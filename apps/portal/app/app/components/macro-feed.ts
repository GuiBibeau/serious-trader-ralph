"use client";

import { useEffect, useState } from "react";
import { apiBase, isRecord } from "../../lib";

type FeedStatus = "idle" | "loading" | "ready" | "error";

export type MacroFeedState<T> = {
  status: FeedStatus;
  error: string | null;
  data: T | null;
  lastUpdatedMs: number | null;
};

export type MacroSignalsData = {
  timestamp: string;
  verdict: string;
  bullishCount: number;
  totalCount: number;
  unavailable: boolean;
  unavailableReason: string | null;
  signals: {
    liquidity: { status: string; value: number | null };
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
      mayerMultiple: number | null;
    };
    hashRate: { status: string; change30d: number | null };
    miningCost: { status: string };
    fearGreed: { status: string; value: number | null };
  };
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

export type MacroFredData = {
  timestamp: string;
  configured: boolean;
  series: MacroFredSeries[];
  unavailableReason: string | null;
};

export type MacroEtfData = {
  timestamp: string;
  unavailable: boolean;
  unavailableReason: string | null;
  summary: {
    etfCount: number;
    totalVolume: number;
    totalEstFlow: number;
    netDirection: string;
    inflowCount: number;
    outflowCount: number;
  };
  etfs: Array<{
    ticker: string;
    issuer: string;
    price: number;
    priceChange: number;
    volume: number;
    avgVolume: number;
    volumeRatio: number;
    direction: string;
    estFlow: number;
  }>;
};

export type MacroStablecoinData = {
  timestamp: string;
  unavailable: boolean;
  unavailableReason: string | null;
  summary: {
    totalMarketCap: number;
    totalVolume24h: number;
    coinCount: number;
    depeggedCount: number;
    healthStatus: string;
  };
  stablecoins: Array<{
    id: string;
    symbol: string;
    name: string;
    price: number;
    deviation: number;
    pegStatus: string;
    marketCap: number;
    volume24h: number;
    change24h: number;
    change7d: number;
  }>;
};

export type MacroOilMetric = {
  id: string;
  name: string;
  current: number;
  previous: number;
  changePct: number;
  unit: string;
  trend: string;
  lastUpdated: string;
};

export type MacroOilData = {
  timestamp: string;
  configured: boolean;
  fetchedAt: string;
  unavailableReason: string | null;
  wtiPrice: MacroOilMetric | null;
  brentPrice: MacroOilMetric | null;
  usProduction: MacroOilMetric | null;
  usInventory: MacroOilMetric | null;
};

type Store<T> = {
  state: MacroFeedState<T>;
  listeners: Set<(state: MacroFeedState<T>) => void>;
  timer: number | null;
  inFlight: boolean;
  intervalMs: number;
  path: string;
  buildBody: () => Record<string, unknown>;
  parse: (input: unknown) => T | null;
};

const SIGNALS_INTERVAL_MS = 60_000;
const FRED_INTERVAL_MS = 5 * 60_000;
const ETF_INTERVAL_MS = 2 * 60_000;
const STABLECOIN_INTERVAL_MS = 60_000;
const OIL_INTERVAL_MS = 5 * 60_000;

function toNumberOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function createStore<T>(config: {
  intervalMs: number;
  path: string;
  buildBody?: () => Record<string, unknown>;
  parse: (input: unknown) => T | null;
}): Store<T> {
  return {
    state: {
      status: "idle",
      error: null,
      data: null,
      lastUpdatedMs: null,
    },
    listeners: new Set(),
    timer: null,
    inFlight: false,
    intervalMs: config.intervalMs,
    path: config.path,
    buildBody: config.buildBody ?? (() => ({})),
    parse: config.parse,
  };
}

function emit<T>(store: Store<T>): void {
  for (const listener of store.listeners) {
    listener(store.state);
  }
}

async function fetchMacroPayload(
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const base = apiBase();
  if (!base) throw new Error("missing NEXT_PUBLIC_EDGE_API_BASE");
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "payment-signature": "portal-macro-widget",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `http-${response.status}`;
    throw new Error(error);
  }
  return payload;
}

async function refreshStore<T>(store: Store<T>): Promise<void> {
  if (store.inFlight) return;
  store.inFlight = true;

  if (store.state.status === "idle") {
    store.state = {
      ...store.state,
      status: "loading",
      error: null,
    };
    emit(store);
  }

  try {
    const payload = await fetchMacroPayload(store.path, store.buildBody());
    const parsed = store.parse(payload);
    if (!parsed) throw new Error("invalid-macro-payload");
    store.state = {
      status: "ready",
      error: null,
      data: parsed,
      lastUpdatedMs: Date.now(),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "macro-feed-fetch-failed";
    store.state = {
      status: store.state.data ? "ready" : "error",
      error: message,
      data: store.state.data,
      lastUpdatedMs: store.state.lastUpdatedMs,
    };
  } finally {
    store.inFlight = false;
    emit(store);
  }
}

function ensurePolling<T>(store: Store<T>): void {
  if (typeof window === "undefined") return;
  if (store.timer !== null) return;
  void refreshStore(store);
  store.timer = window.setInterval(() => {
    void refreshStore(store);
  }, store.intervalMs);
}

function maybeStopPolling<T>(store: Store<T>): void {
  if (typeof window === "undefined") return;
  if (store.listeners.size > 0) return;
  if (store.timer !== null) {
    window.clearInterval(store.timer);
    store.timer = null;
  }
}

function useStoreState<T>(store: Store<T>): MacroFeedState<T> {
  const [snapshot, setSnapshot] = useState<MacroFeedState<T>>(store.state);

  useEffect(() => {
    store.listeners.add(setSnapshot);
    setSnapshot(store.state);
    ensurePolling(store);
    return () => {
      store.listeners.delete(setSnapshot);
      maybeStopPolling(store);
    };
  }, [store]);

  return snapshot;
}

function parseMacroSignals(input: unknown): MacroSignalsData | null {
  if (!isRecord(input) || input.ok !== true || !isRecord(input.signals)) {
    return null;
  }

  const liquidity = isRecord(input.signals.liquidity)
    ? input.signals.liquidity
    : {};
  const flowStructure = isRecord(input.signals.flowStructure)
    ? input.signals.flowStructure
    : {};
  const macroRegime = isRecord(input.signals.macroRegime)
    ? input.signals.macroRegime
    : {};
  const technicalTrend = isRecord(input.signals.technicalTrend)
    ? input.signals.technicalTrend
    : {};
  const hashRate = isRecord(input.signals.hashRate) ? input.signals.hashRate : {};
  const miningCost = isRecord(input.signals.miningCost)
    ? input.signals.miningCost
    : {};
  const fearGreed = isRecord(input.signals.fearGreed)
    ? input.signals.fearGreed
    : {};

  return {
    timestamp: toStringValue(input.timestamp),
    verdict: toStringValue(input.verdict, "UNKNOWN"),
    bullishCount: toNumber(input.bullishCount),
    totalCount: toNumber(input.totalCount),
    unavailable: Boolean(input.unavailable),
    unavailableReason:
      typeof input.unavailableReason === "string" ? input.unavailableReason : null,
    signals: {
      liquidity: {
        status: toStringValue(liquidity.status, "UNKNOWN"),
        value: toNumberOrNull(liquidity.value),
      },
      flowStructure: {
        status: toStringValue(flowStructure.status, "UNKNOWN"),
        btcReturn5: toNumberOrNull(flowStructure.btcReturn5),
        qqqReturn5: toNumberOrNull(flowStructure.qqqReturn5),
      },
      macroRegime: {
        status: toStringValue(macroRegime.status, "UNKNOWN"),
        qqqRoc20: toNumberOrNull(macroRegime.qqqRoc20),
        xlpRoc20: toNumberOrNull(macroRegime.xlpRoc20),
      },
      technicalTrend: {
        status: toStringValue(technicalTrend.status, "UNKNOWN"),
        btcPrice: toNumberOrNull(technicalTrend.btcPrice),
        mayerMultiple: toNumberOrNull(technicalTrend.mayerMultiple),
      },
      hashRate: {
        status: toStringValue(hashRate.status, "UNKNOWN"),
        change30d: toNumberOrNull(hashRate.change30d),
      },
      miningCost: {
        status: toStringValue(miningCost.status, "UNKNOWN"),
      },
      fearGreed: {
        status: toStringValue(fearGreed.status, "UNKNOWN"),
        value: toNumberOrNull(fearGreed.value),
      },
    },
  };
}

function parseMacroFred(input: unknown): MacroFredData | null {
  if (!isRecord(input) || input.ok !== true || !Array.isArray(input.series)) {
    return null;
  }

  const series: MacroFredSeries[] = input.series
    .filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && !Array.isArray(row),
    )
    .map((row) => ({
      id: toStringValue(row.id),
      name: toStringValue(row.name),
      value: toNumberOrNull(row.value),
      previousValue: toNumberOrNull(row.previousValue),
      change: toNumberOrNull(row.change),
      changePercent: toNumberOrNull(row.changePercent),
      date: toStringValue(row.date),
      unit: toStringValue(row.unit),
    }));

  return {
    timestamp: toStringValue(input.timestamp),
    configured: Boolean(input.configured),
    series,
    unavailableReason:
      typeof input.unavailableReason === "string" ? input.unavailableReason : null,
  };
}

function parseMacroEtf(input: unknown): MacroEtfData | null {
  if (!isRecord(input) || input.ok !== true || !isRecord(input.summary)) {
    return null;
  }

  const summary = input.summary;
  const etfs = Array.isArray(input.etfs)
    ? input.etfs
        .filter(
          (row): row is Record<string, unknown> =>
            Boolean(row) && typeof row === "object" && !Array.isArray(row),
        )
        .map((row) => ({
          ticker: toStringValue(row.ticker),
          issuer: toStringValue(row.issuer),
          price: toNumber(row.price),
          priceChange: toNumber(row.priceChange),
          volume: toNumber(row.volume),
          avgVolume: toNumber(row.avgVolume),
          volumeRatio: toNumber(row.volumeRatio),
          direction: toStringValue(row.direction),
          estFlow: toNumber(row.estFlow),
        }))
    : [];

  return {
    timestamp: toStringValue(input.timestamp),
    unavailable: Boolean(input.unavailable),
    unavailableReason:
      typeof input.unavailableReason === "string" ? input.unavailableReason : null,
    summary: {
      etfCount: toNumber(summary.etfCount),
      totalVolume: toNumber(summary.totalVolume),
      totalEstFlow: toNumber(summary.totalEstFlow),
      netDirection: toStringValue(summary.netDirection, "UNAVAILABLE"),
      inflowCount: toNumber(summary.inflowCount),
      outflowCount: toNumber(summary.outflowCount),
    },
    etfs,
  };
}

function parseMacroStablecoin(input: unknown): MacroStablecoinData | null {
  if (!isRecord(input) || input.ok !== true || !isRecord(input.summary)) {
    return null;
  }

  const summary = input.summary;
  const stablecoins = Array.isArray(input.stablecoins)
    ? input.stablecoins
        .filter(
          (row): row is Record<string, unknown> =>
            Boolean(row) && typeof row === "object" && !Array.isArray(row),
        )
        .map((row) => ({
          id: toStringValue(row.id),
          symbol: toStringValue(row.symbol),
          name: toStringValue(row.name),
          price: toNumber(row.price),
          deviation: toNumber(row.deviation),
          pegStatus: toStringValue(row.pegStatus),
          marketCap: toNumber(row.marketCap),
          volume24h: toNumber(row.volume24h),
          change24h: toNumber(row.change24h),
          change7d: toNumber(row.change7d),
        }))
    : [];

  return {
    timestamp: toStringValue(input.timestamp),
    unavailable: Boolean(input.unavailable),
    unavailableReason:
      typeof input.unavailableReason === "string" ? input.unavailableReason : null,
    summary: {
      totalMarketCap: toNumber(summary.totalMarketCap),
      totalVolume24h: toNumber(summary.totalVolume24h),
      coinCount: toNumber(summary.coinCount),
      depeggedCount: toNumber(summary.depeggedCount),
      healthStatus: toStringValue(summary.healthStatus, "UNAVAILABLE"),
    },
    stablecoins,
  };
}

function parseMacroOilMetric(value: unknown): MacroOilMetric | null {
  if (!isRecord(value)) return null;
  return {
    id: toStringValue(value.id),
    name: toStringValue(value.name),
    current: toNumber(value.current),
    previous: toNumber(value.previous),
    changePct: toNumber(value.changePct),
    unit: toStringValue(value.unit),
    trend: toStringValue(value.trend),
    lastUpdated: toStringValue(value.lastUpdated),
  };
}

function parseMacroOil(input: unknown): MacroOilData | null {
  if (!isRecord(input) || input.ok !== true) return null;
  return {
    timestamp: toStringValue(input.timestamp),
    configured: Boolean(input.configured),
    fetchedAt: toStringValue(input.fetchedAt),
    unavailableReason:
      typeof input.unavailableReason === "string" ? input.unavailableReason : null,
    wtiPrice: parseMacroOilMetric(input.wtiPrice),
    brentPrice: parseMacroOilMetric(input.brentPrice),
    usProduction: parseMacroOilMetric(input.usProduction),
    usInventory: parseMacroOilMetric(input.usInventory),
  };
}

const signalsStore = createStore<MacroSignalsData>({
  intervalMs: SIGNALS_INTERVAL_MS,
  path: "/api/x402/read/macro_signals",
  parse: parseMacroSignals,
});

const fredStore = createStore<MacroFredData>({
  intervalMs: FRED_INTERVAL_MS,
  path: "/api/x402/read/macro_fred_indicators",
  parse: parseMacroFred,
});

const etfStore = createStore<MacroEtfData>({
  intervalMs: ETF_INTERVAL_MS,
  path: "/api/x402/read/macro_etf_flows",
  parse: parseMacroEtf,
});

const stablecoinStore = createStore<MacroStablecoinData>({
  intervalMs: STABLECOIN_INTERVAL_MS,
  path: "/api/x402/read/macro_stablecoin_health",
  parse: parseMacroStablecoin,
});

const oilStore = createStore<MacroOilData>({
  intervalMs: OIL_INTERVAL_MS,
  path: "/api/x402/read/macro_oil_analytics",
  parse: parseMacroOil,
});

export function useMacroSignals(): MacroFeedState<MacroSignalsData> {
  return useStoreState(signalsStore);
}

export function useMacroFred(): MacroFeedState<MacroFredData> {
  return useStoreState(fredStore);
}

export function useMacroEtfFlows(): MacroFeedState<MacroEtfData> {
  return useStoreState(etfStore);
}

export function useMacroStablecoinHealth(): MacroFeedState<MacroStablecoinData> {
  return useStoreState(stablecoinStore);
}

export function useMacroOilAnalytics(): MacroFeedState<MacroOilData> {
  return useStoreState(oilStore);
}

export function formatCompactNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(2);
}

export function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatFeedAge(ts: number | null): string {
  if (!ts || !Number.isFinite(ts)) return "never";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
