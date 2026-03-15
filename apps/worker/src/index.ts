import { parseRuntimeResearchBriefRequest } from "../../../src/runtime/research/briefs.js";
import { parseRuntimeResearchCurationRequest } from "../../../src/runtime/research/curation.js";
import { parseRuntimeResearchPolicyGateRequest } from "../../../src/runtime/research/policy_gate.js";
import { parseRuntimeResearchPostLiveRequest } from "../../../src/runtime/research/post_live.js";
import { parseRuntimeResearchPromotionRequest } from "../../../src/runtime/research/promotion.js";
import {
  parseRuntimeResearchReadinessCanaryRequest,
  parseRuntimeResearchReadinessRequest,
  parseRuntimeResearchSubjectControlPatch,
  parseRuntimeResearchVenueTxSmokeRequest,
} from "../../../src/runtime/research/readiness.js";
import { parseRuntimeResearchSynthesisRequest } from "../../../src/runtime/research/synthesis.js";
import { parseRuntimeResearchCandidateTriageRequest } from "../../../src/runtime/research/triage.js";
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
import { DFlowClient } from "./dflow";
import { DriftClient } from "./drift";
import {
  enforceExecSubmitAbuseGuard,
  readExecSubmitPayloadWithLimits,
} from "./execution/abuse_guard";
import {
  bootstrapExecutionCanary,
  isExecutionCanaryScheduledTick,
  readExecutionCanarySnapshot,
  resetExecutionCanary,
  runExecutionCanary,
} from "./execution/canary";
import { ExecutionCoordinator } from "./execution/coordinator";
import {
  buildExecutionErrorEnvelope,
  type CanonicalExecutionErrorCode,
  executionErrorStatus,
  normalizeExecutionErrorCode,
} from "./execution/error_taxonomy";
import {
  hashExecutionSubmitPayload,
  readIdempotencyKey,
  reserveExecutionSubmitRequest,
} from "./execution/idempotency";
import {
  type readTrackedJupiterTriggerOrder,
  resolveJupiterConditionalSpotOrder,
  summarizeJupiterTriggerOrder,
} from "./execution/jupiter_trigger";
import {
  buildTerminalJupiterTriggerReceipt,
  reconcileJupiterConditionalOrder,
} from "./execution/jupiter_trigger_reconciliation";
import {
  readExecutionLaneRoutingConfig,
  resolveExecutionLane,
} from "./execution/lane_resolver";
import {
  DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS,
  readExecutionObservabilitySnapshot,
} from "./execution/observability";
import {
  evaluateExecutionSubmitPolicy,
  evaluatePrivyRuntimeBalancePolicy,
  type SubmitPolicyRuntime,
} from "./execution/policy_engine";
import {
  assembleCanonicalExecutionReceiptV1,
  canonicalExecutionReceiptStorageKey,
} from "./execution/receipt_assembler";
import {
  createRelayImmutabilitySnapshot,
  readRelayImmutabilitySnapshot,
  verifyRelayImmutabilitySnapshot,
} from "./execution/relay_immutability";
import {
  appendExecutionStatusEvent,
  createExecutionAttemptIdempotent,
  type ExecutionRequestRecord,
  finalizeExecutionAttempt,
  getExecutionLatestStatus,
  listExecutionAttempts,
  listExecutionRequestsByActor,
  listExecutionStatusEvents,
  listOpenExecutionRequestsByActorAndIntentFamily,
  terminalizeExecutionRequest,
  updateExecutionRequestStatus,
  upsertExecutionReceiptIdempotent,
} from "./execution/repository";
import { evaluateExecutionRolloutGate } from "./execution/rollout_gate";
import {
  executeIntentViaRouter,
  executeSwapViaRouter,
  resolveExecutionAdapterRegistration,
} from "./execution/router";
import { evaluateSafeLaneTransaction } from "./execution/safe_lane_policy";
import {
  buildExecSubmitIntentSummary,
  parseExecSubmitPayload,
  resolveExecSubmitIntentFamily,
  resolveExecSubmitSpotSwap,
  toExecSubmitRequestV1Compat,
} from "./execution/submit_contract";
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
  executionLaneRuntimeControlsFromSnapshot,
  type OpsControlPatch,
  readOpsControlSnapshot,
  resetOpsControlSnapshot,
  writeOpsControlSnapshot,
} from "./ops_controls";
import { evaluateOracleReferencePriceGuard } from "./oracle_reference";
import { OrcaClient } from "./orca";
import {
  fetchPerpsFundingSurface,
  fetchPerpsOpenInterestSurface,
  fetchPerpsVenueScore,
  type PerpsVenue,
  SUPPORTED_PERPS_VENUES,
} from "./perps_sources";
import { enforcePolicy, normalizePolicy } from "./policy";
import { createPrivySolanaWallet, signTransactionWithPrivyById } from "./privy";
import { RaydiumClient } from "./raydium";
import { gatherMarketSnapshot } from "./research";
import { json, okCors, withCors } from "./response";
import {
  bootstrapRuntimeCanary,
  isRuntimeCanaryScheduledTick,
  readRuntimeCanarySnapshot,
  resetRuntimeCanary,
  runRuntimeCanary,
} from "./runtime_canary";
import {
  applyRuntimeDeploymentControl,
  evaluateRuntimeDeployment,
  handleRuntimeInternalRoute,
  type RuntimeControlAction,
  readRuntimeAdminSnapshot,
  readRuntimeAllocatorSummary,
  readRuntimeDeployment,
  readRuntimeDeploymentRuns,
  readRuntimePnlSummary,
  readRuntimePositionSnapshot,
  readRuntimeResearchRegistry,
  readRuntimeScorecard,
} from "./runtime_internal";
import { runRuntimeResearchBriefWorkflow } from "./runtime_research_briefs";
import { runRuntimeResearchCurationWorkflow } from "./runtime_research_curation";
import { runRuntimeResearchPolicyGateWorkflow } from "./runtime_research_policy_gate";
import {
  listRuntimeResearchPostLiveWorkflow,
  runRuntimeResearchPostLiveWorkflow,
} from "./runtime_research_post_live";
import {
  listRuntimeResearchPromotionWorkflow,
  runRuntimeResearchPromotionWorkflow,
} from "./runtime_research_promotion";
import {
  listRuntimeResearchReadinessCanaryWorkflow,
  listRuntimeResearchReadinessWorkflow,
  listRuntimeResearchSubjectControlWorkflow,
  runRuntimeResearchReadinessCanaryWithMarkdown,
  runRuntimeResearchReadinessWorkflow,
  upsertRuntimeResearchSubjectControlWorkflow,
} from "./runtime_research_readiness";
import { readRuntimeResearchSubstrateSnapshot } from "./runtime_research_substrate";
import { runRuntimeResearchSynthesisWorkflow } from "./runtime_research_synthesis";
import { runRuntimeResearchCandidateTriageWorkflow } from "./runtime_research_triage";
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
  | "terminal_opened_from_consumer"
  | "terminal_mode_changed";

const EXPERIENCE_EVENT_NAMES = new Set<ExperienceEventName>([
  "onboarding_started",
  "onboarding_step_completed",
  "onboarding_completed",
  "level_assigned_auto",
  "level_overridden_manual",
  "degen_acknowledged",
  "terminal_opened_from_consumer",
  "terminal_mode_changed",
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
type ExecutionActorMode = "relay_signed" | "privy_execute";
type ExecApiKeyActor = {
  actorId: string;
  key: string;
  modes: Set<ExecutionActorMode>;
};
type ResolvedExecApiKeyActor = {
  actorId: string;
  modes: Set<ExecutionActorMode>;
  authSource: "x-exec-api-key" | "authorization";
};

function parseBearerToken(value: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!BEARER_RE.test(raw)) return null;
  return raw.replace(BEARER_RE, "").trim() || null;
}

function parseExecApiKeyModes(raw: string): Set<ExecutionActorMode> {
  const modes = new Set<ExecutionActorMode>();
  const normalized = raw
    .split(/[|+]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  for (const mode of normalized) {
    if (mode === "relay_signed" || mode === "relay") {
      modes.add("relay_signed");
      continue;
    }
    if (mode === "privy_execute" || mode === "privy") {
      modes.add("privy_execute");
      continue;
    }
    if (mode === "all") {
      modes.add("relay_signed");
      modes.add("privy_execute");
    }
  }
  if (modes.size < 1) {
    modes.add("relay_signed");
  }
  return modes;
}

function parseExecApiKeyActors(raw: unknown): ExecApiKeyActor[] {
  const entries = String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const parsed: ExecApiKeyActor[] = [];
  for (const entry of entries) {
    let actorId = "";
    let key = "";
    let modesRaw = "";

    if (entry.includes("=")) {
      const [left, right] = entry.split("=", 2);
      actorId = left?.trim() ?? "";
      const rightParts = String(right ?? "")
        .split(":")
        .map((item) => item.trim());
      key = rightParts[0] ?? "";
      modesRaw = rightParts.slice(1).join("|");
    } else {
      const parts = entry.split(":").map((item) => item.trim());
      actorId = parts[0] ?? "";
      key = parts[1] ?? "";
      modesRaw = parts.slice(2).join("|");
    }

    if (!actorId || !key) continue;
    parsed.push({
      actorId,
      key,
      modes: parseExecApiKeyModes(modesRaw),
    });
  }
  return parsed;
}

function resolveExecApiKeyActor(
  request: Request,
  env: Env,
): ResolvedExecApiKeyActor | null {
  const candidates: Array<{
    token: string;
    source: "x-exec-api-key" | "authorization";
  }> = [];
  const headerToken = String(
    request.headers.get("x-exec-api-key") ?? "",
  ).trim();
  if (headerToken) {
    candidates.push({
      token: headerToken,
      source: "x-exec-api-key",
    });
  }
  const bearerToken = parseBearerToken(request.headers.get("authorization"));
  if (bearerToken) {
    candidates.push({
      token: bearerToken,
      source: "authorization",
    });
  }
  if (candidates.length < 1) return null;

  const actors = parseExecApiKeyActors(env.EXEC_API_KEYS);
  for (const candidate of candidates) {
    const match = actors.find((item) => item.key === candidate.token);
    if (!match) continue;
    return {
      actorId: match.actorId,
      modes: new Set(match.modes),
      authSource: candidate.source,
    };
  }
  return null;
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

function readNumberEnv(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function parsePositiveIntParam(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function shouldSyncExecutePrivySubmit(env: Env): boolean {
  return readBooleanEnv(env.EXEC_PRIVY_SYNC_SUBMIT_ENABLED, false);
}

function parseOpsControlPatch(
  value: unknown,
): OpsControlPatch | { error: string } {
  if (!isRecord(value)) {
    return { error: "invalid-ops-control-payload" };
  }

  const patch: OpsControlPatch = {
    updatedBy: readOptionalString(value.updatedBy) ?? "admin-route",
  };

  if (isRecord(value.execution)) {
    patch.execution = {};
    if (value.execution.enabled !== undefined) {
      patch.execution.enabled = readBooleanEnv(value.execution.enabled, true);
    }
    if (value.execution.disabledReason !== undefined) {
      patch.execution.disabledReason = readOptionalString(
        value.execution.disabledReason,
      );
    }
    if (isRecord(value.execution.lanes)) {
      patch.execution.lanes = {};
      if (value.execution.lanes.fast !== undefined) {
        patch.execution.lanes.fast = readBooleanEnv(
          value.execution.lanes.fast,
          true,
        );
      }
      if (value.execution.lanes.protected !== undefined) {
        patch.execution.lanes.protected = readBooleanEnv(
          value.execution.lanes.protected,
          true,
        );
      }
      if (value.execution.lanes.safe !== undefined) {
        patch.execution.lanes.safe = readBooleanEnv(
          value.execution.lanes.safe,
          true,
        );
      }
    }
  }

  if (isRecord(value.canary)) {
    patch.canary = {};
    if (value.canary.enabled !== undefined) {
      patch.canary.enabled = readBooleanEnv(value.canary.enabled, true);
    }
    if (value.canary.disabledReason !== undefined) {
      patch.canary.disabledReason = readOptionalString(
        value.canary.disabledReason,
      );
    }
  }

  if (isRecord(value.runtime)) {
    patch.runtime = {};
    if (value.runtime.enabled !== undefined) {
      patch.runtime.enabled = readBooleanEnv(value.runtime.enabled, true);
    }
    if (value.runtime.disabledReason !== undefined) {
      patch.runtime.disabledReason = readOptionalString(
        value.runtime.disabledReason,
      );
    }
    if (value.runtime.shadowOnly !== undefined) {
      patch.runtime.shadowOnly = readBooleanEnv(value.runtime.shadowOnly, true);
    }
    if (value.runtime.shadowOnlyReason !== undefined) {
      patch.runtime.shadowOnlyReason = readOptionalString(
        value.runtime.shadowOnlyReason,
      );
    }
  }

  return patch;
}

function parseRuntimeAdminControlPath(pathname: string): {
  deploymentId: string;
  action: RuntimeControlAction;
} | null {
  const prefix = "/api/admin/ops/runtime/deployments/";
  if (!pathname.startsWith(prefix)) return null;
  const suffix = pathname.slice(prefix.length);
  const [deploymentId, action, extra] = suffix.split("/");
  if (!deploymentId || extra) return null;
  if (action !== "pause" && action !== "resume" && action !== "kill") {
    return null;
  }
  let decodedDeploymentId: string;
  try {
    decodedDeploymentId = decodeURIComponent(deploymentId);
  } catch {
    return null;
  }
  return {
    deploymentId: decodedDeploymentId,
    action,
  };
}

function parseRuntimeAdminDetailPath(pathname: string): string | null {
  const prefix = "/api/admin/ops/runtime/deployments/";
  if (!pathname.startsWith(prefix)) return null;
  const suffix = pathname.slice(prefix.length);
  if (!suffix || suffix.includes("/")) return null;
  try {
    return decodeURIComponent(suffix);
  } catch {
    return null;
  }
}

function parseRuntimeAdminEvaluatePath(pathname: string): string | null {
  const prefix = "/api/admin/ops/runtime/deployments/";
  if (!pathname.startsWith(prefix)) return null;
  const suffix = pathname.slice(prefix.length);
  const evaluateSuffix = "/evaluate";
  if (!suffix.endsWith(evaluateSuffix)) return null;
  const deploymentId = suffix.slice(0, -evaluateSuffix.length);
  if (!deploymentId || deploymentId.includes("/")) return null;
  try {
    return decodeURIComponent(deploymentId);
  } catch {
    return null;
  }
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

function normalizePolicyReason(value: unknown, fallback: string): string {
  const raw = executionErrorMessage(value) ?? "";
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-:]+|[-:]+$/g, "");
  return normalized || fallback;
}

function asPolicyDeniedError(reason: string): Error {
  return new Error(`policy-denied:${reason}`);
}

function execErrorResponse(input: {
  code: CanonicalExecutionErrorCode;
  status?: number;
  message?: string;
  details?: Record<string, unknown> | null;
  requestId?: string | null;
  headers?: HeadersInit;
}): Response {
  const details =
    input.details && Object.keys(input.details).length > 0
      ? (input.details as unknown as Record<string, unknown>)
      : null;
  return json(
    buildExecutionErrorEnvelope({
      code: input.code,
      ...(input.message ? { message: input.message } : {}),
      ...(details ? { details: details as never } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    }),
    {
      status: input.status ?? executionErrorStatus(input.code),
      ...(input.headers ? { headers: input.headers } : {}),
    },
  );
}

function policyDeniedReason(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Error) {
    const text = value.message.trim();
    if (text.startsWith("policy-denied:")) {
      return text.slice("policy-denied:".length) || "policy-denied";
    }
    return null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("policy-denied:")) {
      return text.slice("policy-denied:".length) || "policy-denied";
    }
    return null;
  }
  if (typeof value === "object" && value && !Array.isArray(value)) {
    const code = String((value as { code?: unknown }).code ?? "")
      .trim()
      .toLowerCase();
    if (code !== "policy-denied") return null;
    const reason = String((value as { reason?: unknown }).reason ?? "").trim();
    return reason || "policy-denied";
  }
  return null;
}

export function resolveTerminalFailureFromExecuteResult(
  status: string,
  err: unknown,
  signature?: string | null,
): {
  terminalStatus: "failed" | "rejected";
  errorCode: string;
  statusReason: string;
} | null {
  if (
    status === "processed" ||
    status === "confirmed" ||
    status === "finalized"
  ) {
    return null;
  }
  const deniedReason = policyDeniedReason(err);
  if (deniedReason) {
    return {
      terminalStatus: "rejected",
      errorCode: "policy-denied",
      statusReason: `policy-denied:${deniedReason}`,
    };
  }
  if (
    status === "error" &&
    typeof signature === "string" &&
    signature.trim().length > 0
  ) {
    return null;
  }
  const canonicalErrorCode = normalizeExecutionErrorCode({
    statusHint: status,
    error: err,
    fallback: "submission-failed",
  });
  return {
    terminalStatus: "failed",
    errorCode: canonicalErrorCode,
    statusReason: canonicalErrorCode,
  };
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

function authorizeAdminRoute(
  request: Request,
  env: Env,
): { ok: true } | { ok: false; status: number; error: string } {
  const configuredToken = String(env.ADMIN_TOKEN ?? "").trim();
  if (!configuredToken) {
    return {
      ok: false,
      status: 503,
      error: "admin-auth-not-configured",
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

function readExecObservabilityThresholds(env: Env) {
  return {
    minSampleSize: Math.floor(
      readNumberEnv(
        env.EXEC_OBS_ALERT_MIN_SAMPLE_SIZE,
        DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS.minSampleSize,
        1,
        50_000,
      ),
    ),
    failRateWarning: readNumberEnv(
      env.EXEC_OBS_ALERT_FAIL_RATE_WARN,
      DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS.failRateWarning,
      0,
      1,
    ),
    failRateCritical: readNumberEnv(
      env.EXEC_OBS_ALERT_FAIL_RATE_CRITICAL,
      DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS.failRateCritical,
      0,
      1,
    ),
    expiryRateWarning: readNumberEnv(
      env.EXEC_OBS_ALERT_EXPIRY_RATE_WARN,
      DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS.expiryRateWarning,
      0,
      1,
    ),
    expiryRateCritical: readNumberEnv(
      env.EXEC_OBS_ALERT_EXPIRY_RATE_CRITICAL,
      DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS.expiryRateCritical,
      0,
      1,
    ),
    dispatchP95WarningMs: readNumberEnv(
      env.EXEC_OBS_ALERT_P95_DISPATCH_MS_WARN,
      DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS.dispatchP95WarningMs,
      1,
      3_600_000,
    ),
    dispatchP95CriticalMs: readNumberEnv(
      env.EXEC_OBS_ALERT_P95_DISPATCH_MS_CRITICAL,
      DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS.dispatchP95CriticalMs,
      1,
      3_600_000,
    ),
    landingP95WarningMs: readNumberEnv(
      env.EXEC_OBS_ALERT_P95_LANDING_MS_WARN,
      DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS.landingP95WarningMs,
      1,
      7_200_000,
    ),
    landingP95CriticalMs: readNumberEnv(
      env.EXEC_OBS_ALERT_P95_LANDING_MS_CRITICAL,
      DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS.landingP95CriticalMs,
      1,
      7_200_000,
    ),
    finalizationP95WarningMs: readNumberEnv(
      env.EXEC_OBS_ALERT_P95_FINALIZATION_MS_WARN,
      DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS.finalizationP95WarningMs,
      1,
      7_200_000,
    ),
    finalizationP95CriticalMs: readNumberEnv(
      env.EXEC_OBS_ALERT_P95_FINALIZATION_MS_CRITICAL,
      DEFAULT_EXECUTION_OBSERVABILITY_THRESHOLDS.finalizationP95CriticalMs,
      1,
      7_200_000,
    ),
  };
}

function resolvePortalOriginForApiHost(hostname: string, env: Env): string {
  const normalized = hostname.trim().toLowerCase().split(":")[0] ?? "";
  if (normalized === "dev.api.trader-ralph.com") {
    return "https://dev.trader-ralph.com";
  }
  const configured = String(env.PORTAL_SITE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (configured) {
    return configured;
  }
  return "https://www.trader-ralph.com";
}

async function proxyPortalDiscovery(
  request: Request,
  pathname: string,
  env: Env,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const portalOrigin = resolvePortalOriginForApiHost(requestUrl.host, env);
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
      const proxied = await proxyPortalDiscovery(request, url.pathname, env);
      return withCors(proxied, env);
    }
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) {
      url.pathname = `/api${url.pathname}`;
    }
    await recordEndpointCallSafe(env, request.method, url.pathname);
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        const loopASlotSourceEnabled =
          String(env.LOOP_A_SLOT_SOURCE_ENABLED ?? "0").trim() === "1";
        if (!loopASlotSourceEnabled) {
          return withCors(json({ ok: true }), env);
        }
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

      const runtimeInternalResponse = await handleRuntimeInternalRoute(
        request,
        url,
        env,
      );
      if (runtimeInternalResponse) {
        return withCors(runtimeInternalResponse, env);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/x402/exec/health"
      ) {
        const loopASlotSourceEnabled =
          String(env.LOOP_A_SLOT_SOURCE_ENABLED ?? "0").trim() === "1";
        const loopAHealth = loopASlotSourceEnabled
          ? await readLoopAHealthFromKv(env)
          : null;
        const opsControls = await readOpsControlSnapshot(env);
        const routing = readExecutionLaneRoutingConfig(
          env,
          executionLaneRuntimeControlsFromSnapshot(opsControls),
        );
        const hasLaneOnline =
          routing.enabled.fast ||
          routing.enabled.protected ||
          routing.enabled.safe;
        return withCors(
          json({
            ok: hasLaneOnline,
            now: new Date().toISOString(),
            api: {
              ok: true,
            },
            loopA: loopAHealth ?? null,
            controls: {
              execution: opsControls.execution,
            },
            lanes: {
              fast: {
                enabled: routing.enabled.fast,
                adapter: routing.adapters.fast,
              },
              protected: {
                enabled: routing.enabled.protected,
                adapter: routing.adapters.protected,
              },
              safe: {
                enabled: routing.enabled.safe,
                adapter: routing.adapters.safe,
                allowAnonymous: routing.allowAnonymousSafe,
              },
            },
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
        const payloadRead = await readExecSubmitPayloadWithLimits(request, env);
        if (!payloadRead.ok) {
          return withCors(
            execErrorResponse({
              code: "invalid-request",
              status: payloadRead.status,
              details: {
                reason: payloadRead.reason,
                abuse: {
                  payload: payloadRead.metadata,
                },
              },
            }),
            env,
          );
        }
        const parsed = parseExecSubmitPayload(payloadRead.payload);
        if (!parsed.ok) {
          return withCors(
            execErrorResponse({
              code: "invalid-request",
              details: {
                reason: parsed.error,
              },
            }),
            env,
          );
        }
        const compatRequest = toExecSubmitRequestV1Compat(parsed.value);
        const intentFamily = resolveExecSubmitIntentFamily(parsed.value);
        const spotSwap = resolveExecSubmitSpotSwap(parsed.value);
        const conditionalSpotOrder =
          parsed.value.mode === "privy_execute" &&
          parsed.value.schemaVersion === "v2" &&
          parsed.value.privyExecute?.intent.family === "conditional_spot_order"
            ? parsed.value.privyExecute
            : null;
        const intentSummary = buildExecSubmitIntentSummary(parsed.value);

        const idempotencyKey = readIdempotencyKey(request);
        if (!idempotencyKey) {
          return withCors(
            execErrorResponse({
              code: "invalid-request",
              details: {
                reason: "missing-idempotency-key",
              },
            }),
            env,
          );
        }

        let actorType: "anonymous_x402" | "privy_user" | "api_key_actor" =
          "anonymous_x402";
        let actorId: string | null = null;
        let actorAuthSource: string | null = null;
        const isRelaySigned = parsed.value.mode === "relay_signed";
        let submitMetadata = parsed.metadataForStorage;
        let relayImmutability: ReturnType<
          typeof readRelayImmutabilitySnapshot
        > = null;
        let relayValidationParsed: {
          transactionVersion: "legacy" | "v0";
          signatureCount: number;
          txSizeBytes: number;
          feePayer: string;
          recentBlockhash: string;
          programIds: string[];
        } | null = null;
        let submitPolicyRuntime: SubmitPolicyRuntime | null = null;
        let privyActorContext: {
          userId: string;
          walletAddress: string;
          privyWalletId: string;
        } | null = null;
        const payloadAbuseMetadata = payloadRead.metadata;
        const apiKeyActor = resolveExecApiKeyActor(request, env);
        if (apiKeyActor) {
          if (!apiKeyActor.modes.has(parsed.value.mode)) {
            return withCors(
              execErrorResponse({
                code: "policy-denied",
                details: {
                  reason: `api-key-mode-not-enabled:${parsed.value.mode}`,
                },
              }),
              env,
            );
          }
          actorType = "api_key_actor";
          actorId = apiKeyActor.actorId;
          actorAuthSource = `api-key:${apiKeyActor.authSource}`;
        }

        if (!isRelaySigned) {
          if (actorType !== "api_key_actor") {
            let user = await requireOnboardedUser(request, env);
            user = await ensureUserWallet(env, user);
            if (!user.walletAddress || !user.privyWalletId) {
              return withCors(
                execErrorResponse({
                  code: "submission-failed",
                  status: 503,
                  details: {
                    reason: "user-wallet-missing",
                  },
                }),
                env,
              );
            }
            if (parsed.value.privyExecute.wallet !== user.walletAddress) {
              return withCors(
                execErrorResponse({
                  code: "invalid-request",
                }),
                env,
              );
            }
            actorType = "privy_user";
            actorId = user.id;
            actorAuthSource = "authorization";
            privyActorContext = {
              userId: user.id,
              walletAddress: user.walletAddress,
              privyWalletId: user.privyWalletId,
            };
          }
        } else if (actorType !== "api_key_actor") {
          const relayPrivyActor = await maybeResolvePrivyActorContext(
            request,
            env,
          );
          if (relayPrivyActor) {
            actorType = "privy_user";
            actorId = relayPrivyActor.userId;
            actorAuthSource = "authorization";
            privyActorContext = relayPrivyActor;
          }
        }

        const rolloutGate = evaluateExecutionRolloutGate({
          env,
          actorType,
          mode: parsed.value.mode,
        });
        submitMetadata = {
          ...(submitMetadata ?? {}),
          rollout: rolloutGate.metadata,
        };
        if (!rolloutGate.ok) {
          return withCors(
            execErrorResponse({
              code: rolloutGate.error,
              status: 403,
              details: {
                reason: rolloutGate.reason,
                rollout: rolloutGate.metadata,
              },
            }),
            env,
          );
        }

        const abuseCheck = await enforceExecSubmitAbuseGuard({
          env,
          request,
          actorType,
          actorId,
          idempotencyKey,
        });
        if (!abuseCheck.ok) {
          console.warn("exec.submit.abuse.denied", {
            actorType,
            actorId,
            reason: abuseCheck.reason,
            status: abuseCheck.status,
            ...(abuseCheck.metadata ?? {}),
          });
          const denied = json(
            buildExecutionErrorEnvelope({
              code: abuseCheck.error,
              details: {
                reason: abuseCheck.reason,
                abuse: abuseCheck.metadata,
              } as never,
            }),
            {
              status: abuseCheck.status,
              ...(abuseCheck.retryAfterSeconds
                ? {
                    headers: {
                      "retry-after": String(abuseCheck.retryAfterSeconds),
                    },
                  }
                : {}),
            },
          );
          return withCors(denied, env);
        }

        const laneResolution = resolveExecutionLane({
          env,
          requestedLane: parsed.value.lane,
          mode: parsed.value.mode,
          actorType,
          runtimeControls: executionLaneRuntimeControlsFromSnapshot(
            await readOpsControlSnapshot(env),
          ),
        });
        if (!laneResolution.ok) {
          return withCors(
            execErrorResponse({
              code: laneResolution.error,
              details: {
                reason: laneResolution.reason,
              },
            }),
            env,
          );
        }
        submitMetadata = {
          ...(submitMetadata ?? {}),
          abuse: {
            payload: payloadAbuseMetadata,
            request: abuseCheck.metadata,
          },
          laneResolution: laneResolution.metadata,
          ...(intentSummary ? { intent: intentSummary } : {}),
          actor: {
            type: actorType,
            id: actorId,
            mode: parsed.value.mode,
            ...(actorAuthSource ? { authSource: actorAuthSource } : {}),
          },
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
              execErrorResponse({
                code: "submission-failed",
                status: 503,
                details: {
                  reason: message,
                },
              }),
              env,
            );
          }
          if (paymentRequired) {
            if (paymentRequired.status === 402) {
              const upstreamBody = (await paymentRequired
                .clone()
                .json()
                .catch(() => null)) as {
                reason?: string;
                paymentRequired?: unknown;
              } | null;
              const normalized = json(
                buildExecutionErrorEnvelope({
                  code: "payment-required",
                  details: {
                    ...(upstreamBody?.reason
                      ? { reason: upstreamBody.reason }
                      : {}),
                    ...(upstreamBody?.paymentRequired
                      ? { paymentRequired: upstreamBody.paymentRequired }
                      : {}),
                  } as never,
                }),
                {
                  status: 402,
                  headers: paymentRequired.headers,
                },
              );
              return withCors(normalized, env);
            }
            return withCors(paymentRequired, env);
          }
          const billingMetadata = await buildExecSubmitBillingAuditMetadata(
            request,
            url.pathname,
          );
          submitMetadata = {
            ...(submitMetadata ?? {}),
            x402Billing: billingMetadata,
          };
        }

        if (
          parsed.value.schemaVersion === "v2" &&
          spotSwap?.venueKey &&
          spotSwap.venueKey !== "jupiter"
        ) {
          return withCors(
            execErrorResponse({
              code: "invalid-request",
              details: {
                reason: `unsupported-venue-key:${spotSwap.venueKey}`,
              },
            }),
            env,
          );
        }
        if (parsed.value.mode === "privy_execute" && !compatRequest) {
          if (
            parsed.value.schemaVersion === "v2" &&
            conditionalSpotOrder &&
            conditionalSpotOrder.intent.venueKey !== "jupiter"
          ) {
            return withCors(
              execErrorResponse({
                code: "invalid-request",
                details: {
                  reason: `unsupported-venue-key:${conditionalSpotOrder.intent.venueKey}`,
                },
              }),
              env,
            );
          }
          if (parsed.value.schemaVersion === "v2" && conditionalSpotOrder) {
            return withCors(
              execErrorResponse({
                code: "invalid-request",
                details: {
                  reason: "unsupported-conditional-order-compat",
                },
              }),
              env,
            );
          }
          return withCors(
            execErrorResponse({
              code: "invalid-request",
              details: {
                reason: intentFamily
                  ? `unsupported-intent-family:${intentFamily}`
                  : "unsupported-intent-family",
              },
            }),
            env,
          );
        }
        if (
          parsed.value.schemaVersion === "v2" &&
          conditionalSpotOrder &&
          conditionalSpotOrder.intent.venueKey !== "jupiter"
        ) {
          return withCors(
            execErrorResponse({
              code: "invalid-request",
              details: {
                reason: `unsupported-venue-key:${conditionalSpotOrder.intent.venueKey}`,
              },
            }),
            env,
          );
        }
        if (parsed.value.schemaVersion === "v2" && spotSwap?.venueKey) {
          const resolvedAdapter = resolveExecutionAdapterRegistration(
            laneResolution.adapter,
          );
          if (
            !resolvedAdapter ||
            resolvedAdapter.venueKey !== spotSwap.venueKey
          ) {
            return withCors(
              execErrorResponse({
                code: "invalid-request",
                details: {
                  reason: `unsupported-venue-route:${spotSwap.venueKey}:${laneResolution.adapter}`,
                },
              }),
              env,
            );
          }
        }

        const submitPolicy = await evaluateExecutionSubmitPolicy({
          env,
          request: compatRequest as NonNullable<typeof compatRequest>,
          lane: laneResolution.lane,
          actorType,
        });
        if (!submitPolicy.ok) {
          return withCors(
            execErrorResponse({
              code: submitPolicy.error,
              status: submitPolicy.status,
              details: {
                reason: submitPolicy.reason,
                policy: submitPolicy.metadata,
              },
            }),
            env,
          );
        }
        if (
          parsed.value.schemaVersion === "v2" &&
          conditionalSpotOrder &&
          laneResolution.adapter !== "jupiter"
        ) {
          return withCors(
            execErrorResponse({
              code: "unsupported-lane",
              details: {
                reason: `conditional-orders-require-safe-lane:${laneResolution.adapter}`,
              },
            }),
            env,
          );
        }
        submitPolicyRuntime = submitPolicy.runtime ?? null;
        relayValidationParsed = submitPolicy.relayParsed
          ? {
              transactionVersion: submitPolicy.relayParsed.transactionVersion,
              signatureCount: submitPolicy.relayParsed.signatureCount,
              txSizeBytes: submitPolicy.relayParsed.txSizeBytes,
              feePayer: submitPolicy.relayParsed.feePayer,
              recentBlockhash: submitPolicy.relayParsed.recentBlockhash,
              programIds: submitPolicy.relayParsed.programIds,
            }
          : null;
        submitMetadata = {
          ...(submitMetadata ?? {}),
          policy: submitPolicy.metadata,
        };

        if (isRelaySigned) {
          if (!relayValidationParsed) {
            return withCors(
              execErrorResponse({
                code: "invalid-transaction",
                details: {
                  reason: "relay-validation-missing",
                },
              }),
              env,
            );
          }
          relayImmutability = await createRelayImmutabilitySnapshot({
            signedTransactionBase64: parsed.value.relaySigned.signedTransaction,
          });
          if (!relayImmutability) {
            return withCors(
              execErrorResponse({
                code: "invalid-transaction",
                details: {
                  reason: "relay-immutability-hash-failed",
                },
              }),
              env,
            );
          }
          submitMetadata = {
            ...(submitMetadata ?? {}),
            relayValidation: {
              transactionVersion: relayValidationParsed.transactionVersion,
              signatureCount: relayValidationParsed.signatureCount,
              txSizeBytes: relayValidationParsed.txSizeBytes,
              feePayer: relayValidationParsed.feePayer,
              recentBlockhash: relayValidationParsed.recentBlockhash,
              programIds: relayValidationParsed.programIds,
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
            execErrorResponse({
              code: "invalid-request",
              status: 409,
              requestId: reservation.request.requestId,
              details: {
                reason: reservation.error,
              },
            }),
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
                execErrorResponse({
                  code: immutabilityVerification.error,
                  status:
                    immutabilityVerification.error === "policy-denied"
                      ? 403
                      : 400,
                  details: {
                    reason: immutabilityVerification.reason,
                  },
                }),
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
          if (conditionalSpotOrder) {
            const options = conditionalSpotOrder.options ?? {};
            const compatSwap = compatRequest?.privyExecute?.swap ?? null;
            if (!compatSwap) {
              return withCors(
                execErrorResponse({
                  code: "invalid-request",
                  details: {
                    reason: "unsupported-conditional-order-compat",
                  },
                }),
                env,
              );
            }
            const resolvedConditionalOrder = resolveJupiterConditionalSpotOrder(
              {
                family: "conditional_spot_order",
                wallet: conditionalSpotOrder.wallet,
                venueKey: conditionalSpotOrder.intent.venueKey,
                marketType: "spot",
                instrumentId: conditionalSpotOrder.intent.instrumentId,
                side: conditionalSpotOrder.intent.side,
                quantityAtomic: conditionalSpotOrder.intent.quantityAtomic,
                params: conditionalSpotOrder.options ?? null,
              },
            );
            const requestedRequireSimulation =
              typeof options.requireSimulation === "boolean"
                ? options.requireSimulation
                : null;
            const effectiveRequireSimulation =
              submitPolicyRuntime?.requireSimulation === true ||
              requestedRequireSimulation === true;
            const executionParams: Record<string, unknown> = {
              lane: laneResolution.lane,
            };
            if (requestedRequireSimulation === false) {
              executionParams.requireSimulation = false;
            }
            if (effectiveRequireSimulation) {
              executionParams.requireSimulation = true;
            }
            if (typeof options.priorityMicroLamports === "number") {
              executionParams.priorityMicroLamports =
                options.priorityMicroLamports;
            }
            const execution = {
              adapter: laneResolution.adapter,
              params: executionParams,
            };
            const policy = normalizePolicy({
              allowedMints: SUPPORTED_TRADING_MINTS,
              slippageBps: compatSwap.slippageBps,
              maxPriceImpactPct: 0.05,
              minSolReserveLamports: "50000000",
              simulateOnly: Boolean(options.simulateOnly),
              dryRun: Boolean(options.dryRun),
              commitment: options.commitment ?? "confirmed",
            });

            const attemptId = newExecutionAttemptId();
            const attemptStartedAt = new Date().toISOString();
            const qualityMetadata = {
              lane: laneResolution.lane,
              orderType: options.orderType ?? null,
              timeInForce: options.timeInForce ?? "gtc",
              requestedRequireSimulation,
              effectiveRequireSimulation,
              priorityMicroLamports:
                typeof options.priorityMicroLamports === "number"
                  ? options.priorityMicroLamports
                  : null,
              limitPriceAtomic:
                typeof options.limitPriceAtomic === "string"
                  ? options.limitPriceAtomic
                  : null,
              triggerPriceAtomic:
                typeof options.triggerPriceAtomic === "string"
                  ? options.triggerPriceAtomic
                  : null,
            };
            let providerResponse: Record<string, unknown> | null = {
              route: laneResolution.adapter,
              lane: laneResolution.lane,
              mode: parsed.value.mode,
              quality: qualityMetadata,
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

              const runtimeBalancePolicy =
                await evaluatePrivyRuntimeBalancePolicy({
                  env,
                  lane: laneResolution.lane,
                  walletAddress: privyActorContext.walletAddress,
                  inputMint: compatSwap.inputMint,
                  amountAtomic: compatSwap.amountAtomic,
                  minSolReserveLamports: policy.minSolReserveLamports,
                  rpc,
                  runtimeDefaults: submitPolicyRuntime,
                });
              providerResponse = {
                ...(providerResponse ?? {}),
                runtimePolicy: runtimeBalancePolicy.metadata,
              };
              if (!runtimeBalancePolicy.ok) {
                throw asPolicyDeniedError(runtimeBalancePolicy.reason);
              }

              const referenceGuard = await evaluateOracleReferencePriceGuard({
                env,
                mode: "live",
                inputMint: compatSwap.inputMint,
                outputMint: compatSwap.outputMint,
                inputAmountAtomic: compatSwap.amountAtomic,
                expectedOutputAmountAtomic:
                  resolvedConditionalOrder.takingAmount,
                jupiter,
              });
              providerResponse = {
                ...(providerResponse ?? {}),
                ...(referenceGuard.enabled
                  ? {
                      referencePrice: {
                        verdict: referenceGuard.verdict,
                        reason: referenceGuard.reason,
                        executionPrice: referenceGuard.executionPrice,
                        executionDivergenceBps:
                          referenceGuard.executionDivergenceBps,
                        snapshot: referenceGuard.snapshot,
                      },
                    }
                  : {}),
              };
              if (
                referenceGuard.enabled &&
                referenceGuard.verdict !== "allow"
              ) {
                throw asPolicyDeniedError(
                  referenceGuard.reason ?? "reference-price-policy-denied",
                );
              }

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

              const result = await executeIntentViaRouter({
                env,
                venueKey: conditionalSpotOrder.intent.venueKey,
                runtimeMode: "live",
                requireVenueRouting: true,
                subjectControlBypassReason: undefined,
                execution,
                policy,
                rpc,
                jupiter,
                intent: {
                  family: "conditional_spot_order",
                  wallet: conditionalSpotOrder.wallet,
                  venueKey: conditionalSpotOrder.intent.venueKey,
                  marketType: "spot",
                  instrumentId: conditionalSpotOrder.intent.instrumentId,
                  side: conditionalSpotOrder.intent.side,
                  quantityAtomic: conditionalSpotOrder.intent.quantityAtomic,
                  params: conditionalSpotOrder.options ?? null,
                },
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
              const failure = resolveTerminalFailureFromExecuteResult(
                result.status,
                result.err,
                result.signature,
              );
              const errorMessage = executionErrorMessage(result.err);
              providerResponse = {
                ...(providerResponse ?? {}),
                triggerOrder: {
                  maker: conditionalSpotOrder.wallet,
                  instrumentId: conditionalSpotOrder.intent.instrumentId,
                  side: conditionalSpotOrder.intent.side,
                  orderType:
                    typeof options.orderType === "string"
                      ? options.orderType
                      : null,
                  inputMint: compatSwap.inputMint,
                  outputMint: compatSwap.outputMint,
                  makingAmount: compatSwap.amountAtomic,
                  takingAmount:
                    String(result.usedQuote?.outAmount ?? "").trim() ||
                    resolvedConditionalOrder.takingAmount,
                  requestId: result.executionMeta?.intentId ?? null,
                  order:
                    result.executionMeta?.venueSessionId ??
                    result.executionMeta?.intentId ??
                    null,
                },
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
                errorCode: failure ? failure.errorCode : null,
                errorMessage,
                completedAt: settledAt,
              });

              if (failure) {
                await upsertExecutionReceiptIdempotent(env.WAITLIST_DB, {
                  requestId: reservation.request.requestId,
                  receiptId: newExecutionReceiptId(),
                  finalizedStatus: failure.terminalStatus,
                  lane: laneResolution.lane,
                  provider: laneResolution.adapter,
                  signature: result.signature,
                  slot: null,
                  errorCode: failure.errorCode,
                  errorMessage,
                  receipt: {
                    mode: parsed.value.mode,
                    route: laneResolution.adapter,
                    resultStatus: result.status,
                    outcome: failure.terminalStatus,
                    lifecycle: result.executionMeta?.lifecycle ?? {
                      settlementState: "failed",
                      notes: ["conditional_spot_order"],
                    },
                    quality: qualityMetadata,
                    quote: {
                      inputMint: compatSwap.inputMint,
                      outputMint: compatSwap.outputMint,
                      inAmount: compatSwap.amountAtomic,
                      outAmount: String(result.usedQuote?.outAmount ?? ""),
                    },
                  },
                  readyAt: settledAt,
                });
                await terminalizeExecutionRequest(env.WAITLIST_DB, {
                  requestId: reservation.request.requestId,
                  status: failure.terminalStatus,
                  statusReason: failure.statusReason,
                  details: {
                    provider: laneResolution.adapter,
                    attempt: 1,
                    ...(result.signature
                      ? { signature: result.signature }
                      : {}),
                  },
                  nowIso: settledAt,
                });
              } else {
                await updateExecutionRequestStatus(env.WAITLIST_DB, {
                  requestId: reservation.request.requestId,
                  status: "dispatched",
                  statusReason: null,
                });
              }
            } catch (error) {
              const failedAt = new Date().toISOString();
              const deniedReason = policyDeniedReason(error);
              const terminalStatus = deniedReason ? "rejected" : "failed";
              const errorCode = deniedReason
                ? "policy-denied"
                : normalizeExecutionErrorCode({
                    error,
                    fallback: "submission-failed",
                  });
              const statusReason = deniedReason
                ? `policy-denied:${deniedReason}`
                : errorCode;
              const errorMessage =
                executionErrorMessage(error) ?? "execution-submit-failed";
              await createExecutionAttemptIdempotent(env.WAITLIST_DB, {
                attemptId,
                requestId: reservation.request.requestId,
                attemptNo: 1,
                lane: laneResolution.lane,
                provider: laneResolution.adapter,
                status: terminalStatus,
                providerResponse,
                errorCode,
                errorMessage,
                startedAt: attemptStartedAt,
              });
              await finalizeExecutionAttempt(env.WAITLIST_DB, {
                attemptId,
                status: terminalStatus,
                providerResponse,
                errorCode,
                errorMessage,
                completedAt: failedAt,
              });
              await upsertExecutionReceiptIdempotent(env.WAITLIST_DB, {
                requestId: reservation.request.requestId,
                receiptId: newExecutionReceiptId(),
                finalizedStatus: terminalStatus,
                lane: laneResolution.lane,
                provider: laneResolution.adapter,
                signature: null,
                slot: null,
                errorCode,
                errorMessage,
                receipt: {
                  mode: parsed.value.mode,
                  route: laneResolution.adapter,
                  outcome: terminalStatus,
                  lifecycle: {
                    settlementState: "failed",
                    notes: [statusReason],
                  },
                  quality: qualityMetadata,
                },
                readyAt: failedAt,
              });
              await terminalizeExecutionRequest(env.WAITLIST_DB, {
                requestId: reservation.request.requestId,
                status: terminalStatus,
                statusReason,
                details: {
                  provider: laneResolution.adapter,
                  attempt: 1,
                  errorMessage,
                },
                nowIso: failedAt,
              });
            }
          } else {
            if (!spotSwap) {
              return withCors(
                execErrorResponse({
                  code: "invalid-request",
                  details: {
                    reason: intentFamily
                      ? `unsupported-intent-family:${intentFamily}`
                      : "unsupported-intent-family",
                  },
                }),
                env,
              );
            }
            const swap = spotSwap.swap;
            const options = spotSwap.options ?? {};
            const requestedRequireSimulation =
              typeof options.requireSimulation === "boolean"
                ? options.requireSimulation
                : null;
            const effectiveRequireSimulation =
              submitPolicyRuntime?.requireSimulation === true ||
              requestedRequireSimulation === true;
            const executionParams: Record<string, unknown> = {
              lane: laneResolution.lane,
            };
            if (requestedRequireSimulation === false) {
              executionParams.requireSimulation = false;
            }
            if (effectiveRequireSimulation) {
              executionParams.requireSimulation = true;
            }
            if (typeof options.priorityMicroLamports === "number") {
              executionParams.priorityMicroLamports =
                options.priorityMicroLamports;
            }
            const execution = {
              adapter: laneResolution.adapter,
              params: executionParams,
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
            const qualityMetadata = {
              lane: laneResolution.lane,
              slippageBps: swap.slippageBps,
              requestedRequireSimulation,
              effectiveRequireSimulation,
              priorityMicroLamports:
                typeof options.priorityMicroLamports === "number"
                  ? options.priorityMicroLamports
                  : null,
            };
            let providerResponse: Record<string, unknown> | null = {
              route: laneResolution.adapter,
              lane: laneResolution.lane,
              mode: parsed.value.mode,
              quality: qualityMetadata,
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

              const runtimeBalancePolicy =
                await evaluatePrivyRuntimeBalancePolicy({
                  env,
                  lane: laneResolution.lane,
                  walletAddress: privyActorContext.walletAddress,
                  inputMint: swap.inputMint,
                  amountAtomic: swap.amountAtomic,
                  minSolReserveLamports: policy.minSolReserveLamports,
                  rpc,
                  runtimeDefaults: submitPolicyRuntime,
                });
              providerResponse = {
                ...(providerResponse ?? {}),
                runtimePolicy: runtimeBalancePolicy.metadata,
              };
              if (!runtimeBalancePolicy.ok) {
                throw asPolicyDeniedError(runtimeBalancePolicy.reason);
              }

              const quoteResponse = await jupiter.quote({
                inputMint: swap.inputMint,
                outputMint: swap.outputMint,
                amount: swap.amountAtomic,
                slippageBps: policy.slippageBps,
                swapMode: "ExactIn",
              });
              try {
                enforcePolicy(policy, quoteResponse);
              } catch (error) {
                throw asPolicyDeniedError(
                  `privy-quote-${normalizePolicyReason(error, "policy-violation")}`,
                );
              }
              const referenceGuard = await evaluateOracleReferencePriceGuard({
                env,
                mode: "live",
                inputMint: swap.inputMint,
                outputMint: swap.outputMint,
                inputAmountAtomic: swap.amountAtomic,
                expectedOutputAmountAtomic: String(
                  quoteResponse.outAmount ?? "",
                ),
                jupiter,
              });
              providerResponse = {
                ...(providerResponse ?? {}),
                ...(referenceGuard.enabled
                  ? {
                      referencePrice: {
                        verdict: referenceGuard.verdict,
                        reason: referenceGuard.reason,
                        executionPrice: referenceGuard.executionPrice,
                        executionDivergenceBps:
                          referenceGuard.executionDivergenceBps,
                        snapshot: referenceGuard.snapshot,
                      },
                    }
                  : {}),
              };
              if (
                referenceGuard.enabled &&
                referenceGuard.verdict !== "allow"
              ) {
                throw asPolicyDeniedError(
                  referenceGuard.reason ?? "reference-price-policy-denied",
                );
              }

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
                venueKey: spotSwap?.venueKey,
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
              const failure = resolveTerminalFailureFromExecuteResult(
                result.status,
                result.err,
                result.signature,
              );
              const terminalStatus = failure
                ? failure.terminalStatus
                : "landed";
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
                errorCode: failure ? failure.errorCode : null,
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
                errorCode: failure ? failure.errorCode : null,
                errorMessage,
                receipt: {
                  mode: parsed.value.mode,
                  route: laneResolution.adapter,
                  resultStatus: result.status,
                  outcome: terminalStatus,
                  lifecycle: {
                    settlementState:
                      result.status === "finalized"
                        ? "finalized"
                        : result.status === "confirmed"
                          ? "confirmed"
                          : "landed",
                    notes: ["spot_swap"],
                  },
                  quality: qualityMetadata,
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
                statusReason: failure ? failure.statusReason : null,
                details: {
                  provider: laneResolution.adapter,
                  attempt: 1,
                  ...(result.signature ? { signature: result.signature } : {}),
                },
                nowIso: settledAt,
              });
            } catch (error) {
              const failedAt = new Date().toISOString();
              const deniedReason = policyDeniedReason(error);
              const terminalStatus = deniedReason ? "rejected" : "failed";
              const errorCode = deniedReason
                ? "policy-denied"
                : normalizeExecutionErrorCode({
                    error,
                    fallback: "submission-failed",
                  });
              const statusReason = deniedReason
                ? `policy-denied:${deniedReason}`
                : errorCode;
              const errorMessage =
                executionErrorMessage(error) ?? "execution-submit-failed";
              await createExecutionAttemptIdempotent(env.WAITLIST_DB, {
                attemptId,
                requestId: reservation.request.requestId,
                attemptNo: 1,
                lane: laneResolution.lane,
                provider: laneResolution.adapter,
                status: terminalStatus,
                providerResponse,
                errorCode,
                errorMessage,
                startedAt: attemptStartedAt,
              });
              await finalizeExecutionAttempt(env.WAITLIST_DB, {
                attemptId,
                status: terminalStatus,
                providerResponse,
                errorCode,
                errorMessage,
                completedAt: failedAt,
              });
              await upsertExecutionReceiptIdempotent(env.WAITLIST_DB, {
                requestId: reservation.request.requestId,
                receiptId: newExecutionReceiptId(),
                finalizedStatus: terminalStatus,
                lane: laneResolution.lane,
                provider: laneResolution.adapter,
                signature: null,
                slot: null,
                errorCode,
                errorMessage,
                receipt: {
                  mode: parsed.value.mode,
                  route: laneResolution.adapter,
                  outcome: terminalStatus,
                  lifecycle: {
                    settlementState: "failed",
                    notes: [statusReason],
                  },
                  quality: qualityMetadata,
                },
                readyAt: failedAt,
              });
              await terminalizeExecutionRequest(env.WAITLIST_DB, {
                requestId: reservation.request.requestId,
                status: terminalStatus,
                statusReason,
                details: {
                  provider: laneResolution.adapter,
                  attempt: 1,
                  errorMessage,
                },
                nowIso: failedAt,
              });
            }
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
            execErrorResponse({
              code: "invalid-request",
              details: {
                reason: "invalid-request-id",
              },
            }),
            env,
          );
        }

        const latest = await getExecutionLatestStatus(
          env.WAITLIST_DB,
          requestId,
        );
        if (!latest) {
          return withCors(
            execErrorResponse({
              code: "not-found",
              requestId,
            }),
            env,
          );
        }
        const reconciled = await reconcileJupiterConditionalOrder({
          env,
          latest,
        });
        const current = reconciled.latest;

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
                  status: current.request.status,
                  reason: current.request.statusReason,
                  details: null,
                  createdAt: current.request.updatedAt,
                },
              ];
        const attemptsByState = new Map<string, (typeof attempts)[number]>();
        for (const attempt of attempts) {
          if (!attemptsByState.has(attempt.status)) {
            attemptsByState.set(attempt.status, attempt);
          }
        }

        const state = toExecSubmitState(current.request.status);
        const queueDepthRaw = Number(current.request.metadata?.queueDepth);
        const queuePositionRaw = Number(
          current.request.metadata?.queuePosition,
        );
        const relayImmutability = readRelayImmutabilitySnapshot(
          current.request.metadata,
        );
        const intentSummary = isRecord(current.request.metadata?.intent)
          ? current.request.metadata.intent
          : null;
        const lifecycleSummary = isRecord(current.receipt?.receipt?.lifecycle)
          ? current.receipt?.receipt?.lifecycle
          : reconciled.lifecycle
            ? reconciled.lifecycle
            : null;
        return withCors(
          json({
            ok: true,
            requestId,
            status: {
              state,
              terminal: isExecSubmitTerminalState(state),
              mode: current.request.mode,
              lane: current.request.lane,
              actorType: current.request.actorType,
              receivedAt: current.request.receivedAt,
              updatedAt: current.request.updatedAt,
              terminalAt: current.request.terminalAt,
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
            ...(intentSummary ? { intent: intentSummary } : {}),
            ...(lifecycleSummary ? { lifecycle: lifecycleSummary } : {}),
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
            execErrorResponse({
              code: "invalid-request",
              details: {
                reason: "invalid-request-id",
              },
            }),
            env,
          );
        }

        const latest = await getExecutionLatestStatus(
          env.WAITLIST_DB,
          requestId,
        );
        if (!latest) {
          return withCors(
            execErrorResponse({
              code: "not-found",
              requestId,
            }),
            env,
          );
        }
        const reconciled = await reconcileJupiterConditionalOrder({
          env,
          latest,
        });
        const current = reconciled.latest;

        const state = toExecSubmitState(current.request.status);
        const terminal = isExecSubmitTerminalState(state);
        const relayImmutability = readRelayImmutabilitySnapshot(
          current.request.metadata,
        );
        if (!current.receipt) {
          return withCors(
            json({
              ok: true,
              requestId,
              ready: false,
              status: {
                state,
                terminal,
                updatedAt: current.request.updatedAt,
                ...(relayImmutability
                  ? { immutability: relayImmutability }
                  : {}),
              },
              ...(reconciled.lifecycle
                ? { lifecycle: reconciled.lifecycle }
                : {}),
            }),
            env,
          );
        }

        const attempts = await listExecutionAttempts(
          env.WAITLIST_DB,
          requestId,
        );
        const canonicalReceipt = assembleCanonicalExecutionReceiptV1({
          request: current.request,
          receipt: current.receipt,
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

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/execution/observability"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        const defaultWindowMinutes = Math.floor(
          readNumberEnv(env.EXEC_OBS_DEFAULT_WINDOW_MINUTES, 60, 5, 10_080),
        );
        const defaultMaxRequests = Math.floor(
          readNumberEnv(env.EXEC_OBS_MAX_REQUESTS, 5_000, 100, 20_000),
        );
        const windowMinutes = parsePositiveIntParam(
          url.searchParams.get("windowMinutes"),
          defaultWindowMinutes,
          5,
          10_080,
        );
        const maxRequests = parsePositiveIntParam(
          url.searchParams.get("maxRequests"),
          defaultMaxRequests,
          100,
          20_000,
        );
        const snapshot = await readExecutionObservabilitySnapshot({
          db: env.WAITLIST_DB,
          windowMinutes,
          maxRequests,
          thresholds: readExecObservabilityThresholds(env),
        });
        return withCors(
          json({
            ok: true,
            ...snapshot,
          }),
          env,
        );
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/execution/canary"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        return withCors(json(await readExecutionCanarySnapshot(env)), env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/execution/canary/bootstrap"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        return withCors(json(await bootstrapExecutionCanary(env)), env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/execution/canary/reset"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        return withCors(json(await resetExecutionCanary(env)), env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/execution/canary/run"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        const payload = (await request.json().catch(() => null)) as unknown;
        const triggerSource =
          isRecord(payload) && payload.trigger === "post_deploy"
            ? "post_deploy"
            : "manual";
        return withCors(
          json(await runExecutionCanary({ env, triggerSource })),
          env,
        );
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/runtime/canary"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        return withCors(json(await readRuntimeCanarySnapshot(env)), env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/runtime/canary/bootstrap"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        return withCors(json(await bootstrapRuntimeCanary(env)), env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/runtime/canary/reset"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        return withCors(json(await resetRuntimeCanary(env)), env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/runtime/canary/run"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        const payload = (await request.json().catch(() => null)) as unknown;
        const triggerSource =
          isRecord(payload) && payload.trigger === "post_deploy"
            ? "post_deploy"
            : "manual";
        return withCors(
          json(await runRuntimeCanary({ env, triggerSource })),
          env,
        );
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/ops/controls"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        return withCors(
          json({
            ok: true,
            controls: await readOpsControlSnapshot(env),
          }),
          env,
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/controls"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        const payload = (await request.json().catch(() => null)) as unknown;
        const parsedPatch = parseOpsControlPatch(payload);
        if ("error" in parsedPatch) {
          return withCors(
            json({ ok: false, error: parsedPatch.error }, { status: 400 }),
            env,
          );
        }
        try {
          const controls = await writeOpsControlSnapshot(env, parsedPatch);
          return withCors(json({ ok: true, controls }), env);
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "ops-control-write-failed",
              },
              { status: 503 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/controls/reset"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const controls = await resetOpsControlSnapshot(env, "admin-reset");
          return withCors(json({ ok: true, controls }), env);
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "ops-control-reset-failed",
              },
              { status: 503 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/ops/runtime/research"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const result = await readRuntimeResearchRegistry({
            env,
            strategyKey: url.searchParams.get("strategyKey") ?? undefined,
            venueKey: url.searchParams.get("venueKey") ?? undefined,
            assetKey: url.searchParams.get("assetKey") ?? undefined,
            sourceId: url.searchParams.get("sourceId") ?? undefined,
          });
          return withCors(json(result.payload, { status: result.status }), env);
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-registry-read-failed",
              },
              { status: 503 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/ops/runtime/research/substrate"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const substrate = await readRuntimeResearchSubstrateSnapshot({
            env,
            strategyKey: url.searchParams.get("strategyKey") ?? undefined,
            venueKey: url.searchParams.get("venueKey") ?? undefined,
            assetKey: url.searchParams.get("assetKey") ?? undefined,
            pairSymbol: url.searchParams.get("pairSymbol") ?? undefined,
            marketType: url.searchParams.get("marketType") ?? undefined,
          });
          return withCors(
            json({
              ok: true,
              filters: {
                strategyKey: url.searchParams.get("strategyKey") ?? null,
                venueKey: url.searchParams.get("venueKey") ?? null,
                assetKey: url.searchParams.get("assetKey") ?? null,
                pairSymbol: url.searchParams.get("pairSymbol") ?? null,
                marketType: url.searchParams.get("marketType") ?? null,
              },
              substrate,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-substrate-read-failed",
              },
              { status: 503 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/runtime/research/curation"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const curationRequest = parseRuntimeResearchCurationRequest(
            await request.json(),
          );
          const result = await runRuntimeResearchCurationWorkflow({
            env,
            request: curationRequest,
          });
          return withCors(
            json({
              ok: true,
              summary: result.summary,
              markdown: result.markdown,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-curation-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/runtime/research/briefs"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const briefRequest = parseRuntimeResearchBriefRequest(
            await request.json(),
          );
          const result = await runRuntimeResearchBriefWorkflow({
            env,
            request: briefRequest,
          });
          return withCors(
            json({
              ok: true,
              brief: result.brief,
              markdown: result.markdown,
              storedSources: result.storedSources,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-brief-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/runtime/research/synthesis"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const synthesisRequest = parseRuntimeResearchSynthesisRequest(
            await request.json(),
          );
          const result = await runRuntimeResearchSynthesisWorkflow({
            env,
            request: synthesisRequest,
          });
          return withCors(
            json({
              ok: true,
              synthesis: result.synthesis,
              markdown: result.markdown,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-synthesis-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/runtime/research/triage"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const triageRequest = parseRuntimeResearchCandidateTriageRequest(
            await request.json(),
          );
          const result = await runRuntimeResearchCandidateTriageWorkflow({
            env,
            request: triageRequest,
          });
          return withCors(
            json({
              ok: true,
              triage: result.triage,
              markdown: result.markdown,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-triage-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/runtime/research/policy-gate"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const policyGateRequest = parseRuntimeResearchPolicyGateRequest(
            await request.json(),
          );
          const result = await runRuntimeResearchPolicyGateWorkflow({
            env,
            request: policyGateRequest,
          });
          return withCors(
            json({
              ok: true,
              policyGate: result.policyGate,
              markdown: result.markdown,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-policy-gate-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/runtime/research/promotions"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const promotionRequest = parseRuntimeResearchPromotionRequest(
            await request.json(),
          );
          const result = await runRuntimeResearchPromotionWorkflow({
            env,
            request: promotionRequest,
          });
          return withCors(
            json({
              ok: true,
              promotion: result.promotion,
              event: result.event,
              markdown: result.markdown,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-promotion-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/ops/runtime/research/promotions"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const limitRaw = Number(url.searchParams.get("limit"));
          const result = await listRuntimeResearchPromotionWorkflow({
            env,
            promotionId: url.searchParams.get("promotionId") ?? undefined,
            subjectKind:
              url.searchParams.get("subjectKind") === "strategy" ||
              url.searchParams.get("subjectKind") === "venue" ||
              url.searchParams.get("subjectKind") === "asset"
                ? (url.searchParams.get("subjectKind") as
                    | "strategy"
                    | "venue"
                    | "asset")
                : undefined,
            subjectKey: url.searchParams.get("subjectKey") ?? undefined,
            ...(Number.isFinite(limitRaw) && limitRaw > 0
              ? { limit: Math.trunc(limitRaw) }
              : {}),
          });
          return withCors(
            json({
              ok: true,
              promotions: result.promotions,
              ...(result.events ? { events: result.events } : {}),
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-promotion-list-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/runtime/research/readiness"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const readinessRequest = parseRuntimeResearchReadinessRequest(
            await request.json(),
          );
          const result = await runRuntimeResearchReadinessWorkflow({
            env,
            request: readinessRequest,
          });
          return withCors(
            json({
              ok: true,
              readiness: result.readiness,
              markdown: result.markdown,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-readiness-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/ops/runtime/research/readiness"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const limitRaw = Number(url.searchParams.get("limit"));
          const result = await listRuntimeResearchReadinessWorkflow({
            env,
            readinessId: url.searchParams.get("readinessId") ?? undefined,
            subjectKind:
              url.searchParams.get("subjectKind") === "venue" ||
              url.searchParams.get("subjectKind") === "asset"
                ? (url.searchParams.get("subjectKind") as "venue" | "asset")
                : undefined,
            subjectKey: url.searchParams.get("subjectKey") ?? undefined,
            ...(Number.isFinite(limitRaw) && limitRaw > 0
              ? { limit: Math.trunc(limitRaw) }
              : {}),
          });
          return withCors(
            json({
              ok: true,
              readinessArtifacts: result.readinessArtifacts,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-readiness-list-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/runtime/research/subject-controls"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const controlPatch = parseRuntimeResearchSubjectControlPatch(
            await request.json(),
          );
          const result = await upsertRuntimeResearchSubjectControlWorkflow({
            env,
            controlPatch,
          });
          return withCors(
            json({
              ok: true,
              control: result.control,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-subject-control-upsert-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/ops/runtime/research/subject-controls"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const limitRaw = Number(url.searchParams.get("limit"));
          const result = await listRuntimeResearchSubjectControlWorkflow({
            env,
            subjectKind:
              url.searchParams.get("subjectKind") === "venue" ||
              url.searchParams.get("subjectKind") === "asset"
                ? (url.searchParams.get("subjectKind") as "venue" | "asset")
                : undefined,
            subjectKey: url.searchParams.get("subjectKey") ?? undefined,
            ...(Number.isFinite(limitRaw) && limitRaw > 0
              ? { limit: Math.trunc(limitRaw) }
              : {}),
          });
          return withCors(
            json({
              ok: true,
              controls: result.controls,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-subject-control-list-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/runtime/research/readiness/canary"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const canaryRequest = parseRuntimeResearchReadinessCanaryRequest(
            await request.json(),
          );
          const result = await runRuntimeResearchReadinessCanaryWithMarkdown({
            env,
            request: canaryRequest,
          });
          return withCors(
            json({
              ok: result.ok,
              status: result.status,
              run: result.run,
              state: result.state,
              markdown: result.markdown,
              ...(result.error ? { error: result.error } : {}),
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-readiness-canary-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/runtime/research/readiness/smoke"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const smokeRequest = parseRuntimeResearchVenueTxSmokeRequest(
            await request.json(),
          );
          const result = await runRuntimeResearchReadinessCanaryWithMarkdown({
            env,
            request: smokeRequest,
          });
          return withCors(
            json({
              ok: result.ok,
              status: result.status,
              run: result.run,
              state: result.state,
              markdown: result.markdown,
              ...(result.error ? { error: result.error } : {}),
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-venue-tx-smoke-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/ops/runtime/research/readiness/canary"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const limitRaw = Number(url.searchParams.get("limit"));
          const result = await listRuntimeResearchReadinessCanaryWorkflow({
            env,
            runId: url.searchParams.get("runId") ?? undefined,
            subjectKind:
              url.searchParams.get("subjectKind") === "venue" ||
              url.searchParams.get("subjectKind") === "asset"
                ? (url.searchParams.get("subjectKind") as "venue" | "asset")
                : undefined,
            subjectKey: url.searchParams.get("subjectKey") ?? undefined,
            ...(Number.isFinite(limitRaw) && limitRaw > 0
              ? { limit: Math.trunc(limitRaw) }
              : {}),
          });
          return withCors(
            json({
              ok: true,
              runs: result.runs,
              state: result.state,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-readiness-canary-list-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/ops/runtime/research/post-live"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const postLiveRequest = parseRuntimeResearchPostLiveRequest(
            await request.json(),
          );
          const result = await runRuntimeResearchPostLiveWorkflow({
            env,
            request: postLiveRequest,
          });
          return withCors(
            json({
              ok: true,
              artifact: result.artifact,
              markdown: result.markdown,
              ...(result.promotion ? { promotion: result.promotion } : {}),
              ...(result.event ? { event: result.event } : {}),
              ...(result.control ? { control: result.control } : {}),
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-post-live-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/ops/runtime/research/post-live"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const limitRaw = Number(url.searchParams.get("limit"));
          const result = await listRuntimeResearchPostLiveWorkflow({
            env,
            postLiveId: url.searchParams.get("postLiveId") ?? undefined,
            subjectKind:
              url.searchParams.get("subjectKind") === "strategy" ||
              url.searchParams.get("subjectKind") === "venue" ||
              url.searchParams.get("subjectKind") === "asset"
                ? (url.searchParams.get("subjectKind") as
                    | "strategy"
                    | "venue"
                    | "asset")
                : undefined,
            subjectKey: url.searchParams.get("subjectKey") ?? undefined,
            ...(Number.isFinite(limitRaw) && limitRaw > 0
              ? { limit: Math.trunc(limitRaw) }
              : {}),
          });
          return withCors(
            json({
              ok: true,
              artifacts: result.artifacts,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-research-post-live-list-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/ops/runtime"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        const [controls, runtime, canary] = await Promise.all([
          readOpsControlSnapshot(env),
          readRuntimeAdminSnapshot(env),
          readRuntimeCanarySnapshot(env),
        ]);
        return withCors(
          json({
            ok: true,
            runtime: {
              ...runtime,
              controls: controls.runtime,
              canary,
            },
          }),
          env,
        );
      }

      const runtimeDetailDeploymentId =
        request.method === "GET"
          ? parseRuntimeAdminDetailPath(url.pathname)
          : null;
      if (request.method === "GET" && runtimeDetailDeploymentId) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        const [
          deploymentResult,
          runsResult,
          allocatorResult,
          positionsResult,
          pnlResult,
          scorecardResult,
        ] = await Promise.all([
          readRuntimeDeployment(env, runtimeDetailDeploymentId),
          readRuntimeDeploymentRuns(env, runtimeDetailDeploymentId),
          readRuntimeAllocatorSummary(env, runtimeDetailDeploymentId),
          readRuntimePositionSnapshot(env, runtimeDetailDeploymentId),
          readRuntimePnlSummary(env, runtimeDetailDeploymentId),
          readRuntimeScorecard(env, runtimeDetailDeploymentId),
        ]);
        const failedResult =
          [
            deploymentResult,
            runsResult,
            allocatorResult,
            positionsResult,
            pnlResult,
            scorecardResult,
          ].find((result) => !result.ok) ?? null;
        if (failedResult) {
          return withCors(
            json(failedResult.payload, { status: failedResult.status }),
            env,
          );
        }
        return withCors(
          json({
            ok: true,
            source:
              readOptionalString(deploymentResult.payload.source) ??
              "runtime-rs",
            deploymentId: runtimeDetailDeploymentId,
            deployment: isRecord(deploymentResult.payload.deployment)
              ? deploymentResult.payload.deployment
              : null,
            runs: Array.isArray(runsResult.payload.runs)
              ? runsResult.payload.runs
              : [],
            allocator: isRecord(allocatorResult.payload)
              ? {
                  currentDecision: isRecord(
                    allocatorResult.payload.currentDecision,
                  )
                    ? allocatorResult.payload.currentDecision
                    : null,
                  decisions: Array.isArray(allocatorResult.payload.decisions)
                    ? allocatorResult.payload.decisions
                    : [],
                  sleeve: isRecord(allocatorResult.payload.sleeve)
                    ? allocatorResult.payload.sleeve
                    : null,
                  pressureSummary: isRecord(
                    allocatorResult.payload.pressureSummary,
                  )
                    ? allocatorResult.payload.pressureSummary
                    : null,
                }
              : null,
            positions: isRecord(positionsResult.payload.snapshot)
              ? positionsResult.payload.snapshot
              : null,
            pnl: isRecord(pnlResult.payload.totals)
              ? {
                  asOf: readOptionalString(pnlResult.payload.asOf),
                  totals: pnlResult.payload.totals,
                }
              : null,
            scorecard: isRecord(scorecardResult.payload.report)
              ? scorecardResult.payload.report
              : null,
          }),
          env,
        );
      }

      const runtimeControl =
        request.method === "POST"
          ? parseRuntimeAdminControlPath(url.pathname)
          : null;
      const runtimeEvaluateDeploymentId =
        request.method === "POST"
          ? parseRuntimeAdminEvaluatePath(url.pathname)
          : null;
      if (request.method === "POST" && runtimeEvaluateDeploymentId) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          > | null;
          const result = await evaluateRuntimeDeployment({
            env,
            deploymentId: runtimeEvaluateDeploymentId,
            body: body ?? {},
          });
          return withCors(json(result.payload, { status: result.status }), env);
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "runtime-deployment-evaluate-failed",
              },
              { status: 400 },
            ),
            env,
          );
        }
      }
      if (request.method === "POST" && runtimeControl) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        const controls = await readOpsControlSnapshot(env);
        if (runtimeControl.action === "resume") {
          if (!controls.runtime.enabled) {
            return withCors(
              json(
                {
                  ok: false,
                  error: "runtime-disabled",
                  deploymentId: runtimeControl.deploymentId,
                  controls: controls.runtime,
                },
                { status: 409 },
              ),
              env,
            );
          }

          const deploymentResult = await readRuntimeDeployment(
            env,
            runtimeControl.deploymentId,
          );
          if (!deploymentResult.ok) {
            return withCors(
              json(deploymentResult.payload, {
                status: deploymentResult.status,
              }),
              env,
            );
          }
          const deployment = isRecord(deploymentResult.payload.deployment)
            ? deploymentResult.payload.deployment
            : null;
          const deploymentMode = readOptionalString(deployment?.mode);
          if (
            controls.runtime.shadowOnly &&
            deploymentMode &&
            deploymentMode !== "shadow"
          ) {
            return withCors(
              json(
                {
                  ok: false,
                  error: "runtime-shadow-only",
                  deploymentId: runtimeControl.deploymentId,
                  mode: deploymentMode,
                  controls: controls.runtime,
                },
                { status: 409 },
              ),
              env,
            );
          }
        }

        const result = await applyRuntimeDeploymentControl({
          env,
          deploymentId: runtimeControl.deploymentId,
          action: runtimeControl.action,
        });
        return withCors(json(result.payload, { status: result.status }), env);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/ops/dashboard"
      ) {
        const auth = authorizeAdminRoute(request, env);
        if (!auth.ok) {
          return withCors(
            json({ ok: false, error: auth.error }, { status: auth.status }),
            env,
          );
        }
        const defaultWindowMinutes = Math.floor(
          readNumberEnv(env.EXEC_OBS_DEFAULT_WINDOW_MINUTES, 60, 5, 10_080),
        );
        const defaultMaxRequests = Math.floor(
          readNumberEnv(env.EXEC_OBS_MAX_REQUESTS, 5_000, 100, 20_000),
        );
        const windowMinutes = parsePositiveIntParam(
          url.searchParams.get("windowMinutes"),
          defaultWindowMinutes,
          5,
          10_080,
        );
        const maxRequests = parsePositiveIntParam(
          url.searchParams.get("maxRequests"),
          defaultMaxRequests,
          100,
          20_000,
        );
        const [controls, execution, canary, runtime, runtimeCanary] =
          await Promise.all([
            readOpsControlSnapshot(env),
            readExecutionObservabilitySnapshot({
              db: env.WAITLIST_DB,
              windowMinutes,
              maxRequests,
              thresholds: readExecObservabilityThresholds(env),
            }),
            readExecutionCanarySnapshot(env),
            readRuntimeAdminSnapshot(env),
            readRuntimeCanarySnapshot(env),
          ]);
        return withCors(
          json({
            ok: true,
            now: new Date().toISOString(),
            controls,
            execution,
            canary,
            runtime: {
              ...runtime,
              controls: controls.runtime,
              canary: runtimeCanary,
            },
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

      if (
        request.method === "POST" &&
        url.pathname === "/api/terminal/spot-preview"
      ) {
        await requireOnboardedUser(request, env);
        const payload = await readPayload(request);
        const venueKey = readTrimmedString(payload.venueKey)?.toLowerCase();
        const inputMint = readTrimmedString(payload.inputMint);
        const outputMint = readTrimmedString(payload.outputMint);
        const amountAtomic = readTrimmedString(payload.amountAtomic);
        const slippageBps = toBoundedInt(payload.slippageBps, 50, 1, 5_000);
        if (
          !venueKey ||
          !inputMint ||
          !outputMint ||
          !amountAtomic ||
          !SUPPORTED_TRADING_MINT_SET.has(inputMint) ||
          !SUPPORTED_TRADING_MINT_SET.has(outputMint) ||
          !SUPPORTED_TRADING_PAIR_MINT_SET.has(`${inputMint}:${outputMint}`)
        ) {
          return withCors(
            json(
              { ok: false, error: "invalid-terminal-spot-preview" },
              { status: 400 },
            ),
            env,
          );
        }

        try {
          const rpcEndpoint = String(env.RPC_ENDPOINT ?? "").trim();
          if (!rpcEndpoint) {
            return withCors(
              json(
                { ok: false, error: "rpc-endpoint-missing" },
                { status: 503 },
              ),
              env,
            );
          }
          const jupiter = new JupiterClient(
            String(env.JUPITER_BASE_URL ?? "").trim() ||
              X402_READ_JUPITER_BASE_URL,
            env.JUPITER_API_KEY,
          );

          let provider = venueKey;
          let normalizedQuote: Record<string, unknown> | null = null;
          if (venueKey === "jupiter") {
            normalizedQuote = (await jupiter.quote({
              inputMint,
              outputMint,
              amount: amountAtomic,
              slippageBps,
              swapMode: "ExactIn",
            })) as unknown as Record<string, unknown>;
          } else if (venueKey === "raydium") {
            const raydium = new RaydiumClient();
            const preview = await raydium.quoteBaseIn({
              inputMint,
              outputMint,
              amount: amountAtomic,
              slippageBps,
            });
            normalizedQuote = preview.normalizedQuote as unknown as Record<
              string,
              unknown
            >;
            provider = "raydium";
          } else if (venueKey === "orca") {
            const orca = new OrcaClient(rpcEndpoint);
            const preview = await orca.quoteBaseIn({
              inputMint,
              outputMint,
              amount: amountAtomic,
              slippageBps,
            });
            normalizedQuote = preview.normalizedQuote as unknown as Record<
              string,
              unknown
            >;
            provider = "orca";
          } else {
            return withCors(
              json(
                {
                  ok: false,
                  error: `unsupported-terminal-spot-preview:${venueKey}`,
                },
                { status: 400 },
              ),
              env,
            );
          }

          const previewProvider =
            readTrimmedString(normalizedQuote?.quoteProvider) ?? provider;
          const routeSummary =
            summarizeTerminalRoutePlan(normalizedQuote) ?? previewProvider;
          return withCors(
            json({
              ok: true,
              preview: {
                venueKey,
                provider: previewProvider,
                inputMint,
                outputMint,
                inAmountAtomic:
                  readTrimmedString(normalizedQuote?.inAmount) ?? amountAtomic,
                outAmountAtomic:
                  readTrimmedString(normalizedQuote?.outAmount) ?? "0",
                priceImpactPct: Number(normalizedQuote?.priceImpactPct),
                routeSummary,
              },
            }),
            env,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "terminal-spot-preview-failed";
          return withCors(
            json({ ok: false, error: message }, { status: 503 }),
            env,
          );
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/terminal/perp-markets"
      ) {
        await requireOnboardedUser(request, env);
        const venueKey =
          readTrimmedString(url.searchParams.get("venueKey"))?.toLowerCase() ??
          "drift";
        const limit = toBoundedInt(url.searchParams.get("limit"), 8, 1, 24);
        if (venueKey !== "drift") {
          return withCors(
            json(
              {
                ok: false,
                error: `unsupported-terminal-perp-markets:${venueKey}`,
              },
              { status: 400 },
            ),
            env,
          );
        }
        try {
          const markets = await listTerminalPerpMarkets({
            env,
            venueKey: "drift",
            limit,
          });
          return withCors(json({ ok: true, markets }), env);
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "terminal-perp-markets-failed",
              },
              { status: 503 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/terminal/perp-preview"
      ) {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        try {
          const preview = await previewTerminalPerpOrder({
            env,
            actorId: user.id,
            payload: await readPayload(request),
          });
          return withCors(json({ ok: true, preview }), env);
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "terminal-perp-preview-failed",
              },
              {
                status:
                  error instanceof Error &&
                  error.message.startsWith("invalid-terminal-perp")
                    ? 400
                    : 503,
              },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/terminal/perp-orders"
      ) {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        if (!user.walletAddress || !user.privyWalletId) {
          return withCors(
            json({ ok: false, error: "user-wallet-missing" }, { status: 503 }),
            env,
          );
        }
        try {
          const result = await submitTerminalPerpOrder({
            request,
            env,
            user,
            payload: await readPayload(request),
          });
          return withCors(json({ ok: true, result }), env);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "terminal-perp-submit-failed";
          const status =
            error instanceof Error &&
            (message.startsWith("invalid-terminal-perp") ||
              message === "missing-idempotency-key")
              ? 400
              : message === "rpc-endpoint-missing"
                ? 503
                : 409;
          return withCors(json({ ok: false, error: message }, { status }), env);
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/terminal/perp-positions"
      ) {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        try {
          const positions = await listTerminalPerpPositionsForActor({
            env,
            actorId: user.id,
          });
          return withCors(json({ ok: true, positions }), env);
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "terminal-perp-positions-failed",
              },
              { status: 503 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/terminal/prediction-markets"
      ) {
        await requireOnboardedUser(request, env);
        const venueKey =
          readTrimmedString(url.searchParams.get("venueKey"))?.toLowerCase() ??
          "dflow";
        const limit = toBoundedInt(url.searchParams.get("limit"), 12, 1, 50);
        if (venueKey !== "dflow") {
          return withCors(
            json(
              {
                ok: false,
                error: `unsupported-terminal-prediction-markets:${venueKey}`,
              },
              { status: 400 },
            ),
            env,
          );
        }
        try {
          const markets = await listTerminalPredictionMarkets({
            env,
            venueKey: "dflow",
            limit,
          });
          return withCors(json({ ok: true, markets }), env);
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "terminal-prediction-markets-failed",
              },
              { status: 503 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/terminal/prediction-preview"
      ) {
        await requireOnboardedUser(request, env);
        try {
          const preview = await previewTerminalPredictionOrder({
            env,
            payload: await readPayload(request),
          });
          return withCors(json({ ok: true, preview }), env);
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "terminal-prediction-preview-failed",
              },
              {
                status:
                  error instanceof Error &&
                  error.message.startsWith("invalid-terminal-prediction")
                    ? 400
                    : 503,
              },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/terminal/prediction-orders"
      ) {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        if (!user.walletAddress || !user.privyWalletId) {
          return withCors(
            json({ ok: false, error: "user-wallet-missing" }, { status: 503 }),
            env,
          );
        }
        try {
          const result = await submitTerminalPredictionOrder({
            request,
            env,
            user,
            payload: await readPayload(request),
          });
          return withCors(json({ ok: true, result }), env);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "terminal-prediction-submit-failed";
          const status =
            error instanceof Error &&
            (message.startsWith("invalid-terminal-prediction") ||
              message === "missing-idempotency-key")
              ? 400
              : message === "rpc-endpoint-missing"
                ? 503
                : 409;
          return withCors(json({ ok: false, error: message }, { status }), env);
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/terminal/prediction-positions"
      ) {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        try {
          const positions = await listTerminalPredictionPositionsForActor({
            env,
            actorId: user.id,
          });
          return withCors(json({ ok: true, positions }), env);
        } catch (error) {
          return withCors(
            json(
              {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "terminal-prediction-positions-failed",
              },
              { status: 503 },
            ),
            env,
          );
        }
      }

      if (
        request.method === "POST" &&
        url.pathname.startsWith("/api/terminal/prediction-positions/") &&
        url.pathname.endsWith("/settle")
      ) {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        if (!user.walletAddress || !user.privyWalletId) {
          return withCors(
            json({ ok: false, error: "user-wallet-missing" }, { status: 503 }),
            env,
          );
        }
        const positionKey = decodeURIComponent(
          url.pathname
            .slice("/api/terminal/prediction-positions/".length)
            .replace(/\/settle$/, ""),
        );
        try {
          const result = await settleTerminalPredictionPosition({
            request,
            env,
            user,
            positionKey,
          });
          return withCors(json({ ok: true, result }), env);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "terminal-prediction-settlement-failed";
          const status =
            error instanceof Error &&
            (message === "terminal-prediction-position-not-found" ||
              message.startsWith("terminal-prediction-position-"))
              ? 404
              : message.startsWith("invalid-terminal-prediction")
                ? 400
                : 409;
          return withCors(json({ ok: false, error: message }, { status }), env);
        }
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/terminal/open-orders"
      ) {
        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        const pageSize = 80;
        const conditionalRequests: ExecutionRequestRecord[] = [];
        const clobRequests: ExecutionRequestRecord[] = [];
        for (let offset = 0; ; offset += pageSize) {
          const page = await listOpenExecutionRequestsByActorAndIntentFamily(
            env.WAITLIST_DB,
            {
              actorId: user.id,
              mode: "privy_execute",
              intentFamily: "conditional_spot_order",
              limit: pageSize,
              offset,
            },
          );
          conditionalRequests.push(...page);
          if (page.length < pageSize) break;
        }
        for (let offset = 0; ; offset += pageSize) {
          const page = await listOpenExecutionRequestsByActorAndIntentFamily(
            env.WAITLIST_DB,
            {
              actorId: user.id,
              mode: "privy_execute",
              intentFamily: "clob_order",
              limit: pageSize,
              offset,
            },
          );
          clobRequests.push(...page);
          if (page.length < pageSize) break;
        }
        const orders: Record<string, unknown>[] = [];
        for (const entry of conditionalRequests) {
          const latest = await getExecutionLatestStatus(
            env.WAITLIST_DB,
            entry.requestId,
          );
          if (!latest) continue;
          const reconciled = await reconcileJupiterConditionalOrder({
            env,
            latest,
          });
          const lifecycle = isRecord(reconciled.lifecycle)
            ? reconciled.lifecycle
            : null;
          const order = buildTerminalConditionalOrderView({
            latest: reconciled.latest,
            lifecycle,
            trackedOrder: reconciled.trackedOrder,
            summary: reconciled.summary
              ? {
                  filledInputAtomic: reconciled.summary.filledInputAtomic,
                  filledOutputAtomic: reconciled.summary.filledOutputAtomic,
                  signature: reconciled.summary.signature,
                }
              : null,
          });
          if (order) orders.push(order);
        }
        for (const entry of clobRequests) {
          const latest = await getExecutionLatestStatus(
            env.WAITLIST_DB,
            entry.requestId,
          );
          const order = buildTerminalOpenBookOrderView({
            latest,
            lifecycle: readPersistedExecutionLifecycle({ latest }),
          });
          if (order) orders.push(order);
        }
        orders.sort((a, b) =>
          String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
        );
        return withCors(
          json({
            ok: true,
            orders,
          }),
          env,
        );
      }

      if (
        request.method === "POST" &&
        url.pathname.startsWith("/api/terminal/open-orders/") &&
        url.pathname.endsWith("/cancel")
      ) {
        const requestId = decodeURIComponent(
          url.pathname
            .slice("/api/terminal/open-orders/".length)
            .replace(/\/cancel$/, ""),
        );
        if (!isValidExecRequestId(requestId)) {
          return withCors(
            execErrorResponse({
              code: "invalid-request",
              details: {
                reason: "invalid-request-id",
              },
            }),
            env,
          );
        }

        let user = await requireOnboardedUser(request, env);
        user = await ensureUserWallet(env, user);
        if (!user.walletAddress || !user.privyWalletId) {
          return withCors(
            json({ ok: false, error: "user-wallet-missing" }, { status: 503 }),
            env,
          );
        }

        const latest = await getExecutionLatestStatus(
          env.WAITLIST_DB,
          requestId,
        );
        if (!latest || latest.request.actorId !== user.id) {
          return withCors(
            execErrorResponse({
              code: "not-found",
              requestId,
            }),
            env,
          );
        }
        const reconciled = await reconcileJupiterConditionalOrder({
          env,
          latest,
        });
        const intent = isRecord(reconciled.latest.request.metadata?.intent)
          ? reconciled.latest.request.metadata?.intent
          : null;
        const intentFamily = readTrimmedString(intent?.family);
        if (
          intentFamily !== "conditional_spot_order" &&
          !(
            intentFamily === "clob_order" &&
            readTrimmedString(intent?.venueKey) === "openbook"
          )
        ) {
          return withCors(
            execErrorResponse({
              code: "invalid-request",
              details: {
                reason: "unsupported-open-order-request",
              },
              requestId,
            }),
            env,
          );
        }
        if (
          intentFamily === "clob_order" &&
          readTrimmedString(intent?.venueKey) === "openbook"
        ) {
          const lifecycle = readPersistedExecutionLifecycle({
            latest: reconciled.latest,
          });
          const currentState = toExecSubmitState(
            reconciled.latest.request.status,
          );
          if (
            isExecSubmitTerminalState(currentState) ||
            reconciled.latest.receipt ||
            reconciled.latest.request.terminalAt
          ) {
            return withCors(
              json({
                ok: true,
                requestId,
                cancelled: false,
                status: {
                  state: currentState,
                  terminal: true,
                  updatedAt: reconciled.latest.request.updatedAt,
                },
                ...(lifecycle ? { lifecycle } : {}),
              }),
              env,
            );
          }
          const trackedOrder = readTrackedOpenBookOrder({
            latest: reconciled.latest,
          });
          const clientOrderId = readTrimmedString(trackedOrder?.clientOrderId);
          if (!clientOrderId) {
            return withCors(
              execErrorResponse({
                code: "invalid-request",
                details: {
                  reason: "openbook-order-tracking-missing",
                },
                requestId,
              }),
              env,
            );
          }
          const provider =
            reconciled.latest.latestAttempt?.provider ?? "openbook_v2";
          const cancelledAt = new Date().toISOString();
          const cancelLifecycle = {
            orderState: "cancelled",
            fillState: "failed",
            settlementState: "failed",
            notes: ["openbook-order-cancelled"],
          };
          await upsertExecutionReceiptIdempotent(env.WAITLIST_DB, {
            requestId,
            receiptId: newExecutionReceiptId(),
            finalizedStatus: "failed",
            lane: reconciled.latest.request.lane,
            provider,
            signature: null,
            slot: null,
            errorCode: "order-cancelled",
            errorMessage: "OpenBook order was cancelled before settlement.",
            receipt: {
              mode: reconciled.latest.request.mode,
              route: provider,
              outcome: "failed",
              lifecycle: cancelLifecycle,
              openbookOrder: {
                clientOrderId,
                openOrdersAccount:
                  readTrimmedString(trackedOrder?.openOrdersAccount) ?? null,
                instrumentId:
                  readTrimmedString(trackedOrder?.instrumentId) ??
                  readTrimmedString(intent?.instrumentId),
                side:
                  readTrimmedString(trackedOrder?.side) ??
                  readTrimmedString(intent?.side),
                orderType:
                  readTrimmedString(trackedOrder?.orderType) ?? "limit",
                timeInForce:
                  readTrimmedString(trackedOrder?.timeInForce) ?? "gtc",
                quantityAtomic:
                  readTrimmedString(trackedOrder?.quantityAtomic) ??
                  readTrimmedString(intent?.quantityAtomic),
                limitPriceAtomic:
                  readTrimmedString(trackedOrder?.limitPriceAtomic) ?? null,
              },
            },
            readyAt: cancelledAt,
          });
          await terminalizeExecutionRequest(env.WAITLIST_DB, {
            requestId,
            status: "failed",
            statusReason: "openbook-order-cancelled",
            details: {
              provider,
              orderState: "cancelled",
              clientOrderId,
            },
            nowIso: cancelledAt,
          });
          const refreshed = await getExecutionLatestStatus(
            env.WAITLIST_DB,
            requestId,
          );
          const refreshedState = toExecSubmitState(
            refreshed?.request.status ?? "failed",
          );
          return withCors(
            json({
              ok: true,
              requestId,
              cancelled: true,
              status: {
                state: refreshedState,
                terminal: isExecSubmitTerminalState(refreshedState),
                updatedAt: refreshed?.request.updatedAt ?? cancelledAt,
              },
              lifecycle: cancelLifecycle,
              signature: null,
            }),
            env,
          );
        }
        const currentState = toExecSubmitState(
          reconciled.latest.request.status,
        );
        const lifecycle = isRecord(reconciled.lifecycle)
          ? reconciled.lifecycle
          : null;
        if (
          isExecSubmitTerminalState(currentState) ||
          reconciled.latest.receipt ||
          reconciled.latest.request.terminalAt
        ) {
          return withCors(
            json({
              ok: true,
              requestId,
              cancelled: false,
              status: {
                state: currentState,
                terminal: true,
                updatedAt: reconciled.latest.request.updatedAt,
              },
              ...(lifecycle ? { lifecycle } : {}),
            }),
            env,
          );
        }
        const trackedOrder = reconciled.trackedOrder;
        if (!trackedOrder) {
          return withCors(
            execErrorResponse({
              code: "invalid-request",
              details: {
                reason: "trigger-order-tracking-missing",
              },
              requestId,
            }),
            env,
          );
        }
        if (trackedOrder.maker !== user.walletAddress) {
          return withCors(
            execErrorResponse({
              code: "auth-required",
              details: {
                reason: "trigger-order-maker-mismatch",
              },
              requestId,
            }),
            env,
          );
        }

        const rpcEndpoint = String(env.RPC_ENDPOINT ?? "").trim();
        if (!rpcEndpoint) {
          return withCors(
            execErrorResponse({
              code: "submission-failed",
              details: {
                reason: "rpc-endpoint-missing",
              },
              requestId,
            }),
            env,
          );
        }
        const rpc = new SolanaRpc(rpcEndpoint);
        const jupiter = new JupiterClient(
          String(env.JUPITER_BASE_URL ?? "").trim() ||
            X402_READ_JUPITER_BASE_URL,
          env.JUPITER_API_KEY,
        );

        try {
          const cancelResponse = await jupiter.cancelTriggerOrder({
            maker: trackedOrder.maker,
            payer: user.walletAddress,
            order: trackedOrder.order,
          });
          const signedBase64 = await signTransactionWithPrivyById(
            env,
            user.privyWalletId,
            cancelResponse.transaction,
          );
          const safeEvaluation = evaluateSafeLaneTransaction({
            env,
            signedTransactionBase64: signedBase64,
          });
          if (!safeEvaluation.ok) {
            return withCors(
              execErrorResponse({
                code: "policy-denied",
                details: {
                  reason: safeEvaluation.reason,
                },
                requestId,
              }),
              env,
            );
          }
          const simulation = await rpc.simulateTransactionBase64(signedBase64, {
            commitment: "confirmed",
            sigVerify: true,
          });
          if (simulation.err) {
            return withCors(
              execErrorResponse({
                code: "policy-denied",
                details: {
                  reason: "safe-lane-simulation-failed",
                },
                requestId,
              }),
              env,
            );
          }
          const signature = await rpc.sendTransactionBase64(signedBase64, {
            preflightCommitment: "confirmed",
            skipPreflight: false,
          });
          const confirmation = await rpc.confirmSignature(signature, {
            commitment: "confirmed",
          });
          if (!confirmation.ok) {
            return withCors(
              execErrorResponse({
                code: "submission-failed",
                details: {
                  reason: "conditional-order-cancel-confirmation-failed",
                },
                requestId,
              }),
              env,
            );
          }

          const cancelSummary = summarizeJupiterTriggerOrder({
            ...(reconciled.orderRecord ?? {}),
            order: trackedOrder.order,
            makingAmount:
              trackedOrder.makingAmount ??
              readTrimmedString(reconciled.orderRecord?.makingAmount) ??
              "0",
            takingAmount:
              trackedOrder.takingAmount ??
              readTrimmedString(reconciled.orderRecord?.takingAmount) ??
              "0",
            status: "Cancelled",
            closeTx: signature,
          });
          const receipt = buildTerminalJupiterTriggerReceipt({
            latest: reconciled.latest,
            trackedOrder,
            orderRecord: reconciled.orderRecord,
            summary: cancelSummary,
          });
          const readyAt = new Date().toISOString();
          await upsertExecutionReceiptIdempotent(env.WAITLIST_DB, {
            requestId,
            receiptId: newExecutionReceiptId(),
            finalizedStatus: receipt.finalizedStatus,
            lane: reconciled.latest.request.lane,
            provider: reconciled.latest.latestAttempt?.provider ?? "jupiter",
            signature,
            slot: null,
            errorCode: receipt.errorCode,
            errorMessage: receipt.errorMessage,
            receipt: receipt.receipt,
            readyAt,
          });
          await terminalizeExecutionRequest(env.WAITLIST_DB, {
            requestId,
            status: receipt.finalizedStatus,
            statusReason: receipt.statusReason,
            details: {
              provider: reconciled.latest.latestAttempt?.provider ?? "jupiter",
              signature,
              orderState: "cancelled",
            },
            nowIso: readyAt,
          });
          const refreshed = await getExecutionLatestStatus(
            env.WAITLIST_DB,
            requestId,
          );
          const refreshedState = toExecSubmitState(
            refreshed?.request.status ?? receipt.finalizedStatus,
          );
          return withCors(
            json({
              ok: true,
              requestId,
              cancelled: true,
              status: {
                state: refreshedState,
                terminal: isExecSubmitTerminalState(refreshedState),
                updatedAt: refreshed?.request.updatedAt ?? readyAt,
              },
              lifecycle: cancelSummary.lifecycle,
              signature,
            }),
            env,
          );
        } catch (error) {
          return withCors(
            execErrorResponse({
              code: normalizeExecutionErrorCode({
                error,
                fallback: "submission-failed",
              }),
              details: {
                reason:
                  readTrimmedString(
                    error instanceof Error ? error.message : error,
                  ) ?? "conditional-order-cancel-failed",
              },
              requestId,
            }),
            env,
          );
        }
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
      if (url.pathname.startsWith("/api/x402/exec/")) {
        const code = normalizeExecutionErrorCode({
          error: message,
          fallback: "submission-failed",
        });
        const forcedStatus =
          message === "d1-migrations-not-applied" ||
          message.startsWith("x402-route-config-")
            ? 503
            : undefined;
        if ((forcedStatus ?? executionErrorStatus(code)) >= 500) {
          console.error("api.error", {
            method: request.method,
            path: url.pathname,
            message: rawMessage,
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        return withCors(
          execErrorResponse({
            code,
            ...(forcedStatus ? { status: forcedStatus } : {}),
            details: {
              reason: message,
            },
          }),
          env,
        );
      }
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
    const runExecutionCanaryTick = isExecutionCanaryScheduledTick(_event);
    const runRuntimeCanaryTick = isRuntimeCanaryScheduledTick(_event);
    if (runExecutionCanaryTick || runRuntimeCanaryTick) {
      if (runExecutionCanaryTick) {
        try {
          await runExecutionCanary({
            env,
            triggerSource: "schedule",
          });
        } catch (error) {
          console.error("execution.canary.scheduled.error", {
            message: error instanceof Error ? error.message : "unknown-error",
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }
      if (runRuntimeCanaryTick) {
        try {
          await runRuntimeCanary({
            env,
            triggerSource: "schedule",
          });
        } catch (error) {
          console.error("runtime.canary.scheduled.error", {
            message: error instanceof Error ? error.message : "unknown-error",
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }
      return;
    }

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

async function maybeResolvePrivyActorContext(
  request: Request,
  env: Env,
): Promise<{
  userId: string;
  walletAddress: string;
  privyWalletId: string;
} | null> {
  const hasAuthorization = Boolean(
    String(request.headers.get("authorization") ?? "").trim(),
  );
  if (!hasAuthorization) return null;
  try {
    let user = await requireOnboardedUser(request, env);
    user = await ensureUserWallet(env, user);
    if (!user.walletAddress || !user.privyWalletId) return null;
    return {
      userId: user.id,
      walletAddress: user.walletAddress,
      privyWalletId: user.privyWalletId,
    };
  } catch {
    return null;
  }
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

function readTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map((entry) => readTrimmedString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return normalized.length > 0 ? normalized : null;
}

function readAtomicBigInt(value: unknown): bigint | null {
  const normalized = readTrimmedString(value);
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

function subtractAtomicStrings(
  total: string | null,
  consumed: string | null,
): string | null {
  const totalAtomic = readAtomicBigInt(total);
  const consumedAtomic = readAtomicBigInt(consumed);
  if (totalAtomic === null || consumedAtomic === null) return null;
  return (
    totalAtomic > consumedAtomic ? totalAtomic - consumedAtomic : 0n
  ).toString();
}

function resolveTerminalSimulationPreference(
  quality: Record<string, unknown> | null,
): "auto" | "always" | "never" {
  if (quality?.requestedRequireSimulation === false) return "never";
  if (quality?.effectiveRequireSimulation === true) return "always";
  return "auto";
}

function resolveTerminalPriorityLevel(
  quality: Record<string, unknown> | null,
): "normal" | "high" | "urgent" {
  const priority = Number(quality?.priorityMicroLamports);
  if (!Number.isFinite(priority) || priority <= 5_000) return "normal";
  if (priority >= 200_000) return "urgent";
  return "high";
}

function resolveTerminalProviderStatus(input: {
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>;
  terminal: boolean;
}): "healthy" | "degraded" | "pending" {
  const latestAttemptStatus = readTrimmedString(
    input.latest?.latestAttempt?.status,
  )?.toLowerCase();
  if (
    latestAttemptStatus === "failed" ||
    latestAttemptStatus === "rejected" ||
    latestAttemptStatus === "expired"
  ) {
    return "degraded";
  }
  if (!input.terminal) return "pending";
  return input.latest?.receipt?.errorCode ? "degraded" : "healthy";
}

function readPersistedExecutionLifecycle(input: {
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>;
}): Record<string, unknown> | null {
  const latest = input.latest;
  if (!latest) return null;
  const receiptLifecycle = isRecord(latest.receipt?.receipt?.lifecycle)
    ? latest.receipt?.receipt?.lifecycle
    : null;
  if (receiptLifecycle) return receiptLifecycle;
  const executionMeta = isRecord(
    latest.latestAttempt?.providerResponse?.executionMeta,
  )
    ? latest.latestAttempt?.providerResponse?.executionMeta
    : null;
  const executionLifecycle = isRecord(executionMeta?.lifecycle)
    ? executionMeta?.lifecycle
    : null;
  return executionLifecycle ?? null;
}

function summarizeTerminalRoutePlan(
  quote: Record<string, unknown> | null,
): string | null {
  if (!quote || !Array.isArray(quote.routePlan)) return null;
  const labels: string[] = [];
  for (const hop of quote.routePlan) {
    if (!isRecord(hop)) continue;
    const swapInfo = isRecord(hop.swapInfo) ? hop.swapInfo : null;
    const label =
      readTrimmedString(swapInfo?.label) ??
      readTrimmedString(hop.poolId) ??
      readTrimmedString(hop.marketId);
    if (!label || labels.includes(label)) continue;
    labels.push(label);
  }
  return labels.length > 0 ? labels.join(" -> ") : null;
}

function resolveTerminalOpenOrderStatus(
  lifecycle: Record<string, unknown> | null,
  terminal: boolean,
):
  | "pending"
  | "working"
  | "partial"
  | "filled"
  | "failed"
  | "cancelled"
  | "expired" {
  const orderState = readTrimmedString(lifecycle?.orderState)?.toLowerCase();
  if (orderState === "accepted") return "pending";
  if (orderState === "partially_filled") return "partial";
  if (orderState === "filled") return "filled";
  if (orderState === "cancelled") return "cancelled";
  if (orderState === "expired") return "expired";
  if (orderState === "rejected") return "failed";
  if (terminal) return "failed";
  return "working";
}

function readTrackedOpenBookOrder(input: {
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>;
}): Record<string, unknown> | null {
  const latest = input.latest;
  if (!latest) return null;
  const intent = isRecord(latest.request.metadata?.intent)
    ? latest.request.metadata.intent
    : null;
  if (
    readTrimmedString(intent?.family) !== "clob_order" ||
    readTrimmedString(intent?.venueKey) !== "openbook"
  ) {
    return null;
  }
  const attemptResponse = isRecord(latest.latestAttempt?.providerResponse)
    ? latest.latestAttempt?.providerResponse
    : null;
  const executionMeta = isRecord(attemptResponse?.executionMeta)
    ? attemptResponse?.executionMeta
    : null;
  const quality = isRecord(attemptResponse?.quality)
    ? attemptResponse?.quality
    : null;
  const receiptOrder = isRecord(latest.receipt?.receipt?.openbookOrder)
    ? latest.receipt?.receipt?.openbookOrder
    : null;
  return {
    clientOrderId:
      readTrimmedString(receiptOrder?.clientOrderId) ??
      readTrimmedString(executionMeta?.intentId),
    openOrdersAccount:
      readTrimmedString(receiptOrder?.openOrdersAccount) ??
      readTrimmedString(executionMeta?.venueSessionId),
    instrumentId:
      readTrimmedString(receiptOrder?.instrumentId) ??
      readTrimmedString(intent?.instrumentId),
    side:
      readTrimmedString(receiptOrder?.side) ?? readTrimmedString(intent?.side),
    orderType:
      readTrimmedString(receiptOrder?.orderType) ??
      readTrimmedString(quality?.orderType) ??
      "limit",
    timeInForce:
      readTrimmedString(receiptOrder?.timeInForce) ??
      readTrimmedString(quality?.timeInForce) ??
      "gtc",
    quantityAtomic:
      readTrimmedString(receiptOrder?.quantityAtomic) ??
      readTrimmedString(intent?.quantityAtomic),
    limitPriceAtomic:
      readTrimmedString(receiptOrder?.limitPriceAtomic) ??
      readTrimmedString(quality?.limitPriceAtomic),
  };
}

function buildTerminalConditionalOrderView(input: {
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>;
  lifecycle: Record<string, unknown> | null;
  trackedOrder: ReturnType<typeof readTrackedJupiterTriggerOrder>;
  summary: {
    filledInputAtomic: string;
    filledOutputAtomic: string;
    signature: string | null;
  } | null;
}): Record<string, unknown> | null {
  const latest = input.latest;
  if (!latest) return null;
  const intent = isRecord(latest.request.metadata?.intent)
    ? latest.request.metadata.intent
    : null;
  if (readTrimmedString(intent?.family) !== "conditional_spot_order") {
    return null;
  }
  const trackedOrder = input.trackedOrder;
  const quality = isRecord(latest.latestAttempt?.providerResponse?.quality)
    ? latest.latestAttempt?.providerResponse?.quality
    : null;
  const lifecycle = input.lifecycle;
  const filledInputAtomic = input.summary?.filledInputAtomic ?? "0";
  const filledOutputAtomic = input.summary?.filledOutputAtomic ?? "0";
  const terminal = Boolean(latest.request.terminalAt);
  const notes = readStringArray(lifecycle?.notes);
  const providerStatus = resolveTerminalProviderStatus({
    latest,
    terminal,
  });
  return {
    requestId: latest.request.requestId,
    requestStatus: latest.request.status,
    terminal,
    receivedAt: latest.request.receivedAt,
    updatedAt: latest.request.updatedAt,
    terminalAt: latest.request.terminalAt,
    intentFamily: readTrimmedString(intent?.family) ?? "conditional_spot_order",
    venueKey: readTrimmedString(intent?.venueKey) ?? "jupiter",
    marketType: readTrimmedString(intent?.marketType) ?? "spot",
    pairId:
      trackedOrder?.instrumentId ?? readTrimmedString(intent?.instrumentId),
    instrumentId:
      trackedOrder?.instrumentId ?? readTrimmedString(intent?.instrumentId),
    instrumentLabel:
      trackedOrder?.instrumentId ?? readTrimmedString(intent?.instrumentId),
    direction: trackedOrder?.side ?? readTrimmedString(intent?.side),
    source: readTrimmedString(latest.request.metadata?.source) ?? "TERMINAL",
    reason: readTrimmedString(latest.request.metadata?.reason),
    orderType:
      trackedOrder?.orderType ??
      readTrimmedString(quality?.orderType) ??
      "limit",
    timeInForce: readTrimmedString(quality?.timeInForce) ?? "gtc",
    lane: latest.request.lane,
    simulationPreference: resolveTerminalSimulationPreference(quality),
    priorityLevel: resolveTerminalPriorityLevel(quality),
    priorityMicroLamports: Number.isFinite(
      Number(quality?.priorityMicroLamports),
    )
      ? Math.max(0, Math.floor(Number(quality?.priorityMicroLamports)))
      : null,
    slippageBps: 50,
    inputMint: trackedOrder?.inputMint,
    outputMint: trackedOrder?.outputMint,
    amountAtomic: trackedOrder?.makingAmount ?? null,
    remainingAmountAtomic: subtractAtomicStrings(
      trackedOrder?.makingAmount ?? null,
      filledInputAtomic,
    ),
    takingAmountAtomic: trackedOrder?.takingAmount ?? null,
    filledInputAtomic,
    filledOutputAtomic,
    limitPriceAtomic: readTrimmedString(quality?.limitPriceAtomic),
    triggerPriceAtomic: readTrimmedString(quality?.triggerPriceAtomic),
    provider:
      latest.receipt?.provider ?? latest.latestAttempt?.provider ?? null,
    providerStatus,
    signature: latest.receipt?.signature ?? input.summary?.signature ?? null,
    errorCode: latest.receipt?.errorCode ?? null,
    errorMessage: latest.receipt?.errorMessage ?? null,
    status: resolveTerminalOpenOrderStatus(lifecycle, terminal),
    oracleFreshnessMs: null,
    oracleSource: null,
    oracleStale: false,
    lifecycle:
      lifecycle && Object.keys(lifecycle).length > 0
        ? {
            ...lifecycle,
            ...(notes ? { notes } : {}),
          }
        : null,
  };
}

function buildTerminalOpenBookOrderView(input: {
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>;
  lifecycle: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const latest = input.latest;
  if (!latest) return null;
  const trackedOrder = readTrackedOpenBookOrder({ latest });
  if (!trackedOrder) return null;
  const terminal = Boolean(latest.request.terminalAt);
  const lifecycle = input.lifecycle;
  const notes = readStringArray(lifecycle?.notes);
  return {
    requestId: latest.request.requestId,
    requestStatus: latest.request.status,
    terminal,
    receivedAt: latest.request.receivedAt,
    updatedAt: latest.request.updatedAt,
    terminalAt: latest.request.terminalAt,
    pairId: readTrimmedString(trackedOrder.instrumentId),
    direction: readTrimmedString(trackedOrder.side),
    source: readTrimmedString(latest.request.metadata?.source) ?? "TERMINAL",
    reason: readTrimmedString(latest.request.metadata?.reason),
    orderType: readTrimmedString(trackedOrder.orderType) ?? "limit",
    timeInForce: readTrimmedString(trackedOrder.timeInForce) ?? "gtc",
    lane: latest.request.lane,
    simulationPreference: "always",
    priorityLevel: "normal",
    priorityMicroLamports: null,
    amountAtomic: readTrimmedString(trackedOrder.quantityAtomic),
    remainingAmountAtomic: readTrimmedString(trackedOrder.quantityAtomic),
    limitPriceAtomic: readTrimmedString(trackedOrder.limitPriceAtomic),
    provider:
      latest.receipt?.provider ??
      latest.latestAttempt?.provider ??
      "openbook_v2",
    signature: latest.receipt?.signature ?? null,
    errorCode: latest.receipt?.errorCode ?? null,
    errorMessage: latest.receipt?.errorMessage ?? null,
    clientOrderId: readTrimmedString(trackedOrder.clientOrderId),
    openOrdersAccount: readTrimmedString(trackedOrder.openOrdersAccount),
    status: resolveTerminalOpenOrderStatus(lifecycle, terminal),
    lifecycle:
      lifecycle && Object.keys(lifecycle).length > 0
        ? {
            ...lifecycle,
            ...(notes ? { notes } : {}),
          }
        : null,
  };
}

const TERMINAL_PERP_COLLATERAL_DECIMALS = 6;
const TERMINAL_PERP_QUANTITY_DECIMALS = 0;

type TerminalPerpOrderSide = "long" | "short" | "close_long" | "close_short";

type TerminalPerpPositionView = {
  key: string;
  venueKey: "drift";
  instrumentId: string;
  instrumentLabel: string;
  side: "long" | "short" | "flat";
  positionState: "open" | "closed";
  signedQuantityAtomic: string;
  signedQuantityUi: string;
  absoluteQuantityUi: string;
  averageEntryPrice: number | null;
  markPrice: number | null;
  oraclePrice: number | null;
  fundingRate1hBps: number | null;
  collateralAtomic: string;
  collateralUi: string;
  notionalQuote: number | null;
  unrealizedPnlQuote: number | null;
  leverage: number | null;
  equityQuote: number | null;
  usedMarginQuote: number | null;
  maintenanceRequirementQuote: number | null;
  freeCollateralQuote: number | null;
  initialMarginRatio: number | null;
  maintenanceMarginRatio: number | null;
  liquidationBufferPct: number | null;
  riskLevel: "low" | "warning" | "critical";
  oracle: string | null;
  oracleSource: string | null;
  lastRequestId: string | null;
  lastUpdatedAt: string | null;
  notes: string[];
};

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function roundFiniteNumber(value: number | null, digits = 6): number | null {
  if (!Number.isFinite(value)) return null;
  return Number((value as number).toFixed(digits));
}

function ratioToFraction(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (parsed > 1) return parsed / 10_000;
  return parsed;
}

function bigintToSignedDisplay(value: bigint, decimals: number): string {
  const sign = value < 0n ? "-" : "";
  return `${sign}${formatAtomicDisplay(absBigInt(value), decimals)}`;
}

function parseTerminalPerpOrderSide(
  value: unknown,
): TerminalPerpOrderSide | null {
  const normalized = readTrimmedString(value)?.toLowerCase();
  if (
    normalized === "long" ||
    normalized === "short" ||
    normalized === "close_long" ||
    normalized === "close_short"
  ) {
    return normalized;
  }
  return null;
}

function parseTerminalPerpOrderType(
  value: unknown,
): "market" | "limit" | "trigger" {
  const normalized = readTrimmedString(value)?.toLowerCase();
  if (normalized === "limit") return "limit";
  if (normalized === "trigger") return "trigger";
  return "market";
}

function parseTerminalPerpTimeInForce(value: unknown): "gtc" | "ioc" | "fok" {
  const normalized = readTrimmedString(value)?.toLowerCase();
  if (normalized === "ioc" || normalized === "fok") return normalized;
  return "gtc";
}

function readPerpReferenceSnapshot(
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>,
): Record<string, unknown> | null {
  const providerResponse = isRecord(latest?.latestAttempt?.providerResponse)
    ? latest.latestAttempt.providerResponse
    : null;
  const executionMeta = isRecord(providerResponse?.executionMeta)
    ? providerResponse.executionMeta
    : null;
  const referencePrice = isRecord(executionMeta?.referencePrice)
    ? executionMeta.referencePrice
    : null;
  return isRecord(referencePrice?.snapshot) ? referencePrice.snapshot : null;
}

function readPerpExecutionPrice(input: {
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>;
  snapshot: Record<string, unknown> | null;
}): number | null {
  const providerResponse = isRecord(
    input.latest?.latestAttempt?.providerResponse,
  )
    ? input.latest.latestAttempt.providerResponse
    : null;
  const executionMeta = isRecord(providerResponse?.executionMeta)
    ? providerResponse.executionMeta
    : null;
  const referencePrice = isRecord(executionMeta?.referencePrice)
    ? executionMeta.referencePrice
    : null;
  const executionPrice = Number(referencePrice?.executionPrice);
  if (Number.isFinite(executionPrice) && executionPrice > 0) {
    return executionPrice;
  }
  const markPrice = Number(input.snapshot?.markPrice);
  if (Number.isFinite(markPrice) && markPrice > 0) return markPrice;
  const oraclePrice = Number(input.snapshot?.oraclePrice);
  return Number.isFinite(oraclePrice) && oraclePrice > 0 ? oraclePrice : null;
}

function classifyPerpRisk(input: {
  leverage: number | null;
  liquidationBufferPct: number | null;
  freeCollateralQuote: number | null;
}): "low" | "warning" | "critical" {
  if (
    (input.freeCollateralQuote !== null && input.freeCollateralQuote < 0) ||
    (input.liquidationBufferPct !== null && input.liquidationBufferPct <= 5)
  ) {
    return "critical";
  }
  if (
    (input.liquidationBufferPct !== null && input.liquidationBufferPct <= 15) ||
    (input.leverage !== null && input.leverage >= 3)
  ) {
    return "warning";
  }
  return "low";
}

function applyPerpOrderToState(input: {
  currentSignedQuantityAtomic: bigint;
  currentCollateralAtomic: bigint;
  currentAverageEntryPrice: number | null;
  side: TerminalPerpOrderSide;
  quantityAtomic: bigint;
  collateralAtomic: bigint | null;
  executionPrice: number | null;
}): {
  signedQuantityAtomic: bigint;
  collateralAtomic: bigint;
  averageEntryPrice: number | null;
} {
  const currentQuantity = input.currentSignedQuantityAtomic;
  const currentAbs = absBigInt(currentQuantity);
  const quantityAtomic = absBigInt(input.quantityAtomic);
  const addCollateral = input.collateralAtomic ?? 0n;
  let nextQuantity = currentQuantity;
  let nextCollateral = input.currentCollateralAtomic;
  let nextAverageEntryPrice = input.currentAverageEntryPrice;

  const reduceCollateral = (closedAbs: bigint): void => {
    if (currentAbs <= 0n || nextCollateral <= 0n || closedAbs <= 0n) return;
    const remaining = currentAbs > closedAbs ? currentAbs - closedAbs : 0n;
    nextCollateral =
      remaining <= 0n ? 0n : (nextCollateral * remaining) / currentAbs;
  };

  const weightedAverage = (existingAbs: bigint, addedAbs: bigint): void => {
    if (
      input.executionPrice === null ||
      !Number.isFinite(input.executionPrice) ||
      input.executionPrice <= 0
    ) {
      return;
    }
    const existingWeight = Number(existingAbs);
    const addedWeight = Number(addedAbs);
    if (existingWeight <= 0 || nextAverageEntryPrice === null) {
      nextAverageEntryPrice = input.executionPrice;
      return;
    }
    nextAverageEntryPrice =
      (nextAverageEntryPrice * existingWeight +
        input.executionPrice * addedWeight) /
      (existingWeight + addedWeight);
  };

  if (input.side === "close_long") {
    if (currentQuantity <= 0n) {
      return {
        signedQuantityAtomic: currentQuantity,
        collateralAtomic: nextCollateral,
        averageEntryPrice: nextAverageEntryPrice,
      };
    }
    const closed = quantityAtomic >= currentAbs ? currentAbs : quantityAtomic;
    nextQuantity = currentQuantity - closed;
    reduceCollateral(closed);
    if (nextQuantity === 0n) nextAverageEntryPrice = null;
    return {
      signedQuantityAtomic: nextQuantity,
      collateralAtomic: nextCollateral,
      averageEntryPrice: nextAverageEntryPrice,
    };
  }

  if (input.side === "close_short") {
    if (currentQuantity >= 0n) {
      return {
        signedQuantityAtomic: currentQuantity,
        collateralAtomic: nextCollateral,
        averageEntryPrice: nextAverageEntryPrice,
      };
    }
    const closed = quantityAtomic >= currentAbs ? currentAbs : quantityAtomic;
    nextQuantity = currentQuantity + closed;
    reduceCollateral(closed);
    if (nextQuantity === 0n) nextAverageEntryPrice = null;
    return {
      signedQuantityAtomic: nextQuantity,
      collateralAtomic: nextCollateral,
      averageEntryPrice: nextAverageEntryPrice,
    };
  }

  if (input.side === "long") {
    if (currentQuantity >= 0n) {
      nextQuantity = currentQuantity + quantityAtomic;
      nextCollateral += addCollateral;
      weightedAverage(currentAbs, quantityAtomic);
    } else if (quantityAtomic < currentAbs) {
      nextQuantity = currentQuantity + quantityAtomic;
      reduceCollateral(quantityAtomic);
    } else if (quantityAtomic === currentAbs) {
      nextQuantity = 0n;
      nextCollateral = 0n;
      nextAverageEntryPrice = null;
    } else {
      const remainder = quantityAtomic - currentAbs;
      nextQuantity = remainder;
      nextCollateral = addCollateral;
      nextAverageEntryPrice = input.executionPrice;
    }
    return {
      signedQuantityAtomic: nextQuantity,
      collateralAtomic: nextCollateral,
      averageEntryPrice: nextAverageEntryPrice,
    };
  }

  if (currentQuantity <= 0n) {
    nextQuantity = currentQuantity - quantityAtomic;
    nextCollateral += addCollateral;
    weightedAverage(currentAbs, quantityAtomic);
  } else if (quantityAtomic < currentAbs) {
    nextQuantity = currentQuantity - quantityAtomic;
    reduceCollateral(quantityAtomic);
  } else if (quantityAtomic === currentAbs) {
    nextQuantity = 0n;
    nextCollateral = 0n;
    nextAverageEntryPrice = null;
  } else {
    const remainder = quantityAtomic - currentAbs;
    nextQuantity = -remainder;
    nextCollateral = addCollateral;
    nextAverageEntryPrice = input.executionPrice;
  }

  return {
    signedQuantityAtomic: nextQuantity,
    collateralAtomic: nextCollateral,
    averageEntryPrice: nextAverageEntryPrice,
  };
}

function buildTerminalPerpMarketView(input: {
  venueKey: "drift";
  contract: {
    marketName: string;
    marketIndex: number | null;
    oracle: string | null;
    oracleSource: string | null;
    status: string | null;
    contractType: string | null;
    initialMarginRatio: number | null;
    maintenanceMarginRatio: number | null;
  };
  funding: {
    fundingRate1hBps: number | null;
    oraclePrice: number | null;
    markPrice: number | null;
    sourceTs: string | null;
  } | null;
  swiftConfigured: boolean;
}): Record<string, unknown> {
  return {
    venueKey: input.venueKey,
    instrumentId: input.contract.marketName,
    instrumentLabel: input.contract.marketName,
    marketIndex: input.contract.marketIndex,
    oracle: input.contract.oracle,
    oracleSource: input.contract.oracleSource,
    status: input.contract.status,
    contractType: input.contract.contractType,
    initialMarginRatio: ratioToFraction(input.contract.initialMarginRatio),
    maintenanceMarginRatio: ratioToFraction(
      input.contract.maintenanceMarginRatio,
    ),
    fundingRate1hBps: input.funding?.fundingRate1hBps ?? null,
    oraclePrice: input.funding?.oraclePrice ?? null,
    markPrice: input.funding?.markPrice ?? null,
    sourceTs: input.funding?.sourceTs ?? null,
    swiftConfigured: input.swiftConfigured,
    routeSummary: input.swiftConfigured ? "Drift Swift" : "Drift Perps",
  };
}

function parseTerminalPerpOrderPayload(input: {
  payload: Record<string, unknown>;
  requireReason?: boolean;
}): {
  venueKey: "drift";
  instrumentId: string;
  instrumentLabel: string;
  side: TerminalPerpOrderSide;
  quantityAtomic: string;
  collateralAtomic: string | null;
  orderType: "market" | "limit" | "trigger";
  timeInForce: "gtc" | "ioc" | "fok";
  reduceOnly: boolean;
  limitPriceAtomic: string | null;
  triggerPriceAtomic: string | null;
  source: string;
  reason: string;
} {
  const venueKey =
    readTrimmedString(input.payload.venueKey)?.toLowerCase() ?? "drift";
  if (venueKey !== "drift") {
    throw new Error(`invalid-terminal-perp-venue:${venueKey}`);
  }
  const instrumentId = readTrimmedString(input.payload.instrumentId);
  const instrumentLabel =
    readTrimmedString(input.payload.instrumentLabel) ?? instrumentId;
  const side = parseTerminalPerpOrderSide(input.payload.side);
  const quantityAtomic = readTrimmedString(input.payload.quantityAtomic);
  const quantityAtomicValue = readAtomicBigInt(quantityAtomic);
  const collateralAtomic = readTrimmedString(input.payload.collateralAtomic);
  const orderType = parseTerminalPerpOrderType(input.payload.orderType);
  const timeInForce = parseTerminalPerpTimeInForce(input.payload.timeInForce);
  const limitPriceAtomic = readTrimmedString(input.payload.limitPriceAtomic);
  const triggerPriceAtomic = readTrimmedString(
    input.payload.triggerPriceAtomic,
  );
  const reduceOnly =
    input.payload.reduceOnly === true ||
    side === "close_long" ||
    side === "close_short";
  const source = readTrimmedString(input.payload.source) ?? "PERPS_TERMINAL";
  const reason =
    readTrimmedString(input.payload.reason) ??
    `${side ?? "perp"}:${instrumentId ?? "instrument"}`;
  if (
    !instrumentId ||
    !instrumentLabel ||
    !side ||
    !quantityAtomic ||
    quantityAtomicValue === null ||
    quantityAtomicValue <= 0n
  ) {
    throw new Error("invalid-terminal-perp-order");
  }
  if (
    (side === "long" || side === "short") &&
    (!collateralAtomic || readAtomicBigInt(collateralAtomic) === null)
  ) {
    throw new Error("invalid-terminal-perp-collateral");
  }
  if (collateralAtomic && readAtomicBigInt(collateralAtomic) === null) {
    throw new Error("invalid-terminal-perp-collateral");
  }
  if (
    orderType === "limit" &&
    (!limitPriceAtomic || readAtomicBigInt(limitPriceAtomic) === null)
  ) {
    throw new Error("invalid-terminal-perp-limit-price");
  }
  if (
    orderType === "trigger" &&
    (!triggerPriceAtomic || readAtomicBigInt(triggerPriceAtomic) === null)
  ) {
    throw new Error("invalid-terminal-perp-trigger-price");
  }
  if (input.requireReason && !reason) {
    throw new Error("invalid-terminal-perp-reason");
  }
  return {
    venueKey: "drift",
    instrumentId,
    instrumentLabel,
    side,
    quantityAtomic,
    collateralAtomic:
      side === "long" || side === "short" ? collateralAtomic : null,
    orderType,
    timeInForce,
    reduceOnly,
    limitPriceAtomic:
      orderType === "limit" && limitPriceAtomic ? limitPriceAtomic : null,
    triggerPriceAtomic:
      orderType === "trigger" && triggerPriceAtomic ? triggerPriceAtomic : null,
    source,
    reason,
  };
}

function parseTerminalPerpPositionHint(input: {
  value: unknown;
  instrumentId: string;
}): {
  signedQuantityAtomic: string;
  collateralAtomic: string;
  averageEntryPrice: number | null;
} | null {
  if (!isRecord(input.value)) return null;
  if (readTrimmedString(input.value.instrumentId) !== input.instrumentId) {
    return null;
  }
  const signedQuantityAtomic = readTrimmedString(
    input.value.signedQuantityAtomic,
  );
  const collateralAtomic = readTrimmedString(input.value.collateralAtomic);
  if (
    !signedQuantityAtomic ||
    readAtomicBigInt(signedQuantityAtomic) === null ||
    !collateralAtomic ||
    readAtomicBigInt(collateralAtomic) === null
  ) {
    return null;
  }
  const averageEntryPriceRaw = Number(input.value.averageEntryPrice);
  return {
    signedQuantityAtomic,
    collateralAtomic,
    averageEntryPrice:
      Number.isFinite(averageEntryPriceRaw) && averageEntryPriceRaw > 0
        ? averageEntryPriceRaw
        : null,
  };
}

async function listTerminalPerpMarkets(input: {
  env: Env;
  venueKey: "drift";
  limit: number;
}): Promise<Record<string, unknown>[]> {
  const drift = new DriftClient(input.env);
  const contracts = (await drift.listContracts())
    .filter((contract) => {
      const contractType = readTrimmedString(
        contract.contractType,
      )?.toLowerCase();
      return contractType === null || contractType === "perp";
    })
    .sort((a, b) => a.marketName.localeCompare(b.marketName))
    .slice(0, input.limit);
  return await Promise.all(
    contracts.map(async (contract) =>
      buildTerminalPerpMarketView({
        venueKey: input.venueKey,
        contract,
        funding:
          (
            await drift.getFundingRates(contract.marketName).catch(() => [])
          )[0] ?? null,
        swiftConfigured: drift.swiftConfigured(),
      }),
    ),
  );
}

async function listTerminalPerpRequestsForActor(input: {
  env: Env;
  actorId: string;
}): Promise<ExecutionRequestRecord[]> {
  const requests: ExecutionRequestRecord[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const page = await listExecutionRequestsByActor(input.env.WAITLIST_DB, {
      actorId: input.actorId,
      mode: "privy_execute",
      limit: pageSize,
      offset,
    });
    requests.push(...page);
    if (page.length < pageSize) break;
  }
  return requests;
}

function isSuccessfulTerminalPerpRequest(
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>,
): boolean {
  const terminalStatus = readTrimmedString(
    latest?.receipt?.finalizedStatus ?? latest?.request.status,
  )?.toLowerCase();
  return terminalStatus === "landed" || terminalStatus === "finalized";
}

async function listTerminalPerpPositionsForActor(input: {
  env: Env;
  actorId: string;
}): Promise<TerminalPerpPositionView[]> {
  const requests = (await listTerminalPerpRequestsForActor(input))
    .filter((entry) => {
      const intent = isRecord(entry.metadata?.intent)
        ? entry.metadata.intent
        : null;
      return (
        readTrimmedString(intent?.family) === "perp_order" &&
        readTrimmedString(intent?.venueKey)?.toLowerCase() === "drift"
      );
    })
    .sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));

  const groups = new Map<
    string,
    {
      key: string;
      instrumentId: string;
      instrumentLabel: string;
      signedQuantityAtomic: bigint;
      collateralAtomic: bigint;
      averageEntryPrice: number | null;
      markPrice: number | null;
      oraclePrice: number | null;
      fundingRate1hBps: number | null;
      initialMarginRatio: number | null;
      maintenanceMarginRatio: number | null;
      oracle: string | null;
      oracleSource: string | null;
      lastRequestId: string | null;
      lastUpdatedAt: string | null;
      notes: string[];
    }
  >();

  for (const request of requests) {
    const latest = await getExecutionLatestStatus(
      input.env.WAITLIST_DB,
      request.requestId,
    );
    if (!latest || !isSuccessfulTerminalPerpRequest(latest)) continue;
    const intent = isRecord(latest.request.metadata?.intent)
      ? latest.request.metadata.intent
      : null;
    const instrumentId = readTrimmedString(intent?.instrumentId);
    const instrumentLabel =
      readTrimmedString(intent?.instrumentLabel) ?? instrumentId;
    const side = parseTerminalPerpOrderSide(intent?.side);
    const quantityAtomic = readAtomicBigInt(intent?.quantityAtomic);
    if (!instrumentId || !instrumentLabel || !side || quantityAtomic === null) {
      continue;
    }
    const snapshot = readPerpReferenceSnapshot(latest);
    const executionPrice = readPerpExecutionPrice({ latest, snapshot });
    const key = `drift:${instrumentId}`;
    const group = groups.get(key) ?? {
      key,
      instrumentId,
      instrumentLabel,
      signedQuantityAtomic: 0n,
      collateralAtomic: 0n,
      averageEntryPrice: null,
      markPrice: null,
      oraclePrice: null,
      fundingRate1hBps: null,
      initialMarginRatio: null,
      maintenanceMarginRatio: null,
      oracle: null,
      oracleSource: null,
      lastRequestId: null,
      lastUpdatedAt: null,
      notes: [],
    };

    const applied = applyPerpOrderToState({
      currentSignedQuantityAtomic: group.signedQuantityAtomic,
      currentCollateralAtomic: group.collateralAtomic,
      currentAverageEntryPrice: group.averageEntryPrice,
      side,
      quantityAtomic,
      collateralAtomic: readAtomicBigInt(intent?.collateralAtomic),
      executionPrice,
    });

    group.signedQuantityAtomic = applied.signedQuantityAtomic;
    group.collateralAtomic = applied.collateralAtomic;
    group.averageEntryPrice = applied.averageEntryPrice;
    group.markPrice = roundFiniteNumber(Number(snapshot?.markPrice));
    group.oraclePrice = roundFiniteNumber(Number(snapshot?.oraclePrice));
    group.fundingRate1hBps = roundFiniteNumber(
      Number(snapshot?.fundingRate1hBps),
      4,
    );
    group.initialMarginRatio =
      ratioToFraction(snapshot?.initialMarginRatio) ?? group.initialMarginRatio;
    group.maintenanceMarginRatio =
      ratioToFraction(snapshot?.maintenanceMarginRatio) ??
      group.maintenanceMarginRatio;
    group.oracle = readTrimmedString(snapshot?.oracle) ?? group.oracle;
    group.oracleSource =
      readTrimmedString(snapshot?.oracleSource) ?? group.oracleSource;
    group.lastRequestId = latest.request.requestId;
    group.lastUpdatedAt =
      latest.request.updatedAt ??
      latest.request.receivedAt ??
      group.lastUpdatedAt;
    const lifecycleNotes =
      readStringArray(readPersistedExecutionLifecycle({ latest })?.notes) ?? [];
    group.notes = Array.from(new Set([...group.notes, ...lifecycleNotes]));
    groups.set(key, group);
  }

  const positions: TerminalPerpPositionView[] = [];
  for (const group of groups.values()) {
    const absoluteQuantityAtomic = absBigInt(group.signedQuantityAtomic);
    const absoluteQuantityUi = atomicToDecimalNumber(
      absoluteQuantityAtomic.toString(),
      TERMINAL_PERP_QUANTITY_DECIMALS,
    );
    const collateralQuote = atomicToDecimalNumber(
      group.collateralAtomic.toString(),
      TERMINAL_PERP_COLLATERAL_DECIMALS,
    );
    const markPrice =
      group.markPrice !== null && Number.isFinite(group.markPrice)
        ? group.markPrice
        : null;
    const notionalQuote =
      absoluteQuantityUi !== null && markPrice !== null
        ? roundFiniteNumber(absoluteQuantityUi * markPrice, 4)
        : null;
    const signedQuantityUiNumber =
      absoluteQuantityUi === null
        ? null
        : group.signedQuantityAtomic < 0n
          ? -absoluteQuantityUi
          : absoluteQuantityUi;
    const unrealizedPnlQuote =
      signedQuantityUiNumber !== null &&
      markPrice !== null &&
      group.averageEntryPrice !== null
        ? roundFiniteNumber(
            (markPrice - group.averageEntryPrice) * signedQuantityUiNumber,
            4,
          )
        : null;
    const equityQuote =
      collateralQuote !== null
        ? roundFiniteNumber(collateralQuote + (unrealizedPnlQuote ?? 0), 4)
        : unrealizedPnlQuote;
    const usedMarginQuote =
      notionalQuote !== null && group.initialMarginRatio !== null
        ? roundFiniteNumber(notionalQuote * group.initialMarginRatio, 4)
        : null;
    const maintenanceRequirementQuote =
      notionalQuote !== null && group.maintenanceMarginRatio !== null
        ? roundFiniteNumber(notionalQuote * group.maintenanceMarginRatio, 4)
        : null;
    const freeCollateralQuote =
      equityQuote !== null && usedMarginQuote !== null
        ? roundFiniteNumber(equityQuote - usedMarginQuote, 4)
        : null;
    const leverage =
      notionalQuote !== null &&
      equityQuote !== null &&
      equityQuote > 0 &&
      Number.isFinite(equityQuote)
        ? roundFiniteNumber(notionalQuote / equityQuote, 4)
        : null;
    const liquidationBufferPct =
      equityQuote !== null &&
      maintenanceRequirementQuote !== null &&
      equityQuote > 0 &&
      Number.isFinite(equityQuote)
        ? roundFiniteNumber(
            ((equityQuote - maintenanceRequirementQuote) / equityQuote) * 100,
            2,
          )
        : null;
    const riskLevel = classifyPerpRisk({
      leverage,
      liquidationBufferPct,
      freeCollateralQuote,
    });
    positions.push({
      key: group.key,
      venueKey: "drift",
      instrumentId: group.instrumentId,
      instrumentLabel: group.instrumentLabel,
      side:
        group.signedQuantityAtomic > 0n
          ? "long"
          : group.signedQuantityAtomic < 0n
            ? "short"
            : "flat",
      positionState: group.signedQuantityAtomic === 0n ? "closed" : "open",
      signedQuantityAtomic: group.signedQuantityAtomic.toString(),
      signedQuantityUi: bigintToSignedDisplay(
        group.signedQuantityAtomic,
        TERMINAL_PERP_QUANTITY_DECIMALS,
      ),
      absoluteQuantityUi: formatAtomicDisplay(
        absoluteQuantityAtomic,
        TERMINAL_PERP_QUANTITY_DECIMALS,
      ),
      averageEntryPrice: roundFiniteNumber(group.averageEntryPrice, 4),
      markPrice,
      oraclePrice: group.oraclePrice,
      fundingRate1hBps: group.fundingRate1hBps,
      collateralAtomic: group.collateralAtomic.toString(),
      collateralUi: formatAtomicDisplay(
        group.collateralAtomic,
        TERMINAL_PERP_COLLATERAL_DECIMALS,
      ),
      notionalQuote,
      unrealizedPnlQuote,
      leverage,
      equityQuote,
      usedMarginQuote,
      maintenanceRequirementQuote,
      freeCollateralQuote,
      initialMarginRatio: group.initialMarginRatio,
      maintenanceMarginRatio: group.maintenanceMarginRatio,
      liquidationBufferPct,
      riskLevel,
      oracle: group.oracle,
      oracleSource: group.oracleSource,
      lastRequestId: group.lastRequestId,
      lastUpdatedAt: group.lastUpdatedAt,
      notes: group.notes,
    });
  }

  return positions.sort((a, b) =>
    String(b.lastUpdatedAt ?? "").localeCompare(String(a.lastUpdatedAt ?? "")),
  );
}

async function previewTerminalPerpOrder(input: {
  env: Env;
  actorId: string;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const parsed = parseTerminalPerpOrderPayload({
    payload: input.payload,
  });
  const drift = new DriftClient(input.env);
  const preview = await drift.describePerpIntent({
    instrumentId: parsed.instrumentId,
    side: parsed.side,
    quantityAtomic: parsed.quantityAtomic,
    collateralAtomic: parsed.collateralAtomic,
    options: {
      orderType: parsed.orderType,
      timeInForce: parsed.timeInForce,
      reduceOnly: parsed.reduceOnly,
      ...(parsed.limitPriceAtomic
        ? { limitPriceAtomic: parsed.limitPriceAtomic }
        : {}),
      ...(parsed.triggerPriceAtomic
        ? { triggerPriceAtomic: parsed.triggerPriceAtomic }
        : {}),
    },
    executionAdapter: "drift",
  });
  const currentPositionHint = parseTerminalPerpPositionHint({
    value: input.payload.currentPosition,
    instrumentId: parsed.instrumentId,
  });
  const currentPosition =
    currentPositionHint ??
    (
      await listTerminalPerpPositionsForActor({
        env: input.env,
        actorId: input.actorId,
      })
    ).find((position) => position.instrumentId === parsed.instrumentId) ??
    null;
  const projected = applyPerpOrderToState({
    currentSignedQuantityAtomic:
      readAtomicBigInt(currentPosition?.signedQuantityAtomic) ?? 0n,
    currentCollateralAtomic:
      readAtomicBigInt(currentPosition?.collateralAtomic) ?? 0n,
    currentAverageEntryPrice: currentPosition?.averageEntryPrice ?? null,
    side: parsed.side,
    quantityAtomic: readAtomicBigInt(parsed.quantityAtomic) ?? 0n,
    collateralAtomic: readAtomicBigInt(parsed.collateralAtomic),
    executionPrice:
      preview.funding?.markPrice ?? preview.funding?.oraclePrice ?? null,
  });
  const projectedAbsQuantity = absBigInt(projected.signedQuantityAtomic);
  const projectedQuantityUi = atomicToDecimalNumber(
    projectedAbsQuantity.toString(),
    TERMINAL_PERP_QUANTITY_DECIMALS,
  );
  const markPrice =
    preview.funding?.markPrice ?? preview.funding?.oraclePrice ?? null;
  const projectedCollateralQuote = atomicToDecimalNumber(
    projected.collateralAtomic.toString(),
    TERMINAL_PERP_COLLATERAL_DECIMALS,
  );
  const initialMarginRatio = ratioToFraction(
    preview.instrument.initialMarginRatio,
  );
  const maintenanceMarginRatio = ratioToFraction(
    preview.instrument.maintenanceMarginRatio,
  );
  const projectedNotionalQuote =
    projectedQuantityUi !== null && markPrice !== null
      ? roundFiniteNumber(projectedQuantityUi * markPrice, 4)
      : null;
  const requiredInitialMarginQuote =
    projectedNotionalQuote !== null && initialMarginRatio !== null
      ? roundFiniteNumber(projectedNotionalQuote * initialMarginRatio, 4)
      : null;
  const requiredMaintenanceQuote =
    projectedNotionalQuote !== null && maintenanceMarginRatio !== null
      ? roundFiniteNumber(projectedNotionalQuote * maintenanceMarginRatio, 4)
      : null;
  const projectedLeverage =
    projectedNotionalQuote !== null &&
    projectedCollateralQuote !== null &&
    projectedCollateralQuote > 0
      ? roundFiniteNumber(projectedNotionalQuote / projectedCollateralQuote, 4)
      : null;
  const projectedLiquidationBufferPct =
    projectedCollateralQuote !== null &&
    requiredMaintenanceQuote !== null &&
    projectedCollateralQuote > 0
      ? roundFiniteNumber(
          ((projectedCollateralQuote - requiredMaintenanceQuote) /
            projectedCollateralQuote) *
            100,
          2,
        )
      : null;
  const projectedRiskLevel = classifyPerpRisk({
    leverage: projectedLeverage,
    liquidationBufferPct: projectedLiquidationBufferPct,
    freeCollateralQuote:
      projectedCollateralQuote !== null && requiredInitialMarginQuote !== null
        ? projectedCollateralQuote - requiredInitialMarginQuote
        : null,
  });

  return {
    venueKey: parsed.venueKey,
    provider: preview.swiftSupported ? "drift_swift" : "drift",
    instrumentId: parsed.instrumentId,
    instrumentLabel: parsed.instrumentLabel,
    side: parsed.side,
    orderType: parsed.orderType,
    timeInForce: parsed.timeInForce,
    reduceOnly: preview.reduceOnly,
    quantityAtomic: parsed.quantityAtomic,
    quantityUi: formatAtomicDisplay(
      parsed.quantityAtomic,
      TERMINAL_PERP_QUANTITY_DECIMALS,
    ),
    collateralAtomic: parsed.collateralAtomic,
    collateralUi: parsed.collateralAtomic
      ? formatAtomicDisplay(
          parsed.collateralAtomic,
          TERMINAL_PERP_COLLATERAL_DECIMALS,
        )
      : null,
    limitPriceAtomic: parsed.limitPriceAtomic,
    triggerPriceAtomic: parsed.triggerPriceAtomic,
    markPrice: preview.funding?.markPrice ?? null,
    oraclePrice: preview.funding?.oraclePrice ?? null,
    oracle: preview.instrument.oracle,
    oracleSource: preview.instrument.oracleSource,
    fundingRate1hBps: preview.funding?.fundingRate1hBps ?? null,
    initialMarginRatio,
    maintenanceMarginRatio,
    swiftSupported: preview.swiftSupported,
    currentSignedQuantityAtomic: currentPosition?.signedQuantityAtomic ?? "0",
    currentSignedQuantityUi: currentPosition?.signedQuantityUi ?? "0.0",
    currentCollateralAtomic: currentPosition?.collateralAtomic ?? "0",
    currentCollateralUi: currentPosition?.collateralUi ?? "0.0",
    currentAverageEntryPrice: currentPosition?.averageEntryPrice ?? null,
    projectedSignedQuantityAtomic: projected.signedQuantityAtomic.toString(),
    projectedSignedQuantityUi: bigintToSignedDisplay(
      projected.signedQuantityAtomic,
      TERMINAL_PERP_QUANTITY_DECIMALS,
    ),
    projectedCollateralAtomic: projected.collateralAtomic.toString(),
    projectedCollateralUi: formatAtomicDisplay(
      projected.collateralAtomic,
      TERMINAL_PERP_COLLATERAL_DECIMALS,
    ),
    projectedNotionalQuote,
    requiredInitialMarginQuote,
    requiredMaintenanceQuote,
    projectedLeverage,
    projectedLiquidationBufferPct,
    projectedRiskLevel,
    routeSummary: preview.swiftSupported ? "Drift Swift" : "Drift Perps",
    notes: Array.from(
      new Set([
        `${parsed.orderType.toUpperCase()} ${parsed.timeInForce.toUpperCase()}`,
        parsed.reduceOnly ? "reduce-only" : "exposure-expanding",
        "paper-mode only",
      ]),
    ),
  };
}

function buildTerminalPerpRequestSummary(
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>,
): Record<string, unknown> | null {
  if (!latest) return null;
  const intent = isRecord(latest.request.metadata?.intent)
    ? latest.request.metadata.intent
    : null;
  if (
    readTrimmedString(intent?.family) !== "perp_order" ||
    readTrimmedString(intent?.venueKey)?.toLowerCase() !== "drift"
  ) {
    return null;
  }
  const snapshot = readPerpReferenceSnapshot(latest);
  return {
    requestId: latest.request.requestId,
    status: latest.request.status,
    terminal: Boolean(latest.request.terminalAt),
    updatedAt: latest.request.updatedAt ?? latest.request.receivedAt,
    receiptId: latest.receipt?.receiptId ?? null,
    provider:
      latest.receipt?.provider ?? latest.latestAttempt?.provider ?? "drift",
    instrumentId: readTrimmedString(intent?.instrumentId),
    instrumentLabel:
      readTrimmedString(intent?.instrumentLabel) ??
      readTrimmedString(intent?.instrumentId),
    side: parseTerminalPerpOrderSide(intent?.side),
    quantityAtomic: readTrimmedString(intent?.quantityAtomic),
    collateralAtomic: readTrimmedString(intent?.collateralAtomic),
    markPrice: roundFiniteNumber(Number(snapshot?.markPrice), 4),
    oraclePrice: roundFiniteNumber(Number(snapshot?.oraclePrice), 4),
    fundingRate1hBps: roundFiniteNumber(Number(snapshot?.fundingRate1hBps), 4),
  };
}

async function submitTerminalPerpOrder(input: {
  request: Request;
  env: Env;
  user: UserRow;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const parsed = parseTerminalPerpOrderPayload({
    payload: input.payload,
    requireReason: true,
  });
  const requestPayload = {
    schemaVersion: "v2",
    mode: "privy_execute",
    lane: "safe",
    metadata: {
      source: parsed.source,
      reason: parsed.reason,
    },
    privyExecute: {
      wallet: input.user.walletAddress,
      intent: {
        family: "perp_order",
        venueKey: parsed.venueKey,
        marketType: "perp",
        instrumentId: parsed.instrumentId,
        instrumentLabel: parsed.instrumentLabel,
        side: parsed.side,
        quantityAtomic: parsed.quantityAtomic,
        ...(parsed.collateralAtomic
          ? { collateralAtomic: parsed.collateralAtomic }
          : {}),
      },
      options: {
        orderType: parsed.orderType,
        timeInForce: parsed.timeInForce,
        reduceOnly: parsed.reduceOnly,
        ...(parsed.limitPriceAtomic
          ? { limitPriceAtomic: parsed.limitPriceAtomic }
          : {}),
        ...(parsed.triggerPriceAtomic
          ? { triggerPriceAtomic: parsed.triggerPriceAtomic }
          : {}),
      },
    },
  };
  const payloadHash = await hashExecutionSubmitPayload(requestPayload);
  const idempotencyKey =
    readIdempotencyKey(input.request) ?? `perp-${crypto.randomUUID()}`;
  const metadata = {
    source: parsed.source,
    reason: parsed.reason,
    intent: {
      family: "perp_order",
      marketType: "perp",
      venueKey: parsed.venueKey,
      instrumentId: parsed.instrumentId,
      instrumentLabel: parsed.instrumentLabel,
      side: parsed.side,
      quantityAtomic: parsed.quantityAtomic,
      ...(parsed.collateralAtomic
        ? { collateralAtomic: parsed.collateralAtomic }
        : {}),
    },
    terminal: {
      workflow: "perps",
      executionMode: "paper",
    },
  } as const;
  const reservation = await reserveExecutionSubmitRequest({
    db: input.env.WAITLIST_DB,
    requestId: newExecRequestId(),
    idempotencyKey,
    actorType: "privy_user",
    actorId: input.user.id,
    mode: "privy_execute",
    lane: "safe",
    payloadHash,
    metadata,
  });
  if (reservation.result === "conflict") {
    throw new Error(reservation.error);
  }
  if (reservation.result === "replay") {
    const latest = await getExecutionLatestStatus(
      input.env.WAITLIST_DB,
      reservation.request.requestId,
    );
    return (
      buildTerminalPerpRequestSummary(latest) ?? {
        requestId: reservation.request.requestId,
        status: reservation.request.status,
        terminal: Boolean(reservation.request.terminalAt),
      }
    );
  }

  await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "received",
    reason: null,
    details: null,
  });
  await updateExecutionRequestStatus(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "validated",
    statusReason: null,
  });
  await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "validated",
    reason: null,
    details: null,
  });

  const rpcEndpoint = String(input.env.RPC_ENDPOINT ?? "").trim();
  if (!rpcEndpoint) {
    throw new Error("rpc-endpoint-missing");
  }

  const attemptId = newExecutionAttemptId();
  const attemptStartedAt = new Date().toISOString();
  const quality = {
    lane: "safe",
    orderType: parsed.orderType,
    timeInForce: parsed.timeInForce,
    reduceOnly: parsed.reduceOnly,
    limitPriceAtomic: parsed.limitPriceAtomic,
    triggerPriceAtomic: parsed.triggerPriceAtomic,
  };
  await updateExecutionRequestStatus(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "dispatched",
    statusReason: null,
  });
  await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "dispatched",
    reason: null,
    details: {
      provider: "drift",
      attempt: 1,
    },
    createdAt: attemptStartedAt,
  });
  await createExecutionAttemptIdempotent(input.env.WAITLIST_DB, {
    attemptId,
    requestId: reservation.request.requestId,
    attemptNo: 1,
    lane: "safe",
    provider: "drift",
    status: "dispatched",
    providerResponse: {
      route: "drift",
      lane: "safe",
      mode: "privy_execute",
      quality,
    },
    startedAt: attemptStartedAt,
  });

  try {
    const drift = new DriftClient(input.env);
    const route = drift.swiftConfigured() ? "drift_swift" : "drift";
    const rpc = new SolanaRpc(rpcEndpoint);
    const jupiter = new JupiterClient(
      String(input.env.JUPITER_BASE_URL ?? "").trim() ||
        X402_READ_JUPITER_BASE_URL,
      input.env.JUPITER_API_KEY,
    );
    const result = await executeIntentViaRouter({
      env: input.env,
      venueKey: parsed.venueKey,
      runtimeMode: "paper",
      requireVenueRouting: true,
      execution: {
        adapter: route,
        params: quality,
      },
      policy: normalizePolicy({
        allowedMints: [USDC_MINT],
        commitment: "confirmed",
      }),
      rpc,
      jupiter,
      drift,
      intent: {
        family: "perp_order",
        wallet: input.user.walletAddress,
        venueKey: parsed.venueKey,
        marketType: "perp",
        instrumentId: parsed.instrumentId,
        side: parsed.side,
        quantityAtomic: parsed.quantityAtomic,
        ...(parsed.collateralAtomic
          ? { collateralAtomic: parsed.collateralAtomic }
          : {}),
        params: {
          orderType: parsed.orderType,
          timeInForce: parsed.timeInForce,
          reduceOnly: parsed.reduceOnly,
          ...(parsed.limitPriceAtomic
            ? { limitPriceAtomic: parsed.limitPriceAtomic }
            : {}),
          ...(parsed.triggerPriceAtomic
            ? { triggerPriceAtomic: parsed.triggerPriceAtomic }
            : {}),
        },
      },
      privyWalletId: input.user.privyWalletId ?? undefined,
      log(level, message, meta) {
        console[level]("terminal.perps.submit", {
          requestId: reservation.request.requestId,
          message,
          ...(meta ?? {}),
        });
      },
    });
    const completedAt = new Date().toISOString();
    const provider = readTrimmedString(result.executionMeta?.route) ?? route;
    const providerResponse = {
      route: provider,
      lane: "safe",
      mode: "privy_execute",
      quality,
      executionMeta:
        result.executionMeta &&
        typeof result.executionMeta === "object" &&
        !Array.isArray(result.executionMeta)
          ? result.executionMeta
          : null,
      perpOrder: {
        instrumentId: parsed.instrumentId,
        instrumentLabel: parsed.instrumentLabel,
        side: parsed.side,
        quantityAtomic: parsed.quantityAtomic,
        collateralAtomic: parsed.collateralAtomic,
      },
    };
    await finalizeExecutionAttempt(input.env.WAITLIST_DB, {
      attemptId,
      status: result.status,
      providerResponse,
      errorCode: null,
      errorMessage: null,
      completedAt,
    });
    const receiptId = newExecutionReceiptId();
    await upsertExecutionReceiptIdempotent(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      receiptId,
      finalizedStatus: "finalized",
      lane: "safe",
      provider,
      signature: result.signature,
      slot: null,
      errorCode: null,
      errorMessage: null,
      receipt: {
        mode: "privy_execute",
        route: provider,
        resultStatus: result.status,
        outcome: "finalized",
        lifecycle: {
          ...(result.executionMeta?.lifecycle ?? {}),
          fillState: "filled",
          settlementState: "confirmed",
        },
        quality,
        perp: {
          instrumentId: parsed.instrumentId,
          instrumentLabel: parsed.instrumentLabel,
          side: parsed.side,
          quantityAtomic: parsed.quantityAtomic,
          collateralAtomic: parsed.collateralAtomic,
        },
        quote: {
          inputMint: USDC_MINT,
          outputMint: parsed.instrumentId,
          inAmount:
            parsed.collateralAtomic ??
            readTrimmedString(result.usedQuote.inAmount) ??
            "0",
          outAmount:
            readTrimmedString(result.usedQuote.outAmount) ??
            parsed.quantityAtomic,
        },
      },
      readyAt: completedAt,
    });
    await terminalizeExecutionRequest(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      status: "landed",
      statusReason: null,
      details: {
        provider,
        attempt: 1,
      },
      nowIso: completedAt,
    });
    await updateExecutionRequestStatus(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      status: "finalized",
      statusReason: null,
      nowIso: completedAt,
    });
    await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      status: "finalized",
      reason: null,
      details: {
        provider,
        attempt: 1,
      },
      createdAt: completedAt,
    });
    const latest = await getExecutionLatestStatus(
      input.env.WAITLIST_DB,
      reservation.request.requestId,
    );
    return (
      buildTerminalPerpRequestSummary(latest) ?? {
        requestId: reservation.request.requestId,
        status: "finalized",
        terminal: true,
        receiptId,
        provider,
      }
    );
  } catch (error) {
    const failedAt = new Date().toISOString();
    const deniedReason = policyDeniedReason(error);
    const terminalStatus = deniedReason ? "rejected" : "failed";
    const errorCode = deniedReason
      ? "policy-denied"
      : normalizeExecutionErrorCode({
          error,
          fallback: "submission-failed",
        });
    const errorMessage =
      executionErrorMessage(error) ?? "terminal-perp-submit-failed";
    await finalizeExecutionAttempt(input.env.WAITLIST_DB, {
      attemptId,
      status: terminalStatus,
      providerResponse: {
        route: "drift",
        lane: "safe",
        mode: "privy_execute",
        quality,
      },
      errorCode,
      errorMessage,
      completedAt: failedAt,
    });
    await upsertExecutionReceiptIdempotent(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      receiptId: newExecutionReceiptId(),
      finalizedStatus: terminalStatus,
      lane: "safe",
      provider: "drift",
      signature: null,
      slot: null,
      errorCode,
      errorMessage,
      receipt: {
        mode: "privy_execute",
        route: "drift",
        outcome: terminalStatus,
        lifecycle: {
          positionState: "closed",
          settlementState: "failed",
          notes: [errorMessage],
        },
        quality,
      },
      readyAt: failedAt,
    });
    await terminalizeExecutionRequest(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      status: terminalStatus,
      statusReason: errorCode,
      details: {
        provider: "drift",
        attempt: 1,
        errorMessage,
      },
      nowIso: failedAt,
    });
    throw error instanceof Error ? error : new Error(errorCode);
  }
}

const TERMINAL_PREDICTION_DECIMALS = 6;

type TerminalPredictionOrderSide =
  | "buy_yes"
  | "buy_no"
  | "sell_yes"
  | "sell_no";

type TerminalPredictionPositionView = {
  key: string;
  venueKey: "dflow";
  instrumentId: string;
  instrumentLabel: string;
  outcomeMint: string;
  outcomeSide: "yes" | "no" | null;
  netQuantityAtomic: string;
  grossBoughtQuantityAtomic: string;
  netQuantityUi: string;
  grossBoughtQuantityUi: string;
  averageEntryPrice: number | null;
  lastPriceQuote: number | null;
  marketStatus: string | null;
  marketResolved: boolean;
  result: string | null;
  settleTime: string | null;
  settlementMint: string | null;
  redemptionStatus: string | null;
  canSettle: boolean;
  expectedPayoutAtomic: string | null;
  expectedPayoutUi: string | null;
  positionState: "open" | "closed";
  settlementState: string;
  lastRequestId: string | null;
  lastUpdatedAt: string | null;
  notes: string[];
};

function parseTerminalPredictionOrderSide(
  value: unknown,
): TerminalPredictionOrderSide | null {
  const normalized = readTrimmedString(value)?.toLowerCase();
  if (
    normalized === "buy_yes" ||
    normalized === "buy_no" ||
    normalized === "sell_yes" ||
    normalized === "sell_no"
  ) {
    return normalized;
  }
  return null;
}

function parseTerminalPredictionOrderType(value: unknown): "market" | "limit" {
  return readTrimmedString(value)?.toLowerCase() === "limit"
    ? "limit"
    : "market";
}

function parseTerminalPredictionTimeInForce(
  value: unknown,
): "gtc" | "ioc" | "fok" {
  const normalized = readTrimmedString(value)?.toLowerCase();
  if (normalized === "ioc" || normalized === "fok") return normalized;
  return "gtc";
}

function parseTerminalPredictionQuantityMode(
  value: unknown,
): "base" | "quote" | "notional" {
  const normalized = readTrimmedString(value)?.toLowerCase();
  if (normalized === "quote" || normalized === "notional") {
    return normalized;
  }
  return "base";
}

function atomicToDecimalNumber(
  atomicInput: string | null,
  decimals: number,
): number | null {
  const normalized = readTrimmedString(atomicInput);
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  const safeDecimals = Math.max(0, Math.min(18, Math.floor(decimals)));
  const padded =
    safeDecimals > 0 ? normalized.padStart(safeDecimals + 1, "0") : normalized;
  const whole =
    safeDecimals > 0 ? padded.slice(0, -safeDecimals) || "0" : padded;
  const fraction =
    safeDecimals > 0 ? padded.slice(-safeDecimals).replace(/0+$/, "") : "";
  const parsed = Number(fraction ? `${whole}.${fraction}` : whole);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePredictionOutcomeSide(value: unknown): "yes" | "no" | null {
  const normalized = readTrimmedString(value)?.toLowerCase();
  if (normalized === "yes" || normalized === "no") return normalized;
  return null;
}

function normalizePredictionResult(value: unknown): "yes" | "no" | null {
  const normalized = readTrimmedString(value)?.toLowerCase();
  if (normalized === "yes" || normalized === "no") return normalized;
  return null;
}

function predictionOutcomeSideFromOrderSide(
  side: TerminalPredictionOrderSide,
): "yes" | "no" {
  return side.endsWith("_yes") ? "yes" : "no";
}

function isPredictionMarketResolved(input: {
  status?: string | null;
  result?: string | null;
  redemptionStatus?: string | null;
}): boolean {
  if (normalizePredictionResult(input.result)) return true;
  const redemption = readTrimmedString(input.redemptionStatus)?.toLowerCase();
  if (redemption === "redeemable" || redemption === "ready") {
    return true;
  }
  const status = readTrimmedString(input.status)?.toLowerCase();
  return Boolean(
    status &&
      status !== "open" &&
      status !== "active" &&
      status !== "live" &&
      status !== "trading",
  );
}

function buildTerminalPredictionMarketView(input: {
  venueKey: "dflow";
  market: {
    marketId: string;
    title: string;
    eventTitle: string | null;
    status: string | null;
    result?: string | null;
    endTime: string | null;
    settleTime: string | null;
    accounts: Array<{
      accountId: string | null;
      yesMint: string | null;
      noMint: string | null;
      settlementMint: string | null;
      scalarOutcomePct?: number | null;
      yesBid: number | null;
      yesAsk: number | null;
      noBid: number | null;
      noAsk: number | null;
      volume: number | null;
      openInterest: number | null;
      redemptionStatus: string | null;
      status: string | null;
    }>;
  };
}): Record<string, unknown> {
  const primaryAccount = input.market.accounts[0] ?? null;
  return {
    venueKey: input.venueKey,
    marketId: input.market.marketId,
    title: input.market.title,
    eventTitle: input.market.eventTitle,
    status: input.market.status,
    result: input.market.result ?? null,
    endTime: input.market.endTime,
    settleTime: input.market.settleTime,
    accountId: primaryAccount?.accountId ?? null,
    settlementMint: primaryAccount?.settlementMint ?? null,
    yesMint: primaryAccount?.yesMint ?? null,
    noMint: primaryAccount?.noMint ?? null,
    scalarOutcomePct: primaryAccount?.scalarOutcomePct ?? null,
    yesBid: primaryAccount?.yesBid ?? null,
    yesAsk: primaryAccount?.yesAsk ?? null,
    noBid: primaryAccount?.noBid ?? null,
    noAsk: primaryAccount?.noAsk ?? null,
    volume: primaryAccount?.volume ?? null,
    openInterest: primaryAccount?.openInterest ?? null,
    redemptionStatus: primaryAccount?.redemptionStatus ?? null,
    accountStatus: primaryAccount?.status ?? null,
    resolved: isPredictionMarketResolved({
      status: input.market.status,
      result: input.market.result ?? null,
      redemptionStatus: primaryAccount?.redemptionStatus ?? null,
    }),
  };
}

function buildTerminalPredictionPositionKey(input: {
  venueKey: string;
  instrumentId: string;
  outcomeMint: string;
}): string {
  return `${input.venueKey}:${input.instrumentId}:${input.outcomeMint}`;
}

function readPredictionReferenceSnapshot(
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>,
): Record<string, unknown> | null {
  const providerResponse = isRecord(latest?.latestAttempt?.providerResponse)
    ? latest.latestAttempt.providerResponse
    : null;
  const executionMeta = isRecord(providerResponse?.executionMeta)
    ? providerResponse.executionMeta
    : null;
  const referencePrice = isRecord(executionMeta?.referencePrice)
    ? executionMeta.referencePrice
    : null;
  return isRecord(referencePrice?.snapshot) ? referencePrice.snapshot : null;
}

function parseTerminalPredictionOrderPayload(input: {
  payload: Record<string, unknown>;
  requireReason?: boolean;
}): {
  venueKey: "dflow";
  instrumentId: string;
  instrumentLabel: string;
  outcomeId: string;
  side: TerminalPredictionOrderSide;
  quantityAtomic: string;
  orderType: "market" | "limit";
  timeInForce: "gtc" | "ioc" | "fok";
  quantityMode: "base";
  limitPriceAtomic: string | null;
  source: string;
  reason: string;
} {
  const venueKey =
    readTrimmedString(input.payload.venueKey)?.toLowerCase() ?? "dflow";
  if (venueKey !== "dflow") {
    throw new Error(`invalid-terminal-prediction-venue:${venueKey}`);
  }
  const instrumentId = readTrimmedString(input.payload.instrumentId);
  const instrumentLabel =
    readTrimmedString(input.payload.instrumentLabel) ?? instrumentId;
  const outcomeId = readTrimmedString(input.payload.outcomeId);
  const side = parseTerminalPredictionOrderSide(input.payload.side);
  const quantityAtomic = readTrimmedString(input.payload.quantityAtomic);
  const orderType = parseTerminalPredictionOrderType(input.payload.orderType);
  const timeInForce = parseTerminalPredictionTimeInForce(
    input.payload.timeInForce,
  );
  const quantityMode = parseTerminalPredictionQuantityMode(
    input.payload.quantityMode,
  );
  const limitPriceAtomic = readTrimmedString(input.payload.limitPriceAtomic);
  const source =
    readTrimmedString(input.payload.source) ?? "PREDICTION_TERMINAL";
  const reason =
    readTrimmedString(input.payload.reason) ??
    `${side ?? "prediction"}:${instrumentId ?? "market"}`;
  if (
    !instrumentId ||
    !instrumentLabel ||
    !outcomeId ||
    !side ||
    !quantityAtomic ||
    readAtomicBigInt(quantityAtomic) === null
  ) {
    throw new Error("invalid-terminal-prediction-order");
  }
  if (quantityMode !== "base") {
    throw new Error("invalid-terminal-prediction-quantity-mode:base-only");
  }
  if (
    orderType === "limit" &&
    (!limitPriceAtomic || readAtomicBigInt(limitPriceAtomic) === null)
  ) {
    throw new Error("invalid-terminal-prediction-limit-price");
  }
  if (input.requireReason && !reason) {
    throw new Error("invalid-terminal-prediction-reason");
  }
  return {
    venueKey: "dflow",
    instrumentId,
    instrumentLabel,
    outcomeId,
    side,
    quantityAtomic,
    orderType,
    timeInForce,
    quantityMode: "base",
    limitPriceAtomic:
      orderType === "limit" && limitPriceAtomic ? limitPriceAtomic : null,
    source,
    reason,
  };
}

async function listTerminalPredictionMarkets(input: {
  env: Env;
  venueKey: "dflow";
  limit: number;
}): Promise<Record<string, unknown>[]> {
  const dflow = new DFlowClient(input.env);
  const markets = await dflow.listPredictionMarkets({
    status: "active",
    limit: input.limit,
  });
  return markets.map((market) =>
    buildTerminalPredictionMarketView({
      venueKey: input.venueKey,
      market,
    }),
  );
}

async function previewTerminalPredictionOrder(input: {
  env: Env;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const parsed = parseTerminalPredictionOrderPayload({
    payload: input.payload,
  });
  const dflow = new DFlowClient(input.env);
  const preview = await dflow.describePredictionIntent({
    instrumentId: parsed.instrumentId,
    outcomeId: parsed.outcomeId,
    side: parsed.side,
    quantityAtomic: parsed.quantityAtomic,
    options: {
      orderType: parsed.orderType,
      timeInForce: parsed.timeInForce,
      quantityMode: parsed.quantityMode,
      ...(parsed.limitPriceAtomic
        ? { limitPriceAtomic: parsed.limitPriceAtomic }
        : {}),
    },
  });
  return {
    venueKey: parsed.venueKey,
    provider: "dflow",
    market: buildTerminalPredictionMarketView({
      venueKey: parsed.venueKey,
      market: preview.market,
    }),
    instrumentId: parsed.instrumentId,
    instrumentLabel: parsed.instrumentLabel,
    outcomeId: parsed.outcomeId,
    outcomeSide: preview.outcomeSide,
    side: parsed.side,
    orderType: parsed.orderType,
    timeInForce: parsed.timeInForce,
    quantityMode: parsed.quantityMode,
    quantityAtomic: parsed.quantityAtomic,
    settlementMint: preview.settlementMint,
    priceQuote: preview.priceQuote,
    estimatedNotionalUsd: preview.estimatedNotionalUsd,
    liveReady: preview.liveReady,
    routeSummary: `DFlow ${preview.outcomeSide.toUpperCase()}`,
    notes: preview.notes,
  };
}

async function listTerminalPredictionPositionsForActor(input: {
  env: Env;
  actorId: string;
}): Promise<TerminalPredictionPositionView[]> {
  const requests = (await listTerminalPredictionRequestsForActor(input))
    .filter((entry) => {
      const intent = isRecord(entry.metadata?.intent)
        ? entry.metadata.intent
        : null;
      return (
        readTrimmedString(intent?.family) === "prediction_order" &&
        readTrimmedString(intent?.venueKey)?.toLowerCase() === "dflow"
      );
    })
    .sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
  const dflow = new DFlowClient(input.env);
  const marketCache = new Map<
    string,
    Awaited<ReturnType<DFlowClient["getPredictionMarketByMint"]>>
  >();
  const groups = new Map<
    string,
    {
      key: string;
      instrumentId: string;
      instrumentLabel: string;
      outcomeMint: string;
      outcomeSide: "yes" | "no" | null;
      netQuantity: bigint;
      grossBoughtQuantity: bigint;
      totalBuyNotionalUsd: number;
      lastPriceQuote: number | null;
      settlementMint: string | null;
      lastRequestId: string | null;
      lastUpdatedAt: string | null;
      settlementState: string;
      notes: string[];
    }
  >();

  for (const request of requests) {
    const latest = await getExecutionLatestStatus(
      input.env.WAITLIST_DB,
      request.requestId,
    );
    if (!latest) continue;
    if (!isSuccessfulTerminalPredictionRequest(latest)) continue;
    const intent = isRecord(latest.request.metadata?.intent)
      ? latest.request.metadata.intent
      : null;
    const instrumentId = readTrimmedString(intent?.instrumentId);
    const instrumentLabel =
      readTrimmedString(intent?.instrumentLabel) ?? instrumentId;
    const outcomeMint = readTrimmedString(intent?.outcomeId);
    const side = parseTerminalPredictionOrderSide(intent?.side);
    const quantityAtomic = readAtomicBigInt(intent?.quantityAtomic);
    if (!instrumentId || !instrumentLabel || !outcomeMint || !side) continue;
    const key = buildTerminalPredictionPositionKey({
      venueKey: "dflow",
      instrumentId,
      outcomeMint,
    });
    const snapshot = readPredictionReferenceSnapshot(latest);
    const quantity = quantityAtomic ?? 0n;
    const group = groups.get(key) ?? {
      key,
      instrumentId,
      instrumentLabel,
      outcomeMint,
      outcomeSide:
        normalizePredictionOutcomeSide(snapshot?.outcomeSide) ??
        predictionOutcomeSideFromOrderSide(side),
      netQuantity: 0n,
      grossBoughtQuantity: 0n,
      totalBuyNotionalUsd: 0,
      lastPriceQuote: null,
      settlementMint: readTrimmedString(snapshot?.settlementMint),
      lastRequestId: null,
      lastUpdatedAt: null,
      settlementState: "pending",
      notes: [],
    };
    if (side.startsWith("buy")) {
      group.netQuantity += quantity;
      group.grossBoughtQuantity += quantity;
      const estimatedNotionalUsd = Number(snapshot?.estimatedNotionalUsd);
      const priceQuote = Number(snapshot?.priceQuote);
      if (Number.isFinite(estimatedNotionalUsd) && estimatedNotionalUsd > 0) {
        group.totalBuyNotionalUsd += estimatedNotionalUsd;
      } else {
        const quantityUi = atomicToDecimalNumber(
          quantity.toString(),
          TERMINAL_PREDICTION_DECIMALS,
        );
        if (
          quantityUi !== null &&
          Number.isFinite(priceQuote) &&
          priceQuote > 0
        ) {
          group.totalBuyNotionalUsd += quantityUi * priceQuote;
        }
      }
    } else if (group.netQuantity > 0n) {
      group.netQuantity =
        quantity >= group.netQuantity ? 0n : group.netQuantity - quantity;
    }
    const priceQuote = Number(snapshot?.priceQuote);
    if (Number.isFinite(priceQuote) && priceQuote > 0) {
      group.lastPriceQuote = priceQuote;
    }
    group.settlementMint =
      readTrimmedString(snapshot?.settlementMint) ?? group.settlementMint;
    group.lastRequestId = latest.request.requestId;
    group.lastUpdatedAt =
      latest.request.updatedAt ??
      latest.request.receivedAt ??
      group.lastUpdatedAt;
    const lifecycle = readPersistedExecutionLifecycle({ latest });
    group.settlementState =
      readTrimmedString(lifecycle?.settlementState) ?? group.settlementState;
    const lifecycleNotes = readStringArray(lifecycle?.notes) ?? [];
    group.notes = Array.from(new Set([...group.notes, ...lifecycleNotes]));
    groups.set(key, group);
  }

  const positions: TerminalPredictionPositionView[] = [];
  for (const group of groups.values()) {
    let market = marketCache.get(group.outcomeMint);
    if (market === undefined) {
      market = await dflow.getPredictionMarketByMint(group.outcomeMint);
      marketCache.set(group.outcomeMint, market);
    }
    const primaryAccount = market?.accounts.find(
      (account) =>
        account.yesMint === group.outcomeMint ||
        account.noMint === group.outcomeMint,
    );
    const result = normalizePredictionResult(market?.result);
    const marketResolved = isPredictionMarketResolved({
      status: market?.status,
      result,
      redemptionStatus: primaryAccount?.redemptionStatus ?? null,
    });
    const expectedPayoutAtomic =
      group.netQuantity > 0n && result && group.outcomeSide
        ? result === group.outcomeSide
          ? group.netQuantity.toString()
          : "0"
        : null;
    positions.push({
      key: group.key,
      venueKey: "dflow",
      instrumentId: group.instrumentId,
      instrumentLabel: group.instrumentLabel,
      outcomeMint: group.outcomeMint,
      outcomeSide: group.outcomeSide,
      netQuantityAtomic: group.netQuantity.toString(),
      grossBoughtQuantityAtomic: group.grossBoughtQuantity.toString(),
      netQuantityUi: formatAtomicDisplay(
        group.netQuantity,
        TERMINAL_PREDICTION_DECIMALS,
      ),
      grossBoughtQuantityUi: formatAtomicDisplay(
        group.grossBoughtQuantity,
        TERMINAL_PREDICTION_DECIMALS,
      ),
      averageEntryPrice:
        group.grossBoughtQuantity > 0n && group.totalBuyNotionalUsd > 0
          ? Number(
              (
                (group.totalBuyNotionalUsd /
                  Number(group.grossBoughtQuantity)) *
                10 ** TERMINAL_PREDICTION_DECIMALS
              ).toFixed(6),
            )
          : null,
      lastPriceQuote: group.lastPriceQuote,
      marketStatus: market?.status ?? null,
      marketResolved,
      result,
      settleTime: market?.settleTime ?? null,
      settlementMint:
        primaryAccount?.settlementMint ?? group.settlementMint ?? null,
      redemptionStatus: primaryAccount?.redemptionStatus ?? null,
      canSettle: group.netQuantity > 0n && result !== null,
      expectedPayoutAtomic,
      expectedPayoutUi: formatAtomicDisplay(
        expectedPayoutAtomic ?? "0",
        TERMINAL_PREDICTION_DECIMALS,
      ),
      positionState: group.netQuantity > 0n ? "open" : "closed",
      settlementState:
        group.netQuantity === 0n &&
        group.notes.includes("prediction-settlement")
          ? "redeemed"
          : group.netQuantity > 0n && result !== null
            ? "redeemable"
            : group.settlementState,
      lastRequestId: group.lastRequestId,
      lastUpdatedAt: group.lastUpdatedAt,
      notes: Array.from(
        new Set(
          [
            ...(result ? [`resolved:${result}`] : []),
            ...(marketResolved && result === null
              ? ["resolved:pending_result"]
              : []),
            ...group.notes,
          ].filter((entry) => Boolean(entry)),
        ),
      ),
    });
  }

  return positions.sort((a, b) =>
    String(b.lastUpdatedAt ?? "").localeCompare(String(a.lastUpdatedAt ?? "")),
  );
}

async function listTerminalPredictionRequestsForActor(input: {
  env: Env;
  actorId: string;
}): Promise<ExecutionRequestRecord[]> {
  const requests: ExecutionRequestRecord[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const page = await listExecutionRequestsByActor(input.env.WAITLIST_DB, {
      actorId: input.actorId,
      mode: "privy_execute",
      limit: pageSize,
      offset,
    });
    requests.push(...page);
    if (page.length < pageSize) break;
  }
  return requests;
}

function isSuccessfulTerminalPredictionRequest(
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>,
): boolean {
  const terminalStatus = readTrimmedString(
    latest?.receipt?.finalizedStatus ?? latest?.request.status,
  )?.toLowerCase();
  return terminalStatus === "landed" || terminalStatus === "finalized";
}

function buildTerminalPredictionRequestSummary(
  latest: Awaited<ReturnType<typeof getExecutionLatestStatus>>,
): Record<string, unknown> | null {
  if (!latest) return null;
  const intent = isRecord(latest.request.metadata?.intent)
    ? latest.request.metadata.intent
    : null;
  if (readTrimmedString(intent?.family) !== "prediction_order") {
    return null;
  }
  const outcomeId = readTrimmedString(intent?.outcomeId);
  const side = parseTerminalPredictionOrderSide(intent?.side);
  const snapshot = readPredictionReferenceSnapshot(latest);
  return {
    requestId: latest.request.requestId,
    status: latest.request.status,
    terminal: Boolean(latest.request.terminalAt),
    updatedAt: latest.request.updatedAt ?? latest.request.receivedAt,
    receiptId: latest.receipt?.receiptId ?? null,
    provider:
      latest.receipt?.provider ?? latest.latestAttempt?.provider ?? null,
    instrumentId: readTrimmedString(intent?.instrumentId),
    instrumentLabel:
      readTrimmedString(intent?.instrumentLabel) ??
      readTrimmedString(intent?.instrumentId),
    outcomeId,
    outcomeSide:
      normalizePredictionOutcomeSide(snapshot?.outcomeSide) ??
      (side ? predictionOutcomeSideFromOrderSide(side) : null),
    quantityAtomic: readTrimmedString(intent?.quantityAtomic),
    settlementMint: readTrimmedString(snapshot?.settlementMint),
    priceQuote: Number(snapshot?.priceQuote),
    estimatedNotionalUsd: Number(snapshot?.estimatedNotionalUsd),
  };
}

async function submitTerminalPredictionOrder(input: {
  request: Request;
  env: Env;
  user: UserRow;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const parsed = parseTerminalPredictionOrderPayload({
    payload: input.payload,
    requireReason: true,
  });
  const requestPayload = {
    schemaVersion: "v2",
    mode: "privy_execute",
    lane: "safe",
    metadata: {
      source: parsed.source,
      reason: parsed.reason,
    },
    privyExecute: {
      wallet: input.user.walletAddress,
      intent: {
        family: "prediction_order",
        venueKey: parsed.venueKey,
        marketType: "prediction",
        instrumentId: parsed.instrumentId,
        instrumentLabel: parsed.instrumentLabel,
        side: parsed.side,
        quantityAtomic: parsed.quantityAtomic,
        outcomeId: parsed.outcomeId,
      },
      options: {
        orderType: parsed.orderType,
        timeInForce: parsed.timeInForce,
        quantityMode: parsed.quantityMode,
        ...(parsed.limitPriceAtomic
          ? { limitPriceAtomic: parsed.limitPriceAtomic }
          : {}),
      },
    },
  };
  const payloadHash = await hashExecutionSubmitPayload(requestPayload);
  const idempotencyKey =
    readIdempotencyKey(input.request) ?? `pred-${crypto.randomUUID()}`;
  const metadata = {
    source: parsed.source,
    reason: parsed.reason,
    intent: {
      family: "prediction_order",
      marketType: "prediction",
      venueKey: parsed.venueKey,
      instrumentId: parsed.instrumentId,
      instrumentLabel: parsed.instrumentLabel,
      side: parsed.side,
      outcomeId: parsed.outcomeId,
      quantityAtomic: parsed.quantityAtomic,
    },
    terminal: {
      workflow: "prediction",
      executionMode: "paper",
    },
  } as const;
  const reservation = await reserveExecutionSubmitRequest({
    db: input.env.WAITLIST_DB,
    requestId: newExecRequestId(),
    idempotencyKey,
    actorType: "privy_user",
    actorId: input.user.id,
    mode: "privy_execute",
    lane: "safe",
    payloadHash,
    metadata,
  });
  if (reservation.result === "conflict") {
    throw new Error(reservation.error);
  }
  if (reservation.result === "replay") {
    const latest = await getExecutionLatestStatus(
      input.env.WAITLIST_DB,
      reservation.request.requestId,
    );
    return (
      buildTerminalPredictionRequestSummary(latest) ?? {
        requestId: reservation.request.requestId,
        status: reservation.request.status,
        terminal: Boolean(reservation.request.terminalAt),
      }
    );
  }

  await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "received",
    reason: null,
    details: null,
  });
  await updateExecutionRequestStatus(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "validated",
    statusReason: null,
  });
  await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "validated",
    reason: null,
    details: null,
  });

  const rpcEndpoint = String(input.env.RPC_ENDPOINT ?? "").trim();
  if (!rpcEndpoint) {
    throw new Error("rpc-endpoint-missing");
  }

  const attemptId = newExecutionAttemptId();
  const attemptStartedAt = new Date().toISOString();
  const quality = {
    lane: "safe",
    orderType: parsed.orderType,
    timeInForce: parsed.timeInForce,
    quantityMode: parsed.quantityMode,
    limitPriceAtomic: parsed.limitPriceAtomic,
  };
  await updateExecutionRequestStatus(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "dispatched",
    statusReason: null,
  });
  await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "dispatched",
    reason: null,
    details: {
      provider: "dflow",
      attempt: 1,
    },
    createdAt: attemptStartedAt,
  });
  await createExecutionAttemptIdempotent(input.env.WAITLIST_DB, {
    attemptId,
    requestId: reservation.request.requestId,
    attemptNo: 1,
    lane: "safe",
    provider: "dflow",
    status: "dispatched",
    providerResponse: {
      route: "dflow",
      lane: "safe",
      mode: "privy_execute",
      quality,
    },
    startedAt: attemptStartedAt,
  });

  try {
    const dflow = new DFlowClient(input.env);
    const rpc = new SolanaRpc(rpcEndpoint);
    const jupiter = new JupiterClient(
      String(input.env.JUPITER_BASE_URL ?? "").trim() ||
        X402_READ_JUPITER_BASE_URL,
      input.env.JUPITER_API_KEY,
    );
    const result = await executeIntentViaRouter({
      env: input.env,
      venueKey: parsed.venueKey,
      runtimeMode: "paper",
      requireVenueRouting: true,
      execution: {
        adapter: "dflow",
        params: {
          lane: "safe",
          orderType: parsed.orderType,
          timeInForce: parsed.timeInForce,
          quantityMode: parsed.quantityMode,
          ...(parsed.limitPriceAtomic
            ? { limitPriceAtomic: parsed.limitPriceAtomic }
            : {}),
        },
      },
      policy: normalizePolicy({
        allowedMints: [USDC_MINT],
        commitment: "confirmed",
      }),
      rpc,
      jupiter,
      dflow,
      intent: {
        family: "prediction_order",
        wallet: input.user.walletAddress,
        venueKey: parsed.venueKey,
        marketType: "prediction",
        instrumentId: parsed.instrumentId,
        outcomeId: parsed.outcomeId,
        side: parsed.side,
        quantityAtomic: parsed.quantityAtomic,
        params: {
          orderType: parsed.orderType,
          timeInForce: parsed.timeInForce,
          quantityMode: parsed.quantityMode,
          ...(parsed.limitPriceAtomic
            ? { limitPriceAtomic: parsed.limitPriceAtomic }
            : {}),
        },
      },
      privyWalletId: input.user.privyWalletId ?? undefined,
      log(level, message, meta) {
        console[level]("terminal.prediction.submit", {
          requestId: reservation.request.requestId,
          message,
          ...(meta ?? {}),
        });
      },
    });
    const completedAt = new Date().toISOString();
    const providerResponse = {
      route: "dflow",
      lane: "safe",
      mode: "privy_execute",
      quality,
      executionMeta:
        result.executionMeta &&
        typeof result.executionMeta === "object" &&
        !Array.isArray(result.executionMeta)
          ? result.executionMeta
          : null,
      predictionOrder: {
        instrumentId: parsed.instrumentId,
        instrumentLabel: parsed.instrumentLabel,
        outcomeId: parsed.outcomeId,
        side: parsed.side,
        quantityAtomic: parsed.quantityAtomic,
      },
    };
    await finalizeExecutionAttempt(input.env.WAITLIST_DB, {
      attemptId,
      status: result.status,
      providerResponse,
      errorCode: null,
      errorMessage: null,
      completedAt,
    });
    const receiptId = newExecutionReceiptId();
    await upsertExecutionReceiptIdempotent(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      receiptId,
      finalizedStatus: "finalized",
      lane: "safe",
      provider: "dflow",
      signature: result.signature,
      slot: null,
      errorCode: null,
      errorMessage: null,
      receipt: {
        mode: "privy_execute",
        route: "dflow",
        resultStatus: result.status,
        outcome: "finalized",
        lifecycle: {
          ...(result.executionMeta?.lifecycle ?? {}),
          fillState: "filled",
          positionState: parsed.side.startsWith("buy") ? "open" : "closed",
          settlementState: "confirmed",
        },
        quality,
        prediction: {
          instrumentId: parsed.instrumentId,
          instrumentLabel: parsed.instrumentLabel,
          outcomeId: parsed.outcomeId,
          side: parsed.side,
          quantityAtomic: parsed.quantityAtomic,
        },
        quote: {
          inputMint:
            readTrimmedString(result.usedQuote.inputMint) ??
            readTrimmedString(
              result.executionMeta?.referencePrice?.snapshot?.settlementMint,
            ) ??
            USDC_MINT,
          outputMint:
            readTrimmedString(result.usedQuote.outputMint) ?? parsed.outcomeId,
          inAmount:
            readTrimmedString(result.usedQuote.inAmount) ??
            parsed.quantityAtomic,
          outAmount:
            readTrimmedString(result.usedQuote.outAmount) ??
            parsed.quantityAtomic,
        },
      },
      readyAt: completedAt,
    });
    await terminalizeExecutionRequest(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      status: "landed",
      statusReason: null,
      details: {
        provider: "dflow",
        attempt: 1,
      },
      nowIso: completedAt,
    });
    await updateExecutionRequestStatus(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      status: "finalized",
      statusReason: null,
      nowIso: completedAt,
    });
    await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      status: "finalized",
      reason: null,
      details: {
        provider: "dflow",
        attempt: 1,
      },
      createdAt: completedAt,
    });
    const latest = await getExecutionLatestStatus(
      input.env.WAITLIST_DB,
      reservation.request.requestId,
    );
    return (
      buildTerminalPredictionRequestSummary(latest) ?? {
        requestId: reservation.request.requestId,
        status: "finalized",
        terminal: true,
        receiptId,
        provider: "dflow",
      }
    );
  } catch (error) {
    const failedAt = new Date().toISOString();
    const deniedReason = policyDeniedReason(error);
    const terminalStatus = deniedReason ? "rejected" : "failed";
    const errorCode = deniedReason
      ? "policy-denied"
      : normalizeExecutionErrorCode({
          error,
          fallback: "submission-failed",
        });
    const errorMessage =
      executionErrorMessage(error) ?? "terminal-prediction-submit-failed";
    await finalizeExecutionAttempt(input.env.WAITLIST_DB, {
      attemptId,
      status: terminalStatus,
      providerResponse: {
        route: "dflow",
        lane: "safe",
        mode: "privy_execute",
        quality,
      },
      errorCode,
      errorMessage,
      completedAt: failedAt,
    });
    await upsertExecutionReceiptIdempotent(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      receiptId: newExecutionReceiptId(),
      finalizedStatus: terminalStatus,
      lane: "safe",
      provider: "dflow",
      signature: null,
      slot: null,
      errorCode,
      errorMessage,
      receipt: {
        mode: "privy_execute",
        route: "dflow",
        outcome: terminalStatus,
        lifecycle: {
          positionState: "closed",
          settlementState: "failed",
          notes: [errorMessage],
        },
        quality,
      },
      readyAt: failedAt,
    });
    await terminalizeExecutionRequest(input.env.WAITLIST_DB, {
      requestId: reservation.request.requestId,
      status: terminalStatus,
      statusReason: errorCode,
      details: {
        provider: "dflow",
        attempt: 1,
        errorMessage,
      },
      nowIso: failedAt,
    });
    throw error instanceof Error ? error : new Error(errorCode);
  }
}

async function settleTerminalPredictionPosition(input: {
  request: Request;
  env: Env;
  user: UserRow;
  positionKey: string;
}): Promise<Record<string, unknown>> {
  const positions = await listTerminalPredictionPositionsForActor({
    env: input.env,
    actorId: input.user.id,
  });
  const position = positions.find((entry) => entry.key === input.positionKey);
  if (!position) {
    throw new Error("terminal-prediction-position-not-found");
  }
  if (!position.canSettle) {
    throw new Error("terminal-prediction-position-not-settleable");
  }
  if (!position.outcomeSide) {
    throw new Error("terminal-prediction-position-outcome-side-missing");
  }
  const side = `sell_${position.outcomeSide}` as TerminalPredictionOrderSide;
  const payloadHash = await hashExecutionSubmitPayload({
    action: "prediction_settlement",
    positionKey: position.key,
    quantityAtomic: position.netQuantityAtomic,
    expectedPayoutAtomic: position.expectedPayoutAtomic,
  });
  const idempotencyKey =
    readIdempotencyKey(input.request) ?? `pred-settle-${crypto.randomUUID()}`;
  const metadata = {
    source: "PREDICTION_SETTLEMENT",
    reason: `Redeem ${position.instrumentLabel} ${position.outcomeSide.toUpperCase()}`,
    intent: {
      family: "prediction_order",
      marketType: "prediction",
      venueKey: "dflow",
      instrumentId: position.instrumentId,
      instrumentLabel: position.instrumentLabel,
      side,
      outcomeId: position.outcomeMint,
      quantityAtomic: position.netQuantityAtomic,
    },
    terminal: {
      workflow: "prediction_settlement",
      executionMode: "paper",
      positionKey: position.key,
    },
  } as const;
  const reservation = await reserveExecutionSubmitRequest({
    db: input.env.WAITLIST_DB,
    requestId: newExecRequestId(),
    idempotencyKey,
    actorType: "privy_user",
    actorId: input.user.id,
    mode: "privy_execute",
    lane: "safe",
    payloadHash,
    metadata,
  });
  if (reservation.result === "conflict") {
    throw new Error(reservation.error);
  }
  if (reservation.result === "replay") {
    const latest = await getExecutionLatestStatus(
      input.env.WAITLIST_DB,
      reservation.request.requestId,
    );
    return (
      buildTerminalPredictionRequestSummary(latest) ?? {
        requestId: reservation.request.requestId,
        status: reservation.request.status,
        terminal: Boolean(reservation.request.terminalAt),
      }
    );
  }

  await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "received",
    reason: null,
    details: null,
  });
  await updateExecutionRequestStatus(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "validated",
    statusReason: null,
  });
  await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "validated",
    reason: null,
    details: null,
  });

  const attemptId = newExecutionAttemptId();
  const attemptStartedAt = new Date().toISOString();
  const quality = {
    lane: "safe",
    orderType: "market",
    timeInForce: "ioc",
    quantityMode: "base",
  };
  await updateExecutionRequestStatus(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "dispatched",
    statusReason: null,
  });
  await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "dispatched",
    reason: null,
    details: {
      provider: "dflow",
      attempt: 1,
      action: "redeem",
    },
    createdAt: attemptStartedAt,
  });
  await createExecutionAttemptIdempotent(input.env.WAITLIST_DB, {
    attemptId,
    requestId: reservation.request.requestId,
    attemptNo: 1,
    lane: "safe",
    provider: "dflow",
    status: "dispatched",
    providerResponse: {
      route: "dflow",
      lane: "safe",
      mode: "privy_execute",
      quality,
    },
    startedAt: attemptStartedAt,
  });

  const completedAt = new Date().toISOString();
  const providerResponse = {
    route: "dflow",
    lane: "safe",
    mode: "privy_execute",
    quality,
    predictionSettlement: {
      positionKey: position.key,
      instrumentId: position.instrumentId,
      outcomeMint: position.outcomeMint,
      outcomeSide: position.outcomeSide,
      quantityAtomic: position.netQuantityAtomic,
      payoutAtomic: position.expectedPayoutAtomic ?? "0",
      settlementMint: position.settlementMint,
      result: position.result,
    },
    executionMeta: {
      route: "dflow",
      classification: "simulated",
      lifecycle: {
        fillState: "settled",
        positionState: "closed",
        settlementState: "redeemed",
        notes: ["prediction-settlement"],
      },
      referencePrice: {
        verdict: "allow",
        reason: null,
        executionPrice: null,
        executionDivergenceBps: null,
        snapshot: {
          marketId: position.instrumentId,
          outcomeMint: position.outcomeMint,
          outcomeSide: position.outcomeSide,
          settlementMint: position.settlementMint,
          result: position.result,
          expectedPayoutAtomic: position.expectedPayoutAtomic ?? "0",
        },
      },
      trace: {
        simulatedAt: completedAt,
        finalizedAt: completedAt,
      },
    },
  };
  await finalizeExecutionAttempt(input.env.WAITLIST_DB, {
    attemptId,
    status: "simulated",
    providerResponse,
    errorCode: null,
    errorMessage: null,
    completedAt,
  });
  const receiptId = newExecutionReceiptId();
  await upsertExecutionReceiptIdempotent(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    receiptId,
    finalizedStatus: "finalized",
    lane: "safe",
    provider: "dflow",
    signature: null,
    slot: null,
    errorCode: null,
    errorMessage: null,
    receipt: {
      mode: "privy_execute",
      route: "dflow",
      resultStatus: "simulated",
      outcome: "finalized",
      lifecycle: {
        fillState: "settled",
        positionState: "closed",
        settlementState: "redeemed",
        notes: ["prediction-settlement"],
      },
      quality,
      prediction: {
        instrumentId: position.instrumentId,
        instrumentLabel: position.instrumentLabel,
        outcomeId: position.outcomeMint,
        side,
        quantityAtomic: position.netQuantityAtomic,
      },
      quote: {
        inputMint: position.outcomeMint,
        outputMint: position.settlementMint ?? USDC_MINT,
        inAmount: position.netQuantityAtomic,
        outAmount: position.expectedPayoutAtomic ?? "0",
      },
    },
    readyAt: completedAt,
  });
  await terminalizeExecutionRequest(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "landed",
    statusReason: null,
    details: {
      provider: "dflow",
      attempt: 1,
      action: "redeem",
    },
    nowIso: completedAt,
  });
  await updateExecutionRequestStatus(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "finalized",
    statusReason: null,
    nowIso: completedAt,
  });
  await appendExecutionStatusEvent(input.env.WAITLIST_DB, {
    requestId: reservation.request.requestId,
    status: "finalized",
    reason: null,
    details: {
      provider: "dflow",
      attempt: 1,
      action: "redeem",
    },
    createdAt: completedAt,
  });
  const latest = await getExecutionLatestStatus(
    input.env.WAITLIST_DB,
    reservation.request.requestId,
  );
  return (
    buildTerminalPredictionRequestSummary(latest) ?? {
      requestId: reservation.request.requestId,
      status: "finalized",
      terminal: true,
      receiptId,
      provider: "dflow",
    }
  );
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
