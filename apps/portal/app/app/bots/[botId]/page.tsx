"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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

type StrategyType = "noop" | "dca" | "rebalance" | "agent";

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

  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fundOpen, setFundOpen] = useState(false);

  const bot = bots.find((b) => b.id === botId) ?? null;

  const refreshMe = useCallback(async (): Promise<void> => {
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
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void refreshMe();
  }, [ready, authenticated, refreshMe]);

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
            {ready && (
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
  const [policy, setPolicy] = useState<PolicyFields>({
    simulateOnly: true,
    dryRun: false,
    slippageBps: "50",
    // UI uses percent units (e.g. "5" means 5%). API expects decimal (0.05).
    maxPriceImpactPct: "5",
  });
  const [saving, setSaving] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Fetch balance + config in parallel on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (!token || cancelled) return;

      const [balRes, cfgRes] = await Promise.all([
        apiFetchJson(`/api/bots/${bot.id}/balance`, token, {
          method: "GET",
        }).catch(() => null),
        apiFetchJson(`/api/bots/${bot.id}/config`, token, {
          method: "GET",
        }).catch(() => null),
      ]);
      if (cancelled) return;

      // Apply balance
      if (
        isRecord(balRes) &&
        isRecord((balRes as Record<string, unknown>).balances)
      ) {
        setBalances(
          (balRes as Record<string, unknown>).balances as unknown as Balances,
        );
      }

      // Apply config
      if (!isRecord(cfgRes)) {
        if (!balRes) setConfigMsg("Failed to load config");
        return;
      }
      const config = (cfgRes as Record<string, unknown>).config;
      if (!isRecord(config)) return;

      // Load strategy
      const strat = config.strategy;
      if (isRecord(strat)) {
        const t = strat.type as string;
        if (t === "dca" || t === "rebalance" || t === "noop" || t === "agent") {
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
          // Fetch agent memory
          apiFetchJson(`/api/bots/${bot.id}/agent/memory`, token, {
            method: "GET",
          })
            .then((memRes) => {
              if (cancelled) return;
              if (
                isRecord(memRes) &&
                isRecord((memRes as Record<string, unknown>).memory)
              ) {
                setAgentMemory(
                  (memRes as Record<string, unknown>)
                    .memory as unknown as AgentMemoryState,
                );
              }
            })
            .catch(() => {});
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
    })();
    return () => {
      cancelled = true;
    };
  }, [bot.id, getAccessToken]);

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

  const mintLabel = (addr: string): string => {
    for (const [k, v] of Object.entries(WELL_KNOWN_MINTS)) {
      if (v === addr) return k;
    }
    return `${addr.slice(0, 8)}…`;
  };

  return (
    <div className="grid gap-5">
      {/* Bot info */}
      <div className="card card-flat p-6">
        <p className="label">Bot</p>
        <div className="grid gap-2.5 mt-3">
          <div className="grid gap-1">
            <span className="text-muted text-[0.85rem]">Wallet</span>
            <code>{bot.walletAddress}</code>
          </div>
          <div className="grid gap-1">
            <span className="text-muted text-[0.85rem]">Signer</span>
            <code>{bot.signerType}</code>
          </div>
          <div className="grid gap-1">
            <span className="text-muted text-[0.85rem]">Last tick</span>
            <code>{formatTick(bot.lastTickAt)}</code>
          </div>
          {bot.lastError ? (
            <div className="grid gap-1">
              <span className="text-muted text-[0.85rem]">Last error</span>
              <code>{bot.lastError}</code>
            </div>
          ) : null}
        </div>
      </div>

      {/* Wallet balance */}
      <div className="card card-flat p-6">
        <p className="label">Wallet balance</p>
        {balances ? (
          <div className="flex gap-8 mt-3">
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

      {/* Strategy config */}
      {configLoaded ? (
        <>
          <div className="card card-flat p-6">
            <p className="label">Strategy</p>
            <div className="grid gap-4 mt-4">
              <div className="grid gap-1">
                <span className="label">Type</span>
                <div className="radio-group">
                  {(
                    ["noop", "dca", "rebalance", "agent"] as StrategyType[]
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
                              : "Agent"}
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

          {/* Agent thinking feed */}
          {strategyType === "agent" && agentMemory ? (
            <div className="card card-flat p-6">
              <p className="label">Ralph&apos;s Thinking</p>
              <div className="grid gap-4 mt-3">
                <div className="grid gap-1">
                  <span className="label">Thesis</span>
                  <p className="font-mono text-[0.9rem] whitespace-pre-wrap">
                    {agentMemory.thesis || "(no thesis yet)"}
                  </p>
                </div>
                <div className="grid gap-1">
                  <span className="label">Trades today</span>
                  <p className="font-mono">{agentMemory.tradesProposedToday}</p>
                </div>
                {agentMemory.observations.length > 0 ? (
                  <div className="grid gap-1">
                    <span className="label">
                      Recent observations ({agentMemory.observations.length})
                    </span>
                    <div className="grid gap-1.5 max-h-48 overflow-y-auto">
                      {agentMemory.observations
                        .slice(-10)
                        .reverse()
                        .map((o) => (
                          <div
                            key={o.ts}
                            className="text-[0.85rem] font-mono border-l border-border pl-3"
                          >
                            <span className="text-muted text-[0.75rem]">
                              [{o.category}]
                            </span>{" "}
                            {o.content}
                          </div>
                        ))}
                    </div>
                  </div>
                ) : null}
                {agentMemory.reflections.length > 0 ? (
                  <div className="grid gap-1">
                    <span className="label">
                      Learnings ({agentMemory.reflections.length})
                    </span>
                    <div className="grid gap-1 max-h-32 overflow-y-auto">
                      {agentMemory.reflections
                        .slice(-5)
                        .reverse()
                        .map((r) => (
                          <p key={r} className="text-[0.85rem] font-mono">
                            {r}
                          </p>
                        ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Policy */}
          <div className="card card-flat p-6">
            <p className="label">Policy</p>
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

          {/* Actions */}
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
              Test tick
            </button>
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
  );
}
