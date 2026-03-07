"use client";

import { useEffect, useMemo, useState } from "react";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../lib";
import {
  buildAccountRiskSnapshot,
  resolveAccountRiskThresholds,
} from "../../terminal/components/account-risk";
import { ExecutionInspectorDrawer } from "../../terminal/components/execution-inspector-drawer";
import { MarketChart } from "../../terminal/components/market-chart";
import type {
  MarketPoint,
  MarketState,
} from "../../terminal/components/sol-market-feed";
import { createSolUsdcIntent } from "../../terminal/components/trade-intent";
import { TOKEN_CONFIGS } from "../../terminal/components/trade-pairs";
import {
  type TradeTicketCompletion,
  TradeTicketModal,
} from "../../terminal/components/trade-ticket-modal";

type RuntimeWindow = Window & {
  __TRADER_RALPH_EDGE_API_BASE__?: string;
};

const PROOF_WALLET = "7YB4proofHarnessWallet111111111111111111111111";

function buildProofMarketState(): MarketState {
  const now = Date.now();
  const points: MarketPoint[] = [];

  for (let index = 0; index < 72; index += 1) {
    const ts = now - (71 - index) * 60 * 60 * 1000;
    const drift = 164.2 + index * 0.62;
    const swing = Math.sin(index / 5) * 3.8;
    const close = Number((drift + swing).toFixed(4));
    points.push({
      ts,
      price: close,
      kind: "ohlcv",
      open: Number((close - 0.9).toFixed(4)),
      high: Number((close + 1.4).toFixed(4)),
      low: Number((close - 1.8).toFixed(4)),
      close,
      volume: 1_200_000 + index * 14_000,
    });
  }

  const latest = points.at(-1)?.price ?? 0;
  const anchor = points.at(-25)?.price ?? latest;

  return {
    status: "ready",
    error: null,
    points,
    latestPrice: latest,
    change24hPct: anchor > 0 ? ((latest - anchor) / anchor) * 100 : null,
    lastUpdatedMs: now,
    sourcePriority: ["proof-fixture", "playwright-route"],
    pairId: "SOL/USDC",
  };
}

export default function BrowserProofPage() {
  const [tradeOpen, setTradeOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [completion, setCompletion] = useState<TradeTicketCompletion | null>(
    null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const runtimeWindow = window as RuntimeWindow;
    if (!runtimeWindow.__TRADER_RALPH_EDGE_API_BASE__) {
      runtimeWindow.__TRADER_RALPH_EDGE_API_BASE__ = window.location.origin;
    }
  }, []);

  const market = useMemo(() => buildProofMarketState(), []);
  const intent = useMemo(
    () =>
      createSolUsdcIntent("buy", "BROWSER_PROOF", {
        reason: "Deterministic browser proof flow",
        amountUi: "50",
        slippageBps: 50,
      }),
    [],
  );
  const tokenBalancesByMint = useMemo(
    () => ({
      [TOKEN_CONFIGS.USDC.mint]: "250000000",
      [TOKEN_CONFIGS.SOL.mint]: "5000000000",
    }),
    [],
  );
  const riskSnapshot = useMemo(
    () =>
      buildAccountRiskSnapshot({
        baseQty: 3.8,
        quoteQty: 900,
        markPrice: market.latestPrice,
        thresholds: resolveAccountRiskThresholds(),
      }),
    [market.latestPrice],
  );

  return (
    <main
      className="min-h-screen bg-paper text-ink"
      data-testid="browser-proof-page"
    >
      <section className="mx-auto w-[min(1180px,92vw)] space-y-6 py-10">
        <header className="card p-6">
          <p className="label">BROWSER_PROOF</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-[700px]">
              <h1>Harness Browser Proof</h1>
              <p className="mt-3 text-muted">
                Deterministic proof surface for Playwright. It reuses the real
                market chart, trade ticket, and execution inspector components
                while browser routes stub the execution APIs.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a className={BTN_SECONDARY} href="/login">
                View login page
              </a>
              <button
                className={BTN_PRIMARY}
                data-testid="proof-open-trade"
                onClick={() => {
                  setCompletion(null);
                  setInspectorOpen(false);
                  setTradeOpen(true);
                }}
                type="button"
              >
                Open trade ticket
              </button>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
          <section className="card p-4" data-testid="proof-market-card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="label">MARKET_RENDER</p>
                <h2 className="mt-2">SOL / USDC browser proof chart</h2>
              </div>
              <div className="rounded border border-border bg-subtle px-3 py-2 text-right text-xs">
                <p className="text-muted">Source priority</p>
                <p className="font-mono">
                  {market.sourcePriority.join(" -> ")}
                </p>
              </div>
            </div>
            <MarketChart market={market} pairLabel="SOL / USDC" />
          </section>

          <section className="card space-y-4 p-6">
            <div>
              <p className="label">EXECUTION_PROOF</p>
              <h2 className="mt-2">Receipt drilldown</h2>
              <p className="mt-3 text-muted">
                Submit a mocked trade from the proof ticket, then inspect the
                terminal receipt snapshot and attempt timeline.
              </p>
            </div>

            <div className="rounded border border-border bg-subtle p-4 text-sm">
              <p className="text-muted">Proof wallet</p>
              <p className="mt-1 font-mono">
                {PROOF_WALLET.slice(0, 8)}...{PROOF_WALLET.slice(-8)}
              </p>
              <p className="mt-3 text-muted">Balances</p>
              <p className="mt-1 font-mono">
                250.000000 USDC · 5.000000000 SOL
              </p>
            </div>

            {completion ? (
              <div
                className="rounded border border-emerald-500/40 bg-emerald-500/10 p-4"
                data-testid="proof-trade-completion"
              >
                <p className="label">TRADE_COMPLETE</p>
                <p className="mt-2 font-mono text-sm">
                  {completion.requestId} • {completion.status}
                </p>
                <p className="mt-1 text-sm text-muted">
                  receipt {completion.receiptId ?? "--"} • provider{" "}
                  {completion.provider ?? "--"}
                </p>
                <p className="mt-1 break-all text-sm text-muted">
                  signature {completion.signature ?? "--"}
                </p>
                <div className="mt-4 flex gap-3">
                  <button
                    className={BTN_PRIMARY}
                    data-testid="proof-open-inspector"
                    onClick={() => setInspectorOpen(true)}
                    type="button"
                  >
                    Open execution inspector
                  </button>
                  <button
                    className={BTN_SECONDARY}
                    onClick={() => {
                      setCompletion(null);
                      setInspectorOpen(false);
                      setTradeOpen(true);
                    }}
                    type="button"
                  >
                    Run again
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded border border-dashed border-border p-4 text-sm text-muted">
                No execution captured yet. Open the trade ticket to run the
                deterministic proof flow.
              </div>
            )}
          </section>
        </div>
      </section>

      <TradeTicketModal
        open={tradeOpen}
        intent={intent}
        walletAddress={PROOF_WALLET}
        tokenBalancesByMint={tokenBalancesByMint}
        riskSnapshot={riskSnapshot}
        getAccessToken={async () => "proof-access-token"}
        onClose={() => setTradeOpen(false)}
        onTradeComplete={(trade) => {
          setCompletion(trade);
        }}
      />
      <ExecutionInspectorDrawer
        open={inspectorOpen}
        requestId={completion?.requestId ?? null}
        onClose={() => setInspectorOpen(false)}
      />
    </main>
  );
}
