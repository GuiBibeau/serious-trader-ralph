"use client";

import { useEffect, useState } from "react";
import { apiBase, isRecord } from "../../lib";

export type MarketPoint = {
  ts: number;
  price: number;
  kind: "ohlcv" | "quote";
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type MarketState = {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  points: MarketPoint[];
  latestPrice: number | null;
  change24hPct: number | null;
  lastUpdatedMs: number | null;
  sourcePriority: string[];
};

type IndicatorsPayload = {
  ohlcv: {
    bars: Array<{
      ts: string;
      open?: number;
      high?: number;
      low?: number;
      close: number;
      volume?: number | null;
    }>;
    sourcePriorityUsed?: string[];
  };
  indicators?: {
    returnsPct?: { h24?: number | null };
  };
};

type OhlcvPayload = {
  ohlcv: {
    bars: Array<{
      ts: string;
      open?: number;
      high?: number;
      low?: number;
      close: number;
      volume?: number | null;
    }>;
    sourcePriorityUsed?: string[];
  };
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const LIVE_QUOTE_AMOUNT_LAMPORTS = "1000000000"; // 1 SOL
const USDC_DECIMALS = 6;
const QUOTE_REFRESH_MS = 15_000;
const INDICATORS_REFRESH_MS = 5 * 60_000;
const MAX_LIVE_POINTS = 120;
const MAX_TOTAL_POINTS = 240;

let state: MarketState = {
  status: "idle",
  error: null,
  points: [],
  latestPrice: null,
  change24hPct: null,
  lastUpdatedMs: null,
  sourcePriority: [],
};

const listeners = new Set<(next: MarketState) => void>();
let pollTimer: number | null = null;
let inFlight = false;
let lastIndicatorsFetchMs = 0;
let basePoints: MarketPoint[] = [];
let livePoints: MarketPoint[] = [];

function emit(): void {
  for (const listener of listeners) listener(state);
}

function update(next: Partial<MarketState>): void {
  state = { ...state, ...next };
  emit();
}

function parseDecimalFromAtomic(raw: string, decimals: number): number {
  const digits = String(raw ?? "").trim();
  if (!/^\d+$/.test(digits)) return NaN;
  try {
    const value = BigInt(digits);
    const scale = 10 ** decimals;
    return Number(value) / scale;
  } catch {
    return NaN;
  }
}

function toChartPoints(
  bars:
    | Array<{
        ts: string;
        open?: number;
        high?: number;
        low?: number;
        close: number;
        volume?: number | null;
      }>
    | undefined,
): MarketPoint[] {
  if (!Array.isArray(bars)) return [];
  const out: MarketPoint[] = [];
  for (const bar of bars) {
    const ts = Date.parse(bar.ts);
    const price = Number(bar.close);
    if (!Number.isFinite(ts) || !Number.isFinite(price) || price <= 0) continue;
    const openRaw = Number(bar.open);
    const highRaw = Number(bar.high);
    const lowRaw = Number(bar.low);
    const volumeRaw = Number(bar.volume);
    const open = Number.isFinite(openRaw) ? openRaw : price;
    const high = Number.isFinite(highRaw) ? highRaw : price;
    const low = Number.isFinite(lowRaw) ? lowRaw : price;
    const point: MarketPoint = {
      ts,
      price,
      kind: "ohlcv",
      open,
      high,
      low,
      close: price,
    };
    if (Number.isFinite(volumeRaw)) {
      point.volume = volumeRaw;
    }
    out.push(point);
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function mergePoints(): MarketPoint[] {
  const merged = [...basePoints, ...livePoints].sort((a, b) => a.ts - b.ts);
  const deduped: MarketPoint[] = [];
  let lastTs = -1;
  for (const point of merged) {
    if (point.ts === lastTs) {
      deduped[deduped.length - 1] = point;
      continue;
    }
    deduped.push(point);
    lastTs = point.ts;
  }
  return deduped.slice(-MAX_TOTAL_POINTS);
}

function calc24hChange(
  points: MarketPoint[],
  fallback: number | null,
): number | null {
  if (points.length < 2) return fallback;
  const latest = points[points.length - 1];
  if (!latest) return fallback;
  const target = latest.ts - 24 * 60 * 60 * 1000;
  let anchor: MarketPoint | null = null;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i];
    if (!point) continue;
    if (point.ts <= target) {
      anchor = point;
      break;
    }
  }
  if (!anchor || anchor.price <= 0) return fallback;
  return ((latest.price - anchor.price) / anchor.price) * 100;
}

function parseIndicatorsPayload(value: unknown): IndicatorsPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  if (!isRecord(value.ohlcv) || !Array.isArray(value.ohlcv.bars)) return null;
  return value as unknown as IndicatorsPayload;
}

function parseOhlcvPayload(value: unknown): OhlcvPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  if (!isRecord(value.ohlcv) || !Array.isArray(value.ohlcv.bars)) return null;
  return value as unknown as OhlcvPayload;
}

async function fetchIndicators(): Promise<void> {
  const base = apiBase();
  if (!base) {
    throw new Error("missing NEXT_PUBLIC_EDGE_API_BASE");
  }

  const requestBody = {
    baseMint: SOL_MINT,
    quoteMint: USDC_MINT,
    lookbackHours: 168,
    limit: 168,
    resolutionMinutes: 60,
  };

  let response = await fetch(`${base}/api/x402/read/market_indicators`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "payment-signature": "portal-market-widget",
    },
    body: JSON.stringify(requestBody),
  });
  let payload = (await response.json().catch(() => null)) as unknown;

  let bars: Array<{ ts: string; close: number }> = [];
  let sourcePriority: string[] = [];
  let h24: number | null = null;

  if (response.ok) {
    const parsed = parseIndicatorsPayload(payload);
    if (!parsed) throw new Error("invalid-indicators-payload");
    bars = parsed.ohlcv.bars;
    sourcePriority = Array.isArray(parsed.ohlcv.sourcePriorityUsed)
      ? parsed.ohlcv.sourcePriorityUsed.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    h24 =
      isRecord(parsed.indicators?.returnsPct) &&
      typeof parsed.indicators?.returnsPct?.h24 === "number"
        ? parsed.indicators.returnsPct.h24
        : null;
  } else if (response.status === 404) {
    // Backward compatibility: older workers might not expose market_indicators yet.
    response = await fetch(`${base}/api/x402/read/market_ohlcv`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "payment-signature": "portal-market-widget",
      },
      body: JSON.stringify(requestBody),
    });
    payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error =
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : `http-${response.status}`;
      throw new Error(error);
    }
    const parsed = parseOhlcvPayload(payload);
    if (!parsed) throw new Error("invalid-ohlcv-payload");
    bars = parsed.ohlcv.bars;
    sourcePriority = Array.isArray(parsed.ohlcv.sourcePriorityUsed)
      ? parsed.ohlcv.sourcePriorityUsed.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
  } else {
    const error =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `http-${response.status}`;
    throw new Error(error);
  }

  basePoints = toChartPoints(bars);
  const merged = mergePoints();
  const latest = merged[merged.length - 1] ?? null;

  update({
    status: "ready",
    error: null,
    points: merged,
    latestPrice: latest?.price ?? null,
    change24hPct: calc24hChange(merged, h24),
    sourcePriority,
    lastUpdatedMs: Date.now(),
  });
}

async function fetchLiveQuote(): Promise<void> {
  const base = apiBase();
  if (!base) {
    throw new Error("missing NEXT_PUBLIC_EDGE_API_BASE");
  }
  const response = await fetch(`${base}/api/x402/read/market_jupiter_quote`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "payment-signature": "portal-market-widget",
    },
    body: JSON.stringify({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: LIVE_QUOTE_AMOUNT_LAMPORTS,
      slippageBps: 50,
    }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `http-${response.status}`;
    throw new Error(error);
  }
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.quote)) {
    throw new Error("invalid-quote-payload");
  }
  const outAmount = String(payload.quote.outAmount ?? "");
  const nextPrice = parseDecimalFromAtomic(outAmount, USDC_DECIMALS);
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
    throw new Error("invalid-quote-price");
  }
  const nextLivePoint: MarketPoint = {
    ts: Date.now(),
    price: nextPrice,
    kind: "quote",
    open: nextPrice,
    high: nextPrice,
    low: nextPrice,
    close: nextPrice,
  };
  livePoints = [...livePoints, nextLivePoint].slice(-MAX_LIVE_POINTS);
  const merged = mergePoints();
  const latest = merged[merged.length - 1] ?? null;
  update({
    status: "ready",
    error: null,
    points: merged,
    latestPrice: latest?.price ?? null,
    change24hPct: calc24hChange(merged, state.change24hPct),
    lastUpdatedMs: Date.now(),
  });
}

async function refreshTick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  if (state.status === "idle") {
    update({ status: "loading", error: null });
  }

  let lastError: string | null = null;
  try {
    if (
      basePoints.length === 0 ||
      Date.now() - lastIndicatorsFetchMs >= INDICATORS_REFRESH_MS
    ) {
      try {
        await fetchIndicators();
        lastIndicatorsFetchMs = Date.now();
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : "indicators-failed";
      }
    }
    try {
      await fetchLiveQuote();
      if (lastError) {
        update({
          status: "ready",
          error: lastError,
        });
      }
    } catch (error) {
      const quoteError =
        error instanceof Error ? error.message : "quote-fetch-failed";
      update({
        status: state.points.length > 0 ? "ready" : "error",
        error: lastError ? `${lastError}; ${quoteError}` : quoteError,
      });
    }
  } finally {
    inFlight = false;
  }
}

function ensurePolling(): void {
  if (typeof window === "undefined") return;
  if (pollTimer !== null) return;
  void refreshTick();
  pollTimer = window.setInterval(() => {
    void refreshTick();
  }, QUOTE_REFRESH_MS);
}

function maybeStopPolling(): void {
  if (typeof window === "undefined") return;
  if (listeners.size > 0) return;
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function useSolMarketFeed(): MarketState {
  const [snapshot, setSnapshot] = useState<MarketState>(state);

  useEffect(() => {
    listeners.add(setSnapshot);
    setSnapshot(state);
    ensurePolling();
    return () => {
      listeners.delete(setSnapshot);
      maybeStopPolling();
    };
  }, []);

  return snapshot;
}

export function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return value.toFixed(2);
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatAgeMs(ts: number | null): string {
  if (!ts || !Number.isFinite(ts)) return "never";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
