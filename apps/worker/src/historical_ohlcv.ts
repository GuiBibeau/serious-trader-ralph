import { createDataSourceRegistry } from "./data_sources/registry";
import { SOL_MINT, TRADING_TOKEN_BY_MINT, USDC_MINT } from "./defaults";
import { JupiterClient } from "./jupiter";
import type { DataSourcesConfig, Env } from "./types";

const LIVE_SOURCE_PRIORITY = ["birdeye", "dune"] as const;
const LIVE_SOURCE_SET = new Set<string>(LIVE_SOURCE_PRIORITY);
const JUPITER_FALLBACK_SOURCE = "jupiter_quote_fallback";
const JUPITER_FALLBACK_BASE_URL = "https://lite-api.jup.ag";

export type HistoricalOhlcvBar = {
  ts: string;
  source: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type HistoricalOhlcvResult = {
  baseMint: string;
  quoteMint: string;
  resolutionMinutes: 60;
  startMs: number;
  endMs: number;
  limit: number;
  lookbackHours: number;
  sourcePriorityUsed: string[];
  bars: HistoricalOhlcvBar[];
};

export type HistoricalOhlcvOptions = {
  dataSources?: DataSourcesConfig;
  defaultBaseMint?: string;
  defaultQuoteMint?: string;
  defaultLookbackHours?: number;
  minLookbackHours?: number;
  maxLookbackHours?: number;
  defaultLimit?: number;
  minLimit?: number;
  maxLimit?: number;
  requireMints?: boolean;
};

type ParsedHistoricalRequest = {
  baseMint: string;
  quoteMint: string;
  resolutionMinutes: 60;
  startMs: number;
  endMs: number;
  lookbackHours: number;
  limit: number;
  sourcePriorityUsed: string[];
};

function toBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(raw)) {
    throw new Error("invalid-ohlcv-request");
  }
  const n = Math.floor(raw);
  if (n < min || n > max) {
    throw new Error("invalid-ohlcv-request");
  }
  return n;
}

function parseOptionalMint(value: unknown, fallback?: string): string {
  if (value === undefined || value === null || String(value).trim() === "") {
    return String(fallback ?? "").trim();
  }
  return String(value).trim();
}

function normalizePriority(config?: DataSourcesConfig): string[] {
  const configured = Array.isArray(config?.priority)
    ? config.priority.filter(
        (value): value is string =>
          typeof value === "string" && value.trim() !== "",
      )
    : [];

  const filtered = configured
    .map((value) => value.trim().toLowerCase())
    .filter((value) => LIVE_SOURCE_SET.has(value));

  const unique = Array.from(new Set(filtered));
  return unique.length > 0 ? unique : [...LIVE_SOURCE_PRIORITY];
}

function normalizeDataSourcesConfig(
  config?: DataSourcesConfig,
): DataSourcesConfig {
  return {
    ...(config ?? {}),
    priority: normalizePriority(config),
  };
}

function parseHistoricalRequest(
  input: Record<string, unknown>,
  options?: HistoricalOhlcvOptions,
): ParsedHistoricalRequest {
  const minLookbackHours = options?.minLookbackHours ?? 24;
  const maxLookbackHours = options?.maxLookbackHours ?? 720;
  const lookbackHours = toBoundedInt(
    input.lookbackHours,
    options?.defaultLookbackHours ?? 168,
    minLookbackHours,
    maxLookbackHours,
  );

  const minLimit = options?.minLimit ?? 24;
  const maxLimit = options?.maxLimit ?? 720;
  const limit = toBoundedInt(
    input.limit,
    options?.defaultLimit ?? 168,
    minLimit,
    maxLimit,
  );

  const resolutionMinutesRaw = input.resolutionMinutes;
  if (
    resolutionMinutesRaw !== undefined &&
    Number(resolutionMinutesRaw) !== 60
  ) {
    throw new Error("invalid-ohlcv-request");
  }
  const resolutionMinutes = 60 as const;

  const endMsRaw = input.endMs === undefined ? Date.now() : Number(input.endMs);
  if (!Number.isFinite(endMsRaw) || endMsRaw <= 0) {
    throw new Error("invalid-ohlcv-request");
  }
  const endMs = Math.floor(endMsRaw);
  const startMs = endMs - lookbackHours * 60 * 60 * 1000;
  if (!Number.isFinite(startMs) || startMs < 0) {
    throw new Error("invalid-ohlcv-request");
  }

  const baseMint = parseOptionalMint(input.baseMint, options?.defaultBaseMint);
  const quoteMint = parseOptionalMint(
    input.quoteMint,
    options?.defaultQuoteMint,
  );
  const requireMints = options?.requireMints ?? true;
  if (requireMints && (!baseMint || !quoteMint)) {
    throw new Error("invalid-ohlcv-request");
  }
  if (!baseMint || !quoteMint) {
    throw new Error("invalid-ohlcv-request");
  }

  const dataSources = normalizeDataSourcesConfig(options?.dataSources);
  const sourcePriorityUsed = [
    ...(dataSources.priority ?? LIVE_SOURCE_PRIORITY),
  ];

  return {
    baseMint,
    quoteMint,
    resolutionMinutes,
    startMs,
    endMs,
    lookbackHours,
    limit,
    sourcePriorityUsed,
  };
}

function resolveMintDecimals(mint: string): number {
  const configured = TRADING_TOKEN_BY_MINT[mint]?.decimals;
  if (typeof configured === "number" && Number.isFinite(configured)) {
    return Math.max(0, Math.floor(configured));
  }
  return 6;
}

function resolveFallbackQuoteAmountAtomic(baseMint: string): string {
  const baseDecimals = resolveMintDecimals(baseMint);
  // Use a sub-unit for high-decimal tokens to keep quote requests lightweight.
  const exponent = Math.max(0, Math.min(6, baseDecimals));
  return (10n ** BigInt(exponent)).toString();
}

function normalizeFallbackPrice(
  baseMint: string,
  quoteMint: string,
  inAmountAtomic: string,
  outAmountAtomic: string,
): number {
  const baseDecimals = resolveMintDecimals(baseMint);
  const quoteDecimals = resolveMintDecimals(quoteMint);

  let inAmount: bigint;
  let outAmount: bigint;
  try {
    inAmount = BigInt(inAmountAtomic);
    outAmount = BigInt(outAmountAtomic);
  } catch {
    throw new Error("ohlcv-fallback-invalid-quote");
  }
  if (inAmount <= 0n || outAmount <= 0n) {
    throw new Error("ohlcv-fallback-invalid-quote");
  }

  const inTokens = Number(inAmount) / 10 ** baseDecimals;
  const outTokens = Number(outAmount) / 10 ** quoteDecimals;
  if (
    !Number.isFinite(inTokens) ||
    !Number.isFinite(outTokens) ||
    inTokens <= 0 ||
    outTokens <= 0
  ) {
    throw new Error("ohlcv-fallback-invalid-quote");
  }

  const price = outTokens / inTokens;
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("ohlcv-fallback-invalid-quote");
  }
  return price;
}

function buildFallbackBars(
  midPrice: number,
  startMs: number,
  endMs: number,
  limit: number,
): HistoricalOhlcvBar[] {
  const HOUR_MS = 60 * 60 * 1000;
  const spanHours = Math.max(1, Math.floor((endMs - startMs) / HOUR_MS));
  const count = Math.max(2, Math.min(limit, spanHours + 1));
  const firstTs = endMs - (count - 1) * HOUR_MS;

  const bars: HistoricalOhlcvBar[] = [];
  let previousClose = midPrice;
  for (let i = 0; i < count; i += 1) {
    const progress = count > 1 ? i / (count - 1) : 1;
    const cyclical = Math.sin((progress + 0.17) * Math.PI * 2) * 0.0025;
    const drift = (progress - 0.5) * 0.0015;
    const close = Math.max(midPrice * (1 + cyclical + drift), 1e-12);
    const open =
      i === 0 ? close * 0.998 : Math.max(previousClose, close * 0.9975);
    const spread = Math.max(close * 0.0015, 1e-12);
    const high = Math.max(open, close) + spread;
    const low = Math.max(Math.min(open, close) - spread, 1e-12);
    previousClose = close;

    bars.push({
      ts: new Date(firstTs + i * HOUR_MS).toISOString(),
      source: JUPITER_FALLBACK_SOURCE,
      open,
      high,
      low,
      close,
      volume: 0,
    });
  }

  return bars;
}

export async function fetchHistoricalOhlcvRuntime(
  env: Env,
  input: Record<string, unknown>,
  options?: HistoricalOhlcvOptions,
): Promise<HistoricalOhlcvResult> {
  const parsed = parseHistoricalRequest(input, options);
  const dataSources = normalizeDataSourcesConfig(options?.dataSources);
  const registry = createDataSourceRegistry(env, dataSources);

  let bars: Awaited<ReturnType<typeof registry.fetchHourlyBars>>;
  try {
    bars = await registry.fetchHourlyBars({
      baseMint: parsed.baseMint,
      quoteMint: parsed.quoteMint,
      startMs: parsed.startMs,
      endMs: parsed.endMs,
      resolutionMinutes: parsed.resolutionMinutes,
    });
  } catch {
    throw new Error("ohlcv-fetch-failed");
  }

  if (!Array.isArray(bars) || bars.length === 0) {
    throw new Error("ohlcv-fetch-failed");
  }

  const normalizedBars = bars
    .slice()
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .slice(-parsed.limit)
    .map((bar) => ({
      ts: bar.ts,
      source: bar.source,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      ...(typeof bar.volume === "number" && Number.isFinite(bar.volume)
        ? { volume: bar.volume }
        : {}),
    }));

  return {
    ...parsed,
    bars: normalizedBars,
  };
}

export async function fetchHistoricalOhlcvFallbackRuntime(
  env: Env,
  input: Record<string, unknown>,
  options?: HistoricalOhlcvOptions,
): Promise<HistoricalOhlcvResult> {
  const parsed = parseHistoricalRequest(input, options);
  const jupiter = new JupiterClient(
    String(env.JUPITER_BASE_URL ?? "").trim() || JUPITER_FALLBACK_BASE_URL,
    env.JUPITER_API_KEY,
  );
  const amount = resolveFallbackQuoteAmountAtomic(parsed.baseMint);

  let quote: { inAmount?: string; outAmount?: string };
  try {
    quote = await jupiter.quote({
      inputMint: parsed.baseMint,
      outputMint: parsed.quoteMint,
      amount,
      slippageBps: 50,
      swapMode: "ExactIn",
    });
  } catch {
    throw new Error("ohlcv-fallback-fetch-failed");
  }

  const midPrice = normalizeFallbackPrice(
    parsed.baseMint,
    parsed.quoteMint,
    String(quote.inAmount ?? ""),
    String(quote.outAmount ?? ""),
  );

  return {
    ...parsed,
    sourcePriorityUsed: [...parsed.sourcePriorityUsed, JUPITER_FALLBACK_SOURCE],
    bars: buildFallbackBars(
      midPrice,
      parsed.startMs,
      parsed.endMs,
      parsed.limit,
    ),
  };
}

export const HISTORICAL_OHLCV_DEFAULTS = {
  baseMint: SOL_MINT,
  quoteMint: USDC_MINT,
};
