import fs from 'fs';
const d = JSON.parse(fs.readFileSync('/Users/tiagosantos/Desktop/criador/_result_pipeline_RC253_FINAL.json', 'utf8'));
console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  RC25.3 FINAL  ·  RESULTADO PIPELINE  teste-sec-rc25-final   ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('【A】ok                           = ', d.ok);
console.log('【B】✅ success                    = ', d.success, '  ← ESPERADO: true');
console.log('【C】appliedTotal                 = ', d.appliedTotal, ' ← esperado >= 4');
console.log('【D】iterationsCount              = ', d.iterationsCount);
console.log('【E】stopReason                   = ', d.stopReason);
console.log('【F】finalScore / finalGrade      = ', d.finalScore, '/', d.finalGrade);
console.log('【G】finalCounts                  = ', JSON.stringify(d.finalCounts));
const auto = (d.finalClassification && d.finalClassification.autoFixable) ? d.finalClassification.autoFixable.length : -1;
console.log('【H】✅ final autoFixable.length  = ', auto, '  ← ESPERADO 0 (nenhum pendente)');
const manu = (d.finalClassification && d.finalClassification.manual) ? d.finalClassification.manual.length : -1;
console.log('【I】final manual.length          = ', manu);
console.log('【J】preBackupFile                = ', d.preBackupFile ? 'EXISTE ' + d.preBackupFile.split('/').pop() : 'NAO CRIADO');
console.log('【K】durationMs                   = ', d.durationMs, 'ms');
console.log('');
console.log('─── DETALHES ITERAÇÕES ───');
(d.iterations || []).forEach((it, i) => {
  console.log('');
  console.log('   Iter ' + (i+1) + ':');
  console.log('     score           =', it.score, 'grade=' + (it.grade || ''));
  console.log('     appliedCount    =', it.appliedCount, ' skippedCount=', it.skippedCount);
  console.log('     counts          =', JSON.stringify(it.counts));
  if (it.classification) console.log('     class.criticos/autoF=', it.classification.criticos, '/', it.classification.autoFixable && it.classification.autoFixable.length);
  console.log('     stopCondition   =', it.stopCondition);
  if (it.applied && it.applied.length) {
    it.applied.forEach(a => console.log('       ✅ APPLIED:', a.ruleId, 'file=', a.file, (a.acao ? 'acao=' + a.acao.slice(0, 100) : '')));
  }
  if (it.skipped && it.skipped.length) {
    it.skipped.slice(0, 6).forEach(s => console.log('       ⏭  SKIPPED:', s.ruleId, 'file=', s.file, 'reason=', (s.reason || '').slice(0, 90)));
  }
});
