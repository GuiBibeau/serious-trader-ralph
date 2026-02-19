import { createDataSourceRegistry } from "./data_sources/registry";
import { SOL_MINT, USDC_MINT } from "./defaults";
import type { DataSourcesConfig, Env } from "./types";

const LIVE_SOURCE_PRIORITY = ["birdeye", "dune"] as const;
const LIVE_SOURCE_SET = new Set<string>(LIVE_SOURCE_PRIORITY);

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

export async function fetchHistoricalOhlcvRuntime(
  env: Env,
  input: Record<string, unknown>,
  options?: HistoricalOhlcvOptions,
): Promise<HistoricalOhlcvResult> {
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
  const registry = createDataSourceRegistry(env, dataSources);

  let bars;
  try {
    bars = await registry.fetchHourlyBars({
      baseMint,
      quoteMint,
      startMs,
      endMs,
      resolutionMinutes,
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
    .slice(-limit)
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
    baseMint,
    quoteMint,
    resolutionMinutes,
    startMs,
    endMs,
    limit,
    lookbackHours,
    sourcePriorityUsed,
    bars: normalizedBars,
  };
}

export const HISTORICAL_OHLCV_DEFAULTS = {
  baseMint: SOL_MINT,
  quoteMint: USDC_MINT,
};
