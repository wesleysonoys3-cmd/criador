import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import http from 'node:http';
import net from 'node:net';
import { WebSocketServer } from 'ws';
import * as fs from 'node:fs/promises';
import * as fsc from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemini-3.5-flash-lite';
const WORKSPACE_ROOT = path.resolve(process.env.WORK_DIR || './workspace');
const DEFAULT_PROJECT = 'default';
const MAX_STEPS = parseInt(process.env.MAX_STEPS || '15', 10);

function looksLikeValidGoogleKey(k) {
  if (!k || typeof k !== 'string') return false;
  const t = k.trim();
  if (t.length < 20) return false;
  if (/sua[_ -]?chave|your[_ -]?key|YOUR[_ -]?KEY|xxxx|xxxx/i.test(t)) return false;
  return /^(AIza|AQ\.|AB\.|AKIA|GOOG)/.test(t) || t.length >= 35;
}
const GOOGLE_KEY_OK = looksLikeValidGoogleKey(GOOGLE_API_KEY);
if (!GOOGLE_KEY_OK) {
  const box = '='.repeat(68);
  console.error('\n' + box);
  console.error('  ⚠️  RC20  GOOGLE_API_KEY ausente, vazia ou com suspeita de inválida.');
  console.error('     ─ A IA NÃO vai funcionar! Qualquer prompt retorna erro 400/401/403.');
  console.error('     ─ Onde corrigir: arquivo .env na pasta do projeto:');
  console.error(`       • ${path.resolve(__dirname, '.env')}`);
  console.error('     ─ Obter chave: https://aistudio.google.com/  (botão Get API key)');
  console.error('     ─ Depois de salvar: reinicie o CriaSiteTiago.app / servidor.');
  console.error(box + '\n');
} else {
  console.log(`✅ RC20  Google API key carregada (prefixo: ${(GOOGLE_API_KEY || '').slice(0, 5)}…${(GOOGLE_API_KEY || '').slice(-4)} · looksLikeValid=true)`);
}
const COMMAND_TIMEOUT_MS = 60000;
const API_VERSION = 'v1beta';
const PORT = parseInt(process.env.PORT || '3000', 10);
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

// ============================================================
//  RC21  RENDER / LINUX HEADLESS DETECTION (nuvem = single-port, sem osascript, sem preview servers extras)
//  - Render REALMENTE injeta: RENDER_EXTERNAL_URL, RENDER_SERVICE_ID, RENDER_SERVICE_NAME, RENDER_INSTANCE_ID
//  - Outras nuvens: K_SERVICE (GCP Cloud Run), RAILWAY_STATIC_URL, VERCEL_URL, HEROKU_APP_ID
//  - Fallback geral: PORT setada + platform NÃO macOS (darwin) + TRAE_LOCAL ausente => assume nuvem/Linux headless
// ============================================================
const IS_RENDER_OR_HEADLESS_LINUX = Boolean(
  process.env.RENDER ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.RENDER_SERVICE_ID ||
  process.env.RENDER_SERVICE_NAME ||
  process.env.RENDER_INSTANCE_ID ||
  process.env.K_SERVICE ||
  process.env.RAILWAY_STATIC_URL ||
  process.env.VERCEL_URL ||
  process.env.HEROKU_APP_ID ||
  (process.env.PORT && process.platform !== 'darwin' && !process.env.TRAE_LOCAL)
);
const RENDER_BASE_URL = (
  process.env.RENDER_EXTERNAL_URL ||
  (IS_RENDER_OR_HEADLESS_LINUX ? '' : '')
).replace(/\/+$/, '');
console.log(
  `🌐 Ambiente: platform=${process.platform} · PORT=${PORT}` +
  (IS_RENDER_OR_HEADLESS_LINUX
    ? ` · RC20 modo RENDER/LINUX headless ativado (single-port ${PORT}, preview via /preview/:slug/)`
    : ' · Desktop macOS/máquina local')
);

// ===== ENSEMBLE 2 Cabeças GRATUITO · 2x Gemini (Google GenAI · sem custo) =====
// Usa 2 modelos diferentes do Google (ambos camada gratuita):
//   Modelo A = rápido/leve (3.5 Flash Lite padrão)
//   Modelo B = criativo/extenso (2.0 Flash default)
// Funcionamento: Paralelo, voto majoritário em chamadas de ferramentas, merge de texto.
const FREE_MODEL_A = process.env.FREE_MODEL_A || process.env.GOOGLE_MODEL || 'gemini-3.5-flash-lite';
const FREE_MODEL_B = process.env.FREE_MODEL_B || 'gemini-2.0-flash-exp';
const FREE_ENSEMBLE_MODE_RAW = String(process.env.FREE_ENSEMBLE_MODE || process.env.ENSEMBLE_MODE || 'off').trim().toLowerCase();
function ensembleIsEnabled(override) {
  const m = typeof override === 'string' ? override.trim().toLowerCase() : FREE_ENSEMBLE_MODE_RAW;
  // Requisito único: ter chave GOOGLE válida (não vazia)
  if (!GOOGLE_API_KEY || !String(GOOGLE_API_KEY).trim().length) return false;
  return ['parallel', 'critic'].includes(m);
}
const ENSEMBLE_ENABLED = ensembleIsEnabled();
const ENSEMBLE_MODE = ENSEMBLE_ENABLED ? FREE_ENSEMBLE_MODE_RAW : 'off';

// ===== Mounted Projects (pastas externas selecionadas do Desktop/Mac) =====
const MOUNTED_FILE = path.join(__dirname, 'mounted_projects.json');
const mountedProjects = new Map(); // slug -> {slug, displayName, path, createdAt, modifiedAt, fallbackInternal?: boolean}
function safeReadMounted() {
  try {
    if (fsc.existsSync(MOUNTED_FILE)) {
      const raw = fsc.readFileSync(MOUNTED_FILE, 'utf-8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) for (const m of arr) if (m && m.slug && m.path) mountedProjects.set(m.slug, Object.assign({ fallbackInternal: false }, m));
    }
  } catch {}
}
async function saveMounted() {
  try {
    await fs.writeFile(MOUNTED_FILE, JSON.stringify([...mountedProjects.values()], null, 2), 'utf-8');
  } catch {}
}
async function markMountedFallback(slug) {
  const m = mountedProjects.get(slug);
  if (!m || m.fallbackInternal) return false;
  m.fallbackInternal = true;
  await saveMounted();
  return true;
}
// Retorna o DIRETÓRIO GRAVÁVEL para um projeto:
//   - Projeto não montado => workspace normal
//   - Projeto montado SEM fallbackInternal => pasta externa do usuário
//   - Projeto montado COM fallbackInternal => pasta workspace interna (macOS TCC bloqueou escrita)
function resolveWritableProjectDir(project) {
  const raw = String(project || DEFAULT_PROJECT || '');
  if (mountedProjects.has(raw)) {
    const m = mountedProjects.get(raw);
    if (m.fallbackInternal) {
      const p = path.join(WORKSPACE_ROOT, raw);
      if (!fsc.existsSync(p)) fsc.mkdirSync(p, { recursive: true });
      return p;
    }
    return m.path;
  }
  // Fallback workspace normal
  const sanitized = raw.replace(/[^\w.\-_ ]/g, '_').trim().replace(/\s+/g, '-').toLowerCase() || 'default';
  const p = path.join(WORKSPACE_ROOT, sanitized);
  if (!fsc.existsSync(p)) fsc.mkdirSync(p, { recursive: true });
  return p;
}
// Retorna pasta FAVORITA VISUAL/EXPLORER (mesma coisa do resolveProjectDir original, não altera leitura)
function resolveVisualProjectDir(project) {
  const raw = String(project || DEFAULT_PROJECT || '');
  if (mountedProjects.has(raw)) return mountedProjects.get(raw).path;
  const sanitized = raw.replace(/[^\w.\-_ ]/g, '_').trim().replace(/\s+/g, '-').toLowerCase() || 'default';
  return path.join(WORKSPACE_ROOT, sanitized);
}
safeReadMounted();

// ===== Port allocation por projeto =====
const PROJECT_PORT_FILE = path.join(__dirname, 'project_ports.json');
const projectPorts = new Map(); // slug -> porta number
const projectServers = new Map(); // slug -> http.Server (static preview)
const PROJECT_PORT_MIN = parseInt(process.env.PROJECT_PORT_MIN || '3001', 10);
const PROJECT_PORT_MAX = parseInt(process.env.PROJECT_PORT_MAX || '4100', 10);
function safeReadProjectPorts() {
  try {
    if (fsc.existsSync(PROJECT_PORT_FILE)) {
      const raw = fsc.readFileSync(PROJECT_PORT_FILE, 'utf-8');
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') for (const [s, p] of Object.entries(obj)) if (typeof p === 'number') projectPorts.set(s, p);
    }
  } catch {}
}
async function saveProjectPorts() {
  try {
    const obj = {}; for (const [s,p] of projectPorts.entries()) obj[s] = p;
    await fs.writeFile(PROJECT_PORT_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch {}
}
safeReadProjectPorts();

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => { try { srv.close(); } catch {}; resolve(false); });
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '127.0.0.1');
  });
}
async function findFreePort(startAt = PROJECT_PORT_MIN) {
  for (let p = startAt; p <= PROJECT_PORT_MAX; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error('Não há portas livres na faixa ' + PROJECT_PORT_MIN + '-' + PROJECT_PORT_MAX);
}
async function getPortForProject(slug) {
  if (projectPorts.has(slug)) {
    const cur = projectPorts.get(slug);
    if (await isPortFree(cur)) return cur;
  }
  // tenta achar a próxima porta livre começando da PROJECT_PORT_MIN, evitando portas já reservadas
  const used = new Set(projectPorts.values());
  let port = PROJECT_PORT_MIN;
  while (used.has(port) || !(await isPortFree(port))) {
    port++;
    if (port > PROJECT_PORT_MAX) break;
  }
  if (port > PROJECT_PORT_MAX) port = await findFreePort();
  projectPorts.set(slug, port);
  await saveProjectPorts();
  return port;
}
function slugifyMountName(raw) {
  const clean = String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-_ ]/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  return clean ? clean.toLowerCase() : 'mounted-' + Date.now().toString(36);
}
async function mountProject(folderPath, displayName) {
  const abs = path.isAbsolute(folderPath) ? folderPath : path.resolve(__dirname, folderPath);
  try { await fs.access(abs); } catch { throw new Error('Pasta não existe ou inacessível: ' + abs); }
  const st = await fs.stat(abs);
  if (!st.isDirectory()) throw new Error('Caminho não é uma pasta: ' + abs);
  // Evita duplicatas de caminho
  for (const m of mountedProjects.values()) if (path.resolve(m.path) === abs) return m;
  const slug = slugifyMountName(displayName || path.basename(abs));
  // Evita conflito de slug: adiciona número se necessário
  let finalSlug = slug;
  let n = 1;
  while (mountedProjects.has(finalSlug) || !finalSlug) {
    n++;
    finalSlug = slug + '-' + n;
  }
  const now = Date.now();
  const record = {
    slug: finalSlug,
    displayName: String(displayName || path.basename(abs)).slice(0, 120),
    path: abs,
    mounted: true,
    createdAt: now,
    modifiedAt: now,
  };
  mountedProjects.set(finalSlug, record);
  await saveMounted();
  return record;
}

await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
await fs.mkdir(path.join(WORKSPACE_ROOT, DEFAULT_PROJECT), { recursive: true });
await fs.mkdir(UPLOAD_DIR, { recursive: true });

function resolveProjectDir(project) {
  // Retorna o caminho ORIGINAL (visual/explorador) — compatibilidade com endpoints /projects/ e listagens
  return resolveVisualProjectDir(project);
}
async function ensureProject(project) {
  const raw = String(project || DEFAULT_PROJECT);
  if (mountedProjects.has(raw)) {
    // Garante que exista tanto a pasta externa (se puder) quanto o fallback interno
    const fallbackDir = resolveWritableProjectDir(raw);
    if (!fsc.existsSync(fallbackDir)) await fs.mkdir(fallbackDir, { recursive: true });
    try {
      const marker1 = path.join(fallbackDir, '.project');
      if (!fsc.existsSync(marker1)) await fs.writeFile(marker1, `# ${raw} (fallback)\nCriado em ${new Date().toISOString()}\n`, 'utf8');
    } catch {}
    try {
      const ext = mountedProjects.get(raw).path;
      if (fsc.existsSync(ext)) {
        const marker2 = path.join(ext, '.project');
        if (!fsc.existsSync(marker2)) await fs.writeFile(marker2, `# ${raw}\nCriado em ${new Date().toISOString()}\n`, 'utf8').catch(() => {});
      }
    } catch {}
    return raw;
  }
  const dir = resolveProjectDir(raw);
  await fs.mkdir(dir, { recursive: true });
  const basename = path.basename(dir);
  try {
    const marker = path.join(dir, '.project');
    if (!fsc.existsSync(marker)) await fs.writeFile(marker, `# ${basename}\nCriado em ${new Date().toISOString()}\n`, 'utf8');
  } catch {}
  return basename;
}
function isProjectMounted(project) { return mountedProjects.has(String(project || '')); }
function isFallbackActive(project) { return mountedProjects.get(String(project || ''))?.fallbackInternal === true; }

// ===== Helpers: escrita/remoção com FALLBACK AUTOMÁTICO (escapa EPERM/EACCES pasta montada Desktop bloqueada macOS)
async function writeFileWithAutoFallback(session, args, notifyUser) {
  const slug = session.project || DEFAULT_PROJECT;
  const mounted = mountedProjects.has(slug);
  const hasFallbackBefore = isFallbackActive(slug);
  let result = await toolWriteFile(session, args);
  if (!result.ok && mounted && !hasFallbackBefore && /EPERM|EACCES|operation not permitted|permission denied/i.test(String(result.error || ''))) {
    const mudou = await markMountedFallback(slug);
    if (mudou) {
      if (notifyUser) notifyUser(
        `⚠️ **Permissão bloqueada pelo macOS**\n\n` +
        `A pasta "${mountedProjects.get(slug)?.displayName || slug}" ` +
        `na sua Área de Trabalho foi bloqueada pela proteção TCC do macOS (Desktop/Documents/Downloads pedem Full Disk Access).\n\n` +
        `✅ Não se preocupe! Continuo salvando tudo dentro da minha pasta interna em \`criador/workspace/${slug}/\`. O preview continua funcionando normalmente. Se quiser, depois pode mover os arquivos manualmente.`
      );
      // Garante pasta interna
      const fallbackDir = resolveWritableProjectDir(slug);
      if (!fsc.existsSync(fallbackDir)) fsc.mkdirSync(fallbackDir, { recursive: true });
      // Reinicia servidor preview se necessário (agora serve da pasta interna
      try {
        if (projectServers.has(slug)) {
          try { projectServers.get(slug).close(); } catch {}
          projectServers.delete(slug);
        }
        startProjectPreviewServer(slug).catch(() => {});
      } catch {}
      // Tenta escrever NOVAMENTE na pasta gravável interna
      result = await toolWriteFile(session, args);
    }
  }
  return result;
}
async function deleteFileWithAutoFallback(session, args, notifyUser) {
  const slug = session.project || DEFAULT_PROJECT;
  const mounted = mountedProjects.has(slug);
  const hasFallbackBefore = isFallbackActive(slug);
  let result = await toolDeleteFile(session, args);
  if (!result.ok && mounted && !hasFallbackBefore && /EPERM|EACCES|operation not permitted|permission denied/i.test(String(result.error || ''))) {
    await markMountedFallback(slug);
    result = await toolDeleteFile(session, args);
  }
  return result;
}

function projectMeta(project) {
  const slug = String(project || DEFAULT_PROJECT);
  if (mountedProjects.has(slug)) {
    const m = mountedProjects.get(slug);
    return {
      name: slug,
      displayName: m.displayName,
      path: m.fallbackInternal ? resolveWritableProjectDir(slug) : m.path,
      mounted: true,
      fallbackInternal: !!m.fallbackInternal,
      createdAt: m.createdAt,
      modifiedAt: m.modifiedAt || Date.now(),
    };
  }
  return { name: slug, displayName: slug, mounted: false, path: resolveProjectDir(slug), createdAt: 0, modifiedAt: 0 };
}
function projectDirOf(session) {
  // IMPORTANTE: usa o caminho GRAVÁVEL (fallback interno se macOS bloqueou a pasta do Desktop)
  return resolveWritableProjectDir(session.project || DEFAULT_PROJECT);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext;
    cb(null, name);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function setStaticPreviewHeaders(res, filePath) {
  if (/\.(html?|htm)$/i.test(filePath || '')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
// ============================================================
//  RC20  RENDER single-port preview: /preview/:slug/*
//  No desktop local continua igual (cada projeto com sua porta 3001+),
//  Mas em nuvem/Render/Linux servemos TUDO dentro da única porta liberada.
// ============================================================
app.use('/preview', (req, res, next) => {
  try {
    const rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
    const parts = rel.split('/').filter(Boolean);
    const slug = parts.shift() || DEFAULT_PROJECT;
    const base = resolveWritableProjectDir(slug);
    const restEncoded = '/' + parts.map(encodeURIComponent).join('/');
    const inside = path.resolve(base, parts.join('/'));
    if (!inside.startsWith(base)) return res.status(403).type('txt').send('403 Fora do workspace');
    const origUrl = req.url;
    const slashIdx = req.originalUrl.indexOf('/preview');
    const afterPreview = req.originalUrl.slice(slashIdx + '/preview'.length);
    const afterSlug = afterPreview.replace(/^\/+[^/]+/, '') || '/';
    req.url = afterSlug || '/';
    if (req.url === '/' || req.url === '') {
      const idxHtml = path.join(base, 'index.html');
      if (fsc.existsSync(idxHtml)) {
        setStaticPreviewHeaders(res, idxHtml);
        return res.sendFile(idxHtml);
      }
    }
    const staticHandler = express.static(base, {
      index: ['index.html', 'index.htm'],
      setHeaders: (res, filePath) => setStaticPreviewHeaders(res, filePath),
      extensions: ['html', 'htm'],
    });
    staticHandler(req, res, (err) => {
      req.url = origUrl;
      if (err) return next(err);
      res.status(404).type('txt').send(`404 — Página não existe no projeto "${slug}".`);
    });
  } catch (e) { next(e); }
});
app.use('/workspace', (req, res, next) => {
  const rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
  const parts = rel.split('/').filter(Boolean);
  const project = parts.shift() || DEFAULT_PROJECT;
  // Serve da pasta GRAVÁVEL (fallback interno se macOS bloqueou) — arquivos atuais estão lá
  const base = resolveWritableProjectDir(project);
  const restPath = '/' + parts.map(encodeURIComponent).join('/');
  const inside = path.resolve(base, parts.join('/'));
  if (!inside.startsWith(base)) return res.status(403).send('Fora do workspace');
  const origUrl = req.url;
  req.url = restPath || '/';
  const staticHandler = express.static(base, {
    setHeaders: (res, filePath, stat) => {
      const ext = path.extname(filePath).toLowerCase();
      if (['.html','.htm'].includes(ext)) {
        res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private');
      }
    }
  });
  staticHandler(req, res, (err) => {
    req.url = origUrl;
    if (err) return next(err);
    next();
  });
});
app.use('/', express.static(path.join(__dirname, 'public')));

function safeResolve(session, relativePath) {
  const baseDir = projectDirOf(session);
  const resolved = path.resolve(baseDir, relativePath || '.');
  if (!resolved.startsWith(baseDir)) {
    throw new Error(`Acesso negado: caminho fora do diretório de trabalho`);
  }
  return resolved;
}
function safeResolveBase(baseDir, relativePath) {
  const resolved = path.resolve(baseDir, relativePath || '.');
  if (!resolved.startsWith(baseDir)) {
    throw new Error(`Acesso negado: caminho fora do diretório de trabalho`);
  }
  return resolved;
}

async function toolReadFile(session, { path: filePath }) {
  if (!filePath) throw new Error('Parâmetro "path" é obrigatório');
  const fullPath = safeResolve(session, filePath);
  try {
    const content = await fs.readFile(fullPath, 'utf8');
    return { ok: true, path: filePath, content, size: content.length };
  } catch (err) {
    return { ok: false, path: filePath, error: err.message };
  }
}

async function toolWriteFile(session, { path: filePath, content }, _notifyUser) {
  if (!filePath) throw new Error('Parâmetro "path" é obrigatório');
  if (typeof content !== 'string') content = String(content ?? '');
  const fullPath = safeResolve(session, filePath);
  try {
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    const existed = await fs.access(fullPath).then(() => true).catch(() => false);
    await fs.writeFile(fullPath, content, 'utf8');
    const projectName = session.project || DEFAULT_PROJECT;
    const safePath = filePath.replace(/\\/g, '/').replace(/^\//, '');
    let url;
    const port = projectPorts.get(projectName);
    if (port) {
      url = `http://127.0.0.1:${port}/${safePath}`;
    } else {
      url = `/workspace/${encodeURIComponent(projectName)}/${safePath}`;
    }
    console.log('[TOOL write_file] projeto=' + projectName + ' | baseDir=' + (projectDirOf(session)) + ' | file=' + safePath + ' | size=' + content.length + ' | url=' + url);
    return {
      ok: true,
      path: filePath,
      action: existed ? 'updated' : 'created',
      size: content.length,
      url,
    };
  } catch (err) {
    console.log('[TOOL write_file FALHOU] projeto=' + (session.project || DEFAULT_PROJECT) + ' | file=' + filePath + ' | err=' + err.message);
    return { ok: false, path: filePath, error: err.message };
  }
}

async function toolDeleteFile(session, { path: filePath, recursive }) {
  if (!filePath) throw new Error('Parâmetro "path" é obrigatório');
  const fullPath = safeResolve(session, filePath);
  try {
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) return { ok: false, path: filePath, error: 'Arquivo/diretório não existe' };
    if (stat.isDirectory()) {
      await fs.rm(fullPath, { recursive: recursive !== false, force: true });
    } else {
      await fs.unlink(fullPath);
    }
    return { ok: true, path: filePath, action: 'deleted' };
  } catch (err) {
    return { ok: false, path: filePath, error: err.message };
  }
}

async function toolRunCommand(session, { command, timeout_sec, cwd }) {
  if (!command) throw new Error('Parâmetro "command" é obrigatório');
  const timeout = timeout_sec ? Math.min(300, parseInt(timeout_sec, 10)) * 1000 : COMMAND_TIMEOUT_MS;
  let execCwd = projectDirOf(session);
  if (cwd) {
    try { execCwd = safeResolve(session, cwd); } catch { /* usa base */ }
  }
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: execCwd,
      timeout,
      maxBuffer: 15 * 1024 * 1024,
      env: { ...process.env, PATH: [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(':') },
    });
    return {
      ok: true,
      command,
      stdout: stdout.slice(-6000),
      stderr: stderr.slice(-3000),
    };
  } catch (err) {
    return {
      ok: false,
      command,
      error: err.message,
      stdout: (err.stdout || '').slice(-3000),
      stderr: (err.stderr || '').slice(-3000),
    };
  }
}

async function toolListDir(session, { path: dirPath, depth }) {
  const baseDir = projectDirOf(session);
  const start = safeResolve(session, dirPath || '.');
  const maxDepth = Math.max(1, Math.min(5, parseInt(depth || '2', 10)));
  async function walk(dir, currentDepth) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const relBase = path.relative(baseDir, dir);
      const result = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const rel = path.join(relBase, e.name).replace(/\\/g, '/').replace(/^\.\//, '');
        if (e.name.startsWith('node_modules') || e.name.startsWith('.git')) continue;
        const item = {
          name: e.name,
          path: rel || '.',
          type: e.isDirectory() ? 'dir' : 'file',
        };
        if (e.isFile()) {
          try {
            const s = await fs.stat(full);
            item.size = s.size;
            item.mtimeMs = s.mtimeMs;
          } catch {}
        }
        if (e.isDirectory() && currentDepth < maxDepth) {
          item.children = await walk(full, currentDepth + 1);
          try {
            const sd = await fs.stat(full);
            item.mtimeMs = sd.mtimeMs;
          } catch {}
        }
        result.push(item);
      }
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return result;
    } catch (err) {
      return [{ name: 'error', type: 'error', error: err.message }];
    }
  }
  const tree = await walk(start, 1);
  return { ok: true, root: path.relative(baseDir, start) || '.', tree, project: session.project || DEFAULT_PROJECT };
}

function makeSessionTools(session, ws) {
  const notifyUser = (text) => {
    try {
      if (ws && ws.readyState === 1) {
        emit(ws, 'message:ai', { id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), text, role: 'system' });
      }
    } catch {}
  };
  return {
    read_file: (a) => toolReadFile(session, a),
    write_file: (a) => writeFileWithAutoFallback(session, a, notifyUser),
    delete_file: (a) => deleteFileWithAutoFallback(session, a, notifyUser),
    run_command: (a) => toolRunCommand(session, a),
    list_dir: (a) => toolListDir(session, a),
  };
}

const TOOL_DECLARATIONS = [
  {
    name: 'read_file',
    description: 'Lê o conteúdo de um arquivo de texto dentro do diretório de trabalho.',
    parameters: {
      type: 'OBJECT',
      properties: { path: { type: 'STRING', description: 'Caminho relativo do arquivo (ex: src/index.js).' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Cria ou sobrescreve um arquivo. Cria subdiretórios automaticamente.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Caminho relativo do arquivo.' },
        content: { type: 'STRING', description: 'Conteúdo completo a ser escrito.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Remove um arquivo ou diretório vazio (use recursive=true para diretórios com conteúdo).',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Caminho relativo do arquivo/diretório.' },
        recursive: { type: 'BOOLEAN', description: 'Remove diretórios com conteúdo (padrão: true).' },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_command',
    description: 'Executa um comando shell no diretório de trabalho.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'Comando shell a executar.' },
        timeout_sec: { type: 'NUMBER', description: 'Timeout em segundos (máx 300). Padrão 60.', minimum: 1, maximum: 300 },
        cwd: { type: 'STRING', description: 'Subdiretório de execução (dentro do workspace).' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_dir',
    description: 'Lista arquivos e diretórios em árvore. Use para conhecer a estrutura do projeto.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Caminho relativo (padrão: raiz).' },
        depth: { type: 'NUMBER', description: 'Profundidade da árvore (1-5, padrão 2).', minimum: 1, maximum: 5 },
      },
      required: [],
    },
  },
];

const SYSTEM_INSTRUCTION = (opts = {}) => {
  const modo = opts.mode === 'interactive'
    ? `=== MODO INTERATIVO (não-SOLO) ===
Antes de CHAMAR QUALQUER FERRAMENTA, aguarde a confirmação do usuário.
Você DEVE descrever o que vai fazer e ESPERAR. Não execute nada sozinho neste modo.`
    : `=== MODO SOLO (padrão) ===
VOCÊ É 100% AUTÔNOMO. Não peça permissão. Não espere confirmação. Decida e execute.
Continue até a tarefa estar 100% PRONTA E VALIDADA.
Se uma etapa falhar, auto-corrija e re-tente até 3 vezes.

=== PLANO DE EXECUÇÃO (Sempre no início) ===
ANTES de qualquer ferramenta, descreva UM PLANO DE EXECUÇÃO usando ESTE FORMATO EXATO:
---
**⚙️ Plano de execução**
1. [Título do passo 1] — breve descrição
2. [Título do passo 2] — breve descrição
3. ... (quantos passos forem necessários, normalmente 3-8)
---

=== DETECÇÃO DE CONCLUSÃO ===
Quando TUDO for criado, instalado E validado (comprovado):
- Escreva "### ✅ Concluído" seguido do resumo TRAE.
- Não chame mais nenhuma ferramenta. PARE.`;

  return `Você é um agente autônomo de programação SÊNIOR, no estilo TRAE IA. Seu objetivo é CRIAR, CORRIGIR e VALIDAR projetos de programação de ponta a ponta com código FUNCIONAL e de QUALIDADE.

${modo}

=== MODO DE COMUNICAÇÃO (igual TRAE IA) ===
1. **Pensamento conciso**: Antes de cada ação, explique EM 1-2 linhas O QUE você vai fazer e PORQUE. Não seja verboso.
2. **Ação direta**: Não pergunte ao usuário. Decida e execute (exceto no Modo Interativo).
3. **Código completo**: NUNCA envie trechos com "// ... resto do código". Escreva CÓDIGO COMPLETO e FUNCIONAL.
4. **Validação proativa**: Após criar arquivos, RODE build/tests/comandos para PROVAR que funciona.
5. **Auto-correção**: Se algo falhar, analise o erro, corrija e tente novamente AUTOMATICAMENTE.

=== ESTRATÉGIA DE TRABALHO ===
- **Passo 0 (explorar)**: Se não sabe a estrutura, use list_dir ou run_command("ls -la") ANTES de criar arquivos.
- **Passo 1 (planejar)**: Mencione brevemente os arquivos que vai criar.
- **Passo 2 (criar)**: Use write_file para criar TUDO (código completo).
- **Passo 3 (instalar)**: Use run_command para npm install / pip install etc.
- **Passo 4 (validar)**: Rode build, test, start, curl ou o que for necessário.
- **Passo 5 (resumo TRAE)**: No final, faça um resumo com:
  - ✅ Objetivo atingido
  - 📁 Arquivos criados (lista com caminhos)
  - 🚀 Comandos para rodar
  - 💡 Dicas de uso

=== REGRAS TÉCNICAS ===
- Diretório de trabalho: ${opts.projectDir || WORKSPACE_ROOT}
- Ferramentas: read_file, write_file, delete_file, run_command, list_dir
- Ao usar write_file: ENVIE SEMPRE O ARQUIVO COMPLETO. Use list_dir para ver o que já existe.
- Prefira Tailwind via CDN + HTML único para protótipos (isso entrega RÁPIDO e FUNCIONA).
- Não use placeholders, TODOs, "// implemente aqui".
- Linguagem: Português Brasileiro natural.

=== DICA DE VELOCIDADE ===
- Evite chamadas desnecessárias: se você SABE a estrutura, crie os arquivos diretamente em paralelo (várias chamadas de write_file numa resposta, quando possível).
- Quando for criar muitos arquivos, mencione primeiro "Vou criar X arquivos..." depois faça.

Diretório de trabalho atual: ${opts.projectDir || WORKSPACE_ROOT}.
Responda em português brasileiro.`;
};

const STATE_IDLE = 'idle';
const STATE_RUNNING = 'running';
const STATE_PAUSED = 'paused';
const STATE_STOPPED = 'stopped';

async function imageInlineData(filePath) {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
  const mime = mimeMap[ext] || 'image/jpeg';
  return { inlineData: { mimeType: mime, data: buf.toString('base64') } };
}

async function genAIStream(contents, system, onChunk, extra = {}) {
  const model = extra.model || GOOGLE_MODEL;
  const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}:streamGenerateContent?key=${GOOGLE_API_KEY}&alt=sse`;
  const body = {
    contents,
    systemInstruction: { parts: [{ text: system }] },
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    generationConfig: { temperature: 0.15, topP: 0.95, maxOutputTokens: 16384 },
  };
  if (extra.toolConfig) body.toolConfig = extra.toolConfig;

  let retries = 0;
  const maxRetries = 2;
  let lastErr = null;

  while (retries <= maxRetries) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        let json;
        try { json = JSON.parse(txt); } catch {}
        const msg = json?.error?.message || txt.slice(0, 500) || `HTTP ${res.status}`;
        if ((res.status === 429 || res.status >= 500) && retries < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * (retries + 1)));
          retries++;
          lastErr = msg;
          continue;
        }
        throw new Error(`API ${res.status}: ${msg}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let combinedTextParts = [];
      let combinedFuncCallParts = [];
      let usage = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || !line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let json;
          try { json = JSON.parse(data); } catch { continue; }
          const candidate = json?.candidates?.[0];
          if (!candidate?.content?.parts) continue;
          const parts = candidate.content.parts;
          combinedTextParts.push(...parts.filter(p => typeof p.text === 'string'));
          combinedFuncCallParts.push(...parts.filter(p => p.functionCall && typeof p.functionCall === 'object'));
          if (candidate.usageMetadata) usage = candidate.usageMetadata;
          try { onChunk({ parts, usage, done: false }); } catch {}
        }
      }
      try { onChunk({ done: true, usage }); } catch {}
      return {
        parts: [...combinedTextParts, ...combinedFuncCallParts],
        usage,
      };
    } catch (err) {
      if (retries < maxRetries && (err.name === 'AbortError' || /timeout|429|5\d{2}/i.test(err.message))) {
        await new Promise(r => setTimeout(r, 1500 * (retries + 1)));
        retries++;
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Falha na API');
}

// ===== ENSEMBLE GRATUITO · 2x Gemini (Paralelo · Voto Majoritário) =====
function pickWinningToolCall(listA, listB) {
  const a = Array.isArray(listA) ? listA : [];
  const b = Array.isArray(listB) ? listB : [];
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const keyOf = (fc) => `${fc.functionCall?.name || ''}::${(fc.functionCall?.args?.path || '')}`;
  const consensus = [];
  for (const fca of a) {
    const matchB = b.find(fcb => keyOf(fca) === keyOf(fcb));
    if (matchB) consensus.push(fca);
  }
  if (consensus.length > 0) return consensus;
  const score = (list) => list.filter(fc => /write_file|delete_file|run_command/i.test(fc.functionCall?.name || '')).length;
  return score(a) >= score(b) ? a : b;
}

async function callEnsembleOrSingle(session, contents, system, onChunk, extra = {}) {
  const wantEnsemble = typeof session.ensemble === 'boolean' ? session.ensemble : ENSEMBLE_ENABLED;
  const enabled = wantEnsemble && ensembleIsEnabled();
  if (!enabled) return await genAIStream(contents, system, onChunk, extra);

  const head1Msg = (p) => onChunk && onChunk({ _provider: 'gemini-a', ...p });
  const head2Msg = (p) => onChunk && onChunk({ _provider: 'gemini-b', ...p });
  let out1 = null, out2 = null, err1 = null, err2 = null;
  const extraA = { ...extra, model: FREE_MODEL_A };
  const extraB = { ...extra, model: FREE_MODEL_B };
  await Promise.allSettled([
    genAIStream(contents, system, head1Msg, extraA).then(r => (out1 = r)).catch(e => { err1 = e; }),
    genAIStream(contents, system, head2Msg, extraB).then(r => (out2 = r)).catch(e => { err2 = e; }),
  ]);
  if (!out1 && !out2) {
    throw new Error('Ensemble: ambas IAs falharam. ' + (err1?.message || '') + ' | ' + (err2?.message || ''));
  }
  if (!out1) return out2;
  if (!out2) return out1;
  const text1 = out1.parts.filter(p => typeof p.text === 'string').map(p => p.text).join('\n\n').trim();
  const text2 = out2.parts.filter(p => typeof p.text === 'string').map(p => p.text).join('\n\n').trim();
  const fc1 = out1.parts.filter(p => p.functionCall && typeof p.functionCall === 'object');
  const fc2 = out2.parts.filter(p => p.functionCall && typeof p.functionCall === 'object');
  const mergedText = [];
  if (text1) mergedText.push({ text: `## Cabeça A · ${FREE_MODEL_A}\n${text1}` });
  if (text2) mergedText.push({ text: `## Cabeça B · ${FREE_MODEL_B}\n${text2}` });
  const winningTools = pickWinningToolCall(fc1, fc2);
  try { onChunk && onChunk({ done: true, usage: { providers: ['gemini-a', 'gemini-b'] } }); } catch {}
  return {
    parts: [...mergedText, ...winningTools],
    usage: { providers: ['gemini-a', 'gemini-b'], modelA: out1.usage, modelB: out2.usage },
    _ensemble: true,
    _toolsConsensus: winningTools.length > 0 && (winningTools.length === fc1.length || winningTools.length === fc2.length),
  };
}

function fileToPart(file) {
  return imageInlineData(file.path).then(img => ({
    image: { inlineData: img.inlineData, filename: file.originalname, url: `/uploads/${file.filename}` },
    part: img,
  }));
}

const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      id,
      createdAt: Date.now(),
      lastActive: Date.now(),
      history: [],
      contents: [],
      mode: 'solo',
      model: GOOGLE_MODEL,
      project: DEFAULT_PROJECT,
      state: STATE_IDLE,
      abortRequested: false,
      pauseRequested: false,
      pauseResolver: null,
      ensemble: ENSEMBLE_ENABLED,
    });
  }
  sessions.get(id).lastActive = Date.now();
  return sessions.get(id);
}

function emit(ws, type, data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, data, ts: Date.now() }));
}

function setState(ws, session, state, extra = {}) {
  session.state = state;
  emit(ws, 'agent:state', Object.assign({ state, mode: session.mode, model: session.model, project: session.project || DEFAULT_PROJECT }, extra));
}

// ===== Static preview server separado POR PROJETO =====
async function startProjectPreviewServer(slug) {
  if (!slug) return null;
  // RC20 RENDER/Linux headless: NÃO cria servidor em outra porta (Render só libera 1 porta).
  // Previews são servidos na MESMA porta via rota /preview/:slug/* injetada no app express principal.
  if (IS_RENDER_OR_HEADLESS_LINUX) {
    const projectDir = resolveWritableProjectDir(slug);
    const previewUrl = RENDER_BASE_URL
      ? `${RENDER_BASE_URL}/preview/${encodeURIComponent(slug)}/`
      : `/preview/${encodeURIComponent(slug)}/`;
    return {
      port: null,
      running: true,
      alreadyRunning: projectServers.has(slug) || true,
      singlePortMode: true,
      url: previewUrl,
      path: projectDir,
    };
  }
  if (projectServers.has(slug) && projectPorts.has(slug)) {
    return { port: projectPorts.get(slug), running: true, alreadyRunning: true };
  }
  // IMPORTANTE: serve da pasta GRAVÁVEL (fallback interno se macOS bloqueou), pois os arquivos atuais estão lá
  const projectDir = resolveWritableProjectDir(slug);
  const port = await getPortForProject(slug);
  if (projectServers.has(slug)) {
    try { projectServers.get(slug).close(); } catch {}
    projectServers.delete(slug);
  }
  const app2 = express();
  app2.use(cors());
  app2.get('/', (req, res, next) => {
    const idx = path.join(projectDir, 'index.html');
    if (fsc.existsSync(idx)) return res.redirect('/index.html');
    next();
  });
  app2.use(express.static(projectDir, {
    index: ['index.html', 'index.htm'],
    setHeaders: (res, fPath) => setStaticPreviewHeaders(res, fPath),
    extensions: ['html', 'htm'],
  }));
  app2.use((req, res) => res.status(404).type('txt').send('404 — Página não existe neste projeto.'));
  const server = http.createServer(app2);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  server.unref();
  projectServers.set(slug, server);
  return { port, running: true, alreadyRunning: false, url: `http://127.0.0.1:${port}/`, path: projectDir };
}
async function stopProjectPreviewServer(slug) {
  if (!slug) return;
  if (projectServers.has(slug)) {
    try { projectServers.get(slug).close(); } catch {}
    projectServers.delete(slug);
  }
}
async function listProjects() {
  const map = new Map(); // slug -> projeto (mounted=true tem prioridade sobre workspace interno, evita duplicado mesmo slug)
  // 1) Workspace projetos (internos) — primeiro, se depois houver mounted=true ele SOBRESCREVE
  try {
    const entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      try {
        const full = path.join(WORKSPACE_ROOT, e.name);
        const st = await fs.stat(full);
        const port = projectPorts.get(e.name) || null;
        if (map.has(e.name)) continue; // mounted=true já entrou antes? pula
        let previewUrl = null;
        if (IS_RENDER_OR_HEADLESS_LINUX) {
          previewUrl = RENDER_BASE_URL
            ? `${RENDER_BASE_URL}/preview/${encodeURIComponent(e.name)}/`
            : `/preview/${encodeURIComponent(e.name)}/`;
        } else {
          previewUrl = port ? `http://127.0.0.1:${port}/` : null;
        }
        map.set(e.name, {
          name: e.name,
          displayName: e.name,
          mounted: false,
          path: full,
          port: IS_RENDER_OR_HEADLESS_LINUX ? null : port,
          previewUrl,
          createdAt: st.birthtimeMs || st.ctimeMs,
          modifiedAt: st.mtimeMs,
        });
      } catch {}
    }
  } catch {}
  // 2) Mounted projetos (pastas externas Desktop/Mac) — SEMPRE SOBRESCREVE workspace interno (prioridade visual)
  for (const m of mountedProjects.values()) {
    try {
      const st = await fs.stat(m.path).catch(() => null);
      const modifiedAt = st ? (st.mtimeMs || m.modifiedAt) : (m.modifiedAt || Date.now());
      const port = projectPorts.get(m.slug) || null;
      let previewUrl = null;
      if (IS_RENDER_OR_HEADLESS_LINUX) {
        previewUrl = RENDER_BASE_URL
          ? `${RENDER_BASE_URL}/preview/${encodeURIComponent(m.slug)}/`
          : `/preview/${encodeURIComponent(m.slug)}/`;
      } else {
        previewUrl = port ? `http://127.0.0.1:${port}/` : null;
      }
      map.set(m.slug, {
        name: m.slug,
        displayName: m.displayName || m.slug,
        mounted: true,
        path: m.path,
        fallbackInternal: !!m.fallbackInternal,
        port: IS_RENDER_OR_HEADLESS_LINUX ? null : port,
        previewUrl,
        createdAt: m.createdAt || Date.now(),
        modifiedAt,
      });
    } catch {}
  }
  const list = Array.from(map.values());
  list.sort((a, b) => {
    if (a.name === DEFAULT_PROJECT) return -1;
    if (b.name === DEFAULT_PROJECT) return 1;
    return (b.modifiedAt || 0) - (a.modifiedAt || 0);
  });
  return list;
}

async function waitIfPaused(session) {
  if (session.pauseRequested) {
    await new Promise((resolve) => { session.pauseResolver = resolve; });
    session.pauseRequested = false;
    session.pauseResolver = null;
  }
}

function parsePlanFromText(text) {
  try {
    if (!text) return null;
    const headerRe = /\*\*⚙️?\s*Plano de execução\*\*/i;
    const headerIdx = text.search(headerRe);
    if (headerIdx === -1) return null;
    const slice = text.slice(headerIdx);
    const endMatch = slice.match(/^---$\s*?/m) || slice.match(/\n{2,}(?=\s*### |\s*## ✅|\s*Concluído|$)/) || { index: Math.min(slice.length, 2500), 0: '' };
    const endIdx = typeof endMatch.index === 'number' ? endMatch.index : Math.min(slice.length, 2500);
    const block = slice.slice(0, endIdx);
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const steps = [];
    const SEEN = new Set();
    for (const l of lines) {
      const m = l.match(/^\s*(\d+)\.\s*(?:\[([^\]]{1,120})\]|([^—\n]{1,120}?))(?:\s*—\s*(.{0,200}))?$/);
      if (!m) continue;
      const num = parseInt(m[1], 10);
      if (!num || num <= 0 || num > 20) continue;
      if (SEEN.has(num)) continue;
      let title = (m[2] || m[3] || '').trim();
      const desc = (m[4] || title || '').trim();
      if (!title) continue;
      title = title.replace(/\.$/, '').trim();
      if (title.length < 4) continue;
      if (title.length > 140) continue;
      if (/[?？]/.test(title)) continue;
      if (/^(basta|abra|como|faq|rodapé|depoimentos|observação|observacoes|nota|atenção|importante)/i.test(title)) continue;
      SEEN.add(num);
      steps.push({ index: num, title, desc });
    }
    steps.sort((a, b) => a.index - b.index);
    if (steps.length === 0) return null;
    if (steps.length > 12) return steps.slice(0, 12);
    return steps;
  } catch {
    return null;
  }
}

// RC10 FIX A: Garante contents sempre terminem com user/turn NÃO VAZIO (nunca model)
// Remove turnos "mortos" model→user[] que causam erro 400 "Requests ending with a model turn are not supported"
function sanitizeContentsBeforeSend(arr, ctx = '') {
  if (!Array.isArray(arr)) return [];
  let pass1 = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item !== 'object') continue;
    if (item.role === 'user' && Array.isArray(item.parts) && item.parts.length === 0) {
      if (pass1.length && pass1[pass1.length-1].role === 'model') pass1.pop();
      continue;
    }
    if (item.role === 'model' && Array.isArray(item.parts) && item.parts.length === 0) continue;
    pass1.push({ ...item, parts: Array.isArray(item.parts) ? item.parts.filter(Boolean) : [] });
  }
  let result = pass1;
  while (result.length && result[result.length-1].role !== 'user') result.pop();
  if (result.length === 0 || !result[result.length-1] || result[result.length-1].role !== 'user') {
    result.push({ role: 'user', parts: [{ text: 'Continue usando as tools.' }] });
  }
  const lastUser = result[result.length-1];
  if (!Array.isArray(lastUser.parts) || lastUser.parts.length === 0) {
    lastUser.parts = [{ text: 'Continue.' }];
  }
  if (process.env.DEBUG_CONTENTS === '1') {
    const trace = result.map(x => `${x.role}(${Array.isArray(x.parts)?x.parts.length:0})`).join(' → ');
    console.log(`[RC10] sanitize (${ctx}): ${trace}`);
  }
  return result;
}

async function runAgentLoop(ws, session, userParts) {
  // ===================== RACE FIX: ABORTA execução anterior =====================
  if (session.state === STATE_RUNNING) {
    try {
      session.abortRequested = true;
      if (typeof session.pauseResolver === 'function') {
        try { session.pauseResolver(); } catch {}
      }
      session.pauseRequested = false;
      setState(ws, session, STATE_STOPPED, { reason: 'new_run_abort_old' });
      emit(ws, 'agent:done', { reason: 'new_run_abort_old' });
    } catch {}
    await new Promise(r => setTimeout(r, 300));
    session.abortRequested = false;
    session.pauseRequested = false;
    session.pauseResolver = null;
  }
  // =============================================================================

  const mode = session.mode || 'solo';
  const projectDir = projectDirOf(session);
  const system = SYSTEM_INSTRUCTION({ mode, projectDir, project: session.project || DEFAULT_PROJECT });
  const contents = session.contents;
  let finishedClean = false;
  let stoppedReason = null;

  try {
    session.abortRequested = false;
    session.pauseRequested = false;
    session.pauseResolver = null;
    setState(ws, session, STATE_RUNNING);

    contents.push({ role: 'user', parts: userParts });
    emit(ws, 'message:user', { id: 'u_' + Date.now(), parts: userParts });

    let planSteps = null;
    let planCompleted = 0;
    let planEmitted = false;
    let forceLoopFollowUpCount = 0;
    let lastPlanParsedFromText = ''; // RC10: evita duplo agent:plan de plano igual

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (session.abortRequested) {
        stoppedReason = 'aborted';
        break;
      }
      await waitIfPaused(session);
      if (session.abortRequested) { stoppedReason = 'aborted'; break; }

      const pCurr = planSteps ? Math.min(planCompleted + 1, planSteps.length) : step;
      const pMax  = planSteps ? planSteps.length : MAX_STEPS;
      emit(ws, 'agent:step', { step: pCurr, max: pMax, planTotal: planSteps?.length || 0, planDone: planCompleted });

      let streamResult;
      const msgId = 'a_' + Date.now() + '_' + step;
      let currentText = '';
      let lastFlush = 0;
      const FLUSH_MS = 20;

      // RC10 FIX B: genAIStream com contents sanitizados + retry do erro 400 model-turn
      // RC14 ENSEMBLE: callEnsembleOrSingle(session, ...) usa 1 cabeça ou 2 cabeças paralelo
      let attempt = 0;
      while (attempt < 2) {
        attempt++;
        const toSend = sanitizeContentsBeforeSend(contents.slice(), `step${step}try${attempt}`);
        try {
          streamResult = await callEnsembleOrSingle(session, toSend, system, (chunk) => {
            if (chunk.done) {
              if (currentText.length) {
                emit(ws, 'message:ai:delta', { id: msgId, text: currentText, done: true, usage: chunk.usage });
              }
              return;
            }
            const txtParts = (chunk.parts || []).filter(p => typeof p.text === 'string');
            for (const p of txtParts) currentText += p.text;
            if (!planEmitted) {
              const found = parsePlanFromText(currentText);
              if (found) {
                const sig = found.map(s => String(s.index)+'|'+s.title).join('||');
                if (sig !== lastPlanParsedFromText) {
                  lastPlanParsedFromText = sig;
                  planSteps = found;
                  planEmitted = true;
                  emit(ws, 'agent:plan', { steps: planSteps, mode });
                  emit(ws, 'agent:progress', { current: 0, total: planSteps.length });
                } else {
                  planSteps = found;
                  planEmitted = true;
                }
              }
            }
            const now = Date.now();
            if (now - lastFlush >= FLUSH_MS && currentText.length) {
              lastFlush = now;
              emit(ws, 'message:ai:delta', { id: msgId, text: currentText, done: false });
            }
          }, { model: session.model });
          break; // sucesso
        } catch (err) {
          const errMsg = err && err.message ? String(err.message) : '';
          const isModelTurn400 = /400[\s\S]{0,80}ending with a model turn/i.test(errMsg);
          const is429 = /429|quota|rate.?limit/i.test(errMsg);
          if (isModelTurn400 && attempt < 2) {
            // Auto-fix: dropar ultimo turno model e garantir user com texto no final
            while (contents.length && contents[contents.length-1].role !== 'user') contents.pop();
            if (!contents.length || contents[contents.length-1].role !== 'user') {
              contents.push({ role:'user', parts:[{ text:'Prossiga usando tools.' }]});
            } else {
              const lu = contents[contents.length-1];
              if (!Array.isArray(lu.parts) || lu.parts.length === 0) {
                lu.parts = [{ text:'Prossiga usando tools.' }];
              } else {
                lu.parts.push({ text:' Continue usando as tools, não pare.' });
              }
            }
            console.log(`[RC10] retry model-turn 400 step=${step}. contents.length=${contents.length}. lastRole=${contents[contents.length-1].role}`);
            continue;
          }
          const friendly = is429
            ? `API 429: Você excedeu sua cota atual da Google. Verifique seu plano e detalhes de cobrança em ai.google.dev/gemini-api/docs/rate-limits. Tente novamente em 1 minuto.`
            : `Erro na IA (${errMsg.slice(0, 180)}). Tente novamente em 1 minuto.`;
          emit(ws, 'error', { message: friendly });
          stoppedReason = 'api_error';
          streamResult = null;
          break;
        }
      }
      if (stoppedReason === 'api_error' || !streamResult) break;

      if (currentText.length) {
        emit(ws, 'message:ai:delta', { id: msgId, text: currentText, done: true, usage: streamResult?.usage });
      }
      if (!planEmitted) {
        const found = parsePlanFromText(currentText);
        if (found) {
          const sig = found.map(s => String(s.index)+'|'+s.title).join('||');
          if (sig !== lastPlanParsedFromText) {
            lastPlanParsedFromText = sig;
            planSteps = found;
            planEmitted = true;
            emit(ws, 'agent:plan', { steps: planSteps, mode });
            emit(ws, 'agent:progress', { current: 0, total: planSteps.length });
          } else {
            planSteps = found;
            planEmitted = true;
          }
        }
      }

      const parts = streamResult?.parts || [];
      const funcCallParts = parts.filter(p => p.functionCall && typeof p.functionCall === 'object');
      if (funcCallParts.length === 0) {
        const hasFinalBlock = /\n###\s*✅\s*Concluído[\s\S]*$/i.test(currentText) || /\n#{1,4}\s*Concluído(?:\s|$)/i.test(currentText) || currentText.trim().endsWith('Concluído');
        const planFinished = !planSteps || planCompleted >= planSteps.length;
        if (hasFinalBlock && planFinished) {
          const currDone = planSteps ? planSteps.length : planCompleted || step;
          emit(ws, 'agent:progress', { current: currDone, total: currDone });
          finishedClean = true;
          stoppedReason = 'finished';
          break;
        }
        if (planSteps && planCompleted < planSteps.length && forceLoopFollowUpCount < 2) {
          forceLoopFollowUpCount++;
          const remaining = planSteps.slice(planCompleted);
          const reminder = remaining.slice(0, Math.min(3, remaining.length)).map((s, i) => `${i+1}. ${s.title}`).join('; ');
          const followUp = { role: 'user', parts: [{ text: `⚠️ CONTINUE O TRABALHO. Você listou um plano mas ainda faltam ${Math.max(1, planSteps.length - planCompleted)} passos. Próximos passos pendentes: ${reminder}. Use as tools declaradas. NÃO escreva apenas texto. NÃO marque como concluído. Execute write_file/run_command etc. AGORA:` }] };
          contents.push(followUp);
          emit(ws, 'message:ai:delta', { id: msgId + '_followup_' + forceLoopFollowUpCount, text: `\n\n⏩ Plano não concluído, forçando continuação… (passos pendentes: ${Math.max(1, planSteps.length - planCompleted)})\n`, done: true });
          emit(ws, 'agent:step', { step: Math.min(planCompleted + 1, planSteps.length), max: planSteps.length, planTotal: planSteps.length, planDone: planCompleted });
          // RC10 FIX C: SEM TOOLS → NÃO push model→user[] mortos. Continue direto.
          continue;
        }
        if (planFinished) {
          const currDone = planSteps ? planSteps.length : planCompleted || step;
          emit(ws, 'agent:progress', { current: currDone, total: currDone });
          finishedClean = true;
          stoppedReason = 'finished';
          break;
        }
        // RC10 FIX D: Sem tools + plano nao concluido + forceLoop excedido → push user obrigatório NÃO VAZIO e continue SEM criar turnos mortos.
        if (forceLoopFollowUpCount >= 2 && !planFinished) {
          contents.push({ role: 'user', parts: [{ text: `Use obrigatoriamente uma ferramenta agora (write_file / run_command / read_file) para avançar o trabalho. NÃO responda apenas com texto. Execute uma ação.` }] });
          continue;
        }
      }

      if (mode === 'interactive') {
        session.pauseRequested = true;
        emit(ws, 'agent:awaitConfirm', {
          step: pCurr,
          calls: funcCallParts.map(f => ({
            id: f.functionCall?.id,
            name: f.functionCall?.name,
            args: f.functionCall?.args || {},
          })),
        });
        setState(ws, session, STATE_PAUSED, { reason: 'awaiting_confirm' });
        await waitIfPaused(session);
        if (session.abortRequested) { stoppedReason = 'aborted'; break; }
        setState(ws, session, STATE_RUNNING);
      }

      // RC10 FIX E: SÓ adicionar turno model/responseParts SE HOUVER tools reais.
      const hasRealTools = funcCallParts.length > 0;
      if (hasRealTools) contents.push({ role: 'model', parts });

      const sessionTools = makeSessionTools(session, ws);
      const responseParts = [];
      let anyDone = false;
      const funcTotal = funcCallParts.length;
      for (let i = 0; i < funcCallParts.length; i++) {
        if (session.abortRequested) break;
        await waitIfPaused(session);
        if (session.abortRequested) break;

        const p = funcCallParts[i];
        const call = p.functionCall;
        const name = call.name;
        const args = call.args || {};
        const toolId = 't_' + (call.id || crypto.randomBytes(5).toString('hex'));

        emit(ws, 'tool:call', { id: toolId, name, args, pending: true, project: session.project || DEFAULT_PROJECT });

        const toolFn = sessionTools[name];
        let result;
        if (!toolFn) {
          result = { ok: false, error: `Ferramenta desconhecida: ${name}` };
        } else {
          try {
            result = await toolFn(args);
          } catch (err) {
            result = { ok: false, error: err.message || 'Erro interno' };
          }
        }

        emit(ws, 'tool:result', {
          id: toolId,
          name,
          args,
          pending: false,
          ok: result.ok,
          error: result.error || null,
          result,
          project: session.project || DEFAULT_PROJECT,
        });

        if (result.ok && name === 'write_file') {
          emit(ws, 'file:changed', { path: args.path, action: result.action, size: result.size, url: result.url, project: session.project || DEFAULT_PROJECT });
        }
        if (result.ok && name === 'delete_file') {
          emit(ws, 'file:changed', { path: args.path, action: 'deleted', project: session.project || DEFAULT_PROJECT });
        }

        responseParts.push({ functionResponse: { name, id: call.id, response: result } });
        anyDone = true;

        if (result.ok && planSteps && planCompleted < planSteps.length) {
          planCompleted++;
          emit(ws, 'agent:progress', { current: planCompleted, total: planSteps.length });
        } else if (result.ok && !planSteps) {
          planCompleted++;
          emit(ws, 'agent:progress', { current: planCompleted, total: Math.max(planCompleted, funcTotal) });
        }
      }
      if (anyDone && planSteps && planCompleted < planSteps.length) {
        planCompleted++;
        emit(ws, 'agent:progress', { current: planCompleted, total: planSteps.length });
      }

      emit(ws, 'file:tree:refresh', {});
      // RC10 FIX F: SÓ push user functionResponses SE realmente teve tools e resposta não-vazia.
      if (hasRealTools && responseParts.length > 0) {
        contents.push({ role: 'user', parts: responseParts });
      }

      if (session.abortRequested) { stoppedReason = 'aborted'; break; }
    }

    // =================== Fim do for loop (max steps) =========================
    if (!finishedClean && !stoppedReason) {
      stoppedReason = 'max_steps';
    }
  } catch (errOuter) {
    // ============= CATCH OUTER: NUNCA deixar o front sem agent:done ===========
    try {
      // Apenas emit error — o front case 'error' já cria addAIMessage ❌ sozinho, evita duplicação
      const msg = errOuter && errOuter.message ? String(errOuter.message) : 'erro inesperado';
      emit(ws, 'error', { message: `Erro interno no agente: ${msg.slice(0, 220)}` });
    } catch {}
    stoppedReason = stoppedReason || 'internal_error';
  } finally {
    // ========================= FINALLY — SEMPRE envia agent:done ===============
    try {
      if (stoppedReason === 'finished' || finishedClean) {
        setState(ws, session, STATE_IDLE, { reason: stoppedReason || 'finished' });
      } else if (stoppedReason === 'aborted' || stoppedReason === 'new_run_abort_old') {
        setState(ws, session, STATE_STOPPED, { reason: stoppedReason });
      } else {
        setState(ws, session, STATE_STOPPED, { reason: stoppedReason || 'error' });
      }
      emit(ws, 'agent:done', { reason: stoppedReason || 'finished' });
    } catch {}
    session.abortRequested = false;
    session.pauseRequested = false;
    session.pauseResolver = null;
  }
  // ============================================================================
}

/* ===== REST API ===== */
app.get('/api/status', (req, res) => {
  res.json({
    ok: Boolean(GOOGLE_API_KEY),
    model: GOOGLE_MODEL,
    workspaceRoot: WORKSPACE_ROOT,
    defaultProject: DEFAULT_PROJECT,
    sessions: sessions.size,
    maxSteps: MAX_STEPS,
    googleKeyOk: GOOGLE_KEY_OK,
    googleKeyPrefix: GOOGLE_API_KEY ? (GOOGLE_API_KEY.slice(0, 5) + '…' + GOOGLE_API_KEY.slice(-4)) : null,
    render: IS_RENDER_OR_HEADLESS_LINUX,
    renderBaseUrl: RENDER_BASE_URL || null,
    platform: process.platform,
    previewMode: IS_RENDER_OR_HEADLESS_LINUX ? 'single-port (/preview/:slug/)' : 'multi-port (3001..4100)',
    ensemble: {
      available: ensembleIsEnabled(),
      mode: ENSEMBLE_MODE,
      modelA: FREE_MODEL_A,
      modelB: FREE_MODEL_B,
      freeTier: true,
      hasGoogleKey: Boolean(GOOGLE_API_KEY),
    },
  });
});

app.get('/api/projects', async (req, res) => {
  const projects = await listProjects();
  res.json({ ok: true, projects });
});

app.post('/api/projects', async (req, res) => {
  const rawName = String(req.body?.name || '').trim();
  if (!rawName) return res.status(400).json({ ok: false, error: 'Nome do projeto é obrigatório' });
  let name = rawName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  if (!name) name = 'projeto-' + Date.now().toString(36);
  const finalName = name.toLowerCase();
  const dir = resolveProjectDir(finalName);
  await fs.mkdir(dir, { recursive: true });
  const marker = path.join(dir, '.project');
  await fs.writeFile(marker, `# ${finalName}\nCriado em ${new Date().toISOString()}\n`, 'utf8').catch(() => {});
  const prev = await startProjectPreviewServer(finalName);
  const projects = await listProjects();
  res.json({ ok: true, project: finalName, projects, port: prev?.port || null, previewUrl: prev?.url || null });
});

app.get('/api/picker/folder', async (req, res) => {
  try {
    const isMac = process.platform === 'darwin';
    if (!isMac || IS_RENDER_OR_HEADLESS_LINUX) {
      return res.status(501).json({
        ok: false,
        error: IS_RENDER_OR_HEADLESS_LINUX
          ? 'Picker de pasta indisponível em nuvem (Render/Linux headless). Use a criação de projetos ou a pasta workspace padrão.'
          : 'Picker de pasta nativo disponível apenas no macOS desktop.',
      });
    }
    const script = `
      set chosenFolder to choose folder with prompt "Selecione a pasta do seu projeto (Desktop, Downloads, etc)" default location (path to desktop folder)
      set posixPath to POSIX path of chosenFolder
      return posixPath
    `;
    const { stdout, stderr } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\\\''")}'`, { timeout: 120000 });
    const folderPath = (stdout || '').toString().trim().replace(/\r?\n$/, '');
    if (!folderPath) {
      return res.json({ ok: false, canceled: true, error: 'Nenhuma pasta selecionada' });
    }
    let displayName = path.basename(folderPath);
    try { await fs.access(folderPath); }
    catch { return res.status(400).json({ ok: false, error: 'Pasta inacessível: ' + folderPath }); }
    const st = await fs.stat(folderPath);
    if (!st.isDirectory()) return res.status(400).json({ ok: false, error: 'Não é uma pasta válida' });
    res.json({ ok: true, folderPath, displayName, canceled: false });
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    if (msg.includes('(-128)') || msg.includes('User canceled') || err.code === 1 || (msg.includes('osascript') && msg.includes('299'))) {
      return res.json({ ok: false, canceled: true, error: 'Cancelado pelo usuário' });
    }
    res.status(500).json({ ok: false, error: msg || err.message || 'Erro ao abrir picker' });
  }
});

// Testa se a pasta do usuário é GRAVÁVEL (macOS TCC Desktop/Documents bloqueia frequentemente)
async function testWritable(folderPath) {
  try {
    if (!folderPath || !fsc.existsSync(folderPath)) return { writable: false, reason: 'not_exists' };
    const name = `.write_test_${process.pid}_${Date.now().toString(36)}.tmp`;
    const full = path.join(folderPath, name);
    await fs.writeFile(full, 'write-test', 'utf8');
    try { await fs.unlink(full).catch(() => {}); } catch {}
    return { writable: true };
  } catch (err) {
    return { writable: false, reason: err?.code || 'error', message: err?.message || String(err) };
  }
}

app.post('/api/projects/mount', async (req, res) => {
  const folderPath = String(req.body?.folderPath || '').trim();
  const displayName = req.body?.displayName ? String(req.body.displayName).trim() : null;
  if (!folderPath) return res.status(400).json({ ok: false, error: 'Caminho da pasta é obrigatório' });
  try {
    const record = await mountProject(folderPath, displayName);
    // Teste de escrita: macOS TCC bloqueia frequentemente pastas Desktop/Documents
    const wtest = await testWritable(record.path);
    let warn = null;
    if (!wtest.writable) {
      // Marca fallback interno ANTES de iniciar preview e criação de arquivos
      const slug = record.slug;
      const m = mountedProjects.get(slug);
      if (m) { m.fallbackInternal = true; await saveMounted(); }
      // Garante pasta workspace interna
      const fbDir = resolveWritableProjectDir(slug);
      if (!fsc.existsSync(fbDir)) fsc.mkdirSync(fbDir, { recursive: true });
      warn = (
        `⚠️ Permissão bloqueada pelo macOS (${wtest.reason}).\n` +
        `A pasta "${record.displayName}" na Área de Trabalho / Documents / Downloads bloqueou escrita.\n` +
        `Não se preocupe: os arquivos serão criados DENTRO da minha pasta interna ` +
        `em "criador/workspace/${slug}/". O preview vai funcionar normalmente. ` +
        `Depois você pode mover os arquivos manualmente se quiser.`
      );
    }
    // Garante projeto (pastas + marker) antes do preview
    await ensureProject(record.slug);
    // Reinicia servidor preview se já estava rodando (antes servia pasta externa, agora pode ser fallback)
    if (projectServers.has(record.slug)) {
      try { projectServers.get(record.slug).close(); } catch {}
      projectServers.delete(record.slug);
    }
    const prev = await startProjectPreviewServer(record.slug);
    const projects = await listProjects();
    const m = mountedProjects.get(record.slug) || record;
    res.json({
      ok: true,
      project: record.slug,
      projects,
      port: prev?.port || null,
      previewUrl: prev?.url || null,
      mounted: { ...m, fallbackInternal: !!m.fallbackInternal },
      writable: wtest.writable,
      writableReason: wtest.reason || null,
      warn,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/projects/:slug/preview/start', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug) return res.status(400).json({ ok: false, error: 'Slug é obrigatório' });
    await ensureProject(slug);
    const result = await startProjectPreviewServer(slug);
    res.json({ ok: true, port: result?.port || null, url: result?.url || null, alreadyRunning: !!result?.alreadyRunning });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/projects/:slug/preview/stop', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    await stopProjectPreviewServer(slug);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function restProjectSession(projectName) {
  const name = (projectName || DEFAULT_PROJECT).toString();
  return { project: name, model: GOOGLE_MODEL, mode: 'solo', state: 'idle' };
}

app.get('/api/files', async (req, res) => {
  const p = req.query.project || req.body?.project || DEFAULT_PROJECT;
  const sess = restProjectSession(p);
  const r = await toolListDir(sess, { path: req.query.path || '.', depth: Math.min(5, parseInt(req.query.depth || '3', 10)) });
  res.json(r);
});

app.get('/api/files/read', async (req, res) => {
  const sess = restProjectSession(req.query.project);
  const r = await toolReadFile(sess, { path: req.query.path });
  res.json(r);
});

app.post('/api/files/write', async (req, res) => {
  const sess = restProjectSession(req.body?.project);
  const r = await writeFileWithAutoFallback(sess, { path: req.body?.path, content: req.body?.content ?? '' });
  res.json(r);
});

app.delete('/api/files', async (req, res) => {
  const sess = restProjectSession(req.body?.project);
  const r = await deleteFileWithAutoFallback(sess, { path: req.body?.path, recursive: req.body?.recursive });
  res.json(r);
});

app.post('/api/exec', async (req, res) => {
  const sess = restProjectSession(req.body?.project);
  const r = await toolRunCommand(sess, { command: req.body?.command, timeout_sec: req.body?.timeout_sec, cwd: req.body?.cwd });
  res.json(r);
});

app.get('/api/sessions', (req, res) => {
  const arr = [...sessions.values()].map(s => ({
    id: s.id,
    createdAt: s.createdAt,
    lastActive: s.lastActive,
    messages: s.contents?.length || 0,
  }));
  res.json(arr);
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
    res.json({
      ok: true,
      filename: req.file.filename,
      originalname: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===== WEBSOCKET ===== */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let sessionId = null;
  // Último projeto pedido nesta conexão WS — usado se a sessão nova for criada logo após project:switch
  let lastRequestedProject = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    if (msg.type === 'project:switch') {
      // Captura projeto requisitado ANTES da sessao existir (caso cliente envie project:switch antes de session:new/resume)
      const cleanName = String(msg.project || DEFAULT_PROJECT).trim();
      if (cleanName) lastRequestedProject = await ensureProject(cleanName);
    }

    if (msg.type === 'session:new') {
      // Se veio parametro project explicito, usa ele. Senao usa o ultimo project:switch da conexao.
      let initialProject = null;
      if (msg.project && typeof msg.project === 'string') {
        initialProject = String(msg.project).trim();
      }
      if (!initialProject) initialProject = lastRequestedProject || null;
      if (!initialProject) initialProject = DEFAULT_PROJECT;
      initialProject = await ensureProject(initialProject);
      sessionId = crypto.randomBytes(6).toString('hex');
      const sess = getSession(sessionId);
      sess.project = initialProject;
      lastRequestedProject = initialProject;
      emit(ws, 'session:ready', { id: sessionId, project: sess.project });
      return;
    }

    if (msg.type === 'session:resume') {
      const sid = typeof msg.sessionId === 'string' ? msg.sessionId : null;
      let initialProject = null;
      if (msg.project && typeof msg.project === 'string') initialProject = String(msg.project).trim();
      if (!initialProject) initialProject = lastRequestedProject || null;
      initialProject = initialProject ? await ensureProject(initialProject) : null;
      let sess;
      if (sid && sessions.has(sid)) {
        sess = getSession(sid);
      } else {
        // Fallback: sessao pedida nao existe no server (reiniciou?), cria nova com initialProject/default
        sessionId = crypto.randomBytes(6).toString('hex');
        sess = getSession(sessionId);
      }
      sessionId = sess.id;
      if (initialProject) sess.project = initialProject;
      if (!sess.project) sess.project = DEFAULT_PROJECT;
      lastRequestedProject = sess.project;
      emit(ws, 'session:ready', { id: sessionId, project: sess.project, resumed: sid ? sessions.has(sid || '') : false });
      return;
    }

    if (!sessionId) {
      emit(ws, 'error', { message: 'Sessão não iniciada' });
      return;
    }

    const session = getSession(sessionId);

    if (msg.type === 'project:list') {
      const projects = await listProjects();
      emit(ws, 'project:list', { projects, active: session.project || DEFAULT_PROJECT });
      return;
    }
    if (msg.type === 'project:switch') {
      const name = String(msg.project || DEFAULT_PROJECT).trim();
      if (!name) return;
      const finalName = await ensureProject(name);
      session.project = finalName;
      session.lastActive = Date.now();
      const prevInfo = await startProjectPreviewServer(finalName);
      const projects = await listProjects();
      setState(ws, session, session.state);
      emit(ws, 'project:switched', {
        project: finalName,
        projects,
        port: prevInfo?.port || null,
        previewUrl: prevInfo?.url || null,
      });
      emit(ws, 'file:tree:refresh', { project: finalName });
      return;
    }
    if (msg.type === 'project:create') {
      const rawName = String(msg.name || '').trim();
      if (!rawName) return;
      let cleaned = rawName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
      if (!cleaned) cleaned = 'projeto-' + Date.now().toString(36);
      const finalName = cleaned.toLowerCase();
      const dir = resolveProjectDir(finalName);
      await fs.mkdir(dir, { recursive: true });
      const marker = path.join(dir, '.project');
      await fs.writeFile(marker, `# ${finalName}\nCriado em ${new Date().toISOString()}\n`, 'utf8').catch(() => {});
      session.project = finalName;
      session.lastActive = Date.now();
      const prevInfo = await startProjectPreviewServer(finalName);
      const projects = await listProjects();
      setState(ws, session, session.state);
      emit(ws, 'project:created', {
        project: finalName,
        projects,
        port: prevInfo?.port || null,
        previewUrl: prevInfo?.url || null,
      });
      emit(ws, 'file:tree:refresh', { project: finalName });
      return;
    }

    if (msg.type === 'config:set') {
      if (typeof msg.mode === 'string' && ['solo', 'interactive'].includes(msg.mode)) session.mode = msg.mode;
      if (typeof msg.model === 'string' && msg.model.trim()) session.model = msg.model.trim();
      if (typeof msg.ensemble === 'boolean') session.ensemble = msg.ensemble && ensembleIsEnabled();
      session.lastActive = Date.now();
      setState(ws, session, session.state);
      emit(ws, 'config:updated', { mode: session.mode, model: session.model, ensemble: session.ensemble, ensembleAvailable: ensembleIsEnabled(), ensembleMode: ENSEMBLE_MODE, modelA: FREE_MODEL_A, modelB: FREE_MODEL_B });
      return;
    }
    if (msg.type === 'ensemble:toggle') {
      session.ensemble = !session.ensemble ? ensembleIsEnabled() : false;
      session.lastActive = Date.now();
      setState(ws, session, session.state);
      emit(ws, 'ensemble:toggled', { enabled: session.ensemble, ensembleAvailable: ensembleIsEnabled(), ensembleMode: ENSEMBLE_MODE, modelA: FREE_MODEL_A, modelB: FREE_MODEL_B });
      return;
    }

    if (msg.type === 'agent:stop') {
      session.abortRequested = true;
      if (typeof session.pauseResolver === 'function') session.pauseResolver();
      session.pauseRequested = false;
      setState(ws, session, STATE_STOPPED, { reason: 'user_stop' });
      return;
    }
    if (msg.type === 'agent:pause') {
      if (session.state === STATE_RUNNING) {
        session.pauseRequested = true;
        setState(ws, session, STATE_PAUSED, { reason: 'user_pause' });
      }
      return;
    }
    if (msg.type === 'agent:resume') {
      if (session.state === STATE_PAUSED || session.pauseRequested) {
        session.pauseRequested = true; // ensure resolver is triggered path
        if (typeof session.pauseResolver === 'function') {
          session.pauseResolver();
        } else {
          session.pauseRequested = false;
        }
        setState(ws, session, STATE_RUNNING, { reason: 'user_resume' });
      }
      return;
    }
    if (msg.type === 'agent:confirm') {
      if (session.state === STATE_PAUSED && typeof session.pauseResolver === 'function') {
        session.pauseResolver();
        setState(ws, session, STATE_RUNNING, { reason: 'user_confirmed' });
      }
      return;
    }

    if (msg.type === 'chat:send') {
      const userParts = [];
      if (msg.text && msg.text.trim()) userParts.push({ text: msg.text });
      if (Array.isArray(msg.images) && msg.images.length > 0) {
        for (const img of msg.images) {
          const filePath = path.join(UPLOAD_DIR, img.filename);
          try {
            const inline = await imageInlineData(filePath);
            userParts.push(inline);
            userParts.push({ text: `\n[Imagem anexada: ${img.originalname}]` });
          } catch (e) {
            emit(ws, 'error', { message: `Falha ao processar imagem ${img.originalname}: ${e.message}` });
          }
        }
      }
      if (userParts.length === 0) return;
      console.log('[WS chat:send] session=' + String(sessionId).slice(0, 8) + ' | session.project=' + (session.project || '') + ' | prompt=' + String(msg.text || '').slice(0, 60).replace(/\s+/g, ' '));
      session.lastActive = Date.now();
      runAgentLoop(ws, session, userParts).catch(err => {
        emit(ws, 'error', { message: err.message || 'Erro interno' });
      });
    }

    if (msg.type === 'session:clear') {
      session.history = [];
      session.contents = [];
      emit(ws, 'session:cleared');
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActive > 1000 * 60 * 60 * 12) sessions.delete(id);
  }
}, 60000);

if (!GOOGLE_API_KEY || GOOGLE_API_KEY.includes('sua_chave')) {
  console.log('⚠️  AVISO: GOOGLE_API_KEY não configurada.');
}

// =============== STARTUP: Garante TODOS projetos (mounted e workspace) têm SERVIDOR PREVIEW DEDICADO RODANDO ANTES do listen ===============
// Isso RESOLVE o bug do usuário "preview em branco / porta não abre após restart servidor" — antes startProjectPreviewServer só era chamado no endpoint mount, nunca no startup!
(async function startupStartAllPreviewServers() {
  // 1) Coleta todos slugs conhecidos: projectPorts (já tem porta alocada) + mountedProjects (mesmo que sem porta ainda) + pastas workspace internas
  const slugsToStart = new Set();
  for (const s of projectPorts.keys()) slugsToStart.add(s);
  for (const s of mountedProjects.keys()) slugsToStart.add(s);
  slugsToStart.add(DEFAULT_PROJECT);
  // Workspace directories (ignora blacklist: node_modules, dotfiles)
  try {
    const BLACKLIST_DIRS = new Set(['node_modules', '.git', '.DS_Store', 'uploads', 'public']);
    const es = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
    for (const e of es) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      if (BLACKLIST_DIRS.has(e.name)) continue;
      slugsToStart.add(e.name);
    }
  } catch {}
  let started = 0, failed = 0;
  const results = [];
  if (IS_RENDER_OR_HEADLESS_LINUX) {
    // RC20 RENDER: single-port mode, NÃO precisamos ligar NENHUM preview extra
    // Todos arquivos são servidos via /preview/:slug/ dentro da porta principal
    const slugsArr = Array.from(slugsToStart);
    for (const s of slugsArr) ensureProject(s);
    started = slugsArr.length;
    results.push(
      `  ℹ️  Modo single-port ativado: ${slugsArr.length} projetos servidos via /preview/:slug/`,
      `  ℹ️  URL base: ${RENDER_BASE_URL || 'same-origin'}`
    );
  } else {
    for (const slug of Array.from(slugsToStart)) {
      try {
        // Garante pasta exista (se fallback interno ou workspace)
        ensureProject(slug);
        const r = await startProjectPreviewServer(slug);
        if (r && r.running) {
          started++;
          if (!r.alreadyRunning) {
            const relPath = r.path && String(r.path).includes(WORKSPACE_ROOT)
              ? 'workspace/' + path.relative(WORKSPACE_ROOT, r.path)
              : (r.path ? r.path.split('/').slice(-3).join('/') : '');
            results.push(`  + ${slug} → porta ${r.port} (${relPath})`);
          }
        }
      } catch (e) {
        failed++;
        results.push(`  ✗ ${slug} FALHOU: ${e && e.message ? e.message : String(e)}`);
      }
    }
  }
  // 2) Startup finalizado: ligar servidor principal
  // Render obriga 0.0.0.0 + escutar em process.env.PORT (normalmente 10000)
  // Desktop/macOS local: continua 127.0.0.1:3000 ou localhost
  const LISTEN_HOST = IS_RENDER_OR_HEADLESS_LINUX ? '0.0.0.0' : '127.0.0.1';
  const displayUrl = IS_RENDER_OR_HEADLESS_LINUX && RENDER_BASE_URL
    ? RENDER_BASE_URL
    : `http://localhost:${PORT}`;
  server.listen(PORT, LISTEN_HOST, () => {
    const banner = `
╔══════════════════════════════════════════════════════╗
║   AGENTE AUTÔNOMO · ESTILO TRAE IA                    ║
╠══════════════════════════════════════════════════════╣
║  URL   : ${displayUrl.length > 50 ? displayUrl.slice(0,47)+'...' : displayUrl.padEnd(53)}║
║  Host  : ${(LISTEN_HOST+':'+PORT).padEnd(53)}║
║  Modelo: ${GOOGLE_MODEL.padEnd(53)}║
║  Work  : ${WORKSPACE_ROOT.length > 53 ? WORKSPACE_ROOT.slice(0,50)+'...' : WORKSPACE_ROOT.padEnd(53)}║
║  Steps : ${String(MAX_STEPS).padEnd(53)}║
╠══════════════════════════════════════════════════════╣
║  Previews: ${String(started).padEnd(3)} projetos · ${String(failed).padEnd(3)} falhas · ${(IS_RENDER_OR_HEADLESS_LINUX?'Single-Port /preview':'Multi-Port 3001+').padEnd(31)}║
╚══════════════════════════════════════════════════════╝
Abra o navegador: ${displayUrl}
${results.length?results.join('\n'):''}`;
    console.log(banner);
  });
})().catch(err => {
  console.error('ERRO STARTUP:', err);
  // De qualquer forma liga servidor principal
  const LISTEN_HOST = IS_RENDER_OR_HEADLESS_LINUX ? '0.0.0.0' : '127.0.0.1';
  server.listen(PORT, LISTEN_HOST, () => console.log(`Servidor principal ligado ${LISTEN_HOST}:${PORT} (com erro startup: ${err && err.message ? err.message : String(err)})`));
});
