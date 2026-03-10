"use client";

import Link from "next/link";
import { BTN_PRIMARY, BTN_SECONDARY, formatTick } from "../../lib";
import type {
  RuntimeControlAction,
  RuntimeOperatorApiPayload,
  RuntimeOperatorDetail,
  RuntimeOperatorSnapshot,
} from "./types";

type RuntimeOperatorViewProps = {
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  payload: RuntimeOperatorApiPayload | null;
  actionPending: RuntimeControlAction | null;
  onRefresh?: () => void;
  onSelectDeployment?: (deploymentId: string) => void;
  onControl?: (action: RuntimeControlAction) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function statusClasses(status: string | null): string {
  switch (status) {
    case "healthy":
    case "pass":
    case "success":
    case "passed":
    case "live":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
    case "paused":
    case "paper":
    case "shadow":
    case "blocked":
      return "border-amber-500/40 bg-amber-500/10 text-amber-200";
    case "failed":
    case "killed":
      return "border-rose-500/40 bg-rose-500/10 text-rose-200";
    default:
      return "border-border bg-surface text-muted";
  }
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

function renderHealthSummary(snapshot: RuntimeOperatorSnapshot | null) {
  const health = isRecord(snapshot?.health) ? snapshot?.health : {};
  const feedGateway = isRecord(health.feedGateway) ? health.feedGateway : {};
  const featureCache = isRecord(health.featureCache) ? health.featureCache : {};
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {summaryItem("Runtime", readString(health.status) ?? "unknown")}
      {summaryItem(
        "Feed age",
        `${readString(feedGateway.maxMarketAgeMs) ?? String(feedGateway.maxMarketAgeMs ?? "n/a")} ms`,
      )}
      {summaryItem(
        "Feature age",
        `${readString(featureCache.maxFeatureAgeMs) ?? String(featureCache.maxFeatureAgeMs ?? "n/a")} ms`,
      )}
      {summaryItem("Deployments", String(snapshot?.deployments.length ?? 0))}
    </div>
  );
}

function renderCanarySummary(snapshot: RuntimeOperatorSnapshot | null) {
  const canary = isRecord(snapshot?.canary) ? snapshot?.canary : {};
  const state = isRecord(canary.state) ? canary.state : {};
  const latestRuns = Array.isArray(canary.latestRuns) ? canary.latestRuns : [];
  const latestRun = isRecord(latestRuns[0]) ? latestRuns[0] : {};
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {summaryItem(
        "Canary",
        readBoolean(canary.ok, false) ? "online" : "offline",
      )}
      {summaryItem(
        "Latest status",
        readString(latestRun.status) ??
          readString(state.disabledReason) ??
          "n/a",
      )}
      {summaryItem(
        "Reconciliation",
        readString(latestRun.reconciliationStatus) ?? "n/a",
      )}
    </div>
  );
}

function renderRuns(detail: RuntimeOperatorDetail | null) {
  if (!detail || detail.runs.length === 0) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
        No runtime runs recorded yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {detail.runs.slice(0, 6).map((run) => (
        <article
          key={run.runId}
          className="rounded border border-border bg-surface/80 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs text-muted">{run.runId}</p>
              <p className="mt-1 text-sm font-medium text-ink">
                {run.trigger.kind} from {run.trigger.source}
              </p>
              <p className="mt-1 text-xs text-muted">
                {run.failureCode ?? run.failureMessage ?? "healthy run"}
              </p>
            </div>
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${statusClasses(
                run.state,
              )}`}
            >
              {run.state.replaceAll("_", " ")}
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3">
            <p>planned {formatTick(run.plannedAt)}</p>
            <p>updated {formatTick(run.updatedAt)}</p>
            <p>{run.submitRequestId ?? run.receiptId ?? "no receipt yet"}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function renderPositions(detail: RuntimeOperatorDetail | null) {
  const snapshot = detail?.positions;
  if (!snapshot) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
        Position snapshot unavailable.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {summaryItem("Equity", `${snapshot.totals.equityUsd} USD`)}
        {summaryItem("Reserved", `${snapshot.totals.reservedUsd} USD`)}
        {summaryItem("Available", `${snapshot.totals.availableUsd} USD`)}
        {summaryItem("Realized", `${snapshot.totals.realizedPnlUsd} USD`)}
        {summaryItem("Unrealized", `${snapshot.totals.unrealizedPnlUsd} USD`)}
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded border border-border bg-surface/80 p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
            Positions
          </p>
          <div className="mt-3 space-y-3">
            {snapshot.positions.length === 0 ? (
              <p className="text-sm text-muted">
                No live positions in this sleeve.
              </p>
            ) : (
              snapshot.positions.map((position) => (
                <div
                  key={`${position.instrumentId}:${position.side}`}
                  className="rounded border border-border bg-paper/70 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">
                      {position.instrumentId}
                    </p>
                    <span className="text-xs uppercase tracking-[0.24em] text-muted">
                      {position.side}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-muted sm:grid-cols-3">
                    <p>qty {position.quantityAtomic}</p>
                    <p>entry {position.entryPriceUsd ?? "--"} USD</p>
                    <p>uPnL {position.unrealizedPnlUsd ?? "--"} USD</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded border border-border bg-surface/80 p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
            Balances
          </p>
          <div className="mt-3 space-y-3">
            {snapshot.balances.map((balance) => (
              <div
                key={balance.mint}
                className="rounded border border-border bg-paper/70 p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">{balance.symbol}</p>
                  <p className="text-muted">{balance.priceUsd ?? "--"} USD</p>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-muted">
                  <p>free {balance.freeAtomic}</p>
                  <p>reserved {balance.reservedAtomic}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function renderPromotion(detail: RuntimeOperatorDetail | null) {
  const report = isRecord(detail?.scorecard) ? detail?.scorecard : {};
  const promotionGates = Array.isArray(report.promotionGates)
    ? report.promotionGates
    : [];
  if (promotionGates.length === 0) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
        Promotion evidence not available yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {promotionGates.map((gate) => {
        const gateRecord = isRecord(gate) ? gate : {};
        const gateId = readString(gateRecord.gateId) ?? "promotion-gate";
        const targetMode = readString(gateRecord.targetMode) ?? "unknown";
        const status = readString(gateRecord.status) ?? "unknown";
        const summary =
          readString(gateRecord.summary) ?? "No summary available.";
        return (
          <article
            key={`${gateId}:${targetMode}:${status}`}
            className="rounded border border-border bg-surface/80 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  Promotion gate
                </p>
                <h3 className="mt-2 text-sm font-medium text-ink">
                  target {targetMode}
                </h3>
              </div>
              <span
                className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${statusClasses(
                  status,
                )}`}
              >
                {status.replaceAll("_", " ")}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted">{summary}</p>
          </article>
        );
      })}
    </div>
  );
}

export function RuntimeOperatorView({
  authenticated,
  loading,
  error,
  payload,
  actionPending,
  onRefresh,
  onSelectDeployment,
  onControl,
}: RuntimeOperatorViewProps) {
  const runtime = payload?.runtime ?? null;
  const detail = payload?.detail ?? null;
  const selectedDeploymentId = payload?.selectedDeploymentId ?? null;

  if (!authenticated) {
    return (
      <section className="mx-auto w-[min(1320px,94vw)] py-10">
        <div className="card p-8">
          <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
            Runtime operator
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
            Sign in required
          </h1>
          <p className="mt-3 max-w-[54ch] text-sm text-muted">
            Runtime deployments are only available to authenticated operators.
          </p>
          <div className="mt-6 flex gap-3">
            <Link className={BTN_PRIMARY} href="/login">
              Open login
            </Link>
            <Link className={BTN_SECONDARY} href="/terminal">
              Back to terminal
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-[min(1380px,95vw)] space-y-6 py-8">
      <header className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[60ch]">
            <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
              Runtime operator
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
              Runtime deployments, runs, and live controls
            </h1>
            <p className="mt-3 text-sm text-muted">
              Auth-gated view of runtime health, rollout state, scorecards,
              positions, and deployment controls.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              className={BTN_SECONDARY}
              onClick={onRefresh}
              type="button"
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <Link className={BTN_SECONDARY} href="/terminal">
              Terminal
            </Link>
          </div>
        </div>
        {error ? (
          <div className="mt-4 rounded border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error}
          </div>
        ) : null}
        {payload?.detailError ? (
          <div className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            {payload.detailError}
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="card p-4">
          <div className="rounded border border-border bg-surface/80 p-4">
            <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
              Runtime controls
            </p>
            <div className="mt-3 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">enabled</span>
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${statusClasses(
                    runtime?.controls.enabled ? "healthy" : "failed",
                  )}`}
                >
                  {runtime?.controls.enabled ? "enabled" : "disabled"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">shadow only</span>
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${statusClasses(
                    runtime?.controls.shadowOnly ? "shadow" : "live",
                  )}`}
                >
                  {runtime?.controls.shadowOnly ? "on" : "off"}
                </span>
              </div>
              <p className="text-xs text-muted">
                {runtime?.controls.disabledReason ??
                  runtime?.controls.shadowOnlyReason ??
                  "runtime controls healthy"}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {runtime?.deployments.length ? (
              runtime.deployments.map((deployment) => {
                const active = deployment.deploymentId === selectedDeploymentId;
                return (
                  <button
                    key={deployment.deploymentId}
                    className={`w-full rounded border p-4 text-left transition-colors ${
                      active
                        ? "border-ink bg-ink text-surface"
                        : "border-border bg-surface/80 text-ink hover:bg-paper"
                    }`}
                    onClick={() =>
                      onSelectDeployment?.(deployment.deploymentId)
                    }
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{deployment.strategyKey}</p>
                      <span className="text-[10px] uppercase tracking-[0.24em] opacity-75">
                        {deployment.state}
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-xs opacity-80">
                      {deployment.deploymentId}
                    </p>
                    <p className="mt-2 text-xs opacity-80">
                      {deployment.pair.symbol} · {deployment.mode} ·{" "}
                      {deployment.lane}
                    </p>
                  </button>
                );
              })
            ) : (
              <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
                No runtime deployments found.
              </div>
            )}
          </div>
        </aside>

        <div className="space-y-6">
          <section className="card p-4">{renderHealthSummary(runtime)}</section>
          <section className="card p-4">{renderCanarySummary(runtime)}</section>

          <section className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  Selected deployment
                </p>
                <h2 className="mt-2 text-lg font-semibold text-ink">
                  {detail?.deployment?.deploymentId ?? "No deployment selected"}
                </h2>
                <p className="mt-2 text-sm text-muted">
                  {detail?.deployment
                    ? `${detail.deployment.strategyKey} on ${detail.deployment.pair.symbol} in ${detail.deployment.mode} mode`
                    : "Choose a deployment to inspect runs, positions, and scorecards."}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {(["pause", "resume", "kill"] as const).map((action) => (
                  <button
                    key={action}
                    className={action === "kill" ? BTN_PRIMARY : BTN_SECONDARY}
                    onClick={() => onControl?.(action)}
                    type="button"
                    disabled={!detail?.deployment || loading}
                  >
                    {actionPending === action
                      ? `${action}...`
                      : action.charAt(0).toUpperCase() + action.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {detail?.deployment ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {summaryItem("State", detail.deployment.state)}
                {summaryItem("Mode", detail.deployment.mode)}
                {summaryItem("Lane", detail.deployment.lane)}
                {summaryItem(
                  "Reserved",
                  `${detail.deployment.capital.reservedUsd} USD`,
                )}
                {summaryItem(
                  "Max notional",
                  `${detail.deployment.policy.maxNotionalUsd} USD`,
                )}
              </div>
            ) : null}
          </section>

          <section className="card p-5">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Positions and PnL
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Sleeve state and live balances
              </h2>
            </div>
            {renderPositions(detail)}
          </section>

          <section className="card p-5">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Recent runs
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Latest runtime evaluations
              </h2>
            </div>
            {renderRuns(detail)}
          </section>

          <section className="card p-5">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Promotion evidence
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Scorecards and rollout gates
              </h2>
            </div>
            {renderPromotion(detail)}
          </section>
        </div>
      </div>
    </section>
  );
}
