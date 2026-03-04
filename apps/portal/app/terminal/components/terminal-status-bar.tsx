"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { cn } from "../../cn";
import { apiBase, isRecord } from "../../lib";
import type { TerminalRealtimeState } from "./realtime-transport";
import type { MarketState } from "./sol-market-feed";
import type {
  TerminalRenderBudgetResult,
  TerminalRenderSnapshot,
} from "./terminal-performance";

type TerminalStatusBarProps = {
  realtime: TerminalRealtimeState;
  market: MarketState;
  renderPerformance?: {
    snapshot: TerminalRenderSnapshot | null;
    budget: TerminalRenderBudgetResult | null;
  };
};

type LaneHealth = {
  enabled: boolean;
  adapter: string | null;
};

type ExecHealthSnapshot = {
  ok: boolean;
  serverNowIso: string | null;
  lanes: {
    fast: LaneHealth;
    protected: LaneHealth;
    safe: LaneHealth;
  };
};

const HEALTH_POLL_MS = 5_000;
const MARKET_STALE_MS = 20_000;
const ACCOUNT_STALE_MS = 20_000;
const TIME_SKEW_WARNING_MS = 5_000;

export function classifyStaleness(
  lastUpdatedMs: number | null,
  staleAfterMs: number,
): "fresh" | "stale" | "missing" {
  if (!lastUpdatedMs || !Number.isFinite(lastUpdatedMs)) return "missing";
  return Date.now() - lastUpdatedMs > staleAfterMs ? "stale" : "fresh";
}

export function computeTimeSkewMs(serverNowIso: string | null): number | null {
  if (!serverNowIso) return null;
  const parsed = Date.parse(serverNowIso);
  if (!Number.isFinite(parsed)) return null;
  return Date.now() - parsed;
}

function parseLaneHealth(value: unknown): LaneHealth {
  if (!isRecord(value)) {
    return { enabled: false, adapter: null };
  }
  return {
    enabled: value.enabled === true,
    adapter:
      typeof value.adapter === "string" && value.adapter.trim()
        ? value.adapter.trim()
        : null,
  };
}

function parseExecHealthPayload(payload: unknown): ExecHealthSnapshot | null {
  if (!isRecord(payload)) return null;
  const lanes = isRecord(payload.lanes) ? payload.lanes : null;
  if (!lanes) return null;
  return {
    ok: payload.ok === true,
    serverNowIso:
      typeof payload.now === "string" && payload.now.trim()
        ? payload.now.trim()
        : null,
    lanes: {
      fast: parseLaneHealth(lanes.fast),
      protected: parseLaneHealth(lanes.protected),
      safe: parseLaneHealth(lanes.safe),
    },
  };
}

function healthChipClass(level: "good" | "warn" | "bad"): string {
  if (level === "good")
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (level === "warn")
    return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-red-500/40 bg-red-500/10 text-red-300";
}

export const TerminalStatusBar = memo(function TerminalStatusBar(
  props: TerminalStatusBarProps,
) {
  const { realtime, market, renderPerformance } = props;
  const [execHealth, setExecHealth] = useState<ExecHealthSnapshot | null>(null);
  const [execHealthError, setExecHealthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadHealth(): Promise<void> {
      const base = apiBase();
      if (!base) {
        if (!cancelled) setExecHealthError("missing NEXT_PUBLIC_EDGE_API_BASE");
        return;
      }
      try {
        const response = await fetch(`${base}/api/x402/exec/health`, {
          method: "GET",
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          throw new Error(`health-http-${response.status}`);
        }
        const parsed = parseExecHealthPayload(payload);
        if (!parsed) throw new Error("invalid-health-payload");
        if (cancelled) return;
        setExecHealth(parsed);
        setExecHealthError(null);
      } catch (error) {
        if (cancelled) return;
        setExecHealthError(
          error instanceof Error ? error.message : "health-fetch-error",
        );
      }
    }

    void loadHealth();
    const timer = window.setInterval(() => {
      void loadHealth();
    }, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const marketFreshness = classifyStaleness(
    market.lastUpdatedMs,
    MARKET_STALE_MS,
  );
  const accountFreshness = classifyStaleness(
    realtime.account?.ts ?? null,
    ACCOUNT_STALE_MS,
  );
  const timeSkewMs = computeTimeSkewMs(execHealth?.serverNowIso ?? null);
  const timeSkewLevel: "good" | "warn" =
    timeSkewMs !== null && Math.abs(timeSkewMs) > TIME_SKEW_WARNING_MS
      ? "warn"
      : "good";
  const perfLevel: "good" | "warn" | "bad" =
    renderPerformance?.budget?.level ?? "good";

  const laneSummary = useMemo(() => {
    if (!execHealth) return "lanes --";
    const rows = [
      `fast:${execHealth.lanes.fast.enabled ? "up" : "down"}`,
      `prot:${execHealth.lanes.protected.enabled ? "up" : "down"}`,
      `safe:${execHealth.lanes.safe.enabled ? "up" : "down"}`,
    ];
    return rows.join(" ");
  }, [execHealth]);

  return (
    <div className="h-8 shrink-0 border border-border bg-surface px-2.5 text-[10px]">
      <div className="flex h-full items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 uppercase tracking-wider",
              healthChipClass(
                realtime.health === "live"
                  ? "good"
                  : realtime.health === "degraded" ||
                      realtime.health === "stale"
                    ? "warn"
                    : "bad",
              ),
            )}
          >
            stream {realtime.health}
          </span>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 uppercase tracking-wider",
              healthChipClass(
                execHealthError
                  ? "bad"
                  : execHealth?.ok === false
                    ? "warn"
                    : "good",
              ),
            )}
          >
            api {execHealthError ? "down" : "up"}
          </span>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 uppercase tracking-wider",
              healthChipClass(marketFreshness === "fresh" ? "good" : "warn"),
            )}
          >
            market {marketFreshness}
          </span>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 uppercase tracking-wider",
              healthChipClass(accountFreshness === "fresh" ? "good" : "warn"),
            )}
          >
            account {accountFreshness}
          </span>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 uppercase tracking-wider",
              healthChipClass(timeSkewLevel),
            )}
          >
            clock{" "}
            {timeSkewMs === null
              ? "--"
              : `${Math.round(timeSkewMs / 1000).toString()}s`}
          </span>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 uppercase tracking-wider",
              healthChipClass(perfLevel),
            )}
          >
            perf{" "}
            {renderPerformance?.snapshot
              ? `${Math.round(renderPerformance.snapshot.fps).toString()}fps`
              : "--"}
          </span>
          <span className="text-muted">{laneSummary}</span>
          {realtime.reason ? (
            <span className="text-amber-300 truncate">
              reason: {realtime.reason}
            </span>
          ) : null}
          {execHealthError ? (
            <span className="text-red-300 truncate">
              health: {execHealthError}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 whitespace-nowrap">
          <a
            className="text-muted underline underline-offset-2"
            href="/api/x402/exec/health"
            target="_blank"
            rel="noreferrer"
          >
            Diagnostics
          </a>
          <span className="text-muted">|</span>
          <a
            className="text-muted underline underline-offset-2"
            href="/api"
            target="_blank"
            rel="noreferrer"
          >
            Help
          </a>
        </div>
      </div>
    </div>
  );
});
