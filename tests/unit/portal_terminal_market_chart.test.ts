import { describe, expect, test } from "bun:test";
import {
  computeIndexOverlayPrice,
  selectMarketPointsForTimeframe,
} from "../../apps/portal/app/terminal/components/market-chart";

describe("portal terminal market chart helpers", () => {
  test("selects timeframe window with safe fallback", () => {
    const now = Date.now();
    const points = Array.from({ length: 12 }).map((_, index) => ({
      ts: now - (11 - index) * 60 * 60 * 1000,
      price: 100 + index,
      kind: "ohlcv" as const,
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100 + index,
      volume: 10 + index,
    }));

    const oneHour = selectMarketPointsForTimeframe(points, "1H");
    const sevenDay = selectMarketPointsForTimeframe(points, "7D");

    expect(oneHour.length).toBeGreaterThanOrEqual(2);
    expect(oneHour.length).toBeLessThan(points.length);
    expect(sevenDay.length).toBe(points.length);
  });

  test("computes index overlay from tail average", () => {
    const points = Array.from({ length: 4 }).map((_, index) => ({
      ts: index,
      price: 100 + index * 10,
      kind: "ohlcv" as const,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
    }));
    const index = computeIndexOverlayPrice(points);
    expect(index).toBe(115);
  });
});
