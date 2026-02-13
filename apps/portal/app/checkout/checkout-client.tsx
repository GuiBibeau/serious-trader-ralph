"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  createRecipient,
  createSPLToken,
  encodeURL,
} from "@solana-commerce/kit";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetchJson, BTN_PRIMARY, BTN_SECONDARY, isRecord } from "../lib";

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

export default function CheckoutPage() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [message, setMessage] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("byok_annual");
  const [selectedPaymentAsset, setSelectedPaymentAsset] = useState<
    "USDC" | "SOL"
  >("USDC");
  const [modalOpen, setModalOpen] = useState(false);
  const [intentLoading, setIntentLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [intent, setIntent] = useState<CheckoutIntent | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const planFromUrl = searchParams.get("plan");
  const assetFromUrl = searchParams.get("asset");
  const payFromUrl = searchParams.get("pay") === "1";

  const safeMessage = useMemo(() => {
    if (!message) return null;
    if (message === "missing-access-token") {
      return "Session expired. Reconnect email to continue.";
    }
    return message;
  }, [message]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  const replaceCheckoutQuery = useCallback(
    (updates: { plan?: string; asset?: "USDC" | "SOL"; pay?: "1" | null }) => {
      const next = new URLSearchParams(searchParams.toString());
      if (updates.plan) next.set("plan", updates.plan);
      if (updates.asset) next.set("asset", updates.asset);
      if (updates.pay === "1") next.set("pay", "1");
      if (updates.pay === null) next.delete("pay");
      const nextQuery = next.toString();
      const currentQuery = searchParams.toString();
      if (nextQuery === currentQuery) return;
      router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}`, {
        scroll: false,
      });
    },
    [searchParams, pathname, router],
  );

  useEffect(() => {
    if (planFromUrl && planFromUrl !== selectedPlanId) {
      setSelectedPlanId(planFromUrl);
    }
    if (
      (assetFromUrl === "USDC" || assetFromUrl === "SOL") &&
      assetFromUrl !== selectedPaymentAsset
    ) {
      setSelectedPaymentAsset(assetFromUrl);
    }
  }, [planFromUrl, assetFromUrl, selectedPlanId, selectedPaymentAsset]);

  useEffect(() => {
    if (!authenticated || subscription?.active) return;
    if (payFromUrl && !modalOpen) setModalOpen(true);
  }, [authenticated, subscription?.active, payFromUrl, modalOpen]);

  const buildSolanaPayUrl = useCallback((input: CheckoutIntent): string => {
    const fields: {
      recipient: ReturnType<typeof createRecipient>;
      amount: bigint;
      reference: ReturnType<typeof createRecipient>;
      label: string;
      message: string;
      memo: string;
      splToken?: ReturnType<typeof createSPLToken>;
    } = {
      recipient: createRecipient(input.payment.recipient),
      amount: BigInt(input.payment.amountAtomic),
      reference: createRecipient(input.payment.reference),
      label: input.payment.label,
      message: input.payment.message,
      memo: input.payment.memo,
    };
    if (input.payment.splToken) {
      fields.splToken = createSPLToken(input.payment.splToken);
    }
    const url = encodeURL(fields);
    url.searchParams.set("cluster", "devnet");
    return url.toString();
  }, []);

  const getTokenSafe = useCallback(async (): Promise<string | null> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await getAccessToken();
      if (token) {
        if (needsReauth) setNeedsReauth(false);
        return token;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    setNeedsReauth(true);
    setMessage("Session expired. Reconnect email to continue.");
    return null;
  }, [getAccessToken, needsReauth]);

  const refreshBillingState = useCallback(async (): Promise<void> => {
    if (!authenticated) return;
    try {
      const token = await getTokenSafe();
      if (!token) return;
      const payload = await apiFetchJson("/api/billing/plans", token, {
        method: "GET",
      });
      const plansRaw = isRecord(payload) ? payload.plans : null;
      const nextPlans = Array.isArray(plansRaw)
        ? (plansRaw.filter((p) => isRecord(p)) as BillingPlan[])
        : [];
      setPlans(nextPlans);
      if (!nextPlans.some((p) => p.id === selectedPlanId) && nextPlans[0]) {
        setSelectedPlanId(nextPlans[0].id);
        replaceCheckoutQuery({ plan: nextPlans[0].id });
      }
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
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, [authenticated, getTokenSafe, replaceCheckoutQuery, selectedPlanId]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void refreshBillingState();
  }, [ready, authenticated, refreshBillingState]);

  const createIntent = useCallback(async (): Promise<void> => {
    if (!authenticated || !selectedPlan) return;
    setIntentLoading(true);
    setMessage(null);
    try {
      const token = await getTokenSafe();
      if (!token) return;
      const payload = await apiFetchJson("/api/billing/checkout", token, {
        method: "POST",
        body: JSON.stringify({
          planId: selectedPlan.id,
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
      const nextIntent = intentRaw as unknown as CheckoutIntent;
      setIntent(nextIntent);
      setCheckoutUrl(buildSolanaPayUrl(nextIntent));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setIntent(null);
      setCheckoutUrl("");
    } finally {
      setIntentLoading(false);
    }
  }, [
    authenticated,
    selectedPlan,
    selectedPaymentAsset,
    getTokenSafe,
    buildSolanaPayUrl,
  ]);

  const checkStatus = useCallback(async (): Promise<void> => {
    if (!authenticated || !intent) return;
    setChecking(true);
    try {
      const token = await getTokenSafe();
      if (!token) return;
      const payload = await apiFetchJson(
        `/api/billing/checkout/${intent.id}`,
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
        const nextIntent = intentRaw as unknown as CheckoutIntent;
        setIntent(nextIntent);
        setCheckoutUrl(buildSolanaPayUrl(nextIntent));
      }
      const subRaw = isRecord(payload) ? payload.subscription : null;
      if (
        isRecord(subRaw) &&
        (subRaw.status === "active" || subRaw.status === "inactive")
      ) {
        const sub = subRaw as unknown as Subscription;
        setSubscription(sub);
        if (sub.active) {
          setModalOpen(false);
          replaceCheckoutQuery({ pay: null });
          setMessage("Payment verified. License is active.");
        }
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, [
    authenticated,
    intent,
    getTokenSafe,
    buildSolanaPayUrl,
    replaceCheckoutQuery,
  ]);

  useEffect(() => {
    if (!modalOpen) return;
    if (!authenticated) return;
    void createIntent();
  }, [modalOpen, authenticated, createIntent]);

  useEffect(() => {
    if (!modalOpen || !intent || intent.status !== "pending") return;
    const timer = window.setInterval(() => {
      void checkStatus();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [modalOpen, intent, checkStatus]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    if (!subscription?.active) return;
    router.replace("/app");
  }, [ready, authenticated, subscription?.active, router]);

  return (
    <main>
      <section className="py-[clamp(3rem,6vw,6rem)]">
        <div className="w-[min(1180px,94vw)] mx-auto grid gap-8">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <div>
              <p className="label">Checkout</p>
              <h1 className="mt-2">Email. Pay. Start.</h1>
              <div className="flex flex-wrap gap-2 mt-4">
                <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-medium">
                  1. Email
                </span>
                <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-medium">
                  2. Pay
                </span>
                <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-medium">
                  3. Start
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/" className={BTN_SECONDARY}>
                Back
              </Link>
              {authenticated && (
                <button
                  className={BTN_SECONDARY}
                  onClick={logout}
                  type="button"
                >
                  Log out
                </button>
              )}
            </div>
          </motion.div>

          {safeMessage && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="card card-flat p-4"
            >
              <p className="label">Notice</p>
              <p className="text-muted mt-2">{safeMessage}</p>
              {needsReauth && (
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    className={BTN_PRIMARY}
                    onClick={() => {
                      void logout();
                      login();
                    }}
                    type="button"
                  >
                    Reconnect email
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {!ready ? (
            <div className="card p-7">
              <p className="label">Session</p>
              <h2 className="mt-2.5">Loading authentication…</h2>
            </div>
          ) : !authenticated ? (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="card p-8 md:p-10"
            >
              <p className="label">Step 1</p>
              <h2 className="mt-2.5">Email</h2>
              <p className="text-muted mt-2">Use your email to continue.</p>
              <div className="flex flex-wrap gap-3 mt-6">
                <motion.button
                  whileHover={{ y: -1, scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  className={BTN_PRIMARY}
                  onClick={() => login()}
                  type="button"
                >
                  Continue with email
                </motion.button>
              </div>
            </motion.div>
          ) : subscription?.active ? (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="card p-8 md:p-10"
            >
              <p className="label">Step 3</p>
              <h2 className="mt-2.5">Start</h2>
              <p className="text-muted mt-3 max-w-[680px]">
                License active
                {subscription.planName ? ` (${subscription.planName})` : ""}.
              </p>
              <div className="grid gap-2 mt-4 text-sm">
                <p>
                  <span className="text-muted">Starts:</span>{" "}
                  <code>{subscription.startsAt ?? "—"}</code>
                </p>
                <p>
                  <span className="text-muted">Expires:</span>{" "}
                  <code>{subscription.expiresAt ?? "—"}</code>
                </p>
              </div>
              <div className="flex flex-wrap gap-3 mt-6">
                <Link href="/app" className={BTN_PRIMARY}>
                  Open control room
                </Link>
              </div>
            </motion.div>
          ) : (
            <div className="grid gap-6">
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: "easeOut" }}
                className="rounded-2xl border border-border bg-surface overflow-hidden"
              >
                <div className="px-7 py-9 md:px-10 md:py-11 text-center border-b border-border">
                  <p className="label">Step 2</p>
                  <h2 className="mt-2.5">Pay</h2>
                </div>
                <div className="grid lg:grid-cols-3">
                  {plans.map((plan, i) => (
                    <motion.button
                      key={plan.id}
                      type="button"
                      onClick={() => {
                        setSelectedPlanId(plan.id);
                        replaceCheckoutQuery({ plan: plan.id });
                      }}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.06 }}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.995 }}
                      className={`relative text-left p-7 md:p-8 border-b border-border lg:border-b-0 transition-colors ${
                        i === 1 ? "lg:border-x" : ""
                      } ${
                        selectedPlanId === plan.id
                          ? "bg-paper"
                          : "bg-surface hover:bg-paper"
                      }`}
                    >
                      <p className="label">
                        {plan.id === "byok_annual" ? "BYOK" : "Hobbyist"}
                      </p>
                      <h3 className="mt-2 text-[1.85rem] leading-none tracking-tight">
                        ${plan.amountUsd}
                        <span className="text-base font-medium text-muted">
                          /year
                        </span>
                      </h3>
                      <p className="mt-4 font-semibold">{plan.name}</p>
                      <p className="text-muted text-sm mt-2">
                        {plan.description}
                      </p>
                      <ul className="mt-5 grid gap-2 text-sm text-muted">
                        {plan.features.map((feature) => (
                          <li key={`${plan.id}-${feature}`}>{feature}</li>
                        ))}
                      </ul>
                    </motion.button>
                  ))}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: 0.12 }}
                    className="p-7 md:p-8 bg-surface"
                  >
                    <p className="label">Fund</p>
                    <h3 className="mt-2 text-[1.85rem] leading-none tracking-tight">
                      Contact
                    </h3>
                    <p className="mt-4 font-semibold">Fund Access</p>
                    <p className="text-muted text-sm mt-2">
                      Express interest in participating directly in the private
                      fund with quant and HFT-grade infrastructure.
                    </p>
                    <ul className="mt-5 grid gap-2 text-sm text-muted">
                      <li>Quant and HFT-level strategy infrastructure</li>
                      <li>Low-latency execution and risk stack</li>
                      <li>Interest intake and qualification review</li>
                      <li>Direct conversation with the fund team</li>
                    </ul>
                    <a
                      className={`${BTN_SECONDARY} mt-7 w-full`}
                      href="mailto:hello@ralph.fund?subject=Fund%20Interest"
                    >
                      Express interest
                    </a>
                  </motion.div>
                </div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="card p-6 md:p-7"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-semibold">
                    {selectedPlan
                      ? `${selectedPlan.name} • $${selectedPlan.amountUsd}/year`
                      : "Select a plan"}
                  </p>
                  <motion.button
                    whileHover={{ y: -1, scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    className={BTN_PRIMARY}
                    onClick={() => {
                      setModalOpen(true);
                      replaceCheckoutQuery({ pay: "1" });
                    }}
                    disabled={!selectedPlan}
                    type="button"
                  >
                    Pay
                  </motion.button>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      </section>

      <AnimatePresence>
        {modalOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[4px] px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setModalOpen(false);
              replaceCheckoutQuery({ pay: null });
            }}
          >
            <motion.div
              className="w-[min(620px,100%)] card max-h-[92vh] overflow-y-auto"
              initial={{ opacity: 0, y: 28, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.97 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-5 border-b border-border flex items-center justify-between">
                <div>
                  <p className="label">Step 3</p>
                  <h3 className="text-[1.2rem] mt-1">Pay</h3>
                </div>
                <button
                  className={BTN_SECONDARY}
                  onClick={() => {
                    setModalOpen(false);
                    replaceCheckoutQuery({ pay: null });
                  }}
                  type="button"
                >
                  Close
                </button>
              </div>

              <div className="p-6 grid gap-5">
                <div className="grid gap-2">
                  <p className="label">Payment asset</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(["USDC", "SOL"] as const).map((asset) => (
                      <motion.button
                        key={asset}
                        whileTap={{ scale: 0.98 }}
                        className={`rounded-md border px-4 py-2.5 text-sm font-medium transition-colors ${
                          selectedPaymentAsset === asset
                            ? "border-accent bg-accent-soft"
                            : "border-border bg-surface hover:bg-paper"
                        }`}
                        onClick={() => {
                          setSelectedPaymentAsset(asset);
                          setIntent(null);
                          setCheckoutUrl("");
                          replaceCheckoutQuery({ asset });
                        }}
                        type="button"
                      >
                        {asset}
                      </motion.button>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-border bg-paper p-4">
                  <p className="text-sm text-muted">
                    {selectedPlan
                      ? `${selectedPlan.name} • $${selectedPlan.amountUsd}/year`
                      : "Selected plan"}
                  </p>
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={
                        intent
                          ? `${intent.payment.currency}:${intent.payment.amountDecimal}`
                          : "pending"
                      }
                      className="font-semibold mt-1"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.16 }}
                    >
                      {intent
                        ? `Send ${intent.payment.amountDecimal} ${intent.payment.currency}`
                        : "Preparing payment request..."}
                    </motion.p>
                  </AnimatePresence>
                </div>

                <div className="rounded-xl border border-border bg-surface p-5">
                  <div className="flex items-center justify-center min-h-[220px]">
                    {intentLoading || !intent || !checkoutUrl ? (
                      <motion.div
                        animate={{ opacity: [0.35, 1, 0.35] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                        className="w-[190px] h-[190px] rounded-md border border-border bg-subtle"
                      />
                    ) : (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.16 }}
                      >
                        <QRCodeSVG
                          value={checkoutUrl}
                          size={190}
                          level="M"
                          bgColor="transparent"
                          fgColor="var(--color-ink)"
                        />
                      </motion.div>
                    )}
                  </div>
                  <p className="text-muted text-xs text-center mt-3">
                    Scan with a Solana Pay compatible wallet.
                  </p>
                </div>

                <div className="grid gap-2 text-sm min-h-[74px]">
                  <p>
                    <span className="text-muted">Recipient:</span>{" "}
                    <code>{intent?.payment.recipient ?? "—"}</code>
                  </p>
                  <p>
                    <span className="text-muted">Expires:</span>{" "}
                    <code>{intent?.expiresAt ?? "—"}</code>
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  {checkoutUrl && (
                    <a
                      className={BTN_PRIMARY}
                      href={checkoutUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Pay
                    </a>
                  )}
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    className={BTN_SECONDARY}
                    onClick={() => void checkStatus()}
                    disabled={checking || !intent}
                    type="button"
                  >
                    {checking ? "Checking..." : "I've paid, verify"}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
