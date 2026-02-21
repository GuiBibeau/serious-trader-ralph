import { describe, expect, test } from "bun:test";
import type { LoopAEventBatch } from "../../apps/worker/src/loop_a/canonical_state";
import {
  loopAMarksLatestKey,
  resolveMarkCommitment,
  runLoopAMarkEngineTick,
} from "../../apps/worker/src/loop_a/mark_engine";
import type { Env } from "../../apps/worker/src/types";
import {
  type ProtocolEvent,
  parseMark,
} from "../../src/loops/contracts/loop_a";

function createMockDb() {
  return {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            run: async () => ({ meta: { changes: 1 } }),
            all: async () => ({ results: [] }),
            first: async () => null,
          };
        },
      };
    },
  };
}

function createMockKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
      delete: async (key: string) => {
        store.delete(key);
      },
    },
  };
}

function createEnv(): { env: Env; store: Map<string, string> } {
  const { kv, store } = createMockKv();
  return {
    env: {
      WAITLIST_DB: createMockDb() as never,
      CONFIG_KV: kv as never,
    } as Env,
    store,
  };
}

function swapEvent(input: {
  slot: number;
  sig: string;
  inMint: string;
  outMint: string;
  inAmount: string;
  outAmount: string;
}): Extract<ProtocolEvent, { kind: "swap" }> {
  return {
    schemaVersion: "v1",
    generatedAt: "2026-02-21T04:00:00.000Z",
    kind: "swap",
    protocol: "jupiter",
    slot: input.slot,
    sig: input.sig,
    ts: "2026-02-21T04:00:00.000Z",
    user: "UserSwap111111111111111111111111111111111111111",
    venue: "jupiter",
    inMint: input.inMint,
    outMint: input.outMint,
    inAmount: input.inAmount,
    outAmount: input.outAmount,
  };
}

function transferEvent(
  slot: number,
  sig: string,
): Extract<ProtocolEvent, { kind: "fee_transfer" }> {
  return {
    schemaVersion: "v1",
    generatedAt: "2026-02-21T04:00:00.000Z",
    kind: "fee_transfer",
    protocol: "spl_token",
    slot,
    sig,
    ts: "2026-02-21T04:00:00.000Z",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: "1000",
  };
}

function batch(
  commitment: "processed" | "confirmed" | "finalized",
  slot: number,
  events: ProtocolEvent[],
): LoopAEventBatch {
  return {
    schemaVersion: "v1",
    commitment,
    slot,
    generatedAt: "2026-02-21T04:00:00.000Z",
    events,
  };
}

describe("worker loop A mark engine", () => {
  test("resolveMarkCommitment falls back to confirmed", () => {
    expect(resolveMarkCommitment(undefined)).toBe("confirmed");
    expect(resolveMarkCommitment("processed")).toBe("processed");
    expect(resolveMarkCommitment("invalid")).toBe("confirmed");
  });

  test("computes marks and publishes latest + per-pair keys", async () => {
    const { env, store } = createEnv();

    const result = await runLoopAMarkEngineTick(env, {
      commitment: "confirmed",
      observedAt: "2026-02-21T04:01:00.000Z",
      decodedBatches: [
        batch("confirmed", 100, [
          swapEvent({
            slot: 100,
            sig: "sig-100",
            inMint: "So11111111111111111111111111111111111111112",
            outMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "250000000",
            outAmount: "1000000",
          }),
        ]),
        batch("finalized", 100, [
          swapEvent({
            slot: 100,
            sig: "sig-finalized-ignored",
            inMint: "So11111111111111111111111111111111111111112",
            outMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "1",
            outAmount: "1",
          }),
        ]),
      ],
    });

    expect(result.marksComputed).toBe(1);
    expect(result.pairKeysWritten).toBe(1);
    expect(result.latestSlot).toBe(100);
    expect(result.latestKey).toBe(loopAMarksLatestKey("confirmed"));

    const latestRaw = store.get(loopAMarksLatestKey("confirmed"));
    expect(latestRaw).not.toBeNull();
    const latest = JSON.parse(latestRaw ?? "{}") as {
      marks: unknown[];
      latestSlot: number;
      count: number;
    };
    expect(latest.count).toBe(1);
    expect(latest.latestSlot).toBe(100);
    const mark = parseMark(latest.marks[0]);
    expect(mark.baseMint).toBe("So11111111111111111111111111111111111111112");
    expect(mark.quoteMint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(mark.evidence?.sigs).toEqual(["sig-100"]);

    const pairKey =
      "loopA:v1:marks:confirmed:pair:So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:latest";
    expect(store.has(pairKey)).toBe(true);
    expect(parseMark(JSON.parse(store.get(pairKey) ?? "{}")).slot).toBe(100);
  });

  test("keeps latest slot mark when multiple swaps hit same pair", async () => {
    const { env, store } = createEnv();

    const result = await runLoopAMarkEngineTick(env, {
      commitment: "confirmed",
      observedAt: "2026-02-21T04:02:00.000Z",
      decodedBatches: [
        batch("confirmed", 120, [
          swapEvent({
            slot: 120,
            sig: "sig-120",
            inMint: "So11111111111111111111111111111111111111112",
            outMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "2",
            outAmount: "4",
          }),
        ]),
        batch("confirmed", 121, [
          swapEvent({
            slot: 121,
            sig: "sig-121",
            inMint: "So11111111111111111111111111111111111111112",
            outMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "2",
            outAmount: "8",
          }),
        ]),
      ],
    });

    expect(result.marksComputed).toBe(1);
    expect(result.latestSlot).toBe(121);
    const latest = JSON.parse(
      store.get(loopAMarksLatestKey("confirmed")) ?? "{}",
    ) as { marks: unknown[] };
    const mark = parseMark(latest.marks[0]);
    expect(mark.slot).toBe(121);
    expect(mark.evidence?.sigs).toEqual(["sig-121"]);
  });

  test("returns zero result when no eligible swap events exist", async () => {
    const { env, store } = createEnv();

    const result = await runLoopAMarkEngineTick(env, {
      commitment: "confirmed",
      observedAt: "2026-02-21T04:03:00.000Z",
      decodedBatches: [
        batch("confirmed", 130, [transferEvent(130, "sig-130")]),
      ],
    });

    expect(result.marksComputed).toBe(0);
    expect(result.latestSlot).toBeNull();
    expect(result.latestKey).toBeNull();
    expect(store.has(loopAMarksLatestKey("confirmed"))).toBe(false);
  });

  test("throws when CONFIG_KV is missing", async () => {
    const env = {
      WAITLIST_DB: createMockDb() as never,
    } as Env;
    await expect(
      runLoopAMarkEngineTick(env, {
        commitment: "confirmed",
        decodedBatches: [],
      }),
    ).rejects.toThrow(/loop-a-config-kv-missing/);
  });
});
