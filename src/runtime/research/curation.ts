import { z } from "zod";
import {
  RuntimeAssetRecordSchema,
  RuntimeBacktestBaselineSchema,
  RuntimeExecutionCostModelRecordSchema,
  RuntimeExecutionCostObservationRecordSchema,
  RuntimeFeatureDefinitionRecordSchema,
  RuntimeHistoricalDatasetSnapshotRecordSchema,
  RuntimeRegimeTagRecordSchema,
  RuntimeReplayCorpusRecordSchema,
  RuntimeResearchEvidenceBundleRecordSchema,
  RuntimeResearchExperimentRecordSchema,
  RuntimeResearchSourceRecordSchema,
  RuntimeVenueMarketTypeSchema,
} from "../contracts/autonomous_runtime.js";

const NON_EMPTY_STRING_SCHEMA = z.string().min(1);

export const RuntimeBacktestRunRequestSchema = z
  .object({
    reportId: NON_EMPTY_STRING_SCHEMA.optional(),
    experimentId: NON_EMPTY_STRING_SCHEMA,
    replayCorpusId: NON_EMPTY_STRING_SCHEMA,
    venueKey: NON_EMPTY_STRING_SCHEMA,
    pairSymbol: NON_EMPTY_STRING_SCHEMA,
    marketType: RuntimeVenueMarketTypeSchema,
    windowMode: z.enum(["rolling", "anchored"]),
    trainingWindowObservations: z.number().int().positive(),
    testingWindowObservations: z.number().int().positive(),
    stepObservations: z.number().int().positive(),
    purgeObservations: z.number().int().nonnegative(),
    baselineStrategies: z.array(RuntimeBacktestBaselineSchema).min(1),
  })
  .strict();

export const RuntimeResearchCurationRequestSchema = z
  .object({
    sources: z.array(RuntimeResearchSourceRecordSchema).optional(),
    assets: z.array(RuntimeAssetRecordSchema).optional(),
    datasetSnapshots: z
      .array(RuntimeHistoricalDatasetSnapshotRecordSchema)
      .optional(),
    replayCorpora: z.array(RuntimeReplayCorpusRecordSchema).optional(),
    featureDefinitions: z
      .array(RuntimeFeatureDefinitionRecordSchema)
      .optional(),
    regimeTags: z.array(RuntimeRegimeTagRecordSchema).optional(),
    costModels: z.array(RuntimeExecutionCostModelRecordSchema).optional(),
    costObservations: z
      .array(RuntimeExecutionCostObservationRecordSchema)
      .optional(),
    experiments: z.array(RuntimeResearchExperimentRecordSchema).optional(),
    evidenceBundles: z
      .array(RuntimeResearchEvidenceBundleRecordSchema)
      .optional(),
    backtests: z.array(RuntimeBacktestRunRequestSchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasPayload = Object.values(value).some(
      (entry) => Array.isArray(entry) && entry.length > 0,
    );
    if (!hasPayload) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "runtime-research-curation-request-empty",
      });
    }
  });

export type RuntimeBacktestRunRequest = z.infer<
  typeof RuntimeBacktestRunRequestSchema
>;

export type RuntimeResearchCurationRequest = z.infer<
  typeof RuntimeResearchCurationRequestSchema
>;

export function parseRuntimeBacktestRunRequest(
  input: unknown,
): RuntimeBacktestRunRequest {
  return RuntimeBacktestRunRequestSchema.parse(input);
}

export function parseRuntimeResearchCurationRequest(
  input: unknown,
): RuntimeResearchCurationRequest {
  return RuntimeResearchCurationRequestSchema.parse(input);
}
