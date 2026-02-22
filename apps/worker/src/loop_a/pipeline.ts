import { publishMarksToMinuteAccumulator } from "../loop_b/minute_accumulator";
import type { Env } from "../types";
import { createDefaultDecoderRegistry } from "./adapters";
import { runLoopABackfillResolverTick } from "./backfill_resolver";
import { runLoopABlockFetcherTick } from "./block_fetcher";
import {
  createEmptyMarkerBatch,
  type LoopAEventBatch,
  resolveContiguousIngestionSlot,
  resolveSnapshotEverySlots,
  resolveStateCommitment,
  runLoopACanonicalStateTick,
} from "./canonical_state";
import {
  readLoopACursorStateFromKv,
  writeLoopACursorStateToKv,
} from "./cursor_store_kv";
import { decodeProtocolEventsFromBlock } from "./decoder_registry";
import { resolveMarkCommitment, runLoopAMarkEngineTick } from "./mark_engine";
import { runLoopASlotSourceTick } from "./slot_source";
import type { LoopACursorState, SlotCommitment } from "./types";

export type LoopAPipelineTickResult = {
  cursorState: LoopACursorState;
  backlog: boolean;
  stateCommitment: "processed" | "confirmed" | "finalized";
  stateTargetSlot: number;
  stateAppliedSlot: number | null;
};

export function hasLoopABacklog(
  cursorState: LoopACursorState,
  commitments: SlotCommitment[] = ["processed", "confirmed", "finalized"],
): boolean {
  for (const commitment of commitments) {
    if (
      cursorState.headCursor[commitment] >
      cursorState.ingestionCursor[commitment]
    ) {
      return true;
    }
    if (
      cursorState.ingestionCursor[commitment] >
      cursorState.stateCursor[commitment]
    ) {
      return true;
    }
  }
  return false;
}

function resolveActiveCommitments(input: {
  stateCommitment: SlotCommitment;
}): SlotCommitment[] {
  // Canonical ingestion/state progression is currently tracked for a single
  // state commitment. Including additional fetch-only commitments here causes
  // perpetual backlog and coordinator alarm thrash.
  return [input.stateCommitment];
}

export async function runLoopATickPipeline(
  env: Env,
): Promise<LoopAPipelineTickResult> {
  const slotSourceEnabled =
    String(env.LOOP_A_SLOT_SOURCE_ENABLED ?? "0").trim() === "1";
  if (!slotSourceEnabled) {
    throw new Error("loop-a-slot-source-disabled");
  }

  if (!env.CONFIG_KV) {
    throw new Error("loop-a-config-kv-missing");
  }

  const blockFetchEnabled =
    String(env.LOOP_A_BLOCK_FETCH_ENABLED ?? "0").trim() === "1";
  const stateCommitment = resolveStateCommitment(env.LOOP_A_STATE_COMMITMENT);
  const activeCommitments = resolveActiveCommitments({
    stateCommitment,
  });

  const result = await runLoopASlotSourceTick(env, {
    // BlockFetcher already handles range coverage. Emitting slot-source
    // backfill ranges in that mode causes duplicate pending-task fan-out.
    backfillCommitments: blockFetchEnabled ? [] : undefined,
  });
  console.log("loop_a.slot_source.tick", {
    cursorBefore: result.cursorBefore,
    cursorAfter: result.cursorAfter,
    cursorStateBefore: result.cursorStateBefore,
    cursorStateAfter: result.cursorStateAfter,
    tasksEmitted: result.tasksEmitted,
  });

  const stateStoreEnabled =
    String(env.LOOP_A_STATE_STORE_ENABLED ?? "0").trim() === "1";
  const backfillResolverEnabled =
    String(env.LOOP_A_BACKFILL_RESOLVER_ENABLED ?? "0").trim() === "1";
  const markEngineEnabled =
    String(env.LOOP_A_MARK_ENGINE_ENABLED ?? "0").trim() === "1";
  const decoderEnabled =
    String(env.LOOP_A_DECODER_ENABLED ?? "0").trim() === "1" ||
    stateStoreEnabled ||
    markEngineEnabled;
  const decoderRegistry = decoderEnabled
    ? createDefaultDecoderRegistry()
    : null;
  let decodedEvents = 0;
  let markerBatches = 0;
  const decodedBatches: LoopAEventBatch[] = [];
  let cursorState = result.cursorStateAfter;

  if (blockFetchEnabled) {
    const blockFetchResult = await runLoopABlockFetcherTick(
      env,
      {
        cursorBefore: result.cursorBefore,
        cursorAfter: result.cursorAfter,
      },
      {
        onFetchedBlock: decoderRegistry
          ? async (fetched) => {
              const events = decodeProtocolEventsFromBlock({
                slot: fetched.slot,
                commitment: fetched.commitment,
                block: fetched.block,
                registry: decoderRegistry,
              });
              decodedBatches.push({
                schemaVersion: "v1",
                commitment: fetched.commitment,
                slot: fetched.slot,
                generatedAt: new Date().toISOString(),
                events,
              });
              decodedEvents += events.length;
            }
          : undefined,
      },
    );

    for (const task of blockFetchResult.missingTasks) {
      if (task.reason === "fetch-failed") continue;
      decodedBatches.push(
        createEmptyMarkerBatch({
          commitment: task.commitment,
          slot: task.slot,
          generatedAt: new Date().toISOString(),
          reason: task.reason === "rpc-null" ? "skipped" : "missing_in_storage",
          source: "block_fetcher",
        }),
      );
      markerBatches += 1;
    }

    cursorState = {
      ...cursorState,
      updatedAt: new Date().toISOString(),
      fetchedCursor: {
        processed: Math.max(
          cursorState.fetchedCursor.processed,
          blockFetchResult.attemptedThrough.processed,
        ),
        confirmed: Math.max(
          cursorState.fetchedCursor.confirmed,
          blockFetchResult.attemptedThrough.confirmed,
        ),
        finalized: Math.max(
          cursorState.fetchedCursor.finalized,
          blockFetchResult.attemptedThrough.finalized,
        ),
      },
    };
    await writeLoopACursorStateToKv(env, cursorState);

    console.log("loop_a.block_fetcher.tick", {
      ...blockFetchResult,
      decodedEvents,
      decodedBatches: decodedBatches.length,
      markerBatches,
    });
  }

  if (backfillResolverEnabled) {
    const resolverResult = await runLoopABackfillResolverTick(env);
    console.log("loop_a.backfill_resolver.tick", resolverResult);
  }

  if (markEngineEnabled) {
    const markCommitment = resolveMarkCommitment(env.LOOP_A_MARK_COMMITMENT);
    const markResult = await runLoopAMarkEngineTick(env, {
      decodedBatches,
      commitment: markCommitment,
    });
    console.log("loop_a.mark_engine.tick", markResult);

    try {
      const loopBIngestResult = await publishMarksToMinuteAccumulator(env, {
        marks: markResult.marks,
      });
      if (loopBIngestResult) {
        console.log("loop_b.minute_accumulator.ingest", loopBIngestResult);
      }
    } catch (error) {
      console.error("loop_b.minute_accumulator.ingest.error", {
        message: error instanceof Error ? error.message : "unknown-error",
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  let stateAppliedSlot: number | null = null;

  if (stateStoreEnabled) {
    const cursorStateLatest =
      (await readLoopACursorStateFromKv(env)) ?? cursorState;
    const missingSlotsByCommitment: Record<string, number | null> = {};
    for (const commitment of activeCommitments) {
      const resolved = await resolveContiguousIngestionSlot({
        env,
        commitment,
        fromSlot: cursorStateLatest.ingestionCursor[commitment],
        targetSlot: cursorStateLatest.headCursor[commitment],
      });
      cursorStateLatest.ingestionCursor[commitment] = resolved.ingestionSlot;
      missingSlotsByCommitment[commitment] = resolved.missingSlot;
    }
    cursorStateLatest.updatedAt = new Date().toISOString();
    await writeLoopACursorStateToKv(env, cursorStateLatest);
    console.log("loop_a.ingestion_cursor.update", {
      activeCommitments,
      headCursor: cursorStateLatest.headCursor,
      ingestionCursor: cursorStateLatest.ingestionCursor,
      missingSlotsByCommitment,
    });

    const stateTickResult = await runLoopACanonicalStateTick(env, {
      cursorAfter: result.cursorAfter,
      targetSlot: cursorStateLatest.ingestionCursor[stateCommitment],
      decodedBatches,
      commitment: stateCommitment,
      snapshotEverySlots: resolveSnapshotEverySlots(
        env.LOOP_A_SNAPSHOT_EVERY_SLOTS,
      ),
    });
    cursorStateLatest.stateCursor[stateCommitment] =
      stateTickResult.snapshotAfterSlot;
    cursorStateLatest.updatedAt = new Date().toISOString();
    await writeLoopACursorStateToKv(env, cursorStateLatest);
    console.log("loop_a.state_store.tick", stateTickResult);

    cursorState = cursorStateLatest;
    stateAppliedSlot = stateTickResult.snapshotAfterSlot;
  } else {
    const latestState = await readLoopACursorStateFromKv(env);
    if (latestState) cursorState = latestState;
  }

  return {
    cursorState,
    backlog: hasLoopABacklog(cursorState, activeCommitments),
    stateCommitment,
    stateTargetSlot: cursorState.ingestionCursor[stateCommitment],
    stateAppliedSlot,
  };
}
