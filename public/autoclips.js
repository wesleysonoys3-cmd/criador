/* =========================================================
 * public/autoclips.js — Aba "AutoClips AI" (frontend)
 * ---------------------------------------------------------
 * Consome somente /api/autoclips/* (backend autoclips/service.js).
 * Fluxo (PARTE 7):
 *   1) Entrada de vídeos (fontes + transcrição)
 *   2) Verificação de direitos (bloqueia sem autorização)
 *   3) Análise inteligente
 *   4) Perfil de edição
 *   5) Edição automática (plano de cortes)
 *   6) Metadados
 *   7) Controle de qualidade
 *   8) Fila/processamento
 * O render real depende do ffmpeg: quando ausente, é sinalizado de
 * forma honesta (sem botão falso).
 * =======================================================*/

const API = '/api/autoclips';

const STATE = {
  inited: false,
  view: 'loading',   // loading | list | create | detail
  status: null,
  profiles: [],
  jobs: [],
  job: null,         // detalhe
  busy: false,
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

/* ---------------- dados ---------------- */
async function loadStatus() {
  const r = await api('/status');
  STATE.status = r;
  if (Array.isArray(r.profiles) && r.profiles.length) STATE.profiles = r.profiles;
  return r;
}
async function loadJobs() {
  const r = await api('/jobs');
  STATE.jobs = r.items || [];
  return r;
}
async function openJob(id) {
  const r = await api('/job/' + encodeURIComponent(id));
  STATE.job = r;
  STATE.view = 'detail';
  render();
}

/* ---------------- render ---------------- */
function render() {
  const body = $('#ac-body');
  if (!body) return;
  if (STATE.view === 'loading') { body.innerHTML = '<div class="text-[12px] text-slate-400">Carregando…</div>'; return; }
  if (STATE.view === 'create') { body.innerHTML = renderCreate(); return; }
  if (STATE.view === 'detail') { body.innerHTML = renderDetail(); return; }
  body.innerHTML = renderList();
}

function badge(status) {
  const tone = STATUS_TONE[status] || 'slate';
  const map = {
    slate: 'border-white/10 bg-white/5 text-slate-300',
    sky: 'border-sky-400/30 bg-sky-500/15 text-sky-200',
    amber: 'border-amber-400/30 bg-amber-500/15 text-amber-200',
    emerald: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200',
    rose: 'border-rose-400/30 bg-rose-500/15 text-rose-200',
  };
  return `<span class="text-[10.5px] px-2 py-0.5 rounded-full border ${map[tone]} font-semibold">${esc(status)}</span>`;
}

function ffmpegBanner() {
  const ff = STATE.status && STATE.status.ffmpeg;
  if (!ff) return '';
  if (ff.available === true) {
    return `<div class="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-3 py-2 text-[11.5px] text-emerald-200 mb-3">
      ffmpeg disponível (${esc(ff.ffmpeg && ff.ffmpeg.version || 'ok')}) — o render pode ser executado.</div>`;
  }
  if (ff.available === false) {
    return `<div class="rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-200 mb-3">
      <b>ffmpeg não instalado.</b> A produção automática (análise, edição, metadados e QA) funciona normalmente, mas o render real fica <b>pendente</b> e é sinalizado como tal — nenhum botão falso.
      <span class="block text-amber-200/80 mt-1">${esc(ff.installHint || '')}</span></div>`;
  }
  return '';
}

function renderList() {
  const jobs = STATE.jobs || [];
  const rows = jobs.map((j) => `
    <button type="button" data-ac-act="open" data-id="${esc(j.id)}" class="w-full text-left rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition p-3">
      <div class="flex items-center gap-2">
        <span class="text-[13px] font-bold text-slate-100 truncate">${esc(j.title)}</span>
        ${badge(j.statusLabel || j.status)}
        <span class="ml-auto text-[10.5px] text-slate-500">${esc(fmtDate(j.updatedAt))}</span>
      </div>
      <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <span>Perfil: <b class="text-slate-300">${esc(j.profileLabel || '—')}</b></span>
        <span>Direitos: <b class="${j.rights && j.rights.canProcess ? 'text-emerald-300' : 'text-rose-300'}">${j.rights ? esc(j.rights.status) : 'não avaliados'}</b></span>
        ${j.plan ? `<span>Cortes: <b class="text-slate-300">${esc(j.plan.cutsCount)}</b> · ${esc(fmtDur(j.plan.totalDuration))}</span>` : ''}
        ${j.qa ? `<span>QA: <b class="${j.qa.ok ? 'text-emerald-300' : 'text-amber-300'}">${esc(j.qa.score)}</b></span>` : ''}
        ${j.render && j.render.pending ? '<span class="text-amber-300">render pendente (ffmpeg)</span>' : ''}
      </div>
      ${j.status === 'processando' ? `<div class="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-amber-400" style="width:${esc(j.progress)}%"></div></div>` : ''}
    </button>`).join('');

  return `${ffmpegBanner()}
  <div class="max-w-[980px]">
    <div class="flex items-center gap-2 mb-3">
      <div class="text-[13px] font-bold text-violet-200">Tarefas do AutoClips</div>
      <span class="text-[11px] text-slate-500">${jobs.length} tarefa(s)</span>
      <button data-ac-act="new" class="ml-auto text-[11.5px] px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Nova tarefa</button>
      <button data-ac-act="reload" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Recarregar</button>
    </div>
    ${jobs.length ? `<div class="grid grid-cols-1 gap-2">${rows}</div>`
      : '<div class="text-[12px] text-slate-500">Nenhuma tarefa ainda. Crie a primeira para enviar um vídeo à produção automática.</div>'}
  </div>`;
}

function profileOptions(selected) {
  return STATE.profiles.map((p) => `<option value="${esc(p.key)}" ${p.key === selected ? 'selected' : ''}>${esc(p.label)} — ${esc(p.description)}</option>`).join('');
}

function renderCreate() {
  return `${ffmpegBanner()}
  <div class="max-w-[980px] space-y-3">
    <div class="flex items-center gap-2">
      <div class="text-[13px] font-bold text-violet-200">Nova tarefa de produção</div>
      <button data-ac-act="list" class="ml-auto text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Voltar</button>
    </div>

    <label class="block text-[11px] text-slate-400">Título da tarefa
      <input id="ac-title" type="text" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100" placeholder="Ex.: Podcast #12 — melhores momentos"></label>

    <label class="block text-[11px] text-slate-400">Perfil de edição
      <select id="ac-profile" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100">${profileOptions('podcast')}</select></label>

    <label class="block text-[11px] text-slate-400">Fontes (uma por linha: <code>local|caminho</code>, <code>url|endereço</code> ou só o caminho)
      <textarea id="ac-sources" rows="3" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-slate-100 font-mono" placeholder="local|/videos/podcast-12.mp4"></textarea></label>

    <label class="block text-[11px] text-slate-400">Transcrição (uma linha por fala: <code>inicio|texto</code>; inicio em segundos ou <code>mm:ss</code>. Também aceita JSON de segmentos)
      <textarea id="ac-transcript" rows="8" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-slate-100 font-mono" placeholder="0|Olha isso, o segredo que ninguém conta...&#10;10|A verdade é que eu descobri depois de muito tempo."></textarea></label>

    <div class="flex items-center gap-2">
      <button data-ac-act="create" class="text-[12px] px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold">Criar tarefa</button>
      <span class="text-[10.5px] text-slate-500">Os direitos são verificados antes de qualquer processamento.</span>
    </div>
  </div>`;
}

function progressBar(job) {
  return `<div class="h-2 rounded-full bg-white/10 overflow-hidden"><div class="h-full ${job.status === 'erro' ? 'bg-rose-400' : 'bg-violet-400'}" style="width:${esc(job.progress)}%"></div></div>`;
}

function renderRights(job) {
  const r = job.rights || {};
  const rights = r.rights || {};
  const rows = RIGHT_KEYS.map((k) => `
    <label class="flex items-center gap-2 text-[11.5px] text-slate-300">
      <span class="flex-1">${esc(RIGHT_LABELS[k])}</span>
      <select data-ac-right="${esc(k)}" class="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11.5px] text-slate-100">
        ${DECISIONS.map((d) => `<option value="${esc(d)}" ${rights[k] === d || (!rights[k] && d === 'NAO_VERIFICAVEL') ? 'selected' : ''}>${esc(DECISION_LABELS[d])}</option>`).join('')}
      </select>
    </label>`).join('');

  const evidence = (r.evidence || []).map((e) => `<li class="text-[11px] text-slate-400">${esc(e.type)}: <b class="text-slate-300">${esc(e.label || e.value)}</b></li>`).join('');

  return `<div class="rounded-2xl border border-white/10 bg-white/5 p-3">
    <div class="flex items-center gap-2 mb-2">
      <div class="text-[12px] font-bold text-slate-200">2 · Direitos de uso</div>
      <span class="text-[10.5px] px-2 py-0.5 rounded-full border ${r.canProcess ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200' : 'border-rose-400/30 bg-rose-500/15 text-rose-200'}">${r.canProcess ? 'pode processar' : 'bloqueado'}</span>
      ${r.status ? `<span class="text-[10.5px] text-slate-500">status: ${esc(r.status)}</span>` : ''}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-1.5">${rows}</div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
      <input id="ac-right-source" type="text" value="${esc(r.source || '')}" class="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-[12px] text-slate-100" placeholder="Origem (ex.: contrato, licença)">
      <input id="ac-right-responsible" type="text" value="${esc(r.responsible || '')}" class="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-[12px] text-slate-100" placeholder="Responsável pela verificação">
    </div>
    <label class="block text-[11px] text-slate-400 mt-2">Evidência (uma por linha: <code>tipo|rótulo|valor</code>)
      <input id="ac-right-evidence" type="text" class="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-[12px] text-slate-100 font-mono" placeholder="contrato|Contrato assinado|lic-123"></label>
    ${evidence ? `<ul class="mt-2 list-disc list-inside space-y-0.5">${evidence}</ul>` : ''}
    <div class="flex items-center gap-2 mt-2">
      <button data-ac-act="save-rights" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">Salvar direitos</button>
      ${!r.canProcess ? '<span class="text-[10.5px] text-rose-300">Sem os direitos exigidos, o processamento fica bloqueado.</span>' : ''}
    </div>
  </div>`;
}

function renderDetail() {
  const job = STATE.job && STATE.job.job;
  if (!job) return '<div class="text-[12px] text-slate-400">Tarefa não encontrada.</div>';
  const d = STATE.job;

  const analysis = d.analysis ? `
    <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div class="text-[12px] font-bold text-slate-200 mb-1">3 · Análise inteligente</div>
      <div class="text-[11px] text-slate-400">${esc(d.analysis.totalAnalyzed)} segmento(s) · ${esc((d.analysis.moments || []).length)} momento(s) · média <b class="text-slate-300">${esc(d.analysis.averageScore)}</b> · mínimo ${esc(d.analysis.minScore)}</div>
      <ul class="mt-2 space-y-1">
        ${(d.analysis.moments || []).slice(0, 12).map((m) => `<li class="text-[11px] text-slate-400"><b class="text-sky-300">${esc(m.score)}</b> · ${esc(fmtDur(m.duration))} · ${esc(String(m.text || '').slice(0, 90))}</li>`).join('')}
      </ul>
    </div>` : '';

  const plan = d.plan ? `
    <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div class="flex items-center gap-2 mb-1">
        <div class="text-[12px] font-bold text-slate-200">5 · Plano de edição</div>
        <span class="text-[10.5px] text-slate-500">${esc(d.plan.profileLabel)} · ${esc(d.plan.aspect)} · ${esc(fmtDur(d.plan.totalDuration))}</span>
      </div>
      <ul class="space-y-1">
        ${(d.plan.cuts || []).map((c) => `
          <li class="text-[11px] text-slate-400 rounded-lg border border-white/5 bg-black/20 px-2 py-1.5">
            <div class="flex items-center gap-2">
              <span class="text-slate-200 font-semibold">#${esc(c.index)}</span>
              <span>${esc(fmtDur(c.duration))}</span>
              <span class="text-sky-300">score ${esc(c.score)}</span>
              <span class="ml-auto text-slate-500">${esc(c.captionsCount)} legenda(s)</span>
            </div>
            <div class="text-slate-300">${esc(c.title)}</div>
            <div class="text-slate-500">${esc(c.reason)}</div>
          </li>`).join('')}
      </ul>
    </div>` : '';

  const meta = d.metadata ? `
    <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div class="text-[12px] font-bold text-slate-200 mb-1">6 · Metadados</div>
      <div class="text-[12px] text-slate-200 font-semibold">${esc(d.metadata.title)}</div>
      <div class="text-[11px] text-slate-400 whitespace-pre-wrap mt-1">${esc(d.metadata.description)}</div>
      <div class="mt-2 flex flex-wrap gap-1">${(d.metadata.tags || []).map((t) => `<span class="text-[10.5px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">${esc(t)}</span>`).join('')}</div>
      <div class="mt-1 text-[10.5px] text-sky-300">${(d.metadata.hashtags || []).map(esc).join(' ')}</div>
    </div>` : '';

  const qa = d.qa ? `
    <div class="rounded-2xl border ${d.qa.ok ? 'border-emerald-400/20' : 'border-amber-400/20'} bg-white/5 p-3">
      <div class="flex items-center gap-2 mb-1">
        <div class="text-[12px] font-bold text-slate-200">7 · Controle de qualidade</div>
        <span class="text-[10.5px] px-2 py-0.5 rounded-full border ${d.qa.ok ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200' : 'border-amber-400/30 bg-amber-500/15 text-amber-200'}">${esc(d.qa.passed)}/${esc(d.qa.checks.length)} · nota ${esc(d.qa.score)}</span>
      </div>
      <ul class="space-y-0.5">
        ${d.qa.checks.map((c) => `<li class="text-[11px] ${c.ok ? 'text-slate-400' : 'text-rose-300'}">${c.ok ? '✓' : '✕'} ${esc(c.name)}${c.detail ? ' — ' + esc(c.detail) : ''}</li>`).join('')}
      </ul>
    </div>` : '';

  const render = d.render ? `
    <div class="rounded-2xl border ${d.render.state === 'renderizado' ? 'border-emerald-400/20' : 'border-amber-400/20'} bg-white/5 p-3">
      <div class="text-[12px] font-bold text-slate-200 mb-1">8 · Render</div>
      <div class="text-[11.5px] ${d.render.state === 'renderizado' ? 'text-emerald-200' : 'text-amber-200'}">${esc(d.render.reason || ('estado: ' + d.render.state))}</div>
      ${d.render.hint ? `<div class="text-[10.5px] text-amber-200/80 mt-1">${esc(d.render.hint)}</div>` : ''}
      ${(d.render.commands || []).length ? `<details class="mt-2"><summary class="text-[10.5px] text-slate-400 cursor-pointer">${(d.render.commands || []).length} comando(s) prontos para execução manual</summary>
        <pre class="mt-1 text-[10px] text-slate-400 whitespace-pre-wrap break-all">${(d.render.commands || []).map((c) => esc(c.command)).join('\n')}</pre></details>` : ''}
    </div>` : '';

  const log = (d.log || []).slice(-14).reverse();

  return `${ffmpegBanner()}
  <div class="max-w-[1040px] space-y-3">
    <div class="flex items-center gap-2">
      <button data-ac-act="list" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Voltar</button>
      ${badge(job.statusLabel || job.status)}
      <span class="text-[13px] font-bold text-slate-100 truncate">${esc(job.title)}</span>
      <button data-ac-act="remove" data-id="${esc(job.id)}" class="ml-auto text-[11px] px-2.5 py-1.5 rounded-lg border border-rose-400/20 bg-rose-500/5 hover:bg-rose-500/15 text-rose-300">Remover</button>
    </div>

    <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-[11px] text-slate-400">${esc(job.stageLabel || 'aguardando')} · ${esc(job.progress || 0)}%</span>
        <label class="ml-auto text-[11px] text-slate-400">Perfil
          <select id="ac-job-profile" class="ml-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11.5px] text-slate-100">${profileOptions(job.profileKey)}</select></label>
      </div>
      ${progressBar(job)}
      <div class="flex flex-wrap gap-2 mt-3">
        <button data-ac-act="run" data-id="${esc(job.id)}" class="text-[11.5px] px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold" title="Roda análise, edição, metadados, QA e render">Processar tudo</button>
        <button data-ac-act="analyze" data-id="${esc(job.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Analisar</button>
        <button data-ac-act="edit" data-id="${esc(job.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Gerar plano</button>
        <button data-ac-act="metadata" data-id="${esc(job.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Metadados</button>
        <button data-ac-act="qa" data-id="${esc(job.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">QA</button>
        <button data-ac-act="report" data-id="${esc(job.id)}" class="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300">Relatório</button>
      </div>
      ${job.error ? `<div class="mt-2 text-[11px] text-rose-300">Erro: ${esc(job.error)}</div>` : ''}
    </div>

    ${renderRights(d)}
    ${analysis}
    ${plan}
    ${meta}
    ${qa}
    ${render}

    <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div class="text-[12px] font-bold text-slate-200 mb-1">Histórico</div>
      <ul class="space-y-0.5">
        ${log.map((l) => `<li class="text-[10.5px] text-slate-500"><span class="text-slate-400">[${esc(l.stage)}]</span> ${esc(l.message)}</li>`).join('')}
      </ul>
    </div>
  </div>`;
}

/* ---------------- parsing de entrada ---------------- */
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
  if (raw[0] === '[') {
    try { return JSON.parse(raw); } catch { /* cai para o modo linha */ }
  }
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
function setBusy(flag) { STATE.busy = !!flag; }

async function doCreate() {
  const title = $('#ac-title') ? $('#ac-title').value.trim() : '';
  if (!title) { toast('Informe um título para a tarefa.', 'warn'); return; }
  const profile = $('#ac-profile') ? $('#ac-profile').value : 'podcast';
  const sources = parseSources($('#ac-sources') ? $('#ac-sources').value : '');
  const transcript = parseTranscript($('#ac-transcript') ? $('#ac-transcript').value : '');
  setBusy(true);
  try {
    const r = await api('/create', { method: 'POST', body: { title, sources, transcript, profile: { key: profile } } });
    toast('Tarefa criada.', 'ok');
    await loadJobs();
    await openJob(r.job.id);
  } catch (e) { toast(e.message || 'Falha ao criar a tarefa.', 'err'); }
  finally { setBusy(false); }
}

async function doSaveRights(id) {
  const rights = {};
  document.querySelectorAll('[data-ac-right]').forEach((sel) => { rights[sel.getAttribute('data-ac-right')] = sel.value; });
  const source = $('#ac-right-source') ? $('#ac-right-source').value.trim() : '';
  const responsible = $('#ac-right-responsible') ? $('#ac-right-responsible').value.trim() : '';
  const evidence = parseEvidence($('#ac-right-evidence') ? $('#ac-right-evidence').value : '');
  try {
    const r = await api('/job/' + encodeURIComponent(id) + '/rights', { method: 'PUT', body: { rights, source, responsible, evidence } });
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

async function doReport(id) {
  try {
    const r = await api('/job/' + encodeURIComponent(id) + '/report');
    const rep = r.report || {};
    STATE.job.analysis = rep.analysis; STATE.job.plan = rep.plan; STATE.job.metadata = rep.metadata;
    STATE.job.qa = rep.qa; STATE.job.render = rep.render; STATE.job.log = rep.log;
    render();
    toast('Relatório atualizado.', 'ok');
  } catch (e) { toast(e.message || 'Falha ao gerar o relatório.', 'err'); }
}

async function doRemove(id) {
  try {
    await api('/job/' + encodeURIComponent(id), { method: 'DELETE', body: {} });
    toast('Tarefa removida.', 'ok');
    await loadJobs();
    STATE.view = 'list'; STATE.job = null; render();
  } catch (e) { toast(e.message || 'Falha ao remover.', 'err'); }
}

function startPolling(id) {
  stopPolling();
  STATE.pollTimer = setInterval(async () => {
    try {
      const r = await api('/job/' + encodeURIComponent(id));
      STATE.job = r;
      const st = r.job && r.job.status;
      if (STATE.view === 'detail') renderDetailInto();
      if (!st || ['concluido', 'erro', 'revisao', 'renderizado', 'aguardando_render'].includes(st)) {
        stopPolling();
        await loadJobs();
        if (STATE.view === 'detail') render();
        if (st === 'concluido') toast('Produção automática concluída. Render: ' + (r.render && r.render.state === 'pendente' ? 'pendente (ffmpeg ausente).' : 'ok.'), 'ok');
        else if (st === 'erro') toast('A tarefa terminou com erro.', 'err');
      }
    } catch { stopPolling(); }
  }, 1300);
}
function stopPolling() { if (STATE.pollTimer) { clearInterval(STATE.pollTimer); STATE.pollTimer = null; } }
function renderDetailInto() { const body = $('#ac-body'); if (body && STATE.view === 'detail') body.innerHTML = renderDetail(); }

/* ---------------- bind ---------------- */
function onClick(ev) {
  const t = ev.target.closest('[data-ac-act]');
  if (!t) return;
  const act = t.getAttribute('data-ac-act');
  const id = t.getAttribute('data-id');
  if (act === 'new') { STATE.view = 'create'; render(); }
  else if (act === 'list') { stopPolling(); STATE.view = 'list'; loadJobs().then(render); }
  else if (act === 'reload') { loadStatus().then(loadJobs).then(render).catch(() => {}); }
  else if (act === 'create') doCreate();
  else if (act === 'open') { stopPolling(); openJob(id); }
  else if (act === 'save-rights') doSaveRights(STATE.job.job.id);
  else if (act === 'analyze') doStep(id, 'analyze', 'Análise');
  else if (act === 'edit') { if ($('#ac-job-profile') && STATE.job) doJobProfile(id); else doStep(id, 'edit', 'Plano'); }
  else if (act === 'metadata') doStep(id, 'metadata', 'Metadados');
  else if (act === 'qa') doStep(id, 'qa', 'Controle de qualidade');
  else if (act === 'run') doRun(id);
  else if (act === 'report') doReport(id);
  else if (act === 'remove') doRemove(id);
}

document.addEventListener('click', onClick);
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
    else { loadStatus().then(loadJobs).then(render).catch(() => {}); }
  } catch (e) { console.error('[autoclips] open erro:', e); }
};
window.__autoclipsOnTabClose = function () { stopPolling(); };

async function boot() {
  try {
    await loadStatus();
    await loadJobs();
    STATE.view = 'list';
    render();
  } catch (e) {
    STATE.view = 'list';
    render();
    toast('Não foi possível carregar o AutoClips: ' + (e.message || ''), 'err');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { if ($('#ac-panel') && !$('#ac-panel').classList.contains('hidden')) window.__autoclipsOnTabOpen(); });
} else {
  if ($('#ac-panel') && !$('#ac-panel').classList.contains('hidden')) window.__autoclipsOnTabOpen();
}
