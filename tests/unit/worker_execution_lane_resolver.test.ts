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
