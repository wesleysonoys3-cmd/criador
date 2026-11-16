/* =========================================================
 * public/autoclips.js — Estúdio "AutoClips AI" (frontend)
 * ---------------------------------------------------------
 * Consome os endpoints já existentes:
 *   /api/autoclips/*   (produção automática de vídeos)
 *   /api/youtube/*     (OAuth oficial + publicações)
 *   /api/analytics/*   (calendário, fila e recomendações)
 *
 * Nada é simulado: cada tela mostra o estado real do backend e,
 * quando algo depende de credenciais/binários externos, isso é
 * informado de forma explícita.
 * =======================================================*/

const API = '/api/autoclips';
const YT = '/api/youtube';
const AN = '/api/analytics';

/* Menu do AutoClips (item 2 da especificação). */
const SECTIONS = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'videos', label: 'Meus vídeos' },
  { id: 'cuts', label: 'Meus cortes' },
  { id: 'schedule', label: 'Agendamentos' },
  { id: 'pubs', label: 'Publicações' },
  { id: 'social', label: 'Minhas redes sociais' },
  { id: 'monitoring', label: 'Monitoramento' },
  { id: 'templates', label: 'Modelos de publicação' },
  { id: 'besttimes', label: 'Melhores horários' },
  { id: 'settings', label: 'Configurações' },
];

const STATE = {
  inited: false,
  section: 'overview',
  busy: false,
  status: null,
  profiles: [],
  overview: null,
  jobs: [],
  cuts: null,
  cutFilter: 'todos',
  job: null,        // detalhe de uma tarefa
  manual: false,
  yt: null,
  accounts: [],     // contas conectadas (multi-rede, Etapa 5)
  platforms: [],    // catálogo de redes + requisitos
  music: null,
  captions: null,   // catálogo de estilos/animações de legenda
  editor: { cut: 1, cap: 0, srt: null, srtIndex: null },
  pubs: [],
  center: null,     // central de publicações (Etapa 6)
  calendar: null,   // calendário de agendamentos
  timezones: [],    // fusos disponíveis
  batchMode: 'now', // 'now' | 'schedule'
  batchResult: null,
  batchPreview: null,
  recs: null,
  pollTimer: null,
};

const RIGHT_KEYS = ['access', 'reproduce', 'edit', 'derivative', 'publish', 'commercial'];
const RIGHT_LABELS = {
  access: 'Direito de acessar',
  reproduce: 'Direito de reproduzir',
  edit: 'Direito de editar',
  derivative: 'Criar obras derivadas',
  publish: 'Direito de publicar',
  commercial: 'Uso comercial',
};
const DECISIONS = ['NAO_VERIFICAVEL', 'PERMITIDO', 'NAO_PERMITIDO'];
const DECISION_LABELS = { NAO_VERIFICAVEL: 'Não verificável', PERMITIDO: 'Permitido', NAO_PERMITIDO: 'Não permitido' };

const STATUS_TONE = {
  rascunho: 'slate', bloqueado: 'rose', pronto: 'sky', processando: 'amber', analisado: 'sky',
  editado: 'sky', revisao: 'amber', concluido: 'emerald', aguardando_render: 'amber',
  renderizado: 'emerald', erro: 'rose',
};

/* Redes sociais: apenas o YouTube tem integração oficial implantada. */
const NETWORKS = [
  { id: 'youtube', label: 'YouTube', ready: true },
  { id: 'instagram', label: 'Instagram', ready: false },
  { id: 'tiktok', label: 'TikTok', ready: false },
  { id: 'facebook', label: 'Facebook', ready: false },
  { id: 'linkedin', label: 'LinkedIn', ready: false },
  { id: 'x', label: 'X', ready: false },
];

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtDate = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};
const fmtDur = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  const m = Math.floor(n / 60), r = n % 60;
  return m > 0 ? (m + 'min ' + (r ? r + 's' : '')).trim() : (r + 's');
};

/* ---------------- HTTP ---------------- */
async function api(path, { method = 'GET', body = null, base = API } = {}) {
  const url = new URL(base + path, location.origin);
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url.toString(), opts);
  let data = null;
  try { data = await r.json(); } catch { data = { ok: false, reason: 'Resposta inválida do servidor.' }; }
  if (!r.ok || data.ok === false) {
    const err = new Error(data.reason || data.error || 'Não foi possível concluir a operação.');
    err.code = data.code || '';
    err.raw = data;
    throw err;
  }
  return data;
}

function toast(msg, kind = 'info') {
  const host = $('#ac-toasts');
  if (!host) return;
  const colors = {
    info: 'border-sky-400/30 bg-sky-500/20 text-sky-100',
    ok: 'border-emerald-400/30 bg-emerald-500/20 text-emerald-100',
    err: 'border-rose-400/30 bg-rose-500/20 text-rose-100',
    warn: 'border-amber-400/30 bg-amber-500/20 text-amber-100',
  };
  const d = document.createElement('div');
  d.className = `pointer-events-auto max-w-[420px] rounded-xl border px-3 py-2 text-[12px] shadow-xl backdrop-blur ${colors[kind] || colors.info}`;
  d.textContent = msg;
  host.appendChild(d);
  setTimeout(() => {
    d.style.transition = 'opacity .3s, transform .3s';
    d.style.opacity = '0'; d.style.transform = 'translateY(6px)';
    setTimeout(() => d.remove(), 320);
  }, 5200);
}

/* ---------------- carregamento de dados ---------------- */
async function loadStatus() {
  const r = await api('/status');
  STATE.status = r;
  if (Array.isArray(r.profiles) && r.profiles.length) STATE.profiles = r.profiles;
  return r;
}
async function loadOverview() { const r = await api('/overview'); STATE.overview = r; return r; }
async function loadJobs() { const r = await api('/jobs'); STATE.jobs = r.items || []; return r; }
async function loadCuts() { const r = await api('/cuts'); STATE.cuts = r; return r; }
async function loadYouTube() {
  try { STATE.yt = await api('/status', { base: YT }); } catch { STATE.yt = null; }
  try { const r = await api('/publications', { base: YT }); STATE.pubs = r.items || []; } catch { STATE.pubs = []; }
  try { const r = await api('/accounts', { base: YT }); STATE.accounts = r.items || []; } catch { STATE.accounts = []; }
  try { const r = await api('/platforms', { base: YT }); STATE.platforms = r.items || []; } catch { STATE.platforms = []; }
  try { STATE.center = await api('/publications/center', { base: YT }); } catch { STATE.center = null; }
  try { STATE.calendar = await api('/publications/calendar', { base: YT }); } catch { STATE.calendar = null; }
  if (STATE.center && Array.isArray(STATE.center.timezones) && STATE.center.timezones.length) STATE.timezones = STATE.center.timezones;
}
async function loadRecs() {
  try { STATE.recs = await api('/recommendations', { base: AN }); } catch { STATE.recs = null; }
}
async function loadMusic() {
  try { STATE.music = await api('/music'); } catch { STATE.music = null; }
}
async function loadCaptions() {
  try { STATE.captions = await api('/captions'); } catch { STATE.captions = null; }
}
async function openJob(id) {
  const r = await api('/job/' + encodeURIComponent(id));
  STATE.job = r;
  STATE.section = 'videos';
  const first = r && r.plan && r.plan.cuts && r.plan.cuts[0];
  STATE.editor = { cut: first ? first.index : 1, cap: 0, srt: null, srtIndex: null };
  render();
}

/* ---------------- menu ---------------- */
function renderMenu() {
  const nav = $('#ac-menu');
  const sel = $('#ac-menu-mobile');
  const items = SECTIONS.map((s) => {
    const active = s.id === STATE.section;
    return `<button type="button" data-ac-act="go" data-section="${esc(s.id)}"
      class="w-full text-left rounded-xl px-3 py-2 text-[12.5px] transition flex items-center gap-2 ${active
        ? 'bg-fuchsia-500/15 text-fuchsia-100 font-semibold border border-fuchsia-400/25'
        : 'text-slate-400 hover:text-slate-100 hover:bg-white/5 border border-transparent'}">
      <span class="w-1.5 h-1.5 rounded-full ${active ? 'bg-fuchsia-300' : 'bg-slate-600'}"></span>
      <span class="truncate">${esc(s.label)}</span>
    </button>`;
  }).join('');
  if (nav) nav.innerHTML = items;
  if (sel) sel.innerHTML = SECTIONS.map((s) => `<option value="${esc(s.id)}" ${s.id === STATE.section ? 'selected' : ''}>${esc(s.label)}</option>`).join('');

  const ctx = $('#ac-ctx');
  if (ctx) {
    const ov = STATE.overview;
    ctx.textContent = ov ? (ov.videos.total + ' vídeo(s) · ' + ov.cuts.total + ' corte(s) · ' + ov.cuts.pending + ' aguardando revisão') : '';
  }
}

/* ---------------- componentes ---------------- */
function badge(statusLabel) {
  const tone = STATUS_TONE[String(statusLabel || '').toLowerCase()] || 'slate';
  const map = {
    slate: 'border-white/10 bg-white/5 text-slate-300',
    sky: 'border-sky-400/30 bg-sky-500/15 text-sky-200',
    amber: 'border-amber-400/30 bg-amber-500/15 text-amber-200',
    emerald: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200',
    rose: 'border-rose-400/30 bg-rose-500/15 text-rose-200',
  };
  return `<span class="text-[10.5px] px-2 py-0.5 rounded-full border ${map[tone]} font-semibold">${esc(statusLabel)}</span>`;
}

function card(label, value, hint, tone = 'violet') {
  const tones = {
    violet: 'border-violet-400/20 text-violet-200',
    amber: 'border-amber-400/20 text-amber-200',
    emerald: 'border-emerald-400/20 text-emerald-200',
    sky: 'border-sky-400/20 text-sky-200',
  };
  return `<div class="rounded-2xl border ${tones[tone]} bg-white/[0.03] p-3">
    <div class="text-[10.5px] uppercase tracking-wider opacity-80 font-semibold">${esc(label)}</div>
    <div class="text-[22px] font-bold text-slate-100 leading-tight mt-0.5">${esc(value)}</div>
    ${hint ? `<div class="text-[10.5px] text-slate-500 mt-0.5">${esc(hint)}</div>` : ''}
  </div>`;
}

function block(title, body, extra = '') {
  return `<section class="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
    <div class="flex items-center gap-2 mb-2">
      <h3 class="text-[12.5px] font-bold text-slate-200">${esc(title)}</h3>${extra}
    </div>
    ${body}
  </section>`;
}

function empty(msg) { return `<div class="text-[11.5px] text-slate-500">${esc(msg)}</div>`; }

function ffmpegBanner() {
  const ff = STATE.status && STATE.status.ffmpeg;
  if (!ff) return '';
  if (ff.available === true) {
    return `<div class="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-3 py-2 text-[11.5px] text-emerald-200">
      ffmpeg disponível (${esc((ff.ffmpeg && ff.ffmpeg.version) || 'ok')}) — o render pode ser executado.</div>`;
  }
  if (ff.available === false) {
    return `<div class="rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-200">
      <b>ffmpeg não instalado.</b> Análise, cortes, metadados e QA funcionam; o render real fica <b>pendente</b> e é sinalizado como tal.
      <span class="block text-amber-200/80 mt-1">${esc(ff.installHint || '')}</span></div>`;
  }
  return '';
}

function note(title, text) {
  return `<div class="rounded-xl border border-sky-400/20 bg-sky-500/5 px-3 py-2 text-[11.5px] text-sky-200">
    <b>${esc(title)}</b><span class="block text-sky-200/80 mt-0.5">${esc(text)}</span></div>`;
}

/* ---------------- rotas de tela ---------------- */
function render() {
  const body = $('#ac-body');
  if (!body) return;
  renderMenu();
  const views = {
    overview: renderOverview,
    videos: renderVideos,
    cuts: renderCuts,
    schedule: renderSchedule,
    pubs: renderPubs,
    social: renderSocial,
    monitoring: renderMonitoring,
    templates: renderTemplates,
    besttimes: renderBestTimes,
    settings: renderSettings,
  };
  const fn = views[STATE.section] || renderOverview;
  body.innerHTML = fn();
  body.scrollTop = 0;
}

/* ================= 1. Visão geral ================= */
function renderOverview() {
  const ov = STATE.overview;
  if (!ov) return '<div class="text-[12px] text-slate-400">Carregando…</div>';
  const scheduled = (STATE.pubs || []).filter((p) => p.scheduledAt && !p.publishedAt);

  const reviewRows = (ov.pendingReview || []).map((j) => `
    <button type="button" data-ac-act="open" data-id="${esc(j.id)}" class="w-full text-left rounded-xl border border-amber-400/20 bg-amber-500/5 hover:bg-amber-500/10 px-3 py-2">
      <div class="flex items-center gap-2">
        <span class="text-[12px] font-semibold text-slate-100 truncate">${esc(j.title)}</span>
        <span class="ml-auto text-[10.5px] text-slate-500">${esc(fmtDate(j.updatedAt))}</span>
      </div>
      <div class="text-[10.5px] text-amber-200/80 mt-0.5">${esc(j.plan ? (j.plan.cutsCount + ' corte(s) · ' + fmtDur(j.plan.totalDuration)) : 'sem plano')} · QA ${esc(j.qa ? j.qa.score : '—')}</div>
    </button>`).join('');

  const procRows = (ov.processing || []).map((j) => `
    <div class="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <div class="flex items-center gap-2">
        <span class="text-[12px] text-slate-100 truncate">${esc(j.title)}</span>
        ${badge(j.statusLabel || j.status)}
        <span class="ml-auto text-[10.5px] text-slate-500">${esc(j.stageLabel || '')} ${esc(j.progress || 0)}%</span>
      </div>
      <div class="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-violet-400" style="width:${esc(j.progress || 0)}%"></div></div>
    </div>`).join('');

  const recentRows = (ov.recent || []).map((j) => `
    <button type="button" data-ac-act="open" data-id="${esc(j.id)}" class="w-full text-left rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] px-3 py-2">
      <div class="flex items-center gap-2">
        <span class="text-[12px] text-slate-100 truncate">${esc(j.title)}</span>
        ${badge(j.statusLabel || j.status)}
        <span class="ml-auto text-[10.5px] text-slate-500">${esc(j.plan ? (j.plan.cutsCount + ' cortes') : '')}</span>
      </div>
      <div class="text-[10.5px] text-slate-500 mt-0.5">${esc(fmtDate(j.updatedAt))}${j.rights ? ' · direitos: ' + esc(j.rights.status) : ''}</div>
    </button>`).join('');

  const scheduledRows = scheduled.map((p) => `
    <div class="rounded-xl border border-sky-400/20 bg-sky-500/5 px-3 py-2 text-[11.5px]">
      <div class="flex items-center gap-2">
        <span class="text-slate-100 truncate">${esc((p.snippet && p.snippet.title) || 'Publicação')}</span>
        <span class="ml-auto text-[10.5px] text-sky-200/80">${esc(fmtDate(p.scheduledAt))}</span>
      </div>
      <div class="text-[10.5px] text-slate-500">YouTube · ${esc(p.visibility || '')} · ${esc(p.status || '')}</div>
    </div>`).join('');

  return `<div class="max-w-[1080px] space-y-4">
    ${ffmpegBanner()}

    <section class="rounded-2xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/10 to-transparent p-4">
      <h2 class="text-[14px] font-bold text-fuchsia-100">Produza cortes a partir de uma URL de vídeo</h2>
      <p class="text-[11.5px] text-slate-400 mt-0.5 mb-3">Cole uma ou várias URLs (uma por linha). A URL é registrada como fonte real do vídeo.</p>
      <textarea id="ac-ingest-urls" rows="3" class="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[12px] text-slate-100 font-mono" placeholder="https://www.youtube.com/watch?v=...&#10;https://vimeo.com/..."></textarea>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
        <label class="text-[10.5px] text-slate-400">Perfil de edição
          <select id="ac-ingest-profile" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100">${profileOptions('podcast')}</select></label>
        <label class="text-[10.5px] text-slate-400">Máximo de cortes
          <input id="ac-ingest-maxcuts" type="number" min="1" max="50" value="6" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100"></label>
        <label class="text-[10.5px] text-slate-400">Duração dos cortes
          <select id="ac-ingest-duration" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100">
            <option value="30">30 segundos</option>
            <option value="45">45 segundos</option>
            <option value="60" selected>60 segundos</option>
            <option value="90">90 segundos</option>
            <option value="0">Personalizada</option>
          </select></label>
        <label class="text-[10.5px] text-slate-400">Formato
          <select id="ac-ingest-aspect" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100">
            <option value="9:16" selected>Vertical 9:16</option>
            <option value="1:1">Quadrado 1:1</option>
            <option value="16:9">Horizontal 16:9</option>
          </select></label>
      </div>
      <label id="ac-ingest-custom-wrap" class="hidden text-[10.5px] text-slate-400 mt-2 block">Duração personalizada (segundos)
        <input id="ac-ingest-custom" type="number" min="5" max="600" value="60" class="mt-1 w-[160px] rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100"></label>
      <div class="flex items-center gap-2 mt-3">
        <button data-ac-act="ingest" class="text-[12px] px-3.5 py-2 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold">Adicionar e criar tarefa</button>
        <button data-ac-act="go" data-section="videos" class="text-[11.5px] px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Ver meus vídeos</button>
      </div>
    </section>

    <section class="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 to-transparent p-4">
      <h2 class="text-[14px] font-bold text-violet-100">Ou envie um vídeo do seu computador</h2>
      <p class="text-[11.5px] text-slate-400 mt-0.5 mb-3">Selecione um arquivo de vídeo. Ele é enviado ao servidor e registrado como fonte local da tarefa.</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label class="text-[10.5px] text-slate-400">Arquivo de vídeo
          <input id="ac-upload-file" type="file" accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-300 file:mr-2 file:rounded-md file:border-0 file:bg-violet-600 file:px-2.5 file:py-1 file:text-white"></label>
        <label class="text-[10.5px] text-slate-400">Título (opcional)
          <input id="ac-upload-title" type="text" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100" placeholder="Usa o nome do arquivo se vazio"></label>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
        <label class="text-[10.5px] text-slate-400">Perfil de edição
          <select id="ac-upload-profile" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100">${profileOptions('podcast')}</select></label>
        <label class="text-[10.5px] text-slate-400">Máximo de cortes
          <input id="ac-upload-maxcuts" type="number" min="1" max="50" value="6" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100"></label>
        <label class="text-[10.5px] text-slate-400">Duração dos cortes
          <select id="ac-upload-duration" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100">
            <option value="30">30 segundos</option>
            <option value="45">45 segundos</option>
            <option value="60" selected>60 segundos</option>
            <option value="90">90 segundos</option>
            <option value="0">Personalizada</option>
          </select></label>
        <label class="text-[10.5px] text-slate-400">Formato
          <select id="ac-upload-aspect" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100">
            <option value="9:16" selected>Vertical 9:16</option>
            <option value="1:1">Quadrado 1:1</option>
            <option value="16:9">Horizontal 16:9</option>
          </select></label>
      </div>
      <label id="ac-upload-custom-wrap" class="hidden text-[10.5px] text-slate-400 mt-2 block">Duração personalizada (segundos)
        <input id="ac-upload-custom" type="number" min="5" max="600" value="60" class="mt-1 w-[160px] rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100"></label>
      <div class="flex flex-wrap items-center gap-2 mt-3">
        <button data-ac-act="upload-local" class="text-[12px] px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold">Enviar vídeo e criar tarefa</button>
        <span class="text-[10.5px] text-slate-500">A duração real é detectada quando o ffprobe está disponível.</span>
      </div>
    </section>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
      ${card('Vídeos', ov.videos.total, 'tarefas registradas', 'violet')}
      ${card('Cortes', ov.cuts.total, ov.cuts.pending + ' aguardando revisão', 'sky')}
      ${card('Processando', ov.videos.processing, ov.queue && ov.queue.running ? 'fila ativa' : 'fila parada', 'amber')}
      ${card('Agendados', scheduled.length, 'publicações futuras', 'emerald')}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      ${block('Cortes aguardando revisão', reviewRows || empty('Nenhum corte aguardando revisão.'))}
      ${block('Processamentos em andamento', procRows || empty('Nada processando agora.'))}
    </div>

    ${block('Publicações agendadas', scheduledRows || empty('Nenhuma publicação agendada. Conecte o YouTube em "Minhas redes sociais".'))}
    ${block('Últimos vídeos processados', recentRows || empty('Nenhum vídeo ainda. Adicione uma URL acima.'))}
  </div>`;
}

/* ================= 2. Meus vídeos ================= */
function renderVideos() {
  if (STATE.job) return renderJobDetail();
  const jobs = STATE.jobs || [];
  const rows = jobs.map((j) => `
    <button type="button" data-ac-act="open" data-id="${esc(j.id)}" class="w-full text-left rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] px-3 py-2.5">
      <div class="flex items-center gap-2">
        <span class="text-[12.5px] font-semibold text-slate-100 truncate">${esc(j.title)}</span>
        ${badge(j.statusLabel || j.status)}
        <span class="ml-auto text-[10.5px] text-slate-500">${esc(fmtDate(j.updatedAt))}</span>
      </div>
      <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-slate-400">
        <span>Perfil: <b class="text-slate-300">${esc(j.profileLabel || '—')}</b></span>
        <span>Fontes: <b class="text-slate-300">${esc(j.sourcesCount)}</b></span>
        <span>Direitos: <b class="${j.rights && j.rights.canProcess ? 'text-emerald-300' : 'text-rose-300'}">${esc(j.rights ? j.rights.status : 'não avaliados')}</b></span>
        ${j.plan ? `<span>Cortes: <b class="text-slate-300">${esc(j.plan.cutsCount)}</b> · ${esc(fmtDur(j.plan.totalDuration))}</span>` : ''}
        ${j.qa ? `<span>QA: <b class="${j.qa.ok ? 'text-emerald-300' : 'text-amber-300'}">${esc(j.qa.score)}</b></span>` : ''}
        ${j.render && j.render.pending ? '<span class="text-amber-300">render pendente</span>' : ''}
      </div>
      ${j.status === 'processando' ? `<div class="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-amber-400" style="width:${esc(j.progress)}%"></div></div>` : ''}
    </button>`).join('');

  return `<div class="max-w-[1080px] space-y-3">
    ${ffmpegBanner()}
    <div class="flex items-center gap-2">
      <h2 class="text-[13px] font-bold text-fuchsia-200">Meus vídeos</h2>
      <span class="text-[11px] text-slate-500">${jobs.length} tarefa(s)</span>
      <button data-ac-act="new-manual" class="ml-auto text-[11.5px] px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Nova tarefa (transcrição manual)</button>
    </div>
    ${STATE.manual ? renderManualForm() : ''}
    ${jobs.length ? `<div class="grid grid-cols-1 gap-2">${rows}</div>` : empty('Nenhuma tarefa ainda. Use a Visão geral para adicionar uma URL de vídeo.')}
  </div>`;
}

function renderManualForm() {
  return `<section class="rounded-2xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
    <div class="text-[12px] font-bold text-slate-200">Nova tarefa com transcrição manual</div>
    <label class="block text-[10.5px] text-slate-400">Título
      <input id="ac-title" type="text" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[12.5px] text-slate-100" placeholder="Ex.: Podcast #12 — melhores momentos"></label>
    <label class="block text-[10.5px] text-slate-400">Perfil de edição
      <select id="ac-profile" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[12.5px] text-slate-100">${profileOptions('podcast')}</select></label>
    <label class="block text-[10.5px] text-slate-400">Fontes (uma por linha: <code>url|endereço</code>, <code>local|caminho</code> ou só o endereço)
      <textarea id="ac-sources" rows="2" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[12px] text-slate-100 font-mono" placeholder="url|https://www.youtube.com/watch?v=..."></textarea></label>
    <label class="block text-[10.5px] text-slate-400">Transcrição (uma linha por fala: <code>inicio|texto</code>; aceita JSON de segmentos)
      <textarea id="ac-transcript" rows="8" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[12px] text-slate-100 font-mono" placeholder="0|Olha isso, o segredo que ninguém conta...&#10;10|A verdade é que eu descobri depois de muito tempo."></textarea></label>
    <div class="flex items-center gap-2">
      <button data-ac-act="create" class="text-[11.5px] px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold">Criar tarefa</button>
      <button data-ac-act="cancel-manual" class="text-[11.5px] px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Cancelar</button>
      <span class="text-[10.5px] text-slate-500">Os direitos são verificados antes de qualquer processamento.</span>
    </div>
  </section>`;
}

/* ================= detalhe do vídeo ================= */
function renderJobDetail() {
  const job = STATE.job && STATE.job.job;
  if (!job) return empty('Tarefa não encontrada.');
  const d = STATE.job;
  const cutStates = d.cutStates || {};

  const analysis = d.analysis ? block('Análise inteligente',
    `<div class="text-[11px] text-slate-400">${esc(d.analysis.totalAnalyzed)} segmento(s) · ${esc((d.analysis.moments || []).length)} momento(s) · média <b class="text-slate-300">${esc(d.analysis.averageScore)}</b> · mínimo ${esc(d.analysis.minScore)}</div>
     <ul class="mt-2 space-y-1">
       ${(d.analysis.moments || []).slice(0, 12).map((m) => `<li class="text-[11px] text-slate-400"><b class="text-sky-300">${esc(m.score)}</b> · ${esc(fmtDur(m.duration))} · ${esc(String(m.text || '').slice(0, 90))}</li>`).join('')}
     </ul>`, badge(d.analysis.moments ? (d.analysis.moments.length + ' momentos') : '')) : '';

  const plan = d.plan ? block('Plano de edição',
    `<ul class="space-y-1">
      ${(d.plan.cuts || []).map((c) => {
        const st = cutStates[c.index] || 'pendente';
        return `<li class="text-[11px] text-slate-400 rounded-lg border border-white/5 bg-black/20 px-2 py-1.5">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-slate-200 font-semibold">#${esc(c.index)}</span>
            <span>${esc(fmtDur(c.duration))}</span>
            <span class="text-sky-300">score ${esc(c.score)}</span>
            <span class="text-slate-500">${esc(c.captionsCount)} legenda(s)</span>
            <span class="ml-auto">${badge(st)}</span>
            <button data-ac-act="cut-state" data-id="${esc(job.id)}" data-index="${esc(c.index)}" data-state="aprovado" class="px-2 py-0.5 rounded border border-emerald-400/25 bg-emerald-500/10 text-emerald-200">Aprovar</button>
            <button data-ac-act="cut-state" data-id="${esc(job.id)}" data-index="${esc(c.index)}" data-state="descartado" class="px-2 py-0.5 rounded border border-rose-400/25 bg-rose-500/10 text-rose-200">Descartar</button>
          </div>
          <div class="text-slate-300">${esc(c.title)}</div>
          <div class="text-slate-500">${esc(c.reason)}</div>
        </li>`;
      }).join('')}
    </ul>`,
    `<span class="text-[10.5px] text-slate-500">${esc(d.plan.profileLabel)} · ${esc(d.plan.aspect)} · ${esc(fmtDur(d.plan.totalDuration))}</span>`) : '';

  const meta = d.metadata ? block('Metadados',
    `<div class="text-[12.5px] text-slate-100 font-semibold">${esc(d.metadata.title)}</div>
     <div class="text-[11px] text-slate-400 whitespace-pre-wrap mt-1">${esc(d.metadata.description)}</div>
     <div class="mt-2 flex flex-wrap gap-1">${(d.metadata.tags || []).map((t) => `<span class="text-[10.5px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">${esc(t)}</span>`).join('')}</div>
     <div class="mt-1 text-[10.5px] text-sky-300">${(d.metadata.hashtags || []).map(esc).join(' ')}</div>`) : '';

  const qa = d.qa ? block('Controle de qualidade',
    `<ul class="space-y-0.5">${d.qa.checks.map((c) => `<li class="text-[11px] ${c.ok ? 'text-slate-400' : 'text-rose-300'}">${c.ok ? 'OK' : 'FALHA'} — ${esc(c.name)}${c.detail ? ' · ' + esc(c.detail) : ''}</li>`).join('')}</ul>`,
    `<span class="text-[10.5px] px-2 py-0.5 rounded-full border ${d.qa.ok ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200' : 'border-amber-400/30 bg-amber-500/15 text-amber-200'}">${esc(d.qa.passed)}/${esc(d.qa.checks.length)} · nota ${esc(d.qa.score)}</span>`) : '';

  const renderBlock = d.render ? block('Render',
    `<div class="text-[11.5px] ${d.render.state === 'renderizado' ? 'text-emerald-200' : 'text-amber-200'}">${esc(d.render.reason || ('estado: ' + d.render.state))}</div>
     ${d.render.hint ? `<div class="text-[10.5px] text-amber-200/80 mt-1">${esc(d.render.hint)}</div>` : ''}
     ${(d.render.commands || []).length ? `<details class="mt-2"><summary class="text-[10.5px] text-slate-400 cursor-pointer">${(d.render.commands || []).length} comando(s) prontos para execução manual</summary><pre class="mt-1 text-[10px] text-slate-400 whitespace-pre-wrap break-all">${(d.render.commands || []).map((c) => esc(c.command)).join('\n')}</pre></details>` : ''}`) : '';

  const log = (d.log || []).slice(-14).reverse();

  return `<div class="max-w-[1080px] space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <button data-ac-act="back-videos" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Voltar</button>
      ${badge(job.statusLabel || job.status)}
      <span class="text-[13px] font-bold text-slate-100 truncate">${esc(job.title)}</span>
      <button data-ac-act="remove" data-id="${esc(job.id)}" class="ml-auto text-[11px] px-2.5 py-1.5 rounded-lg border border-rose-400/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-300">Remover</button>
    </div>

    ${block('Execução',
      `<div class="flex items-center gap-2 mb-2 flex-wrap">
        <span class="text-[11px] text-slate-400">${esc(job.stageLabel || 'aguardando')} · ${esc(job.progress || 0)}%</span>
        <label class="ml-auto text-[11px] text-slate-400">Perfil
          <select id="ac-job-profile" class="ml-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11.5px] text-slate-100">${profileOptions(job.profileKey)}</select></label>
      </div>
      <div class="h-2 rounded-full bg-white/10 overflow-hidden"><div class="h-full ${job.status === 'erro' ? 'bg-rose-400' : 'bg-violet-400'}" style="width:${esc(job.progress || 0)}%"></div></div>
      <div class="flex flex-wrap gap-2 mt-3">
        <button data-ac-act="run" data-id="${esc(job.id)}" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Processar tudo</button>
        <button data-ac-act="analyze" data-id="${esc(job.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Analisar</button>
        <button data-ac-act="edit" data-id="${esc(job.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Gerar plano</button>
        <button data-ac-act="metadata" data-id="${esc(job.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Metadados</button>
        <button data-ac-act="qa" data-id="${esc(job.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">QA</button>
      </div>
      ${job.error ? `<div class="mt-2 text-[11px] text-rose-300">Erro: ${esc(job.error)}</div>` : ''}`)}

    ${renderSource(d)}
    ${renderFormats(d)}
    ${renderRights(d)}
    ${analysis}${plan}${renderEditor(d)}${renderCovers(d)}${meta}${qa}${renderBlock}

    ${block('Histórico', `<ul class="space-y-0.5">${log.map((l) => `<li class="text-[10.5px] text-slate-500"><span class="text-slate-400">[${esc(l.stage)}]</span> ${esc(l.message)}</li>`).join('')}</ul>`)}
  </div>`;
}

function renderRights(d) {
  const r = d.rights || {};
  const rights = r.rights || {};
  const rows = RIGHT_KEYS.map((k) => `
    <label class="flex items-center gap-2 text-[11.5px] text-slate-300">
      <span class="flex-1">${esc(RIGHT_LABELS[k])}</span>
      <select data-ac-right="${esc(k)}" class="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11.5px] text-slate-100">
        ${DECISIONS.map((x) => `<option value="${esc(x)}" ${rights[k] === x || (!rights[k] && x === 'NAO_VERIFICAVEL') ? 'selected' : ''}>${esc(DECISION_LABELS[x])}</option>`).join('')}
      </select>
    </label>`).join('');
  const evidence = (r.evidence || []).map((e) => `<li class="text-[11px] text-slate-400">${esc(e.type)}: <b class="text-slate-300">${esc(e.label || e.value)}</b></li>`).join('');

  return `<section class="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
    <div class="flex items-center gap-2 mb-2">
      <h3 class="text-[12.5px] font-bold text-slate-200">Direitos de uso</h3>
      <span class="text-[10.5px] px-2 py-0.5 rounded-full border ${r.canProcess ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200' : 'border-rose-400/30 bg-rose-500/15 text-rose-200'}">${r.canProcess ? 'pode processar' : 'bloqueado'}</span>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-1.5">${rows}</div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
      <input id="ac-right-source" type="text" value="${esc(r.source || '')}" class="rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-[12px] text-slate-100" placeholder="Origem (contrato, licença)">
      <input id="ac-right-responsible" type="text" value="${esc(r.responsible || '')}" class="rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-[12px] text-slate-100" placeholder="Responsável pela verificação">
    </div>
    <label class="block text-[10.5px] text-slate-400 mt-2">Evidência (tipo|rótulo|valor)
      <input id="ac-right-evidence" type="text" class="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-[12px] text-slate-100 font-mono" placeholder="contrato|Contrato assinado|lic-123"></label>
    ${evidence ? `<ul class="mt-2 list-disc list-inside space-y-0.5">${evidence}</ul>` : ''}
    <div class="flex items-center gap-2 mt-2">
      <button data-ac-act="save-rights" data-id="${esc((d.job || {}).id || '')}" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">Salvar direitos</button>
      ${!r.canProcess ? '<span class="text-[10.5px] text-rose-300">Sem os direitos exigidos, o processamento fica bloqueado.</span>' : ''}
    </div>
  </section>`;
}

/* ================= Fonte real do vídeo (URL) ================= */
function renderSource(d) {
  const job = d.job || {};
  const s = d.sourceInfo;
  const url = job.url || ((d.sources || []).filter((x) => x.kind === 'url').map((x) => x.value)[0]) || '';

  if (!url) {
    return block('Fonte do vídeo',
      `<div class="text-[11px] text-slate-500">Esta tarefa não tem URL de vídeo. Use a transcrição manual (abaixo) como insumo da análise.</div>`);
  }

  const thumb = s && s.thumbnail
    ? `<img src="${esc(s.thumbnail)}" alt="miniatura" class="w-[132px] h-[76px] object-cover rounded-lg border border-white/10 bg-black/40"/>`
    : `<div class="w-[132px] h-[76px] rounded-lg border border-white/10 bg-black/40 grid place-items-center text-[10px] text-slate-500">sem miniatura</div>`;

  const rows = s
    ? `<div class="text-[12px] text-slate-100 font-semibold">${esc(s.title || '(título indisponível)')}</div>
       <div class="text-[11px] text-slate-400">${esc(s.provider || '')}${s.author ? ' · ' + esc(s.author) : ''}${s.duration ? ' · ' + esc(fmtDur(s.duration)) : ''}</div>
       <div class="text-[10.5px] text-slate-500 mt-1" title="${esc(s.url)}">${esc(s.note || 'Dados públicos (oEmbed/Open Graph).')}</div>`
    : `<div class="text-[11.5px] text-amber-200">Ainda não buscamos os dados públicos deste vídeo.</div>
       <div class="text-[10.5px] text-slate-500 mt-1">Clique em “Buscar dados do vídeo” para ler título, autor e miniatura reais (sem baixar o vídeo).</div>`;

  return block('Fonte do vídeo', `
    <div class="flex gap-3 items-start">
      ${thumb}
      <div class="min-w-0 flex-1">${rows}</div>
    </div>
    <div class="mt-2 flex items-center gap-2 flex-wrap">
      <button data-ac-act="enrich" data-id="${esc(job.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Buscar dados do vídeo</button>
      <a href="${esc(url)}" target="_blank" rel="noopener" class="text-[11px] text-sky-300 hover:text-sky-200 truncate max-w-[320px]">${esc(url)}</a>
    </div>`,
    s ? badge(s.provider || 'URL') : '');
}

/* ================= Formatos (múltiplos) ================= */
const ASPECTS = ['9:16', '1:1', '16:9'];
const ASPECT_LABELS = { '9:16': 'Vertical 9:16', '1:1': 'Quadrado 1:1', '16:9': 'Horizontal 16:9' };

function renderFormats(d) {
  const job = d.job || {};
  const current = (d.formats && d.formats.length ? d.formats : (d.plan && d.plan.aspects) || []).slice();
  const sel = current.length ? current : ['9:16'];
  const boxes = ASPECTS.map((a) => `
    <label class="flex items-center gap-2 text-[11.5px] text-slate-300 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
      <input type="checkbox" data-ac-fmt="${esc(a)}" ${sel.includes(a) ? 'checked' : ''} class="accent-violet-500"/>
      <span>${esc(ASPECT_LABELS[a])}</span>
    </label>`).join('');
  return block('Formatos de saída', `
    <div class="flex flex-wrap gap-2">${boxes}</div>
    <div class="mt-2 flex items-center gap-2">
      <button data-ac-act="save-formats" data-id="${esc(job.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Salvar formatos</button>
      <span class="text-[10.5px] text-slate-500">É possível gerar mais de um formato para o mesmo corte.</span>
    </div>`);
}

/* ================= Capas automáticas (3 opções por corte) ================= */
function renderCovers(d) {
  const job = d.job || {};
  if (!d.plan) return '';
  const cov = d.covers;
  const items = (cov && cov.items) || [];

  const header = `<div class="flex items-center gap-2 mb-2">
      <h3 class="text-[12.5px] font-bold text-slate-200">Capas automáticas</h3>
      <span class="text-[10.5px] text-slate-500">3 opções por corte${cov ? ' · ' + esc(cov.aspect) : ''}</span>
    </div>`;

  if (!items.length) {
    return block('Capas automáticas',
      `<div class="text-[11.5px] text-slate-400">Gere 3 opções de capa para cada corte (usa a miniatura real do vídeo quando disponível).</div>
       <div class="mt-2"><button data-ac-act="gen-covers" data-id="${esc(job.id)}" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold">Gerar capas</button></div>`);
  }

  const blocks = items.map((it) => `
    <div class="mt-3">
      <div class="text-[11px] text-slate-300 mb-1">Corte #${esc(it.index)} · ${esc(it.aspect)} · ${it.hasThumbnail ? 'com miniatura real' : 'sem miniatura (fundo + título)'}</div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        ${(it.covers || []).map((c) => `
          <figure class="rounded-xl border border-white/10 bg-black/30 p-1.5">
            <div class="w-full overflow-hidden rounded-lg bg-black/40" style="max-height:230px">${c.svg}</div>
            <figcaption class="text-[10.5px] text-slate-400 mt-1"><b class="text-slate-300">${esc(c.label)}</b> · ${esc(c.style)}</figcaption>
          </figure>`).join('')}
      </div>
    </div>`).join('');

  return `<section class="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
    ${header}
    <button data-ac-act="gen-covers" data-id="${esc(job.id)}" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Regerar capas</button>
    ${blocks}
    ${cov && cov.note ? `<div class="text-[10.5px] text-slate-500 mt-2">${esc(cov.note)}</div>` : ''}
  </section>`;
}

/* ================= Etapa 4 — Editor integrado ================= */
const ORDER_LABELS = { score: 'Melhores notas', cronologica: 'Ordem cronológica', duracao: 'Maior duração' };

function capCatalog() { return STATE.captions || {}; }
function capStyleDef(key) {
  const list = capCatalog().styles || [];
  return list.find((s) => s.key === key) || list[0] || { key: 'padrao', label: 'Padrão', font: 'Arial', size: 46, color: '#FFFFFF', bg: 'rgba(0,0,0,0.55)', outline: '#000000', outlineWidth: 3 };
}
function capAnimLabel(key) {
  const a = (capCatalog().animations || []).find((x) => x.key === key);
  return a ? a.label : key;
}
function opt(list, sel, labelOf) {
  return (list || []).map((x) => `<option value="${esc(x.key)}" ${x.key === sel ? 'selected' : ''}>${esc(labelOf(x))}</option>`).join('');
}

/* Prévia honesta: miniatura real + legenda no enquadramento escolhido.
 * O vídeo final só existe após o render com ffmpeg. */
function renderDatePreview(d, sel, cfg) {
  const thumb = (d.sourceInfo && d.sourceInfo.thumbnail) || '';
  const aspect = (d.plan && d.plan.aspect) || '9:16';
  const ar = aspect === '9:16' ? '9 / 16' : (aspect === '1:1' ? '1 / 1' : '16 / 9');
  const caps = (sel && sel.captions) || [];
  const idx = Math.min(Math.max(0, STATE.editor.cap | 0), Math.max(0, caps.length - 1));
  const cap = caps[idx] || null;
  const st = capStyleDef(cfg.style);
  const text = cap ? String(cap.text || '') : String((sel && sel.title) || '');
  const shown = cfg.uppercase ? text.toUpperCase() : text;
  const justify = cfg.position === 'superior' ? 'flex-start' : (cfg.position === 'centro' ? 'center' : 'flex-end');

  const animClass = cfg.animation && cfg.animation !== 'nenhuma' ? 'ac-anim-' + cfg.animation : '';

  const capBox = cfg.enabled
    ? `<div class="${animClass}" style="max-width:92%;background:${st.bg};color:${st.color};font-family:${st.font.replace(/"/g, '')};font-weight:${st.bold ? 700 : 400};font-size:${Math.round(st.size / 3.2)}px;line-height:1.25;text-align:center;padding:6px 10px;border-radius:8px;text-shadow:0 1px 3px ${st.outline};border:${st.bg === 'rgba(0,0,0,0)' ? '0' : '0'}">
        ${esc(shown.slice(0, cfg.maxChars * 2))}</div>`
    : '';

  const chips = caps.length
    ? `<div class="flex flex-wrap gap-1 mt-2">${caps.map((c, i) => `<button data-ac-act="ed-cap" data-index="${i}" class="text-[10px] px-1.5 py-0.5 rounded border ${i === idx ? 'border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100' : 'border-white/10 bg-white/5 text-slate-400'}">${esc(Number(c.start).toFixed(1))}s</button>`).join('')}</div>`
    : `<div class="text-[10.5px] text-slate-500 mt-2">Este corte não tem blocos de legenda. Ajuste o intervalo e salve o corte para recalculá-los.</div>`;

  return `<div class="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
    <div class="flex items-center gap-2 mb-2">
      <h3 class="text-[12.5px] font-bold text-slate-200">Prévia</h3>
      <span class="text-[10.5px] text-slate-500">enquadramento e legendas · ${esc(aspect)}</span>
      <span class="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-400">sem animação real de vídeo</span>
    </div>
    <div class="mx-auto" style="max-width:260px">
      <div class="relative w-full overflow-hidden rounded-xl border border-white/10 bg-slate-900" style="aspect-ratio:${ar}">
        ${thumb ? `<img src="${esc(thumb)}" alt="" class="absolute inset-0 w-full h-full object-cover opacity-75"/>` : '<div class="absolute inset-0 bg-gradient-to-b from-slate-800 to-slate-950"></div>'}
        <div class="absolute inset-0" style="display:flex;flex-direction:column;justify-content:${justify};align-items:center;padding:9%">${capBox}</div>
      </div>
    </div>
    ${chips}
    <div class="text-[10.5px] text-slate-500 mt-2">O vídeo renderizado depende do ffmpeg. Aqui você confere o enquadramento (${esc(aspect)}), o estilo e o texto das legendas.</div>
  </div>`;
}

/* Linha do tempo: cada corte posicionado no tempo do vídeo de origem. */
function renderDateTimeline(d, sel) {
  const cuts = (d.plan && d.plan.cuts) || [];
  const sourceDur = (d.sourceInfo && Number(d.sourceInfo.duration)) || 0;
  const total = Math.max(1, sourceDur, ...cuts.map((c) => Number(c.end) || 0));
  const bars = cuts.map((c) => {
    const left = Math.min(100, (c.start / total) * 100);
    const width = Math.max(0.7, Math.min(100 - left, ((c.duration || 0) / total) * 100));
    const on = c.index === sel.index;
    const state = (d.cutStates || {})[c.index] || 'pendente';
    const tone = state === 'aprovado' ? 'bg-emerald-400/70' : (state === 'descartado' ? 'bg-rose-400/60' : 'bg-violet-400/70');
    return `<button data-ac-act="ed-select" data-index="${esc(c.index)}" title="Corte #${esc(c.index)} · ${esc(c.start)}s–${esc(c.end)}s"
      class="absolute top-0 h-full rounded ${tone} ${on ? 'ring-2 ring-fuchsia-300' : ''}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></button>`;
  }).join('');
  return `<div class="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
    <div class="flex items-center gap-2 mb-2">
      <h3 class="text-[12.5px] font-bold text-slate-200">Linha do tempo</h3>
      <span class="text-[10.5px] text-slate-500">${cuts.length} corte(s) · ${esc(fmtDur(total))} de origem</span>
      <span class="ml-auto text-[10px] text-slate-500">roxo = pendente · verde = aprovado · vermelho = descartado</span>
    </div>
    <div class="relative h-7 rounded-lg bg-black/40 border border-white/10 overflow-hidden">${bars}</div>
  </div>`;
}

/* Ferramentas laterais do corte selecionado + legendas editáveis. */
function renderDateTools(d, sel, cfg) {
  const job = d.job || {};
  const caps = (sel && sel.captions) || [];
  const lines = caps.map((c) => [c.start, c.end, c.text].join('|')).join('\n');
  const state = (d.cutStates || {})[sel.index] || 'pendente';
  const hist = (d.history && typeof d.history === 'object') ? d.history : {};

  const cutList = ((d.plan && d.plan.cuts) || []).map((c) => `
    <button data-ac-act="ed-select" data-index="${esc(c.index)}" class="text-left w-full px-2 py-1.5 rounded-lg border ${c.index === sel.index ? 'border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-100' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}">
      <span class="font-semibold">#${esc(c.index)}</span> · ${esc(fmtDur(c.duration))} · score ${esc(c.score)}
      <span class="block text-[10px] text-slate-500 truncate">${esc(c.title)}</span>
    </button>`).join('');

  return `<div class="rounded-2xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <h3 class="text-[12.5px] font-bold text-slate-200">Editor</h3>
      ${badge(state)}
      <div class="ml-auto flex items-center gap-1">
        <button data-ac-act="ed-undo" ${hist.canUndo ? '' : 'disabled'} class="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-300 disabled:opacity-40" title="${esc(hist.undoLabel || '')}">Desfazer</button>
        <button data-ac-act="ed-redo" ${hist.canRedo ? '' : 'disabled'} class="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-300 disabled:opacity-40" title="${esc(hist.redoLabel || '')}">Refazer</button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3">
      <div class="space-y-1 max-h-[320px] overflow-auto pr-1">${cutList}</div>

      <div class="space-y-3">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label class="text-[10.5px] text-slate-400">Início (s)
            <input id="ac-ed-start" type="number" step="0.1" min="0" value="${esc(sel.start)}" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-slate-100"/></label>
          <label class="text-[10.5px] text-slate-400">Fim (s)
            <input id="ac-ed-end" type="number" step="0.1" min="0" value="${esc(sel.end)}" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-slate-100"/></label>
          <label class="text-[10.5px] text-slate-400 col-span-2">Título do corte
            <input id="ac-ed-title" type="text" value="${esc(sel.title)}" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-slate-100"/></label>
        </div>

        <label class="block text-[10.5px] text-slate-400">Legendas do corte (uma por linha: <code>início|fim|texto</code>)
          <textarea id="ac-ed-captions" rows="5" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100 font-mono">${esc(lines)}</textarea></label>

        <div class="flex flex-wrap items-center gap-2">
          <button data-ac-act="ed-save-cut" data-id="${esc(job.id)}" data-index="${esc(sel.index)}" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Salvar corte</button>
          <button data-ac-act="cut-state" data-id="${esc(job.id)}" data-index="${esc(sel.index)}" data-state="aprovado" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 text-emerald-200">Aprovar</button>
          <button data-ac-act="cut-state" data-id="${esc(job.id)}" data-index="${esc(sel.index)}" data-state="descartado" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-rose-400/25 bg-rose-500/10 text-rose-200">Descartar</button>
          <button data-ac-act="ed-srt" data-id="${esc(job.id)}" data-index="${esc(sel.index)}" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-300">Ver legendas (.srt)</button>
          <label class="ml-auto text-[10.5px] text-slate-400 flex items-center gap-1">Legendas ativas
            <input id="ac-ed-enabled" type="checkbox" ${cfg.enabled ? 'checked' : ''} class="accent-violet-500"/></label>
        </div>
      </div>
    </div>

    <div class="rounded-xl border border-white/10 bg-black/20 p-2.5">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11.5px] font-semibold text-slate-200">Estilo das legendas</span>
        <span class="text-[10.5px] text-slate-500">${esc(capStyleDef(cfg.style).label)} · ${esc(capAnimLabel(cfg.animation))}</span>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
        <label class="text-[10.5px] text-slate-400">Estilo
          <select id="ac-ed-style" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100">${opt(capCatalog().styles, cfg.style, (s) => s.label)}</select></label>
        <label class="text-[10.5px] text-slate-400">Animação
          <select id="ac-ed-anim" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100">${opt(capCatalog().animations, cfg.animation, (a) => a.label)}</select></label>
        <label class="text-[10.5px] text-slate-400">Posição
          <select id="ac-ed-pos" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100">${opt(capCatalog().positions, cfg.position, (p) => p.label)}</select></label>
        <label class="text-[10.5px] text-slate-400">Caracteres por bloco
          <input id="ac-ed-maxchars" type="number" min="12" max="60" value="${esc(cfg.maxChars)}" class="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-slate-100"/></label>
      </div>
      <div class="flex flex-wrap items-center gap-2 mt-2">
        <label class="text-[10.5px] text-slate-400 flex items-center gap-1">Texto em CAIXA ALTA
          <input id="ac-ed-uppercase" type="checkbox" ${cfg.uppercase ? 'checked' : ''} class="accent-violet-500"/></label>
        <button data-ac-act="ed-save-captions" data-id="${esc(job.id)}" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold">Aplicar legendas</button>
        <button data-ac-act="ed-save-default" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-300">Salvar como estilo padrão</button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <span class="text-[10.5px] text-slate-400">Ordem dos cortes</span>
      <select id="ac-ed-order" class="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11.5px] text-slate-100">
        ${Object.keys(ORDER_LABELS).map((k) => `<option value="${esc(k)}" ${((d.plan && d.plan.order) || 'score') === k ? 'selected' : ''}>${esc(ORDER_LABELS[k])}</option>`).join('')}
      </select>
      <button data-ac-act="ed-order" data-id="${esc(job.id)}" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-300">Aplicar ordem</button>
      ${d.plan && d.plan.editedAt ? `<span class="text-[10.5px] text-slate-500">editado em ${esc(fmtDate(d.plan.editedAt))}</span>` : ''}
    </div>

    ${STATE.editor.srt && STATE.editor.srtIndex === sel.index ? `<div class="rounded-xl border border-white/10 bg-black/30 p-2">
      <div class="text-[10.5px] text-slate-400 mb-1">Arquivo .srt do corte #${esc(sel.index)}</div>
      <pre class="text-[10.5px] text-slate-300 whitespace-pre-wrap max-h-[220px] overflow-auto">${esc(STATE.editor.srt)}</pre>
      ${STATE.editor.forceStyle ? `<div class="text-[10px] text-slate-500 mt-1 break-all">force_style: ${esc(STATE.editor.forceStyle)}</div>` : ''}
    </div>` : ''}
  </div>`;
}

function renderEditor(d) {
  if (!d || !d.plan || !Array.isArray(d.plan.cuts) || !d.plan.cuts.length) return '';
  const cfg = d.captionConfig || d.plan.captionConfig || { enabled: true, style: 'padrao', animation: 'aparecer', position: 'inferior', maxChars: 42, uppercase: false };
  const cuts = d.plan.cuts;
  const sel = cuts.find((c) => c.index === STATE.editor.cut) || cuts[0];
  return `<section class="space-y-3">
    <div class="flex items-center gap-2">
      <h2 class="text-[13px] font-bold text-fuchsia-200">Produção e edição</h2>
      <span class="text-[11px] text-slate-500">ajuste cortes, ordem e legendas — cada alteração fica no histórico</span>
    </div>
    ${renderDatePreview(d, sel, cfg)}
    ${renderDateTimeline(d, sel)}
    ${renderDateTools(d, sel, cfg)}
  </section>`;
}

/* ================= 3. Meus cortes ================= */
function renderCuts() {
  const c = STATE.cuts;
  if (!c) return '<div class="text-[12px] text-slate-400">Carregando…</div>';
  const f = STATE.cutFilter;
  const items = (c.items || []).filter((x) => f === 'todos' || x.state === f);

  const tabs = [['todos', 'Todos'], ['pendente', 'Aguardando'], ['aprovado', 'Aprovados'], ['descartado', 'Descartados']]
    .map(([k, label]) => `<button data-ac-act="cut-filter" data-filter="${esc(k)}" class="text-[11.5px] px-3 py-1.5 rounded-lg border ${f === k ? 'border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-100 font-semibold' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}">${esc(label)}${k === 'pendente' ? ' (' + c.pending + ')' : ''}</button>`).join('');

  const rows = items.map((x) => `
    <div class="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-semibold text-slate-100">#${esc(x.index)} · ${esc(x.title)}</span>
        ${badge(x.state)}
        <span class="text-[10.5px] text-sky-300">score ${esc(x.score)}</span>
        <span class="text-[10.5px] text-slate-500">${esc(fmtDur(x.duration))} · ${esc(x.captionsCount)} legenda(s)</span>
        <span class="ml-auto flex items-center gap-1">
          <button data-ac-act="cut-state" data-id="${esc(x.jobId)}" data-index="${esc(x.index)}" data-state="aprovado" class="text-[10.5px] px-2 py-0.5 rounded border border-emerald-400/25 bg-emerald-500/10 text-emerald-200">Aprovar</button>
          <button data-ac-act="cut-state" data-id="${esc(x.jobId)}" data-index="${esc(x.index)}" data-state="descartado" class="text-[10.5px] px-2 py-0.5 rounded border border-rose-400/25 bg-rose-500/10 text-rose-200">Descartar</button>
          <button data-ac-act="open" data-id="${esc(x.jobId)}" class="text-[10.5px] px-2 py-0.5 rounded border border-white/10 bg-white/5 text-slate-300">Abrir vídeo</button>
        </span>
      </div>
      <div class="text-[10.5px] text-slate-500 mt-0.5">${esc(x.jobTitle)} · ${esc(fmtDate(x.updatedAt))}${x.renderState ? ' · render: ' + esc(x.renderState) : ''}</div>
    </div>`).join('');

  return `<div class="max-w-[1080px] space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <h2 class="text-[13px] font-bold text-fuchsia-200">Meus cortes</h2>
      <span class="text-[11px] text-slate-500">${c.total} corte(s) · ${c.approved} aprovado(s)</span>
    </div>
    <div class="flex items-center gap-1.5 flex-wrap">${tabs}</div>
    ${items.length ? `<div class="space-y-2">${rows}</div>` : empty('Nenhum corte neste filtro.')}
  </div>`;
}

/* ================= 4. Agendamentos ================= */
function renderSchedule() {
  const cal = STATE.calendar;
  const tz = (cal && cal.timezone) || 'America/Sao_Paulo';
  const days = (cal && cal.days) || [];
  const dayRows = days.map((d) => `
    <div class="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
      <div class="text-[11px] font-bold text-sky-200">${esc(d.date)}</div>
      <div class="space-y-1.5 mt-1.5">
        ${d.items.map((p) => `
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full ${p.status === 'publicado' ? 'bg-emerald-300' : p.status === 'erro' ? 'bg-rose-300' : 'bg-sky-300'}"></span>
            <span class="text-[11.5px] text-slate-200 truncate">${esc(p.title)}</span>
            ${badge(p.status)}
            <span class="ml-auto text-[10.5px] text-slate-500">${esc(p.local || fmtDate(p.scheduledAt))}</span>
            ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="text-[10.5px] text-sky-300 hover:underline">link</a>` : ''}
          </div>`).join('')}
      </div>
    </div>`).join('');

  return `<div class="max-w-[1080px] space-y-3">
    <h2 class="text-[13px] font-bold text-fuchsia-200">Agendamentos</h2>
    ${note('Agendamento real', 'Ao agendar, o vídeo é enviado já como privado com horário oficial (publishAt). A plataforma publica sozinha no momento escolhido. Fuso de exibição: ' + tz + '.')}
    ${days.length ? `<div class="space-y-2">${dayRows}</div>` : empty('Nenhuma publicação agendada. Use a aba Publicações para compor um lote e agendar.')}
  </div>`;
}

/* ================= 5. Publicações ================= */
function pubRow(p, withRetry) {
  const url = p.url || (p.videoId ? ('https://www.youtube.com/watch?v=' + p.videoId) : '');
  const retryable = withRetry && p.status === 'erro' && (p.attempts || 0) < 3;
  return `<div class="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
    <div class="flex items-center gap-2 flex-wrap">
      <span class="text-[12px] text-slate-100 truncate">${esc((p.snippet && p.snippet.title) || 'Publicação')}</span>
      ${badge(p.status)}
      <span class="text-[10.5px] text-slate-500">${esc(p.visibility || '')}${p.attempts ? ' · tentativa ' + esc(p.attempts) : ''}</span>
      <span class="ml-auto flex items-center gap-1">
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="text-[10.5px] px-2 py-0.5 rounded border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10">Ver</a>` : ''}
        ${retryable ? `<button data-ac-act="pub-retry" data-id="${esc(p.id)}" class="text-[10.5px] px-2 py-0.5 rounded border border-amber-400/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20">Tentar de novo</button>` : ''}
        ${p.videoId ? `<button data-ac-act="republish" data-id="${esc(p.id)}" class="text-[10.5px] px-2 py-0.5 rounded border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10">Visibilidade</button>` : ''}
        <button data-ac-act="pub-remove" data-id="${esc(p.id)}" class="text-[10.5px] px-2 py-0.5 rounded border border-rose-400/20 bg-rose-500/5 text-rose-300 hover:bg-rose-500/15">Remover</button>
      </span>
    </div>
    <div class="text-[10.5px] text-slate-500 mt-0.5">
      ${esc(p.accountId ? ('conta ' + p.accountId + ' · ') : '')}${esc(fmtDate(p.publishedAt || p.scheduledAt || p.createdAt))}
      ${p.error ? ' · <span class="text-rose-300">' + esc(p.error) + '</span>' : ''}
      ${p.nextAttemptAt ? ' · nova tentativa: ' + esc(fmtDate(p.nextAttemptAt)) : ''}
    </div>
  </div>`;
}

function batchComposer() {
  const jobs = (STATE.jobs || []).filter((j) => j.plan && j.plan.cutsCount > 0);
  const accounts = STATE.accounts || [];
  const tzs = STATE.timezones.length ? STATE.timezones : ['America/Sao_Paulo', 'UTC'];

  const jobRows = jobs.map((j) => `
    <label class="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 cursor-pointer hover:bg-white/5">
      <input type="checkbox" data-ac-job="${esc(j.id)}" class="accent-fuchsia-500" />
      <span class="text-[11.5px] text-slate-200 truncate">${esc(j.title)}</span>
      <span class="ml-auto text-[10.5px] text-slate-500 shrink-0">${esc(j.plan.cutsCount)} corte(s)${j.render ? ' · render ' + esc(j.render.state || '') : ''}</span>
    </label>`).join('');

  const acctRows = accounts.map((a) => `
    <label class="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 cursor-pointer hover:bg-white/5">
      <input type="checkbox" data-ac-acct="${esc(a.id)}" class="accent-fuchsia-500" ${a.primary ? 'checked' : ''} />
      <span class="text-[11.5px] text-slate-200 truncate">${esc((a.account && a.account.name) || a.id)}</span>
      <span class="ml-auto text-[10.5px] text-slate-500 shrink-0">${esc(a.platformLabel || a.platform || '')}</span>
    </label>`).join('');

  const scheduleFields = `
    <div id="ac-batch-sched" class="grid grid-cols-3 gap-2 ${STATE.batchMode === 'schedule' ? '' : 'hidden'}">
      <input id="ac-batch-date" type="date" class="rounded-lg bg-black/30 border border-white/10 px-2 py-1.5 text-[11.5px] text-slate-200" />
      <input id="ac-batch-time" type="time" class="rounded-lg bg-black/30 border border-white/10 px-2 py-1.5 text-[11.5px] text-slate-200" />
      <select id="ac-batch-tz" class="rounded-lg bg-black/30 border border-white/10 px-2 py-1.5 text-[11.5px] text-slate-200">
        ${tzs.map((z) => `<option value="${esc(z)}" ${z === 'America/Sao_Paulo' ? 'selected' : ''}>${esc(z)}</option>`).join('')}
      </select>
    </div>`;

  return block('Publicar em lote', `
    ${accounts.length ? '' : `<div class="mb-2 rounded-lg border border-amber-400/20 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200">Nenhuma conta conectada. Conecte uma em "Minhas redes sociais" para publicar.</div>`}
    <div class="grid md:grid-cols-2 gap-3">
      <div>
        <div class="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1">1. Vídeos/cortes</div>
        <div class="space-y-1 max-h-52 overflow-auto">${jobRows || empty('Nenhuma tarefa com cortes.')}</div>
      </div>
      <div>
        <div class="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1">2. Redes e contas</div>
        <div class="space-y-1 max-h-52 overflow-auto">${acctRows || empty('Nenhuma conta conectada.')}</div>
      </div>
    </div>
    <div class="mt-3 grid md:grid-cols-3 gap-2 items-end">
      <div>
        <div class="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1">3. Quando</div>
        <select id="ac-batch-mode" class="w-full rounded-lg bg-black/30 border border-white/10 px-2 py-1.5 text-[11.5px] text-slate-200">
          <option value="now" ${STATE.batchMode === 'now' ? 'selected' : ''}>Publicar agora</option>
          <option value="schedule" ${STATE.batchMode === 'schedule' ? 'selected' : ''}>Agendar data/hora</option>
        </select>
      </div>
      <div>
        <div class="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Visibilidade</div>
        <select id="ac-batch-vis" class="w-full rounded-lg bg-black/30 border border-white/10 px-2 py-1.5 text-[11.5px] text-slate-200">
          <option value="private">Privado</option>
          <option value="unlisted">Não listado</option>
          <option value="public">Público</option>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <button data-ac-act="batch-preview" class="text-[11.5px] px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200">Pré-visualizar</button>
        <button data-ac-act="batch-run" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Publicar lote</button>
      </div>
    </div>
    <div class="mt-2">${scheduleFields}</div>
    ${STATE.batchPreview ? `<div class="mt-2 rounded-xl border border-sky-400/20 bg-sky-500/5 px-3 py-2 text-[11.5px] text-sky-200">
      Pré-visualização: ${esc(STATE.batchPreview.counts.cuts)} vídeo(s) × ${esc(STATE.batchPreview.counts.accounts)} conta(s) = <b>${esc(STATE.batchPreview.counts.targets)}</b> publicação(ões)${STATE.batchPreview.scheduledAt ? ' agendada(s) para ' + esc(fmtDate(STATE.batchPreview.scheduledAt)) : ''}.
      ${STATE.batchPreview.issues.length ? '<span class="block text-amber-200 mt-1">' + esc(STATE.batchPreview.issues.join(' ')) + '</span>' : ''}</div>` : ''}
    ${STATE.batchResult ? batchResultBox(STATE.batchResult) : ''}
  `);
}

function batchResultBox(r) {
  const rows = (r.results || []).map((x) => `
    <div class="flex items-center gap-2 text-[11px]">
      <span class="${x.ok ? 'text-emerald-300' : 'text-rose-300'}">${x.ok ? 'OK' : 'falhou'}</span>
      <span class="text-slate-300 truncate">${esc(x.title || x.jobId || 'corte')}</span>
      ${x.accountName ? `<span class="text-slate-500">→ ${esc(x.accountName)}</span>` : ''}
      ${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener" class="text-sky-300 hover:underline ml-auto">ver</a>` : `<span class="text-slate-500 ml-auto">${esc(x.reason || x.code || '')}</span>`}
    </div>`).join('');
  return `<div class="mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
    <div class="text-[11.5px] font-semibold text-slate-200 mb-1">Resultado do lote: ${esc(r.counts.ok)}/${esc(r.counts.total)} confirmadas</div>
    <div class="space-y-1">${rows}</div>
  </div>`;
}

function renderPubs() {
  const c = STATE.center;
  const counts = (c && c.counts) || null;
  const recent = (c && c.recent) || (STATE.pubs || []);
  const failed = (c && c.failed) || [];
  const upcoming = (c && c.upcoming) || [];

  const stat = counts ? `<div class="grid grid-cols-2 md:grid-cols-4 gap-2">
    ${card('Publicadas', counts.publicado, '', 'emerald')}
    ${card('Agendadas', counts.agendado, '', 'sky')}
    ${card('Com erro', counts.erro, counts.bloqueado ? counts.bloqueado + ' bloqueada(s)' : '', 'amber')}
    ${card('Total', counts.total, c.retryPending ? c.retryPending + ' retry pendente(s)' : '', 'violet')}
  </div>` : '';

  return `<div class="max-w-[1080px] space-y-3">
    <h2 class="text-[13px] font-bold text-fuchsia-200">Publicações</h2>
    ${note('Registro honesto', 'Uma publicação só é marcada como concluída quando a plataforma confirma (HTTP + id do vídeo). Falhas aparecem com o motivo real e podem ser repetidas — nunca duplicamos o mesmo corte na mesma conta.')}
    ${stat}
    ${batchComposer()}
    ${failed.length ? block('Falhas e bloqueios', `<div class="space-y-2">${failed.slice(0, 20).map((p) => pubRow(p, true)).join('')}</div>`) : ''}
    ${upcoming.length ? block('Agendadas', `<div class="space-y-2">${upcoming.slice(0, 20).map((p) => pubRow(p, false)).join('')}</div>`) : ''}
    ${block('Histórico', recent.length ? `<div class="space-y-2">${recent.slice(0, 40).map((p) => pubRow(p, true)).join('')}</div>` : empty('Nenhuma publicação registrada ainda.'))}
  </div>`;
}

/* ================= 6. Minhas redes sociais ================= */
const ACCT_TONE = {
  conectado: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200',
  expirado: 'border-amber-400/30 bg-amber-500/15 text-amber-200',
  revogado: 'border-rose-400/30 bg-rose-500/15 text-rose-200',
};
function acctBadge(status) {
  const s = String(status || 'desconhecido');
  const tone = ACCT_TONE[s] || 'border-slate-400/30 bg-white/5 text-slate-300';
  return `<span class="text-[10.5px] px-2 py-0.5 rounded-full border ${tone} font-semibold">${esc(s)}</span>`;
}

function accountRow(a) {
  const id = a.id;
  const nm = (a.account && a.account.name) || '(sem nome)';
  const handle = a.account && a.account.handle ? a.account.handle : '';
  const avatar = a.account && a.account.avatar ? a.account.avatar : '';
  const perms = (a.permissions || []).join(', ') || '—';
  return `<div class="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
    <div class="flex items-center gap-2">
      ${avatar ? `<img src="${esc(avatar)}" alt="" class="w-7 h-7 rounded-full object-cover border border-white/10" />` : '<span class="w-7 h-7 rounded-full bg-white/10 border border-white/10"></span>'}
      <span class="text-[12px] font-semibold text-slate-100 truncate">${esc(nm)}</span>
      ${handle ? `<span class="text-[10.5px] text-slate-500 truncate">${esc(handle)}</span>` : ''}
      ${a.primary ? '<span class="text-[10px] px-1.5 py-0.5 rounded-full border border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-200">principal</span>' : ''}
      <span class="ml-auto">${acctBadge(a.status)}</span>
    </div>
    <div class="text-[10.5px] text-slate-500 mt-1">Permissões: ${esc(perms)}</div>
    ${a.connectedAt ? `<div class="text-[10.5px] text-slate-600 mt-0.5">Conectado em ${esc(fmtDate(a.connectedAt))}${a.expiresAt ? ' · token até ' + esc(fmtDate(a.expiresAt)) : ''}</div>` : ''}
    <div class="flex items-center gap-1 mt-2">
      <button data-ac-act="acct-refresh" data-id="${esc(id)}" class="text-[11px] px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Reconectar</button>
      ${!a.primary ? `<button data-ac-act="acct-primary" data-id="${esc(id)}" class="text-[11px] px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Tornar principal</button>` : ''}
      <button data-ac-act="acct-disconnect" data-id="${esc(id)}" class="text-[11px] px-2.5 py-1 rounded-lg border border-rose-400/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-300">Desconectar</button>
    </div>
  </div>`;
}

function platformCard(p) {
  const accounts = (STATE.accounts || []).filter((a) => a.platform === p.id);
  const connected = accounts.length > 0;
  const implemented = p.canConnect !== undefined ? p.canConnect : !!p.oauthImplemented;
  const ready = !!p.configured;
  const statusTone = !implemented
    ? 'border-slate-500/30 bg-white/5 text-slate-400'
    : (connected ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200' : (ready ? 'border-amber-400/30 bg-amber-500/15 text-amber-200' : 'border-rose-400/30 bg-rose-500/10 text-rose-200'));
  const statusText = !implemented
    ? 'não implementado'
    : (connected ? connected + ' conta(s)' : (ready ? 'pronto para conectar' : 'não configurado'));

  return `<div class="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
    <div class="flex items-center gap-2 flex-wrap">
      <span class="text-[12.5px] font-bold text-slate-100">${esc(p.label)}</span>
      <span class="text-[10.5px] px-2 py-0.5 rounded-full border ${statusTone}">${esc(statusText)}</span>
      <div class="ml-auto">
        ${implemented
          ? (ready
              ? `<button data-ac-act="yt-connect" data-platform="${esc(p.id)}" class="text-[11px] px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Conectar conta</button>`
              : `<button disabled title="Defina ${esc((p.envVars || []).join(', '))} no servidor" class="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 text-slate-500 cursor-not-allowed">Conectar conta</button>`)
          : `<span class="text-[10.5px] text-slate-500">requer aprovação/credenciais</span>`}
      </div>
    </div>
    <div class="text-[10.5px] text-slate-500 mt-1">Escopos: ${esc((p.scopes || []).join(', ') || '—')} · Variáveis: ${esc((p.envVars || []).join(', ') || '—')}</div>
    ${implemented && p.redirectUri ? `<div class="text-[10.5px] text-slate-500 mt-0.5">URL de callback: <code class="text-slate-400">${esc(p.redirectUri)}</code></div>` : ''}
    ${p.blockedReason ? `<div class="mt-1 rounded-lg border border-amber-400/20 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200">${esc(p.blockedReason)}</div>` : ''}
    ${implemented ? `<div class="mt-1 text-[10.5px] text-slate-500">${esc(p.publishNote || '')}</div>` : ''}
    ${connected ? `<div class="space-y-2 mt-2">${accounts.map(accountRow).join('')}</div>` : ''}
  </div>`;
}

function renderSocial() {
  const fallback = NETWORKS.map((n) => ({ id: n.id, label: n.label, oauthImplemented: n.ready, canConnect: n.ready, configured: n.ready, scopes: [], envVars: [], blockedReason: n.ready ? null : 'requer credenciais e aprovação da plataforma' }));
  const platforms = (STATE.platforms && STATE.platforms.length) ? STATE.platforms : fallback;
  const total = (STATE.accounts || []).length;
  return `<div class="max-w-[1080px] space-y-3">
    <h2 class="text-[13px] font-bold text-fuchsia-200">Minhas redes sociais</h2>
    ${note('Autenticação oficial', 'Usamos OAuth e APIs oficiais. Nenhuma senha de rede social é pedida ou armazenada; apenas tokens, guardados criptografados, com renovação e revogação. É possível conectar várias contas da mesma rede.')}
    <div class="text-[11.5px] text-slate-400">${esc(total)} conta(s) conectada(s) no total.</div>
    <div class="space-y-2">${platforms.map(platformCard).join('')}</div>
  </div>`;
}

/* ================= 7. Monitoramento ================= */
function renderMonitoring() {
  const yt = STATE.yt;
  const ac = yt && yt.config && yt.config.auto ? yt.config.auto : (yt && yt.config ? yt.config : null);
  return `<div class="max-w-[1080px] space-y-3">
    <h2 class="text-[13px] font-bold text-fuchsia-200">Monitoramento</h2>
    ${note('O que existe hoje', 'O módulo YouTube já executa a publicação automática de cortes por fila e agendador próprios. O monitoramento de canais/perfis conectados (buscar vídeos novos e enfileirar para análise) ainda não está implementado — por isso não há botão que prometa isso.')}
    ${ac ? block('Regras atuais do agendador', `<div class="text-[11px] text-slate-400">Publicação automática: <b class="${ac.enabled ? 'text-emerald-300' : 'text-amber-300'}">${ac.enabled ? 'ligada' : 'desligada'}</b>${ac.minScore !== undefined ? ' · nota mínima ' + esc(ac.minScore) : ''}${ac.dailyLimit !== undefined ? ' · limite diário ' + esc(ac.dailyLimit) : ''}</div>`) : ''}
    <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-[11.5px] text-slate-400">
      Próximos passos previstos: verificar periodicamente novos vídeos das contas conectadas, enfileirar automaticamente para análise e notificar — sempre sem reprocessar vídeos antigos e respeitando os limites oficiais das APIs.
    </div>
  </div>`;
}

/* ================= 8. Modelos de publicação ================= */
function renderTemplates() {
  return `<div class="max-w-[1080px] space-y-3">
    <h2 class="text-[13px] font-bold text-fuchsia-200">Modelos de publicação</h2>
    ${note('Ainda não implementado', 'Os modelos (redes e contas, horários, formato, estilo de legendas, música, capa e preferências de descrição) fazem parte da etapa de automação e ainda não foram implementados. Esta tela existe para não esconder a pendência.')}
    <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-[11.5px] text-slate-400">
      O que o modelo vai guardar: redes e contas, horários e dias, publicação imediata ou agendada, formato de vídeo, estilo de legendas, música, modelo de capa e preferências de descrição/hashtags.
    </div>
  </div>`;
}

/* ================= 9. Melhores horários ================= */
function renderBestTimes() {
  const recs = STATE.recs;
  const items = (recs && recs.items) || [];
  const rows = items.map((r) => `
    <div class="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div class="text-[12px] font-semibold text-slate-100">${esc(r.title)}</div>
      <div class="text-[11px] text-slate-400 mt-0.5">${esc(r.text)}</div>
    </div>`).join('');

  return `<div class="max-w-[1080px] space-y-3">
    <h2 class="text-[13px] font-bold text-fuchsia-200">Melhores horários</h2>
    ${note('Sem métricas, sem invenção', 'As recomendações abaixo usam apenas os dados reais já medidos das suas próprias publicações. Sem dados suficientes, nada é sugerido.')}
    ${items.length ? `<div class="space-y-2">${rows}</div>` : empty('Ainda não há dados suficientes para recomendar horários.')}
    ${recs && recs.disclaimer ? `<div class="text-[10.5px] text-slate-500">${esc(recs.disclaimer)}</div>` : ''}
  </div>`;
}

/* ================= 10. Configurações ================= */
function renderSettings() {
  const st = STATE.status || {};
  const ff = st.ffmpeg || {};
  const yt = STATE.yt || {};
  const profs = (STATE.profiles || []).map((p) => `
    <div class="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div class="text-[12px] font-semibold text-slate-100">${esc(p.label)}</div>
      <div class="text-[10.5px] text-slate-400">${esc(p.description)}</div>
      <div class="text-[10.5px] text-slate-500 mt-0.5">${esc(p.minDuration)}s–${esc(p.maxDuration)}s · até ${esc(p.maxCuts)} cortes · ${esc(p.aspect)} · nota mín. ${esc(p.minScore)}</div>
    </div>`).join('');

  return `<div class="max-w-[1080px] space-y-3">
    <h2 class="text-[13px] font-bold text-fuchsia-200">Configurações</h2>
    ${block('Ambiente',
      `<ul class="text-[11.5px] text-slate-400 space-y-1">
        <li>Render (ffmpeg): <b class="${ff.available ? 'text-emerald-300' : 'text-amber-300'}">${ff.available === true ? 'disponível ' + esc((ff.ffmpeg && ff.ffmpeg.version) || '') : (ff.available === false ? 'não instalado' : 'verificando…')}</b></li>
        <li>Fila: <b class="text-slate-200">${esc((st.queue && st.queue.maxAttempts) || 0)} tentativa(s) por tarefa</b></li>
        <li>Dados: <b class="text-slate-200">${esc(st.dataDir || '')}</b></li>
        <li>Memória inteligente integrada: <b class="${st.memory ? 'text-emerald-300' : 'text-slate-400'}">${st.memory ? 'sim' : 'não'}</b></li>
        <li>Credenciais OAuth do YouTube: <b class="${yt.configured ? 'text-emerald-300' : 'text-amber-300'}">${yt.configured ? 'configuradas' : 'ausentes (YT_CLIENT_ID / YT_CLIENT_SECRET)'}</b></li>
      </ul>`)}
    ${block('Perfis de edição disponíveis', `<div class="grid grid-cols-1 md:grid-cols-2 gap-2">${profs}</div>`)}
    ${renderMusic()}
    ${block('Sobre o render', `<div class="text-[11.5px] text-slate-400">${esc(st.renderNote || '')}</div>`)}
  </div>`;
}

/* ================= Músicas (biblioteca honesta) ================= */
function renderMusic() {
  const m = STATE.music || {};
  const tracks = m.user || [];
  const list = tracks.length
    ? `<ul class="space-y-1">${tracks.map((t) => `
        <li class="flex items-center gap-2 text-[11.5px] text-slate-300 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
          <span class="truncate flex-1"><b class="text-slate-200">${esc(t.title)}</b> · licença: ${esc(t.license)} · vol ${esc(Math.round((t.volume || 0) * 100))}%${t.ducking ? ' · abaixa nas falas' : ''}</span>
          <button data-ac-act="remove-music" data-id="${esc(t.id)}" class="px-2 py-0.5 rounded border border-rose-400/25 bg-rose-500/10 text-rose-200">Remover</button>
        </li>`).join('')}</ul>`
    : `<div class="text-[11px] text-slate-500">Nenhuma faixa registrada.</div>`;

  return block('Músicas', `
    <div class="text-[11px] text-amber-200 mb-2">${esc(m.note || '')}</div>
    ${list}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
      <input id="ac-music-title" type="text" class="rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-[12px] text-slate-100" placeholder="Título (opcional)"/>
      <input id="ac-music-url" type="text" class="rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-[12px] text-slate-100" placeholder="URL da faixa (http/https)"/>
      <input id="ac-music-license" type="text" class="rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-[12px] text-slate-100" placeholder="Licença (ex.: própria, CC0, licenciada)"/>
    </div>
    <label class="flex items-center gap-2 text-[11px] text-slate-300 mt-2">
      <input id="ac-music-confirm" type="checkbox" class="accent-violet-500"/> Confirmo que tenho autorização para usar esta faixa.
    </label>
    <div class="mt-2"><button data-ac-act="add-music" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold">Adicionar faixa</button></div>
    <div class="text-[10.5px] text-slate-500 mt-2">${esc(m.audioNote || '')}</div>`,
    'Biblioteca');
}

/* ---------------- parsing de entrada ---------------- */
function profileOptions(selected) {
  return STATE.profiles.map((p) => `<option value="${esc(p.key)}" ${p.key === selected ? 'selected' : ''}>${esc(p.label)} — ${esc(p.description)}</option>`).join('');
}

function parseSources(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf('|');
    if (i < 0) return { kind: 'local', value: line, label: line.split('/').pop() };
    const kind = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    return { kind: ['local', 'url', 'referencia'].includes(kind) ? kind : 'referencia', value, label: value.split('/').pop() };
  });
}

function parseTime(v) {
  const s = String(v || '').trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return NaN;
}

function parseTranscript(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (raw[0] === '[') { try { return JSON.parse(raw); } catch { /* modo linha */ } }
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const segs = [];
  for (const line of lines) {
    const i = line.indexOf('|');
    let start, txt;
    if (i >= 0) { start = parseTime(line.slice(0, i)); txt = line.slice(i + 1).trim(); }
    else { start = segs.length ? segs[segs.length - 1].end : 0; txt = line; }
    if (!Number.isFinite(start)) start = segs.length ? segs[segs.length - 1].end : 0;
    segs.push({ start, end: start + 8, text: txt });
  }
  return segs;
}

function parseEvidence(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split('|').map((x) => x.trim());
    return { type: parts[0] || 'texto', label: parts[1] || parts[0] || '', value: parts[2] || parts[1] || '' };
  });
}

/* ---------------- ações ---------------- */
async function refreshAll() {
  await loadStatus().catch(() => {});
  await Promise.all([loadOverview().catch(() => {}), loadJobs().catch(() => {}), loadCuts().catch(() => {}), loadYouTube(), loadRecs(), loadMusic(), loadCaptions()]);
  render();
}

async function goSection(id) {
  if (STATE.section !== id) STATE.job = null;
  STATE.section = id;
  render();
}

async function doIngest() {
  const urls = $('#ac-ingest-urls') ? $('#ac-ingest-urls').value : '';
  if (!String(urls).trim()) { toast('Cole pelo menos uma URL de vídeo.', 'warn'); return; }
  const durSel = $('#ac-ingest-duration') ? $('#ac-ingest-duration').value : '60';
  const cutDuration = durSel === '0' ? Number($('#ac-ingest-custom') ? $('#ac-ingest-custom').value : 60) : Number(durSel);
  const body = {
    urls,
    profileKey: $('#ac-ingest-profile') ? $('#ac-ingest-profile').value : 'podcast',
    maxCuts: Number($('#ac-ingest-maxcuts') ? $('#ac-ingest-maxcuts').value : 6),
    cutDuration: Number.isFinite(cutDuration) && cutDuration > 0 ? cutDuration : 0,
    aspect: $('#ac-ingest-aspect') ? $('#ac-ingest-aspect').value : '9:16',
  };
  try {
    const r = await api('/ingest', { method: 'POST', body });
    if (r.created && r.created.length) toast(r.created.length + ' tarefa(s) criada(s). Envie a transcrição para analisar.', 'ok');
    if (r.invalid && r.invalid.length) toast(r.invalid.length + ' URL(s) recusada(s): ' + r.invalid[0].reason, 'warn');
    await refreshAll();
  } catch (e) { toast(e.message || 'Falha ao adicionar as URLs.', 'err'); }
}

async function doUploadLocal() {
  const input = $('#ac-upload-file');
  const file = input && input.files && input.files[0];
  if (!file) { toast('Selecione um arquivo de vídeo.', 'warn'); return; }
  const durSel = $('#ac-upload-duration') ? $('#ac-upload-duration').value : '60';
  const durNum = durSel === '0' ? Number($('#ac-upload-custom') ? $('#ac-upload-custom').value : 60) : Number(durSel);
  const fd = new FormData();
  fd.append('file', file);
  fd.append('title', $('#ac-upload-title') ? $('#ac-upload-title').value.trim() : '');
  fd.append('profileKey', $('#ac-upload-profile') ? $('#ac-upload-profile').value : 'podcast');
  fd.append('maxCuts', String(Number($('#ac-upload-maxcuts') ? $('#ac-upload-maxcuts').value : 6)));
  fd.append('cutDuration', String(Number.isFinite(durNum) && durNum > 0 ? durNum : 0));
  fd.append('aspect', $('#ac-upload-aspect') ? $('#ac-upload-aspect').value : '9:16');
  toast('Enviando vídeo… aguarde.', 'info');
  try {
    const r = await fetch(API + '/upload', { method: 'POST', body: fd });
    const data = await r.json().catch(() => ({ ok: false, reason: 'Resposta inválida do servidor.' }));
    if (!r.ok || data.ok === false) throw new Error(data.reason || 'Não foi possível enviar o vídeo.');
    if (input) input.value = '';
    const dur = data.local && data.local.duration ? ' (' + Math.round(data.local.duration) + 's)' : '';
    toast('Vídeo enviado e tarefa criada' + dur + '. Envie a transcrição para analisar.', 'ok');
    await refreshAll();
    if (data.job && data.job.id) await openJob(data.job.id);
  } catch (e) { toast(e.message || 'Falha ao enviar o vídeo.', 'err'); }
}

async function doCreate() {
  const title = $('#ac-title') ? $('#ac-title').value.trim() : '';
  if (!title) { toast('Informe um título para a tarefa.', 'warn'); return; }
  const body = {
    title,
    profile: { key: $('#ac-profile') ? $('#ac-profile').value : 'podcast' },
    sources: parseSources($('#ac-sources') ? $('#ac-sources').value : ''),
    transcript: parseTranscript($('#ac-transcript') ? $('#ac-transcript').value : ''),
  };
  try {
    const r = await api('/create', { method: 'POST', body });
    STATE.manual = false;
    toast('Tarefa criada.', 'ok');
    await refreshAll();
    await openJob(r.job.id);
  } catch (e) { toast(e.message || 'Falha ao criar a tarefa.', 'err'); }
}

async function doSaveRights(id) {
  if (!id) return;
  const rights = {};
  document.querySelectorAll('[data-ac-right]').forEach((sel) => { rights[sel.getAttribute('data-ac-right')] = sel.value; });
  const body = {
    rights,
    source: $('#ac-right-source') ? $('#ac-right-source').value.trim() : '',
    responsible: $('#ac-right-responsible') ? $('#ac-right-responsible').value.trim() : '',
    evidence: parseEvidence($('#ac-right-evidence') ? $('#ac-right-evidence').value : ''),
  };
  try {
    const r = await api('/job/' + encodeURIComponent(id) + '/rights', { method: 'PUT', body });
    toast(r.canProcess ? 'Direitos registrados — processamento liberado.' : 'Direitos registrados — processamento ainda bloqueado.', r.canProcess ? 'ok' : 'warn');
    await openJob(id);
  } catch (e) { toast(e.message || 'Falha ao salvar os direitos.', 'err'); }
}

async function doStep(id, step, label) {
  const path = { analyze: '/analyze', edit: '/edit', metadata: '/metadata', qa: '/qa' }[step];
  if (!path) return;
  try {
    await api('/job/' + encodeURIComponent(id) + path, { method: 'POST', body: {} });
    toast(label + ' concluído.', 'ok');
    await openJob(id);
  } catch (e) { toast(e.message || ('Falha em ' + label + '.'), 'err'); }
}

async function doJobProfile(id) {
  const sel = $('#ac-job-profile');
  if (!sel) return;
  try {
    await api('/job/' + encodeURIComponent(id) + '/edit', { method: 'POST', body: { profile: { key: sel.value } } });
    toast('Perfil aplicado.', 'ok');
    await openJob(id);
  } catch (e) { toast(e.message || 'Falha ao aplicar o perfil.', 'err'); }
}

async function doRun(id) {
  try {
    await api('/job/' + encodeURIComponent(id) + '/process', { method: 'POST', body: {} });
    toast('Processamento iniciado.', 'ok');
    await openJob(id);
    startPolling(id);
  } catch (e) {
    if (e.code === 'direitos_insuficientes') toast('Bloqueado: verifique os direitos primeiro.', 'warn');
    else if (e.code === 'transcricao_ausente') toast('Sem transcrição — envie os segmentos.', 'warn');
    else toast(e.message || 'Falha ao processar.', 'err');
  }
}

async function doCutState(jobId, index, state) {
  try {
    await api('/job/' + encodeURIComponent(jobId) + '/cut/' + encodeURIComponent(index) + '/state', { method: 'POST', body: { state } });
    toast('Corte #' + index + ' → ' + state + '.', 'ok');
    await loadCuts().catch(() => {});
    await loadOverview().catch(() => {});
    if (STATE.job && STATE.job.job && STATE.job.job.id === jobId) await openJob(jobId);
    else render();
  } catch (e) { toast(e.message || 'Falha ao atualizar o corte.', 'err'); }
}

async function doRemove(id) {
  try {
    await api('/job/' + encodeURIComponent(id), { method: 'DELETE', body: {} });
    toast('Tarefa removida.', 'ok');
    STATE.job = null;
    await refreshAll();
  } catch (e) { toast(e.message || 'Falha ao remover.', 'err'); }
}

/* ---------------- Etapa 4: ações do editor ---------------- */
function edEl(id) { const el = document.getElementById(id); return el || null; }

function parseCaptionLines(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const raw = line.trim();
    if (!raw) continue;
    const parts = raw.split('|');
    if (parts.length < 3) continue;
    const start = Number(String(parts[0]).trim());
    const end = Number(String(parts[1]).trim());
    const txt = parts.slice(2).join('|').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !txt) continue;
    out.push({ start, end, text: txt });
  }
  return out;
}

async function doSaveCut(jobId, index) {
  if (!jobId) return;
  const start = Number(edEl('ac-ed-start') ? edEl('ac-ed-start').value : NaN);
  const end = Number(edEl('ac-ed-end') ? edEl('ac-ed-end').value : NaN);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { toast('Informe início e fim válidos (fim maior que o início).', 'warn'); return; }
  const title = edEl('ac-ed-title') ? edEl('ac-ed-title').value.trim() : '';
  const captions = parseCaptionLines(edEl('ac-ed-captions') ? edEl('ac-ed-captions').value : '');
  try {
    await api('/job/' + encodeURIComponent(jobId) + '/cut/' + encodeURIComponent(index), { method: 'POST', body: { start, end, title, captions } });
    toast('Corte #' + index + ' salvo.', 'ok');
    STATE.editor.srt = null;
    await openJob(jobId);
  } catch (e) { toast(e.message || 'Falha ao salvar o corte.', 'err'); }
}

async function doOrder(jobId) {
  if (!jobId) return;
  const order = edEl('ac-ed-order') ? edEl('ac-ed-order').value : 'score';
  try {
    await api('/job/' + encodeURIComponent(jobId) + '/order', { method: 'POST', body: { order } });
    toast('Ordem aplicada: ' + (ORDER_LABELS[order] || order) + '.', 'ok');
    await openJob(jobId);
  } catch (e) { toast(e.message || 'Falha ao reordenar.', 'err'); }
}

function captionFormValues() {
  return {
    enabled: edEl('ac-ed-enabled') ? edEl('ac-ed-enabled').checked : true,
    style: edEl('ac-ed-style') ? edEl('ac-ed-style').value : 'padrao',
    animation: edEl('ac-ed-anim') ? edEl('ac-ed-anim').value : 'nenhuma',
    position: edEl('ac-ed-pos') ? edEl('ac-ed-pos').value : 'inferior',
    maxChars: edEl('ac-ed-maxchars') ? Number(edEl('ac-ed-maxchars').value) : 42,
    uppercase: edEl('ac-ed-uppercase') ? edEl('ac-ed-uppercase').checked : false,
  };
}

async function doSaveCaptions(jobId) {
  if (!jobId) return;
  try {
    await api('/job/' + encodeURIComponent(jobId) + '/captions', { method: 'POST', body: captionFormValues() });
    toast('Estilo de legendas aplicado.', 'ok');
    await openJob(jobId);
  } catch (e) { toast(e.message || 'Falha ao aplicar as legendas.', 'err'); }
}

async function doSaveDefaultStyle() {
  try {
    const r = await api('/captions/default', { method: 'POST', body: captionFormValues() });
    toast('Estilo salvo como padrão: ' + ((r.described && r.described.styleLabel) || '') + '.', 'ok');
    await loadCaptions();
    render();
  } catch (e) { toast(e.message || 'Falha ao salvar o estilo padrão.', 'err'); }
}

async function doUndo(jobId) {
  if (!jobId) return;
  try {
    const r = await api('/job/' + encodeURIComponent(jobId) + '/undo', { method: 'POST', body: {} });
    toast('Desfeito: ' + (r.undone || 'edição') + '.', 'ok');
    await openJob(jobId);
  } catch (e) { toast(e.message || 'Nada para desfazer.', 'warn'); }
}

async function doRedo(jobId) {
  if (!jobId) return;
  try {
    const r = await api('/job/' + encodeURIComponent(jobId) + '/redo', { method: 'POST', body: {} });
    toast('Refeito: ' + (r.redone || 'edição') + '.', 'ok');
    await openJob(jobId);
  } catch (e) { toast(e.message || 'Nada para refazer.', 'warn'); }
}

async function doSrt(jobId, index) {
  if (!jobId) return;
  try {
    const r = await api('/job/' + encodeURIComponent(jobId) + '/cut/' + encodeURIComponent(index) + '/srt');
    STATE.editor.srt = r.srt || '';
    STATE.editor.forceStyle = r.forceStyle || '';
    STATE.editor.srtIndex = Number(index);
    render();
  } catch (e) { toast(e.message || 'Falha ao gerar as legendas.', 'err'); }
}

async function doEnrich(id) {
  if (!id) return;
  toast('Buscando dados públicos do vídeo…', 'info');
  try {
    await api('/job/' + encodeURIComponent(id) + '/enrich', { method: 'POST', body: {} });
    toast('Dados do vídeo atualizados.', 'ok');
    await openJob(id);
  } catch (e) { toast(e.message || 'Não foi possível ler os dados públicos do vídeo.', 'warn'); }
}

async function doSaveFormats(id) {
  if (!id) return;
  const aspects = [];
  document.querySelectorAll('[data-ac-fmt]').forEach((el) => { if (el.checked) aspects.push(el.getAttribute('data-ac-fmt')); });
  if (!aspects.length) { toast('Escolha ao menos um formato.', 'warn'); return; }
  try {
    await api('/job/' + encodeURIComponent(id) + '/formats', { method: 'POST', body: { aspects } });
    toast('Formatos salvos: ' + aspects.join(', ') + '.', 'ok');
    await openJob(id);
  } catch (e) { toast(e.message || 'Falha ao salvar formatos.', 'err'); }
}

async function doGenCovers(id) {
  if (!id) return;
  try {
    await api('/job/' + encodeURIComponent(id) + '/covers', { method: 'POST', body: {} });
    toast('Capas geradas (3 opções por corte).', 'ok');
    await openJob(id);
  } catch (e) { toast(e.message || 'Falha ao gerar capas.', 'err'); }
}

async function doAddMusic() {
  const url = $('#ac-music-url') ? $('#ac-music-url').value.trim() : '';
  const title = $('#ac-music-title') ? $('#ac-music-title').value.trim() : '';
  const license = $('#ac-music-license') ? $('#ac-music-license').value.trim() : '';
  const confirmRights = $('#ac-music-confirm') ? $('#ac-music-confirm').checked : false;
  try {
    await api('/music', { method: 'POST', body: { url, title, license, confirmRights } });
    toast('Faixa registrada.', 'ok');
    await loadMusic();
    render();
  } catch (e) { toast(e.message || 'Falha ao registrar a faixa.', 'warn'); }
}

async function doRemoveMusic(id) {
  if (!id) return;
  try {
    await api('/music/' + encodeURIComponent(id), { method: 'DELETE', body: {} });
    toast('Faixa removida.', 'ok');
    await loadMusic();
    render();
  } catch (e) { toast(e.message || 'Falha ao remover a faixa.', 'warn'); }
}

async function doYtConnect(platform = 'youtube') {
  try {
    const r = await api('/connect', { method: 'POST', body: { hostBase: location.origin, platform }, base: YT });
    if (!r || !r.url) throw new Error('URL de autorização não retornada.');
    // Redirecionamento de página inteira — mais confiável que popup
    // (evita ERR_BLOCKED_BY_RESPONSE / bloqueio de popups em mobile e túnel).
    location.href = r.url;
  } catch (e) {
    if (e.code === 'sem_credenciais') {
      const p = (STATE.platforms || []).find((x) => x.id === platform);
      const vars = (p && p.envVars && p.envVars.length) ? p.envVars.filter((v) => !/opcional/.test(v)).join(' e ') : 'as credenciais OAuth';
      toast('Credenciais OAuth ausentes: defina ' + vars + ' no servidor.', 'warn');
    } else if (e.code === 'nao_implementado') toast(e.message || 'Integração ainda não implementada para esta rede.', 'warn');
    else toast(e.message || 'Falha ao iniciar a conexão.', 'err');
  }
}

/* Ações por conta conectada (reconectar / desconectar / tornar principal). */
async function doAccountAction(kind, id) {
  if (!id) return;
  const paths = {
    refresh: '/accounts/' + encodeURIComponent(id) + '/refresh',
    disconnect: '/accounts/' + encodeURIComponent(id) + '/disconnect',
    primary: '/accounts/' + encodeURIComponent(id) + '/primary',
  };
  const labels = { refresh: 'Reconexão', disconnect: 'Desconexão', primary: 'Conta principal' };
  try {
    await api(paths[kind], { method: 'POST', body: {}, base: YT });
    toast(labels[kind] + ' concluída.', 'ok');
    await loadYouTube();
    render();
  } catch (e) { toast(e.message || ('Falha: ' + labels[kind]), 'err'); }
}

async function doRepublish(id) {
  const v = window.prompt('Visibilidade (private, unlisted ou public):', 'private');
  if (!v) return;
  try {
    await api('/publication/' + encodeURIComponent(id) + '/republish', { method: 'POST', body: { visibility: String(v).trim() } });
    toast('Visibilidade atualizada.', 'ok');
    await loadYouTube();
    render();
  } catch (e) { toast(e.message || 'Falha ao atualizar a visibilidade.', 'err'); }
}

/* ---------------- Publicação em lote e central (Etapa 6) ---------------- */
function readBatchInput() {
  const cuts = [];
  document.querySelectorAll('[data-ac-job]').forEach((el) => { if (el.checked) cuts.push({ jobId: el.getAttribute('data-ac-job') }); });
  const accountIds = [];
  document.querySelectorAll('[data-ac-acct]').forEach((el) => { if (el.checked) accountIds.push(el.getAttribute('data-ac-acct')); });
  const modeEl = $('#ac-batch-mode'); const visEl = $('#ac-batch-vis');
  const dateEl = $('#ac-batch-date'); const timeEl = $('#ac-batch-time'); const tzEl = $('#ac-batch-tz');
  return {
    cuts, accountIds,
    mode: modeEl ? modeEl.value : 'now',
    visibility: visEl ? visEl.value : 'private',
    date: dateEl ? dateEl.value : '',
    time: timeEl ? timeEl.value : '',
    timezone: tzEl ? tzEl.value : 'America/Sao_Paulo',
  };
}

async function doBatchPreview() {
  const body = readBatchInput();
  try {
    STATE.batchPreview = await api('/publish/preview', { method: 'POST', body, base: YT });
    STATE.batchResult = null;
    STATE.batchMode = body.mode;
    render();
  } catch (e) {
    /* A pré-visualização pode voltar com pendências (ok:false) — isso é informação, não falha. */
    if (e.raw && e.raw.counts) {
      STATE.batchPreview = e.raw;
      STATE.batchResult = null;
      STATE.batchMode = body.mode;
      render();
      const msg = (e.raw.issues && e.raw.issues.length) ? e.raw.issues[0] : 'Pré-visualização com pendências.';
      toast(msg, 'warn');
    } else { toast(e.message || 'Falha na pré-visualização.', 'err'); }
  }
}

async function doBatchRun() {
  const body = readBatchInput();
  if (!body.cuts.length) { toast('Selecione ao menos um vídeo/corte.', 'warn'); return; }
  if (!body.accountIds.length) { toast('Selecione ao menos uma conta.', 'warn'); return; }
  STATE.batchMode = body.mode;
  toast('Enviando lote… aguarde a confirmação da plataforma.', 'info');
  try {
    const r = await api('/publish/batch', { method: 'POST', body, base: YT });
    STATE.batchResult = r;
    STATE.batchPreview = null;
    if (r.ok) toast('Lote: ' + r.counts.ok + '/' + r.counts.total + ' publicação(ões) confirmada(s).', 'ok');
    else toast('O lote não produziu publicações confirmadas. Veja os motivos.', 'warn');
    await loadYouTube();
    render();
  } catch (e) { toast(e.message || 'Falha ao publicar o lote.', 'err'); }
}

async function doPubRetry(id) {
  if (!id) return;
  try {
    const r = await api('/publication/' + encodeURIComponent(id) + '/retry', { method: 'POST', body: {}, base: YT });
    toast(r.ok ? 'Publicação concluída na nova tentativa.' : ('Não foi possível concluir: ' + (r.reason || '')), r.ok ? 'ok' : 'warn');
    await loadYouTube();
    render();
  } catch (e) { toast(e.message || 'Falha ao tentar novamente.', 'err'); }
}

async function doPubRemove(id) {
  if (!id || !window.confirm('Remover este registro de publicação? (não apaga o vídeo na plataforma)')) return;
  try {
    await api('/publication/' + encodeURIComponent(id), { method: 'DELETE', body: {}, base: YT });
    toast('Registro removido.', 'ok');
    await loadYouTube();
    render();
  } catch (e) { toast(e.message || 'Falha ao remover o registro.', 'err'); }
}

/* ---------------- polling ---------------- */
function startPolling(id) {
  stopPolling();
  STATE.pollTimer = setInterval(async () => {
    try {
      const r = await api('/job/' + encodeURIComponent(id));
      STATE.job = r;
      const st = r.job && r.job.status;
      if (STATE.section === 'videos') render();
      if (!st || ['concluido', 'erro', 'revisao', 'renderizado', 'aguardando_render'].includes(st)) {
        stopPolling();
        await refreshAll();
        if (st === 'concluido') toast('Produção concluída. Render: ' + (r.render && r.render.state === 'pendente' ? 'pendente (ffmpeg ausente).' : 'ok.'), 'ok');
        else if (st === 'erro') toast('A tarefa terminou com erro.', 'err');
      }
    } catch { stopPolling(); }
  }, 1500);
}
function stopPolling() { if (STATE.pollTimer) { clearInterval(STATE.pollTimer); STATE.pollTimer = null; } }

/* ---------------- bind ---------------- */
function onClick(ev) {
  const t = ev.target.closest('[data-ac-act]');
  if (!t) return;
  const act = t.getAttribute('data-ac-act');
  const id = t.getAttribute('data-id');
  const index = t.getAttribute('data-index');

  if (act === 'go') goSection(t.getAttribute('data-section'));
  else if (act === 'reload') refreshAll().then(() => toast('Dados atualizados.', 'ok')).catch(() => {});
  else if (act === 'ingest') doIngest();
  else if (act === 'upload-local') doUploadLocal();
  else if (act === 'new-manual') { STATE.manual = true; STATE.job = null; render(); }
  else if (act === 'cancel-manual') { STATE.manual = false; render(); }
  else if (act === 'create') doCreate();
  else if (act === 'open') { stopPolling(); STATE.manual = false; openJob(id); }
  else if (act === 'back-videos') { STATE.job = null; render(); }
  else if (act === 'save-rights') doSaveRights(id);
  else if (act === 'analyze') doStep(id, 'analyze', 'Análise');
  else if (act === 'edit') { if ($('#ac-job-profile') && STATE.job) doJobProfile(id); else doStep(id, 'edit', 'Plano'); }
  else if (act === 'metadata') doStep(id, 'metadata', 'Metadados');
  else if (act === 'qa') doStep(id, 'qa', 'Controle de qualidade');
  else if (act === 'run') doRun(id);
  else if (act === 'remove') doRemove(id);
  else if (act === 'cut-state') doCutState(id, index, t.getAttribute('data-state'));
  else if (act === 'enrich') doEnrich(id);
  else if (act === 'save-formats') doSaveFormats(id);
  else if (act === 'gen-covers') doGenCovers(id);
  else if (act === 'add-music') doAddMusic();
  else if (act === 'remove-music') doRemoveMusic(id);
  else if (act === 'ed-select') { STATE.editor.cut = Number(index); STATE.editor.cap = 0; STATE.editor.srt = null; render(); }
  else if (act === 'ed-cap') { STATE.editor.cap = Number(index); render(); }
  else if (act === 'ed-save-cut') doSaveCut(id, index);
  else if (act === 'ed-order') doOrder(id);
  else if (act === 'ed-save-captions') doSaveCaptions(id);
  else if (act === 'ed-save-default') doSaveDefaultStyle();
  else if (act === 'ed-undo') doUndo(STATE.job && STATE.job.job ? STATE.job.job.id : null);
  else if (act === 'ed-redo') doRedo(STATE.job && STATE.job.job ? STATE.job.job.id : null);
  else if (act === 'ed-srt') doSrt(id, index);
  else if (act === 'cut-filter') { STATE.cutFilter = t.getAttribute('data-filter'); render(); }
  else if (act === 'yt-connect') doYtConnect(t.getAttribute('data-platform') || 'youtube');
  else if (act === 'acct-refresh') doAccountAction('refresh', id);
  else if (act === 'acct-disconnect') doAccountAction('disconnect', id);
  else if (act === 'acct-primary') doAccountAction('primary', id);
  else if (act === 'republish') doRepublish(id);
  else if (act === 'batch-preview') doBatchPreview();
  else if (act === 'batch-run') doBatchRun();
  else if (act === 'pub-retry') doPubRetry(id);
  else if (act === 'pub-remove') doPubRemove(id);
}

document.addEventListener('click', onClick);
document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (!el || !el.id) return;
  if (el.id === 'ac-menu-mobile') goSection(el.value);
  if (el.id === 'ac-batch-mode') {
    STATE.batchMode = el.value;
    const wrap = $('#ac-batch-sched');
    if (wrap) wrap.classList.toggle('hidden', el.value !== 'schedule');
  }
  if (el.id === 'ac-ingest-duration') {
    const wrap = $('#ac-ingest-custom-wrap');
    if (wrap) wrap.classList.toggle('hidden', el.value !== '0');
  }
  if (el.id === 'ac-upload-duration') {
    const wrap = $('#ac-upload-custom-wrap');
    if (wrap) wrap.classList.toggle('hidden', el.value !== '0');
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target && ev.target.id === 'ac-title') doCreate();
});

/* =========================================================
 * Hooks da aba (chamados por public/app.js)
 * =======================================================*/
window.__autoclipsOnTabOpen = function () {
  try {
    if (!STATE.inited) { STATE.inited = true; boot(); }
    else { refreshAll().catch(() => {}); }
  } catch (e) { console.error('[autoclips] open erro:', e); }
};
window.__autoclipsOnTabClose = function () { stopPolling(); };

async function boot() {
  try {
    await refreshAll();
  } catch (e) {
    render();
    toast('Não foi possível carregar o AutoClips: ' + (e.message || ''), 'err');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { if ($('#ac-panel') && !$('#ac-panel').classList.contains('hidden')) window.__autoclipsOnTabOpen(); });
} else {
  if ($('#ac-panel') && !$('#ac-panel').classList.contains('hidden')) window.__autoclipsOnTabOpen();
}
