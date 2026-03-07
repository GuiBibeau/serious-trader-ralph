const TERMINAL_STATUS_SET = new Set([
  "landed",
  "finalized",
  "failed",
  "expired",
  "rejected",
]);
const SUCCESS_STATUS_SET = new Set(["landed", "finalized"]);
const FAILURE_STATUS_SET = new Set(["failed", "expired", "rejected"]);

type RequestRow = {
  requestId: string;
  lane: string;
  mode: string;
  actorType: string;
  status: string;
  statusReason: string | null;
  receivedAt: string;
  terminalAt: string | null;
};

type EventRow = {
  requestId: string;
  status: string;
  createdAt: string;
};

type AttemptRow = {
  requestId: string;
  attemptNo: number;
  provider: string;
  status: string;
  errorCode: string | null;
  completedAt: string | null;
};

export type ObservabilityLatencySummary = {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

export type ObservabilityOutcomeBucket = {
  key: string;
  accepted: number;
  terminal: number;
  succeeded: number;
  failed: number;
  expired: number;
  failRate: number;
  expiryRate: number;
};

export type ObservabilityProviderBucket = {
  provider: string;
  attempts: number;
  errorAttempts: number;
  errorAttemptRate: number;
  requests: number;
  succeeded: number;
  failed: number;
  expired: number;
  failRate: number;
};

export type ObservabilityAlert = {
  code:
    | "fail-rate"
    | "expiry-rate"
    | "dispatch-latency-p95"
    | "landing-latency-p95"
    | "finalization-latency-p95";
  state: "ok" | "warning" | "critical" | "insufficient-data";
  observed: number;
  thresholdWarning: number;
  thresholdCritical: number;
  unit: "ratio" | "ms";
  sampleSize: number;
};

export type ExecutionObservabilityThresholds = {
  minSampleSize: number;
  failRateWarning: number;
  failRateCritical: number;
  expiryRateWarning: number;
  expiryRateCritical: number;
  dispatchP95WarningMs: number;
  dispatchP95CriticalMs: number;
  landingP95WarningMs: number;
  landingP95CriticalMs: number;
  finalizationP95WarningMs: number;
  finalizationP95CriticalMs: number;
};

export const DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS: ExecutionObservabilityThresholds =
  {
    minSampleSize: 20,
    failRateWarning: 0.05,
    failRateCritical: 0.1,
    expiryRateWarning: 0.01,
    expiryRateCritical: 0.03,
    dispatchP95WarningMs: 3_000,
    dispatchP95CriticalMs: 8_000,
    landingP95WarningMs: 45_000,
    landingP95CriticalMs: 120_000,
    finalizationP95WarningMs: 90_000,
    finalizationP95CriticalMs: 300_000,
  };

export type ExecutionObservabilitySnapshot = {
  window: {
    from: string;
    to: string;
    minutes: number;
    maxRequests: number;
    sampledRequests: number;
  };
  totals: {
    accepted: number;
    terminal: number;
    succeeded: number;
    failed: number;
    expired: number;
    failRate: number;
    expiryRate: number;
    duplicateRate: number;
  };
  latenciesMs: {
    dispatch: ObservabilityLatencySummary;
    landing: ObservabilityLatencySummary;
    finalization: ObservabilityLatencySummary;
  };
  dimensions: {
    lane: ObservabilityOutcomeBucket[];
    mode: ObservabilityOutcomeBucket[];
    actor: ObservabilityOutcomeBucket[];
    provider: ObservabilityProviderBucket[];
  };
  alerts: ObservabilityAlert[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

async function queryRows(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all();
  const rows = asRows((result as { results?: unknown[] }).results ?? []);
  return rows;
}

function stringValue(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeRate(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return roundTo(numerator / denominator, 6);
}

function toMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length < 1) return 0;
  const rank = Math.ceil((pct / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx] ?? 0;
}

function summarizeLatency(samples: number[]): ObservabilityLatencySummary {
  const normalized = samples
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Math.round(value));
  if (normalized.length < 1) {
    return {
      count: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
    };
  }
  normalized.sort((a, b) => a - b);
  const total = normalized.reduce((sum, value) => sum + value, 0);
  return {
    count: normalized.length,
    avgMs: Math.round(total / normalized.length),
    p50Ms: percentile(normalized, 50),
    p95Ms: percentile(normalized, 95),
    maxMs: normalized[normalized.length - 1] ?? 0,
  };
}

function mapRequestRows(rows: Array<Record<string, unknown>>): RequestRow[] {
  return rows.map((row) => ({
    requestId: stringValue(row.requestId),
    lane: stringValue(row.lane, "fast"),
    mode: stringValue(row.mode, "relay_signed"),
    actorType: stringValue(row.actorType, "anonymous_x402"),
    status: stringValue(row.status, "received"),
    statusReason: stringOrNull(row.statusReason),
    receivedAt: stringValue(row.receivedAt),
    terminalAt: stringOrNull(row.terminalAt),
  }));
}

function mapEventRows(rows: Array<Record<string, unknown>>): EventRow[] {
  return rows.map((row) => ({
    requestId: stringValue(row.requestId),
    status: stringValue(row.status),
    createdAt: stringValue(row.createdAt),
  }));
}

function mapAttemptRows(rows: Array<Record<string, unknown>>): AttemptRow[] {
  return rows.map((row) => ({
    requestId: stringValue(row.requestId),
    attemptNo: numberValue(row.attemptNo, 0),
    provider: stringValue(row.provider, "unknown"),
    status: stringValue(row.status),
    errorCode: stringOrNull(row.errorCode),
    completedAt: stringOrNull(row.completedAt),
  }));
}

type OutcomeCounter = {
  accepted: number;
  terminal: number;
  succeeded: number;
  failed: number;
  expired: number;
};

function nextOutcomeCounter(): OutcomeCounter {
  return {
    accepted: 0,
    terminal: 0,
    succeeded: 0,
    failed: 0,
    expired: 0,
  };
}

function recordOutcome(counter: OutcomeCounter, status: string): void {
  counter.accepted += 1;
  if (TERMINAL_STATUS_SET.has(status)) {
    counter.terminal += 1;
  }
  if (SUCCESS_STATUS_SET.has(status)) {
    counter.succeeded += 1;
  }
  if (FAILURE_STATUS_SET.has(status)) {
    counter.failed += 1;
  }
  if (status === "expired") {
    counter.expired += 1;
  }
}

function toOutcomeBucket(
  key: string,
  counter: OutcomeCounter,
): ObservabilityOutcomeBucket {
  return {
    key,
    accepted: counter.accepted,
    terminal: counter.terminal,
    succeeded: counter.succeeded,
    failed: counter.failed,
    expired: counter.expired,
    failRate: safeRate(counter.failed, counter.accepted),
    expiryRate: safeRate(counter.expired, counter.accepted),
  };
}

function sortOutcomeBuckets(
  map: Map<string, OutcomeCounter>,
): ObservabilityOutcomeBucket[] {
  return Array.from(map.entries())
    .map(([key, counter]) => toOutcomeBucket(key, counter))
    .sort((a, b) => {
      if (b.accepted !== a.accepted) return b.accepted - a.accepted;
      return a.key.localeCompare(b.key);
    });
}

function isAttemptErrorStatus(value: string): boolean {
  const status = value.trim().toLowerCase();
  if (!status) return false;
  return (
    status.includes("error") ||
    status === "failed" ||
    status === "rejected" ||
    status === "expired"
  );
}

function evaluateAlert(input: {
  code: ObservabilityAlert["code"];
  observed: number;
  warning: number;
  critical: number;
  sampleSize: number;
  minSampleSize: number;
  unit: ObservabilityAlert["unit"];
}): ObservabilityAlert {
  if (input.sampleSize < input.minSampleSize) {
    return {
      code: input.code,
      state: "insufficient-data",
      observed: roundTo(input.observed, 6),
      thresholdWarning: roundTo(input.warning, 6),
      thresholdCritical: roundTo(input.critical, 6),
      unit: input.unit,
      sampleSize: input.sampleSize,
    };
  }
  if (input.observed >= input.critical) {
    return {
      code: input.code,
      state: "critical",
      observed: roundTo(input.observed, 6),
      thresholdWarning: roundTo(input.warning, 6),
      thresholdCritical: roundTo(input.critical, 6),
      unit: input.unit,
      sampleSize: input.sampleSize,
    };
  }
  if (input.observed >= input.warning) {
    return {
      code: input.code,
      state: "warning",
      observed: roundTo(input.observed, 6),
      thresholdWarning: roundTo(input.warning, 6),
      thresholdCritical: roundTo(input.critical, 6),
      unit: input.unit,
      sampleSize: input.sampleSize,
    };
  }
  return {
    code: input.code,
    state: "ok",
    observed: roundTo(input.observed, 6),
    thresholdWarning: roundTo(input.warning, 6),
    thresholdCritical: roundTo(input.critical, 6),
    unit: input.unit,
    sampleSize: input.sampleSize,
  };
}

export async function readExecutionObservabilitySnapshot(input: {
  db: D1Database;
  nowIso?: string;
  windowMinutes: number;
  maxRequests: number;
  thresholds?: ExecutionObservabilityThresholds;
}): Promise<ExecutionObservabilitySnapshot> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const toMsValue = Date.parse(nowIso);
  const toMsSafe = Number.isFinite(toMsValue) ? toMsValue : Date.now();
  const fromIso = new Date(
    toMsSafe - Math.max(1, Math.floor(input.windowMinutes)) * 60_000,
  ).toISOString();
  const maxRequests = Math.max(100, Math.floor(input.maxRequests));
  const thresholds =
    input.thresholds ?? DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS;

  const requestRows = mapRequestRows(
    await queryRows(
      input.db,
      `SELECT
        request_id AS requestId,
        lane,
        mode,
        actor_type AS actorType,
        status,
        status_reason AS statusReason,
        received_at AS receivedAt,
        terminal_at AS terminalAt
      FROM execution_requests
      WHERE received_at >= ?1
      ORDER BY received_at DESC
      LIMIT ?2`,
      [fromIso, maxRequests],
    ),
  );

  const eventRows = mapEventRows(
    await queryRows(
      input.db,
      `WITH window_requests AS (
        SELECT request_id
        FROM execution_requests
        WHERE received_at >= ?1
        ORDER BY received_at DESC
        LIMIT ?2
      )
      SELECT
        e.request_id AS requestId,
        e.status AS status,
        e.created_at AS createdAt
      FROM execution_status_events e
      INNER JOIN window_requests w ON w.request_id = e.request_id
      WHERE e.status IN ('dispatched', 'landed', 'finalized')
      ORDER BY e.request_id ASC, e.seq ASC`,
      [fromIso, maxRequests],
    ),
  );

  const attemptRows = mapAttemptRows(
    await queryRows(
      input.db,
      `WITH window_requests AS (
        SELECT request_id
        FROM execution_requests
        WHERE received_at >= ?1
        ORDER BY received_at DESC
        LIMIT ?2
      )
      SELECT
        a.request_id AS requestId,
        a.attempt_no AS attemptNo,
        a.provider AS provider,
        a.status AS status,
        a.error_code AS errorCode,
        a.completed_at AS completedAt
      FROM execution_attempts a
      INNER JOIN window_requests w ON w.request_id = a.request_id
      ORDER BY a.request_id ASC, a.attempt_no DESC`,
      [fromIso, maxRequests],
    ),
  );

  const totalsCounter = nextOutcomeCounter();
  const laneCounters = new Map<string, OutcomeCounter>();
  const modeCounters = new Map<string, OutcomeCounter>();
  const actorCounters = new Map<string, OutcomeCounter>();

  const requestsById = new Map<
    string,
    {
      lane: string;
      mode: string;
      actorType: string;
      status: string;
      receivedAtMs: number | null;
      terminalAtMs: number | null;
    }
  >();

  for (const row of requestRows) {
    recordOutcome(totalsCounter, row.status);

    const laneCounter = laneCounters.get(row.lane) ?? nextOutcomeCounter();
    recordOutcome(laneCounter, row.status);
    laneCounters.set(row.lane, laneCounter);

    const modeCounter = modeCounters.get(row.mode) ?? nextOutcomeCounter();
    recordOutcome(modeCounter, row.status);
    modeCounters.set(row.mode, modeCounter);

    const actorCounter =
      actorCounters.get(row.actorType) ?? nextOutcomeCounter();
    recordOutcome(actorCounter, row.status);
    actorCounters.set(row.actorType, actorCounter);

    requestsById.set(row.requestId, {
      lane: row.lane,
      mode: row.mode,
      actorType: row.actorType,
      status: row.status,
      receivedAtMs: toMs(row.receivedAt),
      terminalAtMs: toMs(row.terminalAt),
    });
  }

  const eventTimesByRequest = new Map<
    string,
    {
      dispatchedAtMs: number | null;
      landedAtMs: number | null;
      finalizedAtMs: number | null;
    }
  >();

  for (const row of eventRows) {
    const current = eventTimesByRequest.get(row.requestId) ?? {
      dispatchedAtMs: null,
      landedAtMs: null,
      finalizedAtMs: null,
    };
    const eventMs = toMs(row.createdAt);
    if (eventMs === null) continue;
    if (row.status === "dispatched" && current.dispatchedAtMs === null) {
      current.dispatchedAtMs = eventMs;
    }
    if (row.status === "landed" && current.landedAtMs === null) {
      current.landedAtMs = eventMs;
    }
    if (row.status === "finalized" && current.finalizedAtMs === null) {
      current.finalizedAtMs = eventMs;
    }
    eventTimesByRequest.set(row.requestId, current);
  }

  const attemptsPerRequest = new Map<string, number>();
  const finalProviderByRequest = new Map<string, string>();
  const providerCounters = new Map<
    string,
    {
      attempts: number;
      errorAttempts: number;
      requests: number;
      succeeded: number;
      failed: number;
      expired: number;
    }
  >();

  for (const row of attemptRows) {
    attemptsPerRequest.set(
      row.requestId,
      (attemptsPerRequest.get(row.requestId) ?? 0) + 1,
    );

    if (!finalProviderByRequest.has(row.requestId)) {
      finalProviderByRequest.set(row.requestId, row.provider);
    }

    const providerCounter = providerCounters.get(row.provider) ?? {
      attempts: 0,
      errorAttempts: 0,
      requests: 0,
      succeeded: 0,
      failed: 0,
      expired: 0,
    };
    providerCounter.attempts += 1;
    if (row.errorCode || isAttemptErrorStatus(row.status)) {
      providerCounter.errorAttempts += 1;
    }
    providerCounters.set(row.provider, providerCounter);
  }

  for (const [requestId, provider] of finalProviderByRequest.entries()) {
    const request = requestsById.get(requestId);
    if (!request) continue;
    const providerCounter = providerCounters.get(provider);
    if (!providerCounter) continue;
    providerCounter.requests += 1;
    if (SUCCESS_STATUS_SET.has(request.status)) {
      providerCounter.succeeded += 1;
    }
    if (FAILURE_STATUS_SET.has(request.status)) {
      providerCounter.failed += 1;
    }
    if (request.status === "expired") {
      providerCounter.expired += 1;
    }
    providerCounters.set(provider, providerCounter);
  }

  const dispatchLatenciesMs: number[] = [];
  const landingLatenciesMs: number[] = [];
  const finalizationLatenciesMs: number[] = [];

  for (const [requestId, request] of requestsById.entries()) {
    const eventTimes = eventTimesByRequest.get(requestId);
    if (eventTimes && request.receivedAtMs !== null) {
      if (eventTimes.dispatchedAtMs !== null) {
        const dispatchDelta = eventTimes.dispatchedAtMs - request.receivedAtMs;
        if (dispatchDelta >= 0) {
          dispatchLatenciesMs.push(dispatchDelta);
        }
      }
      const landedAtMs = eventTimes.landedAtMs ?? eventTimes.finalizedAtMs;
      if (eventTimes.dispatchedAtMs !== null && landedAtMs !== null) {
        const landingDelta = landedAtMs - eventTimes.dispatchedAtMs;
        if (landingDelta >= 0) {
          landingLatenciesMs.push(landingDelta);
        }
      }
    }

    if (request.receivedAtMs !== null && request.terminalAtMs !== null) {
      const finalizationDelta = request.terminalAtMs - request.receivedAtMs;
      if (finalizationDelta >= 0) {
        finalizationLatenciesMs.push(finalizationDelta);
      }
    }
  }

  const duplicateRequests = Array.from(attemptsPerRequest.values()).filter(
    (attemptCount) => attemptCount > 1,
  ).length;

  const dispatchSummary = summarizeLatency(dispatchLatenciesMs);
  const landingSummary = summarizeLatency(landingLatenciesMs);
  const finalizationSummary = summarizeLatency(finalizationLatenciesMs);

  const totals = {
    accepted: totalsCounter.accepted,
    terminal: totalsCounter.terminal,
    succeeded: totalsCounter.succeeded,
    failed: totalsCounter.failed,
    expired: totalsCounter.expired,
    failRate: safeRate(totalsCounter.failed, totalsCounter.accepted),
    expiryRate: safeRate(totalsCounter.expired, totalsCounter.accepted),
    duplicateRate: safeRate(duplicateRequests, totalsCounter.accepted),
  };

  const provider = Array.from(providerCounters.entries())
    .map(([providerName, counter]) => ({
      provider: providerName,
      attempts: counter.attempts,
      errorAttempts: counter.errorAttempts,
      errorAttemptRate: safeRate(counter.errorAttempts, counter.attempts),
      requests: counter.requests,
      succeeded: counter.succeeded,
      failed: counter.failed,
      expired: counter.expired,
      failRate: safeRate(counter.failed, counter.requests),
    }))
    .sort((a, b) => {
      if (b.attempts !== a.attempts) return b.attempts - a.attempts;
      return a.provider.localeCompare(b.provider);
    });

  const alerts: ObservabilityAlert[] = [
    evaluateAlert({
      code: "fail-rate",
      observed: totals.failRate,
      warning: thresholds.failRateWarning,
      critical: thresholds.failRateCritical,
      sampleSize: totals.accepted,
      minSampleSize: thresholds.minSampleSize,
      unit: "ratio",
    }),
    evaluateAlert({
      code: "expiry-rate",
      observed: totals.expiryRate,
      warning: thresholds.expiryRateWarning,
      critical: thresholds.expiryRateCritical,
      sampleSize: totals.accepted,
      minSampleSize: thresholds.minSampleSize,
      unit: "ratio",
    }),
    evaluateAlert({
      code: "dispatch-latency-p95",
      observed: dispatchSummary.p95Ms,
      warning: thresholds.dispatchP95WarningMs,
      critical: thresholds.dispatchP95CriticalMs,
      sampleSize: dispatchSummary.count,
      minSampleSize: thresholds.minSampleSize,
      unit: "ms",
    }),
    evaluateAlert({
      code: "landing-latency-p95",
      observed: landingSummary.p95Ms,
      warning: thresholds.landingP95WarningMs,
      critical: thresholds.landingP95CriticalMs,
      sampleSize: landingSummary.count,
      minSampleSize: thresholds.minSampleSize,
      unit: "ms",
    }),
    evaluateAlert({
      code: "finalization-latency-p95",
      observed: finalizationSummary.p95Ms,
      warning: thresholds.finalizationP95WarningMs,
      critical: thresholds.finalizationP95CriticalMs,
      sampleSize: finalizationSummary.count,
      minSampleSize: thresholds.minSampleSize,
      unit: "ms",
    }),
  ];

  return {
    window: {
      from: fromIso,
      to: nowIso,
      minutes: Math.max(1, Math.floor(input.windowMinutes)),
      maxRequests,
      sampledRequests: requestRows.length,
    },
    totals,
    latenciesMs: {
      dispatch: dispatchSummary,
      landing: landingSummary,
      finalization: finalizationSummary,
    },
    dimensions: {
      lane: sortOutcomeBuckets(laneCounters),
      mode: sortOutcomeBuckets(modeCounters),
      actor: sortOutcomeBuckets(actorCounters),
      provider,
    },
    alerts,
  };
}
