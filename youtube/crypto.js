/* =========================================================
 * youtube/crypto.js — Proteção dos tokens do YouTube
 * ---------------------------------------------------------
 * PARTE 8.4 (Segurança da publicação):
 *   - Tokens criptografados em repouso (AES-256-GCM).
 *   - Chave obtida de YT_TOKEN_KEY (env) ou de um arquivo local
 *     youtube/data/.ytkey com permissão 0600 (gerado se ausente).
 *   - Nenhum segredo é devolvido ao frontend em texto claro.
 * =======================================================*/
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const _log = (...a) => console.log('[YOUTUBE][crypto]', ...a);
const ALGO = 'aes-256-gcm';
const PREFIX = 'v1';

/* Deriva 32 bytes determinísticos a partir de um segredo em texto. */
function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

let _memKey = null;
let _keyFile = null;

export function setKeyFile(file) { _keyFile = file; }
export function resetKeyCache() { _memKey = null; }

/* Obtém a chave de 32 bytes: env YT_TOKEN_KEY > arquivo .ytkey (0600). */
async function getKey() {
  if (_memKey) return _memKey;
  const env = String(process.env.YT_TOKEN_KEY || '').trim();
  if (env) { _memKey = deriveKey(env); return _memKey; }

  const file = _keyFile || path.resolve(process.cwd(), 'youtube/data/.ytkey');
  try {
    const raw = (await fs.readFile(file, 'utf8')).trim();
    if (raw) { _memKey = deriveKey(raw); return _memKey; }
  } catch { /* gera abaixo */ }

  const generated = crypto.randomBytes(32).toString('base64');
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, generated, { encoding: 'utf8', mode: 0o600 });
    _log('chave de tokens gerada em ' + file + ' (modo 0600)');
  } catch (e) {
    _log('aviso: não foi possível gravar a chave em arquivo:', String((e && e.message) || e));
  }
  _memKey = deriveKey(generated);
  return _memKey;
}

/* Criptografa um objeto/valor → string opaca "v1.<iv>.<tag>.<dados>" em base64. */
export async function encryptJson(value) {
  const key = await getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plain = Buffer.from(JSON.stringify(value == null ? null : value), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

/* Descriptografa o formato acima. Retorna null se inválido/adulterado. */
export async function decryptJson(blob) {
  try {
    const parts = String(blob || '').split('.');
    if (parts.length !== 4 || parts[0] !== PREFIX) return null;
    const key = await getKey();
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch {
    return null; // chave trocada ou dado corrompido
  }
}

/* Máscara para exibir segredos com segurança na interface. */
export function maskSecret(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= 8) return '••••';
  return s.slice(0, 4) + '…' + s.slice(-3);
}
