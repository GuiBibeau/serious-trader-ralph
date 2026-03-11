import { z } from "zod";

export const RUNTIME_PROTOCOL_SCHEMA_FAMILY = "runtime" as const;
export const RUNTIME_PROTOCOL_SCHEMA_VERSION = "v1" as const;
export const DEFAULT_RUNTIME_VENUE_KEY = "jupiter" as const;

const ISO_DATETIME_SCHEMA = z.string().datetime({ offset: true });
const NON_EMPTY_STRING_SCHEMA = z.string().min(1);
const PUBKEY_SCHEMA = z.string().min(32).max(64);
const DECIMAL_STRING_SCHEMA = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/, "invalid-decimal-string");
const NUMERIC_STRING_SCHEMA = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/, "invalid-numeric-string");
const BPS_SCHEMA = z.number().int().min(0).max(10_000);

const VersionedSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_PROTOCOL_SCHEMA_VERSION),
  })
  .strict();

const PairSchema = z
  .object({
    symbol: NON_EMPTY_STRING_SCHEMA,
    baseMint: PUBKEY_SCHEMA,
    quoteMint: PUBKEY_SCHEMA,
  })
  .strict();

export const RuntimeModeSchema = z.enum(["shadow", "paper", "live"]);
export const RuntimeLaneSchema = z.enum(["safe", "protected", "fast"]);
export const RuntimeDeploymentStateSchema = z.enum([
  "draft",
  "shadow",
  "paper",
  "live",
  "paused",
  "killed",
  "archived",
]);
export const RuntimeRunStateSchema = z.enum([
  "pending",
  "risk_checked",
  "planned",
  "submitted",
  "receipt_pending",
  "reconciled",
  "needs_manual_review",
  "completed",
  "rejected",
  "failed",
  "killed",
]);

const RuntimeCapitalSchema = z
  .object({
    allocatedUsd: DECIMAL_STRING_SCHEMA,
    reservedUsd: DECIMAL_STRING_SCHEMA,
    availableUsd: DECIMAL_STRING_SCHEMA,
  })
  .strict();

const RuntimePolicySchema = z
  .object({
    maxNotionalUsd: DECIMAL_STRING_SCHEMA,
    dailyLossLimitUsd: DECIMAL_STRING_SCHEMA,
    maxSlippageBps: BPS_SCHEMA,
    maxConcurrentRuns: z.number().int().positive(),
    rebalanceToleranceBps: BPS_SCHEMA,
  })
  .strict();

export const RuntimeDeploymentRecordSchema = VersionedSchema.extend({
  deploymentId: NON_EMPTY_STRING_SCHEMA,
  strategyKey: NON_EMPTY_STRING_SCHEMA,
  sleeveId: NON_EMPTY_STRING_SCHEMA,
  ownerUserId: NON_EMPTY_STRING_SCHEMA,
  venueKey: NON_EMPTY_STRING_SCHEMA.default(DEFAULT_RUNTIME_VENUE_KEY),
  pair: PairSchema,
  mode: RuntimeModeSchema,
  state: RuntimeDeploymentStateSchema,
  lane: RuntimeLaneSchema,
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  promotedAt: ISO_DATETIME_SCHEMA.optional(),
  pausedAt: ISO_DATETIME_SCHEMA.optional(),
  killedAt: ISO_DATETIME_SCHEMA.optional(),
  policy: RuntimePolicySchema,
  capital: RuntimeCapitalSchema,
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
}).strict();

const RuntimeTriggerSchema = z
  .object({
    kind: z.enum(["cron", "signal", "rebalance", "operator", "canary"]),
    source: NON_EMPTY_STRING_SCHEMA,
    observedAt: ISO_DATETIME_SCHEMA,
    featureSnapshotId: NON_EMPTY_STRING_SCHEMA.optional(),
    reason: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeRunRecordSchema = VersionedSchema.extend({
  runId: NON_EMPTY_STRING_SCHEMA,
  deploymentId: NON_EMPTY_STRING_SCHEMA,
  runKey: NON_EMPTY_STRING_SCHEMA,
  trigger: RuntimeTriggerSchema,
  state: RuntimeRunStateSchema,
  plannedAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  riskVerdictId: NON_EMPTY_STRING_SCHEMA.optional(),
  executionPlanId: NON_EMPTY_STRING_SCHEMA.optional(),
  submitRequestId: NON_EMPTY_STRING_SCHEMA.optional(),
  receiptId: NON_EMPTY_STRING_SCHEMA.optional(),
  failureCode: NON_EMPTY_STRING_SCHEMA.optional(),
  failureMessage: NON_EMPTY_STRING_SCHEMA.optional(),
}).strict();

const RuntimeLedgerBalanceSchema = z
  .object({
    mint: PUBKEY_SCHEMA,
    symbol: NON_EMPTY_STRING_SCHEMA,
    decimals: z.number().int().nonnegative(),
    freeAtomic: NUMERIC_STRING_SCHEMA,
    reservedAtomic: NUMERIC_STRING_SCHEMA,
    priceUsd: DECIMAL_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeLedgerPositionSchema = z
  .object({
    instrumentId: NON_EMPTY_STRING_SCHEMA,
    side: z.enum(["long", "short", "flat"]),
    quantityAtomic: NUMERIC_STRING_SCHEMA,
    entryPriceUsd: DECIMAL_STRING_SCHEMA.optional(),
    markPriceUsd: DECIMAL_STRING_SCHEMA.optional(),
    unrealizedPnlUsd: NUMERIC_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeLedgerSnapshotSchema = VersionedSchema.extend({
  snapshotId: NON_EMPTY_STRING_SCHEMA,
  deploymentId: NON_EMPTY_STRING_SCHEMA,
  sleeveId: NON_EMPTY_STRING_SCHEMA,
  asOf: ISO_DATETIME_SCHEMA,
  balances: z.array(RuntimeLedgerBalanceSchema),
  positions: z.array(RuntimeLedgerPositionSchema),
  totals: z
    .object({
      equityUsd: DECIMAL_STRING_SCHEMA,
      reservedUsd: DECIMAL_STRING_SCHEMA,
      availableUsd: DECIMAL_STRING_SCHEMA,
      realizedPnlUsd: NUMERIC_STRING_SCHEMA,
      unrealizedPnlUsd: NUMERIC_STRING_SCHEMA,
    })
    .strict(),
}).strict();

const RuntimeRiskReasonSchema = z
  .object({
    code: NON_EMPTY_STRING_SCHEMA,
    message: NON_EMPTY_STRING_SCHEMA,
    severity: z.enum(["info", "warn", "error"]),
  })
  .strict();

export const RuntimeRiskVerdictSchema = VersionedSchema.extend({
  verdictId: NON_EMPTY_STRING_SCHEMA,
  deploymentId: NON_EMPTY_STRING_SCHEMA,
  runId: NON_EMPTY_STRING_SCHEMA,
  decidedAt: ISO_DATETIME_SCHEMA,
  verdict: z.enum(["allow", "reject", "pause"]),
  reasons: z.array(RuntimeRiskReasonSchema).min(1),
  observed: z
    .object({
      requestedNotionalUsd: DECIMAL_STRING_SCHEMA,
      reservedUsd: DECIMAL_STRING_SCHEMA,
      concentrationBps: BPS_SCHEMA,
      featureAgeMs: z.number().int().nonnegative(),
    })
    .strict(),
  limits: z
    .object({
      maxNotionalUsd: DECIMAL_STRING_SCHEMA,
      maxReservedUsd: DECIMAL_STRING_SCHEMA,
      maxConcentrationBps: BPS_SCHEMA,
      staleAfterMs: z.number().int().positive(),
    })
    .strict(),
}).strict();

const RuntimeExecutionSliceSchema = z
  .object({
    sliceId: NON_EMPTY_STRING_SCHEMA,
    action: z.enum(["buy", "sell", "rebalance"]),
    inputMint: PUBKEY_SCHEMA,
    outputMint: PUBKEY_SCHEMA,
    inputAmountAtomic: DECIMAL_STRING_SCHEMA,
    minOutputAmountAtomic: DECIMAL_STRING_SCHEMA.optional(),
    notionalUsd: DECIMAL_STRING_SCHEMA,
    slippageBps: BPS_SCHEMA,
  })
  .strict();

export const RuntimeExecutionPlanSchema = VersionedSchema.extend({
  planId: NON_EMPTY_STRING_SCHEMA,
  deploymentId: NON_EMPTY_STRING_SCHEMA,
  venueKey: NON_EMPTY_STRING_SCHEMA.default(DEFAULT_RUNTIME_VENUE_KEY),
  ownerUserId: NON_EMPTY_STRING_SCHEMA.optional(),
  sleeveId: NON_EMPTY_STRING_SCHEMA.optional(),
  runId: NON_EMPTY_STRING_SCHEMA,
  createdAt: ISO_DATETIME_SCHEMA,
  mode: RuntimeModeSchema,
  lane: RuntimeLaneSchema,
  idempotencyKey: NON_EMPTY_STRING_SCHEMA,
  simulateOnly: z.boolean(),
  dryRun: z.boolean(),
  slices: z.array(RuntimeExecutionSliceSchema).min(1),
}).strict();

const RuntimeWalletDeltaSchema = z
  .object({
    mint: PUBKEY_SCHEMA,
    expectedAtomic: NUMERIC_STRING_SCHEMA,
    actualAtomic: NUMERIC_STRING_SCHEMA,
    deltaAtomic: NUMERIC_STRING_SCHEMA,
  })
  .strict();

export const RuntimeReconciliationResultSchema = VersionedSchema.extend({
  reconciliationId: NON_EMPTY_STRING_SCHEMA,
  deploymentId: NON_EMPTY_STRING_SCHEMA,
  runId: NON_EMPTY_STRING_SCHEMA,
  receiptId: NON_EMPTY_STRING_SCHEMA,
  completedAt: ISO_DATETIME_SCHEMA,
  status: z.enum(["passed", "needs_manual_review", "failed"]),
  walletDeltas: z.array(RuntimeWalletDeltaSchema).min(1),
  positionDeltaUsd: NUMERIC_STRING_SCHEMA,
  notes: z.array(NON_EMPTY_STRING_SCHEMA),
  correctionApplied: z.boolean(),
}).strict();

export const RuntimeResearchHypothesisStatusSchema = z.enum([
  "candidate",
  "testing",
  "promoted",
  "rejected",
  "archived",
]);

export const RuntimeResearchSourceKindSchema = z.enum([
  "paper",
  "article",
  "repository",
  "dataset",
  "notebook",
  "internal_note",
  "market_report",
]);

export const RuntimeResearchSourceAcquisitionKindSchema = z.enum([
  "manual_url",
  "paper_feed",
  "venue_docs",
]);

export const RuntimeResearchExperimentStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "archived",
]);

export const RuntimeResearchEvidenceStatusSchema = z.enum([
  "draft",
  "ready_for_review",
  "approved",
  "rejected",
  "superseded",
]);

export const RuntimeBacktestStatusSchema = z.enum([
  "completed",
  "blocked",
  "failed",
]);

export const RuntimeBacktestWindowModeSchema = z.enum(["rolling", "expanding"]);

export const RuntimeBacktestBaselineSchema = z.enum([
  "flat_cash",
  "buy_and_hold",
]);

const RuntimeResearchCitationSchema = z
  .object({
    sourceId: NON_EMPTY_STRING_SCHEMA,
    locator: NON_EMPTY_STRING_SCHEMA.optional(),
    materialDigest: NON_EMPTY_STRING_SCHEMA.optional(),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeCodeRevisionRefSchema = z
  .object({
    vcs: NON_EMPTY_STRING_SCHEMA,
    repository: NON_EMPTY_STRING_SCHEMA,
    revision: NON_EMPTY_STRING_SCHEMA,
    comparedTo: NON_EMPTY_STRING_SCHEMA.optional(),
    treeDirty: z.boolean(),
  })
  .strict();

const RuntimeDatasetSnapshotRefSchema = z
  .object({
    datasetId: NON_EMPTY_STRING_SCHEMA,
    snapshotId: NON_EMPTY_STRING_SCHEMA,
    capturedAt: ISO_DATETIME_SCHEMA,
    uri: NON_EMPTY_STRING_SCHEMA.optional(),
    contentDigest: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeArtifactRefSchema = z
  .object({
    artifactId: NON_EMPTY_STRING_SCHEMA,
    kind: NON_EMPTY_STRING_SCHEMA,
    uri: NON_EMPTY_STRING_SCHEMA,
    contentDigest: NON_EMPTY_STRING_SCHEMA.optional(),
    createdAt: ISO_DATETIME_SCHEMA.optional(),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeHistoricalDatasetAcquisitionKindSchema = z.enum([
  "exchange_export",
  "rpc_archive",
  "research_fixture",
  "manual_import",
  "derived",
]);

export const RuntimeHistoricalDatasetKindSchema = z.enum([
  "trades",
  "bars",
  "order_book_l2",
  "funding_rates",
  "borrow_rates",
  "reference_metadata",
  "market_events",
  "slot_events",
]);

export const RuntimeDatasetNormalizationKindSchema = z.enum([
  "raw",
  "normalized",
  "aggregated",
  "replay_ready",
]);

export const RuntimeDatasetStorageFormatSchema = z.enum([
  "json",
  "jsonl",
  "parquet",
  "csv",
  "fixture_json",
]);

export const RuntimeDatasetRetentionClassSchema = z.enum([
  "seed",
  "research",
  "production",
]);

export const RuntimeReplayCorpusKindSchema = z.enum([
  "feed_gateway_v1",
  "bar_series_v1",
  "order_book_l2_v1",
]);

const RuntimeHistoricalDatasetProvenanceSchema = z
  .object({
    acquisitionKind: RuntimeHistoricalDatasetAcquisitionKindSchema,
    collectedFrom: NON_EMPTY_STRING_SCHEMA,
    provider: NON_EMPTY_STRING_SCHEMA.optional(),
    collectedAt: ISO_DATETIME_SCHEMA,
    generator: NON_EMPTY_STRING_SCHEMA.optional(),
    generatorRevision: NON_EMPTY_STRING_SCHEMA.optional(),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeHistoricalDatasetSnapshotRecordSchema =
  VersionedSchema.extend({
    datasetId: NON_EMPTY_STRING_SCHEMA,
    snapshotId: NON_EMPTY_STRING_SCHEMA,
    datasetKind: RuntimeHistoricalDatasetKindSchema,
    normalizationKind: RuntimeDatasetNormalizationKindSchema,
    format: RuntimeDatasetStorageFormatSchema,
    retentionClass: RuntimeDatasetRetentionClassSchema,
    capturedAt: ISO_DATETIME_SCHEMA,
    coverageStartAt: ISO_DATETIME_SCHEMA,
    coverageEndAt: ISO_DATETIME_SCHEMA,
    rowCount: z.number().int().nonnegative(),
    venueKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
    assetKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
    pairSymbols: z.array(NON_EMPTY_STRING_SCHEMA),
    chainKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
    uri: NON_EMPTY_STRING_SCHEMA,
    contentDigest: NON_EMPTY_STRING_SCHEMA,
    compression: NON_EMPTY_STRING_SCHEMA.optional(),
    timeBucketSeconds: z.number().int().positive().optional(),
    provenance: RuntimeHistoricalDatasetProvenanceSchema,
    samplingNotes: NON_EMPTY_STRING_SCHEMA.optional(),
    compactionNotes: NON_EMPTY_STRING_SCHEMA.optional(),
    tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  }).strict();

export const RuntimeReplayCorpusRecordSchema = VersionedSchema.extend({
  corpusId: NON_EMPTY_STRING_SCHEMA,
  title: NON_EMPTY_STRING_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
  replayKind: RuntimeReplayCorpusKindSchema,
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  venueKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  assetKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  pairSymbols: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  chainKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  datasetSnapshots: z.array(RuntimeDatasetSnapshotRefSchema).min(1),
  fixtureUri: NON_EMPTY_STRING_SCHEMA.optional(),
  contentDigest: NON_EMPTY_STRING_SCHEMA.optional(),
  deterministicSeed: z.number().int().nonnegative().optional(),
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
  notes: NON_EMPTY_STRING_SCHEMA.optional(),
}).strict();

const RuntimeResearchSourceProvenanceSchema = z
  .object({
    acquisitionKind: RuntimeResearchSourceAcquisitionKindSchema,
    collectedFrom: NON_EMPTY_STRING_SCHEMA,
    hostname: NON_EMPTY_STRING_SCHEMA,
    publisher: NON_EMPTY_STRING_SCHEMA.optional(),
    firstSeenAt: ISO_DATETIME_SCHEMA.optional(),
    lastSeenAt: ISO_DATETIME_SCHEMA,
  })
  .strict();

export const RuntimeResearchHypothesisRecordSchema = VersionedSchema.extend({
  hypothesisId: NON_EMPTY_STRING_SCHEMA,
  strategyKey: NON_EMPTY_STRING_SCHEMA,
  title: NON_EMPTY_STRING_SCHEMA,
  thesis: NON_EMPTY_STRING_SCHEMA,
  status: RuntimeResearchHypothesisStatusSchema,
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  venueKeys: z.array(NON_EMPTY_STRING_SCHEMA),
  assetKeys: z.array(NON_EMPTY_STRING_SCHEMA),
  sourceCitations: z.array(RuntimeResearchCitationSchema),
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
}).strict();

export const RuntimeResearchSourceRecordSchema = VersionedSchema.extend({
  sourceId: NON_EMPTY_STRING_SCHEMA,
  sourceKind: RuntimeResearchSourceKindSchema,
  title: NON_EMPTY_STRING_SCHEMA,
  url: NON_EMPTY_STRING_SCHEMA,
  canonicalUrl: NON_EMPTY_STRING_SCHEMA,
  authors: z.array(NON_EMPTY_STRING_SCHEMA),
  publishedAt: ISO_DATETIME_SCHEMA.optional(),
  retrievedAt: ISO_DATETIME_SCHEMA,
  contentDigest: NON_EMPTY_STRING_SCHEMA,
  provenance: RuntimeResearchSourceProvenanceSchema,
  venueKeys: z.array(NON_EMPTY_STRING_SCHEMA),
  assetKeys: z.array(NON_EMPTY_STRING_SCHEMA),
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
}).strict();

export const RuntimeResearchExperimentRecordSchema = VersionedSchema.extend({
  experimentId: NON_EMPTY_STRING_SCHEMA,
  hypothesisId: NON_EMPTY_STRING_SCHEMA,
  strategyKey: NON_EMPTY_STRING_SCHEMA,
  status: RuntimeResearchExperimentStatusSchema,
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  completedAt: ISO_DATETIME_SCHEMA.optional(),
  venueKeys: z.array(NON_EMPTY_STRING_SCHEMA),
  assetKeys: z.array(NON_EMPTY_STRING_SCHEMA),
  sourceCitations: z.array(RuntimeResearchCitationSchema),
  codeRevision: RuntimeCodeRevisionRefSchema,
  datasetSnapshots: z.array(RuntimeDatasetSnapshotRefSchema).min(1),
  artifacts: z.array(RuntimeArtifactRefSchema),
  summary: NON_EMPTY_STRING_SCHEMA,
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
}).strict();

export const RuntimeResearchEvidenceBundleRecordSchema = VersionedSchema.extend(
  {
    evidenceBundleId: NON_EMPTY_STRING_SCHEMA,
    experimentId: NON_EMPTY_STRING_SCHEMA,
    strategyKey: NON_EMPTY_STRING_SCHEMA,
    status: RuntimeResearchEvidenceStatusSchema,
    promotionTarget: NON_EMPTY_STRING_SCHEMA,
    createdAt: ISO_DATETIME_SCHEMA,
    updatedAt: ISO_DATETIME_SCHEMA,
    venueKeys: z.array(NON_EMPTY_STRING_SCHEMA),
    assetKeys: z.array(NON_EMPTY_STRING_SCHEMA),
    sourceCitations: z.array(RuntimeResearchCitationSchema),
    codeRevision: RuntimeCodeRevisionRefSchema,
    datasetSnapshots: z.array(RuntimeDatasetSnapshotRefSchema).min(1),
    artifacts: z.array(RuntimeArtifactRefSchema).min(1),
    summary: NON_EMPTY_STRING_SCHEMA,
    tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
  },
).strict();

export const RuntimeVenueMarketTypeSchema = z.enum(["spot", "perp", "options"]);

export const RuntimeVenueOrderTypeSchema = z.enum([
  "market",
  "limit",
  "auction",
  "twap",
]);

export const RuntimeVenueAuthModelSchema = z.enum([
  "privy_solana_wallet",
  "server_signer",
]);

export const RuntimeVenueFeeModelSchema = z.enum([
  "venue_quote_inclusive",
  "maker_taker_bps",
  "fixed_bps",
]);

export const RuntimeVenueSettlementBehaviorSchema = z.enum([
  "swap_atomic",
  "orderbook_atomic",
  "orderbook_partial",
]);

const RuntimeBacktestConfigSchema = z
  .object({
    replayCorpusId: NON_EMPTY_STRING_SCHEMA,
    venueKey: NON_EMPTY_STRING_SCHEMA,
    pairSymbol: NON_EMPTY_STRING_SCHEMA,
    marketType: RuntimeVenueMarketTypeSchema,
    windowMode: RuntimeBacktestWindowModeSchema,
    trainingWindowObservations: z.number().int().positive(),
    testingWindowObservations: z.number().int().positive(),
    stepObservations: z.number().int().positive(),
    purgeObservations: z.number().int().nonnegative(),
    baselineStrategies: z.array(RuntimeBacktestBaselineSchema).min(1),
  })
  .strict();

const RuntimeBacktestMetricsSchema = z
  .object({
    observationCount: z.number().int().nonnegative(),
    tradeCount: z.number().int().nonnegative(),
    grossReturnBps: NUMERIC_STRING_SCHEMA,
    netReturnBps: NUMERIC_STRING_SCHEMA,
    totalCostBps: NUMERIC_STRING_SCHEMA,
    winRateBps: BPS_SCHEMA,
    maxDrawdownBps: NUMERIC_STRING_SCHEMA,
  })
  .strict();

const RuntimeBacktestBaselineComparisonSchema = z
  .object({
    baseline: RuntimeBacktestBaselineSchema,
    baselineReturnBps: NUMERIC_STRING_SCHEMA,
    excessReturnBps: NUMERIC_STRING_SCHEMA,
  })
  .strict();

const RuntimeBacktestRegimeMetricsSchema = z
  .object({
    regimeKey: NON_EMPTY_STRING_SCHEMA,
    regimeValue: NON_EMPTY_STRING_SCHEMA,
    observationCount: z.number().int().nonnegative(),
    tradeCount: z.number().int().nonnegative(),
    netReturnBps: NUMERIC_STRING_SCHEMA,
    winRateBps: BPS_SCHEMA,
  })
  .strict();

const RuntimeBacktestFoldReportSchema = z
  .object({
    foldId: NON_EMPTY_STRING_SCHEMA,
    foldIndex: z.number().int().nonnegative(),
    trainingStartAt: ISO_DATETIME_SCHEMA,
    trainingEndAt: ISO_DATETIME_SCHEMA,
    testStartAt: ISO_DATETIME_SCHEMA,
    testEndAt: ISO_DATETIME_SCHEMA,
    trainObservationCount: z.number().int().nonnegative(),
    purgedObservationCount: z.number().int().nonnegative(),
    testObservationCount: z.number().int().nonnegative(),
    metrics: RuntimeBacktestMetricsSchema,
    baselineComparisons: z.array(RuntimeBacktestBaselineComparisonSchema),
    regimeMetrics: z.array(RuntimeBacktestRegimeMetricsSchema),
  })
  .strict();

export const RuntimeBacktestReportSchema = VersionedSchema.extend({
  reportId: NON_EMPTY_STRING_SCHEMA,
  experimentId: NON_EMPTY_STRING_SCHEMA,
  strategyKey: NON_EMPTY_STRING_SCHEMA,
  status: RuntimeBacktestStatusSchema,
  generatedAt: ISO_DATETIME_SCHEMA,
  venueKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  assetKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  codeRevision: RuntimeCodeRevisionRefSchema,
  datasetSnapshots: z.array(RuntimeDatasetSnapshotRefSchema).min(1),
  strategySpecDigest: NON_EMPTY_STRING_SCHEMA,
  config: RuntimeBacktestConfigSchema,
  foldReports: z.array(RuntimeBacktestFoldReportSchema).min(1),
  aggregateMetrics: RuntimeBacktestMetricsSchema,
  aggregateBaselineComparisons: z
    .array(RuntimeBacktestBaselineComparisonSchema)
    .min(1),
  aggregateRegimeMetrics: z.array(RuntimeBacktestRegimeMetricsSchema),
  promotionEligible: z.boolean(),
  blockingReasons: z.array(NON_EMPTY_STRING_SCHEMA),
  summary: NON_EMPTY_STRING_SCHEMA,
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
}).strict();

export const RuntimeStrategyCategorySchema = z.enum([
  "allocation",
  "signal",
  "advanced",
]);

export const RuntimeStrategyParameterKindSchema = z.enum([
  "decimal",
  "integer",
  "bps",
  "boolean",
  "enum",
]);

export const RuntimeStrategyAssetRoleSchema = z.enum([
  "base",
  "quote",
  "either",
]);

export const RuntimeOnboardingStateSchema = z.enum([
  "candidate",
  "integrated",
  "shadow_ready",
  "paper_ready",
  "limited_live_ready",
  "broad_live_ready",
  "paused",
  "deprecated",
]);

export const RuntimeAssetListingStateSchema = z.enum([
  "candidate",
  "shadow",
  "paper",
  "live",
  "paused",
  "deprecated",
]);

export const RuntimeAssetKindSchema = z.enum([
  "native",
  "token",
  "stablecoin",
  "wrapped",
  "synthetic",
]);

export const RuntimeAssetRiskClassSchema = z.enum([
  "core",
  "standard",
  "volatile",
  "experimental",
  "restricted",
]);

const RuntimeVenuePrecisionSchema = z
  .object({
    priceDecimals: z.number().int().nonnegative(),
    sizeDecimals: z.number().int().nonnegative(),
    minOrderIncrement: DECIMAL_STRING_SCHEMA.optional(),
    minQuoteNotionalUsd: DECIMAL_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeVenueSizeLimitsSchema = z
  .object({
    minNotionalUsd: DECIMAL_STRING_SCHEMA,
    maxNotionalUsd: DECIMAL_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeVenueLatencyProfileSchema = z
  .object({
    expectedQuoteMs: z.number().int().positive(),
    expectedSubmitMs: z.number().int().positive(),
    expectedSettlementMs: z.number().int().positive(),
  })
  .strict();

export const RuntimeFeatureCatalogStatusSchema = z.enum([
  "draft",
  "active",
  "deprecated",
]);

export const RuntimeRegimeDimensionSchema = z.enum([
  "trend",
  "volatility",
  "spread",
  "liquidity",
  "funding",
  "carry",
]);

const RuntimeCatalogProvenanceSchema = z
  .object({
    generatedBy: NON_EMPTY_STRING_SCHEMA,
    generatedRevision: NON_EMPTY_STRING_SCHEMA.optional(),
    generatedAt: ISO_DATETIME_SCHEMA,
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeFeatureInputRequirementSchema = z
  .object({
    inputKey: NON_EMPTY_STRING_SCHEMA,
    required: z.boolean(),
    freshnessMs: z.number().int().positive().optional(),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeFeatureDefinitionRecordSchema = VersionedSchema.extend({
  featureId: NON_EMPTY_STRING_SCHEMA,
  featureKey: NON_EMPTY_STRING_SCHEMA,
  version: NON_EMPTY_STRING_SCHEMA,
  title: NON_EMPTY_STRING_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
  status: RuntimeFeatureCatalogStatusSchema,
  marketType: RuntimeVenueMarketTypeSchema,
  venueKeys: z.array(NON_EMPTY_STRING_SCHEMA),
  assetKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  pairSymbols: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  inputRequirements: z.array(RuntimeFeatureInputRequirementSchema).min(1),
  derivedFromFeatureKeys: z.array(NON_EMPTY_STRING_SCHEMA),
  freshnessSloMs: z.number().int().positive(),
  maxAllowedDriftBps: BPS_SCHEMA,
  minCoverageBps: BPS_SCHEMA,
  provenance: RuntimeCatalogProvenanceSchema,
  datasetSnapshots: z.array(RuntimeDatasetSnapshotRefSchema).min(1),
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
  notes: NON_EMPTY_STRING_SCHEMA.optional(),
}).strict();

export const RuntimeRegimeTagRecordSchema = VersionedSchema.extend({
  regimeTagId: NON_EMPTY_STRING_SCHEMA,
  regimeKey: NON_EMPTY_STRING_SCHEMA,
  version: NON_EMPTY_STRING_SCHEMA,
  title: NON_EMPTY_STRING_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
  status: RuntimeFeatureCatalogStatusSchema,
  dimension: RuntimeRegimeDimensionSchema,
  value: NON_EMPTY_STRING_SCHEMA,
  marketType: RuntimeVenueMarketTypeSchema,
  venueKeys: z.array(NON_EMPTY_STRING_SCHEMA),
  assetKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  pairSymbols: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  sourceFeatureKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  freshnessSloMs: z.number().int().positive(),
  maxAllowedDriftBps: BPS_SCHEMA,
  minConfidenceBps: BPS_SCHEMA,
  provenance: RuntimeCatalogProvenanceSchema,
  datasetSnapshots: z.array(RuntimeDatasetSnapshotRefSchema).min(1),
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
  notes: NON_EMPTY_STRING_SCHEMA.optional(),
}).strict();

export const RuntimeVenueCapabilitySchema = VersionedSchema.extend({
  venueKey: NON_EMPTY_STRING_SCHEMA,
  displayName: NON_EMPTY_STRING_SCHEMA,
  adapterKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  marketTypes: z.array(RuntimeVenueMarketTypeSchema).min(1),
  orderTypes: z.array(RuntimeVenueOrderTypeSchema).min(1),
  authModel: RuntimeVenueAuthModelSchema,
  feeModel: RuntimeVenueFeeModelSchema,
  precision: RuntimeVenuePrecisionSchema,
  sizeLimits: RuntimeVenueSizeLimitsSchema,
  latencyProfile: RuntimeVenueLatencyProfileSchema,
  settlementBehavior: RuntimeVenueSettlementBehaviorSchema,
  supportedModes: z.array(RuntimeModeSchema).min(1),
  onboardingState: RuntimeOnboardingStateSchema,
  notes: NON_EMPTY_STRING_SCHEMA.optional(),
}).strict();

const RuntimeAssetVenueMappingSchema = z
  .object({
    venueKey: NON_EMPTY_STRING_SCHEMA,
    nativeId: NON_EMPTY_STRING_SCHEMA,
    venueSymbol: NON_EMPTY_STRING_SCHEMA,
    decimals: z.number().int().nonnegative(),
    listingState: RuntimeAssetListingStateSchema,
    quoteAssetKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
    priceDecimals: z.number().int().nonnegative().optional(),
    sizeDecimals: z.number().int().nonnegative().optional(),
    minNotionalUsd: DECIMAL_STRING_SCHEMA.optional(),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeAssetRecordSchema = VersionedSchema.extend({
  assetKey: NON_EMPTY_STRING_SCHEMA,
  displayName: NON_EMPTY_STRING_SCHEMA,
  symbol: NON_EMPTY_STRING_SCHEMA,
  chainKey: NON_EMPTY_STRING_SCHEMA,
  canonicalId: NON_EMPTY_STRING_SCHEMA,
  assetKind: RuntimeAssetKindSchema,
  riskClass: RuntimeAssetRiskClassSchema,
  listingState: RuntimeAssetListingStateSchema,
  decimals: z.number().int().nonnegative(),
  aliases: z.array(NON_EMPTY_STRING_SCHEMA),
  quoteAssetKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  venueMappings: z.array(RuntimeAssetVenueMappingSchema).min(1),
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  promotedAt: ISO_DATETIME_SCHEMA.optional(),
  pausedAt: ISO_DATETIME_SCHEMA.optional(),
  deprecatedAt: ISO_DATETIME_SCHEMA.optional(),
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
  notes: NON_EMPTY_STRING_SCHEMA.optional(),
}).strict();

const RuntimeStrategyVenueSupportSchema = z
  .object({
    venueKey: NON_EMPTY_STRING_SCHEMA,
    onboardingState: RuntimeOnboardingStateSchema,
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeStrategyAssetConstraintSchema = z
  .object({
    role: RuntimeStrategyAssetRoleSchema,
    assetKeys: z.array(NON_EMPTY_STRING_SCHEMA),
    required: z.boolean(),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeStrategyFeatureRequirementSchema = z
  .object({
    featureKey: NON_EMPTY_STRING_SCHEMA,
    required: z.boolean(),
    freshnessMs: z.number().int().positive().optional(),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeStrategyParameterSpecSchema = z
  .object({
    key: NON_EMPTY_STRING_SCHEMA,
    label: NON_EMPTY_STRING_SCHEMA,
    kind: RuntimeStrategyParameterKindSchema,
    required: z.boolean(),
    defaultValue: NON_EMPTY_STRING_SCHEMA.optional(),
    minValue: NON_EMPTY_STRING_SCHEMA.optional(),
    maxValue: NON_EMPTY_STRING_SCHEMA.optional(),
    allowedValues: z.array(NON_EMPTY_STRING_SCHEMA),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeStrategyPromotionPolicySchema = z
  .object({
    requiresHumanApproval: z.boolean(),
    shadowMinRuns: z.number().int().nonnegative(),
    paperMinRuns: z.number().int().nonnegative(),
    liveLaneAllowlist: z.array(RuntimeLaneSchema),
    requiresFreshFeatures: z.boolean(),
    limitedLiveOnly: z.boolean(),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeStrategySpecSchema = VersionedSchema.extend({
  strategyKey: NON_EMPTY_STRING_SCHEMA,
  title: NON_EMPTY_STRING_SCHEMA,
  summary: NON_EMPTY_STRING_SCHEMA,
  category: RuntimeStrategyCategorySchema,
  pluginKey: NON_EMPTY_STRING_SCHEMA,
  defaultLane: RuntimeLaneSchema,
  supportedModes: z.array(RuntimeModeSchema).min(1),
  laneEligibility: z.array(RuntimeLaneSchema).min(1),
  supportedVenues: z.array(RuntimeStrategyVenueSupportSchema).min(1),
  assetConstraints: z.array(RuntimeStrategyAssetConstraintSchema).min(1),
  featureRequirements: z.array(RuntimeStrategyFeatureRequirementSchema),
  regimeRequirements: z.array(NON_EMPTY_STRING_SCHEMA),
  parameterSpecs: z.array(RuntimeStrategyParameterSpecSchema),
  promotionPolicy: RuntimeStrategyPromotionPolicySchema,
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
}).strict();

export const RuntimeExecutionCostModelStatusSchema = z.enum([
  "draft",
  "active",
  "deprecated",
]);

const RuntimeExecutionCostAssumptionsSchema = z
  .object({
    feeBps: BPS_SCHEMA,
    slippageBps: BPS_SCHEMA,
    marketImpactBps: BPS_SCHEMA,
    partialFillRateBps: BPS_SCHEMA,
    partialFillPenaltyBps: BPS_SCHEMA,
    financingCostBpsPerDay: NUMERIC_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeExecutionCostModelRecordSchema = VersionedSchema.extend({
  modelId: NON_EMPTY_STRING_SCHEMA,
  venueKey: NON_EMPTY_STRING_SCHEMA,
  marketType: RuntimeVenueMarketTypeSchema,
  pairSymbol: NON_EMPTY_STRING_SCHEMA,
  instrumentId: NON_EMPTY_STRING_SCHEMA.optional(),
  assetKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
  modeCoverage: z.array(RuntimeModeSchema).min(1),
  status: RuntimeExecutionCostModelStatusSchema,
  assumptions: RuntimeExecutionCostAssumptionsSchema,
  latencyProfile: RuntimeVenueLatencyProfileSchema,
  datasetSnapshots: z.array(RuntimeDatasetSnapshotRefSchema).min(1),
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
  notes: NON_EMPTY_STRING_SCHEMA.optional(),
}).strict();

export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;
export type RuntimeLane = z.infer<typeof RuntimeLaneSchema>;
export type RuntimeDeploymentState = z.infer<
  typeof RuntimeDeploymentStateSchema
>;
export type RuntimeRunState = z.infer<typeof RuntimeRunStateSchema>;
export type RuntimeDeploymentRecord = z.infer<
  typeof RuntimeDeploymentRecordSchema
>;
export type RuntimeRunRecord = z.infer<typeof RuntimeRunRecordSchema>;
export type RuntimeLedgerSnapshot = z.infer<typeof RuntimeLedgerSnapshotSchema>;
export type RuntimeRiskVerdict = z.infer<typeof RuntimeRiskVerdictSchema>;
export type RuntimeExecutionPlan = z.infer<typeof RuntimeExecutionPlanSchema>;
export type RuntimeReconciliationResult = z.infer<
  typeof RuntimeReconciliationResultSchema
>;
export type RuntimeResearchHypothesisRecord = z.infer<
  typeof RuntimeResearchHypothesisRecordSchema
>;
export type RuntimeResearchSourceKind = z.infer<
  typeof RuntimeResearchSourceKindSchema
>;
export type RuntimeResearchSourceAcquisitionKind = z.infer<
  typeof RuntimeResearchSourceAcquisitionKindSchema
>;
export type RuntimeResearchSourceProvenance = z.infer<
  typeof RuntimeResearchSourceProvenanceSchema
>;
export type RuntimeHistoricalDatasetAcquisitionKind = z.infer<
  typeof RuntimeHistoricalDatasetAcquisitionKindSchema
>;
export type RuntimeHistoricalDatasetKind = z.infer<
  typeof RuntimeHistoricalDatasetKindSchema
>;
export type RuntimeDatasetNormalizationKind = z.infer<
  typeof RuntimeDatasetNormalizationKindSchema
>;
export type RuntimeDatasetStorageFormat = z.infer<
  typeof RuntimeDatasetStorageFormatSchema
>;
export type RuntimeDatasetRetentionClass = z.infer<
  typeof RuntimeDatasetRetentionClassSchema
>;
export type RuntimeHistoricalDatasetSnapshotRecord = z.infer<
  typeof RuntimeHistoricalDatasetSnapshotRecordSchema
>;
export type RuntimeReplayCorpusKind = z.infer<
  typeof RuntimeReplayCorpusKindSchema
>;
export type RuntimeReplayCorpusRecord = z.infer<
  typeof RuntimeReplayCorpusRecordSchema
>;
export type RuntimeFeatureCatalogStatus = z.infer<
  typeof RuntimeFeatureCatalogStatusSchema
>;
export type RuntimeRegimeDimension = z.infer<
  typeof RuntimeRegimeDimensionSchema
>;
export type RuntimeFeatureDefinitionRecord = z.infer<
  typeof RuntimeFeatureDefinitionRecordSchema
>;
export type RuntimeRegimeTagRecord = z.infer<
  typeof RuntimeRegimeTagRecordSchema
>;
export type RuntimeExecutionCostModelStatus = z.infer<
  typeof RuntimeExecutionCostModelStatusSchema
>;
export type RuntimeExecutionCostModelRecord = z.infer<
  typeof RuntimeExecutionCostModelRecordSchema
>;
export type RuntimeResearchSourceRecord = z.infer<
  typeof RuntimeResearchSourceRecordSchema
>;
export type RuntimeResearchExperimentRecord = z.infer<
  typeof RuntimeResearchExperimentRecordSchema
>;
export type RuntimeResearchEvidenceBundleRecord = z.infer<
  typeof RuntimeResearchEvidenceBundleRecordSchema
>;
export type RuntimeBacktestStatus = z.infer<typeof RuntimeBacktestStatusSchema>;
export type RuntimeBacktestWindowMode = z.infer<
  typeof RuntimeBacktestWindowModeSchema
>;
export type RuntimeBacktestBaseline = z.infer<
  typeof RuntimeBacktestBaselineSchema
>;
export type RuntimeBacktestReport = z.infer<typeof RuntimeBacktestReportSchema>;
export type RuntimeOnboardingState = z.infer<
  typeof RuntimeOnboardingStateSchema
>;
export type RuntimeAssetListingState = z.infer<
  typeof RuntimeAssetListingStateSchema
>;
export type RuntimeAssetKind = z.infer<typeof RuntimeAssetKindSchema>;
export type RuntimeAssetRiskClass = z.infer<typeof RuntimeAssetRiskClassSchema>;
export type RuntimeVenueMarketType = z.infer<
  typeof RuntimeVenueMarketTypeSchema
>;
export type RuntimeVenueOrderType = z.infer<typeof RuntimeVenueOrderTypeSchema>;
export type RuntimeVenueAuthModel = z.infer<typeof RuntimeVenueAuthModelSchema>;
export type RuntimeVenueFeeModel = z.infer<typeof RuntimeVenueFeeModelSchema>;
export type RuntimeVenueSettlementBehavior = z.infer<
  typeof RuntimeVenueSettlementBehaviorSchema
>;
export type RuntimeVenueCapability = z.infer<
  typeof RuntimeVenueCapabilitySchema
>;
export type RuntimeAssetRecord = z.infer<typeof RuntimeAssetRecordSchema>;
export type RuntimeStrategySpec = z.infer<typeof RuntimeStrategySpecSchema>;

export const RUNTIME_DEPLOYMENT_STATE_TRANSITIONS = {
  draft: ["shadow", "paper", "live", "archived"],
  shadow: ["paper", "paused", "killed", "archived"],
  paper: ["live", "paused", "killed", "archived"],
  live: ["paused", "killed", "archived"],
  paused: ["shadow", "paper", "live", "killed", "archived"],
  killed: ["archived"],
  archived: [],
} as const satisfies Record<
  RuntimeDeploymentState,
  readonly RuntimeDeploymentState[]
>;

export const RUNTIME_RUN_STATE_TRANSITIONS = {
  pending: ["risk_checked", "rejected", "killed"],
  risk_checked: ["planned", "rejected", "killed"],
  planned: ["submitted", "completed", "killed"],
  submitted: ["receipt_pending", "failed", "killed"],
  receipt_pending: ["reconciled", "failed", "killed"],
  reconciled: ["completed", "needs_manual_review", "failed"],
  needs_manual_review: ["completed", "failed"],
  completed: [],
  rejected: [],
  failed: [],
  killed: [],
} as const satisfies Record<RuntimeRunState, readonly RuntimeRunState[]>;

export const RUNTIME_PROTOCOL_SCHEMA_REGISTRY = {
  deployment: {
    schema: RuntimeDeploymentRecordSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/deployment",
    outputFile: "runtime.deployment.v1.schema.json",
  },
  run: {
    schema: RuntimeRunRecordSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/run",
    outputFile: "runtime.run.v1.schema.json",
  },
  ledgerSnapshot: {
    schema: RuntimeLedgerSnapshotSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/ledger_snapshot",
    outputFile: "runtime.ledger_snapshot.v1.schema.json",
  },
  riskVerdict: {
    schema: RuntimeRiskVerdictSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/risk_verdict",
    outputFile: "runtime.risk_verdict.v1.schema.json",
  },
  executionPlan: {
    schema: RuntimeExecutionPlanSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/execution_plan",
    outputFile: "runtime.execution_plan.v1.schema.json",
  },
  reconciliationResult: {
    schema: RuntimeReconciliationResultSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/reconciliation_result",
    outputFile: "runtime.reconciliation_result.v1.schema.json",
  },
  researchHypothesis: {
    schema: RuntimeResearchHypothesisRecordSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/research_hypothesis",
    outputFile: "runtime.research_hypothesis.v1.schema.json",
  },
  researchSource: {
    schema: RuntimeResearchSourceRecordSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/research_source",
    outputFile: "runtime.research_source.v1.schema.json",
  },
  researchExperiment: {
    schema: RuntimeResearchExperimentRecordSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/research_experiment",
    outputFile: "runtime.research_experiment.v1.schema.json",
  },
  researchEvidenceBundle: {
    schema: RuntimeResearchEvidenceBundleRecordSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/research_evidence_bundle",
    outputFile: "runtime.research_evidence_bundle.v1.schema.json",
  },
  backtestReport: {
    schema: RuntimeBacktestReportSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/backtest_report",
    outputFile: "runtime.backtest_report.v1.schema.json",
  },
  historicalDatasetSnapshot: {
    schema: RuntimeHistoricalDatasetSnapshotRecordSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/historical_dataset_snapshot",
    outputFile: "runtime.historical_dataset_snapshot.v1.schema.json",
  },
  replayCorpus: {
    schema: RuntimeReplayCorpusRecordSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/replay_corpus",
    outputFile: "runtime.replay_corpus.v1.schema.json",
  },
  featureDefinition: {
    schema: RuntimeFeatureDefinitionRecordSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/feature_definition",
    outputFile: "runtime.feature_definition.v1.schema.json",
  },
  regimeTag: {
    schema: RuntimeRegimeTagRecordSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/regime_tag",
    outputFile: "runtime.regime_tag.v1.schema.json",
  },
  executionCostModel: {
    schema: RuntimeExecutionCostModelRecordSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/execution_cost_model",
    outputFile: "runtime.execution_cost_model.v1.schema.json",
  },
  venueCapability: {
    schema: RuntimeVenueCapabilitySchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/venue_capability",
    outputFile: "runtime.venue_capability.v1.schema.json",
  },
  assetRecord: {
    schema: RuntimeAssetRecordSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/asset_record",
    outputFile: "runtime.asset_record.v1.schema.json",
  },
  strategySpec: {
    schema: RuntimeStrategySpecSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/strategy_spec",
    outputFile: "runtime.strategy_spec.v1.schema.json",
  },
} as const;

export function canTransitionRuntimeDeploymentState(
  from: RuntimeDeploymentState,
  to: RuntimeDeploymentState,
): boolean {
  const allowed = RUNTIME_DEPLOYMENT_STATE_TRANSITIONS[
    from
  ] as readonly RuntimeDeploymentState[];
  return allowed.includes(to);
}

export function canTransitionRuntimeRunState(
  from: RuntimeRunState,
  to: RuntimeRunState,
): boolean {
  const allowed = RUNTIME_RUN_STATE_TRANSITIONS[
    from
  ] as readonly RuntimeRunState[];
  return allowed.includes(to);
}

export function parseRuntimeDeploymentRecord(
  input: unknown,
): RuntimeDeploymentRecord {
  return RuntimeDeploymentRecordSchema.parse(input);
}

export function parseRuntimeRunRecord(input: unknown): RuntimeRunRecord {
  return RuntimeRunRecordSchema.parse(input);
}

export function parseRuntimeLedgerSnapshot(
  input: unknown,
): RuntimeLedgerSnapshot {
  return RuntimeLedgerSnapshotSchema.parse(input);
}

export function parseRuntimeRiskVerdict(input: unknown): RuntimeRiskVerdict {
  return RuntimeRiskVerdictSchema.parse(input);
}

export function parseRuntimeExecutionPlan(
  input: unknown,
): RuntimeExecutionPlan {
  return RuntimeExecutionPlanSchema.parse(input);
}

export function parseRuntimeReconciliationResult(
  input: unknown,
): RuntimeReconciliationResult {
  return RuntimeReconciliationResultSchema.parse(input);
}

export function parseRuntimeResearchHypothesisRecord(
  input: unknown,
): RuntimeResearchHypothesisRecord {
  return RuntimeResearchHypothesisRecordSchema.parse(input);
}

export function parseRuntimeResearchSourceRecord(
  input: unknown,
): RuntimeResearchSourceRecord {
  return RuntimeResearchSourceRecordSchema.parse(input);
}

export function parseRuntimeHistoricalDatasetSnapshotRecord(
  input: unknown,
): RuntimeHistoricalDatasetSnapshotRecord {
  return RuntimeHistoricalDatasetSnapshotRecordSchema.parse(input);
}

export function parseRuntimeReplayCorpusRecord(
  input: unknown,
): RuntimeReplayCorpusRecord {
  return RuntimeReplayCorpusRecordSchema.parse(input);
}

export function parseRuntimeFeatureDefinitionRecord(
  input: unknown,
): RuntimeFeatureDefinitionRecord {
  return RuntimeFeatureDefinitionRecordSchema.parse(input);
}

export function parseRuntimeRegimeTagRecord(
  input: unknown,
): RuntimeRegimeTagRecord {
  return RuntimeRegimeTagRecordSchema.parse(input);
}

export function parseRuntimeExecutionCostModelRecord(
  input: unknown,
): RuntimeExecutionCostModelRecord {
  return RuntimeExecutionCostModelRecordSchema.parse(input);
}

export function parseRuntimeResearchExperimentRecord(
  input: unknown,
): RuntimeResearchExperimentRecord {
  return RuntimeResearchExperimentRecordSchema.parse(input);
}

export function parseRuntimeResearchEvidenceBundleRecord(
  input: unknown,
): RuntimeResearchEvidenceBundleRecord {
  return RuntimeResearchEvidenceBundleRecordSchema.parse(input);
}

export function parseRuntimeBacktestReport(
  input: unknown,
): RuntimeBacktestReport {
  return RuntimeBacktestReportSchema.parse(input);
}

export function parseRuntimeVenueCapability(
  input: unknown,
): RuntimeVenueCapability {
  return RuntimeVenueCapabilitySchema.parse(input);
}

export function parseRuntimeAssetRecord(input: unknown): RuntimeAssetRecord {
  return RuntimeAssetRecordSchema.parse(input);
}

export function parseRuntimeStrategySpec(input: unknown): RuntimeStrategySpec {
  return RuntimeStrategySpecSchema.parse(input);
}

export function safeParseRuntimeDeploymentRecord(input: unknown) {
  return RuntimeDeploymentRecordSchema.safeParse(input);
}

export function safeParseRuntimeRunRecord(input: unknown) {
  return RuntimeRunRecordSchema.safeParse(input);
}

export function safeParseRuntimeLedgerSnapshot(input: unknown) {
  return RuntimeLedgerSnapshotSchema.safeParse(input);
}

export function safeParseRuntimeRiskVerdict(input: unknown) {
  return RuntimeRiskVerdictSchema.safeParse(input);
}

export function safeParseRuntimeExecutionPlan(input: unknown) {
  return RuntimeExecutionPlanSchema.safeParse(input);
}

export function safeParseRuntimeReconciliationResult(input: unknown) {
  return RuntimeReconciliationResultSchema.safeParse(input);
}

export function safeParseRuntimeResearchHypothesisRecord(input: unknown) {
  return RuntimeResearchHypothesisRecordSchema.safeParse(input);
}

export function safeParseRuntimeResearchSourceRecord(input: unknown) {
  return RuntimeResearchSourceRecordSchema.safeParse(input);
}

export function safeParseRuntimeHistoricalDatasetSnapshotRecord(
  input: unknown,
) {
  return RuntimeHistoricalDatasetSnapshotRecordSchema.safeParse(input);
}

export function safeParseRuntimeReplayCorpusRecord(input: unknown) {
  return RuntimeReplayCorpusRecordSchema.safeParse(input);
}

export function safeParseRuntimeFeatureDefinitionRecord(input: unknown) {
  return RuntimeFeatureDefinitionRecordSchema.safeParse(input);
}

export function safeParseRuntimeRegimeTagRecord(input: unknown) {
  return RuntimeRegimeTagRecordSchema.safeParse(input);
}

export function safeParseRuntimeExecutionCostModelRecord(input: unknown) {
  return RuntimeExecutionCostModelRecordSchema.safeParse(input);
}

export function safeParseRuntimeResearchExperimentRecord(input: unknown) {
  return RuntimeResearchExperimentRecordSchema.safeParse(input);
}

export function safeParseRuntimeResearchEvidenceBundleRecord(input: unknown) {
  return RuntimeResearchEvidenceBundleRecordSchema.safeParse(input);
}

export function safeParseRuntimeBacktestReport(input: unknown) {
  return RuntimeBacktestReportSchema.safeParse(input);
}

export function safeParseRuntimeVenueCapability(input: unknown) {
  return RuntimeVenueCapabilitySchema.safeParse(input);
}

export function safeParseRuntimeAssetRecord(input: unknown) {
  return RuntimeAssetRecordSchema.safeParse(input);
}

export function safeParseRuntimeStrategySpec(input: unknown) {
  return RuntimeStrategySpecSchema.safeParse(input);
}
