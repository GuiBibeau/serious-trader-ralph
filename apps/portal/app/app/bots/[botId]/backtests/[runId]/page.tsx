"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../../../../cn";
import { apiFetchJson, BTN_SECONDARY, isRecord } from "../../../../../lib";

type BacktestDetailPayload = {
  run: {
    runId: string;
    status: "queued" | "running" | "completed" | "failed" | "canceled";
    kind: "validation" | "strategy_json";
    request: Record<string, unknown>;
    summary: {
      netReturnPct: number;
      maxDrawdownPct: number;
      tradeCount: number;
      strategyLabel: string;
      validationStatus?: "passed" | "failed";
    } | null;
    resultRef: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    queuedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    strategyLabel: string;
  };
  result: Record<string, unknown> | null;
  events: Array<{
    id: number;
    runId: string;
    level: string;
    message: string;
    meta: Record<string, unknown> | null;
    createdAt: string;
  }>;
};

function fmtTime(value: string | null): string {
  if (!value) return "-";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

export default function BacktestDetailsPage() {
  const params = useParams<{ botId: string; runId: string }>();
  const botId = params?.botId ?? "";
  const runId = params?.runId ?? "";
  const { ready, authenticated, getAccessToken } = usePrivy();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<BacktestDetailPayload | null>(null);

  useEffect(() => {
    if (!ready || !authenticated || !botId || !runId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("missing-access-token");
        const payload = await apiFetchJson(
          `/api/bots/${botId}/backtests/${runId}`,
          token,
          {
            method: "GET",
          },
        );
        if (!cancelled && isRecord(payload) && isRecord(payload.run)) {
          setDetail(payload as unknown as BacktestDetailPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, botId, runId, getAccessToken]);

  const requestJson = useMemo(
    () =>
      detail?.run.request ? JSON.stringify(detail.run.request, null, 2) : "{}",
    [detail],
  );
  const resultJson = useMemo(
    () => (detail?.result ? JSON.stringify(detail.result, null, 2) : "{}"),
    [detail],
  );

  return (
    <section className="flex-1 min-h-0 overflow-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-[1200px] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/app/bots/${botId}`}
            className={cn(BTN_SECONDARY, "text-sm")}
          >
            Back to Bot Room
          </Link>
          <h1 className="text-2xl font-semibold">Backtest Details</h1>
        </div>

        {loading ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-muted">
            Loading backtest…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-6 text-rose-400">
            {error}
          </div>
        ) : detail ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-xs text-muted uppercase tracking-wider">
                  Status
                </div>
                <div className="mt-1 text-lg font-semibold">
                  {detail.run.status}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-xs text-muted uppercase tracking-wider">
                  Queued
                </div>
                <div className="mt-1 text-sm">
                  {fmtTime(detail.run.queuedAt)}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-xs text-muted uppercase tracking-wider">
                  Started
                </div>
                <div className="mt-1 text-sm">
                  {fmtTime(detail.run.startedAt)}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="text-xs text-muted uppercase tracking-wider">
                  Completed
                </div>
                <div className="mt-1 text-sm">
                  {fmtTime(detail.run.completedAt)}
                </div>
              </div>
            </div>

            {detail.run.summary ? (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-surface p-4">
                  <div className="text-xs text-muted uppercase tracking-wider">
                    Net Return
                  </div>
                  <div
                    className={cn(
                      "mt-1 text-2xl font-mono",
                      detail.run.summary.netReturnPct >= 0
                        ? "text-emerald-400"
                        : "text-rose-400",
                    )}
                  >
                    {detail.run.summary.netReturnPct >= 0 ? "+" : ""}
                    {detail.run.summary.netReturnPct.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-surface p-4">
                  <div className="text-xs text-muted uppercase tracking-wider">
                    Max Drawdown
                  </div>
                  <div className="mt-1 text-2xl font-mono">
                    {detail.run.summary.maxDrawdownPct.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-surface p-4">
                  <div className="text-xs text-muted uppercase tracking-wider">
                    Trade Count
                  </div>
                  <div className="mt-1 text-2xl font-mono">
                    {detail.run.summary.tradeCount}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface p-3 min-h-[280px]">
                <div className="mb-2 text-xs text-muted uppercase tracking-wider">
                  Configuration
                </div>
                <pre className="h-[240px] overflow-auto rounded bg-paper/40 p-3 text-xs leading-relaxed">
                  {requestJson}
                </pre>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3 min-h-[280px]">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted uppercase tracking-wider">
                  <span>Result</span>
                  {detail.run.resultRef ? (
                    <span className="normal-case text-[11px] text-muted">
                      artifact: {detail.run.resultRef}
                    </span>
                  ) : null}
                </div>
                <pre className="h-[240px] overflow-auto rounded bg-paper/40 p-3 text-xs leading-relaxed">
                  {resultJson}
                </pre>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-2 text-xs text-muted uppercase tracking-wider">
                Timeline
              </div>
              <div className="max-h-[300px] overflow-auto space-y-2 pr-1">
                {detail.events.length > 0 ? (
                  detail.events.map((event) => (
                    <div
                      key={event.id}
                      className="rounded border border-border/80 bg-paper/20 p-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium uppercase tracking-wider text-muted">
                          {event.level}
                        </span>
                        <span className="text-muted">
                          {fmtTime(event.createdAt)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm">{event.message}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted">
                    No timeline events yet.
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
