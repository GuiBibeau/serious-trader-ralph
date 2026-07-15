import { describe, expect, test } from "bun:test";
import {
  type AssetInput,
  alertDedupMarks,
  buildMoveEmbeds,
  chunkEmbeds,
  computeAlerts,
  DOWN_COLOR,
  fastBaseline,
  formatUsd,
  MAX_EMBEDS_PER_MESSAGE,
  type MarketState,
  type MoveAlert,
  parseMarketState,
  pruneDedupMarks,
  SNAPSHOT_RETENTION_MS,
  signedPct,
  UP_COLOR,
  utcDay,
} from "./market-moves";

// 2026-07-14T12:00:00.000Z
const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function asset(overrides: Partial<AssetInput> = {}): AssetInput {
  return {
    assetId: "solana",
    symbol: "SOL",
    price: 100,
    change24hPct: 0,
    ...overrides,
  };
}

function emptyState(): MarketState {
  return { snapshots: {}, posted: {} };
}

describe("utcDay", () => {
  test("formats the UTC calendar day", () => {
    expect(utcDay(NOW)).toBe("2026-07-14");
    // One ms before midnight UTC is still the previous day.
    expect(utcDay(Date.UTC(2026, 6, 14, 23, 59, 59, 999))).toBe("2026-07-14");
    expect(utcDay(Date.UTC(2026, 6, 15, 0, 0, 0))).toBe("2026-07-15");
  });
});

describe("parseMarketState", () => {
  test("returns fresh state for garbage", () => {
    expect(parseMarketState(null)).toEqual(emptyState());
    expect(parseMarketState("nope")).toEqual(emptyState());
    expect(parseMarketState([1, 2])).toEqual({ snapshots: {}, posted: {} });
    expect(parseMarketState({ snapshots: 7, posted: "x" })).toEqual(
      emptyState(),
    );
  });

  test("keeps valid points and drops malformed ones", () => {
    const parsed = parseMarketState({
      snapshots: {
        solana: [
          { t: NOW - HOUR, price: 100 },
          { t: "bad", price: 100 },
          { t: NOW, price: Number.NaN },
          { t: NOW, price: 0 },
          { t: NOW, price: -3 },
          "junk",
        ],
        bitcoin: "junk",
      },
      posted: { "solana:big": "2026-07-14", "bad:key": 42 },
    });
    expect(parsed.snapshots).toEqual({
      solana: [{ t: NOW - HOUR, price: 100 }],
    });
    expect(parsed.posted).toEqual({ "solana:big": "2026-07-14" });
  });
});

describe("fastBaseline", () => {
  test("picks the snapshot closest to 1h old", () => {
    const points = [
      { t: NOW - 50 * MIN, price: 1 },
      { t: NOW - 58 * MIN, price: 2 },
      { t: NOW - 70 * MIN, price: 3 },
    ];
    expect(fastBaseline(points, NOW)).toEqual({ t: NOW - 58 * MIN, price: 2 });
  });

  test("ignores snapshots younger than 45min or older than 75min", () => {
    expect(fastBaseline([{ t: NOW - 44 * MIN, price: 1 }], NOW)).toBeNull();
    expect(fastBaseline([{ t: NOW - 76 * MIN, price: 1 }], NOW)).toBeNull();
    expect(fastBaseline([], NOW)).toBeNull();
    // Boundary values are honest enough to use.
    expect(fastBaseline([{ t: NOW - 45 * MIN, price: 1 }], NOW)).not.toBeNull();
    expect(fastBaseline([{ t: NOW - 75 * MIN, price: 1 }], NOW)).not.toBeNull();
  });
});

describe("computeAlerts — fast tier", () => {
  function stateWithBaseline(price: number): MarketState {
    return {
      snapshots: { solana: [{ t: NOW - HOUR, price }] },
      posted: {},
    };
  }

  test("fires at >= 3% up and down for majors", () => {
    const up = computeAlerts(
      [asset({ price: 103 })],
      stateWithBaseline(100),
      NOW,
    );
    expect(up.alerts).toEqual([
      {
        assetId: "solana",
        symbol: "SOL",
        tier: "fast",
        price: 103,
        movePct: 3,
      },
    ]);

    const down = computeAlerts(
      [asset({ price: 97 })],
      stateWithBaseline(100),
      NOW,
    );
    expect(down.alerts[0]?.tier).toBe("fast");
    expect(down.alerts[0]?.movePct).toBe(-3);
  });

  test("does not fire below 3%", () => {
    const { alerts } = computeAlerts(
      [asset({ price: 102.9 })],
      stateWithBaseline(100),
      NOW,
    );
    expect(alerts).toEqual([]);
  });

  test("not evaluable without a snapshot in the honest window", () => {
    const young: MarketState = {
      snapshots: { solana: [{ t: NOW - 30 * MIN, price: 100 }] },
      posted: {},
    };
    expect(computeAlerts([asset({ price: 110 })], young, NOW).alerts).toEqual(
      [],
    );
    expect(
      computeAlerts([asset({ price: 110 })], emptyState(), NOW).alerts,
    ).toEqual([]);
  });

  test("never evaluated for non-majors", () => {
    const state: MarketState = {
      snapshots: { bonk: [{ t: NOW - HOUR, price: 100 }] },
      posted: {},
    };
    const { alerts } = computeAlerts(
      [asset({ assetId: "bonk", symbol: "BONK", price: 110 })],
      state,
      NOW,
    );
    expect(alerts).toEqual([]);
  });

  test("dedups within the same UTC day and re-arms the next day", () => {
    const first = computeAlerts(
      [asset({ price: 104 })],
      stateWithBaseline(100),
      NOW,
    );
    expect(first.alerts).toHaveLength(1);

    // Same day, still moved: no repost.
    const again = computeAlerts(
      [asset({ price: 105 })],
      {
        snapshots: { solana: [{ t: NOW - HOUR, price: 100 }] },
        posted: first.next.posted,
      },
      NOW + 5 * MIN,
    );
    expect(again.alerts).toEqual([]);

    // Next UTC day: mark pruned, fires again.
    const nextDay = NOW + 24 * HOUR;
    const rearmed = computeAlerts(
      [asset({ price: 104 })],
      {
        snapshots: { solana: [{ t: nextDay - HOUR, price: 100 }] },
        posted: first.next.posted,
      },
      nextDay,
    );
    expect(rearmed.alerts).toHaveLength(1);
    expect(rearmed.next.posted["solana:fast"]).toBe("2026-07-15");
  });
});

describe("computeAlerts — session and big tiers", () => {
  test("session fires for majors at |24h| >= 5%", () => {
    const up = computeAlerts([asset({ change24hPct: 5 })], emptyState(), NOW);
    expect(up.alerts[0]).toMatchObject({ tier: "session", movePct: 5 });
    const down = computeAlerts(
      [asset({ change24hPct: -5.5 })],
      emptyState(),
      NOW,
    );
    expect(down.alerts[0]).toMatchObject({ tier: "session", movePct: -5.5 });
    const flat = computeAlerts(
      [asset({ change24hPct: 4.99 })],
      emptyState(),
      NOW,
    );
    expect(flat.alerts).toEqual([]);
  });

  test("session never fires for non-majors", () => {
    const { alerts } = computeAlerts(
      [asset({ assetId: "bonk", symbol: "BONK", change24hPct: 7 })],
      emptyState(),
      NOW,
    );
    expect(alerts).toEqual([]);
  });

  test("big fires for any catalog asset at |24h| >= 10%", () => {
    const { alerts } = computeAlerts(
      [
        asset({ assetId: "bonk", symbol: "BONK", change24hPct: 10 }),
        asset({ assetId: "wif", symbol: "WIF", change24hPct: -12 }),
        asset({ assetId: "jup", symbol: "JUP", change24hPct: 9.9 }),
      ],
      emptyState(),
      NOW,
    );
    expect(alerts.map((alert) => [alert.assetId, alert.tier])).toEqual([
      ["bonk", "big"],
      ["wif", "big"],
    ]);
  });

  test("big supersedes session: one big alert, session slot consumed", () => {
    const first = computeAlerts(
      [asset({ change24hPct: 12 })],
      emptyState(),
      NOW,
    );
    expect(first.alerts).toEqual([
      {
        assetId: "solana",
        symbol: "SOL",
        tier: "big",
        price: 100,
        movePct: 12,
      },
    ]);
    expect(first.next.posted["solana:session"]).toBe("2026-07-14");

    // Later the same day the move cools to session range: stays quiet.
    const later = computeAlerts(
      [asset({ change24hPct: 6 })],
      { snapshots: {}, posted: first.next.posted },
      NOW + HOUR,
    );
    expect(later.alerts).toEqual([]);
  });

  test("big still fires after a session post the same day (escalation)", () => {
    const session = computeAlerts(
      [asset({ change24hPct: 6 })],
      emptyState(),
      NOW,
    );
    expect(session.alerts[0]?.tier).toBe("session");

    const escalated = computeAlerts(
      [asset({ change24hPct: 11 })],
      { snapshots: {}, posted: session.next.posted },
      NOW + HOUR,
    );
    expect(escalated.alerts).toEqual([
      {
        assetId: "solana",
        symbol: "SOL",
        tier: "big",
        price: 100,
        movePct: 11,
      },
    ]);
  });

  test("null price or null change24hPct: honest skip, no alert", () => {
    expect(
      computeAlerts(
        [asset({ price: null, change24hPct: 20 })],
        emptyState(),
        NOW,
      ).alerts,
    ).toEqual([]);
    expect(
      computeAlerts([asset({ change24hPct: null })], emptyState(), NOW).alerts,
    ).toEqual([]);
  });
});

describe("computeAlerts — snapshots", () => {
  test("appends this run's price for majors only", () => {
    const { next } = computeAlerts(
      [
        asset({ price: 100 }),
        asset({ assetId: "bitcoin", symbol: "BTC", price: 50_000 }),
        asset({ assetId: "bonk", symbol: "BONK", price: 0.00001 }),
      ],
      emptyState(),
      NOW,
    );
    expect(next.snapshots).toEqual({
      solana: [{ t: NOW, price: 100 }],
      bitcoin: [{ t: NOW, price: 50_000 }],
    });
  });

  test("prunes history beyond retention and keeps the rest", () => {
    const state: MarketState = {
      snapshots: {
        solana: [
          { t: NOW - SNAPSHOT_RETENTION_MS - 1, price: 90 },
          { t: NOW - HOUR, price: 100 },
          { t: NOW + HOUR, price: 999 }, // future-dated garbage
        ],
      },
      posted: {},
    };
    const { next } = computeAlerts([asset({ price: 100 })], state, NOW);
    expect(next.snapshots.solana).toEqual([
      { t: NOW - HOUR, price: 100 },
      { t: NOW, price: 100 },
    ]);
  });

  test("null price: no snapshot appended, history preserved", () => {
    const state: MarketState = {
      snapshots: { solana: [{ t: NOW - HOUR, price: 100 }] },
      posted: {},
    };
    const { next } = computeAlerts([asset({ price: null })], state, NOW);
    expect(next.snapshots.solana).toEqual([{ t: NOW - HOUR, price: 100 }]);
  });

  test("does not mutate the previous state", () => {
    const state: MarketState = {
      snapshots: { solana: [{ t: NOW - HOUR, price: 100 }] },
      posted: { "solana:big": "2026-07-13" },
    };
    computeAlerts([asset({ price: 104, change24hPct: 12 })], state, NOW);
    expect(state.snapshots.solana).toHaveLength(1);
    expect(state.posted).toEqual({ "solana:big": "2026-07-13" });
  });
});

describe("formatting", () => {
  test("signedPct", () => {
    expect(signedPct(3)).toBe("+3.00%");
    expect(signedPct(-12.345)).toBe("-12.35%");
    expect(signedPct(0)).toBe("+0.00%");
  });

  test("formatUsd", () => {
    expect(formatUsd(50_000)).toBe("$50,000.00");
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(163.4567)).toBe("$163.46");
    expect(formatUsd(0.5)).toBe("$0.5000");
    expect(formatUsd(0.00001234)).toBe("$0.00001234");
    // Below 1e-6 toPrecision goes exponent — expanded back to 4 sig digits.
    expect(formatUsd(0.000000123456)).toBe("$0.0000001235");
  });
});

describe("buildMoveEmbeds", () => {
  const alert: MoveAlert = {
    assetId: "solana",
    symbol: "SOL",
    tier: "fast",
    price: 163.4567,
    movePct: 3.21,
  };

  test("renders symbol, price, signed pct, tier label, and ISO timestamp", () => {
    const [embed] = buildMoveEmbeds([alert], NOW);
    expect(embed).toEqual({
      title: "SOL +3.21% — 1h move",
      description: "Last price $163.46 · +3.21% over the last hour",
      color: UP_COLOR,
      timestamp: "2026-07-14T12:00:00.000Z",
    });
  });

  test("uses the down color for negative moves and the 24h wording", () => {
    const [embed] = buildMoveEmbeds(
      [{ ...alert, tier: "big", movePct: -11.5 }],
      NOW,
    );
    expect(embed.color).toBe(DOWN_COLOR);
    expect(embed.title).toBe("SOL -11.50% — big 24h move");
    expect(embed.description).toContain("over the last 24 hours");
  });

  test("builds one embed per alert — no silent truncation", () => {
    const alerts = Array.from({ length: 14 }, (_, i) => ({
      ...alert,
      assetId: `asset-${i}`,
    }));
    expect(buildMoveEmbeds(alerts, NOW)).toHaveLength(14);
  });
});

describe("chunkEmbeds", () => {
  test("splits into groups of at most size, remainder last", () => {
    const items = Array.from({ length: 14 }, (_, i) => i);
    const chunks = chunkEmbeds(items, MAX_EMBEDS_PER_MESSAGE);
    expect(chunks.map((group) => group.length)).toEqual([10, 4]);
    expect(chunks.flat()).toEqual(items);
  });

  test("exact multiple → no empty trailing chunk", () => {
    expect(chunkEmbeds([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("empty input → no chunks", () => {
    expect(chunkEmbeds([], MAX_EMBEDS_PER_MESSAGE)).toEqual([]);
  });

  test("fewer items than size → single chunk", () => {
    expect(chunkEmbeds([1], MAX_EMBEDS_PER_MESSAGE)).toEqual([[1]]);
  });
});

describe("dedup mark helpers", () => {
  const alert = (assetId: string, tier: MoveAlert["tier"]): MoveAlert => ({
    assetId,
    symbol: assetId.toUpperCase(),
    tier,
    price: 100,
    movePct: 12,
  });

  test("pruneDedupMarks keeps only today's marks", () => {
    expect(
      pruneDedupMarks(
        { "solana:big": "2026-07-14", "bitcoin:fast": "2026-07-13" },
        "2026-07-14",
      ),
    ).toEqual({ "solana:big": "2026-07-14" });
  });

  test("alertDedupMarks marks each alert's own slot", () => {
    expect(
      alertDedupMarks(
        [alert("solana", "fast"), alert("bitcoin", "session")],
        "2026-07-14",
      ),
    ).toEqual({
      "solana:fast": "2026-07-14",
      "bitcoin:session": "2026-07-14",
    });
  });

  test("a big alert consumes the same-day session slot too", () => {
    expect(alertDedupMarks([alert("bonk", "big")], "2026-07-14")).toEqual({
      "bonk:big": "2026-07-14",
      "bonk:session": "2026-07-14",
    });
  });

  test("marks applied chunk-by-chunk converge to computeAlerts' next state", () => {
    // The endpoint persists pruned carryover + per-chunk marks; the union
    // over all chunks must equal what computeAlerts computed in one shot.
    const prev: MarketState = {
      snapshots: {},
      posted: { "solana:session": "2026-07-14", "old:big": "2026-07-13" },
    };
    const { alerts, next } = computeAlerts(
      [
        asset({ change24hPct: 12 }), // solana big (session already consumed)
        asset({ assetId: "bonk", symbol: "BONK", change24hPct: -15 }),
      ],
      prev,
      NOW,
    );
    let marks = pruneDedupMarks(prev.posted, utcDay(NOW));
    for (const group of chunkEmbeds(alerts, 1)) {
      marks = { ...marks, ...alertDedupMarks(group, utcDay(NOW)) };
    }
    expect(marks).toEqual(next.posted);
  });
});
