import type { Env } from "../types";
import type {
  ExecutionActorType,
  ExecutionMode,
  JsonObject,
} from "./repository";

export type ExecutionRolloutSegment = "internal" | "trusted" | "external";

function readBooleanFlag(value: unknown, fallback = true): boolean {
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

function resolveActorSegment(
  actorType: ExecutionActorType,
): ExecutionRolloutSegment {
  if (actorType === "api_key_actor") return "internal";
  if (actorType === "privy_user") return "trusted";
  return "external";
}

export function resolveExecutionRolloutFlags(
  env: Env,
): Record<ExecutionRolloutSegment, boolean> {
  return {
    internal: readBooleanFlag(env.EXEC_ROLLOUT_INTERNAL_ENABLED, true),
    trusted: readBooleanFlag(env.EXEC_ROLLOUT_TRUSTED_ENABLED, true),
    external: readBooleanFlag(env.EXEC_ROLLOUT_EXTERNAL_ENABLED, true),
  };
}

type ExecutionRolloutGateResult =
  | {
      ok: true;
      segment: ExecutionRolloutSegment;
      metadata: JsonObject;
    }
  | {
      ok: false;
      error: "policy-denied";
      reason: string;
      metadata: JsonObject;
    };

export function evaluateExecutionRolloutGate(input: {
  env: Env;
  actorType: ExecutionActorType;
  mode: ExecutionMode;
}): ExecutionRolloutGateResult {
  const segment = resolveActorSegment(input.actorType);
  const flags = resolveExecutionRolloutFlags(input.env);
  const enabled = flags[segment];
  const metadata: JsonObject = {
    segment,
    actorType: input.actorType,
    mode: input.mode,
    enabled,
    flags,
  };
  if (!enabled) {
    return {
      ok: false,
      error: "policy-denied",
      reason: `rollout-segment-disabled:${segment}`,
      metadata,
    };
  }
  return {
    ok: true,
    segment,
    metadata,
  };
}
