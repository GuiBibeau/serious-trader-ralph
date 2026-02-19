"use client";

import {
  formatCompactNumber,
  formatFeedAge,
  formatPct,
  useMacroStablecoinHealth,
} from "./macro-feed";

export function MacroStablecoinWidget() {
  const feed = useMacroStablecoinHealth();
  const data = feed.data;
  const rows = (data?.stablecoins ?? []).slice(0, 4);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          STABLECOIN_HEALTH
        </p>
        <span className="text-[10px] font-mono text-muted">
          {formatFeedAge(feed.lastUpdatedMs)}
        </span>
      </div>
      <div className="flex-1 p-3 overflow-auto text-xs space-y-2">
        {feed.status === "loading" && !data ? (
          <p className="text-muted">Loading stablecoin health...</p>
        ) : null}
        {feed.error ? <p className="text-amber-300">{feed.error}</p> : null}

        {data ? (
          <>
            <div className="rounded border border-border p-2">
              <p className="text-[10px] text-muted">Health Status</p>
              <p className="font-mono text-sm">{data.summary.healthStatus}</p>
              <p className="text-[10px] text-muted">
                Cap {formatCompactNumber(data.summary.totalMarketCap)} | 24h Vol{" "}
                {formatCompactNumber(data.summary.totalVolume24h)}
              </p>
            </div>

            <div className="space-y-1.5">
              {rows.length === 0 ? (
                <p className="text-muted">No stablecoin rows available.</p>
              ) : null}
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="rounded border border-border bg-subtle px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono">{row.symbol}</span>
                    <span>{row.price.toFixed(4)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted">
                    <span>{row.pegStatus}</span>
                    <span>
                      dev {row.deviation.toFixed(3)}% |{" "}
                      {formatPct(row.change24h)}
                    </span>
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
