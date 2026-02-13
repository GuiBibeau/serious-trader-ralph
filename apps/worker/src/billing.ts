import bs58 from "bs58";
import { JupiterClient } from "./jupiter";
import type { Env } from "./types";

export const BILLING_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const BILLING_SOL_MINT = "So11111111111111111111111111111111111111112";

type BillingPlanConfig = {
  id: BillingPlanId;
  name: string;
  description: string;
  amountUsd: number;
  features: string[];
};

const PLAN_CONFIGS: BillingPlanConfig[] = [
  {
    id: "byok_annual",
    name: "BYOK Annual",
    description:
      "Full edge fund access with autonomous execution; you pay your own inference.",
    amountUsd: 99,
    features: [
      "1-year license",
      "Full edge fund feature access",
      "Autonomous execution enabled",
      "Bring your own model/API keys",
      "Inference billed to your own providers",
    ],
  },
  {
    id: "hobbyist_annual",
    name: "Hobbyist Annual",
    description: "Full edge fund access with managed inference included.",
    amountUsd: 790,
    features: [
      "1-year license",
      "Full edge fund feature access",
      "Autonomous execution enabled",
      "AI LLM inference cost included",
      "Managed execution routing",
    ],
  },
];

const INTENT_TTL_MINUTES = 30;
const USDC_DECIMALS = 6;
const SOL_DECIMALS = 9;

export type BillingPlanId = "byok_annual" | "hobbyist_annual";
export type PaymentAsset = "USDC" | "SOL";

export type BillingPlan = {
  id: BillingPlanId;
  name: string;
  description: string;
  amountUsd: number;
  amountDecimal: string;
  amountAtomic: string;
  currency: "USDC";
  mint: string;
  interval: "annual";
  features: string[];
};

export type SubscriptionRow = {
  userId: string;
  planId: BillingPlanId;
  status: "active" | "inactive";
  startsAt: string | null;
  expiresAt: string | null;
  sourceSignature: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionView = {
  status: "active" | "inactive";
  active: boolean;
  planId: BillingPlanId | null;
  planName: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  sourceSignature: string | null;
};

export type PaymentIntentRow = {
  id: string;
  userId: string;
  planId: BillingPlanId;
  referenceKey: string;
  mint: string;
  merchantWallet: string;
  amountAtomic: string;
  amountDecimal: string;
  status: "pending" | "verified" | "expired";
  signature: string | null;
  expiresAt: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CheckoutIntentView = {
  id: string;
  planId: BillingPlanId;
  status: "pending" | "verified" | "expired";
  expiresAt: string;
  payment: {
    recipient: string;
    amountDecimal: string;
    amountAtomic: string;
    currency: PaymentAsset;
    splToken: string | null;
    reference: string;
    label: string;
    message: string;
    memo: string;
  };
};

type SignatureInfo = {
  signature?: string;
  err?: unknown;
};

type ParsedTokenBalance = {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: {
    amount?: string;
  };
};

type ParsedTransaction = {
  meta?: {
    err?: unknown;
    preBalances?: Array<number | string>;
    postBalances?: Array<number | string>;
    preTokenBalances?: ParsedTokenBalance[];
    postTokenBalances?: ParsedTokenBalance[];
  };
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey?: string }>;
    };
  };
};

export function listBillingPlans(env: Env): BillingPlan[] {
  const mint = resolveStableMint(env);
  return PLAN_CONFIGS.map((plan) => {
    const amountAtomic = usdToAtomic(plan.amountUsd, USDC_DECIMALS);
    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      amountUsd: plan.amountUsd,
      amountDecimal: atomicToDecimal(amountAtomic, USDC_DECIMALS),
      amountAtomic,
      currency: "USDC",
      mint,
      interval: "annual",
      features: [...plan.features],
    };
  });
}

export function findBillingPlan(
  env: Env,
  planId: string,
): BillingPlan | undefined {
  return listBillingPlans(env).find((p) => p.id === planId);
}

export function isSubscriptionActive(
  sub: SubscriptionRow | null,
  at = new Date(),
): boolean {
  if (!sub || sub.status !== "active") return false;
  if (!sub.expiresAt) return false;
  const expiresMs = parseTimestampMs(sub.expiresAt);
  if (!Number.isFinite(expiresMs)) return false;
  return expiresMs > at.getTime();
}

function parseTimestampMs(value: string | null): number {
  if (!value) return Number.NaN;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;

  // Backward compatibility for SQLite datetime() values like:
  // "2026-02-12 23:20:01" (no timezone and space separator).
  let normalized = value;
  if (normalized.includes(" ") && !normalized.includes("T")) {
    normalized = normalized.replace(" ", "T");
  }
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  if (!hasTimezone) normalized = `${normalized}Z`;
  return Date.parse(normalized);
}

export function toSubscriptionView(
  env: Env,
  sub: SubscriptionRow | null,
): SubscriptionView {
  const active = isSubscriptionActive(sub);
  const plan = sub ? findBillingPlan(env, sub.planId) : undefined;
  return {
    status: active ? "active" : "inactive",
    active,
    planId: sub?.planId ?? null,
    planName: plan?.name ?? null,
    startsAt: sub?.startsAt ?? null,
    expiresAt: sub?.expiresAt ?? null,
    sourceSignature: sub?.sourceSignature ?? null,
  };
}

export async function getUserSubscription(
  env: Env,
  userId: string,
): Promise<SubscriptionRow | null> {
  const row = (await env.WAITLIST_DB.prepare(
    `
    SELECT
      user_id as userId,
      plan_id as planId,
      status,
      starts_at as startsAt,
      expires_at as expiresAt,
      source_signature as sourceSignature,
      created_at as createdAt,
      updated_at as updatedAt
    FROM subscriptions
    WHERE user_id = ?1
    `,
  )
    .bind(userId)
    .first()) as unknown;
  return mapSubscriptionRow(row);
}

export async function createCheckoutIntent(
  env: Env,
  input: {
    userId: string;
    plan: BillingPlan;
    paymentAsset: PaymentAsset;
  },
): Promise<PaymentIntentRow> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INTENT_TTL_MINUTES * 60_000);

  const id = crypto.randomUUID();
  const referenceKey = randomReferenceKey();
  const merchantWallet = resolveMerchantWallet(env);
  const pricing = await buildCheckoutPricing(
    env,
    input.plan,
    input.paymentAsset,
  );

  await env.WAITLIST_DB.prepare(
    `
    INSERT INTO billing_payment_intents (
      id,
      user_id,
      plan_id,
      reference_key,
      mint,
      merchant_wallet,
      amount_atomic,
      amount_decimal,
      status,
      expires_at,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, datetime('now'))
    `,
  )
    .bind(
      id,
      input.userId,
      input.plan.id,
      referenceKey,
      pricing.mint,
      merchantWallet,
      pricing.amountAtomic,
      pricing.amountDecimal,
      expiresAt.toISOString(),
    )
    .run();

  const intent = await getPaymentIntentForUser(env, input.userId, id);
  if (!intent) throw new Error("billing-intent-create-failed");
  return intent;
}

export function toCheckoutIntentView(
  plan: BillingPlan,
  intent: PaymentIntentRow,
): CheckoutIntentView {
  const currency = resolveIntentCurrency(intent);
  return {
    id: intent.id,
    planId: intent.planId,
    status: intent.status,
    expiresAt: intent.expiresAt,
    payment: {
      recipient: intent.merchantWallet,
      amountDecimal: intent.amountDecimal,
      amountAtomic: intent.amountAtomic,
      currency,
      splToken: currency === "USDC" ? intent.mint : null,
      reference: intent.referenceKey,
      label: `Serious Trader Ralph • ${plan.name}`,
      message: `Annual license payment (${plan.name})`,
      memo: `ralph:${plan.id}:${intent.id}`,
    },
  };
}

export async function getPaymentIntentForUser(
  env: Env,
  userId: string,
  intentId: string,
): Promise<PaymentIntentRow | null> {
  const row = (await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      user_id as userId,
      plan_id as planId,
      reference_key as referenceKey,
      mint,
      merchant_wallet as merchantWallet,
      amount_atomic as amountAtomic,
      amount_decimal as amountDecimal,
      status,
      signature,
      expires_at as expiresAt,
      verified_at as verifiedAt,
      created_at as createdAt,
      updated_at as updatedAt
    FROM billing_payment_intents
    WHERE id = ?1 AND user_id = ?2
    `,
  )
    .bind(intentId, userId)
    .first()) as unknown;
  return mapIntentRow(row);
}

export async function resolveIntentStatus(
  env: Env,
  input: { userId: string; intentId: string; rpcRequest: RpcRequestFn },
): Promise<{ intent: PaymentIntentRow; subscription: SubscriptionView }> {
  let intent = await getPaymentIntentForUser(env, input.userId, input.intentId);
  if (!intent) throw new Error("not-found");

  if (intent.status === "pending") {
    intent = await expireIntentIfNeeded(env, intent);
  }

  if (intent.status === "pending") {
    intent = await scanReferenceForPayment(env, intent, input.rpcRequest);
  }

  const subscription = toSubscriptionView(
    env,
    await getUserSubscription(env, input.userId),
  );
  return { intent, subscription };
}

type RpcRequestFn = <T>(method: string, params?: unknown[]) => Promise<T>;

async function scanReferenceForPayment(
  env: Env,
  intent: PaymentIntentRow,
  rpcRequest: RpcRequestFn,
): Promise<PaymentIntentRow> {
  const signatures = await rpcRequest<SignatureInfo[]>(
    "getSignaturesForAddress",
    [intent.referenceKey, { limit: 20 }],
  );

  for (const item of signatures ?? []) {
    const signature = String(item?.signature ?? "").trim();
    if (!signature || item?.err) continue;
    const ok = await verifyPaymentSignature(intent, signature, rpcRequest);
    if (!ok) continue;

    await env.WAITLIST_DB.prepare(
      `
      UPDATE billing_payment_intents
      SET status = 'verified',
          signature = ?1,
          verified_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?2
      `,
    )
      .bind(signature, intent.id)
      .run();

    await activateSubscription(env, intent.userId, intent.planId, signature);

    const refreshed = await getPaymentIntentForUser(
      env,
      intent.userId,
      intent.id,
    );
    if (!refreshed) throw new Error("not-found");
    return refreshed;
  }

  return intent;
}

async function verifyPaymentSignature(
  intent: PaymentIntentRow,
  signature: string,
  rpcRequest: RpcRequestFn,
): Promise<boolean> {
  const tx = await rpcRequest<ParsedTransaction | null>("getTransaction", [
    signature,
    {
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    },
  ]);
  if (!tx || tx.meta?.err) return false;

  const keys = normalizeAccountKeys(tx.transaction?.message?.accountKeys);
  if (!keys.includes(intent.referenceKey)) return false;

  const mint = intent.mint;
  const merchant = intent.merchantWallet;
  const requiredAmount = parseBigIntSafe(intent.amountAtomic);
  const delta =
    mint === BILLING_SOL_MINT
      ? merchantSolDelta(tx.meta, keys, merchant)
      : merchantTokenDelta(tx.meta, merchant, mint);
  return delta >= requiredAmount;
}

function normalizeAccountKeys(
  keys: Array<string | { pubkey?: string }> | undefined,
): string[] {
  const out: string[] = [];
  for (const key of keys ?? []) {
    if (typeof key === "string") {
      out.push(key);
      continue;
    }
    if (key && typeof key.pubkey === "string") {
      out.push(key.pubkey);
    }
  }
  return out;
}

function merchantTokenDelta(
  meta: ParsedTransaction["meta"] | undefined,
  owner: string,
  mint: string,
): bigint {
  const pre = balanceByIndex(meta?.preTokenBalances, owner, mint);
  const post = balanceByIndex(meta?.postTokenBalances, owner, mint);
  const all = new Set<number>([...pre.keys(), ...post.keys()]);
  let delta = 0n;
  for (const index of all) {
    delta += (post.get(index) ?? 0n) - (pre.get(index) ?? 0n);
  }
  return delta;
}

function merchantSolDelta(
  meta: ParsedTransaction["meta"] | undefined,
  accountKeys: string[],
  owner: string,
): bigint {
  const index = accountKeys.indexOf(owner);
  if (index < 0) return 0n;
  const pre = parseBigIntSafe(meta?.preBalances?.[index]);
  const post = parseBigIntSafe(meta?.postBalances?.[index]);
  return post - pre;
}

function balanceByIndex(
  balances: ParsedTokenBalance[] | undefined,
  owner: string,
  mint: string,
): Map<number, bigint> {
  const out = new Map<number, bigint>();
  for (const bal of balances ?? []) {
    if (bal.owner !== owner || bal.mint !== mint) continue;
    if (typeof bal.accountIndex !== "number") continue;
    const amount = parseBigIntSafe(bal.uiTokenAmount?.amount);
    out.set(bal.accountIndex, amount);
  }
  return out;
}

async function activateSubscription(
  env: Env,
  userId: string,
  planId: BillingPlanId,
  sourceSignature: string,
): Promise<void> {
  const now = new Date();
  const existing = await getUserSubscription(env, userId);
  const existingActiveUntil =
    existing && isSubscriptionActive(existing) && existing.expiresAt
      ? new Date(existing.expiresAt)
      : null;

  const startsAt = now;
  const basis =
    existingActiveUntil && existingActiveUntil > now
      ? existingActiveUntil
      : now;
  const expiresAt = addMonthsUtc(basis, 12);

  await env.WAITLIST_DB.prepare(
    `
    INSERT INTO subscriptions (
      user_id,
      plan_id,
      status,
      starts_at,
      expires_at,
      source_signature,
      updated_at
    ) VALUES (?1, ?2, 'active', ?3, ?4, ?5, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      plan_id = excluded.plan_id,
      status = 'active',
      starts_at = excluded.starts_at,
      expires_at = excluded.expires_at,
      source_signature = excluded.source_signature,
      updated_at = datetime('now')
    `,
  )
    .bind(
      userId,
      planId,
      startsAt.toISOString(),
      expiresAt.toISOString(),
      sourceSignature,
    )
    .run();
}

async function expireIntentIfNeeded(
  env: Env,
  intent: PaymentIntentRow,
): Promise<PaymentIntentRow> {
  const expiresMs = Date.parse(intent.expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs > Date.now()) return intent;
  await env.WAITLIST_DB.prepare(
    `
    UPDATE billing_payment_intents
    SET status = 'expired', updated_at = datetime('now')
    WHERE id = ?1 AND status = 'pending'
    `,
  )
    .bind(intent.id)
    .run();
  const refreshed = await getPaymentIntentForUser(
    env,
    intent.userId,
    intent.id,
  );
  return refreshed ?? intent;
}

function mapSubscriptionRow(row: unknown): SubscriptionRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const planIdRaw = String(r.planId ?? "").trim();
  if (!isBillingPlanId(planIdRaw)) return null;
  return {
    userId: String(r.userId),
    planId: planIdRaw,
    status: String(r.status) === "active" ? "active" : "inactive",
    startsAt: r.startsAt ? String(r.startsAt) : null,
    expiresAt: r.expiresAt ? String(r.expiresAt) : null,
    sourceSignature: r.sourceSignature ? String(r.sourceSignature) : null,
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  };
}

function mapIntentRow(row: unknown): PaymentIntentRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const planIdRaw = String(r.planId ?? "").trim();
  if (!isBillingPlanId(planIdRaw)) return null;
  const statusRaw = String(r.status ?? "pending");
  const status: PaymentIntentRow["status"] =
    statusRaw === "verified" || statusRaw === "expired" ? statusRaw : "pending";
  return {
    id: String(r.id),
    userId: String(r.userId),
    planId: planIdRaw,
    referenceKey: String(r.referenceKey),
    mint: String(r.mint),
    merchantWallet: String(r.merchantWallet),
    amountAtomic: String(r.amountAtomic),
    amountDecimal: String(r.amountDecimal),
    status,
    signature: r.signature ? String(r.signature) : null,
    expiresAt: String(r.expiresAt),
    verifiedAt: r.verifiedAt ? String(r.verifiedAt) : null,
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  };
}

function isBillingPlanId(value: string): value is BillingPlanId {
  return value === "byok_annual" || value === "hobbyist_annual";
}

function resolveMerchantWallet(env: Env): string {
  const wallet = String(env.BILLING_MERCHANT_WALLET ?? "").trim();
  if (!wallet) throw new Error("billing-merchant-wallet-missing");
  return wallet;
}

function resolveStableMint(env: Env): string {
  const mint = String(env.BILLING_STABLE_MINT ?? BILLING_USDC_MINT).trim();
  return mint || BILLING_USDC_MINT;
}

function resolveIntentCurrency(intent: PaymentIntentRow): PaymentAsset {
  return intent.mint === BILLING_SOL_MINT ? "SOL" : "USDC";
}

function randomReferenceKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bs58.encode(bytes);
}

function parseBigIntSafe(value: unknown): bigint {
  if (typeof value !== "string" && typeof value !== "number") return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function usdToAtomic(amountUsd: number, decimals: number): string {
  const scale = 10 ** decimals;
  return Math.round(amountUsd * scale).toString();
}

async function buildCheckoutPricing(
  env: Env,
  plan: BillingPlan,
  asset: PaymentAsset,
): Promise<{ mint: string; amountAtomic: string; amountDecimal: string }> {
  if (asset === "USDC") {
    return {
      mint: plan.mint,
      amountAtomic: plan.amountAtomic,
      amountDecimal: plan.amountDecimal,
    };
  }

  const jupiter = new JupiterClient(
    env.JUPITER_BASE_URL ?? "https://lite-api.jup.ag",
    env.JUPITER_API_KEY,
  );
  const quote = await jupiter.quote({
    inputMint: BILLING_SOL_MINT,
    outputMint: resolveStableMint(env),
    amount: plan.amountAtomic,
    slippageBps: 50,
    swapMode: "ExactOut",
  });
  const amountAtomic = String(quote.inAmount ?? "").trim();
  if (!/^\d+$/.test(amountAtomic) || amountAtomic === "0") {
    throw new Error("sol-pricing-unavailable");
  }

  return {
    mint: BILLING_SOL_MINT,
    amountAtomic,
    amountDecimal: atomicToDecimal(amountAtomic, SOL_DECIMALS),
  };
}

function atomicToDecimal(amountAtomic: string, decimals: number): string {
  let value = 0n;
  try {
    value = BigInt(amountAtomic);
  } catch {
    return "0";
  }
  const base = 10n ** BigInt(decimals);
  const intPart = value / base;
  const fracPart = value % base;
  if (fracPart === 0n) return intPart.toString();
  const frac = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${intPart.toString()}.${frac}`;
}

function addMonthsUtc(source: Date, months: number): Date {
  const d = new Date(source.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}
