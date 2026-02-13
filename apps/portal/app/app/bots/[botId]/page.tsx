"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { cn } from "../../../cn";
import { FundingModal } from "../../../funding-modal";
import {
  apiFetchJson,
  type Bot,
  BTN_PRIMARY,
  BTN_SECONDARY,
  formatTick,
  isRecord,
} from "../../../lib";
import { FadeUp, PillPop, PresenceCard } from "../../../motion";

const WELL_KNOWN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

type StrategyType = "noop" | "dca" | "rebalance" | "agent" | "prediction_market";

type DcaFields = {
  inputMint: string;
  outputMint: string;
  amount: string;
  everyMinutes: string;
};

type RebalanceFields = {
  baseMint: string;
  quoteMint: string;
  targetBasePct: string;
  thresholdPct: string;
  maxSellBaseAmount: string;
  maxBuyQuoteAmount: string;
};

type AgentFields = {
  mandate: string;
  maxTradesPerDay: string;
  model: string;
};

type AgentMemoryState = {
  thesis: string;
  observations: Array<{
    ts: string;
    category: string;
    content: string;
  }>;
  reflections: string[];
  tradesProposedToday: number;
  updatedAt: string;
};

type PolicyFields = {
  simulateOnly: boolean;
  dryRun: boolean;
  slippageBps: string;
  maxPriceImpactPct: string;
};

type Balances = {
  sol: { lamports: string; display: string };
  usdc: { atomic: string; display: string };
};

type BotEvent = {
  ts: string;
  level: string;
  message: string;
  runId: string | null;
  reason: string | null;
  details: Record<string, unknown>;
};

type ChatSource = {
  type:
    | "validation"
    | "strategy-event"
    | "trade"
    | "log"
    | "runtime"
    | "config"
    | "error";
  id?: string;
  label: string;
  hint?: string;
};

type ChatMessage = {
  id: number;
  tenantId: string;
  role: "user" | "assistant";
  actor: "user" | "admin";
  question: string | null;
  answer: string | null;
  model: string | null;
  sources: ChatSource[];
  createdAt: string;
  error: string | null;
};

type BotTelemetry = {
  tenantId: string;
  strategyDescriptor: {
    headline: string;
    bullets: string[];
  };
  config: {
    strategy?: unknown;
    policy?: {
      simulateOnly?: boolean;
      dryRun?: boolean;
    };
    validation?: unknown;
    autotune?: unknown;
    execution?: unknown;
    dataSources?: unknown;
  };
  runtimeState: {
    lifecycleState: string | null;
    activeStrategyHash: string | null;
    lastValidationId: number | null;
    lastTunedAt: string | null;
    nextRevalidateAt: string | null;
    consecutiveFailures: number;
  } | null;
  latestValidation:
    | ({
        id: number;
        status: "running" | "passed" | "failed";
        metrics: ValidationMetrics | null;
        profile: string;
        lookbackDays: number;
        summary: string | null;
      } & Record<string, unknown>)
    | null;
  validationRuns: ValidationRun[];
  botEvents: BotEvent[];
  strategyEvents: StrategyAuditEvent[];
  trades: Array<{
    id: number;
    tenantId: string;
    runId: string | null;
    venue: string | null;
    market: string | null;
    side: string | null;
    status: string | null;
    signature: string | null;
    reasoning: string | null;
    createdAt: string;
  }>;
  startGate: {
    ok: boolean;
    reason?: "strategy-not-validated" | "strategy-validation-stale";
    strategyHash?: string;
    overrideAllowed?: boolean;
  };
};

type ValidationMetrics = {
  netReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  winRate: number;
  tradeCount: number;
};

type ValidationRun = {
  id: number;
  status: "running" | "passed" | "failed";
  strategyType: string;
  lookbackDays: number;
  profile: string;
  summary: string | null;
  completedAt: string | null;
  createdAt: string;
  metrics: ValidationMetrics | null;
};

type ChatEntry = {
  id: number;
  role: "user" | "assistant";
  actor: "user" | "admin";
  question: string | null;
  answer: string | null;
  sources: ChatSource[];
  createdAt: string;
};

type StrategyAuditEvent = {
  id: number;
  eventType: string;
  actor: string;
  reason: string | null;
  createdAt: string;
  validationId: number | null;
};

type Subscription = {
  status: "active" | "inactive";
  active: boolean;
  planId: string | null;
  planName: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  sourceSignature: string | null;
};

const INPUT = "input";

export default function BotPage() {
  const params = useParams<{ botId: string }>();
  const botId = params?.botId ?? "";

  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <main>
        <div className="sticky top-0 z-10 bg-paper border-b border-border py-4">
          <div className="w-[min(1120px,92vw)] mx-auto flex items-center justify-between gap-4">
            <a href="/" className="text-sm font-semibold tracking-tight">
              Serious Trader Ralph
            </a>
          </div>
        </div>
        <section className="py-[clamp(3rem,6vw,6rem)] border-t border-border">
          <div className="w-[min(1120px,92vw)] mx-auto">
            <h1>Bot</h1>
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

  return <BotShell botId={botId} />;
}

function BotShell({ botId }: { botId: string }) {
  const { ready, authenticated, logout, getAccessToken } = usePrivy();
  const router = useRouter();

  const [bots, setBots] = useState<Bot[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fundOpen, setFundOpen] = useState(false);

  const bot = bots.find((b) => b.id === botId) ?? null;

  const refreshMe = useCallback(async (opts?: { silent?: boolean }): Promise<void> => {
    if (!authenticated) return;
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
      setMessage(null);
    }
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const payload = await apiFetchJson("/api/me", token, { method: "GET" });
      const nextBotsRaw = isRecord(payload) ? payload.bots : null;
      const nextBots = Array.isArray(nextBotsRaw) ? (nextBotsRaw as Bot[]) : [];
      setBots(nextBots);

      const subRaw = isRecord(payload) ? payload.subscription : null;
      if (
        isRecord(subRaw) &&
        (subRaw.status === "active" || subRaw.status === "inactive")
      ) {
        setSubscription(subRaw as unknown as Subscription);
      } else {
        setSubscription(null);
      }
    } catch (err) {
      if (!silent) {
        setMessage(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void refreshMe();
  }, [ready, authenticated, refreshMe]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const timer = window.setInterval(() => {
      void refreshMe({ silent: true });
    }, 8000);
    return () => window.clearInterval(timer);
  }, [ready, authenticated, refreshMe]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    if (!subscription) return;
    if (subscription.active) return;
    router.replace("/checkout?plan=byok_annual&asset=USDC&pay=1");
  }, [ready, authenticated, subscription, router]);

  async function startBot(): Promise<void> {
    if (!bot) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${bot.id}/start`, token, {
        method: "POST",
      });
      await refreshMe();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function stopBot(): Promise<void> {
    if (!bot) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${bot.id}/stop`, token, {
        method: "POST",
      });
      await refreshMe();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function tickNow(): Promise<void> {
    if (!bot) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${bot.id}/tick`, token, {
        method: "POST",
      });
      await refreshMe();
      setMessage("Tick submitted.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="sticky top-0 z-10 bg-paper border-b border-border py-4">
        <div className="w-[min(1120px,92vw)] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3.5 min-w-0">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Serious Trader Ralph
            </Link>
            <Link
              href="/app"
              className="text-muted text-[0.85rem] whitespace-nowrap"
            >
              Control room
            </Link>
          </div>

          <div className="flex items-baseline justify-center gap-3 min-w-0 flex-1">
            <span className="font-semibold text-[0.95rem] whitespace-nowrap overflow-hidden text-ellipsis">
              {bot ? bot.name : botId ? "Bot" : "No bot"}
            </span>
            {bot ? (
              <>
                <PillPop
                  className={cn(
                    "inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium",
                    bot.enabled
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-border bg-surface text-muted",
                  )}
                >
                  {bot.enabled ? "On" : "Off"}
                </PillPop>
                <span className="text-muted text-[0.85rem] whitespace-nowrap">
                  {bot.walletAddress.slice(0, 10)}…
                </span>
              </>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-3 flex-wrap">
            {ready && authenticated && (
              <>
                {bot ? (
                  <>
                    <button
                      className={BTN_PRIMARY}
                      onClick={() => setFundOpen(true)}
                      type="button"
                    >
                      Fund
                    </button>
                    {bot.enabled ? (
                      <button
                        className={BTN_SECONDARY}
                        onClick={() => void stopBot()}
                        disabled={loading}
                        type="button"
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        className={BTN_PRIMARY}
                        onClick={() => void startBot()}
                        disabled={loading}
                        type="button"
                      >
                        Start
                      </button>
                    )}
                    <button
                      className={BTN_SECONDARY}
                      onClick={() => void tickNow()}
                      disabled={loading}
                      type="button"
                    >
                      Tick
                    </button>
                  </>
                ) : null}
                <button
                  className={BTN_SECONDARY}
                  onClick={logout}
                  type="button"
                >
                  Log out
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {bot && (
        <FundingModal
          key={String(fundOpen)}
          walletAddress={bot.walletAddress}
          open={fundOpen}
          onClose={() => setFundOpen(false)}
        />
      )}

      <section className="py-[clamp(3rem,6vw,6rem)] border-t border-border">
        <div className="w-[min(1120px,92vw)] mx-auto">
          <PresenceCard show={!!message}>
            <div className="card card-flat p-5 mb-5">
              <p className="label">Notice</p>
              <p className="text-muted">{message}</p>
            </div>
          </PresenceCard>

          {!ready ? (
            <div>
              <h1>Loading…</h1>
            </div>
          ) : subscription && !subscription.active ? (
            <FadeUp>
              <div className="card card-flat p-6">
                <p className="label">Subscription</p>
                <h2 className="mt-2.5">Redirecting to billing…</h2>
                <p className="text-muted mt-3.5">
                  This workspace requires an active annual license.
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-5">
                  <Link className={BTN_SECONDARY} href="/app">
                    Go to billing
                  </Link>
                </div>
              </div>
            </FadeUp>
          ) : bot ? (
            <FadeUp>
              <BotWorkspace
                bot={bot}
                getAccessToken={getAccessToken}
                onTick={tickNow}
                loading={loading}
              />
            </FadeUp>
          ) : (
            <FadeUp>
              <div className="card card-flat p-6">
                <p className="label">Bot</p>
                <h2 className="mt-2.5">Not found</h2>
                <p className="text-muted mt-3.5">
                  This bot id is not registered to your account.
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-5">
                  <button
                    className={BTN_SECONDARY}
                    onClick={() => void refreshMe()}
                    disabled={loading}
                    type="button"
                  >
                    Refresh
                  </button>
                  <Link className={BTN_SECONDARY} href="/app">
                    Back
                  </Link>
                </div>
              </div>
            </FadeUp>
          )}
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  Workspace: balance + strategy config + policy + actions            */
/* ------------------------------------------------------------------ */

function BotWorkspace({
  bot,
  getAccessToken,
  onTick,
  loading: parentLoading,
}: {
  bot: Bot;
  getAccessToken: () => Promise<string | null>;
  onTick: () => Promise<void>;
  loading: boolean;
}) {
  const [balances, setBalances] = useState<Balances | null>(null);
  const [strategyType, setStrategyType] = useState<StrategyType>("noop");
  const [dca, setDca] = useState<DcaFields>({
    inputMint: WELL_KNOWN_MINTS.SOL,
    outputMint: WELL_KNOWN_MINTS.USDC,
    amount: "",
    everyMinutes: "60",
  });
  const [rebalance, setRebalance] = useState<RebalanceFields>({
    baseMint: WELL_KNOWN_MINTS.SOL,
    quoteMint: WELL_KNOWN_MINTS.USDC,
    targetBasePct: "50",
    thresholdPct: "1",
    maxSellBaseAmount: "",
    maxBuyQuoteAmount: "",
  });
  const [agent, setAgent] = useState<AgentFields>({
    mandate: "",
    maxTradesPerDay: "5",
    model: "",
  });
  const [agentMemory, setAgentMemory] = useState<AgentMemoryState | null>(null);
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [validation, setValidation] = useState<ValidationRun | null>(null);
  const [validationRuns, setValidationRuns] = useState<ValidationRun[]>([]);
  const [strategyEvents, setStrategyEvents] = useState<StrategyAuditEvent[]>([]);
  const [policy, setPolicy] = useState<PolicyFields>({
    simulateOnly: true,
    dryRun: false,
    slippageBps: "50",
    // UI uses percent units (e.g. "5" means 5%). API expects decimal (0.05).
    maxPriceImpactPct: "5",
  });
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const [telemetry, setTelemetry] = useState<BotTelemetry | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatPollIntervalMs, setChatPollIntervalMs] = useState(10000);

  const refreshLiveData = useCallback(async (): Promise<void> => {
    const token = await getAccessToken();
    if (!token) return;

    const [balRes, telemetryRes, chatRes] = await Promise.all([
      apiFetchJson(`/api/bots/${bot.id}/balance`, token, {
        method: "GET",
      }).catch(() => null),
      apiFetchJson(`/api/bots/${bot.id}/telemetry?limit=30`, token, {
        method: "GET",
      }).catch(() => null),
      apiFetchJson(`/api/bots/${bot.id}/chat?limit=30`, token, {
        method: "GET",
      }).catch(() => null),
    ]);

    if (
      isRecord(balRes) &&
      isRecord((balRes as Record<string, unknown>).balances)
    ) {
      setBalances(
        (balRes as Record<string, unknown>).balances as unknown as Balances,
      );
    }

    const telemetryPayload = isRecord(telemetryRes)
      ? telemetryRes.telemetry
      : null;
    if (isRecord(telemetryPayload)) {
      const nextTelemetry = telemetryPayload as unknown as BotTelemetry;
      setTelemetry(nextTelemetry);

      const lifecycleState = nextTelemetry.runtimeState?.lifecycleState ?? "";
      const runningLike =
        lifecycleState === "active" ||
        lifecycleState === "validating" ||
        lifecycleState === "watch" ||
        bot.enabled;
      setChatPollIntervalMs(runningLike ? 4000 : 10000);

      const nextEvents = Array.isArray(nextTelemetry.botEvents)
        ? (nextTelemetry.botEvents.filter((item) => isRecord(item)) as BotEvent[])
        : [];
      setEvents(nextEvents);

      const latestValidation = isRecord(nextTelemetry.latestValidation)
        ? (nextTelemetry.latestValidation as unknown as ValidationRun)
        : null;
      setValidation(latestValidation);

      const nextRuns = Array.isArray(nextTelemetry.validationRuns)
        ? (nextTelemetry.validationRuns.filter(
            (item) => isRecord(item),
          ) as ValidationRun[])
        : [];
      setValidationRuns(nextRuns);

      const nextStrategyEvents = Array.isArray(nextTelemetry.strategyEvents)
        ? (nextTelemetry.strategyEvents.filter(
            (item) => isRecord(item),
          ) as StrategyAuditEvent[])
        : [];
      setStrategyEvents(nextStrategyEvents);
    } else {
      setTelemetry(null);
      setEvents([]);
      setValidation(null);
      setValidationRuns([]);
      setStrategyEvents([]);
    }

    const historyRaw = isRecord(chatRes) ? chatRes.messages : null;
    const nextChat = Array.isArray(historyRaw)
      ? (historyRaw.filter((item) => isRecord(item)) as ChatEntry[])
      : [];
    setChatMessages(nextChat);
    setLiveLoaded(true);
  }, [bot.id, getAccessToken]);

  // Fetch config on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (!token || cancelled) return;

      const cfgRes = await apiFetchJson(`/api/bots/${bot.id}/config`, token, {
          method: "GET",
        }).catch(() => null);
      if (cancelled) return;

      // Apply config
      if (!isRecord(cfgRes)) {
        setConfigMsg("Failed to load config");
        return;
      }
      const config = (cfgRes as Record<string, unknown>).config;
      if (!isRecord(config)) return;

      // Load strategy
      const strat = config.strategy;
      if (isRecord(strat)) {
        const t = strat.type as string;
        if (
          t === "dca" ||
          t === "rebalance" ||
          t === "noop" ||
          t === "agent" ||
          t === "prediction_market"
        ) {
          setStrategyType(t as StrategyType);
        }
        if (t === "dca") {
          setDca({
            inputMint: String(strat.inputMint ?? WELL_KNOWN_MINTS.SOL),
            outputMint: String(strat.outputMint ?? WELL_KNOWN_MINTS.USDC),
            amount: String(strat.amount ?? ""),
            everyMinutes: String(strat.everyMinutes ?? "60"),
          });
        }
        if (t === "rebalance") {
          setRebalance({
            baseMint: String(strat.baseMint ?? WELL_KNOWN_MINTS.SOL),
            quoteMint: String(strat.quoteMint ?? WELL_KNOWN_MINTS.USDC),
            targetBasePct: String(
              Math.round(Number(strat.targetBasePct ?? 0.5) * 100),
            ),
            thresholdPct: String(
              Math.round(Number(strat.thresholdPct ?? 0.01) * 100),
            ),
            maxSellBaseAmount: String(strat.maxSellBaseAmount ?? ""),
            maxBuyQuoteAmount: String(strat.maxBuyQuoteAmount ?? ""),
          });
        }
        if (t === "agent") {
          setAgent({
            mandate: String(strat.mandate ?? ""),
            maxTradesPerDay: String(strat.maxTradesPerDay ?? "5"),
            model: String(strat.model ?? ""),
          });
        }
      }

      // Load policy
      const pol = config.policy;
      if (isRecord(pol)) {
        const rawImpact = (pol as Record<string, unknown>).maxPriceImpactPct;
        const impactDecimal =
          typeof rawImpact === "number" ? rawImpact : Number(rawImpact);
        const impactPct = Number.isFinite(impactDecimal)
          ? impactDecimal * 100
          : 1;
        setPolicy({
          simulateOnly: Boolean(pol.simulateOnly ?? true),
          dryRun: Boolean(pol.dryRun ?? false),
          slippageBps: String(pol.slippageBps ?? "50"),
          maxPriceImpactPct: String(impactPct),
        });
      }
      setConfigLoaded(true);

      const memRes = await apiFetchJson(`/api/bots/${bot.id}/agent/memory`, token, {
        method: "GET",
      }).catch(() => null);
      if (
        !cancelled &&
        isRecord(memRes) &&
        isRecord((memRes as Record<string, unknown>).memory)
      ) {
        setAgentMemory(
          (memRes as Record<string, unknown>).memory as unknown as AgentMemoryState,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bot.id, getAccessToken]);

  // Polling for telemetry + events + conversation history
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshLiveData();
      } catch {
        // best effort for live panel
      }
    })();
    const timer = window.setInterval(() => {
      if (cancelled) return;
      void refreshLiveData().catch(() => {});
    }, Math.max(3000, Math.min(12000, chatPollIntervalMs)));
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshLiveData, chatPollIntervalMs]);

  async function saveConfig(): Promise<void> {
    setSaving(true);
    setConfigMsg(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");

      let strategy: Record<string, unknown>;
      if (strategyType === "dca") {
        strategy = {
          type: "dca",
          inputMint: dca.inputMint,
          outputMint: dca.outputMint,
          amount: dca.amount,
          everyMinutes: Number(dca.everyMinutes) || 60,
        };
      } else if (strategyType === "rebalance") {
        strategy = {
          type: "rebalance",
          baseMint: rebalance.baseMint,
          quoteMint: rebalance.quoteMint,
          targetBasePct: (Number(rebalance.targetBasePct) || 0) / 100,
          thresholdPct: (Number(rebalance.thresholdPct) || 0) / 100,
          ...(rebalance.maxSellBaseAmount
            ? { maxSellBaseAmount: rebalance.maxSellBaseAmount }
            : {}),
          ...(rebalance.maxBuyQuoteAmount
            ? { maxBuyQuoteAmount: rebalance.maxBuyQuoteAmount }
            : {}),
        };
      } else if (strategyType === "agent") {
        strategy = {
          type: "agent",
          mandate: agent.mandate,
          maxTradesPerDay: Number(agent.maxTradesPerDay) || 5,
          ...(agent.model.trim() ? { model: agent.model.trim() } : {}),
        };
      } else {
        strategy = { type: "noop" };
      }

      const policyPayload: Record<string, unknown> = {
        simulateOnly: policy.simulateOnly,
        dryRun: policy.dryRun,
        slippageBps: Number(policy.slippageBps) || 50,
        // UI is percent; API expects decimal fraction.
        maxPriceImpactPct: (Number(policy.maxPriceImpactPct) || 1) / 100,
      };

      await apiFetchJson(`/api/bots/${bot.id}/config`, token, {
        method: "PATCH",
        body: JSON.stringify({ strategy, policy: policyPayload }),
      });
      setConfigMsg("Config saved.");
    } catch (err) {
      setConfigMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function validateNow(): Promise<void> {
    setValidating(true);
    setConfigMsg(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const payload = await apiFetchJson(`/api/bots/${bot.id}/validate`, token, {
        method: "POST",
      });
      if (isRecord(payload) && isRecord(payload.validation)) {
        setValidation(payload.validation as unknown as ValidationRun);
      }
      await refreshLiveData();
      setConfigMsg("Validation run submitted.");
    } catch (err) {
      setConfigMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  async function sendChat(message: string): Promise<void> {
    const trimmed = message.trim();
    if (!trimmed) return;
    const token = await getAccessToken();
    if (!token) return;

    setChatBusy(true);
    setConfigMsg(null);
    try {
      const payload = await apiFetchJson(`/api/bots/${bot.id}/chat`, token, {
        method: "POST",
        body: JSON.stringify({ message: trimmed, explain: false }),
      });

      if (isRecord(payload)) {
        const snapshot = (payload as Record<string, unknown>).telemetrySnapshot;
        if (isRecord(snapshot)) {
          setTelemetry(snapshot as BotTelemetry);
        }
      }
      await refreshLiveData();
    } catch (err) {
      setConfigMsg(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      setChatBusy(false);
      setChatInput("");
    }
  }

  function submitChatShortcut(message: string): void {
    void sendChat(message);
  }

  const mintLabel = (addr: string): string => {
    for (const [k, v] of Object.entries(WELL_KNOWN_MINTS)) {
      if (v === addr) return k;
    }
    return `${addr.slice(0, 8)}…`;
  };

  const lastEvent = events[0] ?? null;
  const lastEventMs = lastEvent ? Date.parse(lastEvent.ts) : NaN;
  const isLoopLive =
    Number.isFinite(lastEventMs) && Date.now() - lastEventMs < 20_000;

  const fmtEventTime = (iso: string): string => {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return iso;
    return new Date(ms).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const eventMeta = (event: BotEvent): string | null => {
    const summary = event.details.summary;
    if (typeof summary === "string" && summary.trim()) return summary;
    const name = event.details.name;
    if (typeof name === "string" && name.trim()) return `tool: ${name}`;
    const toolCalls = event.details.toolCalls;
    if (
      Array.isArray(toolCalls) &&
      toolCalls.length > 0 &&
      toolCalls.every((x) => typeof x === "string")
    ) {
      return `calls: ${(toolCalls as string[]).join(", ")}`;
    }
    return null;
  };

  const executionMode = policy.dryRun
    ? "Dry run"
    : policy.simulateOnly
      ? "Simulate only"
      : "Live";

  const chatList = [...chatMessages]
    .filter((entry) => entry.question || entry.answer)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const chatText = (entry: ChatEntry): string => {
    if (entry.role === "user") return entry.question ?? "";
    return entry.answer ?? "";
  };

  const sourceChipClass = "inline-flex items-center rounded-full border border-border px-2 py-1 text-xs text-muted";
  const renderChatSources = (sources: ChatSource[]): ReactNode[] =>
    sources.map((source) => (
      <code className={sourceChipClass} key={`${source.type}:${source.id ?? "n"}`}>
        {source.label}
      </code>
    ));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid gap-5 min-w-0">
        {configLoaded ? (
          <>
            <div className="card card-flat p-6">
            <p className="label">Strategy</p>
            <div className="grid gap-4 mt-4">
              <div className="grid gap-1">
                <span className="label">Type</span>
                <div className="radio-group">
                  {(
                    ["noop", "dca", "rebalance", "agent", "prediction_market"] as StrategyType[]
                  ).map((t) => (
                    <label key={t}>
                      <input
                        type="radio"
                        name="strategyType"
                        value={t}
                        checked={strategyType === t}
                        onChange={() => setStrategyType(t)}
                      />
                      <span>
                        {t === "noop"
                          ? "Noop"
                          : t === "dca"
                            ? "DCA"
                            : t === "rebalance"
                              ? "Rebalance"
                              : t === "agent"
                                ? "Agent"
                                : "Prediction"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {strategyType === "dca" ? (
                <>
                  <div className="grid gap-1">
                    <span className="label">Input mint</span>
                    <select
                      className={cn("input", INPUT)}
                      value={dca.inputMint}
                      onChange={(e) =>
                        setDca((p) => ({ ...p, inputMint: e.target.value }))
                      }
                    >
                      <option value={WELL_KNOWN_MINTS.SOL}>SOL</option>
                      <option value={WELL_KNOWN_MINTS.USDC}>USDC</option>
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <span className="label">Output mint</span>
                    <select
                      className={cn("input", INPUT)}
                      value={dca.outputMint}
                      onChange={(e) =>
                        setDca((p) => ({ ...p, outputMint: e.target.value }))
                      }
                    >
                      <option value={WELL_KNOWN_MINTS.SOL}>SOL</option>
                      <option value={WELL_KNOWN_MINTS.USDC}>USDC</option>
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <span className="label">
                      Amount (atomic —{" "}
                      {mintLabel(dca.inputMint) === "SOL"
                        ? "lamports"
                        : "micro-units"}
                      )
                    </span>
                    <input
                      className={INPUT}
                      type="text"
                      inputMode="numeric"
                      value={dca.amount}
                      onChange={(e) =>
                        setDca((p) => ({ ...p, amount: e.target.value }))
                      }
                      placeholder="e.g. 10000000 (0.01 SOL)"
                    />
                  </div>
                  <div className="grid gap-1">
                    <span className="label">Interval (minutes)</span>
                    <input
                      className={INPUT}
                      type="text"
                      inputMode="numeric"
                      value={dca.everyMinutes}
                      onChange={(e) =>
                        setDca((p) => ({ ...p, everyMinutes: e.target.value }))
                      }
                      placeholder="60"
                    />
                  </div>
                </>
              ) : null}

              {strategyType === "rebalance" ? (
                <>
                  <div className="grid gap-1">
                    <span className="label">Base mint</span>
                    <select
                      className={cn("input", INPUT)}
                      value={rebalance.baseMint}
                      disabled
                    >
                      <option value={WELL_KNOWN_MINTS.SOL}>SOL</option>
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <span className="label">Quote mint</span>
                    <select
                      className={cn("input", INPUT)}
                      value={rebalance.quoteMint}
                      onChange={(e) =>
                        setRebalance((p) => ({
                          ...p,
                          quoteMint: e.target.value,
                        }))
                      }
                    >
                      <option value={WELL_KNOWN_MINTS.USDC}>USDC</option>
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <span className="label">Target SOL % (0–100)</span>
                    <input
                      className={INPUT}
                      type="text"
                      inputMode="numeric"
                      value={rebalance.targetBasePct}
                      onChange={(e) =>
                        setRebalance((p) => ({
                          ...p,
                          targetBasePct: e.target.value,
                        }))
                      }
                      placeholder="50"
                    />
                  </div>
                  <div className="grid gap-1">
                    <span className="label">Threshold % (0–100)</span>
                    <input
                      className={INPUT}
                      type="text"
                      inputMode="numeric"
                      value={rebalance.thresholdPct}
                      onChange={(e) =>
                        setRebalance((p) => ({
                          ...p,
                          thresholdPct: e.target.value,
                        }))
                      }
                      placeholder="1"
                    />
                  </div>
                  <div className="grid gap-1">
                    <span className="label">Max sell (lamports, optional)</span>
                    <input
                      className={INPUT}
                      type="text"
                      inputMode="numeric"
                      value={rebalance.maxSellBaseAmount}
                      onChange={(e) =>
                        setRebalance((p) => ({
                          ...p,
                          maxSellBaseAmount: e.target.value,
                        }))
                      }
                      placeholder="Leave empty for no cap"
                    />
                  </div>
                  <div className="grid gap-1">
                    <span className="label">
                      Max buy (USDC atomic, optional)
                    </span>
                    <input
                      className={INPUT}
                      type="text"
                      inputMode="numeric"
                      value={rebalance.maxBuyQuoteAmount}
                      onChange={(e) =>
                        setRebalance((p) => ({
                          ...p,
                          maxBuyQuoteAmount: e.target.value,
                        }))
                      }
                      placeholder="Leave empty for no cap"
                    />
                  </div>
                </>
              ) : null}

              {strategyType === "agent" ? (
                <>
                  <div className="grid gap-1">
                    <span className="label">Mandate</span>
                    <textarea
                      className={cn(INPUT, "min-h-[5rem] resize-y")}
                      value={agent.mandate}
                      onChange={(e) =>
                        setAgent((p) => ({ ...p, mandate: e.target.value }))
                      }
                      placeholder="What should Ralph focus on? e.g. Observe SOL/USDC. Build a thesis before trading."
                    />
                  </div>
                  <div className="grid gap-1">
                    <span className="label">Max trades per day</span>
                    <input
                      className={INPUT}
                      type="text"
                      inputMode="numeric"
                      value={agent.maxTradesPerDay}
                      onChange={(e) =>
                        setAgent((p) => ({
                          ...p,
                          maxTradesPerDay: e.target.value,
                        }))
                      }
                      placeholder="5"
                    />
                  </div>
                  <div className="grid gap-1">
                    <span className="label">
                      Model override (optional — blank uses env default)
                    </span>
                    <input
                      className={INPUT}
                      type="text"
                      value={agent.model}
                      onChange={(e) =>
                        setAgent((p) => ({ ...p, model: e.target.value }))
                      }
                      placeholder="Leave blank for ZAI_MODEL default"
                    />
                  </div>
                </>
              ) : null}
            </div>
            </div>

            <div className="card card-flat p-6">
              <p className="label">Risk policy</p>
              <div className="grid gap-4 mt-4">
                <div className="flex items-center justify-between py-2">
                  <span>Simulate only</span>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={policy.simulateOnly}
                      onChange={(e) =>
                        setPolicy((p) => ({
                          ...p,
                          simulateOnly: e.target.checked,
                        }))
                      }
                    />
                    <div className="toggle-track" />
                    <div className="toggle-thumb" />
                  </label>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span>Dry run</span>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={policy.dryRun}
                      onChange={(e) =>
                        setPolicy((p) => ({ ...p, dryRun: e.target.checked }))
                      }
                    />
                    <div className="toggle-track" />
                    <div className="toggle-thumb" />
                  </label>
                </div>
                <div className="grid gap-1">
                  <span className="label">Slippage (bps)</span>
                  <input
                    className={INPUT}
                    type="text"
                    inputMode="numeric"
                    value={policy.slippageBps}
                    onChange={(e) =>
                      setPolicy((p) => ({ ...p, slippageBps: e.target.value }))
                    }
                    placeholder="50"
                  />
                </div>
                <div className="grid gap-1">
                  <span className="label">Max price impact (%)</span>
                  <input
                    className={INPUT}
                    type="text"
                    inputMode="numeric"
                    value={policy.maxPriceImpactPct}
                    onChange={(e) =>
                      setPolicy((p) => ({
                        ...p,
                        maxPriceImpactPct: e.target.value,
                      }))
                    }
                    placeholder="1"
                  />
                </div>
              </div>
            </div>

            <div className="card card-flat p-5">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  className={BTN_PRIMARY}
                  onClick={() => void saveConfig()}
                  disabled={saving || parentLoading}
                  type="button"
                >
                  {saving ? "Saving…" : "Save config"}
                </button>
                <button
                  className={BTN_SECONDARY}
                  onClick={() => void onTick()}
                  disabled={saving || parentLoading}
                  type="button"
                >
                  Run now
                </button>
                <button
                  className={BTN_SECONDARY}
                  onClick={() => void validateNow()}
                  disabled={saving || parentLoading || validating}
                  type="button"
                >
                  {validating ? "Validating…" : "Validate now"}
                </button>
                <span className="text-muted text-[0.85rem]">
                  Live panel updates every 5s
                </span>
              </div>
            </div>

            <PresenceCard show={!!configMsg}>
              <p className="text-muted">{configMsg}</p>
            </PresenceCard>
          </>
        ) : (
          <div className="card card-flat p-6">
            <p className="label">Config</p>
            <p className="text-muted mt-2">Loading…</p>
          </div>
        )}
      </div>

      <aside className="grid gap-5 lg:sticky lg:top-24 self-start">
        <div className="card card-flat p-6">
          <p className="label">Loop status</p>
          <div className="mt-3 grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-muted text-[0.85rem]">Heartbeat</span>
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
                  isLoopLive
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-border bg-surface text-muted",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    isLoopLive ? "bg-accent animate-pulse" : "bg-muted",
                  )}
                />
                {isLoopLive ? "Live" : "Idle"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted text-[0.85rem]">Execution</span>
              <code>{executionMode}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted text-[0.85rem]">Last tick</span>
              <code>{formatTick(bot.lastTickAt)}</code>
            </div>
            {lastEvent ? (
              <div className="flex items-center justify-between">
                <span className="text-muted text-[0.85rem]">Last event</span>
                <code>{fmtEventTime(lastEvent.ts)}</code>
              </div>
            ) : null}
            <div className="grid gap-1 pt-1">
              <span className="text-muted text-[0.85rem]">Wallet</span>
              <code>{bot.walletAddress}</code>
            </div>
            {bot.lastError ? (
              <div className="grid gap-1 pt-1">
                <span className="text-muted text-[0.85rem]">Last error</span>
                <code>{bot.lastError}</code>
              </div>
            ) : null}
          </div>
        </div>

        <div className="card card-flat p-6">
          <p className="label">Strategy validation</p>
          {telemetry?.startGate && !telemetry.startGate.ok ? (
            <div className="mt-2 rounded-md border border-border px-3 py-2 text-sm">
              <div className="text-[0.75rem] text-muted">Start gate</div>
              <div className="font-medium">
                {telemetry.startGate.reason === "strategy-not-validated"
                  ? "No recent passing validation for this strategy"
                  : telemetry.startGate.reason === "strategy-validation-stale"
                    ? "Latest validation is stale"
                    : "Validation gate blocked"}
              </div>
            </div>
          ) : null}
          {validation ? (
            <div className="grid gap-2.5 mt-3">
              <div className="flex items-center justify-between">
                <span className="text-muted text-[0.85rem]">Latest</span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
                    validation.status === "passed"
                      ? "border-accent bg-accent-soft text-ink"
                      : validation.status === "failed"
                        ? "border-border bg-surface text-muted"
                        : "border-border bg-paper text-muted",
                  )}
                >
                  {validation.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted text-[0.85rem]">Window</span>
                <code>{validation.lookbackDays}d</code>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted text-[0.85rem]">Profile</span>
                <code>{validation.profile}</code>
              </div>
              {validation.metrics ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted text-[0.85rem]">Net return</span>
                    <code>{validation.metrics.netReturnPct.toFixed(2)}%</code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted text-[0.85rem]">Max DD</span>
                    <code>{validation.metrics.maxDrawdownPct.toFixed(2)}%</code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted text-[0.85rem]">Profit factor</span>
                    <code>{validation.metrics.profitFactor.toFixed(2)}</code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted text-[0.85rem]">Trades</span>
                    <code>{validation.metrics.tradeCount}</code>
                  </div>
                </>
              ) : null}
              {telemetry?.runtimeState ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted text-[0.85rem]">Runtime state</span>
                  <code>{telemetry.runtimeState.lifecycleState}</code>
                </div>
              ) : null}
              {telemetry?.runtimeState?.nextRevalidateAt ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted text-[0.85rem]">
                    Next revalidate
                  </span>
                  <code>{fmtEventTime(telemetry.runtimeState.nextRevalidateAt)}</code>
                </div>
              ) : null}
              {validation.summary ? (
                <p className="text-[0.78rem] text-muted line-clamp-3">
                  {validation.summary}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted mt-2">No validation runs yet.</p>
          )}
          {validationRuns.length > 0 ? (
            <p className="text-[0.75rem] text-muted mt-3">
              history: {validationRuns.length} runs
            </p>
          ) : null}
        </div>

        <div className="card card-flat p-6">
          <p className="label">Wallet balance</p>
          {balances ? (
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-2xl font-mono font-bold">
                  {balances.sol.display}
                </span>
                <span className="label">SOL</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-2xl font-mono font-bold">
                  {balances.usdc.display}
                </span>
                <span className="label">USDC</span>
              </div>
            </div>
          ) : (
            <p className="text-muted mt-2">Loading…</p>
          )}
        </div>

        {strategyType === "agent" && agentMemory ? (
          <div className="card card-flat p-6">
            <p className="label">Agent state</p>
            <div className="grid gap-3 mt-3">
              <div className="grid gap-1">
                <span className="text-muted text-[0.85rem]">Thesis</span>
                <p className="font-mono text-[0.82rem] leading-relaxed max-h-28 overflow-y-auto">
                  {agentMemory.thesis || "(no thesis yet)"}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted text-[0.85rem]">Trades today</span>
                <code>{agentMemory.tradesProposedToday}</code>
              </div>
            </div>
          </div>
        ) : null}

        <div className="card card-flat p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="label">Loop activity</p>
            <span className="text-muted text-[0.75rem]">latest {events.length}</span>
          </div>
          {!liveLoaded ? (
            <p className="text-muted mt-3">Loading live events…</p>
          ) : events.length === 0 ? (
            <p className="text-muted mt-3">No activity yet.</p>
          ) : (
            <div className="grid gap-2.5 mt-3 max-h-[26rem] overflow-y-auto pr-1">
              {events.slice(0, 24).map((event) => (
                <div
                  key={`${event.ts}:${event.message}:${event.runId ?? "none"}`}
                  className="rounded-md border border-border bg-paper px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[0.75rem] text-muted">
                      {fmtEventTime(event.ts)}
                    </span>
                    <span className="text-[0.72rem] uppercase tracking-wide text-muted">
                      {event.level}
                    </span>
                  </div>
                  <p className="text-[0.84rem] mt-1 font-medium">{event.message}</p>
                  {eventMeta(event) ? (
                    <p className="text-[0.78rem] mt-1 text-muted line-clamp-3">
                      {eventMeta(event)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-flat p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="label">Strategy events</p>
            <span className="text-muted text-[0.75rem]">
              latest {strategyEvents.length}
            </span>
          </div>
          {strategyEvents.length === 0 ? (
            <p className="text-muted mt-3">No strategy events yet.</p>
          ) : (
            <div className="grid gap-2.5 mt-3 max-h-[16rem] overflow-y-auto pr-1">
              {strategyEvents.slice(0, 16).map((event) => (
                <div
                  key={`${event.id}:${event.createdAt}`}
                  className="rounded-md border border-border bg-paper px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[0.75rem] text-muted">
                      {fmtEventTime(event.createdAt)}
                    </span>
                    <code>{event.eventType}</code>
                  </div>
                  <p className="text-[0.78rem] mt-1 text-muted">
                    actor: {event.actor}
                    {event.reason ? ` • ${event.reason}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-flat p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="label">Bot conversation</p>
            <span className="text-muted text-[0.75rem]">
              {chatList.length} messages
            </span>
          </div>
          {!telemetry?.startGate.ok ? (
            <p className="text-sm text-amber-500 mt-2">
              Start is blocked: {telemetry?.startGate.reason ?? "unknown"}.
            </p>
          ) : null}
          {!liveLoaded ? (
            <p className="text-muted mt-3">Loading conversation…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mt-3">
                {[
                  "What just happened?",
                  "Why did I get blocked?",
                  "How's validation?",
                ].map((shortcut) => (
                  <button
                    className={BTN_SECONDARY}
                    key={shortcut}
                    onClick={() => submitChatShortcut(shortcut)}
                    disabled={chatBusy}
                    type="button"
                  >
                    {shortcut}
                  </button>
                ))}
              </div>

              <div className="mt-3 grid gap-2.5 max-h-[24rem] overflow-y-auto pr-1">
                {chatList.length === 0 ? (
                  <p className="text-muted">
                    Ask a question to get a live read of what the bot is doing.
                  </p>
                ) : (
                  chatList.map((entry) => (
                    <div
                      key={`${entry.id}-${entry.role}`}
                      className={cn(
                        "rounded-md border px-3 py-2.5",
                        entry.role === "user"
                          ? "border-border bg-surface"
                          : "border-accent/50 bg-accent-soft",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="font-medium text-ink">
                          {entry.role === "user" ? "You" : "Bot"}
                        </span>
                        <span>{fmtEventTime(entry.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-sm">{chatText(entry)}</p>
                      {entry.role === "assistant" && entry.sources.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {renderChatSources(entry.sources)}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendChat(chatInput);
                }}
                className="mt-3"
              >
                <label className="grid gap-1">
                  <span className="text-muted text-[0.8rem]">
                    Ask the bot
                  </span>
                  <textarea
                    className={cn(INPUT, "min-h-[4.5rem] resize-y")}
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    placeholder="Ask anything about validation, recent trades, or why it is blocked..."
                  />
                </label>
                <div className="flex items-center justify-end gap-2 mt-2.5">
                  <button
                    className={BTN_PRIMARY}
                    type="submit"
                    disabled={chatBusy || chatInput.trim().length === 0}
                  >
                    {chatBusy ? "Asking…" : "Send"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
