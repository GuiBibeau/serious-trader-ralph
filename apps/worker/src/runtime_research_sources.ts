import {
  acquireRuntimeResearchSources,
  type FetchLike,
  type RuntimeResearchSourceAcquisitionRequest,
} from "../../../src/runtime/research/source_acquisition.js";
import {
  parseRuntimeResearchSourceRecord,
  type RuntimeResearchSourceRecord,
} from "./runtime_contracts";
import {
  readRuntimeResearchRegistry,
  writeRuntimeResearchSource,
} from "./runtime_internal";
import type { Env } from "./types";

export type RuntimeResearchSourceAcquireResult = {
  records: RuntimeResearchSourceRecord[];
  createdCount: number;
  existingCount: number;
};

export type RuntimeLatestResearchSourceQuery = {
  env: Env;
  sourceKind?: RuntimeResearchSourceRecord["sourceKind"];
  venueKey?: string;
  assetKey?: string;
  tag?: string;
  limit?: number;
};

export async function acquireAndStoreRuntimeResearchSources(input: {
  env: Env;
  request: RuntimeResearchSourceAcquisitionRequest;
  fetchImpl?: FetchLike;
  readExistingSources?: (
    query: RuntimeLatestResearchSourceQuery,
  ) => Promise<{ records: RuntimeResearchSourceRecord[] }>;
  writeSource?: (input: {
    env: Env;
    sourceRecord: RuntimeResearchSourceRecord;
  }) => Promise<{
    ok: boolean;
    payload: Record<string, unknown>;
  }>;
}): Promise<RuntimeResearchSourceAcquireResult> {
  const readExistingSources =
    input.readExistingSources ?? readLatestRuntimeResearchSources;
  const writeSource = input.writeSource ?? writeRuntimeResearchSource;
  const existing = await readExistingSources({
    env: input.env,
    venueKey:
      input.request.kind === "venue_docs"
        ? input.request.venueKey
        : input.request.venueKeys?.[0],
    assetKey: input.request.assetKeys?.[0],
    limit: 250,
  });
  const acquired = await acquireRuntimeResearchSources({
    request: input.request,
    fetchImpl: input.fetchImpl,
  });
  const existingBySourceId = new Map(
    existing.records.map((record) => [record.sourceId, record]),
  );
  const existingByCanonicalUrl = new Map(
    existing.records.map((record) => [record.canonicalUrl, record]),
  );
  const records: RuntimeResearchSourceRecord[] = [];
  let createdCount = 0;
  let existingCount = 0;

  for (const record of acquired) {
    const existingRecord =
      existingBySourceId.get(record.sourceId) ??
      existingByCanonicalUrl.get(record.canonicalUrl) ??
      existing.records.find((candidate) =>
        isNearDuplicateResearchSource(candidate, record),
      );
    const merged = mergeResearchSourceRecord(record, existingRecord);
    const response = await writeSource({
      env: input.env,
      sourceRecord: merged,
    });
    if (!response.ok) {
      throw new Error(
        String(
          response.payload.error ?? "runtime-research-source-write-failed",
        ),
      );
    }
    const payloadRecord =
      response.payload.sourceRecord ?? response.payload.record ?? merged;
    records.push(parseRuntimeResearchSourceRecord(payloadRecord));
    if (response.payload.created === true) {
      createdCount += 1;
    } else {
      existingCount += 1;
    }
  }

  return {
    records,
    createdCount,
    existingCount,
  };
}

export async function readLatestRuntimeResearchSources(
  input: RuntimeLatestResearchSourceQuery,
): Promise<{ records: RuntimeResearchSourceRecord[] }> {
  const response = await readRuntimeResearchRegistry({
    env: input.env,
    venueKey: input.venueKey,
    assetKey: input.assetKey,
  });
  if (!response.ok) {
    throw new Error(
      String(response.payload.error ?? "runtime-research-registry-read-failed"),
    );
  }

  const registry = response.payload.registry;
  const rawSources =
    registry && typeof registry === "object" && Array.isArray(registry.sources)
      ? registry.sources
      : [];
  const tag = input.tag?.trim().toLowerCase() || null;
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.max(1, Math.trunc(input.limit))
      : 20;
  const records = rawSources
    .map((entry) => {
      try {
        return parseRuntimeResearchSourceRecord(entry);
      } catch {
        return null;
      }
    })
    .filter((value): value is RuntimeResearchSourceRecord => value !== null)
    .filter((record) =>
      input.sourceKind ? record.sourceKind === input.sourceKind : true,
    )
    .filter((record) =>
      tag
        ? record.tags.some((candidate) => candidate.toLowerCase() === tag)
        : true,
    )
    .sort(compareResearchSourceRecency)
    .slice(0, limit);

  return { records };
}

function mergeResearchSourceRecord(
  record: RuntimeResearchSourceRecord,
  existing: RuntimeResearchSourceRecord | undefined,
): RuntimeResearchSourceRecord {
  if (!existing) {
    return record;
  }
  return parseRuntimeResearchSourceRecord({
    ...record,
    sourceId: existing.sourceId,
    publishedAt: record.publishedAt ?? existing.publishedAt,
    provenance: {
      ...record.provenance,
      firstSeenAt: existing.provenance.firstSeenAt ?? existing.retrievedAt,
      lastSeenAt: record.retrievedAt,
      publisher: record.provenance.publisher ?? existing.provenance.publisher,
    },
  });
}

function isNearDuplicateResearchSource(
  left: RuntimeResearchSourceRecord,
  right: RuntimeResearchSourceRecord,
): boolean {
  if (left.canonicalUrl === right.canonicalUrl) {
    return true;
  }
  if (
    left.sourceKind === right.sourceKind &&
    normalizeText(left.title) === normalizeText(right.title) &&
    (left.publishedAt ?? "") === (right.publishedAt ?? "")
  ) {
    return true;
  }
  return false;
}

function compareResearchSourceRecency(
  left: RuntimeResearchSourceRecord,
  right: RuntimeResearchSourceRecord,
): number {
  return recencyTimestamp(right) - recencyTimestamp(left);
}

function recencyTimestamp(record: RuntimeResearchSourceRecord): number {
  const value = Date.parse(
    record.publishedAt ?? record.provenance.lastSeenAt ?? record.retrievedAt,
  );
  return Number.isNaN(value) ? 0 : value;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
