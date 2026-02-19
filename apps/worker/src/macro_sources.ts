import type { Env } from "./types";

const MACRO_SIGNALS_TTL_MS = 5 * 60_000;
const MACRO_FRED_TTL_MS = 60 * 60_000;
const MACRO_ETF_TTL_MS = 15 * 60_000;
const MACRO_STABLECOIN_TTL_MS = 2 * 60_000;
const MACRO_OIL_TTL_MS = 30 * 60_000;

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const FRED_OBSERVATIONS_URL =
  "https://api.stlouisfed.org/fred/series/observations";
const FEAR_GREED_URL = "https://api.alternative.me/fng/?limit=30&format=json";
const MEMPOOL_HASHRATE_URL = "https://mempool.space/api/v1/mining/hashrate/1m";
const COINGECKO_MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets";
const EIA_SERIES_BASE = "https://api.eia.gov/v2/seriesid";
const STOOQ_DAILY_CSV_BASE = "https://stooq.com/q/d/l/";
const COINPAPRIKA_TICKER_BASE = "https://api.coinpaprika.com/v1/tickers";

const DEFAULT_FRED_SERIES = [
  "WALCL",
  "FEDFUNDS",
  "T10Y2Y",
  "UNRATE",
  "CPIAUCSL",
  "DGS10",
  "VIXCLS",
] as const;

const FRED_SERIES_META: Record<
  string,
  { name: string; unit: string; precision: number }
> = {
  WALCL: { name: "Fed Total Assets", unit: "$B", precision: 0 },
  FEDFUNDS: { name: "Fed Funds Rate", unit: "%", precision: 2 },
  T10Y2Y: { name: "10Y-2Y Spread", unit: "%", precision: 2 },
  UNRATE: { name: "Unemployment", unit: "%", precision: 1 },
  CPIAUCSL: { name: "CPI Index", unit: "", precision: 1 },
  DGS10: { name: "10Y Treasury", unit: "%", precision: 2 },
  VIXCLS: { name: "VIX", unit: "", precision: 2 },
};

const DEFAULT_ETF_TICKERS = [
  "SOLZ",
  "SOLT",
  "SSK",
  "IBIT",
  "FBTC",
  "ARKB",
  "BITB",
  "GBTC",
  "HODL",
  "BRRR",
  "EZBC",
  "BTCO",
  "BTCW",
] as const;

const ETF_ISSUER: Record<string, string> = {
  SOLZ: "Volatility Shares",
  SOLT: "Volatility Shares",
  SSK: "REX-Osprey",
  IBIT: "BlackRock",
  FBTC: "Fidelity",
  ARKB: "ARK/21Shares",
  BITB: "Bitwise",
  GBTC: "Grayscale",
  HODL: "VanEck",
  BRRR: "Valkyrie",
  EZBC: "Franklin",
  BTCO: "Invesco",
  BTCW: "WisdomTree",
};

const DEFAULT_STABLECOINS = [
  "tether",
  "usd-coin",
  "dai",
  "first-digital-usd",
  "ethena-usde",
] as const;

const COINPAPRIKA_TICKER_BY_GECKO: Record<string, string> = {
  tether: "usdt-tether",
  "usd-coin": "usdc-usd-coin",
  dai: "dai-dai",
  "first-digital-usd": "fdusd-first-digital-usd",
  "ethena-usde": "usde-ethena-usde",
};

const OIL_SERIES = {
  wti: "PET.RWTC.W",
  brent: "PET.RBRTE.W",
  production: "PET.WCRFPUS2.W",
  inventory: "PET.WCESTUS1.W",
} as const;

const STOOQ_MACRO_SYMBOLS = {
  jpy: "usdjpy",
  btc: "btcusd",
  qqq: "qqq.us",
  xlp: "xlp.us",
} as const;

type CacheCell<T> = {
  value: T | null;
  updatedAtMs: number;
};

export type MacroSignalsResponse = {
  timestamp: string;
  verdict: "BUY" | "CASH" | "UNKNOWN";
  bullishCount: number;
  totalCount: number;
  signals: {
    liquidity: {
      status: string;
      value: number | null;
      sparkline: number[];
    };
    flowStructure: {
      status: string;
      btcReturn5: number | null;
      qqqReturn5: number | null;
    };
    macroRegime: {
      status: string;
      qqqRoc20: number | null;
      xlpRoc20: number | null;
    };
    technicalTrend: {
      status: string;
      btcPrice: number | null;
      sma50: number | null;
      sma200: number | null;
      vwap30d: number | null;
      mayerMultiple: number | null;
      sparkline: number[];
    };
    hashRate: {
      status: string;
      change30d: number | null;
    };
    miningCost: {
      status: string;
    };
    fearGreed: {
      status: string;
      value: number | null;
      history: Array<{ value: number; date: string }>;
    };
  };
  meta: {
    qqqSparkline: number[];
  };
  unavailable?: boolean;
  unavailableReason?: string;
};

export type MacroFredSeries = {
  id: string;
  name: string;
  value: number | null;
  previousValue: number | null;
  change: number | null;
  changePercent: number | null;
  date: string;
  unit: string;
};

export type MacroFredIndicatorsResponse = {
  timestamp: string;
  configured: boolean;
  series: MacroFredSeries[];
  unavailableReason?: string;
};

export type MacroEtfFlow = {
  ticker: string;
  issuer: string;
  price: number;
  priceChange: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  direction: "inflow" | "outflow" | "neutral";
  estFlow: number;
};

export type MacroEtfFlowsResponse = {
  timestamp: string;
  summary: {
    etfCount: number;
    totalVolume: number;
    totalEstFlow: number;
    netDirection: "NET INFLOW" | "NET OUTFLOW" | "NEUTRAL" | "UNAVAILABLE";
    inflowCount: number;
    outflowCount: number;
  };
  etfs: MacroEtfFlow[];
  unavailable?: boolean;
  unavailableReason?: string;
};

export type MacroStablecoinRow = {
  id: string;
  symbol: string;
  name: string;
  price: number;
  deviation: number;
  pegStatus: "ON PEG" | "SLIGHT DEPEG" | "DEPEGGED";
  marketCap: number;
  volume24h: number;
  change24h: number;
  change7d: number;
  image: string | null;
};

export type MacroStablecoinHealthResponse = {
  timestamp: string;
  summary: {
    totalMarketCap: number;
    totalVolume24h: number;
    coinCount: number;
    depeggedCount: number;
    healthStatus: "HEALTHY" | "CAUTION" | "WARNING" | "UNAVAILABLE";
  };
  stablecoins: MacroStablecoinRow[];
  unavailable?: boolean;
  unavailableReason?: string;
};

export type MacroOilMetric = {
  id: string;
  name: string;
  current: number;
  previous: number;
  changePct: number;
  unit: string;
  trend: "up" | "down" | "stable";
  lastUpdated: string;
};

export type MacroOilAnalyticsResponse = {
  timestamp: string;
  configured: boolean;
  fetchedAt: string;
  wtiPrice: MacroOilMetric | null;
  brentPrice: MacroOilMetric | null;
  usProduction: MacroOilMetric | null;
  usInventory: MacroOilMetric | null;
  unavailableReason?: string;
};

type MacroFetchMeta = {
  source: string;
  status: "success" | "fallback" | "error";
  latencyMs: number;
  cacheHit: boolean;
  errorReason?: string;
};

const macroSignalsCache: CacheCell<MacroSignalsResponse> = {
  value: null,
  updatedAtMs: 0,
};

const macroFredCache = new Map<string, CacheCell<MacroFredIndicatorsResponse>>();
const macroEtfCache = new Map<string, CacheCell<MacroEtfFlowsResponse>>();
const macroStablecoinCache = new Map<
  string,
  CacheCell<MacroStablecoinHealthResponse>
>();
const macroOilCache: CacheCell<MacroOilAnalyticsResponse> = {
  value: null,
  updatedAtMs: 0,
};

function nowIso(): string {
  return new Date().toISOString();
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isFresh(updatedAtMs: number, ttlMs: number): boolean {
  return updatedAtMs > 0 && Date.now() - updatedAtMs <= ttlMs;
}

function logMacroFetch(meta: MacroFetchMeta): void {
  console.info("macro.fetch", meta);
}

function withTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return {
    signal: ctrl.signal,
    clear: () => clearTimeout(timer),
  };
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<unknown> {
  const timed = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: timed.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(`http-${response.status}`);
    }
    return await response.json();
  } finally {
    timed.clear();
  }
}

async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<string> {
  const timed = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: timed.signal,
      headers: {
        Accept: "text/plain,text/csv,*/*",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(`http-${response.status}`);
    }
    return await response.text();
  } finally {
    timed.clear();
  }
}

function normalizeFredSeriesIds(input?: string[]): string[] {
  const fallback = [...DEFAULT_FRED_SERIES];
  if (!input || input.length < 1) return fallback;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const normalized = String(item ?? "")
      .trim()
      .toUpperCase();
    if (!normalized || normalized.length > 32) continue;
    if (!/^[A-Z0-9_.-]+$/.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 20) break;
  }
  return out.length > 0 ? out : fallback;
}

function normalizeDateInput(input: unknown): string | undefined {
  const value = String(input ?? "").trim();
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

function normalizeEtfTickers(input?: string[]): string[] {
  if (!input || input.length < 1) return [...DEFAULT_ETF_TICKERS];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const normalized = String(item ?? "")
      .trim()
      .toUpperCase();
    if (!normalized || normalized.length > 10) continue;
    if (!/^[A-Z0-9.^-]+$/.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 20) break;
  }
  return out.length > 0 ? out : [...DEFAULT_ETF_TICKERS];
}

function normalizeStablecoins(input?: string[]): string[] {
  if (!input || input.length < 1) return [...DEFAULT_STABLECOINS];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const normalized = String(item ?? "")
      .trim()
      .toLowerCase();
    if (!normalized || normalized.length > 48) continue;
    if (!/^[a-z0-9-]+$/.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 20) break;
  }
  return out.length > 0 ? out : [...DEFAULT_STABLECOINS];
}

function extractClosePrices(chart: unknown): number[] {
  const rows = (
    chart as { chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } }
  )?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(rows)) return [];
  return rows.filter((value): value is number => Number.isFinite(value));
}

function extractVolumes(chart: unknown): number[] {
  const rows = (
    chart as { chart?: { result?: Array<{ indicators?: { quote?: Array<{ volume?: Array<number | null> }> } }> } }
  )?.chart?.result?.[0]?.indicators?.quote?.[0]?.volume;
  if (!Array.isArray(rows)) return [];
  return rows.filter((value): value is number => Number.isFinite(value));
}

function extractAlignedPriceVolume(
  chart: unknown,
): Array<{ price: number; volume: number }> {
  const quote = (
    chart as {
      chart?: {
        result?: Array<{
          indicators?: {
            quote?: Array<{
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }>;
      };
    }
  )?.chart?.result?.[0]?.indicators?.quote?.[0];
  const closes = Array.isArray(quote?.close) ? quote.close : [];
  const volumes = Array.isArray(quote?.volume) ? quote.volume : [];

  const pairs: Array<{ price: number; volume: number }> = [];
  for (let i = 0; i < closes.length; i += 1) {
    const price = closes[i];
    const volume = volumes[i];
    if (!Number.isFinite(price) || !Number.isFinite(volume)) continue;
    pairs.push({ price, volume });
  }
  return pairs;
}

function parseStooqCloseSeries(csv: string): number[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 3) return [];
  const headers = (lines[0] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase());
  const closeIndex = headers.indexOf("close");
  if (closeIndex < 0) return [];

  const out: number[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    if (parts.length <= closeIndex) continue;
    const close = Number(parts[closeIndex]);
    if (!Number.isFinite(close)) continue;
    out.push(close);
  }
  return out;
}

async function fetchStooqCloseSeries(
  symbol: string,
  timeoutMs: number,
): Promise<number[]> {
  const csv = await fetchTextWithTimeout(
    `${STOOQ_DAILY_CSV_BASE}?s=${encodeURIComponent(symbol)}&i=d`,
    timeoutMs,
  );
  return parseStooqCloseSeries(csv);
}

function rateOfChange(values: number[], lookback: number): number | null {
  if (values.length < lookback + 1) return null;
  const recent = values[values.length - 1];
  const past = values[values.length - 1 - lookback];
  if (!Number.isFinite(recent) || !Number.isFinite(past) || past === 0) {
    return null;
  }
  return ((recent - past) / past) * 100;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  if (slice.length < period) return null;
  const total = slice.reduce((sum, value) => sum + value, 0);
  return total / period;
}

function buildFallbackMacroSignals(reason?: string): MacroSignalsResponse {
  return {
    timestamp: nowIso(),
    verdict: "UNKNOWN",
    bullishCount: 0,
    totalCount: 0,
    signals: {
      liquidity: { status: "UNKNOWN", value: null, sparkline: [] },
      flowStructure: { status: "UNKNOWN", btcReturn5: null, qqqReturn5: null },
      macroRegime: { status: "UNKNOWN", qqqRoc20: null, xlpRoc20: null },
      technicalTrend: {
        status: "UNKNOWN",
        btcPrice: null,
        sma50: null,
        sma200: null,
        vwap30d: null,
        mayerMultiple: null,
        sparkline: [],
      },
      hashRate: { status: "UNKNOWN", change30d: null },
      miningCost: { status: "UNKNOWN" },
      fearGreed: { status: "UNKNOWN", value: null, history: [] },
    },
    meta: { qqqSparkline: [] },
    unavailable: true,
    unavailableReason: reason,
  };
}

function isMacroSignalsDegraded(payload: MacroSignalsResponse): boolean {
  return (
    payload.signals.liquidity.status === "UNKNOWN" ||
    payload.signals.flowStructure.status === "UNKNOWN" ||
    payload.signals.macroRegime.status === "UNKNOWN"
  );
}

export async function fetchMacroSignals(
  timeoutMs = 9_000,
): Promise<MacroSignalsResponse> {
  const startedAt = Date.now();
  if (macroSignalsCache.value && isFresh(macroSignalsCache.updatedAtMs, MACRO_SIGNALS_TTL_MS)) {
    if (!isMacroSignalsDegraded(macroSignalsCache.value)) {
      logMacroFetch({
        source: "macro_signals",
        status: "success",
        latencyMs: Date.now() - startedAt,
        cacheHit: true,
      });
      return macroSignalsCache.value;
    }
  }

  try {
    const [jpyChart, btcChart, qqqChart, xlpChart, fearGreed, mempoolHash] =
      await Promise.allSettled([
        fetchJsonWithTimeout(`${YAHOO_CHART_BASE}/JPY=X?range=1y&interval=1d`, timeoutMs),
        fetchJsonWithTimeout(`${YAHOO_CHART_BASE}/BTC-USD?range=1y&interval=1d`, timeoutMs),
        fetchJsonWithTimeout(`${YAHOO_CHART_BASE}/QQQ?range=1y&interval=1d`, timeoutMs),
        fetchJsonWithTimeout(`${YAHOO_CHART_BASE}/XLP?range=1y&interval=1d`, timeoutMs),
        fetchJsonWithTimeout(FEAR_GREED_URL, timeoutMs),
        fetchJsonWithTimeout(MEMPOOL_HASHRATE_URL, timeoutMs),
      ]);

    let jpyPrices = jpyChart.status === "fulfilled" ? extractClosePrices(jpyChart.value) : [];
    let btcPrices = btcChart.status === "fulfilled" ? extractClosePrices(btcChart.value) : [];
    let qqqPrices = qqqChart.status === "fulfilled" ? extractClosePrices(qqqChart.value) : [];
    let xlpPrices = xlpChart.status === "fulfilled" ? extractClosePrices(xlpChart.value) : [];
    const btcAligned =
      btcChart.status === "fulfilled" ? extractAlignedPriceVolume(btcChart.value) : [];

    const fallbackSeriesRequests: Array<
      Promise<{ key: "jpy" | "btc" | "qqq" | "xlp"; values: number[] }>
    > = [];
    if (jpyPrices.length < 31) {
      fallbackSeriesRequests.push(
        fetchStooqCloseSeries(STOOQ_MACRO_SYMBOLS.jpy, timeoutMs).then(
          (values) => ({ key: "jpy", values }),
        ),
      );
    }
    if (btcPrices.length < 60) {
      fallbackSeriesRequests.push(
        fetchStooqCloseSeries(STOOQ_MACRO_SYMBOLS.btc, timeoutMs).then(
          (values) => ({ key: "btc", values }),
        ),
      );
    }
    if (qqqPrices.length < 31) {
      fallbackSeriesRequests.push(
        fetchStooqCloseSeries(STOOQ_MACRO_SYMBOLS.qqq, timeoutMs).then(
          (values) => ({ key: "qqq", values }),
        ),
      );
    }
    if (xlpPrices.length < 31) {
      fallbackSeriesRequests.push(
        fetchStooqCloseSeries(STOOQ_MACRO_SYMBOLS.xlp, timeoutMs).then(
          (values) => ({ key: "xlp", values }),
        ),
      );
    }

    if (fallbackSeriesRequests.length > 0) {
      const fallbackSeries = await Promise.allSettled(fallbackSeriesRequests);
      for (const result of fallbackSeries) {
        if (result.status !== "fulfilled") continue;
        const row = result.value;
        if (row.key === "jpy" && row.values.length > jpyPrices.length) {
          jpyPrices = row.values;
        } else if (row.key === "btc" && row.values.length > btcPrices.length) {
          btcPrices = row.values;
        } else if (row.key === "qqq" && row.values.length > qqqPrices.length) {
          qqqPrices = row.values;
        } else if (row.key === "xlp" && row.values.length > xlpPrices.length) {
          xlpPrices = row.values;
        }
      }
    }

    const jpyRoc30 = rateOfChange(jpyPrices, 30);
    const liquidityStatus =
      jpyRoc30 === null ? "UNKNOWN" : jpyRoc30 < -2 ? "SQUEEZE" : "NORMAL";

    const btcReturn5 = rateOfChange(btcPrices, 5);
    const qqqReturn5 = rateOfChange(qqqPrices, 5);
    let flowStatus = "UNKNOWN";
    if (btcReturn5 !== null && qqqReturn5 !== null) {
      const gap = btcReturn5 - qqqReturn5;
      flowStatus = Math.abs(gap) > 5 ? "PASSIVE GAP" : "ALIGNED";
    }

    const qqqRoc20 = rateOfChange(qqqPrices, 20);
    const xlpRoc20 = rateOfChange(xlpPrices, 20);
    let regimeStatus = "UNKNOWN";
    if (qqqRoc20 !== null && xlpRoc20 !== null) {
      regimeStatus = qqqRoc20 > xlpRoc20 ? "RISK-ON" : "DEFENSIVE";
    }

    const btcSma50 = sma(btcPrices, 50);
    const btcSma200 = sma(btcPrices, 200);
    const btcCurrent = btcPrices.length > 0 ? btcPrices[btcPrices.length - 1] : null;

    let btcVwap: number | null = null;
    if (btcAligned.length >= 30) {
      const last30 = btcAligned.slice(-30);
      let sumPv = 0;
      let sumV = 0;
      for (const row of last30) {
        sumPv += row.price * row.volume;
        sumV += row.volume;
      }
      if (sumV > 0) btcVwap = round(sumPv / sumV, 0);
    }

    let trendStatus = "UNKNOWN";
    let mayerMultiple: number | null = null;
    if (btcCurrent !== null && btcSma50 !== null) {
      const aboveSma = btcCurrent > btcSma50 * 1.02;
      const belowSma = btcCurrent < btcSma50 * 0.98;
      const aboveVwap = btcVwap !== null ? btcCurrent > btcVwap : null;
      if (aboveSma && aboveVwap !== false) trendStatus = "BULLISH";
      else if (belowSma && aboveVwap !== true) trendStatus = "BEARISH";
      else trendStatus = "NEUTRAL";
    }

    if (btcCurrent !== null && btcSma200 !== null && btcSma200 > 0) {
      mayerMultiple = round(btcCurrent / btcSma200, 2);
    }

    let hashStatus = "UNKNOWN";
    let hashChange: number | null = null;
    if (mempoolHash.status === "fulfilled") {
      const rowsRaw = (
        mempoolHash.value as {
          hashrates?: Array<{ avgHashrate?: number } | number>;
        }
      )?.hashrates;
      const rows = Array.isArray(rowsRaw)
        ? rowsRaw
        : Array.isArray(mempoolHash.value)
          ? (mempoolHash.value as Array<{ avgHashrate?: number } | number>)
          : [];
      if (rows.length >= 2) {
        const last = rows[rows.length - 1];
        const first = rows[0];
        const recent =
          typeof last === "number"
            ? last
            : toFiniteNumber(last?.avgHashrate, 0);
        const older =
          typeof first === "number"
            ? first
            : toFiniteNumber(first?.avgHashrate, 0);
        if (older > 0 && recent > 0) {
          hashChange = round(((recent - older) / older) * 100, 1);
          hashStatus =
            hashChange > 3 ? "GROWING" : hashChange < -3 ? "DECLINING" : "STABLE";
        }
      }
    }

    let miningStatus = "UNKNOWN";
    if (btcCurrent !== null && hashChange !== null) {
      miningStatus =
        btcCurrent > 60_000
          ? "PROFITABLE"
          : btcCurrent > 40_000
            ? "TIGHT"
            : "SQUEEZE";
    }

    let fgValue: number | null = null;
    let fgLabel = "UNKNOWN";
    let fgHistory: Array<{ value: number; date: string }> = [];
    if (fearGreed.status === "fulfilled") {
      const rows = (
        fearGreed.value as {
          data?: Array<{
            value?: string;
            value_classification?: string;
            timestamp?: string;
          }>;
        }
      )?.data;
      if (Array.isArray(rows) && rows.length > 0) {
        const currentRaw = Number.parseInt(String(rows[0]?.value ?? ""), 10);
        fgValue = Number.isFinite(currentRaw) ? currentRaw : null;
        fgLabel = String(rows[0]?.value_classification ?? "UNKNOWN");
        fgHistory = rows
          .slice(0, 30)
          .map((row) => {
            const value = Number.parseInt(String(row.value ?? ""), 10);
            const timestamp = Number.parseInt(String(row.timestamp ?? ""), 10);
            if (!Number.isFinite(value) || !Number.isFinite(timestamp)) {
              return null;
            }
            return {
              value,
              date: new Date(timestamp * 1000).toISOString().slice(0, 10),
            };
          })
          .filter((row): row is { value: number; date: string } => Boolean(row))
          .reverse();
      }
    }

    const btcSparkline = btcPrices.slice(-30);
    const qqqSparkline = qqqPrices.slice(-30);
    const jpySparkline = jpyPrices.slice(-30);

    let bullishCount = 0;
    let totalCount = 0;
    const signals = [
      {
        status: liquidityStatus,
        bullish: liquidityStatus === "NORMAL",
      },
      {
        status: flowStatus,
        bullish: flowStatus === "ALIGNED",
      },
      {
        status: regimeStatus,
        bullish: regimeStatus === "RISK-ON",
      },
      {
        status: trendStatus,
        bullish: trendStatus === "BULLISH",
      },
      {
        status: hashStatus,
        bullish: hashStatus === "GROWING",
      },
      {
        status: miningStatus,
        bullish: miningStatus === "PROFITABLE",
      },
      {
        status: fgLabel,
        bullish: fgValue !== null && fgValue > 50,
      },
    ];

    for (const signal of signals) {
      if (signal.status === "UNKNOWN") continue;
      totalCount += 1;
      if (signal.bullish) bullishCount += 1;
    }

    const verdict: "BUY" | "CASH" | "UNKNOWN" =
      totalCount === 0 ? "UNKNOWN" : bullishCount / totalCount >= 0.57 ? "BUY" : "CASH";

    const payload: MacroSignalsResponse = {
      timestamp: nowIso(),
      verdict,
      bullishCount,
      totalCount,
      signals: {
        liquidity: {
          status: liquidityStatus,
          value: jpyRoc30 !== null ? round(jpyRoc30, 2) : null,
          sparkline: jpySparkline,
        },
        flowStructure: {
          status: flowStatus,
          btcReturn5: btcReturn5 !== null ? round(btcReturn5, 2) : null,
          qqqReturn5: qqqReturn5 !== null ? round(qqqReturn5, 2) : null,
        },
        macroRegime: {
          status: regimeStatus,
          qqqRoc20: qqqRoc20 !== null ? round(qqqRoc20, 2) : null,
          xlpRoc20: xlpRoc20 !== null ? round(xlpRoc20, 2) : null,
        },
        technicalTrend: {
          status: trendStatus,
          btcPrice: btcCurrent,
          sma50: btcSma50 !== null ? round(btcSma50, 0) : null,
          sma200: btcSma200 !== null ? round(btcSma200, 0) : null,
          vwap30d: btcVwap,
          mayerMultiple,
          sparkline: btcSparkline,
        },
        hashRate: {
          status: hashStatus,
          change30d: hashChange,
        },
        miningCost: {
          status: miningStatus,
        },
        fearGreed: {
          status: fgLabel,
          value: fgValue,
          history: fgHistory,
        },
      },
      meta: {
        qqqSparkline,
      },
    };

    macroSignalsCache.value = payload;
    macroSignalsCache.updatedAtMs = Date.now();

    logMacroFetch({
      source: "macro_signals",
      status: "success",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
    });

    return payload;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "macro-signals-failed";
    if (macroSignalsCache.value) {
      const fallback = {
        ...macroSignalsCache.value,
        timestamp: nowIso(),
      };
      logMacroFetch({
        source: "macro_signals",
        status: "fallback",
        latencyMs: Date.now() - startedAt,
        cacheHit: true,
        errorReason: reason,
      });
      return fallback;
    }
    const fallback = buildFallbackMacroSignals(reason);
    macroSignalsCache.value = fallback;
    macroSignalsCache.updatedAtMs = Date.now();
    logMacroFetch({
      source: "macro_signals",
      status: "error",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
      errorReason: reason,
    });
    return fallback;
  }
}

function fredCacheKey(
  seriesIds: string[],
  observationStart?: string,
  observationEnd?: string,
): string {
  return `${seriesIds.join(",")}|${observationStart ?? ""}|${observationEnd ?? ""}`;
}

export async function fetchMacroFredIndicators(
  env: Env,
  input?: {
    seriesIds?: string[];
    observationStart?: string;
    observationEnd?: string;
  },
  timeoutMs = 10_000,
): Promise<MacroFredIndicatorsResponse> {
  const seriesIds = normalizeFredSeriesIds(input?.seriesIds);
  const observationStart = normalizeDateInput(input?.observationStart);
  const observationEnd = normalizeDateInput(input?.observationEnd);
  const cacheKey = fredCacheKey(seriesIds, observationStart, observationEnd);
  const startedAt = Date.now();

  const cached = macroFredCache.get(cacheKey);
  if (cached?.value && isFresh(cached.updatedAtMs, MACRO_FRED_TTL_MS)) {
    logMacroFetch({
      source: "macro_fred_indicators",
      status: "success",
      latencyMs: Date.now() - startedAt,
      cacheHit: true,
    });
    return cached.value;
  }

  const apiKey = String(env.FRED_API_KEY ?? "").trim();
  if (!apiKey) {
    const response: MacroFredIndicatorsResponse = {
      timestamp: nowIso(),
      configured: false,
      series: [],
      unavailableReason: "fred-api-key-missing",
    };
    macroFredCache.set(cacheKey, { value: response, updatedAtMs: Date.now() });
    logMacroFetch({
      source: "macro_fred_indicators",
      status: "fallback",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
      errorReason: "fred-api-key-missing",
    });
    return response;
  }

  try {
    const rows = await Promise.all(
      seriesIds.map(async (seriesId): Promise<MacroFredSeries | null> => {
        const params = new URLSearchParams({
          series_id: seriesId,
          api_key: apiKey,
          file_type: "json",
          sort_order: "desc",
          limit: "10",
        });
        if (observationStart) params.set("observation_start", observationStart);
        if (observationEnd) params.set("observation_end", observationEnd);

        const payload = (await fetchJsonWithTimeout(
          `${FRED_OBSERVATIONS_URL}?${params.toString()}`,
          timeoutMs,
        )) as {
          observations?: Array<{ date?: string; value?: string }>;
        };

        const observations = Array.isArray(payload.observations)
          ? payload.observations
          : [];

        const points = observations
          .map((obs) => {
            const value = Number.parseFloat(String(obs.value ?? ""));
            if (!Number.isFinite(value) || String(obs.value ?? "") === ".") {
              return null;
            }
            return {
              date: String(obs.date ?? ""),
              value,
            };
          })
          .filter((row): row is { date: string; value: number } => Boolean(row))
          .reverse();

        if (points.length < 1) return null;

        const latest = points[points.length - 1];
        const previous = points.length >= 2 ? points[points.length - 2] : null;
        if (!latest) return null;

        const meta = FRED_SERIES_META[seriesId] ?? {
          name: seriesId,
          unit: "",
          precision: 2,
        };

        let latestValue = latest.value;
        let prevValue = previous?.value ?? null;
        if (seriesId === "WALCL") {
          latestValue /= 1000;
          if (prevValue !== null) prevValue /= 1000;
        }

        const change = prevValue !== null ? latestValue - prevValue : null;
        const changePercent =
          prevValue !== null && prevValue !== 0
            ? (change ?? 0) / prevValue * 100
            : null;

        return {
          id: seriesId,
          name: meta.name,
          value: round(latestValue, meta.precision),
          previousValue:
            prevValue === null ? null : round(prevValue, meta.precision),
          change: change === null ? null : round(change, meta.precision),
          changePercent:
            changePercent === null ? null : round(changePercent, 2),
          date: latest.date,
          unit: meta.unit,
        };
      }),
    );

    const series = rows.filter((row): row is MacroFredSeries => Boolean(row));
    const response: MacroFredIndicatorsResponse = {
      timestamp: nowIso(),
      configured: true,
      series,
      ...(series.length > 0 ? {} : { unavailableReason: "fred-no-series-data" }),
    };

    macroFredCache.set(cacheKey, { value: response, updatedAtMs: Date.now() });

    logMacroFetch({
      source: "macro_fred_indicators",
      status: "success",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
    });

    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "fred-fetch-failed";
    if (cached?.value) {
      const fallback = { ...cached.value, timestamp: nowIso() };
      logMacroFetch({
        source: "macro_fred_indicators",
        status: "fallback",
        latencyMs: Date.now() - startedAt,
        cacheHit: true,
        errorReason: reason,
      });
      return fallback;
    }

    const fallback: MacroFredIndicatorsResponse = {
      timestamp: nowIso(),
      configured: true,
      series: [],
      unavailableReason: reason,
    };
    macroFredCache.set(cacheKey, { value: fallback, updatedAtMs: Date.now() });
    logMacroFetch({
      source: "macro_fred_indicators",
      status: "error",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
      errorReason: reason,
    });
    return fallback;
  }
}

function parseEtfChartData(
  chart: unknown,
  ticker: string,
  issuer: string,
): MacroEtfFlow | null {
  const closes = extractClosePrices(chart);
  const volumes = extractVolumes(chart);
  if (closes.length < 2 || volumes.length < 1) return null;

  const latestPrice = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];
  if (latestPrice === undefined || prevPrice === undefined) return null;

  const latestVolume = volumes[volumes.length - 1] ?? 0;
  const historicalVolumes = volumes.length > 1 ? volumes.slice(0, -1) : [];
  return buildEtfFlowFromSeries({
    ticker,
    issuer,
    latestPrice,
    prevPrice,
    latestVolume,
    historicalVolumes,
  });
}

function buildEtfFlowFromSeries(input: {
  ticker: string;
  issuer: string;
  latestPrice: number;
  prevPrice: number;
  latestVolume: number;
  historicalVolumes: number[];
}): MacroEtfFlow | null {
  const {
    ticker,
    issuer,
    latestPrice,
    prevPrice,
    latestVolume,
    historicalVolumes,
  } = input;
  if (
    !Number.isFinite(latestPrice) ||
    !Number.isFinite(prevPrice) ||
    !Number.isFinite(latestVolume)
  ) {
    return null;
  }
  const priceChange =
    prevPrice !== 0 ? ((latestPrice - prevPrice) / prevPrice) * 100 : 0;
  const avgVolume =
    historicalVolumes.length > 0
      ? historicalVolumes.reduce((sum, value) => sum + value, 0) /
        historicalVolumes.length
      : latestVolume;

  const volumeRatio = avgVolume > 0 ? latestVolume / avgVolume : 1;
  const direction: MacroEtfFlow["direction"] =
    priceChange > 0.1 ? "inflow" : priceChange < -0.1 ? "outflow" : "neutral";

  return {
    ticker,
    issuer,
    price: round(latestPrice, 2),
    priceChange: round(priceChange, 2),
    volume: Math.round(latestVolume),
    avgVolume: Math.round(avgVolume),
    volumeRatio: round(volumeRatio, 2),
    direction,
    estFlow: Math.round(latestVolume * latestPrice * (priceChange > 0 ? 1 : -1) * 0.1),
  };
}

function parseEtfStooqCsvData(
  csv: string,
  ticker: string,
  issuer: string,
): MacroEtfFlow | null {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 3) return null;
  const header = lines[0]?.toLowerCase() ?? "";
  if (!header.startsWith("date,open,high,low,close,volume")) {
    return null;
  }

  const rows: Array<{ close: number; volume: number }> = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    if (parts.length < 6) continue;
    const close = Number(parts[4]);
    const volume = Number(parts[5]);
    if (!Number.isFinite(close) || !Number.isFinite(volume)) continue;
    rows.push({ close, volume });
  }
  if (rows.length < 2) return null;

  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  if (!latest || !previous) return null;

  const historyStart = Math.max(0, rows.length - 21);
  const historicalVolumes = rows
    .slice(historyStart, rows.length - 1)
    .map((row) => row.volume);

  return buildEtfFlowFromSeries({
    ticker,
    issuer,
    latestPrice: latest.close,
    prevPrice: previous.close,
    latestVolume: latest.volume,
    historicalVolumes,
  });
}

function etfCacheKey(tickers: string[]): string {
  return tickers.join(",");
}

function buildFallbackEtfFlows(reason?: string): MacroEtfFlowsResponse {
  return {
    timestamp: nowIso(),
    summary: {
      etfCount: 0,
      totalVolume: 0,
      totalEstFlow: 0,
      netDirection: "UNAVAILABLE",
      inflowCount: 0,
      outflowCount: 0,
    },
    etfs: [],
    unavailable: true,
    unavailableReason: reason,
  };
}

export async function fetchMacroEtfFlows(
  input?: { tickers?: string[] },
  timeoutMs = 8_000,
): Promise<MacroEtfFlowsResponse> {
  const tickers = normalizeEtfTickers(input?.tickers);
  const cacheKey = etfCacheKey(tickers);
  const startedAt = Date.now();
  const cached = macroEtfCache.get(cacheKey);

  if (cached?.value && isFresh(cached.updatedAtMs, MACRO_ETF_TTL_MS)) {
    logMacroFetch({
      source: "macro_etf_flows",
      status: "success",
      latencyMs: Date.now() - startedAt,
      cacheHit: true,
    });
    return cached.value;
  }

  try {
    const charts = await Promise.allSettled(
      tickers.map((ticker) =>
        fetchJsonWithTimeout(
          `${YAHOO_CHART_BASE}/${encodeURIComponent(ticker)}?range=5d&interval=1d`,
          timeoutMs,
        ),
      ),
    );

    const etfs = new Map<string, MacroEtfFlow>();
    const unresolvedTickers: string[] = [];
    for (let index = 0; index < tickers.length; index += 1) {
      const ticker = tickers[index];
      if (!ticker) continue;
      const chart = charts[index];
      if (chart?.status === "fulfilled") {
        const parsed = parseEtfChartData(
          chart.value,
          ticker,
          ETF_ISSUER[ticker] ?? "Unknown",
        );
        if (parsed) {
          etfs.set(ticker, parsed);
          continue;
        }
      }
      unresolvedTickers.push(ticker);
    }

    if (unresolvedTickers.length > 0) {
      const stooqBatchSize = 4;
      for (
        let start = 0;
        start < unresolvedTickers.length;
        start += stooqBatchSize
      ) {
        const batch = unresolvedTickers.slice(start, start + stooqBatchSize);
        const csvResults = await Promise.allSettled(
          batch.map((ticker) =>
            fetchTextWithTimeout(
              `${STOOQ_DAILY_CSV_BASE}?s=${encodeURIComponent(
                ticker.toLowerCase(),
              )}.us&i=d`,
              timeoutMs,
            ),
          ),
        );

        for (let index = 0; index < batch.length; index += 1) {
          const ticker = batch[index];
          if (!ticker) continue;
          const result = csvResults[index];
          if (!result || result.status !== "fulfilled") continue;
          const parsed = parseEtfStooqCsvData(
            result.value,
            ticker,
            ETF_ISSUER[ticker] ?? "Unknown",
          );
          if (parsed) etfs.set(ticker, parsed);
        }
      }
    }

    const etfRows = Array.from(etfs.values());
    const totalVolume = etfRows.reduce((sum, row) => sum + row.volume, 0);
    const totalEstFlow = etfRows.reduce((sum, row) => sum + row.estFlow, 0);
    const inflowCount = etfRows.filter(
      (row) => row.direction === "inflow",
    ).length;
    const outflowCount = etfRows.filter(
      (row) => row.direction === "outflow",
    ).length;

    const response: MacroEtfFlowsResponse = {
      timestamp: nowIso(),
      summary: {
        etfCount: etfRows.length,
        totalVolume,
        totalEstFlow,
        netDirection:
          totalEstFlow > 0
            ? "NET INFLOW"
            : totalEstFlow < 0
              ? "NET OUTFLOW"
              : "NEUTRAL",
        inflowCount,
        outflowCount,
      },
      etfs: etfRows.sort((a, b) => b.volume - a.volume),
      ...(etfRows.length > 0
        ? {}
        : {
            unavailable: true,
            unavailableReason: "etf-no-provider-data",
          }),
    };

    macroEtfCache.set(cacheKey, { value: response, updatedAtMs: Date.now() });
    logMacroFetch({
      source: "macro_etf_flows",
      status: "success",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
    });
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "etf-flows-failed";
    if (cached?.value) {
      const fallback = { ...cached.value, timestamp: nowIso() };
      logMacroFetch({
        source: "macro_etf_flows",
        status: "fallback",
        latencyMs: Date.now() - startedAt,
        cacheHit: true,
        errorReason: reason,
      });
      return fallback;
    }
    const fallback = buildFallbackEtfFlows(reason);
    macroEtfCache.set(cacheKey, { value: fallback, updatedAtMs: Date.now() });
    logMacroFetch({
      source: "macro_etf_flows",
      status: "error",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
      errorReason: reason,
    });
    return fallback;
  }
}

function stablecoinCacheKey(coins: string[]): string {
  return `v2:${coins.join(",")}`;
}

function buildFallbackStablecoinHealth(
  reason?: string,
): MacroStablecoinHealthResponse {
  return {
    timestamp: nowIso(),
    summary: {
      totalMarketCap: 0,
      totalVolume24h: 0,
      coinCount: 0,
      depeggedCount: 0,
      healthStatus: "UNAVAILABLE",
    },
    stablecoins: [],
    unavailable: true,
    unavailableReason: reason,
  };
}

function toStablecoinRow(input: {
  id: string;
  symbol: string;
  name: string;
  price: number;
  marketCap: number;
  volume24h: number;
  change24h: number;
  change7d: number;
  image?: string | null;
}): MacroStablecoinRow {
  const deviation = Math.abs(input.price - 1);
  const pegStatus: MacroStablecoinRow["pegStatus"] =
    deviation <= 0.005
      ? "ON PEG"
      : deviation <= 0.01
        ? "SLIGHT DEPEG"
        : "DEPEGGED";

  return {
    id: input.id,
    symbol: input.symbol.toUpperCase(),
    name: input.name,
    price: input.price,
    deviation: round(deviation * 100, 3),
    pegStatus,
    marketCap: Math.round(input.marketCap),
    volume24h: Math.round(input.volume24h),
    change24h: round(input.change24h, 2),
    change7d: round(input.change7d, 2),
    image: input.image ?? null,
  };
}

async function fetchStablecoinsFromCoinGecko(
  coins: string[],
  timeoutMs: number,
): Promise<MacroStablecoinRow[]> {
  const params = new URLSearchParams({
    vs_currency: "usd",
    ids: coins.join(","),
    order: "market_cap_desc",
    sparkline: "false",
    price_change_percentage: "7d",
  });

  const payload = (await fetchJsonWithTimeout(
    `${COINGECKO_MARKETS_URL}?${params.toString()}`,
    timeoutMs,
  )) as Array<{
    id?: string;
    symbol?: string;
    name?: string;
    current_price?: number;
    market_cap?: number;
    total_volume?: number;
    price_change_percentage_24h?: number;
    price_change_percentage_7d_in_currency?: number;
    image?: string;
  }>;

  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((coin) =>
    toStablecoinRow({
      id: String(coin.id ?? ""),
      symbol: String(coin.symbol ?? ""),
      name: String(coin.name ?? ""),
      price: toFiniteNumber(coin.current_price, 0),
      marketCap: toFiniteNumber(coin.market_cap, 0),
      volume24h: toFiniteNumber(coin.total_volume, 0),
      change24h: toFiniteNumber(coin.price_change_percentage_24h, 0),
      change7d: toFiniteNumber(coin.price_change_percentage_7d_in_currency, 0),
      image: typeof coin.image === "string" ? coin.image : null,
    }),
  );
}

async function fetchStablecoinsFromCoinPaprika(
  coins: string[],
  timeoutMs: number,
): Promise<MacroStablecoinRow[]> {
  const mapped = coins
    .map((coin) => ({
      geckoId: coin,
      tickerId: COINPAPRIKA_TICKER_BY_GECKO[coin],
    }))
    .filter((entry): entry is { geckoId: string; tickerId: string } =>
      Boolean(entry.tickerId),
    );

  if (mapped.length < 1) return [];

  const results = await Promise.allSettled(
    mapped.map((entry) =>
      fetchJsonWithTimeout(
        `${COINPAPRIKA_TICKER_BASE}/${encodeURIComponent(entry.tickerId)}`,
        timeoutMs,
      ),
    ),
  );

  const rows: MacroStablecoinRow[] = [];
  for (let index = 0; index < mapped.length; index += 1) {
    const entry = mapped[index];
    const result = results[index];
    if (!entry || !result || result.status !== "fulfilled") continue;
    const payload = result.value as {
      symbol?: string;
      name?: string;
      quotes?: {
        USD?: {
          price?: number;
          volume_24h?: number;
          market_cap?: number;
          percent_change_24h?: number;
          percent_change_7d?: number;
        };
      };
    };
    const usd = payload.quotes?.USD;
    if (!usd) continue;

    rows.push(
      toStablecoinRow({
        id: entry.geckoId,
        symbol: String(payload.symbol ?? entry.geckoId),
        name: String(payload.name ?? entry.geckoId),
        price: toFiniteNumber(usd.price, 0),
        marketCap: toFiniteNumber(usd.market_cap, 0),
        volume24h: toFiniteNumber(usd.volume_24h, 0),
        change24h: toFiniteNumber(usd.percent_change_24h, 0),
        change7d: toFiniteNumber(usd.percent_change_7d, 0),
        image: null,
      }),
    );
  }

  return rows;
}

export async function fetchMacroStablecoinHealth(
  input?: { coins?: string[] },
  timeoutMs = 10_000,
): Promise<MacroStablecoinHealthResponse> {
  const coins = normalizeStablecoins(input?.coins);
  const cacheKey = stablecoinCacheKey(coins);
  const startedAt = Date.now();
  const cached = macroStablecoinCache.get(cacheKey);
  if (cached?.value && isFresh(cached.updatedAtMs, MACRO_STABLECOIN_TTL_MS)) {
    logMacroFetch({
      source: "macro_stablecoin_health",
      status: "success",
      latencyMs: Date.now() - startedAt,
      cacheHit: true,
    });
    return cached.value;
  }

  try {
    let providerUsed: "coingecko" | "coinpaprika" = "coingecko";
    let stablecoins: MacroStablecoinRow[] = [];
    let geckoErrorReason: string | null = null;

    try {
      stablecoins = await fetchStablecoinsFromCoinGecko(coins, timeoutMs);
    } catch (error) {
      geckoErrorReason =
        error instanceof Error ? error.message : "stablecoin-coingecko-failed";
      providerUsed = "coinpaprika";
      stablecoins = await fetchStablecoinsFromCoinPaprika(coins, timeoutMs);
    }

    const totalMarketCap = stablecoins.reduce((sum, row) => sum + row.marketCap, 0);
    const totalVolume24h = stablecoins.reduce((sum, row) => sum + row.volume24h, 0);
    const depeggedCount = stablecoins.filter((row) => row.pegStatus === "DEPEGGED").length;

    const response: MacroStablecoinHealthResponse = {
      timestamp: nowIso(),
      summary: {
        totalMarketCap,
        totalVolume24h,
        coinCount: stablecoins.length,
        depeggedCount,
        healthStatus:
          depeggedCount === 0
            ? "HEALTHY"
            : depeggedCount === 1
              ? "CAUTION"
              : "WARNING",
      },
      stablecoins: stablecoins.sort((a, b) => b.marketCap - a.marketCap),
      ...(stablecoins.length > 0
        ? {}
        : {
            unavailable: true,
            unavailableReason:
              providerUsed === "coinpaprika" && geckoErrorReason
                ? `stablecoin-no-data-after-${geckoErrorReason}`
                : "stablecoin-no-data",
          }),
    };

    macroStablecoinCache.set(cacheKey, {
      value: response,
      updatedAtMs: Date.now(),
    });

    logMacroFetch({
      source: "macro_stablecoin_health",
      status: "success",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
    });

    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "stablecoin-fetch-failed";
    if (cached?.value) {
      const fallback = { ...cached.value, timestamp: nowIso() };
      logMacroFetch({
        source: "macro_stablecoin_health",
        status: "fallback",
        latencyMs: Date.now() - startedAt,
        cacheHit: true,
        errorReason: reason,
      });
      return fallback;
    }
    const fallback = buildFallbackStablecoinHealth(reason);
    macroStablecoinCache.set(cacheKey, {
      value: fallback,
      updatedAtMs: Date.now(),
    });
    logMacroFetch({
      source: "macro_stablecoin_health",
      status: "error",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
      errorReason: reason,
    });
    return fallback;
  }
}

function parseOilMetric(
  label: string,
  data: {
    current: number;
    previous: number;
    date: string;
    unit: string;
  },
  id: string,
): MacroOilMetric {
  const changePct =
    data.previous !== 0 ? ((data.current - data.previous) / data.previous) * 100 : 0;
  const trend: MacroOilMetric["trend"] =
    changePct > 0.5 ? "up" : changePct < -0.5 ? "down" : "stable";
  return {
    id,
    name: label,
    current: data.current,
    previous: data.previous,
    changePct: round(changePct, 1),
    unit: data.unit,
    trend,
    lastUpdated: data.date,
  };
}

function buildOilCacheKey(): string {
  return "default";
}

function buildFallbackOilAnalytics(
  configured: boolean,
  reason?: string,
): MacroOilAnalyticsResponse {
  return {
    timestamp: nowIso(),
    configured,
    fetchedAt: nowIso(),
    wtiPrice: null,
    brentPrice: null,
    usProduction: null,
    usInventory: null,
    unavailableReason: reason,
  };
}

export async function fetchMacroOilAnalytics(
  env: Env,
  timeoutMs = 10_000,
): Promise<MacroOilAnalyticsResponse> {
  const cacheKey = buildOilCacheKey();
  void cacheKey;
  const startedAt = Date.now();

  if (macroOilCache.value && isFresh(macroOilCache.updatedAtMs, MACRO_OIL_TTL_MS)) {
    logMacroFetch({
      source: "macro_oil_analytics",
      status: "success",
      latencyMs: Date.now() - startedAt,
      cacheHit: true,
    });
    return macroOilCache.value;
  }

  const apiKey = String(env.EIA_API_KEY ?? "").trim();
  if (!apiKey) {
    const fallback = buildFallbackOilAnalytics(false, "eia-api-key-missing");
    macroOilCache.value = fallback;
    macroOilCache.updatedAtMs = Date.now();
    logMacroFetch({
      source: "macro_oil_analytics",
      status: "fallback",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
      errorReason: "eia-api-key-missing",
    });
    return fallback;
  }

  try {
    const requests = Object.entries(OIL_SERIES).map(async ([key, seriesId]) => {
      const payload = (await fetchJsonWithTimeout(
        `${EIA_SERIES_BASE}/${seriesId}?api_key=${encodeURIComponent(apiKey)}&num=2`,
        timeoutMs,
      )) as {
        response?: {
          data?: Array<{
            value?: number;
            period?: string;
            unit?: string;
          }>;
        };
      };

      const rows = payload.response?.data;
      if (!Array.isArray(rows) || rows.length < 1) return [key, null] as const;
      const latest = rows[0];
      const previous = rows[1] ?? rows[0];
      const currentVal = toFiniteNumber(latest?.value, NaN);
      const previousVal = toFiniteNumber(previous?.value, NaN);
      if (!Number.isFinite(currentVal) || !Number.isFinite(previousVal)) {
        return [key, null] as const;
      }
      return [
        key,
        {
          current: currentVal,
          previous: previousVal,
          date: String(latest?.period ?? nowIso()),
          unit: String(latest?.unit ?? ""),
        },
      ] as const;
    });

    const rows = await Promise.all(requests);
    const metrics = new Map<string, {
      current: number;
      previous: number;
      date: string;
      unit: string;
    }>();
    for (const [key, value] of rows) {
      if (value) metrics.set(key, value);
    }

    const response: MacroOilAnalyticsResponse = {
      timestamp: nowIso(),
      configured: true,
      fetchedAt: nowIso(),
      wtiPrice: metrics.has("wti")
        ? parseOilMetric("WTI Crude", metrics.get("wti")!, "wti-crude")
        : null,
      brentPrice: metrics.has("brent")
        ? parseOilMetric("Brent Crude", metrics.get("brent")!, "brent-crude")
        : null,
      usProduction: metrics.has("production")
        ? parseOilMetric(
            "US Production",
            metrics.get("production")!,
            "us-production",
          )
        : null,
      usInventory: metrics.has("inventory")
        ? parseOilMetric(
            "US Inventory",
            metrics.get("inventory")!,
            "us-inventory",
          )
        : null,
      ...(
        metrics.size > 0
          ? {}
          : { unavailableReason: "oil-no-series-data" }
      ),
    };

    macroOilCache.value = response;
    macroOilCache.updatedAtMs = Date.now();

    logMacroFetch({
      source: "macro_oil_analytics",
      status: "success",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
    });

    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "oil-fetch-failed";
    if (macroOilCache.value) {
      const fallback = {
        ...macroOilCache.value,
        timestamp: nowIso(),
        fetchedAt: nowIso(),
      };
      logMacroFetch({
        source: "macro_oil_analytics",
        status: "fallback",
        latencyMs: Date.now() - startedAt,
        cacheHit: true,
        errorReason: reason,
      });
      return fallback;
    }

    const fallback = buildFallbackOilAnalytics(true, reason);
    macroOilCache.value = fallback;
    macroOilCache.updatedAtMs = Date.now();
    logMacroFetch({
      source: "macro_oil_analytics",
      status: "error",
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
      errorReason: reason,
    });
    return fallback;
  }
}
