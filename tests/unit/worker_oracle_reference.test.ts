import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SOL_MINT, USDC_MINT } from "../../apps/worker/src/defaults";
import {
  evaluateOracleReferencePriceGuard,
  resolveOracleReferencePriceSnapshot,
} from "../../apps/worker/src/oracle_reference";
import type { Env } from "../../apps/worker/src/types";
import { createWorkerLiveEnv } from "../integration/_worker_live_test_utils";

function createSqliteD1Adapter(db: Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const statement = db.query(sql);
              const result = statement.run(...(params as never[])) as {
                changes?: number;
              };
              return {
                meta: {
                  changes:
                    typeof result.changes === "number" ? result.changes : 0,
                },
              };
            },
            async first() {
              const statement = db.query(sql);
              return (statement.get(...(params as never[])) as unknown) ?? null;
            },
            async all() {
              const statement = db.query(sql);
              return {
                results: (statement.all(...(params as never[])) ??
                  []) as unknown[],
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function createOracleEnv(overrides?: Partial<Env>): {
  env: Env;
  sqlite: Database;
} {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const migrationPath = resolve(
    import.meta.dir,
    "..",
    "..",
    "apps/worker/migrations/0012_market_features.sql",
  );
  sqlite.exec(readFileSync(migrationPath, "utf8"));
  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      ORACLE_REFERENCE_ENABLED_MODES: "paper,live",
      ORACLE_REFERENCE_MIN_HEALTHY_SOURCES: "2",
      ORACLE_REFERENCE_SWITCHBOARD_FEEDS_JSON: JSON.stringify({
        SOL: "switchboard-sol-feed",
      }),
      ...(overrides ?? {}),
    },
  });
  return { env, sqlite };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function installHealthyOracleFetch(nowSeconds: number) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/v2/price_feeds")) {
      return jsonResponse([
        {
          id: "pyth-sol-feed",
          attributes: {
            display_symbol: "SOL/USD",
          },
        },
      ]);
    }
    if (url.includes("/v2/updates/price/latest")) {
      return jsonResponse({
        parsed: [
          {
            id: "pyth-sol-feed",
            price: {
              price: 15025,
              conf: 35,
              expo: -2,
              publish_time: nowSeconds,
            },
          },
        ],
      });
    }
    if (url.includes("/solana/mainnet/feed/switchboard-sol-feed")) {
      return jsonResponse({
        price: 149.9,
        stddev: 0.12,
        timestamp: nowSeconds,
      });
    }
    if (url.includes("/price/v3")) {
      return jsonResponse({
        data: {
          [SOL_MINT]: {
            id: SOL_MINT,
            usdPrice: 150.1,
            time: nowSeconds,
          },
          [USDC_MINT]: {
            id: USDC_MINT,
            usdPrice: 1,
            time: nowSeconds,
          },
        },
      });
    }
    throw new Error(`unexpected-fetch:${url}`);
  };
}

describe("worker oracle reference pricing", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("builds a healthy canonical reference snapshot and caches it", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    globalThis.fetch = installHealthyOracleFetch(nowSeconds);
    const { env, sqlite } = createOracleEnv();
    try {
      const snapshot = await resolveOracleReferencePriceSnapshot({
        env,
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
      });

      expect(snapshot.instrumentKey).toBe("SOL/USDC");
      expect(snapshot.status).toBe("healthy");
      expect(snapshot.price).toBeTruthy();
      expect(snapshot.sourceCoverageBps).toBe(10000);
      expect(snapshot.sources).toHaveLength(3);
      expect(
        snapshot.sources.every((source) => source.status === "healthy"),
      ).toBe(true);

      const countRow = sqlite
        .query(
          "SELECT COUNT(*) as count FROM market_features WHERE instrument = ?1 AND feature = ?2",
        )
        .get("SOL/USDC", "reference_price_snapshot_v1") as
        | { count?: number }
        | undefined;
      expect(countRow?.count).toBe(4);
    } finally {
      sqlite.close();
    }
  });

  test("rejects live execution when quoted price diverges from canonical reference", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    globalThis.fetch = installHealthyOracleFetch(nowSeconds);
    const { env, sqlite } = createOracleEnv();
    try {
      const result = await evaluateOracleReferencePriceGuard({
        env,
        mode: "live",
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inputAmountAtomic: "1000000000",
        expectedOutputAmountAtomic: "100000000",
      });

      expect(result.enabled).toBe(true);
      expect(result.verdict).toBe("reject");
      expect(result.reason).toBe("reference-price-execution-divergence");
      expect(result.executionDivergenceBps).toBeGreaterThan(250);
      expect(result.snapshot?.status).toBe("healthy");
    } finally {
      sqlite.close();
    }
  });

  test("pauses paper execution when oracle inputs are stale", async () => {
    const staleSeconds = Math.floor((Date.now() - 10 * 60_000) / 1000);
    globalThis.fetch = installHealthyOracleFetch(staleSeconds);
    const { env, sqlite } = createOracleEnv({
      ORACLE_REFERENCE_FRESHNESS_SLO_MS: "30000",
    });
    try {
      const result = await evaluateOracleReferencePriceGuard({
        env,
        mode: "paper",
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        inputAmountAtomic: "1000000000",
        expectedOutputAmountAtomic: "150000000",
      });

      expect(result.enabled).toBe(true);
      expect(result.verdict).toBe("pause");
      expect(result.reason).toBe("reference-price-stale");
      expect(result.snapshot?.status).toBe("stale");
    } finally {
      sqlite.close();
    }
  });
});
