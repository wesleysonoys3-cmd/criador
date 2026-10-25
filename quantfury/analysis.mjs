const TREND_WINDOW = [
  { pct: 0.3, label: 'Ligeira' },
  { pct: 1.0, label: 'Moderada' },
  { pct: 2.5, label: 'Forte' },
  { pct: 5.0, label: 'Intensa' },
];

const RISK_LEVELS = [
  { score: 25,  tag: 'Baixo',       color: 'emerald' },
  { score: 50,  tag: 'Moderado',    color: 'amber' },
  { score: 75,  tag: 'Alto',        color: 'orange' },
  { score: 100, tag: 'Muito Alto',  color: 'rose' },
];

function pctChange(from, to) {
  if (from == null || to == null || from === 0) return null;
  const v = ((to - from) / Math.abs(from)) * 100;
  return Number.isFinite(v) ? v : null;
}

function abs(n) { return n == null ? null : Math.abs(n); }

function gradeTrend(movePct) {
  if (movePct == null) return { label: 'Indefinido', magnitude: null };
  const a = Math.abs(movePct);
  let chosen = TREND_WINDOW[0];
  for (const w of TREND_WINDOW) if (a >= w.pct) chosen = w;
  return { label: chosen.label, magnitude: a };
}

function classifyDirectionFavor(position) {
  const move = pctChange(position.entryPrice, position.currentPrice);
  if (move == null) return { text: 'Sem dados suficientes', numeric: null, favor: 'indefinido' };
  const shortFavor = position.direction === 'SHORT';
  const longFavor = position.direction === 'LONG';
  const favor = (longFavor && move > 0) || (shortFavor && move < 0) ? 'favor' :
                (longFavor && move < 0) || (shortFavor && move > 0) ? 'contra' : 'neutro';
  return { text: favor === 'favor' ? 'A favor' : favor === 'contra' ? 'Contra' : 'Neutro', numeric: move, favor };
}

function estimateVolatility(position, _account) {
  const move = abs(pctChange(position.entryPrice, position.currentPrice));
  if (move == null) return { label: 'Sem dados', score: 0 };
  if (move < 0.5) return { label: 'Baixa',  score: 10 };
  if (move < 1.5) return { label: 'Média',  score: 35 };
  if (move < 3.0) return { label: 'Alta',   score: 60 };
  return { label: 'Muito alta', score: 85 };
}

function estimateRiskLevel(position, account) {
  let score = 0;
  const move = abs(pctChange(position.entryPrice, position.currentPrice));
  if (move != null) score += Math.min(30, move * 6);
  const pnl = position.pnl != null && account?.balance ? (position.pnl / Math.max(1e-9, account.balance)) * 100 : 0;
  score += Math.min(30, abs(pnl) * 20);
  const lev = abs(position.leverage) || 1;
  if (lev >= 10) score += 25;
  else if (lev >= 5) score += 15;
  else if (lev >= 2) score += 5;
  const favor = classifyDirectionFavor(position);
  if (favor.favor === 'contra') score += 10;
  score = Math.max(0, Math.min(100, score));
  let lvl = RISK_LEVELS[0];
  for (const r of RISK_LEVELS) if (score <= r.score) { lvl = r; break; }
  return { score, tag: lvl.tag, color: lvl.color };
}

function supportResistanceHint(position) {
  const entry = position.entryPrice;
  const current = position.currentPrice;
  if (entry == null || current == null) return null;
  const dist = pctChange(entry, current);
  if (dist == null) return null;
  const atEntry = Math.abs(dist) < 0.3;
  if (atEntry) return { level: 'Próximo ao preço de entrada', note: `Distância de ${dist.toFixed(2)}% da entrada. Sem confirmação de rompimento.` };
  if (dist < -2) return { level: 'Possível suporte abaixo', note: `Preço ${dist.toFixed(2)}% abaixo da entrada. Observar possível zona de compra.` };
  if (dist > 2)  return { level: 'Possível resistência acima', note: `Preço +${dist.toFixed(2)}% acima da entrada. Observar possível zona de venda.` };
  return { level: 'Zona intermediária', note: `Movimento de ${dist.toFixed(2)}% desde a entrada.` };
}

function buildFactors(position, account) {
  const trend = gradeTrend(pctChange(position.entryPrice, position.currentPrice));
  const dir = classifyDirectionFavor(position);
  const vol = estimateVolatility(position, account);
  const sr = supportResistanceHint(position);
  const risk = estimateRiskLevel(position, account);
  const distEntryPct = pctChange(position.entryPrice, position.currentPrice);
  return {
    trend: `${trend.label} (${distEntryPct == null ? '?' : (distEntryPct >= 0 ? '+' : '') + distEntryPct.toFixed(2)}%)`,
    momentum: dir.text === 'Sem dados suficientes' ? dir.text : `${dir.text} da direção · ${dir.numeric == null ? '' : (dir.numeric >= 0 ? '+' : '') + dir.numeric.toFixed(2)+'%'}`,
    volatility: vol.label,
    supportResistance: sr ? sr.level : 'Indefinido',
    distanciaEntrada: distEntryPct == null ? 'Indisponível' : `${distEntryPct.toFixed(2)}%`,
    pnl: position.pnl == null ? 'Indisponível' : `${position.pnl >= 0 ? '+' : ''}${formatCurrency(position.pnl)}`,
    risk,
    srNote: sr ? sr.note : null,
  };
}

function formatCurrency(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const absN = Math.abs(Number(n));
  const sign = n < 0 ? '-' : '';
  if (absN >= 1e9) return sign + '$' + (absN / 1e9).toFixed(2) + 'B';
  if (absN >= 1e6) return sign + '$' + (absN / 1e6).toFixed(2) + 'M';
  if (absN >= 1e3) return sign + '$' + (absN / 1e3).toFixed(2) + 'K';
  return sign + '$' + absN.toFixed(2);
}

function buildAlert(position, factors, priorAlertState) {
  const now = Date.now();
  const msgs = [];
  const risk = factors.risk;
  const stateKey = `${position.asset || 'pos'}:${risk.score}`;
  if (risk.score >= 75) msgs.push(`Tiago, atenção: sua posição em ${position.asset || 'este ativo'} entrou em uma região de maior risco (${risk.tag}).`);
  const movePct = pctChange(position.entryPrice, position.currentPrice);
  if (movePct != null && Math.abs(movePct) >= 3) {
    msgs.push(`Tiago, o preço de ${position.asset || 'este ativo'} se afastou ${Math.abs(movePct).toFixed(1)}% do nível de entrada (${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}%).`);
  }
  if (priorAlertState && typeof priorAlertState === 'object') {
    const priorRisk = Number(priorAlertState.riskScore) || 0;
    if (Math.abs(risk.score - priorRisk) >= 20) {
      msgs.push(`Tiago, houve mudança relevante no cenário da posição em ${position.asset || 'este ativo'}: risco saiu de ${describeRisk(priorRisk)} para ${risk.tag}.`);
    }
  }
  if (!msgs.length) return null;
  return Object.freeze({
    id: `qf_alert_${now}_${Math.random().toString(36).slice(2,8)}`,
    createdAt: new Date(now).toISOString(),
    asset: position.asset || '—',
    level: risk.score >= 75 ? 'critical' : risk.score >= 50 ? 'warning' : 'info',
    messages: Object.freeze(msgs),
    stateKey,
    riskSnapshot: Object.freeze({ score: risk.score, tag: risk.tag, color: risk.color }),
  });
}

function describeRisk(score) {
  let lvl = RISK_LEVELS[0];
  for (const r of RISK_LEVELS) if (score <= r.score) { lvl = r; break; }
  return lvl.tag;
}

function buildAnalysisText(userName, position, factors, account) {
  const fav = factors.momentum;
  const lines = [];
  lines.push(`${userName || 'Tiago'}, sua posição em ${position.asset || 'este ativo'} está marcada como ${position.direction || 'direção não informada'}.`);
  lines.push('');
  if (position.entryPrice != null)   lines.push(`Entrada: US$ ${formatCurrency(position.entryPrice).replace('$','').trim()}`);
  if (position.currentPrice != null) lines.push(`Atual: US$ ${formatCurrency(position.currentPrice).replace('$','').trim()}`);
  if (position.pnl != null)          lines.push(`P&L: ${factors.pnl}`);
  lines.push('');
  lines.push(`O preço está se movimentando ${fav.toLowerCase()} da posição.`);
  lines.push('');
  lines.push('Cenário observado:');
  lines.push(`- Tendência: ${factors.trend}`);
  lines.push(`- Momentum: ${factors.momentum}`);
  lines.push(`- Volatilidade: ${factors.volatility}`);
  if (factors.srNote) lines.push(`- ${factors.supportResistance}: ${factors.srNote}`);
  lines.push(`- Distância da entrada: ${factors.distanciaEntrada}`);
  lines.push(`- P&L: ${factors.pnl}`);
  if (position.size != null || account?.balance) {
    const exposicao = position.size != null && position.currentPrice != null
      ? formatCurrency(position.size * position.currentPrice)
      : (account?.equity ? formatCurrency(account.equity) : null);
    if (exposicao) lines.push(`- Exposição estimada: ${exposicao}`);
  }
  lines.push('');
  lines.push(`Nível de atenção: ${factors.risk.tag} (${factors.risk.score}/100).`);
  lines.push('');
  lines.push('Fatores considerados: tendência, momentum, volatilidade, suporte/resistência, distância da entrada, P&L e demais dados disponíveis pelo MCP.');
  lines.push('');
  lines.push('Observação: esta análise é descritiva e utiliza apenas os dados fornecidos pelo MCP da Quantfury. Não é recomendação de compra ou venda. Não há certeza sobre movimentos futuros.');
  return lines.join('\n');
}

export function analyzeQuantfuryPosition({ position, account, userName = 'Tiago', priorAlertState = null }) {
  if (!position) throw new Error('Posição ausente para análise.');
  const factors = buildFactors(position, account);
  const text = buildAnalysisText(userName, position, factors, account);
  const alert = buildAlert(position, factors, priorAlertState);
  const structuredObservation = Object.freeze({
    asset: position.asset || null,
    direction: position.direction || null,
    entryPrice: position.entryPrice ?? null,
    currentPrice: position.currentPrice ?? null,
    pnl: position.pnl ?? null,
    movePct: pctChange(position.entryPrice, position.currentPrice),
    trend: factors.trend,
    momentum: factors.momentum,
    volatility: factors.volatility,
    riskLevel: factors.risk.tag,
    riskScore: factors.risk.score,
    volatilityScore: estimateVolatility(position, account).score,
  });
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    factors: Object.freeze({
      trend: factors.trend,
      momentum: factors.momentum,
      volatility: factors.volatility,
      supportResistance: factors.supportResistance,
      distanciaEntrada: factors.distanciaEntrada,
      pnl: factors.pnl,
    }),
    analysis: text,
    alert,
    structuredObservation,
  });
}
