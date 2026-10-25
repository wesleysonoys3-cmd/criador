import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PROJECT_ROOT = '/Users/tiagosantos/Desktop/criador/workspace/teste-sec-rc25-final';

function mem() {
  const m = process.memoryUsage();
  return `rss=${Math.round(m.rss/1048576)}MB heapUsed=${Math.round(m.heapUsed/1048576)}MB heapTotal=${Math.round(m.heapTotal/1048576)}MB external=${Math.round(m.external/1048576)}MB arrayBuffers=${Math.round(m.arrayBuffers/1048576)}MB`;
}

const RULES = [
  {
    id: 'SEC-HC-GOOGLEKEY',
    regex: /(?:GOOGLE[_\-]?(?:API|MAPS|CLOUD|SERVICE)[_\-]?KEY\s*[:=]\s*["']?)?(AQ[.\-][a-zA-Z0-9_\-]{20,})/g,
  },
  {
    id: 'SEC-HC-ANYKEY',
    regex: /(?:["']?(?:api[_-]?key|secret|token|access[_-]?key|passwd|password|auth[_-]?token|private[_-]?key)["']?\s*[:=]\s*["']?(sk-[a-zA-Z0-9_\-]{16,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|ghu_[a-zA-Z0-9]{20,}|ghs_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{20,}|AQ[.\-][a-zA-Z0-9_\-]{20,})["']?)/g,
  },
  {
    id: 'SEC-HC-OPENROUTER',
    regex: /(?:OPENROUTER[_\-]?API[_\-]?KEY\s*[:=]\s*["']?)?(sk-or-v1-[a-f0-9]{40,})/g,
  },
  {
    id: 'SEC-EX-STATIC-UNPROTECTED',
    regex: /express\.static\s*\(\s*([^()]*(?:\([^()]*\)[^()]*)*)\s*\)(?![\s\S]{0,260}\bdotfiles\s*:\s*["']deny)/g,
  },
];

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function listFiles(base) {
  const out = [];
  for (const e of fs.readdirSync(base, {withFileTypes:true})) {
    const p = path.join(base, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}

function runAudit(projectPath) {
  console.log('PROJECT PATH:', projectPath);
  console.log('EXISTS:', fs.existsSync(projectPath));
  console.log('DIRS:', fs.readdirSync(projectPath));
  console.log('[MEM SCRIPT BEGIN]', mem());
  console.log('[MEM audit BEGIN]', mem());
  console.log('[MEM listFiles-begin]', mem());
  const filesAbs = listFiles(projectPath);
  const files = filesAbs.map(f => ({ abs: f, rel: path.relative(projectPath, f), text: fs.readFileSync(f,'utf8'), size: fs.statSync(f).size }));
  console.log('[MEM listFiles-done (count='+files.length+')]', mem());
  console.log('FILES:');
  for (const f of files) console.log('  -', f.rel, f.size, 'bytes');
  console.log('');
  console.log('TOTAL FILES SCANADOS:', files.length);

  let findingCount = 0;
  for (let i=0;i<files.length;i++) {
    const f = files[i];
    const text = f.text;
    console.log('');
    console.log('=== Arquivo '+(i+1)+'/'+files.length+': '+f.rel+' ('+text.length+' chars, '+(text.match(/\n/g)||[]).length+1+' linhas) ===');
    console.log('[MEM arquivo '+f.rel+' - início]', mem());
    for (let r=0;r<RULES.length;r++) {
      const rule = RULES[r];
      console.log('[MEM   regra '+rule.id+' - início]', mem());
      const re = new RegExp(rule.regex.source, rule.regex.flags);
      console.log('  regra '+(r+1)+'/'+RULES.length+': '+rule.id+' - regex source.length='+rule.regex.source.length);
      let m;
      let matchCount = 0;
      while ((m = re.exec(text)) !== null) {
        matchCount++;
        findingCount++;
        if (matchCount === 1) console.log('    primeiro match em '+m.index+': "'+m[0].slice(0,80)+'"');
        if (matchCount % 100 === 0) {
          console.log('    matchCount='+matchCount+' mem heapUsed='+Math.round(process.memoryUsage().heapUsed/1048576)+'MB');
          if (matchCount >= 5000) {
            console.log('    === LIMITE 5000 ALCANÇADO (LOOP?), PARANDO REGRA ===');
            break;
          }
        }
        const idx = m.index;
        let lineNumber = 1;
        for (let ii = 0; ii < idx; ii++) if (text.charCodeAt(ii) === 10) lineNumber++;
        const fid = sha256(rule.id+'|'+f.rel+'|'+lineNumber+'|'+m[0].slice(0,80)).slice(0,24);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      console.log('    total matches='+matchCount);
      console.log('[MEM   regra '+rule.id+' - fim]', mem());
    }
    console.log('[MEM arquivo '+f.rel+' - fim]', mem());
  }
  console.log('');
  console.log('[MEM audit END]', mem());
  console.log('TOTAL findings:', findingCount);
  console.log('=== PROFILING CONCLUÍDO SEM OOM ===');
}

runAudit(PROJECT_ROOT);
