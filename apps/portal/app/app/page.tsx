"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../cn";
import { FundingModal } from "../funding-modal";
import {
  ApiError,
  apiFetchJson,
  type BalanceResponse,
  type Bot,
  BTN_PRIMARY,
  BTN_SECONDARY,
  formatSolBalanceDisplay,
  formatUsdcBalanceDisplay,
  isRecord,
} from "../lib";
import { PresenceCard } from "../motion";
import { AgentStats } from "./components/agent-stats";
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
import { MarketChart } from "./components/market-chart";
import { formatPrice, useSolMarketFeed } from "./components/sol-market-feed";
import { useDashboard } from "./context";

type Subscription = {
  status: "active" | "inactive";
  active: boolean;
  planId: string | null;
  planName: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  sourceSignature: string | null;
};

type OnboardingStatus = "being_onboarded" | "active";

type BotCreationLimits = {
  maxFreeBots: number;
  requiredUsdForExtraBots: string;
  currentUsd: string;
  canCreateExtraBot: boolean;
  assetBasis: string;
  valuationState: "skipped" | "computed" | "unavailable";
};

type InferenceProviderView = {
  providerKind: string;
  baseUrl: string;
  model: string;
  configured: boolean;
  apiKeyMasked: string | null;
  updatedAt: string | null;
};

type Balances = BalanceResponse;
type CenterView = "candles" | "execution";

type CreateBotForm = {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

const DEFAULT_PROVIDER_BASE_URL = "https://api.z.ai/api/paas/v4";
const DEFAULT_PROVIDER_MODEL = "glm-5";

function toNumericString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  return null;
}

function formatUsdLabel(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toFixed(2);
}

function parseOnboardingStatus(raw: unknown): OnboardingStatus {
  return raw === "active" ? "active" : "being_onboarded";
}

function parseBotCreationLimits(payload: unknown): BotCreationLimits | null {
  if (!isRecord(payload)) return null;
  const maxFreeBots = Number(payload.maxFreeBots);
  const requiredUsdForExtraBots = String(payload.requiredUsdForExtraBots ?? "");
  const currentUsd = String(payload.currentUsd ?? "0.00");
  const canCreateExtraBot = Boolean(payload.canCreateExtraBot);
  const assetBasis = String(payload.assetBasis ?? "sol_usdc_only");
  const valuationStateRaw = String(payload.valuationState ?? "unavailable");
  const valuationState: BotCreationLimits["valuationState"] =
    valuationStateRaw === "computed" || valuationStateRaw === "skipped"
      ? valuationStateRaw
      : "unavailable";

  if (!Number.isFinite(maxFreeBots) || maxFreeBots <= 0) {
    return null;
  }
  if (!requiredUsdForExtraBots) return null;

  return {
    maxFreeBots,
    requiredUsdForExtraBots,
    currentUsd,
    canCreateExtraBot,
    assetBasis,
    valuationState,
  };
}

function parseInferenceProvider(
  payload: unknown,
): InferenceProviderView | null {
  if (!isRecord(payload)) return null;
  const provider = isRecord(payload.provider) ? payload.provider : payload;
  if (!isRecord(provider)) return null;

  return {
    providerKind: String(provider.providerKind ?? "openai_compatible"),
    baseUrl: String(provider.baseUrl ?? ""),
    model: String(provider.model ?? ""),
    configured: Boolean(provider.configured),
    apiKeyMasked:
      typeof provider.apiKeyMasked === "string" ? provider.apiKeyMasked : null,
    updatedAt:
      typeof provider.updatedAt === "string" ? provider.updatedAt : null,
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

  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>("");
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [onboardingStatus, setOnboardingStatus] =
    useState<OnboardingStatus>("being_onboarded");
  const [botLimits, setBotLimits] = useState<BotCreationLimits | null>(null);
  const [inferenceProvider, setInferenceProvider] =
    useState<InferenceProviderView | null>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [botsLoaded, setBotsLoaded] = useState(false);
  const [_centerView, _setCenterView] = useState<CenterView>("candles");
  const [gridRevision, setGridRevision] = useState(0);
  const [hasCustomGridLayout, setHasCustomGridLayout] = useState(false);

  const [fundOpen, setFundOpen] = useState(false);
  const [walletBalances, setWalletBalances] = useState<Balances | null>(null);
  const [walletBalanceError, setWalletBalanceError] = useState<string | null>(
    null,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateBotForm>({
    name: "",
    baseUrl: DEFAULT_PROVIDER_BASE_URL,
    model: DEFAULT_PROVIDER_MODEL,
    apiKey: "",
  });

  const selectedBot = useMemo(
    () => bots.find((item) => item.id === selectedBotId) ?? bots[0] ?? null,
    [bots, selectedBotId],
  );
  const marketFeed = useSolMarketFeed();
  const selectedBotInferenceConfigured = Boolean(inferenceProvider?.configured);

  const hasManualAccess = Boolean(subscription?.active);
  const capBlocked = Boolean(
    botLimits &&
      bots.length >= botLimits.maxFreeBots &&
      !botLimits.canCreateExtraBot,
  );

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

      const nextBotsRaw = isRecord(payload) ? payload.bots : null;
      const nextBots = Array.isArray(nextBotsRaw) ? (nextBotsRaw as Bot[]) : [];
      setBots(nextBots);
      setBotsLoaded(true);

      setSelectedBotId((current) => {
        if (current && nextBots.some((bot) => bot.id === current))
          return current;
        return nextBots[0]?.id ?? "";
      });

      const nextStatus = parseOnboardingStatus(
        isRecord(payload) ? payload.onboardingStatus : undefined,
      );
      setOnboardingStatus(nextStatus);

      const subRaw = isRecord(payload) ? payload.subscription : null;
      if (
        isRecord(subRaw) &&
        (subRaw.status === "active" || subRaw.status === "inactive")
      ) {
        setSubscription(subRaw as unknown as Subscription);
      } else {
        setSubscription(null);
      }

      const limitsRaw =
        isRecord(payload) &&
        isRecord(payload.limits) &&
        isRecord(payload.limits.botCreation)
          ? payload.limits.botCreation
          : null;
      setBotLimits(parseBotCreationLimits(limitsRaw));
    } catch (error) {
      const nextError =
        error instanceof Error ? error.message : "Failed to load control room";
      setBotsLoaded(true);
      setMessage(nextError);
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken]);

  const refreshWalletBalances = useCallback(
    async (botId: string): Promise<void> => {
      if (!authenticated || !botId) return;
      try {
        const token = await getAccessToken();
        if (!token) return;
        const payload = await apiFetchJson(
          `/api/bots/${botId}/balance`,
          token,
          {
            method: "GET",
          },
        );
        const balancesRaw = isRecord(payload) ? payload.balances : null;
        const hasError =
          isRecord(payload) &&
          (Array.isArray(payload.errors) ||
            (typeof payload.errors === "string" &&
              payload.errors.trim() !== ""));

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
          setWalletBalanceError(null);
          return;
        }

        setWalletBalanceError("Invalid balance payload");
      } catch {
        setWalletBalanceError("Failed to fetch wallet balance");
      }
    },
    [authenticated, getAccessToken],
  );

  const refreshInferenceProvider = useCallback(
    async (botId: string): Promise<void> => {
      if (!authenticated || !botId) return;
      try {
        const token = await getAccessToken();
        if (!token) return;
        const payload = await apiFetchJson(
          `/api/bots/${botId}/inference`,
          token,
          {
            method: "GET",
          },
        );
        setInferenceProvider(parseInferenceProvider(payload));
      } catch {
        setInferenceProvider(null);
      }
    },
    [authenticated, getAccessToken],
  );

  useEffect(() => {
    if (!ready || !authenticated) return;
    void refresh();
  }, [ready, authenticated, refresh]);

  useEffect(() => {
    if (!ready || authenticated) return;
    router.replace("/");
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (!selectedBot) {
      setWalletBalances(null);
      setWalletBalanceError(null);
      setInferenceProvider(null);
      return;
    }

    void Promise.all([
      refreshWalletBalances(selectedBot.id),
      refreshInferenceProvider(selectedBot.id),
    ]);
  }, [selectedBot, refreshInferenceProvider, refreshWalletBalances]);

  useEffect(() => {
    if (!selectedBot) return;
    const timer = window.setInterval(() => {
      void refreshWalletBalances(selectedBot.id);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [selectedBot, refreshWalletBalances]);

  async function startBot(botId: string): Promise<void> {
    if (!hasManualAccess) return;
    if (!selectedBotInferenceConfigured) {
      setMessage("Configure inference provider before starting this bot.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${botId}/start`, token, { method: "POST" });
      await refresh();
    } catch (err) {
      const nextMessage = err instanceof Error ? err.message : String(err);
      setMessage(
        nextMessage === "inference-provider-not-configured"
          ? "Configure inference provider before starting this bot."
          : nextMessage,
      );
    } finally {
      setLoading(false);
    }
  }

  async function stopBot(botId: string): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${botId}/stop`, token, { method: "POST" });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function _tickBot(botId: string): Promise<void> {
    if (!hasManualAccess) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${botId}/tick`, token, { method: "POST" });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function createBot(): Promise<void> {
    if (!authenticated) return;
    if (!createForm.name.trim()) {
      setCreateError("Bot name is required.");
      return;
    }
    if (
      !createForm.baseUrl.trim() ||
      !createForm.model.trim() ||
      !createForm.apiKey.trim()
    ) {
      setCreateError("Inference provider fields are required.");
      return;
    }
    if (capBlocked && botLimits) {
      setCreateError(
        `Bot cap reached. Current baseline value is $${formatUsdLabel(botLimits.currentUsd)}; need at least $${formatUsdLabel(botLimits.requiredUsdForExtraBots)}.`,
      );
      return;
    }

    setCreateBusy(true);
    setCreateError(null);
    setMessage(null);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const payload = await apiFetchJson("/api/bots", token, {
        method: "POST",
        body: JSON.stringify({
          name: createForm.name.trim(),
          provider: {
            providerKind: "openai_compatible",
            baseUrl: createForm.baseUrl.trim(),
            model: createForm.model.trim(),
            apiKey: createForm.apiKey.trim(),
          },
        }),
      });

      const createdBotId =
        isRecord(payload) &&
        isRecord(payload.bot) &&
        typeof payload.bot.id === "string"
          ? payload.bot.id
          : "";

      await refresh();
      if (createdBotId) {
        setSelectedBotId(createdBotId);
      }
      setCreateOpen(false);
      setCreateForm((current) => ({
        ...current,
        name: "",
        apiKey: "",
      }));
      setMessage("Bot created.");
    } catch (error) {
      if (error instanceof ApiError) {
        if (
          error.message === "bot-cap-threshold-not-met" &&
          isRecord(error.data)
        ) {
          const requiredUsd = String(error.data.requiredUsd ?? "5000");
          const currentUsd = String(error.data.currentUsd ?? "0.00");
          setCreateError(
            `Cannot create another bot yet. Current baseline value: $${formatUsdLabel(currentUsd)}; required: $${formatUsdLabel(requiredUsd)} (SOL + USDC across oldest 3 bots).`,
          );
          await refresh();
          return;
        }
        if (error.message === "inference-provider-ping-timeout") {
          setCreateError(
            "Inference provider test timed out. Check endpoint and network.",
          );
          return;
        }
        if (
          error.message === "inference-encryption-key-missing" ||
          error.message === "invalid-inference-encryption-key"
        ) {
          setCreateError("Server-side inference encryption is not configured.");
          return;
        }
        if (error.message.startsWith("inference-provider-ping-failed")) {
          setCreateError(
            "Inference provider test failed. Verify endpoint, model, and API key.",
          );
          return;
        }
        setCreateError(error.message);
        return;
      }
      setCreateError(
        error instanceof Error ? error.message : "Failed to create bot",
      );
    } finally {
      setCreateBusy(false);
    }
  }

  const {
    setOnboardingStatus: setGlobalOnboardingStatus,
    setWalletBalances: setGlobalWalletBalances,
    setWalletBalanceError: setGlobalWalletBalanceError,
    setFundAction,
    setRefreshAction,
    setIsRefreshing,
    setShowFundButton,
    setShowBalance,
  } = useDashboard();

  // Sync state to global context
  useEffect(() => {
    const shouldClearGlobalBalance = botsLoaded && !selectedBot;

    setGlobalOnboardingStatus(onboardingStatus);
    if (walletBalances || shouldClearGlobalBalance) {
      setGlobalWalletBalances(shouldClearGlobalBalance ? null : walletBalances);
    }
    if (walletBalanceError || shouldClearGlobalBalance) {
      setGlobalWalletBalanceError(
        shouldClearGlobalBalance ? null : walletBalanceError,
      );
    }
    setFundAction(selectedBot ? () => setFundOpen(true) : null);
    setRefreshAction(() => void refresh());
    setIsRefreshing(loading);
    setShowFundButton(true);
    setShowBalance(true);

    // Cleanup actions on unmount
    return () => {
      setFundAction(null);
      setRefreshAction(null);
    };
  }, [
    onboardingStatus,
    botsLoaded,
    walletBalances,
    walletBalanceError,
    loading,
    selectedBot,
    setGlobalOnboardingStatus,
    setGlobalWalletBalances,
    setGlobalWalletBalanceError,
    setFundAction,
    setRefreshAction,
    setIsRefreshing,
    setShowFundButton,
    setShowBalance,
    refresh, // refresh is a dependency
  ]);

  return (
    <>
      {selectedBot && (
        <FundingModal
          key={String(fundOpen)}
          walletAddress={selectedBot.walletAddress}
          open={fundOpen}
          onClose={() => setFundOpen(false)}
        />
      )}

      <CreateBotModal
        open={createOpen}
        onClose={() => {
          if (createBusy) return;
          setCreateOpen(false);
          setCreateError(null);
        }}
        onSubmit={() => {
          void createBot();
        }}
        onChange={setCreateForm}
        form={createForm}
        submitting={createBusy}
        error={createError}
        capBlocked={capBlocked}
        limits={botLimits}
        botCount={bots.length}
      />

      <section className="flex-1 min-h-0 w-full">
        <div className="w-full h-full min-h-0">
          <PresenceCard show={Boolean(message)}>
            <div className="mb-4 rounded-md border-l-4 border-red-500 bg-red-500/10 p-3 text-sm text-red-400">
              {message}
            </div>
          </PresenceCard>

          {!ready || !botsLoaded ? (
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
              {/* ─── NEW MONITOR GRID LAYOUT (Draggable / High Density) ─── */}
              <DashboardGrid
                key={gridRevision}
                className="w-full h-full border border-border bg-border pb-1"
                onLayoutChange={() =>
                  setHasCustomGridLayout(hasCustomDashboardGridLayouts())
                }
              >
                {/* AREA: MARKET MONITOR */}
                <div
                  key="market"
                  className="flex flex-col overflow-hidden bg-surface"
                >
                  <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
                    <p className="label flex items-center gap-2 dashboard-drag-handle cursor-move select-none">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      MARKET_MONITOR
                    </p>
                    <div className="flex gap-2 text-[10px] font-mono uppercase tracking-wider">
                      <span className="text-muted">SOL/USDC</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          (marketFeed.change24hPct ?? 0) >= 0
                            ? "text-emerald-400"
                            : "text-red-400",
                        )}
                      >
                        ${formatPrice(marketFeed.latestPrice)}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 relative bg-[var(--color-chart-bg)]">
                    <MarketChart className="opacity-80" />
                  </div>
                </div>

                {/* AREA: AGENT STATS */}
                <div
                  key="agents"
                  className="flex flex-col overflow-hidden bg-surface"
                >
                  <div className="flex items-center justify-between border-b border-border bg-surface/50 px-3 py-1.5 shrink-0">
                    <p className="text-[10px] uppercase tracking-wider text-muted font-bold dashboard-drag-handle cursor-move select-none">
                      AGENT_STATUS
                    </p>
                    <span className="text-[10px] text-muted font-mono">
                      {bots.length} ACTIVE
                    </span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <AgentStats
                      bots={bots}
                      selectedBotId={selectedBotId}
                      onSelectBot={setSelectedBotId}
                      onCreateBot={() => {
                        setCreateOpen(true);
                        setCreateError(null);
                      }}
                      onStartBot={startBot}
                      onStopBot={stopBot}
                      loading={loading}
                      hasManualAccess={hasManualAccess}
                      selectedBotInferenceConfigured={
                        selectedBotInferenceConfigured
                      }
                    />
                  </div>
                </div>

                {/* AREA: WALLET & EXECUTION */}
                <div
                  key="wallet"
                  className="flex flex-col overflow-hidden bg-surface"
                >
                  <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
                    <p className="label text-[10px] text-muted dashboard-drag-handle cursor-move select-none">
                      WALLET_AND_PNL
                    </p>
                  </div>
                  <div className="flex-1 p-4 grid grid-cols-2 gap-4 place-content-center">
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted uppercase tracking-wider">
                        Solana Balance
                      </p>
                      <p className="text-2xl font-mono font-medium text-ink">
                        {formatSolBalanceDisplay(
                          walletBalances?.sol.lamports ?? "0",
                        )}
                        <span className="text-sm text-muted ml-1 font-sans">
                          SOL
                        </span>
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted uppercase tracking-wider">
                        USDC Balance
                      </p>
                      <p className="text-2xl font-mono font-medium text-ink">
                        {formatUsdcBalanceDisplay(
                          walletBalances?.usdc.atomic ?? "0",
                        )}
                        <span className="text-sm text-muted ml-1 font-sans">
                          USDC
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                <div key="macro_radar" className="overflow-hidden">
                  <MacroRadarWidget />
                </div>

                <div key="macro_fred" className="overflow-hidden">
                  <MacroFredWidget />
                </div>

                <div key="macro_etf" className="overflow-hidden">
                  <MacroEtfWidget />
                </div>

                <div key="macro_stablecoin" className="overflow-hidden">
                  <MacroStablecoinWidget />
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

function CreateBotModal(props: {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onChange: (next: CreateBotForm) => void;
  form: CreateBotForm;
  submitting: boolean;
  error: string | null;
  capBlocked: boolean;
  limits: BotCreationLimits | null;
  botCount: number;
}) {
  const {
    open,
    onClose,
    onSubmit,
    onChange,
    form,
    submitting,
    error,
    capBlocked,
    limits,
    botCount,
  } = props;

  if (!open) return null;

  const requiredUsd = limits?.requiredUsdForExtraBots ?? "5000";
  const currentUsd = limits?.currentUsd ?? "0.00";
  const maxFreeBots = limits?.maxFreeBots ?? 3;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-[4px]"
        onClick={onClose}
        aria-label="Close create bot modal"
      />
      <div className="card relative w-[min(560px,94vw)] p-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <p className="font-semibold">Create Bot</p>
          <button
            className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface"
            onClick={onClose}
            type="button"
            disabled={submitting}
          >
            Close
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-md border border-border bg-paper p-3 text-xs text-muted">
            <p>
              {maxFreeBots} free bots. Extra bots require at least $
              {formatUsdLabel(requiredUsd)} across the oldest {maxFreeBots} bot
              wallets.
            </p>
            <p className="mt-1">
              Current baseline value: ${formatUsdLabel(currentUsd)} (SOL + USDC
              only).
            </p>
            {capBlocked && botCount >= maxFreeBots && (
              <p className="mt-2 text-amber-300">
                Creation is blocked until the threshold is met.
              </p>
            )}
          </div>

          <label className="block">
            <span className="mb-1 block text-xs text-muted">Bot name</span>
            <input
              className="input"
              value={form.name}
              maxLength={120}
              onChange={(event) =>
                onChange({
                  ...form,
                  name: event.target.value,
                })
              }
              placeholder="Momentum-SOL"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="mb-1 block text-xs text-muted">
                Provider base URL
              </span>
              <input
                className="input"
                value={form.baseUrl}
                onChange={(event) =>
                  onChange({
                    ...form,
                    baseUrl: event.target.value,
                  })
                }
                placeholder="https://api.z.ai/api/paas/v4"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-muted">Model</span>
              <input
                className="input"
                value={form.model}
                onChange={(event) =>
                  onChange({
                    ...form,
                    model: event.target.value,
                  })
                }
                placeholder="glm-5"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-muted">
                Provider kind
              </span>
              <input
                className="input bg-subtle text-muted"
                value="openai_compatible"
                readOnly
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs text-muted">API key</span>
            <input
              className="input"
              type="password"
              value={form.apiKey}
              onChange={(event) =>
                onChange({
                  ...form,
                  apiKey: event.target.value,
                })
              }
              placeholder="sk-..."
            />
          </label>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              className={cn(BTN_SECONDARY, "h-9 px-3 text-xs")}
              onClick={onClose}
              type="button"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              className={cn(BTN_PRIMARY, "h-9 px-3 text-xs")}
              onClick={onSubmit}
              type="button"
              disabled={submitting || capBlocked}
            >
              {submitting ? "Creating..." : "Create bot"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
