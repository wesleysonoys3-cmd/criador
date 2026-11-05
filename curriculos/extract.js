/* =========================================================
 * curriculos/extract.js — Extração de texto de currículos enviados
 * ---------------------------------------------------------
 * Suporta TXT, DOCX e PDF sem instalar dependências (usa zlib nativo).
 * A extração de PDF é heurística: quando o texto não é confiável o
 * resultado é marcado com confiança baixa e o usuário é orientado a colar.
 * =======================================================*/
import zlib from 'node:zlib';

/* ---------------- ZIP reader (DOCX) ---------------- */
function readZipEntries(buf) {
  const entries = [];
  // EOCD
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return entries;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, method, compSize, localOff, extraLen });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buf, entry) {
  const lo = entry.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) { try { return zlib.inflateRawSync(raw); } catch { return null; } }
  return null;
}

function xmlToText(xml) {
  return String(xml)
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<w:tab\s*\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractDocx(buf) {
  const entries = readZipEntries(buf);
  const doc = entries.find(e => e.name === 'word/document.xml');
  if (!doc) return { ok: false, reason: 'DOCX sem word/document.xml (arquivo pode estar corrompido).' };
  const xmlBuf = readZipEntry(buf, doc);
  if (!xmlBuf) return { ok: false, reason: 'Não foi possível descompactar o conteúdo do DOCX.' };
  const text = xmlToText(xmlBuf.toString('utf8'));
  if (!text) return { ok: false, reason: 'O DOCX não contém texto extraível.' };
  return { ok: true, text, confidence: 'alta' };
}

/* ---------------- PDF ---------------- */
function decodePdfString(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') {
      const nx = raw[i + 1];
      if (nx === 'n') { out += '\n'; i++; }
      else if (nx === 'r') { out += '\r'; i++; }
      else if (nx === 't') { out += '\t'; i++; }
      else if (nx === '(' || nx === ')' || nx === '\\') { out += nx; i++; }
      else if (/[0-7]/.test(nx || '')) {
        let oct = nx; i++;
        for (let k = 0; k < 2 && /[0-7]/.test(raw[i + 1] || ''); k++) { oct += raw[i + 1]; i++; }
        out += String.fromCharCode(parseInt(oct, 8));
      } else { out += nx || ''; i++; }
    } else out += ch;
  }
  return out;
}

function decodeHexString(hex) {
  const clean = String(hex).replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    out += String.fromCharCode(code);
  }
  return out;
}

function contentStreamToText(content) {
  const parts = [];
  const re = /(\[(?:[^\][\\]|\\.)*\]|\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]+>)\s*(Tj|TJ|'|")|(T\*|Td|TD|ET)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m[3]) { parts.push('\n'); continue; }
    const token = m[1];
    if (token.startsWith('[')) {
      const inner = /\((?:[^()\\]|\\.)*\)/g;
      let t; let line = '';
      while ((t = inner.exec(token)) !== null) line += decodePdfString(t[0].slice(1, -1));
      parts.push(line);
    } else if (token.startsWith('(')) {
      parts.push(decodePdfString(token.slice(1, -1)));
    } else if (token.startsWith('<')) {
      parts.push(decodeHexString(token.slice(1, -1)));
    }
    parts.push(' ');
  }
  return parts.join('').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}

function extractPdf(buf) {
  const latin = buf.toString('latin1');
  const chunks = [];
  const re = /stream\r?\n?([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const raw = Buffer.from(m[1], 'latin1');
    let decoded = null;
    try { decoded = zlib.inflateSync(raw); } catch { try { decoded = zlib.inflateRawSync(raw); } catch { decoded = null; } }
    const content = decoded ? decoded.toString('latin1') : raw.toString('latin1');
    if (/\bTj\b|\bTJ\b/.test(content)) chunks.push(contentStreamToText(content));
  }
  const text = chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const letters = (text.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (letters < 40) {
    return {
      ok: false,
      reason: 'Não foi possível extrair texto legível deste PDF (pode ser digitalizado/imagem ou usar fontes embutidas sem mapa de caracteres).',
      partial: text.slice(0, 1500),
    };
  }
  const confidence = letters > 400 ? 'média' : 'baixa';
  return { ok: true, text, confidence };
}

/** Detecta o tipo e extrai o texto. */
export function extractResumeText({ filename = '', mimeType = '', buffer }) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!buf.length) return { ok: false, reason: 'Arquivo vazio.' };
  const ext = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  const type = String(mimeType || '').toLowerCase();

  if (type.includes('pdf') || ext === 'pdf') return extractPdf(buf);
  if (type.includes('wordprocessingml') || type.includes('officedocument') || ext === 'docx') return extractDocx(buf);
  if (type.startsWith('text/') || ext === 'txt' || ext === 'md' || ext === 'rtf') {
    const text = buf.toString('utf8').replace(/\u0000/g, '').trim();
    if (!text) return { ok: false, reason: 'Arquivo de texto vazio.' };
    return { ok: true, text, confidence: 'alta' };
  }
  if (ext === 'doc') {
    return { ok: false, reason: 'O formato .doc (Word antigo) não é suportado para leitura. Salve como .docx ou .pdf e envie novamente.' };
  }
  return { ok: false, reason: `Formato não suportado (${ext || type || 'desconhecido'}). Envie PDF, DOCX ou TXT.` };
}

/** Heurística mínima para pré-preencher campos a partir do texto extraído. */
export function guessContact(text) {
  const t = String(text || '');
  const email = (t.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/) || [])[0] || '';
  const phone = (t.match(/(?:\+55\s?)?(?:\(?\d{2}\)?[\s-]?)?\d{4,5}[\s-]?\d{4}/) || [])[0] || '';
  const firstLines = t.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 6);
  const nameLike = firstLines.find(l => /^[A-ZÀ-Ÿ][a-zà-ÿ]+(\s+[A-ZÀ-Ÿ][a-zà-ÿ]+){1,4}$/.test(l)) || '';
  return { email, phone, nameLike };
}

export default { extractResumeText, guessContact };
