"use client";

import { useEffect, useRef, useState } from "react";
import { apiBase, apiFetchJson, isRecord } from "../../lib";
import {
  getPairConfig,
  marketQuoteAmountAtomic,
  type PairId,
  TOKEN_CONFIGS,
} from "./trade-pairs";

const BEARER_RE = /^bearer\s+/i;
const STREAM_PATH = "/api/terminal/stream";
const STREAM_RETRY_LIMIT = 2;
const STREAM_BOOT_TIMEOUT_MS = 1_800;
const STREAM_RETRY_BASE_MS = 700;
const POLL_INTERVAL_MS = 2_500;
const ACCOUNT_REFRESH_MS = 15_000;
const STREAM_STALE_MS = 8_000;
const POLL_STALE_MS = 12_000;
const MAX_TRADE_TICKS = 120;
const DEPTH_LEVELS = [0.03, 0.06, 0.1, 0.14, 0.2];

export type TransportMode = "stream" | "poll";
export type TransportHealth = "connecting" | "live" | "degraded" | "stale";

export type RealtimeDepthLevel = {
  price: number;
  size: number;
};

export type RealtimeDepthSnapshot = {
  seq: number;
  ts: number;
  asks: RealtimeDepthLevel[];
  bids: RealtimeDepthLevel[];
};

export type RealtimeTradeTick = {
  seq: number;
  ts: number;
  side: "buy" | "sell";
  price: number;
  size: number;
};

export type RealtimeAccountSnapshot = {
  seq: number;
  ts: number;
  solLamports: string;
  usdcAtomic: string;
};

export type TerminalRealtimeState = {
  mode: TransportMode;
  health: TransportHealth;
  reason: string | null;
  lastEventMs: number | null;
  staleForMs: number | null;
  isStale: boolean;
  depth: RealtimeDepthSnapshot | null;
  trades: RealtimeTradeTick[];
  account: RealtimeAccountSnapshot | null;
};

type TransportFrame = {
  seq: number;
  ts: number;
  price: number;
  source: TransportMode;
  account: RealtimeAccountSnapshot | null;
};

type ParsedStreamFrame = {
  seq: number;
  ts: number;
  price: number;
};

export function hasSequenceGap(
  previousSeq: number | null,
  nextSeq: number,
): boolean {
  return previousSeq !== null && nextSeq !== previousSeq + 1;
}

export function appendTradeTick(
  current: RealtimeTradeTick[],
  incoming: RealtimeTradeTick,
  max = MAX_TRADE_TICKS,
): RealtimeTradeTick[] {
  const next = [incoming, ...current];
  if (next.length <= max) return next;
  return next.slice(0, max);
}

export function buildDepthSnapshotFromPrice(
  price: number,
  seq: number,
  ts: number,
): RealtimeDepthSnapshot {
  const asks = DEPTH_LEVELS.map((pct, index) => {
    const deterministicSkew = ((seq + index * 13) % 7) - 3;
    return {
      price: price * (1 + pct / 100),
      size: Math.max(1, 55 + index * 19 + deterministicSkew * 4),
    };
  });
  const bids = DEPTH_LEVELS.map((pct, index) => {
    const deterministicSkew = ((seq + index * 11) % 7) - 3;
    return {
      price: price * (1 - pct / 100),
      size: Math.max(1, 50 + index * 17 + deterministicSkew * 3),
    };
  });
  return { seq, ts, asks, bids };
}

function buildTradeTickFromPrice(
  price: number,
  seq: number,
  ts: number,
): RealtimeTradeTick {
  const side: "buy" | "sell" = seq % 2 === 0 ? "buy" : "sell";
  const microDriftPct = (((seq % 9) - 4) * 0.4) / 100;
  const nextPrice = Math.max(0.0000001, price * (1 + microDriftPct));
  const size = 8 + ((seq * 7) % 33);
  return {
    seq,
    ts,
    side,
    price: nextPrice,
    size,
  };
}

function parseDecimalFromAtomic(raw: string, decimals: number): number | null {
  const digits = String(raw ?? "").trim();
  if (!/^\d+$/.test(digits)) return null;
  try {
    const value = BigInt(digits);
    const scale = 10 ** decimals;
    const out = Number(value) / scale;
    if (!Number.isFinite(out) || out <= 0) return null;
    return out;
  } catch {
    return null;
  }
}

function resolveWsUrl(pairId: PairId): string | null {
  const explicit = String(process.env.NEXT_PUBLIC_TERMINAL_STREAM_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (explicit) {
    const delimiter = explicit.includes("?") ? "&" : "?";
    return `${explicit}${delimiter}pair=${encodeURIComponent(pairId)}`;
  }
  const base = apiBase();
  if (!base) return null;
  try {
    const parsed = new URL(base);
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    parsed.pathname = STREAM_PATH;
    parsed.search = `pair=${encodeURIComponent(pairId)}`;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function parseTerminalStreamFrame(
  value: unknown,
): ParsedStreamFrame | null {
  if (!isRecord(value)) return null;
  const seq = Number(value.seq);
  const ts = Number(value.ts);
  const price = Number(value.price);
  if (
    !Number.isFinite(seq) ||
    !Number.isFinite(ts) ||
    !Number.isFinite(price)
  ) {
    return null;
  }
  if (seq < 1 || ts < 1 || price <= 0) return null;
  return {
    seq: Math.floor(seq),
    ts: Math.floor(ts),
    price,
  };
}

function parseAccountSnapshot(
  value: unknown,
  seq: number,
  ts: number,
): RealtimeAccountSnapshot | null {
  if (!isRecord(value) || !isRecord(value.balances)) return null;
  const balances = value.balances;
  const sol = isRecord(balances.sol) ? balances.sol : null;
  const usdc = isRecord(balances.usdc) ? balances.usdc : null;
  if (!sol || !usdc) return null;
  const solLamports = String(sol.lamports ?? "").trim();
  const usdcAtomic = String(usdc.atomic ?? "").trim();
  if (!/^\d+$/.test(solLamports) || !/^\d+$/.test(usdcAtomic)) return null;
  return {
    seq,
    ts,
    solLamports,
    usdcAtomic,
  };
}

async function buildPortalX402Headers(
  getAccessToken: () => Promise<string | null>,
  paymentSignature: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "payment-signature": paymentSignature,
  };
  try {
    const rawToken = String((await getAccessToken()) ?? "").trim();
    if (rawToken) {
      headers.authorization = BEARER_RE.test(rawToken)
        ? rawToken
        : `Bearer ${rawToken}`;
    }
  } catch {
    // Keep request unauthenticated for public routes.
  }
  return headers;
}

async function fetchQuotePrice(
  pairId: PairId,
  getAccessToken: () => Promise<string | null>,
): Promise<number | null> {
  const base = apiBase();
  if (!base) return null;

  const pair = getPairConfig(pairId);
  const inputMint = TOKEN_CONFIGS[pair.baseSymbol].mint;
  const outputMint = TOKEN_CONFIGS[pair.quoteSymbol].mint;
  const quoteDecimals = TOKEN_CONFIGS[pair.quoteSymbol].decimals;
  const headers = await buildPortalX402Headers(
    getAccessToken,
    "terminal-realtime-transport",
  );

  const response = await fetch(`${base}/api/x402/read/market_jupiter_quote`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      inputMint,
      outputMint,
      amount: marketQuoteAmountAtomic(pairId),
      slippageBps: 50,
    }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok || !isRecord(payload) || !isRecord(payload.quote)) {
    return null;
  }
  const outAmount = String(payload.quote.outAmount ?? "");
  return parseDecimalFromAtomic(outAmount, quoteDecimals);
}

async function fetchAccount(
  getAccessToken: () => Promise<string | null>,
  seq: number,
  ts: number,
): Promise<RealtimeAccountSnapshot | null> {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const payload = await apiFetchJson("/api/wallet/balance", token, {
      method: "GET",
    });
    return parseAccountSnapshot(payload, seq, ts);
  } catch {
    return null;
  }
}

function nextHealth(
  mode: TransportMode,
  isStale: boolean,
  hasEvent: boolean,
): TransportHealth {
  if (!hasEvent && mode === "stream") return "connecting";
  if (isStale) return "stale";
  if (mode === "poll") return "degraded";
  return "live";
}

export function useTerminalRealtimeTransport(input: {
  pairId: PairId;
  walletAddress: string | null;
  getAccessToken: () => Promise<string | null>;
  fallbackPrice: number | null;
}): TerminalRealtimeState {
  const { pairId, walletAddress, getAccessToken, fallbackPrice } = input;
  const [state, setState] = useState<TerminalRealtimeState>({
    mode: "stream",
    health: "connecting",
    reason: null,
    lastEventMs: null,
    staleForMs: null,
    isStale: false,
    depth: null,
    trades: [],
    account: null,
  });

  const mountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const staleTimerRef = useRef<number | null>(null);
  const frameQueueRef = useRef<TransportFrame[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastSeqRef = useRef<number | null>(null);
  const nextSeqRef = useRef(1);
  const lastAccountFetchRef = useRef(0);
  const fallbackPriceRef = useRef<number | null>(fallbackPrice);
  const reconnectAttemptRef = useRef(0);
  const pollingActiveRef = useRef(false);

  useEffect(() => {
    fallbackPriceRef.current = fallbackPrice;
  }, [fallbackPrice]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    setState({
      mode: "stream",
      health: "connecting",
      reason: null,
      lastEventMs: null,
      staleForMs: null,
      isStale: false,
      depth: null,
      trades: [],
      account: null,
    });
    reconnectAttemptRef.current = 0;
    lastSeqRef.current = null;
    nextSeqRef.current = 1;
    lastAccountFetchRef.current = 0;
    pollingActiveRef.current = false;
    frameQueueRef.current = [];

    const stopAllTimers = (): void => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (staleTimerRef.current !== null) {
        window.clearInterval(staleTimerRef.current);
        staleTimerRef.current = null;
      }
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };

    const applyFrame = (
      frame: TransportFrame,
      options?: { skipGapCheck?: boolean },
    ): void => {
      if (cancelled || !mountedRef.current) return;
      if (
        !options?.skipGapCheck &&
        hasSequenceGap(lastSeqRef.current, frame.seq)
      ) {
        void resyncFromPolling("sequence-gap-detected");
        return;
      }
      lastSeqRef.current = frame.seq;
      const depth = buildDepthSnapshotFromPrice(
        frame.price,
        frame.seq,
        frame.ts,
      );
      const tradeTick = buildTradeTickFromPrice(
        frame.price,
        frame.seq,
        frame.ts,
      );

      setState((current) => {
        const staleThreshold =
          frame.source === "stream" ? STREAM_STALE_MS : POLL_STALE_MS;
        const staleForMs = Date.now() - frame.ts;
        const isStale = staleForMs > staleThreshold;
        const mode = frame.source;
        const health = nextHealth(mode, isStale, true);
        const reason =
          mode === "poll"
            ? (current.reason ?? "stream-fallback-active")
            : current.reason;
        return {
          ...current,
          mode,
          health,
          reason,
          lastEventMs: frame.ts,
          staleForMs,
          isStale,
          depth,
          trades: appendTradeTick(current.trades, tradeTick),
          account: frame.account ?? current.account,
        };
      });
    };

    const processQueuedFrames = (): void => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        if (cancelled || !mountedRef.current) return;
        const frame = frameQueueRef.current.shift();
        if (!frame) return;
        applyFrame(frame);
        if (frameQueueRef.current.length > 0) {
          processQueuedFrames();
        }
      });
    };

    const enqueueFrame = (frame: TransportFrame): void => {
      frameQueueRef.current.push(frame);
      processQueuedFrames();
    };

    const fetchAndBuildFrame = async (
      source: TransportMode,
      options?: { forceAccount?: boolean },
    ): Promise<TransportFrame | null> => {
      const ts = Date.now();
      const seq = nextSeqRef.current;
      const accountDue =
        Boolean(walletAddress) &&
        (options?.forceAccount ||
          ts - lastAccountFetchRef.current >= ACCOUNT_REFRESH_MS);

      const [priceMaybe, accountMaybe] = await Promise.all([
        fetchQuotePrice(pairId, getAccessToken).catch(() => null),
        accountDue
          ? fetchAccount(getAccessToken, seq, ts).catch(() => null)
          : Promise.resolve<RealtimeAccountSnapshot | null>(null),
      ]);
      const price = priceMaybe ?? fallbackPriceRef.current;
      if (priceMaybe !== null) {
        fallbackPriceRef.current = priceMaybe;
      }
      if (price === null || !Number.isFinite(price) || price <= 0) {
        return null;
      }
      if (accountMaybe) {
        lastAccountFetchRef.current = ts;
      }
      nextSeqRef.current += 1;
      return {
        seq,
        ts,
        price,
        source,
        account: accountMaybe,
      };
    };

    const resyncFromPolling = async (reason: string): Promise<void> => {
      if (cancelled || !mountedRef.current) return;
      const frame = await fetchAndBuildFrame("poll", { forceAccount: true });
      if (!frame || cancelled || !mountedRef.current) {
        setState((current) => ({
          ...current,
          mode: "poll",
          reason,
          health: current.lastEventMs ? current.health : "stale",
        }));
        return;
      }
      setState((current) => ({
        ...current,
        mode: "poll",
        health: current.lastEventMs ? "degraded" : current.health,
        reason,
      }));
      applyFrame(frame, { skipGapCheck: true });
    };

    const startPollingFallback = (reason: string): void => {
      if (cancelled || pollingActiveRef.current) return;
      pollingActiveRef.current = true;
      setState((current) => ({
        ...current,
        mode: "poll",
        health: current.lastEventMs ? "degraded" : current.health,
        reason,
      }));

      const pollTick = async (): Promise<void> => {
        const frame = await fetchAndBuildFrame("poll");
        if (!frame || cancelled || !mountedRef.current) return;
        enqueueFrame(frame);
      };

      void pollTick();
      pollTimerRef.current = window.setInterval(() => {
        void pollTick();
      }, POLL_INTERVAL_MS);
    };

    const connectStream = (): void => {
      if (cancelled) return;
      const streamUrl = resolveWsUrl(pairId);
      if (!streamUrl) {
        startPollingFallback("stream-url-unavailable");
        return;
      }

      setState((current) => ({
        ...current,
        mode: "stream",
        health: "connecting",
      }));

      const socket = new WebSocket(streamUrl);
      wsRef.current = socket;
      const bootTimer = window.setTimeout(() => {
        socket.close();
      }, STREAM_BOOT_TIMEOUT_MS);

      socket.addEventListener("open", () => {
        window.clearTimeout(bootTimer);
        reconnectAttemptRef.current = 0;
      });

      socket.addEventListener("message", (event) => {
        const payloadRaw = String(event.data ?? "").trim();
        if (!payloadRaw) return;
        let decoded: unknown = null;
        try {
          decoded = JSON.parse(payloadRaw) as unknown;
        } catch {
          return;
        }
        const parsedPayload = parseTerminalStreamFrame(decoded);
        if (!parsedPayload) return;
        enqueueFrame({
          seq: parsedPayload.seq,
          ts: parsedPayload.ts,
          price: parsedPayload.price,
          source: "stream",
          account: null,
        });
      });

      socket.addEventListener("error", () => {
        socket.close();
      });

      socket.addEventListener("close", () => {
        window.clearTimeout(bootTimer);
        if (cancelled) return;
        reconnectAttemptRef.current += 1;
        if (reconnectAttemptRef.current <= STREAM_RETRY_LIMIT) {
          const delay = STREAM_RETRY_BASE_MS * reconnectAttemptRef.current;
          window.setTimeout(connectStream, delay);
          return;
        }
        startPollingFallback("stream-unavailable");
      });
    };

    connectStream();
    void resyncFromPolling("initial-resync");

    staleTimerRef.current = window.setInterval(() => {
      setState((current) => {
        const staleForMs = current.lastEventMs
          ? Date.now() - current.lastEventMs
          : null;
        const staleThreshold =
          current.mode === "stream" ? STREAM_STALE_MS : POLL_STALE_MS;
        const isStale =
          staleForMs !== null &&
          Number.isFinite(staleForMs) &&
          staleForMs > staleThreshold;
        const health = nextHealth(
          current.mode,
          isStale,
          current.lastEventMs !== null,
        );
        if (
          current.staleForMs === staleForMs &&
          current.isStale === isStale &&
          current.health === health
        ) {
          return current;
        }
        return {
          ...current,
          staleForMs,
          isStale,
          health,
        };
      });
    }, 1_000);

    return () => {
      cancelled = true;
      stopAllTimers();
    };
  }, [getAccessToken, pairId, walletAddress]);

  return state;
}
