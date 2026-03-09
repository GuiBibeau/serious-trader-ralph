export type PreviewLink = {
  portalUrl: string;
  workerUrl: string;
  workerName: string | null;
};

export type PreviewHealthResult = {
  prNumber: number;
  portalUrl: string;
  workerUrl: string;
  workerName: string | null;
  portalOk: boolean;
  workerOk: boolean;
};

export type RunnerHealthSnapshot = {
  status: string;
  updatedAt: string | null;
  concurrency: number | null;
  activeRuns: number | null;
  note: string | null;
};

export type OpsDashboardSnapshot = {
  generatedAt: string;
  execution: Record<string, unknown>;
  canary: Record<string, unknown>;
  controls: Record<string, unknown>;
  runtime: Record<string, unknown>;
  previews: PreviewHealthResult[];
  runner: RunnerHealthSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parsePreviewCommentBody(body: string): PreviewLink | null {
  const portalUrl = body.match(/- Portal:\s*(https?:\/\/\S+)/)?.[1] ?? null;
  const workerUrl = body.match(/- Worker:\s*(https?:\/\/\S+)/)?.[1] ?? null;
  const workerName =
    body.match(/- Worker name:\s*`([^`]+)`/)?.[1]?.trim() ?? null;
  if (!portalUrl || !workerUrl) return null;
  return {
    portalUrl,
    workerUrl,
    workerName,
  };
}

export function normalizeRunnerHealth(value: unknown): RunnerHealthSnapshot {
  if (!isRecord(value)) {
    return {
      status: "not-configured",
      updatedAt: null,
      concurrency: null,
      activeRuns: null,
      note: "Runner heartbeat file not found yet.",
    };
  }
  return {
    status: readString(value.status) ?? "unknown",
    updatedAt: readString(value.updatedAt),
    concurrency: readNumber(value.concurrency),
    activeRuns: readNumber(value.activeRuns),
    note: readString(value.note),
  };
}

export function summarizePreviewHealth(results: PreviewHealthResult[]): {
  total: number;
  healthy: number;
  failing: number;
} {
  const total = results.length;
  const healthy = results.filter(
    (item) => item.portalOk && item.workerOk,
  ).length;
  return {
    total,
    healthy,
    failing: total - healthy,
  };
}

function formatExecutionSummary(execution: Record<string, unknown>): string[] {
  const metrics = isRecord(execution.metrics) ? execution.metrics : {};
  const alerts = Array.isArray(execution.alerts) ? execution.alerts : [];
  const failRate = readNumber(metrics.failRate);
  const expiryRate = readNumber(metrics.expiryRate);
  const dispatchP95 = readNumber(
    isRecord(metrics.dispatch) ? metrics.dispatch.p95Ms : null,
  );
  const finalizationP95 = readNumber(
    isRecord(metrics.finalization) ? metrics.finalization.p95Ms : null,
  );
  const activeAlerts = alerts
    .filter((alert) => isRecord(alert) && readString(alert.state) !== "ok")
    .map((alert) => {
      const record = alert as Record<string, unknown>;
      return `${readString(record.id) ?? "unknown"}=${readString(record.state) ?? "unknown"}`;
    });
  return [
    `- failRate: ${failRate ?? "n/a"}`,
    `- expiryRate: ${expiryRate ?? "n/a"}`,
    `- dispatch p95 ms: ${dispatchP95 ?? "n/a"}`,
    `- finalization p95 ms: ${finalizationP95 ?? "n/a"}`,
    `- alerts: ${activeAlerts.length > 0 ? activeAlerts.join(", ") : "ok-or-insufficient-data"}`,
  ];
}

function formatCanarySummary(canary: Record<string, unknown>): string[] {
  const state = isRecord(canary.state) ? canary.state : {};
  const latestRuns = Array.isArray(canary.latestRuns) ? canary.latestRuns : [];
  const latestRun = latestRuns.find(isRecord) ?? null;
  return [
    `- enabled by config: ${String(isRecord(canary.config) ? canary.config.enabled : "unknown")}`,
    `- disabled: ${String(state.disabled ?? false)}`,
    `- disabledReason: ${readString(state.disabledReason) ?? "n/a"}`,
    `- latest run status: ${readString(latestRun?.status) ?? "n/a"}`,
    `- latest reconciliation status: ${readString(latestRun?.reconciliationStatus) ?? "n/a"}`,
  ];
}

function formatControlSummary(controls: Record<string, unknown>): string[] {
  const execution = isRecord(controls.execution) ? controls.execution : {};
  const canary = isRecord(controls.canary) ? controls.canary : {};
  const runtime = isRecord(controls.runtime) ? controls.runtime : {};
  const lanes = isRecord(execution.lanes) ? execution.lanes : {};
  return [
    `- execution enabled: ${String(execution.enabled ?? true)}`,
    `- execution disabledReason: ${readString(execution.disabledReason) ?? "n/a"}`,
    `- lane toggles: fast=${String(lanes.fast ?? true)}, protected=${String(lanes.protected ?? true)}, safe=${String(lanes.safe ?? true)}`,
    `- canary enabled: ${String(canary.enabled ?? true)}`,
    `- canary disabledReason: ${readString(canary.disabledReason) ?? "n/a"}`,
    `- runtime enabled: ${String(runtime.enabled ?? true)}`,
    `- runtime shadowOnly: ${String(runtime.shadowOnly ?? true)}`,
    `- runtime disabledReason: ${readString(runtime.disabledReason) ?? "n/a"}`,
    `- runtime shadowOnlyReason: ${readString(runtime.shadowOnlyReason) ?? "n/a"}`,
  ];
}

function formatRuntimeSummary(runtime: Record<string, unknown>): string[] {
  const integration = isRecord(runtime.integration) ? runtime.integration : {};
  const controls = isRecord(runtime.controls) ? runtime.controls : {};
  const health = isRecord(runtime.health) ? runtime.health : {};
  const canary = isRecord(runtime.canary) ? runtime.canary : {};
  const canaryState = isRecord(canary.state) ? canary.state : {};
  const canaryRuns = Array.isArray(canary.latestRuns)
    ? canary.latestRuns.filter(isRecord)
    : [];
  const latestCanaryRun = canaryRuns[0] ?? null;
  const feedGateway = isRecord(health.feedGateway) ? health.feedGateway : {};
  const featureCache = isRecord(health.featureCache) ? health.featureCache : {};
  const deployments = Array.isArray(runtime.deployments)
    ? runtime.deployments.filter(isRecord)
    : [];
  const stateCounts = deployments.reduce<Record<string, number>>(
    (acc, item) => {
      const state = readString(item.state) ?? "unknown";
      acc[state] = (acc[state] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const stateSummary =
    Object.keys(stateCounts).length > 0
      ? Object.entries(stateCounts)
          .map(([state, count]) => `${state}=${count}`)
          .join(", ")
      : "none";
  const staleCount =
    (Array.isArray(feedGateway.staleMarketStreams)
      ? feedGateway.staleMarketStreams.length
      : 0) +
    (Array.isArray(featureCache.staleFeatureKeys)
      ? featureCache.staleFeatureKeys.length
      : 0);
  const maxSlotAgeMs = Math.max(
    readNumber(feedGateway.maxSlotAgeMs) ?? 0,
    readNumber(featureCache.maxSlotAgeMs) ?? 0,
  );

  return [
    `- status: ${String(runtime.ok ?? false)}`,
    `- source: ${readString(runtime.source) ?? "n/a"}`,
    `- runtime enabled: ${String(controls.enabled ?? true)}`,
    `- shadow only: ${String(controls.shadowOnly ?? true)}`,
    `- shadowOnlyReason: ${readString(controls.shadowOnlyReason) ?? "n/a"}`,
    `- integration: stub=${String(integration.stubModeEnabled ?? false)}, baseUrl=${readString(integration.runtimeBaseUrl) ?? "n/a"}`,
    `- health status: ${readString(health.status) ?? "n/a"}`,
    `- max market age ms: ${readNumber(feedGateway.maxMarketAgeMs) ?? "n/a"}`,
    `- max feature age ms: ${readNumber(featureCache.maxFeatureAgeMs) ?? "n/a"}`,
    `- max slot age ms: ${maxSlotAgeMs || "n/a"}`,
    `- stale streams/features: ${staleCount}`,
    `- runtime canary disabled: ${String(canaryState.disabled ?? false)}`,
    `- runtime canary latest status: ${readString(latestCanaryRun?.status) ?? "n/a"}`,
    `- runtime canary reconciliation: ${readString(latestCanaryRun?.reconciliationStatus) ?? "n/a"}`,
    `- deployments: total=${deployments.length}, states=${stateSummary}`,
    `- error: ${readString(runtime.error) ?? "n/a"}`,
  ];
}

export function buildOpsDashboardMarkdown(
  snapshot: OpsDashboardSnapshot,
): string {
  const previewSummary = summarizePreviewHealth(snapshot.previews);
  const previewLines =
    snapshot.previews.length > 0
      ? snapshot.previews.map(
          (preview) =>
            `- PR #${preview.prNumber}: portal=${preview.portalOk ? "ok" : "down"}, worker=${preview.workerOk ? "ok" : "down"}`,
        )
      : ["- No open PR previews discovered."];
  return [
    "# Ops Dashboard",
    "",
    `Generated at: ${snapshot.generatedAt}`,
    "",
    "## Execution",
    ...formatExecutionSummary(snapshot.execution),
    "",
    "## Canary",
    ...formatCanarySummary(snapshot.canary),
    "",
    "## Controls",
    ...formatControlSummary(snapshot.controls),
    "",
    "## Runtime",
    ...formatRuntimeSummary(snapshot.runtime),
    "",
    "## Preview Health",
    `- total previews: ${previewSummary.total}`,
    `- healthy previews: ${previewSummary.healthy}`,
    `- failing previews: ${previewSummary.failing}`,
    ...previewLines,
    "",
    "## Runner Health",
    `- status: ${snapshot.runner.status}`,
    `- updatedAt: ${snapshot.runner.updatedAt ?? "n/a"}`,
    `- concurrency: ${snapshot.runner.concurrency ?? "n/a"}`,
    `- activeRuns: ${snapshot.runner.activeRuns ?? "n/a"}`,
    `- note: ${snapshot.runner.note ?? "n/a"}`,
  ].join("\n");
}
