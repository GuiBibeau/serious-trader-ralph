import { SOL_MINT, SUPPORTED_TRADING_MINTS, USDC_MINT } from "./defaults";
import { normalizeExecutionErrorCode } from "./execution/error_taxonomy";
import { resolveExecutionLane } from "./execution/lane_resolver";
import { evaluatePrivyRuntimeBalancePolicy } from "./execution/policy_engine";
import {
  createExecutionAttemptIdempotent,
  createExecutionRequestIdempotent,
  finalizeExecutionAttempt,
  type JsonObject,
  terminalizeExecutionRequest,
  updateExecutionRequestStatus,
  upsertExecutionReceiptIdempotent,
} from "./execution/repository";
import { executeSwapViaRouter } from "./execution/router";
import { JupiterClient, type JupiterQuoteResponse } from "./jupiter";
import {
  executionLaneRuntimeControlsFromSnapshot,
  readOpsControlSnapshot,
} from "./ops_controls";
import { enforcePolicy, normalizePolicy } from "./policy";
import { createPrivySolanaWallet } from "./privy";
import {
  parseRuntimeExecutionPlan,
  type RuntimeExecutionPlan,
} from "./runtime_contracts";
import { SolanaRpc } from "./solana_rpc";
import type { Env } from "./types";
import { findUserById, setUserWallet } from "./users_db";

const USDC_DECIMALS = 6;
const SOL_DECIMALS = 9;
const MANAGED_EXECUTION_SOURCE = "worker-runtime-managed";

export type RuntimeManagedExecutionPlanResponse = {
  ok: true;
  accepted: true;
  source: string;
  submitRequestId: string;
  coordination: {
    planId: string;
    deploymentId: string;
    runId: string;
    mode: string;
    lane: string;
    sliceCount: number;
  };
  receipt?: {
    receiptId: string;
    observedAt: string;
    status: string;
    notes: string[];
    signature: string | null;
    provider: string | null;
  };
  observedLedger?: JsonObject;
};

type ManagedWallet = {
  userId: string;
  walletId: string;
  walletAddress: string;
};

type ManagedBalanceSnapshot = {
  solLamports: bigint;
  usdcAtomic: bigint;
};

function readManagedDeploymentAllowlist(env: Env): Set<string> {
  return new Set(
    String(env.RUNTIME_MANAGED_LIVE_DEPLOYMENT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function newExecutionAttemptId(): string {
  return `execattempt_${crypto.randomUUID().replace(/-/g, "")}`;
}

function newExecutionReceiptId(): string {
  return `execrcpt_${crypto.randomUUID().replace(/-/g, "")}`;
}

function newExecRequestId(): string {
  return `execreq_${crypto.randomUUID().replace(/-/g, "")}`;
}

function executionErrorMessage(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Error) return value.message.slice(0, 2_000);
  const text = String(value).trim();
  return text ? text.slice(0, 2_000) : null;
}

function policyDeniedReason(value: unknown): string | null {
  if (value instanceof Error && value.message.startsWith("policy-denied:")) {
    return value.message.slice("policy-denied:".length) || "policy-denied";
  }
  const text = typeof value === "string" ? value : "";
  if (text.startsWith("policy-denied:")) {
    return text.slice("policy-denied:".length) || "policy-denied";
  }
  return null;
}

function executionFailureFromResult(
  status: string,
  error: unknown,
): {
  terminalStatus: "failed" | "rejected";
  errorCode: string;
  statusReason: string;
} | null {
  if (status === "finalized" || status === "landed") return null;
  const deniedReason = policyDeniedReason(error);
  if (deniedReason) {
    return {
      terminalStatus: "rejected",
      errorCode: "policy-denied",
      statusReason: `policy-denied:${deniedReason}`,
    };
  }
  const errorCode = normalizeExecutionErrorCode({
    error,
    fallback: "submission-failed",
  });
  return {
    terminalStatus: "failed",
    errorCode,
    statusReason: errorCode,
  };
}

function atomicToNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

function parseUsdAtomic(value: unknown): bigint {
  const raw = String(value ?? "").trim();
  if (!raw) return 0n;
  const match = raw.match(/^([0-9]+)(?:\.([0-9]{1,6}))?$/);
  if (!match) return 0n;
  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "")
    .padEnd(USDC_DECIMALS, "0")
    .slice(0, USDC_DECIMALS);
  return whole * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction || "0");
}

function formatUsdNumber(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
  return normalized.toFixed(2);
}

function deriveSolPriceUsd(
  quoteResponse: JupiterQuoteResponse,
  inputMint: string,
  outputMint: string,
): number {
  const inAmount = BigInt(String(quoteResponse.inAmount ?? "0") || "0");
  const outAmount = BigInt(String(quoteResponse.outAmount ?? "0") || "0");
  if (inAmount <= 0n || outAmount <= 0n) return 0;
  if (inputMint === USDC_MINT && outputMint === SOL_MINT) {
    return (
      atomicToNumber(inAmount, USDC_DECIMALS) /
      atomicToNumber(outAmount, SOL_DECIMALS)
    );
  }
  if (inputMint === SOL_MINT && outputMint === USDC_MINT) {
    return (
      atomicToNumber(outAmount, USDC_DECIMALS) /
      atomicToNumber(inAmount, SOL_DECIMALS)
    );
  }
  return 0;
}

async function ensureManagedWallet(
  env: Env,
  userId: string,
): Promise<ManagedWallet> {
  const user = await findUserById(env, userId);
  if (!user) {
    throw new Error("runtime-managed-user-not-found");
  }
  if (user.walletAddress && user.privyWalletId) {
    return {
      userId: user.id,
      walletId: user.privyWalletId,
      walletAddress: user.walletAddress,
    };
  }
  const wallet = await createPrivySolanaWallet(env);
  const walletMigratedAt = new Date().toISOString();
  await setUserWallet(env, {
    userId: user.id,
    signerType: "privy",
    privyWalletId: wallet.walletId,
    walletAddress: wallet.address,
    walletMigratedAt,
  });
  return {
    userId: user.id,
    walletId: wallet.walletId,
    walletAddress: wallet.address,
  };
}

async function readManagedBalances(
  rpc: SolanaRpc,
  walletAddress: string,
): Promise<ManagedBalanceSnapshot> {
  const [solLamports, usdcAtomic] = await Promise.all([
    rpc.getBalanceLamports(walletAddress),
    rpc.getTokenBalanceAtomic(walletAddress, USDC_MINT),
  ]);
  return { solLamports, usdcAtomic };
}

function buildObservedLedgerSnapshot(input: {
  plan: RuntimeExecutionPlan;
  wallet: ManagedWallet;
  quoteResponse: JupiterQuoteResponse;
  balances: ManagedBalanceSnapshot;
}): JsonObject {
  const slice = input.plan.slices[0];
  const solPriceUsd = deriveSolPriceUsd(
    input.quoteResponse,
    slice.inputMint,
    slice.outputMint,
  );
  const usdcBalance = atomicToNumber(input.balances.usdcAtomic, USDC_DECIMALS);
  const solBalance = atomicToNumber(input.balances.solLamports, SOL_DECIMALS);
  const equityUsd = usdcBalance + solBalance * solPriceUsd;
  const reservedUsd = Math.min(
    Number(slice.notionalUsd),
    Number.isFinite(equityUsd) ? equityUsd : 0,
  );
  const reservedUsdcAtomic = parseUsdAtomic(formatUsdNumber(reservedUsd));
  const usdcReservedAtomic =
    input.balances.usdcAtomic > reservedUsdcAtomic
      ? reservedUsdcAtomic
      : input.balances.usdcAtomic;
  const usdcFreeAtomic = input.balances.usdcAtomic - usdcReservedAtomic;

  return {
    schemaVersion: "v1",
    snapshotId: `runtime_managed_${crypto.randomUUID().replace(/-/g, "")}`,
    deploymentId: input.plan.deploymentId,
    sleeveId: input.plan.sleeveId ?? input.plan.deploymentId,
    asOf: new Date().toISOString(),
    balances: [
      {
        mint: USDC_MINT,
        symbol: "USDC",
        decimals: USDC_DECIMALS,
        freeAtomic: usdcFreeAtomic.toString(),
        reservedAtomic: usdcReservedAtomic.toString(),
        priceUsd: "1.00",
      },
      {
        mint: SOL_MINT,
        symbol: "SOL",
        decimals: SOL_DECIMALS,
        freeAtomic: input.balances.solLamports.toString(),
        reservedAtomic: "0",
        priceUsd: formatUsdNumber(solPriceUsd || 0),
      },
    ],
    positions:
      input.balances.solLamports > 0n
        ? [
            {
              instrumentId: "SOL/USDC",
              side: "long",
              quantityAtomic: input.balances.solLamports.toString(),
              entryPriceUsd: formatUsdNumber(solPriceUsd || 0),
              markPriceUsd: formatUsdNumber(solPriceUsd || 0),
              unrealizedPnlUsd: "0.00",
            },
          ]
        : [],
    totals: {
      equityUsd: formatUsdNumber(equityUsd),
      reservedUsd: formatUsdNumber(reservedUsd),
      availableUsd: formatUsdNumber(Math.max(equityUsd - reservedUsd, 0)),
      realizedPnlUsd: "0.00",
      unrealizedPnlUsd: "0.00",
    },
    wallet: {
      walletId: input.wallet.walletId,
      walletAddress: input.wallet.walletAddress,
    },
    ownerUserId: input.wallet.userId,
  };
}

function syntheticAcceptedResponse(
  plan: RuntimeExecutionPlan,
  note: string,
): RuntimeManagedExecutionPlanResponse {
  const now = new Date().toISOString();
  return {
    ok: true,
    accepted: true,
    source: MANAGED_EXECUTION_SOURCE,
    submitRequestId: `runtime_${plan.planId}`,
    coordination: {
      planId: plan.planId,
      deploymentId: plan.deploymentId,
      runId: plan.runId,
      mode: plan.mode,
      lane: plan.lane,
      sliceCount: plan.slices.length,
    },
    receipt: {
      receiptId: `runtime_receipt_${plan.planId}`,
      observedAt: now,
      status: "accepted",
      notes: [note],
      signature: null,
      provider: MANAGED_EXECUTION_SOURCE,
    },
  };
}

export async function submitManagedRuntimeExecutionPlan(input: {
  env: Env;
  plan: RuntimeExecutionPlan;
}): Promise<RuntimeManagedExecutionPlanResponse> {
  const { env } = input;
  const plan = parseRuntimeExecutionPlan(input.plan);

  if (plan.mode !== "live") {
    return syntheticAcceptedResponse(
      plan,
      `synthetic ${plan.mode} coordination accepted`,
    );
  }
  if (plan.lane !== "safe") {
    throw new Error("runtime-execution-plan-safe-lane-required");
  }
  if (plan.slices.length !== 1) {
    throw new Error("runtime-execution-plan-single-slice-required");
  }
  if (!plan.ownerUserId) {
    throw new Error("runtime-managed-owner-user-missing");
  }
  if (!readManagedDeploymentAllowlist(env).has(plan.deploymentId)) {
    throw new Error("runtime-managed-live-not-allowed");
  }

  const opsControls = await readOpsControlSnapshot(env);
  if (!opsControls.runtime.enabled) {
    throw new Error(
      opsControls.runtime.disabledReason ?? "runtime-disabled-by-operator",
    );
  }
  if (opsControls.runtime.shadowOnly) {
    throw new Error(
      opsControls.runtime.shadowOnlyReason ?? "runtime-shadow-only",
    );
  }

  const laneResolution = resolveExecutionLane({
    env,
    requestedLane: plan.lane,
    mode: "privy_execute",
    actorType: "privy_user",
    runtimeControls: executionLaneRuntimeControlsFromSnapshot(opsControls),
  });
  if (!laneResolution.ok) {
    throw new Error(laneResolution.reason);
  }

  const wallet = await ensureManagedWallet(env, plan.ownerUserId);
  const slice = plan.slices[0];
  const rpc = new SolanaRpc(String(env.RPC_ENDPOINT ?? "").trim());
  const jupiter = new JupiterClient(
    String(env.JUPITER_BASE_URL ?? "").trim() || "https://lite-api.jup.ag",
    env.JUPITER_API_KEY,
  );
  const quoteResponse = await jupiter.quote({
    inputMint: slice.inputMint,
    outputMint: slice.outputMint,
    amount: slice.inputAmountAtomic,
    slippageBps: slice.slippageBps,
    swapMode: "ExactIn",
  });
  const policy = normalizePolicy({
    allowedMints: SUPPORTED_TRADING_MINTS,
    slippageBps: slice.slippageBps,
    maxPriceImpactPct: 0.05,
    maxTradeAmountAtomic: slice.inputAmountAtomic,
    minSolReserveLamports: "50000000",
    simulateOnly: plan.simulateOnly,
    dryRun: plan.dryRun,
    commitment: "confirmed",
  });
  const runtimeBalancePolicy = await evaluatePrivyRuntimeBalancePolicy({
    env,
    lane: laneResolution.lane,
    walletAddress: wallet.walletAddress,
    inputMint: slice.inputMint,
    amountAtomic: slice.inputAmountAtomic,
    minSolReserveLamports: policy.minSolReserveLamports,
    rpc,
    runtimeDefaults: null,
  });
  if (!runtimeBalancePolicy.ok) {
    throw new Error(`policy-denied:${runtimeBalancePolicy.reason}`);
  }
  try {
    enforcePolicy(policy, quoteResponse);
  } catch (error) {
    throw new Error(
      `policy-denied:runtime-managed-${error instanceof Error ? error.message : "policy-violation"}`,
    );
  }

  const requestId = newExecRequestId();
  const requestReservation = await createExecutionRequestIdempotent(
    env.WAITLIST_DB,
    {
      requestId,
      idempotencyScope: `runtime:${plan.deploymentId}`,
      idempotencyKey: plan.idempotencyKey,
      payloadHash: await crypto.subtle
        .digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify({
              deploymentId: plan.deploymentId,
              planId: plan.planId,
              runId: plan.runId,
              ownerUserId: plan.ownerUserId,
              slice,
              lane: plan.lane,
            }),
          ),
        )
        .then((buffer) =>
          Array.from(new Uint8Array(buffer))
            .map((value) => value.toString(16).padStart(2, "0"))
            .join(""),
        ),
      actorType: "privy_user",
      actorId: wallet.userId,
      mode: "privy_execute",
      lane: laneResolution.lane,
      metadata: {
        source: "runtime-managed",
        deploymentId: plan.deploymentId,
        planId: plan.planId,
        runId: plan.runId,
      },
    },
  );
  const submitRequestId = requestReservation.row.requestId;
  if (requestReservation.created) {
    await updateExecutionRequestStatus(env.WAITLIST_DB, {
      requestId: submitRequestId,
      status: "validated",
      statusReason: null,
    });
  }

  const attemptId = newExecutionAttemptId();
  const attemptStartedAt = new Date().toISOString();
  const qualityMetadata = {
    lane: laneResolution.lane,
    slippageBps: slice.slippageBps,
    simulateOnly: plan.simulateOnly,
    dryRun: plan.dryRun,
  };
  let providerResponse: JsonObject | null = {
    route: laneResolution.adapter,
    lane: laneResolution.lane,
    mode: plan.mode,
    quality: qualityMetadata,
  };

  try {
    await updateExecutionRequestStatus(env.WAITLIST_DB, {
      requestId: submitRequestId,
      status: "dispatched",
      statusReason: null,
    });
    await createExecutionAttemptIdempotent(env.WAITLIST_DB, {
      attemptId,
      requestId: submitRequestId,
      attemptNo: 1,
      lane: laneResolution.lane,
      provider: laneResolution.adapter,
      status: "dispatched",
      providerResponse,
      startedAt: attemptStartedAt,
    });

    const result = await executeSwapViaRouter({
      env,
      execution: {
        adapter: laneResolution.adapter,
        params: {
          lane: laneResolution.lane,
          ...(plan.simulateOnly ? { requireSimulation: true } : {}),
        },
      },
      policy,
      rpc,
      jupiter,
      quoteResponse,
      userPublicKey: wallet.walletAddress,
      privyWalletId: wallet.walletId,
      log(level, message, meta) {
        console[level]("runtime.managed.execution", {
          deploymentId: plan.deploymentId,
          planId: plan.planId,
          runId: plan.runId,
          ownerUserId: wallet.userId,
          message,
          ...(meta ?? {}),
        });
      },
    });
    const settledAt = new Date().toISOString();
    const failure = executionFailureFromResult(result.status, result.err);
    const terminalStatus = failure ? failure.terminalStatus : "landed";
    const errorMessage = executionErrorMessage(result.err);
    providerResponse = {
      ...(providerResponse ?? {}),
      executionStatus: result.status,
      refreshed: result.refreshed,
      lastValidBlockHeight: result.lastValidBlockHeight,
      executionMeta:
        result.executionMeta &&
        typeof result.executionMeta === "object" &&
        !Array.isArray(result.executionMeta)
          ? (result.executionMeta as JsonObject)
          : null,
    };
    await finalizeExecutionAttempt(env.WAITLIST_DB, {
      attemptId,
      status: result.status,
      providerResponse,
      errorCode: failure ? failure.errorCode : null,
      errorMessage,
      completedAt: settledAt,
    });
    const receiptId = newExecutionReceiptId();
    await upsertExecutionReceiptIdempotent(env.WAITLIST_DB, {
      requestId: submitRequestId,
      receiptId,
      finalizedStatus: terminalStatus,
      lane: laneResolution.lane,
      provider: laneResolution.adapter,
      signature: result.signature,
      slot: null,
      errorCode: failure ? failure.errorCode : null,
      errorMessage,
      receipt: {
        mode: plan.mode,
        route: laneResolution.adapter,
        resultStatus: result.status,
        outcome: terminalStatus,
        quality: qualityMetadata,
        planId: plan.planId,
        runId: plan.runId,
      },
      readyAt: settledAt,
    });
    await terminalizeExecutionRequest(env.WAITLIST_DB, {
      requestId: submitRequestId,
      status: terminalStatus,
      statusReason: failure ? failure.statusReason : null,
      details: {
        provider: laneResolution.adapter,
        attempt: 1,
        ...(result.signature ? { signature: result.signature } : {}),
      },
      nowIso: settledAt,
    });

    const afterBalances = await readManagedBalances(rpc, wallet.walletAddress);
    const observedLedger = buildObservedLedgerSnapshot({
      plan,
      wallet,
      quoteResponse,
      balances: afterBalances,
    });
    return {
      ok: true,
      accepted: true,
      source: "worker",
      submitRequestId,
      coordination: {
        planId: plan.planId,
        deploymentId: plan.deploymentId,
        runId: plan.runId,
        mode: plan.mode,
        lane: plan.lane,
        sliceCount: plan.slices.length,
      },
      receipt: {
        receiptId,
        observedAt: settledAt,
        status: terminalStatus,
        notes: failure
          ? [failure.statusReason]
          : ["managed runtime execution accepted"],
        signature: result.signature,
        provider: laneResolution.adapter,
      },
      observedLedger,
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const deniedReason = policyDeniedReason(error);
    const terminalStatus = deniedReason ? "rejected" : "failed";
    const errorCode = deniedReason
      ? "policy-denied"
      : normalizeExecutionErrorCode({
          error,
          fallback: "submission-failed",
        });
    const statusReason = deniedReason
      ? `policy-denied:${deniedReason}`
      : errorCode;
    const errorMessage =
      executionErrorMessage(error) ?? "runtime-managed-submit-failed";
    await createExecutionAttemptIdempotent(env.WAITLIST_DB, {
      attemptId,
      requestId: submitRequestId,
      attemptNo: 1,
      lane: laneResolution.lane,
      provider: laneResolution.adapter,
      status: terminalStatus,
      providerResponse,
      errorCode,
      errorMessage,
      startedAt: attemptStartedAt,
    });
    await finalizeExecutionAttempt(env.WAITLIST_DB, {
      attemptId,
      status: terminalStatus,
      providerResponse,
      errorCode,
      errorMessage,
      completedAt: failedAt,
    });
    await upsertExecutionReceiptIdempotent(env.WAITLIST_DB, {
      requestId: submitRequestId,
      receiptId: newExecutionReceiptId(),
      finalizedStatus: terminalStatus,
      lane: laneResolution.lane,
      provider: laneResolution.adapter,
      signature: null,
      slot: null,
      errorCode,
      errorMessage,
      receipt: {
        mode: plan.mode,
        route: laneResolution.adapter,
        outcome: terminalStatus,
        quality: qualityMetadata,
        planId: plan.planId,
        runId: plan.runId,
      },
      readyAt: failedAt,
    });
    await terminalizeExecutionRequest(env.WAITLIST_DB, {
      requestId: submitRequestId,
      status: terminalStatus,
      statusReason,
      details: {
        provider: laneResolution.adapter,
        attempt: 1,
        errorMessage,
      },
      nowIso: failedAt,
    });
    throw error;
  }
}
