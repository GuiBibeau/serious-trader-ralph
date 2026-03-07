import { z } from "zod";

export const RUNTIME_PROTOCOL_SCHEMA_FAMILY = "runtime" as const;
export const RUNTIME_PROTOCOL_SCHEMA_VERSION = "v1" as const;

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
