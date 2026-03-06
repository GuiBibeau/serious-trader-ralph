import { SOL_MINT, USDC_MINT } from "../defaults";
import type { JupiterQuoteResponse } from "../jupiter";
import { JupiterClient } from "../jupiter";
import {
  executionLaneRuntimeControlsFromSnapshot,
  readOpsControlSnapshot,
} from "../ops_controls";
import { enforcePolicy, normalizePolicy } from "../policy";
import { createPrivySolanaWallet, getPrivyWalletAddressById } from "../privy";
import { SolanaRpc } from "../solana_rpc";
import type { Env } from "../types";
import {
  createExecutionCanaryRun,
  type ExecutionCanaryDirection,
  type ExecutionCanaryRunRecord,
  type ExecutionCanaryRunStatus,
  type ExecutionCanaryStateRecord,
  type ExecutionCanaryTriggerSource,
  getExecutionCanaryDailySpendUsd,
  getExecutionCanaryState,
  listExecutionCanaryRuns,
  updateExecutionCanaryRun,
  updateExecutionCanaryState,
} from "./canary_repository";
import {
  type CanonicalExecutionErrorCode,
  normalizeExecutionErrorCode,
} from "./error_taxonomy";
import { resolveExecutionLane } from "./lane_resolver";
import { evaluatePrivyRuntimeBalancePolicy } from "./policy_engine";
import { assembleCanonicalExecutionReceiptV1 } from "./receipt_assembler";
import {
  appendExecutionStatusEvent,
  createExecutionAttemptIdempotent,
  createExecutionRequestIdempotent,
  finalizeExecutionAttempt,
  getExecutionLatestStatus,
  type JsonObject,
  listExecutionAttempts,
  terminalizeExecutionRequest,
  updateExecutionRequestStatus,
  upsertExecutionReceiptIdempotent,
} from "./repository";
import { executeSwapViaRouter } from "./router";

const EXECUTION_CANARY_PAIR_ID = "SOL/USDC" as const;
const EXECUTION_CANARY_SCHEDULE = "0 */6 * * *";
const EXECUTION_CANARY_ACTOR_ID = "system:execution-canary";
const EXECUTION_CANARY_WALLET_KEY = "execution-canary";
const LAMPORTS_PER_SOL = 1_000_000_000n;
const USDC_DECIMALS = 6;

export type ExecutionCanaryConfig = {
  enabled: boolean;
  autoCreateWallet: boolean;
  pairId: typeof EXECUTION_CANARY_PAIR_ID;
  notionalUsd: string;
  notionalUsdcAtomic: string;
  dailyCapUsd: number;
  maxSlippageBps: number;
  minSolReserveLamports: string;
};

export type ExecutionCanaryWallet = {
  walletId: string;
  walletAddress: string;
  created: boolean;
};

export type ExecutionCanarySnapshot = {
  ok: true;
  config: ExecutionCanaryConfig;
  state: ExecutionCanaryStateRecord | null;
  latestRuns: ExecutionCanaryRunRecord[];
  wallet: {
    walletId: string | null;
    walletAddress: string | null;
  };
};

export type ExecutionCanaryRunResponse = {
  ok: boolean;
  status: ExecutionCanaryRunStatus;
  triggerSource: ExecutionCanaryTriggerSource;
  run: ExecutionCanaryRunRecord | null;
  state: ExecutionCanaryStateRecord | null;
  error?: string;
};

type CanaryBalanceSnapshot = {
  solLamports: bigint;
  usdcAtomic: bigint;
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

function newExecutionAttemptId(): string {
  return `execatt_${crypto.randomUUID().replace(/-/g, "")}`;
}

function newExecutionReceiptId(): string {
  return `exec_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
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
  if (
    isRecord(value) &&
    String(value.code ?? "")
      .trim()
      .toLowerCase() === "policy-denied"
  ) {
    const reason = String(value.reason ?? "").trim();
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
  return `${whole}.${fraction.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "")}`;
}

function nextExecutionCanaryDirection(
  lastDirection: ExecutionCanaryDirection | null,
): ExecutionCanaryDirection {
  return lastDirection === "buy" ? "sell" : "buy";
}

function computeMinimumOutputAtomic(
  quotedOutAtomic: bigint,
  slippageBps: number,
): bigint {
  const boundedSlippage = BigInt(
    Math.max(1, Math.min(5_000, Math.floor(slippageBps))),
  );
  const denominator = 10_000n;
  const numerator = denominator - boundedSlippage;
  return (quotedOutAtomic * numerator) / denominator;
}

function readQuotePriceImpactPct(quote: JupiterQuoteResponse): number {
  const raw =
    typeof quote.priceImpactPct === "number"
      ? quote.priceImpactPct
      : Number(quote.priceImpactPct ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

function readExecutionCanaryConfig(env: Env): ExecutionCanaryConfig {
  const notionalAtomic = parseUsdAtomic(env.EXEC_CANARY_NOTIONAL_USD ?? "5");
  return {
    enabled: readBooleanEnv(env.EXEC_CANARY_ENABLED, false),
    autoCreateWallet: readBooleanEnv(env.EXEC_CANARY_AUTO_CREATE_WALLET, true),
    pairId: EXECUTION_CANARY_PAIR_ID,
    notionalUsd: formatUsdAtomic(notionalAtomic),
    notionalUsdcAtomic: notionalAtomic.toString(),
    dailyCapUsd: readNumberEnv(env.EXEC_CANARY_DAILY_CAP_USD, 25, 1, 1_000),
    maxSlippageBps: Math.floor(
      readNumberEnv(env.EXEC_CANARY_MAX_SLIPPAGE_BPS, 50, 1, 5_000),
    ),
    minSolReserveLamports: String(
      parseBigIntLike(env.EXEC_CANARY_MIN_SOL_RESERVE_LAMPORTS ?? "50000000") ??
        50_000_000n,
    ),
  };
}

async function hashCanaryPayload(
  input: Record<string, unknown>,
): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (part) =>
    part.toString(16).padStart(2, "0"),
  ).join("");
}

function readReconciliationFeeLamports(
  transaction: Record<string, unknown> | null,
): bigint {
  if (!transaction || !isRecord(transaction.meta)) return 0n;
  const fee = parseBigIntLike(transaction.meta.fee);
  return fee ?? 0n;
}

function readTransactionSlot(
  transaction: Record<string, unknown> | null,
): number | null {
  const parsed = Number(transaction?.slot ?? NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function readTransactionError(
  transaction: Record<string, unknown> | null,
): unknown {
  if (!transaction || !isRecord(transaction.meta)) return null;
  return transaction.meta.err ?? null;
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

async function ensureExecutionCanaryWallet(
  env: Env,
  config: ExecutionCanaryConfig,
): Promise<ExecutionCanaryWallet> {
  const state = await getExecutionCanaryState(env.WAITLIST_DB);
  if (state?.walletId && state.walletAddress) {
    return {
      walletId: state.walletId,
      walletAddress: state.walletAddress,
      created: false,
    };
  }
  if (state?.walletId && !state.walletAddress) {
    const walletAddress = await getPrivyWalletAddressById(env, state.walletId);
    await updateExecutionCanaryState(env.WAITLIST_DB, {
      walletAddress,
    });
    return {
      walletId: state.walletId,
      walletAddress,
      created: false,
    };
  }
  if (!config.autoCreateWallet) {
    throw new Error("execution-canary-wallet-missing");
  }
  const created = await createPrivySolanaWallet(env);
  await updateExecutionCanaryState(env.WAITLIST_DB, {
    walletId: created.walletId,
    walletAddress: created.address,
  });
  return {
    walletId: created.walletId,
    walletAddress: created.address,
    created: true,
  };
}

async function chooseSellAmountAtomic(
  jupiter: JupiterClient,
  config: ExecutionCanaryConfig,
): Promise<string> {
  const referenceQuote = await jupiter.quote({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amount: LAMPORTS_PER_SOL.toString(),
    slippageBps: config.maxSlippageBps,
    swapMode: "ExactIn",
  });
  const referenceOut = parseBigIntLike(referenceQuote.outAmount);
  if (!referenceOut || referenceOut <= 0n) {
    throw new Error("execution-canary-reference-quote-missing");
  }
  const targetNotional = BigInt(config.notionalUsdcAtomic);
  const estimatedLamports = (targetNotional * LAMPORTS_PER_SOL) / referenceOut;
  return (estimatedLamports > 0n ? estimatedLamports : 1n).toString();
}

async function fetchCanaryQuote(input: {
  jupiter: JupiterClient;
  direction: ExecutionCanaryDirection;
  config: ExecutionCanaryConfig;
}): Promise<{
  amountAtomic: string;
  inputMint: string;
  outputMint: string;
  quoteResponse: JupiterQuoteResponse;
  quotedOutAtomic: string;
  minExpectedOutAtomic: string;
}> {
  const amountAtomic =
    input.direction === "buy"
      ? input.config.notionalUsdcAtomic
      : await chooseSellAmountAtomic(input.jupiter, input.config);
  const inputMint = input.direction === "buy" ? USDC_MINT : SOL_MINT;
  const outputMint = input.direction === "buy" ? SOL_MINT : USDC_MINT;
  const quoteResponse = await input.jupiter.quote({
    inputMint,
    outputMint,
    amount: amountAtomic,
    slippageBps: input.config.maxSlippageBps,
    swapMode: "ExactIn",
  });
  const quotedOutAtomic = parseBigIntLike(quoteResponse.outAmount);
  if (!quotedOutAtomic || quotedOutAtomic <= 0n) {
    throw new Error("execution-canary-invalid-quote");
  }
  const thresholdRaw = parseBigIntLike(
    isRecord(quoteResponse) ? quoteResponse.otherAmountThreshold : null,
  );
  const minExpectedOutAtomic = (
    thresholdRaw ??
    computeMinimumOutputAtomic(quotedOutAtomic, input.config.maxSlippageBps)
  ).toString();
  return {
    amountAtomic,
    inputMint,
    outputMint,
    quoteResponse,
    quotedOutAtomic: quotedOutAtomic.toString(),
    minExpectedOutAtomic,
  };
}

function executionPolicyForCanary(input: {
  config: ExecutionCanaryConfig;
  quote: {
    inputMint: string;
    outputMint: string;
    amountAtomic: string;
  };
}) {
  return normalizePolicy({
    allowedMints: [SOL_MINT, USDC_MINT],
    slippageBps: input.config.maxSlippageBps,
    maxPriceImpactPct: 0.05,
    minSolReserveLamports: input.config.minSolReserveLamports,
    simulateOnly: false,
    dryRun: false,
    commitment: "finalized",
    maxTradeAmountAtomic: input.quote.amountAtomic,
  });
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

async function finalizeCanaryRun(
  env: Env,
  input: {
    runId: string;
    status: ExecutionCanaryRunStatus;
    statePatch?: Partial<ExecutionCanaryStateRecord> & {
      disabled?: boolean;
      disabledReason?: string | null;
      lastDirection?: ExecutionCanaryDirection | null;
      lastRunId?: string | null;
      lastRunAt?: string | null;
    };
    runPatch?: Parameters<typeof updateExecutionCanaryRun>[1];
  },
): Promise<ExecutionCanaryRunResponse> {
  const completedAt = new Date().toISOString();
  const run = await updateExecutionCanaryRun(env.WAITLIST_DB, {
    runId: input.runId,
    status: input.status,
    completedAt,
    ...(input.runPatch ?? {}),
  });
  const state = input.statePatch
    ? await updateExecutionCanaryState(env.WAITLIST_DB, {
        ...input.statePatch,
        lastRunId: input.statePatch.lastRunId ?? input.runId,
        lastRunAt: input.statePatch.lastRunAt ?? completedAt,
      })
    : await updateExecutionCanaryState(env.WAITLIST_DB, {
        lastRunId: input.runId,
        lastRunAt: completedAt,
      });
  return {
    ok: input.status === "success",
    status: input.status,
    triggerSource: run?.triggerSource ?? "manual",
    run,
    state,
  };
}

function reconciliationPayload(input: {
  before: CanaryBalanceSnapshot;
  after: CanaryBalanceSnapshot;
  feeLamports: bigint;
  outputMint: string;
  minExpectedOutAtomic: bigint;
  transaction: Record<string, unknown> | null;
}): {
  ok: boolean;
  actualOutputAtomic: bigint;
  reason: string | null;
  details: JsonObject;
} {
  const actualOutputAtomic =
    input.outputMint === SOL_MINT
      ? input.after.solLamports - input.before.solLamports + input.feeLamports
      : input.after.usdcAtomic - input.before.usdcAtomic;
  const txError = readTransactionError(input.transaction);
  const ok =
    txError === null &&
    actualOutputAtomic > 0n &&
    actualOutputAtomic >= input.minExpectedOutAtomic;
  let reason: string | null = null;
  if (txError !== null) {
    reason = "execution-canary-transaction-error";
  } else if (actualOutputAtomic <= 0n) {
    reason = "execution-canary-nonpositive-output";
  } else if (actualOutputAtomic < input.minExpectedOutAtomic) {
    reason = "execution-canary-slippage-breach";
  }
  return {
    ok,
    actualOutputAtomic,
    reason,
    details: {
      before: {
        solLamports: input.before.solLamports.toString(),
        usdcAtomic: input.before.usdcAtomic.toString(),
      },
      after: {
        solLamports: input.after.solLamports.toString(),
        usdcAtomic: input.after.usdcAtomic.toString(),
      },
      feeLamports: input.feeLamports.toString(),
      outputMint: input.outputMint,
      minExpectedOutAtomic: input.minExpectedOutAtomic.toString(),
      actualOutputAtomic: actualOutputAtomic.toString(),
      transactionError: txError === null ? null : String(txError),
    },
  };
}

async function buildCanarySnapshot(env: Env): Promise<ExecutionCanarySnapshot> {
  const config = readExecutionCanaryConfig(env);
  const state = await getExecutionCanaryState(env.WAITLIST_DB);
  const latestRuns = await listExecutionCanaryRuns(env.WAITLIST_DB, 10);
  return {
    ok: true,
    config,
    state,
    latestRuns,
    wallet: {
      walletId: state?.walletId ?? null,
      walletAddress: state?.walletAddress ?? null,
    },
  };
}

export async function bootstrapExecutionCanary(
  env: Env,
): Promise<ExecutionCanarySnapshot> {
  const config = readExecutionCanaryConfig(env);
  await ensureExecutionCanaryWallet(env, config);
  return await buildCanarySnapshot(env);
}

export async function resetExecutionCanary(
  env: Env,
): Promise<ExecutionCanarySnapshot> {
  await updateExecutionCanaryState(env.WAITLIST_DB, {
    disabled: false,
    disabledReason: null,
  });
  return await buildCanarySnapshot(env);
}

export async function readExecutionCanarySnapshot(
  env: Env,
): Promise<ExecutionCanarySnapshot> {
  return await buildCanarySnapshot(env);
}

export function isExecutionCanaryScheduledTick(event: ScheduledEvent): boolean {
  return String(event.cron ?? "").trim() === EXECUTION_CANARY_SCHEDULE;
}

export async function runExecutionCanary(input: {
  env: Env;
  triggerSource: ExecutionCanaryTriggerSource;
}): Promise<ExecutionCanaryRunResponse> {
  const { env, triggerSource } = input;
  const config = readExecutionCanaryConfig(env);
  const state = await getExecutionCanaryState(env.WAITLIST_DB);
  const opsControls = await readOpsControlSnapshot(env);

  if (!config.enabled) {
    return {
      ok: false,
      status: "skipped",
      triggerSource,
      run: null,
      state,
      error: "execution-canary-disabled-by-config",
    };
  }
  if (!opsControls.canary.enabled) {
    return {
      ok: false,
      status: "disabled",
      triggerSource,
      run: null,
      state,
      error:
        opsControls.canary.disabledReason ??
        "execution-canary-disabled-by-operator",
    };
  }
  if (state?.disabled) {
    return {
      ok: false,
      status: "disabled",
      triggerSource,
      run: null,
      state,
      error: state.disabledReason ?? "execution-canary-disabled",
    };
  }

  const wallet = await ensureExecutionCanaryWallet(env, config);
  const direction = nextExecutionCanaryDirection(state?.lastDirection ?? null);
  const startedAt = new Date().toISOString();
  const runId = `execcanary_${crypto.randomUUID().replace(/-/g, "")}`;
  await createExecutionCanaryRun(env.WAITLIST_DB, {
    runId,
    triggerSource,
    status: "pending",
    direction,
    pairId: config.pairId,
    inputMint: direction === "buy" ? USDC_MINT : SOL_MINT,
    outputMint: direction === "buy" ? SOL_MINT : USDC_MINT,
    targetNotionalUsd: config.notionalUsd,
    slippageBps: config.maxSlippageBps,
    walletId: wallet.walletId,
    walletAddress: wallet.walletAddress,
    startedAt,
    metadata: {
      schedule: triggerSource === "schedule" ? EXECUTION_CANARY_SCHEDULE : null,
      walletCreated: wallet.created,
    },
  });

  const spendTodayUsd = await getExecutionCanaryDailySpendUsd(
    env.WAITLIST_DB,
    utcDate(startedAt),
  );
  if (spendTodayUsd >= config.dailyCapUsd) {
    return await finalizeCanaryRun(env, {
      runId,
      status: "skipped",
      runPatch: {
        errorCode: "execution-canary-daily-cap-reached",
        errorMessage: `execution-canary-daily-cap-reached:${spendTodayUsd}`,
      },
    });
  }

  const laneResolution = resolveExecutionLane({
    env,
    requestedLane: "safe",
    mode: "privy_execute",
    actorType: "api_key_actor",
    runtimeControls: executionLaneRuntimeControlsFromSnapshot(opsControls),
  });
  if (!laneResolution.ok) {
    return await finalizeCanaryRun(env, {
      runId,
      status: "blocked",
      runPatch: {
        errorCode: laneResolution.error,
        errorMessage: laneResolution.reason,
      },
    });
  }

  const rpc = SolanaRpc.fromEnv(env);
  const jupiter = new JupiterClient(
    String(env.JUPITER_BASE_URL ?? "").trim() || "https://lite-api.jup.ag",
    env.JUPITER_API_KEY,
  );

  const beforeBalances = await readCanaryBalances(rpc, wallet.walletAddress);
  let quoteSummary: Awaited<ReturnType<typeof fetchCanaryQuote>> | null = null;
  try {
    quoteSummary = await fetchCanaryQuote({
      jupiter,
      direction,
      config,
    });
  } catch (error) {
    return await finalizeCanaryRun(env, {
      runId,
      status: "failed",
      runPatch: {
        errorCode: "execution-canary-quote-failed",
        errorMessage: executionErrorMessage(error),
      },
    });
  }

  const policy = executionPolicyForCanary({
    config,
    quote: {
      inputMint: quoteSummary.inputMint,
      outputMint: quoteSummary.outputMint,
      amountAtomic: quoteSummary.amountAtomic,
    },
  });

  const runtimeBalancePolicy = await evaluatePrivyRuntimeBalancePolicy({
    env,
    lane: "safe",
    walletAddress: wallet.walletAddress,
    inputMint: quoteSummary.inputMint,
    amountAtomic: quoteSummary.amountAtomic,
    minSolReserveLamports: config.minSolReserveLamports,
    rpc,
    runtimeDefaults: null,
  });
  if (!runtimeBalancePolicy.ok) {
    return await finalizeCanaryRun(env, {
      runId,
      status: "blocked",
      runPatch: {
        amountAtomic: quoteSummary.amountAtomic,
        quotedOutAtomic: quoteSummary.quotedOutAtomic,
        minExpectedOutAtomic: quoteSummary.minExpectedOutAtomic,
        quotePriceImpactPct: readQuotePriceImpactPct(
          quoteSummary.quoteResponse,
        ),
        quote: asJsonObject(quoteSummary.quoteResponse),
        metadata: {
          runtimePolicy: runtimeBalancePolicy.metadata,
        },
        errorCode: "policy-denied",
        errorMessage: runtimeBalancePolicy.reason,
      },
    });
  }

  try {
    enforcePolicy(policy, quoteSummary.quoteResponse);
  } catch (error) {
    return await finalizeCanaryRun(env, {
      runId,
      status: "failed",
      runPatch: {
        amountAtomic: quoteSummary.amountAtomic,
        quotedOutAtomic: quoteSummary.quotedOutAtomic,
        minExpectedOutAtomic: quoteSummary.minExpectedOutAtomic,
        quotePriceImpactPct: readQuotePriceImpactPct(
          quoteSummary.quoteResponse,
        ),
        quote: asJsonObject(quoteSummary.quoteResponse),
        errorCode: "policy-denied",
        errorMessage: `privy-quote-${normalizePolicyReason(error, "policy-violation")}`,
      },
    });
  }

  const requestId = newExecRequestId();
  const payloadHash = await hashCanaryPayload({
    walletAddress: wallet.walletAddress,
    direction,
    pairId: config.pairId,
    inputMint: quoteSummary.inputMint,
    outputMint: quoteSummary.outputMint,
    amountAtomic: quoteSummary.amountAtomic,
    slippageBps: config.maxSlippageBps,
    triggerSource,
  });
  await createExecutionRequestIdempotent(env.WAITLIST_DB, {
    requestId,
    idempotencyScope: EXECUTION_CANARY_WALLET_KEY,
    idempotencyKey: runId,
    payloadHash,
    actorType: "api_key_actor",
    actorId: EXECUTION_CANARY_ACTOR_ID,
    mode: "privy_execute",
    lane: "safe",
    metadata: {
      canary: true,
      triggerSource,
      direction,
      walletId: wallet.walletId,
      walletAddress: wallet.walletAddress,
    },
    nowIso: startedAt,
  });
  await appendExecutionStatusEvent(env.WAITLIST_DB, {
    requestId,
    status: "received",
    createdAt: startedAt,
  });
  await updateExecutionRequestStatus(env.WAITLIST_DB, {
    requestId,
    status: "validated",
    nowIso: startedAt,
  });
  await appendExecutionStatusEvent(env.WAITLIST_DB, {
    requestId,
    status: "validated",
    createdAt: startedAt,
  });

  const attemptId = newExecutionAttemptId();
  const providerResponseBase: JsonObject = {
    canary: true,
    lane: laneResolution.lane,
    adapter: laneResolution.adapter,
    triggerSource,
    direction,
    quote: {
      inputMint: quoteSummary.inputMint,
      outputMint: quoteSummary.outputMint,
      amountAtomic: quoteSummary.amountAtomic,
      outAmount: quoteSummary.quotedOutAtomic,
      minExpectedOutAtomic: quoteSummary.minExpectedOutAtomic,
    },
    runtimePolicy: runtimeBalancePolicy.metadata,
  };
  await updateExecutionRequestStatus(env.WAITLIST_DB, {
    requestId,
    status: "dispatched",
    nowIso: startedAt,
  });
  await appendExecutionStatusEvent(env.WAITLIST_DB, {
    requestId,
    status: "dispatched",
    details: {
      provider: laneResolution.adapter,
      attempt: 1,
    },
    createdAt: startedAt,
  });
  await createExecutionAttemptIdempotent(env.WAITLIST_DB, {
    attemptId,
    requestId,
    attemptNo: 1,
    lane: laneResolution.lane,
    provider: laneResolution.adapter,
    status: "dispatched",
    providerResponse: providerResponseBase,
    startedAt,
  });

  const execution = {
    adapter: laneResolution.adapter,
    params: {
      lane: laneResolution.lane,
      requireSimulation: true,
    },
  };

  try {
    const result = await executeSwapViaRouter({
      env,
      execution,
      policy,
      rpc,
      jupiter,
      quoteResponse: quoteSummary.quoteResponse,
      userPublicKey: wallet.walletAddress,
      privyWalletId: wallet.walletId,
      log(level, message, meta) {
        console[level]("exec.canary", {
          runId,
          requestId,
          message,
          ...(meta ?? {}),
        });
      },
    });
    const settledAt = new Date().toISOString();
    const failure = executionFailureFromResult(result.status, result.err);
    const terminalStatus = failure ? failure.terminalStatus : "finalized";
    const errorMessage = executionErrorMessage(result.err);
    const providerResponse: JsonObject = {
      ...providerResponseBase,
      executionStatus: result.status,
      refreshed: result.refreshed,
      lastValidBlockHeight: result.lastValidBlockHeight ?? null,
      executionMeta: asJsonObject(result.executionMeta),
    };

    await finalizeExecutionAttempt(env.WAITLIST_DB, {
      attemptId,
      status: result.status,
      providerResponse,
      errorCode: failure ? failure.errorCode : null,
      errorMessage,
      completedAt: settledAt,
    });
    const receiptRow = await upsertExecutionReceiptIdempotent(env.WAITLIST_DB, {
      requestId,
      receiptId: newExecutionReceiptId(),
      finalizedStatus: terminalStatus,
      lane: laneResolution.lane,
      provider: laneResolution.adapter,
      signature: result.signature,
      slot: null,
      errorCode: failure ? failure.errorCode : null,
      errorMessage,
      receipt: {
        canary: true,
        mode: "privy_execute",
        route: laneResolution.adapter,
        outcome: terminalStatus,
        resultStatus: result.status,
        quote: {
          inputMint: quoteSummary.inputMint,
          outputMint: quoteSummary.outputMint,
          inAmount: quoteSummary.amountAtomic,
          outAmount: quoteSummary.quotedOutAtomic,
          minExpectedOutAtomic: quoteSummary.minExpectedOutAtomic,
        },
      },
      readyAt: settledAt,
    });
    await terminalizeExecutionRequest(env.WAITLIST_DB, {
      requestId,
      status: terminalStatus,
      statusReason: failure ? failure.statusReason : null,
      details: {
        provider: laneResolution.adapter,
        attempt: 1,
        ...(result.signature ? { signature: result.signature } : {}),
      },
      nowIso: settledAt,
    });

    const latest = await getExecutionLatestStatus(env.WAITLIST_DB, requestId);
    const attempts = await listExecutionAttempts(env.WAITLIST_DB, requestId);
    const canonicalReceipt = latest
      ? assembleCanonicalExecutionReceiptV1({
          request: latest.request,
          receipt: latest.receipt,
          attempts,
          immutability: null,
        })
      : null;

    const transaction = result.signature
      ? await rpc.getTransactionParsed(result.signature, {
          commitment: "finalized",
        })
      : null;
    const afterBalances = await readCanaryBalances(rpc, wallet.walletAddress);
    const feeLamports = readReconciliationFeeLamports(transaction);
    const reconciliation = reconciliationPayload({
      before: beforeBalances,
      after: afterBalances,
      feeLamports,
      outputMint: quoteSummary.outputMint,
      minExpectedOutAtomic: BigInt(quoteSummary.minExpectedOutAtomic),
      transaction,
    });

    const runPatch = {
      amountAtomic: quoteSummary.amountAtomic,
      quotedOutAtomic: quoteSummary.quotedOutAtomic,
      minExpectedOutAtomic: quoteSummary.minExpectedOutAtomic,
      quotePriceImpactPct: readQuotePriceImpactPct(quoteSummary.quoteResponse),
      requestId,
      receiptId: receiptRow.row.receiptId,
      signature: result.signature,
      receiptStatus: receiptRow.row.finalizedStatus,
      reconciliationStatus: reconciliation.ok ? "passed" : "failed",
      quote: asJsonObject(quoteSummary.quoteResponse),
      receipt: canonicalReceipt ? asJsonObject(canonicalReceipt) : null,
      reconciliation: {
        ...reconciliation.details,
        slot: readTransactionSlot(transaction),
      },
      metadata: {
        providerResponse,
      },
      errorCode: failure ? failure.errorCode : null,
      errorMessage,
    } as const;

    if (failure) {
      return await finalizeCanaryRun(env, {
        runId,
        status: "failed",
        statePatch: {
          lastRunId: runId,
          lastRunAt: settledAt,
          lastDirection: direction,
        },
        runPatch,
      });
    }

    if (!reconciliation.ok) {
      const disabledReason =
        reconciliation.reason ?? "execution-canary-reconciliation-failed";
      return await finalizeCanaryRun(env, {
        runId,
        status: "disabled",
        statePatch: {
          disabled: true,
          disabledReason,
          lastRunId: runId,
          lastRunAt: settledAt,
          lastDirection: direction,
        },
        runPatch: {
          ...runPatch,
          disableReason: disabledReason,
          errorCode: "execution-canary-reconciliation-failed",
          errorMessage: disabledReason,
        },
      });
    }

    return await finalizeCanaryRun(env, {
      runId,
      status: "success",
      statePatch: {
        lastRunId: runId,
        lastRunAt: settledAt,
        lastDirection: direction,
      },
      runPatch,
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    const deniedReason = policyDeniedReason(error);
    const errorCode = deniedReason
      ? "policy-denied"
      : normalizeExecutionErrorCode({
          error,
          fallback: "submission-failed",
        });
    const errorMessage =
      executionErrorMessage(error) ?? "execution-canary-submit-failed";
    await finalizeExecutionAttempt(env.WAITLIST_DB, {
      attemptId,
      status: deniedReason ? "rejected" : "failed",
      providerResponse: providerResponseBase,
      errorCode,
      errorMessage,
      completedAt: failedAt,
    });
    await upsertExecutionReceiptIdempotent(env.WAITLIST_DB, {
      requestId,
      receiptId: newExecutionReceiptId(),
      finalizedStatus: deniedReason ? "rejected" : "failed",
      lane: laneResolution.lane,
      provider: laneResolution.adapter,
      signature: null,
      slot: null,
      errorCode,
      errorMessage,
      receipt: {
        canary: true,
        mode: "privy_execute",
        route: laneResolution.adapter,
        outcome: deniedReason ? "rejected" : "failed",
      },
      readyAt: failedAt,
    });
    await terminalizeExecutionRequest(env.WAITLIST_DB, {
      requestId,
      status: deniedReason ? "rejected" : "failed",
      statusReason: deniedReason ? `policy-denied:${deniedReason}` : errorCode,
      details: {
        provider: laneResolution.adapter,
        attempt: 1,
        errorMessage,
      },
      nowIso: failedAt,
    });
    return await finalizeCanaryRun(env, {
      runId,
      status: "failed",
      statePatch: {
        lastRunId: runId,
        lastRunAt: failedAt,
      },
      runPatch: {
        amountAtomic: quoteSummary.amountAtomic,
        quotedOutAtomic: quoteSummary.quotedOutAtomic,
        minExpectedOutAtomic: quoteSummary.minExpectedOutAtomic,
        quotePriceImpactPct: readQuotePriceImpactPct(
          quoteSummary.quoteResponse,
        ),
        requestId,
        quote: asJsonObject(quoteSummary.quoteResponse),
        errorCode,
        errorMessage,
      },
    });
  }
}

export const executionCanaryTestExports = {
  computeMinimumOutputAtomic,
  nextExecutionCanaryDirection,
  parseUsdAtomic,
  readExecutionCanaryConfig,
};
