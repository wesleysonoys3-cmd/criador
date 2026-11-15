/* =========================================================
 * autoclips/covers.js — Capas automáticas (3 opções por corte)
 * ---------------------------------------------------------
 * Gera 3 variações de capa em SVG a partir do momento do corte:
 *   - usa a miniatura real do vídeo (quando disponível);
 *   - título relacionado ao conteúdo;
 *   - dimensões conforme o formato (9:16, 1:1, 16:9);
 *   - cores/estilos distintos para o usuário escolher.
 *
 * SVG é real, renderizável e editável. Nada é simulado: se não
 * houver miniatura, a capa usa apenas o fundo + título (honesto).
 * =======================================================*/

export const DIMENSIONS = {
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Quebra o título em linhas aproximadamente equilibradas. */
function wrap(text, maxChars) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur.length) { cur = w; continue; }
    if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

function textBlock(lines, { x, y, size, weight = 800, fill = '#ffffff', anchor = 'middle', lineGap = 1.14 }) {
  const step = Math.round(size * lineGap);
  return lines.map((ln, i) =>
    `<text x="${x}" y="${y + i * step}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(ln)}</text>`
  ).join('');
}

function imageLayer(thumb, w, h) {
  if (!thumb) return '';
  // Preserva enquadramento cobrindo a área; a miniatura real é opcional.
  return `<image href="${esc(thumb)}" xlink:href="${esc(thumb)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
}

/* Estilo 1 — Impacto: título grande centralizado sobre a imagem. */
function styleImpact({ w, h, title, thumb, author }) {
  const size = Math.round(Math.min(w, h) * 0.085);
  const lines = wrap(title, 18);
  const baseY = Math.round(h * 0.5);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b0618" stop-opacity="0.15"/><stop offset="0.55" stop-color="#160a2b" stop-opacity="0.62"/><stop offset="1" stop-color="#2a0f4d" stop-opacity="0.94"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="#120826"/>
  ${imageLayer(thumb, w, h)}
  <rect width="${w}" height="${h}" fill="url(#g1)"/>
  ${textBlock(lines, { x: w / 2, y: baseY - (lines.length - 1) * Math.round(size * 1.14) / 2, size, fill: '#ffffff' })}
  ${author ? `<text x="${w / 2}" y="${Math.round(h * 0.9)}" font-family="Inter, Arial, sans-serif" font-size="${Math.round(size * 0.42)}" font-weight="600" fill="#e9d5ff" text-anchor="middle">${esc(author)}</text>` : ''}
</svg>`;
}

/* Estilo 2 — Faixa: imagem no topo e faixa de destaque com o título. */
function styleBand({ w, h, title, thumb, author }) {
  const bandH = Math.round(h * 0.34);
  const size = Math.round(Math.min(w, bandH) * 0.20);
  const lines = wrap(title, 16);
  const y0 = h - bandH + Math.round(bandH * 0.34);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7e22ce"/><stop offset="1" stop-color="#c026d3"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="#120826"/>
  ${imageLayer(thumb, w, h - bandH)}
  <rect x="0" y="${h - bandH}" width="${w}" height="${bandH}" fill="url(#g2)"/>
  ${textBlock(lines, { x: Math.round(w * 0.06), y: y0, size, anchor: 'start', fill: '#ffffff' })}
  ${author ? `<text x="${Math.round(w * 0.06)}" y="${Math.round(h - bandH * 0.16)}" font-family="Inter, Arial, sans-serif" font-size="${Math.round(size * 0.44)}" font-weight="600" fill="#fbe8ff" text-anchor="start">${esc(author)}</text>` : ''}
</svg>`;
}

/* Estilo 3 — Split: barra lateral roxa + título à esquerda. */
function styleSplit({ w, h, title, thumb, author }) {
  const barW = Math.round(w * 0.10);
  const size = Math.round(Math.min(w, h) * 0.072);
  const lines = wrap(title, 16);
  const x = barW + Math.round(w * 0.06);
  const y0 = Math.round(h * 0.42);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs><linearGradient id="g3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0abfc"/><stop offset="1" stop-color="#7c3aed"/></linearGradient>
  <linearGradient id="g3b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0618" stop-opacity="0.35"/><stop offset="1" stop-color="#0b0618" stop-opacity="0.86"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="#0b0618"/>
  ${imageLayer(thumb, w, h)}
  <rect width="${w}" height="${h}" fill="url(#g3b)"/>
  <rect x="0" y="0" width="${barW}" height="${h}" fill="url(#g3)"/>
  ${textBlock(lines, { x, y: y0, size, anchor: 'start', fill: '#ffffff' })}
  ${author ? `<text x="${x}" y="${Math.round(h * 0.86)}" font-family="Inter, Arial, sans-serif" font-size="${Math.round(size * 0.46)}" font-weight="600" fill="#e9d5ff" text-anchor="start">${esc(author)}</text>` : ''}
</svg>`;
}

/* Gera 3 opções de capa para um corte. */
export function buildCovers({ cut = {}, info = null, aspect = '9:16', title = '' } = {}) {
  const dims = DIMENSIONS[aspect] || DIMENSIONS['9:16'];
  const thumb = (info && info.thumbnail) || null;
  const author = (info && info.author) || null;
  const text = String(title || cut.title || cut.caption || 'Corte').trim();
  const ctx = { w: dims.w, h: dims.h, title: text, thumb, author };
  const covers = [
    { key: 'impacto', label: 'Impacto', style: 'Título grande centralizado', svg: styleImpact(ctx) },
    { key: 'faixa', label: 'Faixa', style: 'Barra de destaque inferior', svg: styleBand(ctx) },
    { key: 'split', label: 'Split', style: 'Barra lateral + texto', svg: styleSplit(ctx) },
  ];
  return {
    ok: true,
    aspect,
    width: dims.w,
    height: dims.h,
    hasThumbnail: !!thumb,
    note: thumb ? 'Capas usam a miniatura real do vídeo.' : 'Sem miniatura disponível: capas usam fundo + título (honesto).',
    covers,
  };
}

export function dimensionsFor(aspect) { return DIMENSIONS[aspect] || DIMENSIONS['9:16']; }
