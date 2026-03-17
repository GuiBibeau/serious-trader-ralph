import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getStrategyDeskScenarioManifest,
  getStrategyDeskScenarioReport,
} from "../../apps/worker/src/strategy_desk_repository";

function readFixture(fileName: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      resolve(
        import.meta.dir,
        "..",
        "..",
        "docs/runtime-contracts/fixtures",
        fileName,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function createDb(input: {
  scenarioRow?: Record<string, unknown>;
  legs?: Record<string, unknown>[];
  reportRow?: Record<string, unknown>;
}): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          return {
            async first() {
              if (/FROM strategy_desk_scenarios/i.test(sql)) {
                return input.scenarioRow ?? null;
              }
              if (/FROM strategy_desk_reports/i.test(sql)) {
                return input.reportRow ?? null;
              }
              return null;
            },
            async all() {
              if (/FROM strategy_desk_scenario_legs/i.test(sql)) {
                return { results: input.legs ?? [] };
              }
              return { results: [] };
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe("strategy desk repository", () => {
  test("hydrates scenario manifests when D1 rows already contain parsed JSON values", async () => {
    const scenario = readFixture(
      "runtime.strategy_desk_scenario.valid.v1.json",
    ) as Record<string, unknown>;
    const legs = (scenario.legs as Record<string, unknown>[]) ?? [];

    const db = createDb({
      scenarioRow: {
        scenarioId: scenario.scenarioId,
        schemaVersion: scenario.schemaVersion,
        title: scenario.title,
        summary: scenario.summary,
        ownerUserId: scenario.ownerUserId,
        strategyKey: scenario.strategyKey,
        thesis: scenario.thesis,
        sleeveId: scenario.sleeveId,
        state: scenario.state,
        reviewedAt: scenario.reviewedAt,
        activeHandoffId: scenario.activeHandoffId,
        latestReportId: scenario.latestReportId,
        riskLimits: scenario.riskLimits,
        researchMatrix: scenario.researchMatrix,
        evidence: scenario.evidence,
        implementationReferences: scenario.implementationReferences,
        tags: scenario.tags,
        metadata: scenario.metadata,
        createdAt: scenario.createdAt,
        updatedAt: scenario.updatedAt,
      },
      legs: legs.map((leg, index) => ({
        scenarioId: scenario.scenarioId,
        legId: leg.legId,
        sortOrder: index,
        label: leg.label,
        role: leg.role,
        venueKey: leg.venueKey,
        intentFamily: leg.intentFamily,
        marketType: leg.marketType,
        pair: leg.pair,
        instrumentId: leg.instrumentId,
        assetKeys: leg.assetKeys,
        enabledModes: leg.enabledModes,
        sizing: leg.sizing,
        intent: leg.intent,
        thesis: leg.thesis,
        dependencies: leg.dependencies,
        tags: leg.tags,
      })),
    });

    const persisted = await getStrategyDeskScenarioManifest(
      db,
      String(scenario.scenarioId),
    );

    expect(persisted?.researchMatrix?.variants).toHaveLength(
      (
        (scenario.researchMatrix as Record<string, unknown>)
          .variants as unknown[]
      ).length,
    );
    expect(persisted?.researchMatrix?.windows).toHaveLength(
      (
        (scenario.researchMatrix as Record<string, unknown>)
          .windows as unknown[]
      ).length,
    );
    expect(persisted?.evidence).toHaveLength(
      (scenario.evidence as unknown[]).length,
    );
    expect(persisted?.legs).toHaveLength(legs.length);
  });

  test("hydrates scenario reports when D1 rows already contain parsed JSON values", async () => {
    const report = readFixture(
      "runtime.strategy_desk_report.valid.v1.json",
    ) as Record<string, unknown>;

    const db = createDb({
      reportRow: {
        reportId: report.reportId,
        scenarioId: report.scenarioId,
        scenarioRunId: report.scenarioRunId,
        schemaVersion: report.schemaVersion,
        stage: report.stage,
        status: report.status,
        summary: report.summary,
        legOutcomes: report.legOutcomes,
        portfolioSummary: report.portfolioSummary,
        scorecard: report.scorecard,
        riskOverlays: report.riskOverlays,
        studyMatrix: report.studyMatrix,
        evidence: report.evidence,
        checks: report.checks,
        approvals: report.approvals,
        metadata: report.metadata,
        generatedAt: report.generatedAt,
      },
    });

    const persisted = await getStrategyDeskScenarioReport(
      db,
      String(report.reportId),
    );

    expect(persisted?.studyMatrix?.cells).toHaveLength(
      (
        ((report.studyMatrix as Record<string, unknown>)?.cells ??
          []) as unknown[]
      ).length,
    );
    expect(persisted?.evidence).toHaveLength(
      (report.evidence as unknown[]).length,
    );
    expect(persisted?.checks).toHaveLength((report.checks as unknown[]).length);
  });
});
