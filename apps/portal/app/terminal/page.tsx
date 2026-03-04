"use client";

import { usePrivy } from "@privy-io/react-auth";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../cn";
import {
  type AccountWallet,
  apiFetchJson,
  type BalanceResponse,
  BTN_SECONDARY,
  isRecord,
} from "../lib";
import { PresenceCard } from "../motion";
import {
  clearDashboardGridLayouts,
  DashboardGrid,
  hasCustomDashboardGridLayouts,
} from "./components/dashboard-grid";
import { MacroEtfWidget } from "./components/macro-etf-widget";
import { MacroFredWidget } from "./components/macro-fred-widget";
import { MacroOilWidget } from "./components/macro-oil-widget";
import { MacroRadarWidget } from "./components/macro-radar-widget";
import { MacroStablecoinWidget } from "./components/macro-stablecoin-widget";
import { buildOrderbookLadder } from "./components/orderbook-ladder";
import {
  type RealtimeTradeTick,
  type TerminalRealtimeState,
  useTerminalRealtimeTransport,
} from "./components/realtime-transport";
import {
  formatAgeMs,
  formatPrice,
  type MarketState,
  useMarketFeed,
} from "./components/sol-market-feed";
import { createTradeIntent, type TradeIntent } from "./components/trade-intent";
import {
  DEFAULT_PAIR_ID,
  getPairConfig,
  type PairId,
  SUPPORTED_PAIRS,
  TOKEN_CONFIGS,
} from "./components/trade-pairs";
import type { TradeTicketCompletion } from "./components/trade-ticket-modal";
import {
  countMissingTradeTicks,
  filterTradeTicks,
  type TapeDisplayMode,
  type TapeSideFilter,
} from "./components/trades-tape";
import { useDashboard } from "./context";
import {
  getTerminalModeCapabilities,
  mergeProfileWithTerminalMode,
  modeAllowsAction,
  modeShowsModule,
  readLocalTerminalMode,
  readTerminalModeFromProfile,
  resolveDefaultTerminalMode,
  type TerminalMode,
  writeLocalTerminalMode,
} from "./terminal-modes";

type Balances = BalanceResponse;
type ExecutionActivityRow = {
  id: string;
  ts: number;
  pairId: PairId;
  leg: string;
  status: string;
  signature: string | null;
};

type LadderPrefill = {
  side: "buy" | "sell";
  price: number;
  size: number;
  seq: number;
  ts: number;
};

const FundingModal = dynamic(
  () => import("../funding-modal").then((mod) => mod.FundingModal),
  { ssr: false },
);

const TradeTicketModal = dynamic(
  () =>
    import("./components/trade-ticket-modal").then(
      (mod) => mod.TradeTicketModal,
    ),
  { ssr: false },
);

const MarketChart = dynamic<{
  className?: string;
  market: MarketState;
  pairLabel: string;
}>(() => import("./components/market-chart").then((mod) => mod.MarketChart), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500" />
    </div>
  ),
});

function toNumericString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  return null;
}

function parseAtomic(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function formatAtomicTokenBalance(
  atomicRaw: string | null | undefined,
  decimals: number,
  maxFractionDigits = 6,
): string {
  if (!atomicRaw || !/^\d+$/.test(atomicRaw)) return "0.00";
  try {
    const atomic = BigInt(atomicRaw);
    const safeDecimals = Math.max(0, Math.min(18, Math.floor(decimals)));
    const scale = BigInt(10) ** BigInt(safeDecimals);
    const whole = atomic / scale;
    if (safeDecimals === 0) return whole.toString();

    const fractionRaw = (atomic % scale).toString().padStart(safeDecimals, "0");
    const shownFraction = fractionRaw.slice(
      0,
      Math.min(safeDecimals, maxFractionDigits),
    );
    const trimmed = shownFraction.replace(/0+$/, "");
    if (trimmed.length > 0) return `${whole.toString()}.${trimmed}`;
    return `${whole.toString()}.00`;
  } catch {
    return "0.00";
  }
}

function parseAccountWallet(payload: unknown): AccountWallet | null {
  if (!isRecord(payload)) return null;
  const signerType = String(payload.signerType ?? "").trim();
  const privyWalletId = String(payload.privyWalletId ?? "").trim();
  const walletAddress = String(payload.walletAddress ?? "").trim();
  if (!signerType || !privyWalletId || !walletAddress) return null;
  return {
    signerType,
    privyWalletId,
    walletAddress,
    walletMigratedAt:
      typeof payload.walletMigratedAt === "string"
        ? payload.walletMigratedAt
        : null,
  };
}

function parseUserProfile(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  const user = isRecord(payload.user) ? payload.user : null;
  if (!user) return null;
  return isRecord(user.profile) ? user.profile : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export default function AppPage() {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <main>
        <div className="sticky top-0 z-10 bg-paper border-b border-border py-4">
          <div className="w-[min(1120px,92vw)] mx-auto flex items-center justify-between gap-4">
            <a href="/" className="text-sm font-semibold tracking-tight">
              Trader Ralph
            </a>
          </div>
        </div>
        <section className="py-[clamp(3rem,6vw,6rem)] border-t border-border">
          <div className="w-[min(1120px,92vw)] mx-auto">
            <h1>Control room</h1>
            <div className="card card-flat p-6 mt-8">
              <p className="label">Config</p>
              <h2 className="mt-2.5">Missing Privy app id</h2>
              <p className="text-muted mt-3.5">
                Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in{" "}
                <code>apps/portal/.env.local</code>.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return <ControlRoom />;
}

function ControlRoom() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const router = useRouter();

  const [wallet, setWallet] = useState<AccountWallet | null>(null);
  const [walletBalances, setWalletBalances] = useState<Balances | null>(null);
  const [tokenBalancesByMint, setTokenBalancesByMint] = useState<
    Record<string, string>
  >({});
  const [walletBalanceError, setWalletBalanceError] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeIntent, setTradeIntent] = useState<TradeIntent | null>(null);
  const [selectedPairId, setSelectedPairId] = useState<PairId>(DEFAULT_PAIR_ID);
  const [gridRevision, setGridRevision] = useState(0);
  const [hasCustomGridLayout, setHasCustomGridLayout] = useState(false);
  const [terminalMode, setTerminalMode] = useState<TerminalMode>(() =>
    resolveDefaultTerminalMode(process.env.NEXT_PUBLIC_TERMINAL_DEFAULT_MODE),
  );
  const [terminalModeSaving, setTerminalModeSaving] = useState(false);
  const [userProfile, setUserProfile] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [recentExecutions, setRecentExecutions] = useState<
    ExecutionActivityRow[]
  >([]);
  const [ladderPrefill, setLadderPrefill] = useState<LadderPrefill | null>(
    null,
  );
  const terminalModeRef = useRef<TerminalMode>(terminalMode);
  const fallbackModePersistControllerRef = useRef<AbortController | null>(null);
  const modeCapabilities = getTerminalModeCapabilities(terminalMode);
  const canQuickTrade = modeAllowsAction(terminalMode, "quick_trade");
  const canMacroTrade = modeAllowsAction(terminalMode, "macro_trade");
  const canLayoutEdit = modeAllowsAction(terminalMode, "layout_edit");
  const showMarketModule = modeShowsModule(terminalMode, "market");
  const showWalletModule = modeShowsModule(terminalMode, "wallet");
  const showMacroRadarModule = modeShowsModule(terminalMode, "macro_radar");
  const showMacroFredModule = modeShowsModule(terminalMode, "macro_fred");
  const showMacroEtfModule = modeShowsModule(terminalMode, "macro_etf");
  const showMacroStablecoinModule = modeShowsModule(
    terminalMode,
    "macro_stablecoin",
  );
  const showMacroOilModule = modeShowsModule(terminalMode, "macro_oil");

  useEffect(() => {
    terminalModeRef.current = terminalMode;
  }, [terminalMode]);

  useEffect(
    () => () => {
      fallbackModePersistControllerRef.current?.abort();
    },
    [],
  );

  const resetDashboardLayout = useCallback(() => {
    clearDashboardGridLayouts();
    setHasCustomGridLayout(false);
    setGridRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    setHasCustomGridLayout(hasCustomDashboardGridLayouts());
  }, []);

  const persistTerminalMode = useCallback(
    async (input: {
      mode: TerminalMode;
      profileSnapshot: Record<string, unknown> | null;
      source: "manual" | "local_fallback" | "default_fallback";
      previousMode: TerminalMode | null;
      emitTelemetry: boolean;
    }): Promise<Record<string, unknown> | null> => {
      if (!authenticated) return input.profileSnapshot;
      const token = await getAccessToken();
      if (!token) return input.profileSnapshot;

      if (input.source === "manual") {
        fallbackModePersistControllerRef.current?.abort();
        fallbackModePersistControllerRef.current = null;
      } else {
        fallbackModePersistControllerRef.current?.abort();
        fallbackModePersistControllerRef.current = new AbortController();
      }
      const signal = fallbackModePersistControllerRef.current?.signal;

      if (input.source !== "manual" && terminalModeRef.current !== input.mode) {
        return null;
      }

      let mergeBase = input.profileSnapshot;
      try {
        const latestPayload = await apiFetchJson("/api/me", token, {
          method: "GET",
          ...(signal ? { signal } : {}),
        });
        const latestProfile = parseUserProfile(latestPayload);
        if (latestProfile) mergeBase = latestProfile;
      } catch {
        if (signal?.aborted) return null;
      }

      if (input.source !== "manual" && terminalModeRef.current !== input.mode) {
        return null;
      }

      const mergedProfile = mergeProfileWithTerminalMode(mergeBase, {
        mode: input.mode,
        source: input.source,
      });
      await apiFetchJson("/api/me/profile", token, {
        method: "PATCH",
        body: JSON.stringify({
          profile: mergedProfile,
        }),
        ...(signal ? { signal } : {}),
      });
      if (signal?.aborted) return null;

      if (input.emitTelemetry) {
        await apiFetchJson("/api/events", token, {
          method: "POST",
          body: JSON.stringify({
            name: "terminal_mode_changed",
            properties: {
              from: input.previousMode,
              to: input.mode,
              source: input.source,
            },
          }),
        }).catch(() => {
          // Do not block UX on telemetry write failures.
        });
      }
      return mergedProfile;
    },
    [authenticated, getAccessToken],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!canLayoutEdit) return;
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== "r") return;
      event.preventDefault();
      resetDashboardLayout();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canLayoutEdit, resetDashboardLayout]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!authenticated) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const payload = await apiFetchJson("/api/me", token, { method: "GET" });

      const walletRaw = isRecord(payload) ? payload.wallet : null;
      setWallet(parseAccountWallet(walletRaw));
      const profile = parseUserProfile(payload);
      setUserProfile(profile);
      const serverMode = readTerminalModeFromProfile(profile);
      const localMode = readLocalTerminalMode();
      const defaultMode = resolveDefaultTerminalMode(
        process.env.NEXT_PUBLIC_TERMINAL_DEFAULT_MODE,
      );
      const resolvedMode = serverMode ?? localMode ?? defaultMode;
      setTerminalMode(resolvedMode);
      // Keep local fallback synced with chosen mode.
      writeLocalTerminalMode(resolvedMode);
      if (!serverMode) {
        const source = localMode ? "local_fallback" : "default_fallback";
        void persistTerminalMode({
          mode: resolvedMode,
          profileSnapshot: profile,
          source,
          previousMode: null,
          emitTelemetry: false,
        })
          .then((mergedProfile) => {
            if (mergedProfile) setUserProfile(mergedProfile);
          })
          .catch(() => {
            // Ignore fallback persistence failures.
          });
      }
      setLoaded(true);
    } catch (error) {
      setLoaded(true);
      setMessage(error instanceof Error ? error.message : "failed-to-load");
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken, persistTerminalMode]);

  const refreshWalletBalances = useCallback(async (): Promise<void> => {
    if (!authenticated || !wallet) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const payload = await apiFetchJson("/api/wallet/balance", token, {
        method: "GET",
      });
      const balancesRaw = isRecord(payload) ? payload.balances : null;
      const hasError =
        isRecord(payload) &&
        (Array.isArray(payload.errors) ||
          (typeof payload.errors === "string" && payload.errors.trim() !== ""));
      if (hasError) {
        const errorPayload = (payload as Record<string, unknown>).errors;
        if (typeof errorPayload === "string") {
          setWalletBalanceError(errorPayload);
        } else if (Array.isArray(errorPayload)) {
          setWalletBalanceError(
            errorPayload.map((item) => String(item)).join(", "),
          );
        } else {
          setWalletBalanceError("Invalid balance payload");
        }
        return;
      }

      if (
        isRecord(balancesRaw) &&
        isRecord(balancesRaw.sol) &&
        isRecord(balancesRaw.usdc)
      ) {
        const solLamports = toNumericString(
          (balancesRaw.sol as Record<string, unknown>).lamports,
        );
        const usdcAtomic = toNumericString(
          (balancesRaw.usdc as Record<string, unknown>).atomic,
        );
        setWalletBalances({
          sol: { lamports: solLamports ?? "0" },
          usdc: { atomic: usdcAtomic ?? "0" },
        });
        const nextTokenBalancesByMint: Record<string, string> = {
          [TOKEN_CONFIGS.SOL.mint]: solLamports ?? "0",
          [TOKEN_CONFIGS.USDC.mint]: usdcAtomic ?? "0",
        };
        if (Array.isArray(balancesRaw.tokens)) {
          for (const tokenRow of balancesRaw.tokens) {
            if (!isRecord(tokenRow)) continue;
            const mint = String(tokenRow.mint ?? "").trim();
            const atomic = toNumericString(tokenRow.atomic);
            if (!mint || atomic === null) continue;
            nextTokenBalancesByMint[mint] = atomic;
          }
        }
        setTokenBalancesByMint(nextTokenBalancesByMint);
        setWalletBalanceError(null);
        return;
      }
      setWalletBalanceError("Invalid balance payload");
    } catch {
      setWalletBalanceError("Failed to fetch wallet balance");
    }
  }, [authenticated, getAccessToken, wallet]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void refresh();
  }, [ready, authenticated, refresh]);

  useEffect(() => {
    if (!ready || authenticated) return;
    router.replace("/login");
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (!wallet) {
      setWalletBalances(null);
      setTokenBalancesByMint({});
      setWalletBalanceError(null);
      return;
    }
    void refreshWalletBalances();
  }, [wallet, refreshWalletBalances]);

  const hasWallet = wallet !== null;
  const selectedPair = getPairConfig(selectedPairId);
  const marketFeed = useMarketFeed(selectedPairId);
  const realtimeTransport = useTerminalRealtimeTransport({
    pairId: selectedPairId,
    walletAddress: wallet?.walletAddress ?? null,
    getAccessToken,
    fallbackPrice: marketFeed.latestPrice,
  });
  const handlePairChange = useCallback((nextPairId: PairId): void => {
    setSelectedPairId(nextPairId);
    setLadderPrefill(null);
  }, []);

  const openTradeTicket = useCallback(
    (intent: TradeIntent): void => {
      if (!hasWallet) {
        setMessage("wallet-unavailable");
        return;
      }
      setTradeIntent(intent);
      setTradeOpen(true);
    },
    [hasWallet],
  );

  const handleLadderPrefill = useCallback((nextPrefill: LadderPrefill) => {
    setLadderPrefill((current) => {
      if (
        current &&
        current.side === nextPrefill.side &&
        current.seq === nextPrefill.seq &&
        current.price === nextPrefill.price
      ) {
        return null;
      }
      return nextPrefill;
    });
  }, []);

  const clearLadderPrefill = useCallback(() => {
    setLadderPrefill(null);
  }, []);

  const buildActionReason = useCallback(
    (action: "buy" | "sell"): string => {
      const base =
        action === "buy"
          ? `Market action: buy ${selectedPair.baseSymbol}`
          : `Market action: reduce ${selectedPair.baseSymbol}`;
      if (!ladderPrefill) return base;
      const modeLabel = ladderPrefill.side === action ? "prefill" : "offset";
      return `${base} • ${modeLabel} ${ladderPrefill.price.toFixed(4)} x ${ladderPrefill.size.toFixed(2)}`;
    },
    [ladderPrefill, selectedPair.baseSymbol],
  );

  const openMarketBuyTrade = useCallback(() => {
    if (!canQuickTrade) return;
    openTradeTicket(
      createTradeIntent("buy", "MARKET_MONITOR", selectedPairId, {
        reason: buildActionReason("buy"),
      }),
    );
  }, [buildActionReason, canQuickTrade, openTradeTicket, selectedPairId]);

  const openMarketSellTrade = useCallback(() => {
    if (!canQuickTrade) return;
    openTradeTicket(
      createTradeIntent("sell", "MARKET_MONITOR", selectedPairId, {
        reason: buildActionReason("sell"),
      }),
    );
  }, [buildActionReason, canQuickTrade, openTradeTicket, selectedPairId]);

  const openFundingModal = useCallback(() => {
    setFundOpen(true);
  }, []);

  const handleTerminalModeChange = useCallback(
    (nextMode: TerminalMode): void => {
      if (nextMode === terminalMode) return;
      const previousMode = terminalMode;
      setTerminalMode(nextMode);
      writeLocalTerminalMode(nextMode);
      setTerminalModeSaving(true);
      void persistTerminalMode({
        mode: nextMode,
        profileSnapshot: userProfile,
        source: "manual",
        previousMode,
        emitTelemetry: true,
      })
        .then((mergedProfile) => {
          if (mergedProfile) setUserProfile(mergedProfile);
        })
        .catch(() => {
          // Keep local mode active even if server persistence fails.
        })
        .finally(() => {
          setTerminalModeSaving(false);
        });
    },
    [persistTerminalMode, terminalMode, userProfile],
  );

  const triggerRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const applyOptimisticTradeBalances = useCallback(
    (trade: TradeTicketCompletion): void => {
      const inAmount = parseAtomic(trade.inAmountAtomic);
      const outAmount = parseAtomic(trade.outAmountAtomic);
      if (inAmount === null || outAmount === null) return;

      setTokenBalancesByMint((current) => {
        const next = { ...current };
        const inputCurrent =
          parseAtomic(next[trade.inputMint] ?? "0") ?? BigInt(0);
        const outputCurrent =
          parseAtomic(next[trade.outputMint] ?? "0") ?? BigInt(0);
        const nextInput = inputCurrent - inAmount;
        next[trade.inputMint] = (
          nextInput > BigInt(0) ? nextInput : BigInt(0)
        ).toString();
        next[trade.outputMint] = (outputCurrent + outAmount).toString();
        return next;
      });

      setWalletBalances((current) => {
        if (!current) return current;

        let nextSol = parseAtomic(current.sol.lamports) ?? BigInt(0);
        let nextUsdc = parseAtomic(current.usdc.atomic) ?? BigInt(0);

        if (trade.inputMint === TOKEN_CONFIGS.SOL.mint) nextSol -= inAmount;
        if (trade.inputMint === TOKEN_CONFIGS.USDC.mint) nextUsdc -= inAmount;

        if (trade.outputMint === TOKEN_CONFIGS.SOL.mint) nextSol += outAmount;
        if (trade.outputMint === TOKEN_CONFIGS.USDC.mint) nextUsdc += outAmount;

        if (nextSol < BigInt(0)) nextSol = BigInt(0);
        if (nextUsdc < BigInt(0)) nextUsdc = BigInt(0);

        return {
          sol: { lamports: nextSol.toString() },
          usdc: { atomic: nextUsdc.toString() },
        };
      });
      setWalletBalanceError(null);
    },
    [],
  );

  const handleTradeComplete = useCallback(
    (trade: TradeTicketCompletion): void => {
      applyOptimisticTradeBalances(trade);
      setRecentExecutions((current) => {
        const entry: ExecutionActivityRow = {
          id: crypto.randomUUID(),
          ts: Date.now(),
          pairId: selectedPairId,
          leg: `${trade.inputSymbol} -> ${trade.outputSymbol}`,
          status: trade.status,
          signature: trade.signature,
        };
        return [entry, ...current].slice(0, 30);
      });
      void refreshWalletBalances();
    },
    [applyOptimisticTradeBalances, refreshWalletBalances, selectedPairId],
  );

  useEffect(() => {
    if (!wallet) return;
    const timer = window.setInterval(() => {
      void refreshWalletBalances();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [wallet, refreshWalletBalances]);

  const {
    setWalletBalances: setGlobalWalletBalances,
    setWalletBalanceError: setGlobalWalletBalanceError,
    setFundAction,
    setTerminalMode: setGlobalTerminalMode,
    setTerminalModeSaving: setGlobalTerminalModeSaving,
    setModeAction,
    setRefreshAction,
    setIsRefreshing,
    setShowFundButton,
    setShowBalance,
  } = useDashboard();

  useEffect(() => {
    if (wallet) {
      setGlobalWalletBalances(walletBalances);
      setGlobalWalletBalanceError(walletBalanceError);
    } else {
      setGlobalWalletBalances(null);
      setGlobalWalletBalanceError(null);
    }
    setFundAction(wallet ? openFundingModal : null);
    setGlobalTerminalMode(terminalMode);
    setGlobalTerminalModeSaving(terminalModeSaving);
    setModeAction(handleTerminalModeChange);
    setRefreshAction(triggerRefresh);
    setIsRefreshing(loading);
    setShowFundButton(Boolean(wallet));
    setShowBalance(true);

    return () => {
      setFundAction(null);
      setModeAction(null);
      setRefreshAction(null);
    };
  }, [
    wallet,
    walletBalances,
    walletBalanceError,
    loading,
    setGlobalWalletBalances,
    setGlobalWalletBalanceError,
    setFundAction,
    setGlobalTerminalMode,
    setGlobalTerminalModeSaving,
    setModeAction,
    setRefreshAction,
    setIsRefreshing,
    setShowFundButton,
    setShowBalance,
    openFundingModal,
    terminalMode,
    terminalModeSaving,
    handleTerminalModeChange,
    triggerRefresh,
  ]);

  return (
    <>
      {wallet && fundOpen ? (
        <FundingModal
          walletAddress={wallet.walletAddress}
          open
          onClose={() => setFundOpen(false)}
        />
      ) : null}
      {tradeOpen && tradeIntent ? (
        <TradeTicketModal
          open
          intent={tradeIntent}
          walletAddress={wallet?.walletAddress ?? null}
          tokenBalancesByMint={tokenBalancesByMint}
          getAccessToken={getAccessToken}
          onClose={() => setTradeOpen(false)}
          onTradeComplete={handleTradeComplete}
        />
      ) : null}

      <section className="flex-1 min-h-0 w-full">
        <div className="w-full h-full min-h-0">
          <PresenceCard show={Boolean(message)}>
            <div className="mb-4 rounded-md border-l-4 border-red-500 bg-red-500/10 p-3 text-sm text-red-400">
              {message}
            </div>
          </PresenceCard>

          {!ready || !loaded ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-accent" />
            </div>
          ) : (
            <div className="relative h-full">
              <div className="pointer-events-none absolute left-2 top-2 z-20 hidden sm:block">
                <div
                  className="rounded border border-border/70 bg-paper/90 px-2.5 py-1 text-[11px] text-muted backdrop-blur"
                  title={modeCapabilities.description}
                >
                  Mode:{" "}
                  <span className="font-semibold text-ink">
                    {modeCapabilities.label}
                  </span>
                </div>
              </div>
              {hasCustomGridLayout && canLayoutEdit && (
                <div className="pointer-events-none absolute right-2 top-2 z-20">
                  <button
                    className={cn(
                      BTN_SECONDARY,
                      "pointer-events-auto h-7 border-border/70 bg-paper/90 px-2.5 text-[11px] backdrop-blur",
                    )}
                    onClick={resetDashboardLayout}
                    title="Reorganize layout (R)"
                    type="button"
                  >
                    Reset layout
                  </button>
                </div>
              )}

              <DashboardGrid
                key={gridRevision}
                className="w-full h-full border border-border bg-border pb-1"
                allowLayoutEditing={canLayoutEdit}
                onLayoutChange={() =>
                  setHasCustomGridLayout(hasCustomDashboardGridLayouts())
                }
              >
                {showMarketModule ? (
                  <div
                    key="chart"
                    className="flex flex-col overflow-hidden bg-surface"
                  >
                    <ChartPanel
                      pairId={selectedPairId}
                      market={marketFeed}
                      onPairChange={handlePairChange}
                    />
                  </div>
                ) : null}

                {showMarketModule ? (
                  <div
                    key="orderbook"
                    className="flex flex-col overflow-hidden bg-surface"
                  >
                    <OrderbookDepthPanel
                      market={marketFeed}
                      realtime={realtimeTransport}
                      selectedPrefill={ladderPrefill}
                      onPrefill={handleLadderPrefill}
                    />
                  </div>
                ) : null}

                {showMarketModule ? (
                  <div
                    key="order_entry"
                    className="flex flex-col overflow-hidden bg-surface"
                  >
                    <OrderEntryPanel
                      pairId={selectedPairId}
                      onBuy={openMarketBuyTrade}
                      onSell={openMarketSellTrade}
                      tradingEnabled={canQuickTrade}
                      prefill={ladderPrefill}
                      onClearPrefill={clearLadderPrefill}
                    />
                  </div>
                ) : null}

                {showMarketModule ? (
                  <div
                    key="trades_tape"
                    className="flex flex-col overflow-hidden bg-surface"
                  >
                    <TradesTapePanel realtime={realtimeTransport} />
                  </div>
                ) : null}

                {showMarketModule ? (
                  <div
                    key="positions"
                    className="flex flex-col overflow-hidden bg-surface"
                  >
                    <PositionsOrdersFillsPanel entries={recentExecutions} />
                  </div>
                ) : null}

                {showWalletModule ? (
                  <div
                    key="account_risk"
                    className="flex flex-col overflow-hidden bg-surface"
                  >
                    <AccountRiskPanel
                      pairId={selectedPairId}
                      tokenBalancesByMint={tokenBalancesByMint}
                      market={marketFeed}
                      realtime={realtimeTransport}
                    />
                  </div>
                ) : null}

                {showMacroRadarModule ? (
                  <div key="macro_radar" className="overflow-hidden">
                    <MacroRadarWidget
                      onTradeAction={
                        canMacroTrade ? openTradeTicket : undefined
                      }
                    />
                  </div>
                ) : null}
                {showMacroFredModule ? (
                  <div key="macro_fred" className="overflow-hidden">
                    <MacroFredWidget />
                  </div>
                ) : null}
                {showMacroEtfModule ? (
                  <div key="macro_etf" className="overflow-hidden">
                    <MacroEtfWidget />
                  </div>
                ) : null}
                {showMacroStablecoinModule ? (
                  <div key="macro_stablecoin" className="overflow-hidden">
                    <MacroStablecoinWidget
                      onTradeAction={
                        canMacroTrade ? openTradeTicket : undefined
                      }
                    />
                  </div>
                ) : null}
                {showMacroOilModule ? (
                  <div key="macro_oil" className="overflow-hidden">
                    <MacroOilWidget />
                  </div>
                ) : null}
              </DashboardGrid>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

const ChartPanel = memo(function ChartPanel(props: {
  pairId: PairId;
  market: MarketState;
  onPairChange: (pairId: PairId) => void;
}) {
  const { pairId, market, onPairChange } = props;
  const pair = getPairConfig(pairId);
  const pairLabel = `${pair.baseSymbol}/${pair.quoteSymbol}`;
  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label flex items-center gap-2 dashboard-drag-handle cursor-move select-none">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          CHART
        </p>
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
          <select
            className="h-6 rounded border border-border bg-paper px-2 text-[10px] text-muted uppercase tracking-wider"
            value={pairId}
            onChange={(event) => onPairChange(event.target.value as PairId)}
            title="Select pair"
          >
            {SUPPORTED_PAIRS.map((pairOption) => (
              <option key={pairOption.id} value={pairOption.id}>
                {pairOption.id}
              </option>
            ))}
          </select>
          <span
            className={cn(
              "tabular-nums",
              (market.change24hPct ?? 0) >= 0
                ? "text-emerald-400"
                : "text-red-400",
            )}
          >
            {formatPrice(market.latestPrice)} {pair.quoteSymbol}
          </span>
        </div>
      </div>
      <div className="flex-1 relative bg-[var(--color-chart-bg)]">
        <MarketChart
          className="opacity-80"
          market={market}
          pairLabel={pairLabel}
        />
      </div>
    </>
  );
});

function formatTransportBadge(realtime: TerminalRealtimeState): string {
  if (realtime.mode === "poll") {
    return realtime.isStale ? "poll stale" : "poll fallback";
  }
  if (realtime.health === "connecting") return "stream connecting";
  if (realtime.isStale) return "stream stale";
  return "stream live";
}

const OrderbookDepthPanel = memo(function OrderbookDepthPanel(props: {
  market: MarketState;
  realtime: TerminalRealtimeState;
  selectedPrefill: LadderPrefill | null;
  onPrefill: (prefill: LadderPrefill) => void;
}) {
  const { market, realtime, selectedPrefill, onPrefill } = props;
  const [groupingBps, setGroupingBps] = useState(5);
  const lastPrice = market.latestPrice ?? null;
  const depth = realtime.depth;
  const asks = depth?.asks ?? [];
  const bids = depth?.bids ?? [];
  const hasRealtimeDepth = Boolean(
    depth && depth.asks.length > 0 && depth.bids.length > 0,
  );
  const fallbackBasePrice =
    Number.isFinite(lastPrice) && (lastPrice ?? 0) > 0
      ? (lastPrice as number)
      : null;
  const fallbackLevels = [0.05, 0.1, 0.15, 0.2, 0.25];
  const fallbackAsks =
    fallbackBasePrice === null
      ? []
      : fallbackLevels.map((pct, index) => ({
          price: fallbackBasePrice * (1 + pct / 100),
          size: 80 + index * 25,
        }));
  const fallbackBids =
    fallbackBasePrice === null
      ? []
      : fallbackLevels.map((pct, index) => ({
          price: fallbackBasePrice * (1 - pct / 100),
          size: 75 + index * 22,
        }));
  const renderedAsks = hasRealtimeDepth ? asks : fallbackAsks;
  const renderedBids = hasRealtimeDepth ? bids : fallbackBids;
  const ladder = useMemo(
    () =>
      buildOrderbookLadder({
        asks: renderedAsks,
        bids: renderedBids,
        groupingBps,
        maxRows: 10,
      }),
    [groupingBps, renderedAsks, renderedBids],
  );
  const statusLabel = formatTransportBadge(realtime);
  const spreadLabel =
    ladder.spreadAbs === null || ladder.spreadBps === null
      ? "--"
      : `${ladder.spreadAbs.toFixed(4)} (${ladder.spreadBps.toFixed(2)} bps)`;
  const groupingOptions = [2, 5, 10, 25];

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          ORDERBOOK_DEPTH
        </p>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
              realtime.mode === "poll"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : realtime.isStale
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
            )}
          >
            {statusLabel}
          </span>
          <span className="text-[10px] font-mono text-muted">
            {formatAgeMs(realtime.lastEventMs ?? market.lastUpdatedMs)}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 text-[11px] font-mono">
        <div className="mb-2 flex items-center justify-between rounded border border-border/60 bg-subtle px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted">
            spread {spreadLabel}
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted">
              group
            </span>
            <select
              className="h-6 rounded border border-border bg-paper px-1.5 text-[10px] uppercase tracking-wider text-muted"
              value={groupingBps}
              onChange={(event) => setGroupingBps(Number(event.target.value))}
              title="Group levels"
            >
              {groupingOptions.map((option) => (
                <option key={option} value={option}>
                  {option} bps
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-2 px-1 pb-1 text-[10px] uppercase tracking-wider text-muted">
          <span>Side</span>
          <span>Price</span>
          <span>Size</span>
          <span>Cum</span>
        </div>
        <div className="space-y-1">
          {ladder.asks.length === 0 && ladder.bids.length === 0 ? (
            <p className="rounded border border-border/50 bg-subtle px-2 py-2 text-muted">
              Waiting for market depth...
            </p>
          ) : null}
          {ladder.asks.map((row) => {
            const nextPrefillSide = "buy";
            const sourceSeq = depth?.seq ?? 0;
            const active =
              selectedPrefill?.side === nextPrefillSide &&
              selectedPrefill.price === row.price &&
              selectedPrefill.seq === sourceSeq;
            return (
              <button
                key={`ask-${row.price}`}
                className={cn(
                  "grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded border px-2 py-1 text-left transition-colors",
                  "border-red-500/20 bg-red-500/5 hover:bg-red-500/10",
                  active && "border-red-400 bg-red-500/15",
                )}
                onClick={() =>
                  onPrefill({
                    side: nextPrefillSide,
                    price: row.price,
                    size: row.size,
                    seq: sourceSeq,
                    ts: depth?.ts ?? Date.now(),
                  })
                }
                type="button"
              >
                <span className="text-[10px] uppercase text-red-300">
                  ask {row.isTopOfBook ? "*" : ""}
                </span>
                <span className="text-red-300">{row.price.toFixed(4)}</span>
                <span className="text-muted">{row.size.toFixed(2)}</span>
                <span className="text-muted">
                  {row.cumulativeSize.toFixed(2)}
                </span>
              </button>
            );
          })}

          {ladder.bestAsk && ladder.bestBid ? (
            <div className="rounded border border-border/70 bg-paper/80 px-2 py-1 text-center text-[10px] uppercase tracking-wider text-muted">
              top: bid {ladder.bestBid.price.toFixed(4)} / ask{" "}
              {ladder.bestAsk.price.toFixed(4)}
            </div>
          ) : null}

          {ladder.bids.map((row) => {
            const nextPrefillSide = "sell";
            const sourceSeq = depth?.seq ?? 0;
            const active =
              selectedPrefill?.side === nextPrefillSide &&
              selectedPrefill.price === row.price &&
              selectedPrefill.seq === sourceSeq;
            return (
              <button
                key={`bid-${row.price}`}
                className={cn(
                  "grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded border px-2 py-1 text-left transition-colors",
                  "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10",
                  active && "border-emerald-400 bg-emerald-500/15",
                )}
                onClick={() =>
                  onPrefill({
                    side: nextPrefillSide,
                    price: row.price,
                    size: row.size,
                    seq: sourceSeq,
                    ts: depth?.ts ?? Date.now(),
                  })
                }
                type="button"
              >
                <span className="text-[10px] uppercase text-emerald-300">
                  bid {row.isTopOfBook ? "*" : ""}
                </span>
                <span className="text-emerald-300">{row.price.toFixed(4)}</span>
                <span className="text-muted">{row.size.toFixed(2)}</span>
                <span className="text-muted">
                  {row.cumulativeSize.toFixed(2)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
});

const OrderEntryPanel = memo(function OrderEntryPanel(props: {
  pairId: PairId;
  onBuy: () => void;
  onSell: () => void;
  tradingEnabled: boolean;
  prefill: LadderPrefill | null;
  onClearPrefill: () => void;
}) {
  const { pairId, onBuy, onSell, tradingEnabled, prefill, onClearPrefill } =
    props;
  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          ORDER_ENTRY
        </p>
        <span className="text-[10px] font-mono text-emerald-400">{pairId}</span>
      </div>
      <div className="flex-1 p-3 text-xs space-y-3">
        <div className="rounded border border-border bg-subtle p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted">
            Execution
          </p>
          <p className="mt-1 font-mono text-sm text-ink">Market • IOC</p>
          <p className="text-[10px] text-muted">Routing: fast lane default</p>
          {prefill ? (
            <div className="mt-2 rounded border border-border/70 bg-paper/80 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted">
                Prefill
              </p>
              <p className="mt-1 font-mono text-[11px] text-ink">
                {prefill.side.toUpperCase()} {prefill.price.toFixed(4)} x{" "}
                {prefill.size.toFixed(2)}
              </p>
              <button
                className={cn(
                  BTN_SECONDARY,
                  "mt-2 h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                )}
                onClick={onClearPrefill}
                type="button"
              >
                Clear prefill
              </button>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-2">
          <button
            className={cn(
              BTN_SECONDARY,
              "!h-8 !rounded !text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
              !tradingEnabled && "opacity-60 pointer-events-none",
            )}
            onClick={onBuy}
            type="button"
            disabled={!tradingEnabled}
          >
            Buy / Lift
          </button>
          <button
            className={cn(
              BTN_SECONDARY,
              "!h-8 !rounded !text-xs bg-red-500/10 border-red-500/30 text-red-300",
              !tradingEnabled && "opacity-60 pointer-events-none",
            )}
            onClick={onSell}
            type="button"
            disabled={!tradingEnabled}
          >
            Sell / Hit
          </button>
        </div>
      </div>
    </>
  );
});

const TradesTapePanel = memo(function TradesTapePanel(props: {
  realtime: TerminalRealtimeState;
}) {
  const { realtime } = props;
  const [paused, setPaused] = useState(false);
  const [sideFilter, setSideFilter] = useState<TapeSideFilter>("all");
  const [minSize, setMinSize] = useState(0);
  const [displayMode, setDisplayMode] = useState<TapeDisplayMode>("compact");
  const [displayedTrades, setDisplayedTrades] = useState<RealtimeTradeTick[]>(
    () => realtime.trades.slice(0, 80),
  );
  const [bufferedCount, setBufferedCount] = useState(0);
  const latestHeadSeqRef = useRef<number | null>(
    realtime.trades[0]?.seq ?? null,
  );

  useEffect(() => {
    const currentHeadSeq = realtime.trades[0]?.seq ?? null;
    const previousHeadSeq = latestHeadSeqRef.current;
    latestHeadSeqRef.current = currentHeadSeq;

    if (paused) {
      if (
        currentHeadSeq !== null &&
        previousHeadSeq !== null &&
        currentHeadSeq > previousHeadSeq
      ) {
        setBufferedCount((count) => count + (currentHeadSeq - previousHeadSeq));
      }
      return;
    }

    setDisplayedTrades(realtime.trades.slice(0, 80));
    setBufferedCount(0);
  }, [paused, realtime.trades]);

  const filteredTrades = useMemo(
    () =>
      filterTradeTicks({
        trades: displayedTrades,
        side: sideFilter,
        minSize,
        mode: displayMode,
      }),
    [displayMode, displayedTrades, minSize, sideFilter],
  );
  const missedCount = useMemo(
    () => countMissingTradeTicks(displayedTrades),
    [displayedTrades],
  );

  const togglePaused = useCallback(() => {
    setPaused((current) => {
      const next = !current;
      if (!next) {
        setDisplayedTrades(realtime.trades.slice(0, 80));
        setBufferedCount(0);
      }
      return next;
    });
  }, [realtime.trades]);

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          TRADES_TAPE
        </p>
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          <button
            className={cn(
              BTN_SECONDARY,
              "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
              paused && "border-amber-500/40 bg-amber-500/10 text-amber-300",
            )}
            onClick={togglePaused}
            type="button"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 uppercase tracking-wider",
              realtime.mode === "poll"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : realtime.isStale
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
            )}
          >
            {realtime.mode === "poll" ? "fallback" : "stream"}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 text-xs space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select
            className="h-7 rounded border border-border bg-paper px-2 text-[10px] uppercase tracking-wider text-muted"
            value={sideFilter}
            onChange={(event) =>
              setSideFilter(event.target.value as TapeSideFilter)
            }
            title="Filter side"
          >
            <option value="all">All sides</option>
            <option value="buy">Buys</option>
            <option value="sell">Sells</option>
          </select>
          <select
            className="h-7 rounded border border-border bg-paper px-2 text-[10px] uppercase tracking-wider text-muted"
            value={String(minSize)}
            onChange={(event) => setMinSize(Number(event.target.value))}
            title="Minimum size"
          >
            <option value="0">Min size 0</option>
            <option value="10">Min size 10</option>
            <option value="20">Min size 20</option>
            <option value="30">Min size 30</option>
          </select>
        </div>
        <div className="flex items-center justify-between rounded border border-border/60 bg-subtle px-2 py-1.5">
          <div className="flex items-center gap-2 text-[10px] text-muted uppercase tracking-wider">
            <span>{displayedTrades.length} cached</span>
            {bufferedCount > 0 ? <span>{bufferedCount} buffered</span> : null}
            {missedCount > 0 ? <span>{missedCount} missed</span> : null}
          </div>
          <button
            className={cn(
              BTN_SECONDARY,
              "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
            )}
            onClick={() =>
              setDisplayMode((current) =>
                current === "compact" ? "expanded" : "compact",
              )
            }
            type="button"
          >
            {displayMode === "compact" ? "Expanded" : "Compact"}
          </button>
        </div>
        <div className="space-y-1">
          {filteredTrades.length === 0 ? (
            <p className="rounded border border-border/50 bg-subtle px-2 py-2 text-muted">
              No trades matching current tape filters.
            </p>
          ) : null}
          {filteredTrades.map((trade) => (
            <div
              key={`tape-${trade.seq}`}
              className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded border border-border/60 px-2 py-1"
            >
              <p
                className={cn(
                  "text-[10px] uppercase",
                  trade.side === "buy" ? "text-emerald-300" : "text-red-300",
                )}
              >
                {trade.side}
              </p>
              <p className="font-mono text-[11px] text-ink">
                {trade.price.toFixed(4)}
              </p>
              <p className="text-[10px] text-muted">{trade.size.toFixed(2)}</p>
              {displayMode === "expanded" ? (
                <p className="text-[10px] text-muted">
                  {new Date(trade.ts).toLocaleTimeString()}
                </p>
              ) : (
                <p className="text-[10px] text-muted">#{trade.seq}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
});

const PositionsOrdersFillsPanel = memo(
  function PositionsOrdersFillsPanel(props: {
    entries: ExecutionActivityRow[];
  }) {
    const { entries } = props;
    return (
      <>
        <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
          <p className="label dashboard-drag-handle cursor-move select-none">
            POSITIONS_ORDERS_FILLS
          </p>
          <span className="text-[10px] font-mono text-muted">
            {entries.length} recent
          </span>
        </div>
        <div className="flex-1 overflow-auto p-3 text-xs space-y-3">
          <div className="rounded border border-border bg-subtle p-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">
              Open Positions
            </p>
            <p className="mt-1 text-muted">
              Position netting is not enabled yet for this lane.
            </p>
          </div>
          <div className="rounded border border-border bg-subtle p-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">
              Recent Activity
            </p>
            <div className="mt-2 space-y-1.5">
              {entries.length === 0 ? (
                <p className="text-muted">No fills yet in this session.</p>
              ) : null}
              {entries.slice(0, 8).map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-[1fr_auto] gap-2 rounded border border-border/60 px-2 py-1"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] text-ink truncate">
                      {entry.pairId} • {entry.leg}
                    </p>
                    <p className="text-[10px] text-muted">
                      {new Date(entry.ts).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase text-muted">
                      {entry.status}
                    </p>
                    <p className="text-[10px] text-muted">
                      {entry.signature ? "landed" : "tracking"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  },
);

const AccountRiskPanel = memo(function AccountRiskPanel(props: {
  pairId: PairId;
  tokenBalancesByMint: Record<string, string>;
  market: MarketState;
  realtime: TerminalRealtimeState;
}) {
  const { pairId, tokenBalancesByMint, market, realtime } = props;
  const pair = getPairConfig(pairId);
  const baseToken = TOKEN_CONFIGS[pair.baseSymbol];
  const quoteToken = TOKEN_CONFIGS[pair.quoteSymbol];
  const baseAtomic = tokenBalancesByMint[baseToken.mint] ?? "0";
  const quoteAtomic = tokenBalancesByMint[quoteToken.mint] ?? "0";
  const baseDisplay = formatAtomicTokenBalance(baseAtomic, baseToken.decimals);
  const quoteDisplay = formatAtomicTokenBalance(
    quoteAtomic,
    quoteToken.decimals,
  );
  const baseQty = Number(baseDisplay);
  const riskExposure =
    Number.isFinite(baseQty) && Number.isFinite(market.latestPrice ?? NaN)
      ? baseQty * Number(market.latestPrice)
      : null;
  const change24h = market.change24hPct ?? null;

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          ACCOUNT_RISK
        </p>
        <span className="text-[10px] font-mono text-emerald-400">{pairId}</span>
      </div>
      <div className="flex-1 overflow-auto p-3 text-xs space-y-2">
        <div className="rounded border border-border bg-subtle px-2 py-1.5">
          <p className="text-[10px] text-muted uppercase tracking-wider">
            Transport
          </p>
          <p className="mt-1 font-mono text-ink">
            {formatTransportBadge(realtime)}
          </p>
          <p className="text-[10px] text-muted">
            Last event: {formatAgeMs(realtime.lastEventMs)}
          </p>
        </div>
        <div className="rounded border border-border bg-subtle px-2 py-1.5">
          <p className="text-[10px] text-muted uppercase tracking-wider">
            Balances
          </p>
          <p className="mt-1 font-mono text-ink">
            {baseDisplay} {baseToken.symbol}
          </p>
          <p className="font-mono text-ink">
            {quoteDisplay} {quoteToken.symbol}
          </p>
          {realtime.account ? (
            <p className="text-[10px] text-muted">
              Stream snapshot seq {realtime.account.seq}
            </p>
          ) : null}
        </div>
        <div className="rounded border border-border bg-subtle px-2 py-1.5">
          <p className="text-[10px] text-muted uppercase tracking-wider">
            Risk
          </p>
          <p className="mt-1 font-mono text-ink">
            Exposure:{" "}
            {riskExposure === null || !Number.isFinite(riskExposure)
              ? "--"
              : `${riskExposure.toFixed(2)} ${quoteToken.symbol}`}
          </p>
          <p
            className={cn(
              "font-mono",
              change24h === null
                ? "text-muted"
                : change24h >= 0
                  ? "text-emerald-300"
                  : "text-red-300",
            )}
          >
            24h change: {change24h === null ? "--" : `${change24h.toFixed(2)}%`}
          </p>
        </div>
      </div>
    </>
  );
});
