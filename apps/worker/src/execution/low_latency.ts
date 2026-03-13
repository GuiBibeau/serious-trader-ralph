import {
  readLoopAHealthFromKv,
  readLoopALatencyFromKv,
} from "../loop_a/health";
import type { Env } from "../types";

export type LowLatencyStreamStatus =
  | "disabled"
  | "healthy"
  | "degraded"
  | "error"
  | "unavailable";

export type LowLatencyFailureReasonBucket = {
  key: string;
  count: number;
};

export type LowLatencyExecutionMeta = {
  lane: "fast" | "protected";
  landingPath: "helius_sender" | "jito_bundle";
  policy: {
    retryMode: "bounded";
    maxRetries: number;
    retryBaseMs: number;
    computeBudgetMode: "prebuilt_tx_managed";
    priorityFeeMode:
      | "sender_managed"
      | "bundle_tip"
      | "bundle_tip_pending_tip_account";
    antiFrontRunning:
      | "not_applicable"
      | "bundle_private_orderflow"
      | "disabled";
    revertProtection:
      | "not_applicable"
      | "bundle_status_gated_retry"
      | "disabled";
  };
  stream?: {
    source: "loop_a";
    status: LowLatencyStreamStatus;
    observedAt: string | null;
    tickGeneratedAt: string | null;
    tickDurationMs: number | null;
    processedLagSlots: number | null;
    confirmedLagSlots: number | null;
    finalizedLagSlots: number | null;
    lastSuccessfulAt: string | null;
    errorCount: number | null;
    warnings: string[];
  };
  outcome?: {
    attemptsUsed: number;
    errorCode: string | null;
    bundleStatus: string | null;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBooleanFlag(value: unknown, fallback = false): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  return fallback;
}

export async function resolveFastLaneStreamTelemetry(
  env: Env,
): Promise<NonNullable<LowLatencyExecutionMeta["stream"]>> {
  const slotSourceEnabled = readBooleanFlag(env.LOOP_A_SLOT_SOURCE_ENABLED);
  if (!slotSourceEnabled) {
    return {
      source: "loop_a",
      status: "disabled",
      observedAt: null,
      tickGeneratedAt: null,
      tickDurationMs: null,
      processedLagSlots: null,
      confirmedLagSlots: null,
      finalizedLagSlots: null,
      lastSuccessfulAt: null,
      errorCount: null,
      warnings: [],
    };
  }

  const [health, latency] = await Promise.all([
    readLoopAHealthFromKv(env),
    readLoopALatencyFromKv(env),
  ]);
  if (!health && !latency) {
    return {
      source: "loop_a",
      status: "unavailable",
      observedAt: null,
      tickGeneratedAt: null,
      tickDurationMs: null,
      processedLagSlots: null,
      confirmedLagSlots: null,
      finalizedLagSlots: null,
      lastSuccessfulAt: null,
      errorCount: null,
      warnings: [],
    };
  }

  const status: LowLatencyStreamStatus =
    health?.status === "error"
      ? "error"
      : health?.status === "degraded" || latency?.ok === false
        ? "degraded"
        : "healthy";

  return {
    source: "loop_a",
    status,
    observedAt: health?.generatedAt ?? null,
    tickGeneratedAt: latency?.generatedAt ?? null,
    tickDurationMs: latency?.tickDurationMs ?? null,
    processedLagSlots: health?.lagSlots.processedLag ?? null,
    confirmedLagSlots: health?.lagSlots.confirmedLag ?? null,
    finalizedLagSlots: health?.lagSlots.finalizedLag ?? null,
    lastSuccessfulAt: health?.lastSuccessfulAt ?? null,
    errorCount: health?.errorCount ?? null,
    warnings: Array.isArray(health?.warnings)
      ? health.warnings.filter((warning) => typeof warning === "string")
      : [],
  };
}

export async function buildFastLaneExecutionMeta(input: {
  env: Env;
  maxRetries: number;
  retryBaseMs: number;
  attemptsUsed: number;
  errorCode?: string | null;
}): Promise<LowLatencyExecutionMeta> {
  return {
    lane: "fast",
    landingPath: "helius_sender",
    policy: {
      retryMode: "bounded",
      maxRetries: input.maxRetries,
      retryBaseMs: input.retryBaseMs,
      computeBudgetMode: "prebuilt_tx_managed",
      priorityFeeMode: "sender_managed",
      antiFrontRunning: "not_applicable",
      revertProtection: "not_applicable",
    },
    stream: await resolveFastLaneStreamTelemetry(input.env),
    outcome: {
      attemptsUsed: input.attemptsUsed,
      errorCode: input.errorCode ?? null,
      bundleStatus: null,
    },
  };
}

export function buildProtectedLaneExecutionMeta(input: {
  maxRetries: number;
  retryBaseMs: number;
  attemptsUsed: number;
  tipAccount?: string | null;
  bundleStatus?: string | null;
  errorCode?: string | null;
}): LowLatencyExecutionMeta {
  return {
    lane: "protected",
    landingPath: "jito_bundle",
    policy: {
      retryMode: "bounded",
      maxRetries: input.maxRetries,
      retryBaseMs: input.retryBaseMs,
      computeBudgetMode: "prebuilt_tx_managed",
      priorityFeeMode: input.tipAccount
        ? "bundle_tip"
        : "bundle_tip_pending_tip_account",
      antiFrontRunning: "bundle_private_orderflow",
      revertProtection: "bundle_status_gated_retry",
    },
    outcome: {
      attemptsUsed: input.attemptsUsed,
      errorCode: input.errorCode ?? null,
      bundleStatus: input.bundleStatus ?? null,
    },
  };
}

export function parseLowLatencyExecutionMeta(
  value: unknown,
): LowLatencyExecutionMeta | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const lane = String(record.lane ?? "").trim();
  const landingPath = String(record.landingPath ?? "").trim();
  if (
    (lane !== "fast" && lane !== "protected") ||
    (landingPath !== "helius_sender" && landingPath !== "jito_bundle")
  ) {
    return null;
  }

  const policyRecord = isRecord(record.policy) ? record.policy : null;
  const outcomeRecord = isRecord(record.outcome) ? record.outcome : null;
  const streamRecord = isRecord(record.stream) ? record.stream : null;

  return {
    lane,
    landingPath,
    policy: {
      retryMode: "bounded",
      maxRetries: numberOrNull(policyRecord?.maxRetries) ?? 0,
      retryBaseMs: numberOrNull(policyRecord?.retryBaseMs) ?? 0,
      computeBudgetMode: "prebuilt_tx_managed",
      priorityFeeMode:
        policyRecord?.priorityFeeMode === "bundle_tip" ||
        policyRecord?.priorityFeeMode === "bundle_tip_pending_tip_account"
          ? policyRecord.priorityFeeMode
          : "sender_managed",
      antiFrontRunning:
        policyRecord?.antiFrontRunning === "bundle_private_orderflow" ||
        policyRecord?.antiFrontRunning === "disabled"
          ? policyRecord.antiFrontRunning
          : "not_applicable",
      revertProtection:
        policyRecord?.revertProtection === "bundle_status_gated_retry" ||
        policyRecord?.revertProtection === "disabled"
          ? policyRecord.revertProtection
          : "not_applicable",
    },
    ...(streamRecord
      ? {
          stream: {
            source: "loop_a",
            status:
              streamRecord.status === "healthy" ||
              streamRecord.status === "degraded" ||
              streamRecord.status === "error" ||
              streamRecord.status === "disabled"
                ? streamRecord.status
                : "unavailable",
            observedAt: stringOrNull(streamRecord.observedAt),
            tickGeneratedAt: stringOrNull(streamRecord.tickGeneratedAt),
            tickDurationMs: numberOrNull(streamRecord.tickDurationMs),
            processedLagSlots: numberOrNull(streamRecord.processedLagSlots),
            confirmedLagSlots: numberOrNull(streamRecord.confirmedLagSlots),
            finalizedLagSlots: numberOrNull(streamRecord.finalizedLagSlots),
            lastSuccessfulAt: stringOrNull(streamRecord.lastSuccessfulAt),
            errorCount: numberOrNull(streamRecord.errorCount),
            warnings: Array.isArray(streamRecord.warnings)
              ? streamRecord.warnings
                  .filter(
                    (warning): warning is string => typeof warning === "string",
                  )
                  .slice(0, 20)
              : [],
          },
        }
      : {}),
    ...(outcomeRecord
      ? {
          outcome: {
            attemptsUsed: numberOrNull(outcomeRecord.attemptsUsed) ?? 0,
            errorCode: stringOrNull(outcomeRecord.errorCode),
            bundleStatus: stringOrNull(outcomeRecord.bundleStatus),
          },
        }
      : {}),
  };
}
