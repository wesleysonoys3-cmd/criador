// test_system_instruction_browser_rule.mjs · valida a nova regra §8.1 Browser Agent
// Injetar placeholder WORKSPACE_ROOT dinâmico (se não existir no import) para SYSTEM_INSTRUCTION
// rodar sem carregar todo o server.js.
//
// Como rodar:
//   ./node-v22.14.0-darwin-x64/bin/node test_system_instruction_browser_rule.mjs > /tmp/si_br.log 2>&1; echo EXIT=$?; cat /tmp/si_br.log

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

// Extrair o corpo do parágrafo que representa §8.1 Browser Agent (5 checks mínimos):
const MUST_CONTAIN = [
  '=== BROWSER AGENT (§8.1 · navegação de sites · v1 MÍNIMA) ===',
  'CHAME a ferramenta web_request_ask_authorization com reason="abrir site https://..." e urls=["https://..."]. NÃO escreva texto pedindo clique ANTES de chamar a ferramenta.',
  'Se retornou { authorized:true, autoGranted:true, scopeId }: autorização foi concedida automaticamente (ENV). Pule para o passo 4 usando esse scopeId.',
  'Se retornou { awaitingUser:true, scopeId, note:"Aguardando clique Sim/Não..." }: SÓ AGORA, DEPOIS que a ferramenta já emitiu o evento WS e o modal apareceu de verdade, informe ao usuário',
  'PRIORIZE browser_open sobre web_fetch_authorized',
  'NUNCA INVENTE que o site foi aberto se a ferramenta retornar ok=false ou conter error',
  'CHAME browser_get_page_info(contextId) para extrair preview de texto + links',
  'sempre mostre no resultado ao usuário, sem faltar, os campos retornados pela ferramenta: backend, contextId, finalUrl, status, title',
  'escrever COMO TEXTO, antes de chamar web_request_ask_authorization, qualquer frase como "clique no botão de autorização Sim que apareceu" ou "o modal já abriu". O modal SÓ EXISTE DEPOIS que a ferramenta foi executada no backend e emite evento WS orch:internet_authorization_requested. Se você não chamou a tool, o modal não existe — mentir para o usuário é PROIBIDO.',
];

let pass = 0, fail = 0;
const checks = [
  { name: 'contém header §8.1 Browser Agent', t: MUST_CONTAIN[0] },
  { name: 'Passo 1: chama tool web_request_ask_authorization ANTES, sem texto prévio', t: MUST_CONTAIN[1] },
  { name: 'Passo 2a: branch autoGranted (ENV concede automático)', t: MUST_CONTAIN[2] },
  { name: 'Passo 2b: branch awaitingUser → SÓ AGORA menciona modal ao usuário (depois que evento WS emitido)', t: MUST_CONTAIN[3] },
  { name: 'Passo 4: prioriza browser_open sobre web_fetch', t: MUST_CONTAIN[4] },
  { name: 'Passo 5: NÃO inventa abertura se browser_open ok=false/error', t: MUST_CONTAIN[5] },
  { name: 'Passo 6: browser_get_page_info DEPOIS para preview/links', t: MUST_CONTAIN[6] },
  { name: 'Passo 7: mostra obrigatório 5 campos tool (backend+contextId+finalUrl+status+title)', t: MUST_CONTAIN[7] },
  { name: 'REGRA NEGATIVA: PROIBIDO mentir que modal apareceu SEM chamar a tool web_request_ask_authorization primeiro (cita evento WS orch:internet_authorization_requested)', t: MUST_CONTAIN[8] },
  { name: 'verbos gatilho: abra, acesse, entre no site', t: /"abra", "acesse", "entre no site"/.test(src) },
];

for (const c of checks) {
  const ok = typeof c.t === 'string' ? src.includes(c.t) : !!c.t;
  if (ok) { console.log('✅ PASS ' + c.name); pass++; }
  else { console.log('❌ FAIL ' + c.name + (typeof c.t === 'string' ? ' · substring ausente: "'+c.t.slice(0,80)+'"' : '')); fail++; }
}

// 4. confirmar que a regra está DENTRO do modo SOLO (não aparece no interativo separado)
//    — o modo interativo é montado no ternário opts.mode==='interactive' ? INTERATIVO_TXT : SOLO_TXT.
//    A regra só existe no bloco SOLO_TXT (=variável que contém o `=== PESQUISA NA INTERNET`).
const sectionSoloOnly = /=== PESQUISA NA INTERNET[\s\S]{0,20000}=== DICA DE VELOCIDADE ===/.exec(src);
const inside = sectionSoloOnly && MUST_CONTAIN.every(m => typeof m === 'string' ? sectionSoloOnly[0].includes(m) : true);
if (inside) { console.log('✅ PASS · §8.1 Browser Agent está localizado DENTRO do MODO SOLO (após §8 INTERNET).'); pass++; }
else { console.log('❌ FAIL · §8.1 não está dentro do bloco MODO SOLO.'); fail++; }

console.log(`\nResumo system_instruction_browser_rule: ${pass}/${pass+fail} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
