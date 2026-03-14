import {
  parseRuntimeMarginAccountSnapshot,
  type RuntimeMarginAccountSnapshot,
} from "./runtime_contracts";

export type MangoOrderOptions = {
  orderType?: "market" | "limit" | "trigger" | null;
  timeInForce?: "gtc" | "ioc" | "fok" | null;
  reduceOnly?: boolean | null;
  limitPriceAtomic?: string | null;
  triggerPriceAtomic?: string | null;
  marketSnapshot?: unknown;
  accountSnapshot?: unknown;
};

export type MangoMarketSnapshot = {
  instrumentId: string;
  marketType: "spot" | "perp";
  marketName: string;
  orderbookSource: "openbook_v2" | "mango_perp";
  oracleProvider: string | null;
  status: string | null;
  referencePriceQuote: number | null;
  initialMarginRatio: number | null;
  maintenanceMarginRatio: number | null;
};

export type MangoIntentPreview = {
  market: MangoMarketSnapshot;
  account: RuntimeMarginAccountSnapshot;
  family: "clob_order" | "perp_order";
  side: string;
  orderType: "market" | "limit" | "trigger";
  timeInForce: "gtc" | "ioc" | "fok";
  reduceOnly: boolean;
  quantityAtomic: string;
  collateralAtomic: string | null;
  limitPriceAtomic: string | null;
  triggerPriceAtomic: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPositiveAtomic(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return /^[1-9][0-9]*$/.test(normalized) ? normalized : null;
}

function normalizeOrderType(value: unknown): "market" | "limit" | "trigger" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "limit") return "limit";
  if (normalized === "trigger") return "trigger";
  return "market";
}

function normalizeTimeInForce(value: unknown): "gtc" | "ioc" | "fok" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "ioc") return "ioc";
  if (normalized === "fok") return "fok";
  return "gtc";
}

function readAccountSnapshot(
  options: MangoOrderOptions | null,
): RuntimeMarginAccountSnapshot {
  if (!options?.accountSnapshot) {
    throw new Error("mango-account-snapshot-missing");
  }
  const snapshot = parseRuntimeMarginAccountSnapshot(options.accountSnapshot);
  if (snapshot.venueKey !== "mango") {
    throw new Error("mango-account-snapshot-venue-mismatch");
  }
  if (!snapshot.isOperational) {
    throw new Error("mango-account-not-operational");
  }
  return snapshot;
}

function readMarketSnapshot(input: {
  options: MangoOrderOptions | null;
  instrumentId: string;
  marketType: "spot" | "perp";
}): MangoMarketSnapshot {
  const marketSnapshot = isRecord(input.options?.marketSnapshot)
    ? input.options?.marketSnapshot
    : null;
  if (!marketSnapshot) {
    throw new Error("mango-market-snapshot-missing");
  }

  const instrumentId =
    readTrimmedString(marketSnapshot.instrumentId) ?? input.instrumentId;
  if (instrumentId !== input.instrumentId) {
    throw new Error("mango-market-snapshot-instrument-mismatch");
  }

  const marketType =
    readTrimmedString(marketSnapshot.marketType) === "perp" ? "perp" : "spot";
  if (marketType !== input.marketType) {
    throw new Error("mango-market-snapshot-market-type-mismatch");
  }

  const orderbookSource =
    readTrimmedString(marketSnapshot.orderbookSource) === "mango_perp"
      ? "mango_perp"
      : "openbook_v2";

  return {
    instrumentId,
    marketType,
    marketName:
      readTrimmedString(marketSnapshot.marketName) ?? input.instrumentId,
    orderbookSource:
      input.marketType === "perp" ? "mango_perp" : orderbookSource,
    oracleProvider: readTrimmedString(marketSnapshot.oracleProvider),
    status: readTrimmedString(marketSnapshot.status),
    referencePriceQuote: readFiniteNumber(marketSnapshot.referencePriceQuote),
    initialMarginRatio: readFiniteNumber(marketSnapshot.initialMarginRatio),
    maintenanceMarginRatio: readFiniteNumber(
      marketSnapshot.maintenanceMarginRatio,
    ),
  };
}

function resolveReferencePriceQuote(input: {
  market: MangoMarketSnapshot;
  account: RuntimeMarginAccountSnapshot;
  instrumentId: string;
}): number | null {
  if (input.market.referencePriceQuote !== null) {
    return input.market.referencePriceQuote;
  }
  const position = input.account.positions.find(
    (entry) => entry.instrumentId === input.instrumentId,
  );
  const markPrice = position?.markPriceQuote
    ? Number(position.markPriceQuote)
    : Number.NaN;
  if (Number.isFinite(markPrice)) return markPrice;
  const oracle = input.account.oracles.find(
    (entry) => entry.instrumentId === input.instrumentId,
  );
  const oraclePrice = oracle?.priceQuote
    ? Number(oracle.priceQuote)
    : Number.NaN;
  return Number.isFinite(oraclePrice) ? oraclePrice : null;
}

function hasHealthyOracleForInstrument(input: {
  account: RuntimeMarginAccountSnapshot;
  instrumentId: string;
}): boolean {
  return input.account.oracles.some(
    (oracle) =>
      oracle.instrumentId === input.instrumentId && oracle.status === "healthy",
  );
}

export class MangoClient {
  describeIntent(input: {
    family: "clob_order" | "perp_order";
    instrumentId: string;
    marketType: "spot" | "perp";
    side: string;
    quantityAtomic: string;
    collateralAtomic?: string | null;
    options?: MangoOrderOptions | null;
  }): MangoIntentPreview {
    const quantityAtomic = readPositiveAtomic(input.quantityAtomic);
    if (!quantityAtomic) {
      throw new Error("mango-quantity-atomic-invalid");
    }
    const collateralAtomic = input.collateralAtomic
      ? readPositiveAtomic(input.collateralAtomic)
      : null;
    if (input.collateralAtomic && !collateralAtomic) {
      throw new Error("mango-collateral-atomic-invalid");
    }

    const account = readAccountSnapshot(input.options ?? null);
    if (
      !hasHealthyOracleForInstrument({
        account,
        instrumentId: input.instrumentId,
      })
    ) {
      throw new Error("mango-oracle-health-missing");
    }
    const reduceOnly =
      input.side === "close_long" ||
      input.side === "close_short" ||
      input.options?.reduceOnly === true;
    if (account.liquidationRiskLevel === "critical" && !reduceOnly) {
      throw new Error("mango-account-liquidation-risk-critical");
    }

    const market = readMarketSnapshot({
      options: input.options ?? null,
      instrumentId: input.instrumentId,
      marketType: input.marketType,
    });

    return {
      market: {
        ...market,
        referencePriceQuote: resolveReferencePriceQuote({
          market,
          account,
          instrumentId: input.instrumentId,
        }),
      },
      account,
      family: input.family,
      side: input.side,
      orderType: normalizeOrderType(input.options?.orderType),
      timeInForce: normalizeTimeInForce(input.options?.timeInForce),
      reduceOnly,
      quantityAtomic,
      collateralAtomic,
      limitPriceAtomic: readPositiveAtomic(input.options?.limitPriceAtomic),
      triggerPriceAtomic: readPositiveAtomic(input.options?.triggerPriceAtomic),
    };
  }

  buildSyntheticQuote(preview: MangoIntentPreview): {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    priceImpactPct: number;
    routePlan: Array<{ poolId: string; swapInfo: { label: string } }>;
  } {
    const label =
      preview.market.marketType === "perp"
        ? "Mango v4 Perps"
        : "Mango v4 Spot Margin";
    return {
      inputMint: preview.account.accountRef,
      outputMint: preview.market.instrumentId,
      inAmount: preview.collateralAtomic ?? preview.quantityAtomic,
      outAmount: preview.quantityAtomic,
      priceImpactPct: 0,
      routePlan: [
        {
          poolId: preview.market.marketName,
          swapInfo: { label },
        },
      ],
    };
  }
}
