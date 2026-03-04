import { describe, expect, test } from "bun:test";
import {
  countMissingTradeTicks,
  filterTradeTicks,
} from "../../apps/portal/app/terminal/components/trades-tape";

describe("portal terminal trades tape helpers", () => {
  test("filters by side and size with compact row cap", () => {
    const trades = Array.from({ length: 40 }).map((_, index) => ({
      seq: 100 - index,
      ts: 1_000 + index,
      side: index % 2 === 0 ? ("buy" as const) : ("sell" as const),
      price: 100 + index / 10,
      size: index + 1,
    }));

    const filtered = filterTradeTicks({
      trades,
      side: "buy",
      minSize: 10,
      mode: "compact",
    });

    expect(filtered.length).toBeLessThanOrEqual(28);
    expect(filtered.every((trade) => trade.side === "buy")).toBe(true);
    expect(filtered.every((trade) => trade.size >= 10)).toBe(true);
  });

  test("counts missed ticks from sequence gaps", () => {
    const missed = countMissingTradeTicks([
      { seq: 15, ts: 1, side: "buy", price: 100, size: 1 },
      { seq: 14, ts: 2, side: "buy", price: 101, size: 1 },
      { seq: 10, ts: 3, side: "sell", price: 99, size: 1 },
      { seq: 8, ts: 4, side: "sell", price: 98, size: 1 },
    ]);
    expect(missed).toBe(4);
  });
});
