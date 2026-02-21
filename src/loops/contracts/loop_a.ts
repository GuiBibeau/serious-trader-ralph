import { z } from "zod";

export const LOOP_A_SCHEMA_FAMILY = "loopA" as const;
export const LOOP_A_SCHEMA_VERSION = "v1" as const;

const ISO_DATETIME_SCHEMA = z.string().datetime({ offset: true });
const NON_EMPTY_STRING_SCHEMA = z.string().min(1);
const PUBKEY_SCHEMA = z.string().min(32).max(64);
const DECIMAL_STRING_SCHEMA = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/, "invalid-decimal-string");
const NUMERIC_STRING_SCHEMA = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/, "invalid-numeric-string");

export const ArtifactMetaSchema = z
  .object({
    schemaVersion: z.literal(LOOP_A_SCHEMA_VERSION),
    generatedAt: ISO_DATETIME_SCHEMA,
  })
  .strict();

const ProtocolEventBaseSchema = ArtifactMetaSchema.extend({
  protocol: NON_EMPTY_STRING_SCHEMA,
  slot: z.number().int().nonnegative(),
  sig: NON_EMPTY_STRING_SCHEMA,
  ts: ISO_DATETIME_SCHEMA,
  user: PUBKEY_SCHEMA.optional(),
  venue: NON_EMPTY_STRING_SCHEMA.optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
}).strict();

const SwapProtocolEventSchema = ProtocolEventBaseSchema.extend({
  kind: z.literal("swap"),
  inMint: PUBKEY_SCHEMA,
  outMint: PUBKEY_SCHEMA,
  inAmount: NUMERIC_STRING_SCHEMA,
  outAmount: NUMERIC_STRING_SCHEMA,
}).strict();

const LiquidityAddProtocolEventSchema = ProtocolEventBaseSchema.extend({
  kind: z.literal("liquidity_add"),
  pool: PUBKEY_SCHEMA,
  mint: PUBKEY_SCHEMA,
  amount: NUMERIC_STRING_SCHEMA,
}).strict();

const LiquidityRemoveProtocolEventSchema = ProtocolEventBaseSchema.extend({
  kind: z.literal("liquidity_remove"),
  pool: PUBKEY_SCHEMA,
  mint: PUBKEY_SCHEMA,
  amount: NUMERIC_STRING_SCHEMA,
}).strict();

const BorrowProtocolEventSchema = ProtocolEventBaseSchema.extend({
  kind: z.literal("borrow"),
  market: PUBKEY_SCHEMA,
  mint: PUBKEY_SCHEMA,
  amount: NUMERIC_STRING_SCHEMA,
}).strict();

const RepayProtocolEventSchema = ProtocolEventBaseSchema.extend({
  kind: z.literal("repay"),
  market: PUBKEY_SCHEMA,
  mint: PUBKEY_SCHEMA,
  amount: NUMERIC_STRING_SCHEMA,
}).strict();

const LiquidationProtocolEventSchema = ProtocolEventBaseSchema.extend({
  kind: z.literal("liquidation"),
  market: PUBKEY_SCHEMA,
  mint: PUBKEY_SCHEMA,
  amount: NUMERIC_STRING_SCHEMA,
}).strict();

const MintProtocolEventSchema = ProtocolEventBaseSchema.extend({
  kind: z.literal("mint"),
  mint: PUBKEY_SCHEMA,
  amount: NUMERIC_STRING_SCHEMA,
}).strict();

const BurnProtocolEventSchema = ProtocolEventBaseSchema.extend({
  kind: z.literal("burn"),
  mint: PUBKEY_SCHEMA,
  amount: NUMERIC_STRING_SCHEMA,
}).strict();

const FeeTransferProtocolEventSchema = ProtocolEventBaseSchema.extend({
  kind: z.literal("fee_transfer"),
  mint: PUBKEY_SCHEMA,
  amount: NUMERIC_STRING_SCHEMA,
  to: PUBKEY_SCHEMA.optional(),
}).strict();

const UnknownProtocolEventSchema = ProtocolEventBaseSchema.extend({
  kind: z.literal("unknown"),
  rawKind: NON_EMPTY_STRING_SCHEMA.optional(),
}).strict();

export const ProtocolEventSchema = z.discriminatedUnion("kind", [
  SwapProtocolEventSchema,
  LiquidityAddProtocolEventSchema,
  LiquidityRemoveProtocolEventSchema,
  BorrowProtocolEventSchema,
  RepayProtocolEventSchema,
  LiquidationProtocolEventSchema,
  MintProtocolEventSchema,
  BurnProtocolEventSchema,
  FeeTransferProtocolEventSchema,
  UnknownProtocolEventSchema,
]);

export const MarkSchema = ArtifactMetaSchema.extend({
  slot: z.number().int().nonnegative(),
  ts: ISO_DATETIME_SCHEMA,
  baseMint: PUBKEY_SCHEMA,
  quoteMint: PUBKEY_SCHEMA,
  px: DECIMAL_STRING_SCHEMA,
  bid: DECIMAL_STRING_SCHEMA.optional(),
  ask: DECIMAL_STRING_SCHEMA.optional(),
  confidence: z.number().min(0).max(1),
  venue: NON_EMPTY_STRING_SCHEMA,
  liquidityUsd: DECIMAL_STRING_SCHEMA.optional(),
  evidence: z
    .object({
      sigs: z.array(NON_EMPTY_STRING_SCHEMA).optional(),
      pools: z.array(PUBKEY_SCHEMA).optional(),
      inputs: z.array(NON_EMPTY_STRING_SCHEMA).optional(),
    })
    .strict()
    .optional(),
  version: z.literal(LOOP_A_SCHEMA_VERSION),
}).strict();

export const StateSnapshotSchema = ArtifactMetaSchema.extend({
  slot: z.number().int().nonnegative(),
  commitment: z.enum(["processed", "confirmed", "finalized"]),
  cursor: z
    .object({
      processed: z.number().int().nonnegative(),
      confirmed: z.number().int().nonnegative(),
      finalized: z.number().int().nonnegative(),
    })
    .strict(),
  stateHash: NON_EMPTY_STRING_SCHEMA,
  trackedState: z.record(z.string(), z.unknown()),
  parentSlot: z.number().int().nonnegative().optional(),
  appliedEventCount: z.number().int().nonnegative(),
  inputs: z
    .object({
      eventRefs: z.array(NON_EMPTY_STRING_SCHEMA),
      snapshotRef: NON_EMPTY_STRING_SCHEMA.optional(),
    })
    .strict(),
  version: z.literal(LOOP_A_SCHEMA_VERSION),
}).strict();

export const HealthSchema = ArtifactMetaSchema.extend({
  component: z.literal("loopA"),
  status: z.enum(["ok", "degraded", "error"]),
  updatedAt: ISO_DATETIME_SCHEMA,
  cursors: z
    .object({
      processed: z.number().int().nonnegative(),
      confirmed: z.number().int().nonnegative(),
      finalized: z.number().int().nonnegative(),
    })
    .strict(),
  lagSlots: z
    .object({
      processedLag: z.number().int().nonnegative(),
      confirmedLag: z.number().int().nonnegative(),
      finalizedLag: z.number().int().nonnegative(),
    })
    .strict(),
  lastSuccessfulSlot: z.number().int().nonnegative(),
  lastSuccessfulAt: ISO_DATETIME_SCHEMA,
  errorCount: z.number().int().nonnegative(),
  lastError: z.string().optional(),
  warnings: z.array(z.string()),
  version: z.literal(LOOP_A_SCHEMA_VERSION),
}).strict();

export type ArtifactMeta = z.infer<typeof ArtifactMetaSchema>;
export type ProtocolEvent = z.infer<typeof ProtocolEventSchema>;
export type Mark = z.infer<typeof MarkSchema>;
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;
export type Health = z.infer<typeof HealthSchema>;

export const LOOP_A_SCHEMA_REGISTRY = {
  protocolEvent: {
    schema: ProtocolEventSchema,
    schemaId: "https://ralph.trade/schemas/loopA/v1/protocol_event",
    outputFile: "loop_a.protocol_event.v1.schema.json",
  },
  mark: {
    schema: MarkSchema,
    schemaId: "https://ralph.trade/schemas/loopA/v1/mark",
    outputFile: "loop_a.mark.v1.schema.json",
  },
  stateSnapshot: {
    schema: StateSnapshotSchema,
    schemaId: "https://ralph.trade/schemas/loopA/v1/state_snapshot",
    outputFile: "loop_a.state_snapshot.v1.schema.json",
  },
  health: {
    schema: HealthSchema,
    schemaId: "https://ralph.trade/schemas/loopA/v1/health",
    outputFile: "loop_a.health.v1.schema.json",
  },
} as const;

export function parseProtocolEvent(input: unknown): ProtocolEvent {
  return ProtocolEventSchema.parse(input);
}

export function parseMark(input: unknown): Mark {
  return MarkSchema.parse(input);
}

export function parseStateSnapshot(input: unknown): StateSnapshot {
  return StateSnapshotSchema.parse(input);
}

export function parseHealth(input: unknown): Health {
  return HealthSchema.parse(input);
}

export function safeParseProtocolEvent(input: unknown) {
  return ProtocolEventSchema.safeParse(input);
}

export function safeParseMark(input: unknown) {
  return MarkSchema.safeParse(input);
}

export function safeParseStateSnapshot(input: unknown) {
  return StateSnapshotSchema.safeParse(input);
}

export function safeParseHealth(input: unknown) {
  return HealthSchema.safeParse(input);
}
