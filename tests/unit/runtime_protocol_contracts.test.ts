import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  canTransitionRuntimeDeploymentState,
  canTransitionRuntimeRunState,
  canTransitionRuntimeStrategyDeskPromotionHandoffState,
  canTransitionRuntimeStrategyDeskRunState,
  canTransitionRuntimeStrategyDeskScenarioState,
  parseRuntimeAssetRecord,
  parseRuntimeBacktestReport,
  parseRuntimeDeploymentRecord,
  parseRuntimeExecutionCostModelRecord,
  parseRuntimeExecutionCostObservationRecord,
  parseRuntimeExecutionPlan,
  parseRuntimeFeatureDefinitionRecord,
  parseRuntimeHistoricalDatasetSnapshotRecord,
  parseRuntimeLedgerSnapshot,
  parseRuntimeMarginAccountSnapshot,
  parseRuntimeReconciliationResult,
  parseRuntimeRegimeTagRecord,
  parseRuntimeReplayCorpusRecord,
  parseRuntimeResearchEvidenceBundleRecord,
  parseRuntimeResearchExperimentRecord,
  parseRuntimeResearchHypothesisRecord,
  parseRuntimeResearchReproducibilityBundleRecord,
  parseRuntimeResearchSourceRecord,
  parseRuntimeRiskVerdict,
  parseRuntimeRunRecord,
  parseRuntimeStrategyDeskPromotionHandoff,
  parseRuntimeStrategyDeskScenarioLeg,
  parseRuntimeStrategyDeskScenarioManifest,
  parseRuntimeStrategyDeskScenarioReport,
  parseRuntimeStrategyDeskScenarioRun,
  parseRuntimeStrategySpec,
  parseRuntimeVenueCapability,
  RUNTIME_DEPLOYMENT_STATE_TRANSITIONS,
  RUNTIME_PROTOCOL_SCHEMA_REGISTRY,
  RUNTIME_RUN_STATE_TRANSITIONS,
  RUNTIME_STRATEGY_DESK_PROMOTION_HANDOFF_STATE_TRANSITIONS,
  RUNTIME_STRATEGY_DESK_RUN_STATE_TRANSITIONS,
  RUNTIME_STRATEGY_DESK_SCENARIO_STATE_TRANSITIONS,
  safeParseRuntimeDeploymentRecord,
  safeParseRuntimeExecutionPlan,
} from "../../src/runtime/contracts/index.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("runtime protocol contracts", () => {
  test("parses a valid deployment record", () => {
    const deployment = parseRuntimeDeploymentRecord({
      schemaVersion: "v1",
      deploymentId: "dep_1",
      strategyKey: "dca",
      sleeveId: "sleeve_1",
      ownerUserId: "user_1",
      venueKey: "jupiter",
      pair: {
        symbol: "SOL/USDC",
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
      },
      mode: "shadow",
      state: "shadow",
      lane: "safe",
      createdAt: "2026-03-07T18:00:00Z",
      updatedAt: "2026-03-07T18:01:00Z",
      policy: {
        maxNotionalUsd: "25",
        dailyLossLimitUsd: "10",
        maxSlippageBps: 50,
        maxConcurrentRuns: 1,
        rebalanceToleranceBps: 125,
      },
      capital: {
        allocatedUsd: "100",
        reservedUsd: "5",
        availableUsd: "95",
      },
      tags: ["shadow-only"],
    });

    expect(deployment.state).toBe("shadow");
    expect(deployment.pair.baseMint).toBe(SOL_MINT);
    expect(deployment.pair.marketType).toBe("spot");
  });

  test("parses a valid margin account snapshot", () => {
    const snapshot = parseRuntimeMarginAccountSnapshot({
      schemaVersion: "v1",
      snapshotId: "margin_mango_sol_1",
      venueKey: "mango",
      accountRef: "mango-account-1",
      capturedAt: "2026-03-14T05:00:00Z",
      marketTypes: ["spot", "perp"],
      equityQuote: "12450.25",
      initHealthQuote: "3250.50",
      maintHealthQuote: "2110.25",
      initHealthRatioPct: "26.10",
      maintHealthRatioPct: "16.95",
      usedMarginQuote: "4200.00",
      freeCollateralQuote: "8250.25",
      liquidationBufferPct: "12.35",
      liquidationRiskLevel: "warning",
      beingLiquidated: false,
      isOperational: true,
      positions: [
        {
          instrumentId: "SOL-PERP",
          marketType: "perp",
          side: "long",
          quantityAtomic: "1000000",
          collateralAtomic: "250000",
          notionalQuote: "155.20",
          entryPriceQuote: "154.90",
          markPriceQuote: "155.20",
          unsettledPnlQuote: "0.30",
          reduceOnly: false,
          notes: ["bounded-preview"],
        },
      ],
      oracles: [
        {
          instrumentId: "SOL-PERP",
          provider: "pyth",
          status: "healthy",
          priceQuote: "155.20",
          confidencePct: "0.15",
          lastUpdatedSlot: 345,
          lastUpdatedAt: "2026-03-14T04:59:58Z",
          notes: ["fresh"],
        },
      ],
      tags: ["mango", "paper"],
    });

    expect(snapshot.venueKey).toBe("mango");
    expect(snapshot.liquidationRiskLevel).toBe("warning");
    expect(snapshot.positions[0]?.instrumentId).toBe("SOL-PERP");
    expect(snapshot.oracles[0]?.provider).toBe("pyth");
  });

  test("rejects a deployment without tags", () => {
    const result = safeParseRuntimeDeploymentRecord({
      schemaVersion: "v1",
      deploymentId: "dep_1",
      strategyKey: "dca",
      sleeveId: "sleeve_1",
      ownerUserId: "user_1",
      pair: {
        symbol: "SOL/USDC",
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
      },
      mode: "shadow",
      state: "shadow",
      lane: "safe",
      createdAt: "2026-03-07T18:00:00Z",
      updatedAt: "2026-03-07T18:01:00Z",
      policy: {
        maxNotionalUsd: "25",
        dailyLossLimitUsd: "10",
        maxSlippageBps: 50,
        maxConcurrentRuns: 1,
        rebalanceToleranceBps: 125,
      },
      capital: {
        allocatedUsd: "100",
        reservedUsd: "5",
        availableUsd: "95",
      },
    });

    expect(result.success).toBe(false);
  });

  test("parses valid run, ledger, risk, plan, reconciliation, and research payloads", () => {
    const run = parseRuntimeRunRecord({
      schemaVersion: "v1",
      runId: "run_1",
      deploymentId: "dep_1",
      runKey: "dep_1:run_1",
      trigger: {
        kind: "signal",
        source: "feature-cache",
        observedAt: "2026-03-07T18:05:00Z",
      },
      state: "planned",
      plannedAt: "2026-03-07T18:05:01Z",
      updatedAt: "2026-03-07T18:05:02Z",
      riskVerdictId: "risk_1",
      executionPlanId: "plan_1",
    });
    const ledger = parseRuntimeLedgerSnapshot({
      schemaVersion: "v1",
      snapshotId: "ledger_1",
      deploymentId: "dep_1",
      sleeveId: "sleeve_1",
      asOf: "2026-03-07T18:06:00Z",
      balances: [
        {
          mint: USDC_MINT,
          symbol: "USDC",
          decimals: 6,
          freeAtomic: "95000000",
          reservedAtomic: "5000000",
          priceUsd: "1",
        },
      ],
      positions: [],
      totals: {
        equityUsd: "100",
        reservedUsd: "5",
        availableUsd: "95",
        realizedPnlUsd: "0",
        unrealizedPnlUsd: "0",
      },
    });
    const verdict = parseRuntimeRiskVerdict({
      schemaVersion: "v1",
      verdictId: "risk_1",
      deploymentId: "dep_1",
      runId: "run_1",
      decidedAt: "2026-03-07T18:05:01Z",
      verdict: "allow",
      reasons: [
        {
          code: "ok",
          message: "all clear",
          severity: "info",
        },
      ],
      observed: {
        requestedNotionalUsd: "5",
        reservedUsd: "5",
        concentrationBps: 1200,
        featureAgeMs: 400,
      },
      limits: {
        maxNotionalUsd: "25",
        maxReservedUsd: "50",
        maxConcentrationBps: 3500,
        staleAfterMs: 5000,
      },
    });
    const plan = parseRuntimeExecutionPlan({
      schemaVersion: "v1",
      planId: "plan_1",
      deploymentId: "dep_1",
      venueKey: "jupiter",
      ownerUserId: "user_1",
      sleeveId: "sleeve_1",
      runId: "run_1",
      createdAt: "2026-03-07T18:05:02Z",
      mode: "shadow",
      lane: "safe",
      idempotencyKey: "dep_1:run_1",
      simulateOnly: true,
      dryRun: true,
      slices: [
        {
          sliceId: "slice_1",
          action: "buy",
          inputMint: USDC_MINT,
          outputMint: SOL_MINT,
          inputAmountAtomic: "5000000",
          minOutputAmountAtomic: "25000",
          notionalUsd: "5",
          slippageBps: 50,
        },
      ],
    });
    const reconciliation = parseRuntimeReconciliationResult({
      schemaVersion: "v1",
      reconciliationId: "recon_1",
      deploymentId: "dep_1",
      runId: "run_1",
      receiptId: "receipt_1",
      completedAt: "2026-03-07T18:05:30Z",
      status: "passed",
      walletDeltas: [
        {
          mint: USDC_MINT,
          expectedAtomic: "-5000000",
          actualAtomic: "-5000000",
          deltaAtomic: "0",
        },
      ],
      positionDeltaUsd: "0",
      notes: ["matched"],
      correctionApplied: false,
    });
    const hypothesis = parseRuntimeResearchHypothesisRecord({
      schemaVersion: "v1",
      hypothesisId: "hypothesis_signal_trend",
      strategyKey: "trend_following",
      title: "Trend continuation after liquidity shocks",
      thesis:
        "High-quality liquidity shocks should resolve into short continuation bursts.",
      status: "candidate",
      createdAt: "2026-03-10T14:05:00Z",
      updatedAt: "2026-03-10T14:05:00Z",
      venueKeys: ["jupiter"],
      assetKeys: ["SOL", "USDC"],
      sourceCitations: [{ sourceId: "source_paper_microstructure" }],
      tags: ["candidate"],
    });
    const sourceRecord = parseRuntimeResearchSourceRecord({
      schemaVersion: "v1",
      sourceId: "source_paper_microstructure",
      sourceKind: "paper",
      title: "Microstructure signals for crypto execution",
      url: "https://example.com/papers/microstructure",
      canonicalUrl: "https://example.com/papers/microstructure",
      authors: ["Ada Researcher"],
      retrievedAt: "2026-03-10T14:00:00Z",
      contentDigest: "sha256:paper",
      provenance: {
        acquisitionKind: "paper_feed",
        collectedFrom: "https://example.com/feed/crypto.xml",
        hostname: "example.com",
        publisher: "Example Research",
        firstSeenAt: "2026-03-10T14:00:00Z",
        lastSeenAt: "2026-03-10T14:00:00Z",
      },
      venueKeys: ["jupiter"],
      assetKeys: ["SOL", "USDC"],
      tags: ["signal"],
    });
    const datasetSnapshot = parseRuntimeHistoricalDatasetSnapshotRecord({
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
    });
    const replayCorpus = parseRuntimeReplayCorpusRecord({
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
          datasetId: datasetSnapshot.datasetId,
          snapshotId: datasetSnapshot.snapshotId,
          capturedAt: datasetSnapshot.capturedAt,
          uri: datasetSnapshot.uri,
          contentDigest: datasetSnapshot.contentDigest,
        },
      ],
      fixtureUri:
        "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json",
      contentDigest: "sha256:fixture",
      deterministicSeed: 100,
      tags: ["seed", "replay"],
    });
    const costModel = parseRuntimeExecutionCostModelRecord({
      schemaVersion: "v1",
      modelId: "cost_model_jupiter_sol_usdc_spot",
      venueKey: "jupiter",
      marketType: "spot",
      pairSymbol: "SOL/USDC",
      instrumentId: "SOL/USDC",
      assetKeys: ["SOL", "USDC"],
      modeCoverage: ["shadow", "paper", "live"],
      status: "active",
      assumptions: {
        feeBps: 8,
        slippageBps: 22,
        marketImpactBps: 12,
        partialFillRateBps: 50,
        partialFillPenaltyBps: 12,
        financingCostBpsPerDay: "0",
      },
      calibration: {
        calibrationId: "calibration_jupiter_sol_usdc_spot_seed",
        methodology: "seed_replay_bootstrap",
        sampleStartAt: "2026-03-07T00:00:00.000Z",
        sampleEndAt: "2026-03-10T00:00:00.000Z",
        sampleCount: 240,
        confidenceBps: 8600,
        referenceNotionalUsd: "25.00",
        tags: ["seed", "bootstrap"],
        notes: "Bootstrap calibration from replay coverage.",
      },
      driftGuard: {
        maxCostDriftBps: 90,
        maxLatencyDriftMs: 8000,
        maxReconciliationDriftUsd: "1.50",
      },
      latencyProfile: {
        expectedQuoteMs: 250,
        expectedSubmitMs: 750,
        expectedSettlementMs: 5000,
      },
      datasetSnapshots: [
        {
          datasetId: datasetSnapshot.datasetId,
          snapshotId: datasetSnapshot.snapshotId,
          capturedAt: datasetSnapshot.capturedAt,
          uri: datasetSnapshot.uri,
          contentDigest: datasetSnapshot.contentDigest,
        },
      ],
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      tags: ["seed", "spot"],
    });
    const costObservation = parseRuntimeExecutionCostObservationRecord({
      schemaVersion: "v1",
      observationId: "costobs_jupiter_deployment_shadow_fixture_run_1",
      modelId: "cost_model_jupiter_sol_usdc_spot",
      deploymentId: "deployment_shadow_fixture",
      runId: "deployment_shadow_fixture_run_1",
      receiptId: "receipt_jupiter_deployment_shadow_fixture_run_1",
      venueKey: "jupiter",
      marketType: "spot",
      pairSymbol: "SOL/USDC",
      assetKeys: ["SOL", "USDC"],
      mode: "paper",
      observedAt: "2026-03-10T00:00:00.000Z",
      evaluatedNotionalUsd: "25.00",
      modeledTotalCostUsd: "0.11",
      observedTotalCostUsd: "0.13",
      costDriftUsd: "0.02",
      costDriftBps: 80,
      expectedEndToEndLatencyMs: 5750,
      observedEndToEndLatencyMs: 6125,
      latencyDriftMs: 375,
      reconciliationStatus: "passed",
      reconciliationDriftUsd: "0.02",
      tags: ["cost-observation", "paper"],
      notes:
        "Derived from runtime plan, receipt, and reconciliation artifacts.",
    });
    const featureDefinition = parseRuntimeFeatureDefinitionRecord({
      schemaVersion: "v1",
      featureId: "feature_short_return_bps_v1",
      featureKey: "short_return_bps",
      version: "1.0.0",
      title: "Short-window return",
      summary:
        "Short-window signed return used by directional signal templates.",
      status: "active",
      marketType: "spot",
      venueKeys: ["jupiter", "magicblock", "phoenix"],
      assetKeys: ["SOL", "USDC"],
      pairSymbols: ["SOL/USDC"],
      inputRequirements: [
        {
          inputKey: "mid_price_usd",
          required: true,
          freshnessMs: 20000,
        },
      ],
      derivedFromFeatureKeys: [],
      freshnessSloMs: 20000,
      maxAllowedDriftBps: 50,
      minCoverageBps: 10000,
      provenance: {
        generatedBy: "strategy-lab::feature-catalog",
        generatedRevision: "seed",
        generatedAt: "2026-03-10T00:00:00.000Z",
      },
      datasetSnapshots: [
        {
          datasetId: datasetSnapshot.datasetId,
          snapshotId: datasetSnapshot.snapshotId,
          capturedAt: datasetSnapshot.capturedAt,
          uri: datasetSnapshot.uri,
          contentDigest: datasetSnapshot.contentDigest,
        },
      ],
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      tags: ["signal", "seed"],
    });
    const regimeTag = parseRuntimeRegimeTagRecord({
      schemaVersion: "v1",
      regimeTagId: "regime_long_trend_v1",
      regimeKey: "long_trend",
      version: "1.0.0",
      title: "Long trend regime",
      summary:
        "Classifies long-window directional bias for confirmation and macro rotation.",
      status: "active",
      dimension: "trend",
      value: "confirmed",
      marketType: "spot",
      venueKeys: ["jupiter", "magicblock", "phoenix"],
      assetKeys: ["SOL", "USDC"],
      pairSymbols: ["SOL/USDC"],
      sourceFeatureKeys: ["long_return_bps"],
      freshnessSloMs: 20000,
      maxAllowedDriftBps: 50,
      minConfidenceBps: 8500,
      provenance: {
        generatedBy: "strategy-lab::regime-catalog",
        generatedRevision: "seed",
        generatedAt: "2026-03-10T00:00:00.000Z",
      },
      datasetSnapshots: [
        {
          datasetId: datasetSnapshot.datasetId,
          snapshotId: datasetSnapshot.snapshotId,
          capturedAt: datasetSnapshot.capturedAt,
          uri: datasetSnapshot.uri,
          contentDigest: datasetSnapshot.contentDigest,
        },
      ],
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      tags: ["signal", "seed"],
    });
    const experiment = parseRuntimeResearchExperimentRecord({
      schemaVersion: "v1",
      experimentId: "experiment_signal_trend_shadow",
      hypothesisId: "hypothesis_signal_trend",
      strategyKey: "trend_following",
      status: "completed",
      createdAt: "2026-03-10T14:10:00Z",
      updatedAt: "2026-03-10T14:20:00Z",
      completedAt: "2026-03-10T14:20:00Z",
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
          capturedAt: "2026-03-10T14:00:00Z",
        },
      ],
      artifacts: [],
      summary: "Shadow replay passed the initial trigger-quality gate.",
      tags: ["shadow"],
    });
    const evidenceBundle = parseRuntimeResearchEvidenceBundleRecord({
      schemaVersion: "v1",
      evidenceBundleId: "evidence_signal_trend_shadow",
      experimentId: "experiment_signal_trend_shadow",
      strategyKey: "trend_following",
      status: "ready_for_review",
      promotionTarget: "paper",
      createdAt: "2026-03-10T14:21:00Z",
      updatedAt: "2026-03-10T14:21:00Z",
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
          capturedAt: "2026-03-10T14:00:00Z",
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
    });
    const backtestReport = parseRuntimeBacktestReport({
      schemaVersion: "v1",
      reportId: "backtest_alloc_dca_report",
      experimentId: "experiment_alloc_dca_backtest",
      strategyKey: "dca",
      status: "completed",
      generatedAt: "2026-03-10T14:21:30.000Z",
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
          capturedAt: "2026-03-10T14:00:00.000Z",
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
      ],
      aggregateMetrics: {
        observationCount: 1,
        tradeCount: 1,
        grossReturnBps: "22.5384",
        netReturnBps: "22.5384",
        totalCostBps: "0.0000",
        winRateBps: 10000,
        maxDrawdownBps: "0.0000",
      },
      aggregateBaselineComparisons: [
        {
          baseline: "flat_cash",
          baselineReturnBps: "0.0000",
          excessReturnBps: "22.5384",
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
      ],
      promotionEligible: true,
      blockingReasons: [],
      summary:
        "Backtest cleared two walk-forward folds for dca with positive aggregate net return.",
      tags: ["backtest", "paper"],
    });
    const reproducibilityBundle =
      parseRuntimeResearchReproducibilityBundleRecord({
        schemaVersion: "v1",
        reproducibilityBundleId: "repro_alloc_dca_backtest",
        experimentId: "experiment_alloc_dca_backtest",
        strategyKey: "dca",
        createdAt: "2026-03-10T14:22:00.000Z",
        updatedAt: "2026-03-10T14:22:00.000Z",
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
            datasetId: "dataset_feature_cache_sol_usdc_market_events",
            snapshotId: "snapshot_2026_03_07_backtest",
            capturedAt: "2026-03-10T14:00:00.000Z",
          },
        ],
        manifest: {
          manifestId: "manifest_alloc_dca_backtest",
          generatedAt: "2026-03-10T14:22:00.000Z",
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
              capturedAt: "2026-03-10T14:00:00.000Z",
            },
          ],
          replayCorpusId: "replay_corpus_sol_usdc_feature_cache",
          venueKey: "jupiter",
          pairSymbol: "SOL/USDC",
          marketType: "spot",
          strategySpecDigest:
            "sha256:1992048eb2efcd762981bd78d6ae7685c39873c4ccb8189681e2003ca8d84bff",
          featureVersions: [
            {
              recordId: "feature_short_return",
              key: "short_return_bps",
              version: "v1",
              updatedAt: "2026-03-10T14:00:00.000Z",
            },
          ],
          regimeVersions: [
            {
              recordId: "regime_short_trend",
              key: "short_trend",
              version: "v1",
              updatedAt: "2026-03-10T14:00:00.000Z",
            },
          ],
          costModel: {
            modelId: "cost_model_jupiter_sol_usdc_spot",
            calibrationId: "calibration_jupiter_sol_usdc_spot_seed",
            updatedAt: "2026-03-10T14:00:00.000Z",
          },
          backtestConfig: {
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
        },
        expectedResult: {
          reportId: "backtest_alloc_dca_report",
          status: "completed",
          promotionEligible: true,
          aggregateMetrics: {
            observationCount: 1,
            tradeCount: 1,
            grossReturnBps: "22.5384",
            netReturnBps: "22.5384",
            totalCostBps: "0.0000",
            winRateBps: 10000,
            maxDrawdownBps: "0.0000",
          },
          aggregateBaselineComparisons: [
            {
              baseline: "flat_cash",
              baselineReturnBps: "0.0000",
              excessReturnBps: "22.5384",
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
          ],
          blockingReasons: [],
        },
        artifacts: [
          {
            artifactId: "manifest-alloc-dca",
            kind: "reproducibility-manifest",
            uri: "runtime-reproducibility://repro_alloc_dca_backtest",
          },
        ],
        linkedEvidenceBundleIds: ["evidence_signal_trend_shadow"],
        verificationTolerance: {
          maxNetReturnDeltaBps: "0.1000",
          maxTotalCostDeltaBps: "0.1000",
          maxDrawdownDeltaBps: "0.1000",
          maxWinRateDeltaBps: 1,
          maxTradeCountDelta: 0,
        },
        latestVerification: {
          verifiedAt: "2026-03-10T14:23:00.000Z",
          verificationMode: "bounded_tolerance",
          passed: true,
          reportId: "backtest_alloc_dca_report",
          rerunReportId: "backtest_alloc_dca_report",
          netReturnDeltaBps: "0.0000",
          totalCostDeltaBps: "0.0000",
          maxDrawdownDeltaBps: "0.0000",
          winRateDeltaBps: 0,
          tradeCountDelta: 0,
          blockingReasons: [],
        },
        summary: "Reproducibility bundle for the DCA backtest.",
        tags: ["reproducible", "backtest"],
      });
    const strategySpec = parseRuntimeStrategySpec({
      schemaVersion: "v1",
      strategyKey: "trend_following",
      title: "Trend following",
      summary:
        "Follows the short-window return direction from the feature cache.",
      category: "signal",
      pluginKey: "builtin::trend_following",
      defaultLane: "safe",
      supportedModes: ["shadow", "paper", "live"],
      laneEligibility: ["safe", "protected"],
      supportedVenues: [
        {
          venueKey: "jupiter",
          onboardingState: "broad_live_ready",
        },
      ],
      assetConstraints: [
        {
          role: "base",
          assetKeys: [],
          required: true,
        },
        {
          role: "quote",
          assetKeys: ["USDC"],
          required: true,
        },
      ],
      featureRequirements: [
        {
          featureKey: "short_return_bps",
          required: true,
          freshnessMs: 20000,
        },
      ],
      regimeRequirements: ["short_trend"],
      parameterSpecs: [
        {
          key: "policy.max_notional_usd",
          label: "Max notional USD",
          kind: "decimal",
          required: true,
          defaultValue: "25",
          allowedValues: [],
        },
      ],
      promotionPolicy: {
        requiresHumanApproval: true,
        shadowMinRuns: 5,
        paperMinRuns: 7,
        liveLaneAllowlist: ["safe"],
        requiresFreshFeatures: true,
        limitedLiveOnly: true,
      },
      tags: ["builtin", "signal"],
    });
    const venueCapability = parseRuntimeVenueCapability({
      schemaVersion: "v1",
      venueKey: "jupiter",
      displayName: "Jupiter",
      adapterKeys: ["jupiter", "helius_sender", "jito_bundle"],
      marketTypes: ["spot"],
      orderTypes: ["market"],
      authModel: "privy_solana_wallet",
      feeModel: "venue_quote_inclusive",
      precision: {
        priceDecimals: 6,
        sizeDecimals: 9,
        minOrderIncrement: "0.000001",
        minQuoteNotionalUsd: "0.01",
      },
      sizeLimits: {
        minNotionalUsd: "0.01",
      },
      latencyProfile: {
        expectedQuoteMs: 250,
        expectedSubmitMs: 750,
        expectedSettlementMs: 5000,
      },
      settlementBehavior: "swap_atomic",
      supportedModes: ["shadow", "paper", "live"],
      onboardingState: "broad_live_ready",
    });
    const assetRecord = parseRuntimeAssetRecord({
      schemaVersion: "v1",
      assetKey: "SOL",
      displayName: "Solana",
      symbol: "SOL",
      chainKey: "solana-mainnet",
      canonicalId: SOL_MINT,
      assetKind: "native",
      riskClass: "core",
      listingState: "live",
      decimals: 9,
      aliases: ["WSOL"],
      quoteAssetKeys: ["USDC"],
      venueMappings: [
        {
          venueKey: "jupiter",
          nativeId: SOL_MINT,
          venueSymbol: "SOL",
          decimals: 9,
          listingState: "live",
          quoteAssetKeys: ["USDC"],
          priceDecimals: 6,
          sizeDecimals: 9,
          minNotionalUsd: "0.01",
        },
      ],
      createdAt: "2026-03-10T14:00:00Z",
      updatedAt: "2026-03-10T14:00:00Z",
      promotedAt: "2026-03-10T14:00:00Z",
      tags: ["core"],
    });
    const strategyDeskLeg = parseRuntimeStrategyDeskScenarioLeg({
      legId: "leg_spot_alpha",
      label: "Spot alpha",
      role: "primary_alpha",
      venueKey: "jupiter",
      intentFamily: "spot_swap",
      marketType: "spot",
      pair: {
        symbol: "SOL/USDC",
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
      },
      assetKeys: ["SOL", "USDC"],
      enabledModes: ["shadow", "paper", "live"],
      sizing: {
        targetNotionalUsd: "1000",
        maxNotionalUsd: "2500",
        reserveUsd: "1000",
        maxSlippageBps: 50,
      },
      thesis: "Primary directional spot leg.",
      tags: ["alpha", "spot"],
    });
    const strategyDeskScenario = parseRuntimeStrategyDeskScenarioManifest({
      schemaVersion: "v1",
      scenarioId: "desk_sol_composite_1",
      title: "SOL composite desk scenario",
      summary:
        "Composite spot, perp, prediction, and flash scenario staged through the harness.",
      ownerUserId: "user_1",
      strategyKey: "strategy_desk::sol_composite",
      thesis:
        "Pair trend spot exposure with bounded perp hedge, event overlay, and flash rebalancing.",
      sleeveId: "sleeve_1",
      state: "paper_ready",
      createdAt: "2026-03-17T03:00:00Z",
      updatedAt: "2026-03-17T03:05:00Z",
      reviewedAt: "2026-03-17T03:06:00Z",
      latestReportId: "desk_report_sol_composite_paper_1",
      riskLimits: {
        maxReservedCapitalUsd: "1600.00",
        maxGrossExposureUsd: "3500.00",
        maxNetExposureUsd: "1500.00",
        maxLegConcentrationBps: 7000,
        maxVenueFamilyConcentrationBps: 9000,
        maxDrawdownBps: 750,
      },
      researchMatrix: {
        selectionMetric: "excess_vs_flat_cash_bps",
        backtestLegs: [
          {
            legId: "leg_spot_alpha",
            experimentId: "exp_sol_spot",
            replayCorpusId: "replay_sol_usdc",
            venueKey: "jupiter",
            pairSymbol: "SOL/USDC",
            marketType: "spot",
            windowMode: "rolling",
            trainingWindowObservations: 8,
            testingWindowObservations: 4,
            stepObservations: 4,
            purgeObservations: 1,
            baselineStrategies: ["flat_cash", "buy_and_hold"],
          },
          {
            legId: "leg_perp_hedge",
            experimentId: "exp_sol_perp",
            replayCorpusId: "replay_sol_perp",
            venueKey: "drift",
            pairSymbol: "SOL-PERP",
            marketType: "perp",
            windowMode: "rolling",
            trainingWindowObservations: 8,
            testingWindowObservations: 4,
            stepObservations: 4,
            purgeObservations: 1,
            baselineStrategies: ["flat_cash", "buy_and_hold"],
          },
        ],
        windows: [
          {
            windowId: "selection_week_1",
            label: "Selection week 1",
            cohort: "selection",
            windowMode: "rolling",
            trainingWindowObservations: 8,
            testingWindowObservations: 4,
            stepObservations: 4,
            purgeObservations: 1,
          },
          {
            windowId: "holdout_week_1",
            label: "Holdout week 1",
            cohort: "holdout",
            windowMode: "rolling",
            trainingWindowObservations: 8,
            testingWindowObservations: 4,
            stepObservations: 4,
            purgeObservations: 1,
          },
        ],
        variants: [
          {
            variantId: "fast",
            label: "Fast",
            parameterManifest: {
              threshold: "fast",
            },
          },
          {
            variantId: "slow",
            label: "Slow",
            parameterManifest: {
              threshold: "slow",
            },
          },
        ],
      },
      legs: [
        strategyDeskLeg,
        {
          legId: "leg_perp_hedge",
          label: "Perp hedge",
          role: "hedge",
          venueKey: "drift",
          intentFamily: "perp_order",
          marketType: "perp",
          pair: {
            symbol: "SOL-PERP",
            baseMint: SOL_MINT,
            quoteMint: USDC_MINT,
            marketType: "perp",
          },
          instrumentId: "SOL-PERP",
          assetKeys: ["SOL", "USDC"],
          enabledModes: ["shadow", "paper"],
          sizing: {
            targetNotionalUsd: "500",
            maxNotionalUsd: "750",
            reserveUsd: "250",
            maxSlippageBps: 30,
          },
          thesis: "Hedge spot beta when momentum weakens.",
          dependencies: ["leg_spot_alpha"],
          tags: ["hedge", "perp"],
        },
        {
          legId: "leg_prediction_overlay",
          label: "Prediction overlay",
          role: "prediction",
          venueKey: "dflow",
          intentFamily: "prediction_order",
          marketType: "spot",
          instrumentId: "macro-fed-cut-jun-2026",
          assetKeys: ["SOL", "USDC"],
          enabledModes: ["shadow", "paper"],
          sizing: {
            targetNotionalUsd: "150",
            maxNotionalUsd: "250",
            reserveUsd: "100",
            maxSlippageBps: 100,
          },
          thesis: "Event hedge for macro-sensitive weeks.",
          tags: ["overlay", "prediction"],
        },
        {
          legId: "leg_flash_rebalance",
          label: "Flash rebalance",
          role: "flash_rebalance",
          venueKey: "flash_liquidity",
          intentFamily: "flash_atomic",
          marketType: "spot",
          pair: {
            symbol: "SOL/USDC",
            baseMint: SOL_MINT,
            quoteMint: USDC_MINT,
          },
          assetKeys: ["SOL", "USDC"],
          enabledModes: ["shadow", "paper"],
          sizing: {
            targetNotionalUsd: "250",
            maxNotionalUsd: "500",
            reserveUsd: "125",
            maxSlippageBps: 35,
          },
          thesis: "Atomic rebalance path for bounded inventory clean-up.",
          dependencies: ["leg_spot_alpha", "leg_perp_hedge"],
          tags: ["flash", "rebalance"],
        },
      ],
      evidence: [
        {
          stage: "backtest",
          summary: "Walk-forward backtest bundle for the composite thesis.",
          evidenceRefs: [
            {
              kind: "backtest_report",
              ref: "backtest_alloc_dca_report",
            },
          ],
        },
        {
          stage: "paper",
          summary: "Composite paper report and leg receipts.",
          evidenceRefs: [
            {
              kind: "strategy_desk_report",
              ref: "desk_report_sol_composite_paper_1",
            },
          ],
          latestReportId: "desk_report_sol_composite_paper_1",
        },
      ],
      implementationReferences: [
        {
          kind: "issue",
          ref: "#436",
          notes: "Contract-first strategy desk rollout.",
        },
      ],
      tags: ["strategy-desk", "composite"],
    });
    const strategyDeskRun = parseRuntimeStrategyDeskScenarioRun({
      schemaVersion: "v1",
      scenarioRunId: "desk_run_sol_composite_paper_1",
      scenarioId: strategyDeskScenario.scenarioId,
      scenarioState: "paper_ready",
      runKind: "paper",
      state: "completed",
      requestedBy: "user_1",
      trigger: {
        kind: "operator",
        source: "portal.strategy-desk",
        observedAt: "2026-03-17T03:07:00Z",
        reason: "paper validation before operator review",
      },
      createdAt: "2026-03-17T03:07:00Z",
      updatedAt: "2026-03-17T03:08:00Z",
      startedAt: "2026-03-17T03:07:05Z",
      completedAt: "2026-03-17T03:08:00Z",
      legRuns: [
        {
          legId: "leg_spot_alpha",
          stage: "paper",
          state: "completed",
          runtimeDeploymentId: "dep_sol_spot_paper",
          runtimeRunId: "run_sol_spot_paper_1",
        },
        {
          legId: "leg_perp_hedge",
          stage: "paper",
          state: "completed",
          runtimeDeploymentId: "dep_sol_perp_paper",
          runtimeRunId: "run_sol_perp_paper_1",
        },
        {
          legId: "leg_prediction_overlay",
          stage: "paper",
          state: "completed",
          requestRef: "submit_prediction_overlay_1",
        },
        {
          legId: "leg_flash_rebalance",
          stage: "paper",
          state: "skipped",
          notes: "No rebalance required in this paper window.",
        },
      ],
    });
    const strategyDeskReport = parseRuntimeStrategyDeskScenarioReport({
      schemaVersion: "v1",
      reportId: "desk_report_sol_composite_paper_1",
      scenarioId: strategyDeskScenario.scenarioId,
      scenarioRunId: strategyDeskRun.scenarioRunId,
      stage: "paper",
      status: "requires_human_approval",
      summary:
        "Composite paper evidence is sufficient for operator review, but not for self-arming.",
      generatedAt: "2026-03-17T03:08:10Z",
      legOutcomes: [
        {
          legId: "leg_spot_alpha",
          status: "pass",
          netPnlUsd: "42.15",
          costUsd: "6.80",
          evidenceRefs: [
            {
              kind: "runtime_run",
              ref: "run_sol_spot_paper_1",
            },
          ],
        },
        {
          legId: "leg_perp_hedge",
          status: "pass",
          netPnlUsd: "8.25",
          costUsd: "3.10",
          evidenceRefs: [
            {
              kind: "runtime_run",
              ref: "run_sol_perp_paper_1",
            },
          ],
        },
        {
          legId: "leg_prediction_overlay",
          status: "requires_human_approval",
          costUsd: "1.25",
          evidenceRefs: [
            {
              kind: "worker_receipt",
              ref: "submit_prediction_overlay_1",
            },
          ],
          notes: [
            "Prediction leg remains paper-only until readiness improves.",
          ],
        },
      ],
      portfolioSummary: {
        capitalAllocatedUsd: "1375.00",
        grossExposureBudgetUsd: "4000.00",
        equityUsd: "1424.30",
        availableUsd: "774.30",
        reservedUsd: "650.00",
        realizedPnlUsd: "9.10",
        unrealizedPnlUsd: "40.20",
        grossPnlUsd: "61.50",
        netPnlUsd: "49.30",
        grossExposureUsd: "1650.00",
        netExposureUsd: "684.75",
        maxDrawdownBps: 180,
        tradeCount: 11,
        activeLegCount: 2,
        venueExposureUsd: {
          jupiter: "1000.00",
          drift: "500.00",
          dflow: "150.00",
        },
        venueFamilyExposureUsd: {
          spot_swap: "1000.00",
          perp_order: "500.00",
          prediction_order: "150.00",
        },
        marketTypeExposureUsd: {
          spot: "1000.00",
          perp: "500.00",
          prediction: "150.00",
        },
        notes: ["Composite report aggregates harness-side leg evidence."],
      },
      scorecard: {
        aggregate: {
          passedLegCount: 2,
          blockedLegCount: 0,
          skippedLegCount: 0,
          activeLegCount: 2,
          tradeCount: 11,
          reservedCapitalUsd: "650.00",
          grossExposureUsd: "1650.00",
          netExposureUsd: "684.75",
          grossPnlUsd: "61.50",
          netPnlUsd: "49.30",
          totalCostUsd: "11.15",
          maxDrawdownBps: 180,
        },
        legMetrics: [
          {
            legId: "leg_spot_alpha",
            venueKey: "jupiter",
            intentFamily: "spot_swap",
            marketType: "spot",
            status: "pass",
            targetNotionalUsd: "1000.00",
            reservedCapitalUsd: "400.00",
            grossExposureUsd: "1000.00",
            netExposureUsd: "1000.00",
            netPnlUsd: "42.15",
            costUsd: "6.80",
          },
          {
            legId: "leg_perp_hedge",
            venueKey: "drift",
            intentFamily: "perp_order",
            marketType: "perp",
            status: "pass",
            targetNotionalUsd: "500.00",
            reservedCapitalUsd: "250.00",
            grossExposureUsd: "500.00",
            netExposureUsd: "-500.00",
            netPnlUsd: "8.25",
            costUsd: "3.10",
          },
          {
            legId: "leg_prediction_overlay",
            venueKey: "dflow",
            intentFamily: "prediction_order",
            marketType: "prediction",
            status: "requires_human_approval",
            targetNotionalUsd: "150.00",
            costUsd: "1.25",
            notes: [
              "Prediction leg remains paper-only until readiness improves.",
            ],
          },
        ],
      },
      riskOverlays: [
        {
          overlayId: "reserved-capital",
          category: "capital",
          status: "pass",
          observedValue: "650.00",
          thresholdValue: "1600.00",
          message:
            "Reserved capital remains within the configured desk budget.",
        },
        {
          overlayId: "gross-exposure",
          category: "exposure",
          status: "pass",
          observedValue: "1650.00",
          thresholdValue: "3500.00",
          message:
            "Gross exposure remains within the configured composite budget.",
        },
        {
          overlayId: "failure-state-demotion",
          category: "failure_state",
          status: "pass",
          observedValue: "completed",
          thresholdValue: "completed",
          message:
            "Composite execution completed without fail-closed demotion.",
        },
      ],
      studyMatrix: {
        matrixId: "desk_matrix_sol_composite_backtest_1",
        runKind: "backtest",
        selectionMetric: "excess_vs_flat_cash_bps",
        generatedAt: "2026-03-17T03:08:15Z",
        selectedVariantId: "fast",
        windows: [
          {
            windowId: "selection_week_1",
            label: "Selection week 1",
            cohort: "selection",
          },
          {
            windowId: "holdout_week_1",
            label: "Holdout week 1",
            cohort: "holdout",
          },
        ],
        variantSummaries: [
          {
            variantId: "fast",
            label: "Fast",
            parameterManifest: {
              threshold: "fast",
            },
            selectionWindowCount: 1,
            holdoutWindowCount: 1,
            selectionMetrics: {
              observationCount: 8,
              tradeCount: 5,
              grossReturnBps: "75.0000",
              netReturnBps: "60.0000",
              totalCostBps: "15.0000",
              winRateBps: 5000,
              maxDrawdownBps: "45.0000",
            },
            selectionBaselineComparisons: [
              {
                baseline: "flat_cash",
                baselineReturnBps: "0.0000",
                excessReturnBps: "60.0000",
              },
            ],
            holdoutMetrics: {
              observationCount: 8,
              tradeCount: 4,
              grossReturnBps: "18.0000",
              netReturnBps: "10.0000",
              totalCostBps: "8.0000",
              winRateBps: 5000,
              maxDrawdownBps: "32.0000",
            },
            holdoutBaselineComparisons: [
              {
                baseline: "flat_cash",
                baselineReturnBps: "0.0000",
                excessReturnBps: "10.0000",
              },
            ],
          },
        ],
        cells: [
          {
            cellId: "fast:selection_week_1",
            variantId: "fast",
            variantLabel: "Fast",
            windowId: "selection_week_1",
            windowLabel: "Selection week 1",
            cohort: "selection",
            status: "completed",
            legResults: [
              {
                legId: "leg_spot_alpha",
                reportId: "backtest_fast_selection_spot",
                reproducibilityBundleId: "repro_backtest_fast_selection_spot",
                status: "completed",
                metrics: {
                  observationCount: 4,
                  tradeCount: 3,
                  grossReturnBps: "90.0000",
                  netReturnBps: "70.0000",
                  totalCostBps: "20.0000",
                  winRateBps: 5000,
                  maxDrawdownBps: "45.0000",
                },
                baselineComparisons: [
                  {
                    baseline: "flat_cash",
                    baselineReturnBps: "0.0000",
                    excessReturnBps: "70.0000",
                  },
                ],
              },
            ],
            aggregateMetrics: {
              observationCount: 4,
              tradeCount: 3,
              grossReturnBps: "90.0000",
              netReturnBps: "70.0000",
              totalCostBps: "20.0000",
              winRateBps: 5000,
              maxDrawdownBps: "45.0000",
            },
            aggregateBaselineComparisons: [
              {
                baseline: "flat_cash",
                baselineReturnBps: "0.0000",
                excessReturnBps: "70.0000",
              },
            ],
          },
        ],
      },
      evidence: strategyDeskScenario.evidence,
      checks: [
        {
          checkId: "paper-scorecards",
          status: "pass",
          observedValue: "3/4 legs cleared paper gates",
          thresholdValue: "all live-eligible legs must pass",
          message: "Paper evidence is sufficient for operator review.",
        },
      ],
      approvals: [],
    });
    const strategyDeskHandoff = parseRuntimeStrategyDeskPromotionHandoff({
      schemaVersion: "v1",
      handoffId: "desk_handoff_sol_composite_live_1",
      scenarioId: strategyDeskScenario.scenarioId,
      currentState: "operator_review",
      targetMode: "limited_live",
      status: "awaiting_review",
      summary:
        "Bound the spot alpha leg to limited live while keeping the hedge and prediction overlay off the live allowlist.",
      requestedBy: "user_1",
      createdAt: "2026-03-17T03:09:00Z",
      updatedAt: "2026-03-17T03:09:00Z",
      implementationReference: {
        kind: "issue",
        ref: "#436",
      },
      evidenceRefs: [
        {
          kind: "strategy_desk_report",
          ref: strategyDeskReport.reportId,
        },
      ],
      checks: [
        {
          checkId: "limited-live-human-approval",
          status: "requires_human_approval",
          message:
            "Limited-live promotion remains human-gated even when the desk report is green.",
        },
      ],
      approvals: [],
      bindings: [
        {
          bindingId: "binding_spot_alpha_live",
          bindingKind: "runtime_deployment",
          legIds: ["leg_spot_alpha"],
          venueKey: "jupiter",
          pair: {
            symbol: "SOL/USDC",
            baseMint: SOL_MINT,
            quoteMint: USDC_MINT,
          },
          targetMode: "limited_live",
          deploymentId: "dep_sol_spot_limited_live",
          lane: "safe",
        },
        {
          bindingId: "binding_perp_hedge_recipe",
          bindingKind: "worker_execution_recipe",
          legIds: ["leg_perp_hedge"],
          venueKey: "drift",
          instrumentId: "SOL-PERP",
          targetMode: "paper",
          notes:
            "Perp hedge remains bounded to paper during the first live canary.",
        },
        {
          bindingId: "binding_prediction_control",
          bindingKind: "subject_control",
          legIds: ["leg_prediction_overlay"],
          venueKey: "dflow",
          instrumentId: "macro-fed-cut-jun-2026",
          targetMode: "paper",
          notes:
            "Prediction overlay is intentionally excluded from live arming.",
        },
      ],
      actions: [
        {
          actionId: "record-desk-state",
          actionType: "record_state_transition",
          summary: "Move scenario into operator review before arming.",
          required: true,
        },
        {
          actionId: "upsert-limited-live-deployment",
          actionType: "upsert_runtime_deployment",
          summary:
            "Create or update the bounded Jupiter deployment for the spot leg.",
          required: true,
        },
      ],
    });

    expect(run.state).toBe("planned");
    expect(ledger.totals.availableUsd).toBe("95");
    expect(verdict.verdict).toBe("allow");
    expect(plan.ownerUserId).toBe("user_1");
    expect(plan.sleeveId).toBe("sleeve_1");
    expect(plan.slices).toHaveLength(1);
    expect(reconciliation.status).toBe("passed");
    expect(hypothesis.status).toBe("candidate");
    expect(sourceRecord.sourceKind).toBe("paper");
    expect(datasetSnapshot.datasetKind).toBe("market_events");
    expect(replayCorpus.replayKind).toBe("feed_gateway_v1");
    expect(costModel.marketType).toBe("spot");
    expect(costModel.calibration.calibrationId).toBe(
      "calibration_jupiter_sol_usdc_spot_seed",
    );
    expect(costModel.driftGuard.maxCostDriftBps).toBe(90);
    expect(costObservation.costDriftBps).toBe(80);
    expect(featureDefinition.featureKey).toBe("short_return_bps");
    expect(regimeTag.regimeKey).toBe("long_trend");
    expect(experiment.datasetSnapshots).toHaveLength(1);
    expect(evidenceBundle.promotionTarget).toBe("paper");
    expect(reproducibilityBundle.expectedResult.reportId).toBe(
      "backtest_alloc_dca_report",
    );
    expect(backtestReport.promotionEligible).toBe(true);
    expect(backtestReport.config.windowMode).toBe("rolling");
    expect(venueCapability.adapterKeys).toContain("jupiter");
    expect(assetRecord.venueMappings[0]?.venueKey).toBe("jupiter");
    expect(strategySpec.pluginKey).toBe("builtin::trend_following");
    expect(strategyDeskLeg.legId).toBe("leg_spot_alpha");
    expect(strategyDeskScenario.legs).toHaveLength(4);
    expect(strategyDeskScenario.state).toBe("paper_ready");
    expect(strategyDeskRun.runKind).toBe("paper");
    expect(strategyDeskReport.status).toBe("requires_human_approval");
    expect(strategyDeskHandoff.bindings[0]?.bindingKind).toBe(
      "runtime_deployment",
    );
    expect(strategyDeskHandoff.targetMode).toBe("limited_live");
  });

  test("rejects an execution plan without slices", () => {
    const result = safeParseRuntimeExecutionPlan({
      schemaVersion: "v1",
      planId: "plan_1",
      deploymentId: "dep_1",
      venueKey: "jupiter",
      runId: "run_1",
      createdAt: "2026-03-07T18:05:02Z",
      mode: "shadow",
      lane: "safe",
      idempotencyKey: "dep_1:run_1",
      simulateOnly: true,
      dryRun: true,
      slices: [],
    });

    expect(result.success).toBe(false);
  });

  test("defines explicit deployment and run transitions", () => {
    expect(canTransitionRuntimeDeploymentState("draft", "shadow")).toBe(true);
    expect(canTransitionRuntimeDeploymentState("live", "draft")).toBe(false);
    expect(canTransitionRuntimeRunState("pending", "risk_checked")).toBe(true);
    expect(canTransitionRuntimeRunState("completed", "planned")).toBe(false);
    expect(
      canTransitionRuntimeStrategyDeskScenarioState(
        "paper_ready",
        "operator_review",
      ),
    ).toBe(true);
    expect(
      canTransitionRuntimeStrategyDeskScenarioState(
        "execution_ready",
        "paper_ready",
      ),
    ).toBe(true);
    expect(
      canTransitionRuntimeStrategyDeskScenarioState(
        "execution_bound",
        "paper_ready",
      ),
    ).toBe(false);
    expect(
      canTransitionRuntimeStrategyDeskRunState(
        "legs_running",
        "collecting_evidence",
      ),
    ).toBe(true);
    expect(
      canTransitionRuntimeStrategyDeskRunState("completed", "legs_requested"),
    ).toBe(false);
    expect(
      canTransitionRuntimeStrategyDeskPromotionHandoffState(
        "awaiting_review",
        "approved",
      ),
    ).toBe(true);
    expect(
      canTransitionRuntimeStrategyDeskPromotionHandoffState(
        "applied",
        "approved",
      ),
    ).toBe(false);
    expect(RUNTIME_DEPLOYMENT_STATE_TRANSITIONS.archived).toEqual([]);
    expect(RUNTIME_RUN_STATE_TRANSITIONS.failed).toEqual([]);
    expect(RUNTIME_STRATEGY_DESK_SCENARIO_STATE_TRANSITIONS.archived).toEqual(
      [],
    );
    expect(RUNTIME_STRATEGY_DESK_RUN_STATE_TRANSITIONS.completed).toEqual([]);
    expect(
      RUNTIME_STRATEGY_DESK_PROMOTION_HANDOFF_STATE_TRANSITIONS.archived,
    ).toEqual([]);
  });

  test("accepts anchored runtime backtest reports", () => {
    const report = parseRuntimeBacktestReport({
      schemaVersion: "v1",
      reportId: "backtest_anchored_report",
      experimentId: "experiment_anchored",
      strategyKey: "strategy_desk::sol_composite",
      status: "completed",
      generatedAt: "2026-03-17T05:00:00.000Z",
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
          snapshotId: "snapshot_2026_03_17_backtest",
          capturedAt: "2026-03-17T05:00:00.000Z",
        },
      ],
      strategySpecDigest: "sha256:anchored-report",
      config: {
        replayCorpusId: "replay_corpus_sol_usdc_feature_cache",
        venueKey: "jupiter",
        pairSymbol: "SOL/USDC",
        marketType: "spot",
        windowMode: "anchored",
        trainingWindowObservations: 8,
        testingWindowObservations: 4,
        stepObservations: 4,
        purgeObservations: 1,
        baselineStrategies: ["flat_cash", "buy_and_hold"],
      },
      foldReports: [
        {
          foldId: "fold_0",
          foldIndex: 0,
          trainingStartAt: "2026-03-10T00:00:00Z",
          trainingEndAt: "2026-03-16T23:55:00Z",
          testStartAt: "2026-03-16T23:55:00Z",
          testEndAt: "2026-03-17T05:00:00Z",
          trainObservationCount: 8,
          purgedObservationCount: 1,
          testObservationCount: 4,
          metrics: {
            observationCount: 4,
            tradeCount: 2,
            grossReturnBps: "18.0000",
            netReturnBps: "12.0000",
            totalCostBps: "6.0000",
            winRateBps: 5000,
            maxDrawdownBps: "5.0000",
          },
          baselineComparisons: [
            {
              baseline: "flat_cash",
              baselineReturnBps: "0.0000",
              excessReturnBps: "12.0000",
            },
          ],
          regimeMetrics: [],
        },
      ],
      aggregateMetrics: {
        observationCount: 4,
        tradeCount: 2,
        grossReturnBps: "18.0000",
        netReturnBps: "12.0000",
        totalCostBps: "6.0000",
        winRateBps: 5000,
        maxDrawdownBps: "5.0000",
      },
      aggregateBaselineComparisons: [
        {
          baseline: "flat_cash",
          baselineReturnBps: "0.0000",
          excessReturnBps: "12.0000",
        },
      ],
      aggregateRegimeMetrics: [],
      promotionEligible: true,
      blockingReasons: [],
      summary: "Anchored study report.",
      tags: ["anchored"],
    });

    expect(report.config.windowMode).toBe("anchored");
  });

  test("rejects duplicate strategy desk research matrix ids", () => {
    expect(() =>
      parseRuntimeStrategyDeskScenarioManifest({
        schemaVersion: "v1",
        scenarioId: "desk_sol_composite_duplicates",
        title: "Duplicate matrix ids",
        summary: "Ensure malformed study matrices fail closed.",
        ownerUserId: "user_1",
        strategyKey: "strategy_desk::sol_composite",
        thesis: "Duplicate ids should never be accepted.",
        state: "replay_ready",
        createdAt: "2026-03-17T03:00:00Z",
        updatedAt: "2026-03-17T03:05:00Z",
        researchMatrix: {
          selectionMetric: "excess_vs_flat_cash_bps",
          backtestLegs: [
            {
              legId: "leg_spot_alpha",
              experimentId: "exp_sol_spot",
              replayCorpusId: "replay_sol_usdc",
              venueKey: "jupiter",
              pairSymbol: "SOL/USDC",
              marketType: "spot",
              windowMode: "rolling",
              trainingWindowObservations: 8,
              testingWindowObservations: 4,
              stepObservations: 4,
              purgeObservations: 1,
              baselineStrategies: ["flat_cash", "buy_and_hold"],
            },
            {
              legId: "leg_spot_alpha",
              experimentId: "exp_sol_spot_alt",
              replayCorpusId: "replay_sol_usdc",
              venueKey: "jupiter",
              pairSymbol: "SOL/USDC",
              marketType: "spot",
              windowMode: "rolling",
              trainingWindowObservations: 8,
              testingWindowObservations: 4,
              stepObservations: 4,
              purgeObservations: 1,
              baselineStrategies: ["flat_cash", "buy_and_hold"],
            },
          ],
          windows: [
            {
              windowId: "selection_week_1",
              label: "Selection week 1",
              cohort: "selection",
              windowMode: "rolling",
              trainingWindowObservations: 8,
              testingWindowObservations: 4,
              stepObservations: 4,
              purgeObservations: 1,
            },
          ],
          variants: [
            {
              variantId: "fast",
              label: "Fast",
              parameterManifest: {
                threshold: "fast",
              },
            },
            {
              variantId: "fast",
              label: "Fast duplicate",
              parameterManifest: {
                threshold: "slow",
              },
            },
          ],
        },
        legs: [
          {
            legId: "leg_spot_alpha",
            label: "Spot alpha",
            role: "primary_alpha",
            venueKey: "jupiter",
            intentFamily: "spot_swap",
            marketType: "spot",
            pair: {
              symbol: "SOL/USDC",
              baseMint: SOL_MINT,
              quoteMint: USDC_MINT,
            },
            assetKeys: ["SOL", "USDC"],
            enabledModes: ["shadow", "paper"],
            sizing: {
              targetNotionalUsd: "1000",
              maxNotionalUsd: "2500",
              reserveUsd: "1000",
              maxSlippageBps: 50,
            },
          },
        ],
        evidence: [],
        implementationReferences: [],
        tags: ["strategy-desk"],
      }),
    ).toThrow("duplicate-backtestLegs-legId:leg_spot_alpha");
  });

  test("generates deterministic JSON schema documents", () => {
    for (const entry of Object.values(RUNTIME_PROTOCOL_SCHEMA_REGISTRY)) {
      const schemaA = z.toJSONSchema(entry.schema);
      const schemaB = z.toJSONSchema(entry.schema);
      expect(schemaA).toEqual(schemaB);
    }
  });
});
