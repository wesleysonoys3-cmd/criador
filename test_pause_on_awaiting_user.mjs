// test_pause_on_awaiting_user.mjs
//
// VALIDAÇÃO CIRÚRGICA · regra do usuário:
//   Quando web_request_ask_authorization retorna awaitingUser:true,
//   o orquestrador/executor deve:
//   - PAUSAR imediatamente;
//   - NÃO chamar browser_open;
//   - NÃO chamar novamente web_request_ask_authorization;
//   - NÃO executar próximo passo do plano.
//
// COMO RODAR:
//   cd /Users/tiagosantos/Desktop/criador
//   ./node-v22.14.0-darwin-x64/bin/node test_pause_on_awaiting_user.mjs

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let PASS = 0, FAIL = 0;
const check = (name, ok, extra = '') => {
  if (ok) { console.log('✅ PASS · ' + name); PASS++; }
  else { console.log('❌ FAIL · ' + name + (extra ? ' · ' + extra : '')); FAIL++; }
};

// ============================================================================
// T1 · Loop tool calls tem BREAK logo após: name==='web_request_ask_authorization' && awaitingUser===true
// ============================================================================
const t1 = /name\s*===\s*['"]web_request_ask_authorization['"`](?!\s*\))\s*&&\s*result\s*&&\s*result\.awaitingUser\s*===\s*true[\s\S]{0,900}break\s*;/.test(SRC);
check(
  'T1 · loop de tool calls: se web_request_ask_authorization retorna awaitingUser:true → break do loop (não executa browser_open no mesmo batch)',
  t1,
  'Esperado: if(name==="web_request_ask_authorization" && result && result.awaitingUser===true) { ... break; }'
);

// ============================================================================
// T2 · session._awaitingInternetAuth = true é setado IMEDIATAMENTE após retorno da tool (marcando sessão como aguardando)
// ============================================================================
const t2 = /session\._awaitingInternetAuth\s*=\s*true/.test(SRC);
check(
  'T2 · marca session._awaitingInternetAuth=true após awaitingUser:true',
  t2
);

// ============================================================================
// T3 · REGRA 8 DO USUÁRIO: "forçando continuação…" NÃO PODE ultrapassar estado awaitingUser=true
// ============================================================================
// Verifica que ANTES do bloco forceLoopFollowUpCount++ (forçando continuação), existe a condição
// "if (__awaitingInternet2) { ...pauseRequested=true... await waitIfPaused(session); continue; }"
// que bloqueia a continuação quando awaitingUser.
const idxForce = SRC.indexOf('forçando continuação… (passos pendentes:');
check(
  'T3 · texto "forçando continuação…" existe no executor (ponto de controle REGRA 8)',
  idxForce !== -1,
  'Substring ausente: "forçando continuação… (passos pendentes:"'
);
if (idxForce !== -1) {
  const backwards = SRC.slice(Math.max(0, idxForce - 4500), idxForce);
  const t3 = /__awaitingInternet2[\s\S]{0,160}if\s*\(__awaitingInternet2\)[\s\S]{0,350}pauseRequested\s*=\s*true[\s\S]{0,550}await\s+waitIfPaused\s*\(\s*session\s*\)/.test(backwards);
  check(
    'T3b · REGRA 8: bloco "forçando continuação" NÃO executa quando session._awaitingInternetAuth=true (existe guarda __awaitingInternet2 → pausa waitIfPaused)',
    t3,
    'Não encontrei a guarda __awaitingInternet2 antes do bloco forçando continuação.'
  );
} else {
  check('T3b · SKIPPED (forçando continuação não existe)', false);
}

// ============================================================================
// T4 · Executor NÃO chama browser_open SEM scope válido quando task_scoped.
// Verificação textual: quando task_scoped requer auth, browser_open SEMPRE usa scope
// e toolBrowserOpen retorna INTERNET_NOT_AUTHORIZED se scope nulo/inválido.
// ============================================================================
const idxBrowserOpenTool = SRC.indexOf('async function toolBrowserOpen(session, { url, scope, timeoutMs })');
check(
  'T4 · toolBrowserOpen declara parâmetro scope',
  idxBrowserOpenTool !== -1
);
if (idxBrowserOpenTool !== -1) {
  const browserToolBody = SRC.slice(idxBrowserOpenTool, idxBrowserOpenTool + 800);
  const t4 = /_rc27InternetScopeGranted\s*\(\s*session\s*,\s*scope\s*\)[\s\S]{0,220}INTERNET_NOT_AUTHORIZED/.test(browserToolBody);
  check(
    'T4b · toolBrowserOpen NÃO autoriza sem scope válido (retorna INTERNET_NOT_AUTHORIZED via _rc27InternetScopeGranted)',
    t4
  );
}

// ============================================================================
// T5 · Após usuário clicar SIM / NÃO no modal → resumePause corretamente no legado.
// Handler RC27_INTERNET_AUTHORIZED / RC27_INTERNET_DENIED chama pauseResolver()
// quando session._awaitingInternetAuth === true (não deixa a execução pendurada).
// ============================================================================
const rc28ResumeIdx = SRC.indexOf('async function _rc28ResumeAfterInternetInput');
check(
  'T5 · função _rc28ResumeAfterInternetInput existe (resume pós clique modal)',
  rc28ResumeIdx !== -1
);
if (rc28ResumeIdx !== -1) {
  const fnBody = SRC.slice(rc28ResumeIdx, rc28ResumeIdx + 2200);
  const t5a = /session\.pauseRequested\s*&&\s*typeof\s+session\.pauseResolver\s*===\s*['"]function['"][\s\S]{0,280}session\.pauseResolver\s*\(\s*\)/.test(fnBody);
  const t5b = /_awaitingInternetAuthDenied\s*=\s*!Boolean\s*\(\s*authorized\s*\)/.test(fnBody);
  check(
    'T5a · _rc28ResumeAfterInternetInput acorda waitIfPaused do legado (chama session.pauseResolver())',
    t5a
  );
  check(
    'T5b · _rc28ResumeAfterInternetInput seta session._awaitingInternetAuthDenied = !authorized (para tratar NÃO)',
    t5b
  );
}

// ============================================================================
// T6 · Quando autorização é negada (clicou NÃO) → browser_open NÃO é chamado.
// O executor cai em stoppedReason='internet_auth_denied' + break, sem push next.
// ============================================================================
const t6 = /stoppedReason\s*=\s*['"]internet_auth_denied['"][\s\S]{0,120}finishedClean\s*=\s*true[\s\S]{0,80}break\s*;/.test(SRC);
check(
  'T6 · usuário nega autorização → stoppedReason=internet_auth_denied + break (não chama browser_open)',
  t6
);

// ============================================================================
// T7 · Quando awaitingUser → NÃO incrementa planCompleted (passo NÃO é concluído)
// Verifica: if (!awaitingInternetAuthNow && result.ok && planSteps ... planCompleted++)
// ============================================================================
const t7 = /if\s*\(\s*!awaitingInternetAuthNow\s*&&\s*result\.ok\s*&&\s*planSteps/.test(SRC);
check(
  'T7 · awaitingUser bloqueia incremento planCompleted (próximo passo não é executado)',
  t7
);

console.log(`\nResumo pause_on_awaiting_user: ${PASS}/${PASS+FAIL} PASS, ${FAIL} FAIL`);
process.exit(FAIL === 0 ? 0 : 1);
