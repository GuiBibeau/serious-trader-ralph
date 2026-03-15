import {
  buildRuntimeResearchReadinessCanaryMarkdown,
  buildRuntimeStrategyLabSubjectControlRecord,
  type RuntimeResearchReadinessCanaryRequest,
  type RuntimeResearchVenueTxSmokeIntentFamily,
} from "../../../src/runtime/research/readiness.js";
import {
  requireRuntimeVenueCapability,
  runtimeVenueSupportsIntentFamily,
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
  executeIntentViaRouter,
  executeSwapViaRouter,
  resolveExecutionAdapterRegistration,
} from "./execution/router";
import { evaluateSafeLaneTransaction } from "./execution/safe_lane_policy";
import { quoteSpotSwap } from "./execution/spot_venues";
import type { JupiterQuoteResponse } from "./jupiter";
import { JupiterClient } from "./jupiter";
import {
  executionLaneRuntimeControlsFromSnapshot,
  readOpsControlSnapshot,
} from "./ops_controls";
import { evaluateOracleReferencePriceGuard } from "./oracle_reference";
import type { OrcaClient } from "./orca";
import { enforcePolicy, normalizePolicy } from "./policy";
import {
  createPrivySolanaWallet,
  getPrivyWalletAddressById,
  signTransactionWithPrivyById,
} from "./privy";
import { RaydiumClient } from "./raydium";
import { SolanaRpc } from "./solana_rpc";
import {
  createStrategyLabReadinessCanaryRun,
  getStrategyLabReadinessCanaryDailySpendUsd,
  getStrategyLabReadinessCanaryRun,
  getStrategyLabReadinessCanaryState,
  getStrategyLabSubjectControl,
  listStrategyLabReadinessCanaryRuns,
  type ReadinessCanaryStateRecord,
  updateStrategyLabReadinessCanaryRun,
  updateStrategyLabReadinessCanaryState,
  writeStrategyLabSubjectControl,
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

function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  return readBooleanEnv(value, fallback);
}

function readOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readOptionalString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function readSmokeIntentFamily(
  request: RuntimeResearchReadinessCanaryRequest | Record<string, unknown>,
): RuntimeResearchVenueTxSmokeIntentFamily {
  const raw =
    "smokeIntentFamily" in request
      ? readOptionalString(request.smokeIntentFamily)
      : undefined;
  if (raw === "conditional_spot_order") return "conditional_spot_order";
  if (raw === "clob_order") return "clob_order";
  return "spot_swap";
}

function readSmokeOrderSide(
  request: RuntimeResearchReadinessCanaryRequest | Record<string, unknown>,
): "buy" | "sell" {
  const raw =
    "smokeOrderSide" in request
      ? readOptionalString(request.smokeOrderSide)
      : undefined;
  return raw === "sell" ? "sell" : "buy";
}

function pow10(exp: number): bigint {
  return 10n ** BigInt(Math.max(0, Math.floor(exp)));
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("invalid-readiness-canary-denominator");
  }
  return (numerator + denominator - 1n) / denominator;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  if (isRecord(value)) {
    const message = readOptionalString(value.message);
    if (message) return message.slice(0, 2_000);
    try {
      return JSON.stringify(value).slice(0, 2_000);
    } catch {
      return null;
    }
  }
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

function readProofMode(
  request: RuntimeResearchReadinessCanaryRequest,
): "readiness_canary" | "venue_tx_smoke" {
  return request.proofMode === "venue_tx_smoke"
    ? "venue_tx_smoke"
    : "readiness_canary";
}

function allowsVenueTxSmokeLiveBypass(
  request: RuntimeResearchReadinessCanaryRequest,
  venueKey: string,
): boolean {
  if (readProofMode(request) !== "venue_tx_smoke") {
    return false;
  }
  const smokeIntentFamily = readSmokeIntentFamily(request);
  if (smokeIntentFamily === "spot_swap") {
    return venueKey === "raydium" || venueKey === "orca";
  }
  if (smokeIntentFamily === "clob_order") {
    return venueKey === "openbook";
  }
  return false;
}

function readFailureControlMode(
  request: RuntimeResearchReadinessCanaryRequest | Record<string, unknown>,
): "disable_live" | "engage_kill_switch" {
  const raw =
    "failureControlMode" in request
      ? readOptionalString(request.failureControlMode)
      : undefined;
  return raw === "engage_kill_switch" ? "engage_kill_switch" : "disable_live";
}

function shouldTightenOnFailure(
  request: RuntimeResearchReadinessCanaryRequest | Record<string, unknown>,
): boolean {
  const proofMode =
    "proofMode" in request ? readOptionalString(request.proofMode) : undefined;
  if (proofMode !== "venue_tx_smoke") {
    return false;
  }
  return "tightenOnFailure" in request
    ? readBoolean(request.tightenOnFailure, true)
    : true;
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
  const smokeIntentFamily = readSmokeIntentFamily(request);
  const smokeOrderSide = readSmokeOrderSide(request);
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

  const pairAssetMint =
    pair.baseMint === USDC_MINT ? pair.quoteMint : pair.baseMint;
  const inputMint =
    smokeIntentFamily === "clob_order"
      ? smokeOrderSide === "sell"
        ? pair.baseMint
        : pair.quoteMint
      : USDC_MINT;
  const effectiveOutputMint =
    smokeIntentFamily === "clob_order"
      ? smokeOrderSide === "sell"
        ? pair.quoteMint
        : pair.baseMint
      : pairAssetMint;
  const assetKey =
    request.assetKey ??
    (request.subjectKind === "asset"
      ? request.subjectKey
      : (TRADING_TOKEN_BY_MINT[pairAssetMint]?.symbol ?? ""));
  if (!assetKey || assetKey === "USDC") {
    throw new Error("strategy-lab-readiness-canary-asset-unresolved");
  }

  const capability = requireRuntimeVenueCapability(venueKey);
  const allowSmokeLiveBypass = allowsVenueTxSmokeLiveBypass(request, venueKey);
  if (!runtimeVenueSupportsIntentFamily(capability, smokeIntentFamily)) {
    throw new Error(
      `strategy-lab-readiness-canary-intent-family-unsupported:${venueKey}:${smokeIntentFamily}`,
    );
  }
  if (!runtimeVenueSupportsMode(capability, "live") && !allowSmokeLiveBypass) {
    throw new Error(`strategy-lab-readiness-canary-venue-not-live:${venueKey}`);
  }

  const adapterKey =
    request.adapterKey ??
    capability.adapterKeys.find((candidate) => {
      const registration = resolveExecutionAdapterRegistration(candidate);
      return (
        registration !== null &&
        registration.venueKey === venueKey &&
        registration.supportedIntentFamilies.includes(smokeIntentFamily) &&
        (registration.supportedModes.includes("live") || allowSmokeLiveBypass)
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
    inputMint,
    outputMint: effectiveOutputMint,
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
  orca?: OrcaClient;
  raydium?: RaydiumClient;
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
  const { quoteResponse } = await quoteSpotSwap({
    venueKey: input.context.venueKey,
    inputMint: input.context.inputMint,
    outputMint: input.context.outputMint,
    amountAtomic,
    slippageBps: input.config.maxSlippageBps,
    jupiter: input.jupiter,
    orca: input.orca,
    raydium: input.raydium,
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

function parseUiDecimalToAtomic(value: string, decimals: number): bigint {
  const normalized = value.trim();
  const match = normalized.match(/^([0-9]+)(?:\.([0-9]+))?$/);
  if (!match) {
    throw new Error("openbook-ui-decimal-invalid");
  }
  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return whole * pow10(decimals) + BigInt(fraction || "0");
}

function computeOpenBookQuantityAtomic(input: {
  targetNotionalUsd: string;
  side: "buy" | "sell";
  market: {
    bestBidPriceUi: number | null;
    bestAskPriceUi: number | null;
    minOrderSizeUi: string;
    baseDecimals: number;
    quoteDecimals: number;
  };
}): string {
  const referencePriceUi =
    input.side === "buy"
      ? input.market.bestAskPriceUi
      : input.market.bestBidPriceUi;
  if (!referencePriceUi || referencePriceUi <= 0) {
    throw new Error("openbook-orderbook-liquidity-missing");
  }
  const targetNotionalAtomic = parseUsdAtomic(input.targetNotionalUsd);
  const priceAtomic = BigInt(
    Math.max(
      1,
      Math.round(referencePriceUi * 10 ** input.market.quoteDecimals),
    ),
  );
  const targetQuantityAtomic = ceilDiv(
    targetNotionalAtomic * pow10(input.market.baseDecimals),
    priceAtomic,
  );
  const minOrderAtomic = parseUiDecimalToAtomic(
    input.market.minOrderSizeUi,
    input.market.baseDecimals,
  );
  return (
    targetQuantityAtomic > minOrderAtomic
      ? targetQuantityAtomic
      : minOrderAtomic
  ).toString();
}

function findOpenBookOrderByClientOrderId(input: {
  summary: { orders: Array<{ clientOrderId: string }> };
  clientOrderId: string;
}): { clientOrderId: string } | undefined {
  return input.summary.orders.find(
    (order) => String(order.clientOrderId) === input.clientOrderId,
  );
}

async function submitPrivyManagedTransactionPlan(input: {
  env: Env;
  rpc: SolanaRpc;
  walletId: string;
  unsignedTransactionBase64: string;
  label: string;
}): Promise<
  | { ok: true; signature: string; status: "confirmed" | "finalized" }
  | { ok: false; errorCode: CanonicalExecutionErrorCode; errorMessage: string }
> {
  const signedBase64 = await signTransactionWithPrivyById(
    input.env,
    input.walletId,
    input.unsignedTransactionBase64,
  );
  const safeEvaluation = evaluateSafeLaneTransaction({
    env: input.env,
    signedTransactionBase64: signedBase64,
  });
  if (!safeEvaluation.ok) {
    return {
      ok: false,
      errorCode: "policy-denied",
      errorMessage: `${input.label}:${safeEvaluation.reason}`,
    };
  }
  const simulation = await input.rpc.simulateTransactionBase64(signedBase64, {
    commitment: "confirmed",
    sigVerify: true,
  });
  if (simulation.err) {
    return {
      ok: false,
      errorCode: normalizeExecutionErrorCode({
        error: simulation.err,
        fallback: "simulation-failed",
      }),
      errorMessage: executionErrorMessage(simulation.err) ?? input.label,
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
      errorCode: normalizeExecutionErrorCode({
        error: confirmation.err,
        fallback: "submission-failed",
      }),
      errorMessage:
        executionErrorMessage(confirmation.err) ??
        `${input.label}:confirmation-failed`,
    };
  }
  return {
    ok: true,
    signature,
    status: confirmation.status === "confirmed" ? "confirmed" : "finalized",
  };
}

function mergeMetadata(
  current: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(isRecord(current) ? current : {}),
    ...patch,
  };
}

async function applyVenueSmokeFailureControl(input: {
  env: Env;
  run: NonNullable<RuntimeResearchReadinessCanaryWorkflowResult["run"]>;
}): Promise<NonNullable<RuntimeResearchReadinessCanaryWorkflowResult["run"]>> {
  const metadata = isRecord(input.run.metadata) ? input.run.metadata : {};
  if (
    input.run.subjectKind !== "venue" ||
    !shouldTightenOnFailure(metadata) ||
    input.run.status === "success"
  ) {
    return input.run;
  }

  const existing = await getStrategyLabSubjectControl(
    input.env.WAITLIST_DB,
    "venue",
    input.run.subjectKey,
  );
  const controlMode = readFailureControlMode(metadata);
  const updatedBy =
    readOptionalString(metadata.requestedBy) ?? "system:venue-tx-smoke";
  const disabledReason = `venue-tx-smoke-${input.run.status}:${input.run.runId}`;
  const control = buildRuntimeStrategyLabSubjectControlRecord({
    existing,
    patch: {
      subjectKind: "venue",
      subjectKey: input.run.subjectKey,
      liveAllowed: false,
      ...(controlMode === "engage_kill_switch"
        ? { killSwitchEnabled: true }
        : {}),
      disabledReason,
      updatedBy,
      metadata: {
        source: "venue_tx_smoke",
        runId: input.run.runId,
        mode: controlMode,
      },
    },
  });
  await writeStrategyLabSubjectControl(input.env.WAITLIST_DB, control);

  return (await updateStrategyLabReadinessCanaryRun(input.env.WAITLIST_DB, {
    ...input.run,
    evidenceRefs: [
      ...input.run.evidenceRefs,
      {
        kind: "subject_control_patch",
        ref: `subject-control:venue:${input.run.subjectKey}:${controlMode}`,
      },
    ],
    metadata: mergeMetadata(input.run.metadata, {
      smokeFailureControl: {
        applied: true,
        mode: controlMode,
        subjectKind: "venue",
        subjectKey: input.run.subjectKey,
        liveAllowed: control.liveAllowed,
        killSwitchEnabled: control.killSwitchEnabled,
        disabledReason: control.disabledReason ?? null,
        updatedAt: control.updatedAt,
        updatedBy: control.updatedBy ?? null,
      },
    }),
  })) as NonNullable<RuntimeResearchReadinessCanaryWorkflowResult["run"]>;
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
  const runPatch =
    input.runPatch && isRecord(input.runPatch.metadata)
      ? {
          ...input.runPatch,
          metadata: mergeMetadata(current.metadata, input.runPatch.metadata),
        }
      : input.runPatch;
  const run = await updateStrategyLabReadinessCanaryRun(env.WAITLIST_DB, {
    ...current,
    status: input.status,
    ...(runPatch ?? {}),
    completedAt,
  });
  const nextRun =
    run && input.status !== "success"
      ? await applyVenueSmokeFailureControl({
          env,
          run: run as NonNullable<
            RuntimeResearchReadinessCanaryWorkflowResult["run"]
          >,
        })
      : run;
  const state = await updateStrategyLabReadinessCanaryState(env.WAITLIST_DB, {
    canaryKey: STRATEGY_LAB_READINESS_CANARY_KEY,
    lastRunId: input.runId,
    lastRunAt: completedAt,
  });
  return {
    ok: input.status === "success",
    status: input.status,
    run: nextRun,
    state,
    markdown: nextRun
      ? buildRuntimeResearchReadinessCanaryMarkdown(nextRun)
      : null,
    ...(input.status === "success"
      ? {}
      : {
          error:
            runPatch && "errorMessage" in runPatch
              ? (runPatch.errorMessage as string | undefined)
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
    proofMode: readProofMode(input.request),
    smokeIntentFamily: readSmokeIntentFamily(input.request),
    smokeOrderSide: readSmokeOrderSide(input.request),
    tightenOnFailure: shouldTightenOnFailure(input.request),
    failureControlMode: readFailureControlMode(input.request),
    killDrillNotes: readStringArray(input.request.killDrillNotes),
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

async function runOpenBookVenueTxSmoke(input: {
  env: Env;
  request: RuntimeResearchReadinessCanaryRequest;
  context: CanaryPairContext;
  config: StrategyLabReadinessCanaryConfig;
  wallet: StrategyLabReadinessCanaryWallet;
  runId: string;
  targetNotionalUsd: string;
  submissionPath: {
    venueKey: string;
    adapterKey: string;
    lane: string;
    adapter: string;
  };
  laneResolution: { lane: string };
  rpc: SolanaRpc;
  jupiter: JupiterClient;
}): Promise<RuntimeResearchReadinessCanaryWorkflowResult> {
  const smokeOrderSide = readSmokeOrderSide(input.request);
  const openbook = new (await import("./openbook")).OpenBookClient(
    String(input.env.RPC_ENDPOINT ?? "").trim(),
    undefined,
  );
  const summaryBefore = await openbook.listOpenOrders({
    walletPublicKey: input.wallet.walletAddress,
    instrumentId: input.context.pairSymbol,
  });
  const quantityAtomic = computeOpenBookQuantityAtomic({
    targetNotionalUsd: input.targetNotionalUsd,
    side: smokeOrderSide,
    market: summaryBefore.market,
  });
  const intent = {
    family: "clob_order" as const,
    wallet: input.wallet.walletAddress,
    venueKey: "openbook" as const,
    marketType: "spot" as const,
    instrumentId: input.context.pairSymbol,
    side: smokeOrderSide,
    quantityAtomic,
    params: {
      orderType: "limit",
      timeInForce: "ioc",
      quantityMode: "base",
    },
  };
  const plan = await openbook.buildPlaceOrderPlan({
    walletPublicKey: input.wallet.walletAddress,
    instrumentId: input.context.pairSymbol,
    side: smokeOrderSide,
    quantityAtomic,
    options: intent.params,
  });
  const inputAmountAtomic =
    smokeOrderSide === "buy"
      ? String(plan.quotePreview.inAmount ?? "")
      : quantityAtomic;
  const policy = normalizePolicy({
    allowedMints: [input.context.inputMint, input.context.outputMint],
    slippageBps: input.config.maxSlippageBps,
    maxPriceImpactPct: 0.05,
    minSolReserveLamports: input.config.minSolReserveLamports,
    simulateOnly: false,
    dryRun: false,
    commitment: "finalized",
    maxTradeAmountAtomic: inputAmountAtomic,
  });
  const runtimeBalancePolicy = await evaluatePrivyRuntimeBalancePolicy({
    env: input.env,
    lane: "safe",
    walletAddress: input.wallet.walletAddress,
    inputMint: input.context.inputMint,
    amountAtomic: inputAmountAtomic,
    minSolReserveLamports: input.config.minSolReserveLamports,
    rpc: input.rpc,
    runtimeDefaults: null,
  });
  if (!runtimeBalancePolicy.ok) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "blocked",
      runPatch: {
        errorCode: "policy-denied",
        errorMessage: runtimeBalancePolicy.reason,
        metadata: {
          submissionPath: input.submissionPath,
          smokeIntentFamily: "clob_order",
          smokeOrderSide,
          runtimePolicy: runtimeBalancePolicy.metadata,
        },
      },
    });
  }
  const referenceGuard = await evaluateOracleReferencePriceGuard({
    env: input.env,
    mode: "live",
    inputMint: input.context.inputMint,
    outputMint: input.context.outputMint,
    inputAmountAtomic,
    expectedOutputAmountAtomic: String(plan.quotePreview.outAmount ?? ""),
    jupiter: input.jupiter,
  });
  if (referenceGuard.enabled && referenceGuard.verdict !== "allow") {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "blocked",
      runPatch: {
        errorCode: "policy-denied",
        errorMessage: referenceGuard.reason ?? "reference-price-policy-denied",
        metadata: {
          smokeIntentFamily: "clob_order",
          smokeOrderSide,
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
    rpc: input.rpc,
    walletAddress: input.wallet.walletAddress,
    inputMint: input.context.inputMint,
    outputMint: input.context.outputMint,
  });

  const result = await executeIntentViaRouter({
    env: input.env,
    venueKey: input.context.venueKey,
    runtimeMode: "live",
    experimentalLiveModeBypass: "venue_tx_smoke",
    requireVenueRouting: true,
    subjectControlBypassReason: "strategy_lab_readiness_canary",
    execution: {
      adapter: input.context.adapterKey,
      params: {
        lane: input.laneResolution.lane,
        requireSimulation: true,
      },
    },
    policy,
    rpc: input.rpc,
    jupiter: input.jupiter,
    openbook,
    intent,
    privyWalletId: input.wallet.walletId,
    log(level, message, meta) {
      console[level]("strategy_lab.readiness_canary", {
        runId: input.runId,
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
      runId: input.runId,
      status: failure.status,
      runPatch: {
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        metadata: {
          submissionPath: {
            ...input.submissionPath,
            landingStatus: result.status,
          },
          smokeIntentFamily: "clob_order",
          smokeOrderSide,
          executionMeta: asJsonObject(result.executionMeta),
        },
      },
    });
  }

  const clientOrderId =
    readOptionalString(result.executionMeta?.intentId) ??
    plan.request.clientOrderId;
  await sleep(2_000);
  const summaryAfterPlace = await openbook.listOpenOrders({
    walletPublicKey: input.wallet.walletAddress,
    instrumentId: input.context.pairSymbol,
  });
  const openOrderAfterPlace = findOpenBookOrderByClientOrderId({
    summary: summaryAfterPlace,
    clientOrderId,
  });

  let cancelSignature: string | null = null;
  let cancelStatus: string | null = null;
  let cancelError: string | null = null;
  let summaryAfterCancel = summaryAfterPlace;
  if (openOrderAfterPlace) {
    const cancelPlan = await openbook.buildCancelOrderPlan({
      walletPublicKey: input.wallet.walletAddress,
      instrumentId: input.context.pairSymbol,
      clientOrderId,
    });
    const cancelResult = await submitPrivyManagedTransactionPlan({
      env: input.env,
      rpc: input.rpc,
      walletId: input.wallet.walletId,
      unsignedTransactionBase64: cancelPlan.unsignedTransactionBase64,
      label: "openbook-cancel",
    });
    if (!cancelResult.ok) {
      cancelError = cancelResult.errorMessage;
    } else {
      cancelSignature = cancelResult.signature;
      cancelStatus = cancelResult.status;
      await sleep(2_000);
      summaryAfterCancel = await openbook.listOpenOrders({
        walletPublicKey: input.wallet.walletAddress,
        instrumentId: input.context.pairSymbol,
      });
    }
  }

  const openOrderAfterFinal = findOpenBookOrderByClientOrderId({
    summary: summaryAfterCancel,
    clientOrderId,
  });
  const placeTransaction =
    result.signature !== null
      ? await input.rpc.getTransactionParsed(result.signature, {
          commitment: "confirmed",
        })
      : null;
  const cancelTransaction =
    cancelSignature !== null
      ? await input.rpc.getTransactionParsed(cancelSignature, {
          commitment: "confirmed",
        })
      : null;
  const placeFeeLamports = readReconciliationFeeLamports(placeTransaction);
  const cancelFeeLamports = readReconciliationFeeLamports(cancelTransaction);
  const totalFeeLamports = placeFeeLamports + cancelFeeLamports;
  const afterBalances = await readBalances({
    rpc: input.rpc,
    walletAddress: input.wallet.walletAddress,
    inputMint: input.context.inputMint,
    outputMint: input.context.outputMint,
  });
  const actualOutputAtomic =
    input.context.outputMint === SOL_MINT
      ? afterBalances.outputAtomic -
        beforeBalances.outputAtomic +
        totalFeeLamports
      : afterBalances.outputAtomic - beforeBalances.outputAtomic;
  const terminalLifecycleReached =
    openOrderAfterFinal === undefined && cancelError === null;
  const reconciliationPassed =
    readTransactionError(placeTransaction) === null &&
    readTransactionError(cancelTransaction) === null &&
    terminalLifecycleReached;
  const venueOrderState =
    actualOutputAtomic > 0n
      ? "filled_or_partially_filled"
      : openOrderAfterPlace
        ? "cancelled"
        : "ioc_terminal";

  return await finalizeReadinessCanaryRun(input.env, {
    runId: input.runId,
    status: reconciliationPassed ? "success" : "failed",
    runPatch: {
      receiptId: `receipt_${input.runId.slice(-16)}`,
      signature: result.signature ?? undefined,
      ...(reconciliationPassed
        ? {}
        : {
            errorCode: "strategy-lab-readiness-canary-reconciliation-failed",
            errorMessage:
              cancelError ??
              "strategy-lab-readiness-canary-reconciliation-failed",
          }),
      reconciliation: {
        status: reconciliationPassed ? "passed" : "failed",
        actualOutputAtomic: actualOutputAtomic.toString(),
        minExpectedOutAtomic: "0",
        notes: [
          `status=${result.status}`,
          `smokeOrderSide=${smokeOrderSide}`,
          `venueOrderState=${venueOrderState}`,
          `ordersBefore=${summaryBefore.orderCount}`,
          `ordersAfterPlace=${summaryAfterPlace.orderCount}`,
          `ordersAfterFinal=${summaryAfterCancel.orderCount}`,
          ...(cancelStatus ? [`cancelStatus=${cancelStatus}`] : []),
        ],
      },
      evidenceRefs: [
        {
          kind: "live_canary",
          ref: `signature:${result.signature ?? "missing"}`,
        },
        ...(cancelSignature
          ? [
              {
                kind: "cancel_tx",
                ref: `signature:${cancelSignature}`,
              },
            ]
          : []),
      ],
      metadata: {
        submissionPath: {
          ...input.submissionPath,
          landingStatus: result.status,
          ...(cancelStatus ? { cancelLandingStatus: cancelStatus } : {}),
        },
        smokeIntentFamily: "clob_order",
        smokeOrderSide,
        venueOrderId: clientOrderId,
        ...(cancelSignature ? { cancelSignature } : {}),
        executionMeta: asJsonObject(result.executionMeta),
        feeLamports: totalFeeLamports.toString(),
        placeFeeLamports: placeFeeLamports.toString(),
        cancelFeeLamports: cancelFeeLamports.toString(),
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
        openOrders: {
          before: {
            orderCount: summaryBefore.orderCount,
          },
          afterPlace: {
            orderCount: summaryAfterPlace.orderCount,
          },
          afterFinal: {
            orderCount: summaryAfterCancel.orderCount,
          },
        },
      },
    },
  });
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
      proofMode: readProofMode(input.request),
      smokeIntentFamily: readSmokeIntentFamily(input.request),
      smokeOrderSide: readSmokeOrderSide(input.request),
      tightenOnFailure: shouldTightenOnFailure(input.request),
      failureControlMode: readFailureControlMode(input.request),
      killDrillNotes: readStringArray(input.request.killDrillNotes),
      ...(input.request.metadata
        ? { requestMetadata: input.request.metadata }
        : {}),
      walletCreated: wallet.created,
    },
  });
  const smokeIntentFamily = readSmokeIntentFamily(input.request);
  if (smokeIntentFamily === "conditional_spot_order") {
    return await finalizeReadinessCanaryRun(input.env, {
      runId,
      status: "blocked",
      runPatch: {
        errorCode: "policy-denied",
        errorMessage:
          "strategy-lab-readiness-canary-intent-family-not-implemented:conditional_spot_order",
        metadata: {
          smokeIntentFamily,
          smokeOrderSide: readSmokeOrderSide(input.request),
        },
      },
    });
  }

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
  const submissionPath = {
    venueKey: context.venueKey,
    adapterKey: context.adapterKey,
    lane: laneResolution.lane,
    adapter: context.adapterKey,
  };

  const rpc = SolanaRpc.fromEnv(input.env);
  const jupiter = new JupiterClient(
    String(input.env.JUPITER_BASE_URL ?? "").trim() ||
      "https://lite-api.jup.ag",
    input.env.JUPITER_API_KEY,
  );
  const raydium =
    context.venueKey === "raydium" ? new RaydiumClient() : undefined;
  const orca =
    context.venueKey === "orca"
      ? new (await import("./orca")).OrcaClient(
          String(input.env.RPC_ENDPOINT ?? "").trim(),
        )
      : undefined;
  if (smokeIntentFamily === "clob_order") {
    try {
      return await runOpenBookVenueTxSmoke({
        env: input.env,
        request: input.request,
        context,
        config,
        wallet,
        runId,
        targetNotionalUsd,
        submissionPath,
        laneResolution: { lane: laneResolution.lane },
        rpc,
        jupiter,
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
          metadata: {
            submissionPath,
            smokeIntentFamily,
            smokeOrderSide: readSmokeOrderSide(input.request),
          },
        },
      });
    }
  }

  let quoteSummary: Awaited<ReturnType<typeof fetchCanaryQuote>>;
  try {
    quoteSummary = await fetchCanaryQuote({
      jupiter,
      raydium,
      orca,
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
          submissionPath,
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
      experimentalLiveModeBypass:
        readProofMode(input.request) === "venue_tx_smoke"
          ? "venue_tx_smoke"
          : undefined,
      requireVenueRouting: true,
      subjectControlBypassReason: "strategy_lab_readiness_canary",
      execution: {
        adapter: context.adapterKey,
        params: {
          lane: laneResolution.lane,
          requireSimulation: true,
        },
      },
      policy,
      rpc,
      jupiter,
      raydium,
      orca,
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
            submissionPath: {
              ...submissionPath,
              landingStatus: result.status,
            },
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
          submissionPath: {
            ...submissionPath,
            landingStatus: result.status,
          },
          quote: asJsonObject(quoteSummary.quoteResponse),
          executionMeta: asJsonObject(result.executionMeta),
          feeLamports: feeLamports.toString(),
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
        metadata: {
          submissionPath,
        },
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
