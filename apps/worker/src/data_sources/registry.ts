import type { DataSourcesConfig, Env } from "../types";
import { BirdeyeDataAdapter } from "./birdeye_adapter";
import { listFeaturePoints, upsertFeaturePoint } from "./feature_store";
import { FixtureDataAdapter } from "./fixture_adapter";
import { DuneDataAdapter } from "./dune_adapter";
import type { HistoricalBarsRequest, MarketDataAdapter, PriceBar } from "./types";
import { instrumentKey, resolveSourcePriority } from "./types";

const FEATURE_NAME = "ohlcv_1h";
const CUSTOM_ADAPTER_FACTORIES = new Map<
  string,
  (env: Env, config?: DataSourcesConfig) => MarketDataAdapter
>();

function normalizeTtlMinutes(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(24 * 60, Math.floor(n));
}

function parseCachedBars(rows: Array<{ source: string; ts: string; value: unknown }>): PriceBar[] {
  const bars: PriceBar[] = [];
  for (const row of rows) {
    const v = row.value;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const rec = v as Record<string, unknown>;
    const open = Number(rec.open);
    const high = Number(rec.high);
    const low = Number(rec.low);
    const close = Number(rec.close);
    const volume = rec.volume === undefined ? undefined : Number(rec.volume);
    if (![open, high, low, close].every((x) => Number.isFinite(x))) continue;
    bars.push({
      ts: row.ts,
      source: row.source,
      instrument: String(rec.instrument ?? ""),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume ?? NaN) ? volume : undefined,
    });
  }
  bars.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return bars;
}

export class DataSourceRegistry {
  private readonly adapters = new Map<string, MarketDataAdapter>();

  constructor(
    private readonly env: Env,
    private readonly config?: DataSourcesConfig,
  ) {
    this.adapters.set("fixture", new FixtureDataAdapter());
    this.adapters.set("birdeye", new BirdeyeDataAdapter(env));
    for (const [name, factory] of CUSTOM_ADAPTER_FACTORIES.entries()) {
      this.adapters.set(name, factory(env, config));
    }
  }

  getAdapter(name: string): MarketDataAdapter | null {
    if (name === "dune") {
      const cached = this.adapters.get("dune");
      if (cached) return cached;
      try {
        const dune = new DuneDataAdapter(this.env, this.config);
        this.adapters.set("dune", dune);
        return dune;
      } catch {
        return null;
      }
    }
    return this.adapters.get(name) ?? null;
  }

  async fetchHourlyBars(request: HistoricalBarsRequest): Promise<PriceBar[]> {
    const priority = resolveSourcePriority(this.config);
    const ttlMinutes = normalizeTtlMinutes(this.config?.cacheTtlMinutes ?? 15);
    const instrument = instrumentKey(request.baseMint, request.quoteMint);

    if (ttlMinutes > 0) {
      const cached = await listFeaturePoints(this.env, {
        instrument,
        feature: FEATURE_NAME,
        startTs: new Date(request.startMs).toISOString(),
        endTs: new Date(request.endMs).toISOString(),
        limit: 3000,
      });
      const parsed = parseCachedBars(cached);
      if (parsed.length > 24) {
        const newest = Date.parse(parsed[parsed.length - 1]?.ts ?? "");
        if (Number.isFinite(newest) && Date.now() - newest <= ttlMinutes * 60_000) {
          return parsed;
        }
      }
    }

    let lastError: unknown = null;
    for (const source of priority) {
      const adapter = this.getAdapter(source);
      if (!adapter) continue;
      try {
        const bars = await adapter.fetchHourlyBars({
          ...request,
          pattern:
            source === "fixture"
              ? request.pattern ?? this.config?.fixturePattern
              : request.pattern,
        });
        if (bars.length === 0) continue;

        await Promise.all(
          bars.map((bar) =>
            upsertFeaturePoint(this.env, {
              source: adapter.name,
              instrument,
              feature: FEATURE_NAME,
              ts: bar.ts,
              value: {
                instrument,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume ?? null,
              },
              qualityScore: 1,
            }),
          ),
        );

        return bars;
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(
      lastError instanceof Error ? lastError.message : "data-source-fetch-failed",
    );
  }
}

export function registerDataSourceAdapter(
  name: string,
  factory: (env: Env, config?: DataSourcesConfig) => MarketDataAdapter,
): void {
  const key = String(name || "").trim();
  if (!key) {
    throw new Error("invalid-data-source-name");
  }
  CUSTOM_ADAPTER_FACTORIES.set(key, factory);
}

export function createDataSourceRegistry(
  env: Env,
  config?: DataSourcesConfig,
): DataSourceRegistry {
  return new DataSourceRegistry(env, config);
}
