"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { cn } from "../../../cn";
import { FundingModal } from "../../../funding-modal";
import {
  apiFetchJson,
  type BalanceResponse,
  type Bot,
  BTN_PRIMARY,
  BTN_SECONDARY,
  isRecord,
} from "../../../lib";
import { useDashboard } from "../../context";
import {
  type BacktestListItemLite,
  type BacktestRunStatus,
  detectBacktestTerminalTransitions,
} from "./backtests-utils";
import { ActivityTimeline } from "./components/activity-timeline";
import { AgentChat } from "./components/agent-chat";
import { AgentThoughtsLog } from "./components/agent-thoughts-log";
import { ControlRoomHeader } from "./components/control-room-header";
import { InferenceHealthCard } from "./components/inference-health-card";
import { InferenceSettings } from "./components/inference-settings";
import { LiveTicksChart } from "./components/live-ticks-chart";
import { RunStateBanner } from "./components/run-state-banner";
import { SteeringQueuePanel } from "./components/steering-queue-panel";

const WELL_KNOWN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

type StrategyType =
  | "noop"
  | "dca"
  | "rebalance"
  | "agent"
  | "prediction_market";

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

type DegenRollback = {
  policy: PolicyFields;
  validationEnabled: boolean;
};

type Balances = BalanceResponse;

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
  backtests?: {
    runningCount: number;
    latestRuns: BacktestListItem[];
  };
  agentRun?: {
    state:
      | "idle"
      | "starting"
      | "running"
      | "blocked_inference"
      | "stopped"
      | "error";
    blockedReason: string | null;
    currentRunId: string | null;
    lastTickAt: string | null;
    nextTickAt: string | null;
    provider: {
      baseUrlHash: string | null;
      model: string | null;
      pingAgeMs: number | null;
      resolutionSource: "bot_config" | null;
    };
    steering: {
      pendingCount: number;
      lastAppliedId: number | null;
    };
    context: {
      compactedAt: string | null;
      compactedCount: number;
      messageWindowCount: number;
    };
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

type BacktestSummary = {
  netReturnPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
};

type BacktestListItem = {
  runId: string;
  status: BacktestRunStatus;
  kind: "validation" | "strategy_json";
  strategyLabel: string;
  summary: BacktestSummary | null;
  validationStatus?: "passed" | "failed";
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
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

type SteeringMessageEntry = {
  id: number;
  message: string;
  status: "pending" | "applied" | "canceled";
  queuedAt: string;
  appliedAt: string | null;
  appliedRunId: string | null;
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

type InferenceProviderView = {
  providerKind: string;
  baseUrl: string;
  model: string;
  configured: boolean;
  apiKeyMasked: string | null;
  updatedAt: string | null;
  lastPingAt?: string | null;
  lastPingError?: string | null;
};

const INPUT = "input";
const DEFAULT_PROVIDER_BASE_URL = "https://api.z.ai/api/paas/v4";
const DEFAULT_PROVIDER_MODEL = "glm-5";
type SettingsSection = "strategy" | "risk" | "inference";

const TOOL_CALL_DESCRIPTIONS: Record<string, string> = {
  control_finish: "finalizing this tick",
  market_snapshot: "refreshing portfolio snapshot",
  market_token_balance: "checking token balance",
  market_jupiter_quote: "getting swap quote",
  market_jupiter_quote_batch: "batch quoting routes",
  market_ohlcv_history: "loading price history",
  market_indicators: "computing indicators",
  macro_signals: "scanning macro regime",
  macro_fred_indicators: "loading FRED indicators",
  macro_etf_flows: "checking ETF flows",
  macro_stablecoin_health: "checking stablecoin stress",
  macro_oil_analytics: "checking oil macro data",
  backtest_run_create: "starting backtest",
  backtest_run_list: "listing backtests",
  backtest_run_get: "reading backtest result",
  trades_list_recent: "reviewing recent trades",
  memory_update_thesis: "updating strategy thesis",
  memory_log_observation: "logging market observation",
  memory_add_reflection: "adding reflection note",
  trade_jupiter_swap: "executing swap",
};

function formatToolCallLabel(toolName: string): string {
  const cleaned = String(toolName || "").trim();
  if (!cleaned) return "agent action";
  return cleaned.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatToolCallDescription(toolName: string): string {
  const cleaned = String(toolName || "").trim();
  if (!cleaned) return "running tool";
  return TOOL_CALL_DESCRIPTIONS[cleaned] ?? "running tool";
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
    lastPingAt:
      typeof provider.lastPingAt === "string" ? provider.lastPingAt : null,
    lastPingError:
      typeof provider.lastPingError === "string"
        ? provider.lastPingError
        : null,
  };
}

function toNumericString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  return null;
}

function isDegenPolicySnapshot(
  policy: PolicyFields,
  validationEnabled: boolean,
): boolean {
  const slippage = Number(policy.slippageBps);
  const impactPct = Number(policy.maxPriceImpactPct);
  return (
    !policy.simulateOnly &&
    !policy.dryRun &&
    Number.isFinite(slippage) &&
    slippage >= 10000 &&
    Number.isFinite(impactPct) &&
    impactPct >= 100 &&
    !validationEnabled
  );
}

export default function BotPage() {
  const params = useParams<{ botId: string }>();
  const botId = params?.botId ?? "";

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
  const { ready, authenticated, getAccessToken } = usePrivy();

  const [bots, setBots] = useState<Bot[]>([]);
  const [botsLoaded, setBotsLoaded] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [_message, setMessage] = useState<string | null>(null);
  const [fundOpen, setFundOpen] = useState(false);

  const bot = bots.find((b) => b.id === botId) ?? null;

  const refreshMe = useCallback(
    async (opts?: { silent?: boolean }): Promise<void> => {
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
        const nextBots = Array.isArray(nextBotsRaw)
          ? (nextBotsRaw as Bot[])
          : [];
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
          const nextError = err instanceof Error ? err.message : String(err);
          if (nextError === "manual-onboarding-required") {
            setMessage(
              "This account is not approved yet. Request manual onboarding to access workspace data.",
            );
          } else {
            setMessage(nextError);
          }
        }
      } finally {
        if (!silent) {
          setLoading(false);
          setBotsLoaded(true);
        }
      }
    },
    [authenticated, getAccessToken],
  );

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
    setMessage(
      "Manual access is not active yet. Contact the Trader Ralph team to enable trading actions.",
    );
  }, [ready, authenticated, subscription]);

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
    <>
      <section className="flex-1 min-h-0 relative overflow-hidden">
        {bot ? (
          <BotWorkspace
            bot={bot}
            getAccessToken={getAccessToken}
            onTick={tickNow}
            onFund={() => setFundOpen(true)}
            onStart={() => void startBot()}
            onStop={() => void stopBot()}
            loading={loading}
          />
        ) : !ready || !botsLoaded ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-muted animate-pulse">
              Loading bot data...
            </span>
          </div>
        ) : (
          <div className="p-10 text-center">
            <h2 className="text-xl font-bold">Bot not found</h2>
            <Link href="/app" className={`${BTN_PRIMARY} mt-4 inline-block`}>
              Back to Control Room
            </Link>
          </div>
        )}
      </section>

      {bot && (
        <FundingModal
          key={String(fundOpen)}
          walletAddress={bot.walletAddress}
          open={fundOpen}
          onClose={() => setFundOpen(false)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Workspace: balance + strategy config + policy + actions            */
/* ------------------------------------------------------------------ */

function BotWorkspace({
  bot,
  getAccessToken,
  onTick,
  onFund,
  onStart,
  onStop,
  loading: parentLoading,
}: {
  bot: Bot;
  getAccessToken: () => Promise<string | null>;
  onTick: () => Promise<void>;
  onFund: () => void;
  onStart: () => void;
  onStop: () => void;
  loading: boolean;
}) {
  const router = useRouter();
  const [balances, setBalances] = useState<Balances | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [strategyType, setStrategyType] = useState<StrategyType>("agent");
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
    model: "",
  });
  const [_agentMemory, setAgentMemory] = useState<AgentMemoryState | null>(
    null,
  );
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [_validation, setValidation] = useState<ValidationRun | null>(null);
  const [_validationRuns, setValidationRuns] = useState<ValidationRun[]>([]);
  const [backtestRuns, setBacktestRuns] = useState<BacktestListItem[]>([]);
  const [backtestRunningCount, setBacktestRunningCount] = useState(0);
  const [_strategyEvents, setStrategyEvents] = useState<StrategyAuditEvent[]>(
    [],
  );
  const [policy, setPolicy] = useState<PolicyFields>({
    simulateOnly: true,
    dryRun: false,
    slippageBps: "50",
    // UI uses percent units (e.g. "5" means 5%). API expects decimal (0.05).
    maxPriceImpactPct: "5",
  });
  const [validationEnabled, setValidationEnabled] = useState(true);
  const [degenMode, setDegenMode] = useState(false);
  const [degenRollback, setDegenRollback] = useState<DegenRollback | null>(
    null,
  );
  const [degenConfirmOpen, setDegenConfirmOpen] = useState(false);
  const [degenConfirmText, setDegenConfirmText] = useState("");
  const [saving, setSaving] = useState(false);
  const [_configMsg, setConfigMsg] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [_liveLoaded, setLiveLoaded] = useState(false);
  const [_telemetry, setTelemetry] = useState<BotTelemetry | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [steeringMessages, setSteeringMessages] = useState<
    SteeringMessageEntry[]
  >([]);
  const [_chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [steeringBusy, setSteeringBusy] = useState(false);
  const [chatPollIntervalMs, setChatPollIntervalMs] = useState(10000);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("strategy");
  const [inferenceProvider, setInferenceProvider] =
    useState<InferenceProviderView | null>(null);
  const [inferenceSaving, setInferenceSaving] = useState(false);
  const [inferencePinging, setInferencePinging] = useState(false);
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [_inferencePingMessage, setInferencePingMessage] = useState<
    string | null
  >(null);
  const backtestStatusRef = useRef<Record<string, BacktestRunStatus>>({});
  const seenBacktestToastsRef = useRef<Set<string>>(new Set());
  const backtestToastBootstrappedRef = useRef(false);

  // Transform bot events into thoughts
  const thoughts = useMemo(() => {
    const noisyLifecycle = new Set([
      "tick start",
      "agent tick start",
      "agent tick end",
    ]);
    return events
      .map((e, i) => {
        const message = String(e.message ?? "").trim();
        const messageLower = message.toLowerCase();
        const details = e.details ?? {};
        const detailObservation =
          typeof details.observation === "string"
            ? details.observation.trim()
            : "";
        const detailThesis =
          typeof details.thesis === "string" ? details.thesis.trim() : "";
        const detailReasoning =
          typeof details.reasoning === "string" ? details.reasoning.trim() : "";
        const detailArgs =
          details.args &&
          typeof details.args === "object" &&
          !Array.isArray(details.args)
            ? (details.args as Record<string, unknown>)
            : null;
        const argsObservation =
          detailArgs && typeof detailArgs.observation === "string"
            ? detailArgs.observation.trim()
            : "";
        const argsThesis =
          detailArgs && typeof detailArgs.thesis === "string"
            ? detailArgs.thesis.trim()
            : "";
        const summary =
          typeof details.summary === "string" ? details.summary.trim() : "";
        const err = typeof details.err === "string" ? details.err.trim() : "";
        const toolName =
          typeof details.name === "string" ? String(details.name).trim() : "";
        const observation = detailObservation || argsObservation;
        const thesis = detailThesis || argsThesis;

        let content = message;
        if (messageLower === "agent tool observation logged" && observation) {
          content = observation;
        } else if (
          messageLower === "agent tool thesis updated" &&
          (thesis || detailReasoning)
        ) {
          content = thesis || `Thesis updated: ${detailReasoning}`;
        } else if (messageLower === "agent finished" && summary) {
          content = summary;
        } else if (messageLower === "agent tool call" && toolName) {
          const label = formatToolCallLabel(toolName);
          const description = formatToolCallDescription(toolName);
          content = `${label}: ${description}`;
        } else {
          const meta = [summary, err, toolName ? `tool=${toolName}` : ""]
            .filter((x) => x.length > 0)
            .join(" | ");
          content = meta ? `${message} (${meta})` : message;
        }

        const hasError =
          err.length > 0 ||
          messageLower.includes("failed") ||
          messageLower.includes("error");
        return {
          id: String(i),
          sourceIndex: i,
          ts: Date.parse(e.ts),
          content,
          rawMessage: messageLower,
          hasError,
          level: String(e.level ?? "info").toLowerCase(),
        };
      })
      .filter(
        (item) => Number.isFinite(item.ts) && item.content.trim().length > 0,
      )
      .filter(
        (item) => !(noisyLifecycle.has(item.rawMessage) && !item.hasError),
      )
      .map((item) => ({
        id: item.id,
        sourceIndex: item.sourceIndex,
        ts: item.ts,
        content: item.content,
        category: (item.hasError
          ? "reflection"
          : item.level === "debug"
            ? "planning"
            : "execution") as "planning" | "execution" | "reflection",
      }))
      .sort((a, b) => {
        if (a.ts === b.ts) {
          // Event feed arrives newest-first; for equal timestamps, place older items first.
          return b.sourceIndex - a.sourceIndex;
        }
        return a.ts - b.ts;
      })
      .map(({ sourceIndex, ...item }) => item);
  }, [events]);

  // Transform chat messages
  const messages = useMemo(() => {
    return chatMessages.map((m) => ({
      id: String(m.id),
      role: m.role,
      content: m.answer || m.question || "",
      ts: new Date(m.createdAt).getTime(),
    }));
  }, [chatMessages]);

  const handleSendMessage = async (msg: string) => {
    setChatBusy(true);
    const token = await getAccessToken();
    if (token) {
      await apiFetchJson(`/api/bots/${bot.id}/chat`, token, {
        method: "POST",
        body: JSON.stringify({ message: msg }),
      });
      await refreshLiveData();
    }
    setChatBusy(false);
  };

  const toInferenceUiMessage = useCallback((raw: unknown): string => {
    const message = String(raw ?? "");
    if (message === "inference-provider-not-configured") {
      return "Inference provider is not configured.";
    }
    if (
      message === "inference-encryption-key-missing" ||
      message === "invalid-inference-encryption-key"
    ) {
      return "Server-side inference encryption is not configured.";
    }
    if (message === "inference-provider-ping-timeout") {
      return "Provider test timed out. Check endpoint and network.";
    }
    if (message.startsWith("inference-provider-ping-failed")) {
      return "Provider test failed. Verify endpoint, model, and API key.";
    }
    return message || "Inference provider request failed.";
  }, []);

  const refreshInferenceProvider = useCallback(async (): Promise<void> => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      const payload = await apiFetchJson(
        `/api/bots/${bot.id}/inference`,
        token,
        {
          method: "GET",
        },
      );
      setInferenceProvider(parseInferenceProvider(payload));
      setInferenceError(null);
    } catch (err) {
      setInferenceProvider(null);
      setInferenceError(
        toInferenceUiMessage(err instanceof Error ? err.message : String(err)),
      );
    }
  }, [bot.id, getAccessToken, toInferenceUiMessage]);

  const handlePingSettings = async (cfg: {
    baseUrl: string;
    model: string;
    apiKey?: string;
  }) => {
    const token = await getAccessToken();
    if (!token) return;
    setInferencePinging(true);
    setInferenceError(null);
    setInferencePingMessage(null);
    try {
      await apiFetchJson(`/api/bots/${bot.id}/inference/ping`, token, {
        method: "POST",
        body: JSON.stringify({
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
        }),
      });
      setInferencePingMessage("Connection test passed.");
    } catch (err) {
      setInferenceError(
        toInferenceUiMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    } finally {
      setInferencePinging(false);
    }
  };

  const handleSaveSettings = async (cfg: {
    baseUrl: string;
    model: string;
    apiKey?: string;
  }) => {
    const token = await getAccessToken();
    if (!token) return;
    setInferenceSaving(true);
    setInferenceError(null);
    setInferencePingMessage(null);
    setConfigMsg(null);
    try {
      await apiFetchJson(`/api/bots/${bot.id}/inference`, token, {
        method: "PATCH",
        body: JSON.stringify({
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
        }),
      });
      await refreshInferenceProvider();
      setConfigMsg("Inference provider saved and validated.");
    } catch (err) {
      setInferenceError(
        toInferenceUiMessage(err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setInferenceSaving(false);
    }
  };

  const refreshSteering = useCallback(async (): Promise<void> => {
    const token = await getAccessToken();
    if (!token) return;
    const payload = await apiFetchJson(
      `/api/bots/${bot.id}/steering?limit=50`,
      token,
      {
        method: "GET",
      },
    ).catch(() => null);
    const messagesRaw =
      isRecord(payload) && Array.isArray(payload.messages)
        ? payload.messages
        : [];
    const next = messagesRaw
      .filter((item) => isRecord(item))
      .map((item) => ({
        id: Number(item.id ?? 0),
        message: String(item.message ?? ""),
        status: (item.status === "applied" || item.status === "canceled"
          ? item.status
          : "pending") as SteeringMessageEntry["status"],
        queuedAt: String(item.queuedAt ?? ""),
        appliedAt:
          typeof item.appliedAt === "string" ? String(item.appliedAt) : null,
        appliedRunId:
          typeof item.appliedRunId === "string"
            ? String(item.appliedRunId)
            : null,
      }))
      .filter((item) => Number.isFinite(item.id) && item.id > 0);
    setSteeringMessages(next);
  }, [bot.id, getAccessToken]);

  const sendSteering = async (message: string): Promise<void> => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const token = await getAccessToken();
    if (!token) return;
    setSteeringBusy(true);
    try {
      await apiFetchJson(`/api/bots/${bot.id}/steering`, token, {
        method: "POST",
        body: JSON.stringify({ message: trimmed }),
      });
      await Promise.all([refreshSteering(), refreshLiveData()]);
    } finally {
      setSteeringBusy(false);
    }
  };

  const pingCurrentInference = async (): Promise<void> => {
    if (!inferenceProvider?.configured) return;
    await handlePingSettings({
      baseUrl: inferenceProvider.baseUrl || DEFAULT_PROVIDER_BASE_URL,
      model: inferenceProvider.model || DEFAULT_PROVIDER_MODEL,
    });
    await refreshInferenceProvider();
  };

  const refreshLiveData = useCallback(async (): Promise<void> => {
    const token = await getAccessToken();
    if (!token) return;

    setRefreshing(true);
    const [balRes, telemetryRes, chatRes, eventsRes, steeringRes] =
      await Promise.all([
        apiFetchJson(`/api/bots/${bot.id}/balance`, token, {
          method: "GET",
        }).catch(() => null),
        apiFetchJson(`/api/bots/${bot.id}/telemetry?limit=30`, token, {
          method: "GET",
        }).catch(() => null),
        apiFetchJson(`/api/bots/${bot.id}/chat?limit=30`, token, {
          method: "GET",
        }).catch(() => null),
        apiFetchJson(`/api/bots/${bot.id}/events?limit=80`, token, {
          method: "GET",
        }).catch(() => null),
        apiFetchJson(`/api/bots/${bot.id}/steering?limit=50`, token, {
          method: "GET",
        }).catch(() => null),
      ]);
    setRefreshing(false);

    if (
      isRecord(balRes) &&
      isRecord((balRes as Record<string, unknown>).balances)
    ) {
      const balancesRaw = (balRes as Record<string, unknown>).balances;
      if (
        isRecord(balancesRaw) &&
        isRecord(balancesRaw.sol) &&
        isRecord(balancesRaw.usdc)
      ) {
        setBalances({
          sol: {
            lamports:
              toNumericString(
                (balancesRaw.sol as Record<string, unknown>).lamports,
              ) ?? "",
          },
          usdc: {
            atomic:
              toNumericString(
                (balancesRaw.usdc as Record<string, unknown>).atomic,
              ) ?? "0",
          },
        });
      }
    }

    const directEvents =
      isRecord(eventsRes) && Array.isArray(eventsRes.events)
        ? (eventsRes.events.filter((item) => isRecord(item)) as BotEvent[])
        : [];

    const telemetryPayload = isRecord(telemetryRes)
      ? telemetryRes.telemetry
      : null;
    let telemetryEvents: BotEvent[] = [];
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

      telemetryEvents = Array.isArray(nextTelemetry.botEvents)
        ? (nextTelemetry.botEvents.filter((item) =>
            isRecord(item),
          ) as BotEvent[])
        : [];

      const latestValidation = isRecord(nextTelemetry.latestValidation)
        ? (nextTelemetry.latestValidation as unknown as ValidationRun)
        : null;
      setValidation(latestValidation);

      const nextRuns = Array.isArray(nextTelemetry.validationRuns)
        ? (nextTelemetry.validationRuns.filter((item) =>
            isRecord(item),
          ) as ValidationRun[])
        : [];
      setValidationRuns(nextRuns);

      const telemetryBacktests = isRecord(nextTelemetry.backtests)
        ? nextTelemetry.backtests
        : null;
      const nextBacktests =
        telemetryBacktests && Array.isArray(telemetryBacktests.latestRuns)
          ? (telemetryBacktests.latestRuns.filter((item) =>
              isRecord(item),
            ) as BacktestListItem[])
          : [];
      setBacktestRuns(nextBacktests);
      if (
        telemetryBacktests &&
        Number.isFinite(Number(telemetryBacktests.runningCount))
      ) {
        setBacktestRunningCount(Number(telemetryBacktests.runningCount));
      } else {
        const running = nextBacktests.filter(
          (run) => run.status === "queued" || run.status === "running",
        ).length;
        setBacktestRunningCount(running);
      }

      const nextStrategyEvents = Array.isArray(nextTelemetry.strategyEvents)
        ? (nextTelemetry.strategyEvents.filter((item) =>
            isRecord(item),
          ) as StrategyAuditEvent[])
        : [];
      setStrategyEvents(nextStrategyEvents);
    } else {
      setTelemetry(null);
      setValidation(null);
      setValidationRuns([]);
      setBacktestRuns([]);
      setBacktestRunningCount(0);
      setStrategyEvents([]);
    }

    setEvents((current) => {
      const next = directEvents.length > 0 ? directEvents : telemetryEvents;
      return next.length > 0 ? next : current;
    });

    const historyRaw = isRecord(chatRes) ? chatRes.messages : null;
    const nextChat = Array.isArray(historyRaw)
      ? (historyRaw.filter((item) => isRecord(item)) as ChatEntry[])
      : [];
    setChatMessages(nextChat);
    const steeringRaw = isRecord(steeringRes) ? steeringRes.messages : null;
    const nextSteering = Array.isArray(steeringRaw)
      ? steeringRaw
          .filter((item) => isRecord(item))
          .map((item) => ({
            id: Number(item.id ?? 0),
            message: String(item.message ?? ""),
            status: (item.status === "applied" || item.status === "canceled"
              ? item.status
              : "pending") as SteeringMessageEntry["status"],
            queuedAt: String(item.queuedAt ?? ""),
            appliedAt:
              typeof item.appliedAt === "string"
                ? String(item.appliedAt)
                : null,
            appliedRunId:
              typeof item.appliedRunId === "string"
                ? String(item.appliedRunId)
                : null,
          }))
          .filter((item) => Number.isFinite(item.id) && item.id > 0)
      : [];
    setSteeringMessages(nextSteering);
    setLiveLoaded(true);
  }, [bot.id, getAccessToken, bot.enabled]);

  // Fetch config on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (!token || cancelled) return;

      const inferenceRes = await apiFetchJson(
        `/api/bots/${bot.id}/inference`,
        token,
        { method: "GET" },
      ).catch(() => null);
      if (!cancelled) {
        setInferenceProvider(parseInferenceProvider(inferenceRes));
        setInferenceError(null);
        setInferencePingMessage(null);
      }

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
          // Mandate-first mode: bot UI is agent-only.
          setStrategyType("agent");
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
            model: String(strat.model ?? ""),
          });
        }
      }

      // Load policy
      const pol = config.policy;
      const nextPolicy: PolicyFields = isRecord(pol)
        ? (() => {
            const rawImpact = (pol as Record<string, unknown>)
              .maxPriceImpactPct;
            const impactDecimal =
              typeof rawImpact === "number" ? rawImpact : Number(rawImpact);
            const impactPct = Number.isFinite(impactDecimal)
              ? impactDecimal * 100
              : 1;
            return {
              simulateOnly: Boolean(pol.simulateOnly ?? true),
              dryRun: Boolean(pol.dryRun ?? false),
              slippageBps: String(pol.slippageBps ?? "50"),
              maxPriceImpactPct: String(impactPct),
            };
          })()
        : {
            simulateOnly: true,
            dryRun: false,
            slippageBps: "50",
            maxPriceImpactPct: "5",
          };
      setPolicy(nextPolicy);

      const val = config.validation;
      const nextValidationEnabled =
        !isRecord(val) || val.enabled === undefined
          ? true
          : Boolean(val.enabled);
      setValidationEnabled(nextValidationEnabled);
      setDegenMode(isDegenPolicySnapshot(nextPolicy, nextValidationEnabled));
      setDegenRollback(null);
      setDegenConfirmOpen(false);
      setDegenConfirmText("");
      setConfigLoaded(true);

      const memRes = await apiFetchJson(
        `/api/bots/${bot.id}/agent/memory`,
        token,
        {
          method: "GET",
        },
      ).catch(() => null);
      if (
        !cancelled &&
        isRecord(memRes) &&
        isRecord((memRes as Record<string, unknown>).memory)
      ) {
        setAgentMemory(
          (memRes as Record<string, unknown>)
            .memory as unknown as AgentMemoryState,
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
    const timer = window.setInterval(
      () => {
        if (cancelled) return;
        void refreshLiveData().catch(() => {});
      },
      Math.max(3000, Math.min(12000, chatPollIntervalMs)),
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshLiveData, chatPollIntervalMs]);

  useEffect(() => {
    const detection = detectBacktestTerminalTransitions({
      previousStatuses: backtestStatusRef.current,
      nextRuns: backtestRuns as BacktestListItemLite[],
      bootstrapped: backtestToastBootstrappedRef.current,
      seenTerminalKeys: seenBacktestToastsRef.current,
    });
    backtestStatusRef.current = detection.nextStatuses;

    if (!backtestToastBootstrappedRef.current) {
      backtestToastBootstrappedRef.current = true;
      return;
    }

    for (const transition of detection.transitions) {
      const runId = transition.run.runId;
      const href = `/app/bots/${bot.id}/backtests/${runId}`;
      if (transition.to === "completed") {
        toast.success("Backtest completed", {
          description: transition.run.strategyLabel,
          action: {
            label: "View details",
            onClick: () => router.push(href),
          },
        });
      } else {
        toast.error("Backtest failed", {
          description: transition.run.strategyLabel,
          action: {
            label: "View details",
            onClick: () => router.push(href),
          },
        });
      }
    }
  }, [backtestRuns, bot.id, router]);

  async function saveConfig(): Promise<void> {
    setSaving(true);
    setConfigMsg(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");

      const strategy: Record<string, unknown> = {
        type: "agent",
        mandate: agent.mandate,
        ...(agent.model.trim() ? { model: agent.model.trim() } : {}),
      };

      const policyPayload: Record<string, unknown> = degenMode
        ? {
            killSwitch: false,
            allowedMints: [],
            maxTradeAmountAtomic: "0",
            maxPriceImpactPct: 1,
            slippageBps: 10_000,
            simulateOnly: false,
            dryRun: false,
            minSolReserveLamports: "0",
          }
        : {
            simulateOnly: policy.simulateOnly,
            dryRun: policy.dryRun,
            slippageBps: Number(policy.slippageBps) || 50,
            // UI is percent; API expects decimal fraction.
            maxPriceImpactPct: (Number(policy.maxPriceImpactPct) || 1) / 100,
          };

      const validationPayload: Record<string, unknown> = {
        enabled: degenMode ? false : validationEnabled,
      };

      await apiFetchJson(`/api/bots/${bot.id}/config`, token, {
        method: "PATCH",
        body: JSON.stringify({
          strategy,
          policy: policyPayload,
          validation: validationPayload,
        }),
      });
      setConfigMsg("Config saved.");
      toast.success(
        degenMode ? "Degen mode live: max freedom enabled." : "Config saved.",
      );
    } catch (err) {
      setConfigMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function openDegenConfirmation(): void {
    setDegenConfirmOpen(true);
    setDegenConfirmText("");
  }

  function cancelDegenConfirmation(): void {
    setDegenConfirmOpen(false);
    setDegenConfirmText("");
  }

  function confirmEnableDegenMode(): void {
    setDegenRollback({
      policy: { ...policy },
      validationEnabled,
    });
    setDegenMode(true);
    setValidationEnabled(false);
    setPolicy((current) => ({
      ...current,
      simulateOnly: false,
      dryRun: false,
      slippageBps: "10000",
      maxPriceImpactPct: "100",
    }));
    setDegenConfirmOpen(false);
    setDegenConfirmText("");
    toast("Degen mode armed. Save configuration to apply.");
  }

  function disableDegenMode(): void {
    setDegenMode(false);
    if (degenRollback) {
      setPolicy(degenRollback.policy);
      setValidationEnabled(degenRollback.validationEnabled);
    } else {
      setPolicy((current) => ({
        ...current,
        simulateOnly: true,
        dryRun: false,
        slippageBps: "50",
        maxPriceImpactPct: "5",
      }));
      setValidationEnabled(true);
    }
    setDegenRollback(null);
    setDegenConfirmOpen(false);
    setDegenConfirmText("");
    toast("Degen mode disabled. Save configuration to apply.");
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

  function _submitChatShortcut(message: string): void {
    void sendChat(message);
  }

  const _mintLabel = (addr: string): string => {
    for (const [k, v] of Object.entries(WELL_KNOWN_MINTS)) {
      if (v === addr) return k;
    }
    return `${addr.slice(0, 8)}…`;
  };

  const lastEvent = events[0] ?? null;
  const lastEventMs = lastEvent ? Date.parse(lastEvent.ts) : NaN;
  const _isLoopLive =
    Number.isFinite(lastEventMs) && Date.now() - lastEventMs < 20_000;

  const _fmtEventTime = (iso: string): string => {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return iso;
    return new Date(ms).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const fmtBacktestTime = (iso: string | null): string => {
    if (!iso) return "pending";
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return iso;
    return new Date(ms).toLocaleString([], {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const _eventMeta = (event: BotEvent): string | null => {
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

  const _executionMode = policy.dryRun
    ? "Dry run"
    : policy.simulateOnly
      ? "Simulate only"
      : "Live";

  const latestCompletedBacktest = backtestRuns.find(
    (run) => run.status === "completed" && run.summary,
  );
  const visibleBacktests = backtestRuns.slice(0, 10);

  const _chatList = [...chatMessages]
    .filter((entry) => entry.question || entry.answer)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const _chatText = (entry: ChatEntry): string => {
    if (entry.role === "user") return entry.question ?? "";
    return entry.answer ?? "";
  };

  const sourceChipClass =
    "inline-flex items-center rounded-full border border-border px-2 py-1 text-xs text-muted";
  const _renderChatSources = (sources: ChatSource[]): ReactNode[] =>
    sources.map((source) => (
      <code
        className={sourceChipClass}
        key={`${source.type}:${source.id ?? "n"}`}
      >
        {source.label}
      </code>
    ));

  const {
    setWalletBalances,
    setFundAction,
    setRefreshAction,
    setIsRefreshing,
    setShowFundButton,
    setShowBalance,
  } = useDashboard();

  useEffect(() => {
    if (balances) {
      setWalletBalances(balances);
    }
    setFundAction(() => onFund());
    setRefreshAction(() => void refreshLiveData());
    setIsRefreshing(refreshing);
    setShowFundButton(true);
    setShowBalance(true);

    return () => {
      setFundAction(null);
      setRefreshAction(null);
    };
  }, [
    balances,
    refreshing,
    setWalletBalances,
    setFundAction,
    setRefreshAction,
    setIsRefreshing,
    setShowFundButton,
    setShowBalance,
    refreshLiveData,
    onFund,
  ]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  const inferenceConfigured = Boolean(inferenceProvider?.configured);
  const inferenceHealthy =
    inferenceConfigured &&
    !String(inferenceProvider?.lastPingError ?? "").trim();
  const blockedByInferenceRunState =
    _telemetry?.agentRun?.state === "blocked_inference";
  const canStartBot =
    inferenceConfigured && inferenceHealthy && !blockedByInferenceRunState;
  const startBlockedReason = !inferenceConfigured
    ? "Configure inference provider before starting this bot."
    : !inferenceHealthy
      ? (inferenceProvider?.lastPingError ??
        "Inference provider is unhealthy. Test + save a healthy provider first.")
      : blockedByInferenceRunState
        ? (_telemetry?.agentRun?.blockedReason ??
          "Inference provider is unhealthy.")
        : null;
  const agentRun = _telemetry?.agentRun ?? {
    state: (bot.enabled ? "running" : "idle") as
      | "idle"
      | "starting"
      | "running"
      | "blocked_inference"
      | "stopped"
      | "error",
    blockedReason: null,
    currentRunId: null,
    lastTickAt: bot.lastTickAt,
    nextTickAt: null,
    provider: {
      baseUrlHash: null,
      model: null,
      pingAgeMs: null,
      resolutionSource: null,
    },
    steering: {
      pendingCount: steeringMessages.filter((item) => item.status === "pending")
        .length,
      lastAppliedId: null,
    },
    context: {
      compactedAt: null,
      compactedCount: 0,
      messageWindowCount: 0,
    },
  };
  const timelineEntries = [
    ...events.slice(0, 20).map((event, index) => ({
      id: `event:${index}:${event.ts}`,
      ts: event.ts,
      label: event.message,
      detail: event.reason ?? undefined,
    })),
    ...steeringMessages.slice(0, 20).map((item) => ({
      id: `steer:${item.id}`,
      ts: item.appliedAt ?? item.queuedAt,
      label: `Steering ${item.status}`,
      detail: item.message,
    })),
  ]
    .filter((item) => item.ts)
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  const settingsNav: Array<{ id: SettingsSection; label: string }> = [
    { id: "strategy", label: "Strategy" },
    { id: "risk", label: "Risk policy" },
    { id: "inference", label: "Inference" },
  ];

  return (
    // We don't need main here because the layout provides it
    <div className="container mx-auto max-w-[1920px] p-2 flex-1 overflow-hidden flex flex-col">
      <ControlRoomHeader
        bot={bot}
        onStart={onStart}
        onStop={onStop}
        onFund={onFund}
        onOpenSettings={() => setSettingsOpen(true)}
        loading={parentLoading}
        canStart={canStartBot}
        startBlockedReason={startBlockedReason}
        runState={agentRun.state}
        pendingSteering={agentRun.steering.pendingCount}
        nextTickAt={agentRun.nextTickAt}
      />
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className="md:col-span-2">
          <RunStateBanner
            state={agentRun.state}
            blockedReason={agentRun.blockedReason}
            currentRunId={agentRun.currentRunId}
            lastTickAt={agentRun.lastTickAt}
            nextTickAt={agentRun.nextTickAt}
          />
        </div>
        <InferenceHealthCard
          configured={Boolean(inferenceProvider?.configured)}
          model={agentRun.provider.model ?? inferenceProvider?.model ?? null}
          providerBaseUrlHash={agentRun.provider.baseUrlHash}
          pingAgeMs={agentRun.provider.pingAgeMs}
          lastPingError={inferenceProvider?.lastPingError ?? inferenceError}
          onOpenSettings={() => setSettingsOpen(true)}
          onPingCurrent={pingCurrentInference}
          pinging={inferencePinging}
        />
      </div>
      {settingsOpen ? (
        <div className="fixed inset-0 z-50 p-3 md:p-8">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
          />
          <div className="relative mx-auto h-full max-h-[860px] w-full max-w-[1280px] overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl">
            <div className="flex h-full">
              <aside className="w-64 shrink-0 border-r border-border/80 bg-paper p-4">
                <button
                  className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted hover:text-ink"
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                >
                  x
                </button>
                <div className="space-y-2">
                  {settingsNav.map((section) => (
                    <button
                      key={section.id}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2 text-left text-sm",
                        settingsSection === section.id
                          ? "border-border-strong bg-surface text-ink"
                          : "border-transparent text-muted hover:bg-subtle",
                      )}
                      type="button"
                      onClick={() => setSettingsSection(section.id)}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
              </aside>
              <div className="flex min-w-0 flex-1 flex-col bg-surface">
                <div className="border-b border-border/80 px-6 py-4">
                  <h2 className="text-2xl font-semibold text-ink">
                    {settingsSection === "strategy"
                      ? "Strategy configuration"
                      : settingsSection === "risk"
                        ? "Risk policy"
                        : "Inference"}
                  </h2>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  {settingsSection === "strategy" ? (
                    <div className="space-y-5">
                      <div className="grid gap-1 mb-2">
                        <span className="text-xs text-muted">
                          Strategy Type
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {(["agent"] as StrategyType[]).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setStrategyType(t)}
                              className={cn(
                                "px-3 py-1.5 rounded text-xs font-medium border transition-colors",
                                strategyType === t
                                  ? "bg-accent/10 border-accent/40 text-accent"
                                  : "bg-paper border-border text-muted hover:border-border-strong",
                              )}
                            >
                              Agent (Mandate)
                            </button>
                          ))}
                        </div>
                      </div>
                      {strategyType === "dca" ? (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
                          <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                              <span className="text-xs text-muted block mb-1.5">
                                Input Mint
                              </span>
                              <input
                                className={INPUT}
                                value={dca.inputMint}
                                onChange={(e) =>
                                  setDca((p) => ({
                                    ...p,
                                    inputMint: e.target.value,
                                  }))
                                }
                                placeholder="SOL Mint"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs text-muted block mb-1.5">
                                Output Mint
                              </span>
                              <input
                                className={INPUT}
                                value={dca.outputMint}
                                onChange={(e) =>
                                  setDca((p) => ({
                                    ...p,
                                    outputMint: e.target.value,
                                  }))
                                }
                                placeholder="USDC Mint"
                              />
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                              <span className="text-xs text-muted block mb-1.5">
                                Amount
                              </span>
                              <input
                                className={INPUT}
                                value={dca.amount}
                                onChange={(e) =>
                                  setDca((p) => ({
                                    ...p,
                                    amount: e.target.value,
                                  }))
                                }
                                placeholder="1.0"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs text-muted block mb-1.5">
                                Interval (min)
                              </span>
                              <input
                                className={INPUT}
                                value={dca.everyMinutes}
                                onChange={(e) =>
                                  setDca((p) => ({
                                    ...p,
                                    everyMinutes: e.target.value,
                                  }))
                                }
                                placeholder="60"
                              />
                            </label>
                          </div>
                        </div>
                      ) : null}
                      {strategyType === "rebalance" ? (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
                          <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                              <span className="text-xs text-muted block mb-1.5">
                                Base Mint
                              </span>
                              <input
                                className={cn(
                                  INPUT,
                                  "opacity-60 cursor-not-allowed",
                                )}
                                value={rebalance.baseMint}
                                disabled
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs text-muted block mb-1.5">
                                Quote Mint
                              </span>
                              <input
                                className={INPUT}
                                value={rebalance.quoteMint}
                                onChange={(e) =>
                                  setRebalance((p) => ({
                                    ...p,
                                    quoteMint: e.target.value,
                                  }))
                                }
                                placeholder="USDC Mint"
                              />
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                              <span className="text-xs text-muted block mb-1.5">
                                Target Base %
                              </span>
                              <input
                                className={INPUT}
                                value={rebalance.targetBasePct}
                                onChange={(e) =>
                                  setRebalance((p) => ({
                                    ...p,
                                    targetBasePct: e.target.value,
                                  }))
                                }
                                placeholder="50"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs text-muted block mb-1.5">
                                Threshold %
                              </span>
                              <input
                                className={INPUT}
                                value={rebalance.thresholdPct}
                                onChange={(e) =>
                                  setRebalance((p) => ({
                                    ...p,
                                    thresholdPct: e.target.value,
                                  }))
                                }
                                placeholder="1"
                              />
                            </label>
                          </div>
                        </div>
                      ) : null}
                      {strategyType === "agent" ? (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-1">
                          <label className="block">
                            <span className="text-xs text-muted block mb-1.5">
                              System Mandate
                            </span>
                            <textarea
                              className={cn(
                                INPUT,
                                "min-h-[8rem] resize-y font-mono text-xs leading-relaxed",
                              )}
                              value={agent.mandate}
                              onChange={(e) =>
                                setAgent((p) => ({
                                  ...p,
                                  mandate: e.target.value,
                                }))
                              }
                              placeholder="Define the agent's core personality and trading objectives..."
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs text-muted block mb-1.5">
                              Model (optional)
                            </span>
                            <input
                              className={INPUT}
                              value={agent.model}
                              onChange={(e) =>
                                setAgent((p) => ({
                                  ...p,
                                  model: e.target.value,
                                }))
                              }
                              placeholder="Model override"
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {settingsSection === "risk" ? (
                    <div className="space-y-4 max-w-2xl">
                      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-amber-200">
                              Degen mode
                            </p>
                            <p className="mt-1 text-xs text-amber-100/80">
                              Max freedom trading profile. Disables validation
                              start gate and removes most execution guard rails.
                            </p>
                          </div>
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                              degenMode
                                ? "border-rose-500/60 bg-rose-500/20 text-rose-200"
                                : "border-border text-muted",
                            )}
                          >
                            {degenMode ? "ON" : "OFF"}
                          </span>
                        </div>
                        <p className="mt-3 text-[11px] text-amber-100/80">
                          Profile: live execution, 10000 bps slippage, 100%
                          impact cap, no size cap, no mint allowlist, zero SOL
                          reserve, validation gate off.
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          {degenMode ? (
                            <button
                              type="button"
                              className={BTN_SECONDARY}
                              onClick={disableDegenMode}
                            >
                              Disable Degen
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={cn(
                                BTN_PRIMARY,
                                "border-rose-400/40 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30",
                              )}
                              onClick={openDegenConfirmation}
                            >
                              Enable Degen
                            </button>
                          )}
                        </div>

                        {degenConfirmOpen ? (
                          <div className="mt-3 rounded-lg border border-rose-500/50 bg-rose-500/15 p-3">
                            <p className="text-xs text-rose-100">
                              Warning: this can execute high-impact live trades.
                              Type <code>DEGEN</code> to confirm.
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                className={INPUT}
                                value={degenConfirmText}
                                onChange={(event) =>
                                  setDegenConfirmText(event.target.value)
                                }
                                placeholder="Type DEGEN"
                              />
                              <button
                                type="button"
                                className={BTN_SECONDARY}
                                onClick={cancelDegenConfirmation}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  BTN_PRIMARY,
                                  "border-rose-400/40 bg-rose-500/30 text-rose-50 hover:bg-rose-500/40",
                                )}
                                disabled={degenConfirmText.trim() !== "DEGEN"}
                                onClick={confirmEnableDegenMode}
                              >
                                Confirm
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm">Simulate Execution Only</span>
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={policy.simulateOnly}
                            disabled={degenMode}
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
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="text-xs text-muted block mb-1.5">
                            Slippage (bps)
                          </span>
                          <input
                            className={INPUT}
                            value={policy.slippageBps}
                            disabled={degenMode}
                            onChange={(e) =>
                              setPolicy((p) => ({
                                ...p,
                                slippageBps: e.target.value,
                              }))
                            }
                            placeholder="50"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted block mb-1.5">
                            Max Impact (%)
                          </span>
                          <input
                            className={INPUT}
                            value={policy.maxPriceImpactPct}
                            disabled={degenMode}
                            onChange={(e) =>
                              setPolicy((p) => ({
                                ...p,
                                maxPriceImpactPct: e.target.value,
                              }))
                            }
                            placeholder="1"
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                  {settingsSection === "inference" ? (
                    <div className="max-w-3xl">
                      <InferenceSettings
                        initialBaseUrl={
                          inferenceProvider?.baseUrl ||
                          DEFAULT_PROVIDER_BASE_URL
                        }
                        initialModel={
                          inferenceProvider?.model || DEFAULT_PROVIDER_MODEL
                        }
                        saving={inferenceSaving}
                        pinging={inferencePinging}
                        error={inferenceError}
                        onPing={handlePingSettings}
                        onSave={handleSaveSettings}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="border-t border-border/80 bg-surface px-6 py-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">
                    {saving
                      ? "Saving changes..."
                      : configLoaded
                        ? "Configuration loaded"
                        : "Loading..."}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={BTN_SECONDARY}
                      onClick={() => void onTick()}
                      disabled={saving || parentLoading}
                    >
                      Run Loop
                    </button>
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      onClick={() => void saveConfig()}
                      disabled={saving || parentLoading}
                    >
                      Save Configuration
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 mt-2">
        <div className="flex flex-col gap-2 min-h-0 h-full overflow-hidden">
          {/* Top Row: Chart & Metrics */}
          <div className="h-[300px] grid grid-cols-3 gap-2 shrink-0">
            <div className="col-span-2 bg-[var(--color-chart-bg)] border border-border rounded-lg overflow-hidden relative">
              <LiveTicksChart className="h-full w-full opacity-80" />
            </div>
            <div className="col-span-1 bg-surface border border-border rounded-lg p-4 flex flex-col min-h-0">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-xs font-medium text-muted uppercase tracking-wider">
                  Backtests
                </h3>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                    backtestRunningCount > 0
                      ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
                      : "border-border text-muted",
                  )}
                >
                  {backtestRunningCount > 0
                    ? `${backtestRunningCount} running`
                    : "idle"}
                </span>
              </div>

              {latestCompletedBacktest?.summary ? (
                <div className="rounded border border-border/80 bg-paper/30 p-3 mb-3">
                  <div className="text-[11px] text-muted uppercase tracking-wider mb-2">
                    Latest Completed
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <div className="text-muted">PnL</div>
                      <div
                        className={cn(
                          "font-mono",
                          latestCompletedBacktest.summary.netReturnPct >= 0
                            ? "text-emerald-400"
                            : "text-rose-400",
                        )}
                      >
                        {latestCompletedBacktest.summary.netReturnPct >= 0
                          ? "+"
                          : ""}
                        {latestCompletedBacktest.summary.netReturnPct.toFixed(
                          2,
                        )}
                        %
                      </div>
                    </div>
                    <div>
                      <div className="text-muted">Max DD</div>
                      <div className="font-mono text-ink">
                        {latestCompletedBacktest.summary.maxDrawdownPct.toFixed(
                          2,
                        )}
                        %
                      </div>
                    </div>
                    <div>
                      <div className="text-muted">Trades</div>
                      <div className="font-mono text-ink">
                        {latestCompletedBacktest.summary.tradeCount}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded border border-border/80 bg-paper/30 p-3 mb-3 text-sm text-muted italic">
                  No completed backtests yet.
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-2">
                {visibleBacktests.length > 0 ? (
                  visibleBacktests.map((run) => (
                    <button
                      key={run.runId}
                      type="button"
                      onClick={() =>
                        router.push(
                          `/app/bots/${bot.id}/backtests/${run.runId}`,
                        )
                      }
                      className="w-full rounded border border-border/80 bg-paper/20 p-2 text-left hover:border-border-strong hover:bg-paper/30 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono text-muted">
                          {fmtBacktestTime(
                            run.completedAt ?? run.startedAt ?? run.queuedAt,
                          )}
                        </span>
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                            run.status === "completed"
                              ? "border-emerald-500/50 text-emerald-400"
                              : run.status === "failed"
                                ? "border-rose-500/50 text-rose-400"
                                : "border-amber-500/50 text-amber-400",
                          )}
                        >
                          {run.status}
                        </span>
                      </div>
                      <div className="text-xs text-muted mt-1">
                        {run.strategyLabel}
                      </div>
                      {run.summary ? (
                        <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                          <div
                            className={cn(
                              "font-mono",
                              run.summary.netReturnPct >= 0
                                ? "text-emerald-400"
                                : "text-rose-400",
                            )}
                          >
                            {run.summary.netReturnPct >= 0 ? "+" : ""}
                            {run.summary.netReturnPct.toFixed(2)}%
                          </div>
                          <div className="font-mono text-ink">
                            DD {run.summary.maxDrawdownPct.toFixed(2)}%
                          </div>
                          <div className="font-mono text-ink">
                            {run.summary.tradeCount} t
                          </div>
                        </div>
                      ) : null}
                    </button>
                  ))
                ) : (
                  <div className="text-sm text-muted italic py-4 text-center">
                    Backtest history will appear here.
                  </div>
                )}
              </div>

              <div className="mt-3 rounded border border-border/80 bg-paper/30 p-2 text-[11px] text-muted">
                Informational view only. Backtests are started by agent tools or
                admin workflows.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 h-[250px] shrink-0 lg:grid-cols-2">
            <SteeringQueuePanel
              items={steeringMessages}
              loading={steeringBusy}
              onRefresh={refreshSteering}
              onQueue={sendSteering}
            />
            <ActivityTimeline events={timelineEntries} />
          </div>

          {/* Bottom Row: Chat & Thoughts (Split) */}
          <div className="grid grid-cols-2 gap-2 min-h-0 h-[clamp(320px,42vh,420px)] shrink-0">
            <div className="bg-surface border border-border rounded-lg flex flex-col overflow-hidden">
              <div className="p-3 border-b border-border bg-surface/50">
                <h3 className="text-xs font-medium text-muted uppercase tracking-wider">
                  Agent Internal Monologue
                </h3>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <AgentThoughtsLog
                  thoughts={thoughts}
                  className="h-full w-full"
                />
              </div>
            </div>

            <div className="bg-surface border border-border rounded-lg flex flex-col overflow-hidden">
              <div className="p-3 border-b border-border bg-surface/50">
                <h3 className="text-xs font-medium text-muted uppercase tracking-wider">
                  Communication Channel
                </h3>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <AgentChat
                  messages={messages}
                  onSendMessage={handleSendMessage}
                  onSteerMessage={sendSteering}
                  loading={chatBusy}
                  steeringBusy={steeringBusy}
                  className="h-full w-full"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
