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
import type { LoopACursorState } from "./types";

export type LoopAPipelineTickResult = {
  cursorState: LoopACursorState;
  backlog: boolean;
  stateCommitment: "processed" | "confirmed" | "finalized";
  stateTargetSlot: number;
  stateAppliedSlot: number | null;
};

export function hasLoopABacklog(cursorState: LoopACursorState): boolean {
  const commitments = ["processed", "confirmed", "finalized"] as const;
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

  const result = await runLoopASlotSourceTick(env);
  console.log("loop_a.slot_source.tick", {
    cursorBefore: result.cursorBefore,
    cursorAfter: result.cursorAfter,
    cursorStateBefore: result.cursorStateBefore,
    cursorStateAfter: result.cursorStateAfter,
    tasksEmitted: result.tasksEmitted,
  });

  const blockFetchEnabled =
    String(env.LOOP_A_BLOCK_FETCH_ENABLED ?? "0").trim() === "1";
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
  }

  const stateCommitment = resolveStateCommitment(env.LOOP_A_STATE_COMMITMENT);
  let stateAppliedSlot: number | null = null;

  if (stateStoreEnabled) {
    const cursorStateLatest =
      (await readLoopACursorStateFromKv(env)) ?? cursorState;
    const missingSlotsByCommitment: Record<string, number | null> = {};
    for (const commitment of ["processed", "confirmed", "finalized"] as const) {
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
    backlog: hasLoopABacklog(cursorState),
    stateCommitment,
    stateTargetSlot: cursorState.ingestionCursor[stateCommitment],
    stateAppliedSlot,
  };
}
