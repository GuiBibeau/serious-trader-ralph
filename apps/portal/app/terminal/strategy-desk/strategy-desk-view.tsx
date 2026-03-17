"use client";

import Link from "next/link";
import type {
  RuntimeStrategyDeskPromotionHandoff,
  RuntimeStrategyDeskScenarioReport,
  RuntimeStrategyDeskScenarioRun,
} from "../../../lib/runtime-strategy-desk";
import { BTN_PRIMARY, BTN_SECONDARY, formatTick } from "../../lib";
import {
  type StrategyDeskApiPayload,
  type StrategyDeskExecuteRunKind,
  type StrategyDeskStudyRunKind,
  type StrategyDeskStudySelectionMetric,
  selectStrategyDeskFocusHandoff,
  selectStrategyDeskHandoffForAction,
} from "./types";

type StrategyDeskViewProps = {
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  payload: StrategyDeskApiPayload | null;
  editorValue: string;
  walletAddress: string;
  actionPending: string | null;
  onRefresh?: () => void;
  onSelectScenario?: (scenarioId: string) => void;
  onEditorChange?: (value: string) => void;
  onTitleChange?: (value: string) => void;
  onSummaryChange?: (value: string) => void;
  onWalletAddressChange?: (value: string) => void;
  onResetEditor?: () => void;
  onSaveScenario?: () => void;
  onRunStudy?: (
    runKind: StrategyDeskStudyRunKind,
    selectionMetric?: StrategyDeskStudySelectionMetric,
  ) => void;
  onRunExecute?: (runKind: StrategyDeskExecuteRunKind) => void;
  onPrepareHandoff?: () => void;
  onTransitionHandoff?: (
    action:
      | "submit"
      | "approve"
      | "reject"
      | "apply"
      | "pause"
      | "kill"
      | "demote"
      | "archive",
  ) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> =>
    isRecord(entry),
  );
}

function statusClasses(status: string | null): string {
  switch (status) {
    case "healthy":
    case "pass":
    case "success":
    case "completed":
    case "paper_ready":
    case "shadow_ready":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
    case "requires_human_approval":
    case "blocked":
    case "needs_review":
    case "paper":
    case "shadow":
    case "replay":
    case "backtest":
      return "border-amber-500/40 bg-amber-500/10 text-amber-200";
    case "rejected":
    case "failed":
    case "killed":
      return "border-rose-500/40 bg-rose-500/10 text-rose-200";
    default:
      return "border-border bg-surface text-muted";
  }
}

function renderBadge(status: string | null, label?: string) {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${statusClasses(
        status,
      )}`}
    >
      {(label ?? status ?? "unknown").replaceAll("_", " ")}
    </span>
  );
}

function formatMoney(value: unknown): string {
  const numeric = Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return "--";
  return `$${numeric.toFixed(2)}`;
}

function formatBps(value: unknown): string {
  const numeric = Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return "--";
  return `${numeric.toFixed(2)} bps`;
}

function summaryItem(label: string, value: string) {
  return (
    <div className="rounded border border-border bg-surface/80 p-3">
      <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-ink">{value}</p>
    </div>
  );
}

function collectReproducibilityRefs(
  report: RuntimeStrategyDeskScenarioReport | null,
): string[] {
  const studyMatrix = isRecord(report?.studyMatrix) ? report?.studyMatrix : {};
  const cells = readRecordArray(studyMatrix.cells);
  const refs = new Set<string>();
  for (const cell of cells) {
    for (const legResult of readRecordArray(cell.legResults)) {
      const ref = readString(legResult.reproducibilityBundleId);
      if (ref) refs.add(ref);
    }
  }
  return [...refs];
}

export function buildRunComparison(
  runs: RuntimeStrategyDeskScenarioRun[],
  reports: RuntimeStrategyDeskScenarioReport[],
) {
  const reportsByRunId = new Map(
    reports.map((report) => [report.scenarioRunId, report] as const),
  );
  return runs.map((run) => {
    const report = reportsByRunId.get(run.scenarioRunId) ?? null;
    const portfolio = isRecord(report?.portfolioSummary)
      ? report.portfolioSummary
      : {};
    const studyMatrix = isRecord(report?.studyMatrix) ? report.studyMatrix : {};
    const scorecard = isRecord(report?.scorecard) ? report.scorecard : {};
    const scorecardAggregate = isRecord(scorecard.aggregate)
      ? scorecard.aggregate
      : {};
    return {
      scenarioRunId: run.scenarioRunId,
      runKind: run.runKind,
      runState: run.state,
      reportStatus: report?.status ?? null,
      generatedAt: report?.generatedAt ?? run.updatedAt,
      netPnlUsd:
        readString(portfolio.netPnlUsd) ??
        readString(scorecardAggregate.netPnlUsd) ??
        readString(scorecard.netPnlUsd),
      maxDrawdownBps: readString(portfolio.maxDrawdownBps),
      selectedVariantId: readString(studyMatrix.selectedVariantId),
    };
  });
}

export function strategyDeskVariantRowKey(
  variant: Record<string, unknown>,
  index: number,
): string {
  return (
    readString(variant.variantId) ??
    readString(variant.label) ??
    `variant-${index}`
  );
}

function reportForDisplay(
  latestReport: RuntimeStrategyDeskScenarioReport | null,
  reports: RuntimeStrategyDeskScenarioReport[],
) {
  return latestReport ?? reports[0] ?? null;
}

function readCheckStatusCounts(
  handoff: RuntimeStrategyDeskPromotionHandoff | null,
) {
  let pass = 0;
  let blocked = 0;
  let human = 0;
  for (const check of readRecordArray(handoff?.checks)) {
    const status = readString(check.status);
    if (status === "pass") pass += 1;
    if (status === "blocked") blocked += 1;
    if (status === "requires_human_approval") human += 1;
  }
  return { pass, blocked, human };
}

export function StrategyDeskView({
  authenticated,
  loading,
  error,
  payload,
  editorValue,
  walletAddress,
  actionPending,
  onRefresh,
  onSelectScenario,
  onEditorChange,
  onTitleChange,
  onSummaryChange,
  onWalletAddressChange,
  onResetEditor,
  onSaveScenario,
  onRunStudy,
  onRunExecute,
  onPrepareHandoff,
  onTransitionHandoff,
}: StrategyDeskViewProps) {
  const snapshot = payload?.snapshot ?? null;
  const selectedScenario = snapshot?.selectedScenario ?? null;
  const latestRun = snapshot?.latestRun ?? null;
  const latestReport = reportForDisplay(
    snapshot?.latestReport ?? null,
    snapshot?.reports ?? [],
  );
  const latestHandoff = selectStrategyDeskFocusHandoff(snapshot);
  const submitHandoff = selectStrategyDeskHandoffForAction(snapshot, "submit");
  const approveHandoff = selectStrategyDeskHandoffForAction(
    snapshot,
    "approve",
  );
  const applyHandoff = selectStrategyDeskHandoffForAction(snapshot, "apply");
  const pauseHandoff = selectStrategyDeskHandoffForAction(snapshot, "pause");
  const killHandoff = selectStrategyDeskHandoffForAction(snapshot, "kill");
  const demoteHandoff = selectStrategyDeskHandoffForAction(snapshot, "demote");
  const comparison = buildRunComparison(
    snapshot?.runs ?? [],
    snapshot?.reports ?? [],
  );
  const reproducibilityRefs = collectReproducibilityRefs(latestReport);
  const handoffCheckCounts = readCheckStatusCounts(latestHandoff);

  let draftScenario: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(editorValue) as unknown;
    if (isRecord(parsed)) draftScenario = parsed;
  } catch {
    draftScenario = null;
  }
  const draftTitle =
    readString(draftScenario?.title) ?? selectedScenario?.title ?? "";
  const draftSummary =
    readString(draftScenario?.summary) ?? selectedScenario?.summary ?? "";
  const selectedScenarioSummary = isRecord(selectedScenario?.riskLimits)
    ? selectedScenario.riskLimits
    : {};
  const studyMatrix = isRecord(latestReport?.studyMatrix)
    ? latestReport?.studyMatrix
    : {};
  const variantSummaries = readRecordArray(studyMatrix.variantSummaries);
  const latestPortfolio = isRecord(latestReport?.portfolioSummary)
    ? latestReport.portfolioSummary
    : {};

  if (!authenticated) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="rounded border border-border bg-paper/80 p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Strategy desk
              </p>
              <h1 className="mt-3 text-2xl font-semibold text-ink">
                Composite research and bounded execution surface
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-muted">
                Sign in with an operator account to author scenarios, launch
                replay or paper runs, and inspect promotion readiness.
              </p>
            </div>
            <div className="flex gap-3">
              <Link className={BTN_PRIMARY} href="/login">
                Sign in
              </Link>
              <Link className={BTN_SECONDARY} href="/terminal">
                Terminal
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main
      className="mx-auto max-w-[1600px] px-6 py-8"
      data-testid="strategy-desk-page"
    >
      <section className="rounded border border-border bg-paper/80 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
              Strategy desk
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-ink">
              Author composite scenarios, test them, then decide whether to arm
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted">
              This desk sits above the harness-native execution fabric. It keeps
              scenario authoring, replay and paper evidence, per-leg
              diagnostics, and promotion-readiness in one operator surface.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className={BTN_SECONDARY} onClick={onRefresh} type="button">
              Refresh
            </button>
            <Link className={BTN_SECONDARY} href="/terminal/runtime">
              Runtime ops
            </Link>
            <Link className={BTN_PRIMARY} href="/proof/strategy-desk">
              Proof route
            </Link>
          </div>
        </div>
        {error ? (
          <div className="mt-4 rounded border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <article className="rounded border border-border bg-surface/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  Scenarios
                </p>
                <h2 className="mt-2 text-sm font-medium text-ink">
                  Composite registry
                </h2>
              </div>
              {renderBadge(
                selectedScenario?.state ?? null,
                selectedScenario?.state ?? "none",
              )}
            </div>
            <div
              className="mt-4 space-y-3"
              data-testid="strategy-desk-scenario-list"
            >
              {(snapshot?.scenarios ?? []).length === 0 ? (
                <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
                  No scenarios loaded yet. Save the draft on the right to seed
                  the desk.
                </div>
              ) : (
                (snapshot?.scenarios ?? []).map((scenario) => {
                  const isSelected =
                    scenario.scenarioId === snapshot?.selectedScenarioId;
                  return (
                    <button
                      key={scenario.scenarioId}
                      className={`w-full rounded border px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? "border-accent bg-accent/10"
                          : "border-border bg-paper/70 hover:bg-paper"
                      }`}
                      onClick={() => onSelectScenario?.(scenario.scenarioId)}
                      type="button"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-ink">
                          {scenario.title}
                        </p>
                        {renderBadge(scenario.state)}
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {scenario.strategyKey}
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        {scenario.legs.length} legs · updated{" "}
                        {formatTick(scenario.updatedAt)}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </article>

          <article className="rounded border border-border bg-surface/80 p-4">
            <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
              Selected scenario
            </p>
            <h2 className="mt-2 text-sm font-medium text-ink">
              {selectedScenario?.scenarioId ?? "draft"}
            </h2>
            <div className="mt-4 grid gap-3">
              {summaryItem(
                "Reserved cap",
                formatMoney(selectedScenarioSummary.maxReservedCapitalUsd),
              )}
              {summaryItem(
                "Gross cap",
                formatMoney(selectedScenarioSummary.maxGrossExposureUsd),
              )}
              {summaryItem(
                "Net cap",
                formatMoney(selectedScenarioSummary.maxNetExposureUsd),
              )}
              {summaryItem(
                "Leg count",
                String(selectedScenario?.legs.length ?? 0),
              )}
            </div>
          </article>
        </aside>

        <div className="space-y-6">
          <article className="rounded border border-border bg-surface/80 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  Author scenario
                </p>
                <h2 className="mt-2 text-lg font-medium text-ink">
                  Edit the composite manifest, then persist it through the
                  harness-backed registry
                </h2>
              </div>
              <div className="flex gap-3">
                <button
                  className={BTN_SECONDARY}
                  onClick={onResetEditor}
                  type="button"
                >
                  Reset draft
                </button>
                <button
                  className={BTN_PRIMARY}
                  data-testid="strategy-desk-save-scenario"
                  disabled={actionPending === "upsert_scenario"}
                  onClick={onSaveScenario}
                  type="button"
                >
                  {actionPending === "upsert_scenario"
                    ? "Saving..."
                    : "Save scenario"}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.24em] text-muted">
                  Title
                </span>
                <input
                  className="mt-2 w-full rounded border border-border bg-paper px-3 py-2 text-sm text-ink"
                  data-testid="strategy-desk-title-input"
                  onChange={(event) => onTitleChange?.(event.target.value)}
                  value={draftTitle}
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.24em] text-muted">
                  Operator wallet
                </span>
                <input
                  className="mt-2 w-full rounded border border-border bg-paper px-3 py-2 text-sm text-ink"
                  data-testid="strategy-desk-wallet-input"
                  onChange={(event) =>
                    onWalletAddressChange?.(event.target.value)
                  }
                  placeholder="11111111111111111111111111111111"
                  value={walletAddress}
                />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="text-[10px] uppercase tracking-[0.24em] text-muted">
                Summary
              </span>
              <textarea
                className="mt-2 min-h-[88px] w-full rounded border border-border bg-paper px-3 py-2 text-sm text-ink"
                data-testid="strategy-desk-summary-input"
                onChange={(event) => onSummaryChange?.(event.target.value)}
                value={draftSummary}
              />
            </label>

            <label className="mt-4 block">
              <span className="text-[10px] uppercase tracking-[0.24em] text-muted">
                Full scenario manifest
              </span>
              <textarea
                className="mt-2 min-h-[420px] w-full rounded border border-border bg-[#091017] px-4 py-3 font-mono text-xs leading-6 text-slate-100"
                data-testid="strategy-desk-scenario-editor"
                onChange={(event) => onEditorChange?.(event.target.value)}
                value={editorValue}
              />
            </label>
          </article>

          <article className="rounded border border-border bg-surface/80 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  Run controls
                </p>
                <h2 className="mt-2 text-lg font-medium text-ink">
                  Launch study, shadow, and paper flows
                </h2>
                <p className="mt-2 text-sm text-muted">
                  Study runs compare parameter variants across windows. Shadow
                  and paper runs hit the harness-backed composite runner using
                  the selected scenario and wallet binding.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  className={BTN_SECONDARY}
                  data-testid="strategy-desk-run-replay"
                  disabled={
                    actionPending === "study:replay" || !selectedScenario
                  }
                  onClick={() =>
                    onRunStudy?.("replay", "excess_vs_flat_cash_bps")
                  }
                  type="button"
                >
                  {actionPending === "study:replay"
                    ? "Running replay..."
                    : "Run replay study"}
                </button>
                <button
                  className={BTN_PRIMARY}
                  data-testid="strategy-desk-run-backtest"
                  disabled={
                    actionPending === "study:backtest" || !selectedScenario
                  }
                  onClick={() =>
                    onRunStudy?.("backtest", "excess_vs_flat_cash_bps")
                  }
                  type="button"
                >
                  {actionPending === "study:backtest"
                    ? "Running backtest..."
                    : "Run backtest study"}
                </button>
                <button
                  className={BTN_SECONDARY}
                  data-testid="strategy-desk-run-shadow"
                  disabled={
                    actionPending === "execute:shadow" || !selectedScenario
                  }
                  onClick={() => onRunExecute?.("shadow")}
                  type="button"
                >
                  {actionPending === "execute:shadow"
                    ? "Running shadow..."
                    : "Run shadow"}
                </button>
                <button
                  className={BTN_PRIMARY}
                  data-testid="strategy-desk-run-paper"
                  disabled={
                    actionPending === "execute:paper" || !selectedScenario
                  }
                  onClick={() => onRunExecute?.("paper")}
                  type="button"
                >
                  {actionPending === "execute:paper"
                    ? "Running paper..."
                    : "Run paper"}
                </button>
              </div>
            </div>
          </article>

          <article
            className="rounded border border-border bg-surface/80 p-5"
            data-testid="strategy-desk-bounded-execution"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  Bounded execution
                </p>
                <h2 className="mt-2 text-lg font-medium text-ink">
                  Review, arm, and roll back from the desk
                </h2>
                <p className="mt-2 text-sm text-muted">
                  Prepare a bounded handoff from the current paper evidence,
                  then move it through explicit operator review before applying
                  or rolling it back.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={BTN_SECONDARY}
                  data-testid="strategy-desk-prepare-handoff"
                  disabled={
                    actionPending === "handoff:prepare" || !selectedScenario
                  }
                  onClick={onPrepareHandoff}
                  type="button"
                >
                  {actionPending === "handoff:prepare"
                    ? "Preparing..."
                    : "Prepare handoff"}
                </button>
                <button
                  className={BTN_SECONDARY}
                  data-testid="strategy-desk-submit-handoff"
                  disabled={
                    actionPending === "handoff:submit" || !submitHandoff
                  }
                  onClick={() => onTransitionHandoff?.("submit")}
                  type="button"
                >
                  {actionPending === "handoff:submit"
                    ? "Submitting..."
                    : "Submit review"}
                </button>
                <button
                  className={BTN_SECONDARY}
                  data-testid="strategy-desk-approve-handoff"
                  disabled={
                    actionPending === "handoff:approve" || !approveHandoff
                  }
                  onClick={() => onTransitionHandoff?.("approve")}
                  type="button"
                >
                  {actionPending === "handoff:approve"
                    ? "Approving..."
                    : "Approve"}
                </button>
                <button
                  className={BTN_PRIMARY}
                  data-testid="strategy-desk-apply-handoff"
                  disabled={actionPending === "handoff:apply" || !applyHandoff}
                  onClick={() => onTransitionHandoff?.("apply")}
                  type="button"
                >
                  {actionPending === "handoff:apply"
                    ? "Arming..."
                    : "Arm bounded execution"}
                </button>
                <button
                  className={BTN_SECONDARY}
                  data-testid="strategy-desk-pause-handoff"
                  disabled={actionPending === "handoff:pause" || !pauseHandoff}
                  onClick={() => onTransitionHandoff?.("pause")}
                  type="button"
                >
                  {actionPending === "handoff:pause" ? "Pausing..." : "Pause"}
                </button>
                <button
                  className={BTN_SECONDARY}
                  data-testid="strategy-desk-kill-handoff"
                  disabled={actionPending === "handoff:kill" || !killHandoff}
                  onClick={() => onTransitionHandoff?.("kill")}
                  type="button"
                >
                  {actionPending === "handoff:kill" ? "Killing..." : "Kill"}
                </button>
                <button
                  className={BTN_SECONDARY}
                  data-testid="strategy-desk-demote-handoff"
                  disabled={
                    actionPending === "handoff:demote" || !demoteHandoff
                  }
                  onClick={() => onTransitionHandoff?.("demote")}
                  type="button"
                >
                  {actionPending === "handoff:demote"
                    ? "Demoting..."
                    : "Demote to paper"}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summaryItem(
                "Latest handoff",
                latestHandoff?.handoffId ?? "none",
              )}
              {summaryItem("Status", latestHandoff?.status ?? "--")}
              {summaryItem(
                "Approvals",
                String(readRecordArray(latestHandoff?.approvals).length),
              )}
              {summaryItem(
                "Materialized recipes",
                String(snapshot?.executionRecipes.length ?? 0),
              )}
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div className="rounded border border-border bg-paper/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.24em] text-muted">
                      Handoff summary
                    </p>
                    <h3 className="mt-2 text-sm font-medium text-ink">
                      {latestHandoff?.summary ??
                        "No bounded execution handoff prepared yet."}
                    </h3>
                  </div>
                  <div className="flex gap-2">
                    {renderBadge(latestHandoff?.status ?? null)}
                    {renderBadge(latestHandoff?.targetMode ?? null)}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {summaryItem(
                    "Passed checks",
                    String(handoffCheckCounts.pass),
                  )}
                  {summaryItem(
                    "Blocked checks",
                    String(handoffCheckCounts.blocked),
                  )}
                  {summaryItem("Human gates", String(handoffCheckCounts.human))}
                </div>
                <div className="mt-4 space-y-3">
                  {readRecordArray(latestHandoff?.checks).length === 0 ? (
                    <p className="text-sm text-muted">
                      Prepare a bounded handoff to surface checks and actions.
                    </p>
                  ) : (
                    readRecordArray(latestHandoff?.checks).map((check) => (
                      <div
                        key={`${readString(check.checkId) ?? "check"}-${readString(check.status) ?? "status"}`}
                        className="rounded border border-border bg-surface/80 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-ink">
                            {readString(check.checkId) ?? "check"}
                          </p>
                          {renderBadge(readString(check.status))}
                        </div>
                        <p className="mt-2 text-xs text-muted">
                          {readString(check.message) ?? "No message"}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded border border-border bg-paper/70 p-4">
                <p className="text-[10px] uppercase tracking-[0.24em] text-muted">
                  Bindings and control timeline
                </p>
                <div
                  className="mt-3 space-y-3"
                  data-testid="strategy-desk-handoff-bindings"
                >
                  {readRecordArray(latestHandoff?.bindings).length === 0 ? (
                    <p className="text-sm text-muted">
                      No bindings materialized yet.
                    </p>
                  ) : (
                    readRecordArray(latestHandoff?.bindings).map((binding) => (
                      <div
                        key={
                          readString(binding.bindingId) ??
                          `${readString(binding.venueKey) ?? "binding"}-${readString(binding.instrumentId) ?? readString(isRecord(binding.pair) ? binding.pair.symbol : null) ?? "target"}`
                        }
                        className="rounded border border-border bg-surface/80 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-ink">
                            {readString(binding.bindingId) ?? "binding"}
                          </p>
                          <div className="flex gap-2">
                            {renderBadge(readString(binding.bindingKind))}
                            {renderBadge(readString(binding.targetMode))}
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-muted">
                          {readString(binding.venueKey) ?? "venue"} ·{" "}
                          {readString(binding.instrumentId) ??
                            readString(
                              isRecord(binding.pair)
                                ? binding.pair.symbol
                                : null,
                            ) ??
                            "pair"}
                        </p>
                      </div>
                    ))
                  )}
                  {snapshot?.handoffEvents.length ? (
                    <div className="rounded border border-border bg-surface/80 p-3">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-muted">
                        Timeline
                      </p>
                      <div className="mt-2 space-y-2">
                        {snapshot.handoffEvents.map((event) => (
                          <div
                            className="rounded border border-border/60 bg-paper/60 p-2"
                            key={event.eventId}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium text-ink">
                                {event.eventType}
                              </p>
                              <p className="text-[11px] text-muted">
                                {formatTick(event.createdAt)}
                              </p>
                            </div>
                            <p className="mt-1 text-xs text-muted">
                              {event.summary}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </article>

          <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <article
              className="rounded border border-border bg-surface/80 p-5"
              data-testid="strategy-desk-report-summary"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                    Latest report
                  </p>
                  <h2 className="mt-2 text-lg font-medium text-ink">
                    {latestReport?.reportId ?? "No report yet"}
                  </h2>
                </div>
                <div className="flex gap-2">
                  {renderBadge(latestReport?.stage ?? null)}
                  {renderBadge(latestReport?.status ?? null)}
                </div>
              </div>
              <p className="mt-3 text-sm text-muted">
                {latestReport?.summary ??
                  "Run a backtest, replay, shadow, or paper workflow to populate the report surface."}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summaryItem("Net PnL", formatMoney(latestPortfolio.netPnlUsd))}
                {summaryItem(
                  "Gross exposure",
                  formatMoney(latestPortfolio.grossExposureUsd),
                )}
                {summaryItem(
                  "Max drawdown",
                  formatBps(latestPortfolio.maxDrawdownBps),
                )}
                {summaryItem(
                  "Latest run",
                  latestRun
                    ? `${latestRun.runKind} · ${latestRun.state}`
                    : "none",
                )}
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                <div className="rounded border border-border bg-paper/70 p-4">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-muted">
                    Per-leg outcomes
                  </p>
                  <div
                    className="mt-3 space-y-3"
                    data-testid="strategy-desk-leg-outcomes"
                  >
                    {readRecordArray(latestReport?.legOutcomes).length === 0 ? (
                      <p className="text-sm text-muted">
                        No leg outcomes recorded yet.
                      </p>
                    ) : (
                      readRecordArray(latestReport?.legOutcomes).map(
                        (outcome) => (
                          <div
                            key={`${readString(outcome.legId) ?? "leg"}-${readString(outcome.status) ?? "unknown"}`}
                            className="rounded border border-border bg-surface/80 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium text-ink">
                                {readString(outcome.legId) ?? "leg"}
                              </p>
                              {renderBadge(readString(outcome.status))}
                            </div>
                            <p className="mt-2 text-xs text-muted">
                              PnL {formatMoney(outcome.netPnlUsd)} · Cost{" "}
                              {formatMoney(outcome.costUsd)}
                            </p>
                          </div>
                        ),
                      )
                    )}
                  </div>
                </div>

                <div className="rounded border border-border bg-paper/70 p-4">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-muted">
                    Risk overlays
                  </p>
                  <div className="mt-3 space-y-3">
                    {readRecordArray(latestReport?.riskOverlays).length ===
                    0 ? (
                      <p className="text-sm text-muted">
                        No overlays recorded yet.
                      </p>
                    ) : (
                      readRecordArray(latestReport?.riskOverlays).map(
                        (overlay) => (
                          <div
                            key={`${readString(overlay.overlayId) ?? "overlay"}-${readString(overlay.status) ?? "unknown"}`}
                            className="rounded border border-border bg-surface/80 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium text-ink">
                                {readString(overlay.overlayId) ?? "overlay"}
                              </p>
                              {renderBadge(readString(overlay.status))}
                            </div>
                            <p className="mt-2 text-xs text-muted">
                              {readString(overlay.message) ?? "No message"}
                            </p>
                          </div>
                        ),
                      )
                    )}
                  </div>
                </div>
              </div>
            </article>

            <article className="rounded border border-border bg-surface/80 p-5">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Run history
              </p>
              <h2 className="mt-2 text-lg font-medium text-ink">
                Compare study, shadow, and paper outcomes
              </h2>
              <div
                className="mt-4 overflow-x-auto"
                data-testid="strategy-desk-run-history"
              >
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[10px] uppercase tracking-[0.24em] text-muted">
                    <tr>
                      <th className="pb-2 pr-4">Run</th>
                      <th className="pb-2 pr-4">State</th>
                      <th className="pb-2 pr-4">Report</th>
                      <th className="pb-2 pr-4">Net</th>
                      <th className="pb-2 pr-4">Drawdown</th>
                      <th className="pb-2">Variant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.length === 0 ? (
                      <tr>
                        <td className="py-3 text-muted" colSpan={6}>
                          No run history yet.
                        </td>
                      </tr>
                    ) : (
                      comparison.map((row) => (
                        <tr
                          className="border-t border-border/60"
                          key={row.scenarioRunId}
                        >
                          <td className="py-3 pr-4 text-ink">{row.runKind}</td>
                          <td className="py-3 pr-4">
                            {renderBadge(row.runState)}
                          </td>
                          <td className="py-3 pr-4">
                            {row.reportStatus
                              ? renderBadge(row.reportStatus)
                              : "--"}
                          </td>
                          <td className="py-3 pr-4 text-muted">
                            {formatMoney(row.netPnlUsd)}
                          </td>
                          <td className="py-3 pr-4 text-muted">
                            {formatBps(row.maxDrawdownBps)}
                          </td>
                          <td className="py-3 text-muted">
                            {row.selectedVariantId ?? "--"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <article
              className="rounded border border-border bg-surface/80 p-5"
              data-testid="strategy-desk-variant-table"
            >
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Study comparison
              </p>
              <h2 className="mt-2 text-lg font-medium text-ink">
                Parameter variants and holdout posture
              </h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-[10px] uppercase tracking-[0.24em] text-muted">
                    <tr>
                      <th className="pb-2 pr-4">Variant</th>
                      <th className="pb-2 pr-4">Selection</th>
                      <th className="pb-2 pr-4">Holdout</th>
                      <th className="pb-2 pr-4">Excess</th>
                      <th className="pb-2">Selected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variantSummaries.length === 0 ? (
                      <tr>
                        <td className="py-3 text-muted" colSpan={5}>
                          Run a replay or backtest study to compare variants.
                        </td>
                      </tr>
                    ) : (
                      variantSummaries.map((variant, index) => {
                        const selectionMetrics = isRecord(
                          variant.selectionMetrics,
                        )
                          ? variant.selectionMetrics
                          : {};
                        const holdoutMetrics = isRecord(variant.holdoutMetrics)
                          ? variant.holdoutMetrics
                          : {};
                        const baseline =
                          readRecordArray(
                            variant.selectionBaselineComparisons,
                          )[0] ?? null;
                        return (
                          <tr
                            className="border-t border-border/60"
                            key={strategyDeskVariantRowKey(variant, index)}
                          >
                            <td className="py-3 pr-4 text-ink">
                              {readString(variant.label) ??
                                readString(variant.variantId) ??
                                "variant"}
                            </td>
                            <td className="py-3 pr-4 text-muted">
                              {formatBps(selectionMetrics.netReturnBps)}
                            </td>
                            <td className="py-3 pr-4 text-muted">
                              {formatBps(holdoutMetrics.netReturnBps)}
                            </td>
                            <td className="py-3 pr-4 text-muted">
                              {formatBps(baseline?.excessReturnBps)}
                            </td>
                            <td className="py-3">
                              {readString(studyMatrix.selectedVariantId) ===
                              readString(variant.variantId)
                                ? renderBadge("pass", "selected")
                                : "--"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="rounded border border-border bg-surface/80 p-5">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Evidence and reproducibility
              </p>
              <h2 className="mt-2 text-lg font-medium text-ink">
                Promotion context for the selected scenario
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {summaryItem(
                  "Latest report",
                  latestReport?.reportId ??
                    selectedScenario?.latestReportId ??
                    "--",
                )}
                {summaryItem(
                  "Repro refs",
                  reproducibilityRefs.length > 0
                    ? String(reproducibilityRefs.length)
                    : "0",
                )}
              </div>

              <div className="mt-4 rounded border border-border bg-paper/70 p-4">
                <p className="text-[10px] uppercase tracking-[0.24em] text-muted">
                  Evidence refs
                </p>
                <div className="mt-3 space-y-2">
                  {readRecordArray(latestReport?.evidence).length === 0 &&
                  reproducibilityRefs.length === 0 ? (
                    <p className="text-sm text-muted">
                      Evidence will appear here after the first successful run.
                    </p>
                  ) : (
                    <>
                      {readRecordArray(latestReport?.evidence).map((entry) => (
                        <div
                          className="rounded border border-border bg-surface/80 p-3 text-xs text-muted"
                          key={`${readString(entry.stage) ?? "stage"}-${readString(entry.latestReportId) ?? readString(entry.summary) ?? "summary"}`}
                        >
                          <p className="font-medium text-ink">
                            {readString(entry.stage) ?? "stage"}
                          </p>
                          <p className="mt-1">
                            {readString(entry.summary) ?? "No summary"}
                          </p>
                        </div>
                      ))}
                      {reproducibilityRefs.map((ref) => (
                        <div
                          className="rounded border border-border bg-surface/80 p-3 text-xs text-muted"
                          key={ref}
                        >
                          <p className="font-medium text-ink">{ref}</p>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </article>
          </div>

          {loading ? (
            <p className="text-sm text-muted">Refreshing strategy desk…</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
