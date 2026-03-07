import { getPairConfig, type PairId, type TokenSymbol } from "./trade-pairs";

export type PositionFill = {
  id: string;
  ts: number;
  pairId: PairId;
  direction: "buy" | "sell";
  status: string;
  signature: string | null;
  baseFilledUi: number;
  quoteFilledUi: number;
  fillPrice: number | null;
  qualitySummary: string;
};

export type LivePosition = {
  pairId: PairId;
  baseSymbol: TokenSymbol;
  quoteSymbol: TokenSymbol;
  sizeBase: number;
  avgEntry: number | null;
  mark: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number;
  notional: number | null;
  leverage: number | null;
  riskLevel: "low" | "medium" | "high";
  warning: string | null;
  lastUpdatedTs: number;
  qualitySummary: string;
};

export type LivePositionTotals = {
  unrealizedPnl: number;
  realizedPnl: number;
  notional: number;
};

function isFillSuccess(fill: PositionFill): boolean {
  const status = fill.status.trim().toLowerCase();
  if (!status) return false;
  return (
    status === "landed" ||
    status === "finalized" ||
    status === "confirmed" ||
    status === "processed"
  );
}

function toFiniteNumber(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return value;
}

function toNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function resolveRisk(input: {
  leverage: number | null;
  unrealizedPnl: number | null;
  notional: number | null;
}): { riskLevel: LivePosition["riskLevel"]; warning: string | null } {
  const { leverage, unrealizedPnl, notional } = input;
  if (leverage !== null && leverage >= 2) {
    return {
      riskLevel: "high",
      warning: "High leverage vs quote collateral.",
    };
  }
  if (
    unrealizedPnl !== null &&
    notional !== null &&
    notional > 0 &&
    unrealizedPnl / notional <= -0.08
  ) {
    return {
      riskLevel: "high",
      warning: "Unrealized drawdown exceeds 8%.",
    };
  }
  if (leverage !== null && leverage >= 1) {
    return {
      riskLevel: "medium",
      warning: "Exposure is elevated.",
    };
  }
  return {
    riskLevel: "low",
    warning: null,
  };
}

export function buildLivePositions(input: {
  fills: readonly PositionFill[];
  markByPair: Partial<Record<PairId, number | null>>;
  quoteBalanceBySymbol: Partial<Record<TokenSymbol, number | null>>;
}): LivePosition[] {
  const sorted = [...input.fills].sort((a, b) => a.ts - b.ts);
  const state = new Map<
    PairId,
    {
      sizeBase: number;
      costQuote: number;
      realizedPnl: number;
      lastFillPrice: number | null;
      lastUpdatedTs: number;
      qualitySummary: string;
    }
  >();

  for (const fill of sorted) {
    if (!isFillSuccess(fill)) continue;
    const baseFilled = toNonNegative(fill.baseFilledUi);
    const quoteFilled = toNonNegative(fill.quoteFilledUi);
    const derivedPrice =
      fill.fillPrice !== null
        ? fill.fillPrice
        : baseFilled > 0
          ? quoteFilled / baseFilled
          : null;
    if (baseFilled <= 0 || quoteFilled <= 0) continue;
    if (!Number.isFinite(derivedPrice ?? NaN) || (derivedPrice ?? 0) <= 0) {
      continue;
    }
    const price = derivedPrice as number;

    const current = state.get(fill.pairId) ?? {
      sizeBase: 0,
      costQuote: 0,
      realizedPnl: 0,
      lastFillPrice: null,
      lastUpdatedTs: fill.ts,
      qualitySummary: fill.qualitySummary,
    };

    if (fill.direction === "buy") {
      current.sizeBase += baseFilled;
      current.costQuote += baseFilled * price;
    } else if (current.sizeBase > 0) {
      const avgEntry = current.costQuote / current.sizeBase;
      const closeSize = Math.min(baseFilled, current.sizeBase);
      current.realizedPnl += (price - avgEntry) * closeSize;
      current.sizeBase -= closeSize;
      current.costQuote -= avgEntry * closeSize;
      if (current.sizeBase <= 1e-9) {
        current.sizeBase = 0;
        current.costQuote = 0;
      }
    }

    current.lastFillPrice = price;
    current.lastUpdatedTs = fill.ts;
    current.qualitySummary = fill.qualitySummary;
    state.set(fill.pairId, current);
  }

  const positions: LivePosition[] = [];
  for (const [pairId, entry] of state.entries()) {
    if (entry.sizeBase <= 0) continue;
    const pair = getPairConfig(pairId);
    const avgEntry =
      entry.sizeBase > 0 ? entry.costQuote / entry.sizeBase : null;
    const mark = toFiniteNumber(
      Number(input.markByPair[pairId] ?? entry.lastFillPrice ?? NaN),
    );
    const notional =
      mark === null ? null : (toFiniteNumber(entry.sizeBase * mark) ?? null);
    const unrealizedPnl =
      avgEntry === null || mark === null
        ? null
        : toFiniteNumber((mark - avgEntry) * entry.sizeBase);
    const quoteBalance = toFiniteNumber(
      Number(input.quoteBalanceBySymbol[pair.quoteSymbol] ?? NaN),
    );
    const leverage =
      quoteBalance && quoteBalance > 0 && notional !== null
        ? toFiniteNumber(notional / quoteBalance)
        : null;
    const risk = resolveRisk({
      leverage,
      unrealizedPnl,
      notional,
    });
    positions.push({
      pairId,
      baseSymbol: pair.baseSymbol,
      quoteSymbol: pair.quoteSymbol,
      sizeBase: entry.sizeBase,
      avgEntry,
      mark,
      unrealizedPnl,
      realizedPnl: entry.realizedPnl,
      notional,
      leverage,
      riskLevel: risk.riskLevel,
      warning: risk.warning,
      lastUpdatedTs: entry.lastUpdatedTs,
      qualitySummary: entry.qualitySummary,
    });
  }

  positions.sort((a, b) => {
    const aNotional = a.notional ?? 0;
    const bNotional = b.notional ?? 0;
    if (aNotional !== bNotional) return bNotional - aNotional;
    return b.lastUpdatedTs - a.lastUpdatedTs;
  });
  return positions;
}

export function summarizeLivePositions(
  positions: readonly LivePosition[],
): LivePositionTotals {
  return positions.reduce(
    (acc, position) => ({
      unrealizedPnl: acc.unrealizedPnl + (position.unrealizedPnl ?? 0),
      realizedPnl: acc.realizedPnl + position.realizedPnl,
      notional: acc.notional + (position.notional ?? 0),
    }),
    {
      unrealizedPnl: 0,
      realizedPnl: 0,
      notional: 0,
    },
  );
}
