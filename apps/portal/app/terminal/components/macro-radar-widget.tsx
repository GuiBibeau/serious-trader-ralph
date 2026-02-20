"use client";

import { cn } from "../../cn";
import { BTN_SECONDARY } from "../../lib";
import { formatFeedAge, formatPct, useMacroSignals } from "./macro-feed";
import { createSolUsdcIntent, type TradeIntent } from "./trade-intent";

type MacroRadarWidgetProps = {
  onTradeAction?: (intent: TradeIntent) => void;
};

export function MacroRadarWidget({ onTradeAction }: MacroRadarWidgetProps) {
  const feed = useMacroSignals();
  const data = feed.data;

  const verdictClass =
    data?.verdict === "BUY"
      ? "text-emerald-400"
      : data?.verdict === "CASH"
        ? "text-amber-300"
        : "text-muted";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          MACRO_RADAR
        </p>
        <span className="text-[10px] font-mono text-muted">
          {formatFeedAge(feed.lastUpdatedMs)}
        </span>
      </div>
      <div className="flex-1 p-3 space-y-3 overflow-auto text-xs">
        {feed.status === "loading" && !data ? (
          <p className="text-muted">Loading macro radar...</p>
        ) : null}
        {feed.error ? <p className="text-amber-300">{feed.error}</p> : null}

        {data ? (
          <>
            <div className="rounded border border-border p-2">
              <p className="text-[10px] text-muted">Composite Verdict</p>
              <p className={cn("font-mono text-lg", verdictClass)}>
                {data.verdict}
              </p>
              <p className="text-[10px] text-muted">
                {data.bullishCount}/{data.totalCount} bullish
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <SignalCell
                label="Regime"
                value={data.signals.macroRegime.status}
                detail={`QQQ ${formatPct(data.signals.macroRegime.qqqRoc20)} / XLP ${formatPct(data.signals.macroRegime.xlpRoc20)}`}
              />
              <SignalCell
                label="Liquidity"
                value={data.signals.liquidity.status}
                detail={formatPct(data.signals.liquidity.value)}
              />
              <SignalCell
                label="Fear & Greed"
                value={data.signals.fearGreed.status}
                detail={
                  data.signals.fearGreed.value === null
                    ? "--"
                    : `${data.signals.fearGreed.value}`
                }
              />
              <SignalCell
                label="Hash Rate"
                value={data.signals.hashRate.status}
                detail={formatPct(data.signals.hashRate.change30d)}
              />
            </div>

            {data.unavailable ? (
              <p className="text-[10px] text-amber-300">
                Degraded: {data.unavailableReason ?? "source unavailable"}
              </p>
            ) : null}

            <div className="flex gap-2">
              <button
                className={`${BTN_SECONDARY} !h-7 !px-2.5 !py-0 text-[10px]`}
                onClick={() =>
                  onTradeAction?.(
                    createSolUsdcIntent("buy", "MACRO_RADAR", {
                      reason: `Radar verdict ${data.verdict}`,
                    }),
                  )
                }
                type="button"
              >
                Buy SOL
              </button>
              <button
                className={`${BTN_SECONDARY} !h-7 !px-2.5 !py-0 text-[10px]`}
                onClick={() =>
                  onTradeAction?.(
                    createSolUsdcIntent("sell", "MACRO_RADAR", {
                      reason: `Radar hedge ${data.verdict}`,
                    }),
                  )
                }
                type="button"
              >
                Sell SOL
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SignalCell(props: { label: string; value: string; detail: string }) {
  const { label, value, detail } = props;
  return (
    <div className="rounded border border-border bg-subtle px-2 py-1.5">
      <p className="text-[10px] text-muted">{label}</p>
      <p className="font-mono text-sm">{value || "UNKNOWN"}</p>
      <p className="text-[10px] text-muted truncate">{detail}</p>
    </div>
  );
}
