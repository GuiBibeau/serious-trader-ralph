"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  createRecipient,
  createSPLToken,
  encodeURL,
} from "@solana-commerce/kit";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "../cn";
import { FundingModal } from "../funding-modal";
import {
  apiFetchJson,
  type Bot,
  BTN_PRIMARY,
  BTN_SECONDARY,
  formatTick,
  isRecord,
} from "../lib";
import { FadeUp, PillPop, PresenceCard, Skeleton } from "../motion";

type Trade = {
  id: number;
  tenantId: string;
  runId: string | null;
  venue: string | null;
  market: string | null;
  side: string | null;
  size: string | null;
  price: string | null;
  status: string | null;
  logKey: string | null;
  signature: string | null;
  createdAt: string;
};

type FinancialProfile = {
  annualIncome: string;
  liquidNetWorth: string;
  investmentExperience: string;
  riskTolerance: string;
  investmentGoal: string;
  cryptoExperience: string;
  timeHorizon: string;
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

type BillingPlan = {
  id: string;
  name: string;
  description: string;
  amountUsd: number;
  amountDecimal: string;
  amountAtomic: string;
  currency: string;
  mint: string;
  interval: string;
  features: string[];
};

type CheckoutIntent = {
  id: string;
  planId: string;
  status: "pending" | "verified" | "expired";
  expiresAt: string;
  payment: {
    recipient: string;
    amountDecimal: string;
    amountAtomic: string;
    currency: "USDC" | "SOL";
    splToken: string | null;
    reference: string;
    label: string;
    message: string;
    memo: string;
  };
};

type Balances = {
  sol: { lamports: string; display: string };
  usdc: { atomic: string; display: string };
};

const PROFILE_KEY = "str-financial-profile";
const ONBOARDING_KEY = "str-onboarding-complete";

const PROFILE_FIELDS: {
  key: keyof FinancialProfile;
  label: string;
  options: string[];
}[] = [
  {
    key: "annualIncome",
    label: "Annual income",
    options: [
      "Less than $25,000",
      "$25,000 – $50,000",
      "$50,000 – $100,000",
      "$100,000 – $250,000",
      "More than $250,000",
    ],
  },
  {
    key: "liquidNetWorth",
    label: "Liquid net worth",
    options: [
      "Less than $10,000",
      "$10,000 – $50,000",
      "$50,000 – $100,000",
      "$100,000 – $500,000",
      "More than $500,000",
    ],
  },
  {
    key: "investmentExperience",
    label: "Investment experience",
    options: ["None", "Beginner", "Intermediate", "Advanced", "Professional"],
  },
  {
    key: "riskTolerance",
    label: "Risk tolerance",
    options: [
      "Conservative",
      "Moderately conservative",
      "Moderate",
      "Aggressive",
      "Very aggressive",
    ],
  },
  {
    key: "investmentGoal",
    label: "Investment goal",
    options: [
      "Capital preservation",
      "Income generation",
      "Growth",
      "Speculation",
      "Learning / experimentation",
    ],
  },
  {
    key: "cryptoExperience",
    label: "Crypto experience",
    options: ["None", "Beginner", "Intermediate", "Advanced"],
  },
  {
    key: "timeHorizon",
    label: "Time horizon",
    options: [
      "Less than 1 month",
      "1 – 6 months",
      "6 – 12 months",
      "1 – 3 years",
      "No specific timeline",
    ],
  },
];

const emptyProfile: FinancialProfile = {
  annualIncome: "",
  liquidNetWorth: "",
  investmentExperience: "",
  riskTolerance: "",
  investmentGoal: "",
  cryptoExperience: "",
  timeHorizon: "",
};

function loadProfile(): FinancialProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { ...emptyProfile };
    return {
      ...emptyProfile,
      ...(JSON.parse(raw) as Partial<FinancialProfile>),
    };
  } catch {
    return { ...emptyProfile };
  }
}

export default function AppPage() {
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

const STEP_LABELS = ["Profile", "Billing", "Agent", "Fund"];

function WizardProgress({ step }: { step: number }) {
  return (
    <div className="flex items-center mb-10">
      {STEP_LABELS.map((label, i) => {
        const num = i + 1;
        return (
          <div key={label} className="contents">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-8 h-8 rounded-full border border-border flex items-center justify-center text-xs font-semibold shrink-0",
                  num < step && "bg-ink text-surface border-ink",
                  num === step && "bg-accent-soft border-accent text-ink",
                  num > step && "bg-surface text-muted",
                )}
              >
                {num}
              </div>
              <span className="text-xs text-muted font-medium whitespace-nowrap">
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className="flex-1 h-px bg-border-strong mx-3 min-w-6" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ControlRoom() {
  const { ready, authenticated, logout, getAccessToken } = usePrivy();
  const router = useRouter();

  const [bots, setBots] = useState<Bot[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [botsLoaded, setBotsLoaded] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("byok_annual");
  const [selectedPaymentAsset, setSelectedPaymentAsset] = useState<
    "USDC" | "SOL"
  >("USDC");
  const [checkoutIntent, setCheckoutIntent] = useState<CheckoutIntent | null>(
    null,
  );
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [walletBalances, setWalletBalances] = useState<Balances | null>(null);

  // Funding modal
  const [fundOpen, setFundOpen] = useState(false);

  // Wizard state
  const [wizardStep, setWizardStep] = useState(1);
  const [profile, setProfile] = useState<FinancialProfile>(loadProfile);
  const [createdBot, setCreatedBot] = useState<Bot | null>(null);

  const bot = bots[0] ?? null;

  const profileComplete = PROFILE_FIELDS.every((f) => profile[f.key] !== "");

  const refresh = useCallback(async (): Promise<void> => {
    if (!authenticated) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const [payload, plansPayload] = await Promise.all([
        apiFetchJson("/api/me", token, { method: "GET" }),
        apiFetchJson("/api/billing/plans", token, { method: "GET" }),
      ]);

      const nextBotsRaw = isRecord(payload) ? payload.bots : null;
      const nextBots = Array.isArray(nextBotsRaw) ? (nextBotsRaw as Bot[]) : [];
      setBots(nextBots);
      setBotsLoaded(true);

      const subscriptionRaw = isRecord(payload) ? payload.subscription : null;
      if (
        isRecord(subscriptionRaw) &&
        (subscriptionRaw.status === "active" ||
          subscriptionRaw.status === "inactive")
      ) {
        setSubscription(subscriptionRaw as unknown as Subscription);
      } else {
        setSubscription(null);
      }

      const plansRaw = isRecord(plansPayload) ? plansPayload.plans : null;
      const plans = Array.isArray(plansRaw)
        ? (plansRaw.filter((p) => isRecord(p)) as BillingPlan[])
        : [];
      setBillingPlans(plans);
      if (!plans.some((p) => p.id === selectedPlanId) && plans.length > 0) {
        setSelectedPlanId(plans[0].id);
      }

      // Hydrate profile from API if available
      const userRaw = isRecord(payload) ? payload.user : null;
      const apiProfile =
        isRecord(userRaw) && isRecord(userRaw.profile)
          ? (userRaw.profile as Partial<FinancialProfile>)
          : null;
      if (apiProfile) {
        const merged = { ...emptyProfile, ...apiProfile };
        setProfile(merged);
        localStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setBotsLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken, selectedPlanId]);

  const refreshTrades = useCallback(
    async (botId: string): Promise<void> => {
      if (!authenticated) return;
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("missing-access-token");
        const payload = await apiFetchJson(
          `/api/bots/${botId}/trades?limit=25`,
          token,
          { method: "GET" },
        );
        const nextTradesRaw = isRecord(payload) ? payload.trades : null;
        const nextTrades = Array.isArray(nextTradesRaw)
          ? (nextTradesRaw as Trade[])
          : [];
        setTrades(nextTrades);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [authenticated, getAccessToken],
  );

  const refreshWalletBalances = useCallback(
    async (botId: string): Promise<void> => {
      if (!authenticated) return;
      try {
        const token = await getAccessToken();
        if (!token) return;
        const payload = await apiFetchJson(`/api/bots/${botId}/balance`, token, {
          method: "GET",
        });
        const balancesRaw = isRecord(payload) ? payload.balances : null;
        if (
          isRecord(balancesRaw) &&
          isRecord(balancesRaw.sol) &&
          isRecord(balancesRaw.usdc)
        ) {
          setWalletBalances(balancesRaw as unknown as Balances);
        }
      } catch {
        // Keep the latest known balance in the navbar on transient failures.
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
    if (!bot) return;
    void refreshTrades(bot.id);
  }, [bot, refreshTrades]);

  useEffect(() => {
    if (!bot) {
      setWalletBalances(null);
      return;
    }
    void refreshWalletBalances(bot.id);
    const timer = window.setInterval(() => {
      void refreshWalletBalances(bot.id);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [bot, refreshWalletBalances]);

  useEffect(() => {
    if (wizardStep === 1 && profileComplete) {
      setWizardStep(subscription?.active ? 3 : 2);
      return;
    }
    if (wizardStep === 2 && subscription?.active) {
      setWizardStep(3);
    }
  }, [wizardStep, profileComplete, subscription?.active]);

  // Step 3: auto-create bot on mount
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!botsLoaded || bots.length > 0) return;
    if (wizardStep !== 3 || creating || createdBot) return;
    setCreating(true);
    (async () => {
      setMessage(null);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("missing-access-token");
        const payload = await apiFetchJson("/api/bots", token, {
          method: "POST",
          body: JSON.stringify({ name: "Ralph" }),
        });
        const botRaw = isRecord(payload) ? payload.bot : null;
        if (!isRecord(botRaw) || typeof botRaw.id !== "string")
          throw new Error("bot-create-failed");
        setCreatedBot(botRaw as unknown as Bot);
        await refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setCreating(false);
      }
    })();
  }, [
    botsLoaded,
    bots.length,
    wizardStep,
    creating,
    createdBot,
    getAccessToken,
    refresh,
  ]);

  function handleProfileChange(key: keyof FinancialProfile, value: string) {
    setProfile((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function saveProfileAndContinue(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson("/api/me/profile", token, {
        method: "PATCH",
        body: JSON.stringify({ profile }),
      });
      setWizardStep(subscription?.active ? 3 : 2);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function finishOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, "true");
    // Force re-render into dashboard by refreshing bots
    void refresh();
  }

  const buildSolanaPayUrl = useCallback((intent: CheckoutIntent): string => {
    const fields: {
      recipient: ReturnType<typeof createRecipient>;
      amount: bigint;
      reference: ReturnType<typeof createRecipient>;
      label: string;
      message: string;
      memo: string;
      splToken?: ReturnType<typeof createSPLToken>;
    } = {
      recipient: createRecipient(intent.payment.recipient),
      amount: BigInt(intent.payment.amountAtomic),
      reference: createRecipient(intent.payment.reference),
      label: intent.payment.label,
      message: intent.payment.message,
      memo: intent.payment.memo,
    };
    if (intent.payment.splToken) {
      fields.splToken = createSPLToken(intent.payment.splToken);
    }
    const url = encodeURL(fields);
    url.searchParams.set("cluster", "devnet");
    return url.toString();
  }, []);

  async function beginCheckout(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const payload = await apiFetchJson("/api/billing/checkout", token, {
        method: "POST",
        body: JSON.stringify({
          planId: selectedPlanId,
          paymentAsset: selectedPaymentAsset,
        }),
      });
      const intentRaw = isRecord(payload) ? payload.intent : null;
      if (
        !isRecord(intentRaw) ||
        typeof intentRaw.id !== "string" ||
        !isRecord(intentRaw.payment)
      ) {
        throw new Error("billing-intent-create-failed");
      }
      const intent = intentRaw as unknown as CheckoutIntent;
      setCheckoutIntent(intent);
      setCheckoutUrl(buildSolanaPayUrl(intent));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const checkCheckoutStatus = useCallback(
    async (intentId?: string): Promise<void> => {
      const id = intentId ?? checkoutIntent?.id;
      if (!id) return;
      setCheckingPayment(true);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("missing-access-token");
        const payload = await apiFetchJson(
          `/api/billing/checkout/${id}`,
          token,
          {
            method: "GET",
          },
        );
        const intentRaw = isRecord(payload) ? payload.intent : null;
        if (
          isRecord(intentRaw) &&
          typeof intentRaw.id === "string" &&
          isRecord(intentRaw.payment)
        ) {
          const intent = intentRaw as unknown as CheckoutIntent;
          setCheckoutIntent(intent);
          setCheckoutUrl(buildSolanaPayUrl(intent));
        }

        const subRaw = isRecord(payload) ? payload.subscription : null;
        if (
          isRecord(subRaw) &&
          (subRaw.status === "active" || subRaw.status === "inactive")
        ) {
          const sub = subRaw as unknown as Subscription;
          setSubscription(sub);
          if (sub.active) {
            setMessage("Payment verified. Subscription is active.");
            setWizardStep(3);
          }
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setCheckingPayment(false);
      }
    },
    [checkoutIntent?.id, getAccessToken, buildSolanaPayUrl],
  );

  useEffect(() => {
    if (!checkoutIntent || checkoutIntent.status !== "pending") return;
    const timer = window.setInterval(() => {
      void checkCheckoutStatus(checkoutIntent.id);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [checkoutIntent, checkCheckoutStatus]);

  async function startBot(botId: string): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${botId}/start`, token, { method: "POST" });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
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

  async function tickBot(botId: string): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${botId}/tick`, token, { method: "POST" });
      await Promise.all([refresh(), refreshTrades(botId)]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const showWizard = botsLoaded && bots.length === 0;
  const showDashboard = botsLoaded && bots.length > 0;
  const selectedPlan =
    billingPlans.find((p) => p.id === selectedPlanId) ?? null;
  const shouldRedirectToCheckout =
    ready &&
    authenticated &&
    showDashboard &&
    bot &&
    subscription != null &&
    !subscription.active;

  useEffect(() => {
    if (!shouldRedirectToCheckout) return;
    router.replace(
      `/checkout?plan=${selectedPlanId}&asset=${selectedPaymentAsset}&pay=1`,
    );
  }, [shouldRedirectToCheckout, router, selectedPlanId, selectedPaymentAsset]);

  return (
    <main>
      <div className="sticky top-0 z-10 bg-paper border-b border-border py-4">
        <div className="w-[min(1120px,92vw)] mx-auto flex items-center justify-between gap-4">
          <a href="/" className="text-sm font-semibold tracking-tight">
            Serious Trader Ralph
          </a>
          <div className="flex items-center justify-end gap-3 flex-wrap">
            {ready && authenticated && (
              <>
                {bot && (
                  <span className="inline-flex items-center rounded-full border border-border bg-surface px-2.5 py-1 text-[0.8rem] text-muted whitespace-nowrap">
                    {walletBalances
                      ? `${walletBalances.sol.display} SOL · ${walletBalances.usdc.display} USDC`
                      : "Balance —"}
                  </span>
                )}
                {bot && (
                  <button
                    className={BTN_PRIMARY}
                    onClick={() => setFundOpen(true)}
                    type="button"
                  >
                    Fund
                  </button>
                )}
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

      {(bot || createdBot) && (
        <FundingModal
          key={String(fundOpen)}
          walletAddress={bot?.walletAddress ?? createdBot?.walletAddress ?? ""}
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

          {!ready || !botsLoaded ? (
            <div>
              <h1>Loading…</h1>
            </div>
          ) : shouldRedirectToCheckout ? (
            <div>
              <h1>Redirecting to checkout…</h1>
            </div>
          ) : showWizard ? (
            <div>
              <FadeUp>
                <h1>Set up Ralph</h1>
              </FadeUp>
              <p className="text-muted mt-4 max-w-[600px]">
                Answer a few questions, then we&apos;ll create your trading
                agent and generate a dedicated wallet.
              </p>

              <div className="mt-8">
                <WizardProgress step={wizardStep} />

                {/* Step 1: Financial Profile */}
                <PresenceCard show={wizardStep === 1}>
                  <div className="card card-flat p-6">
                    <p className="label">Financial profile</p>
                    <p className="text-muted mt-2 mb-5">
                      Standard investment suitability questions. All fields
                      required.
                    </p>
                    <div className="grid gap-3">
                      {PROFILE_FIELDS.map((field) => (
                        <div key={field.key}>
                          <label
                            className="label mb-1 block"
                            htmlFor={`profile-${field.key}`}
                          >
                            {field.label}
                          </label>
                          <select
                            id={`profile-${field.key}`}
                            className="input"
                            value={profile[field.key]}
                            onChange={(e) =>
                              handleProfileChange(field.key, e.target.value)
                            }
                          >
                            <option value="" disabled>
                              Select…
                            </option>
                            {field.options.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        <button
                          className={BTN_PRIMARY}
                          disabled={!profileComplete || loading}
                          onClick={() => void saveProfileAndContinue()}
                          type="button"
                        >
                          Continue
                        </button>
                      </div>
                    </div>
                  </div>
                </PresenceCard>

                {/* Step 2: Billing */}
                <PresenceCard show={wizardStep === 2}>
                  <div className="card card-flat p-6">
                    <p className="label">Annual license</p>
                    <h2 className="mt-2.5">Pay in USDC or SOL on Solana</h2>
                    <p className="text-muted mt-3 max-w-[560px]">
                      Choose BYOK or Hobbyist. We generate a Solana Pay request
                      and verify your on-chain transfer automatically.
                    </p>
                    <div className="grid gap-3 mt-5">
                      {billingPlans.length === 0 ? (
                        <div className="mt-2 grid gap-3">
                          <Skeleton height="1.2rem" width="70%" />
                          <Skeleton height="1.2rem" width="55%" />
                        </div>
                      ) : (
                        billingPlans.map((plan) => (
                          <button
                            key={plan.id}
                            type="button"
                            onClick={() => {
                              if (selectedPlanId !== plan.id) {
                                setCheckoutIntent(null);
                                setCheckoutUrl("");
                              }
                              setSelectedPlanId(plan.id);
                            }}
                            className={cn(
                              "text-left rounded-md border p-4 transition-colors",
                              selectedPlanId === plan.id
                                ? "border-accent bg-accent-soft"
                                : "border-border bg-surface hover:bg-paper",
                            )}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <strong>{plan.name}</strong>
                              <span className="text-sm font-semibold">
                                ${plan.amountUsd}/year
                              </span>
                            </div>
                            <p className="text-muted text-sm mt-1">
                              {plan.description}
                            </p>
                            <p className="text-muted text-xs mt-2">
                              {plan.amountDecimal} {plan.currency} • SPL mint{" "}
                              {plan.mint}
                            </p>
                          </button>
                        ))
                      )}
                    </div>

                    <div className="mt-5">
                      <p className="label">Pay with</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {(["USDC", "SOL"] as const).map((asset) => (
                          <button
                            key={asset}
                            type="button"
                            className={cn(
                              BTN_SECONDARY,
                              selectedPaymentAsset === asset &&
                                "!border-accent !bg-accent-soft",
                            )}
                            onClick={() => {
                              if (selectedPaymentAsset !== asset) {
                                setCheckoutIntent(null);
                                setCheckoutUrl("");
                              }
                              setSelectedPaymentAsset(asset);
                            }}
                          >
                            {asset}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 mt-5">
                      <button
                        className={BTN_PRIMARY}
                        onClick={() => void beginCheckout()}
                        disabled={
                          loading ||
                          subscription?.active === true ||
                          !selectedPlan
                        }
                        type="button"
                      >
                        {loading ? "Preparing…" : "Generate payment request"}
                      </button>
                      {checkoutIntent && !subscription?.active && (
                        <button
                          className={BTN_SECONDARY}
                          onClick={() => void checkCheckoutStatus()}
                          disabled={checkingPayment}
                          type="button"
                        >
                          {checkingPayment ? "Checking…" : "I paid, check now"}
                        </button>
                      )}
                      {subscription?.active && (
                        <button
                          className={BTN_PRIMARY}
                          onClick={() => setWizardStep(3)}
                          type="button"
                        >
                          Continue
                        </button>
                      )}
                    </div>

                    {checkoutIntent && checkoutUrl && !subscription?.active && (
                      <div className="mt-6 rounded-md border border-border bg-paper p-4">
                        <p className="label">Checkout request</p>
                        <p className="text-muted text-sm mt-1">
                          Send exactly {checkoutIntent.payment.amountDecimal}{" "}
                          {checkoutIntent.payment.currency} before{" "}
                          {checkoutIntent.expiresAt}.
                        </p>
                        <div className="flex justify-center mt-4">
                          <QRCodeSVG
                            value={checkoutUrl}
                            size={180}
                            level="M"
                            bgColor="transparent"
                            fgColor="var(--color-ink)"
                          />
                        </div>
                        <div className="grid gap-1 mt-4">
                          <span className="text-muted text-[0.85rem]">
                            Recipient
                          </span>
                          <code>{checkoutIntent.payment.recipient}</code>
                        </div>
                        <div className="grid gap-1 mt-3">
                          <span className="text-muted text-[0.85rem]">
                            Solana Pay URL
                          </span>
                          <code className="break-all">{checkoutUrl}</code>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-4">
                          <a
                            className={BTN_SECONDARY}
                            href={checkoutUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in wallet
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </PresenceCard>

                {/* Step 3: Create Agent */}
                <PresenceCard show={wizardStep === 3}>
                  <div className="card card-flat p-6">
                    <p className="label">Create agent</p>
                    {!createdBot ? (
                      <div className="mt-4 grid gap-3">
                        <Skeleton height="1.2rem" width="70%" />
                        <Skeleton height="1rem" width="50%" />
                        <Skeleton
                          height="2.5rem"
                          width="40%"
                          style={{ marginTop: "0.5rem" }}
                        />
                      </div>
                    ) : (
                      <div className="mt-4">
                        <h2 className="mt-1.5">Ralph is ready</h2>
                        <div className="grid gap-2.5 mt-4">
                          <div className="grid gap-1">
                            <span className="text-muted text-[0.85rem]">
                              Wallet address
                            </span>
                            <code>{createdBot.walletAddress}</code>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-5">
                          <button
                            className={BTN_PRIMARY}
                            onClick={() => setWizardStep(4)}
                            type="button"
                          >
                            Continue
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </PresenceCard>

                {/* Step 4: Fund Wallet */}
                <PresenceCard show={wizardStep === 4}>
                  <div className="card card-flat p-6">
                    <p className="label">Fund wallet</p>
                    <h2 className="mt-2.5">Send SOL or USDC to your agent</h2>
                    <p className="text-muted mt-3 max-w-[520px]">
                      Fund your agent with SOL (for fees) and USDC (for
                      trading). You can always fund later from the dashboard.
                    </p>
                    <div className="flex flex-wrap items-center gap-3 mt-5">
                      <button
                        className={BTN_PRIMARY}
                        onClick={() => setFundOpen(true)}
                        type="button"
                      >
                        Fund your bot
                      </button>
                      <button
                        className={BTN_SECONDARY}
                        onClick={finishOnboarding}
                        type="button"
                      >
                        Skip to dashboard
                      </button>
                    </div>
                    <p className="text-muted text-[0.85rem] mt-3">
                      You can fund later — this step is not blocking.
                    </p>
                  </div>
                </PresenceCard>
              </div>
            </div>
          ) : showDashboard && bot ? (
            <div>
              {/* Agent status card */}
              <FadeUp delay={0.1}>
                <div className="card p-6 mt-8">
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <p className="label">Agent</p>
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
                  </div>
                  <h2 className="mt-1.5">{bot.name}</h2>
                  <div className="grid gap-2.5 mt-4">
                    <div className="grid gap-1">
                      <span className="text-muted text-[0.85rem]">
                        Subscription
                      </span>
                      <code>
                        {subscription?.active
                          ? (subscription.planName ?? "Active")
                          : "Inactive"}
                      </code>
                    </div>
                    <div className="grid gap-1">
                      <span className="text-muted text-[0.85rem]">Wallet</span>
                      <code>{bot.walletAddress}</code>
                    </div>
                    <div className="grid gap-1">
                      <span className="text-muted text-[0.85rem]">
                        Last tick
                      </span>
                      <code>{formatTick(bot.lastTickAt)}</code>
                    </div>
                    <div className="grid gap-1">
                      <span className="text-muted text-[0.85rem]">Trades</span>
                      <code>{trades.length}</code>
                    </div>
                    {bot.lastError ? (
                      <div className="grid gap-1">
                        <span className="text-muted text-[0.85rem]">
                          Last error
                        </span>
                        <code>{bot.lastError}</code>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 mt-6">
                    {bot.enabled ? (
                      <button
                        className={BTN_SECONDARY}
                        onClick={() => void stopBot(bot.id)}
                        disabled={loading || !subscription?.active}
                        type="button"
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        className={BTN_PRIMARY}
                        onClick={() => void startBot(bot.id)}
                        disabled={loading || !subscription?.active}
                        type="button"
                      >
                        Start
                      </button>
                    )}
                    <button
                      className={BTN_SECONDARY}
                      onClick={() => void tickBot(bot.id)}
                      disabled={loading || !subscription?.active}
                      type="button"
                    >
                      Tick now
                    </button>
                    <button
                      className={BTN_SECONDARY}
                      onClick={() => router.push(`/app/bots/${bot.id}`)}
                      disabled={loading}
                      type="button"
                    >
                      Open workspace
                    </button>
                  </div>
                </div>
              </FadeUp>

              {/* Funding reminder when no trades */}
              <PresenceCard show={trades.length === 0}>
                <div className="card card-flat p-6 mt-6 border border-accent/30">
                  <p className="label">Funding</p>
                  <p className="text-muted mt-1.5">
                    Your agent hasn&apos;t made any trades yet. Make sure the
                    wallet is funded with SOL or USDC, then start the agent.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 mt-3">
                    <button
                      className={BTN_PRIMARY}
                      onClick={() => setFundOpen(true)}
                      type="button"
                    >
                      Fund your bot
                    </button>
                  </div>
                </div>
              </PresenceCard>

              {/* Recent trades */}
              <FadeUp delay={0.2}>
                <div className="card card-flat p-6 mt-6">
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <p className="label">Recent trades</p>
                    <button
                      className={cn(BTN_SECONDARY, "!px-3 !py-1.5 !text-xs")}
                      onClick={() => void refreshTrades(bot.id)}
                      disabled={loading}
                      type="button"
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="mt-4">
                    {trades.length === 0 ? (
                      <p className="text-muted">
                        No trades yet. Start the agent after funding.
                      </p>
                    ) : (
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <th className="border border-border px-3 py-2.5 text-left text-xs font-semibold text-muted bg-surface">
                              Time
                            </th>
                            <th className="border border-border px-3 py-2.5 text-left text-xs font-semibold text-muted bg-surface">
                              Market
                            </th>
                            <th className="border border-border px-3 py-2.5 text-left text-xs font-semibold text-muted bg-surface">
                              Side
                            </th>
                            <th className="border border-border px-3 py-2.5 text-left text-xs font-semibold text-muted bg-surface">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {trades.map((t) => (
                            <tr key={t.id}>
                              <td className="border border-border px-3 py-2.5 text-muted text-[0.85rem] align-top">
                                {t.createdAt}
                              </td>
                              <td className="border border-border px-3 py-2.5 text-[0.85rem] align-top">
                                {t.market ?? "—"}
                              </td>
                              <td className="border border-border px-3 py-2.5 text-[0.85rem] align-top">
                                {t.side ?? "—"}
                              </td>
                              <td className="border border-border px-3 py-2.5 text-[0.85rem] align-top">
                                <span className="inline-flex items-center px-2 py-1 rounded-full border border-border text-xs font-medium text-muted bg-surface">
                                  {t.status ?? "—"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </FadeUp>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
