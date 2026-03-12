import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  executeSwapViaRouter,
  registerExecutionAdapter,
} from "../../apps/worker/src/execution/router";
import { normalizePolicy } from "../../apps/worker/src/policy";
import { writeStrategyLabSubjectControl } from "../../apps/worker/src/strategy_lab_readiness_repository";
import { parseRuntimeStrategyLabSubjectControl } from "../../src/runtime/contracts/autonomous_runtime.js";

function createSqliteD1Adapter(db: Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const statement = db.query(sql);
              statement.run(...(params as never[]));
              return { meta: { changes: 1 } };
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

async function createLiveRouterEnv() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const migrationName of [
    "0025_execution_fabric.sql",
    "0026_execution_canary.sql",
    "0027_runtime_canary.sql",
    "0028_strategy_lab_promotions.sql",
    "0029_strategy_lab_readiness.sql",
    "0030_strategy_lab_post_live.sql",
  ]) {
    const migrationPath = resolve(
      import.meta.dir,
      "..",
      "..",
      "apps/worker/migrations",
      migrationName,
    );
    sqlite.exec(readFileSync(migrationPath, "utf8"));
  }

  return {
    sqlite,
    env: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
    } as never,
  };
}

describe("worker execution router", () => {
  test("defaults to jupiter adapter and returns dry_run in dry mode", async () => {
    const result = await executeSwapViaRouter({
      env: {} as never,
      execution: undefined,
      policy: normalizePolicy({ dryRun: true }),
      rpc: {} as never,
      jupiter: {} as never,
      quoteResponse: {
        inputMint: "A",
        outputMint: "B",
        inAmount: "1",
        outAmount: "2",
      },
      userPublicKey: "11111111111111111111111111111111",
      privyWalletId: undefined,
      log: () => {},
    });

    expect(result.status).toBe("dry_run");
    expect(result.signature).toBeNull();
  });

  test("jito bundle adapter is present but not configured", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        execution: { adapter: "jito_bundle" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/jito-block-engine-url-missing/);
  });

  test("helius sender adapter is present but not configured", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        execution: { adapter: "helius_sender" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/helius-sender-url-missing/);
  });

  test("magicblock adapter is present but not configured", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        execution: { adapter: "magicblock_ephemeral_rollup" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/magicblock-ephemeral-rollup-url-missing/);
  });

  test("custom execution adapters can be registered for new venues", async () => {
    registerExecutionAdapter(
      "phoenix_orderbook",
      async (input) => ({
        status: "simulated",
        signature: "sig-phoenix",
        usedQuote: input.quoteResponse,
        refreshed: false,
        lastValidBlockHeight: 42,
      }),
      {
        venueKey: "phoenix",
        supportedModes: ["shadow", "paper"],
      },
    );

    const result = await executeSwapViaRouter({
      env: {} as never,
      venueKey: "phoenix",
      runtimeMode: "paper",
      execution: { adapter: "phoenix_orderbook" },
      policy: normalizePolicy({}),
      rpc: {} as never,
      jupiter: {} as never,
      quoteResponse: {
        inputMint: "A",
        outputMint: "B",
        inAmount: "1",
        outAmount: "2",
      },
      userPublicKey: "11111111111111111111111111111111",
      log: () => {},
    });

    expect(result.status).toBe("simulated");
    expect(result.signature).toBe("sig-phoenix");
  });

  test("fails closed when a venue adapter does not match the runtime venue", async () => {
    registerExecutionAdapter("venue_x", async (input) => ({
      status: "simulated",
      signature: "sig-venue-x",
      usedQuote: input.quoteResponse,
      refreshed: false,
      lastValidBlockHeight: 42,
    }));

    await expect(
      executeSwapViaRouter({
        env: {} as never,
        venueKey: "jupiter",
        runtimeMode: "paper",
        execution: { adapter: "venue_x" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/execution-adapter-venue-mismatch/);
  });

  test("fails closed when adapter is not allowlisted for the runtime venue", async () => {
    registerExecutionAdapter(
      "jupiter_shadow_probe",
      async (input) => ({
        status: "simulated",
        signature: "sig-jupiter-shadow",
        usedQuote: input.quoteResponse,
        refreshed: false,
        lastValidBlockHeight: 42,
      }),
      {
        venueKey: "jupiter",
        supportedModes: ["shadow", "paper"],
      },
    );

    await expect(
      executeSwapViaRouter({
        env: {} as never,
        venueKey: "jupiter",
        runtimeMode: "paper",
        execution: { adapter: "jupiter_shadow_probe" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/runtime-venue-adapter-not-supported/);
  });

  test("fails closed when runtime routing metadata is required but missing", async () => {
    await expect(
      executeSwapViaRouter({
        env: {} as never,
        requireVenueRouting: true,
        execution: { adapter: "jupiter" },
        policy: normalizePolicy({}),
        rpc: {} as never,
        jupiter: {} as never,
        quoteResponse: {
          inputMint: "A",
          outputMint: "B",
          inAmount: "1",
          outAmount: "2",
        },
        userPublicKey: "11111111111111111111111111111111",
        log: () => {},
      }),
    ).rejects.toThrow(/runtime-venue-required/);
  });

  test("fails closed when a live venue is not allowlisted", async () => {
    const { env, sqlite } = await createLiveRouterEnv();
    try {
      await writeStrategyLabSubjectControl(
        env.WAITLIST_DB,
        parseRuntimeStrategyLabSubjectControl({
          schemaVersion: "v1",
          subjectKind: "venue",
          subjectKey: "jupiter",
          liveAllowed: false,
          killSwitchEnabled: false,
          updatedAt: "2026-03-12T00:00:00.000Z",
        }),
      );

      await expect(
        executeSwapViaRouter({
          env,
          venueKey: "jupiter",
          runtimeMode: "live",
          execution: { adapter: "jupiter" },
          policy: normalizePolicy({ dryRun: true }),
          rpc: {} as never,
          jupiter: {} as never,
          quoteResponse: {
            inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            outputMint: "So11111111111111111111111111111111111111112",
            inAmount: "1",
            outAmount: "2",
          },
          userPublicKey: "11111111111111111111111111111111",
          log: () => {},
        }),
      ).rejects.toThrow(/runtime-venue-not-allowlisted/);
    } finally {
      sqlite.close();
    }
  });

  test("fails closed when an asset kill switch is enabled for live routing", async () => {
    const { env, sqlite } = await createLiveRouterEnv();
    try {
      await writeStrategyLabSubjectControl(
        env.WAITLIST_DB,
        parseRuntimeStrategyLabSubjectControl({
          schemaVersion: "v1",
          subjectKind: "asset",
          subjectKey: "SOL",
          liveAllowed: true,
          killSwitchEnabled: true,
          updatedAt: "2026-03-12T00:00:00.000Z",
        }),
      );

      await expect(
        executeSwapViaRouter({
          env,
          venueKey: "jupiter",
          runtimeMode: "live",
          execution: { adapter: "jupiter" },
          policy: normalizePolicy({ dryRun: true }),
          rpc: {} as never,
          jupiter: {} as never,
          quoteResponse: {
            inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            outputMint: "So11111111111111111111111111111111111111112",
            inAmount: "1",
            outAmount: "2",
          },
          userPublicKey: "11111111111111111111111111111111",
          log: () => {},
        }),
      ).rejects.toThrow(/runtime-asset-disabled-by-operator/);
    } finally {
      sqlite.close();
    }
  });
});
