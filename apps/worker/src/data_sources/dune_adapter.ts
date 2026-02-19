import type { Env } from "../types";
import type {
  DataSourcesConfig,
  HistoricalBarsRequest,
  MarketDataAdapter,
  PriceBar,
} from "./types";
import { instrumentKey } from "./types";

type UnknownRecord = Record<string, unknown>;

type DuneAdapterConfig = {
  apiKey: string;
  apiUrl: string;
  queryId: string;
  maxRows: number;
  params?: UnknownRecord;
  parameterWhitelist?: string[];
  columns: {
    ts: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string | null;
  };
};

function isObject(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizeText(value: unknown): string | null {
  const s = toStringOrNull(value);
  if (!s) return null;
  return s;
}

function toNumberOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTsIso(value: unknown): string | null {
  const asText = toStringOrNull(value);
  if (asText === null) return null;

  if (/^\d+$/.test(asText)) {
    const raw = Number(asText);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const maybeSec = raw < 2_000_000_000_000;
    const tsMs = maybeSec ? raw * 1000 : raw;
    return new Date(tsMs).toISOString();
  }

  const parsed = Date.parse(asText);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function extractRows(payload: unknown): UnknownRecord[] {
  if (!isObject(payload)) return [];
  const stack: unknown[] = [payload];
  const visited = new Set<unknown>();
  const rows: UnknownRecord[] = [];

  while (stack.length) {
    const current = stack.pop();
    if (!current || visited.has(current) || !isObject(current)) continue;
    visited.add(current);
    const record = current as UnknownRecord;
    if (
      Array.isArray(record.rows) &&
      record.rows.every((item) => isObject(item))
    ) {
      return record.rows as UnknownRecord[];
    }
    for (const value of Object.values(record)) {
      if (isObject(value) || Array.isArray(value)) {
        stack.push(value);
      }
    }
  }

  return rows;
}

function parseBar(
  row: UnknownRecord,
  request: HistoricalBarsRequest,
  columns: DuneAdapterConfig["columns"],
): PriceBar | null {
  const ts = toTsIso(row[columns.ts] ?? row.time ?? row.timestamp);
  const open = toNumberOrNull(row[columns.open] ?? row.o ?? row.Open);
  const high = toNumberOrNull(row[columns.high] ?? row.h ?? row.High);
  const low = toNumberOrNull(row[columns.low] ?? row.l ?? row.Low);
  const close = toNumberOrNull(row[columns.close] ?? row.c ?? row.Close);
  if (
    ts === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  const volumeRaw =
    columns.volume === null
      ? null
      : (row[columns.volume] ?? row.v ?? row.Volume);
  const volume = toNumberOrNull(volumeRaw);

  return {
    ts,
    source: "dune",
    instrument: instrumentKey(request.baseMint, request.quoteMint),
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume ?? NaN) ? volume : undefined,
  };
}

function resolveDuneConfig(
  env: Env,
  config?: DataSourcesConfig,
): DuneAdapterConfig {
  const providers =
    isObject(config?.providers) && isObject(config.providers.dune)
      ? (config.providers.dune as UnknownRecord)
      : {};

  const apiKey = normalizeText(
    providers.apiKey ?? providers.key ?? env.DUNE_API_KEY,
  );
  if (!apiKey) {
    throw new Error("dune-api-key-missing");
  }

  const queryId = normalizeText(
    providers.queryId ?? providers.id ?? env.DUNE_QUERY_ID,
  );
  if (!queryId) {
    throw new Error("dune-query-id-missing");
  }

  const apiUrl = normalizeText(
    providers.apiUrl ??
      providers.baseUrl ??
      env.DUNE_API_URL ??
      "https://api.dune.com",
  );
  const maxRows = Math.min(
    10_000,
    Math.max(1, Number(providers.maxRows ?? 3_000)),
  );
  const params = isObject(providers.params)
    ? (providers.params as UnknownRecord)
    : undefined;
  const parameterWhitelist = Array.isArray(providers.parameterWhitelist)
    ? providers.parameterWhitelist.filter((value) => typeof value === "string")
    : [];
  const columns = {
    ts:
      normalizeText(
        (providers.columns as UnknownRecord)?.ts ??
          (providers.columns as UnknownRecord)?.time,
      ) ?? "ts",
    open:
      normalizeText(
        (providers.columns as UnknownRecord)?.open ??
          (providers.columns as UnknownRecord)?.openPrice ??
          (providers.columns as UnknownRecord)?.o,
      ) ?? "open",
    high:
      normalizeText(
        (providers.columns as UnknownRecord)?.high ??
          (providers.columns as UnknownRecord)?.highPrice ??
          (providers.columns as UnknownRecord)?.h,
      ) ?? "high",
    low:
      normalizeText(
        (providers.columns as UnknownRecord)?.low ??
          (providers.columns as UnknownRecord)?.lowPrice ??
          (providers.columns as UnknownRecord)?.l,
      ) ?? "low",
    close:
      normalizeText(
        (providers.columns as UnknownRecord)?.close ??
          (providers.columns as UnknownRecord)?.closePrice ??
          (providers.columns as UnknownRecord)?.c,
      ) ?? "close",
    volume: normalizeText(
      (providers.columns as UnknownRecord)?.volume ??
        (providers.columns as UnknownRecord)?.v,
    ),
  };

  return {
    apiKey,
    apiUrl,
    queryId,
    maxRows,
    params,
    parameterWhitelist: parameterWhitelist.map((value) => value.trim()),
    columns: {
      ts: columns.ts,
      open: columns.open,
      high: columns.high,
      low: columns.low,
      close: columns.close,
      volume: columns.volume,
    },
  };
}

export class DuneDataAdapter implements MarketDataAdapter {
  readonly name = "dune";

  private readonly config: DuneAdapterConfig;

  constructor(
    readonly env: Env,
    readonly dataSourceConfig?: DataSourcesConfig,
  ) {
    this.config = resolveDuneConfig(env, dataSourceConfig);
  }

  async fetchHourlyBars(request: HistoricalBarsRequest): Promise<PriceBar[]> {
    const normalizedTsStart = Math.floor(request.startMs / 1000);
    const normalizedTsEnd = Math.floor(request.endMs / 1000);
    const url = new URL(
      `/api/v1/query/${encodeURIComponent(this.config.queryId)}/results`,
      this.config.apiUrl,
    );

    const requestParams: UnknownRecord = {
      limit: this.config.maxRows,
      base_mint: request.baseMint,
      quote_mint: request.quoteMint,
      start_ts: normalizedTsStart,
      end_ts: normalizedTsEnd,
      resolution_minutes: request.resolutionMinutes ?? 60,
    };

    const sourceParams = this.config.params ?? {};
    for (const [key, rawValue] of Object.entries(sourceParams)) {
      if (!key.trim() || rawValue === undefined) continue;
      if (
        this.config.parameterWhitelist.length &&
        !this.config.parameterWhitelist.includes(key)
      ) {
        continue;
      }
      requestParams[key] = rawValue;
    }

    for (const [key, rawValue] of Object.entries(requestParams)) {
      if (rawValue === undefined) continue;
      url.searchParams.set(key, String(rawValue));
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-dune-api-key": this.config.apiKey,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `dune-ohlcv-failed:${response.status}${body ? `:${body}` : ""}`,
      );
    }

    const payload = (await response.json()) as unknown;
    const rows = extractRows(payload);
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const bars = rows
      .map((row) => parseBar(row, request, this.config.columns))
      .filter((bar): bar is PriceBar => bar !== null);

    bars.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    return bars;
  }
}
