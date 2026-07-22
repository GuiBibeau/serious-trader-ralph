import { describe, expect, test } from "bun:test";
import { buildDeskContext, type DeskSnapshotInput } from "./chat-context";

function baseInput(
  overrides: Partial<DeskSnapshotInput> = {},
): DeskSnapshotInput {
  return {
    symbol: "SOL",
    timeframe: "1h",
    accountMode: "live",
    positions: [],
    openOrders: [],
    dayPnlUsd: null,
    equityUsd: null,
    monitorRows: [],
    watchlist: [],
    headlines: [],
    nowMs: 1_752_936_120_000,
    ...overrides,
  };
}

describe("buildDeskContext", () => {
  test("empty snapshot serializes to a stable, exact JSON shape", () => {
    const output = buildDeskContext(baseInput());

    expect(output).toEqual({
      symbol: "SOL",
      timeframe: "1h",
      accountMode: "live",
      positions: [],
      openOrders: [],
      dayPnlUsd: null,
      equityUsd: null,
      monitorRows: [],
      watchlist: [],
      headlines: [],
      nowMs: 1_752_936_120_000,
      truncated: false,
    });
    expect(JSON.stringify(output)).toBe(
      '{"symbol":"SOL","timeframe":"1h","accountMode":"live","positions":[],"openOrders":[],"dayPnlUsd":null,"equityUsd":null,"monitorRows":[],"watchlist":[],"headlines":[],"nowMs":1752936120000,"truncated":false}',
    );
  });

  test("stays truncated:false with a small populated snapshot", () => {
    const output = buildDeskContext(
      baseInput({ positions: [{ id: 1 }], dayPnlUsd: 12.5 }),
    );
    expect(output.truncated).toBe(false);
  });

  test("serializes paper mode as an explicit desk fact", () => {
    expect(
      buildDeskContext(baseInput({ accountMode: "paper" })).accountMode,
    ).toBe("paper");
  });
});

describe("buildDeskContext per-field caps", () => {
  test("drops the 21st position, keeps the first 20 (capping is not truncation)", () => {
    const positions = Array.from({ length: 21 }, (_, index) => ({ id: index }));
    const output = buildDeskContext(baseInput({ positions }));

    expect(output.positions).toEqual(
      Array.from({ length: 20 }, (_, index) => ({ id: index })),
    );
    expect(output.truncated).toBe(false);
  });

  test("drops the 13th monitor row, keeps the first 12", () => {
    const monitorRows = Array.from({ length: 13 }, (_, index) => ({
      id: index,
    }));
    const output = buildDeskContext(baseInput({ monitorRows }));

    expect(output.monitorRows).toEqual(
      Array.from({ length: 12 }, (_, index) => ({ id: index })),
    );
    expect(output.truncated).toBe(false);
  });

  test("caps openOrders at 20", () => {
    const openOrders = Array.from({ length: 25 }, (_, index) => ({
      id: index,
    }));
    const output = buildDeskContext(baseInput({ openOrders }));

    expect(output.openOrders).toHaveLength(20);
  });

  test("caps watchlist at 30, keeping the earliest entries", () => {
    const watchlist = Array.from({ length: 40 }, (_, index) => `T${index}`);
    const output = buildDeskContext(baseInput({ watchlist }));

    expect(output.watchlist).toEqual(
      Array.from({ length: 30 }, (_, index) => `T${index}`),
    );
  });

  test("caps headlines at 8", () => {
    const headlines = Array.from({ length: 9 }, (_, index) => ({
      title: `h${index}`,
      source: "src",
      ageMin: index,
    }));
    const output = buildDeskContext(baseInput({ headlines }));

    expect(output.headlines).toHaveLength(8);
  });
});

describe("buildDeskContext verbatim numbers", () => {
  test("top-level PnL/equity keep full precision (no rounding)", () => {
    const output = buildDeskContext(
      baseInput({ dayPnlUsd: 4123.4567, equityUsd: 98765.4321 }),
    );

    expect(JSON.stringify(output)).toContain('"dayPnlUsd":4123.4567');
    expect(JSON.stringify(output)).toContain('"equityUsd":98765.4321');
  });

  test("numbers nested inside rows survive digit-for-digit", () => {
    const output = buildDeskContext(
      baseInput({
        positions: [{ mark: 4123.4567 }],
        monitorRows: [{ funding: -0.000125 }],
      }),
    );

    expect(JSON.stringify(output)).toContain('"mark":4123.4567');
    expect(JSON.stringify(output)).toContain('"funding":-0.000125');
  });

  test("null PnL/equity serialize as null, not zero or omitted", () => {
    const output = buildDeskContext(
      baseInput({ dayPnlUsd: null, equityUsd: null }),
    );

    expect(JSON.stringify(output)).toContain('"dayPnlUsd":null');
    expect(JSON.stringify(output)).toContain('"equityUsd":null');
  });
});

describe("buildDeskContext total-length pressure", () => {
  // A single fat row (~11k chars) is well under each per-field cap, so any
  // emptying is caused by total-length pressure, not capping.
  const fat = { blob: "x".repeat(11_000) };

  test("drops monitorRows first, flags truncated, leaves the rest", () => {
    const output = buildDeskContext(
      baseInput({
        monitorRows: [fat],
        headlines: [{ title: "h", source: "s", ageMin: 1 }],
        openOrders: [{ id: 1 }],
      }),
    );

    expect(output.monitorRows).toEqual([]);
    expect(output.headlines).toEqual([{ title: "h", source: "s", ageMin: 1 }]);
    expect(output.openOrders).toEqual([{ id: 1 }]);
    expect(output.truncated).toBe(true);
  });

  test("also drops headlines when monitorRows alone is not enough", () => {
    const output = buildDeskContext(
      baseInput({
        monitorRows: [fat],
        headlines: [{ title: "y".repeat(11_000), source: "s", ageMin: 1 }],
        openOrders: [{ id: 1 }],
      }),
    );

    expect(output.monitorRows).toEqual([]);
    expect(output.headlines).toEqual([]);
    expect(output.openOrders).toEqual([{ id: 1 }]);
    expect(output.truncated).toBe(true);
  });

  test("drops through openOrders when monitorRows + headlines are both fat", () => {
    const output = buildDeskContext(
      baseInput({
        monitorRows: [fat],
        headlines: [{ title: "y".repeat(11_000), source: "s", ageMin: 1 }],
        openOrders: [{ note: "z".repeat(11_000) }],
        positions: [{ id: 7 }],
        watchlist: ["KEEP"],
      }),
    );

    expect(output.monitorRows).toEqual([]);
    expect(output.headlines).toEqual([]);
    expect(output.openOrders).toEqual([]);
    // Drop order stops at openOrders — positions/watchlist always survive.
    expect(output.positions).toEqual([{ id: 7 }]);
    expect(output.watchlist).toEqual(["KEEP"]);
    expect(output.truncated).toBe(true);
  });
});
