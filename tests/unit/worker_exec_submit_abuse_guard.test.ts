import { describe, expect, test } from "bun:test";
import {
  enforceExecSubmitAbuseGuard,
  readExecSubmitPayloadWithLimits,
} from "../../apps/worker/src/execution/abuse_guard";
import type { Env } from "../../apps/worker/src/types";
import { createWorkerLiveEnv } from "../integration/_worker_live_test_utils";

function createEnv(overrides?: Partial<Env>): Env {
  return createWorkerLiveEnv({
    overrides: {
      PRIVY_APP_ID: "privy-app-id",
      ...(overrides ?? {}),
    },
  });
}

describe("exec submit abuse guard", () => {
  test("rejects oversized payloads before parsing", async () => {
    const env = createEnv({
      EXEC_SUBMIT_MAX_PAYLOAD_BYTES: "1024",
    });
    const request = new Request("http://localhost/api/x402/exec/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        huge: "x".repeat(3_000),
      }),
    });
    const result = await readExecSubmitPayloadWithLimits(request, env);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("payload-too-large");
  });

  test("rejects payloads that exceed shape limits", async () => {
    const env = createEnv({
      EXEC_SUBMIT_MAX_PAYLOAD_DEPTH: "3",
    });
    const request = new Request("http://localhost/api/x402/exec/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        a: {
          b: {
            c: {
              d: 1,
            },
          },
        },
      }),
    });
    const result = await readExecSubmitPayloadWithLimits(request, env);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("payload-shape-limit-exceeded");
  });

  test("enforces actor blocklist and ip rate limits deterministically", async () => {
    const env = createEnv({
      EXEC_SUBMIT_BLOCKLIST_ACTORS: "privy_user:user_1",
    });
    const blocked = await enforceExecSubmitAbuseGuard({
      env,
      request: new Request("http://localhost/api/x402/exec/submit", {
        method: "POST",
        headers: {
          "cf-connecting-ip": "10.0.0.8",
        },
      }),
      actorType: "privy_user",
      actorId: "user_1",
      idempotencyKey: "idem-1",
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.reason).toBe("submit-actor-blocklisted");

    const rateEnv = createEnv({
      EXEC_SUBMIT_RATE_LIMIT_IP_MAX: "1",
      EXEC_SUBMIT_RATE_LIMIT_ACTOR_MAX: "10",
      EXEC_SUBMIT_RATE_LIMIT_WINDOW_SECONDS: "60",
      EXEC_SUBMIT_DUPLICATE_BURST_MAX: "10",
    });
    const first = await enforceExecSubmitAbuseGuard({
      env: rateEnv,
      request: new Request("http://localhost/api/x402/exec/submit", {
        method: "POST",
        headers: {
          "cf-connecting-ip": "10.0.0.9",
        },
      }),
      actorType: "privy_user",
      actorId: "user_9",
      idempotencyKey: "idem-a",
    });
    expect(first.ok).toBe(true);
    const second = await enforceExecSubmitAbuseGuard({
      env: rateEnv,
      request: new Request("http://localhost/api/x402/exec/submit", {
        method: "POST",
        headers: {
          "cf-connecting-ip": "10.0.0.9",
        },
      }),
      actorType: "privy_user",
      actorId: "user_9",
      idempotencyKey: "idem-b",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(429);
    expect(second.reason).toBe("submit-ip-rate-limit-exceeded");
  });
});
