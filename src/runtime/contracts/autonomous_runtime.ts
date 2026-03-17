import { z } from "zod";

export const RUNTIME_PROTOCOL_SCHEMA_FAMILY = "runtime" as const;
export const RUNTIME_PROTOCOL_SCHEMA_VERSION = "v1" as const;
export const DEFAULT_RUNTIME_VENUE_KEY = "jupiter" as const;

const ISO_DATETIME_SCHEMA = z.string().datetime({ offset: true });
const NON_EMPTY_STRING_SCHEMA = z.string().min(1);
const NULLABLE_OPTIONAL_NON_EMPTY_STRING_SCHEMA = z.preprocess(
  (value) => (value === null ? undefined : value),
  NON_EMPTY_STRING_SCHEMA.optional(),
);
const PUBKEY_SCHEMA = z.string().min(32).max(64);
const DECIMAL_STRING_SCHEMA = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/, "invalid-decimal-string");
const NUMERIC_STRING_SCHEMA = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/, "invalid-numeric-string");
const BPS_SCHEMA = z.number().int().min(0).max(10_000);

function addDuplicateIdIssues<
  TEntry extends Record<string, unknown>,
  TKey extends keyof TEntry & string,
>(ctx: z.RefinementCtx, entries: TEntry[], collectionKey: string, idKey: TKey) {
  const seen = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    const value = entry[idKey];
    if (typeof value !== "string" || value.length === 0) continue;
    const firstIndex = seen.get(value);
    if (typeof firstIndex === "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate-${collectionKey}-${idKey}:${value}`,
        path: [collectionKey, index, idKey],
      });
      continue;
    }
    seen.set(value, index);
  }
}

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
    marketType: z.enum(["spot", "perp", "options"]).default("spot"),
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
    marketType: z.enum(["spot", "perp", "options"]).default("spot"),
    instrumentId: NON_EMPTY_STRING_SCHEMA.optional(),
    quantityAtomic: DECIMAL_STRING_SCHEMA.optional(),
    referencePriceUsd: DECIMAL_STRING_SCHEMA.optional(),
    reduceOnly: z.boolean().default(false),
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

export const RuntimeBacktestWindowModeSchema = z.enum([
  "rolling",
  "expanding",
  "anchored",
]);

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
    comparedTo: NULLABLE_OPTIONAL_NON_EMPTY_STRING_SCHEMA,
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

export const RuntimeVenueMarketTypeSchema = z.enum([
  "spot",
  "perp",
  "options",
  "prediction",
]);

export const RuntimeVenueOrderTypeSchema = z.enum([
  "market",
  "limit",
  "trigger",
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

export const RuntimeExecutionIntentFamilySchema = z.enum([
  "spot_swap",
  "conditional_spot_order",
  "clob_order",
  "perp_order",
  "prediction_order",
  "flash_atomic",
]);

export const RuntimeVenueSettlementModelSchema = z.enum([
  "atomic_swap",
  "resting_order",
  "position_account",
  "tokenized_outcome",
  "flash_loan_atomic",
]);

export const RuntimeVenueOracleRequirementSchema = z.enum([
  "pyth",
  "switchboard",
  "venue_reference",
  "none",
]);

const RuntimeVenueLifecycleCapabilitySchema = z
  .object({
    supportsOrderLifecycle: z.boolean(),
    supportsPositionLifecycle: z.boolean(),
    requiresExternalOracle: z.boolean(),
    settlementModel: RuntimeVenueSettlementModelSchema,
  })
  .strict();

export const RuntimeMarginRiskLevelSchema = z.enum([
  "low",
  "warning",
  "critical",
]);

export const RuntimeMarginOracleStatusSchema = z.enum([
  "healthy",
  "stale",
  "unconfident",
  "halted",
]);

const RuntimeMarginOracleSnapshotSchema = z
  .object({
    instrumentId: NON_EMPTY_STRING_SCHEMA,
    provider: NON_EMPTY_STRING_SCHEMA,
    status: RuntimeMarginOracleStatusSchema,
    priceQuote: DECIMAL_STRING_SCHEMA.optional(),
    confidencePct: DECIMAL_STRING_SCHEMA.optional(),
    lastUpdatedSlot: z.number().int().nonnegative().optional(),
    lastUpdatedAt: ISO_DATETIME_SCHEMA.optional(),
    notes: z.array(NON_EMPTY_STRING_SCHEMA),
  })
  .strict();

const RuntimeMarginPositionSnapshotSchema = z
  .object({
    instrumentId: NON_EMPTY_STRING_SCHEMA,
    marketType: RuntimeVenueMarketTypeSchema,
    side: NON_EMPTY_STRING_SCHEMA.optional(),
    quantityAtomic: NUMERIC_STRING_SCHEMA.optional(),
    collateralAtomic: NUMERIC_STRING_SCHEMA.optional(),
    notionalQuote: DECIMAL_STRING_SCHEMA.optional(),
    entryPriceQuote: DECIMAL_STRING_SCHEMA.optional(),
    markPriceQuote: DECIMAL_STRING_SCHEMA.optional(),
    unsettledPnlQuote: DECIMAL_STRING_SCHEMA.optional(),
    reduceOnly: z.boolean().optional(),
    notes: z.array(NON_EMPTY_STRING_SCHEMA),
  })
  .strict();

export const RuntimeMarginAccountSnapshotSchema = VersionedSchema.extend({
  snapshotId: NON_EMPTY_STRING_SCHEMA,
  venueKey: NON_EMPTY_STRING_SCHEMA,
  accountRef: NON_EMPTY_STRING_SCHEMA,
  capturedAt: ISO_DATETIME_SCHEMA,
  marketTypes: z.array(RuntimeVenueMarketTypeSchema).min(1),
  equityQuote: DECIMAL_STRING_SCHEMA,
  initHealthQuote: DECIMAL_STRING_SCHEMA,
  maintHealthQuote: DECIMAL_STRING_SCHEMA,
  initHealthRatioPct: DECIMAL_STRING_SCHEMA.optional(),
  maintHealthRatioPct: DECIMAL_STRING_SCHEMA.optional(),
  usedMarginQuote: DECIMAL_STRING_SCHEMA,
  freeCollateralQuote: DECIMAL_STRING_SCHEMA,
  liquidationBufferPct: DECIMAL_STRING_SCHEMA.optional(),
  liquidationRiskLevel: RuntimeMarginRiskLevelSchema,
  beingLiquidated: z.boolean(),
  isOperational: z.boolean(),
  positions: z.array(RuntimeMarginPositionSnapshotSchema),
  oracles: z.array(RuntimeMarginOracleSnapshotSchema).min(1),
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
  notes: NON_EMPTY_STRING_SCHEMA.optional(),
}).strict();

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

export const RuntimeExperimentVerificationModeSchema = z.enum([
  "exact",
  "bounded_tolerance",
]);

const RuntimeExperimentCatalogVersionRefSchema = z
  .object({
    recordId: NON_EMPTY_STRING_SCHEMA,
    key: NON_EMPTY_STRING_SCHEMA,
    version: NON_EMPTY_STRING_SCHEMA,
    updatedAt: ISO_DATETIME_SCHEMA,
  })
  .strict();

const RuntimeExperimentCostModelRefSchema = z
  .object({
    modelId: NON_EMPTY_STRING_SCHEMA,
    calibrationId: NON_EMPTY_STRING_SCHEMA,
    updatedAt: ISO_DATETIME_SCHEMA,
  })
  .strict();

const RuntimeExperimentManifestSchema = z
  .object({
    manifestId: NON_EMPTY_STRING_SCHEMA,
    generatedAt: ISO_DATETIME_SCHEMA,
    codeRevision: RuntimeCodeRevisionRefSchema,
    datasetSnapshots: z.array(RuntimeDatasetSnapshotRefSchema).min(1),
    replayCorpusId: NON_EMPTY_STRING_SCHEMA.optional(),
    venueKey: NON_EMPTY_STRING_SCHEMA.optional(),
    pairSymbol: NON_EMPTY_STRING_SCHEMA.optional(),
    marketType: RuntimeVenueMarketTypeSchema.optional(),
    strategySpecDigest: NON_EMPTY_STRING_SCHEMA.optional(),
    featureVersions: z.array(RuntimeExperimentCatalogVersionRefSchema),
    regimeVersions: z.array(RuntimeExperimentCatalogVersionRefSchema),
    costModel: RuntimeExperimentCostModelRefSchema.optional(),
    backtestConfig: RuntimeBacktestConfigSchema.optional(),
  })
  .strict();

const RuntimeExperimentExpectedResultSchema = z
  .object({
    reportId: NON_EMPTY_STRING_SCHEMA.optional(),
    status: RuntimeBacktestStatusSchema.optional(),
    promotionEligible: z.boolean(),
    aggregateMetrics: RuntimeBacktestMetricsSchema.optional(),
    aggregateBaselineComparisons: z.array(
      RuntimeBacktestBaselineComparisonSchema,
    ),
    aggregateRegimeMetrics: z.array(RuntimeBacktestRegimeMetricsSchema),
    blockingReasons: z.array(NON_EMPTY_STRING_SCHEMA),
  })
  .strict();

const RuntimeExperimentVerificationToleranceSchema = z
  .object({
    maxNetReturnDeltaBps: NUMERIC_STRING_SCHEMA,
    maxTotalCostDeltaBps: NUMERIC_STRING_SCHEMA,
    maxDrawdownDeltaBps: NUMERIC_STRING_SCHEMA,
    maxWinRateDeltaBps: BPS_SCHEMA,
    maxTradeCountDelta: z.number().int().nonnegative(),
  })
  .strict();

const RuntimeExperimentVerificationResultSchema = z
  .object({
    verifiedAt: ISO_DATETIME_SCHEMA,
    verificationMode: RuntimeExperimentVerificationModeSchema,
    passed: z.boolean(),
    reportId: NON_EMPTY_STRING_SCHEMA.optional(),
    rerunReportId: NON_EMPTY_STRING_SCHEMA.optional(),
    netReturnDeltaBps: NUMERIC_STRING_SCHEMA,
    totalCostDeltaBps: NUMERIC_STRING_SCHEMA,
    maxDrawdownDeltaBps: NUMERIC_STRING_SCHEMA,
    winRateDeltaBps: BPS_SCHEMA,
    tradeCountDelta: z.number().int().nonnegative(),
    blockingReasons: z.array(NON_EMPTY_STRING_SCHEMA),
  })
  .strict();

export const RuntimeResearchReproducibilityBundleRecordSchema =
  VersionedSchema.extend({
    reproducibilityBundleId: NON_EMPTY_STRING_SCHEMA,
    experimentId: NON_EMPTY_STRING_SCHEMA,
    strategyKey: NON_EMPTY_STRING_SCHEMA,
    createdAt: ISO_DATETIME_SCHEMA,
    updatedAt: ISO_DATETIME_SCHEMA,
    venueKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
    assetKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
    sourceCitations: z.array(RuntimeResearchCitationSchema),
    codeRevision: RuntimeCodeRevisionRefSchema,
    datasetSnapshots: z.array(RuntimeDatasetSnapshotRefSchema).min(1),
    manifest: RuntimeExperimentManifestSchema,
    expectedResult: RuntimeExperimentExpectedResultSchema,
    artifacts: z.array(RuntimeArtifactRefSchema),
    linkedEvidenceBundleIds: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
    verificationTolerance: RuntimeExperimentVerificationToleranceSchema,
    latestVerification: RuntimeExperimentVerificationResultSchema.optional(),
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
  intentFamilies: z.array(RuntimeExecutionIntentFamilySchema).min(1).optional(),
  authModel: RuntimeVenueAuthModelSchema,
  feeModel: RuntimeVenueFeeModelSchema,
  precision: RuntimeVenuePrecisionSchema,
  sizeLimits: RuntimeVenueSizeLimitsSchema,
  latencyProfile: RuntimeVenueLatencyProfileSchema,
  settlementBehavior: RuntimeVenueSettlementBehaviorSchema,
  lifecycle: RuntimeVenueLifecycleCapabilitySchema.optional(),
  oracleRequirements: z
    .array(RuntimeVenueOracleRequirementSchema)
    .min(1)
    .optional(),
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

export const RuntimeResearchPolicyTargetModeSchema = z.enum([
  "shadow",
  "paper",
  "limited_live",
  "broad_live",
]);

export const RuntimeResearchPolicyGateStatusSchema = z.enum([
  "pass",
  "blocked",
  "requires_human_approval",
  "not_applicable",
]);

const RuntimeResearchHumanApprovalRecordSchema = z
  .object({
    targetMode: RuntimeResearchPolicyTargetModeSchema,
    approvedBy: NON_EMPTY_STRING_SCHEMA,
    approvedAt: ISO_DATETIME_SCHEMA,
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeResearchPolicyGateCheckSchema = z
  .object({
    checkId: NON_EMPTY_STRING_SCHEMA,
    status: RuntimeResearchPolicyGateStatusSchema,
    observedValue: NON_EMPTY_STRING_SCHEMA.optional(),
    thresholdValue: NON_EMPTY_STRING_SCHEMA.optional(),
    message: NON_EMPTY_STRING_SCHEMA,
  })
  .strict();

const RuntimeResearchPolicyGateDecisionSchema = z
  .object({
    targetMode: RuntimeResearchPolicyTargetModeSchema,
    automatedChecksPassed: z.boolean(),
    requiresHumanApproval: z.boolean(),
    eligible: z.boolean(),
    status: RuntimeResearchPolicyGateStatusSchema,
    summary: NON_EMPTY_STRING_SCHEMA,
    checks: z.array(RuntimeResearchPolicyGateCheckSchema).min(1),
    approval: RuntimeResearchHumanApprovalRecordSchema.optional(),
  })
  .strict();

export const RuntimeResearchPolicyGateArtifactSchema = VersionedSchema.extend({
  policyGateId: NON_EMPTY_STRING_SCHEMA,
  generatedAt: ISO_DATETIME_SCHEMA,
  synthesisId: NON_EMPTY_STRING_SCHEMA,
  hypothesisId: NON_EMPTY_STRING_SCHEMA,
  triageId: NON_EMPTY_STRING_SCHEMA,
  candidateDisposition: NON_EMPTY_STRING_SCHEMA,
  bannedPatterns: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
  gates: z.array(RuntimeResearchPolicyGateDecisionSchema).min(1),
  summary: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
}).strict();

export const RuntimeStrategyLabSubjectKindSchema = z.enum([
  "strategy",
  "venue",
  "asset",
]);

export const RuntimeStrategyLabStrategyStateSchema = z.enum([
  "candidate",
  "draft",
  "shadow",
  "paper",
  "limited_live",
  "broad_live",
  "paused",
  "deprecated",
]);

export const RuntimeStrategyLabPromotionStateSchema = z.enum([
  "candidate",
  "draft",
  "shadow",
  "paper",
  "limited_live",
  "broad_live",
  "integrated",
  "shadow_ready",
  "paper_ready",
  "limited_live_ready",
  "broad_live_ready",
  "paused",
  "deprecated",
]);

export const RuntimeStrategyLabTransitionTypeSchema = z.enum([
  "promote",
  "demote",
  "pause",
  "resume",
  "archive",
]);

export const RuntimeStrategyLabPromotionStatusSchema = z.enum([
  "pass",
  "blocked",
  "requires_human_approval",
  "applied",
]);

export const RuntimeStrategyLabImplementationReferenceSchema = z
  .object({
    kind: z.enum(["pull_request", "issue", "commit"]),
    ref: NON_EMPTY_STRING_SCHEMA,
    mergedAt: ISO_DATETIME_SCHEMA.optional(),
    revision: NON_EMPTY_STRING_SCHEMA.optional(),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeStrategyLabEvidenceRefSchema = z
  .object({
    kind: NON_EMPTY_STRING_SCHEMA,
    ref: NON_EMPTY_STRING_SCHEMA,
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeStrategyLabCheckSchema = z
  .object({
    checkId: NON_EMPTY_STRING_SCHEMA,
    status: RuntimeResearchPolicyGateStatusSchema,
    observedValue: NON_EMPTY_STRING_SCHEMA.optional(),
    thresholdValue: NON_EMPTY_STRING_SCHEMA.optional(),
    message: NON_EMPTY_STRING_SCHEMA,
  })
  .strict();

export const RuntimeStrategyLabActionSchema = z
  .object({
    actionId: NON_EMPTY_STRING_SCHEMA,
    actionType: z.enum([
      "record_state_transition",
      "upsert_runtime_deployment",
      "evaluate_runtime_deployment",
      "apply_runtime_control",
      "record_allowlist_change",
    ]),
    summary: NON_EMPTY_STRING_SCHEMA,
    required: z.boolean(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const RuntimeStrategyLabPromotionRecordSchema = VersionedSchema.extend({
  promotionId: NON_EMPTY_STRING_SCHEMA,
  subjectKind: RuntimeStrategyLabSubjectKindSchema,
  subjectKey: NON_EMPTY_STRING_SCHEMA,
  currentState: RuntimeStrategyLabPromotionStateSchema,
  targetState: RuntimeStrategyLabPromotionStateSchema,
  transitionType: RuntimeStrategyLabTransitionTypeSchema,
  status: RuntimeStrategyLabPromotionStatusSchema,
  summary: NON_EMPTY_STRING_SCHEMA,
  requestedBy: NON_EMPTY_STRING_SCHEMA,
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  appliedAt: ISO_DATETIME_SCHEMA.optional(),
  issueNumber: z.number().int().positive().optional(),
  pullRequestNumber: z.number().int().positive().optional(),
  deploymentId: NON_EMPTY_STRING_SCHEMA.optional(),
  policyGateId: NON_EMPTY_STRING_SCHEMA.optional(),
  synthesisId: NON_EMPTY_STRING_SCHEMA.optional(),
  triageId: NON_EMPTY_STRING_SCHEMA.optional(),
  implementationReference:
    RuntimeStrategyLabImplementationReferenceSchema.optional(),
  evidenceRefs: z.array(RuntimeStrategyLabEvidenceRefSchema).max(64),
  checks: z.array(RuntimeStrategyLabCheckSchema).min(1),
  actions: z.array(RuntimeStrategyLabActionSchema).min(1),
  approvals: z.array(RuntimeResearchHumanApprovalRecordSchema).max(16),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const RuntimeStrategyLabPromotionEventSchema = VersionedSchema.extend({
  eventId: NON_EMPTY_STRING_SCHEMA,
  promotionId: NON_EMPTY_STRING_SCHEMA,
  eventType: z.enum(["evaluated", "applied"]),
  actor: NON_EMPTY_STRING_SCHEMA,
  fromState: RuntimeStrategyLabPromotionStateSchema.optional(),
  toState: RuntimeStrategyLabPromotionStateSchema.optional(),
  summary: NON_EMPTY_STRING_SCHEMA,
  details: z.record(z.string(), z.unknown()).optional(),
  createdAt: ISO_DATETIME_SCHEMA,
}).strict();

export const RuntimeStrategyLabSubjectControlSchema = VersionedSchema.extend({
  subjectKind: RuntimeStrategyLabSubjectKindSchema,
  subjectKey: NON_EMPTY_STRING_SCHEMA,
  liveAllowed: z.boolean(),
  killSwitchEnabled: z.boolean(),
  disabledReason: NON_EMPTY_STRING_SCHEMA.optional(),
  updatedAt: ISO_DATETIME_SCHEMA,
  updatedBy: NON_EMPTY_STRING_SCHEMA.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const RuntimeStrategyLabReadinessControlsSchema = z
  .object({
    venue: RuntimeStrategyLabSubjectControlSchema.optional(),
    asset: RuntimeStrategyLabSubjectControlSchema.optional(),
  })
  .strict();

export const RuntimeStrategyLabReadinessArtifactSchema = VersionedSchema.extend(
  {
    readinessId: NON_EMPTY_STRING_SCHEMA,
    subjectKind: RuntimeStrategyLabSubjectKindSchema,
    subjectKey: NON_EMPTY_STRING_SCHEMA,
    targetState: z.enum(["limited_live_ready", "broad_live_ready"]),
    status: RuntimeStrategyLabPromotionStatusSchema,
    summary: NON_EMPTY_STRING_SCHEMA,
    venueKey: NON_EMPTY_STRING_SCHEMA.optional(),
    assetKey: NON_EMPTY_STRING_SCHEMA.optional(),
    canaryRunId: NON_EMPTY_STRING_SCHEMA.optional(),
    checks: z.array(RuntimeStrategyLabCheckSchema).min(1),
    evidenceRefs: z.array(RuntimeStrategyLabEvidenceRefSchema).max(64),
    controls: RuntimeStrategyLabReadinessControlsSchema.optional(),
    createdAt: ISO_DATETIME_SCHEMA,
    updatedAt: ISO_DATETIME_SCHEMA,
    metadata: z.record(z.string(), z.unknown()).optional(),
  },
).strict();

const RuntimeStrategyLabReadinessCanaryReconciliationSchema = z
  .object({
    status: z.enum(["passed", "failed", "not_attempted"]),
    actualOutputAtomic: NUMERIC_STRING_SCHEMA.optional(),
    minExpectedOutAtomic: NUMERIC_STRING_SCHEMA.optional(),
    notes: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
  })
  .strict();

export const RuntimeStrategyLabReadinessCanaryRunSchema =
  VersionedSchema.extend({
    runId: NON_EMPTY_STRING_SCHEMA,
    subjectKind: RuntimeStrategyLabSubjectKindSchema,
    subjectKey: NON_EMPTY_STRING_SCHEMA,
    venueKey: NON_EMPTY_STRING_SCHEMA,
    assetKey: NON_EMPTY_STRING_SCHEMA,
    pairSymbol: NON_EMPTY_STRING_SCHEMA,
    adapterKey: NON_EMPTY_STRING_SCHEMA,
    triggerSource: z.enum(["manual", "promotion"]),
    status: z.enum([
      "pending",
      "success",
      "blocked",
      "failed",
      "disabled",
      "skipped",
    ]),
    inputMint: PUBKEY_SCHEMA,
    outputMint: PUBKEY_SCHEMA,
    targetNotionalUsd: DECIMAL_STRING_SCHEMA,
    walletId: NON_EMPTY_STRING_SCHEMA.optional(),
    walletAddress: NON_EMPTY_STRING_SCHEMA.optional(),
    receiptId: NON_EMPTY_STRING_SCHEMA.optional(),
    signature: NON_EMPTY_STRING_SCHEMA.optional(),
    errorCode: NON_EMPTY_STRING_SCHEMA.optional(),
    errorMessage: NON_EMPTY_STRING_SCHEMA.optional(),
    reconciliation:
      RuntimeStrategyLabReadinessCanaryReconciliationSchema.optional(),
    evidenceRefs: z.array(RuntimeStrategyLabEvidenceRefSchema).max(16),
    metadata: z.record(z.string(), z.unknown()).optional(),
    startedAt: ISO_DATETIME_SCHEMA,
    completedAt: ISO_DATETIME_SCHEMA.optional(),
  }).strict();

export const RuntimeStrategyLabPostLiveActionSchema = z.enum([
  "observe",
  "revalidate",
  "demote",
  "pause",
  "disable_subject",
]);

export const RuntimeStrategyLabPostLiveArtifactSchema = VersionedSchema.extend({
  postLiveId: NON_EMPTY_STRING_SCHEMA,
  subjectKind: RuntimeStrategyLabSubjectKindSchema,
  subjectKey: NON_EMPTY_STRING_SCHEMA,
  currentState: RuntimeStrategyLabPromotionStateSchema.optional(),
  deploymentId: NON_EMPTY_STRING_SCHEMA.optional(),
  venueKey: NON_EMPTY_STRING_SCHEMA.optional(),
  assetKey: NON_EMPTY_STRING_SCHEMA.optional(),
  pairSymbol: NON_EMPTY_STRING_SCHEMA.optional(),
  status: RuntimeStrategyLabPromotionStatusSchema,
  summary: NON_EMPTY_STRING_SCHEMA,
  recommendedAction: RuntimeStrategyLabPostLiveActionSchema,
  recommendedTargetState: RuntimeStrategyLabPromotionStateSchema.optional(),
  appliedAction: RuntimeStrategyLabPostLiveActionSchema.optional(),
  appliedTargetState: RuntimeStrategyLabPromotionStateSchema.optional(),
  followUpPromotionId: NON_EMPTY_STRING_SCHEMA.optional(),
  followUpControlRef: NON_EMPTY_STRING_SCHEMA.optional(),
  checks: z.array(RuntimeStrategyLabCheckSchema).min(1),
  evidenceRefs: z.array(RuntimeStrategyLabEvidenceRefSchema).max(64),
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  appliedAt: ISO_DATETIME_SCHEMA.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const RuntimeStrategyDeskScenarioStateSchema = z.enum([
  "draft",
  "replay_ready",
  "shadow_ready",
  "paper_ready",
  "operator_review",
  "execution_ready",
  "execution_bound",
  "paused",
  "archived",
]);

export const RuntimeStrategyDeskRunKindSchema = z.enum([
  "replay",
  "backtest",
  "shadow",
  "paper",
  "promotion_review",
]);

export const RuntimeStrategyDeskRunStateSchema = z.enum([
  "pending",
  "legs_requested",
  "legs_running",
  "collecting_evidence",
  "needs_review",
  "completed",
  "rejected",
  "failed",
  "cancelled",
]);

export const RuntimeStrategyDeskLegRoleSchema = z.enum([
  "primary_alpha",
  "hedge",
  "inventory",
  "carry",
  "prediction",
  "liquidity",
  "flash_rebalance",
]);

export const RuntimeStrategyDeskEvidenceStageSchema = z.enum([
  "replay",
  "backtest",
  "shadow",
  "paper",
  "bounded_execution",
]);

export const RuntimeStrategyDeskPromotionHandoffStateSchema = z.enum([
  "draft",
  "awaiting_review",
  "approved",
  "applied",
  "rejected",
  "archived",
]);

export const RuntimeStrategyDeskBindingKindSchema = z.enum([
  "runtime_deployment",
  "worker_execution_recipe",
  "subject_control",
]);

export const RuntimeStrategyDeskTargetModeSchema = z.enum([
  "shadow",
  "paper",
  "limited_live",
]);

const RuntimeStrategyDeskScenarioLegSizingSchema = z
  .object({
    targetNotionalUsd: DECIMAL_STRING_SCHEMA,
    maxNotionalUsd: DECIMAL_STRING_SCHEMA.optional(),
    reserveUsd: DECIMAL_STRING_SCHEMA.optional(),
    maxSlippageBps: BPS_SCHEMA.optional(),
  })
  .strict();

const RuntimeStrategyDeskScenarioBorrowLegSchema = z
  .object({
    provider: NON_EMPTY_STRING_SCHEMA,
    mint: PUBKEY_SCHEMA,
    amountAtomic: DECIMAL_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeStrategyDeskScenarioLegIntentSchema = z
  .object({
    adapterKey: NON_EMPTY_STRING_SCHEMA.optional(),
    side: NON_EMPTY_STRING_SCHEMA.optional(),
    quantityAtomic: DECIMAL_STRING_SCHEMA.optional(),
    collateralAtomic: DECIMAL_STRING_SCHEMA.optional(),
    outcomeId: NON_EMPTY_STRING_SCHEMA.optional(),
    settlementMint: PUBKEY_SCHEMA.optional(),
    referenceId: NON_EMPTY_STRING_SCHEMA.optional(),
    borrowLegs: z
      .array(RuntimeStrategyDeskScenarioBorrowLegSchema)
      .max(8)
      .optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const RuntimeStrategyDeskEvidenceBucketSchema = z
  .object({
    stage: RuntimeStrategyDeskEvidenceStageSchema,
    summary: NON_EMPTY_STRING_SCHEMA,
    evidenceRefs: z.array(RuntimeStrategyLabEvidenceRefSchema).min(1).max(32),
    latestReportId: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeStrategyDeskRiskLimitsSchema = z
  .object({
    maxReservedCapitalUsd: DECIMAL_STRING_SCHEMA.optional(),
    maxGrossExposureUsd: DECIMAL_STRING_SCHEMA.optional(),
    maxNetExposureUsd: DECIMAL_STRING_SCHEMA.optional(),
    maxLegConcentrationBps: BPS_SCHEMA.optional(),
    maxVenueFamilyConcentrationBps: BPS_SCHEMA.optional(),
    maxDrawdownBps: BPS_SCHEMA.optional(),
  })
  .strict();

const RuntimeStrategyDeskStudySelectionMetricSchema = z.enum([
  "net_return_bps",
  "excess_vs_flat_cash_bps",
]);

const RuntimeStrategyDeskStudyCohortSchema = z.enum(["selection", "holdout"]);

const RuntimeStrategyDeskBacktestLegConfigSchema = z
  .object({
    legId: NON_EMPTY_STRING_SCHEMA,
    experimentId: NON_EMPTY_STRING_SCHEMA,
    replayCorpusId: NON_EMPTY_STRING_SCHEMA,
    venueKey: NON_EMPTY_STRING_SCHEMA,
    pairSymbol: NON_EMPTY_STRING_SCHEMA,
    marketType: RuntimeVenueMarketTypeSchema,
    windowMode: z.enum(["rolling", "anchored"]).optional(),
    trainingWindowObservations: z.number().int().positive().optional(),
    testingWindowObservations: z.number().int().positive().optional(),
    stepObservations: z.number().int().positive().optional(),
    purgeObservations: z.number().int().nonnegative().optional(),
    baselineStrategies: z
      .array(RuntimeBacktestBaselineSchema)
      .min(1)
      .optional(),
    notes: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
  })
  .strict();

const RuntimeStrategyDeskStudyWindowSchema = z
  .object({
    windowId: NON_EMPTY_STRING_SCHEMA,
    label: NON_EMPTY_STRING_SCHEMA,
    cohort: RuntimeStrategyDeskStudyCohortSchema,
    windowMode: z.enum(["rolling", "anchored"]),
    trainingWindowObservations: z.number().int().positive(),
    testingWindowObservations: z.number().int().positive(),
    stepObservations: z.number().int().positive(),
    purgeObservations: z.number().int().nonnegative(),
    notes: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
  })
  .strict();

const RuntimeStrategyDeskStudyVariantLegOverrideSchema = z
  .object({
    legId: NON_EMPTY_STRING_SCHEMA,
    experimentId: NON_EMPTY_STRING_SCHEMA.optional(),
    replayCorpusId: NON_EMPTY_STRING_SCHEMA.optional(),
    venueKey: NON_EMPTY_STRING_SCHEMA.optional(),
    pairSymbol: NON_EMPTY_STRING_SCHEMA.optional(),
    marketType: RuntimeVenueMarketTypeSchema.optional(),
    windowMode: z.enum(["rolling", "anchored"]).optional(),
    trainingWindowObservations: z.number().int().positive().optional(),
    testingWindowObservations: z.number().int().positive().optional(),
    stepObservations: z.number().int().positive().optional(),
    purgeObservations: z.number().int().nonnegative().optional(),
    baselineStrategies: z
      .array(RuntimeBacktestBaselineSchema)
      .min(1)
      .optional(),
  })
  .strict();

const RuntimeStrategyDeskStudyVariantSchema = z
  .object({
    variantId: NON_EMPTY_STRING_SCHEMA,
    label: NON_EMPTY_STRING_SCHEMA,
    parameterManifest: z.record(z.string(), z.unknown()),
    legOverrides: z
      .array(RuntimeStrategyDeskStudyVariantLegOverrideSchema)
      .max(16)
      .optional(),
    notes: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
  })
  .strict();

const RuntimeStrategyDeskResearchMatrixSchema = z
  .object({
    selectionMetric: RuntimeStrategyDeskStudySelectionMetricSchema.optional(),
    backtestLegs: z
      .array(RuntimeStrategyDeskBacktestLegConfigSchema)
      .min(1)
      .max(16),
    windows: z.array(RuntimeStrategyDeskStudyWindowSchema).min(1).max(16),
    variants: z.array(RuntimeStrategyDeskStudyVariantSchema).min(1).max(16),
  })
  .superRefine((value, ctx) => {
    addDuplicateIdIssues(ctx, value.backtestLegs, "backtestLegs", "legId");
    addDuplicateIdIssues(ctx, value.windows, "windows", "windowId");
    addDuplicateIdIssues(ctx, value.variants, "variants", "variantId");
  })
  .strict();

export const RuntimeStrategyDeskScenarioLegSchema = z
  .object({
    legId: NON_EMPTY_STRING_SCHEMA,
    label: NON_EMPTY_STRING_SCHEMA,
    role: RuntimeStrategyDeskLegRoleSchema,
    venueKey: NON_EMPTY_STRING_SCHEMA,
    intentFamily: RuntimeExecutionIntentFamilySchema,
    marketType: RuntimeVenueMarketTypeSchema,
    pair: PairSchema.optional(),
    instrumentId: NON_EMPTY_STRING_SCHEMA.optional(),
    assetKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1).max(8),
    enabledModes: z.array(RuntimeModeSchema).min(1).max(3),
    sizing: RuntimeStrategyDeskScenarioLegSizingSchema,
    intent: RuntimeStrategyDeskScenarioLegIntentSchema.optional(),
    thesis: NON_EMPTY_STRING_SCHEMA.optional(),
    dependencies: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
    tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
  })
  .strict();

export const RuntimeStrategyDeskScenarioManifestSchema = VersionedSchema.extend(
  {
    scenarioId: NON_EMPTY_STRING_SCHEMA,
    title: NON_EMPTY_STRING_SCHEMA,
    summary: NON_EMPTY_STRING_SCHEMA,
    ownerUserId: NON_EMPTY_STRING_SCHEMA,
    strategyKey: NON_EMPTY_STRING_SCHEMA,
    thesis: NON_EMPTY_STRING_SCHEMA,
    sleeveId: NON_EMPTY_STRING_SCHEMA.optional(),
    state: RuntimeStrategyDeskScenarioStateSchema,
    createdAt: ISO_DATETIME_SCHEMA,
    updatedAt: ISO_DATETIME_SCHEMA,
    reviewedAt: ISO_DATETIME_SCHEMA.optional(),
    activeHandoffId: NON_EMPTY_STRING_SCHEMA.optional(),
    latestReportId: NON_EMPTY_STRING_SCHEMA.optional(),
    riskLimits: RuntimeStrategyDeskRiskLimitsSchema.optional(),
    researchMatrix: RuntimeStrategyDeskResearchMatrixSchema.optional(),
    legs: z.array(RuntimeStrategyDeskScenarioLegSchema).min(1).max(16),
    evidence: z.array(RuntimeStrategyDeskEvidenceBucketSchema).max(8),
    implementationReferences: z
      .array(RuntimeStrategyLabImplementationReferenceSchema)
      .max(16),
    tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
    metadata: z.record(z.string(), z.unknown()).optional(),
  },
).strict();

const RuntimeStrategyDeskLegRunRefSchema = z
  .object({
    legId: NON_EMPTY_STRING_SCHEMA,
    stage: RuntimeStrategyDeskEvidenceStageSchema,
    state: z.enum(["pending", "submitted", "completed", "failed", "skipped"]),
    requestRef: NON_EMPTY_STRING_SCHEMA.optional(),
    runtimeRunId: NON_EMPTY_STRING_SCHEMA.optional(),
    runtimeDeploymentId: NON_EMPTY_STRING_SCHEMA.optional(),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeStrategyDeskScenarioRunSchema = VersionedSchema.extend({
  scenarioRunId: NON_EMPTY_STRING_SCHEMA,
  scenarioId: NON_EMPTY_STRING_SCHEMA,
  scenarioState: RuntimeStrategyDeskScenarioStateSchema,
  runKind: RuntimeStrategyDeskRunKindSchema,
  state: RuntimeStrategyDeskRunStateSchema,
  requestedBy: NON_EMPTY_STRING_SCHEMA,
  trigger: RuntimeTriggerSchema,
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  startedAt: ISO_DATETIME_SCHEMA.optional(),
  completedAt: ISO_DATETIME_SCHEMA.optional(),
  legRuns: z.array(RuntimeStrategyDeskLegRunRefSchema).min(1).max(16),
  failureCode: NON_EMPTY_STRING_SCHEMA.optional(),
  failureMessage: NON_EMPTY_STRING_SCHEMA.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const RuntimeStrategyDeskLegOutcomeSchema = z
  .object({
    legId: NON_EMPTY_STRING_SCHEMA,
    status: RuntimeResearchPolicyGateStatusSchema,
    netPnlUsd: NUMERIC_STRING_SCHEMA.optional(),
    costUsd: DECIMAL_STRING_SCHEMA.optional(),
    evidenceRefs: z.array(RuntimeStrategyLabEvidenceRefSchema).max(16),
    notes: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
  })
  .strict();

const RuntimeStrategyDeskPortfolioSummarySchema = z
  .object({
    capitalAllocatedUsd: DECIMAL_STRING_SCHEMA.optional(),
    grossExposureBudgetUsd: DECIMAL_STRING_SCHEMA.optional(),
    equityUsd: DECIMAL_STRING_SCHEMA.optional(),
    availableUsd: DECIMAL_STRING_SCHEMA.optional(),
    reservedUsd: DECIMAL_STRING_SCHEMA.optional(),
    realizedPnlUsd: NUMERIC_STRING_SCHEMA.optional(),
    unrealizedPnlUsd: NUMERIC_STRING_SCHEMA.optional(),
    grossPnlUsd: NUMERIC_STRING_SCHEMA.optional(),
    netPnlUsd: NUMERIC_STRING_SCHEMA.optional(),
    grossExposureUsd: DECIMAL_STRING_SCHEMA.optional(),
    netExposureUsd: NUMERIC_STRING_SCHEMA.optional(),
    maxDrawdownBps: BPS_SCHEMA.optional(),
    tradeCount: z.number().int().nonnegative().optional(),
    activeLegCount: z.number().int().nonnegative().optional(),
    venueExposureUsd: z.record(z.string(), DECIMAL_STRING_SCHEMA).optional(),
    venueFamilyExposureUsd: z
      .record(z.string(), DECIMAL_STRING_SCHEMA)
      .optional(),
    marketTypeExposureUsd: z
      .record(z.string(), DECIMAL_STRING_SCHEMA)
      .optional(),
    notes: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
  })
  .strict();

const RuntimeStrategyDeskRiskOverlayCategorySchema = z.enum([
  "capital",
  "concentration",
  "exposure",
  "margin",
  "venue_family",
  "failure_state",
]);

const RuntimeStrategyDeskRiskOverlaySchema = z
  .object({
    overlayId: NON_EMPTY_STRING_SCHEMA,
    category: RuntimeStrategyDeskRiskOverlayCategorySchema,
    status: RuntimeResearchPolicyGateStatusSchema,
    observedValue: NON_EMPTY_STRING_SCHEMA.optional(),
    thresholdValue: NON_EMPTY_STRING_SCHEMA.optional(),
    legIds: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
    message: NON_EMPTY_STRING_SCHEMA,
  })
  .strict();

const RuntimeStrategyDeskScorecardLegMetricSchema = z
  .object({
    legId: NON_EMPTY_STRING_SCHEMA,
    venueKey: NON_EMPTY_STRING_SCHEMA,
    intentFamily: RuntimeExecutionIntentFamilySchema,
    marketType: RuntimeVenueMarketTypeSchema,
    status: RuntimeResearchPolicyGateStatusSchema,
    targetNotionalUsd: DECIMAL_STRING_SCHEMA.optional(),
    reservedCapitalUsd: DECIMAL_STRING_SCHEMA.optional(),
    grossExposureUsd: DECIMAL_STRING_SCHEMA.optional(),
    netExposureUsd: NUMERIC_STRING_SCHEMA.optional(),
    netPnlUsd: NUMERIC_STRING_SCHEMA.optional(),
    costUsd: DECIMAL_STRING_SCHEMA.optional(),
    notes: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
  })
  .strict();

const RuntimeStrategyDeskScenarioScorecardSchema = z
  .object({
    aggregate: z
      .object({
        passedLegCount: z.number().int().nonnegative(),
        blockedLegCount: z.number().int().nonnegative(),
        skippedLegCount: z.number().int().nonnegative(),
        activeLegCount: z.number().int().nonnegative().optional(),
        tradeCount: z.number().int().nonnegative().optional(),
        reservedCapitalUsd: DECIMAL_STRING_SCHEMA.optional(),
        grossExposureUsd: DECIMAL_STRING_SCHEMA.optional(),
        netExposureUsd: NUMERIC_STRING_SCHEMA.optional(),
        grossPnlUsd: NUMERIC_STRING_SCHEMA.optional(),
        netPnlUsd: NUMERIC_STRING_SCHEMA.optional(),
        totalCostUsd: DECIMAL_STRING_SCHEMA.optional(),
        maxDrawdownBps: BPS_SCHEMA.optional(),
      })
      .strict(),
    legMetrics: z
      .array(RuntimeStrategyDeskScorecardLegMetricSchema)
      .min(1)
      .max(16),
  })
  .strict();

const RuntimeStrategyDeskStudyLegResultSchema = z
  .object({
    legId: NON_EMPTY_STRING_SCHEMA,
    reportId: NON_EMPTY_STRING_SCHEMA,
    reproducibilityBundleId: NON_EMPTY_STRING_SCHEMA,
    status: RuntimeBacktestStatusSchema,
    metrics: RuntimeBacktestMetricsSchema,
    baselineComparisons: z
      .array(RuntimeBacktestBaselineComparisonSchema)
      .optional(),
    blockingReasons: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
  })
  .strict();

const RuntimeStrategyDeskStudyMatrixWindowSchema = z
  .object({
    windowId: NON_EMPTY_STRING_SCHEMA,
    label: NON_EMPTY_STRING_SCHEMA,
    cohort: RuntimeStrategyDeskStudyCohortSchema,
  })
  .strict();

const RuntimeStrategyDeskStudyMatrixCellSchema = z
  .object({
    cellId: NON_EMPTY_STRING_SCHEMA,
    variantId: NON_EMPTY_STRING_SCHEMA,
    variantLabel: NON_EMPTY_STRING_SCHEMA,
    windowId: NON_EMPTY_STRING_SCHEMA,
    windowLabel: NON_EMPTY_STRING_SCHEMA,
    cohort: RuntimeStrategyDeskStudyCohortSchema,
    status: RuntimeBacktestStatusSchema,
    legResults: z.array(RuntimeStrategyDeskStudyLegResultSchema).min(1).max(16),
    aggregateMetrics: RuntimeBacktestMetricsSchema,
    aggregateBaselineComparisons: z
      .array(RuntimeBacktestBaselineComparisonSchema)
      .optional(),
    notes: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
  })
  .strict();

const RuntimeStrategyDeskStudyVariantSummarySchema = z
  .object({
    variantId: NON_EMPTY_STRING_SCHEMA,
    label: NON_EMPTY_STRING_SCHEMA,
    parameterManifest: z.record(z.string(), z.unknown()),
    selectionWindowCount: z.number().int().nonnegative(),
    holdoutWindowCount: z.number().int().nonnegative(),
    selectionMetrics: RuntimeBacktestMetricsSchema.optional(),
    selectionBaselineComparisons: z
      .array(RuntimeBacktestBaselineComparisonSchema)
      .optional(),
    holdoutMetrics: RuntimeBacktestMetricsSchema.optional(),
    holdoutBaselineComparisons: z
      .array(RuntimeBacktestBaselineComparisonSchema)
      .optional(),
    notes: z.array(NON_EMPTY_STRING_SCHEMA).max(16).optional(),
  })
  .strict();

const RuntimeStrategyDeskStudyMatrixSchema = z
  .object({
    matrixId: NON_EMPTY_STRING_SCHEMA,
    runKind: z.enum(["replay", "backtest"]),
    selectionMetric: RuntimeStrategyDeskStudySelectionMetricSchema,
    generatedAt: ISO_DATETIME_SCHEMA,
    selectedVariantId: NON_EMPTY_STRING_SCHEMA.optional(),
    windows: z.array(RuntimeStrategyDeskStudyMatrixWindowSchema).min(1).max(16),
    variantSummaries: z
      .array(RuntimeStrategyDeskStudyVariantSummarySchema)
      .min(1)
      .max(16),
    cells: z.array(RuntimeStrategyDeskStudyMatrixCellSchema).min(1).max(256),
  })
  .strict();

export const RuntimeStrategyDeskScenarioReportSchema = VersionedSchema.extend({
  reportId: NON_EMPTY_STRING_SCHEMA,
  scenarioId: NON_EMPTY_STRING_SCHEMA,
  scenarioRunId: NON_EMPTY_STRING_SCHEMA,
  stage: RuntimeStrategyDeskEvidenceStageSchema,
  status: RuntimeResearchPolicyGateStatusSchema,
  summary: NON_EMPTY_STRING_SCHEMA,
  generatedAt: ISO_DATETIME_SCHEMA,
  legOutcomes: z.array(RuntimeStrategyDeskLegOutcomeSchema).min(1).max(16),
  portfolioSummary: RuntimeStrategyDeskPortfolioSummarySchema.optional(),
  scorecard: RuntimeStrategyDeskScenarioScorecardSchema.optional(),
  riskOverlays: z
    .array(RuntimeStrategyDeskRiskOverlaySchema)
    .max(16)
    .optional(),
  studyMatrix: RuntimeStrategyDeskStudyMatrixSchema.optional(),
  evidence: z.array(RuntimeStrategyDeskEvidenceBucketSchema).max(8),
  checks: z.array(RuntimeStrategyLabCheckSchema).min(1),
  approvals: z.array(RuntimeResearchHumanApprovalRecordSchema).max(16),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const RuntimeStrategyDeskRuntimeBindingSchema = z
  .object({
    bindingId: NON_EMPTY_STRING_SCHEMA,
    bindingKind: RuntimeStrategyDeskBindingKindSchema,
    legIds: z.array(NON_EMPTY_STRING_SCHEMA).min(1).max(16),
    venueKey: NON_EMPTY_STRING_SCHEMA,
    pair: PairSchema.optional(),
    instrumentId: NON_EMPTY_STRING_SCHEMA.optional(),
    targetMode: RuntimeStrategyDeskTargetModeSchema,
    deploymentId: NON_EMPTY_STRING_SCHEMA.optional(),
    lane: RuntimeLaneSchema.optional(),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

export const RuntimeStrategyDeskPromotionHandoffSchema = VersionedSchema.extend(
  {
    handoffId: NON_EMPTY_STRING_SCHEMA,
    scenarioId: NON_EMPTY_STRING_SCHEMA,
    currentState: RuntimeStrategyDeskScenarioStateSchema,
    targetMode: RuntimeStrategyDeskTargetModeSchema,
    status: RuntimeStrategyDeskPromotionHandoffStateSchema,
    summary: NON_EMPTY_STRING_SCHEMA,
    requestedBy: NON_EMPTY_STRING_SCHEMA,
    createdAt: ISO_DATETIME_SCHEMA,
    updatedAt: ISO_DATETIME_SCHEMA,
    appliedAt: ISO_DATETIME_SCHEMA.optional(),
    implementationReference:
      RuntimeStrategyLabImplementationReferenceSchema.optional(),
    evidenceRefs: z.array(RuntimeStrategyLabEvidenceRefSchema).min(1).max(64),
    checks: z.array(RuntimeStrategyLabCheckSchema).min(1),
    approvals: z.array(RuntimeResearchHumanApprovalRecordSchema).max(16),
    bindings: z.array(RuntimeStrategyDeskRuntimeBindingSchema).min(1).max(16),
    actions: z.array(RuntimeStrategyLabActionSchema).min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  },
).strict();

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

const RuntimeExecutionCostCalibrationSchema = z
  .object({
    calibrationId: NON_EMPTY_STRING_SCHEMA,
    methodology: NON_EMPTY_STRING_SCHEMA,
    sampleStartAt: ISO_DATETIME_SCHEMA,
    sampleEndAt: ISO_DATETIME_SCHEMA,
    sampleCount: z.number().int().positive(),
    confidenceBps: BPS_SCHEMA,
    referenceNotionalUsd: DECIMAL_STRING_SCHEMA,
    tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
    notes: NON_EMPTY_STRING_SCHEMA.optional(),
  })
  .strict();

const RuntimeExecutionCostDriftGuardSchema = z
  .object({
    maxCostDriftBps: BPS_SCHEMA,
    maxLatencyDriftMs: z.number().int().nonnegative(),
    maxReconciliationDriftUsd: DECIMAL_STRING_SCHEMA,
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
  calibration: RuntimeExecutionCostCalibrationSchema,
  driftGuard: RuntimeExecutionCostDriftGuardSchema,
  latencyProfile: RuntimeVenueLatencyProfileSchema,
  datasetSnapshots: z.array(RuntimeDatasetSnapshotRefSchema).min(1),
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
  tags: z.array(NON_EMPTY_STRING_SCHEMA).max(16),
  notes: NON_EMPTY_STRING_SCHEMA.optional(),
}).strict();

export const RuntimeExecutionCostObservationRecordSchema =
  VersionedSchema.extend({
    observationId: NON_EMPTY_STRING_SCHEMA,
    modelId: NON_EMPTY_STRING_SCHEMA,
    deploymentId: NON_EMPTY_STRING_SCHEMA,
    runId: NON_EMPTY_STRING_SCHEMA,
    receiptId: NON_EMPTY_STRING_SCHEMA,
    venueKey: NON_EMPTY_STRING_SCHEMA,
    marketType: RuntimeVenueMarketTypeSchema,
    pairSymbol: NON_EMPTY_STRING_SCHEMA,
    assetKeys: z.array(NON_EMPTY_STRING_SCHEMA).min(1),
    mode: RuntimeModeSchema,
    observedAt: ISO_DATETIME_SCHEMA,
    evaluatedNotionalUsd: DECIMAL_STRING_SCHEMA,
    modeledTotalCostUsd: DECIMAL_STRING_SCHEMA,
    observedTotalCostUsd: DECIMAL_STRING_SCHEMA,
    costDriftUsd: DECIMAL_STRING_SCHEMA,
    costDriftBps: BPS_SCHEMA,
    expectedEndToEndLatencyMs: z.number().int().nonnegative(),
    observedEndToEndLatencyMs: z.number().int().nonnegative(),
    latencyDriftMs: z.number().int().nonnegative(),
    reconciliationStatus: z.enum(["passed", "needs_manual_review", "failed"]),
    reconciliationDriftUsd: DECIMAL_STRING_SCHEMA,
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
export type RuntimeExecutionCostCalibration = z.infer<
  typeof RuntimeExecutionCostCalibrationSchema
>;
export type RuntimeExecutionCostDriftGuard = z.infer<
  typeof RuntimeExecutionCostDriftGuardSchema
>;
export type RuntimeExecutionCostModelRecord = z.infer<
  typeof RuntimeExecutionCostModelRecordSchema
>;
export type RuntimeExecutionCostObservationRecord = z.infer<
  typeof RuntimeExecutionCostObservationRecordSchema
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
export type RuntimeExperimentVerificationMode = z.infer<
  typeof RuntimeExperimentVerificationModeSchema
>;
export type RuntimeBacktestStatus = z.infer<typeof RuntimeBacktestStatusSchema>;
export type RuntimeBacktestWindowMode = z.infer<
  typeof RuntimeBacktestWindowModeSchema
>;
export type RuntimeBacktestBaseline = z.infer<
  typeof RuntimeBacktestBaselineSchema
>;
export type RuntimeBacktestReport = z.infer<typeof RuntimeBacktestReportSchema>;
export type RuntimeResearchReproducibilityBundleRecord = z.infer<
  typeof RuntimeResearchReproducibilityBundleRecordSchema
>;
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
export type RuntimeExecutionIntentFamily = z.infer<
  typeof RuntimeExecutionIntentFamilySchema
>;
export type RuntimeVenueAuthModel = z.infer<typeof RuntimeVenueAuthModelSchema>;
export type RuntimeVenueFeeModel = z.infer<typeof RuntimeVenueFeeModelSchema>;
export type RuntimeVenueSettlementBehavior = z.infer<
  typeof RuntimeVenueSettlementBehaviorSchema
>;
export type RuntimeVenueSettlementModel = z.infer<
  typeof RuntimeVenueSettlementModelSchema
>;
export type RuntimeVenueOracleRequirement = z.infer<
  typeof RuntimeVenueOracleRequirementSchema
>;
export type RuntimeVenueLifecycleCapability = z.infer<
  typeof RuntimeVenueLifecycleCapabilitySchema
>;
export type RuntimeMarginRiskLevel = z.infer<
  typeof RuntimeMarginRiskLevelSchema
>;
export type RuntimeMarginOracleStatus = z.infer<
  typeof RuntimeMarginOracleStatusSchema
>;
export type RuntimeMarginAccountSnapshot = z.infer<
  typeof RuntimeMarginAccountSnapshotSchema
>;
export type RuntimeVenueCapability = z.infer<
  typeof RuntimeVenueCapabilitySchema
>;
export type RuntimeAssetRecord = z.infer<typeof RuntimeAssetRecordSchema>;
export type RuntimeStrategySpec = z.infer<typeof RuntimeStrategySpecSchema>;
export type RuntimeResearchPolicyTargetMode = z.infer<
  typeof RuntimeResearchPolicyTargetModeSchema
>;
export type RuntimeResearchPolicyGateStatus = z.infer<
  typeof RuntimeResearchPolicyGateStatusSchema
>;
export type RuntimeResearchHumanApprovalRecord = z.infer<
  typeof RuntimeResearchHumanApprovalRecordSchema
>;
export type RuntimeResearchPolicyGateArtifact = z.infer<
  typeof RuntimeResearchPolicyGateArtifactSchema
>;
export type RuntimeStrategyLabSubjectKind = z.infer<
  typeof RuntimeStrategyLabSubjectKindSchema
>;
export type RuntimeStrategyLabStrategyState = z.infer<
  typeof RuntimeStrategyLabStrategyStateSchema
>;
export type RuntimeStrategyLabPromotionState = z.infer<
  typeof RuntimeStrategyLabPromotionStateSchema
>;
export type RuntimeStrategyLabTransitionType = z.infer<
  typeof RuntimeStrategyLabTransitionTypeSchema
>;
export type RuntimeStrategyLabPromotionStatus = z.infer<
  typeof RuntimeStrategyLabPromotionStatusSchema
>;
export type RuntimeStrategyLabImplementationReference = z.infer<
  typeof RuntimeStrategyLabImplementationReferenceSchema
>;
export type RuntimeStrategyLabEvidenceRef = z.infer<
  typeof RuntimeStrategyLabEvidenceRefSchema
>;
export type RuntimeStrategyLabCheck = z.infer<
  typeof RuntimeStrategyLabCheckSchema
>;
export type RuntimeStrategyLabAction = z.infer<
  typeof RuntimeStrategyLabActionSchema
>;
export type RuntimeStrategyLabPromotionRecord = z.infer<
  typeof RuntimeStrategyLabPromotionRecordSchema
>;
export type RuntimeStrategyLabPromotionEvent = z.infer<
  typeof RuntimeStrategyLabPromotionEventSchema
>;
export type RuntimeStrategyLabSubjectControl = z.infer<
  typeof RuntimeStrategyLabSubjectControlSchema
>;
export type RuntimeStrategyLabReadinessArtifact = z.infer<
  typeof RuntimeStrategyLabReadinessArtifactSchema
>;
export type RuntimeStrategyLabReadinessCanaryRun = z.infer<
  typeof RuntimeStrategyLabReadinessCanaryRunSchema
>;
export type RuntimeStrategyLabPostLiveAction = z.infer<
  typeof RuntimeStrategyLabPostLiveActionSchema
>;
export type RuntimeStrategyLabPostLiveArtifact = z.infer<
  typeof RuntimeStrategyLabPostLiveArtifactSchema
>;
export type RuntimeStrategyDeskScenarioState = z.infer<
  typeof RuntimeStrategyDeskScenarioStateSchema
>;
export type RuntimeStrategyDeskRunKind = z.infer<
  typeof RuntimeStrategyDeskRunKindSchema
>;
export type RuntimeStrategyDeskRunState = z.infer<
  typeof RuntimeStrategyDeskRunStateSchema
>;
export type RuntimeStrategyDeskLegRole = z.infer<
  typeof RuntimeStrategyDeskLegRoleSchema
>;
export type RuntimeStrategyDeskEvidenceStage = z.infer<
  typeof RuntimeStrategyDeskEvidenceStageSchema
>;
export type RuntimeStrategyDeskPromotionHandoffState = z.infer<
  typeof RuntimeStrategyDeskPromotionHandoffStateSchema
>;
export type RuntimeStrategyDeskBindingKind = z.infer<
  typeof RuntimeStrategyDeskBindingKindSchema
>;
export type RuntimeStrategyDeskTargetMode = z.infer<
  typeof RuntimeStrategyDeskTargetModeSchema
>;
export type RuntimeStrategyDeskScenarioLeg = z.infer<
  typeof RuntimeStrategyDeskScenarioLegSchema
>;
export type RuntimeStrategyDeskScenarioManifest = z.infer<
  typeof RuntimeStrategyDeskScenarioManifestSchema
>;
export type RuntimeStrategyDeskScenarioRun = z.infer<
  typeof RuntimeStrategyDeskScenarioRunSchema
>;
export type RuntimeStrategyDeskScenarioReport = z.infer<
  typeof RuntimeStrategyDeskScenarioReportSchema
>;
export type RuntimeStrategyDeskPromotionHandoff = z.infer<
  typeof RuntimeStrategyDeskPromotionHandoffSchema
>;

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

export const RUNTIME_STRATEGY_LAB_STRATEGY_STATE_TRANSITIONS = {
  candidate: ["draft", "deprecated"],
  draft: ["candidate", "shadow", "deprecated"],
  shadow: ["draft", "paper", "paused", "deprecated"],
  paper: ["shadow", "limited_live", "paused", "deprecated"],
  limited_live: ["paper", "broad_live", "paused", "deprecated"],
  broad_live: ["limited_live", "paused", "deprecated"],
  paused: ["shadow", "paper", "limited_live", "broad_live", "deprecated"],
  deprecated: [],
} as const satisfies Record<
  RuntimeStrategyLabStrategyState,
  readonly RuntimeStrategyLabStrategyState[]
>;

export const RUNTIME_STRATEGY_LAB_READINESS_STATE_TRANSITIONS = {
  candidate: ["integrated", "deprecated"],
  integrated: ["candidate", "shadow_ready", "deprecated"],
  shadow_ready: ["integrated", "paper_ready", "paused", "deprecated"],
  paper_ready: ["shadow_ready", "limited_live_ready", "paused", "deprecated"],
  limited_live_ready: [
    "paper_ready",
    "broad_live_ready",
    "paused",
    "deprecated",
  ],
  broad_live_ready: ["limited_live_ready", "paused", "deprecated"],
  paused: [
    "shadow_ready",
    "paper_ready",
    "limited_live_ready",
    "broad_live_ready",
    "deprecated",
  ],
  deprecated: [],
} as const satisfies Record<
  Exclude<
    RuntimeStrategyLabPromotionState,
    "draft" | "shadow" | "paper" | "limited_live" | "broad_live"
  >,
  readonly RuntimeStrategyLabPromotionState[]
>;

export const RUNTIME_STRATEGY_DESK_SCENARIO_STATE_TRANSITIONS = {
  draft: ["replay_ready", "archived"],
  replay_ready: ["shadow_ready", "paused", "archived"],
  shadow_ready: ["paper_ready", "paused", "archived"],
  paper_ready: ["operator_review", "paused", "archived"],
  operator_review: ["paper_ready", "execution_ready", "paused", "archived"],
  execution_ready: ["execution_bound", "paused", "archived"],
  execution_bound: ["operator_review", "paused", "archived"],
  paused: [
    "replay_ready",
    "shadow_ready",
    "paper_ready",
    "operator_review",
    "execution_ready",
    "execution_bound",
    "archived",
  ],
  archived: [],
} as const satisfies Record<
  RuntimeStrategyDeskScenarioState,
  readonly RuntimeStrategyDeskScenarioState[]
>;

export const RUNTIME_STRATEGY_DESK_RUN_STATE_TRANSITIONS = {
  pending: ["legs_requested", "rejected", "cancelled"],
  legs_requested: ["legs_running", "failed", "cancelled"],
  legs_running: ["collecting_evidence", "failed", "cancelled"],
  collecting_evidence: ["completed", "needs_review", "failed", "rejected"],
  needs_review: ["completed", "failed", "cancelled"],
  completed: [],
  rejected: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<
  RuntimeStrategyDeskRunState,
  readonly RuntimeStrategyDeskRunState[]
>;

export const RUNTIME_STRATEGY_DESK_PROMOTION_HANDOFF_STATE_TRANSITIONS = {
  draft: ["awaiting_review", "archived"],
  awaiting_review: ["approved", "rejected", "archived"],
  approved: ["applied", "archived"],
  applied: ["archived"],
  rejected: ["draft", "archived"],
  archived: [],
} as const satisfies Record<
  RuntimeStrategyDeskPromotionHandoffState,
  readonly RuntimeStrategyDeskPromotionHandoffState[]
>;

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
  researchReproducibilityBundle: {
    schema: RuntimeResearchReproducibilityBundleRecordSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/research_reproducibility_bundle",
    outputFile: "runtime.research_reproducibility_bundle.v1.schema.json",
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
  executionCostObservation: {
    schema: RuntimeExecutionCostObservationRecordSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/execution_cost_observation",
    outputFile: "runtime.execution_cost_observation.v1.schema.json",
  },
  venueCapability: {
    schema: RuntimeVenueCapabilitySchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/venue_capability",
    outputFile: "runtime.venue_capability.v1.schema.json",
  },
  marginAccountSnapshot: {
    schema: RuntimeMarginAccountSnapshotSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/margin_account_snapshot",
    outputFile: "runtime.margin_account_snapshot.v1.schema.json",
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
  strategyLabPromotion: {
    schema: RuntimeStrategyLabPromotionRecordSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/strategy_lab_promotion",
    outputFile: "runtime.strategy_lab_promotion.v1.schema.json",
  },
  strategyLabPromotionEvent: {
    schema: RuntimeStrategyLabPromotionEventSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/strategy_lab_promotion_event",
    outputFile: "runtime.strategy_lab_promotion_event.v1.schema.json",
  },
  strategyLabSubjectControl: {
    schema: RuntimeStrategyLabSubjectControlSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/strategy_lab_subject_control",
    outputFile: "runtime.strategy_lab_subject_control.v1.schema.json",
  },
  strategyLabReadinessArtifact: {
    schema: RuntimeStrategyLabReadinessArtifactSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/strategy_lab_readiness_artifact",
    outputFile: "runtime.strategy_lab_readiness_artifact.v1.schema.json",
  },
  strategyLabReadinessCanaryRun: {
    schema: RuntimeStrategyLabReadinessCanaryRunSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/strategy_lab_readiness_canary_run",
    outputFile: "runtime.strategy_lab_readiness_canary_run.v1.schema.json",
  },
  strategyLabPostLiveArtifact: {
    schema: RuntimeStrategyLabPostLiveArtifactSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/strategy_lab_post_live_artifact",
    outputFile: "runtime.strategy_lab_post_live_artifact.v1.schema.json",
  },
  strategyDeskScenario: {
    schema: RuntimeStrategyDeskScenarioManifestSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/strategy_desk_scenario",
    outputFile: "runtime.strategy_desk_scenario.v1.schema.json",
  },
  strategyDeskLeg: {
    schema: RuntimeStrategyDeskScenarioLegSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/strategy_desk_leg",
    outputFile: "runtime.strategy_desk_leg.v1.schema.json",
  },
  strategyDeskRun: {
    schema: RuntimeStrategyDeskScenarioRunSchema,
    schemaId: "https://trader-ralph.com/schemas/runtime/v1/strategy_desk_run",
    outputFile: "runtime.strategy_desk_run.v1.schema.json",
  },
  strategyDeskReport: {
    schema: RuntimeStrategyDeskScenarioReportSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/strategy_desk_report",
    outputFile: "runtime.strategy_desk_report.v1.schema.json",
  },
  strategyDeskPromotionHandoff: {
    schema: RuntimeStrategyDeskPromotionHandoffSchema,
    schemaId:
      "https://trader-ralph.com/schemas/runtime/v1/strategy_desk_promotion_handoff",
    outputFile: "runtime.strategy_desk_promotion_handoff.v1.schema.json",
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

export function canTransitionRuntimeStrategyLabStrategyState(
  from: RuntimeStrategyLabStrategyState,
  to: RuntimeStrategyLabStrategyState,
): boolean {
  const allowed = RUNTIME_STRATEGY_LAB_STRATEGY_STATE_TRANSITIONS[
    from
  ] as readonly RuntimeStrategyLabStrategyState[];
  return allowed.includes(to);
}

export function canTransitionRuntimeStrategyLabReadinessState(
  from: Exclude<
    RuntimeStrategyLabPromotionState,
    "draft" | "shadow" | "paper" | "limited_live" | "broad_live"
  >,
  to: RuntimeStrategyLabPromotionState,
): boolean {
  const allowed = RUNTIME_STRATEGY_LAB_READINESS_STATE_TRANSITIONS[
    from
  ] as readonly RuntimeStrategyLabPromotionState[];
  return allowed.includes(to);
}

export function canTransitionRuntimeStrategyDeskScenarioState(
  from: RuntimeStrategyDeskScenarioState,
  to: RuntimeStrategyDeskScenarioState,
): boolean {
  const allowed = RUNTIME_STRATEGY_DESK_SCENARIO_STATE_TRANSITIONS[
    from
  ] as readonly RuntimeStrategyDeskScenarioState[];
  return allowed.includes(to);
}

export function canTransitionRuntimeStrategyDeskRunState(
  from: RuntimeStrategyDeskRunState,
  to: RuntimeStrategyDeskRunState,
): boolean {
  const allowed = RUNTIME_STRATEGY_DESK_RUN_STATE_TRANSITIONS[
    from
  ] as readonly RuntimeStrategyDeskRunState[];
  return allowed.includes(to);
}

export function canTransitionRuntimeStrategyDeskPromotionHandoffState(
  from: RuntimeStrategyDeskPromotionHandoffState,
  to: RuntimeStrategyDeskPromotionHandoffState,
): boolean {
  const allowed = RUNTIME_STRATEGY_DESK_PROMOTION_HANDOFF_STATE_TRANSITIONS[
    from
  ] as readonly RuntimeStrategyDeskPromotionHandoffState[];
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

export function parseRuntimeExecutionCostObservationRecord(
  input: unknown,
): RuntimeExecutionCostObservationRecord {
  return RuntimeExecutionCostObservationRecordSchema.parse(input);
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

export function parseRuntimeResearchReproducibilityBundleRecord(
  input: unknown,
): RuntimeResearchReproducibilityBundleRecord {
  return RuntimeResearchReproducibilityBundleRecordSchema.parse(input);
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

export function parseRuntimeMarginAccountSnapshot(
  input: unknown,
): RuntimeMarginAccountSnapshot {
  return RuntimeMarginAccountSnapshotSchema.parse(input);
}

export function parseRuntimeAssetRecord(input: unknown): RuntimeAssetRecord {
  return RuntimeAssetRecordSchema.parse(input);
}

export function parseRuntimeStrategySpec(input: unknown): RuntimeStrategySpec {
  return RuntimeStrategySpecSchema.parse(input);
}

export function parseRuntimeResearchPolicyGateArtifact(
  input: unknown,
): RuntimeResearchPolicyGateArtifact {
  return RuntimeResearchPolicyGateArtifactSchema.parse(input);
}

export function parseRuntimeStrategyLabPromotionRecord(
  input: unknown,
): RuntimeStrategyLabPromotionRecord {
  return RuntimeStrategyLabPromotionRecordSchema.parse(input);
}

export function parseRuntimeStrategyLabPromotionEvent(
  input: unknown,
): RuntimeStrategyLabPromotionEvent {
  return RuntimeStrategyLabPromotionEventSchema.parse(input);
}

export function parseRuntimeStrategyLabSubjectControl(
  input: unknown,
): RuntimeStrategyLabSubjectControl {
  return RuntimeStrategyLabSubjectControlSchema.parse(input);
}

export function parseRuntimeStrategyLabReadinessArtifact(
  input: unknown,
): RuntimeStrategyLabReadinessArtifact {
  return RuntimeStrategyLabReadinessArtifactSchema.parse(input);
}

export function parseRuntimeStrategyLabReadinessCanaryRun(
  input: unknown,
): RuntimeStrategyLabReadinessCanaryRun {
  return RuntimeStrategyLabReadinessCanaryRunSchema.parse(input);
}

export function parseRuntimeStrategyLabPostLiveArtifact(
  input: unknown,
): RuntimeStrategyLabPostLiveArtifact {
  return RuntimeStrategyLabPostLiveArtifactSchema.parse(input);
}

export function parseRuntimeStrategyDeskScenarioManifest(
  input: unknown,
): RuntimeStrategyDeskScenarioManifest {
  return RuntimeStrategyDeskScenarioManifestSchema.parse(input);
}

export function parseRuntimeStrategyDeskScenarioLeg(
  input: unknown,
): RuntimeStrategyDeskScenarioLeg {
  return RuntimeStrategyDeskScenarioLegSchema.parse(input);
}

export function parseRuntimeStrategyDeskScenarioRun(
  input: unknown,
): RuntimeStrategyDeskScenarioRun {
  return RuntimeStrategyDeskScenarioRunSchema.parse(input);
}

export function parseRuntimeStrategyDeskScenarioReport(
  input: unknown,
): RuntimeStrategyDeskScenarioReport {
  return RuntimeStrategyDeskScenarioReportSchema.parse(input);
}

export function parseRuntimeStrategyDeskPromotionHandoff(
  input: unknown,
): RuntimeStrategyDeskPromotionHandoff {
  return RuntimeStrategyDeskPromotionHandoffSchema.parse(input);
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

export function safeParseRuntimeExecutionCostObservationRecord(input: unknown) {
  return RuntimeExecutionCostObservationRecordSchema.safeParse(input);
}

export function safeParseRuntimeResearchExperimentRecord(input: unknown) {
  return RuntimeResearchExperimentRecordSchema.safeParse(input);
}

export function safeParseRuntimeResearchEvidenceBundleRecord(input: unknown) {
  return RuntimeResearchEvidenceBundleRecordSchema.safeParse(input);
}

export function safeParseRuntimeResearchReproducibilityBundleRecord(
  input: unknown,
) {
  return RuntimeResearchReproducibilityBundleRecordSchema.safeParse(input);
}

export function safeParseRuntimeBacktestReport(input: unknown) {
  return RuntimeBacktestReportSchema.safeParse(input);
}

export function safeParseRuntimeVenueCapability(input: unknown) {
  return RuntimeVenueCapabilitySchema.safeParse(input);
}

export function safeParseRuntimeMarginAccountSnapshot(input: unknown) {
  return RuntimeMarginAccountSnapshotSchema.safeParse(input);
}

export function safeParseRuntimeAssetRecord(input: unknown) {
  return RuntimeAssetRecordSchema.safeParse(input);
}

export function safeParseRuntimeStrategySpec(input: unknown) {
  return RuntimeStrategySpecSchema.safeParse(input);
}

export function safeParseRuntimeStrategyLabPromotionRecord(input: unknown) {
  return RuntimeStrategyLabPromotionRecordSchema.safeParse(input);
}

export function safeParseRuntimeStrategyLabPromotionEvent(input: unknown) {
  return RuntimeStrategyLabPromotionEventSchema.safeParse(input);
}

export function safeParseRuntimeStrategyLabSubjectControl(input: unknown) {
  return RuntimeStrategyLabSubjectControlSchema.safeParse(input);
}

export function safeParseRuntimeStrategyLabReadinessArtifact(input: unknown) {
  return RuntimeStrategyLabReadinessArtifactSchema.safeParse(input);
}

export function safeParseRuntimeStrategyLabReadinessCanaryRun(input: unknown) {
  return RuntimeStrategyLabReadinessCanaryRunSchema.safeParse(input);
}

export function safeParseRuntimeStrategyLabPostLiveArtifact(input: unknown) {
  return RuntimeStrategyLabPostLiveArtifactSchema.safeParse(input);
}

export function safeParseRuntimeStrategyDeskScenarioManifest(input: unknown) {
  return RuntimeStrategyDeskScenarioManifestSchema.safeParse(input);
}

export function safeParseRuntimeStrategyDeskScenarioLeg(input: unknown) {
  return RuntimeStrategyDeskScenarioLegSchema.safeParse(input);
}

export function safeParseRuntimeStrategyDeskScenarioRun(input: unknown) {
  return RuntimeStrategyDeskScenarioRunSchema.safeParse(input);
}

export function safeParseRuntimeStrategyDeskScenarioReport(input: unknown) {
  return RuntimeStrategyDeskScenarioReportSchema.safeParse(input);
}

export function safeParseRuntimeStrategyDeskPromotionHandoff(input: unknown) {
  return RuntimeStrategyDeskPromotionHandoffSchema.safeParse(input);
}
