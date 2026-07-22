// Validation for PnL share-card params. The numbers are painted, never
// computed — so the only job here is strict bounds checking.

export type PositionShare = {
  symbol: string;
  side: "long" | "short";
  pnl: number;
  prices: { entry: number; mark: number } | null;
  /** true when the shared result came from the simulated paper account —
   * every rendered surface must then label it as paper, never as a real
   * on-chain trade. */
  paper: boolean;
};

export function parsePositionParams(
  searchParams: URLSearchParams,
): PositionShare | null {
  const symbol = (searchParams.get("symbol") ?? "").toUpperCase();
  const side = (searchParams.get("side") ?? "").toLowerCase();
  const pnl = Number(searchParams.get("pnl"));
  const entry = Number(searchParams.get("entry"));
  const mark = Number(searchParams.get("mark"));
  if (!/^[A-Z0-9]{1,12}$/.test(symbol)) return null;
  if (side !== "long" && side !== "short") return null;
  if (!Number.isFinite(pnl) || Math.abs(pnl) > 10_000_000) return null;
  const prices =
    Number.isFinite(entry) && Number.isFinite(mark) && entry > 0 && mark > 0
      ? { entry, mark }
      : null;
  return {
    symbol,
    side,
    pnl,
    prices,
    paper: searchParams.get("mode") === "paper",
  };
}
