import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  canTransitionRuntimeDeploymentState,
  canTransitionRuntimeRunState,
  parseRuntimeAssetRecord,
  parseRuntimeBacktestReport,
  parseRuntimeDeploymentRecord,
  parseRuntimeExecutionCostModelRecord,
  parseRuntimeExecutionCostObservationRecord,
  parseRuntimeExecutionPlan,
  parseRuntimeFeatureDefinitionRecord,
  parseRuntimeHistoricalDatasetSnapshotRecord,
  parseRuntimeLedgerSnapshot,
  parseRuntimeReconciliationResult,
  parseRuntimeRegimeTagRecord,
  parseRuntimeReplayCorpusRecord,
  parseRuntimeResearchEvidenceBundleRecord,
  parseRuntimeResearchExperimentRecord,
  parseRuntimeResearchHypothesisRecord,
  parseRuntimeResearchSourceRecord,
  parseRuntimeRiskVerdict,
  parseRuntimeRunRecord,
  parseRuntimeStrategySpec,
  parseRuntimeVenueCapability,
  RUNTIME_DEPLOYMENT_STATE_TRANSITIONS,
  RUNTIME_PROTOCOL_SCHEMA_REGISTRY,
  RUNTIME_RUN_STATE_TRANSITIONS,
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
    expect(backtestReport.promotionEligible).toBe(true);
    expect(backtestReport.config.windowMode).toBe("rolling");
    expect(venueCapability.adapterKeys).toContain("jupiter");
    expect(assetRecord.venueMappings[0]?.venueKey).toBe("jupiter");
    expect(strategySpec.pluginKey).toBe("builtin::trend_following");
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
    expect(RUNTIME_DEPLOYMENT_STATE_TRANSITIONS.archived).toEqual([]);
    expect(RUNTIME_RUN_STATE_TRANSITIONS.failed).toEqual([]);
  });

  test("generates deterministic JSON schema documents", () => {
    for (const entry of Object.values(RUNTIME_PROTOCOL_SCHEMA_REGISTRY)) {
      const schemaA = z.toJSONSchema(entry.schema);
      const schemaB = z.toJSONSchema(entry.schema);
      expect(schemaA).toEqual(schemaB);
    }
  });
});
