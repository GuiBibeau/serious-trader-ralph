"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiBase, isRecord } from "../../lib";
import {
  getPairConfig,
  marketQuoteAmountAtomic,
  type PairId,
  TOKEN_CONFIGS,
} from "./trade-pairs";

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

export type MarketState = {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  points: MarketPoint[];
  latestPrice: number | null;
  change24hPct: number | null;
  lastUpdatedMs: number | null;
  sourcePriority: string[];
  pairId: PairId;
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

const QUOTE_REFRESH_MS = 15_000;
const INDICATORS_REFRESH_MS = 5 * 60_000;
const MAX_LIVE_POINTS = 120;
const MAX_TOTAL_POINTS = 240;

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
    if (Number.isFinite(volumeRaw)) point.volume = volumeRaw;
    out.push(point);
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function mergePoints(
  basePoints: MarketPoint[],
  livePoints: MarketPoint[],
): MarketPoint[] {
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

export function useMarketFeed(pairId: PairId): MarketState {
  const pair = useMemo(() => getPairConfig(pairId), [pairId]);
  const baseMint = TOKEN_CONFIGS[pair.baseSymbol].mint;
  const quoteMint = TOKEN_CONFIGS[pair.quoteSymbol].mint;
  const quoteToken = TOKEN_CONFIGS[pair.quoteSymbol];
  const [state, setState] = useState<MarketState>({
    status: "idle",
    error: null,
    points: [],
    latestPrice: null,
    change24hPct: null,
    lastUpdatedMs: null,
    sourcePriority: [],
    pairId,
  });
  const inFlightRef = useRef(false);
  const lastIndicatorsFetchMsRef = useRef(0);
  const basePointsRef = useRef<MarketPoint[]>([]);
  const livePointsRef = useRef<MarketPoint[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setState({
      status: "idle",
      error: null,
      points: [],
      latestPrice: null,
      change24hPct: null,
      lastUpdatedMs: null,
      sourcePriority: [],
      pairId,
    });
    basePointsRef.current = [];
    livePointsRef.current = [];
    lastIndicatorsFetchMsRef.current = 0;
  }, [pairId]);

  useEffect(() => {
    async function fetchIndicators(): Promise<void> {
      const base = apiBase();
      if (!base) throw new Error("missing NEXT_PUBLIC_EDGE_API_BASE");

      const requestBody = {
        baseMint,
        quoteMint,
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

      basePointsRef.current = toChartPoints(bars);
      const merged = mergePoints(basePointsRef.current, livePointsRef.current);
      const latest = merged[merged.length - 1] ?? null;

      setState((current) => ({
        ...current,
        status: "ready",
        error: null,
        points: merged,
        latestPrice: latest?.price ?? null,
        change24hPct: calc24hChange(merged, h24),
        sourcePriority,
        lastUpdatedMs: Date.now(),
      }));
    }

    async function fetchLiveQuote(): Promise<void> {
      const base = apiBase();
      if (!base) throw new Error("missing NEXT_PUBLIC_EDGE_API_BASE");

      const response = await fetch(
        `${base}/api/x402/read/market_jupiter_quote`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "payment-signature": "portal-market-widget",
          },
          body: JSON.stringify({
            inputMint: baseMint,
            outputMint: quoteMint,
            amount: marketQuoteAmountAtomic(pair.id),
            slippageBps: 50,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const error =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : `http-${response.status}`;
        throw new Error(error);
      }
      if (
        !isRecord(payload) ||
        payload.ok !== true ||
        !isRecord(payload.quote)
      ) {
        throw new Error("invalid-quote-payload");
      }

      const outAmount = String(payload.quote.outAmount ?? "");
      const nextPrice = parseDecimalFromAtomic(outAmount, quoteToken.decimals);
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
      livePointsRef.current = [...livePointsRef.current, nextLivePoint].slice(
        -MAX_LIVE_POINTS,
      );
      const merged = mergePoints(basePointsRef.current, livePointsRef.current);
      const latest = merged[merged.length - 1] ?? null;
      setState((current) => ({
        ...current,
        status: "ready",
        error: null,
        points: merged,
        latestPrice: latest?.price ?? null,
        change24hPct: calc24hChange(merged, current.change24hPct),
        lastUpdatedMs: Date.now(),
      }));
    }

    async function refreshTick(): Promise<void> {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setState((current) =>
        current.status === "idle"
          ? {
              ...current,
              status: "loading",
              error: null,
            }
          : current,
      );

      let lastError: string | null = null;
      try {
        if (
          basePointsRef.current.length === 0 ||
          Date.now() - lastIndicatorsFetchMsRef.current >= INDICATORS_REFRESH_MS
        ) {
          try {
            await fetchIndicators();
            lastIndicatorsFetchMsRef.current = Date.now();
          } catch (error) {
            lastError =
              error instanceof Error ? error.message : "indicators-failed";
          }
        }
        try {
          await fetchLiveQuote();
          if (lastError) {
            setState((current) => ({
              ...current,
              status: "ready",
              error: lastError,
            }));
          }
        } catch (error) {
          const quoteError =
            error instanceof Error ? error.message : "quote-fetch-failed";
          setState((current) => ({
            ...current,
            status: current.points.length > 0 ? "ready" : "error",
            error: lastError ? `${lastError}; ${quoteError}` : quoteError,
          }));
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    void refreshTick();
    timerRef.current = window.setInterval(() => {
      void refreshTick();
    }, QUOTE_REFRESH_MS);

    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [baseMint, pair.id, quoteMint, quoteToken.decimals]);

  return state;
}

export function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  const maximumFractionDigits =
    abs >= 1_000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  const minimumFractionDigits = abs >= 1 ? 2 : 0;
  return value.toLocaleString(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
  });
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
