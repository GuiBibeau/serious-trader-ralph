import { describe, expect, test } from "bun:test";
import { resolveExecutionLane } from "../../apps/worker/src/execution/lane_resolver";
import type { Env } from "../../apps/worker/src/types";

describe("execution lane resolver", () => {
  test("maps fast/protected/safe lanes to default adapters", () => {
    const fast = resolveExecutionLane({
      env: {} as Env,
      requestedLane: "fast",
      mode: "relay_signed",
      actorType: "anonymous_x402",
    });
    expect(fast.ok).toBe(true);
    if (!fast.ok) return;
    expect(fast.adapter).toBe("helius_sender");
    expect(fast.metadata.adapter).toBe("helius_sender");

    const protectedLane = resolveExecutionLane({
      env: {} as Env,
      requestedLane: "protected",
      mode: "relay_signed",
      actorType: "anonymous_x402",
    });
    expect(protectedLane.ok).toBe(true);
    if (!protectedLane.ok) return;
    expect(protectedLane.adapter).toBe("jito_bundle");
    expect(protectedLane.metadata.adapter).toBe("jito_bundle");

    const safe = resolveExecutionLane({
      env: {} as Env,
      requestedLane: "safe",
      mode: "privy_execute",
      actorType: "privy_user",
    });
    expect(safe.ok).toBe(true);
    if (!safe.ok) return;
    expect(safe.adapter).toBe("jupiter");
    expect(safe.metadata.adapter).toBe("jupiter");
  });

  test("uses env adapter overrides with normalization", () => {
    const resolved = resolveExecutionLane({
      env: {
        EXEC_LANE_PROTECTED_ADAPTER: "  JITO_PROTECTED  ",
      } as Env,
      requestedLane: "protected",
      mode: "relay_signed",
      actorType: "anonymous_x402",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.adapter).toBe("jito_protected");
    expect(resolved.metadata.adapter).toBe("jito_protected");
  });

  test("supports operator lane-disable toggles", () => {
    const disabledFast = resolveExecutionLane({
      env: {
        EXEC_LANE_FAST_ENABLED: "0",
      } as Env,
      requestedLane: "fast",
      mode: "relay_signed",
      actorType: "anonymous_x402",
    });
    expect(disabledFast.ok).toBe(false);
    if (disabledFast.ok) return;
    expect(disabledFast.error).toBe("unsupported-lane");
    expect(disabledFast.reason).toBe("lane-disabled-by-operator");

    const disabledProtected = resolveExecutionLane({
      env: {
        EXEC_LANE_PROTECTED_ENABLED: "false",
      } as Env,
      requestedLane: "protected",
      mode: "relay_signed",
      actorType: "anonymous_x402",
    });
    expect(disabledProtected.ok).toBe(false);
    if (disabledProtected.ok) return;
    expect(disabledProtected.error).toBe("unsupported-lane");
    expect(disabledProtected.reason).toBe("lane-disabled-by-operator");
  });

  test("supports runtime ops-control overrides without redeploy", () => {
    const resolved = resolveExecutionLane({
      env: {} as Env,
      requestedLane: "safe",
      mode: "privy_execute",
      actorType: "privy_user",
      runtimeControls: {
        executionEnabled: true,
        executionDisabledReason: null,
        laneEnabledOverrides: {
          fast: true,
          protected: true,
          safe: false,
        },
        mappedBy: "ops-control",
      },
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toBe("lane-disabled-by-operator");

    const globallyDisabled = resolveExecutionLane({
      env: {} as Env,
      requestedLane: "fast",
      mode: "relay_signed",
      actorType: "anonymous_x402",
      runtimeControls: {
        executionEnabled: false,
        executionDisabledReason: "execution-disabled-by-operator",
        laneEnabledOverrides: {
          fast: true,
          protected: true,
          safe: true,
        },
        mappedBy: "ops-control",
      },
    });
    expect(globallyDisabled.ok).toBe(false);
    if (globallyDisabled.ok) return;
    expect(globallyDisabled.reason).toBe("execution-disabled-by-operator");
  });

  test("rejects safe lane for relay_signed mode", () => {
    const resolved = resolveExecutionLane({
      env: {} as Env,
      requestedLane: "safe",
      mode: "relay_signed",
      actorType: "anonymous_x402",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error).toBe("unsupported-lane");
    expect(resolved.reason).toBe("lane-not-available-for-relay-signed");
  });

  test("rejects safe lane for anonymous actors unless explicitly enabled", () => {
    const rejected = resolveExecutionLane({
      env: {} as Env,
      requestedLane: "safe",
      mode: "privy_execute",
      actorType: "anonymous_x402",
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error).toBe("unsupported-lane");
    expect(rejected.reason).toBe("lane-not-available-for-anonymous-actor");

    const allowed = resolveExecutionLane({
      env: {
        EXEC_LANE_SAFE_ALLOW_ANONYMOUS: "true",
      } as Env,
      requestedLane: "safe",
      mode: "privy_execute",
      actorType: "anonymous_x402",
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.adapter).toBe("jupiter");
  });
});
