const PERPS_CACHE_TTL_MS = 15_000;
const PERPS_FETCH_TIMEOUT_MS = 4_500;

const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const DYDX_PERP_MARKETS_URL = "https://indexer.dydx.trade/v4/perpetualMarkets";

const ACTIVE_MARKET_STATUSES = new Set(["ACTIVE", "OPEN", "TRADING"]);

export const DEFAULT_PERPS_SYMBOLS = ["BTC", "ETH", "SOL"] as const;
export const SUPPORTED_PERPS_VENUES = ["hyperliquid", "dydx"] as const;

export type PerpsVenue = (typeof SUPPORTED_PERPS_VENUES)[number];

type PerpsUnavailableVenue = {
  venue: PerpsVenue;
  reason: string;
};

type PerpsVenueRow = {
  venue: PerpsVenue;
  symbol: string;
  market: string;
  status: string;
  fundingRate1h: number | null;
  fundingBps1h: number | null;
  markPrice: number | null;
  openInterestNative: number | null;
  openInterestUsd: number | null;
  volume24hUsd: number | null;
  sourceTs: string;
};

type PerpsRawSnapshot = {
  ts: string;
  rows: PerpsVenueRow[];
  unavailableVenues: PerpsUnavailableVenue[];
};

type PerpsRawCache = {
  value: PerpsRawSnapshot | null;
  updatedAtMs: number;
};

type PerpsRequestInput = {
  symbols?: string[];
  venues?: PerpsVenue[];
  includeInactive?: boolean;
};

type PerpsSymbolFundingRow = {
  symbol: string;
  spreadBps1h: number | null;
  meanFundingBps1h: number | null;
  maxAbsFundingBps1h: number | null;
  byVenue: Array<{
    venue: PerpsVenue;
    market: string;
    status: string;
    fundingRate1h: number | null;
    fundingBps1h: number | null;
    openInterestUsd: number | null;
    volume24hUsd: number | null;
  }>;
};

export type PerpsFundingSurfaceResponse = {
  timestamp: string;
  symbols: string[];
  venues: PerpsVenue[];
  includeInactive: boolean;
  count: number;
  rows: PerpsSymbolFundingRow[];
  unavailableVenues: PerpsUnavailableVenue[];
};

type PerpsSymbolOpenInterestRow = {
  symbol: string;
  totalOpenInterestUsd: number;
  leaderVenue: PerpsVenue | null;
  leaderSharePct: number | null;
  byVenue: Array<{
    venue: PerpsVenue;
    market: string;
    status: string;
    markPrice: number | null;
    openInterestNative: number | null;
    openInterestUsd: number | null;
    sharePct: number | null;
  }>;
};

export type PerpsOpenInterestSurfaceResponse = {
  timestamp: string;
  symbols: string[];
  venues: PerpsVenue[];
  includeInactive: boolean;
  count: number;
  rows: PerpsSymbolOpenInterestRow[];
  unavailableVenues: PerpsUnavailableVenue[];
};

export type PerpsVenueScoreResponse = {
  timestamp: string;
  symbols: string[];
  venues: PerpsVenue[];
  includeInactive: boolean;
  recommendedVenue: PerpsVenue | null;
  scores: Array<{
    venue: PerpsVenue;
    score: number;
    symbolsCovered: number;
    marketsCount: number;
    totalOpenInterestUsd: number;
    totalVolume24hUsd: number;
    avgAbsFundingBps1h: number;
    components: {
      oiLog: number;
      volumeLog: number;
      coverage: number;
      fundingPenalty: number;
    };
  }>;
  unavailableVenues: PerpsUnavailableVenue[];
};

const perpsRawCache: PerpsRawCache = {
  value: null,
  updatedAtMs: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeSymbol(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function withTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return {
    signal: ctrl.signal,
    clear: () => clearTimeout(timer),
  };
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<unknown> {
  const { signal, clear } = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal,
      headers: {
        accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(`fetch-failed:${response.status}`);
    }
    return (await response.json()) as unknown;
  } finally {
    clear();
  }
}

async function fetchHyperliquidRows(): Promise<PerpsVenueRow[]> {
  const raw = await fetchJsonWithTimeout(
    HYPERLIQUID_INFO_URL,
    PERPS_FETCH_TIMEOUT_MS,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    },
  );
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error("invalid-hyperliquid-response");
  }

  const meta = raw[0];
  const ctxList = raw[1];
  if (
    !isRecord(meta) ||
    !Array.isArray(meta.universe) ||
    !Array.isArray(ctxList)
  ) {
    throw new Error("invalid-hyperliquid-response");
  }

  const ts = nowIso();
  const rows: PerpsVenueRow[] = [];
  for (let i = 0; i < meta.universe.length; i += 1) {
    const market = meta.universe[i];
    const ctx = ctxList[i];
    if (!isRecord(market) || !isRecord(ctx)) continue;

    const symbol = normalizeSymbol(String(market.name ?? ""));
    if (!symbol) continue;
    const status = market.isDelisted === true ? "INACTIVE" : "ACTIVE";

    const fundingRate1h = toFiniteNumber(ctx.funding);
    const markPrice =
      toFiniteNumber(ctx.markPx) ?? toFiniteNumber(ctx.oraclePx);
    const openInterestNative = toFiniteNumber(ctx.openInterest);
    const openInterestUsd =
      markPrice === null || openInterestNative === null
        ? null
        : round(markPrice * openInterestNative, 2);
    const volume24hUsd = toFiniteNumber(ctx.dayNtlVlm);

    rows.push({
      venue: "hyperliquid",
      symbol,
      market: `${symbol}-PERP`,
      status,
      fundingRate1h,
      fundingBps1h:
        fundingRate1h === null ? null : round(fundingRate1h * 10_000, 4),
      markPrice,
      openInterestNative,
      openInterestUsd,
      volume24hUsd,
      sourceTs: ts,
    });
  }
  return rows;
}

async function fetchDydxRows(): Promise<PerpsVenueRow[]> {
  const raw = await fetchJsonWithTimeout(
    DYDX_PERP_MARKETS_URL,
    PERPS_FETCH_TIMEOUT_MS,
  );
  if (!isRecord(raw) || !isRecord(raw.markets)) {
    throw new Error("invalid-dydx-response");
  }

  const ts = nowIso();
  const rows: PerpsVenueRow[] = [];
  for (const market of Object.values(raw.markets)) {
    if (!isRecord(market)) continue;

    const ticker = String(market.ticker ?? "").trim();
    if (!ticker) continue;
    const symbol = normalizeSymbol(ticker.split("-")[0] ?? "");
    if (!symbol) continue;

    const statusRaw = String(market.status ?? "")
      .trim()
      .toUpperCase();
    const status = statusRaw || "UNKNOWN";

    const fundingRate1h = toFiniteNumber(market.nextFundingRate);
    const markPrice = toFiniteNumber(market.oraclePrice);
    const openInterestNative = toFiniteNumber(market.openInterest);
    const openInterestUsd =
      markPrice === null || openInterestNative === null
        ? null
        : round(markPrice * openInterestNative, 2);
    const volume24hUsd = toFiniteNumber(market.volume24H);

    rows.push({
      venue: "dydx",
      symbol,
      market: ticker,
      status,
      fundingRate1h,
      fundingBps1h:
        fundingRate1h === null ? null : round(fundingRate1h * 10_000, 4),
      markPrice,
      openInterestNative,
      openInterestUsd,
      volume24hUsd,
      sourceTs: ts,
    });
  }
  return rows;
}

async function loadPerpsRawSnapshot(): Promise<PerpsRawSnapshot> {
  if (
    perpsRawCache.value &&
    perpsRawCache.updatedAtMs > 0 &&
    Date.now() - perpsRawCache.updatedAtMs <= PERPS_CACHE_TTL_MS
  ) {
    return perpsRawCache.value;
  }

  const [hyperliquidResult, dydxResult] = await Promise.allSettled([
    fetchHyperliquidRows(),
    fetchDydxRows(),
  ]);

  const unavailableVenues: PerpsUnavailableVenue[] = [];
  const rows: PerpsVenueRow[] = [];

  if (hyperliquidResult.status === "fulfilled") {
    rows.push(...hyperliquidResult.value);
  } else {
    unavailableVenues.push({
      venue: "hyperliquid",
      reason:
        hyperliquidResult.reason instanceof Error
          ? hyperliquidResult.reason.message
          : "fetch-failed",
    });
  }

  if (dydxResult.status === "fulfilled") {
    rows.push(...dydxResult.value);
  } else {
    unavailableVenues.push({
      venue: "dydx",
      reason:
        dydxResult.reason instanceof Error
          ? dydxResult.reason.message
          : "fetch-failed",
    });
  }

  if (rows.length < 1) {
    throw new Error("perps-data-unavailable");
  }

  const snapshot: PerpsRawSnapshot = {
    ts: nowIso(),
    rows,
    unavailableVenues,
  };
  perpsRawCache.value = snapshot;
  perpsRawCache.updatedAtMs = Date.now();
  return snapshot;
}

function filterPerpsRows(
  rows: PerpsVenueRow[],
  input: PerpsRequestInput,
): PerpsVenueRow[] {
  const symbols =
    input.symbols && input.symbols.length > 0
      ? new Set(input.symbols.map((item) => normalizeSymbol(item)))
      : null;
  const venues =
    input.venues && input.venues.length > 0 ? new Set(input.venues) : null;
  const includeInactive = input.includeInactive === true;

  const filtered = rows.filter((row) => {
    if (venues && !venues.has(row.venue)) return false;
    if (symbols && !symbols.has(row.symbol)) return false;
    if (includeInactive) return true;
    return ACTIVE_MARKET_STATUSES.has(row.status.toUpperCase());
  });

  filtered.sort((a, b) =>
    a.symbol === b.symbol
      ? a.venue.localeCompare(b.venue)
      : a.symbol.localeCompare(b.symbol),
  );
  return filtered;
}

function groupRowsBySymbol(
  rows: PerpsVenueRow[],
): Array<{ symbol: string; rows: PerpsVenueRow[] }> {
  const groups = new Map<string, PerpsVenueRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.symbol);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(row.symbol, [row]);
    }
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([symbol, groupedRows]) => ({ symbol, rows: groupedRows }));
}

function resolveSymbolsFromRows(rows: PerpsVenueRow[]): string[] {
  return Array.from(new Set(rows.map((row) => row.symbol))).sort();
}

function resolveVenuesFromRows(rows: PerpsVenueRow[]): PerpsVenue[] {
  const venues = new Set<PerpsVenue>();
  for (const row of rows) {
    venues.add(row.venue);
  }
  return Array.from(venues).sort((a, b) => a.localeCompare(b));
}

function buildFundingRows(rows: PerpsVenueRow[]): PerpsSymbolFundingRow[] {
  const grouped = groupRowsBySymbol(rows);
  return grouped.map(({ symbol, rows: symbolRows }) => {
    const fundingValues = symbolRows
      .map((row) => row.fundingBps1h)
      .filter((value): value is number => value !== null);

    const spreadBps1h =
      fundingValues.length >= 2
        ? round(Math.max(...fundingValues) - Math.min(...fundingValues), 4)
        : null;
    const meanFundingBps1h =
      fundingValues.length > 0
        ? round(
            fundingValues.reduce((sum, value) => sum + value, 0) /
              fundingValues.length,
            4,
          )
        : null;
    const maxAbsFundingBps1h =
      fundingValues.length > 0
        ? round(
            fundingValues.reduce(
              (max, value) => Math.max(max, Math.abs(value)),
              0,
            ),
            4,
          )
        : null;

    return {
      symbol,
      spreadBps1h,
      meanFundingBps1h,
      maxAbsFundingBps1h,
      byVenue: symbolRows.map((row) => ({
        venue: row.venue,
        market: row.market,
        status: row.status,
        fundingRate1h: row.fundingRate1h,
        fundingBps1h: row.fundingBps1h,
        openInterestUsd: row.openInterestUsd,
        volume24hUsd: row.volume24hUsd,
      })),
    };
  });
}

function buildOpenInterestRows(
  rows: PerpsVenueRow[],
): PerpsSymbolOpenInterestRow[] {
  const grouped = groupRowsBySymbol(rows);
  return grouped.map(({ symbol, rows: symbolRows }) => {
    const totalOpenInterestUsd = round(
      symbolRows.reduce((sum, row) => sum + (row.openInterestUsd ?? 0), 0),
      2,
    );
    const leader =
      symbolRows.length < 1
        ? null
        : symbolRows.reduce((top, row) => {
            const topValue = top.openInterestUsd ?? -1;
            const nextValue = row.openInterestUsd ?? -1;
            return nextValue > topValue ? row : top;
          }, symbolRows[0]);
    const leaderVenue =
      leader && (leader.openInterestUsd ?? 0) > 0 ? leader.venue : null;
    const leaderSharePct =
      leader && totalOpenInterestUsd > 0 && leader.openInterestUsd !== null
        ? round((leader.openInterestUsd / totalOpenInterestUsd) * 100, 2)
        : null;

    return {
      symbol,
      totalOpenInterestUsd,
      leaderVenue,
      leaderSharePct,
      byVenue: symbolRows.map((row) => ({
        venue: row.venue,
        market: row.market,
        status: row.status,
        markPrice: row.markPrice,
        openInterestNative: row.openInterestNative,
        openInterestUsd: row.openInterestUsd,
        sharePct:
          row.openInterestUsd !== null && totalOpenInterestUsd > 0
            ? round((row.openInterestUsd / totalOpenInterestUsd) * 100, 2)
            : null,
      })),
    };
  });
}

function buildVenueScores(
  rows: PerpsVenueRow[],
): PerpsVenueScoreResponse["scores"] {
  const byVenue = new Map<
    PerpsVenue,
    {
      venue: PerpsVenue;
      symbols: Set<string>;
      marketsCount: number;
      totalOpenInterestUsd: number;
      totalVolume24hUsd: number;
      fundingAbsBps: number[];
      rawScore: number;
    }
  >();

  for (const row of rows) {
    const existing = byVenue.get(row.venue) ?? {
      venue: row.venue,
      symbols: new Set<string>(),
      marketsCount: 0,
      totalOpenInterestUsd: 0,
      totalVolume24hUsd: 0,
      fundingAbsBps: [],
      rawScore: 0,
    };
    existing.symbols.add(row.symbol);
    existing.marketsCount += 1;
    existing.totalOpenInterestUsd += row.openInterestUsd ?? 0;
    existing.totalVolume24hUsd += row.volume24hUsd ?? 0;
    if (row.fundingBps1h !== null) {
      existing.fundingAbsBps.push(Math.abs(row.fundingBps1h));
    }
    byVenue.set(row.venue, existing);
  }

  const rawRows = Array.from(byVenue.values()).map((row) => {
    const avgAbsFundingBps1h =
      row.fundingAbsBps.length > 0
        ? row.fundingAbsBps.reduce((sum, value) => sum + value, 0) /
          row.fundingAbsBps.length
        : 0;
    const oiLog = Math.log1p(Math.max(0, row.totalOpenInterestUsd));
    const volumeLog = Math.log1p(Math.max(0, row.totalVolume24hUsd));
    const coverage = row.symbols.size;
    const fundingPenalty = avgAbsFundingBps1h;
    const rawScore =
      oiLog * 0.45 + volumeLog * 0.35 + coverage * 1.5 - fundingPenalty * 0.04;

    return {
      venue: row.venue,
      score: 0,
      rawScore,
      symbolsCovered: coverage,
      marketsCount: row.marketsCount,
      totalOpenInterestUsd: round(row.totalOpenInterestUsd, 2),
      totalVolume24hUsd: round(row.totalVolume24hUsd, 2),
      avgAbsFundingBps1h: round(avgAbsFundingBps1h, 4),
      components: {
        oiLog: round(oiLog, 4),
        volumeLog: round(volumeLog, 4),
        coverage,
        fundingPenalty: round(fundingPenalty, 4),
      },
    };
  });

  const minRaw = rawRows.reduce(
    (min, row) => Math.min(min, row.rawScore),
    Infinity,
  );
  const maxRaw = rawRows.reduce(
    (max, row) => Math.max(max, row.rawScore),
    -Infinity,
  );

  const withScores = rawRows.map((row) => {
    const score =
      rawRows.length <= 1 || maxRaw <= minRaw
        ? 100
        : round(((row.rawScore - minRaw) / (maxRaw - minRaw)) * 100, 2);
    return {
      venue: row.venue,
      score,
      symbolsCovered: row.symbolsCovered,
      marketsCount: row.marketsCount,
      totalOpenInterestUsd: row.totalOpenInterestUsd,
      totalVolume24hUsd: row.totalVolume24hUsd,
      avgAbsFundingBps1h: row.avgAbsFundingBps1h,
      components: row.components,
    };
  });

  withScores.sort((a, b) =>
    b.score === a.score ? a.venue.localeCompare(b.venue) : b.score - a.score,
  );
  return withScores;
}

async function resolveFilteredRows(input: PerpsRequestInput): Promise<{
  snapshotTs: string;
  rows: PerpsVenueRow[];
  unavailableVenues: PerpsUnavailableVenue[];
}> {
  const snapshot = await loadPerpsRawSnapshot();
  const rows = filterPerpsRows(snapshot.rows, input);
  return {
    snapshotTs: snapshot.ts,
    rows,
    unavailableVenues: snapshot.unavailableVenues,
  };
}

export async function fetchPerpsFundingSurface(
  input: PerpsRequestInput,
): Promise<PerpsFundingSurfaceResponse> {
  const { snapshotTs, rows, unavailableVenues } =
    await resolveFilteredRows(input);
  return {
    timestamp: snapshotTs,
    symbols: resolveSymbolsFromRows(rows),
    venues: resolveVenuesFromRows(rows),
    includeInactive: input.includeInactive === true,
    count: rows.length,
    rows: buildFundingRows(rows),
    unavailableVenues,
  };
}

export async function fetchPerpsOpenInterestSurface(
  input: PerpsRequestInput,
): Promise<PerpsOpenInterestSurfaceResponse> {
  const { snapshotTs, rows, unavailableVenues } =
    await resolveFilteredRows(input);
  return {
    timestamp: snapshotTs,
    symbols: resolveSymbolsFromRows(rows),
    venues: resolveVenuesFromRows(rows),
    includeInactive: input.includeInactive === true,
    count: rows.length,
    rows: buildOpenInterestRows(rows),
    unavailableVenues,
  };
}

export async function fetchPerpsVenueScore(
  input: PerpsRequestInput,
): Promise<PerpsVenueScoreResponse> {
  const { snapshotTs, rows, unavailableVenues } =
    await resolveFilteredRows(input);
  const scores = buildVenueScores(rows);
  return {
    timestamp: snapshotTs,
    symbols: resolveSymbolsFromRows(rows),
    venues: resolveVenuesFromRows(rows),
    includeInactive: input.includeInactive === true,
    recommendedVenue: scores[0]?.venue ?? null,
    scores,
    unavailableVenues,
  };
}
