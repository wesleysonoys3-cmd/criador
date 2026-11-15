/* =========================================================
 * autoclips/captions.js — Legendas editáveis e animadas
 * ---------------------------------------------------------
 * Catálogo de ESTILOS e ANIMAÇÕES de legenda usado tanto na prévia
 * da interface quanto na geração dos arquivos de legenda (SRT) e na
 * formatação aplicada pelo ffmpeg no render.
 *
 * Nada aqui depende de IA externa: o estilo é configuração explícita
 * e auditável. A prévia na interface usa exatamente os mesmos campos.
 * =======================================================*/

export const CAPTION_POSITIONS = ['superior', 'centro', 'inferior'];
export const POSITION_LABELS = { superior: 'Superior', centro: 'Centro', inferior: 'Inferior' };

/* Estilos visuais. `assAlignment` segue a numeração do formato ASS
 * (2 = base central, 5 = meio central, 8 = topo central). */
export const CAPTION_STYLES = [
  {
    key: 'padrao', label: 'Padrão', description: 'Texto branco com contorno escuro, legível em qualquer fundo.',
    font: 'Arial', size: 46, bold: true, uppercase: false, color: '#FFFFFF',
    bg: 'rgba(0,0,0,0.55)', outline: '#000000', outlineWidth: 3, assAlignment: 2,
  },
  {
    key: 'impacto', label: 'Impacto', description: 'Caixa alta, fonte grande e fundo forte para cortes virais.',
    font: 'Arial Black', size: 58, bold: true, uppercase: true, color: '#FFFFFF',
    bg: 'rgba(217,70,239,0.82)', outline: '#1E1B4B', outlineWidth: 4, assAlignment: 2,
  },
  {
    key: 'podcast', label: 'Podcast', description: 'Discreto, na base, com faixa escura semitransparente.',
    font: 'Arial', size: 42, bold: false, uppercase: false, color: '#F8FAFC',
    bg: 'rgba(15,23,42,0.72)', outline: '#000000', outlineWidth: 2, assAlignment: 2,
  },
  {
    key: 'didatico', label: 'Didático', description: 'Alto contraste para aulas e explicações passo a passo.',
    font: 'Verdana', size: 44, bold: true, uppercase: false, color: '#0F172A',
    bg: 'rgba(250,250,250,0.92)', outline: '#94A3B8', outlineWidth: 2, assAlignment: 2,
  },
  {
    key: 'entrevista', label: 'Entrevista', description: 'Centralizado, com o nome do falante destacado.',
    font: 'Georgia', size: 42, bold: false, uppercase: false, color: '#FFFFFF',
    bg: 'rgba(30,41,59,0.68)', outline: '#000000', outlineWidth: 2, assAlignment: 2,
  },
  {
    key: 'debate', label: 'Debate', description: 'Contraste lateral, bom para duas ou mais falas.',
    font: 'Arial', size: 44, bold: true, uppercase: false, color: '#FDE68A',
    bg: 'rgba(0,0,0,0.78)', outline: '#7C2D12', outlineWidth: 3, assAlignment: 2,
  },
  {
    key: 'minimalista', label: 'Minimalista', description: 'Sem caixa: só o texto com leve contorno.',
    font: 'Helvetica', size: 40, bold: false, uppercase: false, color: '#FFFFFF',
    bg: 'rgba(0,0,0,0)', outline: '#000000', outlineWidth: 4, assAlignment: 2,
  },
];

export const CAPTION_ANIMATIONS = [
  { key: 'nenhuma', label: 'Sem animação', description: 'O bloco aparece e permanece até o fim do trecho.' },
  { key: 'aparecer', label: 'Aparecer', description: 'Surgimento suave no início do bloco.' },
  { key: 'palavra', label: 'Palavra a palavra', description: 'As palavras surgem em sequência, no ritmo da fala.' },
  { key: 'digitar', label: 'Máquina de escrever', description: 'O texto é revelado caractere por caractere.' },
  { key: 'karaoke', label: 'Karaokê', description: 'A palavra falada é destacada por cor.' },
  { key: 'zoom', label: 'Zoom', description: 'Leve aumento ao entrar e ao sair do bloco.' },
];

const STYLE_BY_KEY = new Map(CAPTION_STYLES.map((s) => [s.key, s]));
const ANIM_KEYS = new Set(CAPTION_ANIMATIONS.map((a) => a.key));

export function styleByKey(key) {
  return STYLE_BY_KEY.get(String(key || '')) || STYLE_BY_KEY.get('padrao');
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/* Configuração de legenda de um trabalho. Sempre devolve um objeto
 * completo, mesmo que a entrada esteja vazia. */
export function normalizeCaptions(input, base = null) {
  const b = normalizeBase(base);
  const src = input && typeof input === 'object' ? input : {};
  const style = STYLE_BY_KEY.has(String(src.style)) ? String(src.style) : b.style;
  const animation = ANIM_KEYS.has(String(src.animation)) ? String(src.animation) : b.animation;
  const position = CAPTION_POSITIONS.includes(String(src.position)) ? String(src.position) : b.position;
  return {
    enabled: src.enabled === undefined ? b.enabled : src.enabled !== false,
    style,
    animation,
    position,
    maxChars: clampNum(src.maxChars, 12, 60, b.maxChars),
    uppercase: src.uppercase === undefined ? b.uppercase : src.uppercase === true,
  };
}

function normalizeBase(base) {
  const s = base && typeof base === 'object' ? base : {};
  return {
    enabled: s.enabled !== false,
    style: STYLE_BY_KEY.has(String(s.style)) ? String(s.style) : 'padrao',
    animation: ANIM_KEYS.has(String(s.animation)) ? String(s.animation) : 'aparecer',
    position: CAPTION_POSITIONS.includes(String(s.position)) ? String(s.position) : 'inferior',
    maxChars: clampNum(s.maxChars, 12, 60, 42),
    uppercase: s.uppercase === true,
  };
}

export function defaultCaptions() { return normalizeBase(null); }

/* Catálogo exposto à interface. */
export function catalog() {
  return {
    ok: true,
    styles: CAPTION_STYLES,
    animations: CAPTION_ANIMATIONS,
    positions: CAPTION_POSITIONS.map((p) => ({ key: p, label: POSITION_LABELS[p] })),
  };
}

/* ---------------- SRT ---------------- */
function srtTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const whole = Math.floor(rest);
  const ms = Math.round((rest - whole) * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return p2(h) + ':' + p2(m) + ':' + p2(whole) + ',' + String(ms).padStart(3, '0');
}

/* Gera o arquivo .srt de um corte a partir das suas legendas. */
export function buildSrt(cut, cfg = null) {
  const c = normalizeCaptions(cfg, null);
  const caps = (cut && Array.isArray(cut.captions) ? cut.captions : []);
  const lines = [];
  let n = 0;
  for (const cap of caps) {
    const text = c.uppercase ? String(cap.text || '').toUpperCase() : String(cap.text || '');
    if (!text.trim()) continue;
    n++;
    lines.push(String(n));
    lines.push(srtTime(cap.start) + ' --> ' + srtTime(cap.end));
    lines.push(text.trim());
    lines.push('');
  }
  return lines.join('\n');
}

/* ---------------- ffmpeg ---------------- */
function assColor(hex, alpha = 0) {
  const h = String(hex || '#FFFFFF').replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.padEnd(6, 'F').slice(0, 6);
  const r = full.slice(0, 2), g = full.slice(2, 4), b = full.slice(4, 6);
  const a = Math.max(0, Math.min(255, Math.round(alpha)));
  const p2 = (x) => String(x).padStart(2, '0').toUpperCase();
  return '&H' + p2(a) + b.toUpperCase() + g.toUpperCase() + r.toUpperCase();
}

function bgAlpha(bg) {
  const m = String(bg || '').match(/rgba?\([^)]*?,\s*([0-9.]+)\s*\)/);
  if (!m) return 0;
  return Math.round((1 - Number(m[1])) * 255);
}

function hexFromRgba(bg, fallback) {
  const m = String(bg || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return fallback;
  const p2 = (x) => Number(x).toString(16).padStart(2, '0');
  return '#' + p2(m[1]) + p2(m[2]) + p2(m[3]);
}

/* Trecho de force_style para o filtro subtitles do ffmpeg. */
export function forceStyle(cfg = null) {
  const c = normalizeCaptions(cfg, null);
  const st = styleByKey(c.style);
  const align = c.position === 'superior' ? 8 : (c.position === 'centro' ? 5 : 2);
  const parts = [
    'FontName=' + st.font.replace(/\s+/g, ' '),
    'FontSize=' + st.size,
    'Bold=' + (st.bold ? 1 : 0),
    'PrimaryColour=' + assColor(st.color, 0),
    'OutlineColour=' + assColor(st.outline, 0),
    'BackColour=' + assColor(hexFromRgba(st.bg, '#000000'), bgAlpha(st.bg)),
    'BorderStyle=' + (bgAlpha(st.bg) > 0 ? 3 : 1),
    'Outline=' + st.outlineWidth,
    'Shadow=0',
    'Alignment=' + align,
    'MarginV=48',
  ];
  if (c.uppercase) parts.push('Uppercase=1');
  return parts.join(',');
}

export function describe(cfg = null) {
  const c = normalizeCaptions(cfg, null);
  const st = styleByKey(c.style);
  const anim = CAPTION_ANIMATIONS.find((a) => a.key === c.animation) || CAPTION_ANIMATIONS[0];
  return {
    config: c,
    styleLabel: st.label,
    animationLabel: anim.label,
    animationDescription: anim.description,
    positionLabel: POSITION_LABELS[c.position] || c.position,
    enabled: c.enabled,
  };
}
