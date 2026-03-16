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
  SUPPORTED_TRADING_TOKENS,
  TRADING_TOKEN_BY_MINT,
  USDC_MINT,
} from "./defaults";
import { DFlowClient } from "./dflow";
import { DriftClient } from "./drift";
import type { DriftLiveAccountSnapshot } from "./drift_live";
import {
  type CanonicalExecutionErrorCode,
  normalizeExecutionErrorCode,
} from "./execution/error_taxonomy";
import {
  findJupiterTriggerOrderByKey,
  JUPITER_TRIGGER_PRICE_DECIMALS,
  type JupiterTrackedTriggerOrder,
  summarizeJupiterTriggerOrder,
} from "./execution/jupiter_trigger";
import { resolveExecutionLane } from "./execution/lane_resolver";
import { evaluatePrivyRuntimeBalancePolicy } from "./execution/policy_engine";
import {
  executeIntentViaRouter,
  executeSwapViaRouter,
  resolveExecutionAdapterRegistration,
} from "./execution/router";
import { evaluateSafeLaneTransaction } from "./execution/safe_lane_policy";
import { quoteSpotSwap } from "./execution/spot_venues";
import type { ExecuteSwapResult } from "./execution/types";
import type {
  JupiterQuoteResponse,
  JupiterTriggerOrderRecord,
} from "./jupiter";
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
const JUPITER_TRIGGER_SMOKE_MARGIN_BPS = 1_000n;
const JUPITER_TRIGGER_SMOKE_MAX_PAGES = 25;
const JUPITER_TRIGGER_SMOKE_POLL_ATTEMPTS = 8;
const JUPITER_TRIGGER_SMOKE_POLL_DELAY_MS = 750;

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
  marketType: "spot" | "perp" | "prediction";
  intentFamily: "spot_swap" | "perp_order" | "prediction_order";
  instrumentId?: string;
  predictionOutcomeId?: string;
  predictionOutcomeSide?: "yes" | "no";
};

type CanarySubmissionPath = {
  venueKey: string;
  adapterKey: string;
  lane: string;
  adapter: string;
};

type DriftLiveModule = typeof import("./drift_live");

let driftLiveModulePromise: Promise<DriftLiveModule> | null = null;

async function loadDriftLiveModule(): Promise<DriftLiveModule> {
  driftLiveModulePromise ??= import("./drift_live");
  return await driftLiveModulePromise;
}

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

function readDFlowSmokeMetadata(input: {
  request: RuntimeResearchReadinessCanaryRequest;
}): {
  instrumentId: string;
  outcomeId: string;
  outcomeSide: "yes" | "no";
  settlementMint: string;
} {
  const metadata = isRecord(input.request.metadata)
    ? input.request.metadata
    : {};
  const instrumentId =
    readOptionalString(metadata.instrumentId) ??
    readOptionalString(input.request.pairSymbol);
  const outcomeId = readOptionalString(metadata.outcomeId);
  const outcomeSideRaw =
    readOptionalString(metadata.outcomeSide)?.toLowerCase() ?? "yes";
  const outcomeSide = outcomeSideRaw === "no" ? "no" : "yes";
  const settlementMint =
    readOptionalString(metadata.settlementMint) ?? USDC_MINT;
  if (!instrumentId) {
    throw new Error(
      "strategy-lab-readiness-canary-dflow-instrument-id-required",
    );
  }
  if (!outcomeId) {
    throw new Error("strategy-lab-readiness-canary-dflow-outcome-id-required");
  }
  return {
    instrumentId,
    outcomeId,
    outcomeSide,
    settlementMint,
  };
}

function readSmokeIntentFamily(
  request: RuntimeResearchReadinessCanaryRequest | Record<string, unknown>,
): RuntimeResearchVenueTxSmokeIntentFamily {
  const raw =
    "smokeIntentFamily" in request
      ? readOptionalString(request.smokeIntentFamily)
      : undefined;
  if (raw === "prediction_order") return "prediction_order";
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

function parseSignedBigIntLike(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  const raw = String(value ?? "").trim();
  if (!raw || !/^-?[0-9]+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function absoluteAtomic(value: unknown): string | null {
  const parsed = parseSignedBigIntLike(value);
  if (parsed === null) return null;
  return (parsed < 0n ? -parsed : parsed).toString();
}

function resolveDriftSmokeUnderlyingMintForCanary(
  instrumentId: string,
): string {
  const symbol = instrumentId
    .trim()
    .toUpperCase()
    .replace(/-PERP$/, "");
  if (symbol === "SOL") return SOL_MINT;
  const token =
    SUPPORTED_TRADING_TOKENS.find(
      (entry) => entry.symbol.toUpperCase() === symbol,
    ) ?? null;
  if (!token) {
    throw new Error(
      `strategy-lab-readiness-canary-drift-underlying-mint-unresolved:${instrumentId}`,
    );
  }
  return token.mint;
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
  if (venueKey === "drift") {
    return true;
  }
  if (smokeIntentFamily === "spot_swap") {
    return venueKey === "raydium" || venueKey === "orca";
  }
  if (smokeIntentFamily === "clob_order") {
    return venueKey === "openbook";
  }
  if (smokeIntentFamily === "prediction_order") {
    return venueKey === "dflow";
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
  const capability = requireRuntimeVenueCapability(venueKey);
  const allowSmokeLiveBypass = allowsVenueTxSmokeLiveBypass(request, venueKey);
  if (!runtimeVenueSupportsMode(capability, "live") && !allowSmokeLiveBypass) {
    throw new Error(`strategy-lab-readiness-canary-venue-not-live:${venueKey}`);
  }

  if (venueKey === "dflow") {
    if (smokeIntentFamily !== "prediction_order") {
      throw new Error(
        `strategy-lab-readiness-canary-intent-family-unsupported:${venueKey}:${smokeIntentFamily}`,
      );
    }
    const prediction = readDFlowSmokeMetadata({ request });
    const assetKey =
      request.assetKey ??
      (request.subjectKind === "asset"
        ? request.subjectKey
        : prediction.instrumentId);
    const requestedAdapterKey = readOptionalString(request.adapterKey);
    const adapterKey =
      requestedAdapterKey ??
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
    if (requestedAdapterKey) {
      const registration =
        resolveExecutionAdapterRegistration(requestedAdapterKey);
      if (
        !registration ||
        registration.venueKey !== venueKey ||
        !registration.supportedIntentFamilies.includes(smokeIntentFamily) ||
        (!registration.supportedModes.includes("live") && !allowSmokeLiveBypass)
      ) {
        throw new Error(
          `strategy-lab-readiness-canary-adapter-unavailable:${venueKey}:${requestedAdapterKey}:${smokeIntentFamily}`,
        );
      }
    }
    return {
      venueKey,
      assetKey,
      pairSymbol: prediction.instrumentId,
      adapterKey,
      inputMint: prediction.settlementMint,
      outputMint: prediction.outcomeId,
      marketType: "prediction",
      intentFamily: "prediction_order",
      instrumentId: prediction.instrumentId,
      predictionOutcomeId: prediction.outcomeId,
      predictionOutcomeSide: prediction.outcomeSide,
    };
  }

  if (venueKey === "drift") {
    const instrumentId =
      request.pairSymbol ??
      (request.subjectKind === "asset"
        ? `${request.subjectKey}-PERP`
        : "SOL-PERP");
    const outputMint = resolveDriftSmokeUnderlyingMintForCanary(instrumentId);
    const assetKey =
      request.assetKey ??
      (request.subjectKind === "asset"
        ? request.subjectKey
        : (TRADING_TOKEN_BY_MINT[outputMint]?.symbol ??
          instrumentId.replace(/-PERP$/i, "")));
    if (!assetKey || assetKey === "USDC") {
      throw new Error("strategy-lab-readiness-canary-asset-unresolved");
    }
    const adapterKey =
      request.adapterKey ??
      capability.adapterKeys.find((candidate) => candidate === "drift");
    if (!adapterKey) {
      throw new Error(
        `strategy-lab-readiness-canary-adapter-unavailable:${venueKey}`,
      );
    }
    return {
      venueKey,
      assetKey,
      pairSymbol: instrumentId,
      adapterKey,
      inputMint: USDC_MINT,
      outputMint,
      marketType: "perp",
      intentFamily: "perp_order",
      instrumentId,
    };
  }

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

  if (!runtimeVenueSupportsIntentFamily(capability, smokeIntentFamily)) {
    throw new Error(
      `strategy-lab-readiness-canary-intent-family-unsupported:${venueKey}:${smokeIntentFamily}`,
    );
  }

  const requestedAdapterKey = readOptionalString(request.adapterKey);
  const adapterKey =
    requestedAdapterKey ??
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
  if (requestedAdapterKey) {
    const registration =
      resolveExecutionAdapterRegistration(requestedAdapterKey);
    if (
      !registration ||
      registration.venueKey !== venueKey ||
      !registration.supportedIntentFamilies.includes(smokeIntentFamily) ||
      (!registration.supportedModes.includes("live") && !allowSmokeLiveBypass)
    ) {
      throw new Error(
        `strategy-lab-readiness-canary-adapter-unavailable:${venueKey}:${requestedAdapterKey}:${smokeIntentFamily}`,
      );
    }
  }

  return {
    venueKey,
    assetKey,
    pairSymbol,
    adapterKey,
    inputMint,
    outputMint: effectiveOutputMint,
    marketType: "spot",
    intentFamily: "spot_swap",
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

function buildReferencePriceMetadata(
  referenceGuard: Awaited<ReturnType<typeof evaluateOracleReferencePriceGuard>>,
): Record<string, unknown> | null {
  if (!referenceGuard.enabled) {
    return null;
  }
  return {
    verdict: referenceGuard.verdict,
    reason: referenceGuard.reason,
    executionPrice: referenceGuard.executionPrice,
    executionDivergenceBps: referenceGuard.executionDivergenceBps,
    snapshot: referenceGuard.snapshot,
  };
}

function deriveJupiterTriggerSmokePriceAtomic(input: {
  context: CanaryPairContext;
  quoteSummary: Awaited<ReturnType<typeof fetchCanaryQuote>>;
  side: "buy" | "sell";
}): string {
  const inputToken = TRADING_TOKEN_BY_MINT[input.context.inputMint];
  const outputToken = TRADING_TOKEN_BY_MINT[input.context.outputMint];
  const inputAmountAtomic = parseBigIntLike(input.quoteSummary.amountAtomic);
  const quotedOutAtomic = parseBigIntLike(input.quoteSummary.quotedOutAtomic);
  if (!inputToken || !outputToken || !inputAmountAtomic || !quotedOutAtomic) {
    throw new Error("strategy-lab-readiness-canary-trigger-price-unavailable");
  }
  const currentPriceAtomic = ceilDiv(
    inputAmountAtomic *
      pow10(outputToken.decimals) *
      pow10(JUPITER_TRIGGER_PRICE_DECIMALS),
    quotedOutAtomic * pow10(inputToken.decimals),
  );
  if (currentPriceAtomic <= 0n) {
    throw new Error("strategy-lab-readiness-canary-trigger-price-invalid");
  }
  const triggerPriceAtomic = ceilDiv(
    input.side === "buy"
      ? currentPriceAtomic * (10_000n + JUPITER_TRIGGER_SMOKE_MARGIN_BPS)
      : currentPriceAtomic * (10_000n - JUPITER_TRIGGER_SMOKE_MARGIN_BPS),
    10_000n,
  );
  if (input.side === "buy") {
    return (
      triggerPriceAtomic > currentPriceAtomic
        ? triggerPriceAtomic
        : currentPriceAtomic + 1n
    ).toString();
  }
  return (triggerPriceAtomic > 0n ? triggerPriceAtomic : 1n).toString();
}

async function fetchJupiterTriggerOrder(input: {
  jupiter: JupiterClient;
  trackedOrder: JupiterTrackedTriggerOrder;
}): Promise<JupiterTriggerOrderRecord | null> {
  const searchOrders = async (
    orderStatus: "active" | "history",
  ): Promise<JupiterTriggerOrderRecord | null> => {
    let page = 1;
    let pageSize = 0;
    while (page <= JUPITER_TRIGGER_SMOKE_MAX_PAGES) {
      const response = await input.jupiter.getTriggerOrders({
        maker: input.trackedOrder.maker,
        orderStatus,
        page,
        ...(input.trackedOrder.inputMint
          ? { inputMint: input.trackedOrder.inputMint }
          : {}),
        ...(input.trackedOrder.outputMint
          ? { outputMint: input.trackedOrder.outputMint }
          : {}),
        includeFailedTx: true,
      });
      const match = findJupiterTriggerOrderByKey(
        response.orders,
        input.trackedOrder.order,
      );
      if (match) return match;
      if (response.orders.length === 0) return null;
      if (pageSize === 0) pageSize = response.orders.length;
      const totalPages = Math.max(
        1,
        Math.ceil(response.totalOrders / pageSize),
      );
      if (page >= totalPages) return null;
      page += 1;
    }
    return null;
  };

  const activeMatch = await searchOrders("active");
  if (activeMatch) return activeMatch;
  return await searchOrders("history");
}

async function pollJupiterTriggerOrderTerminal(input: {
  jupiter: JupiterClient;
  trackedOrder: JupiterTrackedTriggerOrder;
}): Promise<{
  orderRecord: JupiterTriggerOrderRecord | null;
  summary: ReturnType<typeof summarizeJupiterTriggerOrder>;
}> {
  let orderRecord: JupiterTriggerOrderRecord | null = null;
  let summary = summarizeJupiterTriggerOrder(null);
  for (
    let attempt = 0;
    attempt < JUPITER_TRIGGER_SMOKE_POLL_ATTEMPTS;
    attempt += 1
  ) {
    orderRecord = await fetchJupiterTriggerOrder({
      jupiter: input.jupiter,
      trackedOrder: input.trackedOrder,
    });
    summary = summarizeJupiterTriggerOrder(orderRecord);
    if (summary.terminalReason) {
      return {
        orderRecord,
        summary,
      };
    }
    if (attempt < JUPITER_TRIGGER_SMOKE_POLL_ATTEMPTS - 1) {
      await sleep(JUPITER_TRIGGER_SMOKE_POLL_DELAY_MS);
    }
  }
  return {
    orderRecord,
    summary,
  };
}

async function pollJupiterTriggerOrderVisible(input: {
  jupiter: JupiterClient;
  trackedOrder: JupiterTrackedTriggerOrder;
}): Promise<{
  orderRecord: JupiterTriggerOrderRecord | null;
  summary: ReturnType<typeof summarizeJupiterTriggerOrder>;
}> {
  let orderRecord: JupiterTriggerOrderRecord | null = null;
  let summary = summarizeJupiterTriggerOrder(null);
  for (
    let attempt = 0;
    attempt < JUPITER_TRIGGER_SMOKE_POLL_ATTEMPTS;
    attempt += 1
  ) {
    orderRecord = await fetchJupiterTriggerOrder({
      jupiter: input.jupiter,
      trackedOrder: input.trackedOrder,
    });
    summary = summarizeJupiterTriggerOrder(orderRecord);
    if (summary.terminalReason || summary.lifecycle.orderState === "open") {
      return {
        orderRecord,
        summary,
      };
    }
    if (attempt < JUPITER_TRIGGER_SMOKE_POLL_ATTEMPTS - 1) {
      await sleep(JUPITER_TRIGGER_SMOKE_POLL_DELAY_MS);
    }
  }
  return {
    orderRecord,
    summary,
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

function executionSucceeded(
  status: ExecuteSwapResult["status"],
): status is Extract<
  ExecuteSwapResult["status"],
  "processed" | "confirmed" | "finalized"
> {
  return (
    status === "processed" || status === "confirmed" || status === "finalized"
  );
}

function readDriftExecutionAccountState(result: ExecuteSwapResult): {
  before: DriftLiveAccountSnapshot | null;
  after: DriftLiveAccountSnapshot | null;
  setupSignature: string | null;
  setupAction: string | null;
} | null {
  const executionMeta = asJsonObject(result.executionMeta);
  const driftAccount = asJsonObject(executionMeta?.driftAccount);
  if (!driftAccount) return null;
  return {
    before: (driftAccount.before ?? null) as DriftLiveAccountSnapshot | null,
    after: (driftAccount.after ?? null) as DriftLiveAccountSnapshot | null,
    setupSignature: readOptionalString(driftAccount.setupSignature) ?? null,
    setupAction: readOptionalString(driftAccount.setupAction) ?? null,
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

async function runDFlowVenueSmoke(input: {
  env: Env;
  request: RuntimeResearchReadinessCanaryRequest;
  runId: string;
  context: CanaryPairContext;
  wallet: StrategyLabReadinessCanaryWallet;
  targetNotionalUsd: string;
  config: StrategyLabReadinessCanaryConfig;
  lane: string;
  submissionPath: CanarySubmissionPath;
  rpc: SolanaRpc;
  jupiter: JupiterClient;
  dflow: DFlowClient;
}): Promise<RuntimeResearchReadinessCanaryWorkflowResult> {
  const instrumentId = input.context.instrumentId;
  const outcomeId =
    input.context.predictionOutcomeId ?? input.context.outputMint;
  const outcomeSide = input.context.predictionOutcomeSide ?? "yes";
  if (!instrumentId || !outcomeId) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "failed",
      runPatch: {
        errorCode: "submission-failed",
        errorMessage:
          "strategy-lab-readiness-canary-dflow-market-context-missing",
      },
    });
  }

  const smokeOrderSide = readSmokeOrderSide(input.request);
  const metadata = isRecord(input.request.metadata)
    ? input.request.metadata
    : {};
  const side =
    smokeOrderSide === "sell"
      ? (`sell_${outcomeSide}` as const)
      : (`buy_${outcomeSide}` as const);
  const orderInputMint =
    smokeOrderSide === "sell"
      ? input.context.outputMint
      : input.context.inputMint;
  const orderOutputMint =
    smokeOrderSide === "sell"
      ? input.context.inputMint
      : input.context.outputMint;
  const quantityAtomic =
    smokeOrderSide === "sell"
      ? readOptionalString(metadata.quantityAtomic)
      : parseUsdAtomic(input.targetNotionalUsd).toString();
  if (!quantityAtomic) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "blocked",
      runPatch: {
        errorCode: "invalid-request",
        errorMessage:
          "strategy-lab-readiness-canary-dflow-sell-quantity-required",
      },
    });
  }
  const quantityMode = smokeOrderSide === "sell" ? "base" : "notional";

  const preview = await input.dflow.describePredictionIntent({
    instrumentId,
    outcomeId,
    side,
    quantityAtomic,
    options: {
      orderType: "market",
      quantityMode,
      marketNotionalCapUsd: Number(input.targetNotionalUsd),
    },
  });
  const referencePriceMetadata = {
    verdict: "allow" as const,
    reason: null,
    executionPrice:
      preview.priceQuote === null ? null : String(preview.priceQuote),
    executionDivergenceBps: null,
    snapshot: {
      marketId: preview.market.marketId,
      title: preview.market.title,
      eventTitle: preview.market.eventTitle,
      marketStatus: preview.market.status,
      result: preview.market.result,
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
    },
  };

  const policy = normalizePolicy({
    allowedMints: [orderInputMint, orderOutputMint],
    minSolReserveLamports: input.config.minSolReserveLamports,
    simulateOnly: false,
    dryRun: false,
    commitment: "finalized",
    maxTradeAmountAtomic: quantityAtomic,
  });

  const runtimeBalancePolicy = await evaluatePrivyRuntimeBalancePolicy({
    env: input.env,
    lane: "safe",
    walletAddress: input.wallet.walletAddress,
    inputMint: orderInputMint,
    amountAtomic: quantityAtomic,
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
          runtimePolicy: runtimeBalancePolicy.metadata,
        },
      },
    });
  }

  const beforeBalances = await readBalances({
    rpc: input.rpc,
    walletAddress: input.wallet.walletAddress,
    inputMint: orderInputMint,
    outputMint: orderOutputMint,
  });

  try {
    const result = await executeIntentViaRouter({
      env: input.env,
      venueKey: input.context.venueKey,
      runtimeMode: "live",
      experimentalLiveModeBypass:
        readProofMode(input.request) === "venue_tx_smoke"
          ? "venue_tx_smoke"
          : undefined,
      requireVenueRouting: true,
      subjectControlBypassReason: "strategy_lab_readiness_canary",
      execution: {
        adapter: input.context.adapterKey,
        params: {
          lane: input.lane,
          requireSimulation: true,
        },
      },
      policy,
      rpc: input.rpc,
      jupiter: input.jupiter,
      dflow: input.dflow,
      privyWalletId: input.wallet.walletId,
      intent: {
        family: "prediction_order",
        wallet: input.wallet.walletAddress,
        venueKey: "dflow",
        marketType: "prediction",
        instrumentId,
        outcomeId,
        side,
        quantityAtomic,
        params: {
          orderType: "market",
          quantityMode,
          marketNotionalCapUsd: Number(input.targetNotionalUsd),
        },
      },
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
            executionMeta: asJsonObject(result.executionMeta),
            referencePrice: referencePriceMetadata,
          },
        },
      });
    }

    const transaction =
      result.signature !== null
        ? await input.rpc.getTransactionParsed(result.signature, {
            commitment: "confirmed",
          })
        : null;
    const feeLamports = readReconciliationFeeLamports(transaction);
    const afterBalances = await readBalances({
      rpc: input.rpc,
      walletAddress: input.wallet.walletAddress,
      inputMint: orderInputMint,
      outputMint: orderOutputMint,
    });
    const actualInputDelta =
      beforeBalances.inputAtomic - afterBalances.inputAtomic;
    const actualOutputDelta =
      orderOutputMint === SOL_MINT
        ? afterBalances.outputAtomic - beforeBalances.outputAtomic + feeLamports
        : afterBalances.outputAtomic - beforeBalances.outputAtomic;
    const reconciliationPassed =
      readTransactionError(transaction) === null &&
      actualInputDelta > 0n &&
      actualOutputDelta > 0n;

    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: reconciliationPassed ? "success" : "failed",
      runPatch: {
        receiptId: `receipt_${input.runId.slice(-16)}`,
        signature: result.signature ?? undefined,
        errorCode: reconciliationPassed
          ? undefined
          : "strategy-lab-readiness-canary-reconciliation-failed",
        errorMessage: reconciliationPassed
          ? undefined
          : "strategy-lab-readiness-canary-reconciliation-failed",
        reconciliation: {
          status: reconciliationPassed ? "passed" : "failed",
          actualOutputAtomic: actualOutputDelta.toString(),
          minExpectedOutAtomic: "1",
          notes: [
            `status=${result.status}`,
            `actualInputAtomic=${actualInputDelta.toString()}`,
            `smokeOrderSide=${smokeOrderSide}`,
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
            ...input.submissionPath,
            landingStatus: result.status,
          },
          executionMeta: asJsonObject(result.executionMeta),
          referencePrice: referencePriceMetadata,
          feeLamports: feeLamports.toString(),
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
      runId: input.runId,
      status: "failed",
      runPatch: {
        errorCode: normalizeExecutionErrorCode({
          error,
          fallback: "submission-failed",
        }),
        errorMessage: executionErrorMessage(error),
        metadata: {
          submissionPath: input.submissionPath,
          referencePrice: referencePriceMetadata,
        },
      },
    });
  }
}

async function runJupiterConditionalSpotSmoke(input: {
  env: Env;
  request: RuntimeResearchReadinessCanaryRequest;
  runId: string;
  context: CanaryPairContext;
  wallet: StrategyLabReadinessCanaryWallet;
  submissionPath: CanarySubmissionPath;
  quoteSummary: Awaited<ReturnType<typeof fetchCanaryQuote>>;
  policy: ReturnType<typeof normalizePolicy>;
  config: StrategyLabReadinessCanaryConfig;
  rpc: SolanaRpc;
  jupiter: JupiterClient;
  referenceGuard: Awaited<ReturnType<typeof evaluateOracleReferencePriceGuard>>;
}): Promise<RuntimeResearchReadinessCanaryWorkflowResult> {
  if (input.context.venueKey !== "jupiter") {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "blocked",
      runPatch: {
        errorCode: "strategy-lab-readiness-canary-unsupported-smoke-intent",
        errorMessage: `strategy-lab-readiness-canary-unsupported-smoke-intent:${input.context.venueKey}:conditional_spot_order`,
        metadata: {
          submissionPath: input.submissionPath,
        },
      },
    });
  }

  const referencePriceMetadata = buildReferencePriceMetadata(
    input.referenceGuard,
  );
  const smokeOrderSide = readSmokeOrderSide(input.request);
  const orderInputMint =
    smokeOrderSide === "buy"
      ? input.context.inputMint
      : input.context.outputMint;
  const orderOutputMint =
    smokeOrderSide === "buy"
      ? input.context.outputMint
      : input.context.inputMint;
  const orderQuantityAtomic =
    smokeOrderSide === "buy"
      ? input.quoteSummary.amountAtomic
      : input.quoteSummary.quotedOutAtomic;

  let triggerPriceAtomic: string;
  try {
    triggerPriceAtomic = deriveJupiterTriggerSmokePriceAtomic({
      context: input.context,
      quoteSummary: input.quoteSummary,
      side: smokeOrderSide,
    });
  } catch (error) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "failed",
      runPatch: {
        errorCode: "strategy-lab-readiness-canary-trigger-price-failed",
        errorMessage: executionErrorMessage(error),
        metadata: {
          submissionPath: input.submissionPath,
          quote: asJsonObject(input.quoteSummary.quoteResponse),
          ...(referencePriceMetadata
            ? { referencePrice: referencePriceMetadata }
            : {}),
        },
      },
    });
  }

  const runtimeBalancePolicy = await evaluatePrivyRuntimeBalancePolicy({
    env: input.env,
    lane: "safe",
    walletAddress: input.wallet.walletAddress,
    inputMint: orderInputMint,
    amountAtomic: orderQuantityAtomic,
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
          runtimePolicy: runtimeBalancePolicy.metadata,
          smokeOrderSide,
        },
      },
    });
  }

  const beforeBalances = await readBalances({
    rpc: input.rpc,
    walletAddress: input.wallet.walletAddress,
    inputMint: orderInputMint,
    outputMint: orderOutputMint,
  });
  let trackedOrder: JupiterTrackedTriggerOrder | null = null;
  let visibleOrder: JupiterTriggerOrderRecord | null = null;
  let visibleOrderSummary = summarizeJupiterTriggerOrder(null);

  try {
    const createResult = await executeIntentViaRouter({
      env: input.env,
      venueKey: input.context.venueKey,
      runtimeMode: "live",
      requireVenueRouting: true,
      subjectControlBypassReason: "strategy_lab_readiness_canary",
      execution: {
        adapter: input.submissionPath.adapter,
        params: {
          lane: input.submissionPath.lane,
          requireSimulation: true,
        },
      },
      policy: input.policy,
      rpc: input.rpc,
      jupiter: input.jupiter,
      intent: {
        family: "conditional_spot_order",
        wallet: input.wallet.walletAddress,
        venueKey: input.context.venueKey,
        marketType: "spot",
        instrumentId: input.context.pairSymbol,
        side: smokeOrderSide,
        quantityAtomic: orderQuantityAtomic,
        params: {
          orderType: "trigger",
          timeInForce: "gtc",
          limitPriceAtomic: triggerPriceAtomic,
          triggerPriceAtomic,
        },
      },
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
      createResult.status !== "processed" &&
      createResult.status !== "confirmed" &&
      createResult.status !== "finalized"
    ) {
      const failure = classifyExecutionFailure(
        createResult.status,
        createResult.err,
      );
      return await finalizeReadinessCanaryRun(input.env, {
        runId: input.runId,
        status: failure.status,
        runPatch: {
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
          metadata: {
            submissionPath: {
              ...input.submissionPath,
              landingStatus: createResult.status,
            },
            quote: asJsonObject(input.quoteSummary.quoteResponse),
            executionMeta: asJsonObject(createResult.executionMeta),
            triggerPriceAtomic,
            ...(referencePriceMetadata
              ? { referencePrice: referencePriceMetadata }
              : {}),
          },
        },
      });
    }

    const orderId = readOptionalString(
      createResult.executionMeta?.venueSessionId,
    );
    if (!orderId) {
      return await finalizeReadinessCanaryRun(input.env, {
        runId: input.runId,
        status: "failed",
        runPatch: {
          errorCode: "strategy-lab-readiness-canary-trigger-order-missing",
          errorMessage: "strategy-lab-readiness-canary-trigger-order-missing",
          metadata: {
            submissionPath: {
              ...input.submissionPath,
              landingStatus: createResult.status,
            },
            executionMeta: asJsonObject(createResult.executionMeta),
            triggerPriceAtomic,
          },
        },
      });
    }

    trackedOrder = {
      maker: input.wallet.walletAddress,
      order: orderId,
      requestId:
        readOptionalString(createResult.executionMeta?.intentId) ?? null,
      inputMint: orderInputMint,
      outputMint: orderOutputMint,
    };
    const visibleResult = await pollJupiterTriggerOrderVisible({
      jupiter: input.jupiter,
      trackedOrder,
    });
    visibleOrder = visibleResult.orderRecord;
    visibleOrderSummary = visibleResult.summary;
    if (!visibleOrder) {
      return await finalizeReadinessCanaryRun(input.env, {
        runId: input.runId,
        status: "failed",
        runPatch: {
          signature: createResult.signature ?? undefined,
          errorCode: "strategy-lab-readiness-canary-trigger-order-not-visible",
          errorMessage:
            "strategy-lab-readiness-canary-trigger-order-not-visible",
          evidenceRefs: [
            {
              kind: "live_canary",
              ref: `signature:${createResult.signature ?? "missing"}`,
            },
            {
              kind: "venue_order",
              ref: `jupiter-trigger:${trackedOrder.order}`,
            },
          ],
          metadata: {
            submissionPath: {
              ...input.submissionPath,
              createLandingStatus: createResult.status,
            },
            executionMeta: asJsonObject(createResult.executionMeta),
            venueOrderId: trackedOrder.order,
            triggerPriceAtomic,
            smokeOrderSide,
            triggerLifecycle: asJsonObject(visibleOrderSummary.lifecycle),
          },
        },
      });
    }

    trackedOrder.order =
      readOptionalString(visibleOrder.order) ??
      readOptionalString(visibleOrder.orderKey) ??
      trackedOrder.order;
    if (visibleOrderSummary.terminalReason) {
      const closeSignature =
        readOptionalString(visibleOrder.closeTx) ??
        readOptionalString(visibleOrderSummary.signature);
      const createTransaction =
        createResult.signature !== null
          ? await input.rpc.getTransactionParsed(createResult.signature, {
              commitment: "confirmed",
            })
          : null;
      const closeTransaction =
        closeSignature && closeSignature !== createResult.signature
          ? await input.rpc.getTransactionParsed(closeSignature, {
              commitment: "confirmed",
            })
          : null;
      const afterBalances = await readBalances({
        rpc: input.rpc,
        walletAddress: input.wallet.walletAddress,
        inputMint: orderInputMint,
        outputMint: orderOutputMint,
      });
      const createFeeLamports =
        readReconciliationFeeLamports(createTransaction);
      const closeFeeLamports = closeTransaction
        ? readReconciliationFeeLamports(closeTransaction)
        : 0n;
      const totalFeeLamports = createFeeLamports + closeFeeLamports;
      const inputDeltaAtomic =
        afterBalances.inputAtomic - beforeBalances.inputAtomic;
      const outputDeltaAtomic =
        afterBalances.outputAtomic - beforeBalances.outputAtomic;
      const solDeltaLamports =
        afterBalances.solLamports - beforeBalances.solLamports;
      const reconciliationPassed =
        visibleOrderSummary.terminalReason === "filled" ||
        visibleOrderSummary.terminalReason === "cancelled";
      return await finalizeReadinessCanaryRun(input.env, {
        runId: input.runId,
        status: reconciliationPassed ? "success" : "failed",
        runPatch: {
          receiptId: `receipt_${input.runId.slice(-16)}`,
          signature: createResult.signature ?? undefined,
          errorCode: reconciliationPassed
            ? undefined
            : "strategy-lab-readiness-canary-trigger-terminal-before-cancel",
          errorMessage: reconciliationPassed
            ? undefined
            : "strategy-lab-readiness-canary-trigger-terminal-before-cancel",
          reconciliation: {
            status: reconciliationPassed ? "passed" : "failed",
            notes: [
              `createStatus=${createResult.status}`,
              `smokeOrderSide=${smokeOrderSide}`,
              `orderTerminalReason=${visibleOrderSummary.terminalReason}`,
              `inputDeltaAtomic=${inputDeltaAtomic.toString()}`,
              `outputDeltaAtomic=${outputDeltaAtomic.toString()}`,
              `solDeltaLamports=${solDeltaLamports.toString()}`,
            ],
          },
          evidenceRefs: [
            {
              kind: "live_canary",
              ref: `signature:${createResult.signature ?? "missing"}`,
            },
            ...(closeSignature && closeSignature !== createResult.signature
              ? [
                  {
                    kind: "live_canary_close",
                    ref: `signature:${closeSignature}`,
                  },
                ]
              : []),
            {
              kind: "venue_order",
              ref: `jupiter-trigger:${trackedOrder.order}`,
            },
          ],
          metadata: {
            submissionPath: {
              ...input.submissionPath,
              createLandingStatus: createResult.status,
            },
            executionMeta: asJsonObject(createResult.executionMeta),
            venueOrderId: trackedOrder.order,
            smokeOrderSide,
            triggerPriceAtomic,
            feeLamports: {
              create: createFeeLamports.toString(),
              close: closeFeeLamports.toString(),
              total: totalFeeLamports.toString(),
            },
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
            triggerLifecycle: asJsonObject(visibleOrderSummary.lifecycle),
            triggerOrder: asJsonObject(visibleOrder),
            ...(closeSignature ? { closeSignature } : {}),
          },
        },
      });
    }

    if (visibleOrderSummary.lifecycle.orderState !== "open") {
      return await finalizeReadinessCanaryRun(input.env, {
        runId: input.runId,
        status: "failed",
        runPatch: {
          signature: createResult.signature ?? undefined,
          errorCode:
            "strategy-lab-readiness-canary-trigger-order-not-open-before-cancel",
          errorMessage:
            "strategy-lab-readiness-canary-trigger-order-not-open-before-cancel",
          evidenceRefs: [
            {
              kind: "live_canary",
              ref: `signature:${createResult.signature ?? "missing"}`,
            },
            {
              kind: "venue_order",
              ref: `jupiter-trigger:${trackedOrder.order}`,
            },
          ],
          metadata: {
            submissionPath: {
              ...input.submissionPath,
              createLandingStatus: createResult.status,
            },
            executionMeta: asJsonObject(createResult.executionMeta),
            venueOrderId: trackedOrder.order,
            smokeOrderSide,
            triggerPriceAtomic,
            triggerLifecycle: asJsonObject(visibleOrderSummary.lifecycle),
            triggerOrder: asJsonObject(visibleOrder),
          },
        },
      });
    }

    const cancelResponse = await input.jupiter.cancelTriggerOrder({
      maker: input.wallet.walletAddress,
      order: trackedOrder.order,
    });
    const signedCancelBase64 = await signTransactionWithPrivyById(
      input.env,
      input.wallet.walletId,
      cancelResponse.transaction,
    );
    const safeEvaluation = evaluateSafeLaneTransaction({
      env: input.env,
      signedTransactionBase64: signedCancelBase64,
    });
    if (!safeEvaluation.ok) {
      return await finalizeReadinessCanaryRun(input.env, {
        runId: input.runId,
        status: "blocked",
        runPatch: {
          signature: createResult.signature ?? undefined,
          errorCode: "policy-denied",
          errorMessage: safeEvaluation.reason,
          evidenceRefs: [
            {
              kind: "live_canary",
              ref: `signature:${createResult.signature ?? "missing"}`,
            },
            {
              kind: "venue_order",
              ref: `jupiter-trigger:${trackedOrder.order}`,
            },
          ],
          metadata: {
            submissionPath: {
              ...input.submissionPath,
              createLandingStatus: createResult.status,
            },
            executionMeta: asJsonObject(createResult.executionMeta),
            venueOrderId: trackedOrder.order,
            triggerOrder: asJsonObject(visibleOrder),
            triggerPriceAtomic,
          },
        },
      });
    }

    const cancelSimulation = await input.rpc.simulateTransactionBase64(
      signedCancelBase64,
      {
        commitment: input.policy.commitment,
        sigVerify: true,
      },
    );
    if (cancelSimulation.err) {
      return await finalizeReadinessCanaryRun(input.env, {
        runId: input.runId,
        status: "blocked",
        runPatch: {
          signature: createResult.signature ?? undefined,
          errorCode: "policy-denied",
          errorMessage: "safe-lane-simulation-failed",
          evidenceRefs: [
            {
              kind: "live_canary",
              ref: `signature:${createResult.signature ?? "missing"}`,
            },
            {
              kind: "venue_order",
              ref: `jupiter-trigger:${trackedOrder.order}`,
            },
          ],
          metadata: {
            submissionPath: {
              ...input.submissionPath,
              createLandingStatus: createResult.status,
            },
            executionMeta: asJsonObject(createResult.executionMeta),
            venueOrderId: trackedOrder.order,
            triggerOrder: asJsonObject(visibleOrder),
            triggerPriceAtomic,
          },
        },
      });
    }

    const cancelSignature = await input.rpc.sendTransactionBase64(
      signedCancelBase64,
      {
        preflightCommitment: input.policy.commitment,
        skipPreflight: false,
      },
    );
    const cancelConfirmation = await input.rpc.confirmSignature(
      cancelSignature,
      {
        commitment: input.policy.commitment,
      },
    );
    if (!cancelConfirmation.ok) {
      return await finalizeReadinessCanaryRun(input.env, {
        runId: input.runId,
        status: "failed",
        runPatch: {
          signature: createResult.signature ?? undefined,
          errorCode: "submission-failed",
          errorMessage: "conditional-order-cancel-confirmation-failed",
          evidenceRefs: [
            {
              kind: "live_canary",
              ref: `signature:${createResult.signature ?? "missing"}`,
            },
            {
              kind: "live_canary_cancel",
              ref: `signature:${cancelSignature}`,
            },
            {
              kind: "venue_order",
              ref: `jupiter-trigger:${trackedOrder.order}`,
            },
          ],
          metadata: {
            submissionPath: {
              ...input.submissionPath,
              createLandingStatus: createResult.status,
              cancelLandingStatus: "error",
            },
            executionMeta: asJsonObject(createResult.executionMeta),
            venueOrderId: trackedOrder.order,
            cancelSignature,
            cancelRequestId: cancelResponse.requestId,
            triggerOrder: asJsonObject(visibleOrder),
            triggerPriceAtomic,
          },
        },
      });
    }

    const terminal = await pollJupiterTriggerOrderTerminal({
      jupiter: input.jupiter,
      trackedOrder,
    });
    const createTransaction =
      createResult.signature !== null
        ? await input.rpc.getTransactionParsed(createResult.signature, {
            commitment: "confirmed",
          })
        : null;
    const cancelTransaction = await input.rpc.getTransactionParsed(
      cancelSignature,
      {
        commitment: "confirmed",
      },
    );
    const afterBalances = await readBalances({
      rpc: input.rpc,
      walletAddress: input.wallet.walletAddress,
      inputMint: orderInputMint,
      outputMint: orderOutputMint,
    });
    const createFeeLamports = readReconciliationFeeLamports(createTransaction);
    const cancelFeeLamports = readReconciliationFeeLamports(cancelTransaction);
    const totalFeeLamports = createFeeLamports + cancelFeeLamports;
    const inputDeltaAtomic =
      afterBalances.inputAtomic - beforeBalances.inputAtomic;
    const outputDeltaAtomic =
      afterBalances.outputAtomic - beforeBalances.outputAtomic;
    const solDeltaLamports =
      afterBalances.solLamports - beforeBalances.solLamports;
    const reconciliationPassed =
      terminal.summary.terminalReason === "cancelled";

    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: reconciliationPassed ? "success" : "failed",
      runPatch: {
        receiptId: `receipt_${input.runId.slice(-16)}`,
        signature: createResult.signature ?? undefined,
        errorCode: reconciliationPassed
          ? undefined
          : "strategy-lab-readiness-canary-trigger-reconciliation-failed",
        errorMessage: reconciliationPassed
          ? undefined
          : "strategy-lab-readiness-canary-trigger-reconciliation-failed",
        reconciliation: {
          status: reconciliationPassed ? "passed" : "failed",
          notes: [
            `createStatus=${createResult.status}`,
            `cancelStatus=${cancelConfirmation.status ?? "confirmed"}`,
            `smokeOrderSide=${smokeOrderSide}`,
            `orderTerminalReason=${terminal.summary.terminalReason ?? "pending"}`,
            `inputDeltaAtomic=${inputDeltaAtomic.toString()}`,
            `outputDeltaAtomic=${outputDeltaAtomic.toString()}`,
            `solDeltaLamports=${solDeltaLamports.toString()}`,
          ],
        },
        evidenceRefs: [
          {
            kind: "live_canary",
            ref: `signature:${createResult.signature ?? "missing"}`,
          },
          {
            kind: "live_canary_cancel",
            ref: `signature:${cancelSignature}`,
          },
          {
            kind: "venue_order",
            ref: `jupiter-trigger:${trackedOrder.order}`,
          },
        ],
        metadata: {
          submissionPath: {
            ...input.submissionPath,
            createLandingStatus: createResult.status,
            cancelLandingStatus: cancelConfirmation.status ?? "confirmed",
          },
          quote: asJsonObject(input.quoteSummary.quoteResponse),
          executionMeta: asJsonObject(createResult.executionMeta),
          venueOrderId: trackedOrder.order,
          cancelSignature,
          cancelRequestId: cancelResponse.requestId,
          cancelVenueOrderId: cancelResponse.order,
          smokeOrderSide,
          triggerPriceAtomic,
          feeLamports: {
            create: createFeeLamports.toString(),
            cancel: cancelFeeLamports.toString(),
            total: totalFeeLamports.toString(),
          },
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
          triggerLifecycle: asJsonObject(terminal.summary.lifecycle),
          triggerOrder: asJsonObject(terminal.orderRecord),
          ...(referencePriceMetadata
            ? { referencePrice: referencePriceMetadata }
            : {}),
        },
      },
    });
  } catch (error) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "failed",
      runPatch: {
        errorCode: normalizeExecutionErrorCode({
          error,
          fallback: "submission-failed",
        }),
        errorMessage: executionErrorMessage(error),
        metadata: {
          submissionPath: input.submissionPath,
          ...(trackedOrder
            ? { venueOrderId: trackedOrder.order, triggerOrder: trackedOrder }
            : {}),
          ...(visibleOrder
            ? {
                triggerLifecycle: asJsonObject(visibleOrderSummary.lifecycle),
                triggerOrderRecord: asJsonObject(visibleOrder),
              }
            : {}),
        },
      },
    });
  }
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

async function runDriftVenueSmoke(input: {
  env: Env;
  request: RuntimeResearchReadinessCanaryRequest;
  runId: string;
  context: CanaryPairContext;
  wallet: StrategyLabReadinessCanaryWallet;
  targetNotionalUsd: string;
  config: StrategyLabReadinessCanaryConfig;
  lane: string;
  submissionPath: {
    venueKey: string;
    adapterKey: string;
    lane: string;
    adapter: string;
  };
  rpc: SolanaRpc;
  jupiter: JupiterClient;
  drift: DriftClient;
}): Promise<RuntimeResearchReadinessCanaryWorkflowResult> {
  const instrumentId = input.context.instrumentId;
  if (!instrumentId) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "failed",
      runPatch: {
        errorCode: "submission-failed",
        errorMessage: "strategy-lab-readiness-canary-drift-instrument-missing",
      },
    });
  }

  const rpcEndpoint = String(input.env.RPC_ENDPOINT ?? "").trim();
  if (!rpcEndpoint) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "failed",
      runPatch: {
        errorCode: "submission-failed",
        errorMessage: "rpc-endpoint-missing",
      },
    });
  }

  const driftLive = await loadDriftLiveModule();
  const preflightSnapshot = await driftLive
    .readDriftLiveAccountSnapshot({
      rpcEndpoint,
      walletPublicKey: input.wallet.walletAddress,
      instrumentId,
    })
    .catch(() => null);
  if (preflightSnapshot && preflightSnapshot.positionDirection !== "flat") {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "blocked",
      runPatch: {
        errorCode: "policy-denied",
        errorMessage: "strategy-lab-readiness-canary-drift-position-not-flat",
        metadata: {
          submissionPath: input.submissionPath,
          preflightSnapshot,
        },
      },
    });
  }

  let preview: Awaited<ReturnType<DriftClient["describePerpIntent"]>>;
  try {
    preview = await input.drift.describePerpIntent({
      instrumentId,
      side: "long",
      quantityAtomic: "1",
      collateralAtomic: "5000000",
      options: {
        orderType: "market",
        timeInForce: "ioc",
      },
      executionAdapter: input.context.adapterKey,
    });
  } catch (error) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "failed",
      runPatch: {
        errorCode: "strategy-lab-readiness-canary-quote-failed",
        errorMessage: executionErrorMessage(error),
        metadata: {
          submissionPath: input.submissionPath,
        },
      },
    });
  }

  const referencePrice =
    preview.funding?.markPrice ?? preview.funding?.oraclePrice ?? null;
  if (referencePrice === null) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "failed",
      runPatch: {
        errorCode: "strategy-lab-readiness-canary-quote-failed",
        errorMessage:
          "strategy-lab-readiness-canary-drift-reference-price-unavailable",
        metadata: {
          submissionPath: input.submissionPath,
          driftPreview: asJsonObject(preview),
          preflightSnapshot,
        },
      },
    });
  }

  let smokeIntent: ReturnType<typeof driftLive.buildDriftSmokeIntent>;
  try {
    smokeIntent = driftLive.buildDriftSmokeIntent({
      instrumentId,
      side: "long",
      targetNotionalUsd: input.targetNotionalUsd,
      referencePrice,
      collateralAtomic: "5000000",
    });
  } catch (error) {
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "failed",
      runPatch: {
        errorCode: "strategy-lab-readiness-canary-quote-failed",
        errorMessage: executionErrorMessage(error),
        metadata: {
          submissionPath: input.submissionPath,
          driftPreview: asJsonObject(preview),
          preflightSnapshot,
        },
      },
    });
  }

  const collateralAtomic = smokeIntent.collateralAtomic ?? "5000000";
  const policy = normalizePolicy({
    allowedMints: [input.context.inputMint, input.context.outputMint],
    slippageBps: input.config.maxSlippageBps,
    minSolReserveLamports: input.config.minSolReserveLamports,
    simulateOnly: false,
    dryRun: false,
    commitment: "finalized",
    maxTradeAmountAtomic: smokeIntent.quantityAtomic,
  });

  const runtimeBalancePolicy = await evaluatePrivyRuntimeBalancePolicy({
    env: input.env,
    lane: "safe",
    walletAddress: input.wallet.walletAddress,
    inputMint: input.context.inputMint,
    amountAtomic: collateralAtomic,
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
          runtimePolicy: runtimeBalancePolicy.metadata,
          driftPreview: asJsonObject(preview),
          preflightSnapshot,
        },
      },
    });
  }

  const executeIntent = async (intent: {
    side: "long" | "short" | "close_long" | "close_short";
    quantityAtomic: string;
    collateralAtomic: string | null;
    reduceOnly?: boolean;
  }): Promise<ExecuteSwapResult> =>
    await executeIntentViaRouter({
      env: input.env,
      venueKey: input.context.venueKey,
      runtimeMode: "live",
      experimentalLiveModeBypass:
        readProofMode(input.request) === "venue_tx_smoke"
          ? "venue_tx_smoke"
          : undefined,
      requireVenueRouting: true,
      subjectControlBypassReason: "strategy_lab_readiness_canary",
      execution: {
        adapter: input.context.adapterKey,
        params: {
          lane: input.lane,
          requireSimulation: true,
        },
      },
      policy,
      rpc: input.rpc,
      jupiter: input.jupiter,
      drift: input.drift,
      privyWalletId: input.wallet.walletId,
      log(level, message, meta) {
        console[level]("strategy_lab.readiness_canary", {
          runId: input.runId,
          message,
          ...(meta ?? {}),
        });
      },
      intent: {
        family: "perp_order",
        wallet: input.wallet.walletAddress,
        venueKey: input.context.venueKey,
        marketType: "perp",
        instrumentId,
        side: intent.side,
        quantityAtomic: intent.quantityAtomic,
        collateralAtomic: intent.collateralAtomic,
        params: {
          orderType: "market",
          timeInForce: "ioc",
          ...(intent.reduceOnly ? { reduceOnly: true } : {}),
        },
      },
    });

  const openResult = await executeIntent({
    side: "long",
    quantityAtomic: smokeIntent.quantityAtomic,
    collateralAtomic,
  });
  if (!executionSucceeded(openResult.status)) {
    const failure = classifyExecutionFailure(openResult.status, openResult.err);
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: failure.status,
      runPatch: {
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        metadata: {
          submissionPath: {
            ...input.submissionPath,
            landingStatus: openResult.status,
          },
          driftPreview: asJsonObject(preview),
          executionMeta: asJsonObject(openResult.executionMeta),
          preflightSnapshot,
        },
      },
    });
  }

  const openState = readDriftExecutionAccountState(openResult);
  const openAfter = openState?.after ?? null;
  const openedQuantityAtomic =
    absoluteAtomic(openAfter?.baseAssetAmountAtomic) ?? null;
  const openOrderCount = openAfter?.openOrders ?? 0;
  if (
    !openAfter ||
    openAfter.positionDirection === "flat" ||
    !openedQuantityAtomic ||
    openedQuantityAtomic === "0"
  ) {
    if (
      openAfter &&
      openAfter.positionDirection === "flat" &&
      openOrderCount > 0
    ) {
      let cancelPlan: Awaited<
        ReturnType<DriftLiveModule["prepareDriftLiveCancelOrders"]>
      >;
      try {
        cancelPlan = await driftLive.prepareDriftLiveCancelOrders({
          rpcEndpoint,
          walletPublicKey: input.wallet.walletAddress,
          instrumentId,
        });
      } catch (error) {
        return await finalizeReadinessCanaryRun(input.env, {
          runId: input.runId,
          status: "failed",
          runPatch: {
            receiptId: `receipt_${input.runId.slice(-16)}`,
            signature: openResult.signature ?? undefined,
            errorCode: "strategy-lab-readiness-canary-reconciliation-failed",
            errorMessage:
              "strategy-lab-readiness-canary-drift-open-order-cancel-plan-failed",
            reconciliation: {
              status: "failed",
              actualOutputAtomic: "0",
              minExpectedOutAtomic: "0",
              notes: [`openStatus=${openResult.status}`],
            },
            evidenceRefs: [
              {
                kind: "live_canary",
                ref: `signature:${openResult.signature ?? "missing"}`,
              },
            ],
            metadata: {
              submissionPath: {
                ...input.submissionPath,
                landingStatus: openResult.status,
              },
              driftPreview: asJsonObject(preview),
              openExecutionMeta: asJsonObject(openResult.executionMeta),
              preflightSnapshot,
              cancelPlanError: executionErrorMessage(error),
            },
          },
        });
      }

      const cancelResult = await submitPrivyManagedTransactionPlan({
        env: input.env,
        rpc: input.rpc,
        walletId: input.wallet.walletId,
        unsignedTransactionBase64: cancelPlan.cancelTransactionBase64,
        label: "drift-cancel-orders",
      });
      if (!cancelResult.ok) {
        return await finalizeReadinessCanaryRun(input.env, {
          runId: input.runId,
          status: "failed",
          runPatch: {
            receiptId: `receipt_${input.runId.slice(-16)}`,
            signature: openResult.signature ?? undefined,
            errorCode: cancelResult.errorCode,
            errorMessage: cancelResult.errorMessage,
            reconciliation: {
              status: "failed",
              actualOutputAtomic: "0",
              minExpectedOutAtomic: "0",
              notes: [
                `openStatus=${openResult.status}`,
                `openOrdersBeforeCancel=${openOrderCount}`,
              ],
            },
            evidenceRefs: [
              {
                kind: "live_canary",
                ref: `signature:${openResult.signature ?? "missing"}`,
              },
            ],
            metadata: {
              submissionPath: {
                ...input.submissionPath,
                landingStatus: openResult.status,
              },
              driftPreview: asJsonObject(preview),
              openExecutionMeta: asJsonObject(openResult.executionMeta),
              cancelSnapshotBefore: cancelPlan.snapshotBefore,
              preflightSnapshot,
            },
          },
        });
      }

      const cancelSnapshotAfter = await driftLive
        .readDriftLiveAccountSnapshot({
          rpcEndpoint,
          walletPublicKey: input.wallet.walletAddress,
          instrumentId,
        })
        .catch(() => null);
      const cancelled =
        cancelSnapshotAfter?.positionDirection === "flat" &&
        (cancelSnapshotAfter?.openOrders ?? -1) === 0;

      return await finalizeReadinessCanaryRun(input.env, {
        runId: input.runId,
        status: cancelled ? "success" : "failed",
        runPatch: {
          receiptId: `receipt_${input.runId.slice(-16)}`,
          signature: openResult.signature ?? undefined,
          errorCode: cancelled
            ? undefined
            : "strategy-lab-readiness-canary-reconciliation-failed",
          errorMessage: cancelled
            ? undefined
            : "strategy-lab-readiness-canary-drift-cancel-not-observed",
          reconciliation: {
            status: cancelled ? "passed" : "failed",
            actualOutputAtomic: "0",
            minExpectedOutAtomic: "0",
            notes: [
              `openStatus=${openResult.status}`,
              `cancelStatus=${cancelResult.status}`,
              `openOrdersBeforeCancel=${openOrderCount}`,
              `openOrdersAfterCancel=${cancelSnapshotAfter?.openOrders ?? "missing"}`,
            ],
          },
          evidenceRefs: [
            {
              kind: "live_canary",
              ref: `signature:${openResult.signature ?? "missing"}`,
            },
            {
              kind: "live_canary_cancel",
              ref: `signature:${cancelResult.signature}`,
            },
          ],
          metadata: {
            submissionPath: {
              ...input.submissionPath,
              landingStatus: cancelResult.status,
            },
            driftPreview: asJsonObject(preview),
            openExecutionMeta: asJsonObject(openResult.executionMeta),
            preflightSnapshot,
            cancelSnapshotBefore: cancelPlan.snapshotBefore,
            cancelSnapshotAfter,
            cancelSignature: cancelResult.signature,
          },
        },
      });
    }

    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: "failed",
      runPatch: {
        receiptId: `receipt_${input.runId.slice(-16)}`,
        signature: openResult.signature ?? undefined,
        errorCode: "strategy-lab-readiness-canary-reconciliation-failed",
        errorMessage: "strategy-lab-readiness-canary-drift-open-not-observed",
        reconciliation: {
          status: "failed",
          actualOutputAtomic: "0",
          minExpectedOutAtomic: smokeIntent.quantityAtomic,
          notes: [`openStatus=${openResult.status}`],
        },
        evidenceRefs: [
          {
            kind: "live_canary",
            ref: `signature:${openResult.signature ?? "missing"}`,
          },
        ],
        metadata: {
          submissionPath: {
            ...input.submissionPath,
            landingStatus: openResult.status,
          },
          driftPreview: asJsonObject(preview),
          openExecutionMeta: asJsonObject(openResult.executionMeta),
          preflightSnapshot,
        },
      },
    });
  }

  const closeSide =
    openAfter.positionDirection === "short" ? "close_short" : "close_long";
  const closeResult = await executeIntent({
    side: closeSide,
    quantityAtomic: openedQuantityAtomic,
    collateralAtomic: null,
    reduceOnly: true,
  });
  if (!executionSucceeded(closeResult.status)) {
    const failure = classifyExecutionFailure(
      closeResult.status,
      closeResult.err,
    );
    return await finalizeReadinessCanaryRun(input.env, {
      runId: input.runId,
      status: failure.status,
      runPatch: {
        receiptId: `receipt_${input.runId.slice(-16)}`,
        signature: openResult.signature ?? undefined,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        evidenceRefs: [
          {
            kind: "live_canary",
            ref: `signature:${openResult.signature ?? "missing"}`,
          },
          ...(closeResult.signature
            ? [
                {
                  kind: "live_canary" as const,
                  ref: `signature:${closeResult.signature}`,
                },
              ]
            : []),
        ],
        metadata: {
          submissionPath: {
            ...input.submissionPath,
            landingStatus: closeResult.status,
          },
          driftPreview: asJsonObject(preview),
          openExecutionMeta: asJsonObject(openResult.executionMeta),
          closeExecutionMeta: asJsonObject(closeResult.executionMeta),
          preflightSnapshot,
        },
      },
    });
  }

  const closeState = readDriftExecutionAccountState(closeResult);
  const closeAfter = closeState?.after ?? null;
  const closed =
    closeAfter?.positionDirection === "flat" &&
    absoluteAtomic(closeAfter.baseAssetAmountAtomic) === "0";
  const [openTransaction, closeTransaction] = await Promise.all([
    openResult.signature
      ? input.rpc.getTransactionParsed(openResult.signature, {
          commitment: "confirmed",
        })
      : Promise.resolve(null),
    closeResult.signature
      ? input.rpc.getTransactionParsed(closeResult.signature, {
          commitment: "confirmed",
        })
      : Promise.resolve(null),
  ]);
  const totalFeeLamports = (
    readReconciliationFeeLamports(openTransaction) +
    readReconciliationFeeLamports(closeTransaction)
  ).toString();
  return await finalizeReadinessCanaryRun(input.env, {
    runId: input.runId,
    status: closed ? "success" : "failed",
    runPatch: {
      receiptId: `receipt_${input.runId.slice(-16)}`,
      signature: openResult.signature ?? undefined,
      errorCode: closed
        ? undefined
        : "strategy-lab-readiness-canary-reconciliation-failed",
      errorMessage: closed
        ? undefined
        : "strategy-lab-readiness-canary-drift-close-not-flat",
      reconciliation: {
        status: closed ? "passed" : "failed",
        actualOutputAtomic: openedQuantityAtomic,
        minExpectedOutAtomic: smokeIntent.quantityAtomic,
        notes: [
          `openStatus=${openResult.status}`,
          `closeStatus=${closeResult.status}`,
          `closePositionState=${closeAfter?.positionDirection ?? "missing"}`,
        ],
      },
      evidenceRefs: [
        {
          kind: "live_canary",
          ref: `signature:${openResult.signature ?? "missing"}`,
        },
        {
          kind: "live_canary",
          ref: `signature:${closeResult.signature ?? "missing"}`,
        },
        ...(openState?.setupSignature
          ? [
              {
                kind: "live_canary" as const,
                ref: `signature:${openState.setupSignature}`,
              },
            ]
          : []),
      ],
      metadata: {
        submissionPath: {
          ...input.submissionPath,
          landingStatus: closeResult.status,
        },
        driftPreview: asJsonObject(preview),
        preflightSnapshot,
        openExecutionMeta: asJsonObject(openResult.executionMeta),
        closeExecutionMeta: asJsonObject(closeResult.executionMeta),
        setupSignature: openState?.setupSignature ?? null,
        setupAction: openState?.setupAction ?? null,
        totalFeeLamports,
      },
    },
  });
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
  const dflow =
    context.venueKey === "dflow" ? new DFlowClient(input.env) : undefined;
  const drift =
    context.venueKey === "drift" ? new DriftClient(input.env) : undefined;
  const raydium =
    context.venueKey === "raydium" ? new RaydiumClient() : undefined;
  const orca =
    context.venueKey === "orca"
      ? new (await import("./orca")).OrcaClient(
          String(input.env.RPC_ENDPOINT ?? "").trim(),
        )
      : undefined;
  if (context.marketType === "perp" && context.venueKey === "drift" && drift) {
    return await runDriftVenueSmoke({
      env: input.env,
      request: input.request,
      runId,
      context,
      wallet,
      targetNotionalUsd,
      config,
      lane: laneResolution.lane,
      submissionPath,
      rpc,
      jupiter,
      drift,
    });
  }
  if (
    context.marketType === "prediction" &&
    context.venueKey === "dflow" &&
    dflow
  ) {
    return await runDFlowVenueSmoke({
      env: input.env,
      request: input.request,
      runId,
      context,
      wallet,
      targetNotionalUsd,
      config,
      lane: laneResolution.lane,
      submissionPath,
      rpc,
      jupiter,
      dflow,
    });
  }
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
  const referencePriceMetadata = buildReferencePriceMetadata(referenceGuard);

  if (smokeIntentFamily === "conditional_spot_order") {
    return await runJupiterConditionalSpotSmoke({
      env: input.env,
      request: input.request,
      runId,
      context,
      wallet,
      submissionPath,
      quoteSummary,
      policy,
      config,
      rpc,
      jupiter,
      referenceGuard,
    });
  }

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
            ...(referencePriceMetadata
              ? { referencePrice: referencePriceMetadata }
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
          ...(referencePriceMetadata
            ? { referencePrice: referencePriceMetadata }
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
