// PURE desk-context serializer for the side chat (PRD #563, WP2).
//
// Takes the live desk snapshot and produces the opaque context object POSTed
// to /api/chat. Caps keep the payload small and the grounding validator
// honest: every number passes through VERBATIM (no rounding), and when the
// total JSON length exceeds the cap we drop whole sections in a fixed order
// and flag the result as truncated. No I/O, no time, no randomness — fully
// deterministic; see chat-context.test.ts.

const MAX_JSON_LENGTH = 10_000;
const CAP_POSITIONS = 20;
const CAP_OPEN_ORDERS = 20;
const CAP_MONITOR_ROWS = 12;
const CAP_WATCHLIST = 30;
const CAP_HEADLINES = 8;

export type DeskSnapshotInput = {
  symbol: string;
  timeframe: string;
  accountMode: "live" | "paper";
  positions: unknown[];
  openOrders: unknown[];
  dayPnlUsd: number | null;
  equityUsd: number | null;
  monitorRows: unknown[];
  watchlist: string[];
  headlines: { title: string; source: string; ageMin: number }[];
  nowMs: number;
};

/** Serialize the desk snapshot for the endpoint. Caps (exact): positions 20,
 * openOrders 20, monitorRows 12, watchlist 30, headlines 8, total JSON
 * length 10_000 chars — when over, drop monitorRows→headlines→openOrders
 * (in that order) wholesale and set "truncated": true in the output object.
 * Numbers pass through VERBATIM (no rounding — the grounding validator
 * compares digit-for-digit). */
export function buildDeskContext(
  input: DeskSnapshotInput,
): Record<string, unknown> {
  const output: Record<string, unknown> = {
    symbol: input.symbol,
    timeframe: input.timeframe,
    accountMode: input.accountMode,
    positions: input.positions.slice(0, CAP_POSITIONS),
    openOrders: input.openOrders.slice(0, CAP_OPEN_ORDERS),
    dayPnlUsd: input.dayPnlUsd,
    equityUsd: input.equityUsd,
    monitorRows: input.monitorRows.slice(0, CAP_MONITOR_ROWS),
    watchlist: input.watchlist.slice(0, CAP_WATCHLIST),
    headlines: input.headlines.slice(0, CAP_HEADLINES),
    nowMs: input.nowMs,
    truncated: false,
  };

  if (measure(output) > MAX_JSON_LENGTH) {
    output.monitorRows = [];
    output.truncated = true;
    if (measure(output) > MAX_JSON_LENGTH) {
      output.headlines = [];
      if (measure(output) > MAX_JSON_LENGTH) {
        output.openOrders = [];
      }
    }
  }

  return output;
}

function measure(value: Record<string, unknown>): number {
  return JSON.stringify(value).length;
}
