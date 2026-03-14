"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createExecutionClient,
  describeExecutionClientError,
  type ExecutionPredictionMarket,
  type ExecutionPredictionPosition,
  newExecutionIdempotencyKey,
} from "../../execution-client";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../lib";
import type { TerminalVenueRolloutPolicy } from "../terminal-venues";
import { PredictionTicketModal } from "./prediction-ticket-modal";

type PredictionMarketsPanelProps = {
  tradingEnabled: boolean;
  getAccessToken: () => Promise<string | null>;
  terminalVenueRolloutPolicy: TerminalVenueRolloutPolicy;
};

function formatTimestamp(value: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

function formatPrice(value: number | null): string {
  return value === null ? "--" : value.toFixed(4);
}

export function PredictionMarketsPanel(props: PredictionMarketsPanelProps) {
  const { tradingEnabled, getAccessToken, terminalVenueRolloutPolicy } = props;
  const [markets, setMarkets] = useState<ExecutionPredictionMarket[]>([]);
  const [positions, setPositions] = useState<ExecutionPredictionPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [ticketMarket, setTicketMarket] =
    useState<ExecutionPredictionMarket | null>(null);
  const [ticketSide, setTicketSide] = useState<
    "buy_yes" | "buy_no" | "sell_yes" | "sell_no"
  >("buy_yes");

  const predictionEnabled =
    terminalVenueRolloutPolicy.enabledFamilies.includes("prediction_order") &&
    terminalVenueRolloutPolicy.enabledVenues.includes("dflow");

  useEffect(() => {
    if (!predictionEnabled) {
      setMarkets([]);
      setPositions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setMessage(null);
        const token = await getAccessToken();
        if (!token) throw new Error("missing-access-token");
        const client = createExecutionClient({ authToken: token });
        const [nextMarkets, nextPositions] = await Promise.all([
          client.listPredictionMarkets({ venueKey: "dflow", limit: 8 }),
          client.listPredictionPositions(),
        ]);
        if (cancelled) return;
        setMarkets(nextMarkets);
        setPositions(nextPositions);
      } catch (error) {
        if (cancelled) return;
        setMessage(
          describeExecutionClientError(error, "prediction-panel-load-failed"),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken, predictionEnabled]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <p className="label dashboard-drag-handle cursor-move">
          PREDICTION MARKETS
        </p>
        <button
          className={`${BTN_SECONDARY} h-6 px-2 text-[10px]`}
          disabled={!predictionEnabled}
          onClick={() => {
            if (!predictionEnabled) return;
            void (async () => {
              try {
                setLoading(true);
                const token = await getAccessToken();
                if (!token) throw new Error("missing-access-token");
                const client = createExecutionClient({ authToken: token });
                const [nextMarkets, nextPositions] = await Promise.all([
                  client.listPredictionMarkets({ venueKey: "dflow", limit: 8 }),
                  client.listPredictionPositions(),
                ]);
                setMarkets(nextMarkets);
                setPositions(nextPositions);
                setMessage(null);
              } catch (error) {
                setMessage(
                  describeExecutionClientError(
                    error,
                    "prediction-panel-refresh-failed",
                  ),
                );
              } finally {
                setLoading(false);
              }
            })();
          }}
          type="button"
        >
          Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-3">
        {!predictionEnabled ? (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            Prediction workflows are rollout-gated for the current cohort.
          </div>
        ) : null}
        {message ? (
          <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            {message}
          </div>
        ) : null}
        <div className="rounded border border-border bg-paper px-3 py-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-ink">
              Active DFlow markets
            </p>
            <span className="text-[10px] text-muted uppercase tracking-wider">
              paper only
            </span>
          </div>
          <div className="mt-2 space-y-2">
            {loading ? (
              <p className="text-[11px] text-muted">
                Loading prediction markets...
              </p>
            ) : markets.length === 0 ? (
              <p className="text-[11px] text-muted">
                No active prediction markets returned.
              </p>
            ) : (
              markets.map((market) => (
                <div
                  key={market.marketId}
                  className="rounded border border-border/70 bg-surface px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-ink">
                        {market.title}
                      </p>
                      <p className="text-[11px] text-muted">
                        {market.eventTitle ?? "Tokenized event"} • status{" "}
                        {market.status ?? "--"}
                        {market.result ? ` • result ${market.result}` : ""}
                      </p>
                    </div>
                    <div className="text-right text-[10px] text-muted">
                      <p>settle {formatTimestamp(market.settleTime)}</p>
                      <p>redemption {market.redemptionStatus ?? "--"}</p>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted">
                    <div className="rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-1">
                      <p>YES bid / ask</p>
                      <p className="mt-1 font-mono text-ink">
                        {formatPrice(market.yesBid)} /{" "}
                        {formatPrice(market.yesAsk)}
                      </p>
                    </div>
                    <div className="rounded border border-rose-500/25 bg-rose-500/10 px-2 py-1">
                      <p>NO bid / ask</p>
                      <p className="mt-1 font-mono text-ink">
                        {formatPrice(market.noBid)} /{" "}
                        {formatPrice(market.noAsk)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      className={`${BTN_PRIMARY} h-6 px-2 text-[10px]`}
                      disabled={!tradingEnabled || !predictionEnabled}
                      onClick={() => {
                        setTicketMarket(market);
                        setTicketSide("buy_yes");
                      }}
                      type="button"
                    >
                      Buy YES
                    </button>
                    <button
                      className={`${BTN_SECONDARY} h-6 px-2 text-[10px]`}
                      disabled={!tradingEnabled || !predictionEnabled}
                      onClick={() => {
                        setTicketMarket(market);
                        setTicketSide("buy_no");
                      }}
                      type="button"
                    >
                      Buy NO
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded border border-border bg-paper px-3 py-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-ink">
              Positions & settlement
            </p>
            <span className="text-[10px] text-muted uppercase tracking-wider">
              lifecycle explicit
            </span>
          </div>
          <div className="mt-2 space-y-2">
            {positions.length === 0 ? (
              <p className="text-[11px] text-muted">
                No prediction positions have been recorded yet.
              </p>
            ) : (
              positions.map((position) => (
                <div
                  key={position.key}
                  className="rounded border border-border/70 bg-surface px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-ink">
                        {position.instrumentLabel} •{" "}
                        {position.outcomeSide?.toUpperCase() ?? "--"}
                      </p>
                      <p className="text-[11px] text-muted">
                        {position.positionState} • settlement{" "}
                        {position.settlementState}
                        {position.result ? ` • result ${position.result}` : ""}
                      </p>
                    </div>
                    <div className="text-right text-[10px] text-muted">
                      <p>updated {formatTimestamp(position.lastUpdatedAt)}</p>
                      <p>settle {formatTimestamp(position.settleTime)}</p>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted">
                    <div className="rounded border border-border/60 bg-paper/70 px-2 py-1">
                      <p>Net shares</p>
                      <p className="mt-1 font-mono text-ink">
                        {position.netQuantityUi}
                      </p>
                    </div>
                    <div className="rounded border border-border/60 bg-paper/70 px-2 py-1">
                      <p>Expected payout</p>
                      <p className="mt-1 font-mono text-ink">
                        {position.expectedPayoutUi ?? "--"}
                      </p>
                    </div>
                    <div className="rounded border border-border/60 bg-paper/70 px-2 py-1">
                      <p>Avg entry</p>
                      <p className="mt-1 font-mono text-ink">
                        {position.averageEntryPrice === null
                          ? "--"
                          : position.averageEntryPrice.toFixed(4)}
                      </p>
                    </div>
                    <div className="rounded border border-border/60 bg-paper/70 px-2 py-1">
                      <p>Mark / status</p>
                      <p className="mt-1 font-mono text-ink">
                        {position.lastPriceQuote === null
                          ? "--"
                          : position.lastPriceQuote.toFixed(4)}{" "}
                        • {position.marketStatus ?? "--"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-muted">
                      {position.notes.join(" • ") || "No extra lifecycle notes"}
                    </p>
                    <button
                      className={`${BTN_PRIMARY} h-6 px-2 text-[10px]`}
                      disabled={!position.canSettle}
                      onClick={() => {
                        void (async () => {
                          try {
                            const token = await getAccessToken();
                            if (!token) throw new Error("missing-access-token");
                            const client = createExecutionClient({
                              authToken: token,
                            });
                            await client.settlePredictionPosition(
                              position.key,
                              {
                                idempotencyKey:
                                  newExecutionIdempotencyKey("pred-settle"),
                              },
                            );
                            toast.success("Prediction position settled", {
                              description: `${position.instrumentLabel} • ${position.outcomeSide?.toUpperCase() ?? "--"}`,
                              position: "bottom-right",
                            });
                            const [nextMarkets, nextPositions] =
                              await Promise.all([
                                client.listPredictionMarkets({
                                  venueKey: "dflow",
                                  limit: 8,
                                }),
                                client.listPredictionPositions(),
                              ]);
                            setMarkets(nextMarkets);
                            setPositions(nextPositions);
                          } catch (error) {
                            toast.error("Settlement failed", {
                              description: describeExecutionClientError(
                                error,
                                "prediction-settlement-failed",
                              ),
                              position: "bottom-right",
                            });
                          }
                        })();
                      }}
                      type="button"
                    >
                      {position.canSettle ? "Redeem" : "Await resolution"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <PredictionTicketModal
        open={ticketMarket !== null}
        market={ticketMarket}
        defaultSide={ticketSide}
        getAccessToken={getAccessToken}
        terminalVenueRolloutPolicy={terminalVenueRolloutPolicy}
        onClose={() => setTicketMarket(null)}
        onSubmitted={() => {
          void (async () => {
            try {
              const token = await getAccessToken();
              if (!token) throw new Error("missing-access-token");
              const client = createExecutionClient({ authToken: token });
              const [nextMarkets, nextPositions] = await Promise.all([
                client.listPredictionMarkets({ venueKey: "dflow", limit: 8 }),
                client.listPredictionPositions(),
              ]);
              setMarkets(nextMarkets);
              setPositions(nextPositions);
            } catch (error) {
              setMessage(
                describeExecutionClientError(
                  error,
                  "prediction-panel-refresh-failed",
                ),
              );
            }
          })();
        }}
      />
    </div>
  );
}
