"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createExecutionClient,
  describeExecutionClientError,
  type ExecutionPerpPosition,
  type ExecutionPerpPreview,
  type ExecutionPerpResult,
  newExecutionIdempotencyKey,
} from "../../execution-client";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../lib";
import type { PerpTradeIntent } from "./perp-intent";

type PerpTicketModalProps = {
  open: boolean;
  intent: PerpTradeIntent | null;
  walletAddress: string | null;
  currentPosition?: ExecutionPerpPosition | null;
  getAccessToken: () => Promise<string | null>;
  onClose: () => void;
  onOrderComplete?: (result: ExecutionPerpResult) => void;
};

type OrderType = "market" | "limit" | "trigger";
type TimeInForce = "gtc" | "ioc" | "fok";

const PRICE_DECIMALS = 6;
const COLLATERAL_DECIMALS = 6;
const QUANTITY_DECIMALS = 0;

function parseUiAmountToAtomic(value: string, decimals: number): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return null;

  const [wholePartRaw = "0", fracPartRaw = ""] = trimmed.split(".", 2);
  const wholePart = wholePartRaw === "" ? "0" : wholePartRaw;
  if (!/^\d+$/.test(wholePart) || !/^\d*$/.test(fracPartRaw)) return null;
  if (fracPartRaw.length > decimals) return null;

  const scale = BigInt(10) ** BigInt(decimals);
  const wholeAtomic = BigInt(wholePart) * scale;
  const fracPadded = (fracPartRaw + "0".repeat(decimals)).slice(0, decimals);
  const fracAtomic = fracPadded ? BigInt(fracPadded) : BigInt(0);
  const total = wholeAtomic + fracAtomic;
  return total > BigInt(0) ? total.toString() : null;
}

function formatNullableNumber(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return value.toFixed(digits);
}

function signedSideLabel(side: PerpTradeIntent["side"]): string {
  switch (side) {
    case "long":
      return "Open long";
    case "short":
      return "Open short";
    case "close_long":
      return "Close long";
    case "close_short":
      return "Close short";
    default:
      return "Perp order";
  }
}

function isOpeningSide(side: PerpTradeIntent["side"]): boolean {
  return side === "long" || side === "short";
}

export function PerpTicketModal({
  open,
  intent,
  walletAddress,
  currentPosition,
  getAccessToken,
  onClose,
  onOrderComplete,
}: PerpTicketModalProps) {
  const [quantityUi, setQuantityUi] = useState("");
  const [collateralUi, setCollateralUi] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [timeInForce, setTimeInForce] = useState<TimeInForce>("gtc");
  const [limitPriceUi, setLimitPriceUi] = useState("");
  const [triggerPriceUi, setTriggerPriceUi] = useState("");
  const [preview, setPreview] = useState<ExecutionPerpPreview | null>(null);
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<
    "idle" | "submitting" | "error"
  >("idle");
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !intent) return;
    setQuantityUi(intent.quantityUi);
    setCollateralUi(intent.collateralUi);
    setOrderType("market");
    setTimeInForce("gtc");
    setLimitPriceUi("");
    setTriggerPriceUi("");
    setPreview(null);
    setPreviewState("idle");
    setPreviewMessage(null);
    setSubmitState("idle");
    setSubmitMessage(null);
  }, [intent, open]);

  const quantityAtomic = useMemo(
    () => parseUiAmountToAtomic(quantityUi, QUANTITY_DECIMALS),
    [quantityUi],
  );
  const collateralAtomic = useMemo(
    () =>
      isOpeningSide(intent?.side ?? "long")
        ? parseUiAmountToAtomic(collateralUi, COLLATERAL_DECIMALS)
        : null,
    [collateralUi, intent?.side],
  );
  const limitPriceAtomic = useMemo(
    () => parseUiAmountToAtomic(limitPriceUi, PRICE_DECIMALS),
    [limitPriceUi],
  );
  const triggerPriceAtomic = useMemo(
    () => parseUiAmountToAtomic(triggerPriceUi, PRICE_DECIMALS),
    [triggerPriceUi],
  );
  const currentPositionHint = useMemo(
    () =>
      currentPosition
        ? {
            instrumentId: currentPosition.instrumentId,
            signedQuantityAtomic: currentPosition.signedQuantityAtomic,
            collateralAtomic: currentPosition.collateralAtomic,
            averageEntryPrice: currentPosition.averageEntryPrice,
          }
        : null,
    [currentPosition],
  );

  const refreshPreview = useCallback(async (): Promise<void> => {
    if (!intent || !quantityAtomic) {
      setPreview(null);
      setPreviewState("idle");
      setPreviewMessage(null);
      return;
    }
    if (isOpeningSide(intent.side) && !collateralAtomic) {
      setPreview(null);
      setPreviewState("error");
      setPreviewMessage("Collateral is required for opening exposure.");
      return;
    }
    if (orderType === "limit" && !limitPriceAtomic) {
      setPreview(null);
      setPreviewState("error");
      setPreviewMessage("Limit orders require a limit price.");
      return;
    }
    if (orderType === "trigger" && !triggerPriceAtomic) {
      setPreview(null);
      setPreviewState("error");
      setPreviewMessage("Trigger orders require a trigger price.");
      return;
    }

    setPreviewState("loading");
    setPreviewMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const client = createExecutionClient({ authToken: token });
      const nextPreview = await client.previewPerpOrder({
        venueKey: intent.venueKey,
        instrumentId: intent.instrumentId,
        instrumentLabel: intent.instrumentLabel,
        side: intent.side,
        quantityAtomic,
        ...(collateralAtomic ? { collateralAtomic } : {}),
        orderType,
        timeInForce,
        ...(limitPriceAtomic ? { limitPriceAtomic } : {}),
        ...(triggerPriceAtomic ? { triggerPriceAtomic } : {}),
        ...(currentPositionHint
          ? {
              currentPosition: currentPositionHint,
            }
          : {}),
      });
      setPreview(nextPreview);
      setPreviewState("ready");
    } catch (error) {
      setPreview(null);
      setPreviewState("error");
      setPreviewMessage(
        describeExecutionClientError(error, "perp-preview-failed"),
      );
    }
  }, [
    collateralAtomic,
    getAccessToken,
    intent,
    limitPriceAtomic,
    orderType,
    quantityAtomic,
    timeInForce,
    triggerPriceAtomic,
    currentPositionHint,
  ]);

  useEffect(() => {
    if (!open || !intent) return;
    const timer = window.setTimeout(() => {
      void refreshPreview();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [intent, open, refreshPreview]);

  const submitOrder = useCallback(async (): Promise<void> => {
    if (!intent) return;
    if (!walletAddress) {
      setSubmitState("error");
      setSubmitMessage("Wallet unavailable.");
      return;
    }
    if (!quantityAtomic) {
      setSubmitState("error");
      setSubmitMessage("Quantity must be greater than zero.");
      return;
    }
    if (isOpeningSide(intent.side) && !collateralAtomic) {
      setSubmitState("error");
      setSubmitMessage("Collateral is required for opening exposure.");
      return;
    }
    setSubmitState("submitting");
    setSubmitMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const client = createExecutionClient({ authToken: token });
      const idempotencyKey = newExecutionIdempotencyKey("perp");
      const result = await client.submitPerpOrder(
        {
          venueKey: intent.venueKey,
          instrumentId: intent.instrumentId,
          instrumentLabel: intent.instrumentLabel,
          side: intent.side,
          quantityAtomic,
          ...(collateralAtomic ? { collateralAtomic } : {}),
          orderType,
          timeInForce,
          reduceOnly:
            intent.side === "close_long" || intent.side === "close_short",
          ...(limitPriceAtomic ? { limitPriceAtomic } : {}),
          ...(triggerPriceAtomic ? { triggerPriceAtomic } : {}),
          source: intent.source,
          reason: intent.reason,
        },
        { idempotencyKey },
      );
      toast.success("Perp paper order submitted", {
        description: `${intent.instrumentLabel} • ${signedSideLabel(intent.side)}`,
        position: "bottom-right",
        duration: 4000,
      });
      onOrderComplete?.(result);
      onClose();
    } catch (error) {
      setSubmitState("error");
      setSubmitMessage(
        describeExecutionClientError(error, "perp-submit-failed"),
      );
    }
  }, [
    collateralAtomic,
    getAccessToken,
    intent,
    limitPriceAtomic,
    onClose,
    onOrderComplete,
    orderType,
    quantityAtomic,
    timeInForce,
    triggerPriceAtomic,
    walletAddress,
  ]);

  if (!open || !intent) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
      data-testid="perp-ticket-modal"
    >
      <div className="w-full max-w-3xl rounded-lg border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="label">PERP_ORDER</p>
            <p className="mt-1 font-mono text-sm text-ink">
              {intent.instrumentLabel} • {signedSideLabel(intent.side)}
            </p>
            <p className="text-[11px] text-muted">
              Drift paper mode only. Venue constraints are surfaced directly.
            </p>
          </div>
          <button className={BTN_SECONDARY} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3">
            <div className="rounded border border-border bg-subtle p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted">
                Order setup
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    Quantity (contracts)
                  </span>
                  <input
                    className="h-10 w-full rounded border border-border bg-paper px-3 font-mono text-sm text-ink"
                    value={quantityUi}
                    onChange={(event) => setQuantityUi(event.target.value)}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    Collateral (USDC)
                  </span>
                  <input
                    className="h-10 w-full rounded border border-border bg-paper px-3 font-mono text-sm text-ink disabled:opacity-60"
                    value={collateralUi}
                    onChange={(event) => setCollateralUi(event.target.value)}
                    disabled={!isOpeningSide(intent.side)}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    Order type
                  </span>
                  <select
                    className="h-10 w-full rounded border border-border bg-paper px-3 text-sm text-ink"
                    data-testid="perp-ticket-order-type"
                    value={orderType}
                    onChange={(event) =>
                      setOrderType(event.target.value as OrderType)
                    }
                  >
                    <option value="market">Market</option>
                    <option value="limit">Limit</option>
                    <option value="trigger">Trigger</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    Time in force
                  </span>
                  <select
                    className="h-10 w-full rounded border border-border bg-paper px-3 text-sm text-ink"
                    value={timeInForce}
                    onChange={(event) =>
                      setTimeInForce(event.target.value as TimeInForce)
                    }
                  >
                    <option value="gtc">GTC</option>
                    <option value="ioc">IOC</option>
                    <option value="fok">FOK</option>
                  </select>
                </label>
                {orderType === "limit" ? (
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted">
                      Limit price
                    </span>
                    <input
                      className="h-10 w-full rounded border border-border bg-paper px-3 font-mono text-sm text-ink"
                      value={limitPriceUi}
                      onChange={(event) => setLimitPriceUi(event.target.value)}
                    />
                  </label>
                ) : null}
                {orderType === "trigger" ? (
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted">
                      Trigger price
                    </span>
                    <input
                      className="h-10 w-full rounded border border-border bg-paper px-3 font-mono text-sm text-ink"
                      value={triggerPriceUi}
                      onChange={(event) =>
                        setTriggerPriceUi(event.target.value)
                      }
                    />
                  </label>
                ) : null}
              </div>
            </div>

            <div className="rounded border border-border bg-subtle p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  Current position
                </p>
                <button
                  className={BTN_SECONDARY}
                  onClick={() => void refreshPreview()}
                  type="button"
                >
                  Refresh preview
                </button>
              </div>
              {currentPosition ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <p className="font-mono text-[11px] text-ink">
                    Side: {currentPosition.side.toUpperCase()}
                  </p>
                  <p className="font-mono text-[11px] text-ink">
                    Size: {currentPosition.signedQuantityUi}
                  </p>
                  <p className="font-mono text-[11px] text-ink">
                    Entry:{" "}
                    {formatNullableNumber(currentPosition.averageEntryPrice, 4)}
                  </p>
                  <p className="font-mono text-[11px] text-ink">
                    Liq buffer:{" "}
                    {formatNullableNumber(currentPosition.liquidationBufferPct)}
                    %
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-[11px] text-muted">
                  No existing paper position for this contract.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded border border-border bg-subtle p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted">
                Preview
              </p>
              {previewState === "loading" ? (
                <p className="mt-3 text-[11px] text-muted">
                  Refreshing preview…
                </p>
              ) : null}
              {previewState === "error" ? (
                <p className="mt-3 text-[11px] text-red-300">
                  {previewMessage ?? "Perp preview failed."}
                </p>
              ) : null}
              {preview ? (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <p className="font-mono text-[11px] text-ink">
                      Mark: {formatNullableNumber(preview.markPrice, 4)}
                    </p>
                    <p className="font-mono text-[11px] text-ink">
                      Oracle: {formatNullableNumber(preview.oraclePrice, 4)}
                    </p>
                    <p className="font-mono text-[11px] text-ink">
                      Funding:{" "}
                      {formatNullableNumber(preview.fundingRate1hBps, 2)} bps
                    </p>
                    <p className="font-mono text-[11px] text-ink">
                      <span data-testid="perp-ticket-preview-route">
                        Route: {preview.routeSummary ?? preview.provider}
                      </span>
                    </p>
                  </div>
                  <div className="rounded border border-border/60 bg-paper/60 p-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted">
                      Projected risk
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <p className="font-mono text-[11px] text-ink">
                        Size: {preview.projectedSignedQuantityUi ?? "--"}
                      </p>
                      <p className="font-mono text-[11px] text-ink">
                        Collateral: {preview.projectedCollateralUi ?? "--"}
                      </p>
                      <p className="font-mono text-[11px] text-ink">
                        Notional:{" "}
                        {formatNullableNumber(preview.projectedNotionalQuote)}{" "}
                        USDC
                      </p>
                      <p className="font-mono text-[11px] text-ink">
                        Leverage:{" "}
                        {formatNullableNumber(preview.projectedLeverage, 2)}x
                      </p>
                      <p className="font-mono text-[11px] text-ink">
                        Init margin:{" "}
                        {formatNullableNumber(
                          preview.requiredInitialMarginQuote,
                        )}{" "}
                        USDC
                      </p>
                      <p className="font-mono text-[11px] text-ink">
                        Maint margin:{" "}
                        {formatNullableNumber(preview.requiredMaintenanceQuote)}{" "}
                        USDC
                      </p>
                      <p className="font-mono text-[11px] text-ink">
                        Liq buffer:{" "}
                        {formatNullableNumber(
                          preview.projectedLiquidationBufferPct,
                        )}
                        %
                      </p>
                      <p className="font-mono text-[11px] text-ink">
                        <span data-testid="perp-ticket-preview-risk">
                          Risk:{" "}
                          {(
                            preview.projectedRiskLevel ?? "unknown"
                          ).toUpperCase()}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {preview.notes.map((note) => (
                      <span
                        key={note}
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted"
                      >
                        {note}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {submitMessage ? (
              <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-300">
                {submitMessage}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <p className="text-[11px] text-muted">
            Paper execution only. This does not promote Drift to live.
          </p>
          <div className="flex items-center gap-2">
            <button className={BTN_SECONDARY} onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className={BTN_PRIMARY}
              data-testid="perp-ticket-submit"
              onClick={() => void submitOrder()}
              type="button"
              disabled={submitState === "submitting"}
            >
              {submitState === "submitting"
                ? "Submitting…"
                : "Submit paper perp"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
