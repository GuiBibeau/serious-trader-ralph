import { requireUser } from "./auth";
import { BILLING_USDC_MINT } from "./billing";
import { json } from "./response";
import { SolanaRpc } from "./solana_rpc";
import type { Env } from "./types";
import { findUserByPrivyUserId } from "./users_db";

type X402RouteKey =
  | "exec_submit"
  | "market_snapshot"
  | "market_snapshot_v2"
  | "market_token_balance"
  | "market_jupiter_quote"
  | "market_jupiter_quote_batch"
  | "market_ohlcv"
  | "market_indicators"
  | "solana_marks_latest"
  | "solana_scores_latest"
  | "solana_views_top"
  | "macro_signals"
  | "macro_fred_indicators"
  | "macro_etf_flows"
  | "macro_stablecoin_health"
  | "macro_oil_analytics"
  | "perps_funding_surface"
  | "perps_open_interest_surface"
  | "perps_venue_score";

type X402RouteConfig = {
  routeKey: X402RouteKey;
  network: string;
  payTo: string;
  asset: string;
  amountAtomic: string;
  priceUsd: string;
  maxTimeoutSeconds: number;
};

type X402Provider = "local" | "corbits";

type FacilitatorPaymentRequirement = {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  outputSchema: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

type FacilitatorPaymentPayload = {
  x402Version: number;
  scheme: string;
  network: string;
  payload: Record<string, unknown>;
};

type FacilitatorVerifyResponse = {
  isValid?: boolean;
  invalidReason?: string;
};

type FacilitatorSettleResponse = {
  success?: boolean;
  errorReason?: string;
};

const PAYMENT_REQUIRED_HEADER = "payment-required";
const PAYMENT_SIGNATURE_HEADER = "payment-signature";
const PAYMENT_RESPONSE_HEADER = "payment-response";
const X_PAYMENT_HEADER = "x-payment";
const MAINNET_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";
const DEVNET_RPC_ENDPOINT = "https://api.devnet.solana.com";
const CORBITS_FACILITATOR_URL = "https://facilitator.corbits.dev";
const CORBITS_TIMEOUT_MS = 10_000;
const X402_REPLAY_KEY_PREFIX = "x402:payment-signature:";
const X402_REPLAY_TTL_SECONDS = 60 * 60 * 24 * 30;
const BASE58_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

function parseTrustedOriginPatterns(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function patternMatchesOrigin(pattern: string, origin: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === origin;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
  return regex.test(origin);
}

function getRequestOrigin(request: Request): string | null {
  const direct = normalizeOrigin(String(request.headers.get("origin") ?? ""));
  if (direct) return direct;
  const referer = String(request.headers.get("referer") ?? "").trim();
  return normalizeOrigin(referer);
}

function isTrustedOriginRequest(request: Request, env: Env): boolean {
  const origin = getRequestOrigin(request);
  if (!origin) return false;
  const patterns = parseTrustedOriginPatterns(env.X402_TRUSTED_ORIGINS);
  if (patterns.length === 0) return false;
  for (const pattern of patterns) {
    if (patternMatchesOrigin(pattern, origin)) return true;
  }
  return false;
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return null;
  return email;
}

async function hasWaitlistEmail(env: Env, email: string): Promise<boolean> {
  const row = (await env.WAITLIST_DB.prepare(
    "SELECT email FROM waitlist WHERE lower(email) = ?1 LIMIT 1",
  )
    .bind(email.toLowerCase())
    .first()) as unknown;
  return Boolean(row && typeof row === "object");
}

async function canBypassX402ForTrustedPortalRequest(
  request: Request,
  env: Env,
): Promise<boolean> {
  if (!isTrustedOriginRequest(request, env)) return false;
  try {
    const auth = await requireUser(request, env);
    const existing = await findUserByPrivyUserId(env, auth.privyUserId);
    if (existing) return true;

    const email = normalizeEmail(auth.email);
    if (!email) return false;
    return await hasWaitlistEmail(env, email);
  } catch {
    return false;
  }
}

type ParsedTokenBalance = {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: {
    amount?: string;
  };
};

type ParsedTxMeta = {
  err?: unknown;
  preTokenBalances?: ParsedTokenBalance[];
  postTokenBalances?: ParsedTokenBalance[];
};

type ParsedTxResponse = {
  slot?: number;
  blockTime?: number | null;
  meta?: ParsedTxMeta;
};

function toBase64Json(input: unknown): string {
  const raw = JSON.stringify(input);
  let binary = "";
  for (const ch of new TextEncoder().encode(raw)) {
    binary += String.fromCharCode(ch);
  }
  return btoa(binary);
}

function fromBase64Json(value: string): unknown {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function resolveX402Provider(env: Env): X402Provider {
  const raw = String(env.X402_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  if (raw === "corbits") return "corbits";
  return "local";
}

function resolveCorbitsFacilitatorUrl(env: Env): string {
  const configured = String(env.X402_FACILITATOR_URL ?? "").trim();
  return configured || CORBITS_FACILITATOR_URL;
}

function resolveCorbitsTimeoutMs(env: Env): number {
  return normalizePositiveInt(
    env.X402_FACILITATOR_TIMEOUT_MS,
    CORBITS_TIMEOUT_MS,
  );
}

function normalizeCorbitsNetwork(network: string): string {
  const normalized = network.trim().toLowerCase();
  if (normalized === "solana-mainnet") return "solana-mainnet-beta";
  return network;
}

function parseFacilitatorPaymentPayload(
  value: string,
): FacilitatorPaymentPayload | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let decoded: unknown = null;
  if (trimmed.startsWith("{")) {
    try {
      decoded = JSON.parse(trimmed);
    } catch {
      return null;
    }
  } else {
    try {
      decoded = fromBase64Json(trimmed);
    } catch {
      return null;
    }
  }

  if (!isRecord(decoded)) return null;
  if (!Number.isFinite(Number(decoded.x402Version))) return null;
  if (typeof decoded.scheme !== "string" || !decoded.scheme.trim()) return null;
  if (typeof decoded.network !== "string" || !decoded.network.trim())
    return null;
  if (!isRecord(decoded.payload)) return null;

  return {
    x402Version: Number(decoded.x402Version),
    scheme: decoded.scheme.trim(),
    network: decoded.network.trim(),
    payload: decoded.payload,
  };
}

function buildFacilitatorPaymentRequirement(
  config: X402RouteConfig,
  request: Request,
  resourcePath: string,
): FacilitatorPaymentRequirement {
  const resource = new URL(resourcePath, request.url).toString();
  return {
    scheme: "exact",
    network: normalizeCorbitsNetwork(config.network),
    maxAmountRequired: config.amountAtomic,
    resource,
    description: `Trader Ralph x402 route ${config.routeKey}`,
    mimeType: "application/json",
    payTo: config.payTo,
    asset: config.asset,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    outputSchema: {},
    extra: {
      route: config.routeKey,
      priceUsd: config.priceUsd,
    },
  };
}

function parseUsdPriceToAtomic(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(trimmed)) {
    throw new Error("x402-route-config-invalid-price");
  }
  const [whole, fractionalRaw = ""] = trimmed.split(".");
  const fractional = fractionalRaw.padEnd(6, "0");
  const atomic = BigInt(whole) * 1_000_000n + BigInt(fractional);
  if (atomic <= 0n) throw new Error("x402-route-config-invalid-price");
  return atomic.toString();
}

function normalizePositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toBigIntAmount(value: unknown): bigint {
  if (typeof value !== "string" || value.trim() === "") return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function parseTokenBalances(raw: unknown): ParsedTokenBalance[] {
  if (!Array.isArray(raw)) return [];
  const rows: ParsedTokenBalance[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const accountIndex = Number(row.accountIndex);
    const mint = typeof row.mint === "string" ? row.mint : undefined;
    const owner = typeof row.owner === "string" ? row.owner : undefined;
    const uiTokenAmount = isRecord(row.uiTokenAmount)
      ? ({
          amount:
            typeof row.uiTokenAmount.amount === "string"
              ? row.uiTokenAmount.amount
              : undefined,
        } satisfies ParsedTokenBalance["uiTokenAmount"])
      : undefined;
    rows.push({
      accountIndex: Number.isFinite(accountIndex) ? accountIndex : undefined,
      mint,
      owner,
      uiTokenAmount,
    });
  }
  return rows;
}

function sumPositiveReceivedAtomic(
  meta: ParsedTxMeta | null | undefined,
  payTo: string,
  assetMint: string,
): bigint {
  if (!meta) return 0n;
  const pre = parseTokenBalances(meta.preTokenBalances);
  const post = parseTokenBalances(meta.postTokenBalances);
  const preByIndex = new Map<number, bigint>();
  const postByIndex = new Map<number, bigint>();
  const indexes = new Set<number>();

  for (const row of pre) {
    if (
      typeof row.accountIndex !== "number" ||
      row.mint !== assetMint ||
      row.owner !== payTo
    ) {
      continue;
    }
    indexes.add(row.accountIndex);
    preByIndex.set(row.accountIndex, toBigIntAmount(row.uiTokenAmount?.amount));
  }
  for (const row of post) {
    if (
      typeof row.accountIndex !== "number" ||
      row.mint !== assetMint ||
      row.owner !== payTo
    ) {
      continue;
    }
    indexes.add(row.accountIndex);
    postByIndex.set(
      row.accountIndex,
      toBigIntAmount(row.uiTokenAmount?.amount),
    );
  }

  let total = 0n;
  for (const index of indexes) {
    const before = preByIndex.get(index) ?? 0n;
    const after = postByIndex.get(index) ?? 0n;
    const delta = after - before;
    if (delta > 0n) total += delta;
  }
  return total;
}

function getPaymentSignature(request: Request): string {
  return String(
    request.headers.get(PAYMENT_SIGNATURE_HEADER) ??
      request.headers.get(X_PAYMENT_HEADER) ??
      "",
  ).trim();
}

function onchainVerificationEnabled(env: Env): boolean {
  const raw = String(env.X402_ENFORCE_ONCHAIN ?? "1")
    .trim()
    .toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off");
}

function defaultRpcEndpointForNetwork(network: string): string {
  const normalized = network.trim().toLowerCase();
  if (normalized.includes("devnet")) return DEVNET_RPC_ENDPOINT;
  return MAINNET_RPC_ENDPOINT;
}

function resolvePaymentRpcEndpoint(env: Env, network: string): string {
  const configured = String(
    env.BALANCE_RPC_ENDPOINT ??
      env.RPC_ENDPOINT ??
      env.BILLING_RPC_ENDPOINT ??
      "",
  ).trim();
  return configured || defaultRpcEndpointForNetwork(network);
}

async function consumePaymentSignature(
  signature: string,
  config: X402RouteConfig,
  env: Env,
): Promise<void> {
  if (!BASE58_SIGNATURE_RE.test(signature)) {
    throw new Error("x402-payment-signature-invalid");
  }
  if (!env.CONFIG_KV) {
    throw new Error("x402-payment-replay-store-missing");
  }

  const replayKey = `${X402_REPLAY_KEY_PREFIX}${signature}`;
  const existing = await env.CONFIG_KV.get(replayKey);
  if (existing) {
    throw new Error("x402-payment-signature-replayed");
  }

  const rpcEndpoint = resolvePaymentRpcEndpoint(env, config.network);
  const rpc = new SolanaRpc(rpcEndpoint);
  const rawTx = await rpc.getTransactionParsed(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!rawTx) {
    throw new Error("x402-payment-signature-not-found");
  }

  const tx = rawTx as ParsedTxResponse;
  const blockTime = Number(tx.blockTime ?? 0);
  if (!Number.isFinite(blockTime) || blockTime <= 0) {
    throw new Error("x402-payment-missing-blocktime");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - Math.floor(blockTime);
  if (ageSec > config.maxTimeoutSeconds) {
    throw new Error("x402-payment-expired");
  }
  if (ageSec < -30) {
    throw new Error("x402-payment-future-blocktime");
  }

  const meta = isRecord(tx.meta) ? (tx.meta as ParsedTxMeta) : null;
  if (!meta || meta.err) {
    throw new Error("x402-payment-transaction-failed");
  }

  const receivedAtomic = sumPositiveReceivedAtomic(
    meta,
    config.payTo,
    config.asset,
  );
  const requiredAtomic = toBigIntAmount(config.amountAtomic);
  if (receivedAtomic < requiredAtomic) {
    throw new Error("x402-payment-insufficient-amount");
  }

  await env.CONFIG_KV.put(
    replayKey,
    JSON.stringify({
      routeKey: config.routeKey,
      network: config.network,
      asset: config.asset,
      requiredAtomic: config.amountAtomic,
      receivedAtomic: receivedAtomic.toString(),
      consumedAt: new Date().toISOString(),
      slot: Number(tx.slot ?? 0),
      blockTime: Math.floor(blockTime),
    }),
    { expirationTtl: X402_REPLAY_TTL_SECONDS },
  );
}

async function postCorbitsFacilitator<T>(
  env: Env,
  path: "/verify" | "/settle",
  payload: Record<string, unknown>,
): Promise<{ status: number; body: T | null }> {
  const baseUrl = resolveCorbitsFacilitatorUrl(env);
  const timeoutMs = resolveCorbitsTimeoutMs(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(path, baseUrl).toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as T | null;
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function consumePaymentWithCorbits(
  signature: string,
  config: X402RouteConfig,
  env: Env,
  request: Request,
  resourcePath: string,
): Promise<"consumed" | "skipped"> {
  const paymentPayload = parseFacilitatorPaymentPayload(signature);
  if (!paymentPayload) return "skipped";

  const paymentRequirements = buildFacilitatorPaymentRequirement(
    config,
    request,
    resourcePath,
  );
  const reqBody = {
    paymentRequirements,
    paymentPayload,
  };

  const verified = await postCorbitsFacilitator<FacilitatorVerifyResponse>(
    env,
    "/verify",
    reqBody,
  );
  const verifyReason =
    (isRecord(verified.body) &&
      String(verified.body.invalidReason ?? "").trim()) ||
    "";
  if (verified.status >= 400) {
    throw new Error(
      verifyReason || `x402-facilitator-verify-http-${verified.status}`,
    );
  }
  if (!isRecord(verified.body) || verified.body.isValid !== true) {
    throw new Error(verifyReason || "x402-facilitator-payment-invalid");
  }

  const settled = await postCorbitsFacilitator<FacilitatorSettleResponse>(
    env,
    "/settle",
    reqBody,
  );
  const settleReason =
    (isRecord(settled.body) && String(settled.body.errorReason ?? "").trim()) ||
    "";
  if (settled.status >= 400) {
    throw new Error(
      settleReason || `x402-facilitator-settle-http-${settled.status}`,
    );
  }
  if (!isRecord(settled.body) || settled.body.success !== true) {
    throw new Error(settleReason || "x402-facilitator-settle-failed");
  }

  return "consumed";
}

function loadRouteConfig(env: Env, routeKey: X402RouteKey): X402RouteConfig {
  const network = String(env.X402_NETWORK ?? "").trim();
  const payTo = String(env.X402_PAY_TO ?? "").trim();
  const asset = String(env.X402_ASSET_MINT ?? BILLING_USDC_MINT).trim();
  const priceUsdRaw =
    routeKey === "exec_submit"
      ? String(env.X402_EXEC_SUBMIT_PRICE_USD ?? "").trim()
      : routeKey === "market_snapshot"
        ? String(env.X402_MARKET_SNAPSHOT_PRICE_USD ?? "").trim()
        : routeKey === "market_snapshot_v2"
          ? String(env.X402_MARKET_SNAPSHOT_V2_PRICE_USD ?? "").trim()
          : routeKey === "market_token_balance"
            ? String(env.X402_MARKET_TOKEN_BALANCE_PRICE_USD ?? "").trim()
            : routeKey === "market_jupiter_quote"
              ? String(env.X402_MARKET_JUPITER_QUOTE_PRICE_USD ?? "").trim()
              : routeKey === "market_jupiter_quote_batch"
                ? String(
                    env.X402_MARKET_JUPITER_QUOTE_BATCH_PRICE_USD ?? "",
                  ).trim()
                : routeKey === "market_ohlcv"
                  ? String(env.X402_MARKET_OHLCV_PRICE_USD ?? "").trim()
                  : routeKey === "market_indicators"
                    ? String(env.X402_MARKET_INDICATORS_PRICE_USD ?? "").trim()
                    : routeKey === "solana_marks_latest"
                      ? String(
                          env.X402_SOLANA_MARKS_LATEST_PRICE_USD ?? "",
                        ).trim()
                      : routeKey === "solana_scores_latest"
                        ? String(
                            env.X402_SOLANA_SCORES_LATEST_PRICE_USD ?? "",
                          ).trim()
                        : routeKey === "solana_views_top"
                          ? String(
                              env.X402_SOLANA_VIEWS_TOP_PRICE_USD ?? "",
                            ).trim()
                          : routeKey === "macro_signals"
                            ? String(
                                env.X402_MACRO_SIGNALS_PRICE_USD ?? "",
                              ).trim()
                            : routeKey === "macro_fred_indicators"
                              ? String(
                                  env.X402_MACRO_FRED_INDICATORS_PRICE_USD ??
                                    "",
                                ).trim()
                              : routeKey === "macro_etf_flows"
                                ? String(
                                    env.X402_MACRO_ETF_FLOWS_PRICE_USD ?? "",
                                  ).trim()
                                : routeKey === "macro_stablecoin_health"
                                  ? String(
                                      env.X402_MACRO_STABLECOIN_HEALTH_PRICE_USD ??
                                        "",
                                    ).trim()
                                  : routeKey === "macro_oil_analytics"
                                    ? String(
                                        env.X402_MACRO_OIL_ANALYTICS_PRICE_USD ??
                                          "",
                                      ).trim()
                                    : routeKey === "perps_funding_surface"
                                      ? String(
                                          env.X402_PERPS_FUNDING_SURFACE_PRICE_USD ??
                                            "",
                                        ).trim()
                                      : routeKey ===
                                          "perps_open_interest_surface"
                                        ? String(
                                            env.X402_PERPS_OPEN_INTEREST_SURFACE_PRICE_USD ??
                                              "",
                                          ).trim()
                                        : String(
                                            env.X402_PERPS_VENUE_SCORE_PRICE_USD ??
                                              "",
                                          ).trim();
  if (!network || !payTo || !asset || !priceUsdRaw) {
    throw new Error("x402-route-config-missing");
  }
  return {
    routeKey,
    network,
    payTo,
    asset,
    amountAtomic: parseUsdPriceToAtomic(priceUsdRaw),
    priceUsd: priceUsdRaw,
    maxTimeoutSeconds: normalizePositiveInt(env.X402_MAX_TIMEOUT_SECONDS, 60),
  };
}

function buildPaymentRequirements(
  config: X402RouteConfig,
  request: Request,
  resourcePath: string,
  env: Env,
) {
  const provider = resolveX402Provider(env);
  const facilitatorRequirements = buildFacilitatorPaymentRequirement(
    config,
    request,
    resourcePath,
  );
  const network =
    provider === "corbits" ? facilitatorRequirements.network : config.network;
  return {
    x402Version: provider === "corbits" ? 1 : 2,
    accepts: [
      {
        scheme: "exact",
        network,
        asset: facilitatorRequirements.asset,
        amount: config.amountAtomic,
        maxAmountRequired: facilitatorRequirements.maxAmountRequired,
        payTo: facilitatorRequirements.payTo,
        resource: facilitatorRequirements.resource,
        description: facilitatorRequirements.description,
        mimeType: facilitatorRequirements.mimeType,
        outputSchema: facilitatorRequirements.outputSchema,
        maxTimeoutSeconds: facilitatorRequirements.maxTimeoutSeconds,
        extra: {
          route: config.routeKey,
          priceUsd: config.priceUsd,
        },
      },
    ],
    resource: {
      uri: resourcePath,
      method: request.method,
    },
  };
}

function buildPaymentRequiredResponse(
  config: X402RouteConfig,
  request: Request,
  env: Env,
  resourcePath: string,
  reason?: string,
): Response {
  const paymentRequired = buildPaymentRequirements(
    config,
    request,
    resourcePath,
    env,
  );
  const response = json(
    {
      ok: false,
      error: "payment-required",
      ...(reason ? { reason } : {}),
      paymentRequired,
    },
    { status: 402 },
  );
  const headers = new Headers(response.headers);
  headers.set(PAYMENT_REQUIRED_HEADER, toBase64Json(paymentRequired));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function requireX402Payment(
  request: Request,
  env: Env,
  routeKey: X402RouteKey,
  resourcePath: string,
): Promise<Response | null> {
  const config = loadRouteConfig(env, routeKey);
  if (await canBypassX402ForTrustedPortalRequest(request, env)) {
    return null;
  }
  const signature = getPaymentSignature(request);
  if (!signature) {
    return buildPaymentRequiredResponse(config, request, env, resourcePath);
  }
  if (!onchainVerificationEnabled(env)) {
    return null;
  }

  const provider = resolveX402Provider(env);
  try {
    if (provider === "corbits") {
      const corbitsOutcome = await consumePaymentWithCorbits(
        signature,
        config,
        env,
        request,
        resourcePath,
      );
      if (corbitsOutcome === "skipped") {
        await consumePaymentSignature(signature, config, env);
      }
    } else {
      await consumePaymentSignature(signature, config, env);
    }
    return null;
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "x402-payment-verification-failed";
    return buildPaymentRequiredResponse(
      config,
      request,
      env,
      resourcePath,
      reason,
    );
  }
}

export function withX402SettlementHeader(
  response: Response,
  request: Request,
  env: Env,
  routeKey: X402RouteKey,
  resourcePath: string,
): Response {
  const config = loadRouteConfig(env, routeKey);
  const provider = resolveX402Provider(env);
  const payload = {
    x402Version: provider === "corbits" ? 1 : 2,
    accepted: {
      scheme: "exact",
      network: normalizeCorbitsNetwork(config.network),
      asset: config.asset,
      amount: config.amountAtomic,
      maxAmountRequired: config.amountAtomic,
      payTo: config.payTo,
    },
    resource: {
      uri: resourcePath,
      method: request.method,
    },
    settled: true,
    ...(getPaymentSignature(request)
      ? { paymentSignature: getPaymentSignature(request) }
      : {}),
  };
  const headers = new Headers(response.headers);
  headers.set(PAYMENT_RESPONSE_HEADER, toBase64Json(payload));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
