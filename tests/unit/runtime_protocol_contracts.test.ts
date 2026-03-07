import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  canTransitionRuntimeDeploymentState,
  canTransitionRuntimeRunState,
  parseRuntimeDeploymentRecord,
  parseRuntimeExecutionPlan,
  parseRuntimeLedgerSnapshot,
  parseRuntimeReconciliationResult,
  parseRuntimeRiskVerdict,
  parseRuntimeRunRecord,
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

  test("parses valid run, ledger, risk, plan, and reconciliation payloads", () => {
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

    expect(run.state).toBe("planned");
    expect(ledger.totals.availableUsd).toBe("95");
    expect(verdict.verdict).toBe("allow");
    expect(plan.slices).toHaveLength(1);
    expect(reconciliation.status).toBe("passed");
  });

  test("rejects an execution plan without slices", () => {
    const result = safeParseRuntimeExecutionPlan({
      schemaVersion: "v1",
      planId: "plan_1",
      deploymentId: "dep_1",
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
