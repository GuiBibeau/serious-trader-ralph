import { describe, expect, test } from "bun:test";
import { buildOrderbookLadder } from "../../apps/portal/app/terminal/components/orderbook-ladder";

describe("portal terminal orderbook ladder", () => {
  test("builds grouped rows with spread and top-of-book markers", () => {
    const model = buildOrderbookLadder({
      asks: [
        { price: 100.03, size: 10 },
        { price: 100.08, size: 8 },
        { price: 100.12, size: 4 },
      ],
      bids: [
        { price: 99.98, size: 12 },
        { price: 99.94, size: 6 },
        { price: 99.89, size: 3 },
      ],
      groupingBps: 5,
      maxRows: 5,
    });

    expect(model.asks.length).toBeGreaterThan(0);
    expect(model.bids.length).toBeGreaterThan(0);
    expect(model.bestAsk?.isTopOfBook).toBe(true);
    expect(model.bestBid?.isTopOfBook).toBe(true);
    expect(model.spreadAbs).not.toBeNull();
    expect(model.spreadBps).not.toBeNull();
  });

  test("caps rows by maxRows and keeps cumulative size monotonic", () => {
    const model = buildOrderbookLadder({
      asks: [
        { price: 10.01, size: 1 },
        { price: 10.02, size: 2 },
        { price: 10.03, size: 3 },
      ],
      bids: [
        { price: 9.99, size: 1 },
        { price: 9.98, size: 2 },
        { price: 9.97, size: 3 },
      ],
      groupingBps: 1,
      maxRows: 2,
    });

    expect(model.asks).toHaveLength(2);
    expect(model.bids).toHaveLength(2);
    expect(model.asks[1]?.cumulativeSize ?? 0).toBeGreaterThanOrEqual(
      model.asks[0]?.cumulativeSize ?? 0,
    );
    expect(model.bids[1]?.cumulativeSize ?? 0).toBeGreaterThanOrEqual(
      model.bids[0]?.cumulativeSize ?? 0,
    );
  });
});
