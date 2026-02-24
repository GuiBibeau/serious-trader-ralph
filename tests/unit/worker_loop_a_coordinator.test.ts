import { describe, expect, test } from "bun:test";
import {
  LoopACoordinator,
  type LoopACoordinatorStorageState,
} from "../../apps/worker/src/loop_a/coordinator";
import type { LoopACursorState } from "../../apps/worker/src/loop_a/types";
import type { Env } from "../../apps/worker/src/types";

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

function createCursorState(slot: number): LoopACursorState {
  return {
    schemaVersion: "v1",
    updatedAt: "2026-02-21T00:00:00.000Z",
    headCursor: { processed: slot, confirmed: slot, finalized: slot },
    fetchedCursor: { processed: slot, confirmed: slot, finalized: slot },
    ingestionCursor: { processed: slot, confirmed: slot, finalized: slot },
    stateCursor: { processed: slot, confirmed: slot, finalized: slot },
  };
}

function createMockDoState() {
  const store = new Map<string, unknown>();
  let alarmAt: number | null = null;

  return {
    state: {
      storage: {
        get: async (key: string) => store.get(key),
        put: async (key: string, value: unknown) => {
          store.set(key, value);
        },
        delete: async (key: string) => {
          store.delete(key);
        },
        setAlarm: async (time: number | Date) => {
          alarmAt = typeof time === "number" ? time : time.getTime();
        },
        deleteAlarm: async () => {
          alarmAt = null;
        },
        getAlarm: async () => alarmAt,
      },
      blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => await fn(),
    } as unknown as DurableObjectState,
    store,
    getAlarm: () => alarmAt,
  };
}

function createEnv(): Env {
  return {
    WAITLIST_DB: createMockDb() as never,
    LOOP_A_COORDINATOR_ENABLED: "1",
  } as Env;
}

describe("worker loop A coordinator durable object", () => {
  test("queues an alarm tick via trigger endpoint", async () => {
    const mock = createMockDoState();
    const coordinator = new LoopACoordinator(mock.state, createEnv(), {
      now: () => "2026-02-21T01:00:00.000Z",
    });

    const response = await coordinator.fetch(
      new Request("https://internal/loop-a/trigger", { method: "POST" }),
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({ ok: true, queued: true });
    expect(mock.getAlarm()).not.toBeNull();
  });

  test("persists tick state and schedules alarm when backlog exists", async () => {
    const mock = createMockDoState();
    const cursorState = createCursorState(100);

    const coordinator = new LoopACoordinator(mock.state, createEnv(), {
      runTick: async () => ({
        cursorState,
        backlog: true,
        stateCommitment: "confirmed",
        stateTargetSlot: 100,
        stateAppliedSlot: 100,
      }),
      readCursorState: async () => cursorState,
      now: () => "2026-02-21T01:00:00.000Z",
    });

    const response = await coordinator.fetch(
      new Request("https://internal/loop-a/tick", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    const rawState = mock.store.get("loop_a:coordinator_state:v1");
    const state = rawState as LoopACoordinatorStorageState;
    expect(state.tickCount).toBe(1);
    expect(state.backlog).toBe(true);
    expect(state.cursorState?.headCursor.confirmed).toBe(100);
    expect(mock.getAlarm()).not.toBeNull();
  });

  test("keeps cursor state monotonic and clears alarm when backlog is false", async () => {
    const mock = createMockDoState();
    const previousCursor = createCursorState(200);
    await mock.state.storage.put("loop_a:coordinator_state:v1", {
      schemaVersion: "v1",
      updatedAt: "2026-02-21T01:00:00.000Z",
      tickCount: 3,
      backlog: true,
      cursorState: previousCursor,
    } satisfies LoopACoordinatorStorageState);
    await mock.state.storage.setAlarm(Date.now() + 10_000);

    const lowerCursor = createCursorState(120);
    const coordinator = new LoopACoordinator(mock.state, createEnv(), {
      runTick: async () => ({
        cursorState: lowerCursor,
        backlog: false,
        stateCommitment: "confirmed",
        stateTargetSlot: 120,
        stateAppliedSlot: 120,
      }),
      readCursorState: async () => lowerCursor,
      now: () => "2026-02-21T01:05:00.000Z",
    });

    const response = await coordinator.fetch(
      new Request("https://internal/loop-a/tick", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    const rawState = mock.store.get("loop_a:coordinator_state:v1");
    const state = rawState as LoopACoordinatorStorageState;
    expect(state.tickCount).toBe(4);
    expect(state.backlog).toBe(false);
    expect(state.cursorState?.headCursor.confirmed).toBe(200);
    expect(mock.getAlarm()).toBeNull();
  });

  test("records error and schedules retry on tick failure", async () => {
    const mock = createMockDoState();

    const coordinator = new LoopACoordinator(mock.state, createEnv(), {
      runTick: async () => {
        throw new Error("tick-failed");
      },
      now: () => "2026-02-21T01:10:00.000Z",
    });

    const response = await coordinator.fetch(
      new Request("https://internal/loop-a/tick", { method: "POST" }),
    );

    expect(response.status).toBe(500);
    const rawState = mock.store.get("loop_a:coordinator_state:v1");
    const state = rawState as LoopACoordinatorStorageState;
    expect(state.backlog).toBe(true);
    expect(state.lastError).toBe("tick-failed");
    expect(mock.getAlarm()).not.toBeNull();
  });
});
