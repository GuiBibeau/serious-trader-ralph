"use client";

import Link from "next/link";
import { BTN_PRIMARY, BTN_SECONDARY, formatTick } from "../../lib";
import {
  getTerminalIntentFamilyLabel,
  getTerminalVenueDefinition,
  getTerminalVenueExecutionReadinessLabel,
  isTerminalVenueEnabled,
  resolveTerminalVenueRolloutPolicy,
  TERMINAL_INTENT_FAMILIES,
  TERMINAL_VENUE_KEYS,
} from "../terminal-venues";
import type {
  RuntimeControlAction,
  RuntimeOperatorApiPayload,
  RuntimeOperatorDetail,
  RuntimeOperatorProgramMatrixEntry,
  RuntimeOperatorReadinessCanaryInput,
  RuntimeOperatorSnapshot,
  RuntimeOperatorSubjectControlInput,
  RuntimeOperatorVenueTxSmokeInput,
} from "./types";

type RuntimeOperatorViewProps = {
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  payload: RuntimeOperatorApiPayload | null;
  actionPending: string | null;
  onRefresh?: () => void;
  onSelectDeployment?: (deploymentId: string) => void;
  onControl?: (action: RuntimeControlAction) => void;
  onSubjectControl?: (input: RuntimeOperatorSubjectControlInput) => void;
  onReadinessCanary?: (input: RuntimeOperatorReadinessCanaryInput) => void;
  onVenueTxSmoke?: (input: RuntimeOperatorVenueTxSmokeInput) => void;
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

function buildSubjectActionKey(
  input: RuntimeOperatorSubjectControlInput,
): string {
  return `subject-control:${input.subjectKind}:${input.subjectKey}:${
    input.killSwitchEnabled === true
      ? "kill-on"
      : input.killSwitchEnabled === false
        ? "kill-off"
        : input.liveAllowed === true
          ? "live-on"
          : "live-off"
  }`;
}

function buildReadinessCanaryActionKey(
  input: RuntimeOperatorReadinessCanaryInput,
): string {
  return `readiness-canary:${input.subjectKind}:${input.subjectKey}`;
}

function buildVenueTxSmokeActionKey(
  input: RuntimeOperatorVenueTxSmokeInput,
): string {
  return `venue-tx-smoke:${input.subjectKey}:${input.smokeIntentFamily ?? "spot_swap"}`;
}

function renderBadge(status: string, label?: string) {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${statusClasses(
        status,
      )}`}
    >
      {(label ?? status).replaceAll("_", " ")}
    </span>
  );
}

function renderProgramMatrix(
  matrix: RuntimeOperatorProgramMatrixEntry[],
  nextIssueOrder: number[],
) {
  if (matrix.length === 0) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
        Venue program matrix is not available yet.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="runtime-operator-program-matrix">
      <div className="rounded border border-border bg-paper/70 p-4">
        <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
          Next issue order
        </p>
        <p className="mt-2 text-sm text-muted">
          {nextIssueOrder.length > 0
            ? nextIssueOrder
                .map((issueNumber) => `#${issueNumber}`)
                .join(" -> ")
            : "No queued follow-up issues."}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {matrix.map((entry) => (
          <article
            key={entry.subjectKey}
            className="rounded border border-border bg-surface/80 p-4"
            data-testid={`runtime-program-${entry.subjectKey}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  {entry.programFamily} venue
                </p>
                <h3 className="mt-2 text-sm font-medium text-ink">
                  {entry.displayName}
                </h3>
              </div>
              {renderBadge(entry.currentState, entry.currentState)}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {summaryItem("Current state", entry.currentState)}
              {summaryItem("Target state", entry.targetState)}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded border border-border bg-paper/70 p-3">
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  Evidence target
                </p>
                <p className="mt-2 text-sm text-muted">
                  {entry.evidenceTarget}
                </p>
                <p className="mt-3 text-xs text-muted">
                  Markets: {entry.marketLabels.join(", ")}. Modes:{" "}
                  {entry.supportedModes.length > 0
                    ? entry.supportedModes.join(", ")
                    : "n/a"}
                  .
                </p>
              </div>
              <div className="rounded border border-border bg-paper/70 p-3">
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  Controls
                </p>
                <p className="mt-2 text-sm text-muted">{entry.disableDrill}</p>
                <p className="mt-3 text-xs text-muted">
                  Canary: {entry.canaryPlan}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 text-xs text-muted sm:grid-cols-2">
              <p>
                Issues #{entry.integrationIssueNumber}
                {entry.terminalIssueNumber
                  ? ` · #${entry.terminalIssueNumber}`
                  : ""}
                {entry.liveSmokeIssueNumber
                  ? ` · #${entry.liveSmokeIssueNumber}`
                  : ""}
              </p>
              <p>
                Agent-ready after{" "}
                {entry.nextReadyIssueNumbers.length > 0
                  ? entry.nextReadyIssueNumbers
                      .map((issueNumber) => `#${issueNumber}`)
                      .join(", ")
                  : "current queue"}
              </p>
            </div>
            <p className="mt-3 text-sm text-muted">{entry.notes}</p>
          </article>
        ))}
      </div>
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

function renderInfrastructureReadiness(
  snapshot: RuntimeOperatorSnapshot | null,
) {
  const integration = isRecord(snapshot?.integration)
    ? snapshot.integration
    : {};
  const health = isRecord(snapshot?.health) ? snapshot.health : {};
  const routes = isRecord(snapshot?.routes) ? snapshot.routes : {};
  const routeEntries = Object.entries(routes);
  const feedGateway = isRecord(health.feedGateway) ? health.feedGateway : {};
  const featureCache = isRecord(health.featureCache) ? health.featureCache : {};
  const oracleRegistry = isRecord(health.oracleRegistry)
    ? health.oracleRegistry
    : {};
  const strategyRegistry = isRecord(health.strategyRegistry)
    ? health.strategyRegistry
    : {};
  const researchRegistry = isRecord(health.researchRegistry)
    ? health.researchRegistry
    : {};
  const cards = [
    {
      key: "feed-gateway",
      label: "Feed gateway",
      status: readString(feedGateway.status) ?? "unknown",
      detail: `${readString(feedGateway.maxMarketAgeMs) ?? String(feedGateway.maxMarketAgeMs ?? "n/a")} ms max market age`,
    },
    {
      key: "feature-cache",
      label: "Feature cache",
      status: readString(featureCache.status) ?? "unknown",
      detail: `${readString(featureCache.maxFeatureAgeMs) ?? String(featureCache.maxFeatureAgeMs ?? "n/a")} ms max feature age`,
    },
    {
      key: "oracle-registry",
      label: "Oracle registry",
      status: readString(oracleRegistry.status) ?? "unknown",
      detail: `${readString(oracleRegistry.staleInstrumentCount) ?? String(oracleRegistry.staleInstrumentCount ?? "0")} stale instruments`,
    },
    {
      key: "strategy-registry",
      label: "Strategy registry",
      status: readString(strategyRegistry.status) ?? "unknown",
      detail: `${readString(strategyRegistry.deploymentCount) ?? String(strategyRegistry.deploymentCount ?? "0")} deployments`,
    },
    {
      key: "research-registry",
      label: "Research registry",
      status: readString(researchRegistry.status) ?? "unknown",
      detail: `${readString(researchRegistry.experimentCount) ?? String(researchRegistry.experimentCount ?? "0")} experiments`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryItem(
          "Runtime service",
          readString(integration.serviceName) ?? "runtime-rs",
        )}
        {summaryItem(
          "Runtime base",
          readString(integration.runtimeBaseUrl) ?? "not configured",
        )}
        {summaryItem(
          "Stub mode",
          readBoolean(integration.stubModeEnabled, false) ? "enabled" : "off",
        )}
        {summaryItem("Route inventory", String(routeEntries.length))}
      </div>
      <div className="grid gap-3 xl:grid-cols-5">
        {cards.map((card) => (
          <article
            key={card.key}
            className="rounded border border-border bg-surface/80 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                {card.label}
              </p>
              {renderBadge(card.status)}
            </div>
            <p className="mt-3 text-sm text-muted">{card.detail}</p>
          </article>
        ))}
      </div>
      <div className="rounded border border-border bg-surface/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
              Route availability
            </p>
            <p className="mt-2 text-sm text-muted">
              Runtime health and deployment routes currently advertised by the
              worker bridge.
            </p>
          </div>
          {renderBadge(
            routeEntries.length > 0 ? "healthy" : "blocked",
            routeEntries.length > 0 ? "available" : "missing",
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {routeEntries.length > 0 ? (
            routeEntries.map(([routeKey, routeValue]) => (
              <span
                key={routeKey}
                className="rounded border border-border px-2 py-1 text-[10px] uppercase tracking-[0.24em] text-muted"
              >
                {routeKey}: {String(routeValue)}
              </span>
            ))
          ) : (
            <p className="text-sm text-muted">No runtime routes advertised.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function renderTerminalRollout(detail: RuntimeOperatorDetail | null) {
  const rolloutPolicy = resolveTerminalVenueRolloutPolicy();
  const selectedVenueKey = readString(detail?.deployment?.venueKey);
  const readinessVenue = detail?.lab?.readiness?.venue ?? null;
  const readinessArtifacts = readRecordArray(readinessVenue?.artifacts);
  const readinessCanaries = readRecordArray(readinessVenue?.canaryRuns);
  const latestVenueArtifact = readinessArtifacts[0] ?? null;
  const latestVenueCanary = readinessCanaries[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryItem(
          "Enabled venues",
          String(rolloutPolicy.enabledVenues.length),
        )}
        {summaryItem(
          "Enabled families",
          String(rolloutPolicy.enabledFamilies.length),
        )}
        {summaryItem("Selected venue", selectedVenueKey ?? "n/a")}
        {summaryItem(
          "Selected canary",
          readString(latestVenueCanary?.status) ??
            readString(latestVenueArtifact?.status) ??
            "n/a",
        )}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {TERMINAL_VENUE_KEYS.map((venueKey) => {
          const definition = getTerminalVenueDefinition(venueKey);
          if (!definition) return null;
          const rolloutEnabled = isTerminalVenueEnabled(venueKey);
          const enabledFamilies = definition.families.filter((family) =>
            rolloutPolicy.enabledFamilies.includes(family),
          );
          const selected = venueKey === selectedVenueKey;
          return (
            <article
              key={venueKey}
              className={`rounded border p-4 ${
                selected
                  ? "border-ink bg-surface"
                  : "border-border bg-surface/80"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                    {definition.executionPathLabel}
                  </p>
                  <h3 className="mt-2 text-sm font-medium text-ink">
                    {definition.label}
                  </h3>
                </div>
                {renderBadge(
                  rolloutEnabled ? "healthy" : "blocked",
                  rolloutEnabled ? "rollout enabled" : "rollout gated",
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {renderBadge(
                  definition.executionReadiness,
                  getTerminalVenueExecutionReadinessLabel(
                    definition.executionReadiness,
                  ),
                )}
                {selected && latestVenueCanary
                  ? renderBadge(
                      readString(latestVenueCanary.status) ?? "pending",
                      "selected canary",
                    )
                  : null}
              </div>
              <p className="mt-3 text-sm text-muted">
                Families in rollout:{" "}
                {enabledFamilies.length > 0
                  ? enabledFamilies
                      .map((family) => getTerminalIntentFamilyLabel(family))
                      .filter(Boolean)
                      .join(", ")
                  : "none enabled"}
              </p>
            </article>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {TERMINAL_INTENT_FAMILIES.map((family) => {
          const label = getTerminalIntentFamilyLabel(family) ?? family;
          const enabled = rolloutPolicy.enabledFamilies.includes(family);
          const supportedVenueCount = TERMINAL_VENUE_KEYS.filter((venueKey) => {
            const definition = getTerminalVenueDefinition(venueKey);
            return Boolean(definition?.families.includes(family));
          }).length;
          return (
            <article
              key={family}
              className="rounded border border-border bg-surface/80 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">{label}</p>
                {renderBadge(
                  enabled ? "healthy" : "blocked",
                  enabled ? "enabled" : "gated",
                )}
              </div>
              <p className="mt-3 text-sm text-muted">
                {supportedVenueCount} venue rail
                {supportedVenueCount === 1 ? "" : "s"} support this family.
              </p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function renderProofSurfaces(detail: RuntimeOperatorDetail | null) {
  const readiness = detail?.lab?.readiness ?? null;
  const subjects = [readiness?.venue, readiness?.asset].filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded border border-border bg-surface/80 p-4">
        <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
          Proof surfaces
        </p>
        <p className="mt-2 text-sm text-muted">
          Open deterministic browser and runtime proof surfaces directly from
          the operator page.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link className={BTN_PRIMARY} href="/proof/runtime">
            Runtime proof
          </Link>
          <Link className={BTN_SECONDARY} href="/proof/browser">
            Browser proof
          </Link>
        </div>
      </div>
      <div className="rounded border border-border bg-surface/80 p-4">
        <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
          Readiness artifacts
        </p>
        <div className="mt-3 space-y-3">
          {subjects.length > 0 ? (
            subjects.map((subject) => {
              const artifact = readRecordArray(subject.artifacts)[0] ?? null;
              const canary = readRecordArray(subject.canaryRuns)[0] ?? null;
              const label =
                readString(subject.subjectKind) === "asset" ? "Asset" : "Venue";
              return (
                <div
                  key={`${readString(subject.subjectKind)}:${readString(subject.subjectKey)}`}
                  className="rounded border border-border bg-paper/70 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">
                      {label}: {readString(subject.subjectKey) ?? "unknown"}
                    </p>
                    {renderBadge(
                      readString(artifact?.status) ??
                        readString(canary?.status) ??
                        "candidate",
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-muted">
                    <p>
                      readiness id: {readString(artifact?.readinessId) ?? "n/a"}
                    </p>
                    <p>canary id: {readString(canary?.runId) ?? "n/a"}</p>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted">
              No readiness artifacts are attached to the selected deployment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function renderLeaderboard(snapshot: RuntimeOperatorSnapshot | null) {
  const leaderboard = isRecord(snapshot?.leaderboard)
    ? snapshot?.leaderboard
    : {};
  const entries = Array.isArray(leaderboard.entries) ? leaderboard.entries : [];
  if (entries.length === 0) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
        Candidate leaderboard not available yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {entries.slice(0, 5).map((entry, index) => {
        const candidate = isRecord(entry) ? entry : {};
        const strategyKey = readString(candidate.strategyKey) ?? "unknown";
        const pairSymbol = readString(candidate.pairSymbol) ?? "n/a";
        const significance =
          readString(candidate.significanceConfidenceBps) ??
          String(candidate.significanceConfidenceBps ?? "0");
        const gateStatus =
          readString(candidate.promotionGateStatus) ?? "candidate";
        const candidateId =
          readString(candidate.candidateId) ??
          readString(candidate.reportId) ??
          `${strategyKey}:${pairSymbol}`;
        return (
          <article
            key={candidateId}
            className="rounded border border-border bg-surface/80 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  Candidate rank #{index + 1}
                </p>
                <h3 className="mt-2 text-sm font-medium text-ink">
                  {strategyKey} · {pairSymbol}
                </h3>
              </div>
              <span
                className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${statusClasses(
                  gateStatus,
                )}`}
              >
                {gateStatus.replaceAll("_", " ")}
              </span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {summaryItem(
                "Net return",
                `${readString(candidate.netReturnBps) ?? "0.0000"} bps`,
              )}
              {summaryItem("Significance", `${significance} bps`)}
              {summaryItem(
                "Flat-cash excess",
                `${readString(candidate.flatCashExcessReturnBps) ?? "n/a"} bps`,
              )}
            </div>
            <p className="mt-3 text-sm text-muted">
              {readString(candidate.summary) ??
                "No candidate summary available."}
            </p>
          </article>
        );
      })}
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
  const research = isRecord(report.research) ? report.research : null;
  const promotionGates = Array.isArray(report.promotionGates)
    ? report.promotionGates
    : [];
  if (!research && promotionGates.length === 0) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
        Promotion evidence not available yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {research ? (
        <article className="rounded border border-border bg-surface/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Research scorecard
              </p>
              <h3 className="mt-2 text-sm font-medium text-ink">
                backtest {readString(research.backtestReportId) ?? "missing"}
              </h3>
            </div>
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${statusClasses(
                readBoolean(research.promotionEligible, false)
                  ? "pass"
                  : "blocked",
              )}`}
            >
              {readBoolean(research.promotionEligible, false)
                ? "eligible"
                : "blocked"}
            </span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryItem(
              "Net return",
              `${readString(research.netReturnBps) ?? "0.0000"} bps`,
            )}
            {summaryItem(
              "Significance",
              `${readString(research.significanceConfidenceBps) ?? String(research.significanceConfidenceBps ?? "0")} bps`,
            )}
            {summaryItem(
              "Flat-cash excess",
              `${readString(research.flatCashExcessReturnBps) ?? "n/a"} bps`,
            )}
            {summaryItem(
              "Weak regimes",
              readString(research.weakRegimeCount) ??
                String(research.weakRegimeCount ?? "0"),
            )}
          </div>
        </article>
      ) : null}
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

function renderAllocator(detail: RuntimeOperatorDetail | null) {
  const allocator = isRecord(detail?.allocator) ? detail?.allocator : {};
  const currentDecision = isRecord(allocator.currentDecision)
    ? allocator.currentDecision
    : null;
  const sleeve = isRecord(allocator.sleeve) ? allocator.sleeve : null;
  const peerGrants = Array.isArray(currentDecision?.peerGrants)
    ? currentDecision.peerGrants
    : [];

  if (!currentDecision) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
        Allocator evidence not available yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {summaryItem(
          "Grant allocated",
          `${readString(currentDecision.grantedAllocatedUsd) ?? "0.00"} USD`,
        )}
        {summaryItem(
          "Grant reserved",
          `${readString(currentDecision.grantedReservedUsd) ?? "0.00"} USD`,
        )}
        {summaryItem(
          "Priority rank",
          readString(currentDecision.priorityRank) ??
            String(currentDecision.priorityRank ?? "n/a"),
        )}
        {summaryItem(
          "Decision",
          readBoolean(currentDecision.constrained, false)
            ? "constrained"
            : "full grant",
        )}
        {summaryItem(
          "Sleeve equity",
          `${readString(currentDecision.sleeveEquityUsd) ?? "0.00"} USD`,
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded border border-border bg-surface/80 p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
            Peer grants
          </p>
          <div className="mt-3 space-y-3">
            {peerGrants.length === 0 ? (
              <p className="text-sm text-muted">
                No peer grant records available.
              </p>
            ) : (
              peerGrants.map((grant, index) => {
                const record = isRecord(grant) ? grant : {};
                const constrained = readBoolean(record.constrained, false);
                return (
                  <div
                    key={`${readString(record.deploymentId) ?? "peer"}:${index}`}
                    className="rounded border border-border bg-paper/70 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-xs text-muted">
                        {readString(record.deploymentId) ?? "unknown"}
                      </p>
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${statusClasses(
                          constrained ? "blocked" : "pass",
                        )}`}
                      >
                        {constrained ? "constrained" : "full grant"}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs text-muted sm:grid-cols-3">
                      <p>
                        requested{" "}
                        {readString(record.requestedAllocatedUsd) ?? "--"} USD
                      </p>
                      <p>
                        granted {readString(record.grantedAllocatedUsd) ?? "--"}{" "}
                        USD
                      </p>
                      <p>
                        reserved {readString(record.grantedReservedUsd) ?? "--"}{" "}
                        USD
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="rounded border border-border bg-surface/80 p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
            Sleeve coordination
          </p>
          {sleeve ? (
            <div className="mt-3 space-y-3 text-sm">
              <p className="text-muted">
                {readString(sleeve.sleeveId) ?? "unknown sleeve"}
              </p>
              <div className="grid gap-2 text-xs text-muted">
                <p>equity {readString(sleeve.equityUsd) ?? "0.00"} USD</p>
                <p>reserved {readString(sleeve.reservedUsd) ?? "0.00"} USD</p>
                <p>available {readString(sleeve.availableUsd) ?? "0.00"} USD</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Sleeve summary unavailable.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function renderResearchProvenance(detail: RuntimeOperatorDetail | null) {
  const research = isRecord(detail?.lab?.research)
    ? detail?.lab?.research
    : null;
  if (!research) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
        Research provenance is not available yet.
      </div>
    );
  }

  const hypotheses = readRecordArray(research.hypotheses);
  const sources = readRecordArray(research.sources);
  const experiments = readRecordArray(research.experiments);
  const evidenceBundles = readRecordArray(research.evidenceBundles);
  const reproducibilityBundles = readRecordArray(
    research.reproducibilityBundles,
  );
  const hypothesis = hypotheses[0] ?? null;
  const source = sources[0] ?? null;
  const experiment = experiments[0] ?? null;
  const evidenceBundle = evidenceBundles[0] ?? null;
  const reproducibilityBundle = reproducibilityBundles[0] ?? null;
  const latestVerification = isRecord(reproducibilityBundle?.latestVerification)
    ? reproducibilityBundle.latestVerification
    : null;

  return (
    <div className="space-y-4">
      {research.error ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          {readString(research.error)}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {summaryItem("Hypotheses", String(hypotheses.length))}
        {summaryItem("Sources", String(sources.length))}
        {summaryItem("Experiments", String(experiments.length))}
        {summaryItem("Evidence bundles", String(evidenceBundles.length))}
        {summaryItem("Repro bundles", String(reproducibilityBundles.length))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <article className="rounded border border-border bg-surface/80 p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
            Latest hypothesis
          </p>
          {hypothesis ? (
            <>
              <h3 className="mt-2 text-sm font-medium text-ink">
                {readString(hypothesis.title) ??
                  readString(hypothesis.hypothesisId) ??
                  "untitled hypothesis"}
              </h3>
              <p className="mt-2 text-sm text-muted">
                {readString(hypothesis.thesis) ?? "No thesis captured."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {renderBadge(readString(hypothesis.status) ?? "candidate")}
                <span className="text-xs text-muted">
                  {readString(hypothesis.updatedAt) ??
                    readString(hypothesis.createdAt) ??
                    "n/a"}
                </span>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">No hypotheses recorded.</p>
          )}
        </article>
        <article className="rounded border border-border bg-surface/80 p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
            Latest source
          </p>
          {source ? (
            <>
              <h3 className="mt-2 text-sm font-medium text-ink">
                {readString(source.title) ??
                  readString(source.sourceId) ??
                  "untitled source"}
              </h3>
              <p className="mt-2 text-sm text-muted">
                {readString(source.sourceKind) ?? "unknown"} ·{" "}
                {readString(source.canonicalUrl) ??
                  readString(source.url) ??
                  "no url"}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {renderBadge("pass", readString(source.sourceKind) ?? "source")}
                <span className="text-xs text-muted">
                  {readString(source.publishedAt) ??
                    readString(source.retrievedAt) ??
                    "n/a"}
                </span>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">
              No research sources recorded.
            </p>
          )}
        </article>
        <article className="rounded border border-border bg-surface/80 p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
            Latest experiment
          </p>
          {experiment ? (
            <>
              <h3 className="mt-2 text-sm font-medium text-ink">
                {readString(experiment.experimentId) ?? "experiment"}
              </h3>
              <p className="mt-2 text-sm text-muted">
                {readString(experiment.summary) ??
                  "No experiment summary available."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {renderBadge(readString(experiment.status) ?? "candidate")}
                <span className="text-xs text-muted">
                  {readString(experiment.completedAt) ??
                    readString(experiment.updatedAt) ??
                    "n/a"}
                </span>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">No experiments recorded.</p>
          )}
        </article>
        <article className="rounded border border-border bg-surface/80 p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
            Evidence bundle
          </p>
          {evidenceBundle ? (
            <>
              <h3 className="mt-2 text-sm font-medium text-ink">
                {readString(evidenceBundle.evidenceBundleId) ??
                  "evidence bundle"}
              </h3>
              <p className="mt-2 text-sm text-muted">
                {readString(evidenceBundle.summary) ??
                  "No evidence summary available."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {renderBadge(readString(evidenceBundle.status) ?? "candidate")}
                <span className="text-xs text-muted">
                  {readString(evidenceBundle.promotionTarget) ?? "n/a"}
                </span>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">
              No evidence bundles recorded.
            </p>
          )}
        </article>
        <article className="rounded border border-border bg-surface/80 p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
            Reproducibility
          </p>
          {reproducibilityBundle ? (
            <>
              <h3 className="mt-2 text-sm font-medium text-ink">
                {readString(reproducibilityBundle.reproducibilityBundleId) ??
                  "reproducibility bundle"}
              </h3>
              <p className="mt-2 text-sm text-muted">
                {readString(reproducibilityBundle.summary) ??
                  "No reproducibility summary available."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {renderBadge(
                  readString(latestVerification?.status) ?? "pass",
                  readString(latestVerification?.status) ?? "verified",
                )}
                <span className="text-xs text-muted">
                  {readString(reproducibilityBundle.updatedAt) ?? "n/a"}
                </span>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">
              No reproducibility bundles recorded.
            </p>
          )}
        </article>
      </div>
    </div>
  );
}

function renderPromotionTimeline(detail: RuntimeOperatorDetail | null) {
  const promotions = isRecord(detail?.lab?.promotions)
    ? detail?.lab?.promotions
    : null;
  const scorecard = isRecord(detail?.scorecard) ? detail.scorecard : null;
  const strategyPromotions = promotions
    ? readRecordArray(promotions.strategy)
    : [];
  const venuePromotions = promotions ? readRecordArray(promotions.venue) : [];
  const assetPromotions = promotions ? readRecordArray(promotions.asset) : [];
  const promotionGates = Array.isArray(scorecard?.promotionGates)
    ? scorecard.promotionGates
    : [];
  if (!promotions && promotionGates.length === 0) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
        Promotion evidence not available yet.
      </div>
    );
  }

  const groups = [
    { label: "Strategy lifecycle", items: strategyPromotions },
    { label: "Venue readiness", items: venuePromotions },
    { label: "Asset readiness", items: assetPromotions },
  ];

  return (
    <div className="space-y-4">
      {promotions?.error ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          {readString(promotions.error)}
        </div>
      ) : null}
      {promotionGates.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {promotionGates.map((gate) => {
            const record = isRecord(gate) ? gate : {};
            const targetMode = readString(record.targetMode) ?? "unknown";
            const status = readString(record.status) ?? "unknown";
            const summary =
              readString(record.summary) ?? "No gate summary available.";
            return (
              <article
                key={`${targetMode}:${status}:${summary}`}
                className="rounded border border-border bg-surface/80 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                      Runtime gate
                    </p>
                    <h3 className="mt-2 text-sm font-medium text-ink">
                      target {targetMode}
                    </h3>
                  </div>
                  {renderBadge(status)}
                </div>
                <p className="mt-3 text-sm text-muted">{summary}</p>
              </article>
            );
          })}
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-3">
        {groups.map((group) => (
          <article
            key={group.label}
            className="rounded border border-border bg-surface/80 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  {group.label}
                </p>
                <h3 className="mt-2 text-sm font-medium text-ink">
                  {group.items.length} records
                </h3>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              {group.items.length === 0 ? (
                <p className="text-sm text-muted">No promotion records yet.</p>
              ) : (
                group.items.slice(0, 3).map((promotion, index) => {
                  const record = isRecord(promotion) ? promotion : {};
                  const status = readString(record.status) ?? "candidate";
                  return (
                    <div
                      key={`${readString(record.promotionId) ?? group.label}:${index}`}
                      className="rounded border border-border bg-paper/70 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-ink">
                          {readString(record.currentState) ?? "current"} to{" "}
                          {readString(record.targetState) ?? "target"}
                        </p>
                        {renderBadge(status)}
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {readString(record.summary) ??
                          "No promotion summary available."}
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        {readString(record.requestedBy) ?? "n/a"} ·{" "}
                        {readString(record.updatedAt) ??
                          readString(record.createdAt) ??
                          "n/a"}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function renderReadinessControls(
  detail: RuntimeOperatorDetail | null,
  actionPending: string | null,
  onSubjectControl?: (input: RuntimeOperatorSubjectControlInput) => void,
  onReadinessCanary?: (input: RuntimeOperatorReadinessCanaryInput) => void,
  onVenueTxSmoke?: (input: RuntimeOperatorVenueTxSmokeInput) => void,
) {
  const deployment = detail?.deployment ?? null;
  const readiness = detail?.lab?.readiness ?? null;
  const subjects = [readiness?.venue, readiness?.asset].filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  );

  if (!deployment || subjects.length === 0) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
        Venue and asset readiness controls are not available yet.
      </div>
    );
  }

  const assetKey =
    deployment.pair.symbol.split("/")[0] ?? deployment.pair.baseMint;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {subjects.map((subject) => {
        const subjectKind =
          readString(subject.subjectKind) === "asset" ? "asset" : "venue";
        const isVenueSubject = subjectKind === "venue";
        const subjectKey = readString(subject.subjectKey) ?? "unknown";
        const controls = readRecordArray(subject.controls);
        const artifacts = readRecordArray(subject.artifacts);
        const canaryRuns = readRecordArray(subject.canaryRuns);
        const canaryState = isRecord(subject.canaryState)
          ? subject.canaryState
          : null;
        const control = controls[0] ?? null;
        const latestArtifact = artifacts[0] ?? null;
        const latestCanary = canaryRuns[0] ?? null;
        const liveAllowed = readBoolean(control?.liveAllowed, false);
        const killSwitchEnabled = readBoolean(
          control?.killSwitchEnabled,
          false,
        );
        const liveToggleInput: RuntimeOperatorSubjectControlInput = {
          subjectKind,
          subjectKey,
          liveAllowed: !liveAllowed,
          disabledReason: liveAllowed ? "operator-disabled" : null,
        };
        const killToggleInput: RuntimeOperatorSubjectControlInput = {
          subjectKind,
          subjectKey,
          killSwitchEnabled: !killSwitchEnabled,
          disabledReason: killSwitchEnabled ? null : "operator-kill-switch",
        };
        const canaryInput: RuntimeOperatorReadinessCanaryInput = {
          subjectKind,
          subjectKey,
          venueKey: deployment.venueKey,
          assetKey,
          pairSymbol: deployment.pair.symbol,
          targetNotionalUsd: "5.00",
        };
        const smokeInput: RuntimeOperatorVenueTxSmokeInput | null =
          isVenueSubject
            ? {
                subjectKind: "venue",
                subjectKey,
                venueKey: subjectKey,
                assetKey,
                pairSymbol: deployment.pair.symbol,
                targetNotionalUsd: "5.00",
                smokeIntentFamily: "spot_swap",
                tightenOnFailure: true,
                failureControlMode: "disable_live",
                killDrillNotes: [
                  `Tighten ${subjectKey} only; do not widen to runtime-wide pause.`,
                ],
              }
            : null;
        const liveTogglePending =
          actionPending === buildSubjectActionKey(liveToggleInput);
        const killTogglePending =
          actionPending === buildSubjectActionKey(killToggleInput);
        const canaryPending =
          isVenueSubject && smokeInput
            ? actionPending === buildVenueTxSmokeActionKey(smokeInput)
            : actionPending === buildReadinessCanaryActionKey(canaryInput);

        return (
          <article
            key={`${subjectKind}:${subjectKey}`}
            className="rounded border border-border bg-surface/80 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  {subjectKind} readiness
                </p>
                <h3 className="mt-2 text-sm font-medium text-ink">
                  {subjectKey}
                </h3>
              </div>
              {renderBadge(
                readString(latestArtifact?.status) ??
                  readString(latestCanary?.status) ??
                  "candidate",
              )}
            </div>
            {readString(subject.error) ? (
              <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                {readString(subject.error)}
              </div>
            ) : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summaryItem(
                "Live allowed",
                liveAllowed ? "enabled" : "disabled",
              )}
              {summaryItem(
                "Kill switch",
                killSwitchEnabled ? "engaged" : "clear",
              )}
              {summaryItem(
                "Readiness",
                readString(latestArtifact?.targetState) ?? "n/a",
              )}
              {summaryItem(
                isVenueSubject ? "Latest tx smoke" : "Latest canary",
                readString(latestCanary?.status) ?? "not run",
              )}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded border border-border bg-paper/70 p-3">
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  Evidence
                </p>
                <p className="mt-2 text-sm text-muted">
                  {readString(latestArtifact?.summary) ??
                    "No readiness artifact summary available."}
                </p>
                <div className="mt-3 grid gap-2 text-xs text-muted">
                  <p>
                    canary{" "}
                    {readString(latestArtifact?.canaryRunId) ??
                      readString(latestCanary?.runId) ??
                      "n/a"}
                  </p>
                  <p>
                    control{" "}
                    {readString(control?.updatedAt) ??
                      readString(canaryState?.updatedAt) ??
                      "n/a"}
                  </p>
                </div>
              </div>
              <div className="rounded border border-border bg-paper/70 p-3">
                <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                  Controls
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className={BTN_SECONDARY}
                    type="button"
                    onClick={() => onSubjectControl?.(liveToggleInput)}
                    disabled={!onSubjectControl}
                  >
                    {liveTogglePending
                      ? "Updating..."
                      : liveAllowed
                        ? "Disable live"
                        : "Allow live"}
                  </button>
                  <button
                    className={BTN_SECONDARY}
                    type="button"
                    onClick={() => onSubjectControl?.(killToggleInput)}
                    disabled={!onSubjectControl}
                  >
                    {killTogglePending
                      ? "Updating..."
                      : killSwitchEnabled
                        ? "Clear kill switch"
                        : "Engage kill switch"}
                  </button>
                  <button
                    className={BTN_PRIMARY}
                    type="button"
                    onClick={() =>
                      isVenueSubject
                        ? smokeInput && onVenueTxSmoke?.(smokeInput)
                        : onReadinessCanary?.(canaryInput)
                    }
                    disabled={
                      isVenueSubject
                        ? !onVenueTxSmoke || !smokeInput
                        : !onReadinessCanary
                    }
                  >
                    {canaryPending
                      ? isVenueSubject
                        ? "Running tx smoke..."
                        : "Running canary..."
                      : isVenueSubject
                        ? "Run tx smoke"
                        : "Run canary"}
                  </button>
                </div>
              </div>
            </div>
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
  onSubjectControl,
  onReadinessCanary,
  onVenueTxSmoke,
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
              Runtime deployments, research evidence, and promotion control
            </h1>
            <p className="mt-3 text-sm text-muted">
              Auth-gated view of runtime health, research provenance, readiness,
              scorecards, and bounded live controls.
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
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Infrastructure readiness
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Feed, oracle, registry, and route health
              </h2>
            </div>
            {renderInfrastructureReadiness(runtime)}
          </section>
          <section className="card p-5">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Terminal rollout
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Venue and family exposure tied to rollout state
              </h2>
            </div>
            {renderTerminalRollout(detail)}
          </section>
          <section className="card p-5">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Proof and readiness
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Proof surfaces and latest readiness artifacts
              </h2>
            </div>
            {renderProofSurfaces(detail)}
          </section>
          <section className="card p-5">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Candidate leaderboard
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Ranked research candidates and promotion readiness
              </h2>
            </div>
            {renderLeaderboard(runtime)}
          </section>

          <section className="card p-5">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Venue program matrix
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Readiness targets, canary posture, and disable drills by venue
              </h2>
            </div>
            {renderProgramMatrix(
              payload?.program.matrix ?? [],
              payload?.program.nextIssueOrder ?? [],
            )}
          </section>

          <section className="card p-5">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Research provenance
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Latest hypotheses, sources, experiments, and evidence bundles
              </h2>
            </div>
            {renderResearchProvenance(detail)}
          </section>

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
                Readiness controls
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Venue and asset promotion guardrails
              </h2>
            </div>
            {renderReadinessControls(
              detail,
              actionPending,
              onSubjectControl,
              onReadinessCanary,
              onVenueTxSmoke,
            )}
          </section>

          <section className="card p-5">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Capital coordination
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Allocator grants and sleeve priority
              </h2>
            </div>
            {renderAllocator(detail)}
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
                Strategy-lab promotion state
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Lifecycle transitions, approvals, and rollout status
              </h2>
            </div>
            {renderPromotionTimeline(detail)}
          </section>

          <section className="card p-5">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted">
                Runtime scorecards
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
