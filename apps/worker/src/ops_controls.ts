import type { ExecutionLane } from "./execution/repository";
import type { Env } from "./types";

const OPS_CONTROL_KV_KEY = "ops:controls:v1";
const EXECUTION_LANES: ExecutionLane[] = ["fast", "protected", "safe"];

type OpsControlJson = Record<string, unknown>;

export type OpsControlSnapshot = {
  schemaVersion: "v1";
  execution: {
    enabled: boolean;
    disabledReason: string | null;
    lanes: Record<ExecutionLane, boolean>;
  };
  canary: {
    enabled: boolean;
    disabledReason: string | null;
  };
  metadata: {
    source: "default" | "kv";
    updatedAt: string | null;
    updatedBy: string | null;
  };
};

export type OpsControlPatch = {
  execution?: {
    enabled?: boolean;
    disabledReason?: string | null;
    lanes?: Partial<Record<ExecutionLane, boolean>>;
  };
  canary?: {
    enabled?: boolean;
    disabledReason?: string | null;
  };
  updatedAt?: string;
  updatedBy?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
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

function readStringOrNull(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function defaultOpsControlSnapshot(): OpsControlSnapshot {
  return {
    schemaVersion: "v1",
    execution: {
      enabled: true,
      disabledReason: null,
      lanes: {
        fast: true,
        protected: true,
        safe: true,
      },
    },
    canary: {
      enabled: true,
      disabledReason: null,
    },
    metadata: {
      source: "default",
      updatedAt: null,
      updatedBy: null,
    },
  };
}

function mergeLaneFlags(
  current: Record<ExecutionLane, boolean>,
  input: unknown,
): Record<ExecutionLane, boolean> {
  if (!isRecord(input)) return current;
  return {
    fast: readBoolean(input.fast, current.fast),
    protected: readBoolean(input.protected, current.protected),
    safe: readBoolean(input.safe, current.safe),
  };
}

function normalizeOpsControlSnapshot(
  value: unknown,
  source: "default" | "kv",
): OpsControlSnapshot {
  const fallback = defaultOpsControlSnapshot();
  if (!isRecord(value)) {
    return {
      ...fallback,
      metadata: {
        ...fallback.metadata,
        source,
      },
    };
  }
  const execution = isRecord(value.execution) ? value.execution : {};
  const canary = isRecord(value.canary) ? value.canary : {};
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  return {
    schemaVersion: "v1",
    execution: {
      enabled: readBoolean(execution.enabled, fallback.execution.enabled),
      disabledReason:
        readStringOrNull(execution.disabledReason) ??
        fallback.execution.disabledReason,
      lanes: mergeLaneFlags(fallback.execution.lanes, execution.lanes),
    },
    canary: {
      enabled: readBoolean(canary.enabled, fallback.canary.enabled),
      disabledReason:
        readStringOrNull(canary.disabledReason) ??
        fallback.canary.disabledReason,
    },
    metadata: {
      source,
      updatedAt: readStringOrNull(metadata.updatedAt),
      updatedBy: readStringOrNull(metadata.updatedBy),
    },
  };
}

async function readOpsControlRaw(env: Env): Promise<OpsControlJson | null> {
  if (!env.CONFIG_KV || typeof env.CONFIG_KV.get !== "function") {
    return null;
  }
  const raw = await env.CONFIG_KV.get(OPS_CONTROL_KV_KEY, "json");
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(raw) ? raw : null;
}

export async function readOpsControlSnapshot(
  env: Env,
): Promise<OpsControlSnapshot> {
  const raw = await readOpsControlRaw(env);
  return normalizeOpsControlSnapshot(raw, raw ? "kv" : "default");
}

export async function writeOpsControlSnapshot(
  env: Env,
  patch: OpsControlPatch,
): Promise<OpsControlSnapshot> {
  if (!env.CONFIG_KV || typeof env.CONFIG_KV.put !== "function") {
    throw new Error("ops-control-kv-missing");
  }
  const current = await readOpsControlSnapshot(env);
  const nextExecutionEnabled =
    patch.execution?.enabled ?? current.execution.enabled;
  const nextCanaryEnabled = patch.canary?.enabled ?? current.canary.enabled;
  const next: OpsControlSnapshot = {
    schemaVersion: "v1",
    execution: {
      enabled: nextExecutionEnabled,
      disabledReason:
        patch.execution?.disabledReason !== undefined
          ? readStringOrNull(patch.execution.disabledReason)
          : nextExecutionEnabled
            ? null
            : current.execution.disabledReason,
      lanes: {
        ...current.execution.lanes,
        ...(patch.execution?.lanes ?? {}),
      },
    },
    canary: {
      enabled: nextCanaryEnabled,
      disabledReason:
        patch.canary?.disabledReason !== undefined
          ? readStringOrNull(patch.canary.disabledReason)
          : nextCanaryEnabled
            ? null
            : current.canary.disabledReason,
    },
    metadata: {
      source: "kv",
      updatedAt: readStringOrNull(patch.updatedAt) ?? new Date().toISOString(),
      updatedBy: readStringOrNull(patch.updatedBy),
    },
  };
  await env.CONFIG_KV.put(OPS_CONTROL_KV_KEY, JSON.stringify(next));
  return next;
}

export async function resetOpsControlSnapshot(
  env: Env,
  updatedBy?: string | null,
): Promise<OpsControlSnapshot> {
  return await writeOpsControlSnapshot(env, {
    execution: {
      enabled: true,
      disabledReason: null,
      lanes: {
        fast: true,
        protected: true,
        safe: true,
      },
    },
    canary: {
      enabled: true,
      disabledReason: null,
    },
    updatedBy: updatedBy ?? null,
  });
}

export type ExecutionLaneRuntimeControls = {
  executionEnabled: boolean;
  executionDisabledReason: string | null;
  laneEnabledOverrides: Record<ExecutionLane, boolean>;
  mappedBy: "env" | "ops-control";
};

export function executionLaneRuntimeControlsFromSnapshot(
  snapshot: OpsControlSnapshot,
): ExecutionLaneRuntimeControls {
  return {
    executionEnabled: snapshot.execution.enabled,
    executionDisabledReason: snapshot.execution.disabledReason,
    laneEnabledOverrides: EXECUTION_LANES.reduce(
      (acc, lane) => {
        acc[lane] = snapshot.execution.lanes[lane];
        return acc;
      },
      {} as Record<ExecutionLane, boolean>,
    ),
    mappedBy: snapshot.metadata.source === "kv" ? "ops-control" : "env",
  };
}
