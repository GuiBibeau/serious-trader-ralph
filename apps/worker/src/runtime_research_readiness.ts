import {
  parseRuntimeAssetRecord,
  parseRuntimeBacktestReport,
  parseRuntimeExecutionCostModelRecord,
  parseRuntimeExecutionCostObservationRecord,
  parseRuntimeFeatureDefinitionRecord,
  parseRuntimeHistoricalDatasetSnapshotRecord,
} from "../../../src/runtime/contracts/autonomous_runtime.js";
import {
  buildRuntimeResearchReadiness,
  buildRuntimeResearchReadinessCanaryMarkdown,
  buildRuntimeResearchReadinessMarkdown,
  buildRuntimeStrategyLabSubjectControlRecord,
  type RuntimeResearchReadinessCanaryRequest,
  type RuntimeResearchReadinessRequest,
} from "../../../src/runtime/research/readiness.js";
import { getRuntimeVenueCapability } from "../../../src/runtime/venues/catalog.js";
import { SUPPORTED_TRADING_PAIRS } from "./defaults";
import { resolveExecutionAdapterRegistration } from "./execution/router";
import {
  readRuntimeAssetRegistry,
  readRuntimeBacktests,
  readRuntimeCostModelRegistry,
  readRuntimeExecutionCostObservations,
  readRuntimeFeatureCatalogRegistry,
  readRuntimeHistoricalDataLake,
} from "./runtime_internal";
import {
  listRuntimeResearchReadinessCanaryWorkflow,
  runRuntimeResearchReadinessCanaryWorkflow,
} from "./strategy_lab_readiness_canary";
import {
  getStrategyLabReadinessArtifact,
  getStrategyLabReadinessCanaryRun,
  getStrategyLabSubjectControl,
  listStrategyLabReadinessArtifacts,
  listStrategyLabSubjectControls,
  writeStrategyLabReadinessArtifact,
  writeStrategyLabSubjectControl,
} from "./strategy_lab_readiness_repository";
import type { Env } from "./types";

type RuntimeResearchReadinessWorkflowResult = {
  readiness: Awaited<ReturnType<typeof writeStrategyLabReadinessArtifact>>;
  markdown: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveDefaultPairForAsset(assetKey: string): string | undefined {
  return SUPPORTED_TRADING_PAIRS.find(
    (pair) =>
      (pair.baseSymbol === assetKey || pair.quoteSymbol === assetKey) &&
      (pair.baseSymbol === "USDC" || pair.quoteSymbol === "USDC"),
  )?.id;
}

function pickAssetRecord(
  assetRecords: ReturnType<typeof parseRuntimeAssetRecords>,
  assetKey: string | undefined,
): ReturnType<typeof parseRuntimeAssetRecords>[number] | null {
  if (!assetKey) return assetRecords[0] ?? null;
  return assetRecords.find((record) => record.assetKey === assetKey) ?? null;
}

function resolveVenueKey(input: {
  request: RuntimeResearchReadinessRequest;
  assetRecord: ReturnType<typeof parseRuntimeAssetRecords>[number] | null;
}): string {
  if (input.request.venueKey) return input.request.venueKey;
  if (input.request.subjectKind === "venue") return input.request.subjectKey;
  return (
    input.assetRecord?.venueMappings.find((mapping) =>
      ["live", "paper", "shadow"].includes(mapping.listingState),
    )?.venueKey ?? "jupiter"
  );
}

function parseRuntimeAssetRecords(payload: Record<string, unknown>) {
  const raw =
    isRecord(payload.registry) && Array.isArray(payload.registry.assets)
      ? payload.registry.assets
      : [];
  return raw
    .map((entry) => {
      try {
        return parseRuntimeAssetRecord(entry);
      } catch {
        return null;
      }
    })
    .filter(
      (entry): entry is ReturnType<typeof parseRuntimeAssetRecord> =>
        entry !== null,
    );
}

function parseRuntimeDatasetSnapshots(payload: Record<string, unknown>) {
  const raw =
    isRecord(payload.registry) &&
    Array.isArray(payload.registry.datasetSnapshots)
      ? payload.registry.datasetSnapshots
      : [];
  return raw
    .map((entry) => {
      try {
        return parseRuntimeHistoricalDatasetSnapshotRecord(entry);
      } catch {
        return null;
      }
    })
    .filter(
      (
        entry,
      ): entry is ReturnType<
        typeof parseRuntimeHistoricalDatasetSnapshotRecord
      > => entry !== null,
    );
}

function parseRuntimeFeatureDefinitions(payload: Record<string, unknown>) {
  const raw =
    isRecord(payload.registry) &&
    Array.isArray(payload.registry.featureDefinitions)
      ? payload.registry.featureDefinitions
      : [];
  return raw
    .map((entry) => {
      try {
        return parseRuntimeFeatureDefinitionRecord(entry);
      } catch {
        return null;
      }
    })
    .filter(
      (
        entry,
      ): entry is ReturnType<typeof parseRuntimeFeatureDefinitionRecord> =>
        entry !== null,
    );
}

function parseRuntimeCostModels(payload: Record<string, unknown>) {
  const raw =
    isRecord(payload.registry) && Array.isArray(payload.registry.costModels)
      ? payload.registry.costModels
      : [];
  return raw
    .map((entry) => {
      try {
        return parseRuntimeExecutionCostModelRecord(entry);
      } catch {
        return null;
      }
    })
    .filter(
      (
        entry,
      ): entry is ReturnType<typeof parseRuntimeExecutionCostModelRecord> =>
        entry !== null,
    );
}

function parseRuntimeCostObservations(payload: Record<string, unknown>) {
  const raw =
    isRecord(payload.registry) &&
    Array.isArray(payload.registry.costObservations)
      ? payload.registry.costObservations
      : [];
  return raw
    .map((entry) => {
      try {
        return parseRuntimeExecutionCostObservationRecord(entry);
      } catch {
        return null;
      }
    })
    .filter(
      (
        entry,
      ): entry is ReturnType<
        typeof parseRuntimeExecutionCostObservationRecord
      > => entry !== null,
    );
}

function parseRuntimeBacktestReports(payload: Record<string, unknown>) {
  const raw = Array.isArray(payload.reports) ? payload.reports : [];
  return raw
    .map((entry) => {
      try {
        return parseRuntimeBacktestReport(entry);
      } catch {
        return null;
      }
    })
    .filter(
      (entry): entry is ReturnType<typeof parseRuntimeBacktestReport> =>
        entry !== null,
    );
}

function resolveAdapterKey(venueKey: string): string | undefined {
  const capability = getRuntimeVenueCapability(venueKey);
  if (!capability) return undefined;
  return capability.adapterKeys.find((candidate) => {
    const registration = resolveExecutionAdapterRegistration(candidate);
    return (
      registration !== null &&
      registration.venueKey === venueKey &&
      registration.supportedModes.includes("live")
    );
  });
}

function filterDatasetSnapshots(input: {
  snapshots: ReturnType<typeof parseRuntimeDatasetSnapshots>;
  venueKey: string;
  assetKey: string;
  pairSymbol: string;
}) {
  return input.snapshots.filter(
    (snapshot) =>
      snapshot.venueKeys.includes(input.venueKey) &&
      snapshot.assetKeys.includes(input.assetKey) &&
      snapshot.pairSymbols.includes(input.pairSymbol),
  );
}

function filterFeatureDefinitions(input: {
  featureDefinitions: ReturnType<typeof parseRuntimeFeatureDefinitions>;
  venueKey: string;
  assetKey: string;
  pairSymbol: string;
}) {
  return input.featureDefinitions.filter(
    (feature) =>
      feature.status === "active" &&
      feature.venueKeys.includes(input.venueKey) &&
      feature.assetKeys.includes(input.assetKey) &&
      feature.pairSymbols.includes(input.pairSymbol),
  );
}

function filterCostModels(input: {
  costModels: ReturnType<typeof parseRuntimeCostModels>;
  venueKey: string;
  assetKey: string;
  pairSymbol: string;
}) {
  return input.costModels.filter(
    (model) =>
      model.venueKey === input.venueKey &&
      model.assetKeys.includes(input.assetKey) &&
      model.pairSymbol === input.pairSymbol,
  );
}

function filterCostObservations(input: {
  costObservations: ReturnType<typeof parseRuntimeCostObservations>;
  modelIds: string[];
}) {
  return input.costObservations.filter((observation) =>
    input.modelIds.includes(observation.modelId),
  );
}

function filterBacktests(input: {
  reports: ReturnType<typeof parseRuntimeBacktestReports>;
  venueKey: string;
  assetKey: string;
}) {
  return input.reports.filter(
    (report) =>
      report.status === "completed" &&
      report.venueKeys.includes(input.venueKey) &&
      report.assetKeys.includes(input.assetKey),
  );
}

async function requireRuntimeInternalPayload(
  resultPromise: Promise<{ ok: boolean; payload: Record<string, unknown> }>,
  errorCode: string,
): Promise<Record<string, unknown>> {
  const result = await resultPromise;
  if (!result.ok) {
    throw new Error(String(result.payload.error ?? errorCode));
  }
  return result.payload;
}

export async function runRuntimeResearchReadinessWorkflow(input: {
  env: Env;
  request: RuntimeResearchReadinessRequest;
}): Promise<RuntimeResearchReadinessWorkflowResult> {
  const subjectAssetKey =
    input.request.subjectKind === "asset"
      ? input.request.subjectKey
      : (input.request.assetKey ?? "SOL");
  const assetPayload = await requireRuntimeInternalPayload(
    readRuntimeAssetRegistry({
      env: input.env,
      assetKey: subjectAssetKey,
    }),
    "runtime-research-readiness-asset-registry-read-failed",
  );
  const assetRecords = parseRuntimeAssetRecords(assetPayload);
  const assetRecord = pickAssetRecord(assetRecords, subjectAssetKey);
  const venueKey = resolveVenueKey({
    request: input.request,
    assetRecord,
  });
  const pairSymbol =
    input.request.pairSymbol ??
    resolveDefaultPairForAsset(assetRecord?.assetKey ?? subjectAssetKey) ??
    "SOL/USDC";
  const assetKey = assetRecord?.assetKey ?? subjectAssetKey;

  const [
    datasetPayload,
    featurePayload,
    costModelPayload,
    costObservationPayload,
    backtestPayload,
    venueControl,
    assetControl,
    canaryRun,
  ] = await Promise.all([
    requireRuntimeInternalPayload(
      readRuntimeHistoricalDataLake({
        env: input.env,
        venueKey,
        assetKey,
      }),
      "runtime-research-readiness-data-lake-read-failed",
    ),
    requireRuntimeInternalPayload(
      readRuntimeFeatureCatalogRegistry({
        env: input.env,
        venueKey,
        assetKey,
        pairSymbol,
        status: "active",
      }),
      "runtime-research-readiness-feature-registry-read-failed",
    ),
    requireRuntimeInternalPayload(
      readRuntimeCostModelRegistry({
        env: input.env,
        venueKey,
        assetKey,
        pairSymbol,
        marketType: "spot",
      }),
      "runtime-research-readiness-cost-model-read-failed",
    ),
    requireRuntimeInternalPayload(
      readRuntimeExecutionCostObservations({
        env: input.env,
        venueKey,
        assetKey,
        pairSymbol,
        marketType: "spot",
      }),
      "runtime-research-readiness-cost-observation-read-failed",
    ),
    requireRuntimeInternalPayload(
      readRuntimeBacktests({
        env: input.env,
        venueKey,
        assetKey,
        marketType: "spot",
        promotionEligible: true,
      }),
      "runtime-research-readiness-backtests-read-failed",
    ),
    getStrategyLabSubjectControl(input.env.WAITLIST_DB, "venue", venueKey),
    input.request.subjectKind === "asset"
      ? getStrategyLabSubjectControl(
          input.env.WAITLIST_DB,
          "asset",
          input.request.subjectKey,
        )
      : Promise.resolve(null),
    input.request.canaryRunId
      ? getStrategyLabReadinessCanaryRun(
          input.env.WAITLIST_DB,
          input.request.canaryRunId,
        )
      : Promise.resolve(null),
  ]);

  const datasetSnapshots = filterDatasetSnapshots({
    snapshots: parseRuntimeDatasetSnapshots(datasetPayload),
    venueKey,
    assetKey,
    pairSymbol,
  });
  const featureDefinitions = filterFeatureDefinitions({
    featureDefinitions: parseRuntimeFeatureDefinitions(featurePayload),
    venueKey,
    assetKey,
    pairSymbol,
  });
  const costModels = filterCostModels({
    costModels: parseRuntimeCostModels(costModelPayload),
    venueKey,
    assetKey,
    pairSymbol,
  });
  const costObservations = filterCostObservations({
    costObservations: parseRuntimeCostObservations(costObservationPayload),
    modelIds: costModels.map((model) => model.modelId),
  });
  const backtests = filterBacktests({
    reports: parseRuntimeBacktestReports(backtestPayload),
    venueKey,
    assetKey,
  });
  const venueCapability = getRuntimeVenueCapability(venueKey);
  const readiness = buildRuntimeResearchReadiness({
    request: {
      ...input.request,
      venueKey,
      assetKey,
      pairSymbol,
      adapterKey: input.request.adapterKey ?? resolveAdapterKey(venueKey),
      venueCapability,
      assetRecord,
      datasetSnapshots,
      featureDefinitions,
      costModels,
      costObservations,
      backtests,
      controls: {
        ...(venueControl ? { venue: venueControl } : {}),
        ...(assetControl ? { asset: assetControl } : {}),
      },
      ...(canaryRun ? { canaryRun } : {}),
    },
  });
  await writeStrategyLabReadinessArtifact(input.env.WAITLIST_DB, readiness);

  return {
    readiness,
    markdown: buildRuntimeResearchReadinessMarkdown(readiness),
  };
}

export async function listRuntimeResearchReadinessWorkflow(input: {
  env: Env;
  readinessId?: string;
  subjectKind?: "venue" | "asset";
  subjectKey?: string;
  limit?: number;
}): Promise<{
  readinessArtifacts: Awaited<
    ReturnType<typeof listStrategyLabReadinessArtifacts>
  >;
}> {
  if (input.readinessId) {
    const artifact = await getStrategyLabReadinessArtifact(
      input.env.WAITLIST_DB,
      input.readinessId,
    );
    return {
      readinessArtifacts: artifact ? [artifact] : [],
    };
  }

  return {
    readinessArtifacts: await listStrategyLabReadinessArtifacts(
      input.env.WAITLIST_DB,
      {
        subjectKind: input.subjectKind,
        subjectKey: input.subjectKey,
        limit: input.limit,
      },
    ),
  };
}

export async function upsertRuntimeResearchSubjectControlWorkflow(input: {
  env: Env;
  controlPatch: Parameters<
    typeof buildRuntimeStrategyLabSubjectControlRecord
  >[0]["patch"];
}): Promise<{
  control: Awaited<ReturnType<typeof writeStrategyLabSubjectControl>>;
}> {
  const existing = await getStrategyLabSubjectControl(
    input.env.WAITLIST_DB,
    input.controlPatch.subjectKind,
    input.controlPatch.subjectKey,
  );
  const control = buildRuntimeStrategyLabSubjectControlRecord({
    patch: input.controlPatch,
    existing,
  });
  await writeStrategyLabSubjectControl(input.env.WAITLIST_DB, control);
  return { control };
}

export async function listRuntimeResearchSubjectControlWorkflow(input: {
  env: Env;
  subjectKind?: "venue" | "asset";
  subjectKey?: string;
  limit?: number;
}): Promise<{
  controls: Awaited<ReturnType<typeof listStrategyLabSubjectControls>>;
}> {
  return {
    controls: await listStrategyLabSubjectControls(input.env.WAITLIST_DB, {
      subjectKind: input.subjectKind,
      subjectKey: input.subjectKey,
      limit: input.limit,
    }),
  };
}

export async function runRuntimeResearchReadinessCanaryWithMarkdown(input: {
  env: Env;
  request: RuntimeResearchReadinessCanaryRequest;
}): Promise<
  RuntimeResearchReadinessCanaryWorkflowResult & { markdown: string | null }
> {
  const result = await runRuntimeResearchReadinessCanaryWorkflow(input);
  return {
    ...result,
    markdown:
      result.run && !result.markdown
        ? buildRuntimeResearchReadinessCanaryMarkdown(result.run)
        : result.markdown,
  };
}

export { listRuntimeResearchReadinessCanaryWorkflow };
