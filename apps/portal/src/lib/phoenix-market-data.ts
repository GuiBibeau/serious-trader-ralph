import { isRecord } from "./utils";

const PHOENIX_API_BASE = "https://perp-api.phoenix.trade";
const PHOENIX_WS_URL = "wss://perp-api.phoenix.trade/v1/ws";
const MAX_VISIBLE_LEVELS = 16;
const MAX_VISIBLE_TRADES = 80;
// How many historical candles to request + retain. The Phoenix REST API
// serves up to ~2500 bars; 1500 gives deep scrollback without bloating memory.
const CANDLE_HISTORY_LIMIT = 1500;

type CandleCacheEntry = { points: MarketPoint[]; fetchedAt: number };
const candleCache = new Map<string, CandleCacheEntry>();

// Bounded reload seed: one most-recent fetched snapshot persisted to disk so
// the chart paints instantly after a reload, then the live stream takes over.
const CANDLE_STORE_KEY = "trader-ralph-terminal/candles/v1";
const CANDLE_STORE_MAX_AGE_MS = 60 * 60_000;

function candleCacheKey(symbol: string, timeframe: PhoenixTimeframe): string {
  return `${symbol}|${timeframe}`;
}

export function getCachedCandles(
  symbol: string,
  timeframe: PhoenixTimeframe,
): MarketPoint[] | null {
  const key = candleCacheKey(symbol, timeframe);
  const live = candleCache.get(key)?.points;
  if (live) return live;
  // Fall back to the persisted snapshot (instant first paint after reload).
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CANDLE_STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as {
      key: string;
      points: MarketPoint[];
      t: number;
    };
    if (saved.key !== key) return null;
    if (Date.now() - saved.t > CANDLE_STORE_MAX_AGE_MS) return null;
    // Sanitize snapshots persisted before normalizeCandle dropped
    // zero-close bars, so a stale junk bar never seeds a session.
    const points = saved.points.filter((point) => point.close > 0);
    candleCache.set(key, { points, fetchedAt: saved.t });
    return points;
  } catch {
    return null;
  }
}

export function cacheCandles(
  symbol: string,
  timeframe: PhoenixTimeframe,
  points: MarketPoint[],
): void {
  if (points.length < 1) return;
  candleCache.set(candleCacheKey(symbol, timeframe), {
    points,
    fetchedAt: Date.now(),
  });
}

// Persist a single most-recent snapshot to disk. Called only on a full fetch
// (not on every live candle) to avoid hammering localStorage.
function persistCandleSnapshot(
  symbol: string,
  timeframe: PhoenixTimeframe,
  points: MarketPoint[],
): void {
  if (typeof window === "undefined" || points.length < 1) return;
  try {
    window.localStorage.setItem(
      CANDLE_STORE_KEY,
      JSON.stringify({
        key: candleCacheKey(symbol, timeframe),
        points,
        t: Date.now(),
      }),
    );
  } catch {
    // quota / unavailable — non-fatal
  }
}

export const DEFAULT_PHOENIX_SYMBOL = "SOL";
export const PHOENIX_TIMEFRAME = "1m";
export const PHOENIX_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h"] as const;

export type PhoenixTimeframe = (typeof PHOENIX_TIMEFRAMES)[number];

export type PhoenixMarketConfig = {
  symbol: string;
  marketStatus: string;
  isolatedOnly: boolean;
  makerFee: number | null;
  takerFee: number | null;
  maxLeverage: number | null;
  commodity: boolean;
  /** Next session open/close (ISO), from the market calendar; null = 24/7. */
  nextTransitionUtc: string | null;
};

export type MarketPoint = {
  ts: number;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  markOpen?: number | null;
  markHigh?: number | null;
  markLow?: number | null;
  markClose?: number | null;
  volume?: number | null;
  volumeQuote?: number | null;
  tradeCount?: number | null;
};

export type DepthLevel = {
  price: number;
  size: number;
  cum: number;
};

export type TradeTick = {
  seq: number;
  ts: number;
  side: "buy" | "sell";
  price: number;
  size: number;
};

export type PhoenixMarketStats = {
  symbol: string;
  dayNtlVlm: number | null;
  prevDayPx: number | null;
  markPx: number | null;
  midPx: number | null;
  funding: number | null;
  openInterest: number | null;
  oraclePx: number | null;
};

export type PhoenixSource = {
  provider: "Phoenix Perps";
  symbol: string;
  displayPair: string;
  venueUrl: string;
};

export type PhoenixInitialMarketData = {
  source: PhoenixSource;
  chartPoints: MarketPoint[];
  latestPrice: number | null;
  lastMarketUpdate: number | null;
};

export type PhoenixMarketStreamHandlers = {
  onOpen?: () => void;
  onStatus?: (status: string) => void;
  onCandle?: (point: MarketPoint) => void;
  onOrderbook?: (payload: {
    bids: DepthLevel[];
    asks: DepthLevel[];
    mid: number | null;
  }) => void;
  onMarket?: (stats: PhoenixMarketStats) => void;
  onTrades?: (trades: TradeTick[]) => void;
  onFunding?: (funding: number | null) => void;
  onAllMids?: (mids: Record<string, number>) => void;
  onError?: (message: string) => void;
};

export type PhoenixWsHandle = {
  close: () => void;
};

type PhoenixBookLevel = [number, number];

export async function fetchPhoenixMarkets(): Promise<PhoenixMarketConfig[]> {
  const payload = await fetchPhoenixJson<unknown>("/exchange/markets");
  if (!Array.isArray(payload)) return [];
  return payload
    .filter(isRecord)
    .map(parseMarketConfig)
    .filter((market): market is PhoenixMarketConfig => market !== null)
    .sort((a, b) => {
      const statusRank =
        Number(b.marketStatus === "active") -
        Number(a.marketStatus === "active");
      if (statusRank !== 0) return statusRank;
      return a.symbol.localeCompare(b.symbol);
    });
}

export async function fetchPhoenixInitialMarketData(
  symbol: string,
  timeframe: PhoenixTimeframe = PHOENIX_TIMEFRAME,
): Promise<PhoenixInitialMarketData> {
  const chartPoints = await fetchPhoenixCandles(symbol, timeframe);
  const latest = chartPoints.at(-1) ?? null;
  return {
    source: phoenixSource(symbol),
    chartPoints,
    latestPrice: latest?.close ?? null,
    lastMarketUpdate: latest?.ts ?? null,
  };
}

export async function fetchPhoenixCandles(
  symbol: string,
  timeframe: PhoenixTimeframe = PHOENIX_TIMEFRAME,
): Promise<MarketPoint[]> {
  const params = new URLSearchParams({
    symbol,
    timeframe,
    limit: String(CANDLE_HISTORY_LIMIT),
  });
  const payload = await fetchPhoenixJson<unknown>(`/candles?${params}`);
  if (!Array.isArray(payload)) return [];
  const points = normalizeCandles(payload.filter(isRecord)).slice(
    -CANDLE_HISTORY_LIMIT,
  );
  cacheCandles(symbol, timeframe, points);
  persistCandleSnapshot(symbol, timeframe, points);
  return points;
}

export function connectPhoenixMarketStream(
  symbol: string,
  handlers: PhoenixMarketStreamHandlers,
  timeframe: PhoenixTimeframe = PHOENIX_TIMEFRAME,
): PhoenixWsHandle {
  let ws: WebSocket | null = null;
  let reconnectTimer = 0;
  let reconnectDelay = 750;
  let closedByClient = false;

  const connect = () => {
    handlers.onStatus?.("connecting");
    ws = new WebSocket(PHOENIX_WS_URL);

    ws.addEventListener("open", () => {
      const socket = ws;
      if (!socket) return;
      reconnectDelay = 750;
      handlers.onOpen?.();
      handlers.onStatus?.("streaming");
      subscribe(socket, [
        { channel: "orderbook", symbol, bypassExecutionBand: false },
        { channel: "market", symbol },
        { channel: "trades", symbol },
        { channel: "candles", symbol, timeframe },
        { channel: "fundingRate", symbol },
        { channel: "allMids" },
      ]);
    });

    ws.addEventListener("message", (event) => {
      const payload = parseJsonObject(event.data);
      if (!payload) return;
      routeStreamMessage(symbol, payload, handlers);
    });

    ws.addEventListener("error", () => {
      handlers.onError?.("phoenix-stream-error");
      handlers.onStatus?.("stream error");
    });

    ws.addEventListener("close", () => {
      ws = null;
      if (closedByClient) return;
      handlers.onStatus?.("reconnecting");
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(5_000, reconnectDelay * 1.6);
    });
  };

  connect();

  return {
    close: () => {
      closedByClient = true;
      window.clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
    },
  };
}

export function upsertLiveCandle(
  points: MarketPoint[],
  point: MarketPoint,
): MarketPoint[] {
  // Fast paths for the two shapes every live message takes: an update to
  // the in-progress candle (same ts as the tail) or a brand-new candle
  // (later ts). History arrays are sorted ascending with unique timestamps
  // by construction (normalizeCandles + this function's own output), so
  // neither shape needs the O(n log n) filter/sort defence below — that
  // only exists for out-of-order backfill and zero-close points.
  const last = points[points.length - 1];
  if (last !== undefined && point.close > 0 && point.ts >= last.ts) {
    if (point.ts === last.ts) {
      const next = points.slice();
      next[next.length - 1] = point;
      return next;
    }
    const next =
      points.length >= CANDLE_HISTORY_LIMIT
        ? points.slice(points.length - (CANDLE_HISTORY_LIMIT - 1))
        : points.slice();
    next.push(point);
    return next;
  }
  // Slow path: empty history, zero/negative close, or out-of-order point.
  const existingIndex = points.findIndex((item) => item.ts === point.ts);
  const next =
    existingIndex >= 0
      ? points.map((item, index) => (index === existingIndex ? point : item))
      : [...points, point];
  return next
    .filter((item) => item.close > 0)
    .sort((a, b) => a.ts - b.ts)
    .slice(-CANDLE_HISTORY_LIMIT);
}

export function phoenixSource(symbol: string): PhoenixSource {
  return {
    provider: "Phoenix Perps",
    symbol,
    displayPair: `${symbol}-PERP`,
    venueUrl: `https://phoenix.trade`,
  };
}

// ── Daily stats sweep ─────────────────────────────────────────────────
// Per-market 24h change/volume derived from the last two daily candles.
// The stream only carries stats for the subscribed market; this fills the
// palette and monitor for every market at REST cost (~1 call/market/min).
export type PhoenixDailyStat = {
  lastPrice: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
};

let dailyStatsCache: {
  at: number;
  stats: Record<string, PhoenixDailyStat>;
} | null = null;
const DAILY_STATS_TTL_MS = 60_000;

export async function fetchPhoenixDailyStats(
  symbols: string[],
): Promise<Record<string, PhoenixDailyStat>> {
  if (dailyStatsCache && Date.now() - dailyStatsCache.at < DAILY_STATS_TTL_MS) {
    return dailyStatsCache.stats;
  }
  // Gentle sweep: batches of 8 so ~50 markets never trip rate limits, and
  // partial results merge over the previous sweep instead of erasing it.
  const stats: Record<string, PhoenixDailyStat> = {
    ...(dailyStatsCache?.stats ?? {}),
  };
  const queue = [...symbols];
  while (queue.length > 0) {
    const batch = queue.splice(0, 8);
    const entries = await Promise.allSettled(
      batch.map(async (symbol) => {
        const rows = await fetchPhoenixJson<Record<string, unknown>[]>(
          `/v1/candles/${encodeURIComponent(symbol)}?timeframe=1d&limit=3`,
        );
        const candles = (Array.isArray(rows) ? rows : []).slice(-2);
        const last = candles[candles.length - 1];
        const prev = candles.length > 1 ? candles[0] : null;
        const close = parseFiniteNumber(last?.close);
        const prevClose = parseFiniteNumber(prev?.close);
        const stat: PhoenixDailyStat = {
          lastPrice: close,
          change24hPct:
            close !== null && prevClose !== null && prevClose !== 0
              ? ((close - prevClose) / prevClose) * 100
              : null,
          volume24hUsd: parseFiniteNumber(last?.volumeQuote),
        };
        return [symbol, stat] as const;
      }),
    );
    for (const entry of entries) {
      if (entry.status === "fulfilled") stats[entry.value[0]] = entry.value[1];
    }
  }
  dailyStatsCache = { at: Date.now(), stats };
  return stats;
}

async function fetchPhoenixJson<T>(path: string): Promise<T> {
  const response = await fetch(`${PHOENIX_API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Phoenix ${response.status}: ${path}`);
  }
  return response.json() as Promise<T>;
}

function parseMarketConfig(
  raw: Record<string, unknown>,
): PhoenixMarketConfig | null {
  const symbol = String(raw.symbol ?? "").trim();
  if (!symbol) return null;
  const leverageTiers = Array.isArray(raw.leverageTiers)
    ? raw.leverageTiers.filter(isRecord)
    : [];
  const maxLeverage = Math.max(
    0,
    ...leverageTiers
      .map((tier) => parseFiniteNumber(tier.maxLeverage))
      .filter((value): value is number => value !== null),
  );
  const metadata = isRecord(raw.metadata) ? raw.metadata : null;
  const calendar =
    metadata && isRecord(metadata.calendar) ? metadata.calendar : null;
  return {
    symbol,
    marketStatus: String(raw.marketStatus ?? "unknown"),
    isolatedOnly: raw.isolatedOnly === true,
    makerFee: parseFiniteNumber(raw.makerFee),
    takerFee: parseFiniteNumber(raw.takerFee),
    maxLeverage: maxLeverage > 0 ? maxLeverage : null,
    commodity: isRecord(raw.commodityMetadata),
    nextTransitionUtc: calendar
      ? String(calendar.nextMarketTransitionUtc ?? "") || null
      : null,
  };
}

function subscribe(
  ws: WebSocket,
  subscriptions: Array<Record<string, unknown>>,
): void {
  for (const subscription of subscriptions) {
    ws.send(JSON.stringify({ type: "subscribe", subscription }));
  }
}

function routeStreamMessage(
  symbol: string,
  payload: Record<string, unknown>,
  handlers: PhoenixMarketStreamHandlers,
): void {
  const channel = String(payload.channel ?? "");
  const messageSymbol = String(payload.symbol ?? payload.marketSymbol ?? "");
  if (channel === "subscriptionStatus") return;
  if (channel === "orderbook" && messageSymbol === symbol) {
    const orderbook = isRecord(payload.orderbook) ? payload.orderbook : {};
    handlers.onOrderbook?.({
      bids: normalizeBookSide(readBookLevels(orderbook.bids)),
      asks: normalizeBookSide(readBookLevels(orderbook.asks)),
      mid: parseFiniteNumber(orderbook.mid),
    });
    return;
  }
  if (channel === "market" && messageSymbol === symbol) {
    handlers.onMarket?.(parseMarketStats(payload, symbol));
    return;
  }
  if (channel === "trades" && messageSymbol === symbol) {
    const trades = Array.isArray(payload.trades)
      ? payload.trades.filter(isRecord)
      : [];
    handlers.onTrades?.(normalizeTrades(trades));
    return;
  }
  if (channel === "candle" && messageSymbol === symbol) {
    const point = isRecord(payload.candle)
      ? normalizeCandle(payload.candle)
      : null;
    if (point) handlers.onCandle?.(point);
    return;
  }
  if (channel === "fundingRate" && messageSymbol === symbol) {
    handlers.onFunding?.(parseFiniteNumber(payload.funding));
    return;
  }
  if (channel === "allMids" && isRecord(payload.mids)) {
    const mids: Record<string, number> = {};
    for (const [key, value] of Object.entries(payload.mids)) {
      const parsed = parseFiniteNumber(value);
      if (parsed !== null) mids[key] = parsed;
    }
    handlers.onAllMids?.(mids);
    return;
  }
  if (channel === "error") {
    handlers.onError?.(String(payload.error ?? "phoenix-stream-error"));
  }
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(String(raw));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseMarketStats(
  payload: Record<string, unknown>,
  fallbackSymbol: string,
): PhoenixMarketStats {
  return {
    symbol: String(payload.symbol ?? fallbackSymbol),
    dayNtlVlm: parseFiniteNumber(payload.dayNtlVlm),
    prevDayPx: parseFiniteNumber(payload.prevDayPx),
    markPx: parseFiniteNumber(payload.markPx),
    midPx: parseFiniteNumber(payload.midPx),
    funding: parseFiniteNumber(payload.funding),
    openInterest: parseFiniteNumber(payload.openInterest),
    oraclePx: parseFiniteNumber(payload.oraclePx),
  };
}

function normalizeCandles(candles: Record<string, unknown>[]): MarketPoint[] {
  return candles
    .map(normalizeCandle)
    .filter((point): point is MarketPoint => point !== null)
    .sort((a, b) => a.ts - b.ts);
}

function normalizeCandle(candle: Record<string, unknown>): MarketPoint | null {
  const close = parseFiniteNumber(candle.close);
  const open = parseFiniteNumber(candle.open);
  const high = parseFiniteNumber(candle.high);
  const low = parseFiniteNumber(candle.low);
  const rawTime = parseFiniteNumber(candle.time);
  if (
    close === null ||
    // Zero/negative closes are junk bars (they collapse the chart's price
    // autoscale to include 0). Dropping them here makes every candle
    // producer — snapshot fetch, cache/persisted snapshot, heal refetch,
    // live stream — zero-close-free by construction, which is the
    // invariant upsertLiveCandle's fast path relies on.
    close <= 0 ||
    open === null ||
    high === null ||
    low === null ||
    rawTime === null
  ) {
    return null;
  }
  const ts = rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime;
  return {
    ts,
    price: close,
    open,
    high,
    low,
    close,
    markOpen: parseFiniteNumber(candle.markOpen),
    markHigh: parseFiniteNumber(candle.markHigh),
    markLow: parseFiniteNumber(candle.markLow),
    markClose: parseFiniteNumber(candle.markClose),
    volume: parseFiniteNumber(candle.volume),
    volumeQuote: parseFiniteNumber(candle.volumeQuote),
    tradeCount: parseFiniteNumber(candle.tradeCount),
  };
}

function readBookLevels(raw: unknown): PhoenixBookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((level) => {
      if (!Array.isArray(level) || level.length < 2) return null;
      const price = parseFiniteNumber(level[0]);
      const size = parseFiniteNumber(level[1]);
      return price !== null && size !== null ? [price, size] : null;
    })
    .filter((level): level is PhoenixBookLevel => level !== null);
}

function normalizeBookSide(levels: PhoenixBookLevel[]): DepthLevel[] {
  let cum = 0;
  return levels
    .filter(([price, size]) => price > 0 && size > 0)
    .slice(0, MAX_VISIBLE_LEVELS)
    .map(([price, size]) => {
      cum += size;
      return { price, size, cum };
    });
}

function normalizeTrades(trades: Record<string, unknown>[]): TradeTick[] {
  return trades
    .map((trade, index) => {
      const baseAmount = parseFiniteNumber(trade.baseAmount);
      const quoteAmount = parseFiniteNumber(trade.quoteAmount);
      const price =
        baseAmount && baseAmount > 0 && quoteAmount
          ? quoteAmount / baseAmount
          : parseFiniteNumber(trade.price);
      const timestamp = parseFiniteNumber(trade.timestamp);
      const ts =
        timestamp !== null
          ? timestamp < 10_000_000_000
            ? timestamp * 1000
            : timestamp
          : Date.now();
      const side: "buy" | "sell" =
        String(trade.side ?? "").toLowerCase() === "bid" ? "buy" : "sell";
      return {
        seq: Number(trade.tradeSequenceNumber ?? index),
        ts,
        side,
        price: price ?? 0,
        size: baseAmount ?? 0,
      };
    })
    .filter((trade) => trade.price > 0 && trade.size > 0)
    .slice(0, MAX_VISIBLE_TRADES);
}

function parseFiniteNumber(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}
