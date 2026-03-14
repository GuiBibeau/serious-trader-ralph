import { DFlowClient } from "../dflow";
import type {
  ExecuteIntentInput,
  ExecuteSwapResult,
  NonSwapExecutionIntent,
} from "./types";

type ExecuteDFlowPredictionOrderInput = ExecuteIntentInput & {
  intent: NonSwapExecutionIntent;
};

function nowIso(): string {
  return new Date().toISOString();
}

function buildLifecycle(input: {
  side: string;
  notes: string[];
}): NonNullable<ExecuteSwapResult["executionMeta"]>["lifecycle"] {
  const closing = input.side === "sell_yes" || input.side === "sell_no";
  return {
    orderState: "open",
    fillState: "pending",
    positionState: closing ? "closing" : "opening",
    settlementState: "pending",
    notes: input.notes,
  };
}

function readDFlowOptions(
  intent: NonSwapExecutionIntent,
): Record<string, unknown> | null {
  const params = intent.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  return params;
}

export async function executeDFlowPredictionOrder(
  input: ExecuteDFlowPredictionOrderInput,
): Promise<ExecuteSwapResult> {
  if (input.intent.family !== "prediction_order") {
    throw new Error("invalid-dflow-intent-family");
  }
  if (input.intent.venueKey !== "dflow") {
    throw new Error("invalid-dflow-venue");
  }
  if (input.intent.marketType !== "prediction") {
    throw new Error("invalid-dflow-market-type");
  }
  if (input.runtimeMode === "live") {
    throw new Error("dflow-live-mode-not-supported");
  }
  const side = String(input.intent.side ?? "").trim();
  if (
    side !== "buy_yes" &&
    side !== "buy_no" &&
    side !== "sell_yes" &&
    side !== "sell_no"
  ) {
    throw new Error("invalid-dflow-side");
  }
  const outcomeId = String(input.intent.outcomeId ?? "").trim();
  if (!outcomeId) {
    throw new Error("dflow-outcome-id-required");
  }

  const dflow = input.dflow ?? new DFlowClient(input.env);
  const preview = await dflow.describePredictionIntent({
    instrumentId: input.intent.instrumentId,
    outcomeId,
    side,
    quantityAtomic: String(input.intent.quantityAtomic ?? ""),
    options: readDFlowOptions(input.intent),
  });
  const lifecycle = buildLifecycle({
    side,
    notes: preview.notes,
  });
  const usedQuote = dflow.buildSyntheticQuote(preview);
  const referenceSnapshot = {
    marketId: preview.market.marketId,
    title: preview.market.title,
    eventTitle: preview.market.eventTitle,
    marketStatus: preview.market.status,
    endTime: preview.market.endTime,
    settleTime: preview.market.settleTime,
    outcomeSide: preview.outcomeSide,
    outcomeMint: preview.outcomeMint,
    settlementMint: preview.settlementMint,
    priceQuote: preview.priceQuote,
    estimatedNotionalUsd: preview.estimatedNotionalUsd,
    openInterest: preview.marketAccount.openInterest,
    volume: preview.marketAccount.volume,
    redemptionStatus: preview.marketAccount.redemptionStatus,
    liveReady: preview.liveReady,
    orderType: preview.orderType,
    timeInForce: preview.timeInForce,
    quantityMode: preview.quantityMode,
  };

  if (input.policy.dryRun) {
    return {
      status: "dry_run",
      signature: null,
      usedQuote,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route: "dflow",
        classification: "dry_run",
        intentId: preview.market.marketId,
        venueSessionId: `prediction:${preview.market.marketId}:${preview.outcomeSide}`,
        lifecycle,
        referencePrice: {
          verdict: "allow",
          reason: null,
          executionPrice:
            preview.priceQuote === null ? null : String(preview.priceQuote),
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
      route: "dflow",
      classification: "simulated",
      intentId: preview.market.marketId,
      venueSessionId: `prediction:${preview.market.marketId}:${preview.outcomeSide}`,
      lifecycle,
      referencePrice: {
        verdict: "allow",
        reason: null,
        executionPrice:
          preview.priceQuote === null ? null : String(preview.priceQuote),
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
