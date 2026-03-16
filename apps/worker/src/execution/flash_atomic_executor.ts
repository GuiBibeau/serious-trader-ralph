import { buildFlashAtomicPlan } from "../flash_liquidity";
import { signTransactionWithPrivyById } from "../privy";
import { evaluateSafeLaneTransaction } from "./safe_lane_policy";
import type {
  ExecuteIntentInput,
  ExecuteSwapResult,
  NonSwapExecutionIntent,
} from "./types";

type ExecuteFlashAtomicIntentInput = ExecuteIntentInput & {
  intent: NonSwapExecutionIntent;
};

type FlashLiquidityLiveModule = typeof import("../flash_liquidity_live");
type ResolveFlashLiquidityLiveAccount =
  FlashLiquidityLiveModule["resolveFlashLiquidityLiveAccount"];
type BuildFlashLiquidityLiveTransactionPlan =
  FlashLiquidityLiveModule["buildFlashLiquidityLiveTransactionPlan"];
type ReadFlashLiquidityLiveAccountState =
  FlashLiquidityLiveModule["readFlashLiquidityLiveAccountState"];

type FlashAtomicExecutorDeps = {
  resolveFlashLiquidityLiveAccount?: ResolveFlashLiquidityLiveAccount;
  buildFlashLiquidityLiveTransactionPlan?: BuildFlashLiquidityLiveTransactionPlan;
  readFlashLiquidityLiveAccountState?: ReadFlashLiquidityLiveAccountState;
  signTransactionWithPrivyById?: typeof signTransactionWithPrivyById;
  evaluateSafeLaneTransaction?: typeof evaluateSafeLaneTransaction;
};

let flashLiquidityLiveModulePromise: Promise<FlashLiquidityLiveModule> | null =
  null;

async function loadFlashLiquidityLiveModule(): Promise<FlashLiquidityLiveModule> {
  flashLiquidityLiveModulePromise ??= import("../flash_liquidity_live");
  return await flashLiquidityLiveModulePromise;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isSafeLaneExecution(input: ExecuteFlashAtomicIntentInput): boolean {
  const lane = String(input.execution?.params?.lane ?? "")
    .trim()
    .toLowerCase();
  return lane === "safe";
}

function allowsVenueTxSmokeLiveBypass(
  input: ExecuteFlashAtomicIntentInput,
): boolean {
  return (
    input.runtimeMode === "live" &&
    input.experimentalLiveModeBypass === "venue_tx_smoke" &&
    input.subjectControlBypassReason === "strategy_lab_readiness_canary"
  );
}

function normalizeConfirmationStatus(
  status: string | undefined,
): Extract<
  ExecuteSwapResult["status"],
  "processed" | "confirmed" | "finalized" | "error"
> {
  if (
    status === "processed" ||
    status === "confirmed" ||
    status === "finalized"
  ) {
    return status;
  }
  return "error";
}

function sanitizePlanNotes(notes: string[]): string[] {
  return notes.filter(
    (note) =>
      note !== "flash-liquidity-live-blocked" &&
      note !== "paper-only-flash-liquidity-preview",
  );
}

async function submitPrivyManagedTransactionPlan(input: {
  env: ExecuteFlashAtomicIntentInput["env"];
  rpc: ExecuteFlashAtomicIntentInput["rpc"];
  walletId: string;
  unsignedTransactionBase64: string;
  txBuiltAt: string;
  lastValidBlockHeight: number | null;
  route: string;
  intentId: string;
  venueSessionId: string;
  lifecycle: NonNullable<ExecuteSwapResult["executionMeta"]>["lifecycle"];
  signTransactionWithPrivyById: typeof signTransactionWithPrivyById;
  evaluateSafeLaneTransaction: typeof evaluateSafeLaneTransaction;
  requireSafeLaneEvaluation: boolean;
}): Promise<
  | {
      ok: true;
      status: Extract<
        ExecuteSwapResult["status"],
        "processed" | "confirmed" | "finalized"
      >;
      signature: string;
      simulationUnitsConsumed: number | null;
    }
  | {
      ok: false;
      result: ExecuteSwapResult;
    }
> {
  const signedBase64 = await input.signTransactionWithPrivyById(
    input.env,
    input.walletId,
    input.unsignedTransactionBase64,
  );
  if (input.requireSafeLaneEvaluation) {
    const safeEvaluation = input.evaluateSafeLaneTransaction({
      env: input.env,
      signedTransactionBase64: signedBase64,
    });
    if (!safeEvaluation.ok) {
      return {
        ok: false,
        result: {
          status: "simulate_error",
          signature: null,
          usedQuote: {
            inputMint: "11111111111111111111111111111111",
            outputMint: "11111111111111111111111111111111",
            inAmount: "0",
            outAmount: "0",
            priceImpactPct: 0,
            routePlan: [],
          },
          refreshed: false,
          lastValidBlockHeight: input.lastValidBlockHeight,
          err: {
            code: "policy-denied",
            reason: safeEvaluation.reason,
            profile: safeEvaluation.profile,
            limits: safeEvaluation.limits,
          },
          executionMeta: {
            route: input.route,
            classification: "error",
            intentId: input.intentId,
            venueSessionId: input.venueSessionId,
            lifecycle: {
              orderState: "rejected",
              fillState: "failed",
              settlementState: "failed",
              notes: [safeEvaluation.reason],
            },
            trace: {
              txBuiltAt: input.txBuiltAt,
              failedAt: nowIso(),
            },
          },
        },
      };
    }
  }

  const simulation = await input.rpc.simulateTransactionBase64(signedBase64, {
    commitment: "confirmed",
    sigVerify: true,
  });
  if (simulation.err) {
    return {
      ok: false,
      result: {
        status: "simulate_error",
        signature: null,
        usedQuote: {
          inputMint: "11111111111111111111111111111111",
          outputMint: "11111111111111111111111111111111",
          inAmount: "0",
          outAmount: "0",
          priceImpactPct: 0,
          routePlan: [],
        },
        refreshed: false,
        lastValidBlockHeight: input.lastValidBlockHeight,
        err: simulation.err,
        executionMeta: {
          route: input.route,
          classification: "error",
          intentId: input.intentId,
          venueSessionId: input.venueSessionId,
          lifecycle: input.lifecycle,
          trace: {
            txBuiltAt: input.txBuiltAt,
            simulatedAt: nowIso(),
            failedAt: nowIso(),
          },
        },
      },
    };
  }

  const signature = await input.rpc.sendTransactionBase64(signedBase64, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const confirmation = await input.rpc.confirmSignature(signature, {
    commitment: "finalized",
  });
  if (!confirmation.ok) {
    return {
      ok: false,
      result: {
        status: "error",
        signature,
        usedQuote: {
          inputMint: "11111111111111111111111111111111",
          outputMint: "11111111111111111111111111111111",
          inAmount: "0",
          outAmount: "0",
          priceImpactPct: 0,
          routePlan: [],
        },
        refreshed: false,
        lastValidBlockHeight: input.lastValidBlockHeight,
        err: confirmation.err,
        executionMeta: {
          route: input.route,
          classification: "error",
          intentId: input.intentId,
          venueSessionId: input.venueSessionId,
          lifecycle: {
            ...input.lifecycle,
            settlementState: "failed",
          },
          trace: {
            txBuiltAt: input.txBuiltAt,
            simulatedAt: nowIso(),
            sentAt: nowIso(),
            failedAt: nowIso(),
          },
        },
      },
    };
  }

  return {
    ok: true,
    status: normalizeConfirmationStatus(confirmation.status),
    signature,
    simulationUnitsConsumed: simulation.unitsConsumed ?? null,
  };
}

export async function executeFlashAtomicIntent(
  input: ExecuteFlashAtomicIntentInput,
  deps: FlashAtomicExecutorDeps = {},
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
  const allowLiveSmoke = allowsVenueTxSmokeLiveBypass(input);
  if (input.runtimeMode === "live" && !allowLiveSmoke) {
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
  const baseLifecycleNotes = sanitizePlanNotes(plan.notes);
  const route = "flash_liquidity";
  const intentId = plan.referenceId;
  const venueSessionId = `flash:${plan.referenceId}`;

  if (input.policy.dryRun) {
    return {
      status: "dry_run",
      signature: null,
      usedQuote: plan.syntheticQuote,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route,
        classification: "dry_run",
        intentId,
        venueSessionId,
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

  if (input.runtimeMode !== "live") {
    return {
      status: "simulated",
      signature: null,
      usedQuote: plan.syntheticQuote,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route,
        classification: "simulated",
        intentId,
        venueSessionId,
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

  if (!input.privyWalletId) {
    throw new Error("missing-privy-wallet-id");
  }

  const flashLiquidityLiveModule =
    deps.resolveFlashLiquidityLiveAccount &&
    deps.buildFlashLiquidityLiveTransactionPlan &&
    deps.readFlashLiquidityLiveAccountState
      ? null
      : await loadFlashLiquidityLiveModule();
  const resolveLiveAccount =
    deps.resolveFlashLiquidityLiveAccount ??
    flashLiquidityLiveModule?.resolveFlashLiquidityLiveAccount;
  const buildLivePlan =
    deps.buildFlashLiquidityLiveTransactionPlan ??
    flashLiquidityLiveModule?.buildFlashLiquidityLiveTransactionPlan;
  const readLiveAccountState =
    deps.readFlashLiquidityLiveAccountState ??
    flashLiquidityLiveModule?.readFlashLiquidityLiveAccountState;
  if (!resolveLiveAccount || !buildLivePlan || !readLiveAccountState) {
    throw new Error("flash-liquidity-live-module-unavailable");
  }

  const signWithPrivy =
    deps.signTransactionWithPrivyById ?? signTransactionWithPrivyById;
  const evaluateSafeLane =
    deps.evaluateSafeLaneTransaction ?? evaluateSafeLaneTransaction;

  const accountResolution = await resolveLiveAccount({
    env: input.env,
    walletPublicKey: input.intent.wallet,
    intent: input.intent,
  });
  const marginfiAccountAddress = accountResolution.marginfiAccountAddress;
  let setupSignature: string | null = null;
  if (accountResolution.setup) {
    const setupSubmit = await submitPrivyManagedTransactionPlan({
      env: input.env,
      rpc: input.rpc,
      walletId: input.privyWalletId,
      unsignedTransactionBase64:
        accountResolution.setup.unsignedTransactionBase64,
      txBuiltAt,
      lastValidBlockHeight: accountResolution.setup.lastValidBlockHeight,
      route,
      intentId: `${intentId}:marginfi_setup`,
      venueSessionId: marginfiAccountAddress,
      lifecycle: {
        orderState: "accepted",
        fillState: "pending",
        settlementState: "pending",
        notes: ["flash-liquidity-live-marginfi-account-setup"],
      },
      signTransactionWithPrivyById: signWithPrivy,
      evaluateSafeLaneTransaction: evaluateSafeLane,
      requireSafeLaneEvaluation: isSafeLaneExecution(input),
    });
    if (!setupSubmit.ok) {
      return {
        ...setupSubmit.result,
        usedQuote: plan.syntheticQuote,
      };
    }
    setupSignature = setupSubmit.signature;
  }

  const livePlan = await buildLivePlan({
    env: input.env,
    walletPublicKey: input.intent.wallet,
    marginfiAccountAddress,
    intent: input.intent,
  });
  const liveSubmit = await submitPrivyManagedTransactionPlan({
    env: input.env,
    rpc: input.rpc,
    walletId: input.privyWalletId,
    unsignedTransactionBase64: livePlan.unsignedTransactionBase64,
    txBuiltAt,
    lastValidBlockHeight: livePlan.lastValidBlockHeight,
    route,
    intentId,
    venueSessionId: marginfiAccountAddress,
    lifecycle: {
      orderState: "accepted",
      fillState: "filled",
      settlementState: "confirmed",
      notes: [
        ...baseLifecycleNotes,
        "flash-liquidity-live-marginfi-smoke",
        `marginfi-account:${marginfiAccountAddress}`,
        `bank:${livePlan.bankAddress}`,
      ],
    },
    signTransactionWithPrivyById: signWithPrivy,
    evaluateSafeLaneTransaction: evaluateSafeLane,
    requireSafeLaneEvaluation: isSafeLaneExecution(input),
  });
  if (!liveSubmit.ok) {
    return {
      ...liveSubmit.result,
      usedQuote: plan.syntheticQuote,
    };
  }

  const accountState = await readLiveAccountState({
    env: input.env,
    bankMint: livePlan.bankMint,
    walletPublicKey: input.intent.wallet,
    marginfiAccountAddress,
  });
  const finalStatus =
    liveSubmit.status === "finalized"
      ? "finalized"
      : liveSubmit.status === "confirmed"
        ? "confirmed"
        : "processed";
  const classification =
    finalStatus === "finalized"
      ? "finalized"
      : finalStatus === "confirmed"
        ? "confirmed"
        : "submitted";

  return {
    status: finalStatus,
    signature: liveSubmit.signature,
    usedQuote: plan.syntheticQuote,
    refreshed: false,
    lastValidBlockHeight: livePlan.lastValidBlockHeight,
    executionMeta: {
      route,
      classification,
      intentId,
      venueSessionId: marginfiAccountAddress,
      lifecycle: {
        orderState: accountState.activeBalanceCount < 1 ? "filled" : "open",
        fillState: "filled",
        settlementState:
          finalStatus === "finalized" ? "finalized" : "confirmed",
        notes: [
          ...baseLifecycleNotes,
          "flash-liquidity-live-marginfi-smoke",
          `marginfi-account:${marginfiAccountAddress}`,
          `bank:${livePlan.bankAddress}`,
          ...(setupSignature
            ? [`setup-signature:${setupSignature}`]
            : ["setup-signature:none"]),
          `active-balances:${accountState.activeBalanceCount}`,
        ],
      },
      referencePrice: {
        verdict: "allow",
        reason: null,
        executionPrice: null,
        executionDivergenceBps: null,
        snapshot: {
          ...referenceSnapshot,
          liveProvider: livePlan.provider,
          liveBankAddress: livePlan.bankAddress,
          liveBankMint: livePlan.bankMint,
          liveTokenSymbol: livePlan.tokenSymbol,
          marginfiAccountAddress,
          activeBalanceCount: accountState.activeBalanceCount,
          activeBankAddresses: accountState.activeBankAddresses,
        },
      },
      composedPlan: {
        mode: "flash_atomic",
        ...plan.instructionSummary,
        simulationUnitsConsumed: liveSubmit.simulationUnitsConsumed,
        addressLookupTableCount: livePlan.addressLookupTableAddresses.length,
        addressLookupTableAddresses: livePlan.addressLookupTableAddresses,
      },
      trace: {
        txBuiltAt,
        ...(setupSignature ? { simulatedAt: nowIso() } : {}),
        sentAt: nowIso(),
        ...(finalStatus === "processed" ? {} : { confirmedAt: nowIso() }),
        ...(finalStatus === "finalized" ? { finalizedAt: nowIso() } : {}),
      },
    },
  };
}
