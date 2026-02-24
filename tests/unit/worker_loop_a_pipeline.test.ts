import { describe, expect, test } from "bun:test";
import {
  buildFetchWindowFromCursorState,
  hasLoopABacklog,
} from "../../apps/worker/src/loop_a/pipeline";
import type { LoopACursorState } from "../../apps/worker/src/loop_a/types";

function buildCursorState(): LoopACursorState {
  return {
    schemaVersion: "v1",
    updatedAt: "2026-02-21T00:00:00.000Z",
    headCursor: {
      processed: 2_000,
      confirmed: 1_000,
      finalized: 950,
    },
    fetchedCursor: {
      processed: 10,
      confirmed: 1_000,
      finalized: 950,
    },
    ingestionCursor: {
      processed: 10,
      confirmed: 1_000,
      finalized: 940,
    },
    stateCursor: {
      processed: 10,
      confirmed: 1_000,
      finalized: 930,
    },
  };
}

describe("worker loop A pipeline backlog checks", () => {
  test("default backlog check includes all commitments", () => {
    const cursorState = buildCursorState();
    expect(hasLoopABacklog(cursorState)).toBe(true);
  });

  test("backlog can be evaluated against active commitments only", () => {
    const cursorState = buildCursorState();
    expect(hasLoopABacklog(cursorState, ["confirmed"])).toBe(false);
    expect(hasLoopABacklog(cursorState, ["finalized"])).toBe(true);
    expect(hasLoopABacklog(cursorState, ["confirmed", "finalized"])).toBe(true);
  });

  test("builds block fetch window from fetched cursor to head cursor", () => {
    const cursorState = buildCursorState();
    const { cursorBefore, cursorAfter } =
      buildFetchWindowFromCursorState(cursorState);

    expect(cursorBefore).toMatchObject({
      processed: cursorState.fetchedCursor.processed,
      confirmed: cursorState.fetchedCursor.confirmed,
      finalized: cursorState.fetchedCursor.finalized,
    });
    expect(cursorAfter).toMatchObject({
      processed: cursorState.headCursor.processed,
      confirmed: cursorState.headCursor.confirmed,
      finalized: cursorState.headCursor.finalized,
    });
    expect(cursorAfter.confirmed).toBeGreaterThanOrEqual(
      cursorBefore.confirmed,
    );
  });
});
