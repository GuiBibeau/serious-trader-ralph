export type ValidationMetrics = {
  netReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  winRate: number;
  tradeCount: number;
};

function round(value: number, decimals = 4): number {
  const d = 10 ** decimals;
  return Math.round(value * d) / d;
}

function maxDrawdownPct(equityCurve: number[]): number {
  if (equityCurve.length === 0) return 0;
  let peak = equityCurve[0] ?? 1;
  let maxDd = 0;
  for (const point of equityCurve) {
    if (point > peak) peak = point;
    if (peak <= 0) continue;
    const dd = ((peak - point) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
  }
  return round(maxDd, 4);
}

export function computeValidationMetrics(
  equityCurve: number[],
  tradeReturns: number[],
): ValidationMetrics {
  const start = equityCurve[0] ?? 1;
  const end = equityCurve[equityCurve.length - 1] ?? start;
  const netReturnPct = start > 0 ? ((end - start) / start) * 100 : 0;

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  for (const r of tradeReturns) {
    if (!Number.isFinite(r)) continue;
    if (r > 0) {
      grossProfit += r;
      wins += 1;
    } else if (r < 0) {
      grossLoss += Math.abs(r);
    }
  }

  let profitFactor = 1;
  if (grossLoss > 0) {
    profitFactor = grossProfit / grossLoss;
  } else if (grossProfit > 0) {
    profitFactor = 99;
  }

  const tradeCount = tradeReturns.length;
  const winRate = tradeCount > 0 ? (wins / tradeCount) * 100 : 0;

  return {
    netReturnPct: round(netReturnPct, 4),
    maxDrawdownPct: maxDrawdownPct(equityCurve),
    profitFactor: round(profitFactor, 4),
    winRate: round(winRate, 4),
    tradeCount,
  };
}
