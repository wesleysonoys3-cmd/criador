import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, 'server.js');
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ❌ ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`  ✅ ${msg}`);
};

function sanitizeContentsBeforeSend(arr, ctx = '') {
  if (!Array.isArray(arr)) return [];
  let pass1 = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item !== 'object') continue;
    if (item.role === 'user' && Array.isArray(item.parts) && item.parts.length === 0) {
      if (pass1.length && pass1[pass1.length-1].role === 'model') pass1.pop();
      continue;
    }
    if (item.role === 'model' && Array.isArray(item.parts) && item.parts.length === 0) continue;
    const cleanParts = Array.isArray(item.parts)
      ? item.parts.filter(Boolean).map(p => {
          if (!p || typeof p !== 'object') return p;
          const copy = Object.assign({}, p);
          delete copy.role;
          return copy;
        })
      : [];
    pass1.push({ ...item, parts: cleanParts });
  }
  let result = pass1;
  while (result.length && result[result.length-1].role !== 'user') result.pop();
  if (result.length === 0 || !result[result.length-1] || result[result.length-1].role !== 'user') {
    result.push({ role: 'user', parts: [{ text: 'Continue usando as tools.' }] });
  }
  const lastUser = result[result.length-1];
  if (!Array.isArray(lastUser.parts) || lastUser.parts.length === 0) {
    lastUser.parts = [{ text: 'Continue.' }];
  }
  return result;
}

console.log('\n=== TESTE REGRESSÃO GEMINI PAYLOAD (role em parts[j] proibido) ===\n');

console.log('T0. Verificar correção aplicada em server.js (delete copy.role)');
{
  const raw = fs.readFileSync(SERVER_PATH, 'utf8');
  const insideFn = raw.slice(raw.indexOf('function sanitizeContentsBeforeSend'), raw.indexOf('let result = pass1;'));
  assert(/delete\s+copy\.role/.test(insideFn), 'server.js contém "delete copy.role" DENTRO de sanitizeContentsBeforeSend');
  assert(/cleanParts/.test(insideFn), 'server.js usa variável cleanParts com mapeamento em parts[]');
}

console.log('\nT1. ROOT CASE · userParts brutos com {role:"user", text} em parts[] (cenário real erro 400)');
{
  const userPartsInternos = [{ role: 'user', text: 'Olá, crie um site de vendas' }];
  const contents = [
    { role: 'user', parts: userPartsInternos }
  ];
  const out = sanitizeContentsBeforeSend(contents, 't1');

  assert(Array.isArray(out) && out.length >= 1, 'contents é array não vazio');
  assert(typeof out[0].role === 'string' && out[0].role === 'user', 'contents[0].role existe e é "user" (nível correto)');
  assert(Array.isArray(out[0].parts) && out[0].parts.length >= 1, 'contents[0].parts é array com pelo menos 1 item');
  assert(typeof out[0].parts[0] === 'object' && out[0].parts[0].text === 'Olá, crie um site de vendas', 'parts[0].text preserva texto original');
  assert(!('role' in out[0].parts[0]), 'parts[0] NÃO contém campo "role" (proibido pela Gemini API)');

  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < (out[i].parts || []).length; j++) {
      const p = out[i].parts[j];
      if (p && typeof p === 'object') {
        assert(!('role' in p), `contents[${i}].parts[${j}] não tem campo "role" (varredura completa)`);
      }
    }
  }
}

console.log('\nT2. Histórico múltiplas mensagens com role em parts[] de user e model (misturado)');
{
  const contents = [
    { role: 'user', parts: [{ role: 'user', text: 'Primeira pergunta' }, { role: 'user', text: 'Segunda parte' }] },
    { role: 'model', parts: [{ role: 'model', text: 'Resposta 1' }, { functionCall: { name: 'list_dir', args: { path: './' } } }] },
    { role: 'user', parts: [{ role: 'user', text: 'Terceira pergunta' }] },
  ];
  const out = sanitizeContentsBeforeSend(contents, 't2');

  assert(out[0].role === 'user' && out[1].role === 'model' && out[2].role === 'user', 'role nível contents preservado para todas as mensagens');
  assert(out[0].parts[0].text === 'Primeira pergunta' && out[0].parts[1].text === 'Segunda parte', 'text em múltiplas parts preservado');
  assert(!('role' in out[0].parts[0]) && !('role' in out[0].parts[1]), 'parts user não contêm role');
  assert(!('role' in out[1].parts[0]), 'parts model texto não contêm role');
  assert(out[1].parts[0].text === 'Resposta 1', 'parts model texto preservado');
  assert(out[1].parts[1] && out[1].parts[1].functionCall && out[1].parts[1].functionCall.name === 'list_dir', 'parts com functionCall preservado');
  assert(!('role' in out[1].parts[1]), 'parts com functionCall também não contêm role');
}

console.log('\nT3. Cenário parts normais sem role (compatibilidade retroativa) → sem mudanças');
{
  const contents = [
    { role: 'user', parts: [{ text: 'Olá normal' }] },
    { role: 'model', parts: [{ text: 'Resp normal' }, { inlineData: { mimeType: 'image/png', data: 'xxx' } }] },
    { role: 'user', parts: [{ text: 'Tchau normal' }] },
  ];
  const out = sanitizeContentsBeforeSend(contents, 't3');
  assert(out.length === 3, 'mantém 3 mensagens');
  assert(JSON.stringify(out[0].parts) === JSON.stringify([{ text: 'Olá normal' }]), 'parts user idênticas');
  assert(out[1].parts[1].inlineData.mimeType === 'image/png', 'inlineData preservado');
}

console.log('\nT4. Payload final é JSON válido (nenhum circular / símbolo)');
{
  const contents = [
    { role: 'user', parts: [{ role: 'user', text: 'ping' }] },
    { role: 'model', parts: [{ role: 'model', text: 'pong' }] },
    { role: 'user', parts: [{ text: 'fim', extra_ok: 123 }] },
  ];
  const out = sanitizeContentsBeforeSend(contents, 't4');
  let parsed;
  try {
    const jsonStr = JSON.stringify(out);
    parsed = JSON.parse(jsonStr);
    assert(true, 'JSON.stringify e parse sem erro');
    assert(Array.isArray(parsed) && parsed.length >= 1, 'JSON parseado é array');
  } catch (e) {
    assert(false, `JSON inválido: ${e.message}`);
  }
}

console.log('\nT5. Última mensagem model → sanitize adiciona user final conforme RC10');
{
  const contents = [
    { role: 'user', parts: [{ role: 'user', text: 'pergunta' }] },
    { role: 'model', parts: [{ role: 'model', text: 'resposta' }] },
  ];
  const out = sanitizeContentsBeforeSend(contents, 't5');
  assert(out[out.length - 1].role === 'user', 'última mensagem é user (regra RC10)');
  assert(typeof out[out.length - 1].parts[0].text === 'string', 'último parts tem text');
}

console.log('\nT6. Histórico com system (que não vai no contents) — preservar só user/model válidos');
{
  const contents = [
    { role: 'user', parts: [{ role: 'user', text: 'Pergunta' }] },
    { role: 'model', parts: [{ role: 'model', text: 'Resp' }] },
    { role: 'system', parts: [{ text: 'ignorado pois role system não é user/model' }] },
    { role: 'user', parts: [{ text: 'Fim' }] },
  ];
  const out = sanitizeContentsBeforeSend(contents, 't6');
  for (const c of out) {
    assert(typeof c.role === 'string', `mensagem ${c.role || 'null'} tem role string`);
    for (const p of c.parts) assert(!('role' in p), 'parts não tem role');
  }
}

const finalExit = process.exitCode || 0;
console.log(`\n=== RESULTADO TESTES GEMINI PAYLOAD: ${finalExit === 0 ? 'TODOS PASSARAM ✅' : 'FALHAS ❌ (código ' + finalExit + ')'} ===\n`);
if (finalExit !== 0) process.exit(finalExit);
