import type {
  HistoricalBarsRequest,
  MarketDataAdapter,
  PriceBar,
} from "./types";
import { instrumentKey } from "./types";

function clampPattern(pattern: unknown): "uptrend" | "downtrend" | "whipsaw" {
  const value = typeof pattern === "string" ? pattern : "uptrend";
  if (value === "downtrend" || value === "whipsaw") return value;
  return "uptrend";
}

function syntheticClose(
  i: number,
  total: number,
  pattern: "uptrend" | "downtrend" | "whipsaw",
): number {
  const x = i / Math.max(1, total - 1);
  if (pattern === "uptrend") {
    return 100 * (1 + 0.25 * x + 0.01 * Math.sin(i / 14));
  }
  if (pattern === "downtrend") {
    return 100 * (1 - 0.22 * x + 0.01 * Math.sin(i / 10));
  }
  return 100 * (1 + 0.02 * Math.sin(i / 2.5) + 0.015 * Math.sin(i / 8));
}

export class FixtureDataAdapter implements MarketDataAdapter {
  readonly name = "fixture";

  async fetchHourlyBars(request: HistoricalBarsRequest): Promise<PriceBar[]> {
    const startMs = Math.floor(request.startMs / 3600000) * 3600000;
    const endMs = Math.floor(request.endMs / 3600000) * 3600000;
    if (endMs <= startMs) return [];

    const steps = Math.max(1, Math.floor((endMs - startMs) / 3600000));
    const pattern = clampPattern(request.pattern);
    const instrument = instrumentKey(request.baseMint, request.quoteMint);
    const bars: PriceBar[] = [];

    let prevClose = syntheticClose(0, steps, pattern);
    for (let i = 0; i < steps; i += 1) {
      const close = syntheticClose(i + 1, steps, pattern);
      const open = prevClose;
      const high = Math.max(open, close) * 1.001;
      const low = Math.min(open, close) * 0.999;
      bars.push({
        ts: new Date(startMs + i * 3600000).toISOString(),
        source: this.name,
        instrument,
        open,
        high,
        low,
        close,
        volume: 1000 + (i % 12) * 17,
      });
      prevClose = close;
    }

    return bars;
  }
}
