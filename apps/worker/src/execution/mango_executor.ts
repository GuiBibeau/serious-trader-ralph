import { MangoClient } from "../mango";
import type {
  ExecuteIntentInput,
  ExecuteSwapResult,
  NonSwapExecutionIntent,
} from "./types";

type ExecuteMangoIntentInput = ExecuteIntentInput & {
  intent: NonSwapExecutionIntent;
};

function nowIso(): string {
  return new Date().toISOString();
}

function buildLifecycle(input: {
  family: "clob_order" | "perp_order";
  side: string;
  reduceOnly: boolean;
}): NonNullable<ExecuteSwapResult["executionMeta"]>["lifecycle"] {
  if (input.family === "clob_order") {
    return {
      orderState: "open",
      fillState: "pending",
      settlementState: "confirmed",
      ...(input.reduceOnly ? { positionState: "closing" } : {}),
      notes: [`mango:${input.family}:${input.side}`],
    };
  }
  const closing =
    input.side === "close_long" ||
    input.side === "close_short" ||
    input.reduceOnly;
  return {
    orderState: "open",
    fillState: "pending",
    positionState: closing ? "closing" : "opening",
    settlementState: "confirmed",
    notes: [`mango:${input.family}:${input.side}`],
  };
}

function readMangoOptions(
  intent: NonSwapExecutionIntent,
): Record<string, unknown> | null {
  const params = intent.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  return params;
}

function validateMangoSide(
  intent: NonSwapExecutionIntent,
): NonSwapExecutionIntent["side"] {
  const side = String(intent.side ?? "").trim();
  if (!side) {
    throw new Error("invalid-mango-side");
  }
  if (intent.family === "clob_order") {
    if (side === "buy" || side === "sell") {
      return side;
    }
    throw new Error("invalid-mango-clob-side");
  }
  if (
    side === "long" ||
    side === "short" ||
    side === "close_long" ||
    side === "close_short"
  ) {
    return side;
  }
  throw new Error("invalid-mango-perp-side");
}

export async function executeMangoIntent(
  input: ExecuteMangoIntentInput,
): Promise<ExecuteSwapResult> {
  if (
    input.intent.family !== "clob_order" &&
    input.intent.family !== "perp_order"
  ) {
    throw new Error("invalid-mango-intent-family");
  }
  if (input.intent.venueKey !== "mango") {
    throw new Error("invalid-mango-venue");
  }
  if (
    input.intent.family === "clob_order" &&
    input.intent.marketType !== "spot"
  ) {
    throw new Error("invalid-mango-clob-market-type");
  }
  if (
    input.intent.family === "perp_order" &&
    input.intent.marketType !== "perp"
  ) {
    throw new Error("invalid-mango-perp-market-type");
  }
  if (input.runtimeMode === "live") {
    throw new Error("mango-live-mode-not-supported");
  }
  const side = validateMangoSide(input.intent);

  const mango = input.mango ?? new MangoClient();
  const preview = mango.describeIntent({
    family: input.intent.family,
    instrumentId: input.intent.instrumentId,
    marketType: input.intent.marketType,
    side,
    quantityAtomic: String(input.intent.quantityAtomic ?? ""),
    collateralAtomic: input.intent.collateralAtomic ?? null,
    options: readMangoOptions(input.intent),
  });
  const lifecycle = buildLifecycle({
    family: input.intent.family,
    side,
    reduceOnly: preview.reduceOnly,
  });
  const usedQuote = mango.buildSyntheticQuote(preview);

  const referenceSnapshot = {
    accountRef: preview.account.accountRef,
    liquidationRiskLevel: preview.account.liquidationRiskLevel,
    equityQuote: preview.account.equityQuote,
    initHealthQuote: preview.account.initHealthQuote,
    maintHealthQuote: preview.account.maintHealthQuote,
    freeCollateralQuote: preview.account.freeCollateralQuote,
    usedMarginQuote: preview.account.usedMarginQuote,
    beingLiquidated: preview.account.beingLiquidated,
    marketName: preview.market.marketName,
    marketType: preview.market.marketType,
    orderbookSource: preview.market.orderbookSource,
    oracleProvider: preview.market.oracleProvider,
    marketStatus: preview.market.status,
    referencePriceQuote:
      preview.market.referencePriceQuote === null
        ? null
        : String(preview.market.referencePriceQuote),
    orderType: preview.orderType,
    timeInForce: preview.timeInForce,
    reduceOnly: preview.reduceOnly,
    positionCount: preview.account.positions.length,
    oracleCount: preview.account.oracles.length,
  };

  if (input.policy.dryRun) {
    return {
      status: "dry_run",
      signature: null,
      usedQuote,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route: "mango",
        classification: "dry_run",
        intentId: preview.market.instrumentId,
        venueSessionId: `mango:${preview.account.accountRef}`,
        lifecycle,
        referencePrice: {
          verdict: "allow",
          reason: null,
          executionPrice:
            preview.market.referencePriceQuote === null
              ? null
              : String(preview.market.referencePriceQuote),
          executionDivergenceBps: null,
          snapshot: referenceSnapshot,
        },
        trace: {
          txBuiltAt: nowIso(),
        },
      },
    };
  }

  if (input.guardEnabled) await input.guardEnabled();

  return {
    status: "simulated",
    signature: null,
    usedQuote,
    refreshed: false,
    lastValidBlockHeight: null,
    executionMeta: {
      route: "mango",
      classification: "simulated",
      intentId: preview.market.instrumentId,
      venueSessionId: `mango:${preview.account.accountRef}`,
      lifecycle,
      referencePrice: {
        verdict: "allow",
        reason: null,
        executionPrice:
          preview.market.referencePriceQuote === null
            ? null
            : String(preview.market.referencePriceQuote),
        executionDivergenceBps: null,
        snapshot: referenceSnapshot,
      },
      trace: {
        txBuiltAt: nowIso(),
        simulatedAt: nowIso(),
      },
    },
  };
}
