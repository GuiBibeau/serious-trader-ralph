import { describe, expect, test } from "bun:test";
import {
  createDataSourceRegistry,
  registerDataSourceAdapter,
} from "../../apps/worker/src/data_sources/registry";
import { resolveSourcePriority } from "../../apps/worker/src/data_sources/types";

function createMockEnv() {
  const calls: string[] = [];
  const db = {
    prepare(sql: string) {
      calls.push(sql);
      return {
        bind(..._args: unknown[]) {
          return {
            run: async () => ({ meta: { last_row_id: 1 } }),
            all: async () => ({ results: [] }),
            first: async () => null,
          };
        },
      };
    },
  };

  return {
    env: {
      WAITLIST_DB: db,
    } as never,
    calls,
  };
}

describe("worker data adapter registry", () => {
  test("uses default source priority when none provided", () => {
    expect(resolveSourcePriority(undefined)).toEqual(["birdeye", "fixture"]);
  });

  test("honors explicit source priority", () => {
    expect(
      resolveSourcePriority({
        priority: ["fixture", "birdeye"],
      }),
    ).toEqual(["fixture", "birdeye"]);
  });

  test("supports custom adapters for future venues", async () => {
    registerDataSourceAdapter("prediction_feed", () => ({
      name: "prediction_feed",
      async fetchHourlyBars(request) {
        return [
          {
            ts: new Date(request.startMs).toISOString(),
            source: "prediction_feed",
            instrument: `${request.baseMint}/${request.quoteMint}`,
            open: 1,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 100,
          },
        ];
      },
    }));

    const { env, calls } = createMockEnv();
    const registry = createDataSourceRegistry(env, {
      priority: ["prediction_feed"],
      cacheTtlMinutes: 0,
    });

    const bars = await registry.fetchHourlyBars({
      baseMint: "BASE",
      quoteMint: "QUOTE",
      startMs: Date.now() - 2 * 60 * 60 * 1000,
      endMs: Date.now(),
      resolutionMinutes: 60,
    });

    expect(bars).toHaveLength(1);
    expect(bars[0]?.source).toBe("prediction_feed");
    expect(calls.length).toBeGreaterThan(0);
  });
});
