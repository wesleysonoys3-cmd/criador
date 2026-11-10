/* =========================================================
 * gamestudio/service.js — Orquestração do Game Studio (2D e 3D)
 * ---------------------------------------------------------
 * Cria projetos de jogo (Phaser 3 para 2D, Three.js para 3D),
 * gera jogos jogáveis, edita por comando (determinístico, sem
 * IA), versiona, testa e prepara a pré-visualização
 * reutilizando a infraestrutura de projetos/preview já
 * existente no servidor.
 *
 * As duas engines compartilham as MESMAS chaves de configuração
 * (title, background, playerColor, enemyColor, itemColor, speed,
 * difficulty, extraEnemies), então comando por texto, ajustes
 * rápidos, versões e testes funcionam igual para 2D e 3D.
 *
 * Integração com a Memória Inteligente (Módulo 4):
 *   - consulta a memória ANTES de gerar;
 *   - registra o projeto e o que foi realizado;
 *   - valida o conhecimento quando os testes passam.
 *
 * ETAPA 5 (Publicação): gera build de produção (snapshot congelado +
 * manifest), publica como público/privado com link /play/<slug>/,
 * permite atualizar e retirar do ar. A publicação externa exige
 * confirmação explícita (confirm === true).
 * =======================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import state, {
  newGameId, normalizeOwner, GAME_STATUS, GAME_TYPES, MAX_VERSIONS, MAX_BUILDS,
} from './state.js';
import {
  TEMPLATES, GAME_RESOURCES, PHASER_VERSION,
  templateByKey, defaultConfig, normalizeConfig, generateProject,
  TEMPLATES_3D, GAME_RESOURCES_3D, THREE_VERSION,
  templateByKey3D, defaultConfig3D, normalizeConfig3D, generateProject3D,
} from './templates.js';

const _log = (...a) => console.log('[GAMESTUDIO][service]', ...a);

let _initialized = false;
let _memorySvc = null;
let _projectApi = null;

const PROJECT_FILES = ['index.html', 'game.js', 'README.md'];

export function init({ dataDir = null, memorySvc = null, projectApi = null } = {}) {
  state.setDataDir(dataDir || path.resolve(process.cwd(), 'gamestudio/data'));
  if (memorySvc && typeof memorySvc.register === 'function') _memorySvc = memorySvc;
  if (projectApi) _projectApi = projectApi;
  if (!_initialized) {
    _initialized = true;
    state.loadAll().catch(e => _log('loadAll erro:', String(e?.message || e)));
  }
  return { ok: true, dataDir: state.dataDir, games: state.games.size };
}

/* ---------------- Utilidades ---------------- */
function nowIso() { return new Date().toISOString(); }

function getOwned(id, owner) {
  const rec = state.get(id);
  if (!rec) return null;
  if (owner && normalizeOwner(owner) !== normalizeOwner(rec.owner)) return null;
  return rec;
}

function slugify(s) {
  const base = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || 'jogo-2d';
}

function makeSlug(name, id) {
  const tail = String(id || '').replace(/[^a-z0-9]/gi, '').slice(-6) || Date.now().toString(36).slice(-6);
  return 'jogo-' + slugify(name) + '-' + tail;
}

function previewPathFor(slug) { return '/preview/' + encodeURIComponent(slug) + '/'; }
function publicPathFor(slug) { return '/play/' + encodeURIComponent(slug) + '/'; }

/* Hash de conteúdo dos arquivos (identifica a versão publicada). */
function hashFiles(files) {
  const h = crypto.createHash('sha256');
  for (const f of PROJECT_FILES) { h.update(f + '\0'); h.update(String((files || {})[f] ?? '')); h.update('\0'); }
  return h.digest('hex');
}

/* Diretório do snapshot de um build dentro do projeto (workspace). */
function buildDirFor(slug, buildId) {
  return path.join(_projectApi.resolveWritableProjectDir(slug), '_builds', String(buildId));
}

function templateFor(genre) {
  return TEMPLATES.find(t => t.genre === genre)
    || TEMPLATES_3D.find(t => t.genre === genre)
    || TEMPLATES[0];
}

/* Resolve engine conforme o tipo de jogo (2d | 3d). */
function is3D(rec) { return rec && rec.type === '3d'; }
function normalizeForType(type, cfg) { return type === '3d' ? normalizeConfig3D(cfg) : normalizeConfig(cfg); }
function generateForType(type, genre, cfg, name) {
  return type === '3d' ? generateProject3D(genre, cfg, name) : generateProject(genre, cfg, name);
}
function engineLabel(type) {
  return type === '3d' ? 'Three.js ' + THREE_VERSION : 'Phaser ' + PHASER_VERSION;
}

/* ---------------- Arquivos do projeto (workspace reutilizado) ---------------- */
async function writeProjectFiles(slug, files) {
  if (!_projectApi || typeof _projectApi.ensureProject !== 'function' || typeof _projectApi.resolveWritableProjectDir !== 'function') {
    return { ok: false, reason: 'Infraestrutura de projetos indisponível no servidor.' };
  }
  for (const name of Object.keys(files || {})) {
    const rel = String(name).replace(/\\/g, '/');
    if (rel.includes('..') || rel.startsWith('/')) return { ok: false, reason: 'Nome de arquivo inválido.' };
  }
  try {
    await _projectApi.ensureProject(slug);
    const dir = _projectApi.resolveWritableProjectDir(slug);
    await fs.mkdir(dir, { recursive: true });
    for (const name of Object.keys(files || {})) {
      await fs.writeFile(path.join(dir, String(name)), String(files[name]), 'utf8');
    }
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, reason: 'Falha ao gravar os arquivos do jogo: ' + String(e?.message || e) };
  }
}

async function readProjectFiles(slug, names = PROJECT_FILES) {
  let dir = null;
  try { dir = _projectApi.resolveWritableProjectDir(slug); } catch { dir = null; }
  const files = {};
  for (const n of names) {
    try { files[n] = dir ? await fs.readFile(path.join(dir, n), 'utf8') : null; } catch { files[n] = null; }
  }
  return { dir, files };
}

/* ---------------- Versões (histórico de alterações) ---------------- */
function pushVersion(rec, label, files, cfg, status) {
  rec.versions = rec.versions || [];
  rec.versions.push({
    id: 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    at: nowIso(),
    label: String(label || 'Alteração').slice(0, 120),
    genre: rec.genre,
    config: Object.assign({}, cfg || rec.config),
    status: status || rec.status,
    files: Object.assign({}, files || {}),
  });
  if (rec.versions.length > MAX_VERSIONS) rec.versions = rec.versions.slice(-MAX_VERSIONS);
  rec.updatedAt = nowIso();
}

/* ---------------- Resumo exposto à interface ---------------- */
function summary(rec) {
  const t = templateFor(rec.genre);
  const lastTest = (rec.tests || []).length ? rec.tests[rec.tests.length - 1] : null;
  return {
    id: rec.id,
    name: rec.name,
    slug: rec.slug,
    genre: rec.genre,
    genreLabel: t.label,
    type: rec.type,
    technology: rec.technology,
    description: rec.description,
    status: rec.status,
    config: rec.config,
    files: rec.files,
    versionsCount: (rec.versions || []).length,
    testsCount: (rec.tests || []).length,
    lastTest: lastTest ? { at: lastTest.at, ok: lastTest.ok, passed: lastTest.passed, failed: lastTest.failed } : null,
    previewUrl: rec.previewUrl || previewPathFor(rec.slug),
    publication: rec.publication ? {
      active: !!rec.publication.active,
      public: !!rec.publication.public,
      version: rec.publication.version || null,
      buildId: rec.publication.buildId || null,
      hash: rec.publication.hash || null,
      publishedAt: rec.publication.publishedAt || null,
      url: rec.publication.url || publicPathFor(rec.slug),
    } : null,
    buildsCount: (rec.builds || []).length,
    latestBuild: rec.latestBuild || null,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    memoryId: rec.memoryId || null,
  };
}

/* ---------------- Status / catálogo ---------------- */
export function status() {
  const byStatus = {}; for (const s of GAME_STATUS) byStatus[s] = 0;
  const byGenre = {};
  for (const t of TEMPLATES) byGenre[t.genre] = 0;
  for (const t of TEMPLATES_3D) byGenre[t.genre] = 0;
  const byType = { '2d': 0, '3d': 0 };
  for (const r of state.all()) {
    if (byStatus[r.status] !== undefined) byStatus[r.status]++;
    if (byGenre[r.genre] !== undefined) byGenre[r.genre]++;
    if (r.type === '3d') byType['3d']++; else byType['2d']++;
  }
  return {
    ok: true,
    dataDir: state.dataDir,
    total: state.games.size,
    byStatus,
    byGenre,
    byType,
    engine: { name: 'Phaser', version: PHASER_VERSION },
    engines: [
      { name: 'Phaser', version: PHASER_VERSION, type: '2d' },
      { name: 'Three.js', version: THREE_VERSION, type: '3d' },
    ],
    types: GAME_TYPES.slice(),
    statuses: GAME_STATUS.slice(),
    previewRoute: '/preview/<slug>/',
    projectApi: !!_projectApi,
    memory: !!_memorySvc,
  };
}

export function templates() {
  return {
    ok: true,
    engine: { name: 'Phaser', version: PHASER_VERSION },
    engines: [
      { name: 'Phaser', version: PHASER_VERSION, type: '2d' },
      { name: 'Three.js', version: THREE_VERSION, type: '3d' },
    ],
    templates: TEMPLATES.map(t => ({ ...t, type: '2d', defaultConfig: defaultConfig(t.genre, t.label) }))
      .concat(TEMPLATES_3D.map(t => ({ ...t, type: '3d', defaultConfig: defaultConfig3D(t.genre, t.label) }))),
    resources: GAME_RESOURCES.concat(GAME_RESOURCES_3D),
  };
}

export function list(owner = null) {
  return {
    ok: true,
    items: state.list(owner).map(summary)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))),
  };
}

export function get(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Projeto de jogo não encontrado.' };
  return {
    ok: true,
    game: summary(rec),
    versions: (rec.versions || []).map(v => ({
      id: v.id, at: v.at, label: v.label, genre: v.genre, status: v.status, config: v.config,
    })),
    tests: (rec.tests || []).slice(-20),
    commands: (rec.commandLog || []).slice(-30),
    resources: rec.resources || GAME_RESOURCES.slice(),
  };
}

/* ---------------- Criação ---------------- */
export async function create(input = {}, owner = null) {
  if (!_projectApi) return { ok: false, reason: 'Infraestrutura de projetos indisponível no servidor.' };
  const name = String(input.name || input.title || '').trim().slice(0, 80);
  if (!name) return { ok: false, reason: 'Informe o nome do jogo.' };

  // Aceita templates 2D (Phaser) e 3D (Three.js).
  const key = input.genre || input.template || input.key;
  const tpl2d = templateByKey(key);
  const tpl3d = tpl2d ? null : templateByKey3D(key);
  const tpl = tpl2d || tpl3d;
  if (!tpl) {
    const keys = TEMPLATES.map(t => t.key).concat(TEMPLATES_3D.map(t => t.key)).join(', ');
    return { ok: false, reason: 'Tipo de jogo inválido. Use: ' + keys + '.' };
  }
  const genre = tpl.genre;
  const type = tpl3d ? '3d' : '2d';

  const cfg = normalizeForType(type, Object.assign(
    {},
    (type === '3d' ? defaultConfig3D : defaultConfig)(genre, name),
    (input.config && typeof input.config === 'object') ? input.config : {},
    { title: (input.config && input.config.title) || name },
  ));

  // Módulo 4: consultar a memória antes de gerar (reaproveitar conhecimento).
  const hints = consultMemory(name, genre, owner, type);

  const id = newGameId();
  const slug = makeSlug(name, id);
  const project = generateForType(type, genre, cfg, name);
  const w = await writeProjectFiles(slug, project.files);
  if (w.ok === false) return w;

  const resources = (type === '3d' ? GAME_RESOURCES_3D : GAME_RESOURCES).slice();

  const rec = {
    id,
    owner: normalizeOwner(owner),
    slug,
    name,
    genre,
    type,
    technology: engineLabel(type),
    description: String(input.description || tpl.description).slice(0, 300),
    status: 'pronto',
    config: project.config,
    files: Object.keys(project.files),
    resources,
    versions: [],
    tests: [],
    commandLog: [],
    memoryId: null,
    previewUrl: previewPathFor(slug),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  pushVersion(rec, 'Criação', project.files, project.config, 'pronto');
  await state.save(rec);

  rec.memoryId = registerMemory(rec, owner);
  if (rec.memoryId) await state.save(rec);
  registerTaskMemory(rec, owner, 'Criação do jogo ' + (type === '3d' ? '3D' : '2D'));

  _log('create:', rec.slug, '· tipo=' + type + ' · gênero=' + genre);
  return {
    ok: true,
    game: summary(rec),
    hints,
    generatedWith: { engine: rec.technology, genre, files: rec.files },
  };
}

/* ---------------- Edição por comando (determinística) ---------------- */
const SUBJECTS = [
  ['playerColor', /jogador|player|personagem|nave|her[oó]i|boneco|carro|personagem/],
  ['enemyColor', /inimig|enemy|obst[aá]culo|perigo|espinho|monstro|bloco/],
  ['itemColor', /item|moeda|colet[aá]vel|recompensa|estrela|power|b[oô]nus/],
  ['background', /fundo|background|cen[aá]rio|tela|plano de fundo/],
];

const COLOR_SYNONYMS = {
  azul: ['azul', 'azuis'],
  verde: ['verde', 'verdes'],
  vermelho: ['vermelho', 'vermelha', 'vermelhos', 'vermelhas'],
  amarelo: ['amarelo', 'amarela', 'amarelos', 'amarelas'],
  roxo: ['roxo', 'roxa', 'roxos', 'roxas'],
  laranja: ['laranja', 'laranjas'],
  rosa: ['rosa', 'rosas'],
  ciano: ['ciano', 'ciana'],
  branco: ['branco', 'branca', 'brancos', 'brancas'],
  preto: ['preto', 'preta', 'pretos', 'pretas'],
  cinza: ['cinza', 'cinzas'],
  dourado: ['dourado', 'dourada', 'dourados', 'douradas'],
};

const COLOR_MATCHERS = [];
for (const canonical of Object.keys(COLOR_SYNONYMS)) {
  for (const w of COLOR_SYNONYMS[canonical]) COLOR_MATCHERS.push([w, canonical]);
}

export const COMMAND_HELP = 'Exemplos: "deixe o jogador verde", "fundo preto", "inimigos vermelhos", ' +
  '"mais rápido", "velocidade 380", "dificuldade difícil", "mais inimigos", "renomear para Caverna Azul".';

/** Interpreta um comando em linguagem natural (regras, sem IA). */
export function parseCommand(text) {
  const t = String(text || '').toLowerCase();
  const patch = {};
  const rel = { speedMul: null, enemyAdd: 0 };
  const applied = [];
  // Divide em cláusulas por pontuação e pela conjunção "e".
  const clauses = t.split(/[,;.]|\be\b/);

  for (const clause of clauses) {
    const c = clause.trim();
    if (!c) continue;

    // Cores
    let color = null;
    for (const [w, canonical] of COLOR_MATCHERS) {
      if (new RegExp('\\b' + w + '\\b').test(c)) { color = canonical; break; }
    }
    if (!color) {
      const hex = c.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/);
      if (hex) color = '#' + hex[1];
    }
    if (color) {
      let target = null;
      for (const [key, re] of SUBJECTS) { if (re.test(c)) { target = key; break; } }
      if (target) { patch[target] = color; applied.push('definir ' + target + ' = ' + color); }
    }

    // Velocidade
    const vm = c.match(/(?:velocidade|speed)\D{0,6}(\d{2,4})/);
    if (vm) { patch.speed = Number(vm[1]); applied.push('velocidade = ' + vm[1]); }
    else if (/(mais\s+r[aá]pid|acelerar|mais\s+veloz|mais\s+depressa)/.test(c)) { rel.speedMul = (rel.speedMul || 1) * 1.25; applied.push('aumentar velocidade'); }
    else if (/(mais\s+devagar|mais\s+lent|desacelerar|reduzir\s+a\s+velocidade)/.test(c)) { rel.speedMul = (rel.speedMul || 1) * 0.8; applied.push('reduzir velocidade'); }

    // Dificuldade
    if (/dif[ií]cil|\bhard\b|desafi/.test(c)) { patch.difficulty = 'dificil'; applied.push('dificuldade = difícil'); }
    else if (/f[aá]cil|\beasy\b|simples/.test(c)) { patch.difficulty = 'facil'; applied.push('dificuldade = fácil'); }
    else if (/\bnormal\b|m[eé]dio/.test(c)) { patch.difficulty = 'normal'; applied.push('dificuldade = normal'); }

    // Inimigos / obstáculos
    const nm = c.match(/(\d{1,2})\s*(?:inimig|obst|perig)/);
    if (nm) { patch.extraEnemies = Number(nm[1]); applied.push('inimigos extras = ' + nm[1]); }
    else if (/(mais|aumentar|acrescentar)\D{0,12}(inimig|obst|perig)/.test(c)) { rel.enemyAdd += 2; applied.push('mais inimigos'); }
    else if (/(menos|reduzir|diminuir|tirar)\D{0,12}(inimig|obst|perig)/.test(c)) { rel.enemyAdd -= 2; applied.push('menos inimigos'); }

    // Título
    const tm = c.match(/(?:renomear(?:\s+para)?|mudar\s+o\s+nome\s+para|t[ií]tulo(?:\s+para)?|chamar(?:\s+de)?|nome)\s*:?\s*["']?([a-z0-9à-ú][^"']{1,60})/);
    if (tm) { const val = tm[1].trim(); if (val) { patch.title = val; applied.push('título = "' + val + '"'); } }
  }
  return { patch, rel, applied };
}

export async function applyCommand(id, input = {}, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Projeto de jogo não encontrado.' };

  const text = String(input.text || input.command || '').trim();
  const explicit = (input.patch && typeof input.patch === 'object') ? input.patch : null;
  if (!text && !explicit) return { ok: false, reason: 'Descreva a alteração desejada. ' + COMMAND_HELP };

  const parsed = text ? parseCommand(text) : { patch: {}, rel: { speedMul: null, enemyAdd: 0 }, applied: [] };
  const applied = parsed.applied.slice();
  if (explicit) for (const k of Object.keys(explicit)) applied.push('config.' + k + ' = ' + JSON.stringify(explicit[k]));

  if (!applied.length) return { ok: false, reason: 'Não consegui interpretar o comando. ' + COMMAND_HELP };

  // Resolve ajustes relativos sobre a configuração atual.
  const base = Object.assign({}, rec.config);
  if (parsed.rel.speedMul) base.speed = Math.round((base.speed || 220) * parsed.rel.speedMul);
  if (parsed.rel.enemyAdd) base.extraEnemies = (base.extraEnemies || 0) + parsed.rel.enemyAdd;

  const cfg = normalizeForType(rec.type, Object.assign(base, parsed.patch, explicit || {}));

  const diff = {};
  for (const k of Object.keys(cfg)) if (JSON.stringify(cfg[k]) !== JSON.stringify(rec.config[k])) diff[k] = cfg[k];
  if (!Object.keys(diff).length) return { ok: false, reason: 'O comando não alterou nada no jogo.', applied };

  const project = generateForType(rec.type, rec.genre, cfg, rec.name);
  // Regra 1.4: reescrever APENAS os arquivos afetados (game.js sempre; título muda html/README).
  const toWrite = { 'game.js': project.files['game.js'] };
  if (diff.title !== undefined) {
    toWrite['index.html'] = project.files['index.html'];
    toWrite['README.md'] = project.files['README.md'];
  }
  const w = await writeProjectFiles(rec.slug, toWrite);
  if (w.ok === false) return w;

  rec.config = cfg;
  if (diff.title !== undefined) rec.name = cfg.title;
  rec.status = 'pronto';
  rec.commandLog = [...(rec.commandLog || []), {
    at: nowIso(),
    text: text || '(ajuste estruturado)',
    changed: Object.keys(diff),
  }].slice(-50);

  const cur = await readProjectFiles(rec.slug, PROJECT_FILES);
  pushVersion(rec, 'Comando: ' + (text || Object.keys(diff).join(', ')).slice(0, 60), cur.files, cfg, 'pronto');
  await state.save(rec);

  if (rec.memoryId) updateMemoryContent(rec, owner);
  registerTaskMemory(rec, owner, 'Alteração por comando');

  return { ok: true, changed: Object.keys(diff), game: summary(rec), applied };
}

/* ---------------- Pré-visualização (reutiliza a rota /preview/:slug/) ---------------- */
export async function preview(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Projeto de jogo não encontrado.' };
  if (!_projectApi) return { ok: false, reason: 'Infraestrutura de projetos indisponível no servidor.' };
  try {
    await _projectApi.ensureProject(rec.slug);
    let kind = 'static', entry = 'index.html';
    if (typeof _projectApi.detectProjectPreview === 'function') {
      const i = await _projectApi.detectProjectPreview(rec.slug);
      if (i && i.ok !== false) { kind = i.kind; entry = i.entry; }
    }
    rec.previewUrl = previewPathFor(rec.slug);
    rec.lastPreviewAt = nowIso();
    rec.updatedAt = nowIso();
    await state.save(rec);
    return { ok: true, url: rec.previewUrl, kind, entry, game: summary(rec) };
  } catch (e) {
    return { ok: false, reason: 'Falha ao preparar a pré-visualização: ' + String(e?.message || e) };
  }
}

/* ---------------- Testes (determinísticos) ---------------- */
export async function test(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Projeto de jogo não encontrado.' };

  const { files } = await readProjectFiles(rec.slug, PROJECT_FILES);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || null });

  for (const f of PROJECT_FILES) {
    add('Arquivo ' + f, files[f] != null, files[f] == null ? 'ausente' : (String(files[f]).split('\n').length + ' linhas'));
  }

  const html = files['index.html'];
  if (rec.type === '3d') {
    add('HTML carrega o motor Three.js', !!html && /three(\.min)?\.js/i.test(html));
  } else {
    add('HTML carrega o motor Phaser', !!html && /phaser(\.min)?\.js/i.test(html));
  }
  add('HTML carrega o jogo (game.js)', !!html && /game\.js/.test(html));
  add('HTML possui o contêiner #game-root', !!html && /game-root/.test(html));

  const js = files['game.js'];
  let cfgVal = null;
  if (js) {
    try { new vm.Script(js, { filename: rec.slug + '/game.js' }); add('game.js sem erros de sintaxe', true, null); }
    catch (e) { add('game.js sem erros de sintaxe', false, String(e?.message || e)); }
    const m = js.match(/const GAME_CONFIG = (\{[\s\S]*?\});/);
    if (m) { try { cfgVal = JSON.parse(m[1]); } catch { cfgVal = null; } }
    add('game.js define GAME_CONFIG válido', !!cfgVal, cfgVal ? ('gênero=' + rec.genre) : 'bloco GAME_CONFIG ausente ou inválido');
  }

  const passed = checks.filter(c => c.ok).length;
  const failed = checks.length - passed;
  const ok = failed === 0;
  const entry = { id: 't_' + Date.now().toString(36), at: nowIso(), ok, passed, failed, checks };

  rec.tests = [...(rec.tests || []), entry].slice(-30);
  if (ok) rec.status = 'testado';
  rec.updatedAt = nowIso();
  await state.save(rec);

  if (ok && rec.memoryId && _memorySvc && typeof _memorySvc.validate === 'function') {
    try {
      _memorySvc.validate(rec.memoryId, {
        status: 'Testado',
        note: 'Verificações automáticas do Game Studio aprovadas (' + passed + '/' + checks.length + ').',
        evidence: checks.map(c => (c.ok ? 'OK ' : 'FALHA ') + c.name).join('; '),
      }, owner);
    } catch { /* memória é acessória */ }
  }
  registerTaskMemory(rec, owner, ok ? 'Teste aprovado' : 'Teste com falhas');
  _log('test:', rec.slug, ok ? 'APROVADO' : 'FALHAS=' + failed);
  return { ok: true, result: entry, game: summary(rec) };
}

/* ---------------- Versões ---------------- */
export function versions(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Projeto de jogo não encontrado.' };
  return {
    ok: true,
    items: (rec.versions || []).map(v => ({ id: v.id, at: v.at, label: v.label, genre: v.genre, status: v.status })),
  };
}

export async function restoreVersion(id, versionId, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Projeto de jogo não encontrado.' };
  const v = (rec.versions || []).find(x => x.id === versionId);
  if (!v) return { ok: false, reason: 'Versão não encontrada.' };

  const w = await writeProjectFiles(rec.slug, v.files);
  if (w.ok === false) return w;

  rec.genre = v.genre;
  rec.config = normalizeForType(rec.type, v.config);
  rec.name = rec.config.title || rec.name;
  rec.status = 'pronto';
  pushVersion(rec, 'Restauração de ' + (v.label || v.id), v.files, rec.config, 'pronto');
  await state.save(rec);

  if (rec.memoryId) updateMemoryContent(rec, owner);
  registerTaskMemory(rec, owner, 'Restauração de versão');
  return { ok: true, game: summary(rec) };
}

/* ---------------- Build de produção e publicação (ETAPA 5) ---------------- */
/** Gera um build de produção: snapshot congelado + manifest da versão. */
export async function build(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Projeto de jogo não encontrado.' };
  if (!_projectApi) return { ok: false, reason: 'Infraestrutura de projetos indisponível no servidor.' };

  const { files } = await readProjectFiles(rec.slug, PROJECT_FILES);
  const missing = PROJECT_FILES.filter(f => files[f] == null);
  if (missing.length) return { ok: false, reason: 'Arquivos ausentes no projeto: ' + missing.join(', ') + '.' };

  rec.builds = rec.builds || [];
  const number = (rec.builds.length ? rec.builds[rec.builds.length - 1].number : 0) + 1;
  const buildId = 'b' + number + '_' + Date.now().toString(36);
  const hash = hashFiles(files);

  const manifest = {
    schema: 'gamestudio_build_v1',
    game: {
      name: rec.name, slug: rec.slug, genre: rec.genre,
      genreLabel: templateFor(rec.genre).label, type: rec.type, engine: rec.technology,
    },
    version: number,
    versionId: buildId,
    hash,
    entry: 'index.html',
    files: PROJECT_FILES.slice(),
    generatedAt: nowIso(),
    resources: rec.resources || [],
    multiplayer: { planned: true, enabled: false },
  };

  try {
    const dir = buildDirFor(rec.slug, buildId);
    await fs.mkdir(dir, { recursive: true });
    for (const f of PROJECT_FILES) await fs.writeFile(path.join(dir, f), String(files[f]), 'utf8');
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  } catch (e) {
    return { ok: false, reason: 'Falha ao gravar o build de produção: ' + String(e?.message || e) };
  }

  rec.builds.push({ id: buildId, number, at: nowIso(), hash, dir: '_builds/' + buildId, files: PROJECT_FILES.slice(), manifest });
  if (rec.builds.length > MAX_BUILDS) {
    const removed = rec.builds.slice(0, rec.builds.length - MAX_BUILDS);
    rec.builds = rec.builds.slice(-MAX_BUILDS);
    for (const r of removed) { try { await fs.rm(buildDirFor(rec.slug, r.id), { recursive: true, force: true }); } catch { /* ok */ } }
  }
  rec.latestBuild = { id: buildId, number, at: nowIso(), hash };
  rec.updatedAt = nowIso();
  await state.save(rec);

  registerTaskMemory(rec, owner, 'Build de produção v' + number);
  _log('build:', rec.slug, 'v' + number, hash.slice(0, 10));
  return {
    ok: true,
    build: { id: buildId, number, at: rec.latestBuild.at, hash, dir: '_builds/' + buildId, manifest },
    game: summary(rec),
  };
}

/** Publica (ou atualiza a publicação de) um jogo. Exige confirmação explícita. */
export async function publish(id, input = {}, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Projeto de jogo não encontrado.' };
  if (input.confirm !== true) return { ok: false, reason: 'A publicação exige confirmação explícita.' };
  const isPublic = input.isPublic !== false;

  // Garante que o jogo passa nos testes automáticos antes de ir ao ar.
  const lastTest = (rec.tests || []).slice(-1)[0];
  if (!lastTest || !lastTest.ok) {
    const t = await test(id, owner);
    if (t.ok === false || !t.result || !t.result.ok) {
      return { ok: false, reason: 'O jogo não passou nos testes automáticos. Corrija e tente novamente.', result: t.result || null };
    }
  }

  // Usa o build mais recente ou gera um novo snapshot de produção.
  let b = (rec.builds || []).slice(-1)[0];
  if (!b || input.rebuild === true) {
    const r = await build(id, owner);
    if (r.ok === false) return r;
    b = rec.builds.slice(-1)[0];
  }

  rec.publication = {
    active: true,
    public: isPublic,
    buildId: b.id,
    version: b.number,
    hash: b.hash,
    slug: rec.slug,
    url: publicPathFor(rec.slug),
    publishedAt: nowIso(),
    updatedAt: nowIso(),
  };
  rec.status = 'publicado';
  rec.updatedAt = nowIso();
  await state.save(rec);

  if (rec.memoryId && _memorySvc && typeof _memorySvc.validate === 'function') {
    try {
      _memorySvc.validate(rec.memoryId, {
        status: 'Confirmado',
        note: 'Jogo publicado (v' + b.number + ') e disponível em ' + rec.publication.url + ' (' + (isPublic ? 'público' : 'privado') + ').',
      }, owner);
    } catch { /* acessório */ }
  }
  registerTaskMemory(rec, owner, (isPublic ? 'Publicação pública' : 'Publicação privada') + ' v' + b.number);
  _log('publish:', rec.slug, 'v' + b.number, isPublic ? 'público' : 'privado');
  return { ok: true, publication: summary(rec).publication, game: summary(rec) };
}

/** Retira o jogo do ar (mantém builds e arquivos). */
export async function unpublish(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Projeto de jogo não encontrado.' };
  if (!rec.publication || rec.publication.active !== true) return { ok: false, reason: 'Este jogo não está publicado.' };

  rec.publication.active = false;
  rec.publication.unpublishedAt = nowIso();
  rec.publication.updatedAt = nowIso();
  if (rec.status === 'publicado') rec.status = 'testado';
  rec.updatedAt = nowIso();
  await state.save(rec);

  registerTaskMemory(rec, owner, 'Retirada do ar');
  _log('unpublish:', rec.slug);
  return { ok: true, publication: summary(rec).publication, game: summary(rec) };
}

/** Consulta pública (usada pela rota /play/:slug/ — síncrona). */
export function publicStatus(slug) {
  const s = String(slug || '');
  const rec = state.all().find(r => r.slug === s) || null;
  if (!rec) return { ok: false, reason: 'Jogo não encontrado.' };
  const pub = rec.publication || null;
  if (!pub || pub.active !== true || pub.public !== true) {
    return { ok: false, reason: 'Este jogo não está publicado.', game: summary(rec), publication: summary(rec).publication };
  }
  let dir = null;
  try { dir = buildDirFor(rec.slug, pub.buildId); } catch { dir = null; }
  return {
    ok: true, active: true, public: true, dir,
    version: pub.version, buildId: pub.buildId, entry: 'index.html',
    game: summary(rec), publication: summary(rec).publication,
  };
}

/* ---------------- Remoção ---------------- */
export async function remove(id, owner = null) {
  const rec = getOwned(id, owner);
  if (!rec) return { ok: false, reason: 'Projeto de jogo não encontrado.' };
  await state.remove(rec.id);
  return { ok: true, removed: rec.id, note: 'O registro foi removido. A pasta do projeto no workspace foi mantida.' };
}

/* ---------------- Integração com a Memória Inteligente (Módulo 4) ---------------- */
function memoryContent(rec) {
  const t = templateFor(rec.genre);
  const t3 = is3D(rec);
  return [
    'Jogo ' + (t3 ? '3D' : '2D') + ' gerado pelo Game Studio.',
    'Gênero: ' + rec.genre + ' (' + t.label + ')',
    'Projeto (workspace): ' + rec.slug,
    'Arquivos: ' + (rec.files || []).join(', '),
    'Tecnologia: ' + rec.technology + (t3 ? ' (WebGL)' : ' (HTML5/Canvas)'),
    'Configuração: ' + JSON.stringify(rec.config),
    'Últimos comandos: ' + (rec.commandLog || []).slice(-5).map(c => c.text).join(' | '),
    'Pré-visualização: ' + (rec.previewUrl || previewPathFor(rec.slug)),
    rec.publication && rec.publication.active
      ? 'Publicado: ' + (rec.publication.public ? 'público' : 'privado') + ' v' + rec.publication.version + ' em ' + (rec.publication.url || publicPathFor(rec.slug))
      : 'Publicação: não publicado',
  ].join('\n');
}

function registerMemory(rec, owner) {
  if (!_memorySvc || typeof _memorySvc.register !== 'function') return null;
  const t3 = is3D(rec);
  try {
    const r = _memorySvc.register({
      kind: 'projeto',
      category: 'projetos',
      title: 'Jogo ' + (t3 ? '3D' : '2D') + ' (Game Studio): ' + rec.name,
      summary: templateFor(rec.genre).label + ' em ' + engineLabel(rec.type) + '. Arquivos: ' + (rec.files || []).join(', ') + '.',
      content: memoryContent(rec),
      tags: ['game-studio', t3 ? 'jogo-3d' : 'jogo-2d', rec.genre],
      technologies: t3 ? ['Three.js', 'WebGL', 'JavaScript'] : ['Phaser 3', 'HTML5', 'JavaScript'],
      project: rec.slug,
      status: 'Pendente',
      source: { origin: 'game-studio' },
      files: (rec.files || []).map(f => rec.slug + '/' + f),
    }, owner);
    return (r && r.record && r.record.id) || (r && r.id) || null;
  } catch (e) { _log('registerMemory erro:', String(e?.message || e)); return null; }
}

function updateMemoryContent(rec, owner) {
  if (!_memorySvc || typeof _memorySvc.update !== 'function' || !rec.memoryId) return;
  try {
    _memorySvc.update(rec.memoryId, {
      content: memoryContent(rec),
      summary: templateFor(rec.genre).label + ' em ' + engineLabel(rec.type) + '.',
    }, owner);
  } catch { /* acessório */ }
}

function registerTaskMemory(rec, owner, what) {
  if (!_memorySvc || typeof _memorySvc.registerTask !== 'function') return;
  try {
    _memorySvc.registerTask({
      title: 'Game Studio: ' + what + ' — ' + rec.name,
      summary: what + ' no projeto ' + rec.slug + ' (' + rec.genre + ').',
      project: rec.slug,
      tags: ['game-studio', what],
      task: { objective: what, result: 'Arquivos: ' + (rec.files || []).join(', ') },
    }, owner);
  } catch { /* acessório */ }
}

function consultMemory(name, genre, owner, type) {
  if (!_memorySvc || typeof _memorySvc.search !== 'function') return [];
  const t3 = type === '3d';
  try {
    const r = _memorySvc.search({
      query: name + ' ' + genre + ' jogo ' + (t3 ? '3d threejs' : '2d phaser'),
      technologies: t3 ? ['Three.js'] : ['Phaser 3'],
      limit: 4,
    }, owner);
    const items = (r && (r.items || r.records)) || [];
    return items.map(i => ({ id: i.id, title: i.title, category: i.category, status: i.status }));
  } catch { return []; }
}

export { TEMPLATES, GAME_RESOURCES, PHASER_VERSION, TEMPLATES_3D, GAME_RESOURCES_3D, THREE_VERSION };
