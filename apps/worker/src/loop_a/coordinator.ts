import type { Env } from "../types";
import { readLoopACursorStateFromKv } from "./cursor_store_kv";
import { recordLoopAHealthTick } from "./health";
import { type LoopAPipelineTickResult, runLoopATickPipeline } from "./pipeline";
import type { LoopACursorHeads, LoopACursorState } from "./types";

const COORDINATOR_STORAGE_KEY = "loop_a:coordinator_state:v1";
export const LOOP_A_COORDINATOR_NAME = "loop-a-coordinator-v1";
const BACKLOG_ALARM_DELAY_MS = 30_000;
const ERROR_RETRY_ALARM_DELAY_MS = 60_000;

export type LoopACoordinatorStorageState = {
  schemaVersion: "v1";
  updatedAt: string;
  tickCount: number;
  lastTickAt?: string;
  lastError?: string;
  backlog: boolean;
  cursorState?: LoopACursorState;
};

function maxHeads(a: LoopACursorHeads, b: LoopACursorHeads): LoopACursorHeads {
  return {
    processed: Math.max(a.processed, b.processed),
    confirmed: Math.max(a.confirmed, b.confirmed),
    finalized: Math.max(a.finalized, b.finalized),
  };
}

function mergeCursorStateMonotonic(
  before: LoopACursorState | undefined,
  after: LoopACursorState,
): LoopACursorState {
  if (!before) return after;

  return {
    schemaVersion: "v1",
    updatedAt: after.updatedAt,
    headCursor: maxHeads(before.headCursor, after.headCursor),
    fetchedCursor: maxHeads(before.fetchedCursor, after.fetchedCursor),
    ingestionCursor: maxHeads(before.ingestionCursor, after.ingestionCursor),
    stateCursor: maxHeads(before.stateCursor, after.stateCursor),
  };
}

function parseStorageState(
  input: unknown,
): LoopACoordinatorStorageState | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== "v1") return null;
  const updatedAt = record.updatedAt;
  const tickCount = record.tickCount;
  const backlog = record.backlog;
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) {
    return null;
  }
  if (
    typeof tickCount !== "number" ||
    !Number.isInteger(tickCount) ||
    tickCount < 0
  ) {
    return null;
  }
  if (typeof backlog !== "boolean") {
    return null;
  }

  return {
    schemaVersion: "v1",
    updatedAt,
    tickCount,
    backlog,
    lastTickAt:
      typeof record.lastTickAt === "string" ? record.lastTickAt : undefined,
    lastError:
      typeof record.lastError === "string" ? record.lastError : undefined,
    cursorState: record.cursorState as LoopACursorState | undefined,
  };
}

async function setBacklogAlarm(
  state: DurableObjectState,
  backlog: boolean,
): Promise<void> {
  if (backlog) {
    await state.storage.setAlarm(Date.now() + BACKLOG_ALARM_DELAY_MS);
    return;
  }
  await state.storage.deleteAlarm();
}

export type LoopACoordinatorDeps = {
  runTick?: (env: Env) => Promise<LoopAPipelineTickResult>;
  readCursorState?: (env: Env) => Promise<LoopACursorState | null>;
  now?: () => string;
};

export class LoopACoordinator {
  private readonly runTick: (env: Env) => Promise<LoopAPipelineTickResult>;

  private readonly readCursorState: (
    env: Env,
  ) => Promise<LoopACursorState | null>;

  private readonly now: () => string;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    deps: LoopACoordinatorDeps = {},
  ) {
    this.runTick = deps.runTick ?? runLoopATickPipeline;
    this.readCursorState = deps.readCursorState ?? readLoopACursorStateFromKv;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  private async loadState(): Promise<LoopACoordinatorStorageState> {
    const raw = await this.state.storage.get(COORDINATOR_STORAGE_KEY);
    const parsed = parseStorageState(raw);
    if (parsed) return parsed;
    return {
      schemaVersion: "v1",
      updatedAt: this.now(),
      tickCount: 0,
      backlog: false,
    };
  }

  private async persistState(
    next: LoopACoordinatorStorageState,
  ): Promise<void> {
    await this.state.storage.put(COORDINATOR_STORAGE_KEY, next);
  }

  private async handleTick(trigger: "fetch" | "alarm"): Promise<Response> {
    const startedAtMs = Date.now();
    const prevState = await this.loadState();

    try {
      const tickResult = await this.runTick(this.env);
      const cursorStateFromKv = await this.readCursorState(this.env);
      const cursorState = mergeCursorStateMonotonic(
        prevState.cursorState,
        cursorStateFromKv ?? tickResult.cursorState,
      );

      const nextState: LoopACoordinatorStorageState = {
        schemaVersion: "v1",
        updatedAt: this.now(),
        tickCount: prevState.tickCount + 1,
        lastTickAt: this.now(),
        backlog: tickResult.backlog,
        cursorState,
      };

      await this.persistState(nextState);
      await setBacklogAlarm(this.state, tickResult.backlog);
      try {
        await recordLoopAHealthTick(this.env, {
          ok: true,
          trigger:
            trigger === "alarm" ? "coordinator_alarm" : "coordinator_fetch",
          startedAtMs,
          tickResult: {
            ...tickResult,
            cursorState,
          },
        });
      } catch (healthError) {
        console.error("loop_a.coordinator.health.error", {
          trigger,
          message:
            healthError instanceof Error
              ? healthError.message
              : "unknown-health-error",
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          trigger,
          tickCount: nextState.tickCount,
          backlog: tickResult.backlog,
          stateCommitment: tickResult.stateCommitment,
          stateTargetSlot: tickResult.stateTargetSlot,
          stateAppliedSlot: tickResult.stateAppliedSlot,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown-error";
      const nextState: LoopACoordinatorStorageState = {
        schemaVersion: "v1",
        updatedAt: this.now(),
        tickCount: prevState.tickCount,
        lastTickAt: prevState.lastTickAt,
        backlog: true,
        lastError: message,
        cursorState: prevState.cursorState,
      };
      await this.persistState(nextState);
      await this.state.storage.setAlarm(
        Date.now() + ERROR_RETRY_ALARM_DELAY_MS,
      );
      try {
        await recordLoopAHealthTick(this.env, {
          ok: false,
          trigger:
            trigger === "alarm" ? "coordinator_alarm" : "coordinator_fetch",
          startedAtMs,
          cursorStateFallback: prevState.cursorState,
          error,
        });
      } catch (healthError) {
        console.error("loop_a.coordinator.health.error", {
          trigger,
          message:
            healthError instanceof Error
              ? healthError.message
              : "unknown-health-error",
        });
      }
      console.error("loop_a.coordinator.tick.error", {
        trigger,
        message,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return new Response(JSON.stringify({ ok: false, error: message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      (url.pathname === "/loop-a/trigger" ||
        url.pathname === "/internal/loop-a/trigger")
    ) {
      await this.state.storage.setAlarm(Date.now());
      return new Response(JSON.stringify({ ok: true, queued: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/loop-a/tick" ||
        url.pathname === "/internal/loop-a/tick")
    ) {
      return await this.handleTick("fetch");
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/loop-a/state" ||
        url.pathname === "/internal/loop-a/state")
    ) {
      const state = await this.loadState();
      return new Response(JSON.stringify({ ok: true, state }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "not-found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  async alarm(): Promise<void> {
    await this.handleTick("alarm");
  }
}
