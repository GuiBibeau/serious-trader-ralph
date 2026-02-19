"use client";

import { formatFeedAge, formatPct, useMacroFred } from "./macro-feed";

function sortByPriority(name: string): number {
  const order = [
    "Fed Funds Rate",
    "10Y Treasury",
    "10Y-2Y Spread",
    "Unemployment",
    "CPI Index",
    "VIX",
    "Fed Total Assets",
  ];
  const idx = order.indexOf(name);
  return idx === -1 ? order.length : idx;
}

export function MacroFredWidget() {
  const feed = useMacroFred();
  const data = feed.data;

  const rows = (data?.series ?? [])
    .slice()
    .sort((a, b) => sortByPriority(a.name) - sortByPriority(b.name))
    .slice(0, 6);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          MACRO_FRED
        </p>
        <span className="text-[10px] font-mono text-muted">
          {formatFeedAge(feed.lastUpdatedMs)}
        </span>
      </div>
      <div className="flex-1 p-3 overflow-auto text-xs">
        {feed.status === "loading" && !data ? (
          <p className="text-muted">Loading FRED indicators...</p>
        ) : null}
        {feed.error ? <p className="text-amber-300">{feed.error}</p> : null}

        {data ? (
          <>
            <p className="mb-2 text-[10px] text-muted">
              {data.configured
                ? "FRED feed active"
                : `FRED unavailable: ${data.unavailableReason ?? "not configured"}`}
            </p>
            <div className="space-y-1.5">
              {rows.length === 0 ? (
                <p className="text-muted">No series available.</p>
              ) : null}
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="rounded border border-border bg-subtle px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted truncate">
                      {row.name}
                    </span>
                    <span className="font-mono text-xs">
                      {row.value === null ? "--" : `${row.value}${row.unit}`}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted">
                    <span>{row.date || "--"}</span>
                    <span>{formatPct(row.changePercent)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
