export const LOOP_A_SCHEMA_VERSION = "v1" as const;

export type SlotCommitment = "processed" | "confirmed" | "finalized";

export type LoopACursorHeads = {
  processed: number;
  confirmed: number;
  finalized: number;
};

export type LoopACursor = {
  schemaVersion: typeof LOOP_A_SCHEMA_VERSION;
  processed: number;
  confirmed: number;
  finalized: number;
  updatedAt: string;
};

export type LoopACursorState = {
  schemaVersion: typeof LOOP_A_SCHEMA_VERSION;
  updatedAt: string;
  headCursor: LoopACursorHeads;
  fetchedCursor: LoopACursorHeads;
  ingestionCursor: LoopACursorHeads;
  stateCursor: LoopACursorHeads;
};

export type BackfillTask = {
  schemaVersion: typeof LOOP_A_SCHEMA_VERSION;
  commitment: SlotCommitment;
  fromSlot: number;
  toSlot: number;
  detectedAt: string;
  status: "pending";
};

export type SlotSourceTickResult = {
  cursorBefore: LoopACursor | null;
  cursorAfter: LoopACursor;
  cursorStateBefore: LoopACursorState | null;
  cursorStateAfter: LoopACursorState;
  tasksEmitted: number;
};

export type SlotHeads = {
  processed: number;
  confirmed: number;
  finalized: number;
};

export const LOOP_A_CURSOR_KEY = "loopA:v1:cursor";
export const LOOP_A_CURSOR_STATE_KEY = "loopA:v1:cursor_state";

export function isSlotCommitment(value: string): value is SlotCommitment {
  return (
    value === "processed" || value === "confirmed" || value === "finalized"
  );
}
