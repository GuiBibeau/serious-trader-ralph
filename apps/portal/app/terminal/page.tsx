"use client";

import { usePrivy } from "@privy-io/react-auth";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useState } from "react";
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
import {
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
import { useDashboard } from "./context";

type Balances = BalanceResponse;

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

  const resetDashboardLayout = useCallback(() => {
    clearDashboardGridLayouts();
    setHasCustomGridLayout(false);
    setGridRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    setHasCustomGridLayout(hasCustomDashboardGridLayouts());
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
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
  }, [resetDashboardLayout]);

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
      setLoaded(true);
    } catch (error) {
      setLoaded(true);
      setMessage(error instanceof Error ? error.message : "failed-to-load");
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken]);

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

  const openMarketBuyTrade = useCallback(() => {
    openTradeTicket(
      createTradeIntent("buy", "MARKET_MONITOR", selectedPairId, {
        reason: `Market action: buy ${selectedPair.baseSymbol}`,
      }),
    );
  }, [openTradeTicket, selectedPair.baseSymbol, selectedPairId]);

  const openMarketSellTrade = useCallback(() => {
    openTradeTicket(
      createTradeIntent("sell", "MARKET_MONITOR", selectedPairId, {
        reason: `Market action: reduce ${selectedPair.baseSymbol}`,
      }),
    );
  }, [openTradeTicket, selectedPair.baseSymbol, selectedPairId]);

  const openFundingModal = useCallback(() => {
    setFundOpen(true);
  }, []);

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
      void refreshWalletBalances();
    },
    [applyOptimisticTradeBalances, refreshWalletBalances],
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
    setRefreshAction(triggerRefresh);
    setIsRefreshing(loading);
    setShowFundButton(Boolean(wallet));
    setShowBalance(true);

    return () => {
      setFundAction(null);
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
    setRefreshAction,
    setIsRefreshing,
    setShowFundButton,
    setShowBalance,
    openFundingModal,
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
              {hasCustomGridLayout && (
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
                onLayoutChange={() =>
                  setHasCustomGridLayout(hasCustomDashboardGridLayouts())
                }
              >
                <div
                  key="market"
                  className="flex flex-col overflow-hidden bg-surface"
                >
                  <MarketMonitorCard
                    pairId={selectedPairId}
                    onPairChange={setSelectedPairId}
                    onBuy={openMarketBuyTrade}
                    onSell={openMarketSellTrade}
                  />
                </div>

                <div
                  key="wallet"
                  className="flex flex-col overflow-hidden bg-surface"
                >
                  <WalletMonitorCard
                    pairId={selectedPairId}
                    tokenBalancesByMint={tokenBalancesByMint}
                  />
                </div>

                <div key="macro_radar" className="overflow-hidden">
                  <MacroRadarWidget onTradeAction={openTradeTicket} />
                </div>
                <div key="macro_fred" className="overflow-hidden">
                  <MacroFredWidget />
                </div>
                <div key="macro_etf" className="overflow-hidden">
                  <MacroEtfWidget />
                </div>
                <div key="macro_stablecoin" className="overflow-hidden">
                  <MacroStablecoinWidget onTradeAction={openTradeTicket} />
                </div>
                <div key="macro_oil" className="overflow-hidden">
                  <MacroOilWidget />
                </div>
              </DashboardGrid>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

const MarketMonitorCard = memo(function MarketMonitorCard(props: {
  pairId: PairId;
  onPairChange: (pairId: PairId) => void;
  onBuy: () => void;
  onSell: () => void;
}) {
  const { pairId, onPairChange, onBuy, onSell } = props;
  const pair = getPairConfig(pairId);
  const marketFeed = useMarketFeed(pairId);
  const pairLabel = `${pair.baseSymbol}/${pair.quoteSymbol}`;
  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label flex items-center gap-2 dashboard-drag-handle cursor-move select-none">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          MARKET_MONITOR
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
              (marketFeed.change24hPct ?? 0) >= 0
                ? "text-emerald-400"
                : "text-red-400",
            )}
          >
            {formatPrice(marketFeed.latestPrice)} {pair.quoteSymbol}
          </span>
          <button
            className={cn(
              BTN_SECONDARY,
              "!h-6 !px-2 !py-0 text-[10px] !rounded",
            )}
            onClick={onBuy}
            type="button"
          >
            Buy
          </button>
          <button
            className={cn(
              BTN_SECONDARY,
              "!h-6 !px-2 !py-0 text-[10px] !rounded",
            )}
            onClick={onSell}
            type="button"
          >
            Sell
          </button>
        </div>
      </div>
      <div className="flex-1 relative bg-[var(--color-chart-bg)]">
        <MarketChart
          className="opacity-80"
          market={marketFeed}
          pairLabel={pairLabel}
        />
      </div>
    </>
  );
});

const WalletMonitorCard = memo(function WalletMonitorCard(props: {
  pairId: PairId;
  tokenBalancesByMint: Record<string, string>;
}) {
  const { pairId, tokenBalancesByMint } = props;
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

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label text-[10px] text-muted dashboard-drag-handle cursor-move select-none">
          WALLET_MONITOR
        </p>
        <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-mono">
          {pair.id}
        </span>
      </div>
      <div className="flex-1 p-4 grid grid-cols-2 gap-4 place-content-center">
        <div className="space-y-1">
          <p className="text-[10px] text-muted uppercase tracking-wider">
            {baseToken.symbol} Balance
          </p>
          <p className="text-2xl font-mono font-medium text-ink">
            {baseDisplay}
            <span className="text-sm text-muted ml-1 font-sans">
              {baseToken.symbol}
            </span>
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-muted uppercase tracking-wider">
            {quoteToken.symbol} Balance
          </p>
          <p className="text-2xl font-mono font-medium text-ink">
            {quoteDisplay}
            <span className="text-sm text-muted ml-1 font-sans">
              {quoteToken.symbol}
            </span>
          </p>
        </div>
      </div>
    </>
  );
});
