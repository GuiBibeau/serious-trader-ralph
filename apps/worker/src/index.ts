import { buildAgentQueryResponse } from "./agent_query";
import { requireUser } from "./auth";

import { getUserSubscription, toSubscriptionView } from "./billing";
import {
  SOL_MINT,
  SUPPORTED_TRADING_MINTS,
  SUPPORTED_TRADING_PAIR_IDS,
  SUPPORTED_TRADING_PAIRS,
  SUPPORTED_WALLET_TOKEN_BALANCES,
  USDC_MINT,
} from "./defaults";
import { ExecutionCoordinator } from "./execution/coordinator";
import {
  hashExecutionSubmitPayload,
  readIdempotencyKey,
  reserveExecutionSubmitRequest,
} from "./execution/idempotency";
import { resolveExecutionLane } from "./execution/lane_resolver";
import {
  assembleCanonicalExecutionReceiptV1,
  canonicalExecutionReceiptStorageKey,
} from "./execution/receipt_assembler";
import {
  createRelayImmutabilitySnapshot,
  readRelayImmutabilitySnapshot,
  verifyRelayImmutabilitySnapshot,
} from "./execution/relay_immutability";
import { validateRelaySignedSubmission } from "./execution/relay_signed_validator";
import {
  appendExecutionStatusEvent,
  createExecutionAttemptIdempotent,
  finalizeExecutionAttempt,
  getExecutionLatestStatus,
  listExecutionAttempts,
  listExecutionStatusEvents,
  terminalizeExecutionRequest,
  updateExecutionRequestStatus,
  upsertExecutionReceiptIdempotent,
} from "./execution/repository";
import { executeSwapViaRouter } from "./execution/router";
import { parseExecSubmitPayload } from "./execution/submit_contract";
import {
  type ExperienceLevel,
  evaluateOnboarding,
  mergeConsumerProfile,
  parseConsumerProfileSummary,
  parseExperienceLevel,
  parseLevelSource,
  validateOnboardingInput,
} from "./experience";
import {
  fetchHistoricalOhlcvFallbackRuntime,
  fetchHistoricalOhlcvRuntime,
} from "./historical_ohlcv";
import { JupiterClient } from "./jupiter";
import {
  LOOP_A_COORDINATOR_NAME,
  LoopACoordinator,
} from "./loop_a/coordinator";
import { readLoopAHealthFromKv, recordLoopAHealthTick } from "./loop_a/health";
import {
  loopAMarksLatestKey,
  resolveMarkCommitment,
} from "./loop_a/mark_engine";
import { runLoopATickPipeline } from "./loop_a/pipeline";
import {
  LOOP_B_ANOMALY_FEED_KEY,
  LOOP_B_LIQUIDITY_STRESS_KEY,
  LOOP_B_SCORES_LATEST_KEY,
  LOOP_B_TOP_MOVERS_KEY,
  MinuteAccumulator,
} from "./loop_b/minute_accumulator";
import {
  Recommender,
  requestLoopCRecommendations,
  submitLoopCRecommendationFeedback,
  type UserPersonaInput,
} from "./loop_c/recommender";
import {
  fetchMacroEtfFlows,
  fetchMacroFredIndicators,
  fetchMacroOilAnalytics,
  fetchMacroSignals,
  fetchMacroStablecoinHealth,
} from "./macro_sources";
import { computeMarketIndicators } from "./market_indicators";
import {
  fetchPerpsFundingSurface,
  fetchPerpsOpenInterestSurface,
  fetchPerpsVenueScore,
  type PerpsVenue,
  SUPPORTED_PERPS_VENUES,
} from "./perps_sources";
import { enforcePolicy, normalizePolicy } from "./policy";
import { createPrivySolanaWallet } from "./privy";
import { gatherMarketSnapshot } from "./research";
import { json, okCors, withCors } from "./response";
import { SolanaRpc } from "./solana_rpc";
import type { Env, ExecutionConfig } from "./types";
import type { UserRow } from "./users_db";
import {
  findUserByPrivyUserId,
  setUserExperience,
  setUserOnboardingStatus,
  setUserProfile,
  setUserWallet,
  upsertUser,
} from "./users_db";
import { requireX402Payment, withX402SettlementHeader } from "./x402";

const X402_READ_RPC_ENDPOINT_FALLBACK = "https://api.mainnet-beta.solana.com";
const X402_READ_JUPITER_BASE_URL = "https://lite-api.jup.ag";
const X402_SOL_MINT = SOL_MINT;
const MAX_EXPERIENCE_EVENTS = 200;
const SUPPORTED_TRADING_MINT_SET = new Set(SUPPORTED_TRADING_MINTS);
const SUPPORTED_TRADING_PAIR_MINT_SET = new Set(
  SUPPORTED_TRADING_PAIRS.flatMap((pair) => [
    `${pair.baseMint}:${pair.quoteMint}`,
    `${pair.quoteMint}:${pair.baseMint}`,
  ]),
);

type ExperienceEventName =
  | "onboarding_started"
  | "onboarding_step_completed"
  | "onboarding_completed"
  | "level_assigned_auto"
  | "level_overridden_manual"
  | "degen_acknowledged"
  | "terminal_opened_from_consumer";

const EXPERIENCE_EVENT_NAMES = new Set<ExperienceEventName>([
  "onboarding_started",
  "onboarding_step_completed",
  "onboarding_completed",
  "level_assigned_auto",
  "level_overridden_manual",
  "degen_acknowledged",
  "terminal_opened_from_consumer",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISCOVERY_DOC_PATHS = new Set([
  "/api",
  "/endpoints.json",
  "/endpoints.txt",
  "/llms.txt",
  "/dev-skills.txt",
  "/openapi.json",
  "/agent-registry/metadata.json",
  "/api/endpoints.json",
  "/api/endpoints.txt",
  "/api/llms.txt",
  "/api/dev-skills.txt",
  "/api/openapi.json",
  "/api/agent-registry/metadata.json",
]);
const BEARER_RE = /^bearer\s+/i;

function parseBearerToken(value: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!BEARER_RE.test(raw)) return null;
  return raw.replace(BEARER_RE, "").trim() || null;
}

function readBooleanEnv(value: unknown, fallback = false): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  return fallback;
}

function shouldSyncExecutePrivySubmit(env: Env): boolean {
  return readBooleanEnv(env.EXEC_PRIVY_SYNC_SUBMIT_ENABLED, false);
}

function newExecutionAttemptId(): string {
  return `execatt_${crypto.randomUUID().replace(/-/g, "")}`;
}

function newExecutionReceiptId(): string {
  return `exec_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function executionErrorMessage(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Error) return value.message.slice(0, 2_000);
  const text = String(value).trim();
  return text ? text.slice(0, 2_000) : null;
}

function toTerminalStatusFromExecuteResult(
  status: string,
): "landed" | "failed" {
  if (status === "finalized") return "landed";
  if (status === "processed" || status === "confirmed") return "landed";
  return "failed";
}

function authorizeWaitlistWrite(
  request: Request,
  env: Env,
): { ok: true } | { ok: false; status: number; error: string } {
  const configuredToken = String(env.WAITLIST_WRITE_TOKEN ?? "").trim();
  if (!configuredToken) {
    return {
      ok: false,
      status: 503,
      error: "waitlist-auth-not-configured",
    };
  }

  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token || token !== configuredToken) {
    return {
      ok: false,
      status: 401,
      error: "auth-required",
    };
  }

  return { ok: true };
}

function resolvePortalOriginForApiHost(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().split(":")[0] ?? "";
  if (normalized === "dev.api.trader-ralph.com") {
    return "https://dev.trader-ralph.com";
  }
  if (normalized === "staging.api.trader-ralph.com") {
    return "https://staging.trader-ralph.com";
  }
  return "https://www.trader-ralph.com";
}

async function proxyPortalDiscovery(
  request: Request,
  pathname: string,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const portalOrigin = resolvePortalOriginForApiHost(requestUrl.host);
  const targetPath = pathname;
  const upstream = await fetch(`${portalOrigin}${targetPath}`, {
    method: "GET",
    headers: {
      accept:
        request.headers.get("accept") ??
        "text/html,application/json,text/plain,*/*",
    },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  return email || null;
}

async function hasWaitlistEmail(env: Env, email: string): Promise<boolean> {
  const row = (await env.WAITLIST_DB.prepare(
    "SELECT email FROM waitlist WHERE lower(email) = ?1 LIMIT 1",
  )
    .bind(email.toLowerCase())
    .first()) as unknown;
  return Boolean(row && typeof row === "object");
}

async function upsertWaitlistEmail(
  env: Env,
  email: string,
  source: string | null,
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    `INSERT INTO waitlist (email, source) VALUES (?1, ?2)
     ON CONFLICT(email) DO NOTHING`,
  )
    .bind(email.toLowerCase(), source)
    .run();
}

async function recordEndpointCall(
  env: Env,
  method: string,
  path: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  await env.WAITLIST_DB.prepare(
    `INSERT INTO endpoint_call_stats (
      endpoint_method,
      endpoint_path,
      call_count,
      first_called_at,
      last_called_at,
      created_at,
      updated_at
    ) VALUES (?1, ?2, 1, ?3, ?3, ?3, ?3)
     ON CONFLICT(endpoint_method, endpoint_path) DO UPDATE SET
       call_count = endpoint_call_stats.call_count + 1,
       last_called_at = excluded.last_called_at,
       updated_at = excluded.updated_at`,
  )
    .bind(method.toUpperCase(), path, nowIso)
    .run();
}

async function recordEndpointCallSafe(
  env: Env,
  method: string,
  path: string,
): Promise<void> {
  try {
    await recordEndpointCall(env, method, path);
  } catch {
    // Do not fail request handling if telemetry write fails.
  }
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function buildExecSubmitBillingAuditMetadata(
  request: Request,
  resourcePath: string,
): Promise<Record<string, unknown>> {
  const paymentSignature = String(
    request.headers.get("payment-signature") ?? "",
  ).trim();
  const paymentSignatureHash =
    paymentSignature.length > 0
      ? `sha256:${await sha256Hex(paymentSignature)}`
      : null;
  return {
    schemaVersion: "v1",
    model: "x402",
    routeKey: "exec_submit",
    resource: {
      uri: resourcePath,
      method: request.method.toUpperCase(),
    },
    payment: {
      required: true,
      signatureProvided: paymentSignature.length > 0,
      ...(paymentSignatureHash ? { signatureHash: paymentSignatureHash } : {}),
    },
    settlementHeader: "payment-response",
    polling: {
      statusPath: "/api/x402/exec/status/:requestId",
      receiptPath: "/api/x402/exec/receipt/:requestId",
      requiresPayment: false,
    },
  };
}

export {
  ExecutionCoordinator,
  LoopACoordinator,
  MinuteAccumulator,
  Recommender,
};

function isSupportedTradingPairByMint(inputMint: string, outputMint: string) {
  return SUPPORTED_TRADING_PAIR_MINT_SET.has(`${inputMint}:${outputMint}`);
}

function unsupportedTradePairPayload() {
  return {
    ok: false,
    error: "unsupported-trade-pair",
    supportedMints: SUPPORTED_TRADING_MINTS,
    supportedPairs: SUPPORTED_TRADING_PAIR_IDS,
  } as const;
}

function resolveX402ReadRpcEndpoint(env: Env): string {
  const balanceRpc = String(env.BALANCE_RPC_ENDPOINT ?? "").trim();
  if (balanceRpc) return balanceRpc;
  const rpc = String(env.RPC_ENDPOINT ?? "").trim();
  if (rpc) return rpc;
  return X402_READ_RPC_ENDPOINT_FALLBACK;
}

const worker = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    if (request.method === "OPTIONS") {
      return okCors(env);
    }

    const url = new URL(request.url);
    if (request.method === "GET" && DISCOVERY_DOC_PATHS.has(url.pathname)) {
      await recordEndpointCallSafe(env, request.method, url.pathname);
      const proxied = await proxyPortalDiscovery(request, url.pathname);
      return withCors(proxied, env);
    }
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) {
      url.pathname = `/api${url.pathname}`;
    }
    await recordEndpointCallSafe(env, request.method, url.pathname);
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        const loopAHealth = await readLoopAHealthFromKv(env);
        if (!loopAHealth) {
          return withCors(json({ ok: true }), env);
        }
        return withCors(
          json({
            ok: loopAHealth.status !== "error",
            loopA: loopAHealth,
          }),
          env,
        );
      }

      if (
        (request.method === "GET" || request.method === "POST") &&
        url.pathname === "/api/agent/query"
      ) {
        const payload =
          request.method === "POST" ? await readPayload(request) : {};
        const query =
          request.method === "GET"
            ? url.searchParams.get("q")
            : (payload.query ?? payload.q);
        return withCors(json(buildAgentQueryResponse(query, url)), env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/exec/submit"
      ) {
        const payload = await readPayload(request);
        const parsed = parseExecSubmitPayload(payload);
        if (!parsed.ok) {
          return withCors(
            json({ ok: false, error: parsed.error }, { status: 400 }),
            env,
          );
        }

        const idempotencyKey = readIdempotencyKey(request);
        if (!idempotencyKey) {
          return withCors(
            json(
              { ok: false, error: "missing-idempotency-key" },
              { status: 400 },
            ),
            env,
          );
        }

        let actorType: "anonymous_x402" | "privy_user" = "anonymous_x402";
        let actorId: string | null = null;
        const isRelaySigned = parsed.value.mode === "relay_signed";
        let submitMetadata = parsed.metadataForStorage;
        let relayImmutability: ReturnType<
          typeof readRelayImmutabilitySnapshot
        > = null;
        let privyActorContext: {
          userId: string;
          walletAddress: string;
          privyWalletId: string;
        } | null = null;
        if (!isRelaySigned) {
          let user = await requireOnboardedUser(request, env);
          user = await ensureUserWallet(env, user);
          if (!user.walletAddress || !user.privyWalletId) {
            return withCors(
              json(
                { ok: false, error: "user-wallet-missing" },
                { status: 503 },
              ),
              env,
            );
          }
          if (parsed.value.privyExecute.wallet !== user.walletAddress) {
            return withCors(
              json({ ok: false, error: "invalid-request" }, { status: 400 }),
              env,
            );
          }
          actorType = "privy_user";
          actorId = user.id;
          privyActorContext = {
            userId: user.id,
            walletAddress: user.walletAddress,
            privyWalletId: user.privyWalletId,
          };
        }

        const laneResolution = resolveExecutionLane({
          env,
          requestedLane: parsed.value.lane,
          mode: parsed.value.mode,
          actorType,
        });
        if (!laneResolution.ok) {
          return withCors(
            json(
              {
                ok: false,
                error: laneResolution.error,
                reason: laneResolution.reason,
              },
              { status: 400 },
            ),
            env,
          );
        }
        submitMetadata = {
          ...(submitMetadata ?? {}),
          laneResolution: laneResolution.metadata,
        };

        if (isRelaySigned) {
          let paymentRequired: Response | null = null;
          try {
            paymentRequired = await requireX402Payment(
              request,
              env,
              "exec_submit",
              url.pathname,
            );
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "x402-route-config-missing";
            return withCors(
              json({ ok: false, error: message }, { status: 503 }),
              env,
            );
          }
          if (paymentRequired) return withCors(paymentRequired, env);
          const billingMetadata = await buildExecSubmitBillingAuditMetadata(
            request,
            url.pathname,
          );
          submitMetadata = {
            ...(submitMetadata ?? {}),
            x402Billing: billingMetadata,
          };

          const validation = await validateRelaySignedSubmission(
            env,
            parsed.value.relaySigned,
          );
          if (!validation.ok) {
            return withCors(
              json(
                {
                  ok: false,
                  error: validation.error,
                  reason: validation.reason,
                },
                { status: validation.error === "policy-denied" ? 403 : 400 },
              ),
              env,
            );
          }
          relayImmutability = await createRelayImmutabilitySnapshot({
            signedTransactionBase64: parsed.value.relaySigned.signedTransaction,
          });
          if (!relayImmutability) {
            return withCors(
              json(
                {
                  ok: false,
                  error: "invalid-transaction",
                  reason: "relay-immutability-hash-failed",
                },
                { status: 400 },
              ),
              env,
            );
          }
          submitMetadata = {
            ...(submitMetadata ?? {}),
            relayValidation: {
              transactionVersion: validation.parsed.transactionVersion,
              signatureCount: validation.parsed.signatureCount,
              txSizeBytes: validation.parsed.txSizeBytes,
              feePayer: validation.parsed.feePayer,
              recentBlockhash: validation.parsed.recentBlockhash,
              programIds: validation.parsed.programIds,
            },
            relayImmutability,
          };
        }

        const payloadHash = await hashExecutionSubmitPayload(parsed.value);
        const reservation = await reserveExecutionSubmitRequest({
          db: env.WAITLIST_DB,
          requestId: newExecRequestId(),
          idempotencyKey,
          actorType,
          actorId,
          mode: parsed.value.mode,
          lane: laneResolution.lane,
          payloadHash,
          metadata: submitMetadata,
        });

        if (reservation.result === "conflict") {
          return withCors(
            json(
              {
                ok: false,
                error: "invalid-request",
                reason: reservation.error,
                requestId: reservation.request.requestId,
              },
              { status: 409 },
            ),
            env,
          );
        }

        if (isRelaySigned && reservation.result !== "created") {
          const storedImmutability = readRelayImmutabilitySnapshot(
            reservation.request.metadata,
          );
          if (storedImmutability) {
            const immutabilityVerification =
              await verifyRelayImmutabilitySnapshot({
                expectedReceivedTxHash: storedImmutability.receivedTxHash,
                signedTransactionBase64:
                  parsed.value.mode === "relay_signed"
                    ? parsed.value.relaySigned.signedTransaction
                    : "",
              });
            if (!immutabilityVerification.ok) {
              return withCors(
                json(
                  {
                    ok: false,
                    error: immutabilityVerification.error,
                    reason: immutabilityVerification.reason,
                  },
                  {
                    status:
                      immutabilityVerification.error === "policy-denied"
                        ? 403
                        : 400,
                  },
                ),
                env,
              );
            }
          }
        }

        if (reservation.result === "created") {
          await appendExecutionStatusEvent(env.WAITLIST_DB, {
            requestId: reservation.request.requestId,
            status: "received",
            reason: null,
            details: null,
          });
          await updateExecutionRequestStatus(env.WAITLIST_DB, {
            requestId: reservation.request.requestId,
            status: "validated",
            statusReason: null,
          });
          await appendExecutionStatusEvent(env.WAITLIST_DB, {
            requestId: reservation.request.requestId,
            status: "validated",
            reason: null,
            details: null,
          });
        }

        if (
          reservation.result === "created" &&
          !isRelaySigned &&
          shouldSyncExecutePrivySubmit(env) &&
          privyActorContext
        ) {
          const swap = parsed.value.privyExecute.swap;
          const options = parsed.value.privyExecute.options ?? {};
          const execution = {
            adapter: laneResolution.adapter,
          };
          const policy = normalizePolicy({
            allowedMints: SUPPORTED_TRADING_MINTS,
            slippageBps: swap.slippageBps,
            maxPriceImpactPct: 0.05,
            minSolReserveLamports: "50000000",
            simulateOnly: Boolean(options.simulateOnly),
            dryRun: Boolean(options.dryRun),
            commitment: options.commitment ?? "confirmed",
          });

          const attemptId = newExecutionAttemptId();
          const attemptStartedAt = new Date().toISOString();
          let providerResponse: Record<string, unknown> | null = {
            route: laneResolution.adapter,
            lane: laneResolution.lane,
            mode: parsed.value.mode,
          };

          try {
            const rpcEndpoint = String(env.RPC_ENDPOINT ?? "").trim();
            if (!rpcEndpoint) {
              throw new Error("rpc-endpoint-missing");
            }
            const rpc = new SolanaRpc(rpcEndpoint);
            const jupiter = new JupiterClient(
              String(env.JUPITER_BASE_URL ?? "").trim() ||
                X402_READ_JUPITER_BASE_URL,
              env.JUPITER_API_KEY,
            );

            const inputAmount = BigInt(swap.amountAtomic);
            if (inputAmount <= 0n) {
              throw new Error("invalid-trade-request");
            }

            if (swap.inputMint === X402_SOL_MINT) {
              const balanceLamports = await rpc.getBalanceLamports(
                privyActorContext.walletAddress,
              );
              const minSolReserveLamports = BigInt(
                policy.minSolReserveLamports,
              );
              if (inputAmount + minSolReserveLamports > balanceLamports) {
                throw new Error("insufficient-sol-reserve");
              }
            } else {
              const tokenBalance = await rpc.getTokenBalanceAtomic(
                privyActorContext.walletAddress,
                swap.inputMint,
              );
              if (inputAmount > tokenBalance) {
                throw new Error("insufficient-token-balance");
              }
            }

            const quoteResponse = await jupiter.quote({
              inputMint: swap.inputMint,
              outputMint: swap.outputMint,
              amount: swap.amountAtomic,
              slippageBps: policy.slippageBps,
              swapMode: "ExactIn",
            });
            enforcePolicy(policy, quoteResponse);

            await updateExecutionRequestStatus(env.WAITLIST_DB, {
              requestId: reservation.request.requestId,
              status: "dispatched",
              statusReason: null,
            });
            await appendExecutionStatusEvent(env.WAITLIST_DB, {
              requestId: reservation.request.requestId,
              status: "dispatched",
              reason: null,
              details: {
                provider: laneResolution.adapter,
                attempt: 1,
              },
              createdAt: attemptStartedAt,
            });
            await createExecutionAttemptIdempotent(env.WAITLIST_DB, {
              attemptId,
              requestId: reservation.request.requestId,
              attemptNo: 1,
              lane: laneResolution.lane,
              provider: laneResolution.adapter,
              status: "dispatched",
              providerResponse,
              startedAt: attemptStartedAt,
            });

            const result = await executeSwapViaRouter({
              env,
              execution,
              policy,
              rpc,
              jupiter,
              quoteResponse,
              userPublicKey: privyActorContext.walletAddress,
              privyWalletId: privyActorContext.privyWalletId,
              log(level, message, meta) {
                console[level]("exec.submit", {
                  requestId: reservation.request.requestId,
                  userId: privyActorContext.userId,
                  message,
                  ...(meta ?? {}),
                });
              },
            });
            const settledAt = new Date().toISOString();
            const terminalStatus = toTerminalStatusFromExecuteResult(
              result.status,
            );
            const errorMessage = executionErrorMessage(result.err);
            providerResponse = {
              ...(providerResponse ?? {}),
              executionStatus: result.status,
              refreshed: result.refreshed,
              lastValidBlockHeight: result.lastValidBlockHeight,
              executionMeta:
                result.executionMeta &&
                typeof result.executionMeta === "object" &&
                !Array.isArray(result.executionMeta)
                  ? result.executionMeta
                  : null,
            };

            await finalizeExecutionAttempt(env.WAITLIST_DB, {
              attemptId,
              status: result.status,
              providerResponse,
              errorCode: terminalStatus === "failed" ? result.status : null,
              errorMessage,
              completedAt: settledAt,
            });
            await upsertExecutionReceiptIdempotent(env.WAITLIST_DB, {
              requestId: reservation.request.requestId,
              receiptId: newExecutionReceiptId(),
              finalizedStatus: terminalStatus,
              lane: laneResolution.lane,
              provider: laneResolution.adapter,
              signature: result.signature,
              slot: null,
              errorCode: terminalStatus === "failed" ? result.status : null,
              errorMessage,
              receipt: {
                mode: parsed.value.mode,
                route: laneResolution.adapter,
                resultStatus: result.status,
                outcome: terminalStatus,
                quote: {
                  inputMint: swap.inputMint,
                  outputMint: swap.outputMint,
                  inAmount: swap.amountAtomic,
                  outAmount: String(result.usedQuote?.outAmount ?? ""),
                },
              },
              readyAt: settledAt,
            });
            await terminalizeExecutionRequest(env.WAITLIST_DB, {
              requestId: reservation.request.requestId,
              status: terminalStatus,
              statusReason: terminalStatus === "failed" ? result.status : null,
              details: {
                provider: laneResolution.adapter,
                attempt: 1,
                ...(result.signature ? { signature: result.signature } : {}),
              },
              nowIso: settledAt,
            });
          } catch (error) {
            const failedAt = new Date().toISOString();
            const errorMessage =
              executionErrorMessage(error) ?? "execution-submit-failed";
            await createExecutionAttemptIdempotent(env.WAITLIST_DB, {
              attemptId,
              requestId: reservation.request.requestId,
              attemptNo: 1,
              lane: laneResolution.lane,
              provider: laneResolution.adapter,
              status: "failed",
              providerResponse,
              errorCode: "execution-failed",
              errorMessage,
              startedAt: attemptStartedAt,
            });
            await finalizeExecutionAttempt(env.WAITLIST_DB, {
              attemptId,
              status: "failed",
              providerResponse,
              errorCode: "execution-failed",
              errorMessage,
              completedAt: failedAt,
            });
            await upsertExecutionReceiptIdempotent(env.WAITLIST_DB, {
              requestId: reservation.request.requestId,
              receiptId: newExecutionReceiptId(),
              finalizedStatus: "failed",
              lane: laneResolution.lane,
              provider: laneResolution.adapter,
              signature: null,
              slot: null,
              errorCode: "execution-failed",
              errorMessage,
              receipt: {
                mode: parsed.value.mode,
                route: laneResolution.adapter,
                outcome: "failed",
              },
              readyAt: failedAt,
            });
            await terminalizeExecutionRequest(env.WAITLIST_DB, {
              requestId: reservation.request.requestId,
              status: "failed",
              statusReason: "execution-failed",
              details: {
                provider: laneResolution.adapter,
                attempt: 1,
                errorMessage,
              },
              nowIso: failedAt,
            });
          }
        }

        const latest = await getExecutionLatestStatus(
          env.WAITLIST_DB,
          reservation.request.requestId,
        );
        const updatedAt =
          latest?.request.updatedAt ?? reservation.request.updatedAt;
        const state = toExecSubmitState(latest?.request.status ?? "validated");
        const base = json({
          ok: true,
          requestId: reservation.request.requestId,
          status: {
            state,
            terminal: isExecSubmitTerminalState(state),
            updatedAt,
          },
          poll: {
            statusUrl: `/api/x402/exec/status/${reservation.request.requestId}`,
            receiptUrl: `/api/x402/exec/receipt/${reservation.request.requestId}`,
          },
        });
        if (!isRelaySigned) return withCors(base, env);
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "exec_submit",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/x402/exec/status/")
      ) {
        const requestId = url.pathname.slice("/api/x402/exec/status/".length);
        if (!isValidExecRequestId(requestId)) {
          return withCors(
            json({ ok: false, error: "invalid-request-id" }, { status: 400 }),
            env,
          );
        }

        const latest = await getExecutionLatestStatus(
          env.WAITLIST_DB,
          requestId,
        );
        if (!latest) {
          return withCors(
            json({ ok: false, error: "not-found" }, { status: 404 }),
            env,
          );
        }

        const [events, attempts] = await Promise.all([
          listExecutionStatusEvents(env.WAITLIST_DB, requestId, 500),
          listExecutionAttempts(env.WAITLIST_DB, requestId),
        ]);
        const timelineEvents =
          events.length > 0
            ? events
            : [
                {
                  eventId: "synthetic",
                  requestId,
                  seq: 1,
                  status: latest.request.status,
                  reason: latest.request.statusReason,
                  details: null,
                  createdAt: latest.request.updatedAt,
                },
              ];
        const attemptsByState = new Map<string, (typeof attempts)[number]>();
        for (const attempt of attempts) {
          if (!attemptsByState.has(attempt.status)) {
            attemptsByState.set(attempt.status, attempt);
          }
        }

        const state = toExecSubmitState(latest.request.status);
        const queueDepthRaw = Number(latest.request.metadata?.queueDepth);
        const queuePositionRaw = Number(latest.request.metadata?.queuePosition);
        const relayImmutability = readRelayImmutabilitySnapshot(
          latest.request.metadata,
        );
        return withCors(
          json({
            ok: true,
            requestId,
            status: {
              state,
              terminal: isExecSubmitTerminalState(state),
              mode: latest.request.mode,
              lane: latest.request.lane,
              actorType: latest.request.actorType,
              receivedAt: latest.request.receivedAt,
              updatedAt: latest.request.updatedAt,
              terminalAt: latest.request.terminalAt,
              ...(Number.isFinite(queueDepthRaw) && queueDepthRaw >= 0
                ? { queueDepth: Math.floor(queueDepthRaw) }
                : {}),
              ...(Number.isFinite(queuePositionRaw) && queuePositionRaw >= 0
                ? { queuePosition: Math.floor(queuePositionRaw) }
                : {}),
              ...(relayImmutability ? { immutability: relayImmutability } : {}),
            },
            events: timelineEvents.map((event) => {
              const mappedState = toExecSubmitState(event.status);
              const attempt = attemptsByState.get(event.status);
              return {
                state: mappedState,
                at: event.createdAt,
                ...(attempt ? { provider: attempt.provider } : {}),
                ...(attempt ? { attempt: attempt.attemptNo } : {}),
                ...(event.reason ? { note: event.reason } : {}),
              };
            }),
            attempts: attempts.map((attempt) => ({
              attempt: attempt.attemptNo,
              provider: attempt.provider,
              state: attempt.status,
              at: attempt.completedAt ?? attempt.startedAt,
            })),
          }),
          env,
        );
      }

      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/x402/exec/receipt/")
      ) {
        const requestId = url.pathname.slice("/api/x402/exec/receipt/".length);
        if (!isValidExecRequestId(requestId)) {
          return withCors(
            json({ ok: false, error: "invalid-request-id" }, { status: 400 }),
            env,
          );
        }

        const latest = await getExecutionLatestStatus(
          env.WAITLIST_DB,
          requestId,
        );
        if (!latest) {
          return withCors(
            json({ ok: false, error: "not-found" }, { status: 404 }),
            env,
          );
        }

        const state = toExecSubmitState(latest.request.status);
        const terminal = isExecSubmitTerminalState(state);
        const relayImmutability = readRelayImmutabilitySnapshot(
          latest.request.metadata,
        );
        if (!latest.receipt) {
          return withCors(
            json({
              ok: true,
              requestId,
              ready: false,
              status: {
                state,
                terminal,
                updatedAt: latest.request.updatedAt,
                ...(relayImmutability
                  ? { immutability: relayImmutability }
                  : {}),
              },
            }),
            env,
          );
        }

        const attempts = await listExecutionAttempts(
          env.WAITLIST_DB,
          requestId,
        );
        const canonicalReceipt = assembleCanonicalExecutionReceiptV1({
          request: latest.request,
          receipt: latest.receipt,
          attempts,
          immutability: relayImmutability,
        });
        if (env.LOGS_BUCKET) {
          const key = canonicalExecutionReceiptStorageKey(requestId);
          try {
            await env.LOGS_BUCKET.put(key, JSON.stringify(canonicalReceipt));
          } catch (error) {
            console.warn("exec.receipt.persist.error", {
              requestId,
              key,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return withCors(
          json({
            ok: true,
            requestId,
            ready: true,
            receipt: canonicalReceipt,
          }),
          env,
        );
      }

      if (request.method === "POST" && url.pathname === "/api/waitlist") {
        const waitlistAuth = authorizeWaitlistWrite(request, env);
        if (!waitlistAuth.ok) {
          return withCors(
            json(
              { ok: false, error: waitlistAuth.error },
              { status: waitlistAuth.status },
            ),
            env,
          );
        }

        const payload = await readPayload(request);
        const email = normalizeEmail(payload.email);
        if (!email || !EMAIL_RE.test(email)) {
          return withCors(
            json({ ok: false, error: "invalid-email" }, { status: 400 }),
            env,
          );
        }

        const source = String(payload.source ?? "landing_page")
          .trim()
          .slice(0, 80);
        await upsertWaitlistEmail(env, email, source || null);
        return withCors(json({ ok: true, email }), env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_snapshot"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "market_snapshot",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const walletAddress = String(payload.walletAddress ?? "").trim();
        if (!walletAddress) {
          return withCors(
            json(
              { ok: false, error: "missing-wallet-address" },
              { status: 400 },
            ),
            env,
          );
        }

        const quoteMintRaw = String(payload.quoteMint ?? "").trim();
        const quoteDecimalsRaw = Number(payload.quoteDecimals);
        const quoteDecimals = Number.isFinite(quoteDecimalsRaw)
          ? quoteDecimalsRaw
          : undefined;

        // Public x402 read routes always serve mainnet market data.
        const rpc = new SolanaRpc(resolveX402ReadRpcEndpoint(env));
        const jupiter = new JupiterClient(
          X402_READ_JUPITER_BASE_URL,
          env.JUPITER_API_KEY,
        );
        const snapshot = await gatherMarketSnapshot(
          rpc,
          jupiter,
          walletAddress,
          normalizePolicy(undefined),
          {
            quoteMint: quoteMintRaw || undefined,
            quoteDecimals,
          },
        );
        const base = json({ ok: true, snapshot });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_snapshot",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_snapshot_v2"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "market_snapshot_v2",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const walletAddress = String(payload.walletAddress ?? "").trim();
        if (!walletAddress) {
          return withCors(
            json(
              { ok: false, error: "missing-wallet-address" },
              { status: 400 },
            ),
            env,
          );
        }
        if (
          payload.trackedMints !== undefined &&
          !Array.isArray(payload.trackedMints)
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-snapshot-request" },
              { status: 400 },
            ),
            env,
          );
        }

        const quoteMintRaw = String(payload.quoteMint ?? "").trim();
        const quoteDecimalsRaw = Number(payload.quoteDecimals);
        const quoteDecimals = Number.isFinite(quoteDecimalsRaw)
          ? quoteDecimalsRaw
          : undefined;
        const trackedMints = toUniqueStrings(payload.trackedMints, 32);

        const rpc = new SolanaRpc(resolveX402ReadRpcEndpoint(env));
        const jupiter = new JupiterClient(
          X402_READ_JUPITER_BASE_URL,
          env.JUPITER_API_KEY,
        );
        const snapshot = await gatherMarketSnapshot(
          rpc,
          jupiter,
          walletAddress,
          normalizePolicy(undefined),
          {
            quoteMint: quoteMintRaw || undefined,
            quoteDecimals,
          },
        );

        const balanceMints = Array.from(
          new Set([X402_SOL_MINT, snapshot.quoteMint, ...trackedMints]),
        );
        const balances = await Promise.all(
          balanceMints.map(async (mint) => {
            const balanceAtomic =
              mint === X402_SOL_MINT
                ? await rpc.getBalanceLamports(walletAddress)
                : await rpc.getTokenBalanceAtomic(walletAddress, mint);
            return {
              mint,
              balanceAtomic: balanceAtomic.toString(),
            };
          }),
        );

        const base = json({ ok: true, snapshot, balances });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_snapshot_v2",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_token_balance"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "market_token_balance",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const walletAddress = String(payload.walletAddress ?? "").trim();
        const mint = String(payload.mint ?? "").trim();
        if (!walletAddress) {
          return withCors(
            json(
              { ok: false, error: "missing-wallet-address" },
              { status: 400 },
            ),
            env,
          );
        }
        if (!mint) {
          return withCors(
            json({ ok: false, error: "missing-mint" }, { status: 400 }),
            env,
          );
        }

        const rpc = new SolanaRpc(resolveX402ReadRpcEndpoint(env));
        const balanceAtomic =
          mint === X402_SOL_MINT
            ? await rpc.getBalanceLamports(walletAddress)
            : await rpc.getTokenBalanceAtomic(walletAddress, mint);
        const base = json({
          ok: true,
          balance: {
            walletAddress,
            mint,
            balanceAtomic: balanceAtomic.toString(),
            ts: new Date().toISOString(),
          },
        });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_token_balance",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_jupiter_quote"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "market_jupiter_quote",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const inputMint = String(payload.inputMint ?? "").trim();
        const outputMint = String(payload.outputMint ?? "").trim();
        const amount = String(payload.amount ?? "").trim();
        const slippageBpsRaw = Number(payload.slippageBps);
        const slippageBps = Number.isFinite(slippageBpsRaw)
          ? Math.max(1, Math.min(5_000, Math.floor(slippageBpsRaw)))
          : 50;
        if (!inputMint || !outputMint || !amount || !/^\d+$/.test(amount)) {
          return withCors(
            json(
              { ok: false, error: "invalid-quote-request" },
              { status: 400 },
            ),
            env,
          );
        }
        if (
          !SUPPORTED_TRADING_MINT_SET.has(inputMint) ||
          !SUPPORTED_TRADING_MINT_SET.has(outputMint) ||
          !isSupportedTradingPairByMint(inputMint, outputMint)
        ) {
          return withCors(
            json(unsupportedTradePairPayload(), { status: 400 }),
            env,
          );
        }

        // Public x402 read routes always serve mainnet market data.
        const jupiter = new JupiterClient(
          X402_READ_JUPITER_BASE_URL,
          env.JUPITER_API_KEY,
        );
        const quote = await jupiter.quote({
          inputMint,
          outputMint,
          amount,
          slippageBps,
          swapMode: "ExactIn",
        });
        const base = json({
          ok: true,
          quote,
          supportedMints: SUPPORTED_TRADING_MINTS,
          supportedPairs: SUPPORTED_TRADING_PAIR_IDS,
        });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_jupiter_quote",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_jupiter_quote_batch"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "market_jupiter_quote_batch",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const requests = Array.isArray(payload.requests)
          ? payload.requests
          : null;
        if (!requests || requests.length < 1 || requests.length > 20) {
          return withCors(
            json(
              { ok: false, error: "invalid-quote-batch-request" },
              { status: 400 },
            ),
            env,
          );
        }

        const jupiter = new JupiterClient(
          X402_READ_JUPITER_BASE_URL,
          env.JUPITER_API_KEY,
        );
        const results: Array<Record<string, unknown>> = [];
        let successCount = 0;
        for (let index = 0; index < requests.length; index += 1) {
          const item = requests[index];
          if (!isRecord(item)) {
            results.push({ ok: false, index, error: "invalid-quote-request" });
            continue;
          }

          const inputMint = String(item.inputMint ?? "").trim();
          const outputMint = String(item.outputMint ?? "").trim();
          const amount = String(item.amount ?? "").trim();
          const slippageBps = toBoundedInt(item.slippageBps, 50, 1, 5_000);
          if (!inputMint || !outputMint || !amount || !/^\d+$/.test(amount)) {
            results.push({ ok: false, index, error: "invalid-quote-request" });
            continue;
          }
          if (
            !SUPPORTED_TRADING_MINT_SET.has(inputMint) ||
            !SUPPORTED_TRADING_MINT_SET.has(outputMint) ||
            !isSupportedTradingPairByMint(inputMint, outputMint)
          ) {
            results.push({
              ok: false,
              index,
              error: "unsupported-trade-pair",
              supportedMints: SUPPORTED_TRADING_MINTS,
              supportedPairs: SUPPORTED_TRADING_PAIR_IDS,
            });
            continue;
          }

          try {
            const quote = await jupiter.quote({
              inputMint,
              outputMint,
              amount,
              slippageBps,
              swapMode: "ExactIn",
            });
            successCount += 1;
            results.push({
              ok: true,
              index,
              quote: summarizeJupiterQuote(quote as Record<string, unknown>),
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "quote-failed";
            results.push({ ok: false, index, error: "quote-failed", message });
          }
        }

        if (successCount < 1) {
          return withCors(
            json(
              {
                ok: false,
                error: "quote-batch-failed",
                results,
              },
              { status: 503 },
            ),
            env,
          );
        }

        const base = json({
          ok: true,
          successCount,
          errorCount: requests.length - successCount,
          results,
          supportedMints: SUPPORTED_TRADING_MINTS,
          supportedPairs: SUPPORTED_TRADING_PAIR_IDS,
        });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_jupiter_quote_batch",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_ohlcv"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "market_ohlcv",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const baseMint = String(payload.baseMint ?? "").trim();
        const quoteMint = String(payload.quoteMint ?? "").trim();
        if (
          baseMint &&
          quoteMint &&
          !isSupportedTradingPairByMint(baseMint, quoteMint)
        ) {
          return withCors(
            json(unsupportedTradePairPayload(), { status: 400 }),
            env,
          );
        }
        const ohlcvOptions = {
          defaultLookbackHours: 168,
          defaultLimit: 168,
          minLookbackHours: 24,
          maxLookbackHours: 720,
          minLimit: 24,
          maxLimit: 720,
          requireMints: true,
        } as const;
        let ohlcv: Awaited<ReturnType<typeof fetchHistoricalOhlcvRuntime>>;
        try {
          ohlcv = await fetchHistoricalOhlcvRuntime(env, payload, ohlcvOptions);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "ohlcv-fetch-failed";
          if (message === "invalid-ohlcv-request") {
            return withCors(
              json(
                { ok: false, error: "invalid-ohlcv-request" },
                { status: 400 },
              ),
              env,
            );
          }
          try {
            ohlcv = await fetchHistoricalOhlcvFallbackRuntime(
              env,
              payload,
              ohlcvOptions,
            );
          } catch {
            return withCors(
              json({ ok: false, error: "ohlcv-fetch-failed" }, { status: 503 }),
              env,
            );
          }
        }

        const base = json({
          ok: true,
          ohlcv,
          supportedMints: SUPPORTED_TRADING_MINTS,
          supportedPairs: SUPPORTED_TRADING_PAIR_IDS,
        });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_ohlcv",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/market_indicators"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "market_indicators",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const baseMint = String(payload.baseMint ?? "").trim();
        const quoteMint = String(payload.quoteMint ?? "").trim();
        if (
          baseMint &&
          quoteMint &&
          !isSupportedTradingPairByMint(baseMint, quoteMint)
        ) {
          return withCors(
            json(unsupportedTradePairPayload(), { status: 400 }),
            env,
          );
        }
        const ohlcvOptions = {
          defaultLookbackHours: 168,
          defaultLimit: 168,
          minLookbackHours: 24,
          maxLookbackHours: 720,
          minLimit: 24,
          maxLimit: 720,
          requireMints: true,
        } as const;
        let ohlcv: Awaited<ReturnType<typeof fetchHistoricalOhlcvRuntime>>;
        try {
          ohlcv = await fetchHistoricalOhlcvRuntime(env, payload, ohlcvOptions);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "indicators-fetch-failed";
          if (message === "invalid-ohlcv-request") {
            return withCors(
              json(
                { ok: false, error: "invalid-indicators-request" },
                { status: 400 },
              ),
              env,
            );
          }
          try {
            ohlcv = await fetchHistoricalOhlcvFallbackRuntime(
              env,
              payload,
              ohlcvOptions,
            );
          } catch {
            return withCors(
              json(
                { ok: false, error: "indicators-fetch-failed" },
                { status: 503 },
              ),
              env,
            );
          }
        }

        const indicators = computeMarketIndicators(ohlcv.bars);
        const base = json({
          ok: true,
          ohlcv,
          indicators,
          supportedMints: SUPPORTED_TRADING_MINTS,
          supportedPairs: SUPPORTED_TRADING_PAIR_IDS,
        });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "market_indicators",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/solana_marks_latest"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "solana_marks_latest",
            "/api/x402/read/solana_marks_latest",
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);
        if (!env.CONFIG_KV) {
          return withCors(
            json(
              { ok: false, error: "loop-data-unavailable" },
              { status: 503 },
            ),
            env,
          );
        }

        const payload = await readPayload(request);
        const commitment = parseLoopACommitment(payload.commitment);
        if (!commitment) {
          return withCors(
            json({ ok: false, error: "invalid-commitment" }, { status: 400 }),
            env,
          );
        }

        const key = loopAMarksLatestKey(commitment);
        const marks = await readJsonFromKv(env.CONFIG_KV, key);
        if (marks === null) {
          return withCors(
            json(
              { ok: false, error: "loop-data-unavailable" },
              { status: 503 },
            ),
            env,
          );
        }
        const base = json({
          ok: true,
          commitment,
          marks,
        });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "solana_marks_latest",
          "/api/x402/read/solana_marks_latest",
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/solana_scores_latest"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "solana_scores_latest",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);
        if (!env.CONFIG_KV) {
          return withCors(
            json(
              { ok: false, error: "loop-data-unavailable" },
              { status: 503 },
            ),
            env,
          );
        }

        const payload = await readPayload(request);
        if (
          payload.pairId !== undefined &&
          payload.pairId !== null &&
          typeof payload.pairId !== "string"
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-score-request" },
              { status: 400 },
            ),
            env,
          );
        }
        const pairId = String(payload.pairId ?? "").trim();
        const rawScores = await readJsonFromKv(
          env.CONFIG_KV,
          LOOP_B_SCORES_LATEST_KEY,
        );
        if (rawScores === null) {
          return withCors(
            json(
              { ok: false, error: "loop-data-unavailable" },
              { status: 503 },
            ),
            env,
          );
        }

        const scores = filterLoopBScores(rawScores, pairId);
        const base = json({
          ok: true,
          ...(pairId ? { pairId } : {}),
          scores,
        });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "solana_scores_latest",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/solana_views_top"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "solana_views_top",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);
        if (!env.CONFIG_KV) {
          return withCors(
            json(
              { ok: false, error: "loop-data-unavailable" },
              { status: 503 },
            ),
            env,
          );
        }

        const payload = await readPayload(request);
        const view = parseLoopBViewSelection(payload.view);
        if (!view) {
          return withCors(
            json({ ok: false, error: "invalid-view-request" }, { status: 400 }),
            env,
          );
        }

        const [topMovers, liquidityStress, anomalyFeed] = await Promise.all([
          view === "all" || view === "top_movers"
            ? readJsonFromKv(env.CONFIG_KV, LOOP_B_TOP_MOVERS_KEY)
            : Promise.resolve(null),
          view === "all" || view === "liquidity_stress"
            ? readJsonFromKv(env.CONFIG_KV, LOOP_B_LIQUIDITY_STRESS_KEY)
            : Promise.resolve(null),
          view === "all" || view === "anomaly_feed"
            ? readJsonFromKv(env.CONFIG_KV, LOOP_B_ANOMALY_FEED_KEY)
            : Promise.resolve(null),
        ]);

        if (!topMovers && !liquidityStress && !anomalyFeed) {
          return withCors(
            json(
              { ok: false, error: "loop-data-unavailable" },
              { status: 503 },
            ),
            env,
          );
        }

        const base = json({
          ok: true,
          view,
          ...(topMovers ? { topMovers } : {}),
          ...(liquidityStress ? { liquidityStress } : {}),
          ...(anomalyFeed ? { anomalyFeed } : {}),
        });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "solana_views_top",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/macro_signals"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "macro_signals",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const macro = await fetchMacroSignals();
        const base = json({ ok: true, ...macro });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "macro_signals",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/macro_fred_indicators"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "macro_fred_indicators",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        if (
          payload.seriesIds !== undefined &&
          !Array.isArray(payload.seriesIds)
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-macro-fred-request" },
              { status: 400 },
            ),
            env,
          );
        }
        if (
          payload.observationStart !== undefined &&
          typeof payload.observationStart !== "string"
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-macro-fred-request" },
              { status: 400 },
            ),
            env,
          );
        }
        if (
          payload.observationEnd !== undefined &&
          typeof payload.observationEnd !== "string"
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-macro-fred-request" },
              { status: 400 },
            ),
            env,
          );
        }

        const macro = await fetchMacroFredIndicators(env, {
          seriesIds: toUniqueStrings(payload.seriesIds, 20),
          observationStart:
            typeof payload.observationStart === "string"
              ? payload.observationStart
              : undefined,
          observationEnd:
            typeof payload.observationEnd === "string"
              ? payload.observationEnd
              : undefined,
        });
        const base = json({ ok: true, ...macro });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "macro_fred_indicators",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/macro_etf_flows"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "macro_etf_flows",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        if (payload.tickers !== undefined && !Array.isArray(payload.tickers)) {
          return withCors(
            json(
              { ok: false, error: "invalid-macro-etf-request" },
              { status: 400 },
            ),
            env,
          );
        }

        const macro = await fetchMacroEtfFlows({
          tickers: toUniqueStrings(payload.tickers, 20),
        });
        const base = json({ ok: true, ...macro });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "macro_etf_flows",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/macro_stablecoin_health"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "macro_stablecoin_health",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        if (payload.coins !== undefined && !Array.isArray(payload.coins)) {
          return withCors(
            json(
              { ok: false, error: "invalid-macro-stablecoin-request" },
              { status: 400 },
            ),
            env,
          );
        }

        const macro = await fetchMacroStablecoinHealth({
          coins: toUniqueStrings(payload.coins, 20),
        });
        const base = json({ ok: true, ...macro });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "macro_stablecoin_health",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/macro_oil_analytics"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "macro_oil_analytics",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const macro = await fetchMacroOilAnalytics(env);
        const base = json({ ok: true, ...macro });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "macro_oil_analytics",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/perps_funding_surface"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "perps_funding_surface",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const parsedPerpsInput = parsePerpsReadInput(payload);
        if (!parsedPerpsInput.ok) {
          return withCors(
            json({ ok: false, error: parsedPerpsInput.error }, { status: 400 }),
            env,
          );
        }

        let perpsSurface: Awaited<ReturnType<typeof fetchPerpsFundingSurface>>;
        try {
          perpsSurface = await fetchPerpsFundingSurface(parsedPerpsInput.value);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "perps-fetch-failed";
          const responseError =
            message === "perps-data-unavailable"
              ? "perps-data-unavailable"
              : "perps-fetch-failed";
          return withCors(
            json({ ok: false, error: responseError }, { status: 503 }),
            env,
          );
        }

        const base = json({ ok: true, ...perpsSurface });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "perps_funding_surface",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/perps_open_interest_surface"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "perps_open_interest_surface",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const parsedPerpsInput = parsePerpsReadInput(payload);
        if (!parsedPerpsInput.ok) {
          return withCors(
            json({ ok: false, error: parsedPerpsInput.error }, { status: 400 }),
            env,
          );
        }

        let perpsSurface: Awaited<
          ReturnType<typeof fetchPerpsOpenInterestSurface>
        >;
        try {
          perpsSurface = await fetchPerpsOpenInterestSurface(
            parsedPerpsInput.value,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "perps-fetch-failed";
          const responseError =
            message === "perps-data-unavailable"
              ? "perps-data-unavailable"
              : "perps-fetch-failed";
          return withCors(
            json({ ok: false, error: responseError }, { status: 503 }),
            env,
          );
        }

        const base = json({ ok: true, ...perpsSurface });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "perps_open_interest_surface",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/x402/read/perps_venue_score"
      ) {
        let paymentRequired: Response | null = null;
        try {
          paymentRequired = await requireX402Payment(
            request,
            env,
            "perps_venue_score",
            url.pathname,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "x402-route-config-missing";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
        if (paymentRequired) return withCors(paymentRequired, env);

        const payload = await readPayload(request);
        const parsedPerpsInput = parsePerpsReadInput(payload);
        if (!parsedPerpsInput.ok) {
          return withCors(
            json({ ok: false, error: parsedPerpsInput.error }, { status: 400 }),
            env,
          );
        }

        let perpsSurface: Awaited<ReturnType<typeof fetchPerpsVenueScore>>;
        try {
          perpsSurface = await fetchPerpsVenueScore(parsedPerpsInput.value);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "perps-fetch-failed";
          const responseError =
            message === "perps-data-unavailable"
              ? "perps-data-unavailable"
              : "perps-fetch-failed";
          return withCors(
            json({ ok: false, error: responseError }, { status: 503 }),
            env,
          );
        }

        const base = json({ ok: true, ...perpsSurface });
        const settled = withX402SettlementHeader(
          base,
          request,
          env,
          "perps_venue_score",
          url.pathname,
        );
        return withCors(settled, env);
      }

      if (request.method === "POST" && url.pathname === "/api/trade/swap") {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        if (!user.walletAddress || !user.privyWalletId) {
          return withCors(
            json({ ok: false, error: "user-wallet-missing" }, { status: 503 }),
            env,
          );
        }

        const payload = await readPayload(request);
        const execution = parseExecutionConfig(payload.execution);
        const inputMint = String(payload.inputMint ?? "").trim();
        const outputMint = String(payload.outputMint ?? "").trim();
        const amount = String(payload.amount ?? "").trim();
        const slippageBps = toBoundedInt(payload.slippageBps, 50, 1, 5_000);
        const source = String(payload.source ?? "")
          .trim()
          .slice(0, 80);
        const reason = String(payload.reason ?? "")
          .trim()
          .slice(0, 240);

        if (
          !inputMint ||
          !outputMint ||
          inputMint === outputMint ||
          !amount ||
          !/^\d+$/.test(amount)
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-trade-request" },
              { status: 400 },
            ),
            env,
          );
        }

        if (
          !SUPPORTED_TRADING_MINT_SET.has(inputMint) ||
          !SUPPORTED_TRADING_MINT_SET.has(outputMint) ||
          !isSupportedTradingPairByMint(inputMint, outputMint)
        ) {
          return withCors(
            json(unsupportedTradePairPayload(), { status: 400 }),
            env,
          );
        }

        const walletAddress = user.walletAddress;
        const inputAmount = BigInt(amount);
        if (inputAmount <= 0n) {
          return withCors(
            json(
              { ok: false, error: "invalid-trade-request" },
              { status: 400 },
            ),
            env,
          );
        }
        const lane = resolveTradeSwapExecutionLane(execution);
        const idempotencyKey =
          readIdempotencyKey(request) ??
          newTradeSwapCompatibilityIdempotencyKey();
        const submitPayload: Record<string, unknown> = {
          schemaVersion: "v1",
          mode: "privy_execute",
          ...(lane ? { lane } : {}),
          ...(source || reason
            ? {
                metadata: {
                  ...(source ? { source } : {}),
                  ...(reason ? { reason } : {}),
                },
              }
            : {}),
          privyExecute: {
            intentType: "swap",
            wallet: walletAddress,
            swap: {
              inputMint,
              outputMint,
              amountAtomic: amount,
              slippageBps,
            },
          },
        };
        const submitHeaders = new Headers({
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        });
        const authorization = request.headers.get("authorization");
        if (authorization) submitHeaders.set("authorization", authorization);
        const submitRequest = new Request(
          new URL("/api/x402/exec/submit", url.origin).toString(),
          {
            method: "POST",
            headers: submitHeaders,
            body: JSON.stringify(submitPayload),
          },
        );
        const submitResponse = await worker.fetch(submitRequest, env, _ctx);
        let submitPayloadRaw: unknown = null;
        try {
          submitPayloadRaw = await submitResponse.json();
        } catch {
          submitPayloadRaw = null;
        }
        if (!isRecord(submitPayloadRaw)) {
          return withCors(
            json({ ok: false, error: "trade-submit-failed" }, { status: 502 }),
            env,
          );
        }
        if (submitResponse.status >= 400 || submitPayloadRaw.ok !== true) {
          const error =
            typeof submitPayloadRaw.error === "string"
              ? submitPayloadRaw.error
              : "trade-submit-failed";
          return withCors(
            json({ ok: false, error }, { status: submitResponse.status }),
            env,
          );
        }
        const requestId = String(submitPayloadRaw.requestId ?? "").trim();
        if (!requestId) {
          return withCors(
            json({ ok: false, error: "trade-submit-failed" }, { status: 502 }),
            env,
          );
        }
        const status = isRecord(submitPayloadRaw.status)
          ? String(submitPayloadRaw.status.state ?? "").trim()
          : "";
        return withCors(
          json({
            ok: true,
            requestId,
            status: status || "validated",
            signature: null,
            refreshed: false,
            lastValidBlockHeight: null,
            source: source || "TERMINAL",
            err: null,
            executionReceipt: null,
            ...(isRecord(submitPayloadRaw.poll)
              ? { poll: submitPayloadRaw.poll }
              : {}),
            compatibility: {
              route: "/api/trade/swap",
              deprecated: true,
              replacement: "/api/x402/exec/submit",
            },
          }),
          env,
        );
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        const experience = buildExperienceView(user);
        const consumerProfile = parseConsumerProfileSummary(
          user.profile,
          user.feedSeedVersion,
        );
        return withCors(
          json({
            ok: true,
            user,
            wallet:
              user.walletAddress && user.privyWalletId
                ? {
                    signerType: user.signerType ?? "privy",
                    privyWalletId: user.privyWalletId,
                    walletAddress: user.walletAddress,
                    walletMigratedAt: user.walletMigratedAt ?? null,
                  }
                : null,
            experience,
            consumerProfile,
          }),
          env,
        );
      }

      if (request.method === "GET" && url.pathname === "/api/wallet/balance") {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        if (!user.walletAddress) {
          return withCors(
            json({ ok: false, error: "user-wallet-missing" }, { status: 503 }),
            env,
          );
        }
        const balanceRpcEndpoint =
          String(env.BALANCE_RPC_ENDPOINT ?? "").trim() ||
          String(env.RPC_ENDPOINT ?? "").trim();
        if (!balanceRpcEndpoint) {
          return withCors(
            json({ ok: false, error: "rpc-endpoint-missing" }, { status: 500 }),
            env,
          );
        }
        const rpc = new SolanaRpc(balanceRpcEndpoint);
        let lamports = 0n;
        const balanceErrors: string[] = [];
        const tokenBalanceResults = await Promise.all(
          SUPPORTED_WALLET_TOKEN_BALANCES.map(async (token) => {
            try {
              const atomic = await rpc.getTokenBalanceAtomic(
                user.walletAddress as string,
                token.mint,
              );
              return {
                mint: token.mint,
                symbol: token.symbol,
                decimals: token.decimals,
                atomic: atomic.toString(),
                display: formatAtomicDisplay(atomic, token.decimals),
              };
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              balanceErrors.push(`${token.symbol.toLowerCase()}:${message}`);
              return {
                mint: token.mint,
                symbol: token.symbol,
                decimals: token.decimals,
                atomic: "0",
                display: formatAtomicDisplay(0n, token.decimals),
              };
            }
          }),
        );
        const usdcBalance =
          tokenBalanceResults.find((token) => token.mint === USDC_MINT)
            ?.atomic ?? "0";

        try {
          lamports = await rpc.getBalanceLamports(user.walletAddress);
        } catch (error) {
          balanceErrors.push(
            `sol:${error instanceof Error ? error.message : String(error)}`,
          );
        }

        return withCors(
          json({
            ok: true,
            balances: {
              sol: {
                lamports: lamports.toString(),
                display: formatAtomicDisplay(lamports, 9),
              },
              usdc: {
                atomic: usdcBalance,
                display: formatAtomicDisplay(usdcBalance, 6),
              },
              tokens: tokenBalanceResults,
            },
            ...(balanceErrors.length > 0
              ? { errors: balanceErrors }
              : Object.create(null)),
          }),
          env,
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/recommendations/latest"
      ) {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        const payload = await readPayload(request);
        const scopedWallet = resolveScopedWallet({
          requestedWallet: payload.wallet,
          userWallet: user.walletAddress,
        });
        if (!scopedWallet.ok) {
          return withCors(
            json({ ok: false, error: scopedWallet.error }, { status: 400 }),
            env,
          );
        }
        if (!scopedWallet.wallet) {
          return withCors(
            json({ ok: false, error: "user-wallet-missing" }, { status: 503 }),
            env,
          );
        }
        if (scopedWallet.forbidden) {
          return withCors(
            json(
              { ok: false, error: "wallet-not-authorized" },
              { status: 403 },
            ),
            env,
          );
        }
        const persona = parseLoopCPersonaOverride(
          payload.persona,
          payload.riskMode,
        );
        const observedAt =
          typeof payload.observedAt === "string" &&
          payload.observedAt.trim().length > 0
            ? payload.observedAt.trim()
            : undefined;
        if (observedAt && Number.isNaN(Date.parse(observedAt))) {
          return withCors(
            json({ ok: false, error: "invalid-observedAt" }, { status: 400 }),
            env,
          );
        }
        const view = await requestLoopCRecommendations(env, {
          userId: user.id,
          wallet: scopedWallet.wallet,
          limit: toBoundedInt(payload.limit, 10, 1, 50),
          observedAt,
          ...(persona ? { persona } : {}),
        });
        if (!view) {
          return withCors(
            json(
              { ok: false, error: "recommendations-unavailable" },
              { status: 503 },
            ),
            env,
          );
        }

        return withCors(
          json({
            ok: true,
            view,
          }),
          env,
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/recommendations/feedback"
      ) {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        const payload = await readPayload(request);
        const scopedWallet = resolveScopedWallet({
          requestedWallet: payload.wallet,
          userWallet: user.walletAddress,
        });
        if (!scopedWallet.ok) {
          return withCors(
            json({ ok: false, error: scopedWallet.error }, { status: 400 }),
            env,
          );
        }
        if (!scopedWallet.wallet) {
          return withCors(
            json({ ok: false, error: "user-wallet-missing" }, { status: 503 }),
            env,
          );
        }
        if (scopedWallet.forbidden) {
          return withCors(
            json(
              { ok: false, error: "wallet-not-authorized" },
              { status: 403 },
            ),
            env,
          );
        }

        const decision = String(payload.decision ?? "")
          .trim()
          .toLowerCase();
        if (decision !== "yes" && decision !== "no") {
          return withCors(
            json({ ok: false, error: "invalid-decision" }, { status: 400 }),
            env,
          );
        }

        const recommendationId =
          typeof payload.recommendationId === "string"
            ? payload.recommendationId.trim()
            : "";
        const pairId =
          typeof payload.pairId === "string" ? payload.pairId.trim() : "";
        if (!recommendationId && !pairId) {
          return withCors(
            json(
              { ok: false, error: "missing-recommendation-target" },
              { status: 400 },
            ),
            env,
          );
        }
        const resolvedPairId =
          pairId || parsePairIdFromRecommendationId(recommendationId);
        if (!resolvedPairId) {
          return withCors(
            json(
              { ok: false, error: "invalid-recommendationId" },
              { status: 400 },
            ),
            env,
          );
        }

        const update = await submitLoopCRecommendationFeedback(env, {
          userId: user.id,
          wallet: scopedWallet.wallet,
          ...(recommendationId ? { recommendationId } : {}),
          pairId: resolvedPairId,
          decision,
          reason:
            typeof payload.reason === "string"
              ? payload.reason.trim()
              : undefined,
          decidedAt:
            typeof payload.decidedAt === "string" &&
            payload.decidedAt.trim().length > 0
              ? payload.decidedAt.trim()
              : undefined,
        });

        if (!update) {
          return withCors(
            json(
              { ok: false, error: "recommendations-unavailable" },
              { status: 503 },
            ),
            env,
          );
        }

        return withCors(
          json({
            ok: true,
            ack: {
              decision,
              ...(recommendationId ? { recommendationId } : {}),
              ...(pairId ? { pairId } : {}),
            },
            signalState: update,
          }),
          env,
        );
      }

      if (request.method === "PATCH" && url.pathname === "/api/me/profile") {
        const user = await requireOnboardedUser(request, env);
        const payload = await readPayload(request);
        const profile = payload.profile;
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
          return withCors(
            json({ ok: false, error: "invalid-profile" }, { status: 400 }),
            env,
          );
        }
        await setUserProfile(env, user.id, profile as Record<string, unknown>);
        return withCors(json({ ok: true }), env);
      }

      if (
        request.method === "PUT" &&
        url.pathname === "/api/onboarding/complete"
      ) {
        const user = await requireOnboardedUser(request, env);
        const payload = await readPayload(request);
        const validated = validateOnboardingInput(payload);
        if (!validated.ok) {
          return withCors(
            json({ ok: false, error: validated.error }, { status: 400 }),
            env,
          );
        }

        const nowIso = new Date().toISOString();
        const evaluated = evaluateOnboarding(validated.input);
        const mergedProfile = mergeConsumerProfile(user.profile, {
          ...evaluated.consumerProfile,
          completedAt: nowIso,
        });

        await setUserProfile(env, user.id, mergedProfile);
        await setUserExperience(env, {
          userId: user.id,
          experienceLevel: evaluated.level,
          levelSource: "auto",
          onboardingCompletedAt: nowIso,
          onboardingVersion: 1,
          feedSeedVersion: 1,
          degenAcknowledgedAt: null,
        });
        await setUserOnboardingStatus(env, user.id, "active");

        const experience = {
          level: evaluated.level,
          levelSource: "auto" as const,
          onboardingCompleted: true,
          onboardingCompletedAt: nowIso,
          onboardingVersion: 1,
        };
        const consumerProfile = {
          goalPrimary: evaluated.consumerProfile.goalPrimary,
          riskBand: evaluated.riskBand,
          timeHorizon: evaluated.consumerProfile.timeHorizon,
          literacyScore: evaluated.literacyScore,
          feedSeedVersion: 1,
        };

        return withCors(
          json({
            ok: true,
            experience,
            consumerProfile,
          }),
          env,
        );
      }

      if (
        request.method === "PATCH" &&
        url.pathname === "/api/me/experience-level"
      ) {
        const user = await requireOnboardedUser(request, env);
        const payload = await readPayload(request);
        const level = String(payload.level ?? "").trim();
        if (
          level !== "beginner" &&
          level !== "intermediate" &&
          level !== "pro" &&
          level !== "degen"
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-experience-level" },
              { status: 400 },
            ),
            env,
          );
        }

        const currentOnboardingCompletedAt = user.onboardingCompletedAt ?? null;
        const onboardingCompleted =
          Boolean(currentOnboardingCompletedAt) ||
          user.onboardingStatus === "active";
        if (!onboardingCompleted) {
          return withCors(
            json(
              { ok: false, error: "onboarding-not-complete" },
              { status: 400 },
            ),
            env,
          );
        }

        const acknowledgeHighRisk = payload.acknowledgeHighRisk === true;
        if (level === "degen" && !acknowledgeHighRisk) {
          return withCors(
            json(
              {
                ok: false,
                error: "missing-high-risk-acknowledgement",
              },
              { status: 400 },
            ),
            env,
          );
        }

        const degenAcknowledgedAt =
          level === "degen"
            ? new Date().toISOString()
            : (user.degenAcknowledgedAt ?? null);

        await setUserExperience(env, {
          userId: user.id,
          experienceLevel: level as ExperienceLevel,
          levelSource: "manual",
          onboardingCompletedAt:
            currentOnboardingCompletedAt ?? new Date().toISOString(),
          onboardingVersion: user.onboardingVersion,
          feedSeedVersion: user.feedSeedVersion,
          degenAcknowledgedAt,
        });

        const experience = {
          level,
          levelSource: "manual" as const,
          onboardingCompleted: true,
          onboardingCompletedAt:
            currentOnboardingCompletedAt ?? new Date().toISOString(),
          onboardingVersion:
            Number.isFinite(user.onboardingVersion) &&
            user.onboardingVersion > 0
              ? user.onboardingVersion
              : 1,
        };

        return withCors(json({ ok: true, experience }), env);
      }

      if (request.method === "POST" && url.pathname === "/api/events") {
        const user = await requireOnboardedUser(request, env);
        const payload = await readPayload(request);
        const name = parseExperienceEventName(payload.name ?? payload.event);
        if (!name) {
          return withCors(
            json({ ok: false, error: "invalid-event-name" }, { status: 400 }),
            env,
          );
        }
        const properties = sanitizeEventProperties(payload.properties);
        const profile = appendExperienceEventToProfile(user.profile, {
          name,
          ts: new Date().toISOString(),
          properties,
        });
        await setUserProfile(env, user.id, profile);
        return withCors(json({ ok: true }), env);
      }

      if (request.method === "GET" && url.pathname === "/api/billing/plans") {
        const user = await requireOnboardedUser(request, env);
        const subscription = await getUserSubscription(env, user.id);
        return withCors(
          json({
            ok: true,
            plans: [],
            mode: "manual_onboarding",
            subscription: toSubscriptionView(env, subscription),
          }),
          env,
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/billing/checkout"
      ) {
        return withCors(
          json({ ok: false, error: "manual-onboarding-only" }, { status: 410 }),
          env,
        );
      }

      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/billing/checkout/")
      ) {
        return withCors(
          json({ ok: false, error: "manual-onboarding-only" }, { status: 410 }),
          env,
        );
      }

      if (
        url.pathname === "/api/bots" ||
        url.pathname.startsWith("/api/bots/") ||
        url.pathname.startsWith("/api/admin/bots/") ||
        url.pathname === "/api/config" ||
        url.pathname === "/api/trades" ||
        url.pathname === "/api/loop/status" ||
        url.pathname === "/api/loop/start" ||
        url.pathname === "/api/loop/stop" ||
        url.pathname === "/api/loop/tick"
      ) {
        return withCors(
          json({ ok: false, error: "bot-runtime-removed" }, { status: 410 }),
          env,
        );
      }

      return withCors(
        json({ ok: false, error: "not-found" }, { status: 404 }),
        env,
      );
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "unknown-error";
      const message = /JWS Protected Header is invalid/i.test(rawMessage)
        ? "unauthorized"
        : /no such table/i.test(rawMessage) ||
            /no such column/i.test(rawMessage)
          ? "d1-migrations-not-applied"
          : rawMessage;
      const status =
        message === "unauthorized"
          ? 401
          : message === "manual-onboarding-required" ||
              message === "waitlist-required" ||
              message === "waitlist-email-required"
            ? 403
            : message === "d1-migrations-not-applied" ||
                message.startsWith("x402-route-config-")
              ? 503
              : message === "not-found"
                ? 404
                : message.startsWith("invalid-") ||
                    message.startsWith("missing-")
                  ? 400
                  : 500;
      if (status >= 500) {
        // Avoid leaking request headers or secrets; log only safe metadata.
        console.error("api.error", {
          method: request.method,
          path: url.pathname,
          message: rawMessage,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      return withCors(json({ ok: false, error: message }, { status }), env);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const startedAtMs = Date.now();
    const slotSourceEnabled =
      String(env.LOOP_A_SLOT_SOURCE_ENABLED ?? "0").trim() === "1";
    if (!slotSourceEnabled) return;

    if (!env.CONFIG_KV) {
      console.warn("loop_a.slot_source.skipped", {
        reason: "loop-a-config-kv-missing",
      });
      return;
    }

    const coordinatorEnabled =
      String(env.LOOP_A_COORDINATOR_ENABLED ?? "0").trim() === "1";

    if (coordinatorEnabled && env.LOOP_A_COORDINATOR_DO) {
      try {
        const id = env.LOOP_A_COORDINATOR_DO.idFromName(
          LOOP_A_COORDINATOR_NAME,
        );
        const stub = env.LOOP_A_COORDINATOR_DO.get(id);
        const response = await stub.fetch("https://internal/loop-a/tick", {
          method: "POST",
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          console.error("loop_a.coordinator.tick.failed", {
            status: response.status,
            body: text.slice(0, 1000),
          });
        }
        return;
      } catch (error) {
        console.error("loop_a.coordinator.scheduled.error", {
          message: error instanceof Error ? error.message : "unknown-error",
          stack: error instanceof Error ? error.stack : undefined,
        });
        return;
      }
    }
    if (coordinatorEnabled && !env.LOOP_A_COORDINATOR_DO) {
      console.warn("loop_a.coordinator.skipped", {
        reason: "loop-a-coordinator-binding-missing",
      });
    }

    try {
      const tickResult = await runLoopATickPipeline(env);
      await recordLoopAHealthTick(env, {
        ok: true,
        trigger: "scheduled",
        startedAtMs,
        tickResult,
      });
    } catch (error) {
      try {
        await recordLoopAHealthTick(env, {
          ok: false,
          trigger: "scheduled",
          startedAtMs,
          error,
        });
      } catch (healthError) {
        console.error("loop_a.health.scheduled.error", {
          message:
            healthError instanceof Error
              ? healthError.message
              : "unknown-health-error",
        });
      }
      console.error("loop_a.scheduled.error", {
        message: error instanceof Error ? error.message : "unknown-error",
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  },
};

export default worker;

async function requireOnboardedUser(
  request: Request,
  env: Env,
): Promise<UserRow> {
  const auth = await requireUser(request, env);
  const email = normalizeEmail(auth.email);
  if (!email) {
    throw new Error("waitlist-email-required");
  }
  const waitlisted = await hasWaitlistEmail(env, email);
  if (!waitlisted) {
    throw new Error("waitlist-required");
  }

  const existing = await findUserByPrivyUserId(env, auth.privyUserId);
  if (existing) return existing;
  return await upsertUser(env, auth.privyUserId);
}

async function ensureUserWallet(env: Env, user: UserRow): Promise<UserRow> {
  if (user.walletAddress && user.privyWalletId) return user;
  const wallet = await createPrivySolanaWallet(env);
  await setUserWallet(env, {
    userId: user.id,
    signerType: "privy",
    privyWalletId: wallet.walletId,
    walletAddress: wallet.address,
    walletMigratedAt: new Date().toISOString(),
  });
  return {
    ...user,
    signerType: "privy",
    privyWalletId: wallet.walletId,
    walletAddress: wallet.address,
    walletMigratedAt: new Date().toISOString(),
  };
}

function buildExperienceView(user: UserRow): {
  level: ExperienceLevel;
  levelSource: "auto" | "manual";
  onboardingCompleted: boolean;
  onboardingCompletedAt: string | null;
  onboardingVersion: number;
} {
  const onboardingCompletedAt = user.onboardingCompletedAt ?? null;
  const onboardingCompleted =
    Boolean(onboardingCompletedAt) || user.onboardingStatus === "active";
  return {
    level: parseExperienceLevel(user.experienceLevel),
    levelSource: parseLevelSource(user.levelSource),
    onboardingCompleted,
    onboardingCompletedAt,
    onboardingVersion:
      Number.isFinite(user.onboardingVersion) && user.onboardingVersion > 0
        ? Math.floor(user.onboardingVersion)
        : 1,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseExperienceEventName(value: unknown): ExperienceEventName | null {
  const raw = String(value ?? "").trim() as ExperienceEventName;
  return EXPERIENCE_EVENT_NAMES.has(raw) ? raw : null;
}

function sanitizeEventProperties(
  value: unknown,
): Record<string, string | number | boolean> {
  if (!isRecord(value)) return {};
  const output: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (!key.trim()) continue;
    if (typeof raw === "string") {
      output[key] = raw.slice(0, 200);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      output[key] = raw;
    } else if (typeof raw === "boolean") {
      output[key] = raw;
    } else {
      continue;
    }
    count += 1;
    if (count >= 20) break;
  }
  return output;
}

function appendExperienceEventToProfile(
  existingProfile: Record<string, unknown> | null,
  event: {
    name: ExperienceEventName;
    ts: string;
    properties: Record<string, string | number | boolean>;
  },
): Record<string, unknown> {
  const profile = isRecord(existingProfile) ? { ...existingProfile } : {};
  const analyticsRaw = profile.analytics;
  const analytics = isRecord(analyticsRaw) ? { ...analyticsRaw } : {};
  const eventsRaw = Array.isArray(analytics.events) ? analytics.events : [];
  const nextEvents = [...eventsRaw, event].slice(-MAX_EXPERIENCE_EVENTS);
  analytics.events = nextEvents;
  profile.analytics = analytics;
  return profile;
}

function toBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function formatAtomicDisplay(
  atomicInput: bigint | string,
  decimals: number,
): string {
  let atomic = 0n;
  try {
    atomic =
      typeof atomicInput === "bigint" ? atomicInput : BigInt(atomicInput);
  } catch {
    return "0.0";
  }

  const safeDecimals = Math.max(0, Math.min(18, Math.floor(decimals)));
  const scale = 10n ** BigInt(safeDecimals);
  const whole = atomic / scale;
  const fraction = (atomic % scale).toString().padStart(safeDecimals, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole.toString()}.${trimmed}` : `${whole}.0`;
}

function toUniqueStrings(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    out.push(normalized);
    seen.add(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

type ExecSubmitState =
  | "received"
  | "validated"
  | "queued"
  | "dispatched"
  | "landed"
  | "finalized"
  | "failed"
  | "expired";

function newExecRequestId(): string {
  const token = crypto.randomUUID().replace(/-/g, "");
  return `execreq_${token}`;
}

function isValidExecRequestId(value: string): boolean {
  return /^execreq_[A-Za-z0-9_-]{8,}$/.test(value);
}

function toExecSubmitState(status: string): ExecSubmitState {
  if (status === "received") return "received";
  if (status === "validated") return "validated";
  if (status === "queued") return "queued";
  if (status === "dispatched") return "dispatched";
  if (status === "landed") return "landed";
  if (status === "finalized") return "finalized";
  if (status === "expired") return "expired";
  if (status === "failed" || status === "rejected") return "failed";
  return "received";
}

function isExecSubmitTerminalState(state: ExecSubmitState): boolean {
  return (
    state === "landed" ||
    state === "finalized" ||
    state === "failed" ||
    state === "expired"
  );
}

function parsePerpsSymbol(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 20);
}

function parsePerpsReadInput(payload: Record<string, unknown>):
  | {
      ok: true;
      value: {
        symbols?: string[];
        venues?: PerpsVenue[];
        includeInactive?: boolean;
      };
    }
  | { ok: false; error: string } {
  if (payload.symbols !== undefined && !Array.isArray(payload.symbols)) {
    return { ok: false, error: "invalid-perps-request" };
  }
  if (payload.venues !== undefined && !Array.isArray(payload.venues)) {
    return { ok: false, error: "invalid-perps-request" };
  }
  if (
    payload.includeInactive !== undefined &&
    typeof payload.includeInactive !== "boolean"
  ) {
    return { ok: false, error: "invalid-perps-request" };
  }

  const symbols =
    payload.symbols === undefined
      ? []
      : toUniqueStrings(payload.symbols, 30)
          .map(parsePerpsSymbol)
          .filter((value) => value.length > 0);
  if (payload.symbols !== undefined && symbols.length < 1) {
    return { ok: false, error: "invalid-perps-request" };
  }

  const venueInputs =
    payload.venues === undefined
      ? []
      : payload.venues
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value.length > 0);
  if (payload.venues !== undefined && venueInputs.length < 1) {
    return { ok: false, error: "invalid-perps-request" };
  }
  const validVenueSet = new Set<string>(SUPPORTED_PERPS_VENUES);
  if (venueInputs.some((venue) => !validVenueSet.has(venue))) {
    return { ok: false, error: "invalid-perps-request" };
  }
  const venueStrings = Array.from(new Set(venueInputs)).slice(
    0,
    SUPPORTED_PERPS_VENUES.length,
  );

  return {
    ok: true,
    value: {
      ...(symbols.length > 0 ? { symbols } : {}),
      ...(venueStrings.length > 0
        ? { venues: venueStrings as PerpsVenue[] }
        : {}),
      ...(payload.includeInactive === true ? { includeInactive: true } : {}),
    },
  };
}

function parseLoopACommitment(
  value: unknown,
): "processed" | "confirmed" | "finalized" | null {
  if (value === undefined || value === null || String(value).trim() === "") {
    return resolveMarkCommitment(undefined);
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized !== "processed" &&
    normalized !== "confirmed" &&
    normalized !== "finalized"
  ) {
    return null;
  }
  return resolveMarkCommitment(normalized);
}

function parseLoopBViewSelection(
  value: unknown,
): "all" | "top_movers" | "liquidity_stress" | "anomaly_feed" | null {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "all";
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "all" ||
    normalized === "top_movers" ||
    normalized === "liquidity_stress" ||
    normalized === "anomaly_feed"
  ) {
    return normalized;
  }
  return null;
}

function filterLoopBScores(rawScores: unknown, pairId: string): unknown {
  if (!pairId) return rawScores;
  if (!isRecord(rawScores)) return rawScores;
  const rows = Array.isArray(rawScores.rows) ? rawScores.rows : [];
  const filteredRows = rows.filter(
    (row) =>
      isRecord(row) &&
      typeof row.pairId === "string" &&
      row.pairId.trim() === pairId,
  );
  return {
    ...rawScores,
    count: filteredRows.length,
    rows: filteredRows,
  };
}

async function readJsonFromKv(
  kv: KVNamespace,
  key: string,
): Promise<unknown | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseExecutionConfig(value: unknown): ExecutionConfig | undefined {
  if (!isRecord(value)) return undefined;
  const adapter = String(value.adapter ?? "").trim();
  const params =
    value.params && isRecord(value.params) ? { ...value.params } : undefined;
  if (!adapter && !params) return undefined;
  return {
    ...(adapter ? { adapter } : {}),
    ...(params ? { params } : {}),
  };
}

function resolveTradeSwapExecutionLane(
  execution: ExecutionConfig | undefined,
): "fast" | "protected" | "safe" | undefined {
  const adapter = String(execution?.adapter ?? "")
    .trim()
    .toLowerCase();
  if (!adapter || adapter === "jupiter") return "safe";
  if (
    adapter === "fast" ||
    adapter === "helius" ||
    adapter === "helius_sender"
  ) {
    return "fast";
  }
  if (
    adapter === "jito" ||
    adapter === "jito_bundle" ||
    adapter === "protected"
  ) {
    return "protected";
  }
  if (
    adapter === "magicblock" ||
    adapter === "magicblock_ephemeral_rollup" ||
    adapter === "safe"
  ) {
    return "safe";
  }
  return undefined;
}

function newTradeSwapCompatibilityIdempotencyKey(): string {
  return `trade_swap_${crypto.randomUUID().replace(/-/g, "")}`;
}

function parseRiskMode(
  value: unknown,
): "conservative" | "balanced" | "aggressive" | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "conservative") return "conservative";
  if (normalized === "balanced") return "balanced";
  if (normalized === "aggressive") return "aggressive";
  return null;
}

function parseLoopCPersonaOverride(
  value: unknown,
  riskModeRaw: unknown,
): UserPersonaInput | undefined {
  const persona = isRecord(value) ? value : {};
  const fromRiskMode = parseRiskMode(riskModeRaw);
  const riskBudgetRaw = persona.riskBudget;
  let riskBudget: UserPersonaInput["riskBudget"] | undefined;
  if (
    riskBudgetRaw === "low" ||
    riskBudgetRaw === "medium" ||
    riskBudgetRaw === "high"
  ) {
    riskBudget = riskBudgetRaw;
  } else if (
    typeof riskBudgetRaw === "number" &&
    Number.isFinite(riskBudgetRaw) &&
    riskBudgetRaw >= 0
  ) {
    riskBudget = riskBudgetRaw;
  }

  if (fromRiskMode === "conservative") riskBudget = "low";
  if (fromRiskMode === "balanced") riskBudget = "medium";
  if (fromRiskMode === "aggressive") riskBudget = "high";

  const horizonRaw = String(persona.horizon ?? "")
    .trim()
    .toLowerCase();
  const horizon: UserPersonaInput["horizon"] =
    horizonRaw === "short" || horizonRaw === "medium" || horizonRaw === "long"
      ? horizonRaw
      : undefined;
  const sectorPreferences = toUniqueStrings(persona.sectorPreferences, 20);
  const excludedAssets = toUniqueStrings(persona.excludedAssets, 200);
  const excludedProtocols = toUniqueStrings(persona.excludedProtocols, 50);

  const parsed: UserPersonaInput = {
    ...(riskBudget !== undefined ? { riskBudget } : {}),
    ...(horizon ? { horizon } : {}),
    ...(sectorPreferences.length > 0 ? { sectorPreferences } : {}),
    ...(excludedAssets.length > 0 ? { excludedAssets } : {}),
    ...(excludedProtocols.length > 0 ? { excludedProtocols } : {}),
  };

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parsePairIdFromRecommendationId(
  recommendationId: string | undefined,
): string | null {
  const raw = String(recommendationId ?? "").trim();
  if (!raw) return null;
  const markerIndex = raw.indexOf(":");
  if (markerIndex < 0) return null;
  const pairId = raw.slice(markerIndex + 1).trim();
  return pairId ? pairId : null;
}

function resolveScopedWallet(input: {
  requestedWallet: unknown;
  userWallet: string | null;
}):
  | { ok: true; wallet: string | null; forbidden: false }
  | { ok: true; wallet: string | null; forbidden: true }
  | { ok: false; error: string } {
  const userWallet = String(input.userWallet ?? "").trim();
  if (!userWallet) {
    return { ok: true, wallet: null, forbidden: false };
  }

  if (input.requestedWallet === undefined || input.requestedWallet === null) {
    return { ok: true, wallet: userWallet, forbidden: false };
  }
  if (typeof input.requestedWallet !== "string") {
    return { ok: false, error: "invalid-wallet" };
  }
  const requestedWallet = input.requestedWallet.trim();
  if (!requestedWallet) {
    return { ok: true, wallet: userWallet, forbidden: false };
  }
  if (requestedWallet !== userWallet) {
    return { ok: true, wallet: userWallet, forbidden: true };
  }
  return { ok: true, wallet: requestedWallet, forbidden: false };
}

function summarizeJupiterQuote(
  quote: Record<string, unknown>,
): Record<string, unknown> {
  const inputMint = typeof quote.inputMint === "string" ? quote.inputMint : "";
  const outputMint =
    typeof quote.outputMint === "string" ? quote.outputMint : "";
  const inAmount = typeof quote.inAmount === "string" ? quote.inAmount : "";
  const outAmount = typeof quote.outAmount === "string" ? quote.outAmount : "";
  const priceImpactPct = quote.priceImpactPct ?? 0;
  const routePlan = Array.isArray(quote.routePlan) ? quote.routePlan : [];
  const labels: string[] = [];
  for (const hop of routePlan) {
    const info = (hop as { swapInfo?: { label?: unknown } }).swapInfo;
    const label = info?.label;
    if (typeof label === "string" && label.trim()) labels.push(label.trim());
    if (labels.length >= 3) break;
  }

  return {
    inputMint,
    outputMint,
    inAmount,
    outAmount,
    priceImpactPct,
    ...(labels.length > 0 ? { route: labels.join(" -> ") } : {}),
  };
}

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  if (contentType.includes("form")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  return {};
}
