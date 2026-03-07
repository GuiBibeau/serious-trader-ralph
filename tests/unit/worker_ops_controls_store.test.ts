import { describe, expect, test } from "bun:test";
import { readOpsControlSnapshot } from "../../apps/worker/src/ops_controls";
import type { Env } from "../../apps/worker/src/types";

describe("worker ops controls store", () => {
  test("falls back to default snapshot when KV reads fail", async () => {
    const snapshot = await readOpsControlSnapshot({
      CONFIG_KV: {
        async get() {
          throw new Error("kv-temporary-outage");
        },
      },
    } as unknown as Env);

    expect(snapshot).toMatchObject({
      execution: {
        enabled: true,
        lanes: {
          fast: true,
          protected: true,
          safe: true,
        },
      },
      canary: {
        enabled: true,
      },
      metadata: {
        source: "default",
      },
    });
  });
});
