"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  apiBase,
  apiFetchJson,
  BTN_PRIMARY,
  BTN_SECONDARY,
  isRecord,
} from "../../lib";
import { SOL_DECIMALS, type TradeIntent, USDC_DECIMALS } from "./trade-intent";

type TradeTicketModalProps = {
  open: boolean;
  intent: TradeIntent | null;
  walletAddress: string | null;
  solBalanceLamports?: string | null;
  usdcBalanceAtomic?: string | null;
  getAccessToken: () => Promise<string | null>;
  onClose: () => void;
  onTradeComplete?: (trade: TradeTicketCompletion) => void;
};

export type TradeTicketCompletion = {
  inputSymbol: "SOL" | "USDC";
  outputSymbol: "SOL" | "USDC";
  inAmountAtomic: string;
  outAmountAtomic: string;
  status: string;
  signature: string | null;
};

type QuoteState = {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  inAmountAtomic: string | null;
  outAmountAtomic: string | null;
  outAmountUi: string | null;
  route: string | null;
  priceImpactPct: number | null;
};

const USDC_AMOUNT_PRESETS = ["25", "50", "100"] as const;
const SOL_AMOUNT_PRESETS = ["0.1", "0.25", "0.5"] as const;
const MIN_AMOUNT_BY_SYMBOL = {
  SOL: "0.01",
  USDC: "1",
} as const;
const MIN_SLIPPAGE_BPS = "1";
const MAX_SLIPPAGE_BPS = "5000";

function decimalsForSymbol(symbol: "SOL" | "USDC"): number {
  return symbol === "SOL" ? SOL_DECIMALS : USDC_DECIMALS;
}

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
  if (total <= BigInt(0)) return null;
  return total.toString();
}

function formatAtomicToUi(
  atomicRaw: string | null,
  decimals: number,
  maxFracDigits = 6,
): string | null {
  if (!atomicRaw || !/^\d+$/.test(atomicRaw)) return null;
  try {
    const amount = BigInt(atomicRaw);
    const scale = BigInt(10) ** BigInt(decimals);
    const whole = amount / scale;
    const frac = (amount % scale).toString().padStart(decimals, "0");
    if (decimals === 0 || maxFracDigits <= 0) return whole.toString();
    const shownFrac = frac.slice(0, Math.min(decimals, maxFracDigits));
    const trimmedFrac = shownFrac.replace(/0+$/, "");
    return trimmedFrac
      ? `${whole.toString()}.${trimmedFrac}`
      : whole.toString();
  } catch {
    return null;
  }
}

function toPositiveAtomic(raw: string | null | undefined): string | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw) > BigInt(0) ? raw : null;
  } catch {
    return null;
  }
}

function summarizeQuoteRoute(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.routePlan)) return null;
  const labels: string[] = [];
  for (const hop of payload.routePlan) {
    if (!isRecord(hop) || !isRecord(hop.swapInfo)) continue;
    const label = hop.swapInfo.label;
    if (typeof label === "string" && label.trim()) {
      labels.push(label.trim());
    }
    if (labels.length >= 3) break;
  }
  return labels.length > 0 ? labels.join(" -> ") : null;
}

function toBoundedSlippage(value: string, fallback: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(5000, Math.floor(raw)));
}

function areQuoteStatesEqual(a: QuoteState, b: QuoteState): boolean {
  return (
    a.status === b.status &&
    a.error === b.error &&
    a.inAmountAtomic === b.inAmountAtomic &&
    a.outAmountAtomic === b.outAmountAtomic &&
    a.outAmountUi === b.outAmountUi &&
    a.route === b.route &&
    a.priceImpactPct === b.priceImpactPct
  );
}

const EMPTY_QUOTE: QuoteState = {
  status: "idle",
  error: null,
  inAmountAtomic: null,
  outAmountAtomic: null,
  outAmountUi: null,
  route: null,
  priceImpactPct: null,
};

export function TradeTicketModal({
  open,
  intent,
  walletAddress,
  solBalanceLamports,
  usdcBalanceAtomic,
  getAccessToken,
  onClose,
  onTradeComplete,
}: TradeTicketModalProps) {
  const [amountUi, setAmountUi] = useState("");
  const [slippageInput, setSlippageInput] = useState("50");
  const [quote, setQuote] = useState<QuoteState>(EMPTY_QUOTE);
  const [submitStatus, setSubmitStatus] = useState<
    "idle" | "submitting" | "error"
  >("idle");
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isQuoteTransitionPending, startQuoteTransition] = useTransition();

  const onCloseRef = useRef(onClose);
  const quoteAbortRef = useRef<AbortController | null>(null);
  const quoteRequestIdRef = useRef(0);
  onCloseRef.current = onClose;

  const setQuoteTransition = useCallback((next: QuoteState) => {
    startQuoteTransition(() => {
      setQuote((current) =>
        areQuoteStatesEqual(current, next) ? current : next,
      );
    });
  }, []);

  useEffect(() => {
    return () => {
      quoteAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || !intent) return;
    quoteAbortRef.current?.abort();
    setAmountUi(intent.amountUi);
    setSlippageInput(String(intent.slippageBps));
    setQuote(EMPTY_QUOTE);
    setSubmitStatus("idle");
    setSubmitMessage(null);
  }, [open, intent]);

  const deferredAmountUi = useDeferredValue(amountUi);
  const deferredSlippageInput = useDeferredValue(slippageInput);

  const amountPresets = useMemo(
    () =>
      intent?.inputSymbol === "USDC" ? USDC_AMOUNT_PRESETS : SOL_AMOUNT_PRESETS,
    [intent?.inputSymbol],
  );

  const maxAmountUi = useMemo(() => {
    if (!intent) return null;
    const inputAtomicRaw =
      intent.inputSymbol === "SOL" ? solBalanceLamports : usdcBalanceAtomic;
    const inputAtomic = toPositiveAtomic(inputAtomicRaw);
    if (!inputAtomic) return null;
    return formatAtomicToUi(
      inputAtomic,
      decimalsForSymbol(intent.inputSymbol),
      6,
    );
  }, [intent, solBalanceLamports, usdcBalanceAtomic]);

  const resolvedSlippageBps = useMemo(
    () => toBoundedSlippage(deferredSlippageInput, intent?.slippageBps ?? 50),
    [deferredSlippageInput, intent?.slippageBps],
  );

  const refreshQuote = useCallback(async (): Promise<void> => {
    if (!intent || !open) return;
    const inputDecimals = decimalsForSymbol(intent.inputSymbol);
    const outputDecimals = decimalsForSymbol(intent.outputSymbol);
    const inAmountAtomic = parseUiAmountToAtomic(
      deferredAmountUi,
      inputDecimals,
    );

    if (!inAmountAtomic) {
      setQuoteTransition({
        ...EMPTY_QUOTE,
        status: "idle",
      });
      return;
    }

    const base = apiBase();
    if (!base) {
      setQuoteTransition({
        status: "error",
        error: "missing NEXT_PUBLIC_EDGE_API_BASE",
        inAmountAtomic,
        outAmountAtomic: null,
        outAmountUi: null,
        route: null,
        priceImpactPct: null,
      });
      return;
    }

    setQuoteTransition({
      status: "loading",
      error: null,
      inAmountAtomic,
      outAmountAtomic: null,
      outAmountUi: null,
      route: null,
      priceImpactPct: null,
    });

    quoteAbortRef.current?.abort();
    const controller = new AbortController();
    quoteAbortRef.current = controller;
    const requestId = quoteRequestIdRef.current + 1;
    quoteRequestIdRef.current = requestId;

    try {
      const response = await fetch(
        `${base}/api/x402/read/market_jupiter_quote`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "payment-signature": "portal-trade-ticket",
          },
          body: JSON.stringify({
            inputMint: intent.inputMint,
            outputMint: intent.outputMint,
            amount: inAmountAtomic,
            slippageBps: resolvedSlippageBps,
          }),
          signal: controller.signal,
        },
      );
      const payload = (await response.json().catch(() => null)) as unknown;
      if (requestId !== quoteRequestIdRef.current) return;
      if (!response.ok) {
        const error =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : `http-${response.status}`;
        throw new Error(error);
      }
      if (
        !isRecord(payload) ||
        payload.ok !== true ||
        !isRecord(payload.quote)
      ) {
        throw new Error("invalid-quote-payload");
      }

      const outAmountAtomic = String(payload.quote.outAmount ?? "").trim();
      const outAmountUi = formatAtomicToUi(outAmountAtomic, outputDecimals, 6);
      if (!outAmountUi) throw new Error("invalid-quote-out-amount");
      const priceImpactRaw = payload.quote.priceImpactPct;
      const priceImpactPct =
        typeof priceImpactRaw === "number"
          ? priceImpactRaw
          : Number(priceImpactRaw);

      setQuoteTransition({
        status: "ready",
        error: null,
        inAmountAtomic,
        outAmountAtomic,
        outAmountUi,
        route: summarizeQuoteRoute(payload.quote),
        priceImpactPct: Number.isFinite(priceImpactPct) ? priceImpactPct : null,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setQuoteTransition({
        status: "error",
        error: error instanceof Error ? error.message : "quote-failed",
        inAmountAtomic,
        outAmountAtomic: null,
        outAmountUi: null,
        route: null,
        priceImpactPct: null,
      });
    }
  }, [deferredAmountUi, intent, open, resolvedSlippageBps, setQuoteTransition]);

  useEffect(() => {
    if (!open || !intent) return;
    const timer = window.setTimeout(() => {
      void refreshQuote();
    }, 120);
    return () => {
      window.clearTimeout(timer);
      quoteAbortRef.current?.abort();
    };
  }, [open, intent, refreshQuote]);

  const executeTrade = useCallback(async (): Promise<void> => {
    if (!intent) return;
    if (!walletAddress) {
      setSubmitStatus("error");
      setSubmitMessage("wallet-unavailable");
      return;
    }
    if (!quote.inAmountAtomic) {
      setSubmitStatus("error");
      setSubmitMessage("quote-required");
      return;
    }
    if (!quote.outAmountAtomic) {
      setSubmitStatus("error");
      setSubmitMessage("quote-out-amount-missing");
      return;
    }

    setSubmitStatus("submitting");
    setSubmitMessage(null);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");

      const payload = await apiFetchJson("/api/trade/swap", token, {
        method: "POST",
        body: JSON.stringify({
          inputMint: intent.inputMint,
          outputMint: intent.outputMint,
          amount: quote.inAmountAtomic,
          slippageBps: resolvedSlippageBps,
          source: intent.source,
          reason: intent.reason,
        }),
      });

      if (!isRecord(payload) || payload.ok !== true) {
        throw new Error("swap-failed");
      }

      const status = String(payload.status ?? "").trim() || "unknown";
      const nextSignature =
        typeof payload.signature === "string" && payload.signature.trim()
          ? payload.signature.trim()
          : null;
      onTradeComplete?.({
        inputSymbol: intent.inputSymbol,
        outputSymbol: intent.outputSymbol,
        inAmountAtomic: quote.inAmountAtomic,
        outAmountAtomic: quote.outAmountAtomic,
        status,
        signature: nextSignature,
      });
      toast.success("Swap executed", {
        description: nextSignature
          ? `Signature: ${nextSignature.slice(0, 8)}...${nextSignature.slice(-8)}`
          : `Status: ${status}`,
        position: "bottom-right",
      });
      onClose();
    } catch (error) {
      setSubmitStatus("error");
      setSubmitMessage(error instanceof Error ? error.message : "swap-failed");
    }
  }, [
    getAccessToken,
    intent,
    onClose,
    onTradeComplete,
    quote.inAmountAtomic,
    quote.outAmountAtomic,
    resolvedSlippageBps,
    walletAddress,
  ]);

  const handleAmountChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setAmountUi(event.target.value);
    },
    [],
  );

  const handleSlippageChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSlippageInput(event.target.value);
    },
    [],
  );

  const setAmountMin = useCallback(() => {
    if (!intent) return;
    setAmountUi(MIN_AMOUNT_BY_SYMBOL[intent.inputSymbol]);
  }, [intent]);

  const setAmountMax = useCallback(() => {
    if (!maxAmountUi) return;
    setAmountUi(maxAmountUi);
  }, [maxAmountUi]);

  const setSlippageMin = useCallback(() => {
    setSlippageInput(MIN_SLIPPAGE_BPS);
  }, []);

  const setSlippageMax = useCallback(() => {
    setSlippageInput(MAX_SLIPPAGE_BPS);
  }, []);

  if (!intent) return null;
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[6px]">
      <button
        aria-label="Close trade ticket"
        className="absolute inset-0"
        onClick={onClose}
        type="button"
      />
      <div className="relative w-[min(520px,92vw)] max-h-[90vh] overflow-y-auto card">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div>
            <p className="label">TRADE_TICKET</p>
            <p className="text-[11px] text-muted mt-1">
              {intent.source} • {intent.reason}
            </p>
          </div>
          <button
            className="flex items-center justify-center w-9 h-9 rounded-md border border-border bg-surface text-xl cursor-pointer hover:bg-paper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="p-6 space-y-4">
          <TradeIdentityCard intent={intent} walletAddress={walletAddress} />
          <TradeInputsSection
            amountUi={amountUi}
            amountPresets={amountPresets}
            inputSymbol={intent.inputSymbol}
            amountMinValue={MIN_AMOUNT_BY_SYMBOL[intent.inputSymbol]}
            amountMaxValue={maxAmountUi}
            slippageInput={slippageInput}
            onAmountChange={handleAmountChange}
            onSlippageChange={handleSlippageChange}
            onSelectPreset={setAmountUi}
            onSetAmountMin={setAmountMin}
            onSetAmountMax={setAmountMax}
            onSetSlippageMin={setSlippageMin}
            onSetSlippageMax={setSlippageMax}
            onRefreshQuote={refreshQuote}
          />
          <QuoteSummaryCard
            outputSymbol={intent.outputSymbol}
            quote={quote}
            loading={quote.status === "loading" || isQuoteTransitionPending}
          />

          {submitMessage ? (
            <p className="text-red-400 text-xs">{submitMessage}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              className={`${BTN_SECONDARY} !py-2 !px-4 text-xs`}
              onClick={onClose}
              type="button"
            >
              Close
            </button>
            <button
              className={`${BTN_PRIMARY} !py-2 !px-4 text-xs min-w-[8.5rem]`}
              onClick={() => void executeTrade()}
              type="button"
              disabled={
                submitStatus === "submitting" ||
                quote.status !== "ready" ||
                !quote.inAmountAtomic
              }
            >
              {submitStatus === "submitting"
                ? "Submitting..."
                : `Execute ${intent.direction === "buy" ? "Buy" : "Sell"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const TradeIdentityCard = memo(function TradeIdentityCard(props: {
  intent: TradeIntent;
  walletAddress: string | null;
}) {
  const { intent, walletAddress } = props;
  return (
    <div className="rounded border border-border bg-subtle px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted">Pair</span>
        <span className="font-mono">SOL/USDC</span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-muted">Direction</span>
        <span className="font-mono uppercase">{intent.direction}</span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-muted">Wallet</span>
        <span className="font-mono">
          {walletAddress
            ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
            : "--"}
        </span>
      </div>
    </div>
  );
});

const TradeInputsSection = memo(function TradeInputsSection(props: {
  amountUi: string;
  amountPresets: readonly string[];
  inputSymbol: "SOL" | "USDC";
  amountMinValue: string;
  amountMaxValue: string | null;
  slippageInput: string;
  onAmountChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSlippageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectPreset: (value: string) => void;
  onSetAmountMin: () => void;
  onSetAmountMax: () => void;
  onSetSlippageMin: () => void;
  onSetSlippageMax: () => void;
  onRefreshQuote: () => Promise<void>;
}) {
  const {
    amountUi,
    amountPresets,
    inputSymbol,
    amountMinValue,
    amountMaxValue,
    slippageInput,
    onAmountChange,
    onSlippageChange,
    onSelectPreset,
    onSetAmountMin,
    onSetAmountMax,
    onSetSlippageMin,
    onSetSlippageMax,
    onRefreshQuote,
  } = props;
  const quickActionClass = `${BTN_SECONDARY} h-6 min-w-[2.9rem] !px-2 text-[10px] font-mono`;

  return (
    <>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <label className="label block" htmlFor="trade-ticket-amount">
            Amount ({inputSymbol})
          </label>
          <div className="flex items-center gap-1.5">
            <button
              aria-label={`Set minimum amount (${amountMinValue} ${inputSymbol})`}
              className={quickActionClass}
              onClick={onSetAmountMin}
              type="button"
            >
              Min
            </button>
            <button
              aria-label={
                amountMaxValue
                  ? `Set maximum amount (${amountMaxValue} ${inputSymbol})`
                  : `No ${inputSymbol} balance available`
              }
              className={quickActionClass}
              disabled={!amountMaxValue}
              onClick={onSetAmountMax}
              type="button"
            >
              Max
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            id="trade-ticket-amount"
            className="input-field !py-2.5 font-mono"
            inputMode="decimal"
            placeholder={inputSymbol === "USDC" ? "50" : "0.25"}
            value={amountUi}
            onChange={onAmountChange}
          />
          <button
            className={`${BTN_SECONDARY} !py-2.5 !px-3 text-xs`}
            type="button"
            onClick={() => void onRefreshQuote()}
          >
            Refresh quote
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          {amountPresets.map((preset) => (
            <button
              key={preset}
              className={`${BTN_SECONDARY} !py-1.5 !px-2.5 text-[11px]`}
              type="button"
              onClick={() => onSelectPreset(preset)}
            >
              {preset} {inputSymbol}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <label className="label block" htmlFor="trade-ticket-slippage">
            Slippage (bps)
          </label>
          <div className="flex items-center gap-1.5">
            <button
              aria-label="Set minimum slippage (1 bps)"
              className={quickActionClass}
              onClick={onSetSlippageMin}
              type="button"
            >
              Min
            </button>
            <button
              aria-label="Set maximum slippage (5000 bps)"
              className={quickActionClass}
              onClick={onSetSlippageMax}
              type="button"
            >
              Max
            </button>
          </div>
        </div>
        <input
          id="trade-ticket-slippage"
          className="input-field !py-2.5 font-mono"
          inputMode="numeric"
          min={1}
          max={5000}
          value={slippageInput}
          onChange={onSlippageChange}
        />
      </div>
    </>
  );
});

const QuoteSummaryCard = memo(function QuoteSummaryCard(props: {
  outputSymbol: "SOL" | "USDC";
  quote: QuoteState;
  loading: boolean;
}) {
  const { outputSymbol, quote, loading } = props;
  const statusText = quote.error
    ? quote.error
    : loading
      ? "Fetching quote..."
      : " ";
  const statusClass = quote.error
    ? "text-amber-300"
    : loading
      ? "text-muted"
      : "text-transparent";

  return (
    <div className="rounded border border-border bg-subtle px-3 py-2 text-xs space-y-1.5 min-h-[112px]">
      <div className="flex items-center justify-between">
        <span className="text-muted">Expected Output</span>
        <span className="font-mono">
          {quote.outAmountUi ? `${quote.outAmountUi} ${outputSymbol}` : "--"}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted">Price Impact</span>
        <span className="font-mono">
          {quote.priceImpactPct === null
            ? "--"
            : `${(quote.priceImpactPct * 100).toFixed(2)}%`}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted">Route</span>
        <span className="font-mono truncate max-w-[65%] text-right">
          {quote.route ?? "--"}
        </span>
      </div>
      <p aria-live="polite" className={statusClass}>
        {statusText}
      </p>
    </div>
  );
});
