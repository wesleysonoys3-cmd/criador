/* =========================================================
 * youtube/publisher.js — Publicação no YouTube (PARTE 8.3)
 * ---------------------------------------------------------
 * - Publicar agora / agendar / privado / não listado / público.
 * - Validação de metadados, prevenção de duplicidade e trava de
 *   cota diária antes de chamar a API.
 * - Botão de emergência (emergencyStop) interrompe publicações.
 * - Registra id/url/data/status/erros/tentativas de cada publicação.
 *
 * O upload é sempre a partir de um ARQUIVO LOCAL já renderizado —
 * a API oficial não baixa vídeo de uma URL qualquer.
 * =======================================================*/
import fs from 'node:fs/promises';
import { uploadVideo, updateVideo } from './client.js';
import { newPublicationId } from './state.js';

const _log = (...a) => console.log('[YOUTUBE][publisher]', ...a);

export const VISIBILITIES = ['public', 'unlisted', 'private'];
export const PUB_STATUS = ['rascunho', 'bloqueado', 'enviando', 'agendado', 'publicado', 'erro', 'cancelado'];

export function nowIso() { return new Date().toISOString(); }

/* Monta o snippet aceito pela API a partir dos metadados do AutoClips. */
export function buildSnippet(metadata, fallbackTitle) {
  const m = metadata || {};
  const title = String(m.title || fallbackTitle || 'Corte').slice(0, 100);
  const description = String(m.description || '').slice(0, 5000);
  const rawTags = Array.isArray(m.tags) ? m.tags : [];
  const tags = [];
  let budget = 500; // YouTube: soma dos tags <= 500 caracteres
  for (const t of rawTags) {
    const s = String(t || '').trim();
    if (!s) continue;
    if (s.length + 1 > budget) break;
    tags.push(s.slice(0, 60));
    budget -= s.length + 1;
  }
  return {
    title: title || 'Corte',
    description,
    tags,
    categoryId: String(m.categoryId || '22'),
    defaultLanguage: String(m.language || 'pt-BR'),
  };
}

/* Monta o status (visibilidade/agendamento). */
export function buildStatus({ visibility, scheduledAt, madeForKids = false }) {
  const vis = VISIBILITIES.indexOf(String(visibility || '')) >= 0 ? String(visibility) : 'private';
  const status = { privacyStatus: vis, selfDeclaredMadeForKids: !!madeForKids };
  const at = scheduledAt ? Date.parse(scheduledAt) : 0;
  if (at && at > Date.now()) {
    // Agendamento oficial: privacyStatus=private + publishAt (ISO 8601)
    status.privacyStatus = 'private';
    status.publishAt = new Date(at).toISOString();
  }
  return status;
}

export function isScheduled(status) { return !!(status && status.publishAt); }

/* Validação prévia (não chama a API). */
export function validatePublish({ snippet, filePath, fileExists }) {
  const issues = [];
  if (!snippet || !String(snippet.title || '').trim()) issues.push('Título é obrigatório.');
  else if (String(snippet.title).length > 100) issues.push('Título acima de 100 caracteres.');
  if (snippet && /[<>]/.test(String(snippet.title || ''))) issues.push('Título não pode conter "<" nem ">".');
  if (!filePath) issues.push('Arquivo de vídeo não informado.');
  else if (fileExists === false) issues.push('Arquivo de vídeo não encontrado no servidor.');
  return { ok: issues.length === 0, issues };
}

/* Chave de deduplicação: mesmo job + mesmo arquivo não publica 2x. */
export function dedupeKey({ jobId, filePath, size, mtimeMs }) {
  return [String(jobId || '-'), String(filePath || ''), String(size == null ? '' : size), String(mtimeMs == null ? '' : mtimeMs)].join('|');
}

export function findDuplicate(state, key) {
  if (!key) return null;
  return state.allPublications().find((p) =>
    p.dedupeKey === key && (p.status === 'publicado' || p.status === 'agendado' || p.status === 'enviando')
  ) || null;
}

/* Conta publicações de hoje (visibilidade pública/agendada) para a trava diária. */
export function countToday(state, nowDate) {
  const d = nowDate || new Date();
  const y = d.getFullYear(); const m = d.getMonth(); const day = d.getDate();
  return state.allPublications().filter((p) => {
    if (p.status !== 'publicado' && p.status !== 'agendado') return false;
    const t = Date.parse(p.createdAt || p.publishedAt || '');
    if (!t) return false;
    const pd = new Date(t);
    return pd.getFullYear() === y && pd.getMonth() === m && pd.getDate() === day;
  }).length;
}

/* Métricas de arquivo (tamanho + mtime) para a chave de deduplicação. */
export async function fileFingerprint(filePath) {
  try {
    const st = await fs.stat(filePath);
    return { exists: true, size: st.size, mtimeMs: Math.round(st.mtimeMs) };
  } catch {
    return { exists: false, size: null, mtimeMs: null };
  }
}

/*
 * Publica (ou agenda) um corte. Retorna sempre { ok, publication } e
 * registra o resultado no estado — inclusive nos bloqueios (honesto).
 */
export async function publish(ctx) {
  const { state, accessToken, filePath, metadata, visibility, scheduledAt, jobId, owner, config, reasonLabel } = ctx;
  const cfg = config || {};
  const snippet = buildSnippet(metadata, jobId ? ('Corte ' + jobId) : 'Corte');
  const status = buildStatus({ visibility, scheduledAt });

  const fp = await fileFingerprint(filePath);
  const key = dedupeKey({ jobId, filePath, size: fp.size, mtimeMs: fp.mtimeMs });

  const pub = {
    id: newPublicationId(),
    owner: owner || 'local',
    jobId: jobId || null,
    filePath: filePath || null,
    createdAt: nowIso(),
    visibility: status.privacyStatus,
    scheduledAt: status.publishAt || null,
    dedupeKey: key,
    attempts: 0,
    status: 'rascunho',
    videoId: null,
    url: null,
    error: null,
    snippet: { title: snippet.title, description: snippet.description, tags: snippet.tags },
    note: reasonLabel || 'manual',
  };

  const block = (reason, code) => {
    pub.status = 'bloqueado';
    pub.error = reason;
    pub.code = code || 'bloqueado';
    state.appendActivity({ type: 'publicacao_bloqueada', id: pub.id, reason, code: code || 'bloqueado' });
    return { ok: false, code: code || 'bloqueado', reason, publication: pub };
  };

  if (cfg.emergencyStop) return await persist(state, block('Publicações interrompidas pelo botão de emergência.', 'emergencia'));

  const val = validatePublish({ snippet, filePath, fileExists: fp.exists });
  if (!val.ok) return await persist(state, block(val.issues.join(' '), 'validacao'));

  const dup = findDuplicate(state, key);
  if (dup) return await persist(state, block('Este corte já foi publicado/agendado (evitando duplicidade).', 'duplicado'));

  if (cfg.dailyLimit && cfg.dailyLimit > 0 && countToday(state) >= cfg.dailyLimit) {
    return await persist(state, block('Limite diário de publicações atingido (' + cfg.dailyLimit + ').', 'cota_diaria'));
  }
  if (!accessToken) return await persist(state, block('Canal do YouTube não conectado.', 'sem_conexao'));

  pub.status = 'enviando';
  pub.attempts = 1;
  await state.savePublication(pub);
  state.appendActivity({ type: 'publicacao_iniciada', id: pub.id, visibility: pub.visibility, scheduled: !!pub.scheduledAt });

  const r = await uploadVideo({ accessToken, filePath, snippet, status });
  if (!r.ok) {
    pub.status = 'erro';
    pub.error = r.reason || 'Falha no envio.';
    pub.code = r.quota ? 'cota_api' : 'upload';
    state.appendActivity({ type: 'publicacao_erro', id: pub.id, error: pub.error, quota: !!r.quota });
    return await persist(state, { ok: false, code: pub.code, reason: pub.error, publication: pub });
  }

  pub.videoId = r.video.id;
  pub.url = 'https://www.youtube.com/watch?v=' + r.video.id;
  pub.status = isScheduled(status) ? 'agendado' : 'publicado';
  pub.publishedAt = nowIso();
  pub.error = null;
  state.appendActivity({ type: 'publicacao_ok', id: pub.id, videoId: pub.videoId, status: pub.status });
  _log('publicado:', pub.id, '→', pub.url, '(' + pub.status + ')');
  return await persist(state, { ok: true, publication: pub });
}

/* Atualiza um vídeo já publicado (ex.: trocar visibilidade). */
export async function republishStatus({ state, accessToken, publication, visibility }) {
  if (!publication || !publication.videoId) return { ok: false, reason: 'Publicação sem vídeo associado.' };
  const r = await updateVideo({ accessToken, videoId: publication.videoId, status: buildStatus({ visibility }) });
  if (!r.ok) return r;
  publication.visibility = visibility;
  state.appendActivity({ type: 'publicacao_visibilidade', id: publication.id, visibility });
  await state.savePublication(publication);
  return { ok: true, publication };
}

async function persist(state, result) {
  try { await state.savePublication(result.publication); } catch (e) { _log('erro ao salvar publicação:', String((e && e.message) || e)); }
  return result;
}
