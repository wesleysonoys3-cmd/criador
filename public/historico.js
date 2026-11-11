/* =========================================================
 * public/historico.js — Aba "Histórico" (frontend, PARTE 9)
 * ---------------------------------------------------------
 * Consome somente /api/analytics/* (backend analytics/service.js).
 *   - Visão geral (vídeos, cortes, publicações, métricas).
 *   - Fila de processamento.
 *   - Calendário de publicações.
 *   - Métricas oficiais por vídeo e desempenho por perfil.
 *   - Recomendações baseadas apenas nos dados reais.
 *
 * Honestidade: métricas dependem da integração oficial do YouTube;
 * não há promessa de viralização.
 * =======================================================*/

const API = '/api/analytics';

const STATE = {
  inited: false,
  loading: true,
  month: new Date().toISOString().slice(0, 7),
  overview: null,
  metrics: null,
  byProfile: [],
  recommendations: [],
  history: [],
  queue: null,
  calendar: null,
  busy: false,
};

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
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(API + path, opts);
  let data = null;
  try { data = await r.json(); } catch { data = { ok: false, reason: 'Resposta inválida do servidor.' }; }
  if (!r.ok || data.ok === false) { const e = new Error(data.reason || 'Não foi possível concluir a operação.'); e.code = data.code || ''; throw e; }
  return data;
}

function toast(msg, kind = 'info') {
  const host = $('#hs-toasts');
  if (!host) return;
  const colors = { info: 'border-sky-400/30 bg-sky-500/20 text-sky-100', ok: 'border-emerald-400/30 bg-emerald-500/20 text-emerald-100', err: 'border-rose-400/30 bg-rose-500/20 text-rose-100', warn: 'border-amber-400/30 bg-amber-500/20 text-amber-100' };
  const d = document.createElement('div');
  d.className = `pointer-events-auto max-w-[420px] rounded-xl border px-3 py-2 text-[12px] shadow-xl backdrop-blur ${colors[kind] || colors.info}`;
  d.textContent = msg;
  host.appendChild(d);
  setTimeout(() => { d.style.transition = 'opacity .3s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 320); }, 5200);
}

function card(label, value, hint) {
  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="text-[10.5px] uppercase tracking-wider text-slate-500">${esc(label)}</div>
    <div class="text-[22px] font-bold text-slate-100 leading-tight">${esc(value)}</div>
    ${hint ? `<div class="text-[10.5px] text-slate-500">${esc(hint)}</div>` : ''}
  </div>`;
}

/* ---------------- carregamento ---------------- */
async function loadAll() {
  const [overview, metrics, recommendations, history, queue, calendar] = await Promise.all([
    api('/overview'),
    api('/metrics'),
    api('/recommendations'),
    api('/history?limit=60'),
    api('/queue'),
    api('/calendar?month=' + encodeURIComponent(STATE.month)),
  ]);
  STATE.overview = overview;
  STATE.metrics = metrics;
  STATE.byProfile = metrics.byProfile || [];
  STATE.recommendations = recommendations.items || [];
  STATE.history = history.items || [];
  STATE.queue = queue;
  STATE.calendar = calendar;
}

/* ---------------- render ---------------- */
function render() {
  const body = $('#hs-body');
  if (!body) return;
  if (STATE.loading) { body.innerHTML = '<div class="text-[12px] text-slate-400">Carregando histórico…</div>'; return; }

  const o = STATE.overview || {};
  const m = STATE.metrics || {};
  const pub = o.publications || {};
  const vids = o.videos || {};
  const mt = o.metrics || {};

  const overviewHtml = `<div class="grid grid-cols-2 md:grid-cols-4 gap-2">
    ${card('Vídeos no AutoClips', vids.total || 0, (vids.processed || 0) + ' processado(s)')}
    ${card('Cortes gerados', (o.clips && o.clips.generated) || 0, (o.clips && o.clips.published || 0) + ' publicado(s)/agendado(s)')}
    ${card('Publicações', pub.total || 0, Object.keys(pub.byStatus || {}).map((k) => k + ': ' + pub.byStatus[k]).join(' · ') || 'nenhuma')}
    ${card('Métricas rastreadas', mt.tracked || 0, mt.lastFetchedAt ? 'atualizado ' + fmtDate(mt.lastFetchedAt) : 'nunca atualizado')}
  </div>
  <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
    ${card('Visualizações', mt.views || 0)}
    ${card('Curtidas', mt.likes || 0)}
    ${card('Comentários', mt.comments || 0)}
  </div>`;

  body.innerHTML = `<div class="max-w-[1080px] space-y-3">
    ${overviewHtml}
    ${metricBanner(m)}
    ${recommendationsCard()}
    ${queueCard()}
    ${metricsTable()}
    ${profileCard()}
    ${calendarCard()}
    ${historyCard()}
    <div class="text-[10.5px] text-slate-500">${esc(((o.disclaimers || [])[0]) || 'Não há garantia de visualizações nem promessa de viralização.')}</div>
  </div>`;
}

function metricBanner(m) {
  const connected = m.connected || (STATE.overview && STATE.overview.connected);
  if (connected) {
    return `<div class="flex items-center gap-2">
      <button data-hs-act="refresh-metrics" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold">Atualizar métricas</button>
      <span class="text-[10.5px] text-slate-500">${m.note ? esc(m.note) : 'Dados oficiais do YouTube. Podem levar horas para atualizar.'}</span>
    </div>`;
  }
  return `<div class="rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-200">
    <b>Métricas oficiais indisponíveis.</b> Conecte o canal do YouTube (aba YouTube) para buscar visualizações, curtidas e comentários. Os demais dados do histórico continuam disponíveis.
  </div>`;
}

function recommendationsCard() {
  const items = STATE.recommendations || [];
  const tone = { info: 'border-sky-400/20 bg-sky-500/5', sugestao: 'border-emerald-400/20 bg-emerald-500/5', atencao: 'border-amber-400/20 bg-amber-500/5' };
  const txt = { info: 'text-sky-200', sugestao: 'text-emerald-200', atencao: 'text-amber-200' };
  const rows = items.map((r) => `<div class="rounded-xl border ${tone[r.level] || tone.info} px-3 py-2">
    <div class="text-[12px] font-bold ${txt[r.level] || txt.info}">${esc(r.title)}</div>
    <div class="text-[11px] text-slate-400">${esc(r.text)}</div>
  </div>`).join('');
  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="text-[12px] font-bold text-slate-200 mb-2">Recomendações</div>
    ${rows || '<div class="text-[11.5px] text-slate-500">Sem recomendações no momento.</div>'}
  </div>`;
}

function queueCard() {
  const q = STATE.queue || {};
  const ffs = q.ffmpeg || {};
  const ffNote = ffs.available === false ? '<span class="text-amber-300">ffmpeg ausente — o render real fica pendente (nenhum botão falso).</span>'
    : (ffs.available ? '<span class="text-emerald-300">ffmpeg disponível.</span>' : '<span class="text-slate-500">ffmpeg: verificando…</span>');
  const rows = (q.items || []).map((i) => `<li class="text-[11px] text-slate-400">${esc(i.title || i.id)} · <b class="text-slate-300">${esc(i.statusLabel || i.status)}</b>${i.stageLabel ? ' — ' + esc(i.stageLabel) : ''} (${esc(i.progress || 0)}%)${i.attempts ? ' · tentativas: ' + esc(i.attempts) : ''}</li>`).join('');
  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="flex items-center gap-2">
      <div class="text-[12px] font-bold text-slate-200">Fila de processamento</div>
      <span class="text-[10.5px] px-2 py-0.5 rounded-full border ${q.running ? 'border-sky-400/30 bg-sky-500/15 text-sky-200' : 'border-white/10 bg-white/5 text-slate-300'}">${q.running ? 'rodando' : 'parada'}</span>
      <span class="text-[10.5px] text-slate-500">pendentes: ${esc(q.pendingCount || 0)} · máx. tentativas: ${esc(q.maxAttempts == null ? '—' : q.maxAttempts)}</span>
    </div>
    <ul class="mt-1 space-y-0.5">${rows || '<li class="text-[11px] text-slate-500">Nenhuma tarefa na fila.</li>'}</ul>
    <div class="mt-1 text-[10.5px] text-slate-500">${ffNote} ${esc(q.note || '')}</div>
  </div>`;
}

function metricsTable() {
  const m = STATE.metrics || {};
  const items = m.items || [];
  if (!items.length) return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3"><div class="text-[12px] font-bold text-slate-200 mb-1">Métricas por vídeo</div><div class="text-[11.5px] text-slate-500">Nenhum vídeo publicado ainda.</div></div>`;
  const num = (v) => (v == null ? '—' : v);
  const rows = items.map((i) => `<tr class="border-t border-white/5">
    <td class="py-1.5 pr-2 text-[11.5px] text-slate-200 max-w-[320px] truncate">${esc(i.title || i.videoId)}</td>
    <td class="py-1.5 px-2 text-[11px] text-slate-400">${esc(i.profileKey || '—')}</td>
    <td class="py-1.5 px-2 text-[11px] text-slate-400">${esc(i.status || '')}</td>
    <td class="py-1.5 px-2 text-[11px] text-slate-300 text-right">${esc(num(i.views))}</td>
    <td class="py-1.5 px-2 text-[11px] text-slate-300 text-right">${esc(num(i.likes))}</td>
    <td class="py-1.5 px-2 text-[11px] text-slate-300 text-right">${esc(num(i.comments))}</td>
    <td class="py-1.5 pl-2 text-[11px]">${i.url ? `<a class="text-sky-300 hover:underline" href="${esc(i.url)}" target="_blank" rel="noopener">abrir ↗</a>` : ''}</td>
  </tr>`).join('');
  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="text-[12px] font-bold text-slate-200 mb-1">Métricas por vídeo</div>
    <div class="overflow-auto">
      <table class="w-full">
        <thead><tr class="text-[10px] uppercase tracking-wider text-slate-500">
          <th class="text-left py-1 pr-2">Título</th><th class="text-left px-2">Perfil</th><th class="text-left px-2">Status</th>
          <th class="text-right px-2">Views</th><th class="text-right px-2">Likes</th><th class="text-right px-2">Coment.</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function profileCard() {
  const rows = (STATE.byProfile || []).map((p) => `<li class="text-[11px] text-slate-400">
    <b class="text-slate-200">${esc(p.profileKey)}</b> — ${esc(p.count)} vídeo(s), ${esc(p.measured)} medido(s)${p.avgViews != null ? ' · média ' + esc(p.avgViews) + ' views' : ''}${p.avgLikes != null ? ' · média ' + esc(p.avgLikes) + ' likes' : ''}
  </li>`).join('');
  if (!rows) return '';
  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="text-[12px] font-bold text-slate-200 mb-1">Desempenho por perfil de edição</div>
    <ul class="space-y-0.5">${rows}</ul>
  </div>`;
}

function calendarCard() {
  const cal = STATE.calendar || { days: {} };
  const days = cal.days || {};
  const keys = Object.keys(days).sort();
  const cells = keys.map((d) => `<div class="rounded-xl border border-white/10 bg-white/5 p-2">
    <div class="text-[11px] font-bold text-slate-200">${esc(d.slice(8, 10))}/${esc(d.slice(5, 7))}</div>
    <ul class="mt-0.5 space-y-0.5">${days[d].map((p) => `<li class="text-[10.5px] text-slate-400 truncate">${esc(p.status)} · ${esc(p.title || p.id)}</li>`).join('')}</ul>
  </div>`).join('');
  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="flex items-center gap-2 mb-2">
      <div class="text-[12px] font-bold text-slate-200">Calendário de publicações</div>
      <input id="hs-month" type="month" value="${esc(STATE.month)}" class="ml-auto rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-100">
    </div>
    ${cells ? `<div class="grid grid-cols-2 md:grid-cols-4 gap-2">${cells}</div>` : '<div class="text-[11.5px] text-slate-500">Nenhuma publicação neste mês.</div>'}
  </div>`;
}

function historyCard() {
  const items = STATE.history || [];
  const rows = items.map((i) => {
    const isPub = i.type === 'publication';
    const badge = isPub
      ? `<span class="text-[10px] px-1.5 py-0.5 rounded border border-sky-400/30 bg-sky-500/10 text-sky-200">publicação</span>`
      : `<span class="text-[10px] px-1.5 py-0.5 rounded border border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200">AutoClips</span>`;
    const extra = isPub ? (i.visibility ? ' · ' + esc(i.visibility) : '') : (i.cuts ? ' · ' + esc(i.cuts) + ' corte(s)' : '') + (i.score != null ? ' · nota ' + esc(i.score) : '');
    return `<li class="flex items-center gap-2 text-[11px] text-slate-400 py-1 border-b border-white/5">
      <span class="text-slate-500 shrink-0">${esc(fmtDate(i.at))}</span>
      ${badge}
      <span class="text-slate-200 truncate max-w-[360px]">${esc(i.title || i.id)}</span>
      <span class="text-slate-500">${esc(i.statusLabel || i.status || '')}${extra}</span>
      ${i.url ? `<a class="ml-auto text-sky-300 hover:underline shrink-0" href="${esc(i.url)}" target="_blank" rel="noopener">abrir ↗</a>` : ''}
    </li>`;
  }).join('');
  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="text-[12px] font-bold text-slate-200 mb-1">Histórico</div>
    <ul>${rows || '<li class="text-[11.5px] text-slate-500">Sem eventos.</li>'}</ul>
  </div>`;
}

/* ---------------- ações ---------------- */
async function doRefreshMetrics() {
  if (STATE.busy) return;
  STATE.busy = true;
  try {
    const r = await api('/metrics/refresh', { method: 'POST', body: {} });
    STATE.metrics = r;
    STATE.byProfile = r.byProfile || [];
    await refreshOverview();
    render();
    toast(r.fetched ? 'Métricas atualizadas (' + (r.items || []).length + ' vídeo(s)).' : (r.note || 'Nada para atualizar.'), r.fetched ? 'ok' : 'warn');
  } catch (e) { toast(e.message || 'Falha ao atualizar as métricas.', 'err'); }
  finally { STATE.busy = false; }
}

async function refreshOverview() { try { STATE.overview = await api('/overview'); } catch { /* ok */ } }

function onChange(ev) {
  if (ev.target && ev.target.id === 'hs-month') {
    STATE.month = ev.target.value || STATE.month;
    api('/calendar?month=' + encodeURIComponent(STATE.month)).then((cal) => { STATE.calendar = cal; render(); }).catch(() => {});
  }
}

function onClick(ev) {
  const t = ev.target.closest('[data-hs-act]');
  if (!t) return;
  const act = t.getAttribute('data-hs-act');
  if (act === 'refresh-metrics') return void doRefreshMetrics();
  if (act === 'reload') {
    STATE.loading = true; render();
    loadAll().then(() => { STATE.loading = false; render(); }).catch((e) => { STATE.loading = false; render(); toast(e.message || 'Falha ao carregar.', 'err'); });
  }
}

document.addEventListener('click', onClick);
document.addEventListener('change', onChange);

/* =========================================================
 * Hooks da aba (chamados por public/app.js)
 * =======================================================*/
window.__historicoOnTabOpen = function () {
  try {
    if (!STATE.inited) { STATE.inited = true; boot(); }
    else { STATE.loading = true; render(); loadAll().then(() => { STATE.loading = false; render(); }).catch(() => { STATE.loading = false; render(); }); }
  } catch (e) { console.error('[historico] open erro:', e); }
};
window.__historicoOnTabClose = function () { /* nada a limpar */ };

async function boot() {
  try { await loadAll(); STATE.loading = false; render(); }
  catch (e) { STATE.loading = false; render(); toast('Não foi possível carregar o histórico: ' + (e.message || ''), 'err'); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { const p = $('#hs-panel'); if (p && !p.classList.contains('hidden')) window.__historicoOnTabOpen(); });
} else {
  const p = $('#hs-panel'); if (p && !p.classList.contains('hidden')) window.__historicoOnTabOpen();
}
