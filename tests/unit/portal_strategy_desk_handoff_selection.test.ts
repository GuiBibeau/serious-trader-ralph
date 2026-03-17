import { describe, expect, test } from "bun:test";
import {
  type StrategyDeskApiPayload,
  selectStrategyDeskFocusHandoff,
  selectStrategyDeskHandoffForAction,
} from "../../apps/portal/app/terminal/strategy-desk/types";
import type { RuntimeStrategyDeskPromotionHandoff } from "../../apps/portal/lib/runtime-strategy-desk";

const FIXTURE_TIME = "2026-03-17T03:08:10Z";

function handoffFixture(
  overrides?: Partial<RuntimeStrategyDeskPromotionHandoff>,
): RuntimeStrategyDeskPromotionHandoff {
  return {
    schemaVersion: "v1",
    handoffId: "desk_handoff_sol_composite_live_1",
    scenarioId: "desk_sol_composite_1",
    currentState: "operator_review",
    targetMode: "limited_live",
    status: "approved",
    summary: "Bounded execution handoff.",
    requestedBy: "operator_1",
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    evidenceRefs: [],
    checks: [],
    approvals: [],
    bindings: [],
    actions: [],
    ...overrides,
  };
}

function snapshotFixture(
  overrides?: Partial<StrategyDeskApiPayload["snapshot"]>,
): StrategyDeskApiPayload["snapshot"] {
  return {
    scenarios: [],
    selectedScenarioId: "desk_sol_composite_1",
    selectedScenario: null,
    runs: [],
    reports: [],
    handoffs: [],
    activeHandoff: null,
    latestHandoff: null,
    handoffEvents: [],
    executionRecipes: [],
    latestRun: null,
    latestReport: null,
    ...overrides,
  };
}

describe("strategy desk handoff selection", () => {
  test("routes submit to the newest draft while keeping controls on the active applied handoff", () => {
    const activeHandoff = handoffFixture({
      handoffId: "desk_handoff_active",
      status: "applied",
    });
    const latestDraft = handoffFixture({
      handoffId: "desk_handoff_draft",
      status: "draft",
      updatedAt: "2026-03-17T03:09:10Z",
    });
    const snapshot = snapshotFixture({
      activeHandoff,
      latestHandoff: latestDraft,
    });

    expect(
      selectStrategyDeskHandoffForAction(snapshot, "submit")?.handoffId,
    ).toBe("desk_handoff_draft");
    expect(
      selectStrategyDeskHandoffForAction(snapshot, "pause")?.handoffId,
    ).toBe("desk_handoff_active");
    expect(selectStrategyDeskFocusHandoff(snapshot)?.handoffId).toBe(
      "desk_handoff_active",
    );
  });

  test("keeps apply and demote pinned to the active approved handoff when a newer draft exists", () => {
    const activeApproved = handoffFixture({
      handoffId: "desk_handoff_active",
      status: "approved",
    });
    const latestDraft = handoffFixture({
      handoffId: "desk_handoff_draft",
      status: "draft",
      updatedAt: "2026-03-17T03:09:10Z",
    });
    const snapshot = snapshotFixture({
      activeHandoff: activeApproved,
      latestHandoff: latestDraft,
    });

    expect(
      selectStrategyDeskHandoffForAction(snapshot, "apply")?.handoffId,
    ).toBe("desk_handoff_active");
    expect(
      selectStrategyDeskHandoffForAction(snapshot, "demote")?.handoffId,
    ).toBe("desk_handoff_active");
  });
});
