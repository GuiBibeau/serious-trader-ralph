import {
  parseRuntimeAssetRecord,
  parseRuntimeBacktestReport,
  parseRuntimeExecutionCostModelRecord,
  parseRuntimeExecutionCostObservationRecord,
  parseRuntimeFeatureDefinitionRecord,
  parseRuntimeHistoricalDatasetSnapshotRecord,
  parseRuntimeRegimeTagRecord,
  parseRuntimeReplayCorpusRecord,
  parseRuntimeResearchEvidenceBundleRecord,
  parseRuntimeResearchExperimentRecord,
  parseRuntimeResearchHypothesisRecord,
  parseRuntimeResearchSourceRecord,
  type RuntimeAssetRecord,
  type RuntimeBacktestReport,
  type RuntimeExecutionCostModelRecord,
  type RuntimeExecutionCostObservationRecord,
  type RuntimeFeatureDefinitionRecord,
  type RuntimeHistoricalDatasetSnapshotRecord,
  type RuntimeRegimeTagRecord,
  type RuntimeReplayCorpusRecord,
  type RuntimeResearchEvidenceBundleRecord,
  type RuntimeResearchExperimentRecord,
  type RuntimeResearchHypothesisRecord,
  type RuntimeResearchSourceRecord,
} from "../../../src/runtime/contracts/autonomous_runtime.js";
import type { RuntimeResearchCurationRequest } from "../../../src/runtime/research/curation.js";
import {
  type RuntimeInternalJsonResult,
  runRuntimeBacktest,
  writeRuntimeAsset,
  writeRuntimeExecutionCostModel,
  writeRuntimeExecutionCostObservation,
  writeRuntimeFeatureDefinition,
  writeRuntimeHistoricalDatasetSnapshot,
  writeRuntimeRegimeTag,
  writeRuntimeReplayCorpus,
  writeRuntimeResearchEvidenceBundle,
  writeRuntimeResearchExperiment,
  writeRuntimeResearchHypothesis,
  writeRuntimeResearchSource,
} from "./runtime_internal";
import type { Env } from "./types";

type RuntimeResearchCurationWriteSummary<T> = {
  attempted: number;
  created: number;
  records: T[];
};

export type RuntimeResearchCurationSummary = {
  sources: RuntimeResearchCurationWriteSummary<RuntimeResearchSourceRecord>;
  hypotheses: RuntimeResearchCurationWriteSummary<RuntimeResearchHypothesisRecord>;
  assets: RuntimeResearchCurationWriteSummary<RuntimeAssetRecord>;
  datasetSnapshots: RuntimeResearchCurationWriteSummary<RuntimeHistoricalDatasetSnapshotRecord>;
  replayCorpora: RuntimeResearchCurationWriteSummary<RuntimeReplayCorpusRecord>;
  featureDefinitions: RuntimeResearchCurationWriteSummary<RuntimeFeatureDefinitionRecord>;
  regimeTags: RuntimeResearchCurationWriteSummary<RuntimeRegimeTagRecord>;
  costModels: RuntimeResearchCurationWriteSummary<RuntimeExecutionCostModelRecord>;
  costObservations: RuntimeResearchCurationWriteSummary<RuntimeExecutionCostObservationRecord>;
  experiments: RuntimeResearchCurationWriteSummary<RuntimeResearchExperimentRecord>;
  evidenceBundles: RuntimeResearchCurationWriteSummary<RuntimeResearchEvidenceBundleRecord>;
  backtests: RuntimeResearchCurationWriteSummary<RuntimeBacktestReport>;
};

export type RuntimeResearchCurationWorkflowResult = {
  summary: RuntimeResearchCurationSummary;
  markdown: string;
};

export type RuntimeResearchCurationIo = {
  writeRuntimeResearchSource: typeof writeRuntimeResearchSource;
  writeRuntimeResearchHypothesis: typeof writeRuntimeResearchHypothesis;
  writeRuntimeAsset: typeof writeRuntimeAsset;
  writeRuntimeHistoricalDatasetSnapshot: typeof writeRuntimeHistoricalDatasetSnapshot;
  writeRuntimeReplayCorpus: typeof writeRuntimeReplayCorpus;
  writeRuntimeFeatureDefinition: typeof writeRuntimeFeatureDefinition;
  writeRuntimeRegimeTag: typeof writeRuntimeRegimeTag;
  writeRuntimeExecutionCostModel: typeof writeRuntimeExecutionCostModel;
  writeRuntimeExecutionCostObservation: typeof writeRuntimeExecutionCostObservation;
  writeRuntimeResearchExperiment: typeof writeRuntimeResearchExperiment;
  runRuntimeBacktest: typeof runRuntimeBacktest;
  writeRuntimeResearchEvidenceBundle: typeof writeRuntimeResearchEvidenceBundle;
};

const defaultRuntimeResearchCurationIo: RuntimeResearchCurationIo = {
  writeRuntimeResearchSource,
  writeRuntimeResearchHypothesis,
  writeRuntimeAsset,
  writeRuntimeHistoricalDatasetSnapshot,
  writeRuntimeReplayCorpus,
  writeRuntimeFeatureDefinition,
  writeRuntimeRegimeTag,
  writeRuntimeExecutionCostModel,
  writeRuntimeExecutionCostObservation,
  writeRuntimeResearchExperiment,
  runRuntimeBacktest,
  writeRuntimeResearchEvidenceBundle,
};

function createdFromResponse(response: RuntimeInternalJsonResult): boolean {
  return response.payload.created === true || response.status === 201;
}

export function resolvePersistedCollectionRecord<T>(input: {
  payloadValue: unknown;
  fallbackValue: T;
  parseItem: (value: unknown) => T;
}): T {
  try {
    return input.parseItem(input.payloadValue ?? input.fallbackValue);
  } catch {
    return input.parseItem(input.fallbackValue);
  }
}

async function persistCollection<T>(input: {
  items: T[] | undefined;
  writeItem: (item: T) => Promise<RuntimeInternalJsonResult>;
  parseItem: (value: unknown) => T;
  selectPayloadItem: (payload: Record<string, unknown>) => unknown;
}): Promise<RuntimeResearchCurationWriteSummary<T>> {
  const items = input.items ?? [];
  const records: T[] = [];
  let created = 0;

  for (const item of items) {
    const response = await input.writeItem(item);
    if (!response.ok) {
      throw new Error(
        String(
          response.payload.error ?? "runtime-research-curation-write-failed",
        ),
      );
    }
    if (createdFromResponse(response)) {
      created += 1;
    }
    const payloadValue = input.selectPayloadItem(response.payload);
    records.push(
      resolvePersistedCollectionRecord({
        payloadValue,
        fallbackValue: item,
        parseItem: input.parseItem,
      }),
    );
  }

  return {
    attempted: items.length,
    created,
    records,
  };
}

function buildSection<T>(
  title: string,
  summary: RuntimeResearchCurationWriteSummary<T>,
  idSelector: (record: T) => string,
): string[] {
  if (summary.attempted < 1) return [];
  const lines = [
    `### ${title}`,
    `- attempted: ${summary.attempted}`,
    `- created: ${summary.created}`,
  ];
  for (const record of summary.records.slice(0, 8)) {
    lines.push(`- ${idSelector(record)}`);
  }
  return lines;
}

export function buildRuntimeResearchCurationMarkdown(
  summary: RuntimeResearchCurationSummary,
): string {
  const lines = ["## Strategy Lab Curation", ""];

  for (const section of [
    buildSection("Sources", summary.sources, (record) => record.sourceId),
    buildSection(
      "Hypotheses",
      summary.hypotheses,
      (record) => record.hypothesisId,
    ),
    buildSection("Assets", summary.assets, (record) => record.assetKey),
    buildSection(
      "Dataset Snapshots",
      summary.datasetSnapshots,
      (record) => `${record.datasetId}:${record.snapshotId}`,
    ),
    buildSection(
      "Replay Corpora",
      summary.replayCorpora,
      (record) => record.corpusId,
    ),
    buildSection(
      "Feature Definitions",
      summary.featureDefinitions,
      (record) => record.featureId,
    ),
    buildSection(
      "Regime Tags",
      summary.regimeTags,
      (record) => record.regimeTagId,
    ),
    buildSection("Cost Models", summary.costModels, (record) => record.modelId),
    buildSection(
      "Cost Observations",
      summary.costObservations,
      (record) => record.observationId,
    ),
    buildSection(
      "Experiments",
      summary.experiments,
      (record) => record.experimentId,
    ),
    buildSection(
      "Evidence Bundles",
      summary.evidenceBundles,
      (record) => record.evidenceBundleId,
    ),
    buildSection("Backtests", summary.backtests, (record) => record.reportId),
  ]) {
    if (section.length < 1) continue;
    lines.push(...section, "");
  }

  return `${lines.join("\n").trim()}\n`;
}

export async function runRuntimeResearchCurationWorkflow(input: {
  env: Env;
  request: RuntimeResearchCurationRequest;
  io?: RuntimeResearchCurationIo;
}): Promise<RuntimeResearchCurationWorkflowResult> {
  const io = input.io ?? defaultRuntimeResearchCurationIo;
  const summary: RuntimeResearchCurationSummary = {
    sources: await persistCollection({
      items: input.request.sources,
      writeItem: async (sourceRecord) =>
        await io.writeRuntimeResearchSource({ env: input.env, sourceRecord }),
      parseItem: parseRuntimeResearchSourceRecord,
      selectPayloadItem: (payload) => payload.sourceRecord ?? payload.record,
    }),
    hypotheses: await persistCollection({
      items: input.request.hypotheses,
      writeItem: async (hypothesis) =>
        await io.writeRuntimeResearchHypothesis({ env: input.env, hypothesis }),
      parseItem: parseRuntimeResearchHypothesisRecord,
      selectPayloadItem: (payload) => payload.hypothesis ?? payload.record,
    }),
    assets: await persistCollection({
      items: input.request.assets,
      writeItem: async (asset) =>
        await io.writeRuntimeAsset({ env: input.env, asset }),
      parseItem: parseRuntimeAssetRecord,
      selectPayloadItem: (payload) => payload.asset ?? payload.record,
    }),
    datasetSnapshots: await persistCollection({
      items: input.request.datasetSnapshots,
      writeItem: async (datasetSnapshot) =>
        await io.writeRuntimeHistoricalDatasetSnapshot({
          env: input.env,
          datasetSnapshot,
        }),
      parseItem: parseRuntimeHistoricalDatasetSnapshotRecord,
      selectPayloadItem: (payload) => payload.datasetSnapshot ?? payload.record,
    }),
    replayCorpora: await persistCollection({
      items: input.request.replayCorpora,
      writeItem: async (replayCorpus) =>
        await io.writeRuntimeReplayCorpus({ env: input.env, replayCorpus }),
      parseItem: parseRuntimeReplayCorpusRecord,
      selectPayloadItem: (payload) => payload.replayCorpus ?? payload.record,
    }),
    featureDefinitions: await persistCollection({
      items: input.request.featureDefinitions,
      writeItem: async (featureDefinition) =>
        await io.writeRuntimeFeatureDefinition({
          env: input.env,
          featureDefinition,
        }),
      parseItem: parseRuntimeFeatureDefinitionRecord,
      selectPayloadItem: (payload) =>
        payload.featureDefinition ?? payload.record,
    }),
    regimeTags: await persistCollection({
      items: input.request.regimeTags,
      writeItem: async (regimeTag) =>
        await io.writeRuntimeRegimeTag({ env: input.env, regimeTag }),
      parseItem: parseRuntimeRegimeTagRecord,
      selectPayloadItem: (payload) => payload.regimeTag ?? payload.record,
    }),
    costModels: await persistCollection({
      items: input.request.costModels,
      writeItem: async (costModel) =>
        await io.writeRuntimeExecutionCostModel({
          env: input.env,
          costModel,
        }),
      parseItem: parseRuntimeExecutionCostModelRecord,
      selectPayloadItem: (payload) => payload.costModel ?? payload.record,
    }),
    costObservations: await persistCollection({
      items: input.request.costObservations,
      writeItem: async (costObservation) =>
        await io.writeRuntimeExecutionCostObservation({
          env: input.env,
          costObservation,
        }),
      parseItem: parseRuntimeExecutionCostObservationRecord,
      selectPayloadItem: (payload) => payload.costObservation ?? payload.record,
    }),
    experiments: await persistCollection({
      items: input.request.experiments,
      writeItem: async (experiment) =>
        await io.writeRuntimeResearchExperiment({ env: input.env, experiment }),
      parseItem: parseRuntimeResearchExperimentRecord,
      selectPayloadItem: (payload) => payload.experiment ?? payload.record,
    }),
    backtests: await persistCollection({
      items: input.request.backtests,
      writeItem: async (payload) =>
        await io.runRuntimeBacktest({ env: input.env, payload }),
      parseItem: parseRuntimeBacktestReport,
      selectPayloadItem: (payload) => payload.report ?? payload.record,
    }),
    // Backtests must be persisted before evidence bundles so same-request
    // promotions can reference freshly created runtime-backtest artifacts.
    evidenceBundles: await persistCollection({
      items: input.request.evidenceBundles,
      writeItem: async (evidenceBundle) =>
        await io.writeRuntimeResearchEvidenceBundle({
          env: input.env,
          evidenceBundle,
        }),
      parseItem: parseRuntimeResearchEvidenceBundleRecord,
      selectPayloadItem: (payload) => payload.evidenceBundle ?? payload.record,
    }),
  };

  return {
    summary,
    markdown: buildRuntimeResearchCurationMarkdown(summary),
  };
}
