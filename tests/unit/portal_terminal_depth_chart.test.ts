import { describe, expect, test } from "bun:test";
import {
  buildDepthChartModel,
  findNearestDepthPoint,
} from "../../apps/portal/app/terminal/components/depth-chart";

describe("portal terminal depth chart helpers", () => {
  test("builds spread and imbalance from ladder rows", () => {
    const model = buildDepthChartModel({
      sequence: 42,
      bids: [
        {
          side: "bid",
          price: 100,
          size: 10,
          cumulativeSize: 10,
          isTopOfBook: true,
        },
        {
          side: "bid",
          price: 99.9,
          size: 8,
          cumulativeSize: 18,
          isTopOfBook: false,
        },
      ],
      asks: [
        {
          side: "ask",
          price: 100.1,
          size: 9,
          cumulativeSize: 9,
          isTopOfBook: true,
        },
        {
          side: "ask",
          price: 100.2,
          size: 7,
          cumulativeSize: 16,
          isTopOfBook: false,
        },
      ],
    });

    expect(model.sequence).toBe(42);
    expect(model.spreadAbs).toBeCloseTo(0.1, 6);
    expect(model.totalBidSize).toBe(18);
    expect(model.totalAskSize).toBe(16);
    expect(model.imbalance).toBeCloseTo((18 - 16) / 34, 6);
  });

  test("finds nearest point for crosshair hover", () => {
    const nearest = findNearestDepthPoint(
      [
        { price: 99.8, cumulativeSize: 5 },
        { price: 100.0, cumulativeSize: 8 },
        { price: 100.4, cumulativeSize: 12 },
      ],
      100.1,
    );
    expect(nearest?.price).toBe(100.0);
    expect(nearest?.cumulativeSize).toBe(8);
  });
});
