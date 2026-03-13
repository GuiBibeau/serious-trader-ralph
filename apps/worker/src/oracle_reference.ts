import { upsertFeaturePoint } from "./data_sources/feature_store";
import { TRADING_TOKEN_BY_MINT } from "./defaults";
import { JupiterClient } from "./jupiter";
import type { Env } from "./types";

const PYTH_DEFAULT_BASE_URL = "https://hermes.pyth.network";
const SWITCHBOARD_DEFAULT_BASE_URL = "https://api.switchboard.xyz";
const JUPITER_PRICE_DEFAULT_BASE_URL = "https://lite-api.jup.ag";
const REFERENCE_PRICE_FEATURE = "reference_price_snapshot_v1";
const DEFAULT_FRESHNESS_SLO_MS = 60_000;
const DEFAULT_MAX_SOURCE_DIVERGENCE_BPS = 150;
const DEFAULT_MAX_EXECUTION_DIVERGENCE_BPS = 250;
const DEFAULT_MIN_HEALTHY_SOURCES = 2;

const STABLE_ASSET_KEYS = new Set(["USDC", "USDT", "PYUSD", "USD1", "USDG"]);

const DEFAULT_PYTH_SYMBOL_BY_ASSET: Record<string, string> = {
  SOL: "SOL/USD",
  USDC: "USDC/USD",
  USDT: "USDT/USD",
  PYTH: "PYTH/USD",
  JUP: "JUP/USD",
  JTO: "JTO/USD",
  BONK: "BONK/USD",
  WIF: "WIF/USD",
  RAY: "RAY/USD",
  JITOSOL: "SOL/USD",
  MSOL: "SOL/USD",
  JUPSOL: "SOL/USD",
};

const PYTH_FEED_ID_CACHE = new Map<string, string>();

export type OracleReferenceProvider =
  | "pyth"
  | "switchboard"
  | "jupiter_price_v3"
  | "stable_parity";

export type OracleReferenceSourceSnapshot = {
  provider: OracleReferenceProvider;
  baseAssetKey: string;
  quoteAssetKey: string;
  price: string | null;
  asOf: string | null;
  ageMs: number | null;
  confidenceBps: number | null;
  sourceInstrument: string | null;
  status: "healthy" | "stale" | "missing" | "error";
  error: string | null;
};

export type OracleReferencePriceSnapshot = {
  instrumentKey: string;
  baseAssetKey: string;
  quoteAssetKey: string;
  baseMint: string;
  quoteMint: string;
  price: string | null;
  asOf: string;
  freshnessSloMs: number;
  maxSourceDivergenceBps: number;
  maxSourceAgeMs: number | null;
  maxObservedDivergenceBps: number | null;
  sourceCoverageBps: number;
  status: "healthy" | "stale" | "divergent" | "missing";
  sources: OracleReferenceSourceSnapshot[];
};

export type OracleReferenceGuardResult = {
  enabled: boolean;
  verdict: "allow" | "pause" | "reject";
  reason: string | null;
  executionPrice: string | null;
  executionDivergenceBps: number | null;
  snapshot: OracleReferencePriceSnapshot | null;
};

type ReferenceAssetContext = {
  assetKey: string;
  mint: string;
  decimals: number;
};

type OracleReferenceConfig = {
  enabledModes: Set<string>;
  freshnessSloMs: number;
  maxSourceDivergenceBps: number;
  maxExecutionDivergenceBps: number;
  minHealthySources: number;
  pythBaseUrl: string;
  switchboardBaseUrl: string;
  jupiterPriceBaseUrl: string;
  pythSymbolByAsset: Record<string, string>;
  switchboardFeedByAsset: Record<string, string>;
};

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseStringMapJson(
  value: unknown,
  fallback?: Record<string, string>,
): Record<string, string> {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return fallback ? { ...fallback } : {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fallback ? { ...fallback } : {};
    }
    const output: Record<string, string> = fallback ? { ...fallback } : {};
    for (const [key, entry] of Object.entries(parsed)) {
      const normalizedKey = String(key ?? "")
        .trim()
        .toUpperCase();
      const normalizedValue = String(entry ?? "").trim();
      if (normalizedKey && normalizedValue) {
        output[normalizedKey] = normalizedValue;
      }
    }
    return output;
  } catch {
    return fallback ? { ...fallback } : {};
  }
}

function readOracleReferenceConfig(env: Env): OracleReferenceConfig {
  const enabledModes = new Set(
    String(env.ORACLE_REFERENCE_ENABLED_MODES ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => Boolean(value)),
  );
  return {
    enabledModes,
    freshnessSloMs: parsePositiveInt(
      env.ORACLE_REFERENCE_FRESHNESS_SLO_MS,
      DEFAULT_FRESHNESS_SLO_MS,
    ),
    maxSourceDivergenceBps: parsePositiveInt(
      env.ORACLE_REFERENCE_MAX_SOURCE_DIVERGENCE_BPS,
      DEFAULT_MAX_SOURCE_DIVERGENCE_BPS,
    ),
    maxExecutionDivergenceBps: parsePositiveInt(
      env.ORACLE_REFERENCE_MAX_EXECUTION_DIVERGENCE_BPS,
      DEFAULT_MAX_EXECUTION_DIVERGENCE_BPS,
    ),
    minHealthySources: parsePositiveInt(
      env.ORACLE_REFERENCE_MIN_HEALTHY_SOURCES,
      DEFAULT_MIN_HEALTHY_SOURCES,
    ),
    pythBaseUrl:
      String(env.PYTH_HERMES_BASE_URL ?? "").trim() || PYTH_DEFAULT_BASE_URL,
    switchboardBaseUrl:
      String(env.SWITCHBOARD_BASE_URL ?? "").trim() ||
      SWITCHBOARD_DEFAULT_BASE_URL,
    jupiterPriceBaseUrl:
      String(env.JUPITER_PRICE_BASE_URL ?? "").trim() ||
      String(env.JUPITER_BASE_URL ?? "").trim() ||
      JUPITER_PRICE_DEFAULT_BASE_URL,
    pythSymbolByAsset: parseStringMapJson(
      env.ORACLE_REFERENCE_PYTH_SYMBOLS_JSON,
      DEFAULT_PYTH_SYMBOL_BY_ASSET,
    ),
    switchboardFeedByAsset: parseStringMapJson(
      env.ORACLE_REFERENCE_SWITCHBOARD_FEEDS_JSON,
    ),
  };
}

function resolveReferenceAsset(mint: string): ReferenceAssetContext | null {
  const token = TRADING_TOKEN_BY_MINT[mint];
  if (!token) return null;
  return {
    assetKey: token.symbol.toUpperCase(),
    mint: token.mint,
    decimals: token.decimals,
  };
}

function isStableAsset(assetKey: string): boolean {
  return STABLE_ASSET_KEYS.has(assetKey);
}

function ratioToBps(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (numerator <= 0 || denominator <= 0) return null;
  return Math.round((Math.abs(numerator - denominator) / denominator) * 10_000);
}

function median(values: number[]): number | null {
  const normalized = values.filter((value) => Number.isFinite(value));
  if (normalized.length < 1) return null;
  const sorted = [...normalized].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return (left + right) / 2;
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const millis = parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
  return new Date(millis).toISOString();
}

function ageMs(asOfIso: string | null): number | null {
  if (!asOfIso) return null;
  const parsed = Date.parse(asOfIso);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Date.now() - parsed);
}

function toAtomicDecimal(value: string, decimals: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed / 10 ** decimals;
}

function pairPriceFromUsd(
  baseUsd: number | null,
  quoteUsd: number | null,
): number | null {
  if (!Number.isFinite(baseUsd ?? NaN) || !Number.isFinite(quoteUsd ?? NaN)) {
    return null;
  }
  if ((quoteUsd ?? 0) <= 0 || (baseUsd ?? 0) <= 0) {
    return null;
  }
  return (baseUsd as number) / (quoteUsd as number);
}

async function resolvePythFeedId(
  baseUrl: string,
  symbol: string,
): Promise<string> {
  const cacheKey = `${baseUrl}|${symbol.trim().toUpperCase()}`;
  const cached = PYTH_FEED_ID_CACHE.get(cacheKey);
  if (cached) return cached;
  const url = new URL("/v2/price_feeds", baseUrl);
  url.searchParams.set("query", symbol);
  const response = await fetch(url.toString(), { method: "GET" });
  if (!response.ok) {
    throw new Error(`pyth-price-feeds-failed:${response.status}`);
  }
  const payload = (await response.json().catch(() => null)) as Array<{
    id?: unknown;
    attributes?: Record<string, unknown>;
  }> | null;
  if (!Array.isArray(payload)) {
    throw new Error("pyth-price-feeds-invalid");
  }
  const normalized = symbol.trim().toUpperCase();
  const normalizedNoSlash = normalized.replace("/", "");
  for (const feed of payload) {
    const attributes = feed.attributes ?? {};
    const candidates = [
      String(attributes.display_symbol ?? ""),
      String(attributes.symbol ?? ""),
      String(attributes.generic_symbol ?? ""),
      attributes.base && attributes.quote_currency
        ? `${String(attributes.base)}/${String(attributes.quote_currency)}`
        : "",
    ]
      .map((value) => value.trim().toUpperCase())
      .filter((value) => Boolean(value));
    if (
      candidates.some(
        (candidate) =>
          candidate === normalized ||
          candidate.replace("/", "") === normalizedNoSlash,
      )
    ) {
      const id = String(feed.id ?? "").trim();
      if (!id) break;
      PYTH_FEED_ID_CACHE.set(cacheKey, id);
      return id;
    }
  }
  throw new Error("pyth-feed-not-found");
}

async function fetchPythUsdPrice(input: {
  baseUrl: string;
  assetKey: string;
  config: OracleReferenceConfig;
}): Promise<{
  priceUsd: number;
  asOf: string | null;
  confidenceBps: number | null;
  sourceInstrument: string;
}> {
  if (isStableAsset(input.assetKey)) {
    return {
      priceUsd: 1,
      asOf: new Date().toISOString(),
      confidenceBps: 0,
      sourceInstrument: `${input.assetKey}/USD`,
    };
  }
  const symbol = input.config.pythSymbolByAsset[input.assetKey];
  if (!symbol) {
    throw new Error("pyth-symbol-not-configured");
  }
  const feedId = await resolvePythFeedId(input.baseUrl, symbol);
  const url = new URL("/v2/updates/price/latest", input.baseUrl);
  url.searchParams.append("ids[]", feedId);
  const response = await fetch(url.toString(), { method: "GET" });
  if (!response.ok) {
    throw new Error(`pyth-price-update-failed:${response.status}`);
  }
  const payload = (await response.json().catch(() => null)) as {
    parsed?: Array<{
      price?: {
        price?: string | number;
        conf?: string | number;
        expo?: number;
        publish_time?: number;
      };
    }>;
  } | null;
  const parsed = payload?.parsed?.[0]?.price;
  if (!parsed) {
    throw new Error("pyth-price-not-found");
  }
  const expo = Number(parsed.expo ?? 0);
  const price = Number(parsed.price);
  const confidence = Number(parsed.conf);
  const scaledPrice =
    Number.isFinite(price) && Number.isFinite(expo) ? price * 10 ** expo : NaN;
  const scaledConfidence =
    Number.isFinite(confidence) && Number.isFinite(expo)
      ? confidence * 10 ** expo
      : NaN;
  if (!Number.isFinite(scaledPrice) || scaledPrice <= 0) {
    throw new Error("pyth-price-invalid");
  }
  const confidenceBps =
    Number.isFinite(scaledConfidence) && scaledConfidence >= 0
      ? ratioToBps(scaledPrice + scaledConfidence, scaledPrice)
      : null;
  return {
    priceUsd: scaledPrice,
    asOf: toIsoTimestamp(parsed.publish_time ?? null),
    confidenceBps,
    sourceInstrument: symbol,
  };
}

async function fetchSwitchboardUsdPrice(input: {
  baseUrl: string;
  assetKey: string;
  config: OracleReferenceConfig;
}): Promise<{
  priceUsd: number;
  asOf: string | null;
  confidenceBps: number | null;
  sourceInstrument: string;
}> {
  if (isStableAsset(input.assetKey)) {
    return {
      priceUsd: 1,
      asOf: new Date().toISOString(),
      confidenceBps: 0,
      sourceInstrument: `${input.assetKey}/USD`,
    };
  }
  const feedId = input.config.switchboardFeedByAsset[input.assetKey];
  if (!feedId) {
    throw new Error("switchboard-feed-not-configured");
  }
  const url = new URL(`/solana/mainnet/feed/${feedId}`, input.baseUrl);
  const response = await fetch(url.toString(), { method: "GET" });
  if (!response.ok) {
    throw new Error(`switchboard-feed-failed:${response.status}`);
  }
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("switchboard-feed-invalid");
  }
  const result =
    payload.result && typeof payload.result === "object"
      ? (payload.result as Record<string, unknown>)
      : null;
  const priceRaw =
    payload.price ??
    result?.value ??
    result?.result ??
    payload.exchange_rate ??
    null;
  const stddevRaw =
    payload.stddev ??
    payload.stdDev ??
    payload.std_deviation ??
    result?.std_dev ??
    result?.stdDev ??
    result?.stddev ??
    null;
  const timestampRaw =
    payload.timestamp ??
    payload.ts ??
    payload.time ??
    result?.timestamp ??
    result?.ts ??
    result?.time ??
    null;
  const priceUsd = Number(priceRaw);
  const stddev = Number(stddevRaw);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("switchboard-price-invalid");
  }
  const confidenceBps =
    Number.isFinite(stddev) && stddev >= 0
      ? ratioToBps(priceUsd + stddev, priceUsd)
      : null;
  return {
    priceUsd,
    asOf: toIsoTimestamp(timestampRaw),
    confidenceBps,
    sourceInstrument: feedId,
  };
}

async function fetchJupiterPairSnapshot(input: {
  baseAsset: ReferenceAssetContext;
  quoteAsset: ReferenceAssetContext;
  config: OracleReferenceConfig;
  jupiter?: JupiterClient;
}): Promise<OracleReferenceSourceSnapshot> {
  const client =
    input.jupiter ??
    new JupiterClient(input.config.jupiterPriceBaseUrl, undefined);
  try {
    const records = await client.priceV3([
      input.baseAsset.mint,
      input.quoteAsset.mint,
    ]);
    const baseRecord = records[input.baseAsset.mint] ?? null;
    const quoteRecord = records[input.quoteAsset.mint] ?? null;
    const baseUsd =
      Number(baseRecord?.usdPrice ?? baseRecord?.price ?? NaN) || NaN;
    const quoteUsd =
      Number(quoteRecord?.usdPrice ?? quoteRecord?.price ?? NaN) || NaN;
    const basePrice = isStableAsset(input.baseAsset.assetKey)
      ? 1
      : Number.isFinite(baseUsd)
        ? baseUsd
        : NaN;
    const quotePrice = isStableAsset(input.quoteAsset.assetKey)
      ? 1
      : Number.isFinite(quoteUsd)
        ? quoteUsd
        : NaN;
    const pairPrice = pairPriceFromUsd(basePrice, quotePrice);
    const baseAsOf = toIsoTimestamp(baseRecord?.time ?? null);
    const quoteAsOf = toIsoTimestamp(quoteRecord?.time ?? null);
    const asOf =
      [baseAsOf, quoteAsOf]
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => left.localeCompare(right))[0] ?? null;
    const observedAgeMs = ageMs(asOf);
    if (!Number.isFinite(pairPrice ?? NaN) || (pairPrice ?? 0) <= 0) {
      return {
        provider: "jupiter_price_v3",
        baseAssetKey: input.baseAsset.assetKey,
        quoteAssetKey: input.quoteAsset.assetKey,
        price: null,
        asOf,
        ageMs: observedAgeMs,
        confidenceBps: null,
        sourceInstrument: `${input.baseAsset.mint},${input.quoteAsset.mint}`,
        status: "missing",
        error: "jupiter-price-missing",
      };
    }
    return {
      provider: "jupiter_price_v3",
      baseAssetKey: input.baseAsset.assetKey,
      quoteAssetKey: input.quoteAsset.assetKey,
      price: pairPrice.toFixed(10).replace(/0+$/, "").replace(/\.$/, ""),
      asOf,
      ageMs: observedAgeMs,
      confidenceBps: null,
      sourceInstrument: `${input.baseAsset.mint},${input.quoteAsset.mint}`,
      status:
        observedAgeMs !== null && observedAgeMs > input.config.freshnessSloMs
          ? "stale"
          : "healthy",
      error: null,
    };
  } catch (error) {
    return {
      provider: "jupiter_price_v3",
      baseAssetKey: input.baseAsset.assetKey,
      quoteAssetKey: input.quoteAsset.assetKey,
      price: null,
      asOf: null,
      ageMs: null,
      confidenceBps: null,
      sourceInstrument: `${input.baseAsset.mint},${input.quoteAsset.mint}`,
      status: "error",
      error: error instanceof Error ? error.message : "jupiter-price-error",
    };
  }
}

async function fetchOraclePairSnapshot(input: {
  provider: "pyth" | "switchboard";
  baseAsset: ReferenceAssetContext;
  quoteAsset: ReferenceAssetContext;
  config: OracleReferenceConfig;
}): Promise<OracleReferenceSourceSnapshot> {
  try {
    const fetcher =
      input.provider === "pyth" ? fetchPythUsdPrice : fetchSwitchboardUsdPrice;
    const base = await fetcher({
      baseUrl:
        input.provider === "pyth"
          ? input.config.pythBaseUrl
          : input.config.switchboardBaseUrl,
      assetKey: input.baseAsset.assetKey,
      config: input.config,
    });
    const quote = await fetcher({
      baseUrl:
        input.provider === "pyth"
          ? input.config.pythBaseUrl
          : input.config.switchboardBaseUrl,
      assetKey: input.quoteAsset.assetKey,
      config: input.config,
    });
    const pairPrice = pairPriceFromUsd(base.priceUsd, quote.priceUsd);
    const asOf =
      [base.asOf, quote.asOf]
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => left.localeCompare(right))[0] ?? null;
    const observedAgeMs = ageMs(asOf);
    if (!Number.isFinite(pairPrice ?? NaN) || (pairPrice ?? 0) <= 0) {
      return {
        provider: input.provider,
        baseAssetKey: input.baseAsset.assetKey,
        quoteAssetKey: input.quoteAsset.assetKey,
        price: null,
        asOf,
        ageMs: observedAgeMs,
        confidenceBps: null,
        sourceInstrument: `${base.sourceInstrument}->${quote.sourceInstrument}`,
        status: "missing",
        error: `${input.provider}-pair-price-missing`,
      };
    }
    const confidenceCandidates = [
      base.confidenceBps,
      quote.confidenceBps,
    ].filter((value): value is number => Number.isFinite(value ?? NaN));
    const confidenceBps =
      confidenceCandidates.length > 0
        ? Math.max(...confidenceCandidates)
        : null;
    return {
      provider: input.provider,
      baseAssetKey: input.baseAsset.assetKey,
      quoteAssetKey: input.quoteAsset.assetKey,
      price: pairPrice.toFixed(10).replace(/0+$/, "").replace(/\.$/, ""),
      asOf,
      ageMs: observedAgeMs,
      confidenceBps,
      sourceInstrument: `${base.sourceInstrument}->${quote.sourceInstrument}`,
      status:
        observedAgeMs !== null && observedAgeMs > input.config.freshnessSloMs
          ? "stale"
          : "healthy",
      error: null,
    };
  } catch (error) {
    return {
      provider: input.provider,
      baseAssetKey: input.baseAsset.assetKey,
      quoteAssetKey: input.quoteAsset.assetKey,
      price: null,
      asOf: null,
      ageMs: null,
      confidenceBps: null,
      sourceInstrument: null,
      status: "error",
      error: error instanceof Error ? error.message : `${input.provider}-error`,
    };
  }
}

function buildStableParitySnapshot(input: {
  baseAsset: ReferenceAssetContext;
  quoteAsset: ReferenceAssetContext;
  freshnessSloMs: number;
}): OracleReferenceSourceSnapshot | null {
  if (
    !isStableAsset(input.baseAsset.assetKey) ||
    !isStableAsset(input.quoteAsset.assetKey)
  ) {
    return null;
  }
  return {
    provider: "stable_parity",
    baseAssetKey: input.baseAsset.assetKey,
    quoteAssetKey: input.quoteAsset.assetKey,
    price: "1",
    asOf: new Date().toISOString(),
    ageMs: 0,
    confidenceBps: 0,
    sourceInstrument: `${input.baseAsset.assetKey}/USD->${input.quoteAsset.assetKey}/USD`,
    status: "healthy",
    error: null,
  };
}

async function cacheReferenceSnapshots(
  env: Env,
  snapshot: OracleReferencePriceSnapshot,
): Promise<void> {
  const ts = snapshot.asOf;
  await Promise.all([
    ...snapshot.sources.map((source) =>
      upsertFeaturePoint(env, {
        source: source.provider,
        instrument: snapshot.instrumentKey,
        feature: REFERENCE_PRICE_FEATURE,
        ts,
        value: source,
        qualityScore: source.status === "healthy" ? 1 : 0,
      }),
    ),
    upsertFeaturePoint(env, {
      source: "reference_price",
      instrument: snapshot.instrumentKey,
      feature: REFERENCE_PRICE_FEATURE,
      ts,
      value: snapshot,
      qualityScore: snapshot.status === "healthy" ? 1 : 0,
    }),
  ]);
}

export async function resolveOracleReferencePriceSnapshot(input: {
  env: Env;
  inputMint: string;
  outputMint: string;
  jupiter?: JupiterClient;
}): Promise<OracleReferencePriceSnapshot> {
  const baseAsset = resolveReferenceAsset(input.inputMint);
  const quoteAsset = resolveReferenceAsset(input.outputMint);
  if (!baseAsset || !quoteAsset) {
    throw new Error("reference-price-asset-not-supported");
  }
  const config = readOracleReferenceConfig(input.env);
  const instrumentKey = `${baseAsset.assetKey}/${quoteAsset.assetKey}`;
  const [pythSnapshot, switchboardSnapshot, jupiterSnapshot] =
    await Promise.all([
      fetchOraclePairSnapshot({
        provider: "pyth",
        baseAsset,
        quoteAsset,
        config,
      }),
      fetchOraclePairSnapshot({
        provider: "switchboard",
        baseAsset,
        quoteAsset,
        config,
      }),
      fetchJupiterPairSnapshot({
        baseAsset,
        quoteAsset,
        config,
        jupiter: input.jupiter,
      }),
    ]);
  const stableParity = buildStableParitySnapshot({
    baseAsset,
    quoteAsset,
    freshnessSloMs: config.freshnessSloMs,
  });
  const sources = stableParity
    ? [stableParity, pythSnapshot, switchboardSnapshot, jupiterSnapshot]
    : [pythSnapshot, switchboardSnapshot, jupiterSnapshot];
  const healthySources = sources.filter(
    (source) => source.status === "healthy",
  );
  const healthyPrices = healthySources
    .map((source) => Number(source.price))
    .filter((value) => Number.isFinite(value) && value > 0);
  const price = median(healthyPrices);
  const observedAgeMs = healthySources
    .map((source) => source.ageMs)
    .filter((value): value is number => Number.isFinite(value ?? NaN));
  const maxSourceAgeMs =
    observedAgeMs.length > 0 ? Math.max(...observedAgeMs) : null;
  const maxObservedDivergenceBps = healthyPrices
    .map((value) =>
      Number.isFinite(price ?? NaN) && (price ?? 0) > 0
        ? ratioToBps(value, price as number)
        : null,
    )
    .filter((value): value is number => Number.isFinite(value ?? NaN))
    .reduce<number | null>(
      (current, value) => (current === null ? value : Math.max(current, value)),
      null,
    );
  const attemptedSourceCount = Math.max(
    1,
    sources.filter((source) => source.provider !== "stable_parity").length,
  );
  const healthySourceCount = healthySources.filter(
    (source) => source.provider !== "stable_parity",
  ).length;
  const staleSourceCount = sources.filter(
    (source) =>
      source.provider !== "stable_parity" && source.status === "stale",
  ).length;
  let status: OracleReferencePriceSnapshot["status"] = "healthy";
  if (
    !Number.isFinite(price ?? NaN) ||
    healthySourceCount < config.minHealthySources
  ) {
    status = staleSourceCount > 0 ? "stale" : "missing";
  } else if (
    maxSourceAgeMs !== null &&
    maxSourceAgeMs > config.freshnessSloMs
  ) {
    status = "stale";
  } else if (
    maxObservedDivergenceBps !== null &&
    maxObservedDivergenceBps > config.maxSourceDivergenceBps
  ) {
    status = "divergent";
  }
  const snapshot: OracleReferencePriceSnapshot = {
    instrumentKey,
    baseAssetKey: baseAsset.assetKey,
    quoteAssetKey: quoteAsset.assetKey,
    baseMint: baseAsset.mint,
    quoteMint: quoteAsset.mint,
    price:
      Number.isFinite(price ?? NaN) && (price ?? 0) > 0
        ? (price as number).toFixed(10).replace(/0+$/, "").replace(/\.$/, "")
        : null,
    asOf: new Date().toISOString(),
    freshnessSloMs: config.freshnessSloMs,
    maxSourceDivergenceBps: config.maxSourceDivergenceBps,
    maxSourceAgeMs,
    maxObservedDivergenceBps,
    sourceCoverageBps: Math.round(
      (healthySourceCount / attemptedSourceCount) * 10_000,
    ),
    status,
    sources,
  };
  await cacheReferenceSnapshots(input.env, snapshot);
  return snapshot;
}

export async function evaluateOracleReferencePriceGuard(input: {
  env: Env;
  mode: "shadow" | "paper" | "live";
  inputMint: string;
  outputMint: string;
  inputAmountAtomic: string;
  expectedOutputAmountAtomic: string;
  jupiter?: JupiterClient;
}): Promise<OracleReferenceGuardResult> {
  const config = readOracleReferenceConfig(input.env);
  if (!config.enabledModes.has(input.mode)) {
    return {
      enabled: false,
      verdict: "allow",
      reason: null,
      executionPrice: null,
      executionDivergenceBps: null,
      snapshot: null,
    };
  }
  const baseAsset = resolveReferenceAsset(input.inputMint);
  const quoteAsset = resolveReferenceAsset(input.outputMint);
  if (!baseAsset || !quoteAsset) {
    return {
      enabled: true,
      verdict: input.mode === "paper" ? "pause" : "reject",
      reason: "reference-price-asset-not-supported",
      executionPrice: null,
      executionDivergenceBps: null,
      snapshot: null,
    };
  }
  const snapshot = await resolveOracleReferencePriceSnapshot({
    env: input.env,
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    jupiter: input.jupiter,
  });
  if (snapshot.status !== "healthy") {
    return {
      enabled: true,
      verdict: input.mode === "paper" ? "pause" : "reject",
      reason: `reference-price-${snapshot.status}`,
      executionPrice: null,
      executionDivergenceBps: null,
      snapshot,
    };
  }
  const inputAmount = toAtomicDecimal(
    input.inputAmountAtomic,
    baseAsset.decimals,
  );
  const outputAmount = toAtomicDecimal(
    input.expectedOutputAmountAtomic,
    quoteAsset.decimals,
  );
  const executionPrice =
    Number.isFinite(inputAmount ?? NaN) &&
    Number.isFinite(outputAmount ?? NaN) &&
    (inputAmount ?? 0) > 0 &&
    (outputAmount ?? 0) > 0
      ? (outputAmount as number) / (inputAmount as number)
      : null;
  const referencePrice = Number(snapshot.price);
  const executionDivergenceBps =
    Number.isFinite(executionPrice ?? NaN) &&
    Number.isFinite(referencePrice) &&
    referencePrice > 0
      ? ratioToBps(executionPrice as number, referencePrice)
      : null;
  if (
    executionDivergenceBps !== null &&
    executionDivergenceBps > config.maxExecutionDivergenceBps
  ) {
    return {
      enabled: true,
      verdict: input.mode === "paper" ? "pause" : "reject",
      reason: "reference-price-execution-divergence",
      executionPrice:
        executionPrice !== null
          ? executionPrice.toFixed(10).replace(/0+$/, "").replace(/\.$/, "")
          : null,
      executionDivergenceBps,
      snapshot,
    };
  }
  return {
    enabled: true,
    verdict: "allow",
    reason: null,
    executionPrice:
      executionPrice !== null
        ? executionPrice.toFixed(10).replace(/0+$/, "").replace(/\.$/, "")
        : null,
    executionDivergenceBps,
    snapshot,
  };
}
