import { DriftClient, type DriftOrderOptions } from "../drift";
import type {
  ExecuteIntentInput,
  ExecuteSwapResult,
  NonSwapExecutionIntent,
} from "./types";

type ExecuteDriftPerpOrderInput = ExecuteIntentInput & {
  intent: NonSwapExecutionIntent;
};

function nowIso(): string {
  return new Date().toISOString();
}

function buildLifecycle(input: {
  side: string;
  note: string;
}): NonNullable<ExecuteSwapResult["executionMeta"]>["lifecycle"] {
  const closing = input.side === "close_long" || input.side === "close_short";
  return {
    orderState: "open",
    fillState: "pending",
    positionState: closing ? "closing" : "opening",
    settlementState: "confirmed",
    notes: [input.note],
  };
}

function readDriftOptions(
  intent: NonSwapExecutionIntent,
): DriftOrderOptions | null {
  const params = intent.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  return params as DriftOrderOptions;
}

export async function executeDriftPerpOrder(
  input: ExecuteDriftPerpOrderInput,
): Promise<ExecuteSwapResult> {
  if (input.intent.family !== "perp_order") {
    throw new Error("invalid-drift-intent-family");
  }
  if (input.intent.venueKey !== "drift") {
    throw new Error("invalid-drift-venue");
  }
  if (input.intent.marketType !== "perp") {
    throw new Error("invalid-drift-market-type");
  }
  if (
    input.intent.side !== "long" &&
    input.intent.side !== "short" &&
    input.intent.side !== "close_long" &&
    input.intent.side !== "close_short"
  ) {
    throw new Error("invalid-drift-side");
  }
  if (input.runtimeMode === "live") {
    throw new Error("drift-live-mode-not-supported");
  }

  const route =
    String(input.execution?.adapter ?? "").trim() === "drift_swift"
      ? "drift_swift"
      : "drift";
  const drift = input.drift ?? new DriftClient(input.env);
  if (route === "drift_swift" && !drift.swiftConfigured()) {
    throw new Error("drift-swift-api-base-missing");
  }

  const preview = await drift.describePerpIntent({
    instrumentId: input.intent.instrumentId,
    side: input.intent.side,
    quantityAtomic: String(input.intent.quantityAtomic ?? ""),
    collateralAtomic: input.intent.collateralAtomic ?? null,
    options: readDriftOptions(input.intent),
    executionAdapter: route,
  });
  const lifecycle = buildLifecycle({
    side: input.intent.side,
    note: `${route}:${preview.orderType}:${preview.timeInForce}`,
  });
  const usedQuote = drift.buildSyntheticQuote(preview);

  if (input.policy.dryRun) {
    return {
      status: "dry_run",
      signature: null,
      usedQuote,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route,
        classification: "dry_run",
        intentId: preview.instrument.marketName,
        venueSessionId:
          preview.instrument.marketIndex === null
            ? null
            : `perp_market:${preview.instrument.marketIndex}`,
        lifecycle,
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
      route,
      classification: "simulated",
      intentId: preview.instrument.marketName,
      venueSessionId:
        preview.instrument.marketIndex === null
          ? null
          : `perp_market:${preview.instrument.marketIndex}`,
      lifecycle,
      referencePrice: {
        verdict: "allow",
        reason: null,
        executionPrice:
          preview.funding?.markPrice === null
            ? null
            : String(preview.funding.markPrice),
        executionDivergenceBps: null,
        snapshot: {
          marketName: preview.instrument.marketName,
          marketIndex: preview.instrument.marketIndex,
          oracle: preview.instrument.oracle,
          oracleSource: preview.instrument.oracleSource,
          initialMarginRatio: preview.instrument.initialMarginRatio,
          maintenanceMarginRatio: preview.instrument.maintenanceMarginRatio,
          fundingRate1hBps: preview.funding?.fundingRate1hBps ?? null,
          oraclePrice: preview.funding?.oraclePrice ?? null,
          markPrice: preview.funding?.markPrice ?? null,
          reduceOnly: preview.reduceOnly,
          swiftSupported: preview.swiftSupported,
        },
      },
      trace: {
        txBuiltAt: nowIso(),
        simulatedAt: nowIso(),
      },
    },
  };
}
