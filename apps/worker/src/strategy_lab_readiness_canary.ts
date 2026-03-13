import {
  buildRuntimeResearchReadinessCanaryMarkdown,
  type RuntimeResearchReadinessCanaryRequest,
} from "../../../src/runtime/research/readiness.js";
import {
  requireRuntimeVenueCapability,
  runtimeVenueSupportsMode,
} from "../../../src/runtime/venues/catalog.js";
import {
  SOL_MINT,
  SUPPORTED_TRADING_PAIRS,
  TRADING_TOKEN_BY_MINT,
  USDC_MINT,
} from "./defaults";
import {
  type CanonicalExecutionErrorCode,
  normalizeExecutionErrorCode,
} from "./execution/error_taxonomy";
import { resolveExecutionLane } from "./execution/lane_resolver";
import { evaluatePrivyRuntimeBalancePolicy } from "./execution/policy_engine";
import {
  executeSwapViaRouter,
  resolveExecutionAdapterRegistration,
} from "./execution/router";
import type { JupiterQuoteResponse } from "./jupiter";
import { JupiterClient } from "./jupiter";
import {
  executionLaneRuntimeControlsFromSnapshot,
  readOpsControlSnapshot,
} from "./ops_controls";
import { evaluateOracleReferencePriceGuard } from "./oracle_reference";
import { enforcePolicy, normalizePolicy } from "./policy";
import { createPrivySolanaWallet, getPrivyWalletAddressById } from "./privy";
import { SolanaRpc } from "./solana_rpc";
import {
  createStrategyLabReadinessCanaryRun,
  getStrategyLabReadinessCanaryDailySpendUsd,
  getStrategyLabReadinessCanaryRun,
  getStrategyLabReadinessCanaryState,
  listStrategyLabReadinessCanaryRuns,
  type ReadinessCanaryStateRecord,
  updateStrategyLabReadinessCanaryRun,
  updateStrategyLabReadinessCanaryState,
} from "./strategy_lab_readiness_repository";
import type { Env } from "./types";

const STRATEGY_LAB_READINESS_CANARY_KEY = "strategy_lab";
const USDC_DECIMALS = 6;

type StrategyLabReadinessCanaryConfig = {
  enabled: boolean;
  autoCreateWallet: boolean;
  notionalUsd: string;
  notionalUsdcAtomic: string;
  dailyCapUsd: number;
  maxSlippageBps: number;
  minSolReserveLamports: string;
};

type StrategyLabReadinessCanaryWallet = {
  walletId: string;
  walletAddress: string;
  created: boolean;
};

type BalanceSnapshot = {
  inputAtomic: bigint;
  outputAtomic: bigint;
  solLamports: bigint;
};

type CanaryPairContext = {
  venueKey: string;
  assetKey: string;
  pairSymbol: string;
  adapterKey: string;
  inputMint: string;
  outputMint: string;
};

export type RuntimeResearchReadinessCanaryWorkflowResult = {
  ok: boolean;
  status: "pending" | "success" | "blocked" | "failed" | "disabled" | "skipped";
  run: Awaited<ReturnType<typeof getStrategyLabReadinessCanaryRun>> | null;
  state: ReadinessCanaryStateRecord | null;
  markdown: string | null;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

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

function executionErrorMessage(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Error) return value.message.slice(0, 2_000);
  const text = String(value).trim();
  return text ? text.slice(0, 2_000) : null;
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

function readReconciliationFeeLamports(
  transaction: Record<string, unknown> | null,
): bigint {
  if (!transaction || !isRecord(transaction.meta)) return 0n;
  return parseBigIntLike(transaction.meta.fee) ?? 0n;
}

function readTransactionError(
  transaction: Record<string, unknown> | null,
): unknown {
  if (!transaction || !isRecord(transaction.meta)) return null;
  return transaction.meta.err ?? null;
}

function utcDate(value: string): string {
  return value.slice(0, 10);
}

function isStubModeEnabled(env: Env): boolean {
  return String(env.RUNTIME_INTERNAL_STUB_MODE ?? "").trim() === "1";
}

function readStrategyLabReadinessCanaryConfig(
  env: Env,
): StrategyLabReadinessCanaryConfig {
  const notionalAtomic = parseUsdAtomic(
    env.STRATEGY_LAB_READINESS_CANARY_NOTIONAL_USD ?? "5",
  );
  return {
    enabled: readBooleanEnv(env.STRATEGY_LAB_READINESS_CANARY_ENABLED, true),
    autoCreateWallet: readBooleanEnv(
      env.STRATEGY_LAB_READINESS_CANARY_AUTO_CREATE_WALLET,
      true,
    ),
    notionalUsd: formatUsdAtomic(notionalAtomic),
    notionalUsdcAtomic: notionalAtomic.toString(),
    dailyCapUsd: readNumberEnv(
      env.STRATEGY_LAB_READINESS_CANARY_DAILY_CAP_USD,
      25,
      1,
      1_000,
    ),
    maxSlippageBps: Math.floor(
      readNumberEnv(
        env.STRATEGY_LAB_READINESS_CANARY_MAX_SLIPPAGE_BPS,
        50,
        1,
        5_000,
      ),
    ),
    minSolReserveLamports: String(
      parseBigIntLike(
        env.STRATEGY_LAB_READINESS_CANARY_MIN_SOL_RESERVE_LAMPORTS ??
          "50000000",
      ) ?? 50_000_000n,
    ),
  };
}

async function ensureReadinessCanaryWallet(
  env: Env,
  config: StrategyLabReadinessCanaryConfig,
): Promise<StrategyLabReadinessCanaryWallet> {
  const state = await getStrategyLabReadinessCanaryState(
    env.WAITLIST_DB,
    STRATEGY_LAB_READINESS_CANARY_KEY,
  );
  if (state?.walletId && state.walletAddress) {
    return {
      walletId: state.walletId,
      walletAddress: state.walletAddress,
      created: false,
    };
  }
  if (state?.walletId && !state.walletAddress) {
    const walletAddress = await getPrivyWalletAddressById(env, state.walletId);
    await updateStrategyLabReadinessCanaryState(env.WAITLIST_DB, {
      canaryKey: STRATEGY_LAB_READINESS_CANARY_KEY,
      walletAddress,
    });
    return {
      walletId: state.walletId,
      walletAddress,
      created: false,
    };
  }
  if (!config.autoCreateWallet) {
    throw new Error("strategy-lab-readiness-wallet-missing");
  }
  const created = await createPrivySolanaWallet(env);
  await updateStrategyLabReadinessCanaryState(env.WAITLIST_DB, {
    canaryKey: STRATEGY_LAB_READINESS_CANARY_KEY,
    walletId: created.walletId,
    walletAddress: created.address,
  });
  return {
    walletId: created.walletId,
    walletAddress: created.address,
    created: true,
  };
}

function resolveDefaultPairForAsset(assetKey: string): string | null {
  return (
    SUPPORTED_TRADING_PAIRS.find(
      (pair) =>
        (pair.baseSymbol === assetKey || pair.quoteSymbol === assetKey) &&
        (pair.baseSymbol === "USDC" || pair.quoteSymbol === "USDC"),
    )?.id ?? null
  );
}

function resolveCanaryPairContext(
  request: RuntimeResearchReadinessCanaryRequest,
): CanaryPairContext {
  const venueKey =
    request.venueKey ??
    (request.subjectKind === "venue" ? request.subjectKey : "jupiter");
  const pairSymbol =
    request.pairSymbol ??
    (request.subjectKind === "asset"
      ? (resolveDefaultPairForAsset(request.subjectKey) ?? "")
      : "SOL/USDC");
  if (!pairSymbol) {
    throw new Error("strategy-lab-readiness-canary-pair-unresolved");
  }
  const pair = SUPPORTED_TRADING_PAIRS.find((entry) => entry.id === pairSymbol);
  if (!pair) {
    throw new Error(
      `strategy-lab-readiness-canary-unsupported-pair:${pairSymbol}`,
    );
  }
  if (pair.baseSymbol !== "USDC" && pair.quoteSymbol !== "USDC") {
    throw new Error("strategy-lab-readiness-canary-pair-must-include-usdc");
  }

  const outputMint =
    pair.baseMint === USDC_MINT ? pair.quoteMint : pair.baseMint;
  const assetKey =
    request.assetKey ??
    (request.subjectKind === "asset"
      ? request.subjectKey
      : (TRADING_TOKEN_BY_MINT[outputMint]?.symbol ?? ""));
  if (!assetKey || assetKey === "USDC") {
    throw new Error("strategy-lab-readiness-canary-asset-unresolved");
  }

  const capability = requireRuntimeVenueCapability(venueKey);
  if (!runtimeVenueSupportsMode(capability, "live")) {
    throw new Error(`strategy-lab-readiness-canary-venue-not-live:${venueKey}`);
  }

  const adapterKey =
    request.adapterKey ??
    capability.adapterKeys.find((candidate) => {
      const registration = resolveExecutionAdapterRegistration(candidate);
      return (
        registration !== null &&
        registration.venueKey === venueKey &&
        registration.supportedModes.includes("live")
      );
    });
  if (!adapterKey) {
    throw new Error(
      `strategy-lab-readiness-canary-adapter-unavailable:${venueKey}`,
    );
  }

  return {
    venueKey,
    assetKey,
    pairSymbol,
    adapterKey,
    inputMint: USDC_MINT,
    outputMint,
  };
}

async function readBalances(input: {
  rpc: SolanaRpc;
  walletAddress: string;
  inputMint: string;
  outputMint: string;
}): Promise<BalanceSnapshot> {
  const [inputAtomic, outputAtomic, solLamports] = await Promise.all([
    input.inputMint === SOL_MINT
      ? input.rpc.getBalanceLamports(input.walletAddress)
      : input.rpc.getTokenBalanceAtomic(input.walletAddress, input.inputMint),
    input.outputMint === SOL_MINT
      ? input.rpc.getBalanceLamports(input.walletAddress)
      : input.rpc.getTokenBalanceAtomic(input.walletAddress, input.outputMint),
    input.rpc.getBalanceLamports(input.walletAddress),
  ]);
  return {
    inputAtomic,
    outputAtomic,
    solLamports,
  };
}

async function fetchCanaryQuote(input: {
  jupiter: JupiterClient;
  context: CanaryPairContext;
  config: StrategyLabReadinessCanaryConfig;
  targetNotionalUsd: string;
}): Promise<{
  amountAtomic: string;
  quoteResponse: JupiterQuoteResponse;
  quotedOutAtomic: string;
  minExpectedOutAtomic: string;
}> {
  const amountAtomic = parseUsdAtomic(input.targetNotionalUsd).toString();
  const quoteResponse = await input.jupiter.quote({
    inputMint: input.context.inputMint,
    outputMint: input.context.outputMint,
    amount: amountAtomic,
    slippageBps: input.config.maxSlippageBps,
    swapMode: "ExactIn",
  });
  const quotedOutAtomic = parseBigIntLike(quoteResponse.outAmount);
  if (!quotedOutAtomic || quotedOutAtomic <= 0n) {
    throw new Error("strategy-lab-readiness-canary-invalid-quote");
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
    quoteResponse,
    quotedOutAtomic: quotedOutAtomic.toString(),
    minExpectedOutAtomic,
  };
}

async function finalizeReadinessCanaryRun(
  env: Env,
  input: {
    runId: string;
    status: RuntimeResearchReadinessCanaryWorkflowResult["status"];
    runPatch?: Partial<
      NonNullable<RuntimeResearchReadinessCanaryWorkflowResult["run"]>
    >;
  },
): Promise<RuntimeResearchReadinessCanaryWorkflowResult> {
  const current = await getStrategyLabReadinessCanaryRun(
    env.WAITLIST_DB,
    input.runId,
  );
  if (!current) {
    throw new Error("strategy-lab-readiness-canary-run-missing");
  }
  const completedAt = new Date().toISOString();
  const run = await updateStrategyLabReadinessCanaryRun(env.WAITLIST_DB, {
    ...current,
    status: input.status,
    ...(input.runPatch ?? {}),
    completedAt,
  });
  const state = await updateStrategyLabReadinessCanaryState(env.WAITLIST_DB, {
    canaryKey: STRATEGY_LAB_READINESS_CANARY_KEY,
    lastRunId: input.runId,
    lastRunAt: completedAt,
  });
  return {
    ok: input.status === "success",
    status: input.status,
    run,
    state,
    markdown: run ? buildRuntimeResearchReadinessCanaryMarkdown(run) : null,
    ...(input.status === "success"
      ? {}
      : {
          error:
            input.runPatch && "errorMessage" in input.runPatch
              ? (input.runPatch.errorMessage as string | undefined)
              : undefined,
        }),
  };
}

function stubWalletAddress(): string {
  return "11111111111111111111111111111111";
}

function stubSignature(runId: string): string {
  return `stub_${runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)}`;
}

function buildStubCanaryMetadata(input: {
  request: RuntimeResearchReadinessCanaryRequest;
  context: CanaryPairContext;
}): Record<string, unknown> {
  return {
    source: "stub",
    requestedBy: input.request.requestedBy,
    pairSymbol: input.context.pairSymbol,
    venueKey: input.context.venueKey,
    assetKey: input.context.assetKey,
  };
}

function classifyExecutionFailure(
  status: string,
  error: unknown,
): {
  status: "blocked" | "failed";
  errorCode: CanonicalExecutionErrorCode;
  errorMessage: string | null;
} {
  const message = executionErrorMessage(error);
  const denied = message?.toLowerCase().includes("policy-denied")
    ? "policy-denied"
    : null;
  if (denied) {
    return {
      status: "blocked",
      errorCode: "policy-denied",
      errorMessage: message,
    };
  }
  return {
    status: "failed",
    errorCode: normalizeExecutionErrorCode({
      statusHint: status,
      error,
      fallback: "submission-failed",
    }),
    errorMessage: message,
  };
}

export async function runRuntimeResearchReadinessCanaryWorkflow(input: {
  env: Env;
  request: RuntimeResearchReadinessCanaryRequest;
}): Promise<RuntimeResearchReadinessCanaryWorkflowResult> {
  const config = readStrategyLabReadinessCanaryConfig(input.env);
  const state = await getStrategyLabReadinessCanaryState(
    input.env.WAITLIST_DB,
    STRATEGY_LAB_READINESS_CANARY_KEY,
  );

  if (!config.enabled) {
    return {
      ok: false,
      status: "disabled",
      run: null,
      state,
      markdown: null,
      error: "strategy-lab-readiness-canary-disabled-by-config",
    };
  }

  const opsControls = await readOpsControlSnapshot(input.env);
  if (!opsControls.canary.enabled) {
    return {
      ok: false,
      status: "disabled",
      run: null,
      state,
      markdown: null,
      error:
        opsControls.canary.disabledReason ??
        "strategy-lab-readiness-canary-disabled-by-operator",
    };
  }

  let context: CanaryPairContext;
  try {
    context = resolveCanaryPairContext(input.request);
  } catch (error) {
    return {
      ok: false,
      status: "blocked",
      run: null,
      state,
      markdown: null,
      error:
        error instanceof Error
          ? error.message
          : "strategy-lab-readiness-canary-context-failed",
    };
  }

  const wallet = isStubModeEnabled(input.env)
    ? {
        walletId: "wallet_strategy_lab_stub",
        walletAddress: stubWalletAddress(),
        created: false,
      }
    : await ensureReadinessCanaryWallet(input.env, config);
  const startedAt = new Date().toISOString();
  const runId = `readinesscanary_${crypto.randomUUID().replace(/-/g, "")}`;
  const targetNotionalUsd =
    input.request.targetNotionalUsd ?? config.notionalUsd;

  await createStrategyLabReadinessCanaryRun(input.env.WAITLIST_DB, {
    schemaVersion: "v1",
    runId,
    subjectKind: input.request.subjectKind,
    subjectKey: input.request.subjectKey,
    venueKey: context.venueKey,
    assetKey: context.assetKey,
    pairSymbol: context.pairSymbol,
    adapterKey: context.adapterKey,
    triggerSource: input.request.triggerSource ?? "manual",
    status: "pending",
    inputMint: context.inputMint,
    outputMint: context.outputMint,
    targetNotionalUsd,
    walletId: wallet.walletId,
    walletAddress: wallet.walletAddress,
    evidenceRefs: [],
    startedAt,
    metadata: {
      requestedBy: input.request.requestedBy,
      ...(input.request.metadata
        ? { requestMetadata: input.request.metadata }
        : {}),
      walletCreated: wallet.created,
    },
  });

  const spendToday = await getStrategyLabReadinessCanaryDailySpendUsd(
    input.env.WAITLIST_DB,
    utcDate(startedAt),
  );
  if (spendToday > config.dailyCapUsd) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId,
      status: "skipped",
      runPatch: {
        errorCode: "strategy-lab-readiness-canary-daily-cap-reached",
        errorMessage: `strategy-lab-readiness-canary-daily-cap-reached:${spendToday}`,
      },
    });
  }

  if (isStubModeEnabled(input.env)) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId,
      status: "success",
      runPatch: {
        receiptId: `receipt_${runId.slice(-16)}`,
        signature: stubSignature(runId),
        reconciliation: {
          status: "passed",
          actualOutputAtomic: "1000",
          minExpectedOutAtomic: "900",
          notes: ["stub mode"],
        },
        evidenceRefs: [
          {
            kind: "live_canary",
            ref: `stub:${runId}`,
          },
        ],
        metadata: buildStubCanaryMetadata({
          request: input.request,
          context,
        }),
      },
    });
  }

  const laneResolution = resolveExecutionLane({
    env: input.env,
    requestedLane: "safe",
    mode: "privy_execute",
    actorType: "api_key_actor",
    runtimeControls: executionLaneRuntimeControlsFromSnapshot(opsControls),
  });
  if (!laneResolution.ok) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId,
      status: "blocked",
      runPatch: {
        errorCode: laneResolution.error,
        errorMessage: laneResolution.reason,
      },
    });
  }

  const rpc = SolanaRpc.fromEnv(input.env);
  const jupiter = new JupiterClient(
    String(input.env.JUPITER_BASE_URL ?? "").trim() ||
      "https://lite-api.jup.ag",
    input.env.JUPITER_API_KEY,
  );

  let quoteSummary: Awaited<ReturnType<typeof fetchCanaryQuote>>;
  try {
    quoteSummary = await fetchCanaryQuote({
      jupiter,
      context,
      config,
      targetNotionalUsd,
    });
  } catch (error) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId,
      status: "failed",
      runPatch: {
        errorCode: "strategy-lab-readiness-canary-quote-failed",
        errorMessage: executionErrorMessage(error),
      },
    });
  }

  const policy = normalizePolicy({
    allowedMints: [context.inputMint, context.outputMint],
    slippageBps: config.maxSlippageBps,
    maxPriceImpactPct: 0.05,
    minSolReserveLamports: config.minSolReserveLamports,
    simulateOnly: false,
    dryRun: false,
    commitment: "finalized",
    maxTradeAmountAtomic: quoteSummary.amountAtomic,
  });

  const runtimeBalancePolicy = await evaluatePrivyRuntimeBalancePolicy({
    env: input.env,
    lane: "safe",
    walletAddress: wallet.walletAddress,
    inputMint: context.inputMint,
    amountAtomic: quoteSummary.amountAtomic,
    minSolReserveLamports: config.minSolReserveLamports,
    rpc,
    runtimeDefaults: null,
  });
  if (!runtimeBalancePolicy.ok) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId,
      status: "blocked",
      runPatch: {
        errorCode: "policy-denied",
        errorMessage: runtimeBalancePolicy.reason,
        metadata: {
          runtimePolicy: runtimeBalancePolicy.metadata,
        },
      },
    });
  }

  try {
    enforcePolicy(policy, quoteSummary.quoteResponse);
  } catch (error) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId,
      status: "blocked",
      runPatch: {
        errorCode: "policy-denied",
        errorMessage: `privy-quote-${normalizePolicyReason(error, "policy-violation")}`,
      },
    });
  }
  const referenceGuard = await evaluateOracleReferencePriceGuard({
    env: input.env,
    mode: "live",
    inputMint: context.inputMint,
    outputMint: context.outputMint,
    inputAmountAtomic: quoteSummary.amountAtomic,
    expectedOutputAmountAtomic: String(
      quoteSummary.quoteResponse.outAmount ?? "",
    ),
    jupiter,
  });
  if (referenceGuard.enabled && referenceGuard.verdict !== "allow") {
    return await finalizeReadinessCanaryRun(input.env, {
      runId,
      status: "blocked",
      runPatch: {
        errorCode: "policy-denied",
        errorMessage: referenceGuard.reason ?? "reference-price-policy-denied",
        metadata: {
          referencePrice: {
            verdict: referenceGuard.verdict,
            reason: referenceGuard.reason,
            executionPrice: referenceGuard.executionPrice,
            executionDivergenceBps: referenceGuard.executionDivergenceBps,
            snapshot: referenceGuard.snapshot,
          },
        },
      },
    });
  }

  const beforeBalances = await readBalances({
    rpc,
    walletAddress: wallet.walletAddress,
    inputMint: context.inputMint,
    outputMint: context.outputMint,
  });

  try {
    const result = await executeSwapViaRouter({
      env: input.env,
      venueKey: context.venueKey,
      runtimeMode: "live",
      requireVenueRouting: true,
      subjectControlBypassReason: "strategy_lab_readiness_canary",
      execution: {
        adapter: laneResolution.adapter,
        params: {
          lane: laneResolution.lane,
          requireSimulation: true,
        },
      },
      policy,
      rpc,
      jupiter,
      quoteResponse: quoteSummary.quoteResponse,
      userPublicKey: wallet.walletAddress,
      privyWalletId: wallet.walletId,
      log(level, message, meta) {
        console[level]("strategy_lab.readiness_canary", {
          runId,
          message,
          ...(meta ?? {}),
        });
      },
    });

    if (
      result.status !== "processed" &&
      result.status !== "confirmed" &&
      result.status !== "finalized"
    ) {
      const failure = classifyExecutionFailure(result.status, result.err);
      return await finalizeReadinessCanaryRun(input.env, {
        runId,
        status: failure.status,
        runPatch: {
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
          metadata: {
            quote: asJsonObject(quoteSummary.quoteResponse),
            executionMeta: asJsonObject(result.executionMeta),
            ...(referenceGuard.enabled
              ? {
                  referencePrice: {
                    verdict: referenceGuard.verdict,
                    reason: referenceGuard.reason,
                    executionPrice: referenceGuard.executionPrice,
                    executionDivergenceBps:
                      referenceGuard.executionDivergenceBps,
                    snapshot: referenceGuard.snapshot,
                  },
                }
              : {}),
          },
        },
      });
    }

    const transaction =
      result.signature !== null
        ? await rpc.getTransactionParsed(result.signature, {
            commitment: "confirmed",
          })
        : null;
    const feeLamports = readReconciliationFeeLamports(transaction);
    const afterBalances = await readBalances({
      rpc,
      walletAddress: wallet.walletAddress,
      inputMint: context.inputMint,
      outputMint: context.outputMint,
    });
    const actualOutputAtomic =
      context.outputMint === SOL_MINT
        ? afterBalances.outputAtomic - beforeBalances.outputAtomic + feeLamports
        : afterBalances.outputAtomic - beforeBalances.outputAtomic;
    const minExpectedOutAtomic =
      parseBigIntLike(quoteSummary.minExpectedOutAtomic) ?? 0n;
    const reconciliationPassed =
      readTransactionError(transaction) === null &&
      actualOutputAtomic > 0n &&
      actualOutputAtomic >= minExpectedOutAtomic;

    return await finalizeReadinessCanaryRun(input.env, {
      runId,
      status: reconciliationPassed ? "success" : "failed",
      runPatch: {
        receiptId: `receipt_${runId.slice(-16)}`,
        signature: result.signature ?? null ?? undefined,
        errorCode: reconciliationPassed
          ? undefined
          : "strategy-lab-readiness-canary-reconciliation-failed",
        errorMessage: reconciliationPassed
          ? undefined
          : "strategy-lab-readiness-canary-reconciliation-failed",
        reconciliation: {
          status: reconciliationPassed ? "passed" : "failed",
          actualOutputAtomic: actualOutputAtomic.toString(),
          minExpectedOutAtomic: minExpectedOutAtomic.toString(),
          notes: [
            `status=${result.status}`,
            `priceImpactPct=${readQuotePriceImpactPct(quoteSummary.quoteResponse)}`,
          ],
        },
        evidenceRefs: [
          {
            kind: "live_canary",
            ref: `signature:${result.signature ?? "missing"}`,
          },
        ],
        metadata: {
          quote: asJsonObject(quoteSummary.quoteResponse),
          executionMeta: asJsonObject(result.executionMeta),
          ...(referenceGuard.enabled
            ? {
                referencePrice: {
                  verdict: referenceGuard.verdict,
                  reason: referenceGuard.reason,
                  executionPrice: referenceGuard.executionPrice,
                  executionDivergenceBps: referenceGuard.executionDivergenceBps,
                  snapshot: referenceGuard.snapshot,
                },
              }
            : {}),
          beforeBalances: {
            inputAtomic: beforeBalances.inputAtomic.toString(),
            outputAtomic: beforeBalances.outputAtomic.toString(),
            solLamports: beforeBalances.solLamports.toString(),
          },
          afterBalances: {
            inputAtomic: afterBalances.inputAtomic.toString(),
            outputAtomic: afterBalances.outputAtomic.toString(),
            solLamports: afterBalances.solLamports.toString(),
          },
        },
      },
    });
  } catch (error) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId,
      status: "failed",
      runPatch: {
        errorCode: normalizeExecutionErrorCode({
          error,
          fallback: "submission-failed",
        }),
        errorMessage: executionErrorMessage(error),
      },
    });
  }
}

export async function listRuntimeResearchReadinessCanaryWorkflow(input: {
  env: Env;
  runId?: string;
  subjectKind?: "venue" | "asset";
  subjectKey?: string;
  limit?: number;
}): Promise<{
  runs: Awaited<ReturnType<typeof listStrategyLabReadinessCanaryRuns>>;
  state: ReadinessCanaryStateRecord | null;
}> {
  const state = await getStrategyLabReadinessCanaryState(
    input.env.WAITLIST_DB,
    STRATEGY_LAB_READINESS_CANARY_KEY,
  );
  if (input.runId) {
    const run = await getStrategyLabReadinessCanaryRun(
      input.env.WAITLIST_DB,
      input.runId,
    );
    return {
      runs: run ? [run] : [],
      state,
    };
  }

  return {
    runs: await listStrategyLabReadinessCanaryRuns(input.env.WAITLIST_DB, {
      subjectKind: input.subjectKind,
      subjectKey: input.subjectKey,
      limit: input.limit,
    }),
    state,
  };
}
