import type { ExecutionLaneRuntimeControls } from "../ops_controls";
import type { Env } from "../types";
import type {
  ExecutionActorType,
  ExecutionLane,
  ExecutionMode,
  JsonObject,
} from "./repository";

const DEFAULT_LANE_ADAPTERS: Record<ExecutionLane, string> = {
  fast: "helius_sender",
  protected: "jito_bundle",
  safe: "jupiter",
};

function normalizeAdapter(value: unknown, fallback: string): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized || fallback;
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

function resolveLaneAdapters(env: Env): Record<ExecutionLane, string> {
  return {
    fast: normalizeAdapter(
      env.EXEC_LANE_FAST_ADAPTER,
      DEFAULT_LANE_ADAPTERS.fast,
    ),
    protected: normalizeAdapter(
      env.EXEC_LANE_PROTECTED_ADAPTER,
      DEFAULT_LANE_ADAPTERS.protected,
    ),
    safe: normalizeAdapter(
      env.EXEC_LANE_SAFE_ADAPTER,
      DEFAULT_LANE_ADAPTERS.safe,
    ),
  };
}

function resolveLaneEnabledFlags(env: Env): Record<ExecutionLane, boolean> {
  return {
    fast: readBooleanFlag(env.EXEC_LANE_FAST_ENABLED, true),
    protected: readBooleanFlag(env.EXEC_LANE_PROTECTED_ENABLED, true),
    safe: readBooleanFlag(env.EXEC_LANE_SAFE_ENABLED, true),
  };
}

export type ExecutionLaneRoutingConfig = {
  adapters: Record<ExecutionLane, string>;
  enabled: Record<ExecutionLane, boolean>;
  allowAnonymousSafe: boolean;
  mappedBy: "env" | "ops-control";
  executionEnabled: boolean;
  executionDisabledReason: string | null;
};

export function readExecutionLaneRoutingConfig(
  env: Env,
  runtimeControls?: ExecutionLaneRuntimeControls,
): ExecutionLaneRoutingConfig {
  const envEnabled = resolveLaneEnabledFlags(env);
  const globalExecutionEnabled = runtimeControls?.executionEnabled ?? true;
  const laneEnabledOverrides = runtimeControls?.laneEnabledOverrides ?? {};
  return {
    adapters: resolveLaneAdapters(env),
    enabled: {
      fast:
        globalExecutionEnabled &&
        envEnabled.fast &&
        (laneEnabledOverrides.fast ?? true),
      protected:
        globalExecutionEnabled &&
        envEnabled.protected &&
        (laneEnabledOverrides.protected ?? true),
      safe:
        globalExecutionEnabled &&
        envEnabled.safe &&
        (laneEnabledOverrides.safe ?? true),
    },
    allowAnonymousSafe: readBooleanFlag(
      env.EXEC_LANE_SAFE_ALLOW_ANONYMOUS,
      false,
    ),
    mappedBy: runtimeControls?.mappedBy ?? "env",
    executionEnabled: globalExecutionEnabled,
    executionDisabledReason: runtimeControls?.executionDisabledReason ?? null,
  };
}

type LaneResolveResult =
  | {
      ok: true;
      lane: ExecutionLane;
      adapter: string;
      metadata: JsonObject;
    }
  | {
      ok: false;
      error: "unsupported-lane";
      reason: string;
    };

export function resolveExecutionLane(input: {
  env: Env;
  requestedLane: ExecutionLane;
  mode: ExecutionMode;
  actorType: ExecutionActorType;
  runtimeControls?: ExecutionLaneRuntimeControls;
}): LaneResolveResult {
  const routing = readExecutionLaneRoutingConfig(
    input.env,
    input.runtimeControls,
  );

  if (!routing.enabled[input.requestedLane]) {
    const reason =
      !routing.executionEnabled && routing.executionDisabledReason
        ? routing.executionDisabledReason
        : !routing.executionEnabled
          ? "execution-disabled-by-operator"
          : "lane-disabled-by-operator";
    return {
      ok: false,
      error: "unsupported-lane",
      reason,
    };
  }

  if (input.requestedLane === "safe") {
    if (input.mode === "relay_signed") {
      return {
        ok: false,
        error: "unsupported-lane",
        reason: "lane-not-available-for-relay-signed",
      };
    }
    if (input.actorType === "anonymous_x402" && !routing.allowAnonymousSafe) {
      return {
        ok: false,
        error: "unsupported-lane",
        reason: "lane-not-available-for-anonymous-actor",
      };
    }
  }

  return {
    ok: true,
    lane: input.requestedLane,
    adapter: routing.adapters[input.requestedLane],
    metadata: {
      lane: input.requestedLane,
      adapter: routing.adapters[input.requestedLane],
      requestedByMode: input.mode,
      requestedByActor: input.actorType,
      mappedBy: routing.mappedBy,
      executionEnabled: routing.executionEnabled,
    },
  };
}
