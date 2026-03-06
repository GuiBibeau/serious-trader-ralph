"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../cn";
import { apiBase, BTN_SECONDARY, isRecord } from "../../lib";

type ExecutionInspectorEvent = {
  state: string;
  at: string | null;
  provider: string | null;
  attempt: number | null;
  note: string | null;
};

type ExecutionInspectorAttempt = {
  attempt: number;
  provider: string;
  state: string;
  at: string | null;
};

export type ExecutionInspectorSnapshot = {
  requestId: string;
  status: {
    state: string;
    terminal: boolean;
    mode: string | null;
    lane: string | null;
    actorType: string | null;
    receivedAt: string | null;
    updatedAt: string | null;
    terminalAt: string | null;
  };
  events: ExecutionInspectorEvent[];
  attempts: ExecutionInspectorAttempt[];
  receipt: {
    ready: boolean;
    receiptId: string | null;
    provider: string | null;
    generatedAt: string | null;
    outcomeStatus: string | null;
    signature: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    raw: unknown;
  };
};

type ExecutionInspectorDrawerProps = {
  open: boolean;
  requestId: string | null;
  onClose: () => void;
};

const POLL_INTERVAL_MS = 2500;

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

export function parseStatusPayload(payload: unknown): {
  requestId: string;
  status: ExecutionInspectorSnapshot["status"];
  events: ExecutionInspectorEvent[];
  attempts: ExecutionInspectorAttempt[];
} {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new Error("invalid-status-payload");
  }
  const requestId = parseOptionalString(payload.requestId);
  const statusRaw = isRecord(payload.status) ? payload.status : null;
  if (!requestId || !statusRaw) {
    throw new Error("invalid-status-payload");
  }
  const status = {
    state: parseOptionalString(statusRaw.state) ?? "unknown",
    terminal: statusRaw.terminal === true,
    mode: parseOptionalString(statusRaw.mode),
    lane: parseOptionalString(statusRaw.lane),
    actorType: parseOptionalString(statusRaw.actorType),
    receivedAt: parseOptionalString(statusRaw.receivedAt),
    updatedAt: parseOptionalString(statusRaw.updatedAt),
    terminalAt: parseOptionalString(statusRaw.terminalAt),
  };

  const events: ExecutionInspectorEvent[] = Array.isArray(payload.events)
    ? payload.events
        .map((event) => {
          if (!isRecord(event)) return null;
          return {
            state: parseOptionalString(event.state) ?? "unknown",
            at: parseOptionalString(event.at),
            provider: parseOptionalString(event.provider),
            attempt: parseOptionalInteger(event.attempt),
            note: parseOptionalString(event.note),
          };
        })
        .filter((event): event is ExecutionInspectorEvent => event !== null)
    : [];

  const attempts: ExecutionInspectorAttempt[] = Array.isArray(payload.attempts)
    ? payload.attempts
        .map((attempt) => {
          if (!isRecord(attempt)) return null;
          const attemptNo = parseOptionalInteger(attempt.attempt);
          const provider = parseOptionalString(attempt.provider);
          const state = parseOptionalString(attempt.state);
          return attemptNo !== null && provider && state
            ? {
                attempt: attemptNo,
                provider,
                state,
                at: parseOptionalString(attempt.at),
              }
            : null;
        })
        .filter(
          (attempt): attempt is ExecutionInspectorAttempt => attempt !== null,
        )
    : [];

  return { requestId, status, events, attempts };
}

export function parseReceiptPayload(
  payload: unknown,
): ExecutionInspectorSnapshot["receipt"] {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new Error("invalid-receipt-payload");
  }
  if (payload.ready !== true) {
    return {
      ready: false,
      receiptId: null,
      provider: null,
      generatedAt: null,
      outcomeStatus: null,
      signature: null,
      errorCode: null,
      errorMessage: null,
      raw: null,
    };
  }

  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  const outcome = receipt && isRecord(receipt.outcome) ? receipt.outcome : null;
  return {
    ready: true,
    receiptId: parseOptionalString(receipt?.receiptId),
    provider: parseOptionalString(receipt?.provider),
    generatedAt: parseOptionalString(receipt?.generatedAt),
    outcomeStatus: parseOptionalString(outcome?.status),
    signature: parseOptionalString(outcome?.signature),
    errorCode: parseOptionalString(outcome?.errorCode),
    errorMessage: parseOptionalString(outcome?.errorMessage),
    raw: receipt,
  };
}

export function normalizeInspectorError(
  input: ExecutionInspectorSnapshot,
): string | null {
  if (input.receipt.errorCode || input.receipt.errorMessage) {
    const code = input.receipt.errorCode ?? "submission-failed";
    const message = input.receipt.errorMessage ?? "execution failed";
    return `${code}: ${message}`;
  }
  const terminalState = input.status.state.toLowerCase();
  if (
    terminalState === "failed" ||
    terminalState === "expired" ||
    terminalState === "rejected"
  ) {
    return `execution-${terminalState}`;
  }
  return null;
}

async function fetchExecutionInspectorSnapshot(
  requestId: string,
  signal?: AbortSignal,
): Promise<ExecutionInspectorSnapshot> {
  const base = apiBase();
  if (!base) throw new Error("missing NEXT_PUBLIC_EDGE_API_BASE");
  const [statusResponse, receiptResponse] = await Promise.all([
    fetch(`${base}/api/x402/exec/status/${encodeURIComponent(requestId)}`, {
      method: "GET",
      signal,
    }),
    fetch(`${base}/api/x402/exec/receipt/${encodeURIComponent(requestId)}`, {
      method: "GET",
      signal,
    }),
  ]);

  const statusPayload = (await statusResponse
    .json()
    .catch(() => null)) as unknown;
  if (!statusResponse.ok) {
    throw new Error(`status-http-${statusResponse.status}`);
  }
  const receiptPayload = (await receiptResponse
    .json()
    .catch(() => null)) as unknown;
  if (!receiptResponse.ok) {
    throw new Error(`receipt-http-${receiptResponse.status}`);
  }

  const status = parseStatusPayload(statusPayload);
  const receipt = parseReceiptPayload(receiptPayload);
  return {
    requestId: status.requestId,
    status: status.status,
    events: status.events,
    attempts: status.attempts,
    receipt,
  };
}

function formatTimestamp(value: string | null): string {
  if (!value) return "--";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleTimeString();
}

function statusBadgeClass(state: string): string {
  const normalized = state.trim().toLowerCase();
  if (
    normalized === "failed" ||
    normalized === "expired" ||
    normalized === "rejected"
  ) {
    return "border-red-500/40 bg-red-500/10 text-red-300";
  }
  if (normalized === "landed" || normalized === "finalized") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
  return "border-sky-500/40 bg-sky-500/10 text-sky-300";
}

export const ExecutionInspectorDrawer = memo(function ExecutionInspectorDrawer(
  props: ExecutionInspectorDrawerProps,
) {
  const { open, requestId, onClose } = props;
  const [snapshot, setSnapshot] = useState<ExecutionInspectorSnapshot | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    setRefreshTick((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!open || !requestId) return;
    void refreshTick;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchExecutionInspectorSnapshot(requestId, controller.signal)
      .then((next) => {
        if (!mountedRef.current) return;
        setSnapshot(next);
      })
      .catch((fetchError) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        setError(
          fetchError instanceof Error ? fetchError.message : "inspector-error",
        );
      })
      .finally(() => {
        if (!mountedRef.current || controller.signal.aborted) return;
        setLoading(false);
      });
    return () => controller.abort();
  }, [open, refreshTick, requestId]);

  useEffect(() => {
    if (!open || !requestId) return;
    if (!snapshot) return;
    const terminalWithReceipt =
      snapshot.status.terminal && snapshot.receipt.ready;
    if (terminalWithReceipt) return;
    const timer = window.setTimeout(() => {
      refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [open, refresh, requestId, snapshot]);

  const normalizedError = useMemo(
    () => (snapshot ? normalizeInspectorError(snapshot) : null),
    [snapshot],
  );
  const timelineRows = useMemo(
    () => snapshot?.events ?? [],
    [snapshot?.events],
  );
  const attempts = useMemo(
    () => snapshot?.attempts ?? [],
    [snapshot?.attempts],
  );

  if (!open || !requestId) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-end bg-black/50 backdrop-blur-[2px]"
      data-testid="execution-inspector-drawer"
    >
      <button
        className="absolute inset-0"
        aria-label="Close execution inspector"
        onClick={onClose}
        type="button"
      />
      <aside className="relative z-10 h-full w-[min(520px,92vw)] border-l border-border bg-paper">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="label">EXECUTION_INSPECTOR</p>
            <p className="text-[11px] font-mono text-muted">{requestId}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={cn(BTN_SECONDARY, "h-7 px-2 text-[10px] uppercase")}
              onClick={refresh}
              type="button"
            >
              Refresh
            </button>
            <button
              className={cn(BTN_SECONDARY, "h-7 px-2 text-[10px] uppercase")}
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
        <div className="h-[calc(100%-57px)] overflow-auto p-4 text-xs space-y-3">
          {loading ? (
            <p className="text-muted">Loading execution trace...</p>
          ) : null}
          {error ? (
            <p className="text-red-300">inspector-error: {error}</p>
          ) : null}
          {snapshot ? (
            <>
              <div className="rounded border border-border bg-subtle p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted">
                    Status
                  </p>
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                      statusBadgeClass(snapshot.status.state),
                    )}
                  >
                    {snapshot.status.state}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  mode {snapshot.status.mode ?? "--"} • lane{" "}
                  {snapshot.status.lane ?? "--"} • actor{" "}
                  {snapshot.status.actorType ?? "--"}
                </p>
                <p className="text-[11px] text-muted">
                  received {formatTimestamp(snapshot.status.receivedAt)} •
                  updated {formatTimestamp(snapshot.status.updatedAt)} •
                  terminal {formatTimestamp(snapshot.status.terminalAt)}
                </p>
                {normalizedError ? (
                  <p className="mt-1 text-[11px] text-red-300">
                    {normalizedError}
                  </p>
                ) : null}
              </div>

              <div className="rounded border border-border bg-subtle p-2">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  Timeline
                </p>
                <div className="mt-2 space-y-1.5">
                  {timelineRows.length === 0 ? (
                    <p className="text-muted">No timeline events yet.</p>
                  ) : (
                    timelineRows.map((event, index) => (
                      <div
                        key={`timeline-${event.state}-${event.at ?? "na"}-${index}`}
                        className="grid grid-cols-[1fr_auto] gap-2 rounded border border-border/60 px-2 py-1"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-[11px] text-ink">
                            {event.state}
                            {event.attempt !== null
                              ? ` • attempt ${event.attempt}`
                              : ""}
                          </p>
                          <p className="text-[10px] text-muted">
                            provider {event.provider ?? "--"} •{" "}
                            {event.note ?? "no-note"}
                          </p>
                        </div>
                        <p className="text-[10px] text-muted">
                          {formatTimestamp(event.at)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded border border-border bg-subtle p-2">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  Attempts
                </p>
                <div className="mt-2 space-y-1.5">
                  {attempts.length === 0 ? (
                    <p className="text-muted">No attempts recorded yet.</p>
                  ) : (
                    attempts.map((attempt) => (
                      <div
                        key={`attempt-${attempt.attempt}`}
                        className="flex items-center justify-between rounded border border-border/60 px-2 py-1"
                      >
                        <p className="font-mono text-[11px] text-ink">
                          #{attempt.attempt} • {attempt.provider} •{" "}
                          {attempt.state}
                        </p>
                        <p className="text-[10px] text-muted">
                          {formatTimestamp(attempt.at)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded border border-border bg-subtle p-2">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  Terminal Receipt
                </p>
                {!snapshot.receipt.ready ? (
                  <p className="mt-1 text-muted">
                    Receipt not ready yet. Polling will continue until terminal.
                  </p>
                ) : (
                  <>
                    <p className="mt-1 font-mono text-[11px] text-ink">
                      {snapshot.receipt.outcomeStatus ?? "--"} • provider{" "}
                      {snapshot.receipt.provider ?? "--"}
                    </p>
                    <p className="text-[10px] text-muted">
                      receipt {snapshot.receipt.receiptId ?? "--"} • generated{" "}
                      {formatTimestamp(snapshot.receipt.generatedAt)}
                    </p>
                    <p className="text-[10px] text-muted break-all">
                      signature: {snapshot.receipt.signature ?? "--"}
                    </p>
                    {snapshot.receipt.errorCode ||
                    snapshot.receipt.errorMessage ? (
                      <p className="text-[10px] text-red-300">
                        {snapshot.receipt.errorCode ?? "submission-failed"}:{" "}
                        {snapshot.receipt.errorMessage ?? "execution error"}
                      </p>
                    ) : null}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[10px] text-muted">
                        View receipt payload
                      </summary>
                      <pre className="mt-1 overflow-auto rounded border border-border/60 bg-paper p-2 text-[10px] text-ink">
                        {JSON.stringify(snapshot.receipt.raw, null, 2)}
                      </pre>
                    </details>
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
});
