// Per-wallet Phoenix trader snapshots, persisted on device. The store is the
// single source of truth for account state: the terminal derives its view
// from here, the live refresh writes back here, and localStorage + the
// cross-tab storage event keep every tab and every page load instant.

import { persisted } from "./persisted";
import type { PhoenixTraderState } from "./phoenix-trade";

export type TraderSnapshot = { at: number; state: PhoenixTraderState };

const SNAPSHOT_TTL_MS = 24 * 3_600_000;
const MAX_WALLETS = 4;

export const traderSnapshots = persisted<Record<string, TraderSnapshot>>(
  "trader-ralph-phoenix-snapshots",
  {},
);

/** Snapshot for a wallet, or null when absent/expired. */
export function freshSnapshot(
  snapshots: Record<string, TraderSnapshot>,
  authority: string,
): PhoenixTraderState | null {
  const entry = snapshots[authority];
  if (!entry || typeof entry.at !== "number" || !entry.state) return null;
  if (Date.now() - entry.at > SNAPSHOT_TTL_MS) return null;
  return entry.state;
}

/** Record a fresh snapshot, pruning to the most recent wallets. */
export function recordSnapshot(
  authority: string,
  state: PhoenixTraderState,
): void {
  traderSnapshots.update((snapshots) => {
    const next: Record<string, TraderSnapshot> = {
      ...snapshots,
      [authority]: { at: Date.now(), state },
    };
    const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at);
    for (const key of keys.slice(MAX_WALLETS)) delete next[key];
    return next;
  });
}

// ── Equity history (Day P&L) ─────────────────────────────────────────
// Per-wallet equity samples, persisted on device. Appended from the same
// trader refresh that records snapshots (no extra RPC): at most one point
// per minute, capped to a 24h window. The baseline is the first sample of
// each UTC day; deposits/withdrawals shift it at their confirm sites so
// funding moves don't masquerade as P&L.

export type EquityPoint = { ts: number; equity: number };
export type EquityDayBaseline = { day: string; equity: number };

const EQUITY_SAMPLE_MS = 60_000;
const EQUITY_MAX_POINTS = 1_440; // one point/min → 24h window

export const equityHistory = persisted<Record<string, EquityPoint[]>>(
  "trader-ralph-phoenix-equity",
  {},
);

export const equityBaselines = persisted<Record<string, EquityDayBaseline>>(
  "trader-ralph-phoenix-equity-day",
  {},
);

/** UTC day bucket for the baseline roll, e.g. "2026-07-03". */
function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Append an equity sample (throttled to one per minute), roll the UTC-day
 *  baseline on the first sample of each day, and prune to the most recent
 *  wallets — same policy as the trader snapshots. */
export function recordEquitySample(authority: string, equity: number): void {
  if (!authority || !Number.isFinite(equity)) return;
  const now = Date.now();
  let sampled = false;
  let keptWallets: string[] = [];
  equityHistory.update((histories) => {
    const points = histories[authority] ?? [];
    const last = points[points.length - 1];
    if (last && now - last.ts < EQUITY_SAMPLE_MS) return histories;
    sampled = true;
    const next: Record<string, EquityPoint[]> = {
      ...histories,
      [authority]: [...points, { ts: now, equity }].slice(-EQUITY_MAX_POINTS),
    };
    const latest = (list: EquityPoint[]): number =>
      list[list.length - 1]?.ts ?? 0;
    const keys = Object.keys(next).sort(
      (a, b) => latest(next[b]) - latest(next[a]),
    );
    for (const key of keys.slice(MAX_WALLETS)) delete next[key];
    keptWallets = Object.keys(next);
    return next;
  });
  if (!sampled) return;
  equityBaselines.update((baselines) => {
    const day = utcDay(now);
    const next: Record<string, EquityDayBaseline> = {};
    for (const key of keptWallets) {
      if (baselines[key]) next[key] = baselines[key];
    }
    if (next[authority]?.day !== day) next[authority] = { day, equity };
    return next;
  });
}

/** Shift a wallet's day-P&L baseline when funds move in-app (deposit +,
 *  withdraw −) so transfers don't read as P&L. External transfers straight
 *  to the wallet are not offset — accepted. */
export function shiftEquityBaseline(authority: string, deltaUsd: number): void {
  if (!authority || !Number.isFinite(deltaUsd) || deltaUsd === 0) return;
  equityBaselines.update((baselines) => {
    const entry = baselines[authority];
    if (!entry) return baselines;
    return {
      ...baselines,
      [authority]: { ...entry, equity: entry.equity + deltaUsd },
    };
  });
}

/** Chart overlay-line visibility, persisted per device. */
export type ChartLinePrefs = {
  pos: boolean;
  tpsl: boolean;
  orders: boolean;
  alerts: boolean;
};

export const chartLinePrefs = persisted<ChartLinePrefs>(
  "trader-ralph-chart-lines",
  { pos: true, tpsl: true, orders: true, alerts: true },
);
