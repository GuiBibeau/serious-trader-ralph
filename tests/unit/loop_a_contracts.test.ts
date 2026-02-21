import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  LOOP_A_SCHEMA_REGISTRY,
  parseHealth,
  parseMark,
  parseProtocolEvent,
  parseStateSnapshot,
  safeParseHealth,
  safeParseMark,
  safeParseProtocolEvent,
  safeParseStateSnapshot,
} from "../../src/loops/contracts/loop_a.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const POOL = "Czfq3xZZD7f7mUXGQ95M5x7TQYtjY1fM6bMpiKFF9s8s";
const SIG =
  "4QWQY8hJCF3zz7X9Y7NfKGh6y3ysK4Wi2fFx9kqvF5mkmowMrAkxAuE4L73p5udjXKSzkYsbk1XnX4QgxQeM4QVD";

const META = {
  schemaVersion: "v1" as const,
  generatedAt: "2026-02-21T00:00:00Z",
};

describe("loop A contracts", () => {
  test("parses valid swap protocol event", () => {
    const event = parseProtocolEvent({
      ...META,
      kind: "swap",
      protocol: "jupiter",
      slot: 123,
      sig: SIG,
      ts: "2026-02-21T00:00:01Z",
      inMint: SOL_MINT,
      outMint: USDC_MINT,
      inAmount: "1.25",
      outAmount: "240.5",
      venue: "jupiter",
    });

    expect(event.kind).toBe("swap");
    expect(event.inMint).toBe(SOL_MINT);
  });

  test("enforces kind-specific swap fields", () => {
    expect(() =>
      parseProtocolEvent({
        ...META,
        kind: "swap",
        protocol: "jupiter",
        slot: 124,
        sig: SIG,
        ts: "2026-02-21T00:00:02Z",
        outMint: USDC_MINT,
        inAmount: "1",
        outAmount: "200",
      }),
    ).toThrow();
  });

  test("rejects protocol event when metadata is missing", () => {
    const result = safeParseProtocolEvent({
      kind: "unknown",
      protocol: "test",
      slot: 1,
      sig: SIG,
      ts: "2026-02-21T00:00:03Z",
    });
    expect(result.success).toBe(false);
  });

  test("parses valid mark payload", () => {
    const mark = parseMark({
      ...META,
      slot: 200,
      ts: "2026-02-21T00:01:00Z",
      baseMint: SOL_MINT,
      quoteMint: USDC_MINT,
      px: "192.44",
      confidence: 0.78,
      venue: "orca",
      version: "v1",
      evidence: {
        sigs: [SIG],
        pools: [POOL],
      },
    });

    expect(mark.confidence).toBe(0.78);
  });

  test("rejects mark when confidence is out of range", () => {
    const result = safeParseMark({
      ...META,
      slot: 201,
      ts: "2026-02-21T00:02:00Z",
      baseMint: SOL_MINT,
      quoteMint: USDC_MINT,
      px: "192.44",
      confidence: 1.01,
      venue: "orca",
      version: "v1",
    });

    expect(result.success).toBe(false);
  });

  test("rejects mark with invalid generatedAt", () => {
    expect(() =>
      parseMark({
        ...META,
        generatedAt: "not-a-date",
        slot: 202,
        ts: "2026-02-21T00:03:00Z",
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        px: "192.44",
        confidence: 0.6,
        venue: "orca",
        version: "v1",
      }),
    ).toThrow();
  });

  test("rejects state snapshot when generatedAt is missing", () => {
    const result = safeParseStateSnapshot({
      schemaVersion: "v1",
      slot: 220,
      commitment: "confirmed",
      cursor: {
        processed: 222,
        confirmed: 220,
        finalized: 218,
      },
      stateHash: "state_abc123",
      trackedState: {
        [POOL]: {
          liquidityUsd: "1240000",
        },
      },
      appliedEventCount: 42,
      inputs: {
        eventRefs: [
          "loopA/v1/events/date=2026-02-21/hour=00/slot=220.jsonl.gz",
        ],
      },
      version: "v1",
    });
    expect(result.success).toBe(false);
  });

  test("parses valid state snapshot", () => {
    const snapshot = parseStateSnapshot({
      ...META,
      slot: 220,
      commitment: "confirmed",
      cursor: {
        processed: 222,
        confirmed: 220,
        finalized: 218,
      },
      stateHash: "state_abc123",
      trackedState: {
        [POOL]: {
          liquidityUsd: "1240000",
        },
      },
      appliedEventCount: 42,
      inputs: {
        eventRefs: [
          "loopA/v1/events/date=2026-02-21/hour=00/slot=220.jsonl.gz",
        ],
      },
      version: "v1",
    });

    expect(snapshot.cursor.confirmed).toBe(220);
  });

  test("rejects health payload when schemaVersion is missing", () => {
    const result = safeParseHealth({
      generatedAt: "2026-02-21T00:04:00Z",
      component: "loopA",
      status: "ok",
      updatedAt: "2026-02-21T00:04:00Z",
      cursors: {
        processed: 300,
        confirmed: 298,
        finalized: 296,
      },
      lagSlots: {
        processedLag: 0,
        confirmedLag: 2,
        finalizedLag: 4,
      },
      lastSuccessfulSlot: 298,
      lastSuccessfulAt: "2026-02-21T00:04:00Z",
      errorCount: 0,
      warnings: [],
      version: "v1",
    });
    expect(result.success).toBe(false);
  });

  test("parses valid health payload", () => {
    const health = parseHealth({
      ...META,
      component: "loopA",
      status: "ok",
      updatedAt: "2026-02-21T00:04:00Z",
      cursors: {
        processed: 300,
        confirmed: 298,
        finalized: 296,
      },
      lagSlots: {
        processedLag: 0,
        confirmedLag: 2,
        finalizedLag: 4,
      },
      lastSuccessfulSlot: 298,
      lastSuccessfulAt: "2026-02-21T00:04:00Z",
      errorCount: 0,
      warnings: [],
      version: "v1",
    });

    expect(health.status).toBe("ok");
  });

  test("generates deterministic JSON schema documents", () => {
    for (const entry of Object.values(LOOP_A_SCHEMA_REGISTRY)) {
      const schemaA = z.toJSONSchema(entry.schema);
      const schemaB = z.toJSONSchema(entry.schema);
      expect(schemaA).toEqual(schemaB);
    }
  });
});
