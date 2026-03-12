import {
  parseRuntimeAssetRecord,
  parseRuntimeBacktestReport,
  parseRuntimeExecutionCostModelRecord,
  parseRuntimeExecutionCostObservationRecord,
  parseRuntimeFeatureDefinitionRecord,
  parseRuntimeHistoricalDatasetSnapshotRecord,
  parseRuntimeRegimeTagRecord,
  parseRuntimeReplayCorpusRecord,
  type RuntimeAssetRecord,
  type RuntimeBacktestReport,
  type RuntimeExecutionCostModelRecord,
  type RuntimeExecutionCostObservationRecord,
  type RuntimeFeatureDefinitionRecord,
  type RuntimeHistoricalDatasetSnapshotRecord,
  type RuntimeRegimeTagRecord,
  type RuntimeReplayCorpusRecord,
} from "../../../src/runtime/contracts/autonomous_runtime.js";
import {
  readRuntimeAssetRegistry,
  readRuntimeBacktests,
  readRuntimeCostModelRegistry,
  readRuntimeExecutionCostObservations,
  readRuntimeFeatureCatalogRegistry,
  readRuntimeHistoricalDataLake,
  readRuntimeResearchRegistry,
} from "./runtime_internal";
import type { Env } from "./types";

type RuntimeResearchSubstrateSnapshot = {
  research: Record<string, unknown> | null;
  assets: RuntimeAssetRecord[];
  datasetSnapshots: RuntimeHistoricalDatasetSnapshotRecord[];
  replayCorpora: RuntimeReplayCorpusRecord[];
  featureDefinitions: RuntimeFeatureDefinitionRecord[];
  regimeTags: RuntimeRegimeTagRecord[];
  costModels: RuntimeExecutionCostModelRecord[];
  costObservations: RuntimeExecutionCostObservationRecord[];
  backtests: RuntimeBacktestReport[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseArray<T>(value: unknown, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      try {
        return parse(entry);
      } catch {
        return null;
      }
    })
    .filter((entry): entry is T => entry !== null);
}

export async function readRuntimeResearchSubstrateSnapshot(input: {
  env: Env;
  strategyKey?: string;
  venueKey?: string;
  assetKey?: string;
  pairSymbol?: string;
  marketType?: string;
}): Promise<RuntimeResearchSubstrateSnapshot> {
  const [
    researchResult,
    assetResult,
    datasetResult,
    featureResult,
    costModelResult,
    costObservationResult,
    backtestResult,
  ] = await Promise.all([
    readRuntimeResearchRegistry({
      env: input.env,
      strategyKey: input.strategyKey,
      venueKey: input.venueKey,
      assetKey: input.assetKey,
    }),
    readRuntimeAssetRegistry({
      env: input.env,
      assetKey: input.assetKey,
      venueKey: input.venueKey,
    }),
    readRuntimeHistoricalDataLake({
      env: input.env,
      venueKey: input.venueKey,
      assetKey: input.assetKey,
    }),
    readRuntimeFeatureCatalogRegistry({
      env: input.env,
      venueKey: input.venueKey,
      assetKey: input.assetKey,
      pairSymbol: input.pairSymbol,
      marketType: input.marketType,
      status: "active",
    }),
    readRuntimeCostModelRegistry({
      env: input.env,
      venueKey: input.venueKey,
      assetKey: input.assetKey,
      pairSymbol: input.pairSymbol,
      marketType: input.marketType,
    }),
    readRuntimeExecutionCostObservations({
      env: input.env,
      venueKey: input.venueKey,
      assetKey: input.assetKey,
      pairSymbol: input.pairSymbol,
      marketType: input.marketType,
    }),
    readRuntimeBacktests({
      env: input.env,
      strategyKey: input.strategyKey,
      venueKey: input.venueKey,
      assetKey: input.assetKey,
      marketType: input.marketType,
    }),
  ]);

  for (const result of [
    researchResult,
    assetResult,
    datasetResult,
    featureResult,
    costModelResult,
    costObservationResult,
    backtestResult,
  ]) {
    if (!result.ok) {
      throw new Error(
        String(
          result.payload.error ?? "runtime-research-substrate-read-failed",
        ),
      );
    }
  }

  const datasetRegistry = isRecord(datasetResult.payload.registry)
    ? datasetResult.payload.registry
    : {};
  const featureRegistry = isRecord(featureResult.payload.registry)
    ? featureResult.payload.registry
    : {};
  const costRegistry = isRecord(costModelResult.payload.registry)
    ? costModelResult.payload.registry
    : {};
  const observationRegistry = isRecord(costObservationResult.payload.registry)
    ? costObservationResult.payload.registry
    : {};

  return {
    research: isRecord(researchResult.payload.registry)
      ? researchResult.payload.registry
      : null,
    assets: parseArray(
      isRecord(assetResult.payload.registry)
        ? assetResult.payload.registry.assets
        : [],
      parseRuntimeAssetRecord,
    ),
    datasetSnapshots: parseArray(
      datasetRegistry.datasetSnapshots,
      parseRuntimeHistoricalDatasetSnapshotRecord,
    ),
    replayCorpora: parseArray(
      datasetRegistry.replayCorpora,
      parseRuntimeReplayCorpusRecord,
    ),
    featureDefinitions: parseArray(
      featureRegistry.featureDefinitions,
      parseRuntimeFeatureDefinitionRecord,
    ),
    regimeTags: parseArray(
      featureRegistry.regimeTags,
      parseRuntimeRegimeTagRecord,
    ),
    costModels: parseArray(
      costRegistry.costModels,
      parseRuntimeExecutionCostModelRecord,
    ),
    costObservations: parseArray(
      observationRegistry.costObservations,
      parseRuntimeExecutionCostObservationRecord,
    ),
    backtests: parseArray(
      backtestResult.payload.reports,
      parseRuntimeBacktestReport,
    ),
  };
}
