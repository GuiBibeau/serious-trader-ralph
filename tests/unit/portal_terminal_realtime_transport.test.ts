import { describe, expect, test } from "bun:test";
import {
  appendTradeTick,
  buildDepthSnapshotFromPrice,
  hasSequenceGap,
  parseTerminalStreamFrame,
} from "../../apps/portal/app/terminal/components/realtime-transport";

describe("portal terminal realtime transport helpers", () => {
  test("detects sequence gaps", () => {
    expect(hasSequenceGap(null, 1)).toBe(false);
    expect(hasSequenceGap(10, 11)).toBe(false);
    expect(hasSequenceGap(10, 13)).toBe(true);
  });

  test("caps trade tape rows", () => {
    const next = appendTradeTick(
      [
        { seq: 2, ts: 2, side: "buy", price: 101, size: 2 },
        { seq: 1, ts: 1, side: "sell", price: 100, size: 1 },
      ],
      { seq: 3, ts: 3, side: "buy", price: 102, size: 3 },
      2,
    );
    expect(next).toHaveLength(2);
    expect(next[0]?.seq).toBe(3);
    expect(next[1]?.seq).toBe(2);
  });

  test("builds deterministic depth from price", () => {
    const depth = buildDepthSnapshotFromPrice(100, 42, 1_000);
    expect(depth.seq).toBe(42);
    expect(depth.asks).toHaveLength(5);
    expect(depth.bids).toHaveLength(5);
    expect(depth.asks[0]?.price).toBeGreaterThan(100);
    expect(depth.bids[0]?.price).toBeLessThan(100);
  });

  test("parses valid stream frames only", () => {
    expect(parseTerminalStreamFrame({ seq: 7, ts: 11, price: 140.25 })).toEqual(
      {
        seq: 7,
        ts: 11,
        price: 140.25,
      },
    );
    expect(
      parseTerminalStreamFrame({ seq: "bad", ts: 1, price: 1 }),
    ).toBeNull();
    expect(parseTerminalStreamFrame({ seq: 1, ts: 1, price: 0 })).toBeNull();
  });
});
