"use client";

import { BTN_PRIMARY, BTN_SECONDARY } from "../../lib";
import type { MarketState } from "./sol-market-feed";
import { createTradeIntent, type TradeIntent } from "./trade-intent";
import type { PairId } from "./trade-pairs";

const WATCHLIST: readonly PairId[] = [
  "BONK/USDC",
  "WIF/USDC",
  "JUP/USDC",
  "RAY/USDC",
  "SOL/USDC",
];

const RISK_SCORE: Record<PairId, "elevated" | "high" | "extreme"> = {
  "BONK/USDC": "extreme",
  "WIF/USDC": "extreme",
  "JUP/USDC": "high",
  "RAY/USDC": "high",
  "SOL/USDC": "elevated",
  "SOL/USDT": "elevated",
  "USDC/USDT": "elevated",
  "USDC/PYUSD": "elevated",
  "USDC/USD1": "elevated",
  "USDC/USDG": "elevated",
  "SOL/JITOSOL": "elevated",
  "SOL/MSOL": "elevated",
  "SOL/JUPSOL": "elevated",
  "JTO/USDC": "high",
  "PYTH/USDC": "high",
};

type DegenWatchlistWidgetProps = {
  selectedPairId: PairId;
  market: MarketState;
  tradingEnabled: boolean;
  onPairFocus: (pairId: PairId) => void;
  onTradeAction?: (intent: TradeIntent) => void;
};

function riskClass(level: "elevated" | "high" | "extreme"): string {
  if (level === "elevated")
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (level === "high")
    return "border-orange-500/40 bg-orange-500/10 text-orange-200";
  return "border-red-500/40 bg-red-500/10 text-red-200";
}

function formatPriceUi(value: number): string {
  if (!Number.isFinite(value)) return "--";
  if (value >= 1000)
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

export function DegenWatchlistWidget(props: DegenWatchlistWidgetProps) {
  const { selectedPairId, market, tradingEnabled, onPairFocus, onTradeAction } =
    props;

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <p className="label dashboard-drag-handle cursor-move">
          DEGEN WATCHLIST
        </p>
        <span className="text-[10px] text-muted uppercase tracking-wider">
          Rapid rotation
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-1.5">
          {WATCHLIST.map((pairId) => {
            const isFocused = pairId === selectedPairId;
            const risk = RISK_SCORE[pairId] ?? "high";
            const price = isFocused ? market.latestPrice : null;
            const change24h = isFocused ? market.change24hPct : null;
            return (
              <div
                key={pairId}
                className="rounded border border-border bg-paper p-2"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <button
                    className="text-left text-xs font-semibold text-ink underline-offset-2 hover:underline"
                    onClick={() => onPairFocus(pairId)}
                    type="button"
                  >
                    {pairId}
                  </button>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${riskClass(risk)}`}
                  >
                    {risk}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-[11px] text-muted">
                  <span>
                    Price:{" "}
                    {price !== null ? formatPriceUi(price) : "Focus pair"}
                  </span>
                  <span
                    className={
                      change24h === null
                        ? "text-muted"
                        : change24h >= 0
                          ? "text-emerald-300"
                          : "text-red-300"
                    }
                  >
                    {change24h === null
                      ? "24h --"
                      : `24h ${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    className={`${BTN_PRIMARY} h-6 px-2 text-[10px]`}
                    onClick={() => {
                      if (!onTradeAction || !tradingEnabled) return;
                      onTradeAction(
                        createTradeIntent("buy", "DEGEN_WATCHLIST", pairId, {
                          reason: `Volatility breakout watch (${risk})`,
                        }),
                      );
                    }}
                    type="button"
                    disabled={!tradingEnabled || !onTradeAction}
                  >
                    Fast Buy
                  </button>
                  <button
                    className={`${BTN_SECONDARY} h-6 px-2 text-[10px]`}
                    onClick={() => {
                      if (!onTradeAction || !tradingEnabled) return;
                      onTradeAction(
                        createTradeIntent("sell", "DEGEN_WATCHLIST", pairId, {
                          reason: `Volatility hedge watch (${risk})`,
                        }),
                      );
                    }}
                    type="button"
                    disabled={!tradingEnabled || !onTradeAction}
                  >
                    Fast Sell
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
