import { describe, expect, test } from "bun:test";

import {
  type LoopAEventBatch,
  type LoopAStateSnapshot,
  loopAEventBatchKey,
  loopAStateLatestKey,
  loopAStateSnapshotKey,
  runLoopACanonicalStateTick,
} from "../../apps/worker/src/loop_a/canonical_state";
import type { LoopACursor } from "../../apps/worker/src/loop_a/types";
import type { Env } from "../../apps/worker/src/types";
import type { ProtocolEvent } from "../../src/loops/contracts/loop_a.js";

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
  const env = {
    WAITLIST_DB: createMockDb() as never,
    CONFIG_KV: kv as never,
    RPC_ENDPOINT: "https://rpc.example",
  } as Env;
  return { env, store };
}

function cursor(
  processed: number,
  confirmed: number,
  finalized: number,
): LoopACursor {
  return {
    schemaVersion: "v1",
    processed,
    confirmed,
    finalized,
    updatedAt: "2026-02-21T04:30:00.000Z",
  };
}

function transferEvent(slot: number, sig: string): ProtocolEvent {
  return {
    schemaVersion: "v1",
    generatedAt: "2026-02-21T04:30:00.000Z",
    kind: "fee_transfer",
    protocol: "spl_token",
    slot,
    sig,
    ts: "2026-02-21T04:30:00.000Z",
    user: "UserOne111111111111111111111111111111111111111",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: "100",
    to: "UserTwo111111111111111111111111111111111111111",
  };
}

function swapEvent(slot: number, sig: string): ProtocolEvent {
  return {
    schemaVersion: "v1",
    generatedAt: "2026-02-21T04:30:00.000Z",
    kind: "swap",
    protocol: "jupiter",
    slot,
    sig,
    ts: "2026-02-21T04:30:00.000Z",
    user: "UserSwap111111111111111111111111111111111111111",
    inMint: "So11111111111111111111111111111111111111112",
    outMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    inAmount: "250000000",
    outAmount: "1000000",
  };
}

function batch(
  slot: number,
  events: ProtocolEvent[],
  commitment: "processed" | "confirmed" | "finalized" = "confirmed",
): LoopAEventBatch {
  return {
    schemaVersion: "v1",
    commitment,
    slot,
    generatedAt: "2026-02-21T04:30:00.000Z",
    events,
  };
}

function readSnapshot(
  store: Map<string, string>,
  key: string,
): LoopAStateSnapshot | null {
  const raw = store.get(key);
  if (!raw) return null;
  return JSON.parse(raw) as LoopAStateSnapshot;
}

describe("worker loop A canonical state", () => {
  test("bootstraps from decoded batches and persists latest snapshot", async () => {
    const { env, store } = createEnv();

    const result = await runLoopACanonicalStateTick(env, {
      cursorAfter: cursor(102, 102, 100),
      decodedBatches: [
        batch(101, [transferEvent(101, "sig-transfer-101")]),
        batch(102, [swapEvent(102, "sig-swap-102")]),
      ],
      commitment: "confirmed",
      snapshotEverySlots: 10,
      observedAt: "2026-02-21T04:31:00.000Z",
    });

    expect(result.snapshotBeforeSlot).toBeNull();
    expect(result.snapshotAfterSlot).toBe(102);
    expect(result.replayedSlots).toBe(2);
    expect(result.appliedEvents).toBe(2);

    const snapshot = readSnapshot(store, loopAStateLatestKey("confirmed"));
    expect(snapshot).not.toBeNull();
    expect(snapshot?.slot).toBe(102);
    expect(snapshot?.trackedState.totalEvents).toBe(2);
    expect(snapshot?.trackedState.byKind.fee_transfer).toBe(1);
    expect(snapshot?.trackedState.byKind.swap).toBe(1);
    expect(snapshot?.trackedState.byProtocol.spl_token).toBe(1);
    expect(snapshot?.trackedState.byProtocol.jupiter).toBe(1);

    expect(store.has(loopAEventBatchKey("confirmed", 101))).toBe(true);
    expect(store.has(loopAEventBatchKey("confirmed", 102))).toBe(true);
  });

  test("replays persisted batches after restart to recover forward", async () => {
    const { env, store } = createEnv();

    await runLoopACanonicalStateTick(env, {
      cursorAfter: cursor(201, 201, 200),
      decodedBatches: [batch(201, [transferEvent(201, "sig-201")])],
      commitment: "confirmed",
      snapshotEverySlots: 100,
      observedAt: "2026-02-21T04:32:00.000Z",
    });

    store.set(
      loopAEventBatchKey("confirmed", 202),
      JSON.stringify(batch(202, [swapEvent(202, "sig-202")], "confirmed")),
    );
    store.set(
      loopAEventBatchKey("confirmed", 203),
      JSON.stringify(batch(203, [transferEvent(203, "sig-203")], "confirmed")),
    );

    const result = await runLoopACanonicalStateTick(env, {
      cursorAfter: cursor(203, 203, 201),
      decodedBatches: [],
      commitment: "confirmed",
      snapshotEverySlots: 100,
      observedAt: "2026-02-21T04:33:00.000Z",
    });

    expect(result.snapshotBeforeSlot).toBe(201);
    expect(result.snapshotAfterSlot).toBe(203);
    expect(result.replayedSlots).toBe(2);
    expect(result.appliedEvents).toBe(2);

    const snapshot = readSnapshot(store, loopAStateLatestKey("confirmed"));
    expect(snapshot?.trackedState.totalEvents).toBe(3);
    expect(snapshot?.trackedState.byKind.fee_transfer).toBe(2);
    expect(snapshot?.trackedState.byKind.swap).toBe(1);
  });

  test("writes periodic checkpoint snapshots when cadence threshold is met", async () => {
    const { env, store } = createEnv();

    const result = await runLoopACanonicalStateTick(env, {
      cursorAfter: cursor(104, 104, 100),
      decodedBatches: [
        batch(101, [transferEvent(101, "sig-101")]),
        batch(102, [transferEvent(102, "sig-102")]),
        batch(103, [swapEvent(103, "sig-103")]),
        batch(104, [transferEvent(104, "sig-104")]),
      ],
      commitment: "confirmed",
      snapshotEverySlots: 2,
      observedAt: "2026-02-21T04:34:00.000Z",
    });

    expect(result.checkpointsWritten).toBe(1);
    expect(store.has(loopAStateSnapshotKey("confirmed", 104))).toBe(true);
  });

  test("halts replay progression when a slot batch is missing", async () => {
    const { env, store } = createEnv();

    await runLoopACanonicalStateTick(env, {
      cursorAfter: cursor(11, 11, 10),
      decodedBatches: [batch(11, [transferEvent(11, "sig-11")])],
      commitment: "confirmed",
      snapshotEverySlots: 100,
      observedAt: "2026-02-21T04:35:00.000Z",
    });

    const result = await runLoopACanonicalStateTick(env, {
      cursorAfter: cursor(13, 13, 10),
      decodedBatches: [batch(12, [swapEvent(12, "sig-12")])],
      commitment: "confirmed",
      snapshotEverySlots: 100,
      observedAt: "2026-02-21T04:36:00.000Z",
    });

    expect(result.snapshotBeforeSlot).toBe(11);
    expect(result.snapshotAfterSlot).toBe(12);
    expect(result.replayMissingSlots).toEqual([13]);

    const snapshot = readSnapshot(store, loopAStateLatestKey("confirmed"));
    expect(snapshot?.slot).toBe(12);
    expect(snapshot?.trackedState.totalEvents).toBe(2);
  });
});
