import fs from 'fs';
const file = process.argv[2];
if (!file) { console.error('use: _parse_evidence.mjs FILE.json [label]'); process.exit(1); }
const label = process.argv[3] || file;
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log('\n=========== EXTRATO: ' + label + ' ===========');
if (d.ok === false) {
  console.log('FALHA: ok=false  error=' + d.error);
  process.exit(0);
}
console.log('pipelineVersion :', d.pipelineVersion);
console.log('success         :', d.success);
console.log('appliedTotal    :', d.appliedTotal);
console.log('rollbackCount   :', d.rollbackCount);
console.log('stopReason      :', d.stopReason);
console.log('finalGrade      :', d.finalGrade);
console.log('finalScore      :', d.finalScore);
console.log('iterationsCount :', d.iterationsCount);
const af = (d.finalClassification && d.finalClassification.autoFixable) || [];
console.log('autoFixableFin  :', af.length);
console.log('criticosFinal   :', (d.finalClassification && d.finalClassification.criticos) || 0);
console.log('tests.pass      :', d.tests && d.tests.pass);
if (d._rc26_internal) {
  console.log('rc25SuccessRaw  :', d._rc26_internal.rc25SuccessRaw);
  console.log('rc26WhitelistOK :', d._rc26_internal.rc26WhitelistConditionRaw);
  console.log('initialScanRepId:', d._rc26_internal.initialScanReportId);
  console.log('finalScanRepId  :', d._rc26_internal.finalReportId);
}
console.log('--- verifyReport (whitelist DIAG_AUTOFIX_SAFE_RULES presentes inicial) ---');
const SAFE = new Set(['SEC-HC-GOOGLEKEY','SEC-HC-ANYKEY','SEC-HC-OPENROUTER','SEC-INT-DOTENV-ABSENT','SEC-EX-STATIC-UNPROTECTED','SEC-PKG-MISSING-INSTALL']);
const vr = d.verifyReport || [];
vr.filter(v => v.presenteNoScanInicial && SAFE.has(v.ruleId)).forEach(v => {
  console.log(JSON.stringify({
    ruleId: v.ruleId, findingId: v.findingId, file: v.file, line: v.line,
    scanInicial: v.presenteNoScanInicial, rescanFinal: v.presenteNoRescanFinal,
    rolledBack: v.rolledBack, rollbackReason: (v.rollbackReason||null)
  }));
});
console.log('--- verifyReport regressões (só aparecem no FINAL) ---');
vr.filter(v => v.regressao === true).forEach(v => console.log('  REGRESSAO: ' + JSON.stringify({ruleId:v.ruleId,findingId:v.findingId})));
console.log('--- patchRecords 0:3 resumo ---');
const pr = d.patchRecords || [];
pr.slice(0, 3).forEach(grp => {
  (grp.records||[]).slice(0,3).forEach(r => {
    console.log(JSON.stringify({
      iter:grp.iter,idx:r.patchIndex,ruleId:r.ruleId,applied:r.applied,
      rolledBack:r.rolledBack,rollbackEqual:r.rollbackEqual,
      rollbackReason: r.rollbackReason ? String(r.rollbackReason).slice(0,80) : null,
      hashPre:r.hashPre?r.hashPre.slice(0,12)+'...':null,
      hashAfterRollback:r.hashAfterRollback?r.hashAfterRollback.slice(0,12)+'...':null,
    }));
  });
});
// Retrocompat 21 campos RC25.3
const RC25_21_FIELDS = ['ok','slug','project','iterations','iterationsCount','preBackupFile','preBackupTs','preBackupSize','finalGrade','finalScore','finalCounts','finalClassification','finalFindings','finalReportId','appliedTotal','tests','testsPass','success','stopReason','criadorUrl','voiceUrl'];
const missing21 = RC25_21_FIELDS.filter(k => !(k in d));
console.log('--- RETROCOMPAT RC25.3 campos 21 ---');
console.log('  21/21 presentes: ' + (missing21.length === 0 ? 'SIM ✅' : 'FALTANDO=' + missing21.join(',')));
console.log('  Campos ausentes: [' + missing21.join(', ') + ']');
// Rollback prova (Cenário B): verificar se tem pelo menos 1 rolledBack & hashPre === hashAfterRollback
const rbRecs = [];
pr.forEach(grp => (grp.records||[]).forEach(r => { if (r.rolledBack) rbRecs.push(r); }));
console.log('--- Rollback Records ---');
console.log('  total rolledBack:', rbRecs.length);
rbRecs.forEach(r => {
  const eq = r.hashPre && r.hashAfterRollback ? (r.hashPre === r.hashAfterRollback ? 'IGUAIS ✅' : 'DIFERENTES ❌') : null;
  console.log('  ' + JSON.stringify({ruleId:r.ruleId,iter:r.iter,rollbackEqual:r.rollbackEqual,hashPreEqAfterRb:eq,rollbackReason:r.rollbackReason?.slice(0,100)}));
});
console.log('=========== FIM: ' + label + ' ===========\n');
