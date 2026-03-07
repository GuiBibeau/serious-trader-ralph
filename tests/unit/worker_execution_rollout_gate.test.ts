import { describe, expect, test } from "bun:test";
import {
  evaluateExecutionRolloutGate,
  resolveExecutionRolloutFlags,
} from "../../apps/worker/src/execution/rollout_gate";
import type { Env } from "../../apps/worker/src/types";

describe("execution rollout gate", () => {
  test("enables all actor segments by default", () => {
    const flags = resolveExecutionRolloutFlags({} as Env);
    expect(flags).toEqual({
      internal: true,
      trusted: true,
      external: true,
    });
  });

  test("maps actor types to rollout segments", () => {
    const external = evaluateExecutionRolloutGate({
      env: {} as Env,
      actorType: "anonymous_x402",
      mode: "relay_signed",
    });
    expect(external.ok).toBe(true);
    if (external.ok) {
      expect(external.segment).toBe("external");
    }

    const trusted = evaluateExecutionRolloutGate({
      env: {} as Env,
      actorType: "privy_user",
      mode: "privy_execute",
    });
    expect(trusted.ok).toBe(true);
    if (trusted.ok) {
      expect(trusted.segment).toBe("trusted");
    }

    const internal = evaluateExecutionRolloutGate({
      env: {} as Env,
      actorType: "api_key_actor",
      mode: "relay_signed",
    });
    expect(internal.ok).toBe(true);
    if (internal.ok) {
      expect(internal.segment).toBe("internal");
    }
  });

  test("denies disabled rollout segments with deterministic reason", () => {
    const deniedExternal = evaluateExecutionRolloutGate({
      env: {
        EXEC_ROLLOUT_EXTERNAL_ENABLED: "0",
      } as Env,
      actorType: "anonymous_x402",
      mode: "relay_signed",
    });
    expect(deniedExternal.ok).toBe(false);
    if (deniedExternal.ok) return;
    expect(deniedExternal.error).toBe("policy-denied");
    expect(deniedExternal.reason).toBe("rollout-segment-disabled:external");

    const deniedTrusted = evaluateExecutionRolloutGate({
      env: {
        EXEC_ROLLOUT_TRUSTED_ENABLED: "false",
      } as Env,
      actorType: "privy_user",
      mode: "privy_execute",
    });
    expect(deniedTrusted.ok).toBe(false);
    if (deniedTrusted.ok) return;
    expect(deniedTrusted.error).toBe("policy-denied");
    expect(deniedTrusted.reason).toBe("rollout-segment-disabled:trusted");
  });
});
