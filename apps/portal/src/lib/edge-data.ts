import { isRecord } from "./utils";

const LOCAL_EDGE_API_BASE = "http://127.0.0.1:8888";

export type RowTone = "up" | "down" | "flat" | "warn";

export type DataRow = {
  label: string;
  value: string;
  status: string;
  change?: string;
  tone?: RowTone;
  spark?: number[];
};

export type PanelSummary = {
  label: string;
  tone?: RowTone;
};

export type DataPanel = {
  rows: DataRow[];
  status: string;
  source: string;
  summary?: PanelSummary;
};

type EdgeRequest = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  accessToken?: string | null;
};

class EdgeDataError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(path: string, status: number, message: string) {
    super(message);
    this.name = "EdgeDataError";
    this.status = status;
    this.path = path;
  }
}

export function edgeApiBase(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const configured = String(
    env.PUBLIC_EDGE_API_BASE ??
      env.VITE_EDGE_API_BASE ??
      env.NEXT_PUBLIC_EDGE_API_BASE ??
      "",
  )
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\\n$/, "")
    .replace(/\/+$/, "");
  if (configured) return configured;
  return import.meta.env.PROD ? "" : LOCAL_EDGE_API_BASE;
}

export async function fetchMacroSignalsRows(
  accessToken?: string | null,
): Promise<DataPanel> {
  return fetchPanelRows({
    path: "/api/x402/read/macro_signals",
    accessToken,
    parse: parseMacroSignals,
    summarize: summarizeMacroSignals,
  });
}

export async function fetchFredRows(
  accessToken?: string | null,
): Promise<DataPanel> {
  return fetchPanelRows({
    path: "/api/x402/read/macro_fred_indicators",
    accessToken,
    parse: parseFred,
    summarize: summarizeFred,
  });
}

export async function fetchEtfRows(
  accessToken?: string | null,
): Promise<DataPanel> {
  return fetchPanelRows({
    path: "/api/x402/read/macro_etf_flows",
    accessToken,
    parse: parseEtfs,
    summarize: summarizeEtfs,
  });
}

export async function fetchStablecoinRows(
  accessToken?: string | null,
): Promise<DataPanel> {
  return fetchPanelRows({
    path: "/api/x402/read/macro_stablecoin_health",
    accessToken,
    parse: parseStablecoins,
    summarize: summarizeStablecoins,
  });
}

export async function fetchOilRows(
  accessToken?: string | null,
): Promise<DataPanel> {
  return fetchPanelRows({
    path: "/api/x402/read/macro_oil_analytics",
    accessToken,
    parse: parseOil,
    summarize: summarizeOil,
  });
}

async function fetchPanelRows(input: {
  path: string;
  method?: "GET" | "POST";
  accessToken?: string | null;
  parse: (payload: unknown) => DataRow[];
  summarize?: (payload: unknown) => PanelSummary | undefined;
}): Promise<DataPanel> {
  const source = edgeApiBase();
  if (!source) {
    return panelUnavailable(
      "edge api base missing",
      "Set PUBLIC_EDGE_API_BASE",
      "",
    );
  }
  try {
    const payload = await edgeFetchJson(input.path, {
      method: input.method ?? "POST",
      body: input.method === "GET" ? undefined : {},
      accessToken: input.accessToken,
    });
    const rows = input.parse(payload);
    return {
      rows: rows.length > 0 ? rows : [statusRow("No rows returned", "ready")],
      status: "ready",
      source,
      summary: input.summarize?.(payload),
    };
  } catch (error) {
    return panelFromError(error, source);
  }
}

async function edgeFetchJson(
  path: string,
  request: EdgeRequest = {},
): Promise<unknown> {
  const base = edgeApiBase();
  if (!base) throw new EdgeDataError(path, 0, "edge-api-base-missing");
  const headers = new Headers();
  if (request.method !== "GET") headers.set("content-type", "application/json");
  const token = request.accessToken?.trim();
  if (token) {
    headers.set(
      "authorization",
      /^bearer\s+/i.test(token) ? token : `Bearer ${token}`,
    );
  }
  const response = await fetch(`${base}${path}`, {
    method: request.method ?? "POST",
    headers,
    body: request.body ? JSON.stringify(request.body) : undefined,
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      response.status === 402
        ? "live feed unavailable"
        : isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : `http-${response.status}`;
    throw new EdgeDataError(path, response.status, message);
  }
  return payload;
}

function panelFromError(error: unknown, source: string): DataPanel {
  if (error instanceof EdgeDataError) {
    const status =
      error.status === 402
        ? "live feed unavailable"
        : error.status === 401
          ? "authorization required"
          : error.status === 404
            ? "endpoint unavailable"
            : error.status > 0
              ? `http ${error.status}`
              : "not connected";
    return {
      rows: [statusRow(error.message, status)],
      status,
      source,
    };
  }
  const message = error instanceof Error ? error.message : "edge-fetch-failed";
  return {
    rows: [statusRow(message, "not connected")],
    status: "not connected",
    source,
  };
}

function panelUnavailable(
  message: string,
  status: string,
  source: string,
): DataPanel {
  return {
    rows: [statusRow(message, status)],
    status,
    source,
  };
}

function statusRow(value: string, status: string): DataRow {
  return {
    label: "Status",
    value,
    status,
  };
}

function parseMacroSignals(payload: unknown): DataRow[] {
  if (!isRecord(payload)) return [];
  const signals = isRecord(payload.signals) ? payload.signals : {};
  return Object.entries(signals)
    .slice(0, 6)
    .map(([key, raw]) => {
      const item = isRecord(raw) ? raw : {};
      const status = String(item.status ?? "UNKNOWN");
      return {
        label: labelize(key),
        value: valueFromKeys(item, [
          "value",
          "btcReturn5",
          "qqqRoc20",
          "change30d",
          "btcPrice",
        ]),
        status,
        tone: toneFromStatus(status),
        change: signedPercent(item.changePercent ?? item.change),
        spark: sparkFrom(item.sparkline ?? item.history),
      };
    });
}

function parseFred(payload: unknown): DataRow[] {
  if (!isRecord(payload)) return [];
  if (payload.configured === false) {
    return [statusRow("Provider API key not set", "setup")];
  }
  if (!Array.isArray(payload.series)) return [];
  return payload.series
    .filter(isRecord)
    .slice(0, 6)
    .map((row) => ({
      label: String(row.name ?? row.id ?? "Series"),
      value: `${formatCompact(row.value)}${String(row.unit ?? "")}`,
      status: String(row.date ?? "—"),
      change: signedPercent(row.changePercent),
      tone: toneFromNumber(numberFrom(row.changePercent ?? row.change)),
      spark: sparkFrom(row.history ?? row.sparkline),
    }));
}

function parseEtfs(payload: unknown): DataRow[] {
  if (!isRecord(payload)) return [];
  const etfs = Array.isArray(payload.etfs) ? payload.etfs.filter(isRecord) : [];
  if (etfs.length > 0) {
    return [...etfs]
      .sort(
        (a, b) =>
          Math.abs(numberFrom(b.estFlow ?? b.volume)) -
          Math.abs(numberFrom(a.estFlow ?? a.volume)),
      )
      .slice(0, 6)
      .map((row) => {
        const direction = String(row.direction ?? "");
        return {
          label: String(row.ticker ?? row.issuer ?? "ETF"),
          value: `$${formatCompact(row.estFlow ?? row.volume)}`,
          status: direction || "—",
          change: signedPercent(row.priceChange),
          tone: direction
            ? toneFromStatus(direction)
            : toneFromNumber(numberFrom(row.estFlow)),
        };
      });
  }
  return isRecord(payload.summary) ? summaryRows(payload.summary) : [];
}

function parseStablecoins(payload: unknown): DataRow[] {
  if (!isRecord(payload)) return [];
  const coins = Array.isArray(payload.stablecoins)
    ? payload.stablecoins.filter(isRecord)
    : [];
  if (coins.length > 0) {
    return coins.slice(0, 6).map((row) => {
      const peg = String(row.pegStatus ?? "");
      const deviation = numberFrom(row.deviation);
      const depegged =
        /depeg/i.test(peg) ||
        (Number.isFinite(deviation) && Math.abs(deviation) > 0.5);
      return {
        label: String(row.symbol ?? row.name ?? "Stablecoin"),
        value: `$${formatCompact(row.marketCap ?? row.volume24h)}`,
        status: peg || (depegged ? "DEPEG" : "PEG OK"),
        change: signedPercent(row.change24h),
        tone: depegged ? "warn" : "flat",
      };
    });
  }
  return isRecord(payload.summary) ? summaryRows(payload.summary) : [];
}

function parseOil(payload: unknown): DataRow[] {
  if (!isRecord(payload)) return [];
  if (payload.configured === false) {
    return [statusRow("Provider API key not set", "setup")];
  }
  const rows = ["wtiPrice", "brentPrice", "usProduction", "usInventory"]
    .map((key): DataRow | null => {
      const row = isRecord(payload[key]) ? payload[key] : null;
      if (!row) return null;
      const trend = String(row.trend ?? "");
      return {
        label: String(row.name ?? labelize(key)),
        value: `${formatCompact(row.current)} ${String(row.unit ?? "")}`.trim(),
        status: trend || "—",
        change: signedPercent(row.changePct ?? row.changePercent),
        tone: trend
          ? toneFromStatus(trend)
          : toneFromNumber(numberFrom(row.changePct)),
      };
    })
    .filter((row): row is DataRow => row !== null);

  const wti = isRecord(payload.wtiPrice)
    ? numberFrom(payload.wtiPrice.current)
    : NaN;
  const brent = isRecord(payload.brentPrice)
    ? numberFrom(payload.brentPrice.current)
    : NaN;
  if (Number.isFinite(wti) && Number.isFinite(brent)) {
    rows.push({
      label: "BRENT-WTI",
      value: `$${(brent - wti).toFixed(2)}`,
      status: "spread",
      tone: "flat",
    });
  }
  return rows;
}

function summaryRows(summary: Record<string, unknown>): DataRow[] {
  return Object.entries(summary)
    .slice(0, 6)
    .map(([key, raw]) => ({
      label: labelize(key),
      value: typeof raw === "number" ? formatCompact(raw) : String(raw),
      status: "summary",
    }));
}

function summarizeMacroSignals(payload: unknown): PanelSummary | undefined {
  if (!isRecord(payload) || typeof payload.verdict !== "string")
    return undefined;
  const verdict = payload.verdict.trim();
  if (!verdict) return undefined;
  const bull = numberFrom(payload.bullishCount);
  const total = numberFrom(payload.totalCount);
  const tally =
    Number.isFinite(bull) && Number.isFinite(total)
      ? ` · ${bull}/${total}`
      : "";
  return { label: `${verdict}${tally}`, tone: toneFromStatus(verdict) };
}

function summarizeFred(payload: unknown): PanelSummary | undefined {
  if (!isRecord(payload)) return undefined;
  if (payload.configured === false)
    return { label: "key not set", tone: "warn" };
  const count = Array.isArray(payload.series) ? payload.series.length : 0;
  return count > 0 ? { label: `${count} series`, tone: "flat" } : undefined;
}

function summarizeEtfs(payload: unknown): PanelSummary | undefined {
  const summary =
    isRecord(payload) && isRecord(payload.summary) ? payload.summary : null;
  if (!summary) return undefined;
  const direction = String(summary.netDirection ?? "").trim();
  const inflow = numberFrom(summary.inflowCount);
  const outflow = numberFrom(summary.outflowCount);
  const tally =
    Number.isFinite(inflow) || Number.isFinite(outflow)
      ? ` · ${inflow || 0}↑/${outflow || 0}↓`
      : "";
  if (!direction && !tally) return undefined;
  return {
    label: `${direction}${tally}`.trim(),
    tone: toneFromStatus(direction),
  };
}

function summarizeStablecoins(payload: unknown): PanelSummary | undefined {
  const summary =
    isRecord(payload) && isRecord(payload.summary) ? payload.summary : null;
  if (!summary) return undefined;
  const health = String(summary.healthStatus ?? "").trim();
  const depegged = numberFrom(summary.depeggedCount);
  const dp = Number.isFinite(depegged) ? ` · ${depegged} depegged` : "";
  if (!health && !dp) return undefined;
  const tone: RowTone = health
    ? /(healthy|stable)/i.test(health)
      ? "up"
      : "warn"
    : "flat";
  return { label: `${health}${dp}`.trim(), tone };
}

function summarizeOil(payload: unknown): PanelSummary | undefined {
  if (!isRecord(payload)) return undefined;
  if (payload.configured === false)
    return { label: "key not set", tone: "warn" };
  const wti = isRecord(payload.wtiPrice) ? payload.wtiPrice : null;
  const trend = wti ? String(wti.trend ?? "").trim() : "";
  return trend
    ? { label: `WTI ${trend}`, tone: toneFromStatus(trend) }
    : undefined;
}

function toneFromStatus(status: string): RowTone {
  const s = status.toLowerCase();
  if (/(bullish|rising|inflow|expanding|strong|healthy|buy|up\b)/.test(s)) {
    return "up";
  }
  if (
    /(bearish|declining|outflow|contracting|weak|depeg|falling|sell|down\b)/.test(
      s,
    )
  ) {
    return "down";
  }
  return "flat";
}

function toneFromNumber(value: number): RowTone {
  if (!Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

function numberFrom(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function signedPercent(value: unknown): string | undefined {
  const n = numberFrom(value);
  if (!Number.isFinite(n)) return undefined;
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function sparkFrom(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const nums = value.map(numberFrom).filter((n) => Number.isFinite(n));
  return nums.length >= 2 ? nums.slice(-32) : undefined;
}

function labelize(value: string): string {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .toUpperCase();
}

function valueFromKeys(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (key in row) return formatCompact(row[key]);
  }
  return "--";
}

function formatCompact(value: unknown): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "--";
  const abs = Math.abs(number);
  if (abs >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(number / 1_000).toFixed(2)}K`;
  return number.toFixed(2);
}
