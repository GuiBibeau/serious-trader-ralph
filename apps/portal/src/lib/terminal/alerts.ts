// Pure alert-matching layer. matchAlerts runs on every price tick, so the
// no-hit path is allocation-free — it returns null rather than a fresh
// empty array. Mutation + fireAlert side effects stay in the page.

export type Alert = {
  id: string;
  symbol: string;
  op: "above" | "below";
  price: number;
  tier: "FLASH" | "PRIORITY" | "ROUTINE";
  triggered: boolean;
};

/**
 * Untriggered alerts for `symbol` whose threshold the price has crossed —
 * `above` fires at price >= threshold, `below` at price <= threshold.
 * Returns null when nothing fired (reference-stable for the hot path).
 */
export function matchAlerts(
  alerts: Alert[],
  price: number,
  symbol: string,
): Alert[] | null {
  let hits: Alert[] | null = null;
  for (const alert of alerts) {
    if (alert.triggered || alert.symbol !== symbol) continue;
    const hit =
      alert.op === "above" ? price >= alert.price : price <= alert.price;
    if (hit) {
      if (!hits) hits = [];
      hits.push(alert);
    }
  }
  return hits;
}

export function headlineMatches(title: string, symbol: string): boolean {
  return title.toUpperCase().includes(symbol.toUpperCase());
}
