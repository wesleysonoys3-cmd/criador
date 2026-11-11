/* =========================================================
 * analytics/service.js — Histórico e Analytics do AutoClips (PARTE 9)
 * ---------------------------------------------------------
 * Reúne, em um só lugar:
 *   - Histórico de vídeos processados (AutoClips).
 *   - Cortes gerados.
 *   - Publicações (YouTube).
 *   - Calendário de publicações/agendamentos.
 *   - Estado da fila de processamento.
 *   - Métricas oficiais (visualizações, curtidas, comentários) quando a
 *     integração do YouTube está conectada.
 *   - Desempenho por perfil de edição.
 *   - Recomendações baseadas APENAS nos dados reais.
 *
 * Honestidade (regra do projeto): não promete viralização; nenhuma
 * recomendação altera regras do usuário sem autorização; métricas só
 * aparecem quando há integração oficial conectada.
 * =======================================================*/
import path from 'node:path';
import state, { SCHEMA } from './state.js';

const _log = (...a) => console.log('[ANALYTICS][service]', ...a);

let _autoclipsSvc = null;
let _youtubeSvc = null;
let _initialized = false;

/* Estágios em que a tarefa já foi processada (passou do rascunho/direitos). */
const PROCESSED = ['analisado', 'editado', 'revisao', 'concluido', 'aguardando_render', 'renderizado', 'erro'];
const PUBLISHED_STATES = ['publicado', 'agendado'];

function nowIso() { return new Date().toISOString(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function init({ dataDir = null, autoclipsSvc = null, youtubeSvc = null } = {}) {
  if (dataDir) state.setDataDir(dataDir);
  if (autoclipsSvc) _autoclipsSvc = autoclipsSvc;
  if (youtubeSvc) _youtubeSvc = youtubeSvc;
  if (!_initialized) {
    _initialized = true;
    state.loadAll().catch((e) => _log('loadAll erro: ' + String((e && e.message) || e)));
  }
  return { ok: true, dataDir: state.dataDir };
}

/* ---------------- Fontes ---------------- */
function jobs(owner) {
  try { return (_autoclipsSvc && _autoclipsSvc.list(owner).items) || []; } catch { return []; }
}
function pubs(owner) {
  try { return (_youtubeSvc && _youtubeSvc.listPublications(owner).items) || []; } catch { return []; }
}
function jobMap(owner) {
  const m = new Map();
  for (const j of jobs(owner)) m.set(j.id, j);
  return m;
}
function connected() {
  try { return !!(_youtubeSvc && _youtubeSvc.status().connected); } catch { return false; }
}
function stat(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* ---------------- Visão geral ---------------- */
export function overview(owner) {
  const jl = jobs(owner);
  const pl = pubs(owner);

  const byStatus = {};
  for (const j of jl) byStatus[j.status] = (byStatus[j.status] || 0) + 1;

  const clipsGenerated = jl.reduce((s, j) => s + num(j.plan && j.plan.cutsCount), 0);

  const pubByStatus = {}; const pubByVis = {};
  for (const p of pl) {
    pubByStatus[p.status] = (pubByStatus[p.status] || 0) + 1;
    pubByVis[p.visibility] = (pubByVis[p.visibility] || 0) + 1;
  }

  const cached = state.all();
  const totals = cached.reduce((a, m) => ({
    views: a.views + num(m.views), likes: a.likes + num(m.likes), comments: a.comments + num(m.comments),
  }), { views: 0, likes: 0, comments: 0 });

  const ac = _autoclipsSvc ? _autoclipsSvc.status() : null;

  return {
    ok: true,
    videos: {
      total: jl.length,
      processed: jl.filter((j) => PROCESSED.indexOf(j.status) >= 0).length,
      byStatus,
    },
    clips: {
      generated: clipsGenerated,
      published: pl.filter((p) => PUBLISHED_STATES.indexOf(p.status) >= 0).length,
    },
    publications: { total: pl.length, byStatus: pubByStatus, byVisibility: pubByVis },
    metrics: {
      tracked: cached.length,
      views: totals.views,
      likes: totals.likes,
      comments: totals.comments,
      lastFetchedAt: cached.length ? cached.reduce((m, x) => (x.fetchedAt && x.fetchedAt > m ? x.fetchedAt : m), '') : null,
    },
    queue: ac ? {
      running: ac.queue.running, current: ac.queue.current,
      pendingCount: ac.queue.pendingCount, maxAttempts: ac.queue.maxAttempts,
    } : null,
    ffmpeg: ac ? ac.ffmpeg : null,
    connected: connected(),
    disclaimers: [
      'Não há garantia de visualizações nem promessa de viralização.',
      'As métricas dependem da integração oficial do YouTube e podem levar horas para atualizar.',
    ],
  };
}

/* ---------------- Histórico ---------------- */
export function history(owner, limit = 100) {
  const jl = jobs(owner);
  const pl = pubs(owner);
  const items = [];

  for (const j of jl) {
    items.push({
      type: 'job', at: j.updatedAt || j.createdAt, id: j.id, title: j.title,
      status: j.status, statusLabel: j.statusLabel, profileKey: j.profileKey,
      cuts: j.plan ? j.plan.cutsCount : 0, score: j.qa ? j.qa.score : null,
      render: j.render ? j.render.state : null, error: j.error || null,
    });
  }
  for (const p of pl) {
    items.push({
      type: 'publication', at: p.publishedAt || p.scheduledAt || p.createdAt, id: p.id,
      title: (p.snippet && p.snippet.title) || '', status: p.status, visibility: p.visibility,
      url: p.url || null, jobId: p.jobId || null, scheduledAt: p.scheduledAt || null,
      error: p.error || null,
    });
  }

  items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return { ok: true, items: items.slice(0, Math.max(1, Math.min(500, limit))) };
}

/* ---------------- Calendário ---------------- */
export function calendar({ month, owner } = {}) {
  const pl = pubs(owner);
  const key = (month && /^\d{4}-\d{2}$/.test(String(month))) ? String(month) : new Date().toISOString().slice(0, 7);
  const days = {};
  for (const p of pl) {
    const at = p.scheduledAt || p.publishedAt || p.createdAt;
    if (!at) continue;
    const d = String(at).slice(0, 10);
    if (!d.startsWith(key)) continue;
    if (!days[d]) days[d] = [];
    days[d].push({
      id: p.id, title: (p.snippet && p.snippet.title) || '', status: p.status,
      visibility: p.visibility, url: p.url || null, scheduledAt: p.scheduledAt || null,
    });
  }
  return { ok: true, month: key, days };
}

/* ---------------- Fila ---------------- */
export function queueState(owner) {
  const ac = _autoclipsSvc ? _autoclipsSvc.status() : null;
  const jl = jobs(owner);
  const items = jl.filter((j) => j.queued || j.status === 'processando').map((j) => ({
    id: j.id, title: j.title, status: j.status, statusLabel: j.statusLabel,
    progress: j.progress, stageLabel: j.stageLabel, attempts: j.attempts, queued: !!j.queued,
  }));
  return {
    ok: true,
    running: ac ? ac.queue.running : false,
    current: ac ? ac.queue.current : null,
    pendingCount: ac ? ac.queue.pendingCount : 0,
    maxAttempts: ac ? ac.queue.maxAttempts : null,
    items,
    ffmpeg: ac ? ac.ffmpeg : null,
    note: 'A fila retoma automaticamente as tarefas interrompidas ao reiniciar o servidor.',
  };
}

/* ---------------- Métricas oficiais (PARTE 9) ---------------- */
export async function metrics(owner, { refresh = false } = {}) {
  const pl = pubs(owner);
  const published = pl.filter((p) => p.videoId && PUBLISHED_STATES.indexOf(p.status) >= 0);
  const ids = published.map((p) => p.videoId);
  const jm = jobMap(owner);

  let fetched = null;
  if (refresh) {
    if (!_youtubeSvc) return { ok: false, reason: 'Módulo YouTube indisponível.' };
    if (!ids.length) return { ok: true, items: [], totals: { views: 0, likes: 0, comments: 0 }, fetchedAt: null, fetched: false, note: 'Nenhum vídeo publicado para consultar métricas.' };
    const r = await _youtubeSvc.fetchVideoStats(ids);
    if (!r.ok) return { ok: false, code: r.code || null, reason: r.reason || 'Não foi possível consultar as estatísticas.' };
    const at = nowIso();
    const entries = [];
    for (const v of (r.videos || [])) {
      const pub = published.find((p) => p.videoId === v.id) || null;
      const st = v.statistics || {};
      const job = pub && pub.jobId ? jm.get(pub.jobId) : null;
      entries.push({
        videoId: v.id,
        title: v.title || (pub && pub.snippet && pub.snippet.title) || '',
        publicationId: pub ? pub.id : null,
        jobId: pub ? pub.jobId : null,
        profileKey: job ? job.profileKey : null,
        visibility: pub ? pub.visibility : null,
        publishedAt: pub ? (pub.publishedAt || null) : null,
        views: stat(st.viewCount), likes: stat(st.likeCount),
        comments: stat(st.commentCount), favorites: stat(st.favoriteCount),
        fetchedAt: at,
      });
    }
    await state.setMetrics(entries);
    state.appendSnapshots(entries.map((e) => ({ at: e.fetchedAt, videoId: e.videoId, views: e.views, likes: e.likes, comments: e.comments })));
    fetched = { at, count: entries.length };
  }

  const items = published.map((p) => {
    const cached = p.videoId ? state.get(p.videoId) : null;
    const job = p.jobId ? jm.get(p.jobId) : null;
    return {
      videoId: p.videoId, publicationId: p.id, jobId: p.jobId,
      profileKey: job ? job.profileKey : (cached ? cached.profileKey : null),
      title: (p.snippet && p.snippet.title) || (cached && cached.title) || '',
      visibility: p.visibility, status: p.status, url: p.url || null,
      publishedAt: p.publishedAt || null,
      views: cached ? cached.views : null, likes: cached ? cached.likes : null,
      comments: cached ? cached.comments : null, fetchedAt: cached ? cached.fetchedAt : null,
    };
  });

  const totals = items.reduce((a, i) => ({
    views: a.views + num(i.views), likes: a.likes + num(i.likes), comments: a.comments + num(i.comments),
  }), { views: 0, likes: 0, comments: 0 });

  let lastAt = fetched ? fetched.at : null;
  if (!lastAt) { for (const i of items) if (i.fetchedAt && (!lastAt || i.fetchedAt > lastAt)) lastAt = i.fetchedAt; }

  return {
    ok: true,
    items,
    totals,
    byProfile: byProfile(items),
    fetchedAt: lastAt,
    fetched: !!fetched,
    connected: connected(),
    note: connected() ? null : 'Conecte o canal do YouTube para buscar as métricas oficiais.',
  };
}

/* Desempenho por perfil de edição (usa apenas vídeos com métricas). */
function byProfile(items) {
  const acc = new Map();
  for (const i of items) {
    const key = i.profileKey || 'sem_perfil';
    if (!acc.has(key)) acc.set(key, { profileKey: key, count: 0, measured: 0, views: 0, likes: 0, comments: 0 });
    const a = acc.get(key);
    a.count += 1;
    if (i.views != null) { a.measured += 1; a.views += num(i.views); a.likes += num(i.likes); a.comments += num(i.comments); }
  }
  return Array.from(acc.values()).map((a) => ({
    profileKey: a.profileKey,
    count: a.count,
    measured: a.measured,
    views: a.views, likes: a.likes, comments: a.comments,
    avgViews: a.measured ? Math.round(a.views / a.measured) : null,
    avgLikes: a.measured ? Math.round(a.likes / a.measured) : null,
  })).sort((x, y) => (y.avgViews || 0) - (x.avgViews || 0));
}

/* ---------------- Recomendações (honestas, baseadas em dados reais) ---------------- */
export function recommendations(owner) {
  const jl = jobs(owner);
  const pl = pubs(owner);
  const cached = state.all();
  const recs = [];

  if (!connected()) {
    recs.push({ id: 'conectar', level: 'info', title: 'Conecte o canal do YouTube',
      text: 'Sem a conexão oficial não é possível medir visualizações, curtidas e comentários.' });
  }
  if (!pl.length) {
    recs.push({ id: 'publicar', level: 'info', title: 'Publique um corte para começar a medir',
      text: jl.length ? 'Você já tem tarefas no AutoClips — publique um corte para gerar métricas.' : 'Crie e processe um vídeo no AutoClips e depois publique um corte.' });
  }
  if (pl.length && !cached.length) {
    recs.push({ id: 'atualizar', level: 'sugestao', title: 'Atualize as métricas',
      text: 'Há publicações registradas, mas nenhuma métrica foi buscada ainda. Use "Atualizar métricas".' });
  }

  if (cached.length) {
    const jm = jobMap(owner);
    const perf = byProfile(pl.filter((p) => p.videoId).map((p) => {
      const job = p.jobId ? jm.get(p.jobId) : null;
      const c = state.get(p.videoId);
      return { profileKey: job ? job.profileKey : (c && c.profileKey), views: c ? c.views : null, likes: c ? c.likes : null, comments: c ? c.comments : null };
    }));
    const measured = perf.filter((p) => p.measured > 0);
    if (measured.length >= 2) {
      const best = measured[0];
      const worst = measured[measured.length - 1];
      if (best.avgViews > worst.avgViews) {
        recs.push({ id: 'perfil', level: 'sugestao', title: 'Perfil com melhor média: ' + best.profileKey,
          text: 'A média de visualizações do perfil "' + best.profileKey + '" (' + best.avgViews + ') está acima de "' + worst.profileKey + '" (' + worst.avgViews + '). Considere priorizar esse perfil.' });
      }
    }
    const zeros = cached.filter((c) => num(c.views) === 0);
    if (zeros.length) {
      recs.push({ id: 'sem_views', level: 'atencao', title: zeros.length + ' vídeo(s) sem visualizações',
        text: 'Revise título, miniatura, horário e visibilidade (o vídeo pode estar privado). Nenhuma garantia de alcance — são apenas pontos a verificar.' });
    }
    if (measured.length) {
      const sum = measured.reduce((a, p) => a + p.likes + p.comments, 0);
      const views = measured.reduce((a, p) => a + p.views, 0);
      if (views > 0) {
        const rate = ((sum / views) * 100).toFixed(2);
        recs.push({ id: 'engajamento', level: 'info', title: 'Taxa de engajamento aproximada: ' + rate + '%',
          text: 'Curtidas + comentários divididos por visualizações. Serve como referência para comparar seus próprios cortes.' });
      }
    }
  }

  // Publicação automática — apenas sugere; nunca altera regras sozinha.
  let cfg = null;
  try { cfg = _youtubeSvc ? _youtubeSvc.getConfig() : null; } catch { cfg = null; }
  if (cfg && !cfg.enabled) {
    const eligible = jl.filter((j) => (j.status === 'concluido' || j.status === 'renderizado') && (!j.qa || num(j.qa.score) >= cfg.minScore));
    if (eligible.length) {
      recs.push({ id: 'auto', level: 'info', title: 'Há ' + eligible.length + ' corte(s) elegível(is)',
        text: 'A publicação automática está desligada. Se quiser, habilite as regras (limite diário, horários e nota mínima) na aba YouTube — nada é publicado sem a sua configuração.' });
    }
  }

  return {
    ok: true,
    items: recs,
    disclaimer: 'Recomendações baseadas apenas nos seus dados. Não há promessa de viralização.',
  };
}

export function status() {
  return {
    ok: true,
    schema: SCHEMA,
    dataDir: state.dataDir,
    trackedVideos: state.metrics.size,
    snapshots: state.snapshots.length,
    connected: connected(),
    autoclips: !!_autoclipsSvc,
    youtube: !!_youtubeSvc,
  };
}
