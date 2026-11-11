/* =========================================================
 * public/youtube.js — Aba "YouTube" (frontend)
 * ---------------------------------------------------------
 * Consome somente /api/youtube/* (backend youtube/service.js).
 * PARTE 8:
 *   8.1 Conectar canal (OAuth 2.0 oficial do Google)
 *   8.2 Gerenciamento (status, reconectar, desconectar)
 *   8.3 Publicação (agora/agendar, privado/não listado/público)
 *   8.4 Segurança (emergência, limites, atividades)
 *
 * A conexão usa a PRÓPRIA conta Google do dono (não exige conta de
 * administrador). O único insumo externo é o Client ID/Secret do
 * Google Cloud (grátis, na conta do usuário). Sem credenciais, a
 * aba informa isso de forma honesta — nenhum botão falso.
 * =======================================================*/

const API = '/api/youtube';

const STATE = {
  inited: false,
  loading: true,
  status: null,
  publications: [],
  activity: [],
  view: 'main',     // main | publishing
  busy: false,
  pollTimer: null,
};

const VIS_LABELS = { public: 'Público', unlisted: 'Não listado', private: 'Privado' };
const PUB_TONE = {
  rascunho: 'slate', bloqueado: 'amber', enviando: 'sky', agendado: 'violet',
  publicado: 'emerald', erro: 'rose', cancelado: 'slate',
};
const DOW = [
  { v: 1, l: 'Seg' }, { v: 2, l: 'Ter' }, { v: 3, l: 'Qua' }, { v: 4, l: 'Qui' },
  { v: 5, l: 'Sex' }, { v: 6, l: 'Sáb' }, { v: 0, l: 'Dom' },
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

async function api(path, { method = 'GET', body = null } = {}) {
  const url = new URL(API + path, location.origin);
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
  const host = $('#yt-toasts');
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
  }, 5600);
}

/* ---------------- dados ---------------- */
async function loadStatus() { STATE.status = await api('/status'); return STATE.status; }
async function loadPublications() { const r = await api('/publications'); STATE.publications = r.items || []; return r; }
async function loadActivity() { const r = await api('/activity?limit=40'); STATE.activity = r.items || []; return r; }

async function reloadAll() {
  await Promise.all([loadStatus(), loadPublications(), loadActivity()]);
}

/* ---------------- render ---------------- */
function render() {
  const body = $('#yt-body');
  if (!body) return;
  if (STATE.loading) { body.innerHTML = '<div class="text-[12px] text-slate-400">Carregando…</div>'; return; }
  body.innerHTML = STATE.view === 'publishing' ? renderPublish() : renderMain();
}

function badge(status) {
  const tone = PUB_TONE[status] || 'slate';
  const map = {
    slate: 'border-white/10 bg-white/5 text-slate-300',
    sky: 'border-sky-400/30 bg-sky-500/15 text-sky-200',
    amber: 'border-amber-400/30 bg-amber-500/15 text-amber-200',
    violet: 'border-violet-400/30 bg-violet-500/15 text-violet-200',
    emerald: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200',
    rose: 'border-rose-400/30 bg-rose-500/15 text-rose-200',
  };
  return `<span class="text-[10.5px] px-2 py-0.5 rounded-full border ${map[tone]} font-semibold">${esc(status)}</span>`;
}

function credsBanner(s) {
  if (!s.configured) {
    return `<div class="rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-200 mb-3">
      <b>Credenciais OAuth do Google não configuradas.</b> Para conectar seu canal, crie um Client ID/Secret no Google Cloud (grátis, na sua conta — não é conta de administrador) e defina no arquivo <code>.env</code>:
      <span class="block mt-1 font-mono text-[11px] text-amber-200/90">YT_CLIENT_ID=…&nbsp;&nbsp;YT_CLIENT_SECRET=…</span>
      <span class="block mt-1 text-amber-200/80">Depois reinicie o servidor. A conexão é feita com a sua própria conta Google via OAuth 2.0.</span></div>`;
  }
  return '';
}

function connectionCard(s) {
  const c = s.connection;
  if (s.connected && c && c.channel) {
    const ch = c.channel;
    return `<div class="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-3">
      <div class="flex items-center gap-3">
        ${ch.thumbnail ? `<img src="${esc(ch.thumbnail)}" alt="" class="w-10 h-10 rounded-full border border-white/10">` : ''}
        <div class="min-w-0">
          <div class="text-[13px] font-bold text-emerald-100 truncate">${esc(ch.title)}</div>
          <div class="text-[11px] text-emerald-200/80 truncate">${esc(ch.handle || ch.id)}${ch.subscriberCount != null ? ' · ' + esc(ch.subscriberCount) + ' inscritos' : ''}</div>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <button data-yt-act="refresh" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200">Reconectar</button>
          <button data-yt-act="disconnect" class="text-[11px] px-2.5 py-1.5 rounded-lg border border-rose-400/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-300">Desconectar</button>
        </div>
      </div>
      <div class="mt-2 text-[10.5px] text-emerald-200/70">Autorizado em ${esc(fmtDate(c.authorizedAt))} · escopos: ${esc((c.scopes || []).join(', ') || '—')}</div>
    </div>`;
  }
  const st = c ? esc(c.status) : 'não conectado';
  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="flex items-center gap-3">
      <div class="min-w-0">
        <div class="text-[13px] font-bold text-slate-100">Nenhum canal conectado</div>
        <div class="text-[11px] text-slate-400">Situação: <b class="text-slate-300">${st}</b></div>
      </div>
      <button data-yt-act="connect" class="ml-auto text-[11.5px] px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold" ${s.configured ? '' : 'disabled title="Configure YT_CLIENT_ID/YT_CLIENT_SECRET primeiro"'}>Conectar canal</button>
    </div>
  </div>`;
}

function emergencyCard(s) {
  const cfg = s.config || {};
  const on = !!cfg.emergencyStop;
  return `<div class="rounded-2xl border ${on ? 'border-rose-400/30 bg-rose-500/5' : 'border-white/10 bg-white/5'} p-3 flex items-center gap-3">
    <div class="min-w-0">
      <div class="text-[12px] font-bold ${on ? 'text-rose-200' : 'text-slate-200'}">Botão de emergência</div>
      <div class="text-[11px] ${on ? 'text-rose-200/80' : 'text-slate-400'}">${on ? 'Publicações automáticas INTERROMPIDAS.' : 'Desligado — as regras de publicação estão ativas.'}</div>
    </div>
    <button data-yt-act="emergency" data-on="${on ? '0' : '1'}" class="ml-auto text-[11.5px] px-3 py-1.5 rounded-lg font-semibold ${on ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-rose-600 hover:bg-rose-500 text-white'}">${on ? 'Reativar publicações' : 'Parar tudo agora'}</button>
  </div>`;
}

function gateCard(s) {
  const g = s.autoGate || {};
  const cfg = s.config || {};
  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="flex items-center gap-2">
      <div class="text-[12px] font-bold text-slate-200">Publicação automática</div>
      <span class="text-[10.5px] px-2 py-0.5 rounded-full border ${cfg.enabled ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200' : 'border-white/10 bg-white/5 text-slate-300'}">${cfg.enabled ? 'ligada' : 'desligada'}</span>
      <span class="ml-auto text-[10.5px] text-slate-500">${esc(g.reason || '')}</span>
    </div>
    <div class="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-slate-400">
      <span>Hoje: <b class="text-slate-200">${esc(s.todayPublished)}</b>/<b class="text-slate-200">${esc(cfg.dailyLimit)}</b></span>
      <span>Intervalo: <b class="text-slate-200">${esc(cfg.intervalMinutes)}min</b></span>
      <span>Nota mín.: <b class="text-slate-200">${esc(cfg.minScore)}</b></span>
      <span>Padrão: <b class="text-slate-200">${esc(VIS_LABELS[cfg.defaultVisibility] || cfg.defaultVisibility)}</b></span>
    </div>
    <div class="flex flex-wrap items-center gap-2 mt-3">
      <button data-yt-act="publish-new" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold">Publicar corte</button>
      <button data-yt-act="auto-run" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Tentar automático agora</button>
      <button data-yt-act="config" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Configurar regras</button>
      <button data-yt-act="reload" class="ml-auto text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Recarregar</button>
    </div>
  </div>`;
}

function configForm(s) {
  const cfg = s.config || {};
  const days = DOW.map((d) => `<label class="inline-flex items-center gap-1 text-[11px] text-slate-300 mr-3">
    <input type="checkbox" data-yt-day="${d.v}" ${(cfg.allowedDays || []).indexOf(d.v) >= 0 ? 'checked' : ''}> ${d.l}</label>`).join('');
  const profiles = (s.profiles || []).map((p) => `<label class="inline-flex items-center gap-1 text-[11px] text-slate-300 mr-3">
    <input type="checkbox" data-yt-profile="${esc(p.key)}" ${(cfg.profiles || []).indexOf(p.key) >= 0 ? 'checked' : ''}> ${esc(p.label)}</label>`).join('');
  return `<details class="rounded-2xl border border-white/10 bg-white/5 p-3" ${STATE.showConfig ? 'open' : ''}>
    <summary class="text-[12px] font-bold text-slate-200 cursor-pointer">Regras de publicação automática</summary>
    <div class="mt-3 space-y-2">
      <label class="flex items-center gap-2 text-[11.5px] text-slate-300"><input type="checkbox" id="yt-enabled" ${cfg.enabled ? 'checked' : ''}> Ligar publicação automática</label>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <label class="text-[11px] text-slate-400">Máx./dia<input id="yt-daily" type="number" min="0" value="${esc(cfg.dailyLimit)}" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100"></label>
        <label class="text-[11px] text-slate-400">Intervalo (min)<input id="yt-interval" type="number" min="1" value="${esc(cfg.intervalMinutes)}" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100"></label>
        <label class="text-[11px] text-slate-400">Hora início<input id="yt-start" type="number" min="0" max="23" value="${esc(cfg.allowedStartHour)}" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100"></label>
        <label class="text-[11px] text-slate-400">Hora fim<input id="yt-end" type="number" min="1" max="24" value="${esc(cfg.allowedEndHour)}" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100"></label>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <label class="text-[11px] text-slate-400">Nota mínima (QA)<input id="yt-minscore" type="number" min="0" max="100" value="${esc(cfg.minScore)}" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100"></label>
        <label class="text-[11px] text-slate-400">Visibilidade padrão
          <select id="yt-visibility" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100">
            <option value="private" ${cfg.defaultVisibility === 'private' ? 'selected' : ''}>Privado</option>
            <option value="unlisted" ${cfg.defaultVisibility === 'unlisted' ? 'selected' : ''}>Não listado</option>
            <option value="public" ${cfg.defaultVisibility === 'public' ? 'selected' : ''}>Público</option>
          </select></label>
      </div>
      <div><div class="text-[11px] text-slate-400 mb-1">Dias permitidos</div>${days}</div>
      <div><div class="text-[11px] text-slate-400 mb-1">Perfis do AutoClips (nenhum = todos)</div>${profiles || '<span class="text-[11px] text-slate-500">—</span>'}</div>
      <div class="flex items-center gap-2">
        <button data-yt-act="save-config" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">Salvar regras</button>
        <span class="text-[10.5px] text-slate-500">Segurança: nada é publicado sem você autorizar as regras acima.</span>
      </div>
    </div>
  </details>`;
}

function publicationsList() {
  const items = STATE.publications || [];
  const rows = items.map((p) => `
    <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div class="flex items-center gap-2">
        <span class="text-[12.5px] font-bold text-slate-100 truncate">${esc((p.snippet && p.snippet.title) || p.id)}</span>
        ${badge(p.status)}
        <span class="ml-auto text-[10.5px] text-slate-500">${esc(fmtDate(p.createdAt))}</span>
      </div>
      <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <span>Visibilidade: <b class="text-slate-300">${esc(VIS_LABELS[p.visibility] || p.visibility)}</b></span>
        ${p.scheduledAt ? `<span>Agendado: <b class="text-slate-300">${esc(fmtDate(p.scheduledAt))}</b></span>` : ''}
        ${p.jobId ? `<span>AutoClips: <b class="text-slate-300">${esc(p.jobId)}</b></span>` : ''}
        ${p.url ? `<a class="text-sky-300 hover:underline" href="${esc(p.url)}" target="_blank" rel="noopener">abrir no YouTube ↗</a>` : ''}
      </div>
      ${p.error ? `<div class="mt-1 text-[11px] text-rose-300">${esc(p.error)}</div>` : ''}
      <div class="flex items-center gap-2 mt-2">
        <select data-yt-repub="${esc(p.id)}" class="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-100" ${p.videoId ? '' : 'disabled'}>
          ${['public', 'unlisted', 'private'].map((v) => `<option value="${v}" ${p.visibility === v ? 'selected' : ''}>${esc(VIS_LABELS[v])}</option>`).join('')}
        </select>
        <button data-yt-act="republish" data-id="${esc(p.id)}" class="text-[11px] px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300" ${p.videoId ? '' : 'disabled'}>Aplicar visibilidade</button>
        <button data-yt-act="remove-pub" data-id="${esc(p.id)}" class="ml-auto text-[11px] px-2.5 py-1 rounded-lg border border-rose-400/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-300">Remover</button>
      </div>
    </div>`).join('');
  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="flex items-center gap-2 mb-2">
      <div class="text-[12px] font-bold text-slate-200">Publicações</div>
      <span class="text-[11px] text-slate-500">${items.length} registro(s)</span>
    </div>
    ${items.length ? `<div class="grid grid-cols-1 gap-2">${rows}</div>` : '<div class="text-[12px] text-slate-500">Nenhuma publicação ainda.</div>'}
  </div>`;
}

function activityList() {
  const items = STATE.activity || [];
  const labels = {
    canal_conectado: 'Canal conectado', canal_desconectado: 'Canal desconectado', canal_atualizado: 'Canal atualizado',
    conexao_invalida: 'Conexão inválida', config_atualizada: 'Configuração atualizada',
    emergencia_ativada: 'Emergência ATIVADA', emergencia_desativada: 'Emergência desativada',
    publicacao_iniciada: 'Publicação iniciada', publicacao_ok: 'Publicação concluída',
    publicacao_erro: 'Falha na publicação', publicacao_bloqueada: 'Publicação bloqueada',
    publicacao_visibilidade: 'Visibilidade alterada', auto_publicacao: 'Publicação automática',
  };
  const rows = items.map((a) => `<li class="text-[10.5px] text-slate-500">
    <span class="text-slate-400">[${esc(fmtDate(a.at))}]</span> ${esc(labels[a.type] || a.type)}
    ${a.channel ? ' · ' + esc(a.channel) : ''}${a.reason ? ' — ' + esc(a.reason) : ''}${a.error ? ' — ' + esc(a.error) : ''}
  </li>`).join('');
  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="text-[12px] font-bold text-slate-200 mb-1">Atividades (segurança)</div>
    <ul class="space-y-0.5">${rows || '<li class="text-[11px] text-slate-500">Sem atividade registrada.</li>'}</ul>
  </div>`;
}

function renderMain() {
  const s = STATE.status;
  if (!s) return '<div class="text-[12px] text-slate-400">Sem dados de status.</div>';
  return `<div class="max-w-[1040px] space-y-3">
    ${credsBanner(s)}
    ${connectionCard(s)}
    ${emergencyCard(s)}
    ${gateCard(s)}
    ${configForm(s)}
    ${publicationsList()}
    ${activityList()}
  </div>`;
}

function renderPublish() {
  const s = STATE.status || {};
  const cfg = s.config || {};
  return `<div class="max-w-[980px] space-y-3">
    <div class="flex items-center gap-2">
      <div class="text-[13px] font-bold text-red-200">Publicar um corte</div>
      <button data-yt-act="back" class="ml-auto text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Voltar</button>
    </div>
    <div class="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-2">
      <label class="block text-[11px] text-slate-400">ID da tarefa do AutoClips (opcional — use para publicar um corte renderizado)
        <input id="yt-jobid" type="text" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-slate-100 font-mono" placeholder="ac_xxxxx"></label>
      <label class="block text-[11px] text-slate-400">Arquivo local (opcional se informar o ID da tarefa; obrigatório para envio manual)
        <input id="yt-file" type="text" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-slate-100 font-mono" placeholder="/caminho/para/video.mp4"></label>
      <label class="block text-[11px] text-slate-400">Título
        <input id="yt-title" type="text" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100" placeholder="Título do vídeo"></label>
      <label class="block text-[11px] text-slate-400">Descrição
        <textarea id="yt-desc" rows="3" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-slate-100"></textarea></label>
      <label class="block text-[11px] text-slate-400">Tags (separadas por vírgula)
        <input id="yt-tags" type="text" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-slate-100" placeholder="corte, shorts, melhores momentos"></label>
      <div class="grid grid-cols-2 gap-2">
        <label class="text-[11px] text-slate-400">Visibilidade
          <select id="yt-pub-vis" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100">
            ${['public', 'unlisted', 'private'].map((v) => `<option value="${v}" ${cfg.defaultVisibility === v ? 'selected' : ''}>${esc(VIS_LABELS[v])}</option>`).join('')}
          </select></label>
        <label class="text-[11px] text-slate-400">Agendar para (opcional)
          <input id="yt-pub-at" type="datetime-local" class="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100"></label>
      </div>
      <div class="flex items-center gap-2 pt-1">
        <button data-yt-act="do-publish" class="text-[12px] px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold" ${s.connected ? '' : 'disabled title="Conecte um canal primeiro"'}>Publicar</button>
        <span class="text-[10.5px] text-slate-500">${s.connected ? 'O envio é feito a partir de um ARQUIVO local (a API não baixa vídeo de URL).' : 'Conecte o canal antes de publicar.'}</span>
      </div>
    </div>
  </div>`;
}

/* ---------------- ações ---------------- */
function setBusy(flag) { STATE.busy = !!flag; }

async function doConnect() {
  try {
    const r = await api('/connect', { method: 'POST', body: {} });
    if (r.ok && r.url) window.open(r.url, '_blank', 'noopener');
    toast('Abra a janela do Google e autorize o acesso ao seu canal.', 'info');
    startPolling();
  } catch (e) { toast(e.message || 'Falha ao iniciar a conexão.', 'err'); }
}

async function doRefresh() {
  try { await api('/refresh', { method: 'POST', body: {} }); toast('Canal atualizado.', 'ok'); await reloadAll(); render(); }
  catch (e) { toast(e.message || 'Falha ao reconectar.', 'err'); }
}

async function doDisconnect() {
  try { const r = await api('/disconnect', { method: 'POST', body: {} }); toast(r.revoked ? 'Canal desconectado e acesso revogado.' : 'Canal desconectado.', 'ok'); await reloadAll(); render(); }
  catch (e) { toast(e.message || 'Falha ao desconectar.', 'err'); }
}

async function doEmergency(on) {
  try { const r = await api('/emergency', { method: 'POST', body: { on } }); toast(on ? 'Emergência ATIVADA — tudo parado.' : 'Publicações reativadas.', on ? 'warn' : 'ok'); await reloadAll(); render(); return r; }
  catch (e) { toast(e.message || 'Falha ao alterar a emergência.', 'err'); }
}

async function doAutoRun() {
  try {
    const r = await api('/auto/run', { method: 'POST', body: {} });
    if (r.ran) toast(r.ok ? 'Publicação automática concluída.' : ('Automático: ' + (r.reason || 'não publicado.')), r.ok ? 'ok' : 'warn');
    else toast('Nada para publicar agora: ' + (r.reason || ''), 'warn');
    await reloadAll(); render();
  } catch (e) { toast(e.message || 'Falha na execução automática.', 'err'); }
}

function collectConfig() {
  const days = [];
  document.querySelectorAll('[data-yt-day]').forEach((c) => { if (c.checked) days.push(Number(c.getAttribute('data-yt-day'))); });
  const profiles = [];
  document.querySelectorAll('[data-yt-profile]').forEach((c) => { if (c.checked) profiles.push(c.getAttribute('data-yt-profile')); });
  return {
    enabled: $('#yt-enabled') ? $('#yt-enabled').checked : false,
    dailyLimit: $('#yt-daily') ? Number($('#yt-daily').value) : 3,
    intervalMinutes: $('#yt-interval') ? Number($('#yt-interval').value) : 60,
    allowedStartHour: $('#yt-start') ? Number($('#yt-start').value) : 9,
    allowedEndHour: $('#yt-end') ? Number($('#yt-end').value) : 22,
    minScore: $('#yt-minscore') ? Number($('#yt-minscore').value) : 70,
    defaultVisibility: $('#yt-visibility') ? $('#yt-visibility').value : 'private',
    allowedDays: days,
    profiles,
  };
}

async function doSaveConfig() {
  STATE.showConfig = true;
  try {
    await api('/config', { method: 'PUT', body: collectConfig() });
    toast('Regras salvas.', 'ok');
    await reloadAll(); render();
  } catch (e) { toast(e.message || 'Falha ao salvar as regras.', 'err'); render(); }
}

function parseTags(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

async function doPublish() {
  const jobId = $('#yt-jobid') ? $('#yt-jobid').value.trim() : '';
  const filePath = $('#yt-file') ? $('#yt-file').value.trim() : '';
  if (!jobId && !filePath) { toast('Informe o ID da tarefa ou um arquivo local.', 'warn'); return; }
  const title = $('#yt-title') ? $('#yt-title').value.trim() : '';
  const description = $('#yt-desc') ? $('#yt-desc').value.trim() : '';
  const tags = parseTags($('#yt-tags') ? $('#yt-tags').value : '');
  const visibility = $('#yt-pub-vis') ? $('#yt-pub-vis').value : 'private';
  const scheduledAt = $('#yt-pub-at') && $('#yt-pub-at').value ? new Date($('#yt-pub-at').value).toISOString() : null;
  const metadata = (title || description || tags.length) ? { title, description, tags } : null;
  setBusy(true);
  try {
    const r = await api('/publish', { method: 'POST', body: { jobId: jobId || null, filePath: filePath || null, metadata, visibility, scheduledAt } });
    const p = r.publication || {};
    toast(p.status === 'agendado' ? 'Agendado com sucesso.' : (p.status === 'publicado' ? 'Publicado com sucesso.' : 'Concluído.'), 'ok');
    STATE.view = 'main';
    await reloadAll(); render();
  } catch (e) { toast(e.message || 'Falha ao publicar.', 'err'); }
  finally { setBusy(false); }
}

async function doRepublish(id) {
  const sel = document.querySelector('[data-yt-repub="' + CSS.escape(id) + '"]');
  const visibility = sel ? sel.value : 'private';
  try { await api('/publication/' + encodeURIComponent(id) + '/republish', { method: 'POST', body: { visibility } }); toast('Visibilidade atualizada.', 'ok'); await reloadAll(); render(); }
  catch (e) { toast(e.message || 'Falha ao atualizar a visibilidade.', 'err'); }
}

async function doRemovePub(id) {
  try { await api('/publication/' + encodeURIComponent(id), { method: 'DELETE', body: {} }); toast('Registro removido.', 'ok'); await reloadAll(); render(); }
  catch (e) { toast(e.message || 'Falha ao remover.', 'err'); }
}

/* ---------------- bind ---------------- */
function onClick(ev) {
  const t = ev.target.closest('[data-yt-act]');
  if (!t) return;
  const act = t.getAttribute('data-yt-act');
  const id = t.getAttribute('data-id');
  if (act === 'connect') return void doConnect();
  if (act === 'refresh') return void doRefresh();
  if (act === 'disconnect') return void doDisconnect();
  if (act === 'emergency') return void doEmergency(t.getAttribute('data-on') === '1');
  if (act === 'auto-run') return void doAutoRun();
  if (act === 'config') { STATE.showConfig = !STATE.showConfig; render(); return; }
  if (act === 'save-config') return void doSaveConfig();
  if (act === 'publish-new') { STATE.view = 'publishing'; render(); return; }
  if (act === 'back') { STATE.view = 'main'; render(); return; }
  if (act === 'do-publish') return void doPublish();
  if (act === 'republish') return void doRepublish(id);
  if (act === 'remove-pub') return void doRemovePub(id);
  if (act === 'reload') { STATE.loading = true; render(); reloadAll().then(() => { STATE.loading = false; render(); }).catch(() => { STATE.loading = false; render(); }); }
}

document.addEventListener('click', onClick);

/* =========================================================
 * Hooks da aba (chamados por public/app.js)
 * =======================================================*/
window.__youtubeOnTabOpen = function () {
  try {
    if (!STATE.inited) { STATE.inited = true; boot(); }
    else { STATE.loading = true; render(); reloadAll().then(() => { STATE.loading = false; render(); }).catch(() => { STATE.loading = false; render(); }); }
  } catch (e) { console.error('[youtube] open erro:', e); }
};
window.__youtubeOnTabClose = function () { stopPolling(); };

function startPolling() {
  stopPolling();
  let n = 0;
  STATE.pollTimer = setInterval(async () => {
    n += 1;
    try {
      await loadStatus();
      await loadPublications();
      if (STATE.view === 'main') render();
      if (STATE.status && STATE.status.connected) { stopPolling(); toast('Canal conectado com sucesso!', 'ok'); }
    } catch { /* segue tentando */ }
    if (n > 40) stopPolling(); // ~2 min
  }, 3000);
}
function stopPolling() { if (STATE.pollTimer) { clearInterval(STATE.pollTimer); STATE.pollTimer = null; } }

async function boot() {
  try {
    await reloadAll();
    STATE.loading = false;
    STATE.view = 'main';
    render();
  } catch (e) {
    STATE.loading = false;
    render();
    toast('Não foi possível carregar o módulo YouTube: ' + (e.message || ''), 'err');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { if ($('#yt-panel') && !$('#yt-panel').classList.contains('hidden')) window.__youtubeOnTabOpen(); });
} else {
  if ($('#yt-panel') && !$('#yt-panel').classList.contains('hidden')) window.__youtubeOnTabOpen();
}
