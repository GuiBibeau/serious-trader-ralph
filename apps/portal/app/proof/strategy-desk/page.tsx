"use client";

import { useState } from "react";
import type {
  RuntimeStrategyDeskExecutionRecipe,
  RuntimeStrategyDeskPromotionHandoff,
  RuntimeStrategyDeskPromotionHandoffEvent,
  RuntimeStrategyDeskScenarioManifest,
  RuntimeStrategyDeskScenarioReport,
  RuntimeStrategyDeskScenarioRun,
} from "../../../lib/runtime-strategy-desk";
import { StrategyDeskView } from "../../terminal/strategy-desk/strategy-desk-view";
import type { StrategyDeskApiPayload } from "../../terminal/strategy-desk/types";

const FIXTURE_TIME = "2026-03-17T03:08:10Z";
const WALLET_ADDRESS = "11111111111111111111111111111111";

function scenarioFixture(): RuntimeStrategyDeskScenarioManifest {
  return {
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
    updatedAt: FIXTURE_TIME,
    reviewedAt: "2026-03-17T03:06:00Z",
    latestReportId: "desk_report_sol_composite_paper_1",
    riskLimits: {
      maxReservedCapitalUsd: "1600",
      maxGrossExposureUsd: "3500",
      maxNetExposureUsd: "1500",
    },
    researchMatrix: {
      selectionMetric: "excess_vs_flat_cash_bps",
      backtestLegs: [
        {
          legId: "leg_spot_alpha",
          experimentId: "exp_sol_spot",
          replayCorpusId: "replay_sol_usdc",
        },
      ],
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
      {
        legId: "leg_spot_alpha",
        label: "Spot alpha",
        role: "primary_alpha",
        venueKey: "jupiter",
        intentFamily: "spot_swap",
        marketType: "spot",
        pair: {
          symbol: "SOL/USDC",
          baseMint: "So11111111111111111111111111111111111111112",
          quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          marketType: "spot",
        },
        assetKeys: ["SOL", "USDC"],
        enabledModes: ["shadow", "paper", "live"],
        sizing: {
          targetNotionalUsd: "1000",
          maxNotionalUsd: "2500",
          reserveUsd: "1000",
        },
        intent: {
          side: "buy",
        },
      },
      {
        legId: "leg_perp_hedge",
        label: "Perp hedge",
        role: "hedge",
        venueKey: "drift",
        intentFamily: "perp_order",
        marketType: "perp",
        instrumentId: "SOL-PERP",
        assetKeys: ["SOL", "USDC"],
        enabledModes: ["shadow", "paper"],
        sizing: {
          targetNotionalUsd: "500",
          maxNotionalUsd: "750",
          reserveUsd: "250",
        },
        intent: {
          side: "short",
          quantityAtomic: "3521126760",
        },
      },
      {
        legId: "leg_prediction_overlay",
        label: "Prediction overlay",
        role: "prediction",
        venueKey: "dflow",
        intentFamily: "prediction_order",
        marketType: "prediction",
        instrumentId: "macro-fed-cut-jun-2026",
        assetKeys: ["SOL", "USDC"],
        enabledModes: ["shadow", "paper"],
        sizing: {
          targetNotionalUsd: "150",
          maxNotionalUsd: "250",
          reserveUsd: "100",
        },
      },
    ],
    evidence: [
      {
        stage: "backtest",
        summary: "Walk-forward backtest bundle for the composite thesis.",
      },
      {
        stage: "paper",
        summary: "Composite paper report and leg receipts.",
        latestReportId: "desk_report_sol_composite_paper_1",
      },
    ],
    implementationReferences: [
      {
        kind: "issue",
        ref: "#441",
      },
    ],
    tags: ["strategy-desk", "composite"],
    metadata: {
      operatorWalletAddress: WALLET_ADDRESS,
    },
  };
}

function backtestRunFixture(): RuntimeStrategyDeskScenarioRun {
  return {
    schemaVersion: "v1",
    scenarioRunId: "desk_run_sol_composite_backtest_1",
    scenarioId: "desk_sol_composite_1",
    scenarioState: "paper_ready",
    runKind: "backtest",
    state: "completed",
    requestedBy: "operator_1",
    trigger: {
      kind: "operator",
      source: "portal.strategy-desk",
      observedAt: FIXTURE_TIME,
      reason: "browser-proof-backtest",
    },
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    completedAt: FIXTURE_TIME,
    legRuns: [],
  };
}

function paperRunFixture(): RuntimeStrategyDeskScenarioRun {
  return {
    schemaVersion: "v1",
    scenarioRunId: "desk_run_sol_composite_paper_1",
    scenarioId: "desk_sol_composite_1",
    scenarioState: "paper_ready",
    runKind: "paper",
    state: "completed",
    requestedBy: "operator_1",
    trigger: {
      kind: "operator",
      source: "portal.strategy-desk",
      observedAt: FIXTURE_TIME,
      reason: "browser-proof-paper",
    },
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    completedAt: FIXTURE_TIME,
    legRuns: [],
  };
}

function backtestReportFixture(): RuntimeStrategyDeskScenarioReport {
  return {
    schemaVersion: "v1",
    reportId: "desk_report_sol_composite_backtest_1",
    scenarioId: "desk_sol_composite_1",
    scenarioRunId: "desk_run_sol_composite_backtest_1",
    stage: "backtest",
    status: "pass",
    summary:
      "Backtest matrix selected the fast variant with positive holdout excess.",
    generatedAt: FIXTURE_TIME,
    legOutcomes: [
      {
        legId: "leg_spot_alpha",
        status: "pass",
        evidenceRefs: [],
      },
    ],
    studyMatrix: {
      matrixId: "desk_matrix_sol_composite_backtest_1",
      runKind: "backtest",
      selectionMetric: "excess_vs_flat_cash_bps",
      generatedAt: FIXTURE_TIME,
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
          selectionMetrics: {
            netReturnBps: "60.0000",
          },
          holdoutMetrics: {
            netReturnBps: "10.0000",
          },
          selectionBaselineComparisons: [
            {
              baseline: "flat_cash",
              excessReturnBps: "60.0000",
            },
          ],
        },
        {
          variantId: "slow",
          label: "Slow",
          selectionMetrics: {
            netReturnBps: "34.0000",
          },
          holdoutMetrics: {
            netReturnBps: "4.0000",
          },
          selectionBaselineComparisons: [
            {
              baseline: "flat_cash",
              excessReturnBps: "34.0000",
            },
          ],
        },
      ],
      cells: [
        {
          cellId: "fast:selection_week_1",
          variantId: "fast",
          windowId: "selection_week_1",
          legResults: [
            {
              legId: "leg_spot_alpha",
              reproducibilityBundleId: "repro_backtest_fast_selection_spot_1",
            },
          ],
        },
      ],
    },
    evidence: [
      {
        stage: "backtest",
        summary: "Walk-forward study bundle recorded from the proof route.",
      },
    ],
    checks: [
      {
        checkId: "matrix-generated",
        status: "pass",
        message: "Study matrix completed successfully.",
      },
    ],
    approvals: [],
    riskOverlays: [],
  };
}

function paperReportFixture(): RuntimeStrategyDeskScenarioReport {
  return {
    schemaVersion: "v1",
    reportId: "desk_report_sol_composite_paper_1",
    scenarioId: "desk_sol_composite_1",
    scenarioRunId: "desk_run_sol_composite_paper_1",
    stage: "paper",
    status: "requires_human_approval",
    summary:
      "Composite paper evidence is sufficient for operator review, but not for self-arming.",
    generatedAt: FIXTURE_TIME,
    legOutcomes: [
      {
        legId: "leg_spot_alpha",
        status: "pass",
        netPnlUsd: "42.15",
        costUsd: "6.80",
      },
      {
        legId: "leg_perp_hedge",
        status: "pass",
        netPnlUsd: "8.25",
        costUsd: "3.10",
      },
      {
        legId: "leg_prediction_overlay",
        status: "requires_human_approval",
        costUsd: "1.25",
      },
    ],
    portfolioSummary: {
      netPnlUsd: "49.30",
      grossExposureUsd: "1650.00",
      maxDrawdownBps: 180,
    },
    scorecard: {
      aggregate: {
        tradeCount: 11,
      },
    },
    riskOverlays: [
      {
        overlayId: "reserved-capital",
        status: "pass",
        message: "Reserved capital remains within the configured desk budget.",
      },
      {
        overlayId: "gross-exposure",
        status: "pass",
        message:
          "Gross exposure remains within the configured composite budget.",
      },
    ],
    evidence: [
      {
        stage: "paper",
        summary: "Composite paper report and leg receipts.",
      },
    ],
    checks: [
      {
        checkId: "paper-scorecards",
        status: "pass",
        message: "Paper evidence is sufficient for operator review.",
      },
    ],
    approvals: [],
  };
}

function handoffFixture(
  status: RuntimeStrategyDeskPromotionHandoff["status"] = "draft",
): RuntimeStrategyDeskPromotionHandoff {
  return {
    schemaVersion: "v1",
    handoffId: "desk_handoff_sol_composite_live_1",
    scenarioId: "desk_sol_composite_1",
    currentState: "operator_review",
    targetMode: "limited_live",
    status,
    summary:
      "Bound the spot leg to limited live while keeping the hedge and prediction overlay paper-bound.",
    requestedBy: "operator_1",
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    ...(status === "applied" ? { appliedAt: FIXTURE_TIME } : {}),
    evidenceRefs: [
      {
        kind: "strategy_desk_report",
        ref: "desk_report_sol_composite_paper_1",
      },
    ],
    checks: [
      {
        checkId: "paper-report-pass",
        status: "pass",
        message: "Paper report is green and ready for operator review.",
      },
      {
        checkId: "limited-live-human-approval",
        status: "requires_human_approval",
        message:
          "Limited-live promotion remains human-gated even when the desk report is green.",
      },
    ],
    approvals:
      status === "approved" || status === "applied"
        ? [
            {
              targetMode: "limited_live",
              approvedBy: "operator_1",
              approvedAt: FIXTURE_TIME,
            },
          ]
        : [],
    bindings: [
      {
        bindingId: "binding_leg_spot_alpha_runtime",
        bindingKind: "runtime_deployment",
        legIds: ["leg_spot_alpha"],
        venueKey: "jupiter",
        targetMode: "limited_live",
        deploymentId: "dep_desk_sol_live",
        lane: "safe",
      },
      {
        bindingId: "binding_leg_perp_hedge_recipe",
        bindingKind: "worker_execution_recipe",
        legIds: ["leg_perp_hedge"],
        venueKey: "drift",
        instrumentId: "SOL-PERP",
        targetMode: "paper",
      },
    ],
    actions: [
      {
        actionId: "record-desk-state",
        actionType: "record_state_transition",
        summary: "Move the scenario into operator review before arming.",
        required: true,
      },
    ],
  };
}

function handoffEventFixture(
  eventType: RuntimeStrategyDeskPromotionHandoffEvent["eventType"],
  summary: string,
): RuntimeStrategyDeskPromotionHandoffEvent {
  return {
    eventId: `desk_handoff_evt_${eventType}`,
    handoffId: "desk_handoff_sol_composite_live_1",
    eventType,
    actor: "operator_1",
    summary,
    createdAt: FIXTURE_TIME,
  };
}

function executionRecipeFixture(
  status: RuntimeStrategyDeskExecutionRecipe["status"] = "paper",
): RuntimeStrategyDeskExecutionRecipe {
  return {
    recipeId: "desk_recipe_perp_1",
    scenarioId: "desk_sol_composite_1",
    handoffId: "desk_handoff_sol_composite_live_1",
    bindingId: "binding_leg_perp_hedge_recipe",
    status,
    venueKey: "drift",
    instrumentId: "SOL-PERP",
    targetMode: "paper",
    legIds: ["leg_perp_hedge"],
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  };
}

function buildPayload(): StrategyDeskApiPayload {
  const scenario = scenarioFixture();
  const runs = [paperRunFixture(), backtestRunFixture()];
  const reports = [paperReportFixture(), backtestReportFixture()];
  const handoffs = [handoffFixture()];
  return {
    ok: true,
    snapshot: {
      scenarios: [scenario],
      selectedScenarioId: scenario.scenarioId,
      selectedScenario: scenario,
      runs,
      reports,
      handoffs,
      activeHandoff: handoffs[0],
      latestHandoff: handoffs[0],
      handoffEvents: [
        handoffEventFixture(
          "prepared",
          "Prepared a bounded execution handoff.",
        ),
      ],
      executionRecipes: [],
      latestRun: runs[0],
      latestReport: reports[0],
    },
  };
}

export default function StrategyDeskProofPage() {
  const [payload, setPayload] = useState<StrategyDeskApiPayload>(buildPayload);
  const [editorValue, setEditorValue] = useState(
    JSON.stringify(buildPayload().snapshot.selectedScenario, null, 2),
  );
  const [walletAddress, setWalletAddress] = useState(WALLET_ADDRESS);
  const [actionPending, setActionPending] = useState<string | null>(null);

  function syncScenario(nextScenario: RuntimeStrategyDeskScenarioManifest) {
    setPayload((current) => {
      const scenarios = current.snapshot.scenarios.map((scenario) =>
        scenario.scenarioId === nextScenario.scenarioId
          ? nextScenario
          : scenario,
      );
      return {
        ok: true,
        snapshot: {
          ...current.snapshot,
          scenarios,
          selectedScenarioId: nextScenario.scenarioId,
          selectedScenario: nextScenario,
        },
      };
    });
    setEditorValue(JSON.stringify(nextScenario, null, 2));
  }

  function patchDraft(mutator: (draft: Record<string, unknown>) => void) {
    try {
      const parsed = JSON.parse(editorValue) as Record<string, unknown>;
      mutator(parsed);
      setEditorValue(JSON.stringify(parsed, null, 2));
    } catch {
      return;
    }
  }

  function applyStudy(kind: "replay" | "backtest") {
    setActionPending(`study:${kind}`);
    const report = backtestReportFixture();
    const run = backtestRunFixture();
    report.reportId = `desk_report_sol_composite_${kind}_proof`;
    report.scenarioRunId = `desk_run_sol_composite_${kind}_proof`;
    report.stage = kind;
    report.summary =
      kind === "replay"
        ? "Replay matrix completed with the fast variant still selected."
        : report.summary;
    run.scenarioRunId = report.scenarioRunId;
    run.runKind = kind;
    run.updatedAt = new Date().toISOString();
    report.generatedAt = run.updatedAt;
    setPayload((current) => ({
      ok: true,
      snapshot: {
        ...current.snapshot,
        runs: [
          run,
          ...current.snapshot.runs.filter((entry) => entry.runKind !== kind),
        ],
        reports: [
          report,
          ...current.snapshot.reports.filter((entry) => entry.stage !== kind),
        ],
        latestRun: run,
        latestReport: report,
      },
    }));
    setActionPending(null);
  }

  function applyExecution(kind: "shadow" | "paper") {
    setActionPending(`execute:${kind}`);
    const run = paperRunFixture();
    const report = paperReportFixture();
    run.scenarioRunId = `desk_run_sol_composite_${kind}_proof`;
    run.runKind = kind;
    run.updatedAt = new Date().toISOString();
    report.reportId = `desk_report_sol_composite_${kind}_proof`;
    report.scenarioRunId = run.scenarioRunId;
    report.stage = kind;
    report.generatedAt = run.updatedAt;
    report.summary =
      kind === "shadow"
        ? "Composite shadow run completed without wallet mutation."
        : report.summary;
    setPayload((current) => ({
      ok: true,
      snapshot: {
        ...current.snapshot,
        runs: [
          run,
          ...current.snapshot.runs.filter((entry) => entry.runKind !== kind),
        ],
        reports: [
          report,
          ...current.snapshot.reports.filter((entry) => entry.stage !== kind),
        ],
        latestRun: run,
        latestReport: report,
      },
    }));
    setActionPending(null);
  }

  function applyPrepareHandoff() {
    setActionPending("handoff:prepare");
    setPayload((current) => ({
      ok: true,
      snapshot: {
        ...current.snapshot,
        selectedScenario: current.snapshot.selectedScenario
          ? {
              ...current.snapshot.selectedScenario,
              state: "operator_review",
              activeHandoffId: "desk_handoff_sol_composite_live_1",
            }
          : null,
        scenarios: current.snapshot.scenarios.map((scenario) => ({
          ...scenario,
          state:
            scenario.scenarioId === "desk_sol_composite_1"
              ? "operator_review"
              : scenario.state,
          activeHandoffId:
            scenario.scenarioId === "desk_sol_composite_1"
              ? "desk_handoff_sol_composite_live_1"
              : scenario.activeHandoffId,
        })),
        handoffs: [handoffFixture(), ...current.snapshot.handoffs.slice(1)],
        activeHandoff: handoffFixture(),
        latestHandoff: handoffFixture(),
        handoffEvents: [
          handoffEventFixture(
            "prepared",
            "Prepared a bounded execution handoff from paper evidence.",
          ),
        ],
        executionRecipes: [],
      },
    }));
    setActionPending(null);
  }

  function applyHandoffAction(
    action: "submit" | "approve" | "apply" | "pause" | "kill" | "demote",
  ) {
    setActionPending(`handoff:${action}`);
    setPayload((current) => {
      const nextScenario =
        current.snapshot.selectedScenario &&
        current.snapshot.selectedScenario.scenarioId === "desk_sol_composite_1"
          ? {
              ...current.snapshot.selectedScenario,
              state:
                action === "submit"
                  ? "operator_review"
                  : action === "approve"
                    ? "execution_ready"
                    : action === "apply"
                      ? "execution_bound"
                      : action === "demote"
                        ? "paper_ready"
                        : "paused",
              activeHandoffId:
                action === "demote"
                  ? undefined
                  : "desk_handoff_sol_composite_live_1",
            }
          : current.snapshot.selectedScenario;
      const handoffStatus =
        action === "submit"
          ? "awaiting_review"
          : action === "approve"
            ? "approved"
            : action === "apply"
              ? "applied"
              : action === "demote"
                ? "archived"
                : (current.snapshot.latestHandoff?.status ?? "applied");
      const nextHandoff = handoffFixture(
        handoffStatus as RuntimeStrategyDeskPromotionHandoff["status"],
      );
      const eventSummary =
        action === "submit"
          ? "Submitted bounded execution handoff for review."
          : action === "approve"
            ? "Approved bounded execution handoff."
            : action === "apply"
              ? "Applied bounded execution handoff."
              : action === "pause"
                ? "Paused bounded execution."
                : action === "kill"
                  ? "Killed bounded execution."
                  : "Demoted bounded execution back to paper.";
      return {
        ok: true,
        snapshot: {
          ...current.snapshot,
          selectedScenario: nextScenario,
          scenarios: current.snapshot.scenarios.map((scenario) =>
            scenario.scenarioId === "desk_sol_composite_1" && nextScenario
              ? nextScenario
              : scenario,
          ),
          handoffs: [nextHandoff],
          activeHandoff: action === "demote" ? null : nextHandoff,
          latestHandoff: nextHandoff,
          handoffEvents: [
            ...current.snapshot.handoffEvents,
            handoffEventFixture(action, eventSummary),
          ],
          executionRecipes:
            action === "apply"
              ? [executionRecipeFixture("paper")]
              : action === "pause"
                ? [executionRecipeFixture("paused")]
                : action === "kill"
                  ? [executionRecipeFixture("killed")]
                  : action === "demote"
                    ? [executionRecipeFixture("archived")]
                    : current.snapshot.executionRecipes,
        },
      };
    });
    setActionPending(null);
  }

  return (
    <div data-testid="strategy-desk-proof-page">
      <StrategyDeskView
        authenticated
        loading={false}
        error={null}
        payload={payload}
        editorValue={editorValue}
        walletAddress={walletAddress}
        actionPending={actionPending}
        onRefresh={() => setPayload(buildPayload())}
        onSelectScenario={() => undefined}
        onEditorChange={setEditorValue}
        onTitleChange={(value) => {
          patchDraft((draft) => {
            draft.title = value;
          });
        }}
        onSummaryChange={(value) => {
          patchDraft((draft) => {
            draft.summary = value;
          });
        }}
        onWalletAddressChange={(value) => {
          setWalletAddress(value);
          patchDraft((draft) => {
            const metadata =
              draft.metadata &&
              typeof draft.metadata === "object" &&
              !Array.isArray(draft.metadata)
                ? (draft.metadata as Record<string, unknown>)
                : {};
            metadata.operatorWalletAddress = value;
            draft.metadata = metadata;
          });
        }}
        onResetEditor={() =>
          setEditorValue(
            JSON.stringify(payload.snapshot.selectedScenario, null, 2),
          )
        }
        onSaveScenario={() => {
          try {
            const parsed = JSON.parse(
              editorValue,
            ) as RuntimeStrategyDeskScenarioManifest;
            syncScenario(parsed);
          } catch {
            return;
          }
        }}
        onRunStudy={(runKind) => applyStudy(runKind)}
        onRunExecute={(runKind) => applyExecution(runKind)}
        onPrepareHandoff={() => applyPrepareHandoff()}
        onTransitionHandoff={(action) => {
          if (
            action === "submit" ||
            action === "approve" ||
            action === "apply" ||
            action === "pause" ||
            action === "kill" ||
            action === "demote"
          ) {
            applyHandoffAction(action);
          }
        }}
      />
    </div>
  );
}
