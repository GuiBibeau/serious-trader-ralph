"use client";

import { BTN_PRIMARY, BTN_SECONDARY } from "../../lib";
import { createTradeIntent, type TradeIntent } from "./trade-intent";
import type { PairId } from "./trade-pairs";

type DegenEventHooksWidgetProps = {
  selectedPairId: PairId;
  tradingEnabled: boolean;
  onTradeAction?: (intent: TradeIntent) => void;
};

type EventHook = {
  id: string;
  title: string;
  window: string;
  risk: "moderate" | "high" | "extreme";
  pairId: PairId;
  buyReason: string;
  sellReason: string;
};

const EVENT_HOOKS: readonly EventHook[] = [
  {
    id: "us-cpi",
    title: "US CPI Print",
    window: "Next high-impact macro window",
    risk: "high",
    pairId: "SOL/USDC",
    buyReason: "Macro upside momentum hook",
    sellReason: "Macro downside hedge hook",
  },
  {
    id: "solana-upgrade",
    title: "Solana Ecosystem Upgrade",
    window: "Pending release-cycle catalyst",
    risk: "extreme",
    pairId: "JUP/USDC",
    buyReason: "Event-driven upside breakout hook",
    sellReason: "Event-failure unwind hook",
  },
  {
    id: "meme-rotation",
    title: "Meme Rotation Pulse",
    window: "Realtime social momentum spikes",
    risk: "extreme",
    pairId: "WIF/USDC",
    buyReason: "Momentum continuation hook",
    sellReason: "Momentum exhaustion hedge hook",
  },
];

function riskClass(level: EventHook["risk"]): string {
  if (level === "moderate") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
  if (level === "high") {
    return "border-orange-500/40 bg-orange-500/10 text-orange-200";
  }
  return "border-red-500/40 bg-red-500/10 text-red-200";
}

export function DegenEventHooksWidget(props: DegenEventHooksWidgetProps) {
  const { selectedPairId, tradingEnabled, onTradeAction } = props;

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <p className="label dashboard-drag-handle cursor-move">EVENT HOOKS</p>
        <span className="text-[10px] text-muted uppercase tracking-wider">
          Prediction scaffolds
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
          Hook templates only. Always validate thesis and liquidity before
          dispatch.
        </p>
        <div className="mt-2 space-y-1.5">
          {EVENT_HOOKS.map((item) => {
            const pairId = item.pairId ?? selectedPairId;
            return (
              <div
                key={item.id}
                className="rounded border border-border bg-paper p-2"
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-ink">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-muted">{item.window}</p>
                  </div>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${riskClass(item.risk)}`}
                  >
                    {item.risk}
                  </span>
                </div>
                <p className="text-[11px] text-muted">
                  Trade pair hook: {pairId}
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    className={`${BTN_PRIMARY} h-6 px-2 text-[10px]`}
                    onClick={() => {
                      if (!onTradeAction || !tradingEnabled) return;
                      onTradeAction(
                        createTradeIntent("buy", "DEGEN_EVENT_HOOK", pairId, {
                          reason: `${item.title}: ${item.buyReason}`,
                        }),
                      );
                    }}
                    type="button"
                    disabled={!tradingEnabled || !onTradeAction}
                  >
                    Scenario Buy
                  </button>
                  <button
                    className={`${BTN_SECONDARY} h-6 px-2 text-[10px]`}
                    onClick={() => {
                      if (!onTradeAction || !tradingEnabled) return;
                      onTradeAction(
                        createTradeIntent("sell", "DEGEN_EVENT_HOOK", pairId, {
                          reason: `${item.title}: ${item.sellReason}`,
                        }),
                      );
                    }}
                    type="button"
                    disabled={!tradingEnabled || !onTradeAction}
                  >
                    Scenario Sell
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
