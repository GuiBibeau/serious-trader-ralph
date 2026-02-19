"use client";

import { formatFeedAge, formatPct, useMacroOilAnalytics } from "./macro-feed";

export function MacroOilWidget() {
  const feed = useMacroOilAnalytics();
  const data = feed.data;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          OIL_ANALYTICS
        </p>
        <span className="text-[10px] font-mono text-muted">
          {formatFeedAge(feed.lastUpdatedMs)}
        </span>
      </div>
      <div className="flex-1 p-3 overflow-auto text-xs space-y-2">
        {feed.status === "loading" && !data ? (
          <p className="text-muted">Loading oil analytics...</p>
        ) : null}
        {feed.error ? <p className="text-amber-300">{feed.error}</p> : null}

        {data ? (
          <>
            <p className="text-[10px] text-muted">
              {data.configured
                ? `Fetched ${data.fetchedAt || "--"}`
                : `EIA unavailable: ${data.unavailableReason ?? "not configured"}`}
            </p>

            <div className="grid grid-cols-2 gap-2">
              <MetricCell metric={data.wtiPrice} />
              <MetricCell metric={data.brentPrice} />
              <MetricCell metric={data.usProduction} />
              <MetricCell metric={data.usInventory} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MetricCell(props: {
  metric: {
    name: string;
    current: number;
    unit: string;
    changePct: number;
  } | null;
}) {
  const { metric } = props;
  if (!metric) {
    return (
      <div className="rounded border border-border bg-subtle px-2 py-1.5">
        <p className="text-[10px] text-muted">N/A</p>
        <p className="font-mono text-sm">--</p>
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-subtle px-2 py-1.5">
      <p className="text-[10px] text-muted truncate">{metric.name}</p>
      <p className="font-mono text-sm">
        {metric.current.toFixed(2)} {metric.unit}
      </p>
      <p className="text-[10px] text-muted">{formatPct(metric.changePct)}</p>
    </div>
  );
}
