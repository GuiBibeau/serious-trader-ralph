import { describe, expect, test } from "bun:test";
import { buildRuntimeResearchPostLiveReview } from "../../src/runtime/research/post_live.js";

describe("runtime research post-live review", () => {
  test("keeps a healthy limited-live strategy in observe mode", () => {
    const { artifact } = buildRuntimeResearchPostLiveReview({
      request: {
        subjectKind: "strategy",
        subjectKey: "candidate_trend_following_jupiter_sol_usdc",
        requestedBy: "codex",
        currentState: "limited_live",
        deploymentId: "dep_trend_following_sol_usdc_limited_live",
        venueKey: "jupiter",
        assetKey: "SOL",
        pairSymbol: "SOL/USDC",
        thresholds: {
          maxFailedRunRateBps: 2500,
          maxManualReviewRateBps: 1000,
          maxDriftAlertCount: 0,
          maxCostDriftBps: 90,
          maxLatencyDriftMs: 8000,
          maxFeatureAgeMs: 20000,
        },
      },
      context: {
        scorecard: {
          deploymentId: "dep_trend_following_sol_usdc_limited_live",
          failedRunCount: 0,
          manualReviewRunCount: 0,
          driftAlertCount: 0,
          totalPnlUsd: "1.25",
          maxDrawdownUsd: "0.40",
          costDriftBps: 10,
          latencyDriftMs: 200,
          maxObservedFeatureAgeMs: 500,
          freshnessSloMs: 20000,
          featureDefinitionCoverageBps: 10000,
          regimeTagCoverageBps: 10000,
          missingFeatureKeys: [],
          missingRegimeKeys: [],
        },
        latestCostModel: {
          schemaVersion: "v1",
          modelId: "cost_model_jupiter_sol_usdc_spot",
          venueKey: "jupiter",
          marketType: "spot",
          pairSymbol: "SOL/USDC",
          assetKeys: ["SOL", "USDC"],
          modeCoverage: ["shadow", "paper", "live"],
          status: "active",
          assumptions: {
            feeBps: 8,
            slippageBps: 22,
            marketImpactBps: 12,
            partialFillRateBps: 50,
            partialFillPenaltyBps: 15,
          },
          calibration: {
            calibrationId: "calibration_jupiter_sol_usdc_spot_seed",
            methodology: "fixture",
            sampleStartAt: "2026-03-10T00:00:00.000Z",
            sampleEndAt: "2026-03-11T00:00:00.000Z",
            sampleCount: 12,
            confidenceBps: 9000,
            referenceNotionalUsd: "25.00",
            tags: ["fixture"],
          },
          driftGuard: {
            maxCostDriftBps: 90,
            maxLatencyDriftMs: 8000,
            maxReconciliationDriftUsd: "1.00",
          },
          latencyProfile: "retail",
          datasetSnapshots: [
            {
              datasetId: "dataset_1",
              snapshotId: "snapshot_1",
              capturedAt: "2026-03-10T00:00:00.000Z",
              uri: "repo://fixture",
              contentDigest: "sha256:fixture",
            },
          ],
          createdAt: "2026-03-10T00:00:00.000Z",
          updatedAt: "2026-03-11T00:00:00.000Z",
          tags: ["fixture"],
        },
        venueControl: {
          schemaVersion: "v1",
          subjectKind: "venue",
          subjectKey: "jupiter",
          liveAllowed: true,
          killSwitchEnabled: false,
          updatedAt: "2026-03-11T00:00:00.000Z",
        },
        assetControl: {
          schemaVersion: "v1",
          subjectKind: "asset",
          subjectKey: "SOL",
          liveAllowed: true,
          killSwitchEnabled: false,
          updatedAt: "2026-03-11T00:00:00.000Z",
        },
      },
    });

    expect(artifact.status).toBe("pass");
    expect(artifact.recommendedAction).toBe("observe");
    expect(artifact.checks.every((check) => check.status === "pass")).toBe(
      true,
    );
  });

  test("recommends disabling a subject when asset drift is injected", () => {
    const { artifact } = buildRuntimeResearchPostLiveReview({
      request: {
        subjectKind: "asset",
        subjectKey: "JUP",
        requestedBy: "codex",
        currentState: "limited_live_ready",
        venueKey: "jupiter",
        assetKey: "JUP",
        pairSymbol: "JUP/USDC",
        externalChecks: [
          {
            checkId: "asset-event-freeze-authority",
            status: "blocked",
            message: "Asset event feed reported a freeze-authority change.",
          },
        ],
      },
      context: {
        assetControl: {
          schemaVersion: "v1",
          subjectKind: "asset",
          subjectKey: "JUP",
          liveAllowed: true,
          killSwitchEnabled: false,
          updatedAt: "2026-03-11T00:00:00.000Z",
        },
        latestReadinessArtifact: {
          schemaVersion: "v1",
          readinessId: "readiness_jup_asset",
          subjectKind: "asset",
          subjectKey: "JUP",
          targetState: "limited_live_ready",
          status: "pass",
          summary: "JUP onboarding readiness remains healthy.",
          venueKey: "jupiter",
          assetKey: "JUP",
          checks: [
            {
              checkId: "ready",
              status: "pass",
              message: "ready",
            },
          ],
          evidenceRefs: [],
          createdAt: "2026-03-11T00:00:00.000Z",
          updatedAt: "2026-03-11T00:00:00.000Z",
        },
      },
    });

    expect(artifact.status).toBe("blocked");
    expect(artifact.recommendedAction).toBe("disable_subject");
    expect(
      artifact.checks.some(
        (check) =>
          check.checkId === "asset-event-freeze-authority" &&
          check.status === "blocked",
      ),
    ).toBe(true);
  });
});
