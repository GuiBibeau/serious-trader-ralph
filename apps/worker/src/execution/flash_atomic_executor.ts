import { buildFlashAtomicPlan } from "../flash_liquidity";
import type {
  ExecuteIntentInput,
  ExecuteSwapResult,
  NonSwapExecutionIntent,
} from "./types";

type ExecuteFlashAtomicIntentInput = ExecuteIntentInput & {
  intent: NonSwapExecutionIntent;
};

function nowIso(): string {
  return new Date().toISOString();
}

export async function executeFlashAtomicIntent(
  input: ExecuteFlashAtomicIntentInput,
): Promise<ExecuteSwapResult> {
  if (input.intent.family !== "flash_atomic") {
    throw new Error("invalid-flash-atomic-intent-family");
  }
  if (input.intent.venueKey !== "flash_liquidity") {
    throw new Error("invalid-flash-liquidity-venue");
  }
  if (input.intent.marketType !== "spot") {
    throw new Error("invalid-flash-liquidity-market-type");
  }
  if (input.runtimeMode === "live") {
    throw new Error("flash-liquidity-live-mode-not-supported");
  }

  const plan = buildFlashAtomicPlan({
    intent: input.intent,
    execution: input.execution,
    env: input.env,
  });
  const txBuiltAt = nowIso();
  const lifecycle = {
    orderState: "accepted" as const,
    fillState: "filled" as const,
    settlementState: input.policy.dryRun
      ? ("pending" as const)
      : ("confirmed" as const),
    notes: plan.notes,
  };
  const referenceSnapshot = {
    referenceId: plan.referenceId,
    settlementMint: plan.settlementMint,
    borrowLegCount: plan.borrowLegs.length,
    providerCount: plan.providerPreviews.length,
    providers: plan.providerPreviews.map((preview) => ({
      provider: preview.provider,
      estimatedFeeBps: preview.estimatedFeeBps,
      borrowLegCount: preview.borrowLegCount,
    })),
    feeByMint: plan.flashEstimatedFeeByMint,
  };

  if (input.policy.dryRun) {
    return {
      status: "dry_run",
      signature: null,
      usedQuote: plan.syntheticQuote,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route: "flash_liquidity",
        classification: "dry_run",
        intentId: plan.referenceId,
        venueSessionId: `flash:${plan.referenceId}`,
        lifecycle,
        referencePrice: {
          verdict: "allow",
          reason: null,
          executionPrice: null,
          executionDivergenceBps: null,
          snapshot: referenceSnapshot,
        },
        composedPlan: {
          mode: "flash_atomic",
          ...plan.instructionSummary,
          simulationUnitsConsumed: null,
        },
        trace: {
          txBuiltAt,
        },
      },
    };
  }

  if (input.guardEnabled) {
    await input.guardEnabled();
  }

  return {
    status: "simulated",
    signature: null,
    usedQuote: plan.syntheticQuote,
    refreshed: false,
    lastValidBlockHeight: null,
    executionMeta: {
      route: "flash_liquidity",
      classification: "simulated",
      intentId: plan.referenceId,
      venueSessionId: `flash:${plan.referenceId}`,
      lifecycle,
      referencePrice: {
        verdict: "allow",
        reason: null,
        executionPrice: null,
        executionDivergenceBps: null,
        snapshot: referenceSnapshot,
      },
      composedPlan: {
        mode: "flash_atomic",
        ...plan.instructionSummary,
        simulationUnitsConsumed: null,
      },
      trace: {
        txBuiltAt,
        simulatedAt: nowIso(),
      },
    },
  };
}
