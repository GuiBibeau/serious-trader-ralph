"use client";

import {
  formatCompactNumber,
  formatFeedAge,
  formatPct,
  useMacroEtfFlows,
} from "./macro-feed";

export function MacroEtfWidget() {
  const feed = useMacroEtfFlows();
  const data = feed.data;
  const topEtfs = (data?.etfs ?? []).slice(0, 4);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          MACRO_ETF_FLOWS
        </p>
        <span className="text-[10px] font-mono text-muted">
          {formatFeedAge(feed.lastUpdatedMs)}
        </span>
      </div>
      <div className="flex-1 p-3 overflow-auto text-xs space-y-2">
        {feed.status === "loading" && !data ? (
          <p className="text-muted">Loading ETF flow structure...</p>
        ) : null}
        {feed.error ? <p className="text-amber-300">{feed.error}</p> : null}

        {data ? (
          <>
            <div className="rounded border border-border p-2">
              <p className="text-[10px] text-muted">Net Direction</p>
              <p className="font-mono text-sm">{data.summary.netDirection}</p>
              <p className="text-[10px] text-muted">
                Flow {formatCompactNumber(data.summary.totalEstFlow)} | Vol{" "}
                {formatCompactNumber(data.summary.totalVolume)}
              </p>
            </div>

            <div className="space-y-1.5">
              {topEtfs.length === 0 ? (
                <p className="text-muted">No ETF rows available.</p>
              ) : null}
              {topEtfs.map((row) => (
                <div
                  key={row.ticker}
                  className="rounded border border-border bg-subtle px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono">{row.ticker}</span>
                    <span>{formatPct(row.priceChange)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted">
                    <span>{row.direction}</span>
                    <span>VolRatio {row.volumeRatio.toFixed(2)}</span>
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
