import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = __dirname;

const PORT = Number(process.env.SECURITY_PORT || process.env.PORT || 3400);
const HOST = process.env.HOST || '127.0.0.1';
const AUTO_APPLY_NON_CRITICAL = String(process.env.SECURITY_AUTO_APPLY_NON_CRITICAL || 'false').trim().toLowerCase() === 'true';
const DIAG_MAX_ITERATIONS = Math.max(1, Math.min(8, Number(process.env.SECURITY_DIAG_MAX_ITERATIONS || 3)));
const DIAG_NODE_BIN = process.env.SECURITY_NODE_BIN || process.env.NODE_BIN || process.argv[0];
const CRIADOR_URL = process.env.SECURITY_CRIADOR_URL || 'http://127.0.0.1:3000';
const VOICE_URL   = process.env.SECURITY_VOICE_URL   || 'http://127.0.0.1:3005';

const CRIADOR_WORKSPACE = path.resolve(APP_ROOT, process.env.CRIADOR_WORKSPACE || '../workspace');
const CRIADOR_MOUNTED_JSON = path.resolve(APP_ROOT, process.env.CRIADOR_MOUNTED_JSON || '../mounted_projects.json');
const CRIADOR_PORTS_JSON   = path.resolve(APP_ROOT, process.env.CRIADOR_PORTS_JSON   || '../project_ports.json');
const PUBLIC_DIR = path.resolve(APP_ROOT, 'public');

const AUDIT_DIR  = path.resolve(APP_ROOT, process.env.AUDIT_DIR  || 'audits');
const BACKUP_DIR = path.resolve(APP_ROOT, process.env.BACKUP_DIR || 'backups');
for (const d of [AUDIT_DIR, BACKUP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR, { dotfiles: 'deny', index: ['index.html'] }));

/* ============================================================
   HELPERS
============================================================ */
function keyPrefix(k) {
  if (!k || typeof k !== 'string' || k.length < 6) return '';
  return k.slice(0, 5) + '…' + k.slice(-2);
}
function safeReadJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}
function safeIsInside(base, target) {
  const r = path.resolve(base);
  const t = path.resolve(target);
  return t === r || t.startsWith(r + path.sep);
}
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function listFilesRecursive(base, { maxFiles = 5000, maxBytesPerFile = 2 * 1024 * 1024, excludeDirs = new Set(['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', 'vendor']) } = {}) {
  const out = [];
  let count = 0;
  function walk(p) {
    if (count >= maxFiles) return;
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      const n = path.basename(p);
      if (excludeDirs.has(n)) return;
      let ents;
      try { ents = fs.readdirSync(p); } catch { return; }
      for (const e of ents) walk(path.join(p, e));
    } else if (st.isFile()) {
      if (st.size > maxBytesPerFile) return;
      out.push(p);
      count++;
    }
  }
  walk(base);
  return out;
}
function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function slugSanitize(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}
/* ============================================================
   RC25 · HELPERS ADICIONAIS (Diagnóstico + Auto-Correção)
   - nodeCheckSyntax(): executa node --check no arquivo alvo e retorna erro
   - runAllAutomatedTests(): suíte de testes sintáticos/integração/arquivos
   - ensureProjectDotenv(): garante .env no projeto com variáveis obrigatórias
   - _fetchJson(): wrapper fetch seguro (timeout) p/ checar endpoints
============================================================ */
function _fetchJson(url, { timeoutMs = 5000, method = 'GET', body, headers } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, {
    method,
    signal: ctrl.signal,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const t = await r.text();
    let j = null;
    try { j = JSON.parse(t); } catch {}
    return { ok: r.ok, http: r.status, json: j, raw: t.slice(0, 400) };
  }).catch((e) => {
    const m = String(e && e.message || e);
    const code = m.includes('Abort') ? 'TIMEOUT' : 'NETWORK';
    return { ok: false, http: 0, json: null, raw: '', code, error: m };
  }).finally(() => clearTimeout(to));
}
function nodeCheckSyntax(file) {
  try {
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) return { ok: false, skipped: true, reason: 'arquivo_nao_existe' };
    execSync(`"${DIAG_NODE_BIN}" --check "${abs}"`, { stdio: 'pipe', timeout: 30_000, encoding: 'utf8' });
    return { ok: true, file: path.basename(file) };
  } catch (e) {
    const stderr = String(e && e.stderr || e && e.message || '').slice(0, 1500);
    let line = null;
    let col = null;
    const mL = /(\.m?js|\.cjs|\.tsx?|\.html?)\:(\d+)(?:\:(\d+))?/i.exec(stderr);
    if (mL) { line = Number(mL[2]) || null; col = Number(mL[3]) || null; }
    return {
      ok: false,
      file: path.basename(file),
      line, col,
      stderr: stderr.split(/\r?\n/).slice(0, 4).join(' | '),
    };
  }
}
function ensureProjectDotenv(project, extraWritePairs = []) {
  const envAbs = path.join(project.path, '.env');
  let criado = false, adicionou = 0;
  if (!fs.existsSync(envAbs)) {
    fs.writeFileSync(envAbs, `# .env gerado automaticamente pelo TiAgente Security RC25\n# Projeto: ${project.slug}\n`, 'utf8');
    criado = true;
  }
  let content = fs.readFileSync(envAbs, 'utf8');
  const lines = content.split(/\r?\n/);
  const existing = new Set();
  for (const l of lines) {
    const m = /^([A-Za-z0-9_]+)\s*=/.exec(l.trim());
    if (m) existing.add(m[1]);
  }
  // RC25.3 FIX E (BUG 14): não duplicar GOOGLE_API_KEY se já está presente em extraWritePairs (valor do hardcoded do projeto tem PRIORIDADE sobre default do Security)
  const extraKeys = new Set((extraWritePairs || []).filter(x=>x && x.k).map(x => String(x.k)));
  const required = [];
  if (!extraKeys.has('GOOGLE_API_KEY')) {
    required.push({ k: 'GOOGLE_API_KEY', v: process.env.GOOGLE_API_KEY || '# Preencher: GOOGLE_API_KEY=...' });
  }
  required.push(...extraWritePairs);
  const appends = [];
  for (const item of required) {
    if (!item || !item.k) continue;
    if (existing.has(item.k)) continue;
    // Nunca escrever comentário/valor vazio se for KEY que não temos
    const val = /^#/.test(item.v) || String(item.v).includes('Preencher')
      ? item.v
      : /^\s*$/.test(String(item.v)) ? `# Preencher: ${item.k}=...` : String(item.v);
    appends.push(`${item.k}=${val}`);
  }
  if (appends.length) {
    const final = (content.endsWith('\n') ? content : (content + '\n')) +
      (criado ? '' : '# --- ADICIONADO PELO TIAGENTE SECURITY RC25 ---\n') +
      appends.join('\n') + '\n';
    fs.writeFileSync(envAbs, final, 'utf8');
    adicionou = appends.length;
  }
  // Garantir que o .env esteja no .gitignore
  const gAbs = path.join(project.path, '.gitignore');
  try {
    let g = fs.existsSync(gAbs) ? fs.readFileSync(gAbs, 'utf8') : '';
    if (!/(^|\n)\.env(\s|$|#)/m.test(g)) {
      const prev = (g && !g.endsWith('\n')) ? '\n' : '';
      fs.writeFileSync(gAbs, g + prev + '.env\n', 'utf8');
    }
  } catch {}
  return { ok: true, criado, adicionou, envFile: '.env' };
}
function runAllAutomatedTests(project, opts = {}) {
  const out = {
    ts: Date.now(),
    files: { obrigatoriosEncontrados: [], obrigatoriosFaltando: [], total: 0 },
    jsSyntax: [],
    port: null,
    endpoints: [],
    overall: true,
    pass: true,
    summary: '',
  };
  // 1) Arquivos obrigatórios de um projeto RC22: (index.html, style.css, script.js, README.md, server.js se houver package.json)
  const mustHave = [];
  const allFiles = listFilesRecursive(project.path, { maxFiles: 500, maxBytesPerFile: 512 * 1024 }).map(p => path.relative(project.path, p));
  const relSet = new Set(allFiles.map(x => x.split(path.sep).join('/')));
  function hasAny(rels) {
    for (const r of rels) { if (relSet.has(r)) return true; }
    const namesRels = new Set(allFiles.map(p => path.basename(p)));
    for (const r of rels) { if (namesRels.has(path.basename(r))) return true; }
    return false;
  }
  // RC25 FIX (tests.pass): exigir style.css/script.js SÓ se for PROJETO 100% ESTÁTICO (sem package.json, sem entrypoint backend)
  const pkgPathNow = path.join(project.path, 'package.json');
  const hasPkgNow = fs.existsSync(pkgPathNow);
  const hasBackendEntryNow = (() => {
    if (hasPkgNow) return true;
    return ['server.js', 'index.js', 'app.js', 'main.js', 'src/server.js', 'src/index.js', 'src/app.js']
      .some(c => relSet.has(c));
  })();
  if (hasAny(['index.html']) && !hasPkgNow && !hasBackendEntryNow) {
    mustHave.push('style.css');
    mustHave.push('script.js');
    // README.md: nice-to-have, NÃO é bloqueante para tests.pass (só warning na auditoria). Não push aqui.
  }
  const pkgPath = path.join(project.path, 'package.json');
  const hasPkg = fs.existsSync(pkgPath);
  if (hasPkg) {
    const pkg = safeReadJSON(pkgPath, {}) || {};
    const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    if (deps['express']) mustHave.push('.env');
    if (pkg.main && typeof pkg.main === 'string') {
      const abs = path.join(project.path, pkg.main);
      if (!fs.existsSync(abs)) mustHave.push(pkg.main);
    } else if (deps['express']) {
      const candidates = ['server.js', 'index.js', 'app.js', 'src/server.js', 'src/index.js'];
      let achou = false; for (const c of candidates) if (relSet.has(c)) achou = true;
      if (!achou) mustHave.push('server.js (ou index.js)');
    }
  }
  const uniqueMust = Array.from(new Set(mustHave));
  out.files.total = relSet.size;
  for (const r of uniqueMust) {
    if (relSet.has(r)) out.files.obrigatoriosEncontrados.push(r);
    else {
      const existsByName = allFiles.some(x => path.basename(x) === r.split(' ')[0]);
      if (existsByName) out.files.obrigatoriosEncontrados.push(r);
      else out.files.obrigatoriosFaltando.push(r);
    }
  }
  if (out.files.obrigatoriosFaltando.length) { out.pass = false; out.overall = false; }
  // 2) JS Syntax check (arquivos .js/.mjs/.cjs dentro do projeto, max 12 para não gastar tempo)
  const jsFiles = allFiles.filter(r => /\.(m?js|cjs)$/i.test(r)).slice(0, 12);
  for (const r of jsFiles) {
    const abs = path.join(project.path, r);
    const r2 = nodeCheckSyntax(abs);
    if (r2.skipped) continue;
    out.jsSyntax.push({ file: r, ...r2 });
    if (!r2.ok) { out.pass = false; out.overall = false; }
  }
  // 3) Porta do projeto em project_ports.json / projeto: se está ouvindo,
  //    faz um GET /health ou /api/status e anota.
  const projPort = project.port || null;
  if (projPort && Number(projPort)) {
    out.port = { port: projPort, lsofOk: false, httpOk: null, httpCode: 0, httpRaw: '' };
    try {
      const r = execSync(`lsof -iTCP:${projPort} -sTCP:LISTEN -P -n 2>/dev/null | grep LISTEN | head -1`,
        { stdio: 'pipe', timeout: 3000, encoding: 'utf8' });
      out.port.lsofOk = /LISTEN/i.test(String(r || ''));
    } catch {}
    if (out.port.lsofOk) {
      const h1 = awaitOrNull(() => _fetchJson(`http://127.0.0.1:${projPort}/api/status`, { timeoutMs: 4500 }));
      const h2 = !h1 || !h1.ok ? awaitOrNull(() => _fetchJson(`http://127.0.0.1:${projPort}/health`, { timeoutMs: 4500 })) : h1;
      if (h1) out.endpoints.push({ path: '/api/status', ...h1 });
      if (h2 && h2 !== h1) out.endpoints.push({ path: '/health', ...h2 });
      const ultimo = h2 || h1;
      if (ultimo) { out.port.httpOk = !!ultimo.ok; out.port.httpCode = ultimo.http || 0; out.port.httpRaw = ultimo.raw || ''; }
      if (!ultimo || !ultimo.ok) { out.pass = false; out.overall = false; }
    }
  }
  // 4) Summary
  const c = [
    out.files.obrigatoriosFaltando.length ? `${out.files.obrigatoriosFaltando.length} arquivo(s) obrigatório(s) faltando` : 'Arquivos obrigatórios OK',
    out.jsSyntax.some(x => !x.ok) ? `${out.jsSyntax.filter(x=>!x.ok).length} erro(s) de sintaxe JS` : 'JS Syntax OK',
    projPort ? (out.port && out.port.lsofOk && out.port.httpOk ? `Porta ${projPort} ouvindo + HTTP 200` : (out.port?.lsofOk ? `Porta ${projPort} aberta mas HTTP falhou` : `Porta ${projPort} SEM servidor ouvindo`)) : 'Nenhuma porta associada',
  ];
  out.summary = c.join(' · ');
  return out;
}
function awaitOrNull(fn) { try { return fn(); } catch { return null; } }

/* ============================================================
   PROJETOS (lista workspace criador + mounted_projects.json)
============================================================ */
function scanProjects() {
  const projects = [];
  const seen = new Set();
  const mounted = Array.isArray(safeReadJSON(CRIADOR_MOUNTED_JSON, [])) ? safeReadJSON(CRIADOR_MOUNTED_JSON, []) : [];
  const ports = safeReadJSON(CRIADOR_PORTS_JSON, {}) || {};
  for (const m of mounted) {
    if (!m || !m.slug || !m.path) continue;
    const p = path.resolve(m.path);
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    projects.push({
      slug: slugSanitize(m.slug),
      displayName: m.displayName || m.slug,
      path: p, port: ports[m.slug] || m.port || null, source: 'mounted',
    });
  }
  if (fs.existsSync(CRIADOR_WORKSPACE)) {
    for (const dir of fs.readdirSync(CRIADOR_WORKSPACE)) {
      const abs = path.resolve(CRIADOR_WORKSPACE, dir);
      let st; try { st = fs.statSync(abs); } catch { continue; }
      if (!st.isDirectory()) continue;
      const key = abs.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      projects.push({
        slug: slugSanitize(dir), displayName: dir,
        path: abs, port: ports[dir] || null, source: 'workspace',
      });
    }
  }
  projects.sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  return projects;
}
function resolveProject(slug) {
  if (!slug) return null;
  const s = slugSanitize(slug);
  return scanProjects().find(p => p.slug === s) || null;
}

/* ============================================================
   REGRAS DE AUDITORIA (heurísticas)
   - id, title, description, severity(critico|alto|medio|baixo),
     regex ou matcher, fix(type: comment_inform|env_move|replace_line|regex_replace, ...)
============================================================ */
const RULES = [
  {
    id: 'SEC-HC-GOOGLEKEY', severity: 'critico',
    title: 'GOOGLE_API_KEY / Chave Google hardcoded em código fonte',
    description: 'Chave Google (Gemini, Maps, Cloud, Service Account) escrita diretamente em código com prefixo AIza ou AQ. Deve ser movida para o .env.',
    regex: /\b((?:GOOGLE_API_KEY|GEMINI_API_KEY|GOOGLE_MAPS_KEY|GOOGLE_CLOUD_KEY|FIREBASE_API_KEY)\s*[:=]\s*["']?[A-Za-z0-9_\-]{20,}["']?|(AIza[A-Za-z0-9_\-]{25,})|(AQ\.Ab[A-Za-z0-9_\-]{10,}))/g,
    fix: { type: 'env_move', envKey: 'GOOGLE_API_KEY', comment: 'Mover a chave Google para o arquivo .env e carregar via process.env (dotenv/config).' }
  },
  {
    id: 'SEC-HC-ANYKEY', severity: 'alto',
    title: 'Possível segredo/token hardcoded',
    description: 'Possível token/key hardcoded (prefixos sk-, sk-or-, sk-ant-, sk-proj-, ghp_, gho_, AIza, AQ., AKIA, xoxb-, JWT eyJ..., csk- etc).',
    regex: /\b(sk-[A-Za-z0-9_\-]{16,}|sk-or-v[A-Za-z0-9_\-]{16,}|sk-ant-[A-Za-z0-9_\-]{16,}|sk-proj-[A-Za-z0-9_\-]{16,}|xox[baprs]-[A-Za-z0-9_\-]{16,}|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}|AIza[A-Za-z0-9_\-]{25,}|AQ\.Ab[A-Za-z0-9_\-]{10,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|csk-[A-Za-z0-9_\-]{24,})/g,
    fix: { type: 'comment_inform', note: 'Remova a chave do código. Coloque em .env e importe via biblioteca dotenv.' }
  },
  {
    id: 'SEC-HC-OPENROUTER', severity: 'alto',
    title: 'Chave OpenRouter/Mistral/DeepSeek hardcoded',
    description: 'Chave de API (sk-or-v1..., Cerebras/Mistral prefixo csk- etc) hardcoded em JS/TS/PY.',
    regex: /"(sk-or-v1-[A-Za-z0-9_\-]{20,}|csk-[A-Za-z0-9_\-]{30,})"|'(sk-or-v1-[A-Za-z0-9_\-]{20,}|csk-[A-Za-z0-9_\-]{30,})'/g,
    fix: { type: 'comment_inform', note: 'Mova para .env e use process.env.' }
  },
  {
    id: 'SEC-XSS-INNERHTML', severity: 'medio',
    title: 'Atribuição direta a innerHTML com input do usuário',
    description: 'Dados externos (params, body, query, URL hash, fetch resposta) indo para innerHTML sem sanitização.',
    regex: /innerHTML\s*=\s*[^;\n]*(req\.|\$\{req|location\.hash|URLSearchParams|atob\()/g,
    fix: { type: 'comment_inform', note: 'Use textContent ou sanitize com DOMPurify antes do innerHTML.' }
  },
  {
    id: 'SEC-XSS-DOCWRITE', severity: 'alto',
    title: 'document.write / document.writeln dinâmico',
    description: 'document.write é um vetor clássico de XSS quando recebe dados de query/hash. Evite em produção.',
    regex: /document\.write(ln)?\s*\(/g,
    fix: { type: 'comment_inform', note: 'Substitua por createElement + textContent / appendChild.' }
  },
  {
    id: 'SEC-EX-STATIC-DOTFILES', severity: 'baixo',
    title: 'express.static servindo dotfiles (.env)',
    description: 'Por padrão express.static nega dotfiles, MAS se a pasta static for a raiz o .env pode vazar. Sempre adicione dotfiles:"deny".',
    regex: /express\.static\s*\(\s*(__dirname\s*\+?\s*["']\/?["']?|["']\/["']\s*,)/,
    fix: { type: 'replace_line', note: 'Adicione { dotfiles:"deny", index:["index.html"] } como segundo argumento.' }
  },
  {
    id: 'SEC-EX-CORS-STAR', severity: 'medio',
    title: 'CORS com "*" em serviço autenticado',
    description: 'cors({origin:"*"}) ou Access-Control-Allow-Origin: *. Permite qualquer origem executar requests com credenciais.',
    regex: /Access-Control-Allow-Origin\s*:\s*["']\*["']|cors\s*\(\s*\{\s*origin\s*:\s*["']\*["']/,
    fix: { type: 'comment_inform', note: 'Use allowlist de origens e credentials:true só quando necessário.' }
  },
  {
    id: 'SEC-PT-READFILE-REQ', severity: 'critico',
    title: 'Path Traversal: req.params/body/query em fs.readFile/fs.readFileSync sem baseDir',
    description: 'Input do usuário (req.body/params/query) vai direto para fs sem validar que o caminho final está DENTRO de uma pasta permitida (workspace).',
    regex: /fs\.(readFile|readFileSync|writeFile|writeFileSync|stat|statSync|unlink|rm|mkdir|open|createReadStream|createWriteStream)\s*\(\s*([^,\n)]*req\.)/,
    fix: { type: 'comment_inform', note: 'Use path.resolve(baseDir, relPath) e valide com if (!relResolved.startsWith(baseDir+path.sep)) return 403.' }
  },
  {
    id: 'SEC-PT-REQUIRE-REQ', severity: 'alto',
    title: 'Path Traversal: req.params/body em require() / import() dinâmico',
    description: 'require(req.params.x) permite carregar arquivos arbitrários e executar código malicioso fora da pasta.',
    regex: /\brequire\s*\(\s*([^)]*req\.|`[^`]*\$\{req\.)/,
    fix: { type: 'comment_inform', note: 'Lista branca de módulos permitidos ou sanitize extensão e baseDir.' }
  },
  {
    id: 'SEC-PT-EXEC-REQ', severity: 'critico',
    title: 'RCE: req.params/body/query direto em exec/execSync/spawn',
    description: 'Input do usuário concatenado em shell command sem whitelist de argumentos. RCE direto.',
    regex: /\b(exec|execSync|spawn|spawnSync)\s*\(\s*([^,\n)]*req\.)/,
    fix: { type: 'comment_inform', note: 'NUNCA concatene req em shell. Whitelist rigorosa de comandos permitidos + argumentos.' }
  },
  {
    id: 'SEC-EX-HELMET-OFF', severity: 'baixo',
    title: 'Sem helmet() nem headers de segurança em Express',
    description: 'app.use(helmet()) não encontrado. Ataques como clickjacking, MIME-sniffing são facilitados.',
    regexMeta: 'absent_marker',
    absentMarker: /\bhelmet\s*\(/,
    severity: 'baixo',
    title: 'HEADER: helmet() ausente',
    description: 'Considere adicionar helmet() como middleware para headers de segurança padrão (CSP, X-Frame-Options, X-Content-Type-Options).',
    fix: { type: 'comment_inform', note: 'npm i helmet e app.use(helmet()) logo após app.use(cors()).' }
  },
  {
    id: 'SEC-PKG-VULN-DEPS', severity: 'baixo',
    title: 'Pacotes com vulnerabilidades conhecidas (heurística)',
    description: 'package.json com dependências antigas ou suspeitas (ex.: lodash < 4.17.21, express < 4.19.2, marked < 4.0.10, serialize-javascript < 3.1.0).',
    regexMeta: 'package_json_check',
    fix: { type: 'comment_inform', note: 'Rode npm audit e npm update. Alvos rápidos: express, lodash, marked, serialize-javascript.' }
  },
  {
    id: 'SEC-SESS-LOCALSTORAGE-TOKEN', severity: 'medio',
    title: 'localStorage armazenando JWT/senha ou chave',
    description: 'localStorage.setItem com "token"/"jwt"/"senha"/"password" sofre de XSS -> sequestro de sessão.',
    regex: /localStorage\.setItem\s*\(\s*["']([^"']*(token|jwt|auth|senha|password|apikey|api_key|secret)[^"']*)["']/i,
    fix: { type: 'comment_inform', note: 'Use cookie HttpOnly; Secure; SameSite para sessões.' }
  },
  /* ===== RC25 · NOVAS REGRAS (Diagnóstico & Integração) ===== */
  {
    id: 'SEC-INT-DOTENV-ABSENT', severity: 'alto',
    title: 'Projeto Express sem arquivo .env ou sem `import dotenv/config`',
    description: 'Projeto que usa express/require(fetch com API key) SEM dotenv/config no topo do server.js. Variáveis sensíveis podem ficar hardcoded ou indefinidas.',
    regexMeta: 'custom_matcher_dotenv',
    fix: { type: 'ensure_dotenv', note: 'Cria .env, adiciona GOOGLE_API_KEY placeholder, adiciona `import \'dotenv/config\'` no topo de server.js, garante .env no .gitignore.' }
  },
  {
    id: 'SEC-EX-STATIC-UNPROTECTED', severity: 'medio',
    title: 'express.static sem proteção explícita { dotfiles:"deny", index:["index.html"] }',
    description: 'express.static pode servir .env se a pasta estiver errada. Sempre adicione o 2º argumento de proteção.',
    regex: /express\.static\s*\(\s*([^()]*(?:\([^()]*\)[^()]*)*)\s*\)/g,
    fix: { type: 'regex_replace', searchTemplate: 'express.static(<ARGS>)', replaceTemplate: 'express.static(<ARGS>, { dotfiles: \'deny\', index: [\'index.html\'] })' }
  },
  {
    id: 'SEC-JS-SYNTAXCHECK', severity: 'critico',
    title: 'Erro de sintaxe JavaScript detectado (node --check falhou)',
    description: 'Arquivo JS do projeto falha na verificação de sintaxe. O arquivo NÃO carrega no Node/navenador e quebra integrações.',
    regexMeta: 'custom_matcher_jsSyntax',
    fix: { type: 'comment_inform', note: 'Corrija o erro de sintaxe antes de publicar. Usei node --check; linha/coluna anotada no finding.' }
  },
  {
    id: 'SEC-INT-ENDPT-CRIADOR', severity: 'baixo',
    title: 'Criador RC22 (3000) não está respondendo /api/status',
    description: 'Integração do Criador (porta 3000) /api/status não retornou 200 OK durante o diagnóstico.',
    regexMeta: 'custom_matcher_endpoints',
    fix: { type: 'comment_inform', note: 'Verifique se server.js rodou na porta 3000. Use start_factory.sh ou start_all.command.' }
  },
  {
    id: 'SEC-INT-ENDPT-VOICE', severity: 'baixo',
    title: 'Voice REST (3005) /health não está respondendo',
    description: 'Integração de Voz (porta 3005) /health não retornou 200 OK durante o diagnóstico.',
    regexMeta: 'custom_matcher_endpoints',
    fix: { type: 'comment_inform', note: 'Verifique se voice_rest_server.js está rodando na 3005. Restart: bash stop-all.command + start_factory.sh.' }
  },
  {
    id: 'SEC-FS-MISSING-MANDATORY', severity: 'critico',
    title: 'Arquivos obrigatórios do projeto RC22 ausentes',
    description: 'Faltam arquivos fundamentais (style.css, script.js, server.js, .env, README.md etc) esperados para um projeto RC22 executar.',
    regexMeta: 'custom_matcher_missingFiles',
    fix: { type: 'comment_inform', note: 'Re-execute a fase DEV do RC22 para gerar os arquivos ausentes, ou crie manualmente o arquivo listado na linha.' }
  },
  {
    id: 'SEC-PKG-MISSING-INSTALL', severity: 'medio',
    title: 'package.json existe mas node_modules NÃO existe (npm install nunca rodou)',
    description: 'Se package.json existe mas a pasta node_modules não está presente, o servidor nunca vai rodar e as integrações vão falhar 100% com MODULE_NOT_FOUND.',
    regexMeta: 'custom_matcher_nodeModules',
    fix: { type: 'shell_auto_safe', note: 'Roda npm install automaticamente na pasta do projeto (só se houver package.json e faltar node_modules).' }
  },
  {
    id: 'SEC-PT-FS-SAFE-RESOLVE', severity: 'alto',
    title: 'Operação fs sem path.resolve + baseDir check (risco path traversal)',
    description: 'fs.readFile/writeFile com concatenação manual (relPath colado) sem safeIsInside(baseDir, abs) → risco clássico de path traversal ../../.',
    regex: /(?:^|[^.\w])fs\.(readFile|writeFile|stat|unlink|mkdir|open|readFileSync|writeFileSync|statSync|createReadStream|createWriteStream)\s*\(\s*([A-Za-z0-9_.$]+\s*\+\s*["']?\s*\/?["']?\s*[A-Za-z0-9_.$-]+)/,
    fix: { type: 'comment_inform', note: 'Sempre faça `const abs = path.resolve(baseDir, rel); if (!abs.startsWith(baseDir+path.sep)) return 403;` antes de qualquer fs.*' }
  },
];

/* ============================================================
   EXECUTA UMA AUDITORIA: gera findings[] + counts + score + grade
============================================================ */
function runAuditOnProject(project) {
  const report = {
    id: Date.now().toString(36) + '-' + crypto.randomBytes(8).toString('hex'),
    ts: Date.now(),
    project: { slug: project.slug, displayName: project.displayName, path: project.path, port: project.port, source: project.source },
    files: 0, bytes: 0,
    counts: { critico: 0, alto: 0, medio: 0, baixo: 0, seguro: 0 },
    findings: [],
    hashes: {},
    filePatterns: [],
  };

  const files = listFilesRecursive(project.path, { maxFiles: 5000, maxBytesPerFile: 2.5 * 1024 * 1024 });
  report.files = files.length;

  const exts = new Set();
  for (const f of files) {
    const text = readText(f);
    const rel = path.relative(project.path, f);
    if (text !== null) {
      report.hashes[rel] = sha256(text);
      report.bytes += Buffer.byteLength(text, 'utf8');
    } else {
      try { report.bytes += fs.statSync(f).size; } catch {}
    }
    const ext = path.extname(f).toLowerCase();
    if (ext) exts.add(ext);
    if (text === null) continue;

    // regras por regex
    const lines = text.split(/\r?\n/);
    for (const rule of RULES) {
      if (rule.regexMeta) continue;
      // RC25.2 FIX A: não escanear arquivos .env / .env.* para SEC-HC-* (chaves lá são o destino CORRETO — não é hardcoded indevido)
      if (/^SEC-HC-/.test(rule.id) && (rel === '.env' || /^\.env\./.test(rel))) continue;
      // RC25.2 FIX A2: SEC-EX-STATIC-UNPROTECTED só faz sentido em arquivos JS/TS (skip para .env, .html, etc)
      if (rule.id === 'SEC-EX-STATIC-UNPROTECTED' && !/\.(js|mjs|cjs|ts)$/i.test(rel)) continue;
      const re = new RegExp(rule.regex.source, rule.regex.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        // descobrir linha
        let lineNumber = 1;
        const idx = m.index;
        for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) lineNumber++;
        const line = lines[lineNumber - 1] || '';
        // RC25 FIX 1 (anti-loop infinito): NÃO detectar hardcoded secrets em linhas JÁ COMENTADAS
        // (evita FIXME_SECURITY ser re-detectado todas iterações seguintes)
        if (/^(SEC-HC-|SEC-EX-STATIC-UNPROTECTED$)/.test(rule.id) && /^\s*(\/\/|\/\*|\*|#)/.test(line)) {
          if (m.index === re.lastIndex) re.lastIndex++;
          continue;
        }
        // RC25.3 FIX B: SEC-EX-STATIC-UNPROTECTED → pular se a linha JÁ contém dotfiles: "deny" ou dotfiles: 'deny'
        // (falso-positivo: a regex não olha dentro do segundo argumento; essa checagem elimina FP 100%)
        if (rule.id === 'SEC-EX-STATIC-UNPROTECTED' && /dotfiles\s*:\s*(["\'])deny\1/.test(line)) {
          if (m.index === re.lastIndex) re.lastIndex++;
          continue;
        }
        const finding = {
          findingId: sha256(rule.id + '|' + rel + '|' + lineNumber + '|' + m[0].slice(0, 80)).slice(0, 24),
          ruleId: rule.id,
          severity: rule.severity,
          title: rule.title,
          description: rule.description,
          file: rel,
          line: lineNumber,
          before: line,
          fix: rule.fix || null,
        };
        report.findings.push(finding);
        report.counts[rule.severity] = (report.counts[rule.severity] || 0) + 1;
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }

    // Regra SEC-EX-HELMET-OFF: ausente em arquivos .js de um projeto Express
    // (não rodamos por arquivo; fazemos em package.json abaixo)

    // localStorage é client-side: ignorar se for arquivo server
    // (já coberto por regex acima em .js/.ts)
  }

  // ===== Package.json rules: HELLY absent + deps antigas =====
  const pkgPath = path.join(project.path, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = safeReadJSON(pkgPath, null);
    if (pkg && (pkg.dependencies || pkg.devDependencies)) {
      // SEC-EX-HELMET-OFF: se tiver express e NÃO tiver helmet
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (allDeps['express'] && !allDeps['helmet']) {
        const finding = {
          findingId: sha256('SEC-EX-HELMET-OFF|' + project.slug + '|package.json').slice(0, 24),
          ruleId: 'SEC-EX-HELMET-OFF', severity: 'baixo',
          title: 'HEADER: helmet() ausente',
          description: 'Projeto usa Express mas não tem "helmet" como dependência. Recomendado instalar.',
          file: 'package.json', line: 1,
          before: JSON.stringify(allDeps).slice(0, 200),
          fix: RULES.find(r => r.id === 'SEC-EX-HELMET-OFF').fix,
        };
        report.findings.push(finding);
        report.counts.baixo++;
      }
  // Pacotes suspeitos antigos (heurística nomes)
      const SUSP = [
        { name: 'lodash', min: '4.17.21' },
        { name: 'express', min: '4.19.2' },
        { name: 'marked', min: '4.0.10' },
        { name: 'serialize-javascript', min: '3.1.0' },
        { name: 'minimist', min: '1.2.6' },
        { name: 'shell-quote', min: '1.7.3' },
      ];
      for (const s of SUSP) {
        if (!allDeps[s.name]) continue;
        const v = String(allDeps[s.name]).replace(/^[\^~]/, '');
        if (/^[0-9]+\.[0-9]+\.[0-9]+$/.test(v)) {
          const parts = v.split('.').map(Number);
          const want = s.min.split('.').map(Number);
          let older = false;
          for (let i = 0; i < 3; i++) {
            if ((parts[i] || 0) < (want[i] || 0)) { older = true; break; }
            if ((parts[i] || 0) > (want[i] || 0)) break;
          }
          if (older) {
            const f = {
              findingId: sha256('SEC-PKG-VULN-DEPS|' + s.name + '|' + v).slice(0, 24),
              ruleId: 'SEC-PKG-VULN-DEPS', severity: 'baixo',
              title: `Dep. potencialmente vulnerável: ${s.name}@${v} (mínimo sugerido ${s.min})`,
              description: `Versão antiga detectada por heurística. Verifique com "npm audit".`,
              file: 'package.json', line: 1,
              before: `"${s.name}": "${allDeps[s.name]}"`,
              fix: RULES.find(r => r.id === 'SEC-PKG-VULN-DEPS').fix,
            };
            report.findings.push(f);
            report.counts.baixo++;
          }
        }
      }
    }
  }

  /* ===== RC25 · CUSTOM MATCHERS NOVOS ===== */
  const allRelFiles = files.map(f => path.relative(project.path, f));
  const allRel = new Set(allRelFiles.map(x => x.split(path.sep).join('/')));
  // (i) JS Syntax check + CUSTOM_MATCHER_JSYNTAX
  try {
    for (const f of allRelFiles) {
      if (!/\.(m?js|cjs)$/i.test(f)) continue;
      const abs = path.join(project.path, f);
      const s = nodeCheckSyntax(abs);
      if (s.skipped) continue;
      if (!s.ok) {
        report.findings.push({
          findingId: sha256('SEC-JS-SYNTAXCHECK|' + f + '|' + (s.line || 0) + '|' + s.stderr.slice(0, 30)).slice(0, 24),
          ruleId: 'SEC-JS-SYNTAXCHECK', severity: 'critico',
          title: 'Erro de sintaxe JavaScript em ' + f + (s.line ? ' (linha ' + s.line + ')' : ''),
          description: 'node --check falhou: ' + (s.stderr || '').slice(0, 300),
          file: f, line: s.line || 1, before: s.stderr ? s.stderr.split(' | ')[0] || '' : '',
          fix: RULES.find(r => r.id === 'SEC-JS-SYNTAXCHECK').fix,
        });
        report.counts.critico++;
      }
    }
  } catch {}
  // (ii) SEC-INT-DOTENV-ABSENT
  try {
    const usesExpress = (() => {
      // 1º opção: detectar por package.json dependencies['express']
      if (fs.existsSync(pkgPath)) {
        const p = safeReadJSON(pkgPath, {}) || {};
        const d = Object.assign({}, p.dependencies || {}, p.devDependencies || {});
        if (d['express']) return true;
      }
      // RC25 FIX 9: fallback se NÃO tem package.json (projeto mínimo) → scanear arquivos JS por import/require express
      const jsFiles = allRelFiles.filter(r => /\.(m?js|cjs|ts)$/i.test(r));
      for (const r of jsFiles.slice(0, 20)) {
        const abs = path.join(project.path, r);
        const tx = readText(abs);
        if (!tx) continue;
        if (/require\s*\(\s*['"]express['"]\s*\)/.test(tx)) return true;
        if (/from\s+['"]express['"]/.test(tx)) return true;
        if (/^\s*import\s+express\b/m.test(tx)) return true;
      }
      return false;
    })();
    if (usesExpress) {
      const hasEnv = fs.existsSync(path.join(project.path, '.env'));
      const serverCandidates = ['server.js', 'index.js', 'app.js', 'main.js', 'src/server.js', 'src/index.js', 'src/app.js'];
      let serverFile = null;
      for (const c of serverCandidates) if (fs.existsSync(path.join(project.path, c))) { serverFile = c; break; }
      // Se não achou candidatos, usa o primeiro arquivo JS encontrado como entrypoint.
      if (!serverFile) {
        const jsFirst = allRelFiles.find(r => /\.(m?js|cjs)$/i.test(r));
        if (jsFirst) serverFile = jsFirst;
      }
      let hasDotenvImport = false;
      if (serverFile) {
        const t = readText(path.join(project.path, serverFile)) || '';
        hasDotenvImport = /import\s+['"]dotenv\/config['"]|require\(['"]dotenv['"]\)\.config/.test(t);
      }
      if (!hasEnv || !hasDotenvImport) {
        report.findings.push({
          findingId: sha256('SEC-INT-DOTENV-ABSENT|' + project.slug).slice(0, 24),
          ruleId: 'SEC-INT-DOTENV-ABSENT', severity: 'alto',
          title: (!hasEnv ? '.env ausente. ' : '') + (!hasDotenvImport ? (serverFile || 'entrypoint') + ' não carrega dotenv/config' : ''),
          description: 'Projeto Express sem configuração segura de env vars: ' + ((!hasEnv && !hasDotenvImport) ? 'sem .env e sem import' : (!hasEnv ? 'sem arquivo .env' : 'sem import dotenv no entrypoint.')),
          file: serverFile || 'package.json', line: 1,
          before: serverFile ? (readText(path.join(project.path, serverFile)) || '').split(/\r?\n/)[0] || '' : '',
          fix: RULES.find(r => r.id === 'SEC-INT-DOTENV-ABSENT').fix,
        });
        report.counts.alto++;
      }
    }
  } catch {}
  // (iii) SEC-EX-STATIC-UNPROTECTED (já está no loop de regex acima, nada a fazer aqui)
  // (iv) SEC-FS-MISSING-MANDATORY
  try {
    const need = [];
    // RC25 FIX: exige style.css/script.js/README SÓ se NÃO tem package.json e NÃO tem entrypoint backend (HTML estático puro)
    const hasPkgStaticCheck = fs.existsSync(pkgPath);
    const hasEntryStaticCheck = hasPkgStaticCheck ? true : (
      allRel.has('server.js') || allRel.has('index.js') || allRel.has('app.js') ||
      allRel.has('src/server.js') || allRel.has('src/index.js') || allRel.has('src/app.js') ||
      allRel.has('main.js')
    );
    if (allRel.has('index.html') && !hasPkgStaticCheck && !hasEntryStaticCheck) {
      if (!allRel.has('style.css')) need.push('style.css');
      if (!allRel.has('script.js')) need.push('script.js');
      if (!allRel.has('README.md')) need.push('README.md'); // para estático, README é obrigatório (entregável)
    }
    if (fs.existsSync(pkgPath)) {
      const p = safeReadJSON(pkgPath, {}) || {};
      const d = Object.assign({}, p.dependencies || {}, p.devDependencies || {});
      if (d['express'] && !fs.existsSync(path.join(project.path, '.env'))) need.push('.env');
      if (d['express']) {
        const entries = ['server.js', 'index.js', 'app.js', 'src/server.js', 'src/index.js', 'src/app.js'];
        let ok = false; for (const e of entries) if (allRel.has(e)) ok = true;
        if (!ok) need.push('server.js (ou entrypoint Express)');
      }
    }
    for (const miss of need) {
      report.findings.push({
        findingId: sha256('SEC-FS-MISSING-MANDATORY|' + project.slug + '|' + miss).slice(0, 24),
        ruleId: 'SEC-FS-MISSING-MANDATORY', severity: 'critico',
        title: 'Arquivo obrigatório ausente: ' + miss,
        description: 'Projeto RC22 incompleto — faltam arquivos fundamentais para rodar/entregar.',
        file: miss.split(' (')[0], line: 1, before: '(arquivo não existe)',
        fix: RULES.find(r => r.id === 'SEC-FS-MISSING-MANDATORY').fix,
      });
      report.counts.critico++;
    }
  } catch {}
  // (v) SEC-PKG-MISSING-INSTALL
  try {
    if (fs.existsSync(pkgPath) && !fs.existsSync(path.join(project.path, 'node_modules'))) {
      report.findings.push({
        findingId: sha256('SEC-PKG-MISSING-INSTALL|' + project.slug).slice(0, 24),
        ruleId: 'SEC-PKG-MISSING-INSTALL', severity: 'medio',
        title: 'npm install nunca foi executado (sem node_modules)',
        description: 'Sem a pasta node_modules o servidor Node NÃO sobe (MODULE_NOT_FOUND).',
        file: 'package.json', line: 1, before: 'exists package.json, missing node_modules/',
        fix: RULES.find(r => r.id === 'SEC-PKG-MISSING-INSTALL').fix,
      });
      report.counts.medio++;
    }
  } catch {}
  // (vi) SEC-INT-ENDPT-CRIADOR / VOICE  (checados no PIPELINE completo, não no audit standalone para economizar tempo)

  // Calcula score e grade
  const score = (report.counts.critico * 10) + (report.counts.alto * 5) + (report.counts.medio * 2) + (report.counts.baixo * 1);
  let grade = 'A';
  if (score >= 100) grade = 'E';
  else if (score >= 60) grade = 'D';
  else if (score >= 30) grade = 'C';
  else if (score >= 10) grade = 'B';
  if (report.counts.critico >= 3 && grade === 'B') grade = 'C';
  if (report.counts.critico >= 6) grade = Math.min(grade, 'D');
  if (report.counts.critico >= 10) grade = 'E';

  report.score = score;
  report.grade = grade;
  report.filePatterns = Array.from(exts).sort();

  // Ordena findings por severidade critico -> baixo
  const ordem = { critico: 0, alto: 1, medio: 2, baixo: 3, seguro: 4 };
  report.findings.sort((a, b) => (ordem[a.severity] ?? 9) - (ordem[b.severity] ?? 9));

  return report;
}

/* ============================================================
   SALVAR / LER RELATÓRIOS
============================================================ */
function saveAudit(report) {
  const f = path.join(AUDIT_DIR, `${slugSanitize(report.project.slug)}-${report.ts}-${report.id}.json`);
  fs.writeFileSync(f, JSON.stringify(report, null, 2));
  return f;
}

/* ============================================================
   BACKUP / RESTAURAR
============================================================ */
function backupProject(project, { tag = 'auto' } = {}) {
  const ts = Date.now();
  const slugDir = path.join(BACKUP_DIR, slugSanitize(project.slug));
  fs.mkdirSync(slugDir, { recursive: true });
  const fileName = `${ts}-${tag}.tar.gz`;
  const filePath = path.join(slugDir, fileName);
  // Usar tar via execSync (macOS tem tar nativo)
  try {
    execSync(`tar -czf "${filePath}" -C "${path.dirname(project.path)}" "${path.basename(project.path)}"`, { stdio: 'pipe', timeout: 120_000 });
  } catch (e) {
    // Fallback: gzip manual via Node (arquivos regulares) — se tar falhar
    try {
      const all = listFilesRecursive(project.path, { maxFiles: 20000 });
      const payload = {};
      for (const f of all) {
        const rel = path.relative(project.path, f);
        try { payload[rel] = fs.readFileSync(f, 'utf8'); } catch { payload[rel + '::BINARY'] = fs.readFileSync(f).toString('base64'); }
      }
      const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
      const gz = zlib.gzipSync(b64);
      fs.writeFileSync(filePath, gz);
    } catch (e2) {
      throw new Error('Falha ao criar backup (tar + fallback node): ' + String((e && e.message) || e) + ' | ' + String((e2 && e2.message) || e2));
    }
  }
  const st = fs.statSync(filePath);
  return { file: path.relative(APP_ROOT, filePath), ts, size: st.size, absPath: filePath };
}
function listBackups(project) {
  const slugDir = path.join(BACKUP_DIR, slugSanitize(project.slug));
  if (!fs.existsSync(slugDir)) return [];
  const out = [];
  for (const f of fs.readdirSync(slugDir)) {
    const abs = path.join(slugDir, f);
    const st = fs.statSync(abs);
    if (!st.isFile()) continue;
    const ts = parseInt(f.split('-')[0] || '0', 10);
    out.push({ file: path.relative(APP_ROOT, abs), absPath: abs, ts: ts || st.mtimeMs, size: st.size });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}
function restoreBackup(project, backupRelFile) {
  const absBackup = path.resolve(APP_ROOT, backupRelFile);
  if (!fs.existsSync(absBackup)) throw new Error('Backup não existe: ' + backupRelFile);

  // 1) Safety backup do estado atual
  const safety = backupProject(project, { tag: 'safety-before-restore' });

  // 2) Apagar conteúdo ATUAL do projeto (menos .gi*, .DS_Store)
  for (const e of fs.readdirSync(project.path)) {
    const p = path.join(project.path, e);
    if (e === '.git' || e === '.gitignore' || e === '.gitattributes' || e === '.DS_Store') continue;
    try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
  }

  // 3) Extrair: tentar tar primeiro
  let ok = false;
  try {
    execSync(`tar -xzf "${absBackup}" -C "${path.dirname(project.path)}"`, { stdio: 'pipe', timeout: 120_000 });
    ok = true;
  } catch {
    try {
      const gz = fs.readFileSync(absBackup);
      const raw = zlib.gunzipSync(gz).toString('utf8');
      const b64 = JSON.parse(raw);
      const payload = JSON.parse(Buffer.from(typeof b64 === 'string' ? b64 : '{}', 'base64').toString('utf8'));
      for (const key of Object.keys(payload)) {
        const [rel, binFlag] = key.split('::BINARY');
        const abs = path.join(project.path, binFlag ? rel : key);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (binFlag) fs.writeFileSync(abs, Buffer.from(payload[key], 'base64'));
        else fs.writeFileSync(abs, payload[key], 'utf8');
      }
      ok = true;
    } catch {}
  }
  if (!ok) throw new Error('Não foi possível restaurar (tar + fallback falharam).');
  return { safetyBackupFile: safety.file, restored: absBackup };
}

/* ============================================================
   FIXES: aplicar uma finding (comentar a linha, etc)
============================================================ */
function applyFix(finding, project) {
  const ruleId = finding && finding.ruleId ? finding.ruleId : '';
  const fix = finding && finding.fix ? finding.fix : null;
  if (!finding || !fix) return { applied: false, reason: 'sem fix' };

  /* ===== RC25 · NOVOS FIXES AUTOMÁTICOS SEGUROS =====
     (executados MESMO que finding.file não exista — alguns operam em nível de projeto) */

  // (A) SEC-INT-DOTENV-ABSENT: cria .env + garante import 'dotenv/config' no topo + .gitignore .env
  if (ruleId === 'SEC-INT-DOTENV-ABSENT' || fix.type === 'ensure_dotenv') {
    try {
      const r1 = ensureProjectDotenv(project);
      const serverCandidates = ['server.js', 'index.js', 'app.js', 'main.js', 'src/server.js', 'src/index.js', 'src/app.js'];
      let serverFile = null;
      for (const c of serverCandidates) if (fs.existsSync(path.join(project.path, c))) { serverFile = c; break; }
      let r2 = { applied: false, reason: 'sem entrypoint detectado (pode ser client-only HTML)' };
      if (serverFile) {
        const sAbs = path.join(project.path, serverFile);
        if (safeIsInside(project.path, sAbs)) {
          const tx = fs.readFileSync(sAbs, 'utf8');
          if (!/^\s*import\s+['"]dotenv\/config['"]\s*;?\s*$/m.test(tx)) {
            const linhas = tx.split(/\r?\n/);
            let insertIdx = 0;
            // Pula shebang (#!/usr/bin/env node)
            if (linhas.length && /^#!/.test(linhas[0])) insertIdx = 1;
            linhas.splice(insertIdx, 0, `import 'dotenv/config';  // adicionado automaticamente TiAgente Security RC25`);
            const novo = linhas.join('\n') + (tx.endsWith('\n') ? '\n' : '');
            fs.writeFileSync(sAbs, novo, 'utf8');
            r2 = { applied: true, file: serverFile, action: 'inserted import dotenv/config na linha 1' };
          } else {
            r2 = { applied: true, file: serverFile, action: 'dotenv já importado — skip linha' };
          }
        }
      }
      return {
        applied: true, ruleId, fixType: fix.type,
        envCriado: r1.criado, envAdicionouVars: r1.adicionou, dotenvEntrypoint: r2,
      };
    } catch (e) {
      return { applied: false, ruleId, reason: String(e && e.message || e) };
    }
  }

  // (B) SEC-PKG-MISSING-INSTALL: npm install só se tiver package.json e faltar node_modules
  if (ruleId === 'SEC-PKG-MISSING-INSTALL' || fix.type === 'shell_auto_safe') {
    try {
      const pj = path.join(project.path, 'package.json');
      if (!fs.existsSync(pj)) return { applied: false, reason: 'sem package.json' };
      if (fs.existsSync(path.join(project.path, 'node_modules'))) return { applied: false, reason: 'node_modules já existe' };
      execSync(`npm install --no-audit --no-fund --loglevel=error`, { cwd: project.path, stdio: 'pipe', timeout: 180_000, encoding: 'utf8' });
      return { applied: true, ruleId, fixType: fix.type, acao: 'npm install executado com sucesso na pasta do projeto.' };
    } catch (e) {
      return { applied: false, ruleId, reason: 'npm install falhou: ' + String(e && e.message || e).slice(0, 260) };
    }
  }

  // (C) SEC-EX-STATIC-UNPROTECTED: regex_replace express.static()
  if (ruleId === 'SEC-EX-STATIC-UNPROTECTED' || fix.type === 'regex_replace') {
    try {
      const abs = path.resolve(project.path, finding.file);
      if (!safeIsInside(project.path, abs)) throw new Error('Fora da pasta do projeto: ' + finding.file);
      if (!fs.existsSync(abs)) throw new Error('Arquivo não existe: ' + finding.file);
      const tx = fs.readFileSync(abs, 'utf8');
      // RC25.2 FIX C: anti-loop SEC-EX-STATIC — se o arquivo JÁ TEM dotfiles:'deny' em qualquer posição, NÃO reaplicar.
      if (/\bdotfiles\s*:\s*(["\'])deny\1/.test(tx)) {
        return { applied: false, ruleId, reason: 'express.static já contém dotfiles: "deny" (já aplicado — skip anti-loop).' };
      }
      // regex flexível: aceita path.join, __dirname etc. entre parênteses 1-2 níveis
      const re = /express\.static\s*\(\s*((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\s*\)(?![\s\S]{0,2000}\bdotfiles\s*:\s*(["\'])deny\2)/g;
      const nova = tx.replace(re,
        (m, g1) => `express.static(${g1.trim()}, { dotfiles: 'deny', index: ['index.html'] })`);
      if (nova === tx) return { applied: false, ruleId, reason: 'nenhum match express.static encontrado no arquivo' };
      fs.writeFileSync(abs, nova, 'utf8');
      return { applied: true, ruleId, fixType: 'regex_replace', file: finding.file };
    } catch (e) {
      return { applied: false, ruleId, reason: String(e && e.message || e) };
    }
  }

  /* ===== Fim dos novos fixes RC25. A partir daqui = comportamento legado ===== */

  const abs = path.resolve(project.path, finding.file);
  if (!safeIsInside(project.path, abs)) throw new Error('Fora da pasta do projeto: ' + finding.file);
  if (!fs.existsSync(abs)) throw new Error('Arquivo não existe: ' + finding.file);

  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);
  const lineNumber = Number(finding.line) || 1;
  const line = lines[lineNumber - 1];
  if (!line) return { applied: false, reason: 'linha não existe' };

  // Aplicações automáticas SÓ nas regras seguras:
  // SEC-HC-GOOGLEKEY / SEC-HC-ANYKEY / SEC-HC-OPENROUTER => comentar a linha com FIXME e adicionar .env.
  if (/SEC-HC-/.test(ruleId) && (fix.type === 'env_move' || fix.type === 'comment_inform')) {
    // RC25 FIX MAIOR (BUG 1 + BUG 2 corrigidos):
    // Ao invés de só prepend // FIXME (falso positivo, linha ainda executa + loop match),
    // faz a substituição REAL: move o valor para .env e troca a atribuição por process.env.<ENV_KEY>.
    // Anti-loop: se linha já contém TIAGENTE_SECURITY_FIXED, pula (não aplicar 2x).
    try {
      // RC25.2 FIX B: se o arquivo É .env, NÃO aplicar SEC-HC-* (chaves em .env são o DESTINO CORRETO — não comentar!)
      const baseName = path.basename(abs);
      if (baseName === '.env' || /^\.env\./.test(baseName)) {
        return { applied: false, ruleId, reason: 'chave já se encontra no arquivo .env (destino correto) — skip.' };
      }
      const LINE_MARKER = 'TIAGENTE_SECURITY_FIXED';
      if (new RegExp(`//\\s*${LINE_MARKER}|#\\s*${LINE_MARKER}`).test(line)) {
        return { applied: false, ruleId, reason: 'linha já corrigida anteriormente (loop prevent)' };
      }

      // 1) Detectar qual a ENV_KEY destino.
      //    Prioridade: fix.envKey > variável declarada na própria linha (se GOOGLE_API_KEY etc) > heurística prefixo valor.
      function _detectEnvKey(l, fixObj) {
        if (fixObj && fixObj.envKey && typeof fixObj.envKey === 'string' && fixObj.envKey.length >= 3) {
          return fixObj.envKey;
        }
        const decl = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Z_][A-Z0-9_]*)\s*=/.exec(l);
        if (decl && /^(GOOGLE_API_KEY|OPENROUTER_API_KEY|OPENAI_API_KEY|CEREBRAS_API_KEY|MISTRAL_API_KEY|GEMINI_API_KEY|GROQ_API_KEY|ANTHROPIC_API_KEY|WATI_API_TOKEN|STRIPE_SECRET_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|JWT_SECRET|SESSION_SECRET|DATABASE_URL|DB_URL|SUPABASE_URL|SUPABASE_KEY|DISCORD_BOT_TOKEN|SLACK_BOT_TOKEN|GITHUB_TOKEN)$/.test(decl[1])) {
          return decl[1];
        }
        // Heurística: extrai o 1º valor quoted da linha e olha prefixo.
        const qMatch = /=(?:'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)"|`((?:\\.|[^`])*)`)/.exec(l);
        const val = (qMatch && (qMatch[1] || qMatch[2] || qMatch[3])) || '';
        if (/^AIza/.test(val)) return 'GOOGLE_API_KEY';
        if (/^sk-or-/i.test(val)) return 'OPENROUTER_API_KEY';
        if (/^sk-proj-|^sk-ant-|^sk-gcp-|^sk-svcacct-|^sk-/.test(val)) return 'OPENAI_API_KEY';
        if (/^ghp_/.test(val)) return 'GITHUB_TOKEN';
        if (/^eyJ[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}\./.test(val)) return 'JWT_SECRET';
        if (/^\d+:[A-Za-z0-9_-]{20,}$/.test(val)) return 'DISCORD_BOT_TOKEN';
        return null;
      }

      function _extractQuotedValue(l) {
        const m = /=\s*(?:'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)"|`((?:\\.|[^`])*)`)/.exec(l);
        if (m) return m[1] || m[2] || m[3] || '';
        return '';
      }

      const isJsLike = /\.(js|mjs|cjs|jsx|ts|tsx|vue)$/i.test(abs);
      const isPy = /\.py$/i.test(abs);
      const isShOrEnv = /\.(sh|bash|zsh)$/i.test(abs) || /\.env[^/]*$/i.test(abs) || abs.endsWith('.command');

      const envKey = _detectEnvKey(line, fix);
      const valorRaw = _extractQuotedValue(line);
      let novoValorLinha = null;
      let acao = 'comentada (não foi possível substituir atribuição)';
      let valorMovido = false;

      // 2) Mover valor para .env SEMPRE que tivermos valor real e envKey
      if (envKey && typeof valorRaw === 'string' && valorRaw.length >= 6 && !/^Preencher/.test(valorRaw)) {
        const writeRes = ensureProjectDotenv(project, [{ k: envKey, v: valorRaw }]);
        valorMovido = writeRes.ok === true && (writeRes.criado || writeRes.adicionou >= 0);
      }

      if (isJsLike) {
        // Caso JS: TENTA substituir atribuição. Caso contrário, comenta LINHA TODA no final.
        const atribRe = /^(\s*(?:export\s+)?(?:const|let|var)\s+)([A-Za-z0-9_$]+)(\s*=\s*)(?:'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:\\.|[^`])*`)(\s*;?\s*)$/;
        const mAtrib = atribRe.exec(line);
        if (mAtrib && envKey) {
          novoValorLinha = `${mAtrib[1]}${mAtrib[2]}${mAtrib[3]}process.env.${envKey}${mAtrib[4] || ''}  // ${LINE_MARKER}: ${ruleId} · valor movido para .env (chave ${envKey}).`;
          acao = `atribuição substituída por process.env.${envKey} · ${valorMovido ? 'valor salvo em .env' : '.env já tinha essa chave (skip write)'}`;
        } else {
          // Fallback: linha não é atribuição simples → comenta LINHA INTEIRA no começo
          novoValorLinha = `// ${LINE_MARKER}: ${ruleId} · RISCO removido (linha comentada) · original: ${line}`;
        }
      } else if (isPy || isShOrEnv) {
        const coment = isPy ? '#' : '#';
        // Tenta substituir PY: VAR = "valor" → VAR = os.getenv('ENV_KEY') / shell: VAR="$ENV_KEY"
        if (isPy) {
          const mPy = /^(\s*)([A-Z_][A-Z0-9_]*)(\s*=\s*)(?:'(?:\\.|[^'])*'|"(?:\\.|[^"])*")(\s*#?.*)$/.exec(line);
          if (mPy && envKey) {
            novoValorLinha = `${mPy[1]}${mPy[2]}${mPy[3]}os.getenv('${envKey}', '')${mPy[4] || ''}  # ${LINE_MARKER}: ${ruleId} movido para .env.`;
            acao = `python atribuição substituída por os.getenv('${envKey}')`;
          }
        } else {
          const mSh = /^(\s*)([A-Z_][A-Z0-9_]*)(\s*=\s*)(?:'(?:\\.|[^'])*'|"(?:\\.|[^"])*")(\s*#?.*)$/.exec(line);
          if (mSh && envKey) {
            novoValorLinha = `${mSh[1]}${mSh[2]}${mSh[3]}"\${${envKey}:-}"${mSh[4] || ''}  # ${LINE_MARKER}: ${ruleId} movido para .env.`;
            acao = `shell atribuição substituída por $${envKey} fallback`;
          }
        }
        if (!novoValorLinha) {
          novoValorLinha = `${coment} ${LINE_MARKER}: ${ruleId} · RISCO removido (linha comentada) · original: ${line}`;
        }
      }

      if (novoValorLinha && novoValorLinha !== line) {
        // Garante que o .env exista (apenas cria se não existir; não duplica valores)
        try { ensureProjectDotenv(project); } catch {}
        lines[lineNumber - 1] = novoValorLinha;
        const newText = lines.join('\n') + (text.endsWith('\n') ? '\n' : '');
        fs.writeFileSync(abs, newText, 'utf8');
        return {
          applied: true,
          before: line,
          after: novoValorLinha,
          ruleId,
          file: finding.file,
          line: lineNumber,
          fixType: fix.type,
          envKey,
          valorMovidoParaDotenv: valorMovido,
          acao,
        };
      }
      return { applied: false, ruleId, reason: 'tipo de arquivo ou formato de linha não reconhecido para safe-fix — requer manual.' };
    } catch (e) {
      return { applied: false, ruleId, reason: 'erro applyFix SEC-HC: ' + String(e && e.message || e).slice(0, 260) };
    }
  }

  // XSS, PathTraversal, CORS, StaticDotfiles etc -> MODO INFORMATIVO SÓ (anotação no relatório)
  if (fix.type === 'comment_inform') {
    // NÃO alteramos o código para essas categorias — só informamos.
    return { applied: false, reason: 'Fix informativo — requer revisão manual. NÃO aplicado automaticamente (segurança).' };
  }
  if (fix.type === 'replace_line' || fix.type === 'regex_replace') {
    return { applied: false, reason: 'Alteração estrutural. Requer manual approval — não aplicado automaticamente.' };
  }
  return { applied: false, reason: 'fix_type desconhecido.' };
}

/* ============================================================
   RC25 · PIPELINE COMPLETO: Diagnóstico → Backup → Aplica → Testa → Re-audita → Loop
============================================================ */
const DIAG_AUTOFIX_SAFE_RULES = new Set([
  // Whitelist hard: SÓ essas regras são aplicadas automaticamente no pipeline completo.
  // O restante (SEC-PT-*, SEC-XSS-*, SEC-EX-CORS etc.) fica em findings com fix informativo.
  'SEC-HC-GOOGLEKEY',
  'SEC-HC-ANYKEY',
  'SEC-HC-OPENROUTER',
  'SEC-INT-DOTENV-ABSENT',
  'SEC-EX-STATIC-UNPROTECTED',
  'SEC-PKG-MISSING-INSTALL',
]);
function _diag_classify(report) {
  const res = { criticos: 0, altos: 0, medios: 0, baixos: 0, autoFixable: [], manual: [] };
  for (const f of report.findings) {
    res[f.severity] = (res[f.severity] || 0) + 1;
    if (DIAG_AUTOFIX_SAFE_RULES.has(f.ruleId)) res.autoFixable.push(f);
    else res.manual.push(f);
  }
  return res;
}
function _diag_stopCondition({ classification, tests, iter, appliedCountIter }) {
  if (iter >= DIAG_MAX_ITERATIONS) return { stop: true, reason: 'atingiu MAX_ITERATIONS=' + DIAG_MAX_ITERATIONS };
  // RC25 FIX 6 (principal): só declara SUCCESS se NÃO tiver NENHUM autoFix pendente (autoFixable.length === 0)
  // NÃO pode parar SÓ por criticos=0 se ainda houver alto/medio segurável na whitelist para corrigir.
  const zeroCriticos = (classification.criticos || 0) === 0;
  const testesOk = !!tests && tests.pass === true;
  const autoFixPendentes = Array.isArray(classification.autoFixable) ? classification.autoFixable.length : 999;
  if (zeroCriticos && testesOk && autoFixPendentes === 0) {
    return { stop: true, reason: 'sucesso: críticos=0 · testes automáticos PASS · nenhum auto-fix pendente.' };
  }
  // Anti-loop rápido: se aplicamos 0 E temos 0 autoFixable pendente E criticos=0 → sair
  if (appliedCountIter === 0 && autoFixPendentes === 0) {
    return { stop: true, reason: 'sem progresso (0 applied esta iteração · sem auto-fix pendente).' };
  }
  return { stop: false };
}

/* ============================================================
   RC26 · WRAPPERS NOVOS (prefixo _rc26_) — NENHUMA ALTERAÇÃO
   em funções RC25.3 existentes acima (applyFix, runAuditOnProject,
   _diag_classify etc. permanecem 100% intocados internamente).
   4 wrappers: makeRepairPlan → prePatchCheckpoint → rollback
   → buildVerifyReport.
============================================================ */
const _RC26_SEV_ORDER = { critico: 0, alto: 1, medio: 2, baixo: 3 };
function _rc26_makeRepairPlan(classification, { maxPatchesPerIter = 8 } = {}) {
  const list = Array.isArray(classification && classification.autoFixable) ? classification.autoFixable : [];
  const seen = new Set();
  const uniq = [];
  for (const f of list) {
    if (!f || !f.findingId) continue;
    // Deduplicação por (file, findingId) — garante único patch por finding
    const key = `${f.file || ''}|${f.findingId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(f);
  }
  // Ordena: critico → alto → médio → baixo. Desempate file (mesmo arquivo consecutivos, menos IO).
  uniq.sort((a, b) => {
    const oa = _RC26_SEV_ORDER[a.severity] ?? 99;
    const ob = _RC26_SEV_ORDER[b.severity] ?? 99;
    if (oa !== ob) return oa - ob;
    return String(a.file || '').localeCompare(String(b.file || ''));
  });
  const plan = [];
  for (let i = 0; i < Math.min(uniq.length, maxPatchesPerIter); i++) {
    const f = uniq[i];
    plan.push({
      index: i,
      findingId: f.findingId,
      ruleId: f.ruleId,
      severity: f.severity,
      file: f.file,
      line: Number(f.line) || 0,
      plannedAction: (f && f.fix && f.fix.type) ? `fix.type=${f.fix.type}` : 'applyFix default',
    });
  }
  return plan;
}
function _rc26_prePatchCheckpoint(project, finding, fileRelAbs, textContent) {
  const s = typeof textContent === 'string' ? textContent : '';
  return {
    hashPre: sha256(s),
    sizePre: Buffer.byteLength(s, 'utf8'),
    buffer: Buffer.from(s, 'utf8'),
    ts: Date.now(),
    file: finding && finding.file ? finding.file : (fileRelAbs ? path.relative(project.path, fileRelAbs) : ''),
    fileRelAbs,
  };
}
function _rc26_rollbackFromCheckpoint(project, checkpoint) {
  if (!checkpoint || !checkpoint.fileRelAbs || !Buffer.isBuffer(checkpoint.buffer)) {
    return { ok: false, error: 'checkpoint inválido (sem fileRelAbs/buffer)' };
  }
  const s = checkpoint.buffer.toString('utf8');
  fs.writeFileSync(checkpoint.fileRelAbs, s, 'utf8');
  const hashAfter = sha256(s);
  return { ok: true, hashAfterRollback: hashAfter, equals: hashAfter === checkpoint.hashPre };
}
function _rc26_buildVerifyReport(initialScanReport, finalScanReport, patchRecordsFlat) {
  const initialFindings = Array.isArray(initialScanReport && initialScanReport.findings) ? initialScanReport.findings : [];
  const finalIds = new Set(
    (Array.isArray(finalScanReport && finalScanReport.findings) ? finalScanReport.findings : [])
      .map(f => f && f.findingId).filter(Boolean)
  );
  const rollbackByFinding = new Map();
  if (Array.isArray(patchRecordsFlat)) {
    for (const p of patchRecordsFlat) {
      if (p && p.findingId && p.rolledBack) {
        rollbackByFinding.set(p.findingId, { rolledBack: true, rollbackReason: String(p.rollbackReason || '') });
      }
    }
  }
  const out = [];
  const seen = new Set();
  for (const f of initialFindings) {
    if (!f || !f.findingId || seen.has(f.findingId)) continue;
    seen.add(f.findingId);
    const rb = rollbackByFinding.get(f.findingId) || { rolledBack: false, rollbackReason: undefined };
    out.push({
      findingId: f.findingId,
      ruleId: f.ruleId,
      severity: f.severity,
      file: f.file,
      line: Number(f.line) || 0,
      presenteNoScanInicial: true,
      presenteNoRescanFinal: finalIds.has(f.findingId),
      rolledBack: !!rb.rolledBack,
      rollbackReason: rb.rolledBack ? (rb.rollbackReason || undefined) : undefined,
    });
  }
  // Findings que apareceram APENAS no rescan final (novos, regressão) — marcados com inicial=false
  if (Array.isArray(finalScanReport && finalScanReport.findings)) {
    for (const g of finalScanReport.findings) {
      if (!g || !g.findingId || seen.has(g.findingId)) continue;
      seen.add(g.findingId);
      out.push({
        findingId: g.findingId,
        ruleId: g.ruleId,
        severity: g.severity,
        file: g.file,
        line: Number(g.line) || 0,
        presenteNoScanInicial: false,
        presenteNoRescanFinal: true,
        rolledBack: false,
        regressao: true,
      });
    }
  }
  return out;
}

async function runFullDiagnosticPipeline(project, opts = {}) {
  const startedAt = Date.now();
  const iters = [];
  const pre = backupProject(project, { tag: 'diagnostic-pre-pipeline' });
  let lastReport = null;
  let lastTests = null;
  let appliedTotal = 0;
  let iter = 0;
  // RC26 · vars novas (todas aditivas; não tocam em variáveis RC25.3)
  let initialScanReport = null;            // primeiro scan (iter===1) — usado p/ verifyReport
  const allPatchRecordsFlat = [];          // flat acumulado por iteração
  let rollbackCount = 0;                   // total rollbacks na pipeline toda
  let firstRepairPlan = null;              // repairPlan do iter1 = do inicial
  const maxIter = Math.max(1, Math.min(DIAG_MAX_ITERATIONS, Number(opts.maxIterations || DIAG_MAX_ITERATIONS)));
  while (true) {
    iter++;
    const iterObj = { iter, ts: Date.now() };
    // (1) AUDITORIA EXAUSTIVA
    const rep = runAuditOnProject(project);
    lastReport = rep;
    saveAudit(rep);
    if (iter === 1) initialScanReport = rep;   // RC26 · guarda o SCAN INICIAL
    let classification = _diag_classify(rep);
    iterObj.reportId = rep.id;
    iterObj.grade = rep.grade;
    iterObj.score = rep.score;
    iterObj.counts = rep.counts;
    iterObj.classification = classification;
    // (2) TESTES AUTOMÁTICOS (node check / arquivos obrigatórios / HTTP / porta)
    let tests = runAllAutomatedTests(project);
    lastTests = tests;
    iterObj.tests = tests;
    // (3) ADICIONA findings de endpoints Criador/Voice (global) se falhar
    try {
      const criadorUp = await _fetchJson(CRIADOR_URL + '/api/status', { timeoutMs: 4500 });
      if (!criadorUp.ok) {
        const f1 = {
          findingId: sha256('SEC-INT-ENDPT-CRIADOR|' + criadorUp.http).slice(0, 24),
          ruleId: 'SEC-INT-ENDPT-CRIADOR', severity: 'baixo',
          title: 'Criador RC22 (3000) não respondeu /api_status (HTTP ' + (criadorUp.http || 0) + ')',
          description: 'Durante o diagnóstico o Criador RC22 não estava disponível. ' + (criadorUp.error || criadorUp.raw || ''),
          file: 'CRIADOR_PORT_3000', line: 1, before: criadorUp.raw || '',
          fix: RULES.find(r => r.id === 'SEC-INT-ENDPT-CRIADOR').fix,
        };
        lastReport.findings.unshift(f1); lastReport.counts.baixo++;
      }
    } catch {}
    try {
      const voiceUp = await _fetchJson(VOICE_URL + '/health', { timeoutMs: 4500 });
      if (!voiceUp.ok) {
        const f2 = {
          findingId: sha256('SEC-INT-ENDPT-VOICE|' + voiceUp.http).slice(0, 24),
          ruleId: 'SEC-INT-ENDPT-VOICE', severity: 'baixo',
          title: 'Voice REST (3005) não respondeu /health (HTTP ' + (voiceUp.http || 0) + ')',
          description: 'Durante o diagnóstico o servidor de voz não estava disponível. ' + (voiceUp.error || voiceUp.raw || ''),
          file: 'VOICE_PORT_3005', line: 1, before: voiceUp.raw || '',
          fix: RULES.find(r => r.id === 'SEC-INT-ENDPT-VOICE').fix,
        };
        lastReport.findings.unshift(f2); lastReport.counts.baixo++;
      }
    } catch {}

    // =====================================================================
    // RC26 · LOOP POR-PATCH (10 etapas SCAN→FINDINGS→DIAGNOSE→REPAIR PLAN→
    // CHECKPOINT→APPLY PATCH→TEST→RESCAN→VERIFY→ROLLBACK)
    // Substitui o loop antigo "for (const f of classification.autoFixable) applyFix"
    // =====================================================================
    const aplicados = [];
    const pulados = [];
    // Etapa 4: REPAIR PLAN · ordena e deduplica
    const repairPlan = _rc26_makeRepairPlan(classification, opts);
    if (iter === 1) firstRepairPlan = repairPlan;
    iterObj.repairPlan = repairPlan;
    const patchRecordsIter = [];
    if (repairPlan.length > 0) {
      for (let pIdx = 0; pIdx < repairPlan.length; pIdx++) {
        const p = repairPlan[pIdx];
        // finding correspondente
        const finding = classification.autoFixable.find(f => f && f.findingId === p.findingId);
        if (!finding) {
          pulados.push({ findingId: p.findingId, ruleId: p.ruleId, file: p.file, reason: 'finding não encontrado em classification.autoFixable' });
          continue;
        }
        // Etapa 5: CHECKPOINT (em memória)
        const abs = path.resolve(project.path, finding.file);
        let checkpoint = null;
        let record = {
          iter,
          index: p.index,
          patchIndex: pIdx,
          findingId: p.findingId,
          ruleId: p.ruleId,
          severity: p.severity,
          file: finding.file,
          hashPre: null, sizePre: 0, hashAfterApply: null,
          applied: false, rolledBack: false, rollbackReason: null, rollbackEqual: null, hashAfterRollback: null,
          appliedMeta: null,
          tsCheckpoint: 0, tsApply: 0, tsRollback: 0,
        };
        try {
          if (!fs.existsSync(abs)) {
            pulados.push({ findingId: p.findingId, ruleId: p.ruleId, file: finding.file, reason: 'arquivo não existe antes do patch' });
            record.rolledBack = false; record.applied = false; record.tsCheckpoint = Date.now();
            patchRecordsIter.push(record);
            allPatchRecordsFlat.push(record);
            continue;
          }
          const preContent = fs.readFileSync(abs, 'utf8');
          checkpoint = _rc26_prePatchCheckpoint(project, finding, abs, preContent);
          record.hashPre = checkpoint.hashPre;
          record.sizePre = checkpoint.sizePre;
          record.tsCheckpoint = checkpoint.ts;

          // Etapa 6: APPLY PATCH
          const ap = applyFix(finding, project);
          record.tsApply = Date.now();
          if (!ap || ap.applied !== true) {
            pulados.push({ findingId: p.findingId, ruleId: p.ruleId, file: finding.file, reason: (ap && ap.reason) || 'applyFix retornou applied=false' });
            record.applied = false;
            record.appliedMeta = ap || null;
            patchRecordsIter.push(record);
            allPatchRecordsFlat.push(record);
            continue;
          }
          record.applied = true;
          record.appliedMeta = ap;
          // hash depois do apply
          try { record.hashAfterApply = sha256(fs.readFileSync(abs, 'utf8')); } catch {}
          aplicados.push({ findingId: p.findingId, severity: p.severity, ruleId: p.ruleId, file: finding.file, ...ap });

          // Etapa 7a: TEST 1 · nodeCheckSyntax se JS/TS
          const isJsLike = /\.(js|mjs|cjs|jsx|ts|tsx|vue)$/i.test(abs);
          if (isJsLike) {
            const ncs = nodeCheckSyntax(abs);
            if (!ncs || ncs.ok !== true) {
              // ROLLBACK IMEDIATO
              const rb = _rc26_rollbackFromCheckpoint(project, checkpoint);
              record.tsRollback = Date.now();
              record.rolledBack = true;
              record.rollbackReason = 'nodeCheckSyntax falhou: ' + String((ncs && ncs.error) || '?').slice(0, 260);
              record.hashAfterRollback = rb.hashAfterRollback;
              record.rollbackEqual = rb.equals;
              rollbackCount++;
              // reverte dos aplicados o que tínhamos adicionado
              aplicados.pop();
              pulados.push({ findingId: p.findingId, ruleId: p.ruleId, file: finding.file, reason: record.rollbackReason });
              patchRecordsIter.push(record);
              allPatchRecordsFlat.push(record);
              continue;
            }
          }
          // Etapa 7b: TEST 2 · runAllAutomatedTests pós-patch
          const postPatchTests = runAllAutomatedTests(project);
          if (!postPatchTests || postPatchTests.pass !== true) {
            const rb = _rc26_rollbackFromCheckpoint(project, checkpoint);
            record.tsRollback = Date.now();
            record.rolledBack = true;
            record.rollbackReason = 'runAllAutomatedTests.pass=false após patch: ' + String((postPatchTests && postPatchTests.summary) || '?').slice(0, 260);
            record.hashAfterRollback = rb.hashAfterRollback;
            record.rollbackEqual = rb.equals;
            rollbackCount++;
            aplicados.pop();
            pulados.push({ findingId: p.findingId, ruleId: p.ruleId, file: finding.file, reason: record.rollbackReason });
            patchRecordsIter.push(record);
            allPatchRecordsFlat.push(record);
            continue;
          }
          // Etapa 8+9: RESCAN leve + VERIFY por-finding → verificar se findingId AINDA existe
          const miniScan = runAuditOnProject(project);
          const stillThere = Array.isArray(miniScan.findings) && miniScan.findings.some(f => f && f.findingId === p.findingId);
          if (stillThere) {
            const rb = _rc26_rollbackFromCheckpoint(project, checkpoint);
            record.tsRollback = Date.now();
            record.rolledBack = true;
            record.rollbackReason = 'VERIFY falhou: findingId=' + p.findingId + ' ainda está presente no rescan leve pós-patch (patch não resolveu).';
            record.hashAfterRollback = rb.hashAfterRollback;
            record.rollbackEqual = rb.equals;
            rollbackCount++;
            aplicados.pop();
            pulados.push({ findingId: p.findingId, ruleId: p.ruleId, file: finding.file, reason: record.rollbackReason });
            patchRecordsIter.push(record);
            allPatchRecordsFlat.push(record);
            continue;
          }
          // Tudo OK: sem rollback, grava
          patchRecordsIter.push(record);
          allPatchRecordsFlat.push(record);
        } catch (e) {
          // Exceção em qualquer etapa: se temos checkpoint e já havíamos aplicado, roda rollback defensivo.
          try {
            if (checkpoint && record.applied) {
              const rb = _rc26_rollbackFromCheckpoint(project, checkpoint);
              record.tsRollback = Date.now();
              record.rolledBack = true;
              record.rollbackReason = 'EXCEPTION defensivo: ' + String(e && e.message || e).slice(0, 260);
              record.hashAfterRollback = rb.hashAfterRollback;
              record.rollbackEqual = rb.equals;
              rollbackCount++;
              if (aplicados.length && aplicados[aplicados.length - 1].findingId === p.findingId) aplicados.pop();
            }
          } catch {}
          pulados.push({ findingId: p.findingId, ruleId: p.ruleId, file: finding.file, reason: 'EXCEPTION: ' + String(e && e.message || e).slice(0, 260) });
          patchRecordsIter.push(record);
          allPatchRecordsFlat.push(record);
        }
      }
    }
    appliedTotal += aplicados.length;
    iterObj.patchRecords = patchRecordsIter;
    iterObj.rollbackCount = patchRecordsIter.filter(r => r.rolledBack).length;
    iterObj.applied = aplicados;
    iterObj.appliedCount = aplicados.length;
    iterObj.skipped = pulados;
    iterObj.skippedCount = pulados.length;
    // RC26 · RESCAN GLOBAL pós-patch por iteração (antes do stopCondition)
    // Se houver pelo menos 1 patch aplicado (sem rollback), roda nova auditoria completa
    // e ATUALIZA lastReport / classification / tests para o stopCondition julgar o estado mais recente.
    if (aplicados.length > 0) {
      try {
        const rescanRep = runAuditOnProject(project);
        saveAudit(rescanRep);
        lastReport = rescanRep;
        const rescanClass = _diag_classify(rescanRep);
        const rescanTests = runAllAutomatedTests(project);
        lastTests = rescanTests;
        iterObj.rescanReportId = rescanRep.id;
        iterObj.rescanGrade = rescanRep.grade;
        iterObj.rescanScore = rescanRep.score;
        iterObj.rescanCounts = rescanRep.counts;
        iterObj.rescanClassification = rescanClass;
        iterObj.rescanTests = rescanTests;
        // Substitui os valores usados no stopCondition abaixo pelos valores do rescan mais recente
        classification = rescanClass;
        tests = rescanTests;
      } catch (eRescan) {
        iterObj.rescanError = String(eRescan && eRescan.message || eRescan).slice(0, 260);
      }
    }
    // (4) STOP CONDITION (mantida exatamente igual a RC25.3 — ordem de checagem preserved)
    const sc = _diag_stopCondition({ classification, tests, iter, appliedCountIter: aplicados.length });
    iters.push(iterObj);
    if (iter >= maxIter || sc.stop) {
      iterObj.stopCondition = sc.reason || ('atingiu MAX_ITER=' + maxIter);
      break;
    }
    // (6) GUARD ANTI-LOOP
    if (aplicados.length === 0) {
      iterObj.stopCondition = iterObj.stopCondition || 'anti-loop: 0 applied nesta iteração (sem progresso)';
      break;
    }
  }
  const finalReport = lastReport;
  const finalClassification = _diag_classify(finalReport);
  const durMs = Date.now() - startedAt;
  const finalTests = lastTests;
  const finalAutoFixPendentes = Array.isArray(finalClassification.autoFixable) ? finalClassification.autoFixable.length : 999;
  // RC26 · Constrói VERIFY REPORT real (prova de desaparecimento finding-a-finding)
  const verifyReport = initialScanReport && finalReport
    ? _rc26_buildVerifyReport(initialScanReport, finalReport, allPatchRecordsFlat)
    : [];
  // RC26 · Sucesso = RC25.3 AND todos os findings de whitelist que estavam presentes no scan inicial
  // NÃO estão mais presentes no rescan final E NÃO sofreram rollback.
  const rc25Success = (finalClassification.criticos || 0) === 0 && finalTests.pass === true && finalAutoFixPendentes === 0;
  const rc26WhitelistCondition = Array.isArray(verifyReport) && verifyReport.length > 0
    ? verifyReport
        .filter(v => v.presenteNoScanInicial === true && DIAG_AUTOFIX_SAFE_RULES.has(v.ruleId))
        .every(v => v.presenteNoRescanFinal === false && v.rolledBack === false)
    : true;   // sem verifyReport (caso extremo) → deixa RC25 decidir
  const rc26Success = rc25Success && rc26WhitelistCondition;
  // Stop reason enriquecido se falhou apenas por whitelist verify
  let stopReasonFinal = (iters[iters.length - 1] && iters[iters.length - 1].stopCondition) || 'n/a';
  if (rc25Success && !rc26WhitelistCondition) {
    const stillThereWhitelist = verifyReport
      .filter(v => v.presenteNoScanInicial === true && DIAG_AUTOFIX_SAFE_RULES.has(v.ruleId))
      .filter(v => v.presenteNoRescanFinal === true || v.rolledBack === true)
      .map(v => v.ruleId + ':' + (v.presenteNoRescanFinal ? 'ainda-presente' : 'rolledback'))
      .join(', ');
    stopReasonFinal = 'RC26 verify: findings whitelist pendentes → ' + (stillThereWhitelist || '?');
  }
  return {
    ok: true,
    pipelineVersion: 'RC26',
    slug: project.slug,
    project: { slug: project.slug, displayName: project.displayName, path: project.path, port: project.port },
    startedAt,
    finishedAt: Date.now(),
    durationMs: durMs,
    iterations: iters,
    iterationsCount: iters.length,
    preBackupFile: pre.file,
    preBackupTs: pre.ts,
    preBackupSize: pre.size,
    finalGrade: finalReport.grade,
    finalScore: finalReport.score,
    finalCounts: finalReport.counts,
    finalClassification,
    finalFindings: finalReport.findings,
    finalReportId: finalReport.id,
    appliedTotal,
    tests: finalTests,
    testsPass: finalTests.pass,
    // RC26 · campos novos ADITIVOS (agora 100% preenchidos)
    repairPlan: firstRepairPlan || [],
    patchRecords: iters.map(it => ({ iter: it.iter, records: it.patchRecords || [], rescanReportId: it.rescanReportId || null })),
    rollbackCount,
    success: rc26Success,
    stopReason: stopReasonFinal,
    verifyReport,
    criadorUrl: CRIADOR_URL,
    voiceUrl: VOICE_URL,
    _rc26_internal: {
      initialScanReportId: initialScanReport && initialScanReport.id,
      finalReportId: finalReport && finalReport.id,
      rc25SuccessRaw: rc25Success,
      rc26WhitelistConditionRaw: rc26WhitelistCondition,
    },
  };
}

/* ============================================================
   ENDPOINTS BÁSICOS
============================================================ */
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    app: 'TiAgente Security',
    version: 'RC25.1 · Diagnostic & AutoFix',
    port: PORT,
    host: HOST,
    auditsDir: AUDIT_DIR,
    backupDir: BACKUP_DIR,
    criadorWorkspace: CRIADOR_WORKSPACE,
    googleKeyOk: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim().length >= 10),
    googleKeyPrefix: keyPrefix(process.env.GOOGLE_API_KEY || ''),
    autoFixSafeRules: Array.from(DIAG_AUTOFIX_SAFE_RULES).sort(),
    maxIterations: DIAG_MAX_ITERATIONS,
    pipelineEnabled: true,
  });
});

app.get('/api/projects', (req, res) => {
  const projects = scanProjects();
  res.json({ ok: true, projects, auditDir: AUDIT_DIR, backupDir: BACKUP_DIR });
});

/* ============================================================
   AUDITAR: start retorna findings + IDs (para approve)
============================================================ */
app.post('/api/audit/start_with_ids', (req, res) => {
  try {
    const { slug } = req.body || {};
    const proj = resolveProject(slug);
    if (!proj) return res.status(404).json({ ok: false, error: 'Projeto não encontrado: ' + String(slug) });
    const report = runAuditOnProject(proj);
    const auditFile = saveAudit(report);
    res.json({
      ok: true,
      auditId: report.id,
      auditFile: path.relative(APP_ROOT, auditFile),
      report,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

/* ============================================================
   APLICAR CORREÇÕES (aprovadas via whitelist de IDs)
   - Faz backup primeiro (backupProject)
   - Aplica cada fix em lote
   - Roda auditoria NOVA e retorna diff before x after
============================================================ */
app.post('/api/fixes/apply', async (req, res) => {
  try {
    const body = req.body || {};
    const slug = body.slug;
    const ids = Array.isArray(body.findingIds) ? body.findingIds : [];
    const confirmOk = !!body.confirmAutoApplySafetyChecked;
    const applyMode = String(body.applyMode || '').trim() || (body.autoFullPipeline === true ? 'auto_full_pipeline' : 'whitelist_hc_only');

    // RC25 · NOVO applyMode: auto_full_pipeline. Não precisa de IDs específicos — o pipeline
    // auto-roda audit → classify → apply → tests → re-audit → loop (respeitando a whitelist de
    // regras seguras DIAG_AUTOFIX_SAFE_RULES). Ideal para o RC22 integration_bridge novo.
    if (applyMode === 'auto_full_pipeline') {
      if (!confirmOk) return res.status(400).json({ ok: false, error: 'confirmAutoApplySafetyChecked === false — obrigatório para pipeline completo.' });
      const proj = resolveProject(slug);
      if (!proj) return res.status(404).json({ ok: false, error: 'Projeto não encontrado.' });
      const r = await runFullDiagnosticPipeline(proj, { maxIterations: body.maxIterations || DIAG_MAX_ITERATIONS });
      return res.json({
        ok: true,
        applyMode,
        pipeline: true,
        pipelineVersion: r.pipelineVersion,
        ...r,
      });
    }

    if (!confirmOk) return res.status(400).json({ ok: false, error: 'confirmAutoApplySafetyChecked === false. Marque o checkbox de segurança.' });

    const proj = resolveProject(slug);
    if (!proj) return res.status(404).json({ ok: false, error: 'Projeto não encontrado.' });
    if (!ids.length) return res.status(400).json({ ok: false, error: 'Nenhum finding selecionado.' });

    // 1) Relatório BEFORE (ler auditoria existente mais recente deste slug, se existir)
    const slugDir = AUDIT_DIR;
    let beforeReport = null;
    try {
      const recent = fs.readdirSync(slugDir)
        .filter(f => f.startsWith(slugSanitize(proj.slug) + '-') && f.endsWith('.json'))
        .sort()
        .pop();
      if (recent) beforeReport = safeReadJSON(path.join(slugDir, recent), null);
    } catch {}
    if (!beforeReport) beforeReport = runAuditOnProject(proj);

    // 2) Whitelist: só aplicar IDs presentes no beforeReport
    const idSet = new Set(ids.map(x => String(x)));
    const whitelist = {};
    for (const f of beforeReport.findings) if (idSet.has(f.findingId)) whitelist[f.findingId] = f;

    // RC25 · Whitelist ampliada: aceita NÃO SÓ SEC-HC-* mas também as regras seguras novas
    // (SEC-INT-DOTENV-ABSENT, SEC-EX-STATIC-UNPROTECTED, SEC-PKG-MISSING-INSTALL) quando
    // applyMode !== 'whitelist_hc_only' (ex: applyMode='extended_safe').
    const SAFE_APPLY_BY_MODE =
      applyMode === 'extended_safe' || body.allowExtendedSafe === true
        ? new Set([...DIAG_AUTOFIX_SAFE_RULES])
        : new Set(['SEC-HC-GOOGLEKEY', 'SEC-HC-ANYKEY', 'SEC-HC-OPENROUTER']);

    const applied = [];
    const skipped = [];
    const pre = backupProject(proj, { tag: 'pre-fix' });

    for (const id of Object.keys(whitelist)) {
      const finding = whitelist[id];
      if (!SAFE_APPLY_BY_MODE.has(finding.ruleId)) {
        skipped.push({ id, ruleId: finding.ruleId, file: finding.file, line: finding.line, reason: `Regra ${finding.ruleId} não está na safe list deste applyMode=${applyMode}. Use applyMode="extended_safe" ou "auto_full_pipeline".` });
        continue;
      }
      try {
        const r = applyFix(finding, proj);
        if (r && r.applied) applied.push({ findingId: id, severity: finding.severity, ruleId: finding.ruleId, file: finding.file, line: finding.line, before: r.before, after: r.after, extra: Object.fromEntries(Object.entries(r).filter(([k]) => !['applied','before','after','ruleId','file','line','fixType'].includes(k))) });
        else skipped.push({ id, ruleId: finding.ruleId, file: finding.file, line: finding.line, reason: (r && r.reason) || 'não aplicou' });
      } catch (e) {
        skipped.push({ id, ruleId: finding.ruleId, file: finding.file, line: finding.line, reason: String(e && e.message || e) });
      }
    }

    // 4) Rodar auditoria AFTER para comparar
    const afterReport = runAuditOnProject(proj);
    saveAudit(afterReport);

    // 5) diff counts + grade + score
    const countsDiff = {};
    for (const sev of ['critico','alto','medio','baixo','seguro']) {
      const b = beforeReport.counts[sev] || 0;
      const a = afterReport.counts[sev] || 0;
      countsDiff[sev] = { before: b, after: a, delta: a - b };
    }
    const diff = {
      grade: { before: beforeReport.grade, after: afterReport.grade },
      score: { before: beforeReport.score, after: afterReport.score },
      critico: countsDiff.critico,
      alto:    countsDiff.alto,
      medio:   countsDiff.medio,
      baixo:   countsDiff.baixo,
      appliedCount: applied.length,
      skippedCount: skipped.length,
    };

    res.json({
      ok: true,
      preBackupFile: pre.file,
      applied, appliedCount: applied.length,
      skipped, skippedCount: skipped.length,
      beforeReport, afterReport,
      diff,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

/* ============================================================
   IA · Resumo inteligente Gemini (opcional)
   Se GOOGLE_API_KEY vazia → retorna ok:false com "sem chave, apenas heurística".
   NÃO usa tools, não chama o criador. Chamada própria do Security.
============================================================ */
app.post('/api/ai/explain', async (req, res) => {
  const { auditId, tone = 'curto' } = req.body || {};
  const key = (process.env.GOOGLE_API_KEY || '').trim();
  if (key.length < 10) return res.status(400).json({ ok: false, error: 'GOOGLE_API_KEY não configurada no .env do TiAgente Security. Sem chave: auditoria heurística funciona normalmente.' });

  const files = fs.readdirSync(AUDIT_DIR);
  const file = files.find(f => f.includes('-' + auditId + '.json'));
  if (!file) return res.status(404).json({ ok: false, error: 'Auditoria não encontrada' });
  const r = safeReadJSON(path.join(AUDIT_DIR, file), null);
  if (!r) return res.status(500).json({ ok: false, error: 'Relatório corrompido' });
  const prompt = JSON.stringify({
    grade: r.grade, score: r.score, counts: r.counts,
    projetos: `${r.project.displayName} (${r.files} arquivos, ${(r.bytes/1024)|0}KB)`,
    resumoCriticos: r.findings.filter(f=>f.severity==='critico').slice(0, 3).map(f => ({ regra: f.ruleId, arquivo: f.file, linha: f.line, titulo: f.title, detalhe: f.description.slice(0, 200) })),
    resumoAltos: r.findings.filter(f=>f.severity==='alto').slice(0, 3).map(f => ({ regra: f.ruleId, arquivo: f.file, titulo: f.title })),
    avaliacao: (tone==='detalhado' ? 'Explicação detalhada em pt-BR, 4 parágrafos.' : 'Resumo de 2 parágrafos em português, direto ao ponto.'),
  }, null, 0);

  try {
    const body = {
      contents: [{ parts: [{
        text: `Você é um analista sênior de segurança. Baseado APENAS nos dados abaixo (não invente), gere um relatório executivo para o dono do projeto. Primeiro um scorecard emoji resumido, depois explicação de achados mais críticos e ações imediatas (nº de itens = nº de críticos). Dados brutos do relatório:\n\n${prompt}\n\nSaída em MARKDOWN (3 até 6 parágrafos, max 1800 caracteres).`
      }] }],
      generationConfig: { maxOutputTokens: 900, temperature: 0.2 },
    };
    const candidates = [
      ['v1beta', 'gemini-3.6-flash'],
      ['v1beta', 'gemini-3.5-flash-lite'],
      ['v1beta', 'gemini-2.5-flash'],
      ['v1beta', 'gemini-2.0-flash-exp'],
      ['v1beta', 'gemini-1.5-flash'],
      ['v1beta', 'gemini-1.5-pro-exp-0827'],
    ];
    let lastErr = null;
    for (const [ver, model] of candidates) {
      try {
        const url = `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const r2 = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const out = await r2.json().catch(() => ({}));
        if (r2.ok && out && Array.isArray(out.candidates) && out.candidates[0]?.content?.parts?.[0]?.text) {
          const texto = out.candidates[0].content.parts[0].text;
          return res.json({ ok: true, text: texto, tone, auditId, model, apiVersion: ver });
        }
        lastErr = 'IA falhou (model=' + model + '/' + ver + '): status=' + r2.status + ' / ' + JSON.stringify(out).slice(0, 300);
      } catch (e) {
        lastErr = String(e && e.message || e);
      }
    }
    return res.status(502).json({ ok: false, error: lastErr || 'Nenhum modelo respondeu.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

/* ============================================================
   RC25 · ENDPOINT NOVO: DIAGNÓSTICO COMPLETO (loop até resolução)
============================================================ */
app.post('/api/diagnostic/run', async (req, res) => {
  try {
    const body = req.body || {};
    const { slug, maxIterations } = body;
    const proj = resolveProject(slug);
    if (!proj) return res.status(404).json({ ok: false, error: 'Projeto não encontrado: ' + String(slug) });
    const r = await runFullDiagnosticPipeline(proj, { maxIterations });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});
/* ============================================================
   ENDPOINT COMPAT: /api/audit/start (fallback do integration_bridge)
   - Faz a mesma coisa do start_with_ids, retorna { ok:true, auditId, report }
============================================================ */
app.post('/api/audit/start', (req, res) => {
  try {
    const { slug } = req.body || {};
    const proj = resolveProject(slug);
    if (!proj) return res.status(404).json({ ok: false, error: 'Projeto não encontrado.' });
    const report = runAuditOnProject(proj);
    const auditFile = saveAudit(report);
    res.json({
      ok: true,
      auditId: report.id,
      auditFile: path.relative(APP_ROOT, auditFile),
      report,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});
app.post('/api/audit/apply_fixes', async (req, res) => {
  // Compatibilidade: integration_bridge tenta esse nome também. Redireciona para /api/fixes/apply
  const body = req.body || {};
  req.body = {
    slug: body.slug,
    findingIds: body.ids || body.findingIds || [],
    confirmAutoApplySafetyChecked: !!body.autoApply,
    applyMode: body.applyMode || (body.autoApply ? 'extended_safe' : 'whitelist_hc_only'),
  };
  // Chama o handler de /api/fixes/apply
  res.redirect ? null : null;
  try {
    const proj = resolveProject(req.body.slug);
    if (!proj) return res.status(404).json({ ok: false, error: 'Projeto não encontrado.' });
    if (!req.body.confirmAutoApplySafetyChecked) {
      // Se autoApply:false, SEM apply; retorna report e counts p/ usuário aprovar
      const r = runAuditOnProject(proj);
      saveAudit(r);
      return res.json({ ok: true, auditId: r.id, report: r, applied: [], skipped: [] });
    }
    const r = await runFullDiagnosticPipeline(proj);
    return res.json({ ok: true, pipeline: true, ...r });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});
app.post('/api/agent/:slug/security/apply', async (req, res) => {
  // Compatibilidade: integration_bridge tenta essa rota.
  try {
    const slug = req.params && req.params.slug;
    const proj = resolveProject(slug);
    if (!proj) return res.status(404).json({ ok: false, error: 'projeto não encontrado' });
    const body = req.body || {};
    if (!body || body.forceApply !== true && !(Array.isArray(body.toApply) && body.toApply.length)) {
      return res.json({ ok: true, warn: 'sem itens para aplicar', applied: 0, skipped: 0 });
    }
    // Auto pipeline completo
    const r = await runFullDiagnosticPipeline(proj);
    res.json({
      ok: true,
      pipelineUsed: true,
      appliedCount: r.appliedTotal || 0,
      iterations: r.iterationsCount,
      ...r,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

/* ============================================================
   BACKUP endpoints
============================================================ */
app.get('/api/backup/list/:slug', (req, res) => {
  const proj = resolveProject(req.params.slug);
  if (!proj) return res.status(404).json({ ok: false, error: 'projeto não encontrado' });
  try {
    res.json({ ok: true, backups: listBackups(proj), project: { slug: proj.slug, path: proj.path } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});
app.post('/api/backup/create', (req, res) => {
  const { slug } = req.body || {};
  const proj = resolveProject(slug);
  if (!proj) return res.status(404).json({ ok: false, error: 'projeto não encontrado' });
  try {
    const b = backupProject(proj, { tag: 'manual' });
    res.json({ ok: true, ...b });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});
app.post('/api/backup/restore', (req, res) => {
  const { slug, backupFile, confirmPermanentlyDeleteNewFiles } = req.body || {};
  if (!confirmPermanentlyDeleteNewFiles) return res.status(400).json({ ok: false, error: 'confirmPermanentlyDeleteNewFiles === false' });
  const proj = resolveProject(slug);
  if (!proj) return res.status(404).json({ ok: false, error: 'projeto não encontrado' });
  try {
    const r = restoreBackup(proj, backupFile);
    const afterAudit = runAuditOnProject(proj);
    saveAudit(afterAudit);
    res.json({ ok: true, ...r, afterAudit });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

/* ============================================================
   URL AUDIT · Auditoria autorizada, não-destrutiva, 100% determinística
   - 2 etapas: (1) request-confirmation → token TTL 15s
                (2) run (só com token válido) → fetch 1x GET / + 3x HEAD recursos públicos
   - NÃO usa IA. NÃO faz brute force / flood. NÃO acessa rotas privadas.
   - Findings estruturados: {id,title,category,severity,evidence,recommendation,status}
   - Status: confirmado | suspeito | nao_observavel | seguro
============================================================ */
const URL_AUDIT_AUTH_TOKENS = new Map();   // key=token → {url, createdAtMs, clientFingerprint?}
const URL_AUDIT_TOKEN_TTL_MS = 20000;       // 20s janela de confirmação (15s + folga 5s)
const URL_AUDIT_TIMEOUT_MS = 12000;         // timeout total por requisição externa
const URL_AUDIT_MAX_REDIRECTS = 6;          // limite redirects (evita loop)
function _urlAuditPruneOldTokens() {
  const now = Date.now();
  for (const [t, v] of URL_AUDIT_AUTH_TOKENS) {
    if (now - v.createdAtMs > URL_AUDIT_TOKEN_TTL_MS) URL_AUDIT_AUTH_TOKENS.delete(t);
  }
}
setInterval(_urlAuditPruneOldTokens, 5000).unref?.();

function _urlAuditIsPublicIpOrLoopback(hostname) {
  if (!hostname) return true;
  const h = String(hostname).toLowerCase().trim();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h)) return true;
  if (/^169\.254\.\d+\.\d+$/.test(h)) return true;
  if (h === '[::ffff:127.0.0.1]') return true;
  return false;
}
function _urlAuditNormalize(raw) {
  try {
    let s = String(raw || '').trim();
    if (!s) return null;
    if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(s)) s = 'https://' + s;
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;  // proíbe user:pass@
    if (u.port && !['80','443','8080','8443','3000','3005','3400','5173','4173'].includes(u.port)) {
      // permite portas conhecidas públicas; bloqueia portas arbitrárias internas
      if (_urlAuditIsPublicIpOrLoopback(u.hostname)) return null;
    }
    if (_urlAuditIsPublicIpOrLoopback(u.hostname)) return null;  // proíbe LAN/loopback (evita SSRF)
    // strip hash/query desnecessária por enquanto — mantém path
    u.hash = '';
    return u;
  } catch {
    return null;
  }
}
function _urlAuditFinding({ id, title, category, severity, evidence, recommendation, status = 'confirmado' }) {
  return {
    id: id || ('URL-' + Math.random().toString(36).slice(2, 10).toUpperCase()),
    title: String(title || ''),
    category: String(category || 'Outros'),
    severity: ['critico','alto','medio','baixo','seguro'].includes(severity) ? severity : 'medio',
    evidence: String(evidence || ''),
    recommendation: String(recommendation || ''),
    status: ['confirmado','suspeito','nao_observavel','seguro'].includes(status) ? status : 'confirmado',
  };
}
async function scanUrlSafety(rawUrl) {
  const findings = [];
  const metadata = {
    startedAt: new Date().toISOString(),
    urlInput: String(rawUrl || ''),
    finalUrl: null,  // após redirects
    finalStatus: null,
    finalHttpVersion: null,
    redirectChain: [],
    finalHeaders: null,
    finalCookieCount: 0,
    publicResources: {},
    errors: [],
  };
  const u = _urlAuditNormalize(rawUrl);
  if (!u) {
    findings.push(_urlAuditFinding({
      id: 'URL-INVALID', title: 'URL inválida ou proibida',
      category: 'Entrada', severity: 'critico', status: 'confirmado',
      evidence: `Entrada fornecida: ${(rawUrl||'').slice(0, 200) || '(vazia)'}`,
      recommendation: 'Use URLs públicas HTTP/HTTPS válidas. Não é permitido escanear localhost, IPs de LAN (10.x, 192.168.x, 172.16-31.x), portas arbitrárias internas, ou URLs com credenciais user:pass@.'
    }));
    metadata.errors.push('URL_INVALID_OR_FORBIDDEN');
    return { ok: false, metadata, findings, score: 100, grade: 'F' };
  }
  metadata.urlNormalized = u.toString();
  const baseHref = u.origin + (u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '');
  // ---- Requisição principal 1x (GET /, follow redirects limitado)
  let mainResp;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), URL_AUDIT_TIMEOUT_MS);
    let cur = u.toString();
    let hops = 0;
    const visited = new Set();
    while (hops <= URL_AUDIT_MAX_REDIRECTS) {
      if (visited.has(cur)) { metadata.errors.push('REDIRECT_LOOP_DETECTED'); break; }
      visited.add(cur);
      const step = await fetch(cur, {
        method: 'GET',
        signal: ctrl.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'TiAgente-Security-URL-Audit/1.0 (non-destructive; +https://github.com/local)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.8,en;q=0.5',
        },
        credentials: 'omit',   // NÃO envia cookies/senhas
        cache: 'no-store',
      });
      const loc = step.headers.get('location');
      if ((step.status >= 300 && step.status < 400) && loc && hops < URL_AUDIT_MAX_REDIRECTS) {
        const abs = new URL(loc, cur).toString();
        metadata.redirectChain.push({ from: cur, status: step.status, to: abs });
        cur = abs; hops++;
        // Bloqueia redirect para LAN/loopback
        const hh = _urlAuditNormalize(abs);
        if (!hh) { metadata.errors.push('REDIRECT_TO_FORBIDDEN_ORIGIN_BLOCKED'); break; }
        continue;
      }
      mainResp = { response: step, finalUrl: cur, hops };
      break;
    }
    clearTimeout(to);
  } catch (e) {
    if (e?.name === 'AbortError' || /timeout|timed out|aborted/i.test(String(e?.message||''))) {
      findings.push(_urlAuditFinding({ id: 'URL-TIMEOUT', title: 'Tempo de conexão esgotado',
        category: 'Conectividade', severity: 'medio', status: 'confirmado',
        evidence: `Timeout após ${URL_AUDIT_TIMEOUT_MS/1000}s ao acessar ${metadata.urlNormalized}`,
        recommendation: 'Verifique se o domínio está acessível publicamente e se há firewall/DDoS protection bloqueando requisições de usuários legítimos.'
      }));
      metadata.errors.push('FETCH_TIMEOUT');
    } else if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|DNS|getaddrinfo/i.test(String(e?.message||''))) {
      findings.push(_urlAuditFinding({ id: 'URL-DNS', title: 'Domínio não resolve ou conexão recusada',
        category: 'Conectividade', severity: 'alto', status: 'confirmado',
        evidence: String(e?.message || e).slice(0, 240),
        recommendation: 'Verifique DNS, registros A/AAAA, e se a porta 80/443 está aberta no servidor.'
      }));
      metadata.errors.push('FETCH_NETWORK');
    } else {
      findings.push(_urlAuditFinding({ id: 'URL-NETERR', title: 'Erro de rede ao conectar',
        category: 'Conectividade', severity: 'medio', status: 'confirmado',
        evidence: String(e?.message || e).slice(0, 240),
        recommendation: 'Verifique conectividade geral e se o site não está bloqueado.'
      }));
      metadata.errors.push('FETCH_UNKNOWN');
    }
  }

  // ---- Se houve resposta principal, aplica ~10 regras determinísticas
  if (mainResp) {
    const resp = mainResp.response;
    metadata.finalUrl = mainResp.finalUrl;
    metadata.finalStatus = resp.status;
    try { metadata.finalHttpVersion = String(resp.httpVersion || '') || null; } catch {}
    const hdrs = {};
    for (const [k, v] of resp.headers.entries()) hdrs[k.toLowerCase()] = v;
    metadata.finalHeaders = hdrs;
    const finalU = new URL(mainResp.finalUrl);

    // R1 · HTTPS/TLS
    if (finalU.protocol === 'https:') {
      findings.push(_urlAuditFinding({ id: 'URL-HTTPS', title: 'HTTPS/TLS habilitado na URL final',
        category: 'Transporte', severity: 'seguro', status: 'confirmado',
        evidence: `protocolo=${finalU.protocol} finalUrl=${finalU.origin}`,
        recommendation: 'Manter. Verifique também o rating no SSLLabs (certificado, protocolos TLS 1.2+/cifras modernas, HSTS).',
      }));
    } else {
      findings.push(_urlAuditFinding({ id: 'URL-NOHTTPS', title: 'Site SEM HTTPS/TLS (protocolo inseguro)',
        category: 'Transporte', severity: 'critico', status: 'confirmado',
        evidence: `protocolo=${finalU.protocol}  ·  status=${resp.status}  ·  url=${finalU.origin}`,
        recommendation: 'Ative HTTPS/TLS com certificado válido (Let\'s Encrypt / CA confiável) e desative redirecione HTTP → HTTPS permanente (301 HSTS).'
      }));
    }
    // R1b · redirect chain http→https
    const startU = new URL(metadata.urlNormalized);
    if (startU.protocol === 'http:') {
      const goesHttps = metadata.redirectChain.some(r => {
        try { const t = new URL(r.to); return t.protocol === 'https:'; } catch { return false; }
      });
      if (goesHttps) {
        findings.push(_urlAuditFinding({ id: 'URL-HTTPREDIRECTOK', title: 'HTTP → HTTPS redirecionamento ativo',
          category: 'Transporte', severity: 'seguro', status: 'confirmado',
          evidence: `${metadata.redirectChain.length} redirect(s); primeira origem http: redirecionou para https.`,
          recommendation: 'Manter. Considere adicionar HSTS para obrigar HTTPS no navegador (preload list opcional).'
        }));
      } else {
        findings.push(_urlAuditFinding({ id: 'URL-HTTPNOREDIRECT', title: 'HTTP NÃO redireciona para HTTPS',
          category: 'Transporte', severity: 'alto', status: 'confirmado',
          evidence: `entrada=${startU.protocol}//${startU.hostname} sem redirect para https: ou sequência ${metadata.redirectChain.length} hops permaneceu http.`,
          recommendation: 'Configure 301 permanente de http://* → https://* no servidor / CDN / load balancer.'
        }));
      }
    }
    // R2 · status code (5xx = erro, 4xx site bloqueia agent, 2xx/3xx = ok)
    if (resp.status >= 500) {
      findings.push(_urlAuditFinding({ id: 'URL-HTTP5XX', title: `Erro HTTP ${resp.status} no servidor`,
        category: 'HTTP', severity: 'alto', status: 'confirmado',
        evidence: `status=${resp.status} statusText=${resp.statusText || ''}`,
        recommendation: 'Investigue logs de aplicação. Pode expor stack trace/credenciais se custom errors estiverem desligados; ative páginas de erro genéricas.'
      }));
    } else if (resp.status === 403 || resp.status === 451) {
      findings.push(_urlAuditFinding({ id: 'URL-HTTPBLOCK', title: `Acesso público bloqueado HTTP ${resp.status}`,
        category: 'HTTP', severity: 'baixo', status: 'suspeito',
        evidence: `status=${resp.status}. Bloqueio por cloud/WAF/IP geográfico ou por User-Agent desconhecido.`,
        recommendation: 'Se o site é público, permita bots/User-Agents conhecidos. Se é privado, manter bloqueio e adicionar autenticação adequada.'
      }));
    } else if (resp.status >= 200 && resp.status < 400) {
      findings.push(_urlAuditFinding({ id: 'URL-HTTP-OK', title: `Resposta HTTP ${resp.status} estável`,
        category: 'HTTP', severity: 'seguro', status: 'confirmado',
        evidence: `status=${resp.status}  redirects=${metadata.redirectChain.length}`,
        recommendation: 'Manter.'
      }));
    }
    // R3 · Headers de segurança (OWASP Secure Headers)
    const SECURE_HEADERS_CHECKS = [
      { key: 'strict-transport-security',  label: 'HSTS · HTTP Strict Transport Security', sev: 'alto',   rec: 'Adicione header "Strict-Transport-Security: max-age=31536000; includeSubDomains" (2 anos mínimo).' },
      { key: 'x-frame-options',            label: 'X-Frame-Options (anti-clickjacking)', sev: 'medio',  rec: 'Adicione "X-Frame-Options: DENY" ou "SAMEORIGIN" (ou equivalente via CSP frame-ancestors).' },
      { key: 'x-content-type-options',     label: 'X-Content-Type-Options: nosniff',     sev: 'medio',  rec: 'Adicione "X-Content-Type-Options: nosniff" para evitar MIME sniffing em CSS/JS.' },
      { key: 'referrer-policy',            label: 'Referrer-Policy',                     sev: 'baixo',  rec: 'Adicione "Referrer-Policy: strict-origin-when-cross-origin" (ou mais restrito).' },
      { key: 'permissions-policy',         label: 'Permissions-Policy',                  sev: 'baixo',  rec: 'Adicione "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()" (desabilita por padrão APIs sensíveis).' },
      { key: 'content-security-policy',    label: 'Content-Security-Policy (CSP)',       sev: 'alto',   rec: 'Implemente CSP com fontes explícitas (não use "unsafe-inline" / "unsafe-eval" / "*" a menos que estritamente necessário).' },
    ];
    for (const c of SECURE_HEADERS_CHECKS) {
      const v = hdrs[c.key];
      if (v && String(v).trim().length > 0) {
        findings.push(_urlAuditFinding({
          id: 'URL-HDR-' + c.key.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
          title: `Header seguro PRESENTE: ${c.label}`,
          category: 'Headers', severity: 'seguro', status: 'confirmado',
          evidence: `${c.key}: ${String(v).slice(0,160)}`,
          recommendation: 'Manter. Revise periodicamente políticas (CSP, Permissions-Policy, HSTS preload).'
        }));
        // Extra checks específicos
        if (c.key === 'content-security-policy') {
          const vlow = String(v).toLowerCase();
          if (/unsafe-inline|unsafe-eval/.test(vlow)) {
            findings.push(_urlAuditFinding({ id: 'URL-CSP-UNSAFE', title: 'CSP contém diretivas inseguras (unsafe-inline/unsafe-eval)',
              category: 'CSP', severity: 'alto', status: 'confirmado',
              evidence: `content-security-policy: ${String(v).slice(0,220)}`,
              recommendation: 'Remova "unsafe-inline" / "unsafe-eval" usando nonce criptográfico por request ou hash SHA-256 de scrips inline confiáveis (CSP Level 2+).'
            }));
          }
          if (/(^|[\s;])default-src\s+\*[\s;]/.test(vlow) || /(^|[\s;])script-src\s+\*[\s;]/.test(vlow)) {
            findings.push(_urlAuditFinding({ id: 'URL-CSP-WILDCARD', title: 'CSP permite wildcard * em script-src/default-src',
              category: 'CSP', severity: 'alto', status: 'confirmado',
              evidence: `content-security-policy: ${String(v).slice(0,220)}`,
              recommendation: 'Substitua "*" por origens explícitas e confiáveis. Nunca use "*" em script-src/style-src.'
            }));
          }
        }
      } else {
        findings.push(_urlAuditFinding({
          id: 'URL-HDR-MISSING-' + c.key.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
          title: `Header AUSENTE: ${c.label}`,
          category: 'Headers', severity: c.sev, status: 'confirmado',
          evidence: `header "${c.key}" não foi retornado em ${metadata.finalUrl}`,
          recommendation: c.rec
        }));
      }
    }
    // R4 · CORS
    const acao = hdrs['access-control-allow-origin'];
    if (acao === '*') {
      findings.push(_urlAuditFinding({ id: 'URL-CORS-STAR', title: 'CORS Access-Control-Allow-Origin = * (origem aberta)',
        category: 'CORS', severity: 'medio', status: 'confirmado',
        evidence: 'access-control-allow-origin: *',
        recommendation: 'Se API retorna dados autenticados ou sensíveis NÃO use "*". Especifique origens explícitas e valide Vary: Origin. Para recursos públicos estáticos CDN (CSS/JS/img) "*" é aceitável.'
      }));
    } else if (acao === 'null') {
      findings.push(_urlAuditFinding({ id: 'URL-CORS-NULL', title: 'CORS permitindo origem "null"',
        category: 'CORS', severity: 'alto', status: 'confirmado',
        evidence: 'access-control-allow-origin: null',
        recommendation: 'Remova permissão para origem "null" (falsificação via iframe sandbox / arquivo local).'
      }));
    } else if (acao) {
      findings.push(_urlAuditFinding({ id: 'URL-CORS-CONFIG', title: `CORS configurado (origem explícita)`,
        category: 'CORS', severity: 'seguro', status: 'confirmado',
        evidence: `access-control-allow-origin: ${String(acao).slice(0,160)}`,
        recommendation: 'Manter. Verificar se há checagem efetiva de whitelist (não refletir header de origem sem validar).'
      }));
    } else {
      findings.push(_urlAuditFinding({ id: 'URL-CORS-OFF', title: 'CORS não declarado (sem access-control-allow-origin)',
        category: 'CORS', severity: 'baixo', status: 'nao_observavel',
        evidence: 'Nenhum header "access-control-allow-origin" retornado em requisição GET /.',
        recommendation: 'Se este é um endpoint API usado cross-origin, configure whitelist. Se é um site tradicional (mesma origem), manter desligado é seguro.'
      }));
    }
    // R5 · Cookies secure + HttpOnly + SameSite
    const setCookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : (hdrs['set-cookie'] ? [hdrs['set-cookie']] : []);
    metadata.finalCookieCount = setCookies.length;
    if (setCookies.length === 0) {
      findings.push(_urlAuditFinding({ id: 'URL-COOKIES-NONE', title: 'Nenhum Set-Cookie retornado',
        category: 'Cookies', severity: 'baixo', status: 'nao_observavel',
        evidence: '0 set-cookie headers em GET /',
        recommendation: 'Se o site usa sessões/auth, após o login verifique os atributos Secure, HttpOnly e SameSite=Lax/Strict.'
      }));
    }
    for (let i = 0; i < setCookies.length; i++) {
      const ck = String(setCookies[i] || '');
      const m = /^([^=;\s]+)=?/.exec(ck);
      const ckName = m ? m[1] : `<cookie#${i+1}>`;
      const ckLow = ck.toLowerCase();
      const hasSecure = /;\s*secure\b/i.test(ckLow);
      const hasHttpOnly = /;\s*httponly\b/i.test(ckLow);
      const hasSameSite = /;\s*samesite\s*=\s*(strict|lax|none)\b/i.test(ckLow);
      const ssMatch = /;\s*samesite\s*=\s*(strict|lax|none)\b/i.exec(ckLow);
      const ssVal = ssMatch ? ssMatch[1].toLowerCase() : null;
      if (!hasSecure) {
        findings.push(_urlAuditFinding({ id: 'URL-CK-SEC-' + i, title: `Cookie "${ckName}" SEM atributo Secure`,
          category: 'Cookies', severity: 'alto', status: 'confirmado',
          evidence: ck.slice(0, 220),
          recommendation: 'Adicione "; Secure" em todos os cookies de sessão/autenticação (só enviados via HTTPS).'
        }));
      }
      if (!hasHttpOnly) {
        findings.push(_urlAuditFinding({ id: 'URL-CK-HO-' + i, title: `Cookie "${ckName}" SEM atributo HttpOnly`,
          category: 'Cookies', severity: 'medio', status: 'confirmado',
          evidence: ck.slice(0, 220),
          recommendation: 'Adicione "; HttpOnly" em cookies de sessão/JWT para impedir leitura via JS em caso de XSS.'
        }));
      }
      if (!hasSameSite) {
        findings.push(_urlAuditFinding({ id: 'URL-CK-SS-' + i, title: `Cookie "${ckName}" SEM SameSite (default Lax pode variar por navegador)`,
          category: 'Cookies', severity: 'medio', status: 'confirmado',
          evidence: ck.slice(0, 220),
          recommendation: 'Declare explicitamente "; SameSite=Lax" (padrão seguro) ou Strict para sessões sensíveis. Se cross-origin, use SameSite=None + Secure.'
        }));
      } else if (ssVal === 'none' && !hasSecure) {
        findings.push(_urlAuditFinding({ id: 'URL-CK-SSNONE-' + i, title: `Cookie "${ckName}" SameSite=None SEM Secure`,
          category: 'Cookies', severity: 'critico', status: 'confirmado',
          evidence: ck.slice(0, 220),
          recommendation: 'Mesma origem: troque SameSite=None por Lax/Strict. Cross-origin obrigatório: adicione "; Secure" (navegadores modernos rejeitam SameSite=None sem Secure).'
        }));
      }
      if (hasSecure && hasHttpOnly && hasSameSite && (ssVal !== 'none' || hasSecure)) {
        findings.push(_urlAuditFinding({ id: 'URL-CK-OK-' + i, title: `Cookie "${ckName}" com atributos seguros (Secure + HttpOnly + SameSite)`,
          category: 'Cookies', severity: 'seguro', status: 'confirmado',
          evidence: ck.slice(0, 220),
          recommendation: 'Manter.'
        }));
      }
    }
    // R6 · Info leak: Server / X-Powered-By / X-AspNet-Version / X-Generator
    const LEAK_HEADERS = ['server','x-powered-by','x-aspnet-version','x-aspnetmvc-version','x-generator','x-drupal-dynamic-cache','x-wp-db']
      .filter(k => hdrs[k]);
    if (LEAK_HEADERS.length > 0) {
      const evidence = LEAK_HEADERS.map(k => `${k}: ${String(hdrs[k]).slice(0,80)}`).join('  ·  ');
      findings.push(_urlAuditFinding({ id: 'URL-INFOLEAK', title: `Informações técnicas expostas em headers (${LEAK_HEADERS.join(', ')})`,
        category: 'Fingerprint', severity: 'baixo', status: 'confirmado',
        evidence,
        recommendation: 'Remova ou ofusque X-Powered-By, versões de servidor/linguagem/framework. Dificulta reconhecimento automatizado de vulnerabilidades de versões.'
      }));
    } else {
      findings.push(_urlAuditFinding({ id: 'URL-NOINFOLEAK', title: 'Nenhum header tecnicamente informativo (Server/X-Powered-By etc.) exposto',
        category: 'Fingerprint', severity: 'seguro', status: 'confirmado',
        evidence: Object.keys(hdrs).filter(k => k.startsWith('x-') || k==='server').map(k => `${k}=`).join(', ') || 'nenhum header sensível retornado',
        recommendation: 'Manter.'
      }));
    }
  }

  // ---- Recursos públicos · HEAD / robots.txt · sitemap.xml · wlwmanifest.xml
  const RESOURCES_TO_CHECK = [
    { file: 'robots.txt',  category: 'Recursos Públicos', expected: [200, 204, 404], desc: 'Lista crawlers permitidos e rotas proibidas (não liste rotas privadas)' },
    { file: 'sitemap.xml', category: 'Recursos Públicos', expected: [200], desc: 'Índice de páginas para SEO' },
    { file: 'wlwmanifest.xml', category: 'Fingerprint', expected: [403,404], desc: 'Se existir em WP antigo, expõe versão Wordpress e endpoint de postagem antigo.' },
  ];
  for (const r of RESOURCES_TO_CHECK) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 7000);
    try {
      const tgt = baseHref.replace(/\/$/, '') + '/' + r.file;
      const rr = await fetch(tgt, {
        method: 'HEAD', signal: ctrl.signal, redirect: 'follow', credentials: 'omit', cache: 'no-store',
        headers: { 'User-Agent': 'TiAgente-Security-URL-Audit/1.0' },
      });
      clearTimeout(to);
      metadata.publicResources[r.file] = { status: rr.status, found: rr.ok };
      if (r.file === 'wlwmanifest.xml' && (rr.status === 200 || rr.status === 301 || rr.status === 302)) {
        findings.push(_urlAuditFinding({ id: 'URL-R-WLW', title: 'wlwmanifest.xml Acessível publicamente (possível instalação Wordpress exposta)',
          category: r.category, severity: 'baixo', status: 'confirmado',
          evidence: `${baseHref}/wlwmanifest.xml → HTTP ${rr.status} (esperado 403/404)`,
          recommendation: 'Remova o arquivo wlwmanifest.xml ou bloqueie via htaccess/nginx; é um artefato legado de clientes Windows Live Writer.'
        }));
      } else if (r.file === 'wlwmanifest.xml' && (rr.status === 403 || rr.status === 404)) {
        findings.push(_urlAuditFinding({ id: 'URL-R-WLWOK', title: 'wlwmanifest.xml bloqueado/inexistente (bom)',
          category: r.category, severity: 'seguro', status: 'confirmado',
          evidence: `/wlwmanifest.xml → HTTP ${rr.status}`,
          recommendation: 'Manter.'
        }));
      } else if (r.file === 'robots.txt') {
        findings.push(_urlAuditFinding({ id: 'URL-R-ROBOTS', title: 'robots.txt verificado',
          category: r.category, severity: 'baixo', status: rr.status === 404 ? 'suspeito' : 'confirmado',
          evidence: `/robots.txt → HTTP ${rr.status}${rr.status===404?' (ausente)':''}`,
          recommendation: rr.status===404 ? 'Crie robots.txt (mesmo que vazio) para crawlers bem-comportados; nunca liste rotas privadas como /admin, /painel.' : 'Verifique que Sensitive paths (painel/admin/internal) não estão em Allow.'
        }));
      } else if (r.file === 'sitemap.xml') {
        findings.push(_urlAuditFinding({ id: 'URL-R-SITEMAP', title: 'sitemap.xml verificado',
          category: r.category, severity: 'baixo', status: 'confirmado',
          evidence: `/sitemap.xml → HTTP ${rr.status}${rr.status===200?' (encontrado)':' (ausente)'}.`,
          recommendation: rr.status===200 ? 'Verifique se URLs privadas não estão sendo indexadas. Submeta no Google Search Console.' : 'Crie sitemap.xml se o site possui conteúdo indexável (importante para SEO).'
        }));
      }
    } catch (e) {
      clearTimeout(to);
      metadata.publicResources[r.file] = { error: String(e?.message||e).slice(0,140) };
      findings.push(_urlAuditFinding({ id: 'URL-R-ERR-' + r.file.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase(), title: `${r.file} não foi possível checar (timeout/rede)`,
        category: r.category, severity: 'baixo', status: 'nao_observavel',
        evidence: String(e?.message || e).slice(0, 200),
        recommendation: r.desc
      }));
    }
  }
  metadata.finishedAt = new Date().toISOString();

  // ---- Score e nota (compatível com fórmula existente RC26)
  const WEIGHTS = { critico: 10, alto: 5, medio: 2, baixo: 1, seguro: 0 };
  let score = 0;
  const counts = { critico: 0, alto: 0, medio: 0, baixo: 0, seguro: 0, nao_observavel: 0, suspeito: 0 };
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
    if (['seguro','nao_observavel'].includes(f.severity)) continue;
    score += (WEIGHTS[f.severity] || 1);
  }
  let grade = 'C';
  if (score < 5) grade = 'A';
  else if (score < 15) grade = 'B';
  else if (score < 30) grade = 'C';
  else if (score < 60) grade = 'D';
  else grade = 'F';
  findings.sort((a, b) => {
    const R = { critico: 0, alto: 1, medio: 2, baixo: 3, suspeito: 4, nao_observavel: 5, seguro: 6 };
    return (R[a.severity] ?? 9) - (R[b.severity] ?? 9);
  });
  return { ok: true, metadata, findings, counts, score, grade };
}

// ===== ENDPOINTS =====
app.post('/api/url-audit/request-confirmation', (req, res) => {
  const { url, clientId } = req.body || {};
  const u = _urlAuditNormalize(url);
  if (!u) return res.status(400).json({ ok: false, error: 'URL inválida. Use URLs públicas HTTP/HTTPS (não localhost/LAN/portas arbitrárias, nem user:pass@).' });
  _urlAuditPruneOldTokens();
  const token = crypto.randomBytes(24).toString('hex');
  URL_AUDIT_AUTH_TOKENS.set(token, { url: u.toString(), createdAtMs: Date.now(), clientId: String(clientId || '').slice(0, 64) });
  res.json({
    ok: true,
    confirmationToken: token,
    urlNormalized: u.toString(),
    ttlSeconds: Math.floor(URL_AUDIT_TOKEN_TTL_MS / 1000),
    plan: [
      `1. 1 requisição GET ${u.origin}${u.pathname.length>1?u.pathname:''} (follow redirects máximo ${URL_AUDIT_MAX_REDIRECTS})`,
      '2. Análise: HTTPS/TLS · redirect chain HTTP→HTTPS · status code HTTP',
      '3. Headers: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Content-Security-Policy',
      '4. CORS Access-Control-Allow-Origin',
      '5. Cookies: Secure / HttpOnly / SameSite',
      '6. Fingerprint: Server, X-Powered-By, X-AspNet-Version, X-Generator',
      '7. 3 HEAD recursos públicos: /robots.txt · /sitemap.xml · /wlwmanifest.xml (Wordpress legado)',
      'NÃO: brute force, login, envio de forms, paths adivinhados, dados POST, scan de portas.',
    ],
    warnings: [
      'Ao confirmar, você declara ser proprietário ou ter autorização escrita do proprietário para escanear este endereço.',
      'O scan é somente leitura e NÃO altera dados; em raros casos WAF/Cloudflare pode bloquear o IP do cliente (403/429).'
    ]
  });
});

app.post('/api/url-audit/run', async (req, res) => {
  const { confirmationToken, clientId } = req.body || {};
  if (!confirmationToken || typeof confirmationToken !== 'string') return res.status(400).json({ ok: false, error: 'confirmationToken faltando. Etapa 1 (solicitar confirmação) obrigatória.' });
  _urlAuditPruneOldTokens();
  const entry = URL_AUDIT_AUTH_TOKENS.get(confirmationToken);
  if (!entry) return res.status(401).json({ ok: false, error: 'Token de confirmação expirado ou inválido. Recarregue a página e tente novamente.' });
  if (Date.now() - entry.createdAtMs > URL_AUDIT_TOKEN_TTL_MS) {
    URL_AUDIT_AUTH_TOKENS.delete(confirmationToken);
    return res.status(401).json({ ok: false, error: 'Token expirado (janela de 15-20s). Confirme imediatamente após solicitar.' });
  }
  URL_AUDIT_AUTH_TOKENS.delete(confirmationToken);  // 1 uso só (não repete token)
  try {
    const report = await scanUrlSafety(entry.url);
    // Salvar em disco opcional? (mantemos só em memória nesta primeira etapa. Se quiser, criar /audits/url_*.json)
    res.json({ ok: true, report });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

/* ============================================================
   SPA fallback: qualquer rota não-API retorna index.html
============================================================ */
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  const p = req.path || '/';
  if (p.includes('.') && !p.endsWith('.html')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ============================================================
   START SERVER
============================================================ */
const server = app.listen(PORT, HOST, () => {
  const projects = scanProjects().length;
  const box = '═'.repeat(63);
  console.log('╔' + box + '╗');
  console.log('║   TiAgente SECURITY · Auditor & Fixer (MÓDULO ISOLADO)   ║');
  console.log('╠' + box + '╣');
  const linha = (txt) => {
    const pad = Math.max(0, 63 - Array.from(txt).length);
    return '║  ' + txt + ' '.repeat(pad) + '║';
  };
  console.log(linha(`URL        : http://${HOST}:${PORT}/`));
  console.log(linha(`Projetos   : ${projects} detectados (workspace criador + mounted)`));
  const hasK = process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim().length >= 10;
  const kp = keyPrefix(process.env.GOOGLE_API_KEY || '');
  console.log(linha(`Google IA  : ${hasK ? '🔑 ' + kp + ' (resumos IA)' : '— desligado (só heurística)'}`));
  console.log(linha(`Audits dir : audits/  ·  Backups dir : backups/`));
  console.log('╚' + box + '╝');
});

server.on('error', (err) => {
  console.error('[SERVER ERROR]', err);
});
