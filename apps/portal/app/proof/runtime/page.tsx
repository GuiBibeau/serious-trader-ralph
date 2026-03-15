"use client";

import { useState } from "react";
import {
  listRuntimeVenueProgramMatrix,
  RUNTIME_VENUE_PROGRAM_NEXT_ISSUES,
} from "../../terminal/runtime/program-matrix";
import { RuntimeOperatorView } from "../../terminal/runtime/runtime-operator-view";
import type { RuntimeOperatorApiPayload } from "../../terminal/runtime/types";

const FIXTURE_TIME = "2026-03-09T14:10:00.000Z";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const DEPLOYMENTS = [
  {
    schemaVersion: "v1",
    deploymentId: "runtime_canary_live_dca",
    strategyKey: "dca",
    sleeveId: "sleeve_runtime_canary",
    ownerUserId: "user_operator",
    pair: {
      symbol: "SOL/USDC",
      baseMint: SOL_MINT,
      quoteMint: USDC_MINT,
    },
    venueKey: "jupiter",
    mode: "live",
    state: "live",
    lane: "safe",
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    promotedAt: FIXTURE_TIME,
    pausedAt: undefined,
    killedAt: undefined,
    policy: {
      maxNotionalUsd: "5.00",
      dailyLossLimitUsd: "25.00",
      maxSlippageBps: 50,
      maxConcurrentRuns: 1,
      rebalanceToleranceBps: 100,
    },
    capital: {
      allocatedUsd: "25.00",
      reservedUsd: "5.00",
      availableUsd: "20.00",
    },
    tags: ["runtime-canary", "proof"],
  },
  {
    schemaVersion: "v1",
    deploymentId: "deployment_mean_reversion_paper",
    strategyKey: "mean_reversion",
    sleeveId: "sleeve_beta",
    ownerUserId: "user_operator",
    pair: {
      symbol: "SOL/USDC",
      baseMint: SOL_MINT,
      quoteMint: USDC_MINT,
    },
    venueKey: "jupiter",
    mode: "paper",
    state: "paper",
    lane: "safe",
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    promotedAt: FIXTURE_TIME,
    pausedAt: undefined,
    killedAt: undefined,
    policy: {
      maxNotionalUsd: "40.00",
      dailyLossLimitUsd: "60.00",
      maxSlippageBps: 50,
      maxConcurrentRuns: 2,
      rebalanceToleranceBps: 80,
    },
    capital: {
      allocatedUsd: "320.00",
      reservedUsd: "40.00",
      availableUsd: "280.00",
    },
    tags: ["managed-template", "proof"],
  },
] as const;

function buildPayload(selectedDeploymentId: string): RuntimeOperatorApiPayload {
  const deployment =
    DEPLOYMENTS.find(
      (candidate) => candidate.deploymentId === selectedDeploymentId,
    ) ?? DEPLOYMENTS[0];
  return {
    ok: true,
    runtime: {
      ok: true,
      source: "proof-fixture",
      integration: {
        stubModeEnabled: false,
        runtimeBaseUrl: "https://ralph-runtime-rs.fly.dev",
      },
      health: {
        status: "healthy",
        feedGateway: {
          maxMarketAgeMs: 2100,
        },
        featureCache: {
          maxFeatureAgeMs: 2600,
        },
      },
      routes: {
        health: "/api/internal/runtime/health",
        deployments: "/api/internal/runtime/deployments",
        research: "/api/internal/runtime/research",
      },
      deployments: [...DEPLOYMENTS],
      controls: {
        enabled: true,
        disabledReason: null,
        shadowOnly: false,
        shadowOnlyReason: null,
      },
      canary: {
        ok: true,
        state: {
          disabled: false,
          disabledReason: null,
        },
        latestRuns: [
          {
            status: "success",
            reconciliationStatus: "passed",
          },
        ],
      },
      leaderboard: {
        generatedAt: FIXTURE_TIME,
        entryCount: 1,
        entries: [
          {
            candidateId: "trend_following::jupiter::SOL/USDC::spot",
            strategyKey: "trend_following",
            pairSymbol: "SOL/USDC",
            netReturnBps: "11.1667",
            flatCashExcessReturnBps: "11.1667",
            significanceConfidenceBps: 9200,
            promotionGateStatus: "pass",
            summary:
              "Trend following candidate cleared significance and robustness gates.",
          },
        ],
      },
      error: null,
    },
    program: {
      matrix: listRuntimeVenueProgramMatrix(),
      nextIssueOrder: [...RUNTIME_VENUE_PROGRAM_NEXT_ISSUES],
    },
    selectedDeploymentId: deployment.deploymentId,
    detail: {
      deploymentId: deployment.deploymentId,
      deployment: { ...deployment },
      runs: [
        {
          schemaVersion: "v1",
          runId: `run_${deployment.deploymentId}`,
          deploymentId: deployment.deploymentId,
          runKey: `${deployment.deploymentId}:${FIXTURE_TIME}`,
          trigger: {
            kind: "signal",
            source: "proof-page",
            observedAt: FIXTURE_TIME,
            reason: "browser-proof",
          },
          state: deployment.mode === "live" ? "completed" : "planned",
          plannedAt: FIXTURE_TIME,
          updatedAt: FIXTURE_TIME,
          riskVerdictId: `risk_${deployment.deploymentId}`,
          executionPlanId: `plan_${deployment.deploymentId}`,
          submitRequestId:
            deployment.mode === "live"
              ? `submit_${deployment.deploymentId}`
              : undefined,
          receiptId:
            deployment.mode === "live"
              ? `receipt_${deployment.deploymentId}`
              : undefined,
          failureCode: undefined,
          failureMessage: undefined,
        },
      ],
      allocator: {
        currentDecision: {
          deploymentId: deployment.deploymentId,
          grantedAllocatedUsd: deployment.capital.allocatedUsd,
          grantedReservedUsd: deployment.capital.reservedUsd,
          priorityRank: deployment.mode === "live" ? 1 : 2,
          constrained: false,
        },
        decisions: [
          {
            deploymentId: deployment.deploymentId,
            grantedAllocatedUsd: deployment.capital.allocatedUsd,
            grantedReservedUsd: deployment.capital.reservedUsd,
            priorityRank: deployment.mode === "live" ? 1 : 2,
            constrained: false,
          },
        ],
        sleeve: {
          sleeveId: deployment.sleeveId,
          equityUsd: deployment.mode === "live" ? "25.00" : "320.00",
          reservedUsd: deployment.capital.reservedUsd,
          availableUsd: deployment.capital.availableUsd,
        },
      },
      positions: {
        schemaVersion: "v1",
        snapshotId: `ledger_${deployment.deploymentId}`,
        deploymentId: deployment.deploymentId,
        sleeveId: deployment.sleeveId,
        asOf: FIXTURE_TIME,
        balances: [
          {
            mint: USDC_MINT,
            symbol: "USDC",
            decimals: 6,
            freeAtomic: "20000000",
            reservedAtomic: "5000000",
            priceUsd: "1.00",
          },
          {
            mint: SOL_MINT,
            symbol: "SOL",
            decimals: 9,
            freeAtomic: "1058167243",
            reservedAtomic: "0",
            priceUsd: "171.20",
          },
        ],
        positions: [
          {
            instrumentId: "SOL/USDC",
            side: "long",
            quantityAtomic: "31500000",
            entryPriceUsd: "168.40",
            markPriceUsd: "171.20",
            unrealizedPnlUsd: "0.88",
          },
        ],
        totals: {
          equityUsd: deployment.capital.allocatedUsd,
          reservedUsd: deployment.capital.reservedUsd,
          availableUsd: deployment.capital.availableUsd,
          realizedPnlUsd: "1.72",
          unrealizedPnlUsd: "0.88",
        },
      },
      pnl: {
        asOf: FIXTURE_TIME,
        totals: {
          equityUsd: deployment.capital.allocatedUsd,
          reservedUsd: deployment.capital.reservedUsd,
          availableUsd: deployment.capital.availableUsd,
          realizedPnlUsd: "1.72",
          unrealizedPnlUsd: "0.88",
        },
      },
      scorecard: {
        deploymentId: deployment.deploymentId,
        generatedAt: FIXTURE_TIME,
        scorecard: {
          triggerQuality: {
            totalRuns: 4,
          },
        },
        promotionGates: [
          {
            targetMode: deployment.mode === "live" ? "live" : "paper",
            status: deployment.mode === "live" ? "pass" : "blocked",
            summary:
              deployment.mode === "live"
                ? "Bounded live canary remains healthy."
                : "Paper deployment still waiting on live approval.",
          },
        ],
      },
      lab: {
        research: {
          hypotheses: [
            {
              hypothesisId: "hyp_trend_following_sol",
              strategyKey: "trend_following",
              title: "Trend following on SOL/USDC",
              thesis:
                "Momentum persistence remains durable during healthy liquidity regimes.",
              status: "candidate",
              createdAt: FIXTURE_TIME,
              updatedAt: FIXTURE_TIME,
            },
          ],
          sources: [
            {
              sourceId: "src_trend_following_paper",
              sourceKind: "paper",
              title: "Interpretable momentum signal study",
              canonicalUrl: "https://research.example.com/momentum",
              retrievedAt: FIXTURE_TIME,
              publishedAt: FIXTURE_TIME,
            },
          ],
          experiments: [
            {
              experimentId: "exp_trend_following_sol",
              status: "completed",
              summary:
                "Walk-forward replay beat flat cash and held significance across volatile windows.",
              updatedAt: FIXTURE_TIME,
              completedAt: FIXTURE_TIME,
            },
          ],
          evidenceBundles: [
            {
              evidenceBundleId: "bundle_trend_following_shadow",
              status: "approved",
              promotionTarget: "paper",
              summary:
                "Shadow and paper bundle includes backtest, replay, and reconciliation artifacts.",
            },
          ],
          reproducibilityBundles: [
            {
              reproducibilityBundleId: "repro_trend_following_shadow",
              summary:
                "Backtest rerun matched the stored report within configured tolerances.",
              updatedAt: FIXTURE_TIME,
              latestVerification: {
                status: "pass",
              },
            },
          ],
          error: null,
        },
        promotions: {
          strategy: [
            {
              promotionId: "promotion_strategy_shadow",
              currentState: "draft",
              targetState: "shadow",
              status: "applied",
              summary:
                "Candidate implementation merged and activated in shadow.",
              requestedBy: "operator@example.com",
              updatedAt: FIXTURE_TIME,
            },
          ],
          venue: [
            {
              promotionId: "promotion_venue_limited_live",
              currentState: "paper_ready",
              targetState: "limited_live_ready",
              status: "requires_human_approval",
              summary:
                "Venue readiness cleared all automated checks and awaits approval.",
              requestedBy: "operator@example.com",
              updatedAt: FIXTURE_TIME,
            },
          ],
          asset: [
            {
              promotionId: "promotion_asset_limited_live",
              currentState: "paper_ready",
              targetState: "limited_live_ready",
              status: "pass",
              summary:
                "Asset controls, cost drift, and bounded canary are all within guardrails.",
              requestedBy: "operator@example.com",
              updatedAt: FIXTURE_TIME,
            },
          ],
          error: null,
        },
        readiness: {
          venue: {
            subjectKind: "venue",
            subjectKey: "jupiter",
            artifacts: [
              {
                readinessId: "readiness_jupiter",
                targetState: "limited_live_ready",
                status: "pass",
                summary:
                  "Venue readiness checks passed with a bounded canary plan.",
                canaryRunId: "readycanary_jupiter_sol",
              },
            ],
            controls: [
              {
                liveAllowed: true,
                killSwitchEnabled: false,
                updatedAt: FIXTURE_TIME,
              },
            ],
            canaryRuns: [
              {
                runId: "readycanary_jupiter_sol",
                status: "success",
                updatedAt: FIXTURE_TIME,
              },
            ],
            canaryState: {
              updatedAt: FIXTURE_TIME,
            },
            error: null,
          },
          asset: {
            subjectKind: "asset",
            subjectKey: "SOL",
            artifacts: [
              {
                readinessId: "readiness_sol",
                targetState: "limited_live_ready",
                status: "pass",
                summary:
                  "Asset readiness checks passed with live controls staged.",
                canaryRunId: "readycanary_sol",
              },
            ],
            controls: [
              {
                liveAllowed: true,
                killSwitchEnabled: false,
                updatedAt: FIXTURE_TIME,
              },
            ],
            canaryRuns: [
              {
                runId: "readycanary_sol",
                status: "success",
                updatedAt: FIXTURE_TIME,
              },
            ],
            canaryState: {
              updatedAt: FIXTURE_TIME,
            },
            error: null,
          },
        },
      },
    },
    detailError: null,
  };
}

export default function RuntimeProofPage() {
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string>(
    DEPLOYMENTS[0].deploymentId,
  );
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [payload, setPayload] = useState<RuntimeOperatorApiPayload>(() =>
    buildPayload(DEPLOYMENTS[0].deploymentId),
  );

  function updateDeploymentState(nextState: "paused" | "live" | "killed") {
    const nextPayload = buildPayload(selectedDeploymentId);
    if (nextPayload.detail?.deployment) {
      nextPayload.detail.deployment.state = nextState;
    }
    setPayload(nextPayload);
  }

  return (
    <main data-testid="runtime-operator-proof-page">
      <RuntimeOperatorView
        authenticated
        loading={false}
        error={null}
        payload={payload}
        actionPending={actionPending}
        onRefresh={() => setPayload(buildPayload(selectedDeploymentId))}
        onSelectDeployment={(deploymentId) => {
          setSelectedDeploymentId(deploymentId);
          setPayload(buildPayload(deploymentId));
        }}
        onControl={(action) => {
          setActionPending(action);
          if (action === "pause") updateDeploymentState("paused");
          if (action === "resume") updateDeploymentState("live");
          if (action === "kill") updateDeploymentState("killed");
          window.setTimeout(() => setActionPending(null), 50);
        }}
        onSubjectControl={(input) => {
          setActionPending(
            `subject-control:${input.subjectKind}:${input.subjectKey}:${
              input.killSwitchEnabled === true
                ? "kill-on"
                : input.killSwitchEnabled === false
                  ? "kill-off"
                  : input.liveAllowed === true
                    ? "live-on"
                    : "live-off"
            }`,
          );
          window.setTimeout(() => setActionPending(null), 50);
        }}
        onReadinessCanary={(input) => {
          setActionPending(
            `readiness-canary:${input.subjectKind}:${input.subjectKey}`,
          );
          window.setTimeout(() => setActionPending(null), 50);
        }}
      />
    </main>
  );
}
