import type { DataSourcesConfig } from "../types";

export type FixturePattern = "uptrend" | "downtrend" | "whipsaw";

export type PriceBar = {
  ts: string;
  source: string;
  instrument: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type HistoricalBarsRequest = {
  baseMint: string;
  quoteMint: string;
  startMs: number;
  endMs: number;
  resolutionMinutes: 60;
  pattern?: FixturePattern;
};

export type MarketDataAdapter = {
  name: string;
  fetchHourlyBars(request: HistoricalBarsRequest): Promise<PriceBar[]>;
};

export type DataSourceFetchResult = {
  source: string;
  bars: PriceBar[];
};

export function resolveSourcePriority(config?: DataSourcesConfig): string[] {
  const priority = Array.isArray(config?.priority)
    ? config?.priority.filter((v): v is string => typeof v === "string")
    : [];
  if (priority.length > 0) return priority;
  return ["birdeye", "fixture"];
}

export function instrumentKey(baseMint: string, quoteMint: string): string {
  return `${baseMint}/${quoteMint}`;
}
