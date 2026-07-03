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
