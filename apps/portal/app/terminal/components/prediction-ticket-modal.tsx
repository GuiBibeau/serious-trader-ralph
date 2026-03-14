"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createExecutionClient,
  describeExecutionClientError,
  type ExecutionPredictionMarket,
  type ExecutionPredictionResult,
  newExecutionIdempotencyKey,
} from "../../execution-client";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../lib";
import {
  getTerminalVenueExecutionReadinessLabel,
  type TerminalVenueRolloutPolicy,
} from "../terminal-venues";

type PredictionTicketModalProps = {
  open: boolean;
  market: ExecutionPredictionMarket | null;
  defaultSide: "buy_yes" | "buy_no" | "sell_yes" | "sell_no";
  getAccessToken: () => Promise<string | null>;
  terminalVenueRolloutPolicy: TerminalVenueRolloutPolicy;
  onClose: () => void;
  onSubmitted: (result: ExecutionPredictionResult) => void;
};

const OUTCOME_DECIMALS = 6;

function parseUiAmountToAtomic(value: string, decimals: number): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return null;
  const [wholeRaw = "0", fractionRaw = ""] = trimmed.split(".", 2);
  if (fractionRaw.length > decimals) return null;
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const paddedFraction = `${fractionRaw}${"0".repeat(decimals)}`.slice(
    0,
    decimals,
  );
  try {
    const zero = BigInt(0);
    const scale = BigInt(10) ** BigInt(decimals);
    const total =
      BigInt(whole) * scale + (paddedFraction ? BigInt(paddedFraction) : zero);
    return total > zero ? total.toString() : null;
  } catch {
    return null;
  }
}

function readableSideLabel(
  side: PredictionTicketModalProps["defaultSide"],
): string {
  switch (side) {
    case "buy_yes":
      return "Buy YES";
    case "buy_no":
      return "Buy NO";
    case "sell_yes":
      return "Sell YES";
    case "sell_no":
      return "Sell NO";
  }
}

export function PredictionTicketModal(props: PredictionTicketModalProps) {
  const {
    open,
    market,
    defaultSide,
    getAccessToken,
    terminalVenueRolloutPolicy,
    onClose,
    onSubmitted,
  } = props;
  const [side, setSide] = useState(defaultSide);
  const [amountUi, setAmountUi] = useState("10");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [timeInForce, setTimeInForce] = useState<"gtc" | "ioc" | "fok">("gtc");
  const [limitPriceUi, setLimitPriceUi] = useState("");
  const [previewStatus, setPreviewStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [previewPrice, setPreviewPrice] = useState<number | null>(null);
  const [previewNotional, setPreviewNotional] = useState<number | null>(null);
  const [previewSettlementMint, setPreviewSettlementMint] = useState<
    string | null
  >(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setSide(defaultSide);
    setAmountUi("10");
    setOrderType("market");
    setTimeInForce("gtc");
    setLimitPriceUi("");
    setPreviewStatus("idle");
    setPreviewMessage(null);
    setPreviewPrice(null);
    setPreviewNotional(null);
    setPreviewSettlementMint(null);
  }, [defaultSide, open]);

  const venueEnabled =
    terminalVenueRolloutPolicy.enabledVenues.includes("dflow");
  const familyEnabled =
    terminalVenueRolloutPolicy.enabledFamilies.includes("prediction_order");
  const canAccess = venueEnabled && familyEnabled;
  const amountAtomic = useMemo(
    () => parseUiAmountToAtomic(amountUi, OUTCOME_DECIMALS),
    [amountUi],
  );
  const limitPriceAtomic = useMemo(
    () => parseUiAmountToAtomic(limitPriceUi, 6),
    [limitPriceUi],
  );

  useEffect(() => {
    if (!open || !market || !canAccess || !amountAtomic) {
      setPreviewStatus("idle");
      setPreviewMessage(null);
      setPreviewPrice(null);
      setPreviewNotional(null);
      setPreviewSettlementMint(null);
      return;
    }
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewStatus("loading");
    setPreviewMessage(null);
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("missing-access-token");
        const client = createExecutionClient({ authToken: token });
        const preview = await client.previewPredictionOrder(
          {
            venueKey: "dflow",
            instrumentId: market.marketId,
            instrumentLabel: market.title,
            outcomeId: side.endsWith("_yes")
              ? (market.yesMint ?? "")
              : (market.noMint ?? ""),
            side,
            quantityAtomic: amountAtomic,
            orderType,
            timeInForce,
            quantityMode: "base",
            ...(orderType === "limit" && limitPriceAtomic
              ? { limitPriceAtomic }
              : {}),
          },
          { signal: controller.signal },
        );
        setPreviewStatus("ready");
        setPreviewMessage(preview.routeSummary);
        setPreviewPrice(preview.priceQuote);
        setPreviewNotional(preview.estimatedNotionalUsd);
        setPreviewSettlementMint(preview.settlementMint);
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreviewStatus("error");
        setPreviewMessage(
          describeExecutionClientError(error, "prediction-preview-failed"),
        );
        setPreviewPrice(null);
        setPreviewNotional(null);
        setPreviewSettlementMint(null);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    amountAtomic,
    canAccess,
    getAccessToken,
    limitPriceAtomic,
    market,
    open,
    orderType,
    side,
    timeInForce,
  ]);

  if (!open || !market) return null;

  const submitDisabled =
    !canAccess ||
    submitBusy ||
    !amountAtomic ||
    (orderType === "limit" && !limitPriceAtomic);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-xl rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="label">PREDICTION_TICKET</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">
              {market.title}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {market.eventTitle ?? "DFlow tokenized event market"} •{" "}
              {getTerminalVenueExecutionReadinessLabel("shadow_paper")}
            </p>
          </div>
          <button
            className={`${BTN_SECONDARY} !px-3 !py-2 text-xs`}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="grid gap-4 px-5 py-4">
          {!canAccess ? (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Prediction trading is rollout-gated for the current cohort.
            </div>
          ) : (
            <div className="rounded border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
              Prediction orders stay paper-only here. The terminal persists the
              simulated request/receipt path so positions and settlement remain
              auditable.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted">
                Side
              </span>
              <select
                className="input-field !py-2 font-mono"
                value={side}
                onChange={(event) =>
                  setSide(event.target.value as typeof defaultSide)
                }
              >
                <option value="buy_yes">buy_yes</option>
                <option value="buy_no">buy_no</option>
                <option value="sell_yes">sell_yes</option>
                <option value="sell_no">sell_no</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted">
                Quantity (shares)
              </span>
              <input
                className="input-field !py-2 font-mono"
                inputMode="decimal"
                value={amountUi}
                onChange={(event) => setAmountUi(event.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted">
                Order Type
              </span>
              <select
                className="input-field !py-2 font-mono"
                value={orderType}
                onChange={(event) =>
                  setOrderType(event.target.value as "market" | "limit")
                }
              >
                <option value="market">market</option>
                <option value="limit">limit</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted">
                TIF
              </span>
              <select
                className="input-field !py-2 font-mono"
                value={timeInForce}
                onChange={(event) =>
                  setTimeInForce(event.target.value as "gtc" | "ioc" | "fok")
                }
              >
                <option value="gtc">gtc</option>
                <option value="ioc">ioc</option>
                <option value="fok">fok</option>
              </select>
            </label>
          </div>

          {orderType === "limit" ? (
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted">
                Limit Price
              </span>
              <input
                className="input-field !py-2 font-mono"
                inputMode="decimal"
                placeholder="0.55"
                value={limitPriceUi}
                onChange={(event) => setLimitPriceUi(event.target.value)}
              />
            </label>
          ) : null}

          <div className="grid gap-3 rounded border border-border bg-subtle px-3 py-3 text-xs sm:grid-cols-2">
            <div>
              <p className="text-muted">Selected path</p>
              <p className="mt-1 font-mono text-ink">
                {readableSideLabel(side)} via DFlow
              </p>
            </div>
            <div>
              <p className="text-muted">Settlement mint</p>
              <p className="mt-1 font-mono text-ink">
                {previewSettlementMint ?? market.settlementMint ?? "--"}
              </p>
            </div>
            <div>
              <p className="text-muted">Preview price</p>
              <p className="mt-1 font-mono text-ink">
                {previewPrice === null ? "--" : previewPrice.toFixed(4)}
              </p>
            </div>
            <div>
              <p className="text-muted">Estimated notional</p>
              <p className="mt-1 font-mono text-ink">
                {previewNotional === null
                  ? "--"
                  : `$${previewNotional.toFixed(2)}`}
              </p>
            </div>
          </div>

          <p
            className={`text-xs ${
              previewStatus === "error"
                ? "text-red-300"
                : previewStatus === "loading"
                  ? "text-muted"
                  : "text-ink"
            }`}
          >
            {previewStatus === "loading"
              ? "Refreshing preview..."
              : (previewMessage ?? "Preview idle")}
          </p>

          <div className="flex justify-end gap-2">
            <button
              className={`${BTN_SECONDARY} !px-4 !py-2 text-xs`}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className={`${BTN_PRIMARY} !px-4 !py-2 text-xs`}
              disabled={submitDisabled}
              onClick={() => {
                if (!amountAtomic) return;
                void (async () => {
                  try {
                    setSubmitBusy(true);
                    const token = await getAccessToken();
                    if (!token) throw new Error("missing-access-token");
                    const client = createExecutionClient({ authToken: token });
                    const result = await client.submitPredictionOrder(
                      {
                        venueKey: "dflow",
                        instrumentId: market.marketId,
                        instrumentLabel: market.title,
                        outcomeId: side.endsWith("_yes")
                          ? (market.yesMint ?? "")
                          : (market.noMint ?? ""),
                        side,
                        quantityAtomic: amountAtomic,
                        orderType,
                        timeInForce,
                        quantityMode: "base",
                        ...(orderType === "limit" && limitPriceAtomic
                          ? { limitPriceAtomic }
                          : {}),
                        source: "PREDICTION_TICKET",
                        reason: `${readableSideLabel(side)} ${market.title}`,
                      },
                      {
                        idempotencyKey: newExecutionIdempotencyKey("pred"),
                      },
                    );
                    toast.success("Prediction order recorded", {
                      description: `${readableSideLabel(side)} • ${amountUi} shares`,
                      position: "bottom-right",
                    });
                    onSubmitted(result);
                    onClose();
                  } catch (error) {
                    toast.error("Prediction order failed", {
                      description: describeExecutionClientError(
                        error,
                        "prediction-submit-failed",
                      ),
                      position: "bottom-right",
                    });
                  } finally {
                    setSubmitBusy(false);
                  }
                })();
              }}
              type="button"
            >
              {submitBusy ? "Submitting..." : "Submit Paper Order"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
