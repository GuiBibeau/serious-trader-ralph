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
  createExecutionClient,
  describeExecutionClientError,
  newExecutionIdempotencyKey,
} from "../../execution-client";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../lib";
import type {
  TerminalIntentFamily,
  TerminalMarketType,
  TerminalOracleStatus,
  TerminalProviderStatus,
  TerminalSpotVenueDefinition,
  TerminalVenueKey,
  TerminalVenueRolloutPolicy,
} from "../terminal-venues";
import {
  getTerminalOrderTypeLabel,
  getTerminalSpotVenueDefinition,
  getTerminalTimeInForceLabel,
  getTerminalVenueExecutionReadinessLabel,
  listTerminalSpotVenueDefinitions,
} from "../terminal-venues";
import {
  type AccountRiskSnapshot,
  evaluatePreSubmitRisk,
} from "./account-risk";
import {
  formatHotkeyChord,
  matchesHotkey,
  toAriaKeyShortcuts,
} from "./terminal-hotkeys";
import type { TradeIntent } from "./trade-intent";

type TradeTicketModalProps = {
  open: boolean;
  intent: TradeIntent | null;
  walletAddress: string | null;
  tokenBalancesByMint?: Record<string, string> | null;
  riskSnapshot?: AccountRiskSnapshot | null;
  referencePrice?: number | null;
  terminalVenueRolloutPolicy: TerminalVenueRolloutPolicy;
  riskAcknowledgement?: {
    required: boolean;
    title?: string;
    message?: string;
    confirmationLabel?: string;
  };
  hotkeyBindings?: TradeTicketHotkeyBindings;
  getAccessToken: () => Promise<string | null>;
  onClose: () => void;
  onTradeComplete?: (trade: TradeTicketCompletion) => void;
  onOrderQueued?: (requestId: string) => void;
};

type TradeTicketHotkeyBindings = {
  submit: string;
  cancel: string;
  preset1: string;
  preset2: string;
  preset3: string;
};

export type TradeTicketCompletion = {
  pairId: TradeIntent["pairId"];
  instrumentId: string;
  instrumentLabel: string;
  venueKey: TradeIntent["venueKey"];
  intentFamily: TradeIntent["intentFamily"];
  marketType: TradeIntent["marketType"];
  direction: TradeIntent["direction"];
  source: string;
  reason: string;
  requestId: string;
  receiptId: string | null;
  provider: string | null;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  inAmountAtomic: string;
  outAmountAtomic: string;
  baseFilledUi: number;
  quoteFilledUi: number;
  fillPrice: number | null;
  feeUi: number | null;
  feeSymbol: string | null;
  status: string;
  signature: string | null;
  lane: ExecutionLane;
  simulationPreference: SimulationPreference;
  slippageBps: number;
  priorityLevel: PriorityLevel;
  priorityMicroLamports: number;
};

export type QueuedTerminalOrder = {
  id: string;
  createdAt: number;
  updatedAt: number;
  pairId: TradeIntent["pairId"];
  instrumentId?: string;
  instrumentLabel?: string;
  venueKey?: TerminalVenueKey;
  intentFamily?: TerminalIntentFamily;
  marketType?: TerminalMarketType;
  providerStatus?: TerminalProviderStatus | null;
  oracleStatus?: TerminalOracleStatus | null;
  direction: TradeIntent["direction"];
  source: string;
  reason: string;
  orderType: "limit" | "trigger";
  timeInForce: TimeInForce;
  amountUi: string;
  remainingAmountUi: string;
  slippageBps: number;
  lane: ExecutionLane;
  simulationPreference: SimulationPreference;
  priorityLevel: PriorityLevel;
  limitPriceUi: string | null;
  triggerPriceUi: string | null;
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

type OrderType = "market" | "limit" | "trigger";
type TimeInForce = "gtc" | "ioc" | "fok";
type QuantityMode = "base" | "quote" | "notional";
type ExecutionLane = "fast" | "protected" | "safe";
type SimulationPreference = "auto" | "always" | "never";
type PriorityLevel = "normal" | "high" | "urgent";

const MIN_SLIPPAGE_BPS = "1";
const MAX_SLIPPAGE_BPS = "5000";
const EXEC_POLL_INTERVAL_MS = 1200;
const EXEC_POLL_TIMEOUT_MS = 45000;
const ORDER_PRICE_DECIMALS = 6;
const MAX_PRIORITY_MICRO_LAMPORTS = 2_000_000;
const DEFAULT_EXECUTION_LANE: ExecutionLane = "safe";
const DEFAULT_SIMULATION_PREFERENCE: SimulationPreference = "auto";
const DEFAULT_PRIORITY_LEVEL: PriorityLevel = "normal";
const DEFAULT_TRADE_TICKET_HOTKEY_BINDINGS: TradeTicketHotkeyBindings = {
  submit: "mod+enter",
  cancel: "escape",
  preset1: "alt+1",
  preset2: "alt+2",
  preset3: "alt+3",
};
const PRIORITY_MICRO_LAMPORTS_BY_LEVEL: Record<PriorityLevel, number> = {
  normal: 5_000,
  high: 50_000,
  urgent: 200_000,
};

type CloseModalOptions = {
  cancelExecution?: boolean;
};

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

function atomicToUiNumber(
  atomicRaw: string | null,
  decimals: number,
): number | null {
  const ui = formatAtomicToUi(atomicRaw, decimals, 9);
  if (!ui) return null;
  const parsed = Number(ui);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function lamportsToSolUi(lamports: string | null): number | null {
  const formatted = formatAtomicToUi(lamports, 9, 9);
  if (!formatted) return null;
  const parsed = Number(formatted);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toPositiveAtomic(raw: string | null | undefined): string | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw) > BigInt(0) ? raw : null;
  } catch {
    return null;
  }
}

function toBoundedSlippage(value: string, fallback: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(5000, Math.floor(raw)));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
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

function isVenueLiveExecutable(
  venue: TerminalSpotVenueDefinition | null,
): boolean {
  return (
    venue?.executionReadiness === "bounded_live" ||
    venue?.executionReadiness === "broad_live"
  );
}

function coerceVenueOrderType(
  venue: TerminalSpotVenueDefinition | null,
  orderType: OrderType,
): OrderType {
  if (!venue) return orderType;
  return venue.supportedOrderTypes.includes(orderType)
    ? orderType
    : (venue.supportedOrderTypes[0] ?? "market");
}

function coerceVenueTimeInForce(
  venue: TerminalSpotVenueDefinition | null,
  timeInForce: TimeInForce,
): TimeInForce {
  if (!venue) return timeInForce;
  return venue.supportedTimeInForce.includes(timeInForce)
    ? timeInForce
    : (venue.supportedTimeInForce[0] ?? "gtc");
}

export function validateOrderConfig(input: {
  orderType: OrderType;
  timeInForce: TimeInForce;
  lane: ExecutionLane;
  venue?: TerminalSpotVenueDefinition | null;
  reduceOnly: boolean;
  postOnly: boolean;
  quantityMode: QuantityMode;
  amountAtomic: string | null;
  limitPriceAtomic: string | null;
  triggerPriceAtomic: string | null;
  takeProfitPriceAtomic: string | null;
  stopLossPriceAtomic: string | null;
  bracketEnabled: boolean;
}): string[] {
  const errors: string[] = [];
  const venue = input.venue ?? getTerminalSpotVenueDefinition("jupiter");
  if (venue && !venue.supportedOrderTypes.includes(input.orderType)) {
    errors.push(
      `${venue.label} does not support ${input.orderType.toUpperCase()} spot orders.`,
    );
  }
  if (venue && !venue.supportedTimeInForce.includes(input.timeInForce)) {
    errors.push(
      `${venue.label} does not support ${input.timeInForce.toUpperCase()} time-in-force.`,
    );
  }
  if (!input.amountAtomic) {
    errors.push("Amount must be greater than zero.");
  }
  if (input.orderType === "limit" && !input.limitPriceAtomic) {
    errors.push("Limit orders require a limit price.");
  }
  if (input.orderType === "trigger" && !input.triggerPriceAtomic) {
    errors.push("Trigger orders require a trigger price.");
  }
  if (
    (input.orderType === "limit" || input.orderType === "trigger") &&
    input.lane !== "safe"
  ) {
    errors.push("Limit and trigger orders currently require the safe lane.");
  }
  if (
    (input.orderType === "limit" || input.orderType === "trigger") &&
    input.timeInForce !== "gtc"
  ) {
    errors.push("Trigger-backed spot orders currently require GTC.");
  }
  if (
    input.postOnly &&
    (input.timeInForce === "ioc" || input.timeInForce === "fok")
  ) {
    errors.push("Post-only cannot be combined with IOC or FOK.");
  }
  if (input.postOnly && venue && !venue.supportsPostOnly) {
    errors.push(`${venue.label} does not support post-only spot orders.`);
  }
  if (
    (input.orderType === "limit" || input.orderType === "trigger") &&
    input.postOnly
  ) {
    errors.push("Post-only is not supported for Trigger-backed spot orders.");
  }
  if (input.orderType === "market" && input.postOnly) {
    errors.push("Post-only is only valid for limit or trigger orders.");
  }
  if (
    (input.orderType === "limit" || input.orderType === "trigger") &&
    input.reduceOnly
  ) {
    errors.push("Reduce-only is not supported for Trigger-backed spot orders.");
  }
  if (input.reduceOnly && venue && !venue.supportsReduceOnly) {
    errors.push(`${venue.label} does not support reduce-only spot orders.`);
  }
  if (
    input.bracketEnabled &&
    !input.takeProfitPriceAtomic &&
    !input.stopLossPriceAtomic
  ) {
    errors.push("Bracket mode requires TP and/or SL price.");
  }
  if (
    input.bracketEnabled &&
    input.takeProfitPriceAtomic &&
    input.stopLossPriceAtomic
  ) {
    try {
      if (
        BigInt(input.takeProfitPriceAtomic) ===
        BigInt(input.stopLossPriceAtomic)
      ) {
        errors.push("TP and SL cannot be equal.");
      }
    } catch {
      errors.push("Invalid TP/SL values.");
    }
  }
  if (
    input.quantityMode !== "quote" &&
    input.orderType === "market" &&
    input.reduceOnly
  ) {
    errors.push(
      "Reduce-only market orders currently require quote quantity mode.",
    );
  }
  if (
    (input.orderType === "limit" || input.orderType === "trigger") &&
    input.bracketEnabled
  ) {
    errors.push("Bracket TP/SL is not wired yet for Trigger-backed orders.");
  }
  if (input.bracketEnabled && venue && !venue.supportsBracket) {
    errors.push(`${venue.label} does not support bracket TP/SL controls.`);
  }
  return errors;
}

function qualityHint(input: {
  lane: ExecutionLane;
  simulationPreference: SimulationPreference;
  priorityLevel: PriorityLevel;
}): string {
  const laneHint =
    input.lane === "safe"
      ? "Safe lane routes with stronger validation."
      : input.lane === "protected"
        ? "Protected lane prioritizes private execution."
        : "Fast lane targets lowest latency routing.";
  const simulationHint =
    input.simulationPreference === "always"
      ? "Simulation is always required before dispatch."
      : input.simulationPreference === "never"
        ? "Simulation is skipped unless policy enforces it."
        : "Simulation follows lane and policy defaults.";
  const priorityHint =
    input.priorityLevel === "urgent"
      ? "Urgent priority increases fee pressure for speed."
      : input.priorityLevel === "high"
        ? "High priority balances speed and fee spend."
        : "Normal priority uses conservative fee settings.";
  return `${laneHint} ${simulationHint} ${priorityHint}`;
}

export function validateExecutionQualityConfig(input: {
  lane: ExecutionLane;
  simulationPreference: SimulationPreference;
  slippageBps: number;
  priorityMicroLamports: number;
}): string[] {
  const errors: string[] = [];
  if (input.lane === "safe" && input.simulationPreference === "never") {
    errors.push("Safe lane requires simulation (choose auto or always).");
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1) {
    errors.push("Slippage must be at least 1 bps.");
  }
  if (input.slippageBps > 5_000) {
    errors.push("Slippage cannot exceed 5000 bps.");
  }
  if (
    !Number.isInteger(input.priorityMicroLamports) ||
    input.priorityMicroLamports < 0 ||
    input.priorityMicroLamports > MAX_PRIORITY_MICRO_LAMPORTS
  ) {
    errors.push("Priority fee is outside allowed bounds.");
  }
  return errors;
}

export function computeQuoteReferenceDivergenceBps(input: {
  direction: TradeIntent["direction"];
  quotedInputAtomic: string | null;
  quotedOutputAtomic: string | null;
  inputDecimals: number;
  outputDecimals: number;
  referencePrice: number | null | undefined;
}): number | null {
  const impliedReference =
    typeof input.referencePrice === "number" &&
    Number.isFinite(input.referencePrice) &&
    input.referencePrice > 0
      ? input.referencePrice
      : null;
  if (impliedReference === null) return null;

  const quotedInput = Number(
    formatAtomicToUi(input.quotedInputAtomic, input.inputDecimals, 9) ?? "",
  );
  const quotedOutput = Number(
    formatAtomicToUi(input.quotedOutputAtomic, input.outputDecimals, 9) ?? "",
  );
  if (
    !Number.isFinite(quotedInput) ||
    !Number.isFinite(quotedOutput) ||
    quotedInput <= 0 ||
    quotedOutput <= 0
  ) {
    return null;
  }

  const quotedPrice =
    input.direction === "buy"
      ? quotedInput / quotedOutput
      : quotedOutput / quotedInput;
  return ((quotedPrice - impliedReference) / impliedReference) * 10_000;
}

export function TradeTicketModal({
  open,
  intent,
  walletAddress,
  tokenBalancesByMint,
  riskSnapshot,
  referencePrice,
  terminalVenueRolloutPolicy,
  riskAcknowledgement,
  hotkeyBindings = DEFAULT_TRADE_TICKET_HOTKEY_BINDINGS,
  getAccessToken,
  onClose,
  onTradeComplete,
  onOrderQueued,
}: TradeTicketModalProps) {
  const [amountUi, setAmountUi] = useState("");
  const [slippageInput, setSlippageInput] = useState("50");
  const [executionLane, setExecutionLane] = useState<ExecutionLane>(
    DEFAULT_EXECUTION_LANE,
  );
  const [simulationPreference, setSimulationPreference] =
    useState<SimulationPreference>(DEFAULT_SIMULATION_PREFERENCE);
  const [priorityLevel, setPriorityLevel] = useState<PriorityLevel>(
    DEFAULT_PRIORITY_LEVEL,
  );
  const [selectedVenueKey, setSelectedVenueKey] =
    useState<TerminalVenueKey>("jupiter");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [timeInForce, setTimeInForce] = useState<TimeInForce>("gtc");
  const [quantityMode, setQuantityMode] = useState<QuantityMode>("quote");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [limitPriceUi, setLimitPriceUi] = useState("");
  const [triggerPriceUi, setTriggerPriceUi] = useState("");
  const [takeProfitPriceUi, setTakeProfitPriceUi] = useState("");
  const [stopLossPriceUi, setStopLossPriceUi] = useState("");
  const [bracketEnabled, setBracketEnabled] = useState(false);
  const [quote, setQuote] = useState<QuoteState>(EMPTY_QUOTE);
  const [submitStatus, setSubmitStatus] = useState<
    "idle" | "submitting" | "tracking" | "error"
  >("idle");
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  const [isQuoteTransitionPending, startQuoteTransition] = useTransition();

  const quoteAbortRef = useRef<AbortController | null>(null);
  const executeAbortRef = useRef<AbortController | null>(null);
  const executeToastIdRef = useRef<string | number | null>(null);
  const continueExecutionOnUnmountRef = useRef(false);
  const quoteRequestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const dismissExecuteToast = useCallback(() => {
    if (executeToastIdRef.current === null) return;
    toast.dismiss(executeToastIdRef.current);
    executeToastIdRef.current = null;
  }, []);

  const closeModal = useCallback(
    (options?: CloseModalOptions) => {
      const cancelExecution = Boolean(options?.cancelExecution);
      if (cancelExecution) {
        continueExecutionOnUnmountRef.current = false;
        executeAbortRef.current?.abort();
        dismissExecuteToast();
      }
      openRef.current = false;
      onClose();
    },
    [dismissExecuteToast, onClose],
  );

  const cancelAndCloseModal = useCallback(() => {
    quoteAbortRef.current?.abort();
    closeModal({ cancelExecution: true });
  }, [closeModal]);

  const setQuoteTransition = useCallback((next: QuoteState) => {
    startQuoteTransition(() => {
      setQuote((current) =>
        areQuoteStatesEqual(current, next) ? current : next,
      );
    });
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      quoteAbortRef.current?.abort();
      if (!continueExecutionOnUnmountRef.current) {
        executeAbortRef.current?.abort();
        dismissExecuteToast();
      }
    };
  }, [dismissExecuteToast]);

  useEffect(() => {
    if (!open || !intent) return;
    quoteAbortRef.current?.abort();
    setAmountUi(intent.amountUi);
    setSlippageInput(String(intent.slippageBps));
    setExecutionLane(DEFAULT_EXECUTION_LANE);
    setSimulationPreference(DEFAULT_SIMULATION_PREFERENCE);
    setPriorityLevel(DEFAULT_PRIORITY_LEVEL);
    setSelectedVenueKey(intent.venueKey);
    setOrderType("market");
    setTimeInForce("gtc");
    setQuantityMode("quote");
    setReduceOnly(false);
    setPostOnly(false);
    setLimitPriceUi("");
    setTriggerPriceUi("");
    setTakeProfitPriceUi("");
    setStopLossPriceUi("");
    setBracketEnabled(false);
    setQuote(EMPTY_QUOTE);
    setSubmitStatus("idle");
    setSubmitMessage(null);
    setRiskConfirmed(false);
  }, [open, intent]);

  const deferredAmountUi = useDeferredValue(amountUi);
  const deferredSlippageInput = useDeferredValue(slippageInput);

  const spotVenueOptions = useMemo(
    () =>
      listTerminalSpotVenueDefinitions({
        policy: terminalVenueRolloutPolicy,
        includeDisabled: true,
      }).filter((definition) => definition.executionReadiness !== "research"),
    [terminalVenueRolloutPolicy],
  );
  const selectedVenue = useMemo(
    () => getTerminalSpotVenueDefinition(selectedVenueKey),
    [selectedVenueKey],
  );
  const selectedVenueLiveExecutable = useMemo(
    () => isVenueLiveExecutable(selectedVenue),
    [selectedVenue],
  );
  const selectedVenueEnabled = useMemo(
    () => terminalVenueRolloutPolicy.enabledVenues.includes(selectedVenueKey),
    [selectedVenueKey, terminalVenueRolloutPolicy.enabledVenues],
  );

  useEffect(() => {
    const nextOrderType = coerceVenueOrderType(selectedVenue, orderType);
    if (nextOrderType !== orderType) {
      setOrderType(nextOrderType);
    }
    const nextTimeInForce = coerceVenueTimeInForce(selectedVenue, timeInForce);
    if (nextTimeInForce !== timeInForce) {
      setTimeInForce(nextTimeInForce);
    }
    if (postOnly && !selectedVenue?.supportsPostOnly) {
      setPostOnly(false);
    }
    if (reduceOnly && !selectedVenue?.supportsReduceOnly) {
      setReduceOnly(false);
    }
    if (bracketEnabled && !selectedVenue?.supportsBracket) {
      setBracketEnabled(false);
    }
  }, [
    bracketEnabled,
    orderType,
    postOnly,
    reduceOnly,
    selectedVenue,
    timeInForce,
  ]);

  const amountPresets = useMemo(
    () => intent?.amountPresets ?? [],
    [intent?.amountPresets],
  );

  const maxAmountUi = useMemo(() => {
    if (!intent) return null;
    const inputAtomicRaw = tokenBalancesByMint?.[intent.inputMint];
    const inputAtomic = toPositiveAtomic(inputAtomicRaw);
    if (!inputAtomic) return null;
    return formatAtomicToUi(inputAtomic, intent.inputDecimals, 6);
  }, [intent, tokenBalancesByMint]);

  const resolvedSlippageBps = useMemo(
    () => toBoundedSlippage(deferredSlippageInput, intent?.slippageBps ?? 50),
    [deferredSlippageInput, intent?.slippageBps],
  );
  const priorityMicroLamports = useMemo(
    () => PRIORITY_MICRO_LAMPORTS_BY_LEVEL[priorityLevel],
    [priorityLevel],
  );
  const executionQualityHint = useMemo(
    () =>
      qualityHint({
        lane: executionLane,
        simulationPreference,
        priorityLevel,
      }),
    [executionLane, priorityLevel, simulationPreference],
  );
  const executionQualityErrors = useMemo(
    () =>
      validateExecutionQualityConfig({
        lane: executionLane,
        simulationPreference,
        slippageBps: resolvedSlippageBps,
        priorityMicroLamports,
      }),
    [
      executionLane,
      priorityMicroLamports,
      resolvedSlippageBps,
      simulationPreference,
    ],
  );

  const amountAtomicForValidation = useMemo(
    () => parseUiAmountToAtomic(deferredAmountUi, intent?.inputDecimals ?? 0),
    [deferredAmountUi, intent?.inputDecimals],
  );
  const limitPriceAtomic = useMemo(
    () => parseUiAmountToAtomic(limitPriceUi, ORDER_PRICE_DECIMALS),
    [limitPriceUi],
  );
  const triggerPriceAtomic = useMemo(
    () => parseUiAmountToAtomic(triggerPriceUi, ORDER_PRICE_DECIMALS),
    [triggerPriceUi],
  );
  const takeProfitPriceAtomic = useMemo(
    () => parseUiAmountToAtomic(takeProfitPriceUi, ORDER_PRICE_DECIMALS),
    [takeProfitPriceUi],
  );
  const stopLossPriceAtomic = useMemo(
    () => parseUiAmountToAtomic(stopLossPriceUi, ORDER_PRICE_DECIMALS),
    [stopLossPriceUi],
  );
  const orderValidationErrors = useMemo(
    () =>
      validateOrderConfig({
        orderType,
        timeInForce,
        lane: executionLane,
        venue: selectedVenue,
        reduceOnly,
        postOnly,
        quantityMode,
        amountAtomic: amountAtomicForValidation,
        limitPriceAtomic,
        triggerPriceAtomic,
        takeProfitPriceAtomic,
        stopLossPriceAtomic,
        bracketEnabled,
      }),
    [
      amountAtomicForValidation,
      bracketEnabled,
      executionLane,
      limitPriceAtomic,
      orderType,
      postOnly,
      quantityMode,
      reduceOnly,
      selectedVenue,
      stopLossPriceAtomic,
      takeProfitPriceAtomic,
      timeInForce,
      triggerPriceAtomic,
    ],
  );
  const preSubmitRisk = useMemo(
    () =>
      evaluatePreSubmitRisk({
        snapshot: riskSnapshot,
        direction: intent?.direction ?? "buy",
        reduceOnly,
      }),
    [intent?.direction, reduceOnly, riskSnapshot],
  );

  const refreshQuote = useCallback(async (): Promise<void> => {
    if (!intent || !open) return;
    const inputDecimals = intent.inputDecimals;
    const outputDecimals = intent.outputDecimals;
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
      const rawToken = String((await getAccessToken()) ?? "").trim();
      const executionClient = createExecutionClient({
        authToken: rawToken,
      });
      const preview = await executionClient.previewSpotOrder(
        {
          venueKey: selectedVenueKey,
          inputMint: intent.inputMint,
          outputMint: intent.outputMint,
          amountAtomic: inAmountAtomic,
          slippageBps: resolvedSlippageBps,
        },
        { signal: controller.signal },
      );
      if (requestId !== quoteRequestIdRef.current) return;

      const outAmountAtomic = preview.outAmountAtomic;
      const outAmountUi = formatAtomicToUi(outAmountAtomic, outputDecimals, 6);
      if (!outAmountUi) throw new Error("invalid-quote-out-amount");

      setQuoteTransition({
        status: "ready",
        error: null,
        inAmountAtomic,
        outAmountAtomic,
        outAmountUi,
        route: preview.routeSummary,
        priceImpactPct: preview.priceImpactPct,
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
  }, [
    deferredAmountUi,
    getAccessToken,
    intent,
    open,
    resolvedSlippageBps,
    selectedVenueKey,
    setQuoteTransition,
  ]);

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
    if (!selectedVenueEnabled) {
      setSubmitStatus("error");
      setSubmitMessage("selected-venue-rollout-gated");
      return;
    }
    if (!selectedVenueLiveExecutable) {
      setSubmitStatus("error");
      setSubmitMessage("selected-venue-preview-only");
      return;
    }
    if (orderValidationErrors.length > 0 || executionQualityErrors.length > 0) {
      setSubmitStatus("error");
      setSubmitMessage(
        orderValidationErrors[0] ??
          executionQualityErrors[0] ??
          "invalid-order-config",
      );
      return;
    }
    if (preSubmitRisk.blocked) {
      setSubmitStatus("error");
      setSubmitMessage(preSubmitRisk.message ?? "risk-guard-blocked");
      return;
    }
    if (riskAcknowledgement?.required && !riskConfirmed) {
      setSubmitStatus("error");
      setSubmitMessage(
        riskAcknowledgement.message ??
          "degen-risk-confirmation-required-before-submit",
      );
      return;
    }
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

    const boundedSlippageBps = toBoundedSlippage(
      slippageInput,
      resolvedSlippageBps,
    );
    const options = {
      commitment: "confirmed" as const,
      ...(simulationPreference === "always"
        ? { requireSimulation: true }
        : simulationPreference === "never"
          ? { requireSimulation: false }
          : {}),
      priorityMicroLamports,
      orderType,
      timeInForce,
      reduceOnly,
      postOnly,
      quantityMode,
      ...(limitPriceAtomic ? { limitPriceAtomic } : {}),
      ...(triggerPriceAtomic ? { triggerPriceAtomic } : {}),
      ...(takeProfitPriceAtomic ? { takeProfitPriceAtomic } : {}),
      ...(stopLossPriceAtomic ? { stopLossPriceAtomic } : {}),
    };

    if (orderType === "limit" || orderType === "trigger") {
      setSubmitStatus("submitting");
      setSubmitMessage(null);
      try {
        executeAbortRef.current?.abort();
        continueExecutionOnUnmountRef.current = false;
        const controller = new AbortController();
        executeAbortRef.current = controller;
        dismissExecuteToast();

        const token = await getAccessToken();
        if (!token) throw new Error("missing-access-token");

        const executionClient = createExecutionClient({
          authToken: token,
          pollIntervalMs: EXEC_POLL_INTERVAL_MS,
          pollTimeoutMs: EXEC_POLL_TIMEOUT_MS,
        });
        const idempotencyKey = newExecutionIdempotencyKey("trade");
        const submitAck = await executionClient.submit(
          {
            schemaVersion: "v2",
            mode: "privy_execute",
            lane: executionLane,
            metadata: {
              source: intent.source,
              reason: `${intent.reason} • ${orderType}/${timeInForce}/${quantityMode} • ${executionLane}/${simulationPreference}/${priorityLevel}`,
              clientRequestId: idempotencyKey,
            },
            privyExecute: {
              wallet: walletAddress,
              intent: {
                family: "conditional_spot_order",
                venueKey: selectedVenueKey,
                marketType: intent.marketType,
                instrumentId: intent.instrumentId,
                side: intent.direction,
                quantityAtomic: quote.inAmountAtomic,
              },
              options,
            },
          },
          {
            idempotencyKey,
            signal: controller.signal,
          },
        );

        if (submitAck.terminal) {
          throw new Error(`conditional-order-${submitAck.state}`);
        }

        closeModal();
        onOrderQueued?.(submitAck.requestId);
        toast.success(`${orderType.toUpperCase()} order submitted`, {
          description: `${intent.instrumentLabel} • ${amountUi.trim()} ${intent.inputSymbol}`,
          position: "bottom-right",
          duration: 3500,
        });
        return;
      } catch (error) {
        const message = describeExecutionClientError(
          error,
          "conditional-order-submit-failed",
        );
        if (!mountedRef.current || !openRef.current) {
          toast.error("Conditional order submit failed", {
            description: message,
            position: "bottom-right",
            duration: 7000,
          });
          return;
        }
        setSubmitStatus("error");
        setSubmitMessage(message);
        return;
      }
    }
    setSubmitStatus("submitting");
    setSubmitMessage(null);
    let execToastId: string | number | null = null;

    try {
      executeAbortRef.current?.abort();
      continueExecutionOnUnmountRef.current = false;
      const controller = new AbortController();
      executeAbortRef.current = controller;
      dismissExecuteToast();

      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");

      const executionClient = createExecutionClient({
        authToken: token,
        pollIntervalMs: EXEC_POLL_INTERVAL_MS,
        pollTimeoutMs: EXEC_POLL_TIMEOUT_MS,
      });
      const idempotencyKey = newExecutionIdempotencyKey("trade");
      const submitAck = await executionClient.submit(
        {
          schemaVersion: "v1",
          mode: "privy_execute",
          lane: executionLane,
          metadata: {
            source: intent.source,
            reason: `${intent.reason} • ${orderType}/${timeInForce}/${quantityMode} • ${executionLane}/${simulationPreference}/${priorityLevel}`,
            clientRequestId: idempotencyKey,
          },
          privyExecute: {
            intentType: "swap",
            wallet: walletAddress,
            swap: {
              inputMint: intent.inputMint,
              outputMint: intent.outputMint,
              amountAtomic: quote.inAmountAtomic,
              slippageBps: boundedSlippageBps,
            },
            options,
          },
        },
        {
          idempotencyKey,
          signal: controller.signal,
        },
      );

      continueExecutionOnUnmountRef.current = true;
      closeModal();
      execToastId = toast.loading("TX submitting...", {
        position: "bottom-right",
        duration: Number.POSITIVE_INFINITY,
      });
      executeToastIdRef.current = execToastId;

      const terminal = await executionClient.waitForTerminalReceipt({
        requestId: submitAck.requestId,
        signal: controller.signal,
      });

      const inputUiAmount =
        atomicToUiNumber(quote.inAmountAtomic, intent.inputDecimals) ?? 0;
      const outputUiAmount =
        atomicToUiNumber(quote.outAmountAtomic, intent.outputDecimals) ?? 0;
      const baseFilledUi =
        intent.direction === "buy" ? outputUiAmount : inputUiAmount;
      const quoteFilledUi =
        intent.direction === "buy" ? inputUiAmount : outputUiAmount;
      const fillPrice = baseFilledUi > 0 ? quoteFilledUi / baseFilledUi : null;

      onTradeComplete?.({
        pairId: intent.pairId,
        instrumentId: intent.instrumentId,
        instrumentLabel: intent.instrumentLabel,
        venueKey: selectedVenueKey,
        intentFamily: intent.intentFamily,
        marketType: intent.marketType,
        direction: intent.direction,
        source: intent.source,
        reason: intent.reason,
        requestId: terminal.requestId,
        receiptId: terminal.receiptId,
        provider: terminal.provider,
        inputMint: intent.inputMint,
        outputMint: intent.outputMint,
        inputSymbol: intent.inputSymbol,
        outputSymbol: intent.outputSymbol,
        inAmountAtomic: quote.inAmountAtomic,
        outAmountAtomic: quote.outAmountAtomic,
        baseFilledUi,
        quoteFilledUi,
        fillPrice,
        feeUi: lamportsToSolUi(terminal.networkFeeLamports),
        feeSymbol: terminal.networkFeeLamports ? "SOL" : null,
        status: terminal.status,
        signature: terminal.signature,
        lane: executionLane,
        simulationPreference,
        slippageBps: boundedSlippageBps,
        priorityLevel,
        priorityMicroLamports,
      });
      toast.success("Trade executed", {
        id: execToastId ?? undefined,
        description: terminal.signature
          ? `Signature: ${terminal.signature.slice(0, 8)}...${terminal.signature.slice(-8)}`
          : `Status: ${terminal.status}`,
        position: "bottom-right",
        duration: 6000,
      });
      continueExecutionOnUnmountRef.current = false;
      executeToastIdRef.current = null;
    } catch (error) {
      if (executeAbortRef.current?.signal.aborted) return;
      const message = describeExecutionClientError(error, "execution-failed");
      if (executeToastIdRef.current !== null || execToastId !== null) {
        toast.error("Trade execution failed", {
          id: executeToastIdRef.current ?? execToastId ?? undefined,
          description: message,
          position: "bottom-right",
          duration: 7000,
        });
        executeToastIdRef.current = null;
      } else {
        toast.error("Trade execution failed", {
          description: message,
          position: "bottom-right",
          duration: 7000,
        });
      }
      continueExecutionOnUnmountRef.current = false;
      if (!mountedRef.current) return;
      if (!openRef.current) return;
      setSubmitStatus("error");
      setSubmitMessage(message);
    }
  }, [
    amountUi,
    closeModal,
    dismissExecuteToast,
    getAccessToken,
    intent,
    limitPriceAtomic,
    onOrderQueued,
    onTradeComplete,
    orderType,
    orderValidationErrors,
    preSubmitRisk,
    riskAcknowledgement?.message,
    riskAcknowledgement?.required,
    riskConfirmed,
    executionLane,
    executionQualityErrors,
    postOnly,
    priorityLevel,
    priorityMicroLamports,
    quantityMode,
    quote.inAmountAtomic,
    quote.outAmountAtomic,
    reduceOnly,
    resolvedSlippageBps,
    selectedVenueKey,
    selectedVenueEnabled,
    selectedVenueLiveExecutable,
    slippageInput,
    stopLossPriceAtomic,
    simulationPreference,
    takeProfitPriceAtomic,
    timeInForce,
    triggerPriceAtomic,
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
    setAmountUi(intent.inputMinAmountUi);
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

  const canExecuteTrade =
    submitStatus !== "submitting" &&
    submitStatus !== "tracking" &&
    quote.status === "ready" &&
    Boolean(quote.inAmountAtomic) &&
    selectedVenueEnabled &&
    selectedVenueLiveExecutable &&
    (!riskAcknowledgement?.required || riskConfirmed) &&
    orderValidationErrors.length < 1 &&
    executionQualityErrors.length < 1 &&
    !preSubmitRisk.blocked;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (matchesHotkey(event, hotkeyBindings.cancel)) {
        event.preventDefault();
        cancelAndCloseModal();
        return;
      }

      const typing = isTypingTarget(event.target);
      if (typing && !event.altKey && !event.metaKey && !event.ctrlKey) {
        return;
      }

      if (matchesHotkey(event, hotkeyBindings.submit)) {
        if (!canExecuteTrade) return;
        event.preventDefault();
        void executeTrade();
        return;
      }

      if (matchesHotkey(event, hotkeyBindings.preset1)) {
        const preset = amountPresets[0] ?? null;
        if (!preset) return;
        event.preventDefault();
        setAmountUi(preset);
        return;
      }

      if (matchesHotkey(event, hotkeyBindings.preset2)) {
        const preset = amountPresets[1] ?? null;
        if (!preset) return;
        event.preventDefault();
        setAmountUi(preset);
        return;
      }

      if (matchesHotkey(event, hotkeyBindings.preset3)) {
        const preset = amountPresets[2] ?? null;
        if (!preset) return;
        event.preventDefault();
        setAmountUi(preset);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    amountPresets,
    cancelAndCloseModal,
    canExecuteTrade,
    executeTrade,
    hotkeyBindings.cancel,
    hotkeyBindings.preset1,
    hotkeyBindings.preset2,
    hotkeyBindings.preset3,
    hotkeyBindings.submit,
    open,
  ]);

  if (!intent) return null;
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[6px]"
      data-testid="trade-ticket-modal"
    >
      <button
        aria-label="Close trade ticket"
        className="absolute inset-0"
        onClick={cancelAndCloseModal}
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
            onClick={cancelAndCloseModal}
            type="button"
            aria-label="Close"
            aria-keyshortcuts={toAriaKeyShortcuts(hotkeyBindings.cancel)}
          >
            &times;
          </button>
        </div>

        <div className="p-6 space-y-4">
          <TradeIdentityCard intent={intent} walletAddress={walletAddress} />
          <SpotVenueSection
            venueOptions={spotVenueOptions}
            selectedVenueKey={selectedVenueKey}
            selectedVenue={selectedVenue}
            selectedVenueEnabled={selectedVenueEnabled}
            selectedVenueLiveExecutable={selectedVenueLiveExecutable}
            orderType={orderType}
            timeInForce={timeInForce}
            onVenueChange={setSelectedVenueKey}
          />
          <TradeRiskContextCard
            snapshot={riskSnapshot ?? null}
            preSubmitRisk={preSubmitRisk}
          />
          {riskAcknowledgement?.required ? (
            <DegenRiskAcknowledgeCard
              title={riskAcknowledgement.title}
              message={riskAcknowledgement.message}
              confirmationLabel={riskAcknowledgement.confirmationLabel}
              confirmed={riskConfirmed}
              onConfirmedChange={setRiskConfirmed}
            />
          ) : null}
          <TradeInputsSection
            amountUi={amountUi}
            amountPresets={amountPresets}
            inputSymbol={intent.inputSymbol}
            quantityMode={quantityMode}
            amountMinValue={intent.inputMinAmountUi}
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
          <ExecutionQualitySection
            lane={executionLane}
            simulationPreference={simulationPreference}
            priorityLevel={priorityLevel}
            priorityMicroLamports={priorityMicroLamports}
            slippageBps={resolvedSlippageBps}
            hint={executionQualityHint}
            validationErrors={executionQualityErrors}
            onLaneChange={setExecutionLane}
            onSimulationPreferenceChange={setSimulationPreference}
            onPriorityLevelChange={setPriorityLevel}
          />
          <AdvancedOrderConfigSection
            venue={selectedVenue}
            orderType={orderType}
            timeInForce={timeInForce}
            quantityMode={quantityMode}
            reduceOnly={reduceOnly}
            postOnly={postOnly}
            bracketEnabled={bracketEnabled}
            limitPriceUi={limitPriceUi}
            triggerPriceUi={triggerPriceUi}
            takeProfitPriceUi={takeProfitPriceUi}
            stopLossPriceUi={stopLossPriceUi}
            validationErrors={orderValidationErrors}
            onOrderTypeChange={setOrderType}
            onTimeInForceChange={setTimeInForce}
            onQuantityModeChange={setQuantityMode}
            onReduceOnlyChange={setReduceOnly}
            onPostOnlyChange={setPostOnly}
            onBracketEnabledChange={setBracketEnabled}
            onLimitPriceChange={setLimitPriceUi}
            onTriggerPriceChange={setTriggerPriceUi}
            onTakeProfitPriceChange={setTakeProfitPriceUi}
            onStopLossPriceChange={setStopLossPriceUi}
          />
          <QuoteSummaryCard
            direction={intent.direction}
            outputSymbol={intent.outputSymbol}
            inputDecimals={intent.inputDecimals}
            outputDecimals={intent.outputDecimals}
            quote={quote}
            referencePrice={referencePrice}
            loading={quote.status === "loading" || isQuoteTransitionPending}
          />

          {submitMessage ? (
            <p
              className={
                submitStatus === "error"
                  ? "text-red-400 text-xs"
                  : "text-muted text-xs"
              }
            >
              {submitMessage}
            </p>
          ) : null}
          {!selectedVenueEnabled ? (
            <p className="text-amber-300 text-xs">
              {selectedVenue?.label ?? "Selected venue"} is rollout-gated for
              this cohort.
            </p>
          ) : null}
          {selectedVenueEnabled && !selectedVenueLiveExecutable ? (
            <p className="text-amber-300 text-xs">
              {selectedVenue?.label ?? "Selected venue"} is preview-only in the
              current harness. Live terminal execution remains gated to{" "}
              {getTerminalVenueExecutionReadinessLabel(
                selectedVenue?.executionReadiness ?? "research",
              ).toLowerCase()}
              .
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              className={`${BTN_SECONDARY} !py-2 !px-4 text-xs`}
              onClick={cancelAndCloseModal}
              type="button"
              aria-keyshortcuts={toAriaKeyShortcuts(hotkeyBindings.cancel)}
            >
              Close
            </button>
            <button
              className={`${BTN_PRIMARY} !py-2 !px-4 text-xs min-w-[8.5rem]`}
              data-testid="trade-ticket-submit"
              onClick={() => void executeTrade()}
              type="button"
              disabled={!canExecuteTrade}
              aria-keyshortcuts={toAriaKeyShortcuts(hotkeyBindings.submit)}
            >
              {submitStatus === "submitting" || submitStatus === "tracking"
                ? submitStatus === "tracking"
                  ? "Tracking..."
                  : "Submitting..."
                : !selectedVenueEnabled
                  ? "Rollout Gated"
                  : !selectedVenueLiveExecutable
                    ? "Preview Only"
                    : `Execute ${intent.direction === "buy" ? "Buy" : "Sell"}`}
            </button>
          </div>
          <p className="text-[10px] text-muted text-right">
            {formatHotkeyChord(hotkeyBindings.submit)} submit •{" "}
            {formatHotkeyChord(hotkeyBindings.cancel)} cancel •{" "}
            {formatHotkeyChord(hotkeyBindings.preset1)}/
            {formatHotkeyChord(hotkeyBindings.preset2)}/
            {formatHotkeyChord(hotkeyBindings.preset3)} presets
          </p>
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
        <span className="font-mono">{intent.pairId}</span>
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

const SpotVenueSection = memo(function SpotVenueSection(props: {
  venueOptions: TerminalSpotVenueDefinition[];
  selectedVenueKey: TerminalVenueKey;
  selectedVenue: TerminalSpotVenueDefinition | null;
  selectedVenueEnabled: boolean;
  selectedVenueLiveExecutable: boolean;
  orderType: OrderType;
  timeInForce: TimeInForce;
  onVenueChange: (value: TerminalVenueKey) => void;
}) {
  const {
    venueOptions,
    selectedVenueKey,
    selectedVenue,
    selectedVenueEnabled,
    selectedVenueLiveExecutable,
    orderType,
    timeInForce,
    onVenueChange,
  } = props;

  return (
    <div className="rounded border border-border bg-subtle px-3 py-2 text-xs space-y-3">
      <p className="label">SPOT_VENUE_PATH</p>
      <div className="grid grid-cols-1 sm:grid-cols-[1.2fr_0.8fr_0.8fr] gap-2">
        <label className="space-y-1">
          <span className="text-muted text-[10px] uppercase tracking-wider">
            Venue
          </span>
          <select
            className="input-field !py-2 font-mono"
            data-testid="trade-ticket-venue-select"
            value={selectedVenueKey}
            onChange={(event) =>
              onVenueChange(event.target.value as TerminalVenueKey)
            }
          >
            {venueOptions.map((venue) => (
              <option key={venue.venueKey} value={venue.venueKey}>
                {venue.label}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded border border-border/60 bg-paper/70 px-2 py-1.5 text-[10px] text-muted">
          <p className="uppercase tracking-wider">Path</p>
          <p
            className="mt-1 font-mono text-ink"
            data-testid="trade-ticket-venue-path"
          >
            {selectedVenue?.executionPathLabel ?? "--"}
          </p>
        </div>
        <div className="rounded border border-border/60 bg-paper/70 px-2 py-1.5 text-[10px] text-muted">
          <p className="uppercase tracking-wider">Readiness</p>
          <p
            className="mt-1 font-mono text-ink"
            data-testid="trade-ticket-venue-readiness"
          >
            {selectedVenue
              ? getTerminalVenueExecutionReadinessLabel(
                  selectedVenue.executionReadiness,
                )
              : "--"}
          </p>
        </div>
      </div>
      {selectedVenue ? (
        <div className="rounded border border-border/60 bg-paper/70 px-2 py-1.5 text-[10px] text-muted space-y-0.5">
          <p>
            Orders:{" "}
            {selectedVenue.supportedOrderTypes
              .map((value) => getTerminalOrderTypeLabel(value) ?? value)
              .join(", ")}
          </p>
          <p>
            TIF:{" "}
            {selectedVenue.supportedTimeInForce
              .map((value) => getTerminalTimeInForceLabel(value) ?? value)
              .join(", ")}
          </p>
          <p>
            Current path:{" "}
            {(getTerminalOrderTypeLabel(orderType) ?? orderType).toUpperCase()}{" "}
            /{" "}
            {(
              getTerminalTimeInForceLabel(timeInForce) ?? timeInForce
            ).toUpperCase()}
          </p>
          <p>
            {selectedVenueEnabled
              ? selectedVenueLiveExecutable
                ? "This venue is eligible for live terminal execution."
                : "This venue is preview-only in the current harness."
              : "This venue is rollout-gated for the current cohort."}
          </p>
        </div>
      ) : null}
    </div>
  );
});

const TradeRiskContextCard = memo(function TradeRiskContextCard(props: {
  snapshot: AccountRiskSnapshot | null;
  preSubmitRisk: { blocked: boolean; message: string | null };
}) {
  const { snapshot, preSubmitRisk } = props;
  if (!snapshot) {
    return (
      <div className="rounded border border-border bg-subtle px-3 py-2 text-xs text-muted">
        Risk context unavailable.
      </div>
    );
  }

  const highlightClass =
    snapshot.liquidationRiskLevel === "critical" ||
    snapshot.concentrationLevel === "critical"
      ? "border-red-500/40 bg-red-500/10 text-red-200"
      : snapshot.liquidationRiskLevel === "warning" ||
          snapshot.concentrationLevel === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
        : "border-border bg-subtle text-ink";
  const formatNumber = (value: number | null, digits = 2): string =>
    value === null || !Number.isFinite(value) ? "--" : value.toFixed(digits);

  return (
    <div className={`rounded border px-3 py-2 text-xs ${highlightClass}`}>
      <p className="label">RISK_CONTEXT</p>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <p>
          Equity:{" "}
          <span className="font-mono">
            {formatNumber(snapshot.equityQuote)}
          </span>
        </p>
        <p className="text-right">
          Used margin:{" "}
          <span className="font-mono">
            {formatNumber(snapshot.usedMarginQuote)}
          </span>
        </p>
        <p>
          Maint ratio:{" "}
          <span className="font-mono">
            {formatNumber(snapshot.maintenanceRatio, 2)}x
          </span>
        </p>
        <p className="text-right">
          Liq buffer:{" "}
          <span className="font-mono">
            {formatNumber(snapshot.liquidationBufferPct, 2)}%
          </span>
        </p>
      </div>
      {preSubmitRisk.message ? (
        <p
          className={
            preSubmitRisk.blocked
              ? "mt-1.5 text-[11px] text-red-300"
              : "mt-1.5 text-[11px] text-amber-200"
          }
        >
          {preSubmitRisk.message}
        </p>
      ) : null}
    </div>
  );
});

const DegenRiskAcknowledgeCard = memo(function DegenRiskAcknowledgeCard(props: {
  title?: string;
  message?: string;
  confirmationLabel?: string;
  confirmed: boolean;
  onConfirmedChange: (next: boolean) => void;
}) {
  const { title, message, confirmationLabel, confirmed, onConfirmedChange } =
    props;
  return (
    <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
      <p className="label">{title ?? "DEGEN_RISK_ACKNOWLEDGEMENT"}</p>
      <p className="mt-1 text-[11px]">
        {message ??
          "This path is configured for high-volatility execution. Confirm risk posture before dispatch."}
      </p>
      <label className="mt-2 inline-flex items-center gap-1.5 text-[11px]">
        <input
          className="h-3.5 w-3.5 accent-red-500"
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.target.checked)}
        />
        <span>
          {confirmationLabel ??
            "I understand this is Degen mode and accept higher execution risk."}
        </span>
      </label>
    </div>
  );
});

const TradeInputsSection = memo(function TradeInputsSection(props: {
  amountUi: string;
  amountPresets: readonly string[];
  inputSymbol: string;
  quantityMode: QuantityMode;
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
    quantityMode,
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
            Amount ({quantityMode === "quote" ? inputSymbol : quantityMode})
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
            data-testid="trade-ticket-amount-input"
            inputMode="decimal"
            placeholder={amountPresets[1] ?? amountPresets[0] ?? "1"}
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
          data-testid="trade-ticket-slippage-input"
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

const ExecutionQualitySection = memo(function ExecutionQualitySection(props: {
  lane: ExecutionLane;
  simulationPreference: SimulationPreference;
  priorityLevel: PriorityLevel;
  priorityMicroLamports: number;
  slippageBps: number;
  hint: string;
  validationErrors: string[];
  onLaneChange: (value: ExecutionLane) => void;
  onSimulationPreferenceChange: (value: SimulationPreference) => void;
  onPriorityLevelChange: (value: PriorityLevel) => void;
}) {
  const {
    lane,
    simulationPreference,
    priorityLevel,
    priorityMicroLamports,
    slippageBps,
    hint,
    validationErrors,
    onLaneChange,
    onSimulationPreferenceChange,
    onPriorityLevelChange,
  } = props;
  return (
    <div className="rounded border border-border bg-subtle px-3 py-2 text-xs space-y-3">
      <p className="label">EXECUTION_QUALITY</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="text-muted text-[10px] uppercase tracking-wider">
            Lane
          </span>
          <select
            className="input-field !py-2 font-mono"
            value={lane}
            onChange={(event) =>
              onLaneChange(event.target.value as ExecutionLane)
            }
          >
            <option value="fast">fast</option>
            <option value="protected">protected</option>
            <option value="safe">safe</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-muted text-[10px] uppercase tracking-wider">
            Simulation
          </span>
          <select
            className="input-field !py-2 font-mono"
            value={simulationPreference}
            onChange={(event) =>
              onSimulationPreferenceChange(
                event.target.value as SimulationPreference,
              )
            }
          >
            <option value="auto">auto</option>
            <option value="always">always</option>
            <option value="never">never</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-muted text-[10px] uppercase tracking-wider">
            Priority
          </span>
          <select
            className="input-field !py-2 font-mono"
            value={priorityLevel}
            onChange={(event) =>
              onPriorityLevelChange(event.target.value as PriorityLevel)
            }
          >
            <option value="normal">normal</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </select>
        </label>
      </div>
      <div className="rounded border border-border/60 bg-paper/70 px-2 py-1.5 text-[10px] text-muted space-y-0.5">
        <p>Slippage: {slippageBps} bps</p>
        <p>
          Priority fee: {priorityMicroLamports.toLocaleString()} u-lamports/CU
        </p>
        <p>{hint}</p>
      </div>
      {validationErrors.length > 0 ? (
        <ul className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300 space-y-1">
          {validationErrors.map((error) => (
            <li key={error}>• {error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

const AdvancedOrderConfigSection = memo(
  function AdvancedOrderConfigSection(props: {
    venue: TerminalSpotVenueDefinition | null;
    orderType: OrderType;
    timeInForce: TimeInForce;
    quantityMode: QuantityMode;
    reduceOnly: boolean;
    postOnly: boolean;
    bracketEnabled: boolean;
    limitPriceUi: string;
    triggerPriceUi: string;
    takeProfitPriceUi: string;
    stopLossPriceUi: string;
    validationErrors: string[];
    onOrderTypeChange: (value: OrderType) => void;
    onTimeInForceChange: (value: TimeInForce) => void;
    onQuantityModeChange: (value: QuantityMode) => void;
    onReduceOnlyChange: (value: boolean) => void;
    onPostOnlyChange: (value: boolean) => void;
    onBracketEnabledChange: (value: boolean) => void;
    onLimitPriceChange: (value: string) => void;
    onTriggerPriceChange: (value: string) => void;
    onTakeProfitPriceChange: (value: string) => void;
    onStopLossPriceChange: (value: string) => void;
  }) {
    const {
      venue,
      orderType,
      timeInForce,
      quantityMode,
      reduceOnly,
      postOnly,
      bracketEnabled,
      limitPriceUi,
      triggerPriceUi,
      takeProfitPriceUi,
      stopLossPriceUi,
      validationErrors,
      onOrderTypeChange,
      onTimeInForceChange,
      onQuantityModeChange,
      onReduceOnlyChange,
      onPostOnlyChange,
      onBracketEnabledChange,
      onLimitPriceChange,
      onTriggerPriceChange,
      onTakeProfitPriceChange,
      onStopLossPriceChange,
    } = props;

    return (
      <div className="rounded border border-border bg-subtle px-3 py-2 text-xs space-y-3">
        <p className="label">ADVANCED_ORDER_CONFIG</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="space-y-1">
            <span className="text-muted text-[10px] uppercase tracking-wider">
              Order Type
            </span>
            <select
              className="input-field !py-2 font-mono"
              data-testid="trade-ticket-order-type"
              value={orderType}
              onChange={(event) =>
                onOrderTypeChange(event.target.value as OrderType)
              }
            >
              {(venue?.supportedOrderTypes ?? ["market"]).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-muted text-[10px] uppercase tracking-wider">
              Time In Force
            </span>
            <select
              className="input-field !py-2 font-mono"
              value={timeInForce}
              onChange={(event) =>
                onTimeInForceChange(event.target.value as TimeInForce)
              }
            >
              {(venue?.supportedTimeInForce ?? ["gtc"]).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-muted text-[10px] uppercase tracking-wider">
              Quantity Mode
            </span>
            <select
              className="input-field !py-2 font-mono"
              value={quantityMode}
              onChange={(event) =>
                onQuantityModeChange(event.target.value as QuantityMode)
              }
            >
              <option value="quote">quote</option>
              <option value="base">base</option>
              <option value="notional">notional</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
          <label className="flex items-center gap-2">
            <input
              checked={reduceOnly}
              onChange={(event) => onReduceOnlyChange(event.target.checked)}
              type="checkbox"
              disabled={!venue?.supportsReduceOnly}
            />
            <span>Reduce-only</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              checked={postOnly}
              onChange={(event) => onPostOnlyChange(event.target.checked)}
              type="checkbox"
              disabled={!venue?.supportsPostOnly}
            />
            <span>Post-only</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              checked={bracketEnabled}
              onChange={(event) => onBracketEnabledChange(event.target.checked)}
              type="checkbox"
              disabled={!venue?.supportsBracket}
            />
            <span>Bracket TP/SL</span>
          </label>
        </div>

        {orderType !== "market" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {orderType === "limit" ? (
              <label className="space-y-1">
                <span className="text-muted text-[10px] uppercase tracking-wider">
                  Limit Price
                </span>
                <input
                  className="input-field !py-2 font-mono"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={limitPriceUi}
                  onChange={(event) => onLimitPriceChange(event.target.value)}
                />
              </label>
            ) : null}
            {orderType === "trigger" ? (
              <label className="space-y-1">
                <span className="text-muted text-[10px] uppercase tracking-wider">
                  Trigger Price
                </span>
                <input
                  className="input-field !py-2 font-mono"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={triggerPriceUi}
                  onChange={(event) => onTriggerPriceChange(event.target.value)}
                />
              </label>
            ) : null}
          </div>
        ) : null}

        {bracketEnabled ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-muted text-[10px] uppercase tracking-wider">
                Take Profit
              </span>
              <input
                className="input-field !py-2 font-mono"
                inputMode="decimal"
                placeholder="0.00"
                value={takeProfitPriceUi}
                onChange={(event) =>
                  onTakeProfitPriceChange(event.target.value)
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted text-[10px] uppercase tracking-wider">
                Stop Loss
              </span>
              <input
                className="input-field !py-2 font-mono"
                inputMode="decimal"
                placeholder="0.00"
                value={stopLossPriceUi}
                onChange={(event) => onStopLossPriceChange(event.target.value)}
              />
            </label>
          </div>
        ) : null}

        <p className="text-[10px] text-muted">
          Quantity mode and order flags are mapped into the execution contract
          options for policy-aware routing.
        </p>

        {validationErrors.length > 0 ? (
          <ul className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300 space-y-1">
            {validationErrors.map((error) => (
              <li key={error}>• {error}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  },
);

const QuoteSummaryCard = memo(function QuoteSummaryCard(props: {
  direction: TradeIntent["direction"];
  outputSymbol: string;
  inputDecimals: number;
  outputDecimals: number;
  quote: QuoteState;
  referencePrice: number | null | undefined;
  loading: boolean;
}) {
  const {
    direction,
    outputSymbol,
    inputDecimals,
    outputDecimals,
    quote,
    referencePrice,
    loading,
  } = props;
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
  const impliedReference =
    typeof referencePrice === "number" &&
    Number.isFinite(referencePrice) &&
    referencePrice > 0
      ? referencePrice
      : null;
  const referenceDivergenceBps = computeQuoteReferenceDivergenceBps({
    direction,
    quotedInputAtomic: quote.inAmountAtomic,
    quotedOutputAtomic: quote.outAmountAtomic,
    inputDecimals,
    outputDecimals,
    referencePrice,
  });

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
        <span
          className="font-mono truncate max-w-[65%] text-right"
          data-testid="trade-ticket-quote-route"
        >
          {quote.route ?? "--"}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted">Reference</span>
        <span className="font-mono" data-testid="trade-ticket-quote-reference">
          {impliedReference === null ? "--" : impliedReference.toFixed(4)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted">Vs Ref</span>
        <span className="font-mono" data-testid="trade-ticket-quote-vs-ref">
          {referenceDivergenceBps === null
            ? "--"
            : `${referenceDivergenceBps >= 0 ? "+" : ""}${referenceDivergenceBps.toFixed(1)} bps`}
        </span>
      </div>
      <p aria-live="polite" className={statusClass}>
        {statusText}
      </p>
    </div>
  );
});
