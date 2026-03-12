import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeHeliusSenderSwap } from "../../apps/worker/src/execution/helius_sender_executor";
import { registerExecutionAdapter } from "../../apps/worker/src/execution/router";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";

const worker = (await import("../../apps/worker/src/index")).default;

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

function createRuntimeExecutionEnv() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const migrationName of [
    "0004_users_bots.sql",
    "0005_user_profile.sql",
    "0008_billing.sql",
    "0014_user_onboarding_status.sql",
    "0021_user_wallet_columns.sql",
    "0023_user_experience_onboarding.sql",
    "0025_execution_fabric.sql",
    "0027_runtime_canary.sql",
    "0029_strategy_lab_readiness.sql",
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
  sqlite
    .query(
      `
      INSERT INTO runtime_canary_state (
        state_key,
        schema_version,
        deployment_id,
        wallet_id,
        wallet_address,
        disabled,
        created_at,
        updated_at
      ) VALUES (?1, 'v1', ?2, ?3, ?4, 0, ?5, ?5)
      `,
    )
    .run(
      "mainnet",
      "runtime_canary_live_dca",
      "wallet_runtime_canary",
      "6F6A1zpGpRGmqrXpqgBFYGjC9WFo6iovrRVYoJNBHZqF",
      "2026-03-08T00:00:00.000Z",
    );
  sqlite
    .query(
      `
      INSERT INTO users (
        id,
        privy_user_id,
        profile,
        onboarding_status,
        signer_type,
        privy_wallet_id,
        wallet_address,
        wallet_migrated_at,
        experience_level,
        level_source,
        onboarding_completed_at,
        onboarding_version,
        feed_seed_version
      ) VALUES (?1, ?2, ?3, 'active', 'privy', ?4, ?5, ?6, 'intermediate', 'manual', ?6, 1, 1)
      `,
    )
    .run(
      "user_runtime_managed",
      "did:privy:user_runtime_managed",
      JSON.stringify({ riskProfile: "managed" }),
      "wallet_runtime_managed",
      "6F6A1zpGpRGmqrXpqgBFYGjC9WFo6iovrRVYoJNBHZqF",
      "2026-03-08T00:00:00.000Z",
    );
  for (const [subjectKind, subjectKey] of [
    ["venue", "jupiter"],
    ["asset", "SOL"],
    ["asset", "USDC"],
  ]) {
    sqlite
      .query(
        `
        INSERT INTO strategy_lab_subject_controls (
          subject_kind,
          subject_key,
          schema_version,
          live_allowed,
          kill_switch_enabled,
          updated_at,
          updated_by
        ) VALUES (?1, ?2, 'v1', 1, 0, ?3, 'unit-test')
        `,
      )
      .run(subjectKind, subjectKey, "2026-03-08T00:00:00.000Z");
  }

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      RUNTIME_INTERNAL_STUB_MODE: "0",
      RUNTIME_CANARY_ENABLED: "1",
      RUNTIME_CANARY_AUTO_CREATE_WALLET: "0",
      RUNTIME_CANARY_DEPLOYMENT_ID: "runtime_canary_live_dca",
      RUNTIME_CANARY_NOTIONAL_USD: "5",
      RUNTIME_CANARY_ALLOCATED_USD: "25",
      RUNTIME_CANARY_DAILY_CAP_USD: "25",
      RUNTIME_CANARY_MAX_SLIPPAGE_BPS: "50",
      RUNTIME_CANARY_MIN_SOL_RESERVE_LAMPORTS: "50000000",
      EXEC_LANE_SAFE_ADAPTER: "helius_sender",
      RUNTIME_MANAGED_LIVE_DEPLOYMENT_IDS: "deployment_live_rebalance",
      RPC_ENDPOINT: "https://rpc.test.local",
      BALANCE_RPC_ENDPOINT: "https://rpc.test.local",
      JUPITER_BASE_URL: "https://jupiter.test.local",
    },
  });

  return { env, sqlite };
}

const VALID_RUNTIME_DEPLOYMENT = {
  schemaVersion: "v1",
  deploymentId: "deployment_123",
  strategyKey: "dca",
  sleeveId: "sleeve_alpha",
  ownerUserId: "user_123",
  venueKey: "jupiter",
  pair: {
    symbol: "SOL/USDC",
    baseMint: "So11111111111111111111111111111111111111112",
    quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  mode: "shadow",
  state: "shadow",
  lane: "safe",
  createdAt: "2026-03-07T00:00:00.000Z",
  updatedAt: "2026-03-07T00:00:00.000Z",
  policy: {
    maxNotionalUsd: "250.00",
    dailyLossLimitUsd: "35.00",
    maxSlippageBps: 50,
    maxConcurrentRuns: 2,
    rebalanceToleranceBps: 100,
  },
  capital: {
    allocatedUsd: "1000.00",
    reservedUsd: "125.00",
    availableUsd: "875.00",
  },
  tags: ["fixture"],
};

const VALID_RUNTIME_EXECUTION_PLAN = {
  schemaVersion: "v1",
  planId: "plan_123",
  deploymentId: "deployment_123",
  venueKey: "jupiter",
  ownerUserId: "user_123",
  sleeveId: "sleeve_alpha",
  runId: "run_123",
  createdAt: "2026-03-07T00:00:00.000Z",
  mode: "shadow",
  lane: "safe",
  idempotencyKey: "deployment_123:run_123",
  simulateOnly: true,
  dryRun: true,
  slices: [
    {
      sliceId: "slice_1",
      action: "buy",
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outputMint: "So11111111111111111111111111111111111111112",
      inputAmountAtomic: "5000000",
      minOutputAmountAtomic: "30000000",
      notionalUsd: "5.00",
      slippageBps: 50,
    },
  ],
};

const VALID_RUNTIME_RESEARCH_SOURCE = {
  schemaVersion: "v1",
  sourceId: "source_paper_microstructure",
  sourceKind: "paper",
  title: "Microstructure signals for crypto execution",
  url: "https://example.com/papers/microstructure",
  canonicalUrl: "https://example.com/papers/microstructure",
  authors: ["Ada Researcher"],
  retrievedAt: "2026-03-10T14:00:00.000Z",
  contentDigest: "sha256:paper",
  provenance: {
    acquisitionKind: "paper_feed",
    collectedFrom: "https://example.com/feed/crypto.xml",
    hostname: "example.com",
    publisher: "Example Research",
    firstSeenAt: "2026-03-10T14:00:00.000Z",
    lastSeenAt: "2026-03-10T14:00:00.000Z",
  },
  venueKeys: ["jupiter"],
  assetKeys: ["SOL", "USDC"],
  tags: ["signal"],
};

const VALID_RUNTIME_RESEARCH_HYPOTHESIS = {
  schemaVersion: "v1",
  hypothesisId: "hypothesis_signal_trend",
  strategyKey: "trend_following",
  title: "Trend continuation after liquidity shocks",
  thesis:
    "High-quality liquidity shocks should resolve into short continuation bursts.",
  status: "candidate",
  createdAt: "2026-03-10T14:05:00.000Z",
  updatedAt: "2026-03-10T14:05:00.000Z",
  venueKeys: ["jupiter"],
  assetKeys: ["SOL", "USDC"],
  sourceCitations: [{ sourceId: "source_paper_microstructure" }],
  tags: ["candidate"],
};

const VALID_RUNTIME_RESEARCH_EXPERIMENT = {
  schemaVersion: "v1",
  experimentId: "experiment_signal_trend_shadow",
  hypothesisId: "hypothesis_signal_trend",
  strategyKey: "trend_following",
  status: "completed",
  createdAt: "2026-03-10T14:10:00.000Z",
  updatedAt: "2026-03-10T14:20:00.000Z",
  completedAt: "2026-03-10T14:20:00.000Z",
  venueKeys: ["jupiter"],
  assetKeys: ["SOL", "USDC"],
  sourceCitations: [{ sourceId: "source_paper_microstructure" }],
  codeRevision: {
    vcs: "git",
    repository: "github.com/GuiBibeau/serious-trader-ralph",
    revision: "356b539e3ec730663c4025b8f00cd6b47b823d1a",
    treeDirty: false,
  },
  datasetSnapshots: [
    {
      datasetId: "dataset_features_sol_usdc",
      snapshotId: "snapshot_2026_03_10",
      capturedAt: "2026-03-10T14:00:00.000Z",
    },
  ],
  artifacts: [],
  summary: "Shadow replay passed the initial trigger-quality gate.",
  tags: ["shadow"],
};

const VALID_RUNTIME_RESEARCH_EVIDENCE_BUNDLE = {
  schemaVersion: "v1",
  evidenceBundleId: "evidence_signal_trend_shadow",
  experimentId: "experiment_signal_trend_shadow",
  strategyKey: "trend_following",
  status: "ready_for_review",
  promotionTarget: "paper",
  createdAt: "2026-03-10T14:21:00.000Z",
  updatedAt: "2026-03-10T14:21:00.000Z",
  venueKeys: ["jupiter"],
  assetKeys: ["SOL", "USDC"],
  sourceCitations: [{ sourceId: "source_paper_microstructure" }],
  codeRevision: {
    vcs: "git",
    repository: "github.com/GuiBibeau/serious-trader-ralph",
    revision: "356b539e3ec730663c4025b8f00cd6b47b823d1a",
    treeDirty: false,
  },
  datasetSnapshots: [
    {
      datasetId: "dataset_features_sol_usdc",
      snapshotId: "snapshot_2026_03_10",
      capturedAt: "2026-03-10T14:00:00.000Z",
    },
  ],
  artifacts: [
    {
      artifactId: "proof-markdown",
      kind: "proof-bundle",
      uri: "r2://artifacts/proof-markdown.md",
    },
  ],
  summary: "Evidence bundle for shadow-to-paper review.",
  tags: ["promotion"],
};

const VALID_RUNTIME_ASSET = {
  schemaVersion: "v1",
  assetKey: "BONK",
  displayName: "Bonk",
  symbol: "BONK",
  chainKey: "solana-mainnet",
  canonicalId: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  assetKind: "token",
  riskClass: "volatile",
  listingState: "candidate",
  decimals: 5,
  aliases: ["Bonk Inu"],
  quoteAssetKeys: ["USDC"],
  venueMappings: [
    {
      venueKey: "jupiter",
      nativeId: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      venueSymbol: "BONK",
      decimals: 5,
      listingState: "candidate",
      quoteAssetKeys: ["USDC"],
      priceDecimals: 8,
      sizeDecimals: 5,
      minNotionalUsd: "0.10",
    },
  ],
  createdAt: "2026-03-10T14:25:00.000Z",
  updatedAt: "2026-03-10T14:25:00.000Z",
  tags: ["candidate", "meme"],
};

const VALID_RUNTIME_DATASET_SNAPSHOT = {
  schemaVersion: "v1",
  datasetId: "dataset_feed_replay_sol_usdc_market_events",
  snapshotId: "snapshot_2026_03_07_seed",
  datasetKind: "market_events",
  normalizationKind: "replay_ready",
  format: "fixture_json",
  retentionClass: "seed",
  capturedAt: "2026-03-10T00:00:00.000Z",
  coverageStartAt: "2026-03-07T00:00:00Z",
  coverageEndAt: "2026-03-07T00:00:05Z",
  rowCount: 2,
  venueKeys: ["jupiter"],
  assetKeys: ["SOL", "USDC"],
  pairSymbols: ["SOL/USDC"],
  chainKeys: ["solana-mainnet"],
  uri: "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents",
  contentDigest: "sha256:fixture",
  provenance: {
    acquisitionKind: "research_fixture",
    collectedFrom:
      "services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json",
    provider: "repo-fixture",
    collectedAt: "2026-03-10T00:00:00.000Z",
    generator: "runtime-rs",
    generatorRevision: "feed-replay-seed-v1",
  },
  tags: ["seed", "replay"],
};

const VALID_RUNTIME_REPLAY_CORPUS = {
  schemaVersion: "v1",
  corpusId: "replay_corpus_sol_usdc_feed_gateway_seed",
  title: "SOL/USDC feed gateway seed replay corpus",
  summary:
    "Deterministic replay corpus seeded from the checked-in runtime feed fixture.",
  replayKind: "feed_gateway_v1",
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
  venueKeys: ["jupiter", "helius"],
  assetKeys: ["SOL", "USDC"],
  pairSymbols: ["SOL/USDC"],
  chainKeys: ["solana-mainnet"],
  datasetSnapshots: [
    {
      datasetId: "dataset_feed_replay_sol_usdc_market_events",
      snapshotId: "snapshot_2026_03_07_seed",
      capturedAt: "2026-03-10T00:00:00.000Z",
      uri: "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents",
      contentDigest: "sha256:fixture",
    },
  ],
  fixtureUri:
    "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json",
  contentDigest: "sha256:fixture",
  deterministicSeed: 100,
  tags: ["seed", "replay"],
};

const VALID_RUNTIME_BACKTEST_REPORT = {
  schemaVersion: "v1",
  reportId: "backtest_alloc_dca_report",
  experimentId: "experiment_alloc_dca_backtest",
  strategyKey: "dca",
  status: "completed",
  generatedAt: "2026-03-10T00:00:00.000Z",
  venueKeys: ["jupiter"],
  assetKeys: ["SOL", "USDC"],
  codeRevision: {
    vcs: "git",
    repository: "github.com/GuiBibeau/serious-trader-ralph",
    revision: "356b539e3ec730663c4025b8f00cd6b47b823d1a",
    treeDirty: false,
  },
  datasetSnapshots: [
    {
      datasetId: "dataset_feature_cache_sol_usdc_market_events",
      snapshotId: "snapshot_2026_03_07_backtest",
      capturedAt: "2026-03-10T00:00:00.000Z",
      uri: "repo://services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json#marketEvents",
      contentDigest: "sha256:feature-cache",
    },
  ],
  strategySpecDigest:
    "sha256:1992048eb2efcd762981bd78d6ae7685c39873c4ccb8189681e2003ca8d84bff",
  config: {
    replayCorpusId: "replay_corpus_sol_usdc_feature_cache",
    venueKey: "jupiter",
    pairSymbol: "SOL/USDC",
    marketType: "spot",
    windowMode: "rolling",
    trainingWindowObservations: 2,
    testingWindowObservations: 1,
    stepObservations: 1,
    purgeObservations: 0,
    baselineStrategies: ["flat_cash", "buy_and_hold"],
  },
  foldReports: [
    {
      foldId: "fold_0",
      foldIndex: 0,
      trainingStartAt: "2026-03-07T00:00:00Z",
      trainingEndAt: "2026-03-07T00:00:10Z",
      testStartAt: "2026-03-07T00:00:10Z",
      testEndAt: "2026-03-07T00:00:15Z",
      trainObservationCount: 2,
      purgedObservationCount: 0,
      testObservationCount: 1,
      metrics: {
        observationCount: 1,
        tradeCount: 1,
        grossReturnBps: "22.5384",
        netReturnBps: "22.5384",
        totalCostBps: "0.0000",
        winRateBps: 10000,
        maxDrawdownBps: "0.0000",
      },
      baselineComparisons: [
        {
          baseline: "flat_cash",
          baselineReturnBps: "0.0000",
          excessReturnBps: "22.5384",
        },
      ],
      regimeMetrics: [
        {
          regimeKey: "short_trend",
          regimeValue: "flat",
          observationCount: 1,
          tradeCount: 1,
          netReturnBps: "22.5384",
          winRateBps: 10000,
        },
      ],
    },
    {
      foldId: "fold_1",
      foldIndex: 1,
      trainingStartAt: "2026-03-07T00:00:05Z",
      trainingEndAt: "2026-03-07T00:00:15Z",
      testStartAt: "2026-03-07T00:00:15Z",
      testEndAt: "2026-03-07T00:00:20Z",
      trainObservationCount: 2,
      purgedObservationCount: 0,
      testObservationCount: 1,
      metrics: {
        observationCount: 1,
        tradeCount: 1,
        grossReturnBps: "18.1150",
        netReturnBps: "18.1150",
        totalCostBps: "0.0000",
        winRateBps: 10000,
        maxDrawdownBps: "0.0000",
      },
      baselineComparisons: [
        {
          baseline: "flat_cash",
          baselineReturnBps: "0.0000",
          excessReturnBps: "18.1150",
        },
      ],
      regimeMetrics: [
        {
          regimeKey: "short_trend",
          regimeValue: "up",
          observationCount: 1,
          tradeCount: 1,
          netReturnBps: "18.1150",
          winRateBps: 10000,
        },
      ],
    },
  ],
  aggregateMetrics: {
    observationCount: 2,
    tradeCount: 2,
    grossReturnBps: "40.6534",
    netReturnBps: "40.6534",
    totalCostBps: "0.0000",
    winRateBps: 10000,
    maxDrawdownBps: "0.0000",
  },
  aggregateBaselineComparisons: [
    {
      baseline: "flat_cash",
      baselineReturnBps: "0.0000",
      excessReturnBps: "40.6534",
    },
  ],
  aggregateRegimeMetrics: [
    {
      regimeKey: "short_trend",
      regimeValue: "flat",
      observationCount: 1,
      tradeCount: 1,
      netReturnBps: "22.5384",
      winRateBps: 10000,
    },
    {
      regimeKey: "short_trend",
      regimeValue: "up",
      observationCount: 1,
      tradeCount: 1,
      netReturnBps: "18.1150",
      winRateBps: 10000,
    },
  ],
  promotionEligible: true,
  blockingReasons: [],
  summary:
    "Backtest cleared two walk-forward folds for dca with positive aggregate net return.",
  tags: ["backtest", "paper"],
};

describe("worker runtime internal routes", () => {
  test("requires runtime service auth", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/health"),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "auth-required",
    });
  });

  test("fails closed when runtime service auth is not configured", async () => {
    const env = createWorkerLiveEnv({
      overrides: {
        RUNTIME_INTERNAL_SERVICE_TOKEN: "",
      },
    });

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/health", {
        headers: {
          authorization: "Bearer runtime-service-secret",
        },
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "runtime-service-auth-not-configured",
    });
  });

  test("returns authenticated runtime bridge health", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/health", {
        headers: {
          authorization: "Bearer runtime-service-secret",
        },
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      schemaVersion: "v1",
      service: "worker-runtime-bridge",
      authenticatedService: "runtime-rs",
      integration: {
        stubModeEnabled: true,
      },
      routes: {
        deployments: "/api/internal/runtime/deployments",
        executionPlans: "/api/internal/runtime/execution-plans",
        health: "/api/internal/runtime/health",
        scorecards: "/api/internal/runtime/scorecards",
        leaderboards: "/api/internal/runtime/leaderboards",
        allocator: "/api/internal/runtime/allocator",
        reproducibilityBundles:
          "/api/internal/runtime/research/reproducibility-bundles",
        backtests: "/api/internal/runtime/backtests",
        costModels: "/api/internal/runtime/cost-models",
      },
    });
  });

  test("accepts runtime deployment records through the private route family", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/deployments", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-service-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_RUNTIME_DEPLOYMENT),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "accepted",
      source: "stub",
      deployment: {
        deploymentId: "deployment_123",
        strategyKey: "dca",
      },
    });
  });

  test("accepts service-authenticated runtime execution plans", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/execution-plans", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-service-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_RUNTIME_EXECUTION_PLAN),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      ok: true,
      accepted: true,
      source: "stub",
      submitRequestId: "submit_plan_123",
      coordination: {
        planId: "plan_123",
        deploymentId: "deployment_123",
        runId: "run_123",
        sliceCount: 1,
      },
    });
  });

  test("executes the bounded runtime canary plan in non-stub mode", async () => {
    const { env, sqlite } = createRuntimeExecutionEnv();
    const originalFetch = globalThis.fetch;
    registerExecutionAdapter(
      "helius_sender",
      async (input) => ({
        status: "finalized",
        signature: "sig_runtime_canary",
        usedQuote: input.quoteResponse,
        refreshed: false,
        lastValidBlockHeight: null,
        executionMeta: {
          route: "helius_sender",
          classification: "finalized",
        },
      }),
      {
        venueKey: "jupiter",
        supportedModes: ["live"],
      },
    );

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://jupiter.test.local/swap/v1/quote")) {
        return new Response(
          JSON.stringify({
            inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "5000000",
            outputMint: "So11111111111111111111111111111111111111112",
            outAmount: "35000000",
            otherAmountThreshold: "34000000",
            swapMode: "ExactIn",
            slippageBps: 50,
            priceImpactPct: "0.001",
            routePlan: [],
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url === "https://rpc.test.local") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
        };
        if (body.method === "getBalance") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "1",
              result: { value: 100_000_000 },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "getTokenAccountsByOwner") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "1",
              result: {
                value: [
                  {
                    account: {
                      data: {
                        parsed: {
                          info: {
                            tokenAmount: {
                              amount: "20000000",
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/internal/runtime/execution-plans", {
          method: "POST",
          headers: {
            authorization: "Bearer runtime-service-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            schemaVersion: "v1",
            planId: "plan_live_canary",
            deploymentId: "runtime_canary_live_dca",
            venueKey: "jupiter",
            runId: "run_live_canary",
            createdAt: "2026-03-08T00:00:00.000Z",
            mode: "live",
            lane: "safe",
            idempotencyKey: "runtime_canary_live_dca:run_live_canary",
            simulateOnly: false,
            dryRun: false,
            slices: [
              {
                sliceId: "slice_1",
                action: "buy",
                inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                outputMint: "So11111111111111111111111111111111111111112",
                inputAmountAtomic: "5000000",
                minOutputAmountAtomic: "34000000",
                notionalUsd: "5.00",
                slippageBps: 50,
              },
            ],
          }),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        ok: true,
        accepted: true,
        source: "worker",
        submitRequestId: expect.any(String),
        receipt: {
          status: "landed",
          signature: "sig_runtime_canary",
        },
        observedLedger: {
          deploymentId: "runtime_canary_live_dca",
          sleeveId: "sleeve_runtime_canary",
        },
      });
    } finally {
      registerExecutionAdapter("helius_sender", executeHeliusSenderSwap, {
        venueKey: "jupiter",
        supportedModes: ["live"],
      });
      globalThis.fetch = originalFetch;
      sqlite.close();
    }
  });

  test("executes the bounded managed live plan in non-stub mode", async () => {
    const { env, sqlite } = createRuntimeExecutionEnv();
    const originalFetch = globalThis.fetch;
    registerExecutionAdapter(
      "helius_sender",
      async (input) => ({
        status: "finalized",
        signature: "sig_runtime_managed",
        usedQuote: input.quoteResponse,
        refreshed: false,
        lastValidBlockHeight: null,
        executionMeta: {
          route: "helius_sender",
          classification: "finalized",
        },
      }),
      {
        venueKey: "jupiter",
        supportedModes: ["live"],
      },
    );
    await env.CONFIG_KV.put(
      "ops:controls:v1",
      JSON.stringify({
        schemaVersion: "v1",
        execution: {
          enabled: true,
          disabledReason: null,
          lanes: {
            fast: true,
            protected: true,
            safe: true,
          },
        },
        canary: {
          enabled: true,
          disabledReason: null,
        },
        runtime: {
          enabled: true,
          disabledReason: null,
          shadowOnly: false,
          shadowOnlyReason: null,
        },
        metadata: {
          source: "test",
          updatedAt: "2026-03-08T00:00:00.000Z",
          updatedBy: "worker-runtime-internal-test",
        },
      }),
    );
    env.EXEC_LANE_SAFE_ADAPTER = "helius_sender";

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://jupiter.test.local/swap/v1/quote")) {
        return new Response(
          JSON.stringify({
            inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "5000000",
            outputMint: "So11111111111111111111111111111111111111112",
            outAmount: "35000000",
            otherAmountThreshold: "34000000",
            swapMode: "ExactIn",
            slippageBps: 50,
            priceImpactPct: "0.001",
            routePlan: [],
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url === "https://rpc.test.local") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
        };
        if (body.method === "getBalance") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "1",
              result: { value: 100_000_000 },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (body.method === "getTokenAccountsByOwner") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "1",
              result: {
                value: [
                  {
                    account: {
                      data: {
                        parsed: {
                          info: {
                            tokenAmount: {
                              amount: "20000000",
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/internal/runtime/execution-plans", {
          method: "POST",
          headers: {
            authorization: "Bearer runtime-service-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            schemaVersion: "v1",
            planId: "plan_live_managed",
            deploymentId: "deployment_live_rebalance",
            venueKey: "jupiter",
            ownerUserId: "user_runtime_managed",
            sleeveId: "sleeve_runtime_managed",
            runId: "run_live_managed",
            createdAt: "2026-03-08T00:00:00.000Z",
            mode: "live",
            lane: "safe",
            idempotencyKey: "deployment_live_rebalance:run_live_managed",
            simulateOnly: false,
            dryRun: false,
            slices: [
              {
                sliceId: "slice_1",
                action: "rebalance",
                inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                outputMint: "So11111111111111111111111111111111111111112",
                inputAmountAtomic: "5000000",
                minOutputAmountAtomic: "34000000",
                notionalUsd: "5.00",
                slippageBps: 50,
              },
            ],
          }),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        ok: true,
        accepted: true,
        source: "worker",
        submitRequestId: expect.any(String),
        receipt: {
          status: "landed",
          signature: "sig_runtime_managed",
        },
        observedLedger: {
          deploymentId: "deployment_live_rebalance",
          sleeveId: "sleeve_runtime_managed",
          ownerUserId: "user_runtime_managed",
        },
      });
    } finally {
      registerExecutionAdapter("helius_sender", executeHeliusSenderSwap, {
        venueKey: "jupiter",
        supportedModes: ["live"],
      });
      globalThis.fetch = originalFetch;
      sqlite.close();
    }
  });

  test("returns stubbed runtime scorecards and promotion gates", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/scorecards?deploymentId=deployment_123",
        {
          headers: {
            authorization: "Bearer runtime-service-secret",
          },
        },
      ),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      source: "stub",
      deploymentId: "deployment_123",
      report: {
        mode: "shadow",
        scorecard: {
          triggerQuality: {
            totalRuns: 3,
          },
          cost: {
            modelId: "cost_model_jupiter_sol_usdc_spot",
          },
        },
      },
    });
    expect(payload.report.promotionGates[0]).toMatchObject({
      sourceMode: "shadow",
      targetMode: "paper",
      status: "pass",
    });
  });

  test("returns stubbed strategy leaderboards", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/leaderboards", {
        headers: {
          authorization: "Bearer runtime-service-secret",
        },
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      source: "stub",
      leaderboard: {
        entryCount: 1,
        entries: [
          {
            strategyKey: "trend_following",
            pairSymbol: "SOL/USDC",
            promotionEligible: true,
          },
        ],
      },
    });
  });

  test("returns stubbed runtime backtests", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/backtests?strategyKey=dca&promotionEligible=true",
        {
          headers: {
            authorization: "Bearer runtime-service-secret",
          },
        },
      ),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      source: "stub",
      filters: {
        strategyKey: "dca",
        promotionEligible: "true",
      },
      reports: [
        {
          reportId: "backtest_alloc_dca_report",
          strategyKey: "dca",
          status: "completed",
          promotionEligible: true,
          config: {
            marketType: "spot",
            windowMode: "rolling",
          },
        },
      ],
    });
  });

  test("accepts runtime backtest reports through the private route family", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/backtests", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-service-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_RUNTIME_BACKTEST_REPORT),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      ok: true,
      source: "stub",
      created: true,
      report: {
        reportId: "backtest_alloc_dca_report",
        strategyKey: "dca",
        status: "completed",
        promotionEligible: true,
        config: {
          replayCorpusId: "replay_corpus_sol_usdc_feature_cache",
          marketType: "spot",
        },
      },
    });
  });

  test("returns stubbed runtime allocator decisions", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/allocator?deploymentId=deployment_123",
        {
          headers: {
            authorization: "Bearer runtime-service-secret",
          },
        },
      ),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      source: "stub",
      deploymentId: "deployment_123",
      currentDecision: {
        deploymentId: "deployment_123",
        grantedReservedUsd: "125.00",
      },
      sleeve: {
        sleeveId: "sleeve_alpha",
        availableUsd: "875.00",
      },
    });
  });

  test("returns stubbed runtime research registry", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/research?strategyKey=trend_following&venueKey=jupiter&assetKey=SOL&sourceId=source_paper_microstructure",
        {
          headers: {
            authorization: "Bearer runtime-service-secret",
          },
        },
      ),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      source: "stub",
      filters: {
        strategyKey: "trend_following",
        venueKey: "jupiter",
        assetKey: "SOL",
        sourceId: "source_paper_microstructure",
      },
      registry: {
        hypotheses: [
          {
            hypothesisId: "hypothesis_signal_trend",
          },
        ],
        experiments: [
          {
            experimentId: "experiment_signal_trend_shadow",
          },
        ],
        evidenceBundles: [
          {
            evidenceBundleId: "evidence_signal_trend_shadow",
          },
        ],
        reproducibilityBundles: [
          {
            reproducibilityBundleId: "repro_signal_trend_shadow",
          },
        ],
      },
    });
  });

  test("returns stubbed runtime cost model registry", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/cost-models?venueKey=jupiter&assetKey=SOL&pairSymbol=SOL%2FUSDC&marketType=spot&mode=paper",
        {
          headers: {
            authorization: "Bearer runtime-service-secret",
          },
        },
      ),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      source: "stub",
      filters: {
        venueKey: "jupiter",
        assetKey: "SOL",
        pairSymbol: "SOL/USDC",
        marketType: "spot",
        mode: "paper",
      },
      registry: {
        costModels: expect.arrayContaining([
          expect.objectContaining({
            modelId: "cost_model_jupiter_sol_usdc_spot",
            venueKey: "jupiter",
            marketType: "spot",
          }),
        ]),
      },
    });
  });

  test("accepts stubbed runtime research writes", async () => {
    const env = createWorkerLiveEnv();

    const sourceResponse = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/research/sources", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-service-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_RUNTIME_RESEARCH_SOURCE),
      }),
      env,
      createExecutionContextStub(),
    );
    expect(sourceResponse.status).toBe(201);

    const hypothesisResponse = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/research/hypotheses", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-service-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_RUNTIME_RESEARCH_HYPOTHESIS),
      }),
      env,
      createExecutionContextStub(),
    );
    expect(hypothesisResponse.status).toBe(201);

    const experimentResponse = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/research/experiments",
        {
          method: "POST",
          headers: {
            authorization: "Bearer runtime-service-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify(VALID_RUNTIME_RESEARCH_EXPERIMENT),
        },
      ),
      env,
      createExecutionContextStub(),
    );
    expect(experimentResponse.status).toBe(201);

    const evidenceResponse = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/research/evidence-bundles",
        {
          method: "POST",
          headers: {
            authorization: "Bearer runtime-service-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify(VALID_RUNTIME_RESEARCH_EVIDENCE_BUNDLE),
        },
      ),
      env,
      createExecutionContextStub(),
    );

    expect(evidenceResponse.status).toBe(201);
    expect(await evidenceResponse.json()).toMatchObject({
      ok: true,
      source: "stub",
      created: true,
      evidenceBundle: {
        evidenceBundleId: "evidence_signal_trend_shadow",
      },
    });
  });

  test("returns stubbed runtime asset registry", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/assets?assetKey=SOL&venueKey=jupiter&listingState=live",
        {
          headers: {
            authorization: "Bearer runtime-service-secret",
          },
        },
      ),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      source: "stub",
      filters: {
        assetKey: "SOL",
        venueKey: "jupiter",
        listingState: "live",
      },
    });
    expect(payload.registry.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetKey: "SOL",
          venueMappings: expect.arrayContaining([
            expect.objectContaining({ venueKey: "jupiter" }),
          ]),
        }),
      ]),
    );
  });

  test("accepts stubbed runtime asset writes and transitions", async () => {
    const env = createWorkerLiveEnv();

    const writeResponse = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/assets", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-service-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_RUNTIME_ASSET),
      }),
      env,
      createExecutionContextStub(),
    );
    expect(writeResponse.status).toBe(201);
    expect(await writeResponse.json()).toMatchObject({
      ok: true,
      source: "stub",
      created: true,
      asset: {
        assetKey: "BONK",
        listingState: "candidate",
      },
    });

    const transitionResponse = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/assets/BONK/transition",
        {
          method: "POST",
          headers: {
            authorization: "Bearer runtime-service-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            listingState: "paper",
            changedAt: "2026-03-10T14:30:00.000Z",
          }),
        },
      ),
      env,
      createExecutionContextStub(),
    );

    expect(transitionResponse.status).toBe(200);
    expect(await transitionResponse.json()).toMatchObject({
      ok: true,
      source: "stub",
      asset: {
        assetKey: "BONK",
        listingState: "paper",
      },
    });
  });

  test("returns stubbed runtime historical data lake", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/datasets?datasetId=dataset_feed_replay_sol_usdc_market_events&snapshotId=snapshot_2026_03_07_seed&corpusId=replay_corpus_sol_usdc_feed_gateway_seed&venueKey=jupiter&assetKey=SOL&datasetKind=market_events",
        {
          headers: {
            authorization: "Bearer runtime-service-secret",
          },
        },
      ),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      source: "stub",
      filters: {
        datasetId: "dataset_feed_replay_sol_usdc_market_events",
        snapshotId: "snapshot_2026_03_07_seed",
        corpusId: "replay_corpus_sol_usdc_feed_gateway_seed",
        venueKey: "jupiter",
        assetKey: "SOL",
        datasetKind: "market_events",
      },
    });
    expect(payload.registry.datasetSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          datasetId: "dataset_feed_replay_sol_usdc_market_events",
        }),
      ]),
    );
    expect(payload.registry.replayCorpora).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          corpusId: "replay_corpus_sol_usdc_feed_gateway_seed",
        }),
      ]),
    );
  });

  test("accepts stubbed runtime historical data writes", async () => {
    const env = createWorkerLiveEnv();

    const datasetResponse = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/datasets/snapshots", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-service-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_RUNTIME_DATASET_SNAPSHOT),
      }),
      env,
      createExecutionContextStub(),
    );
    expect(datasetResponse.status).toBe(201);
    expect(await datasetResponse.json()).toMatchObject({
      ok: true,
      source: "stub",
      created: true,
      datasetSnapshot: {
        datasetId: "dataset_feed_replay_sol_usdc_market_events",
      },
    });

    const replayResponse = await worker.fetch(
      new Request(
        "http://localhost/api/internal/runtime/datasets/replay-corpora",
        {
          method: "POST",
          headers: {
            authorization: "Bearer runtime-service-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify(VALID_RUNTIME_REPLAY_CORPUS),
        },
      ),
      env,
      createExecutionContextStub(),
    );
    expect(replayResponse.status).toBe(201);
    expect(await replayResponse.json()).toMatchObject({
      ok: true,
      source: "stub",
      created: true,
      replayCorpus: {
        corpusId: "replay_corpus_sol_usdc_feed_gateway_seed",
      },
    });
  });
});
