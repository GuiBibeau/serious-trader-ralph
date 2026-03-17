import type { RuntimeBacktestRunRequest } from "../../../src/runtime/research/curation.js";
import type {
  RuntimeStrategyDeskRunKind,
  RuntimeStrategyDeskScenarioLeg,
  RuntimeStrategyDeskScenarioManifest,
  RuntimeStrategyDeskScenarioReport,
  RuntimeStrategyDeskScenarioRun,
} from "./runtime_contracts";
import { parseRuntimeBacktestReport } from "./runtime_contracts";
import { runRuntimeBacktest } from "./runtime_internal";
import {
  getRuntimeStrategyDeskScenarioWorkflow,
  upsertRuntimeStrategyDeskScenarioReportWorkflow,
  upsertRuntimeStrategyDeskScenarioRunWorkflow,
} from "./runtime_strategy_desk";
import type { Env } from "./types";

type StrategyDeskStudyRunKind = Extract<
  RuntimeStrategyDeskRunKind,
  "replay" | "backtest"
>;

type StrategyDeskStudySelectionMetric = NonNullable<
  NonNullable<
    RuntimeStrategyDeskScenarioManifest["researchMatrix"]
  >["selectionMetric"]
>;

type StrategyDeskStudyMatrix = NonNullable<
  RuntimeStrategyDeskScenarioReport["studyMatrix"]
>;
type StrategyDeskStudyCell = StrategyDeskStudyMatrix["cells"][number];
type StrategyDeskStudyWindow = StrategyDeskStudyMatrix["windows"][number];
type StrategyDeskStudyVariantSummary =
  StrategyDeskStudyMatrix["variantSummaries"][number];
type StrategyDeskStudyLegResult = StrategyDeskStudyCell["legResults"][number];
type StrategyDeskBacktestMetrics = StrategyDeskStudyLegResult["metrics"];
type StrategyDeskBacktestBaselineComparison = NonNullable<
  StrategyDeskStudyLegResult["baselineComparisons"]
>[number];
type StrategyDeskBacktestStatus = StrategyDeskStudyLegResult["status"];
type StrategyDeskResearchMatrix = NonNullable<
  RuntimeStrategyDeskScenarioManifest["researchMatrix"]
>;
type StrategyDeskResearchMatrixLeg =
  StrategyDeskResearchMatrix["backtestLegs"][number];
type StrategyDeskResearchMatrixWindow =
  StrategyDeskResearchMatrix["windows"][number];
type StrategyDeskResearchMatrixVariant =
  StrategyDeskResearchMatrix["variants"][number];

export type RuntimeStrategyDeskStudyWorkflowInput = {
  env: Env;
  scenarioId: string;
  runKind: StrategyDeskStudyRunKind;
  requestedBy: string;
  scenarioRunId?: string;
  reportId?: string;
  variantIds?: string[];
  windowIds?: string[];
  selectionMetric?: StrategyDeskStudySelectionMetric;
};

type StrategyDeskStudyDeps = {
  now?: () => string;
  createId?: (prefix: string) => string;
  runRuntimeBacktest?: typeof runRuntimeBacktest;
};

export type RuntimeStrategyDeskStudyWorkflowResult = {
  scenario: RuntimeStrategyDeskScenarioManifest;
  run: RuntimeStrategyDeskScenarioRun;
  report: RuntimeStrategyDeskScenarioReport;
};

const DEFAULT_SELECTION_METRIC: StrategyDeskStudySelectionMetric =
  "excess_vs_flat_cash_bps";

function nowIso(deps?: StrategyDeskStudyDeps): string {
  return deps?.now?.() ?? new Date().toISOString();
}

function createDeskId(prefix: string, deps?: StrategyDeskStudyDeps): string {
  if (deps?.createId) {
    return deps.createId(prefix);
  }
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function readNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value: number): string {
  return value.toFixed(2);
}

function formatBps(value: number): string {
  return value.toFixed(4);
}

function zeroMetrics(): StrategyDeskBacktestMetrics {
  return {
    observationCount: 0,
    tradeCount: 0,
    grossReturnBps: "0.0000",
    netReturnBps: "0.0000",
    totalCostBps: "0.0000",
    winRateBps: 0,
    maxDrawdownBps: "0.0000",
  };
}

function readLegReserveUsd(leg: RuntimeStrategyDeskScenarioLeg): number {
  return readNumber(leg.sizing.reserveUsd ?? leg.sizing.targetNotionalUsd);
}

function readLegTargetUsd(leg: RuntimeStrategyDeskScenarioLeg): number {
  return readNumber(leg.sizing.targetNotionalUsd);
}

function readLegBudgetUsd(leg: RuntimeStrategyDeskScenarioLeg): number {
  return readNumber(leg.sizing.maxNotionalUsd ?? leg.sizing.targetNotionalUsd);
}

function readLegNetExposureUsd(leg: RuntimeStrategyDeskScenarioLeg): number {
  const notional = readLegTargetUsd(leg);
  const side = String(leg.intent?.side ?? "")
    .trim()
    .toLowerCase();
  switch (leg.intentFamily) {
    case "spot_swap":
    case "conditional_spot_order":
    case "clob_order":
      return side === "sell" ? -notional : notional;
    case "perp_order":
      return side === "short" || side === "close_long" ? -notional : notional;
    case "prediction_order":
      if (side === "buy_no" || side === "sell_yes") return -notional;
      return notional;
    default:
      return 0;
  }
}

function aggregateMetrics(
  entries: Array<{
    metrics: StrategyDeskBacktestMetrics;
    weight: number;
  }>,
): StrategyDeskBacktestMetrics {
  if (entries.length === 0) return zeroMetrics();

  const weighted = entries.filter((entry) => entry.weight > 0);
  const returnDenominator =
    weighted.reduce((sum, entry) => sum + entry.weight, 0) || entries.length;
  const winRateDenominator =
    entries.reduce(
      (sum, entry) => sum + Math.max(entry.metrics.observationCount, 1),
      0,
    ) || entries.length;

  const observationCount = entries.reduce(
    (sum, entry) => sum + entry.metrics.observationCount,
    0,
  );
  const tradeCount = entries.reduce(
    (sum, entry) => sum + entry.metrics.tradeCount,
    0,
  );
  const grossReturnBps = entries.reduce(
    (sum, entry) =>
      sum +
      readNumber(entry.metrics.grossReturnBps) *
        (entry.weight > 0 ? entry.weight : 1),
    0,
  );
  const netReturnBps = entries.reduce(
    (sum, entry) =>
      sum +
      readNumber(entry.metrics.netReturnBps) *
        (entry.weight > 0 ? entry.weight : 1),
    0,
  );
  const totalCostBps = entries.reduce(
    (sum, entry) =>
      sum +
      readNumber(entry.metrics.totalCostBps) *
        (entry.weight > 0 ? entry.weight : 1),
    0,
  );
  const winRateBps = entries.reduce(
    (sum, entry) =>
      sum +
      entry.metrics.winRateBps * Math.max(entry.metrics.observationCount, 1),
    0,
  );
  const maxDrawdownBps = entries.reduce(
    (current, entry) =>
      Math.max(current, readNumber(entry.metrics.maxDrawdownBps)),
    0,
  );

  return {
    observationCount,
    tradeCount,
    grossReturnBps: formatBps(grossReturnBps / returnDenominator),
    netReturnBps: formatBps(netReturnBps / returnDenominator),
    totalCostBps: formatBps(totalCostBps / returnDenominator),
    winRateBps: Math.round(winRateBps / winRateDenominator),
    maxDrawdownBps: formatBps(maxDrawdownBps),
  };
}

function aggregateBaselineComparisons(
  entries: Array<{
    comparisons?: StrategyDeskBacktestBaselineComparison[];
    weight: number;
  }>,
): StrategyDeskBacktestBaselineComparison[] | undefined {
  const baselineOrder: string[] = [];
  const aggregate = new Map<
    string,
    {
      weight: number;
      baselineReturnBps: number;
      excessReturnBps: number;
    }
  >();

  for (const entry of entries) {
    const comparisons = entry.comparisons ?? [];
    for (const comparison of comparisons) {
      if (!baselineOrder.includes(comparison.baseline)) {
        baselineOrder.push(comparison.baseline);
      }
      const current = aggregate.get(comparison.baseline) ?? {
        weight: 0,
        baselineReturnBps: 0,
        excessReturnBps: 0,
      };
      const weight = entry.weight > 0 ? entry.weight : 1;
      current.weight += weight;
      current.baselineReturnBps +=
        readNumber(comparison.baselineReturnBps) * weight;
      current.excessReturnBps +=
        readNumber(comparison.excessReturnBps) * weight;
      aggregate.set(comparison.baseline, current);
    }
  }

  if (aggregate.size === 0) return undefined;

  return baselineOrder.map((baseline) => {
    const current = aggregate.get(baseline);
    if (!current || current.weight <= 0) {
      return {
        baseline,
        baselineReturnBps: "0.0000",
        excessReturnBps: "0.0000",
      };
    }
    return {
      baseline,
      baselineReturnBps: formatBps(current.baselineReturnBps / current.weight),
      excessReturnBps: formatBps(current.excessReturnBps / current.weight),
    };
  });
}

function baselineExcessReturnBps(
  comparisons: StrategyDeskBacktestBaselineComparison[] | undefined,
  baseline: string,
): number | null {
  const match = comparisons?.find(
    (comparison) => comparison.baseline === baseline,
  );
  return match ? readNumber(match.excessReturnBps) : null;
}

function matrixLegWeight(
  scenario: RuntimeStrategyDeskScenarioManifest,
  legId: string,
): number {
  const leg = scenario.legs.find((entry) => entry.legId === legId);
  return leg ? Math.max(readLegReserveUsd(leg), readLegTargetUsd(leg), 1) : 1;
}

function mergeBacktestLegConfig(input: {
  leg: StrategyDeskResearchMatrixLeg;
  variant: StrategyDeskResearchMatrixVariant;
  window: StrategyDeskResearchMatrixWindow;
}): RuntimeBacktestRunRequest {
  const override = input.variant.legOverrides?.find(
    (candidate) => candidate.legId === input.leg.legId,
  );
  return {
    reportId: undefined,
    experimentId: override?.experimentId ?? input.leg.experimentId,
    replayCorpusId: override?.replayCorpusId ?? input.leg.replayCorpusId,
    venueKey: override?.venueKey ?? input.leg.venueKey,
    pairSymbol: override?.pairSymbol ?? input.leg.pairSymbol,
    marketType: override?.marketType ?? input.leg.marketType,
    windowMode: override?.windowMode ?? input.window.windowMode ?? "rolling",
    trainingWindowObservations:
      override?.trainingWindowObservations ??
      input.window.trainingWindowObservations,
    testingWindowObservations:
      override?.testingWindowObservations ??
      input.window.testingWindowObservations,
    stepObservations:
      override?.stepObservations ?? input.window.stepObservations,
    purgeObservations:
      override?.purgeObservations ?? input.window.purgeObservations,
    baselineStrategies: override?.baselineStrategies ??
      input.leg.baselineStrategies ?? ["flat_cash", "buy_and_hold"],
  };
}

function buildLegRunNotes(input: {
  variantCount: number;
  windowCount: number;
  selectedVariantIds: string[];
}): string {
  return `study:${input.variantCount} variants x ${input.windowCount} windows:${input.selectedVariantIds.join(",")}`;
}

function upsertStageEvidenceBucket(input: {
  scenario: RuntimeStrategyDeskScenarioManifest;
  runKind: StrategyDeskStudyRunKind;
  reportId: string;
  selectedVariantId?: string;
  reproducibilityRefs: string[];
}): RuntimeStrategyDeskScenarioReport["evidence"] {
  const next = input.scenario.evidence.filter(
    (bucket) => bucket.stage !== input.runKind,
  );
  next.push({
    stage: input.runKind,
    summary:
      input.runKind === "backtest"
        ? "Composite backtest study matrix with selection and holdout windows."
        : "Composite replay study matrix with selection and holdout windows.",
    evidenceRefs: [
      {
        kind: "strategy_desk_report",
        ref: input.reportId,
      },
      ...(input.selectedVariantId
        ? [
            {
              kind: "strategy_desk_variant",
              ref: input.selectedVariantId,
            },
          ]
        : []),
      ...input.reproducibilityRefs.map((ref) => ({
        kind: "reproducibility_bundle",
        ref,
      })),
    ].slice(0, 32),
    latestReportId: input.reportId,
  });
  return next;
}

function scenarioLegById(
  scenario: RuntimeStrategyDeskScenarioManifest,
  legId: string,
): RuntimeStrategyDeskScenarioLeg {
  const leg = scenario.legs.find((entry) => entry.legId === legId);
  if (!leg) {
    throw new Error(
      `runtime-strategy-desk-study-leg-unknown:${scenario.scenarioId}:${legId}`,
    );
  }
  return leg;
}

function studySelectionMetricValue(input: {
  summary: StrategyDeskStudyVariantSummary;
  metric: StrategyDeskStudySelectionMetric;
}): number | null {
  if (input.metric === "net_return_bps") {
    return input.summary.selectionMetrics
      ? readNumber(input.summary.selectionMetrics.netReturnBps)
      : null;
  }
  return baselineExcessReturnBps(
    input.summary.selectionBaselineComparisons,
    "flat_cash",
  );
}

function buildVariantSummary(input: {
  variant: StrategyDeskResearchMatrixVariant;
  cells: StrategyDeskStudyCell[];
}): StrategyDeskStudyVariantSummary {
  const selectionCells = input.cells.filter(
    (cell) => cell.cohort === "selection",
  );
  const holdoutCells = input.cells.filter((cell) => cell.cohort === "holdout");
  const aggregateCellMetrics = (
    cells: StrategyDeskStudyCell[],
  ): StrategyDeskBacktestMetrics | undefined => {
    if (cells.length === 0) return undefined;
    return aggregateMetrics(
      cells.map((cell) => ({
        metrics: cell.aggregateMetrics,
        weight: Math.max(cell.aggregateMetrics.observationCount, 1),
      })),
    );
  };
  const aggregateCellBaselines = (
    cells: StrategyDeskStudyCell[],
  ): StrategyDeskBacktestBaselineComparison[] | undefined =>
    aggregateBaselineComparisons(
      cells.map((cell) => ({
        comparisons: cell.aggregateBaselineComparisons,
        weight: Math.max(cell.aggregateMetrics.observationCount, 1),
      })),
    );

  return {
    variantId: input.variant.variantId,
    label: input.variant.label,
    parameterManifest: input.variant.parameterManifest,
    selectionWindowCount: selectionCells.length,
    holdoutWindowCount: holdoutCells.length,
    ...(selectionCells.length > 0
      ? {
          selectionMetrics: aggregateCellMetrics(selectionCells),
          selectionBaselineComparisons: aggregateCellBaselines(selectionCells),
        }
      : {}),
    ...(holdoutCells.length > 0
      ? {
          holdoutMetrics: aggregateCellMetrics(holdoutCells),
          holdoutBaselineComparisons: aggregateCellBaselines(holdoutCells),
        }
      : {}),
    ...(input.variant.notes ? { notes: input.variant.notes } : {}),
  };
}

function summarizeScenarioLegs(input: {
  scenario: RuntimeStrategyDeskScenarioManifest;
  studyMatrix: StrategyDeskStudyMatrix;
}): {
  legOutcomes: RuntimeStrategyDeskScenarioReport["legOutcomes"];
  scorecard: RuntimeStrategyDeskScenarioReport["scorecard"];
  portfolioSummary: NonNullable<
    RuntimeStrategyDeskScenarioReport["portfolioSummary"]
  >;
} {
  const focusCells =
    input.studyMatrix.selectedVariantId &&
    input.studyMatrix.variantSummaries.find(
      (summary) => summary.variantId === input.studyMatrix.selectedVariantId,
    )?.holdoutWindowCount
      ? input.studyMatrix.cells.filter(
          (cell) =>
            cell.variantId === input.studyMatrix.selectedVariantId &&
            cell.cohort === "holdout",
        )
      : input.studyMatrix.selectedVariantId
        ? input.studyMatrix.cells.filter(
            (cell) => cell.variantId === input.studyMatrix.selectedVariantId,
          )
        : input.studyMatrix.cells;

  const legOutcomes = input.scenario.legs.map((leg) => {
    const legResults = focusCells.flatMap((cell) =>
      cell.legResults.filter((result) => result.legId === leg.legId),
    );
    if (legResults.length === 0) {
      return {
        legId: leg.legId,
        status: "not_applicable" as const,
        evidenceRefs: [],
        notes: ["No study matrix backtest config is attached to this leg."],
      };
    }

    const aggregatedMetrics = aggregateMetrics(
      legResults.map((result) => ({
        metrics: result.metrics,
        weight: Math.max(result.metrics.observationCount, 1),
      })),
    );
    const targetUsd = readLegTargetUsd(leg);
    const status: RuntimeStrategyDeskScenarioReport["legOutcomes"][number]["status"] =
      legResults.some((result) => result.status !== "completed")
        ? "blocked"
        : "pass";

    return {
      legId: leg.legId,
      status,
      netPnlUsd: formatUsd(
        (targetUsd * readNumber(aggregatedMetrics.netReturnBps)) / 10_000,
      ),
      costUsd: formatUsd(
        (targetUsd * readNumber(aggregatedMetrics.totalCostBps)) / 10_000,
      ),
      evidenceRefs: Array.from(
        new Map(
          legResults.flatMap((result) => [
            [
              `backtest:${result.reportId}`,
              {
                kind: "backtest_report",
                ref: result.reportId,
              },
            ],
            [
              `repro:${result.reproducibilityBundleId}`,
              {
                kind: "reproducibility_bundle",
                ref: result.reproducibilityBundleId,
              },
            ],
          ]),
        ).values(),
      ).slice(0, 16),
      ...(legResults.some((result) => (result.blockingReasons?.length ?? 0) > 0)
        ? {
            notes: legResults
              .flatMap((result) => result.blockingReasons ?? [])
              .slice(0, 16),
          }
        : {}),
    };
  });

  const selectedVariantSummary =
    input.studyMatrix.variantSummaries.find(
      (summary) => summary.variantId === input.studyMatrix.selectedVariantId,
    ) ?? input.studyMatrix.variantSummaries[0];
  const summaryMetrics =
    selectedVariantSummary?.holdoutMetrics ??
    selectedVariantSummary?.selectionMetrics ??
    zeroMetrics();
  const capitalAllocatedUsd = input.scenario.legs.reduce(
    (sum, leg) => sum + readLegReserveUsd(leg),
    0,
  );
  const grossExposureBudgetUsd = input.scenario.legs.reduce(
    (sum, leg) => sum + readLegBudgetUsd(leg),
    0,
  );
  const reservedUsd = capitalAllocatedUsd;
  const grossPnlUsd =
    (capitalAllocatedUsd * readNumber(summaryMetrics.grossReturnBps)) / 10_000;
  const netPnlUsd =
    (capitalAllocatedUsd * readNumber(summaryMetrics.netReturnBps)) / 10_000;
  const totalCostUsd =
    (capitalAllocatedUsd * readNumber(summaryMetrics.totalCostBps)) / 10_000;
  const grossExposureUsd = input.scenario.legs.reduce(
    (sum, leg) => sum + readLegTargetUsd(leg),
    0,
  );
  const netExposureUsd = input.scenario.legs.reduce(
    (sum, leg) => sum + readLegNetExposureUsd(leg),
    0,
  );
  const venueExposureUsd = Object.fromEntries(
    Array.from(
      input.scenario.legs.reduce((map, leg) => {
        map.set(
          leg.venueKey,
          (map.get(leg.venueKey) ?? 0) + readLegTargetUsd(leg),
        );
        return map;
      }, new Map<string, number>()),
    ).map(([key, value]) => [key, formatUsd(value)]),
  );
  const venueFamilyExposureUsd = Object.fromEntries(
    Array.from(
      input.scenario.legs.reduce((map, leg) => {
        map.set(
          leg.intentFamily,
          (map.get(leg.intentFamily) ?? 0) + readLegTargetUsd(leg),
        );
        return map;
      }, new Map<string, number>()),
    ).map(([key, value]) => [key, formatUsd(value)]),
  );
  const marketTypeExposureUsd = Object.fromEntries(
    Array.from(
      input.scenario.legs.reduce((map, leg) => {
        map.set(
          leg.marketType,
          (map.get(leg.marketType) ?? 0) + readLegTargetUsd(leg),
        );
        return map;
      }, new Map<string, number>()),
    ).map(([key, value]) => [key, formatUsd(value)]),
  );
  const activeLegCount = legOutcomes.filter(
    (outcome) => outcome.status !== "not_applicable",
  ).length;

  const portfolioSummary = {
    capitalAllocatedUsd: formatUsd(capitalAllocatedUsd),
    grossExposureBudgetUsd: formatUsd(grossExposureBudgetUsd),
    equityUsd: formatUsd(capitalAllocatedUsd + netPnlUsd),
    availableUsd: formatUsd(
      Math.max(capitalAllocatedUsd + netPnlUsd - reservedUsd, 0),
    ),
    reservedUsd: formatUsd(reservedUsd),
    grossPnlUsd: formatUsd(grossPnlUsd),
    netPnlUsd: formatUsd(netPnlUsd),
    grossExposureUsd: formatUsd(grossExposureUsd),
    netExposureUsd: formatUsd(netExposureUsd),
    maxDrawdownBps: Math.round(readNumber(summaryMetrics.maxDrawdownBps)),
    tradeCount: summaryMetrics.tradeCount,
    activeLegCount,
    venueExposureUsd,
    venueFamilyExposureUsd,
    marketTypeExposureUsd,
    notes: [
      `Selected variant: ${selectedVariantSummary?.variantId ?? "none"}`,
      selectedVariantSummary?.holdoutMetrics
        ? "Portfolio summary is based on holdout metrics for the selected variant."
        : "Portfolio summary is based on selection metrics for the selected variant.",
    ],
  } satisfies NonNullable<
    RuntimeStrategyDeskScenarioReport["portfolioSummary"]
  >;

  const legMetrics = input.scenario.legs.map((leg, index) => ({
    legId: leg.legId,
    venueKey: leg.venueKey,
    intentFamily: leg.intentFamily,
    marketType: leg.marketType,
    status: legOutcomes[index]?.status ?? "not_applicable",
    targetNotionalUsd: formatUsd(readLegTargetUsd(leg)),
    reservedCapitalUsd: formatUsd(readLegReserveUsd(leg)),
    grossExposureUsd: formatUsd(readLegTargetUsd(leg)),
    netExposureUsd: formatUsd(readLegNetExposureUsd(leg)),
    ...(legOutcomes[index]?.netPnlUsd
      ? { netPnlUsd: legOutcomes[index].netPnlUsd }
      : {}),
    ...(legOutcomes[index]?.costUsd
      ? { costUsd: legOutcomes[index].costUsd }
      : {}),
    ...(legOutcomes[index]?.notes ? { notes: legOutcomes[index].notes } : {}),
  }));

  const scorecard = {
    aggregate: {
      passedLegCount: legOutcomes.filter((outcome) => outcome.status === "pass")
        .length,
      blockedLegCount: legOutcomes.filter(
        (outcome) => outcome.status === "blocked",
      ).length,
      skippedLegCount: legOutcomes.filter(
        (outcome) => outcome.status === "not_applicable",
      ).length,
      activeLegCount,
      tradeCount: summaryMetrics.tradeCount,
      reservedCapitalUsd: portfolioSummary.reservedUsd,
      grossExposureUsd: portfolioSummary.grossExposureUsd,
      netExposureUsd: portfolioSummary.netExposureUsd,
      grossPnlUsd: portfolioSummary.grossPnlUsd,
      netPnlUsd: portfolioSummary.netPnlUsd,
      totalCostUsd: formatUsd(totalCostUsd),
      maxDrawdownBps: portfolioSummary.maxDrawdownBps,
    },
    legMetrics,
  } satisfies NonNullable<RuntimeStrategyDeskScenarioReport["scorecard"]>;

  return { legOutcomes, scorecard, portfolioSummary };
}

async function runStudyCellLeg(input: {
  env: Env;
  scenario: RuntimeStrategyDeskScenarioManifest;
  scenarioRunId: string;
  runKind: StrategyDeskStudyRunKind;
  variant: StrategyDeskResearchMatrixVariant;
  window: StrategyDeskResearchMatrixWindow;
  legConfig: StrategyDeskResearchMatrixLeg;
  deps?: StrategyDeskStudyDeps;
}): Promise<StrategyDeskStudyLegResult> {
  const leg = scenarioLegById(input.scenario, input.legConfig.legId);
  const payload = mergeBacktestLegConfig({
    leg: input.legConfig,
    variant: input.variant,
    window: input.window,
  });
  const reportId = createDeskId(
    `desk_${input.scenario.scenarioId}_${input.variant.variantId}_${input.window.windowId}_${input.legConfig.legId}_${input.runKind ?? "study"}`,
    input.deps,
  );
  try {
    const result = await (input.deps?.runRuntimeBacktest ?? runRuntimeBacktest)(
      {
        env: input.env,
        payload: {
          ...payload,
          reportId,
        },
      },
    );
    if (!result.ok) {
      const reason = String(result.payload.error ?? "runtime-backtest-failed");
      return {
        legId: input.legConfig.legId,
        reportId,
        reproducibilityBundleId: `repro_${reportId}`,
        status: "failed",
        metrics: zeroMetrics(),
        blockingReasons: [reason],
      };
    }
    const report = parseRuntimeBacktestReport(
      (result.payload.report ?? result.payload) as Record<string, unknown>,
    );
    return {
      legId: input.legConfig.legId,
      reportId: report.reportId,
      reproducibilityBundleId: `repro_${report.reportId}`,
      status: report.status,
      metrics: report.aggregateMetrics,
      ...(report.aggregateBaselineComparisons.length > 0
        ? {
            baselineComparisons: report.aggregateBaselineComparisons,
          }
        : {}),
      ...(report.blockingReasons.length > 0
        ? { blockingReasons: report.blockingReasons }
        : {}),
    };
  } catch (error) {
    return {
      legId: leg.legId,
      reportId,
      reproducibilityBundleId: `repro_${reportId}`,
      status: "failed",
      metrics: zeroMetrics(),
      blockingReasons: [
        error instanceof Error ? error.message : "runtime-backtest-threw",
      ],
    };
  }
}

function selectVariantId(input: {
  variantSummaries: StrategyDeskStudyVariantSummary[];
  selectionMetric: StrategyDeskStudySelectionMetric;
}): string | undefined {
  let best: { variantId: string; value: number } | null = null;
  for (const summary of input.variantSummaries) {
    const value = studySelectionMetricValue({
      summary,
      metric: input.selectionMetric,
    });
    if (value === null) continue;
    if (!best || value > best.value + Number.EPSILON) {
      best = { variantId: summary.variantId, value };
    }
  }
  return best?.variantId;
}

export async function executeRuntimeStrategyDeskStudyWorkflow(
  input: RuntimeStrategyDeskStudyWorkflowInput,
  deps?: StrategyDeskStudyDeps,
): Promise<RuntimeStrategyDeskStudyWorkflowResult> {
  const { scenario } = await getRuntimeStrategyDeskScenarioWorkflow({
    env: input.env,
    scenarioId: input.scenarioId,
  });
  const researchMatrix = scenario.researchMatrix;
  if (!researchMatrix) {
    throw new Error(
      `runtime-strategy-desk-study-matrix-missing:${scenario.scenarioId}`,
    );
  }

  const windows = researchMatrix.windows.filter((window) =>
    !input.windowIds || input.windowIds.length === 0
      ? true
      : input.windowIds.includes(window.windowId),
  );
  const variants = researchMatrix.variants.filter((variant) =>
    !input.variantIds || input.variantIds.length === 0
      ? true
      : input.variantIds.includes(variant.variantId),
  );
  if (windows.length === 0) {
    throw new Error(
      `runtime-strategy-desk-study-window-selection-empty:${scenario.scenarioId}`,
    );
  }
  if (variants.length === 0) {
    throw new Error(
      `runtime-strategy-desk-study-variant-selection-empty:${scenario.scenarioId}`,
    );
  }

  for (const legConfig of researchMatrix.backtestLegs) {
    scenarioLegById(scenario, legConfig.legId);
  }

  const createdAt = nowIso(deps);
  let run = (
    await upsertRuntimeStrategyDeskScenarioRunWorkflow({
      env: input.env,
      run: {
        schemaVersion: scenario.schemaVersion,
        scenarioRunId:
          input.scenarioRunId ??
          createDeskId(
            `desk_run_${scenario.scenarioId}_${input.runKind}`,
            deps,
          ),
        scenarioId: scenario.scenarioId,
        scenarioState: scenario.state,
        runKind: input.runKind,
        state: "pending",
        requestedBy: input.requestedBy,
        trigger: {
          kind: "operator",
          source: "portal.strategy-desk-study",
          observedAt: createdAt,
          reason: `${input.runKind} matrix study`,
        },
        createdAt,
        updatedAt: createdAt,
        legRuns: scenario.legs.map((leg) => ({
          legId: leg.legId,
          stage: input.runKind,
          state: "pending",
          requestRef: `study:${leg.legId}`,
        })),
      },
    })
  ).run;

  const requestedAt = nowIso(deps);
  run = (
    await upsertRuntimeStrategyDeskScenarioRunWorkflow({
      env: input.env,
      run: {
        ...run,
        state: "legs_requested",
        updatedAt: requestedAt,
      },
    })
  ).run;

  const runningAt = nowIso(deps);
  run = (
    await upsertRuntimeStrategyDeskScenarioRunWorkflow({
      env: input.env,
      run: {
        ...run,
        state: "legs_running",
        startedAt: run.startedAt ?? runningAt,
        updatedAt: runningAt,
      },
    })
  ).run;

  const cells: StrategyDeskStudyCell[] = [];
  for (const variant of variants) {
    for (const window of windows) {
      const legResults: StrategyDeskStudyLegResult[] = [];
      for (const legConfig of researchMatrix.backtestLegs) {
        legResults.push(
          await runStudyCellLeg({
            env: input.env,
            scenario,
            scenarioRunId: run.scenarioRunId,
            runKind: input.runKind,
            variant,
            window,
            legConfig,
            deps,
          }),
        );
      }

      const aggregateMetricsResult = aggregateMetrics(
        legResults.map((result) => ({
          metrics: result.metrics,
          weight: matrixLegWeight(scenario, result.legId),
        })),
      );
      const aggregateBaselineComparisonResults = aggregateBaselineComparisons(
        legResults.map((result) => ({
          comparisons: result.baselineComparisons,
          weight: matrixLegWeight(scenario, result.legId),
        })),
      );
      const status: StrategyDeskBacktestStatus = legResults.some(
        (result) => result.status === "failed",
      )
        ? "failed"
        : legResults.some((result) => result.status === "blocked")
          ? "blocked"
          : "completed";

      cells.push({
        cellId: `${variant.variantId}:${window.windowId}`,
        variantId: variant.variantId,
        variantLabel: variant.label,
        windowId: window.windowId,
        windowLabel: window.label,
        cohort: window.cohort,
        status,
        legResults,
        aggregateMetrics: aggregateMetricsResult,
        ...(aggregateBaselineComparisonResults
          ? {
              aggregateBaselineComparisons: aggregateBaselineComparisonResults,
            }
          : {}),
        notes: [`window=${window.windowMode}`, `variant=${variant.variantId}`],
      });
    }
  }

  const collectingAt = nowIso(deps);
  run = (
    await upsertRuntimeStrategyDeskScenarioRunWorkflow({
      env: input.env,
      run: {
        ...run,
        state: "collecting_evidence",
        updatedAt: collectingAt,
      },
    })
  ).run;

  const selectionMetric =
    input.selectionMetric ??
    researchMatrix.selectionMetric ??
    DEFAULT_SELECTION_METRIC;
  const variantSummaries = variants.map((variant) =>
    buildVariantSummary({
      variant,
      cells: cells.filter((cell) => cell.variantId === variant.variantId),
    }),
  );
  const selectedVariantId = selectVariantId({
    variantSummaries,
    selectionMetric,
  });
  const studyMatrix: StrategyDeskStudyMatrix = {
    matrixId: createDeskId(
      `desk_matrix_${scenario.scenarioId}_${input.runKind}`,
      deps,
    ),
    runKind: input.runKind,
    selectionMetric,
    generatedAt: nowIso(deps),
    ...(selectedVariantId ? { selectedVariantId } : {}),
    windows: windows.map<StrategyDeskStudyWindow>((window) => ({
      windowId: window.windowId,
      label: window.label,
      cohort: window.cohort,
    })),
    variantSummaries,
    cells,
  };

  const { legOutcomes, scorecard, portfolioSummary } = summarizeScenarioLegs({
    scenario,
    studyMatrix,
  });
  const blockedCells = cells.filter((cell) => cell.status !== "completed");
  const holdoutWindowCount = windows.filter(
    (window) => window.cohort === "holdout",
  ).length;
  const selectedVariant = variantSummaries.find(
    (summary) => summary.variantId === selectedVariantId,
  );
  const checks: RuntimeStrategyDeskScenarioReport["checks"] = [
    {
      checkId: "matrix-generated",
      status: "pass",
      observedValue: `${variants.length} variants x ${windows.length} windows`,
      thresholdValue: "at least one variant and one window",
      message: "Composite study matrix generated successfully.",
    },
    {
      checkId: "holdout-coverage",
      status: holdoutWindowCount > 0 ? "pass" : "requires_human_approval",
      observedValue: String(holdoutWindowCount),
      thresholdValue: ">= 1",
      message:
        holdoutWindowCount > 0
          ? "Holdout windows are present for out-of-sample comparison."
          : "No holdout windows are configured, so selection performance is in-sample only.",
    },
    {
      checkId: "variant-selection",
      status: selectedVariantId ? "pass" : "blocked",
      observedValue: selectedVariantId ?? "none",
      thresholdValue: "selected variant id",
      message: selectedVariantId
        ? "A study winner was selected from the configured matrix."
        : "No variant could be selected from the configured matrix.",
    },
  ];

  const reportStatus: RuntimeStrategyDeskScenarioReport["status"] =
    blockedCells.length > 0 || !selectedVariantId
      ? "blocked"
      : holdoutWindowCount === 0
        ? "requires_human_approval"
        : "pass";
  const completedAt = nowIso(deps);
  const reportId =
    input.reportId ??
    createDeskId(`desk_report_${scenario.scenarioId}_${input.runKind}`, deps);
  const reproducibilityRefs = Array.from(
    new Set(
      cells
        .filter((cell) =>
          selectedVariantId ? cell.variantId === selectedVariantId : true,
        )
        .flatMap((cell) =>
          cell.legResults.map((result) => result.reproducibilityBundleId),
        ),
    ),
  ).slice(0, 12);
  const report = (
    await upsertRuntimeStrategyDeskScenarioReportWorkflow({
      env: input.env,
      report: {
        schemaVersion: scenario.schemaVersion,
        reportId,
        scenarioId: scenario.scenarioId,
        scenarioRunId: run.scenarioRunId,
        stage: input.runKind,
        status: reportStatus,
        summary:
          reportStatus === "blocked"
            ? `Composite ${input.runKind} study found ${blockedCells.length} blocked or failed matrix cells.`
            : reportStatus === "requires_human_approval"
              ? `Composite ${input.runKind} study completed without holdout coverage and requires operator review.`
              : `Composite ${input.runKind} study completed with ${variants.length} variants across ${windows.length} windows.`,
        generatedAt: completedAt,
        legOutcomes,
        portfolioSummary,
        scorecard,
        studyMatrix,
        evidence: upsertStageEvidenceBucket({
          scenario,
          runKind: input.runKind,
          reportId,
          selectedVariantId,
          reproducibilityRefs,
        }),
        checks,
        approvals: [],
        metadata: {
          selectionMetric,
          blockedCellCount: blockedCells.length,
          selectedVariantLabel: selectedVariant?.label ?? null,
        },
      },
    })
  ).report;

  const legRuns = scenario.legs.map((leg) => {
    const hasBacktestConfig = researchMatrix.backtestLegs.some(
      (config) => config.legId === leg.legId,
    );
    if (!hasBacktestConfig) {
      return {
        legId: leg.legId,
        stage: input.runKind,
        state: "skipped" as const,
        requestRef: `study:${leg.legId}`,
        notes: "No study matrix config defined for this leg.",
      };
    }
    const selectedLegCells = cells.filter((cell) =>
      selectedVariantId ? cell.variantId === selectedVariantId : true,
    );
    const states = selectedLegCells.flatMap((cell) =>
      cell.legResults
        .filter((result) => result.legId === leg.legId)
        .map((result) => result.status),
    );
    const state = states.some((status) => status !== "completed")
      ? "failed"
      : "completed";
    return {
      legId: leg.legId,
      stage: input.runKind,
      state,
      requestRef: `study:${leg.legId}`,
      notes: buildLegRunNotes({
        variantCount: variants.length,
        windowCount: windows.length,
        selectedVariantIds: selectedVariantId ? [selectedVariantId] : [],
      }),
    };
  });

  const terminalState: RuntimeStrategyDeskScenarioRun["state"] =
    report.status === "blocked"
      ? "rejected"
      : report.status === "requires_human_approval"
        ? "needs_review"
        : "completed";
  run = (
    await upsertRuntimeStrategyDeskScenarioRunWorkflow({
      env: input.env,
      run: {
        ...run,
        state: terminalState,
        updatedAt: completedAt,
        completedAt,
        legRuns,
        ...(report.status === "blocked"
          ? {
              failureCode: "strategy-desk-study-blocked",
              failureMessage: report.summary,
            }
          : {}),
        metadata: {
          ...(run.metadata ?? {}),
          latestReportId: report.reportId,
          selectedVariantId,
          variantCount: variants.length,
          windowCount: windows.length,
        },
      },
    })
  ).run;

  return {
    scenario,
    run,
    report,
  };
}
