import { SOL_MINT, SUPPORTED_TRADING_MINTS, USDC_MINT } from "./defaults";
import {
  type CanonicalExecutionErrorCode,
  normalizeExecutionErrorCode,
} from "./execution/error_taxonomy";
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
import type { JupiterQuoteResponse } from "./jupiter";
import { JupiterClient } from "./jupiter";
import {
  executionLaneRuntimeControlsFromSnapshot,
  readOpsControlSnapshot,
} from "./ops_controls";
import { enforcePolicy, normalizePolicy } from "./policy";
import { createPrivySolanaWallet, getPrivyWalletAddressById } from "./privy";
import {
  createRuntimeCanaryRun,
  getRuntimeCanaryDailySpendUsd,
  getRuntimeCanaryState,
  listRuntimeCanaryRuns,
  type RuntimeCanaryReconciliationStatus,
  type RuntimeCanaryRunRecord,
  type RuntimeCanaryRunStatus,
  type RuntimeCanaryStateRecord,
  type RuntimeCanaryTriggerSource,
  updateRuntimeCanaryRun,
  updateRuntimeCanaryState,
} from "./runtime_canary_repository";
import {
  parseRuntimeDeploymentRecord,
  type RuntimeDeploymentRecord,
  type RuntimeExecutionPlan,
} from "./runtime_contracts";
import {
  evaluateRuntimeDeployment,
  readRuntimeDeployment,
  readRuntimeDeploymentRuns,
  readRuntimeScorecard,
  upsertRuntimeDeployment,
} from "./runtime_internal";
import { SolanaRpc } from "./solana_rpc";
import type { Env } from "./types";

const RUNTIME_CANARY_ACTOR_ID = "system:runtime-canary";
const RUNTIME_CANARY_DEPLOYMENT_TAG = "runtime:canary";
const RUNTIME_CANARY_SCHEDULE = "0 */6 * * *";
const RUNTIME_CANARY_DEFAULT_DEPLOYMENT_ID = "runtime_canary_live_dca";
const RUNTIME_CANARY_OWNER_USER_ID = "system:runtime-canary";
const RUNTIME_CANARY_SLEEVE_ID = "sleeve_runtime_canary";
const RUNTIME_CANARY_ACTIVE_REGION = "ord";
const RUNTIME_CANARY_RETRYABLE_DISABLE_REASONS = new Set([
  "deployment-not-runnable",
  "deployment-not-shadow",
  "runtime-deployment-unavailable",
]);
const USDC_DECIMALS = 6;
const SOL_DECIMALS = 9;

export type RuntimeCanaryConfig = {
  enabled: boolean;
  autoCreateWallet: boolean;
  deploymentId: string;
  pairId: "SOL/USDC";
  strategyKey: "dca";
  allocatedUsd: string;
  notionalUsd: string;
  notionalUsdcAtomic: string;
  dailyCapUsd: number;
  maxSlippageBps: number;
  minSolReserveLamports: string;
};

export type RuntimeCanarySnapshot = {
  ok: true;
  config: RuntimeCanaryConfig;
  state: RuntimeCanaryStateRecord | null;
  latestRuns: RuntimeCanaryRunRecord[];
  deployment: Record<string, unknown> | null;
  deploymentRuns: Record<string, unknown>[];
  scorecard: Record<string, unknown> | null;
  wallet: {
    walletId: string | null;
    walletAddress: string | null;
  };
};

export type RuntimeCanaryRunResponse = {
  ok: boolean;
  status: RuntimeCanaryRunStatus;
  triggerSource: RuntimeCanaryTriggerSource;
  run: RuntimeCanaryRunRecord | null;
  state: RuntimeCanaryStateRecord | null;
  error?: string;
};

type RuntimeCanaryWallet = {
  walletId: string;
  walletAddress: string;
  created: boolean;
};

type CanaryBalanceSnapshot = {
  solLamports: bigint;
  usdcAtomic: bigint;
};

type RuntimeCanaryExecutionPlanResponse = {
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
  receipt: {
    receiptId: string;
    observedAt: string;
    status: string;
    notes: string[];
    signature: string | null;
    provider: string | null;
  };
  observedLedger: JsonObject;
};

function readBooleanEnv(value: unknown, fallback = false): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  return fallback;
}

function readNumberEnv(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseBigIntLike(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  const raw = String(value ?? "").trim();
  if (!raw || !/^[0-9]+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function parseUsdAtomic(value: unknown): bigint {
  const raw = String(value ?? "").trim();
  if (!raw) return 5_000_000n;
  const match = raw.match(/^([0-9]+)(?:\.([0-9]{1,6}))?$/);
  if (!match) return 5_000_000n;
  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "")
    .padEnd(USDC_DECIMALS, "0")
    .slice(0, USDC_DECIMALS);
  return whole * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction || "0");
}

function formatUsdAtomic(value: bigint): string {
  const whole = value / 10n ** BigInt(USDC_DECIMALS);
  const fraction = value % 10n ** BigInt(USDC_DECIMALS);
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "")}`;
}

function formatUsdNumber(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
  return normalized.toFixed(2);
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
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    String((value as { code?: unknown }).code ?? "")
      .trim()
      .toLowerCase() === "policy-denied"
  ) {
    const reason = String((value as { reason?: unknown }).reason ?? "").trim();
    return reason || "policy-denied";
  }
  return null;
}

function normalizePolicyReason(value: unknown, fallback: string): string {
  const raw = executionErrorMessage(value) ?? "";
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-:]+|[-:]+$/g, "");
  return normalized || fallback;
}

function newExecutionAttemptId(): string {
  return `execatt_${crypto.randomUUID().replace(/-/g, "")}`;
}

function newExecutionReceiptId(): string {
  return `exec_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function newExecRequestId(): string {
  return `execreq_${crypto.randomUUID().replace(/-/g, "")}`;
}

function executionFailureFromResult(
  status: string,
  error: unknown,
): {
  terminalStatus: "failed" | "rejected";
  errorCode: CanonicalExecutionErrorCode;
  statusReason: string;
} | null {
  if (
    status === "processed" ||
    status === "confirmed" ||
    status === "finalized"
  ) {
    return null;
  }
  const deniedReason = policyDeniedReason(error);
  if (deniedReason) {
    return {
      terminalStatus: "rejected",
      errorCode: "policy-denied",
      statusReason: `policy-denied:${deniedReason}`,
    };
  }
  const errorCode = normalizeExecutionErrorCode({
    statusHint: status,
    error,
    fallback: "submission-failed",
  });
  return {
    terminalStatus: "failed",
    errorCode,
    statusReason: errorCode,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asJsonObject(value: unknown): JsonObject | null {
  if (!isRecord(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  } catch {
    return null;
  }
}

function utcDate(value: string): string {
  return value.slice(0, 10);
}

async function hashRuntimeCanaryPayload(
  input: Record<string, unknown>,
): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (part) =>
    part.toString(16).padStart(2, "0"),
  ).join("");
}

function readRuntimeCanaryConfig(env: Env): RuntimeCanaryConfig {
  const notionalAtomic = parseUsdAtomic(env.RUNTIME_CANARY_NOTIONAL_USD ?? "5");
  const allocatedAtomic = parseUsdAtomic(
    env.RUNTIME_CANARY_ALLOCATED_USD ?? "25",
  );
  const deploymentId =
    String(env.RUNTIME_CANARY_DEPLOYMENT_ID ?? "").trim() ||
    RUNTIME_CANARY_DEFAULT_DEPLOYMENT_ID;
  return {
    enabled: readBooleanEnv(env.RUNTIME_CANARY_ENABLED, false),
    autoCreateWallet: readBooleanEnv(
      env.RUNTIME_CANARY_AUTO_CREATE_WALLET,
      true,
    ),
    deploymentId,
    pairId: "SOL/USDC",
    strategyKey: "dca",
    allocatedUsd: formatUsdAtomic(allocatedAtomic),
    notionalUsd: formatUsdAtomic(notionalAtomic),
    notionalUsdcAtomic: notionalAtomic.toString(),
    dailyCapUsd: readNumberEnv(env.RUNTIME_CANARY_DAILY_CAP_USD, 25, 1, 1_000),
    maxSlippageBps: Math.floor(
      readNumberEnv(env.RUNTIME_CANARY_MAX_SLIPPAGE_BPS, 50, 1, 5_000),
    ),
    minSolReserveLamports: String(
      parseBigIntLike(
        env.RUNTIME_CANARY_MIN_SOL_RESERVE_LAMPORTS ?? "50000000",
      ) ?? 50_000_000n,
    ),
  };
}

function buildRuntimeCanaryDeployment(
  config: RuntimeCanaryConfig,
): RuntimeDeploymentRecord {
  const allocatedAtomic = parseUsdAtomic(config.allocatedUsd);
  const reservedAtomic = parseUsdAtomic(config.notionalUsd);
  const availableAtomic =
    allocatedAtomic > reservedAtomic ? allocatedAtomic - reservedAtomic : 0n;
  const nowIso = new Date().toISOString();
  return parseRuntimeDeploymentRecord({
    schemaVersion: "v1",
    deploymentId: config.deploymentId,
    strategyKey: config.strategyKey,
    sleeveId: RUNTIME_CANARY_SLEEVE_ID,
    ownerUserId: RUNTIME_CANARY_OWNER_USER_ID,
    pair: {
      symbol: config.pairId,
      baseMint: SOL_MINT,
      quoteMint: USDC_MINT,
    },
    mode: "live",
    state: "live",
    lane: "safe",
    createdAt: nowIso,
    updatedAt: nowIso,
    policy: {
      maxNotionalUsd: config.notionalUsd,
      dailyLossLimitUsd: config.notionalUsd,
      maxSlippageBps: config.maxSlippageBps,
      maxConcurrentRuns: 1,
      rebalanceToleranceBps: 100,
    },
    capital: {
      allocatedUsd: config.allocatedUsd,
      reservedUsd: config.notionalUsd,
      availableUsd: formatUsdAtomic(availableAtomic),
    },
    tags: [
      RUNTIME_CANARY_DEPLOYMENT_TAG,
      "runtime:limited-live",
      `region:${RUNTIME_CANARY_ACTIVE_REGION}`,
    ],
  });
}

async function ensureRuntimeCanaryWallet(
  env: Env,
  config: RuntimeCanaryConfig,
): Promise<RuntimeCanaryWallet> {
  const state = await getRuntimeCanaryState(env.WAITLIST_DB);
  if (state?.walletId) {
    return {
      walletId: state.walletId,
      walletAddress:
        state.walletAddress ??
        (await getPrivyWalletAddressById(env, state.walletId)),
      created: false,
    };
  }
  if (!config.autoCreateWallet) {
    throw new Error("runtime-canary-wallet-missing");
  }
  const wallet = await createPrivySolanaWallet(env);
  await updateRuntimeCanaryState(env.WAITLIST_DB, {
    deploymentId: config.deploymentId,
    walletId: wallet.walletId,
    walletAddress: wallet.address,
  });
  return {
    walletId: wallet.walletId,
    walletAddress: wallet.address,
    created: true,
  };
}

async function readCanaryBalances(
  rpc: SolanaRpc,
  walletAddress: string,
): Promise<CanaryBalanceSnapshot> {
  const [solLamports, usdcAtomic] = await Promise.all([
    rpc.getBalanceLamports(walletAddress),
    rpc.getTokenBalanceAtomic(walletAddress, USDC_MINT),
  ]);
  return {
    solLamports,
    usdcAtomic,
  };
}

function atomicToNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
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

function buildObservedLedgerSnapshot(input: {
  config: RuntimeCanaryConfig;
  wallet: RuntimeCanaryWallet;
  quoteResponse: JupiterQuoteResponse;
  inputMint: string;
  outputMint: string;
  balances: CanaryBalanceSnapshot;
}): JsonObject {
  const solPriceUsd = deriveSolPriceUsd(
    input.quoteResponse,
    input.inputMint,
    input.outputMint,
  );
  const usdcBalance = atomicToNumber(input.balances.usdcAtomic, USDC_DECIMALS);
  const solBalance = atomicToNumber(input.balances.solLamports, SOL_DECIMALS);
  const equityUsd = usdcBalance + solBalance * solPriceUsd;
  const reservedUsd = Math.min(
    Number(input.config.notionalUsd),
    Number.isFinite(equityUsd) ? equityUsd : 0,
  );
  const availableUsd = Math.max(equityUsd - reservedUsd, 0);
  const reservedUsdcAtomic = parseUsdAtomic(formatUsdNumber(reservedUsd));
  const usdcReservedAtomic =
    input.balances.usdcAtomic > reservedUsdcAtomic
      ? reservedUsdcAtomic
      : input.balances.usdcAtomic;
  const usdcFreeAtomic = input.balances.usdcAtomic - usdcReservedAtomic;

  return {
    schemaVersion: "v1",
    snapshotId: `runtime_canary_${crypto.randomUUID().replace(/-/g, "")}`,
    deploymentId: input.config.deploymentId,
    sleeveId: RUNTIME_CANARY_SLEEVE_ID,
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
              instrumentId: input.config.pairId,
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
      availableUsd: formatUsdNumber(availableUsd),
      realizedPnlUsd: "0.00",
      unrealizedPnlUsd: "0.00",
    },
    wallet: {
      walletId: input.wallet.walletId,
      walletAddress: input.wallet.walletAddress,
    },
  };
}

function runtimeCanaryDisabledReason(
  runtimeState: RuntimeCanaryStateRecord | null,
  error: string,
): Partial<{
  disabled: boolean;
  disabledReason: string | null;
}> {
  if (runtimeState?.disabled) return {};
  return {
    disabled: true,
    disabledReason: error,
  };
}

function isRetryableRuntimeCanaryDisableReason(
  reason: string | null | undefined,
): boolean {
  const normalized = String(reason ?? "")
    .trim()
    .toLowerCase();
  return RUNTIME_CANARY_RETRYABLE_DISABLE_REASONS.has(normalized);
}

function canAutoRecoverRuntimeCanaryRun(input: {
  state: RuntimeCanaryStateRecord | null;
  triggerSource: RuntimeCanaryTriggerSource;
}): boolean {
  return (
    input.triggerSource === "post_deploy" &&
    Boolean(input.state?.disabled) &&
    isRetryableRuntimeCanaryDisableReason(input.state?.disabledReason)
  );
}

function runtimeCanaryFailureStatePatch(input: {
  state: RuntimeCanaryStateRecord | null;
  triggerSource: RuntimeCanaryTriggerSource;
  error: string;
}) {
  if (
    input.triggerSource === "post_deploy" &&
    isRetryableRuntimeCanaryDisableReason(input.error)
  ) {
    return undefined;
  }
  return runtimeCanaryDisabledReason(input.state, input.error);
}

async function buildRuntimeCanarySnapshot(
  env: Env,
): Promise<RuntimeCanarySnapshot> {
  const config = readRuntimeCanaryConfig(env);
  const [state, latestRuns] = await Promise.all([
    getRuntimeCanaryState(env.WAITLIST_DB),
    listRuntimeCanaryRuns(env.WAITLIST_DB, 10),
  ]);
  const deploymentId = state?.deploymentId ?? config.deploymentId;
  const [deploymentResult, runsResult, scorecardResult] = await Promise.all([
    readRuntimeDeployment(env, deploymentId),
    readRuntimeDeploymentRuns(env, deploymentId),
    readRuntimeScorecard(env, deploymentId),
  ]);

  return {
    ok: true,
    config,
    state,
    latestRuns,
    deployment:
      deploymentResult.ok && isRecord(deploymentResult.payload.deployment)
        ? (deploymentResult.payload.deployment as Record<string, unknown>)
        : null,
    deploymentRuns:
      runsResult.ok && Array.isArray(runsResult.payload.runs)
        ? runsResult.payload.runs.filter(isRecord)
        : [],
    scorecard:
      scorecardResult.ok && isRecord(scorecardResult.payload.report)
        ? (scorecardResult.payload.report as Record<string, unknown>)
        : null,
    wallet: {
      walletId: state?.walletId ?? null,
      walletAddress: state?.walletAddress ?? null,
    },
  };
}

function runtimeCanaryStatusFromPayload(
  payload: Record<string, unknown>,
): RuntimeCanaryRunStatus {
  const reconciliation = isRecord(payload.reconciliation)
    ? payload.reconciliation
    : null;
  const run = isRecord(payload.run) ? payload.run : null;
  const reconciliationStatus = String(
    reconciliation?.status ?? "",
  ).toLowerCase();
  const runState = String(run?.state ?? "").toLowerCase();
  if (reconciliationStatus === "passed" && runState === "completed") {
    return "success";
  }
  if (
    reconciliationStatus === "failed" ||
    reconciliationStatus === "needs_manual_review" ||
    runState === "failed"
  ) {
    return "failed";
  }
  if (
    runState === "rejected" ||
    runState === "killed" ||
    runState === "needs_manual_review"
  ) {
    return "blocked";
  }
  return "failed";
}

function runtimeCanaryReconciliationStatusFromPayload(
  payload: Record<string, unknown>,
): RuntimeCanaryReconciliationStatus {
  const reconciliation = isRecord(payload.reconciliation)
    ? payload.reconciliation
    : null;
  const status = String(reconciliation?.status ?? "").toLowerCase();
  if (
    status === "passed" ||
    status === "needs_manual_review" ||
    status === "failed"
  ) {
    return status as RuntimeCanaryReconciliationStatus;
  }
  return "not_attempted";
}

function deploymentStateFromPayload(
  payload: Record<string, unknown>,
): string | null {
  const deployment = isRecord(payload.deployment) ? payload.deployment : null;
  const state = String(deployment?.state ?? "").trim();
  return state || null;
}

function canaryInternalError(
  payload: Record<string, unknown>,
  fallback: string,
): string {
  const error = String(payload.error ?? payload.message ?? "").trim();
  return error || fallback;
}

async function finalizeRuntimeCanaryRun(
  env: Env,
  input: {
    runId: string;
    status: RuntimeCanaryRunStatus;
    statePatch?: Partial<{
      disabled: boolean;
      disabledReason: string | null;
    }>;
    runPatch?: Partial<{
      runtimeRunId: string | null;
      runtimeDeploymentState: string | null;
      submitRequestId: string | null;
      runtimeReceiptId: string | null;
      reconciliationStatus: RuntimeCanaryReconciliationStatus;
      disableReason: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      metadata: JsonObject | null;
      coordination: JsonObject | null;
      receipt: JsonObject | null;
      reconciliation: JsonObject | null;
      observedLedger: JsonObject | null;
    }>;
  },
): Promise<RuntimeCanaryRunResponse> {
  const completedAt = new Date().toISOString();
  const run = await updateRuntimeCanaryRun(env.WAITLIST_DB, {
    runId: input.runId,
    status: input.status,
    completedAt,
    ...input.runPatch,
  });
  const state = await updateRuntimeCanaryState(
    env.WAITLIST_DB,
    {
      ...(input.statePatch ?? {}),
      lastRunId: run.runId,
      lastRunAt: completedAt,
    },
    completedAt,
  );
  return {
    ok: input.status === "success",
    status: input.status,
    triggerSource: run.triggerSource,
    run,
    state,
    ...(run.errorMessage ? { error: run.errorMessage } : {}),
  };
}

function buildRuntimeCanaryExecutionPolicy(input: {
  plan: RuntimeExecutionPlan;
  requireSimulation: boolean;
  dryRun: boolean;
  minSolReserveLamports: string;
}) {
  return normalizePolicy({
    allowedMints: SUPPORTED_TRADING_MINTS,
    slippageBps:
      input.plan.slices[0]?.slippageBps ??
      readNumberEnv(undefined, 50, 1, 5_000),
    maxPriceImpactPct: 0.05,
    maxTradeAmountAtomic: input.plan.slices[0]?.inputAmountAtomic ?? "0",
    minSolReserveLamports: input.minSolReserveLamports,
    simulateOnly: input.requireSimulation,
    dryRun: input.dryRun,
    commitment: "confirmed",
  });
}

async function currentRuntimeCanaryWallet(
  env: Env,
  config: RuntimeCanaryConfig,
): Promise<RuntimeCanaryWallet> {
  return await ensureRuntimeCanaryWallet(env, config);
}

export async function submitRuntimeCanaryExecutionPlan(input: {
  env: Env;
  plan: RuntimeExecutionPlan;
}): Promise<RuntimeCanaryExecutionPlanResponse> {
  const { env, plan } = input;
  const config = readRuntimeCanaryConfig(env);
  if (!config.enabled) {
    throw new Error("runtime-canary-disabled-by-config");
  }
  if (plan.deploymentId !== config.deploymentId) {
    throw new Error("runtime-execution-plan-not-supported");
  }
  if (plan.mode !== "live") {
    throw new Error("runtime-execution-plan-live-mode-required");
  }
  if (plan.lane !== "safe") {
    throw new Error("runtime-execution-plan-safe-lane-required");
  }
  if (plan.slices.length !== 1) {
    throw new Error("runtime-execution-plan-single-slice-required");
  }

  const opsControls = await readOpsControlSnapshot(env);
  if (!opsControls.runtime.enabled) {
    throw new Error(
      opsControls.runtime.disabledReason ?? "runtime-disabled-by-operator",
    );
  }

  const laneResolution = resolveExecutionLane({
    env,
    requestedLane: plan.lane,
    mode: "privy_execute",
    actorType: "api_key_actor",
    runtimeControls: executionLaneRuntimeControlsFromSnapshot(opsControls),
  });
  if (!laneResolution.ok) {
    throw new Error(laneResolution.reason);
  }

  const wallet = await currentRuntimeCanaryWallet(env, config);
  const slice = plan.slices[0];
  const rpc = SolanaRpc.fromEnv(env);
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
  const policy = buildRuntimeCanaryExecutionPolicy({
    plan,
    requireSimulation: plan.simulateOnly,
    dryRun: plan.dryRun,
    minSolReserveLamports: config.minSolReserveLamports,
  });
  const runtimeBalancePolicy = await evaluatePrivyRuntimeBalancePolicy({
    env,
    lane: laneResolution.lane,
    walletAddress: wallet.walletAddress,
    inputMint: slice.inputMint,
    amountAtomic: slice.inputAmountAtomic,
    minSolReserveLamports: config.minSolReserveLamports,
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
      `policy-denied:privy-quote-${normalizePolicyReason(error, "policy-violation")}`,
    );
  }

  const requestId = newExecRequestId();
  const payloadHash = await hashRuntimeCanaryPayload({
    deploymentId: plan.deploymentId,
    planId: plan.planId,
    runId: plan.runId,
    walletAddress: wallet.walletAddress,
    slice,
    lane: plan.lane,
  });
  const requestReservation = await createExecutionRequestIdempotent(
    env.WAITLIST_DB,
    {
      requestId,
      idempotencyScope: `runtime:${plan.deploymentId}`,
      idempotencyKey: plan.idempotencyKey,
      payloadHash,
      actorType: "api_key_actor",
      actorId: RUNTIME_CANARY_ACTOR_ID,
      mode: "privy_execute",
      lane: laneResolution.lane,
      metadata: {
        source: "runtime-canary",
        reason: "runtime-live-canary",
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
        console[level]("runtime.canary.execution", {
          deploymentId: plan.deploymentId,
          planId: plan.planId,
          runId: plan.runId,
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
    const afterBalances = await readCanaryBalances(rpc, wallet.walletAddress);
    const observedLedger = buildObservedLedgerSnapshot({
      config,
      wallet,
      quoteResponse,
      inputMint: slice.inputMint,
      outputMint: slice.outputMint,
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
          : ["runtime canary execution accepted"],
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
      executionErrorMessage(error) ?? "runtime-canary-submit-failed";
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

export async function bootstrapRuntimeCanary(
  env: Env,
): Promise<RuntimeCanarySnapshot> {
  const config = readRuntimeCanaryConfig(env);
  const wallet = await ensureRuntimeCanaryWallet(env, config);
  const deployment = buildRuntimeCanaryDeployment(config);
  const result = await upsertRuntimeDeployment(env, deployment);
  if (!result.ok) {
    throw new Error(
      canaryInternalError(result.payload, "runtime-canary-bootstrap-failed"),
    );
  }
  await updateRuntimeCanaryState(env.WAITLIST_DB, {
    deploymentId: config.deploymentId,
    walletId: wallet.walletId,
    walletAddress: wallet.walletAddress,
  });
  return await buildRuntimeCanarySnapshot(env);
}

export async function resetRuntimeCanary(
  env: Env,
): Promise<RuntimeCanarySnapshot> {
  await updateRuntimeCanaryState(env.WAITLIST_DB, {
    disabled: false,
    disabledReason: null,
  });
  return await buildRuntimeCanarySnapshot(env);
}

export async function readRuntimeCanarySnapshot(
  env: Env,
): Promise<RuntimeCanarySnapshot> {
  return await buildRuntimeCanarySnapshot(env);
}

export function isRuntimeCanaryScheduledTick(event: ScheduledEvent): boolean {
  return String(event.cron ?? "").trim() === RUNTIME_CANARY_SCHEDULE;
}

export async function runRuntimeCanary(input: {
  env: Env;
  triggerSource: RuntimeCanaryTriggerSource;
}): Promise<RuntimeCanaryRunResponse> {
  const { env, triggerSource } = input;
  const config = readRuntimeCanaryConfig(env);
  let state = await getRuntimeCanaryState(env.WAITLIST_DB);
  const opsControls = await readOpsControlSnapshot(env);

  if (!config.enabled) {
    return {
      ok: false,
      status: "skipped",
      triggerSource,
      run: null,
      state,
      error: "runtime-canary-disabled-by-config",
    };
  }
  if (!opsControls.runtime.enabled) {
    return {
      ok: false,
      status: "disabled",
      triggerSource,
      run: null,
      state,
      error:
        opsControls.runtime.disabledReason ?? "runtime-disabled-by-operator",
    };
  }
  if (state?.disabled) {
    if (canAutoRecoverRuntimeCanaryRun({ state, triggerSource })) {
      state = await updateRuntimeCanaryState(
        env.WAITLIST_DB,
        {
          disabled: false,
          disabledReason: null,
        },
        new Date().toISOString(),
      );
    } else {
      return {
        ok: false,
        status: "disabled",
        triggerSource,
        run: null,
        state,
        error: state.disabledReason ?? "runtime-canary-disabled",
      };
    }
  }

  const wallet = await ensureRuntimeCanaryWallet(env, config);
  const deployment = buildRuntimeCanaryDeployment(config);
  const deploymentResult = await upsertRuntimeDeployment(env, deployment);
  if (!deploymentResult.ok) {
    return {
      ok: false,
      status: "failed",
      triggerSource,
      run: null,
      state,
      error: canaryInternalError(
        deploymentResult.payload,
        "runtime-canary-bootstrap-failed",
      ),
    };
  }

  const startedAt = new Date().toISOString();
  const runId = `runtimecanary_${crypto.randomUUID().replace(/-/g, "")}`;
  await createRuntimeCanaryRun(env.WAITLIST_DB, {
    runId,
    triggerSource,
    status: "pending",
    deploymentId: config.deploymentId,
    targetNotionalUsd: config.notionalUsd,
    walletId: wallet.walletId,
    walletAddress: wallet.walletAddress,
    startedAt,
    metadata: {
      schedule: triggerSource === "schedule" ? RUNTIME_CANARY_SCHEDULE : null,
      walletCreated: wallet.created,
      shadowOnlyBypass: opsControls.runtime.shadowOnly,
      shadowOnlyReason: opsControls.runtime.shadowOnlyReason,
    },
  });

  const spendTodayUsd = await getRuntimeCanaryDailySpendUsd(
    env.WAITLIST_DB,
    utcDate(startedAt),
  );
  if (spendTodayUsd >= config.dailyCapUsd) {
    return await finalizeRuntimeCanaryRun(env, {
      runId,
      status: "skipped",
      runPatch: {
        errorCode: "runtime-canary-daily-cap-reached",
        errorMessage: `runtime-canary-daily-cap-reached:${spendTodayUsd}`,
      },
    });
  }

  const runtimeDeployment = await readRuntimeDeployment(
    env,
    config.deploymentId,
  );
  if (!runtimeDeployment.ok) {
    return await finalizeRuntimeCanaryRun(env, {
      runId,
      status: "failed",
      runPatch: {
        errorCode: "runtime-deployment-unavailable",
        errorMessage: canaryInternalError(
          runtimeDeployment.payload,
          "runtime-deployment-unavailable",
        ),
      },
    });
  }
  const runtimeDeploymentRecord = isRecord(runtimeDeployment.payload.deployment)
    ? runtimeDeployment.payload.deployment
    : null;
  const runtimeState = String(
    runtimeDeploymentRecord?.state ?? "",
  ).toLowerCase();
  if (runtimeState === "paused" || runtimeState === "killed") {
    return await finalizeRuntimeCanaryRun(env, {
      runId,
      status: "blocked",
      runPatch: {
        runtimeDeploymentState: runtimeState || null,
        errorCode: "runtime-canary-deployment-not-runnable",
        errorMessage: `runtime-canary-deployment-not-runnable:${runtimeState}`,
      },
    });
  }

  const evaluation = await evaluateRuntimeDeployment({
    env,
    deploymentId: config.deploymentId,
    body: {
      trigger: {
        kind: "canary",
        source: "worker-runtime-canary",
        observedAt: startedAt,
        reason: triggerSource,
      },
    },
  });
  if (!evaluation.ok) {
    const error = canaryInternalError(
      evaluation.payload,
      "runtime-canary-evaluation-failed",
    );
    return await finalizeRuntimeCanaryRun(env, {
      runId,
      status: "failed",
      statePatch: runtimeCanaryFailureStatePatch({
        state,
        triggerSource,
        error,
      }),
      runPatch: {
        runtimeDeploymentState: deploymentStateFromPayload(evaluation.payload),
        errorCode: "runtime-canary-evaluation-failed",
        errorMessage: error,
      },
    });
  }

  const status = runtimeCanaryStatusFromPayload(evaluation.payload);
  const reconciliationStatus = runtimeCanaryReconciliationStatusFromPayload(
    evaluation.payload,
  );
  const nextStatePatch =
    status === "success"
      ? undefined
      : runtimeCanaryDisabledReason(
          state,
          reconciliationStatus !== "not_attempted"
            ? `runtime-canary-${reconciliationStatus}`
            : "runtime-canary-run-failed",
        );

  return await finalizeRuntimeCanaryRun(env, {
    runId,
    status,
    statePatch: nextStatePatch,
    runPatch: {
      runtimeRunId:
        String(
          (evaluation.payload.run as { runId?: unknown } | undefined)?.runId ??
            "",
        ).trim() || null,
      runtimeDeploymentState: deploymentStateFromPayload(evaluation.payload),
      submitRequestId:
        String(
          (
            evaluation.payload.coordination as
              | { submitRequestId?: unknown }
              | undefined
          )?.submitRequestId ?? "",
        ).trim() || null,
      runtimeReceiptId:
        String(
          (
            evaluation.payload.reconciliation as
              | { receiptId?: unknown }
              | undefined
          )?.receiptId ?? "",
        ).trim() || null,
      reconciliationStatus,
      errorCode:
        status === "success"
          ? null
          : `runtime-canary-${reconciliationStatus !== "not_attempted" ? reconciliationStatus : "failed"}`,
      errorMessage:
        status === "success"
          ? null
          : canaryInternalError(
              evaluation.payload,
              "runtime-canary-run-failed",
            ),
      coordination: asJsonObject(evaluation.payload.coordination),
      receipt: isRecord(evaluation.payload.coordination)
        ? asJsonObject(
            (evaluation.payload.coordination as Record<string, unknown>)
              .receipt,
          )
        : null,
      reconciliation: asJsonObject(evaluation.payload.reconciliation),
      observedLedger: asJsonObject(evaluation.payload.observedLedger),
    },
  });
}
