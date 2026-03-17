import {
  canTransitionRuntimeStrategyDeskRunState,
  canTransitionRuntimeStrategyDeskScenarioState,
  type RuntimeStrategyDeskScenarioManifest,
  type RuntimeStrategyDeskScenarioReport,
  type RuntimeStrategyDeskScenarioRun,
} from "../../../src/runtime/contracts/autonomous_runtime.js";
import {
  getStrategyDeskScenarioManifest,
  getStrategyDeskScenarioReport,
  getStrategyDeskScenarioRun,
  listStrategyDeskScenarioManifests,
  listStrategyDeskScenarioReports,
  listStrategyDeskScenarioRuns,
  updateStrategyDeskScenarioLatestReport,
  writeStrategyDeskScenarioManifest,
  writeStrategyDeskScenarioReport,
  writeStrategyDeskScenarioRun,
} from "./strategy_desk_repository";
import type { Env } from "./types";

type StrategyDeskScenarioUpsertResult = {
  scenario: RuntimeStrategyDeskScenarioManifest;
};

type StrategyDeskScenarioListResult = {
  scenarios: RuntimeStrategyDeskScenarioManifest[];
};

type StrategyDeskScenarioRunUpsertResult = {
  run: RuntimeStrategyDeskScenarioRun;
};

type StrategyDeskScenarioRunListResult = {
  runs: RuntimeStrategyDeskScenarioRun[];
};

type StrategyDeskScenarioReportUpsertResult = {
  report: RuntimeStrategyDeskScenarioReport;
};

type StrategyDeskScenarioReportListResult = {
  reports: RuntimeStrategyDeskScenarioReport[];
};

function ensureScenarioTransitionAllowed(
  existing: RuntimeStrategyDeskScenarioManifest | null,
  incoming: RuntimeStrategyDeskScenarioManifest,
): void {
  if (!existing) return;
  if (existing.state === incoming.state) return;
  if (
    !canTransitionRuntimeStrategyDeskScenarioState(
      existing.state,
      incoming.state,
    )
  ) {
    throw new Error(
      `runtime-strategy-desk-scenario-transition-invalid:${existing.state}:${incoming.state}`,
    );
  }
}

function ensureRunTransitionAllowed(
  existing: RuntimeStrategyDeskScenarioRun | null,
  incoming: RuntimeStrategyDeskScenarioRun,
): void {
  if (!existing) return;
  if (existing.scenarioId !== incoming.scenarioId) {
    throw new Error(
      `runtime-strategy-desk-run-scenario-mismatch:${existing.scenarioId}:${incoming.scenarioId}`,
    );
  }
  if (existing.runKind !== incoming.runKind) {
    throw new Error(
      `runtime-strategy-desk-run-kind-mismatch:${existing.runKind}:${incoming.runKind}`,
    );
  }
  if (existing.state === incoming.state) return;
  if (
    !canTransitionRuntimeStrategyDeskRunState(existing.state, incoming.state)
  ) {
    throw new Error(
      `runtime-strategy-desk-run-transition-invalid:${existing.state}:${incoming.state}`,
    );
  }
}

function ensureScenarioLegIds(
  scenario: RuntimeStrategyDeskScenarioManifest,
  legIds: Iterable<string>,
  errorPrefix: string,
): void {
  const known = new Set(scenario.legs.map((leg) => leg.legId));
  for (const legId of legIds) {
    if (!known.has(legId)) {
      throw new Error(`${errorPrefix}:${scenario.scenarioId}:${legId}`);
    }
  }
}

export async function upsertRuntimeStrategyDeskScenarioWorkflow(input: {
  env: Env;
  scenario: RuntimeStrategyDeskScenarioManifest;
}): Promise<StrategyDeskScenarioUpsertResult> {
  const existing = await getStrategyDeskScenarioManifest(
    input.env.WAITLIST_DB,
    input.scenario.scenarioId,
  );
  ensureScenarioTransitionAllowed(existing, input.scenario);
  return {
    scenario: await writeStrategyDeskScenarioManifest(
      input.env.WAITLIST_DB,
      input.scenario,
    ),
  };
}

export async function getRuntimeStrategyDeskScenarioWorkflow(input: {
  env: Env;
  scenarioId: string;
}): Promise<StrategyDeskScenarioUpsertResult> {
  const scenario = await getStrategyDeskScenarioManifest(
    input.env.WAITLIST_DB,
    input.scenarioId,
  );
  if (!scenario) {
    throw new Error(
      `runtime-strategy-desk-scenario-not-found:${input.scenarioId}`,
    );
  }
  return { scenario };
}

export async function listRuntimeStrategyDeskScenariosWorkflow(input: {
  env: Env;
  scenarioId?: string;
  ownerUserId?: string;
  strategyKey?: string;
  state?: string;
  venueKey?: string;
  intentFamily?: string;
  marketType?: string;
  limit?: number;
}): Promise<StrategyDeskScenarioListResult> {
  return {
    scenarios: await listStrategyDeskScenarioManifests(input.env.WAITLIST_DB, {
      scenarioId: input.scenarioId,
      ownerUserId: input.ownerUserId,
      strategyKey: input.strategyKey,
      state: input.state,
      venueKey: input.venueKey,
      intentFamily: input.intentFamily,
      marketType: input.marketType,
      limit: input.limit,
    }),
  };
}

export async function upsertRuntimeStrategyDeskScenarioRunWorkflow(input: {
  env: Env;
  run: RuntimeStrategyDeskScenarioRun;
}): Promise<StrategyDeskScenarioRunUpsertResult> {
  const scenario = await getStrategyDeskScenarioManifest(
    input.env.WAITLIST_DB,
    input.run.scenarioId,
  );
  if (!scenario) {
    throw new Error(
      `runtime-strategy-desk-scenario-not-found:${input.run.scenarioId}`,
    );
  }
  ensureScenarioLegIds(
    scenario,
    input.run.legRuns.map((legRun) => legRun.legId),
    "runtime-strategy-desk-run-leg-unknown",
  );
  const existing = await getStrategyDeskScenarioRun(
    input.env.WAITLIST_DB,
    input.run.scenarioRunId,
  );
  ensureRunTransitionAllowed(existing, input.run);
  return {
    run: await writeStrategyDeskScenarioRun(input.env.WAITLIST_DB, input.run),
  };
}

export async function getRuntimeStrategyDeskScenarioRunWorkflow(input: {
  env: Env;
  scenarioRunId: string;
}): Promise<StrategyDeskScenarioRunUpsertResult> {
  const run = await getStrategyDeskScenarioRun(
    input.env.WAITLIST_DB,
    input.scenarioRunId,
  );
  if (!run) {
    throw new Error(
      `runtime-strategy-desk-run-not-found:${input.scenarioRunId}`,
    );
  }
  return { run };
}

export async function listRuntimeStrategyDeskScenarioRunsWorkflow(input: {
  env: Env;
  scenarioRunId?: string;
  scenarioId?: string;
  runKind?: string;
  state?: string;
  limit?: number;
}): Promise<StrategyDeskScenarioRunListResult> {
  return {
    runs: await listStrategyDeskScenarioRuns(input.env.WAITLIST_DB, {
      scenarioRunId: input.scenarioRunId,
      scenarioId: input.scenarioId,
      runKind: input.runKind,
      state: input.state,
      limit: input.limit,
    }),
  };
}

export async function upsertRuntimeStrategyDeskScenarioReportWorkflow(input: {
  env: Env;
  report: RuntimeStrategyDeskScenarioReport;
}): Promise<StrategyDeskScenarioReportUpsertResult> {
  const scenario = await getStrategyDeskScenarioManifest(
    input.env.WAITLIST_DB,
    input.report.scenarioId,
  );
  if (!scenario) {
    throw new Error(
      `runtime-strategy-desk-scenario-not-found:${input.report.scenarioId}`,
    );
  }
  const run = await getStrategyDeskScenarioRun(
    input.env.WAITLIST_DB,
    input.report.scenarioRunId,
  );
  if (!run) {
    throw new Error(
      `runtime-strategy-desk-report-run-not-found:${input.report.scenarioRunId}`,
    );
  }
  if (run.scenarioId !== input.report.scenarioId) {
    throw new Error(
      `runtime-strategy-desk-report-scenario-mismatch:${run.scenarioId}:${input.report.scenarioId}`,
    );
  }
  ensureScenarioLegIds(
    scenario,
    input.report.legOutcomes.map((outcome) => outcome.legId),
    "runtime-strategy-desk-report-leg-unknown",
  );

  const report = await writeStrategyDeskScenarioReport(
    input.env.WAITLIST_DB,
    input.report,
  );
  const currentLatestReport = scenario.latestReportId
    ? await getStrategyDeskScenarioReport(
        input.env.WAITLIST_DB,
        scenario.latestReportId,
      )
    : null;
  if (
    !currentLatestReport ||
    currentLatestReport.generatedAt <= report.generatedAt
  ) {
    await updateStrategyDeskScenarioLatestReport(input.env.WAITLIST_DB, {
      scenarioId: report.scenarioId,
      latestReportId: report.reportId,
      updatedAt: report.generatedAt,
    });
  }
  return { report };
}

export async function getRuntimeStrategyDeskScenarioReportWorkflow(input: {
  env: Env;
  reportId: string;
}): Promise<StrategyDeskScenarioReportUpsertResult> {
  const report = await getStrategyDeskScenarioReport(
    input.env.WAITLIST_DB,
    input.reportId,
  );
  if (!report) {
    throw new Error(`runtime-strategy-desk-report-not-found:${input.reportId}`);
  }
  return { report };
}

export async function listRuntimeStrategyDeskScenarioReportsWorkflow(input: {
  env: Env;
  reportId?: string;
  scenarioId?: string;
  scenarioRunId?: string;
  stage?: string;
  status?: string;
  limit?: number;
}): Promise<StrategyDeskScenarioReportListResult> {
  return {
    reports: await listStrategyDeskScenarioReports(input.env.WAITLIST_DB, {
      reportId: input.reportId,
      scenarioId: input.scenarioId,
      scenarioRunId: input.scenarioRunId,
      stage: input.stage,
      status: input.status,
      limit: input.limit,
    }),
  };
}
