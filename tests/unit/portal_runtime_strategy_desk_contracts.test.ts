import { describe, expect, test } from "bun:test";
import {
  buildRunComparison,
  strategyDeskVariantRowKey,
} from "../../apps/portal/app/terminal/strategy-desk/strategy-desk-view";
import { safeParseRuntimeStrategyDeskScenarioManifest } from "../../apps/portal/lib/runtime-strategy-desk";

const FIXTURE_TIME = "2026-03-17T03:08:10Z";

describe("portal runtime strategy desk contracts", () => {
  test("rejects scenario manifests when any leg is invalid", () => {
    const parsed = safeParseRuntimeStrategyDeskScenarioManifest({
      schemaVersion: "v1",
      scenarioId: "desk_sol_composite_1",
      title: "SOL composite desk scenario",
      summary: "Composite desk scenario",
      ownerUserId: "user_1",
      strategyKey: "strategy_desk::sol_composite",
      thesis: "Composite thesis",
      state: "paper_ready",
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
      legs: [
        {
          legId: "leg_spot_alpha",
          label: "Spot alpha",
          role: "primary_alpha",
          venueKey: "jupiter",
          intentFamily: "spot_swap",
          marketType: "spot",
          assetKeys: ["SOL", "USDC"],
          enabledModes: ["shadow", "paper"],
          sizing: {
            targetNotionalUsd: "1000",
          },
        },
        {
          legId: "leg_perp_hedge",
          label: "Perp hedge",
          role: "hedge",
          venueKey: "drift",
          intentFamily: "perp_order",
          assetKeys: ["SOL"],
          enabledModes: ["shadow"],
          sizing: {
            targetNotionalUsd: "250",
          },
        },
      ],
      evidence: [],
      implementationReferences: [],
      tags: ["strategy-desk"],
    });

    expect(parsed).toEqual({
      success: false,
      error: "strategy-desk-scenario-legs-invalid",
    });
  });

  test("reads run comparison net pnl from scorecard aggregate when portfolio summary is absent", () => {
    const comparison = buildRunComparison(
      [
        {
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
          },
          createdAt: FIXTURE_TIME,
          updatedAt: FIXTURE_TIME,
          legRuns: [],
        },
      ],
      [
        {
          schemaVersion: "v1",
          reportId: "desk_report_sol_composite_paper_1",
          scenarioId: "desk_sol_composite_1",
          scenarioRunId: "desk_run_sol_composite_paper_1",
          stage: "paper",
          status: "pass",
          summary: "Paper report",
          generatedAt: FIXTURE_TIME,
          legOutcomes: [],
          scorecard: {
            aggregate: {
              netPnlUsd: "49.30",
            },
          },
          riskOverlays: [],
          evidence: [],
          checks: [],
          approvals: [],
        },
      ],
    );

    expect(comparison).toHaveLength(1);
    expect(comparison[0]).toMatchObject({
      scenarioRunId: "desk_run_sol_composite_paper_1",
      netPnlUsd: "49.30",
    });
  });

  test("builds deterministic fallback keys for variant rows", () => {
    expect(
      strategyDeskVariantRowKey(
        {
          label: "Carry tilt",
        },
        3,
      ),
    ).toBe("Carry tilt");
    expect(strategyDeskVariantRowKey({}, 3)).toBe("variant-3");
  });
});
