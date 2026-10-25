/* =========================================================
 * test_jogos_motor.mjs · validação direcionada do módulo Jogos
 * Cobre os 6 pontos exigidos pela §11 da especificação:
 *   1) integridade dos cálculos com dados conhecidos
 *   2) separação entre dados reais e simulados
 *   3) tratamento de dados ausentes e duplicados
 *   4) funcionamento dos estados e alertas
 *   5) persistência e separação das sessões
 *   6) ausência de alterações em funcionalidades não relacionadas
 * Executar: node test_jogos_motor.mjs
 * =======================================================*/
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

import {
  STATES, DECISIONS, MOTOR_VERSION, MIN_SAMPLE_INFERENCE,
  normalizeRecord, dedupe, detectGaps, checkSessionScope,
  computeObserved, returnSeriesStats, theoreticalEV, chiSquareGOF,
  normalCdf, pValueChi2, monteCarlo, makeRng,
  buildHypotheses, anomalyState, decide, riskScenarios, guardAutoMode, buildAnalysis,
} from './jogos/motor.js';
import { JogosState } from './jogos/state.js';
import * as JogosSvc from './jogos/service.js';

const results = [];
function ok(name, fn) {
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, err: String(e?.message || e) }); }
}
async function okAsync(name, fn) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, err: String(e?.message || e) }); }
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

/* ---------- 1) INTEGRIDADE DOS CÁLCULOS COM DADOS CONHECIDOS ---------- */
ok('1.1 computeObserved: RTP/retorno líquido/winRate com 4 apostas conhecidas', () => {
  // apostas 1,1,1,1 · multiplicadores 0,0,2,0 → payout 0,0,2,0
  const recs = [
    { roundId: 1, outcome: 'perda', multiplier: 0, bet: 1 },
    { roundId: 2, outcome: 'perda', multiplier: 0, bet: 1 },
    { roundId: 3, outcome: 'x2', multiplier: 2, bet: 1 },
    { roundId: 4, outcome: 'perda', multiplier: 0, bet: 1 },
  ].map(r => normalizeRecord(r));
  const o = computeObserved(recs);
  assert.equal(o.nWithMoney, 4);
  near(o.totalBet, 4);
  near(o.totalPayout, 2);
  near(o.rtpObserved, 0.5);          // 2/4
  near(o.netResult, -2);             // 2-4
  near(o.evObservedPerUnit, -0.5);   // 0.5-1
  near(o.winRate, 0.25);             // 1 de 4 com multiplicador >= 1
});

ok('1.2 returnSeriesStats: média/variância/IC95 com série conhecida [0,0,2,0]', () => {
  const recs = [
    { roundId: 1, multiplier: 0, bet: 1 }, { roundId: 2, multiplier: 0, bet: 1 },
    { roundId: 3, multiplier: 2, bet: 1 }, { roundId: 4, multiplier: 0, bet: 1 },
  ].map(r => normalizeRecord(r));
  const s = returnSeriesStats(recs);
  assert.equal(s.ok, true);
  assert.equal(s.n, 4);
  near(s.mean, 0.5);
  near(s.variance, 1);        // amostral (n-1): 3/3
  near(s.stddev, 1);
  near(s.ci95[0], 0.5 - 1.959964 * 0.5, 1e-5);
  near(s.ci95[1], 0.5 + 1.959964 * 0.5, 1e-5);
});

ok('1.3 theoreticalEV: EV = Σ p·r − 1 (r inclui a aposta)', () => {
  const ev0 = theoreticalEV({ probabilities: { a: 0.5, b: 0.5 }, payouts: { a: 2, b: 0 } });
  assert.equal(ev0.ok, true);
  near(ev0.ev, 0);                    // 0.5*2 + 0.5*0 - 1 = 0
  assert.match(ev0.definitions, /retorno TOTAL por unidade/);
  const evNeg = theoreticalEV({ probabilities: { a: 0.6, b: 0.4 }, payouts: { a: 1.5, b: 0 } });
  near(evNeg.ev, -0.1);
  near(evNeg.houseEdge, 0.1);
  // Σp ≠ 1 e ausência de tabela → NÃO calcula
  assert.equal(theoreticalEV({ probabilities: { a: 0.5 }, payouts: { a: 2 } }).ok, false);
  assert.equal(theoreticalEV({}).ok, false);
});

ok('1.4 chiSquareGOF/funções de distribuição: valores de referência conhecidos', () => {
  near(normalCdf(0), 0.5, 1e-6);
  near(normalCdf(1.959964), 0.975, 1e-4);
  near(pValueChi2(0, 1), 1, 1e-9);
  const g = chiSquareGOF([500, 500], [0.5, 0.5]);
  assert.equal(g.ok, true);
  near(g.chi2, 0);
  near(g.pValue, 1, 1e-9);
  assert.equal(g.df, 1);
});

ok('1.5 monteCarlo: reprodutível por seed e rotulada como SIMULAÇÃO', () => {
  const ref = { probabilities: { a: 0.5, b: 0.5 }, payouts: { a: 2, b: 0 } };
  const s1 = monteCarlo({ ...ref, n: 2000, seed: 42, bankroll: 100, bet: 1 });
  const s2 = monteCarlo({ ...ref, n: 2000, seed: 42, bankroll: 100, bet: 1 });
  assert.equal(s1.ok, true);
  assert.equal(s1.kind, 'simulation');
  assert.match(s1.label, /NÃO É RESULTADO REAL/);
  near(s1.meanRtp, s2.meanRtp, 1e-12);   // mesmo seed ⇒ mesmo resultado
  assert.equal(monteCarlo({ n: 100 }).ok, false); // sem referência não roda
  assert.equal(typeof makeRng(1), 'function');
});

/* ---------- 2) SEPARAÇÃO ENTRE DADOS REAIS E SIMULADOS ---------- */
ok('2.1 computeObserved separa observado × simulado (séries não somadas)', () => {
  const recs = [
    normalizeRecord({ roundId: 1, outcome: 'perda', multiplier: 0, bet: 10 }),
    normalizeRecord({ roundId: 2, outcome: 'x2', multiplier: 2, bet: 10 }),
    normalizeRecord({ roundId: 3, outcome: 'x2', multiplier: 2, bet: 10 }),
    normalizeRecord({ roundId: 4, outcome: 'x2', multiplier: 2, bet: 10, kind: 'simulation', source: 'montecarlo' }),
    normalizeRecord({ roundId: 5, outcome: 'x2', multiplier: 2, bet: 10, kind: 'simulation', source: 'montecarlo' }),
  ];
  const o = computeObserved(recs);
  assert.equal(o.nObserved, 3);
  assert.equal(o.nSimulation, 2);
  assert.equal(o.nWithMoney, 3);          // simulado NÃO entra no total
  near(o.totalBet, 30);
  near(o.totalPayout, 40);
  near(o.rtpObserved, 40 / 30);
});

ok('2.2 checkSessionScope sinaliza mistura de reais + simulados', () => {
  const mix = [
    normalizeRecord({ roundId: 1, outcome: 'x2', bet: 1, multiplier: 2 }),
    normalizeRecord({ roundId: 2, outcome: 'x2', bet: 1, multiplier: 2, kind: 'simulation' }),
  ];
  const s = checkSessionScope(mix, {});
  assert.equal(s.ok, false);
  assert.ok(s.violations.some(v => /reais e simulados/i.test(v)));
  assert.deepEqual(s.kinds.sort(), ['observed', 'simulation']);
  // só observados ⇒ sem violação
  const clean = checkSessionScope([normalizeRecord({ roundId: 1, outcome: 'x2', bet: 1, multiplier: 2 })], {});
  assert.equal(clean.ok, true);
});

ok('2.3 buildAnalysis marca versão dos dados e mantém as séries separadas', () => {
  const out = buildAnalysis({
    records: [
      { roundId: 1, outcome: 'perda', multiplier: 0, bet: 1 },
      { roundId: 2, outcome: 'x2', multiplier: 2, bet: 1, kind: 'simulation' },
    ],
    scope: { siteHost: 'demo.exemplo.com', gameName: 'Demo' },
  });
  assert.equal(out.ok, true);
  assert.equal(out.observed.nObserved, 1);
  assert.equal(out.observed.nSimulation, 1);
  assert.equal(out.dataVersion, `${MOTOR_VERSION}·2registros`);
  assert.ok(out.disclaimers.length >= 3);
  assert.match(out.disclaimers.join(' '), /não são previsíveis/i);
});

/* ---------- 3) DADOS AUSENTES E DUPLICADOS ---------- */
ok('3.1 normalizeRecord NÃO inventa dados ausentes', () => {
  const r = normalizeRecord({});
  assert.equal(r.bet, null);
  assert.equal(r.payout, null);
  assert.equal(r.multiplier, null);
  assert.equal(r.roundId, null);
  assert.equal(r.outcome, null);
  assert.equal(r.source, 'desconhecida');
  assert.equal(r.method, 'desconhecido');
  assert.equal(r.kind, 'observed');
  assert.ok(Number.isFinite(r.ts));
});

ok('3.2 derivação documentada payout↔multiplicador (apenas com bet presente)', () => {
  near(normalizeRecord({ bet: 10, multiplier: 2.5 }).payout, 25);
  near(normalizeRecord({ bet: 10, payout: 25 }).multiplier, 2.5);
  // sem bet NÃO deriva nada
  assert.equal(normalizeRecord({ multiplier: 2.5 }).payout, null);
  assert.equal(normalizeRecord({ payout: 25 }).multiplier, null);
});

ok('3.3 dedupe remove duplicados por roundId e por assinatura', () => {
  const byId = dedupe([
    normalizeRecord({ roundId: 7, outcome: 'a', multiplier: 1 }),
    normalizeRecord({ roundId: 7, outcome: 'a', multiplier: 1 }),
    normalizeRecord({ roundId: 8, outcome: 'b', multiplier: 2 }),
  ]);
  assert.equal(byId.records.length, 2);
  assert.equal(byId.duplicatesRemoved, 1);
  const bySig = dedupe([
    normalizeRecord({ ts: 1000, outcome: 'a', multiplier: 1 }),
    normalizeRecord({ ts: 1000, outcome: 'a', multiplier: 1 }),
  ]);
  assert.equal(bySig.duplicatesRemoved, 1);
});

ok('3.4 detectGaps informa lacunas sem preencher nada', () => {
  const g = detectGaps([1, 2, 4].map(id => normalizeRecord({ roundId: id, outcome: 'a', multiplier: 1 })));
  assert.equal(g.missingCount, 1);
  assert.deepEqual(g.missingSamples, [3]);
  assert.ok(g.issues.some(i => /lacunas/i.test(i)));
  // registros sem roundId
  const g2 = detectGaps([normalizeRecord({ outcome: 'a' })]);
  assert.ok(g2.issues.some(i => /sem roundId/i.test(i)));
});

ok('3.5 resultado ausente é excluído da distribuição (não preenchido)', () => {
  const recs = [
    normalizeRecord({ roundId: 1, outcome: 'a', multiplier: 1, bet: 1 }),
    normalizeRecord({ roundId: 2, multiplier: 1, bet: 1 }), // sem outcome
  ];
  const o = computeObserved(recs);
  assert.equal(o.distribution.length, 1);
  assert.equal(o.distribution[0].outcome, 'a');
  assert.equal(o.distribution[0].count, 1);
  const g = detectGaps(recs);
  assert.equal(g.withoutOutcome, 1);
});

/* ---------- 4) ESTADOS E ALERTAS ---------- */
ok('4.1 anomalyState percorre todos os 7 estados previstos', () => {
  assert.equal(anomalyState({ n: 0 }).state, STATES.COLETANDO);
  assert.equal(anomalyState({ n: 50, hasReference: false }).state, STATES.COLETANDO);
  assert.equal(anomalyState({ n: 10, hasReference: true }).state, STATES.AMOSTRA_INSUFICIENTE);
  assert.equal(anomalyState({ n: 50, hasReference: true, hypothesis: null }).state, STATES.COLETANDO);
  assert.equal(anomalyState({ n: 50, hasReference: true, hypothesis: {}, discoverySignificant: false }).state, STATES.HIPOTESE_INVESTIGACAO);
  assert.equal(anomalyState({ n: 50, hasReference: true, hypothesis: {}, discoverySignificant: true }).state, STATES.POSSIVEL_ANOMALIA);
  assert.equal(anomalyState({ n: 50, hasReference: true, hypothesis: {}, discoverySignificant: true, independentValidation: { n: 10, pValue: 0.01 } }).state, STATES.INCONCLUSIVA);
  assert.equal(anomalyState({ n: 50, hasReference: true, hypothesis: {}, discoverySignificant: true, independentValidation: { n: 100, pValue: 0.4 } }).state, STATES.NAO_VALIDADA);
  const val = anomalyState({ n: 50, hasReference: true, hypothesis: {}, discoverySignificant: true, independentValidation: { n: 100, pValue: 0.01 } });
  assert.equal(val.state, STATES.VALIDADA_INDEPENDENTE);
  assert.match(val.reason, /NÃO implica vantagem/i);
});

ok('4.2 todas as 7 strings de estado são exatamente as exigidas', () => {
  assert.deepEqual(Object.values(STATES).sort(), [
    'AMOSTRA INSUFICIENTE', 'COLETANDO DADOS', 'HIPÓTESE EM INVESTIGAÇÃO',
    'INCONCLUSIVA', 'NÃO VALIDADA', 'POSSÍVEL ANOMALIA', 'VALIDADA EM DADOS INDEPENDENTES',
  ].sort());
});

ok('4.3 decide cobre as 6 decisões e interrompe ao atingir limite de risco', () => {
  assert.equal(decide({ riskLimitHit: true }).stop, true);
  assert.match(decide({ riskLimitHit: true }).reason, /interrompida/i);
  assert.equal(decide({ n: 0 }).decision, DECISIONS.CONTINUAR);
  assert.equal(decide({ n: 10 }).decision, DECISIONS.CONTINUAR);
  assert.equal(decide({ n: 100, evTheoretical: -0.05 }).decision, DECISIONS.EV_DESFAVORAVEL);
  assert.equal(decide({ n: 100, hypothesis: true, pValue: 0.01 }).decision, DECISIONS.ANOMALIA_INVESTIGAR);
  assert.equal(decide({ n: 100, hypothesis: true, independentValidation: { n: 10, pValue: 0.01 } }).decision, DECISIONS.EVIDENCIA_INSUFICIENTE);
  assert.equal(decide({ n: 100, hypothesis: true, independentValidation: { n: 100, pValue: 0.3 } }).decision, DECISIONS.HIPOTESE_NAO_COMPROVADA);
  assert.equal(decide({ n: 100, hypothesis: true, independentValidation: { n: 100, pValue: 0.01 } }).decision, DECISIONS.ANOMALIA_INVESTIGAR);
  const sem = decide({ n: 100, rtpObserved: 0.9 });
  assert.equal(sem.decision, DECISIONS.SEM_VANTAGEM);
  // nunca afirma "vantagem comprovada"
  assert.doesNotMatch(sem.reason, /vantagem comprovada|lucro garantido/i);
});

ok('4.4 hipóteses trazem os 7 campos obrigatórios da §5', () => {
  const records = Array.from({ length: 300 }, (_, i) => normalizeRecord({ roundId: i + 1, outcome: i % 2 ? 'a' : 'b', multiplier: i % 2 ? 2 : 0, bet: 1 }));
  const hs = buildHypotheses({ records, reference: { probabilities: { a: 0.5, b: 0.5 }, source: 'tabela do fornecedor' } });
  assert.ok(hs.length >= 2);
  for (const h of hs) {
    for (const k of ['observed', 'reference', 'testApplied', 'sampleSize', 'uncertainty', 'alternativeExplanations', 'reproducible']) {
      assert.ok(k in h, `hipótese ${h.id} sem campo ${k}`);
    }
    assert.ok(Array.isArray(h.alternativeExplanations) && h.alternativeExplanations.length >= 2);
  }
  // sem referência: H1 não é testável e diz isso explicitamente
  const hs2 = buildHypotheses({ records });
  const h1 = hs2.find(h => h.id === 'H1-distribuicao');
  assert.equal(h1.uncertainty, null);
  assert.match(h1.inconclusiveReason, /sem tabela de referência/i);
});

ok('4.5 guardAutoMode bloqueia dinheiro real e só libera demo/simulação', () => {
  assert.equal(guardAutoMode({ environment: 'demo', realMoney: false }).allowed, true);
  assert.equal(guardAutoMode({ environment: 'demo', realMoney: true }).allowed, false);
  const blocked = guardAutoMode({ environment: 'real', realMoney: true });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /DEMONSTRAÇÃO\/simulação/i);
  assert.ok(blocked.allowedInstead.includes('análise'));
});

ok('4.6 riskScenarios calcula cenários e proíbe progressão', () => {
  const r = riskScenarios({ budget: 100, maxLoss: 50, baseBet: 5, maxMinutes: 30, evPerUnit: -0.05 });
  assert.equal(r.ok, true);
  const base = r.ladder.find(l => l.bet === 5);
  assert.equal(base.roundsUntilMaxLoss, 10);       // 50/5
  near(base.exposurePer100, 500);                  // 5*100
  near(base.expectedLossPer100, 25);               // 500*0.05
  assert.ok(r.warnings.some(w => /EXPOSIÇÃO FINANCEIRA/i.test(w)));
  assert.ok(r.warnings.some(w => /martingale/i.test(w)));
  assert.equal(r.ladder.length, 4);
  // sem orçamento/aposta não calcula nada
  assert.equal(riskScenarios({}).ok, false);
  assert.equal(riskScenarios({ budget: 100 }).ok, false);
});

/* ---------- 5) PERSISTÊNCIA E SEPARAÇÃO DAS SESSÕES ---------- */
await (async () => {
  const dir = path.join(os.tmpdir(), 'jogos_test_' + Date.now().toString(36));
  const created = [];
  try {
    const st = new JogosState();
    st.setDataDir(dir);
    await st.save({ id: 'js_A', siteHost: 'site-a.com', gameName: 'Jogo A', status: 'observando', createdAt: '2026-01-01T00:00:00Z', records: [normalizeRecord({ roundId: 1, outcome: 'a', bet: 1, multiplier: 2 })] });
    await st.save({ id: 'js_B', siteHost: 'site-b.com', gameName: 'Jogo B', status: 'pausada', createdAt: '2026-01-02T00:00:00Z', records: [] });
    created.push(path.join(dir, 'session_js_A.json'), path.join(dir, 'session_js_B.json'));

    await okAsync('5.1 grava 1 arquivo por sessão e recarrega em instância nova', async () => {
      const files = fs.readdirSync(dir).filter(f => /^session_.*\.json$/.test(f));
      assert.equal(files.length, 2);

      const st2 = new JogosState();
      st2.setDataDir(dir);
      const loaded = await st2.loadAll();
      assert.equal(loaded.loaded, 2);
      assert.equal(st2.get('js_A').gameName, 'Jogo A');
      assert.equal(st2.get('js_B').gameName, 'Jogo B');
      assert.equal(st2.get('js_A').siteHost, 'site-a.com');
      const list = st2.list();
      assert.equal(list.length, 2);
      assert.equal(list[0].recordsCount + list[1].recordsCount, 1); // sessões não se misturam
      assert.ok(list.every(s => !('records' in s)));
    });

    await okAsync('5.2 remove() apaga o arquivo da sessão e não afeta as outras', async () => {
      const st3 = new JogosState();
      st3.setDataDir(dir);
      await st3.loadAll();
      assert.equal(await st3.remove('js_A'), true);
      assert.equal(st3.get('js_A'), null);
      assert.equal(st3.get('js_B').gameName, 'Jogo B');
      const files = fs.readdirSync(dir).filter(f => /^session_.*\.json$/.test(f));
      assert.equal(files.length, 1);
    });

    await okAsync('5.3 id malicioso não escapa do diretório de dados (path traversal)', async () => {
      const st4 = new JogosState();
      st4.setDataDir(dir);
      await st4.save({ id: '../../etc/passwd_test', siteHost: 'x', gameName: 'x' });
      const escaped = fs.existsSync(path.resolve(dir, '../../etc/passwd_test'));
      assert.equal(escaped, false);
      const files = fs.readdirSync(dir);
      assert.ok(files.some(f => !f.includes('/') && !f.includes('..')));
    });
  } catch (e) {
    results.push({ name: '5.x persistência', pass: false, err: String(e?.message || e) });
  } finally {
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch {}
  }
})();

/* ---------- 6) CAMADA DE SERVIÇO (ponte real entre a UI e as rotas /api/jogos/*) ---------- */
await (async () => {
  const dir = path.join(os.tmpdir(), 'jogos_svc_' + Date.now().toString(36));
  try {
    // allowFn espelha o gate real: bloqueia endereços locais/internos
    const allowFn = (urlOrHost) => {
      const h = String(urlOrHost).toLowerCase();
      if (/(^|\/\/)(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\]|.*\.local)/.test(h)) {
        return { ok: false, reason: 'endereço local/interno não permitido' };
      }
      return { ok: true };
    };
    JogosSvc.init({ dataDir: dir, allowFn, browserAgent: null });

    await okAsync('6.1 status() declara backend real e não promete leitura ao vivo', async () => {
      const st = JogosSvc.status();
      assert.equal(st.ok, true);
      assert.equal(st.motorVersion, MOTOR_VERSION);
      assert.equal(st.browser.available, false);
      assert.equal(st.browser.liveReadAvailable, false);
      assert.match(st.browser.note, /NÃO é possível/i);
      assert.equal(st.minSampleInference, MIN_SAMPLE_INFERENCE);
    });

    const s1 = JogosSvc.createSession({ siteUrl: 'https://jogo.exemplo.com/aviator', gameName: 'Aviator' });
    ok('6.2 createSession bloqueia URL local/interna, protocolo inválido e campos vazios', () => {
      assert.equal(JogosSvc.createSession({}).ok, false);
      assert.equal(JogosSvc.createSession({ siteUrl: 'https://x.com/a' }).ok, false); // sem gameName
      const local = JogosSvc.createSession({ siteUrl: 'http://127.0.0.1:8080/jogo', gameName: 'X' });
      assert.equal(local.ok, false);
      assert.match(local.reason, /local\/interno/i);
      const proto = JogosSvc.createSession({ siteUrl: 'ftp://jogo.exemplo.com/x', gameName: 'X' });
      assert.equal(proto.ok, false);
      assert.match(proto.reason, /Protocolo/i);
      assert.equal(s1.ok, true);
      assert.equal(s1.session.siteHost, 'jogo.exemplo.com');
      assert.equal(s1.session.recordsCount, 0);
    });
    const id1 = s1.session.id;

    ok('6.3 importação autorizada de CSV (aliases PT) com deduplicação', () => {
      const csv = [
        'rodada;resultado;multiplicador;aposta;modo',
        '1;perda;0;1;normal',
        '2;x2;2;1;normal',
        '2;x2;2;1;normal',       // duplicado
        '3;x5;5;1;turbo',
      ].join('\n');
      const r = JogosSvc.importData(id1, { format: 'csv', content: csv });
      assert.equal(r.ok, true);
      assert.equal(r.dataset, 'discovery');
      assert.equal(r.received, 4);
      assert.equal(r.added, 3);
      assert.equal(r.duplicatesRemoved, 1);
      assert.deepEqual(r.totals, { records: 3, validationRecords: 0 });
      const s = JogosSvc.getSession(id1);
      assert.ok(s.records.every(x => x.method === 'importação autorizada do usuário'));
      assert.ok(s.records.every(x => /jogo\.exemplo\.com/.test(x.source)));
      assert.equal(s.records[0].mode, 'normal');
    });

    ok('6.4 importação com CSV de cabeçalho irreconhecível é recusada', () => {
      const bad = JogosSvc.importData(id1, { format: 'csv', content: 'foo;bar\n1;2' });
      assert.equal(bad.ok, false);
      assert.match(bad.reason, /Cabeçalho não reconhecido/i);
      assert.equal(JogosSvc.importData(id1, { format: 'json', content: '' }).ok, false);
      assert.equal(JogosSvc.importData(id1, { format: 'json', content: '{"a":1}' }).ok, false);
    });

    ok('6.5 setReference valida a tabela; analyze devolve estado e decisão explicáveis', () => {
      assert.equal(JogosSvc.setReference(id1, { probabilities: { perda: 0.5, x2: 0.4 }, payouts: { perda: 0, x2: 2 } }).ok, false); // Σp≠1
      assert.equal(JogosSvc.setReference(id1, { probabilities: { perda: 0.5, x2: 0.5 }, payouts: { perda: 0 } }).ok, false);          // falta payout
      assert.equal(JogosSvc.setReference(id1, { probabilities: { perda: 0.5, x2: 0.5 }, payouts: { perda: 0, x2: 2 }, source: 'tabela oficial v1' }).ok, true);

      const a = JogosSvc.analyze(id1, {});
      assert.equal(a.ok, true);
      const rep = a.report;
      assert.equal(rep.dataVersion, `${MOTOR_VERSION}·3registros`);
      assert.equal(rep.motorVersion, MOTOR_VERSION);
      assert.equal(rep.observed.nObserved, 3);
      assert.equal(rep.theoreticalEV.ok, true);
      near(rep.theoreticalEV.ev, 0);
      assert.ok(Object.values(STATES).includes(rep.state.state));
      assert.ok(Object.values(DECISIONS).includes(rep.decision.decision));
      // n=3 < 30 ⇒ amostra insuficiente + continuar observação
      assert.equal(rep.state.state, STATES.AMOSTRA_INSUFICIENTE);
      assert.equal(rep.decision.decision, DECISIONS.CONTINUAR);
      assert.equal(rep.hypotheses[0].sampleSize, 2); // 2 dos 3 resultados casam com a referência
      assert.match(rep.hypotheses[0].reproducible, /chiSquareGOF/);
      assert.equal(rep.integrity.duplicatesRemoved, 0); // já deduplicado na importação
    });

    ok('6.6 dados simulados importados ficam separados dos reais na análise', () => {
      const sim = JSON.stringify([{ roundId: 'sim-1', outcome: 'x5', multiplier: 5, bet: 1 }]);
      const r = JogosSvc.importData(id1, { format: 'json', content: sim, kind: 'simulation', source: 'montecarlo interno', method: 'simulação' });
      assert.equal(r.ok, true);
      assert.equal(r.totals.records, 4); // convivem, mas separados
      const rep = JogosSvc.analyze(id1, {}).report;
      assert.equal(rep.observed.nObserved, 3);
      assert.equal(rep.observed.nSimulation, 1);
      near(rep.observed.totalBet, 3);          // simulado fora do total apostado
      assert.ok(rep.integrity.scope.violations.some(v => /reais e simulados/i.test(v)));
    });

    ok('6.7 modo automático: bloqueado com dinheiro real, permitido em demo', () => {
      const blocked = JogosSvc.setAutoMode(id1, { enabled: true, environment: 'real', realMoney: true });
      assert.equal(blocked.ok, false);
      assert.ok(blocked.allowedInstead.includes('análise'));
      const off = JogosSvc.autoStep(id1, {});
      assert.equal(off.ok, false); // desligado após o bloqueio
      const on = JogosSvc.setAutoMode(id1, { enabled: true, environment: 'demo', realMoney: false });
      assert.equal(on.ok, true);
      const step = JogosSvc.autoStep(id1, {});
      assert.equal(step.ok, true);
      assert.equal(step.step.action, 'pausar_sem_acao');            // decisão não autoriza ação
      assert.ok(step.step.pausedBecause);
      assert.equal(step.step.environment, 'demo');
      assert.equal(step.step.dataVersion, `${MOTOR_VERSION}·4registros`);
    });

    ok('6.8 sessões separadas: dados de um jogo nunca entram em outro', () => {
      const s2 = JogosSvc.createSession({ siteUrl: 'https://outro.exemplo.com/crash', gameName: 'Crash' });
      assert.equal(s2.ok, true);
      const id2 = s2.session.id;
      JogosSvc.importData(id2, { format: 'json', content: JSON.stringify([
        { roundId: 1, outcome: 'x2', multiplier: 2, bet: 10 },
        { roundId: 2, outcome: 'perda', multiplier: 0, bet: 10 },
      ]) });
      const r2 = JogosSvc.analyze(id2, {}).report;
      assert.equal(r2.dataVersion, `${MOTOR_VERSION}·2registros`);
      assert.equal(r2.scope.siteHost, 'outro.exemplo.com');
      assert.equal(r2.scope.gameName, 'Crash');
      // a sessão 1 permanece intacta
      const s1b = JogosSvc.getSession(id1);
      assert.equal(s1b.records.length, 4);
      assert.equal(s1b.session.siteHost, 'jogo.exemplo.com');
      const list = JogosSvc.listSessions().items;
      assert.equal(list.length, 2);
      assert.equal(new Set(list.map(x => x.id)).size, 2);
    });

    await okAsync('6.9 sessão encerrada não aceita novos registros e navegador é honesto sobre o backend', async () => {
      const s3 = JogosSvc.createSession({ siteUrl: 'https://terceiro.exemplo.com/roleta', gameName: 'Roleta' });
      const id3 = s3.session.id;
      assert.equal(JogosSvc.endSession(id3).ok, true);
      const after = JogosSvc.appendRecords(id3, [{ roundId: 1, outcome: 'a', multiplier: 2, bet: 1 }]);
      assert.equal(after.ok, false);
      assert.match(after.reason, /encerrada/i);
      const br = await JogosSvc.openBrowser('https://jogo.exemplo.com/aviator');
      assert.equal(br.ok, false); // sem browserAgent neste ambiente: informa, não finge
      assert.match(br.reason, /indisponível/i);
      const brLocal = await JogosSvc.openBrowser('http://192.168.0.10/jogo');
      assert.equal(brLocal.ok, false);
      assert.match(brLocal.reason, /local\/interno/i);
      await JogosSvc.deleteSession(id3);
    });

    await okAsync('6.10 persistência: 1 arquivo por sessão no dataDir do módulo', async () => {
      const files = fs.readdirSync(dir).filter(f => /^session_.*\.json$/.test(f));
      assert.equal(files.length, 2);
      const raw = JSON.parse(await fsp.readFile(path.join(dir, files[0]), 'utf8'));
      assert.equal(raw.schema, 'jogos_session_v1');
      assert.ok(Array.isArray(raw.records));
    });
  } catch (e) {
    results.push({ name: '6.x service', pass: false, err: String(e?.message || e) });
  } finally {
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch {}
  }
})();

/* ---------- 7) AUSÊNCIA DE ALTERAÇÕES EM FUNCIONALIDADES NÃO RELACIONADAS ---------- */
ok('7.1 git status restrito ao escopo do módulo Jogos', () => {
  const out = execSync('git status --porcelain', { cwd: process.cwd() }).toString().trim();
  const lines = out ? out.split('\n').map(l => l.trim()) : [];
  const allowedPrefixes = ['jogos/', 'public/jogos.js', 'public/index.html', 'public/styles.css', 'public/app.js', 'server.js', 'test_jogos_motor.mjs'];
  // artefatos de DADOS gerados em runtime (scheduler do BTC) não são alterações de código
  const dataDirs = ['btc_market/data/', 'jogos/data/'];
  const unexpected = lines.filter(l => {
    const p = l.replace(/^[A-Z?!]{1,2}\s+/, '').replace(/^"|"$/g, '');
    if (dataDirs.some(d => p.startsWith(d))) return false;
    return !allowedPrefixes.some(a => p === a || p.startsWith(a));
  });
  assert.deepEqual(unexpected, [], 'arquivos de código fora do escopo alterados: ' + unexpected.join(', '));
});

/* ---------- RELATÓRIO ---------- */
const pass = results.filter(r => r.pass).length;
console.log('\n=== VALIDAÇÃO DIRECIONADA · MÓDULO JOGOS ===');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FALHA'}  ${r.name}${r.pass ? '' : '  → ' + r.err}`);
console.log(`\n${pass}/${results.length} verificações aprovadas`);
process.exit(pass === results.length ? 0 : 1);
