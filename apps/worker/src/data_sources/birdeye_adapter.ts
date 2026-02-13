import type { Env } from "../types";
import type { HistoricalBarsRequest, MarketDataAdapter, PriceBar } from "./types";
import { instrumentKey } from "./types";

type BirdeyeOhlcvItem = {
  unixTime?: number;
  t?: number;
  o?: string | number;
  h?: string | number;
  l?: string | number;
  c?: string | number;
  v?: string | number;
};

type BirdeyeOhlcvResponse = {
  data?: BirdeyeOhlcvItem[] | { items?: BirdeyeOhlcvItem[] };
  items?: BirdeyeOhlcvItem[];
};

function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export class BirdeyeDataAdapter implements MarketDataAdapter {
  readonly name = "birdeye";

  constructor(private readonly env: Env) {}

  async fetchHourlyBars(request: HistoricalBarsRequest): Promise<PriceBar[]> {
    if (!this.env.BIRDEYE_API_KEY) {
      throw new Error("birdeye-api-key-missing");
    }

    const url = new URL("/defi/ohlcv/base_quote", "https://public-api.birdeye.so");
    url.searchParams.set("base_address", request.baseMint);
    url.searchParams.set("quote_address", request.quoteMint);
    url.searchParams.set("type", "1H");
    url.searchParams.set("time_from", String(Math.floor(request.startMs / 1000)));
    url.searchParams.set("time_to", String(Math.floor(request.endMs / 1000)));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-api-key": this.env.BIRDEYE_API_KEY,
        "x-chain": "solana",
        accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`birdeye-ohlcv-failed:${response.status}${body ? `:${body}` : ""}`);
    }

    const payload = (await response.json()) as BirdeyeOhlcvResponse;
    const rawItems = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.data?.items)
        ? payload.data.items
        : Array.isArray(payload.items)
          ? payload.items
          : [];

    const instrument = instrumentKey(request.baseMint, request.quoteMint);
    const bars: PriceBar[] = [];
    for (const item of rawItems) {
      const tsSec = toNumber(item.unixTime ?? item.t);
      const open = toNumber(item.o);
      const high = toNumber(item.h);
      const low = toNumber(item.l);
      const close = toNumber(item.c);
      const volume = toNumber(item.v) ?? undefined;
      if (tsSec === null || open === null || high === null || low === null || close === null) {
        continue;
      }
      bars.push({
        ts: new Date(tsSec * 1000).toISOString(),
        source: this.name,
        instrument,
        open,
        high,
        low,
        close,
        volume,
      });
    }

    bars.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    return bars;
  }
}
