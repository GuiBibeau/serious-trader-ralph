import {
  requireRuntimeVenueCapability,
  runtimeVenueSupportsAdapter,
  runtimeVenueSupportsIntentFamily,
  runtimeVenueSupportsMode,
} from "../../../src/runtime/venues/catalog.js";
import {
  SUPPORTED_TRADING_MINTS,
  TRADING_TOKEN_BY_MINT,
  USDC_MINT,
} from "./defaults";
import { DFlowClient } from "./dflow";
import { DriftClient } from "./drift";
import {
  type ExecutionAdapterRegistration,
  executeIntentViaRouter,
  resolveExecutionAdapterRegistration,
} from "./execution/router";
import {
  quoteSpotSwap,
  resolveSpotVenueExecutionAdapter,
} from "./execution/spot_venues";
import type {
  ExecuteSwapResult,
  ExecutionRouterIntent,
  NonSwapExecutionIntent,
  SpotSwapExecutionIntent,
} from "./execution/types";
import { JupiterClient } from "./jupiter";
import { MangoClient } from "./mango";
import { OpenBookClient } from "./openbook";
import { OrcaClient } from "./orca";
import { enforcePolicy, normalizePolicy } from "./policy";
import { RaydiumClient } from "./raydium";
import type {
  RuntimeMode,
  RuntimeStrategyDeskRunKind,
  RuntimeStrategyDeskScenarioLeg,
  RuntimeStrategyDeskScenarioManifest,
  RuntimeStrategyDeskScenarioReport,
  RuntimeStrategyDeskScenarioRun,
} from "./runtime_contracts";
import {
  getRuntimeStrategyDeskScenarioWorkflow,
  upsertRuntimeStrategyDeskScenarioReportWorkflow,
  upsertRuntimeStrategyDeskScenarioRunWorkflow,
} from "./runtime_strategy_desk";
import { SolanaRpc } from "./solana_rpc";
import type { Env } from "./types";

type StrategyDeskExecuteRunKind = Extract<
  RuntimeStrategyDeskRunKind,
  "shadow" | "paper"
>;

export type RuntimeStrategyDeskExecuteWorkflowInput = {
  env: Env;
  scenarioId: string;
  runKind: StrategyDeskExecuteRunKind;
  requestedBy: string;
  walletAddress: string;
  privyWalletId?: string;
  scenarioRunId?: string;
  reportId?: string;
  trigger?: Partial<RuntimeStrategyDeskScenarioRun["trigger"]>;
  maxRetriesPerLeg?: number;
};

type StrategyDeskExecutionDeps = {
  now?: () => string;
  createId?: (prefix: string) => string;
  createRpc?: (env: Env) => SolanaRpc;
  createJupiterClient?: (env: Env) => JupiterClient;
  createDFlowClient?: (env: Env) => DFlowClient;
  createDriftClient?: (env: Env) => DriftClient;
  createRaydiumClient?: () => RaydiumClient;
  createOrcaClient?: (env: Env) => OrcaClient;
  createMangoClient?: () => MangoClient;
  createOpenBookClient?: (env: Env) => OpenBookClient;
  quoteSpotSwap?: typeof quoteSpotSwap;
  executeIntentViaRouter?: typeof executeIntentViaRouter;
};

export type RuntimeStrategyDeskExecuteWorkflowResult = {
  scenario: RuntimeStrategyDeskScenarioManifest;
  run: RuntimeStrategyDeskScenarioRun;
  report: RuntimeStrategyDeskScenarioReport;
};

type StrategyDeskRunnerContext = {
  rpc: SolanaRpc;
  jupiter: JupiterClient;
  dflow: DFlowClient;
  drift: DriftClient;
  raydium: RaydiumClient;
  orca: OrcaClient;
  mango: MangoClient;
  openbook: OpenBookClient;
};

type ResolvedStrategyDeskLeg = {
  leg: RuntimeStrategyDeskScenarioLeg;
  capability: ReturnType<typeof requireRuntimeVenueCapability>;
  adapter: ExecutionAdapterRegistration;
  policy: ReturnType<typeof normalizePolicy>;
  intent: ExecutionRouterIntent;
  quoteResponse?: Parameters<typeof enforcePolicy>[1];
};

type StrategyDeskRunArtifact = {
  legId: string;
  attemptCount: number;
  adapterKey: string;
  venueKey: string;
  requestRef: string;
  status: ExecuteSwapResult["status"] | "blocked" | "skipped";
  signature: string | null;
  quote?: {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
  };
  executionMeta?: Record<string, unknown> | null;
  error?: string;
  errorCode?: string;
};

const STABLE_MINTS = new Set(
  ["USDC", "USDT", "PYUSD", "USD1", "USDG"]
    .map(
      (symbol) =>
        Object.values(TRADING_TOKEN_BY_MINT).find(
          (token) => token.symbol === symbol,
        )?.mint,
    )
    .filter((value): value is string => Boolean(value)),
);

function nowIso(deps?: StrategyDeskExecutionDeps): string {
  return deps?.now ? deps.now() : new Date().toISOString();
}

function createDeskId(
  prefix: string,
  deps?: StrategyDeskExecutionDeps,
): string {
  if (deps?.createId) return deps.createId(prefix);
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function decimalToAtomic(value: string, decimals: number): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^([0-9]+)(?:\.([0-9]+))?$/);
  if (!match) {
    throw new Error(`runtime-strategy-desk-invalid-decimal:${value}`);
  }
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return `${BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction || "0")}`;
}

function stableMintDecimals(mint: string): number | null {
  if (!STABLE_MINTS.has(mint)) return null;
  return TRADING_TOKEN_BY_MINT[mint]?.decimals ?? 6;
}

function usdToStableAtomic(usd: string, mint: string): string {
  const decimals = stableMintDecimals(mint);
  if (decimals === null) {
    throw new Error(`runtime-strategy-desk-stable-mint-required:${mint}`);
  }
  return decimalToAtomic(usd, decimals);
}

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(2, Math.floor(parsed)));
}

function stageForRunKind(
  runKind: StrategyDeskExecuteRunKind,
): RuntimeStrategyDeskScenarioReport["stage"] {
  return runKind;
}

function scenarioStateAllowsRun(
  scenario: RuntimeStrategyDeskScenarioManifest,
  runKind: StrategyDeskExecuteRunKind,
): boolean {
  if (runKind === "shadow") {
    return (
      scenario.state === "shadow_ready" ||
      scenario.state === "paper_ready" ||
      scenario.state === "operator_review" ||
      scenario.state === "execution_ready" ||
      scenario.state === "execution_bound"
    );
  }
  return (
    scenario.state === "paper_ready" ||
    scenario.state === "operator_review" ||
    scenario.state === "execution_ready" ||
    scenario.state === "execution_bound"
  );
}

function isExecutionSuccessStatus(
  status: ExecuteSwapResult["status"],
): boolean {
  return (
    status === "dry_run" ||
    status === "simulated" ||
    status === "processed" ||
    status === "confirmed" ||
    status === "finalized"
  );
}

function readExecutionErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object" || Array.isArray(err)) return null;
  const code = String((err as Record<string, unknown>).code ?? "").trim();
  return code || null;
}

function readExecutionError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (!err || typeof err !== "object") return String(err ?? "execution-failed");
  const code = String((err as Record<string, unknown>).code ?? "").trim();
  const reason = String((err as Record<string, unknown>).reason ?? "").trim();
  if (code && reason) return `${code}:${reason}`;
  if (reason) return reason;
  if (code) return code;
  return JSON.stringify(err);
}

function summarizeExecutionMeta(
  value: ExecuteSwapResult["executionMeta"],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function topologicalScenarioLegs(
  scenario: RuntimeStrategyDeskScenarioManifest,
): RuntimeStrategyDeskScenarioLeg[] {
  const byId = new Map(scenario.legs.map((leg) => [leg.legId, leg]));
  const incoming = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const originalOrder = new Map(
    scenario.legs.map((leg, index) => [leg.legId, index]),
  );

  for (const leg of scenario.legs) {
    incoming.set(leg.legId, 0);
    dependents.set(leg.legId, []);
  }

  for (const leg of scenario.legs) {
    for (const dependency of leg.dependencies ?? []) {
      if (!byId.has(dependency)) {
        throw new Error(
          `runtime-strategy-desk-leg-dependency-unknown:${scenario.scenarioId}:${leg.legId}:${dependency}`,
        );
      }
      incoming.set(leg.legId, (incoming.get(leg.legId) ?? 0) + 1);
      dependents.get(dependency)?.push(leg.legId);
    }
  }

  const ready = scenario.legs
    .filter((leg) => (incoming.get(leg.legId) ?? 0) === 0)
    .sort(
      (left, right) =>
        (originalOrder.get(left.legId) ?? 0) -
        (originalOrder.get(right.legId) ?? 0),
    );

  const ordered: RuntimeStrategyDeskScenarioLeg[] = [];
  while (ready.length > 0) {
    const next = ready.shift();
    if (!next) break;
    ordered.push(next);
    for (const dependentId of dependents.get(next.legId) ?? []) {
      const count = (incoming.get(dependentId) ?? 1) - 1;
      incoming.set(dependentId, count);
      if (count === 0) {
        const dependent = byId.get(dependentId);
        if (dependent) {
          ready.push(dependent);
          ready.sort(
            (left, right) =>
              (originalOrder.get(left.legId) ?? 0) -
              (originalOrder.get(right.legId) ?? 0),
          );
        }
      }
    }
  }

  if (ordered.length !== scenario.legs.length) {
    throw new Error(
      `runtime-strategy-desk-leg-dependency-cycle:${scenario.scenarioId}`,
    );
  }
  return ordered;
}

function defaultTrigger(
  now: string,
  override?: Partial<RuntimeStrategyDeskScenarioRun["trigger"]>,
): RuntimeStrategyDeskScenarioRun["trigger"] {
  return {
    kind: "operator",
    source: "strategy_desk_runner",
    observedAt: now,
    ...(override?.reason ? { reason: override.reason } : {}),
    ...(override?.featureSnapshotId
      ? { featureSnapshotId: override.featureSnapshotId }
      : {}),
  };
}

function defaultLegRuns(
  scenario: RuntimeStrategyDeskScenarioManifest,
  stage: RuntimeStrategyDeskScenarioReport["stage"],
): RuntimeStrategyDeskScenarioRun["legRuns"] {
  return scenario.legs.map((leg) => ({
    legId: leg.legId,
    stage,
    state: "pending" as const,
  }));
}

function buildRunnerContext(
  env: Env,
  deps?: StrategyDeskExecutionDeps,
): StrategyDeskRunnerContext {
  const rpcEndpoint =
    String(env.RPC_ENDPOINT ?? "").trim() ||
    "https://api.mainnet-beta.solana.com";
  const rpc = deps?.createRpc?.(env) ?? new SolanaRpc(rpcEndpoint);
  const jupiter =
    deps?.createJupiterClient?.(env) ??
    new JupiterClient(
      String(env.JUPITER_BASE_URL ?? "").trim() || "https://lite-api.jup.ag",
      env.JUPITER_API_KEY,
    );
  const dflow = deps?.createDFlowClient?.(env) ?? new DFlowClient(env);
  const drift = deps?.createDriftClient?.(env) ?? new DriftClient(env);
  const raydium = deps?.createRaydiumClient?.() ?? new RaydiumClient();
  const orca =
    deps?.createOrcaClient?.(env) ??
    new OrcaClient(
      rpcEndpoint,
      String(env.ORCA_API_BASE_URL ?? "").trim() || "https://api.orca.so",
    );
  const mango = deps?.createMangoClient?.() ?? new MangoClient();
  const openbook =
    deps?.createOpenBookClient?.(env) ?? new OpenBookClient(rpcEndpoint);
  return {
    rpc,
    jupiter,
    dflow,
    drift,
    raydium,
    orca,
    mango,
    openbook,
  };
}

function defaultAdapterKey(leg: RuntimeStrategyDeskScenarioLeg): string {
  if (leg.intentFamily === "spot_swap") {
    const capability = requireRuntimeVenueCapability(leg.venueKey);
    return resolveSpotVenueExecutionAdapter({
      venueKey: leg.venueKey,
      runtimeMode: "paper",
      defaultAdapter: capability.adapterKeys[0] ?? leg.venueKey,
    });
  }
  if (leg.intentFamily === "perp_order" && leg.venueKey === "drift") {
    return "drift";
  }
  if (leg.intentFamily === "prediction_order" && leg.venueKey === "dflow") {
    return "dflow";
  }
  if (leg.intentFamily === "flash_atomic") {
    return "flash_liquidity";
  }
  if (leg.intentFamily === "clob_order" && leg.venueKey === "openbook") {
    return "openbook_v2";
  }
  return leg.venueKey;
}

function resolveLegAdapter(
  leg: RuntimeStrategyDeskScenarioLeg,
): ExecutionAdapterRegistration {
  const adapterKey = leg.intent?.adapterKey ?? defaultAdapterKey(leg);
  const registration = resolveExecutionAdapterRegistration(adapterKey);
  if (!registration) {
    throw new Error(
      `runtime-strategy-desk-adapter-not-registered:${leg.legId}:${adapterKey}`,
    );
  }
  return registration;
}

function buildLegPolicy(
  leg: RuntimeStrategyDeskScenarioLeg,
  maxTradeAmountAtomic: string,
): ReturnType<typeof normalizePolicy> {
  return normalizePolicy({
    allowedMints: SUPPORTED_TRADING_MINTS,
    slippageBps: leg.sizing.maxSlippageBps ?? 50,
    maxPriceImpactPct: 0.05,
    maxTradeAmountAtomic,
    minSolReserveLamports: "50000000",
    simulateOnly: true,
    dryRun: false,
    commitment: "confirmed",
  });
}

async function buildSpotLeg(input: {
  env: Env;
  leg: RuntimeStrategyDeskScenarioLeg;
  runKind: StrategyDeskExecuteRunKind;
  walletAddress: string;
  context: StrategyDeskRunnerContext;
  deps?: StrategyDeskExecutionDeps;
}): Promise<ResolvedStrategyDeskLeg> {
  const { leg, context } = input;
  if (!leg.pair) {
    throw new Error(`runtime-strategy-desk-pair-required:${leg.legId}`);
  }
  const side = String(leg.intent?.side ?? "buy")
    .trim()
    .toLowerCase();
  if (side !== "buy" && side !== "sell") {
    throw new Error(`runtime-strategy-desk-spot-side-invalid:${leg.legId}`);
  }

  const inputMint = side === "sell" ? leg.pair.baseMint : leg.pair.quoteMint;
  const outputMint = side === "sell" ? leg.pair.quoteMint : leg.pair.baseMint;
  const amountAtomic =
    leg.intent?.quantityAtomic ??
    (side === "buy"
      ? usdToStableAtomic(leg.sizing.targetNotionalUsd, leg.pair.quoteMint)
      : null);
  if (!amountAtomic) {
    throw new Error(
      `runtime-strategy-desk-spot-quantity-required:${leg.legId}`,
    );
  }

  const policy = buildLegPolicy(leg, amountAtomic);
  const quote = await (input.deps?.quoteSpotSwap ?? quoteSpotSwap)({
    venueKey: leg.venueKey,
    inputMint,
    outputMint,
    amountAtomic,
    slippageBps: policy.slippageBps,
    jupiter: context.jupiter,
    orca: context.orca,
    raydium: context.raydium,
  });
  enforcePolicy(policy, quote.quoteResponse);

  return {
    leg,
    capability: requireRuntimeVenueCapability(leg.venueKey),
    adapter: resolveLegAdapter(leg),
    policy,
    intent: {
      family: "spot_swap",
      wallet: input.walletAddress,
      venueKey: leg.venueKey,
      marketType: "spot",
      inputMint,
      outputMint,
      amountAtomic,
      slippageBps: policy.slippageBps,
    } satisfies SpotSwapExecutionIntent,
    quoteResponse: quote.quoteResponse,
  };
}

function buildNonSpotIntent(
  leg: RuntimeStrategyDeskScenarioLeg,
): NonSwapExecutionIntent {
  const side = String(leg.intent?.side ?? "").trim();

  if (leg.intentFamily === "prediction_order") {
    const instrumentId = String(leg.instrumentId ?? "").trim();
    if (!instrumentId) {
      throw new Error(`runtime-strategy-desk-instrument-required:${leg.legId}`);
    }
    const outcomeId = String(leg.intent?.outcomeId ?? "").trim();
    if (!outcomeId) {
      throw new Error(
        `runtime-strategy-desk-prediction-outcome-required:${leg.legId}`,
      );
    }
    if (
      side !== "buy_yes" &&
      side !== "buy_no" &&
      side !== "sell_yes" &&
      side !== "sell_no"
    ) {
      throw new Error(
        `runtime-strategy-desk-prediction-side-invalid:${leg.legId}`,
      );
    }
    return {
      family: "prediction_order",
      wallet: "",
      venueKey: leg.venueKey,
      marketType: "prediction",
      instrumentId,
      outcomeId,
      side,
      quantityAtomic:
        leg.intent?.quantityAtomic ??
        usdToStableAtomic(
          leg.sizing.targetNotionalUsd,
          leg.intent?.settlementMint ?? USDC_MINT,
        ),
      settlementMint: leg.intent?.settlementMint ?? USDC_MINT,
      params: {
        quantityMode: "quote",
        marketNotionalCapUsd: Number(
          leg.sizing.maxNotionalUsd ?? leg.sizing.targetNotionalUsd,
        ),
        ...(leg.intent?.params ?? {}),
      },
    };
  }

  if (leg.intentFamily === "flash_atomic") {
    const instrumentId =
      String(leg.instrumentId ?? "").trim() ||
      String(leg.pair?.symbol ?? "").trim() ||
      String(leg.intent?.referenceId ?? "").trim();
    const referenceId = String(leg.intent?.referenceId ?? "").trim();
    const settlementMint =
      leg.intent?.settlementMint ?? leg.pair?.quoteMint ?? USDC_MINT;
    const borrowLegs =
      leg.intent?.borrowLegs?.map((borrowLeg) => ({
        provider: borrowLeg.provider,
        mint: borrowLeg.mint,
        amountAtomic:
          borrowLeg.amountAtomic ??
          usdToStableAtomic(leg.sizing.targetNotionalUsd, borrowLeg.mint),
      })) ?? [];
    if (!referenceId || borrowLegs.length < 1) {
      throw new Error(
        `runtime-strategy-desk-flash-borrow-legs-required:${leg.legId}`,
      );
    }
    return {
      family: "flash_atomic",
      wallet: "",
      venueKey: leg.venueKey,
      marketType: "spot",
      instrumentId,
      referenceId,
      settlementMint,
      borrowLegs,
      params: leg.intent?.params ?? null,
    };
  }

  if (leg.intentFamily === "perp_order") {
    const instrumentId = String(leg.instrumentId ?? "").trim();
    if (!instrumentId) {
      throw new Error(`runtime-strategy-desk-instrument-required:${leg.legId}`);
    }
    if (
      side !== "long" &&
      side !== "short" &&
      side !== "close_long" &&
      side !== "close_short"
    ) {
      throw new Error(`runtime-strategy-desk-perp-side-invalid:${leg.legId}`);
    }
    if (!leg.intent?.quantityAtomic) {
      throw new Error(
        `runtime-strategy-desk-perp-quantity-required:${leg.legId}`,
      );
    }
    return {
      family: "perp_order",
      wallet: "",
      venueKey: leg.venueKey,
      marketType: "perp",
      instrumentId,
      side,
      quantityAtomic: leg.intent.quantityAtomic,
      collateralAtomic:
        leg.intent.collateralAtomic ??
        (leg.sizing.reserveUsd
          ? usdToStableAtomic(leg.sizing.reserveUsd, USDC_MINT)
          : undefined),
      params: leg.intent.params ?? null,
    };
  }

  if (leg.intentFamily === "clob_order") {
    const instrumentId = String(leg.instrumentId ?? "").trim();
    if (!instrumentId) {
      throw new Error(`runtime-strategy-desk-instrument-required:${leg.legId}`);
    }
    if (side !== "buy" && side !== "sell") {
      throw new Error(`runtime-strategy-desk-clob-side-invalid:${leg.legId}`);
    }
    if (!leg.intent?.quantityAtomic) {
      throw new Error(
        `runtime-strategy-desk-clob-quantity-required:${leg.legId}`,
      );
    }
    return {
      family: "clob_order",
      wallet: "",
      venueKey: leg.venueKey,
      marketType: leg.marketType === "perp" ? "perp" : "spot",
      instrumentId,
      side,
      quantityAtomic: leg.intent.quantityAtomic,
      params: leg.intent.params ?? null,
    };
  }

  throw new Error(
    `runtime-strategy-desk-intent-family-unsupported:${leg.legId}:${leg.intentFamily}`,
  );
}

function buildNonSpotLeg(input: {
  leg: RuntimeStrategyDeskScenarioLeg;
  walletAddress: string;
}): ResolvedStrategyDeskLeg {
  const intent = buildNonSpotIntent(input.leg);
  intent.wallet = input.walletAddress;
  const maxTradeAmountAtomic =
    intent.collateralAtomic ??
    intent.quantityAtomic ??
    input.leg.intent?.quantityAtomic ??
    "0";
  return {
    leg: input.leg,
    capability: requireRuntimeVenueCapability(input.leg.venueKey),
    adapter: resolveLegAdapter(input.leg),
    policy: buildLegPolicy(input.leg, maxTradeAmountAtomic),
    intent,
  };
}

async function resolveStrategyDeskLeg(input: {
  env: Env;
  leg: RuntimeStrategyDeskScenarioLeg;
  runKind: StrategyDeskExecuteRunKind;
  walletAddress: string;
  context: StrategyDeskRunnerContext;
  deps?: StrategyDeskExecutionDeps;
}): Promise<ResolvedStrategyDeskLeg> {
  const mode = input.runKind as RuntimeMode;
  const capability = requireRuntimeVenueCapability(input.leg.venueKey);
  if (!runtimeVenueSupportsMode(capability, mode)) {
    throw new Error(
      `runtime-strategy-desk-mode-not-supported:${input.leg.legId}:${input.runKind}`,
    );
  }
  if (!runtimeVenueSupportsIntentFamily(capability, input.leg.intentFamily)) {
    throw new Error(
      `runtime-strategy-desk-intent-family-not-supported:${input.leg.legId}:${input.leg.intentFamily}`,
    );
  }
  if (!capability.marketTypes.includes(input.leg.marketType)) {
    throw new Error(
      `runtime-strategy-desk-market-type-not-supported:${input.leg.legId}:${input.leg.marketType}`,
    );
  }
  if (!input.leg.enabledModes.includes(mode)) {
    throw new Error(
      `runtime-strategy-desk-leg-mode-disabled:${input.leg.legId}:${input.runKind}`,
    );
  }
  const adapter = resolveLegAdapter(input.leg);
  if (!runtimeVenueSupportsAdapter(capability, adapter.adapterKey)) {
    throw new Error(
      `runtime-strategy-desk-adapter-not-supported:${input.leg.legId}:${adapter.adapterKey}`,
    );
  }
  if (input.leg.intentFamily === "spot_swap") {
    const resolved = await buildSpotLeg(input);
    return { ...resolved, adapter };
  }
  const resolved = buildNonSpotLeg({
    leg: input.leg,
    walletAddress: input.walletAddress,
  });
  return { ...resolved, adapter };
}

async function executeResolvedLeg(input: {
  env: Env;
  resolved: ResolvedStrategyDeskLeg;
  runKind: StrategyDeskExecuteRunKind;
  walletAddress: string;
  privyWalletId?: string;
  requestRef: string;
  context: StrategyDeskRunnerContext;
  deps?: StrategyDeskExecutionDeps;
}): Promise<ExecuteSwapResult> {
  const execute = input.deps?.executeIntentViaRouter ?? executeIntentViaRouter;
  const spotExecutionInput =
    input.resolved.intent.family === "spot_swap"
      ? (() => {
          if (!input.resolved.quoteResponse) {
            throw new Error(
              `runtime-strategy-desk-spot-quote-missing:${input.resolved.leg.legId}`,
            );
          }
          return {
            quoteResponse: input.resolved.quoteResponse,
            userPublicKey: input.walletAddress,
          };
        })()
      : null;
  return await execute({
    env: input.env,
    venueKey: input.resolved.leg.venueKey,
    runtimeMode: input.runKind,
    requireVenueRouting: true,
    execution: {
      adapter: input.resolved.adapter.adapterKey,
      params: {
        lane: "safe",
        requireSimulation: true,
        ...(input.resolved.intent.family === "spot_swap" &&
        input.resolved.adapter.adapterKey === "jupiter"
          ? {
              composePlan: true,
            }
          : {}),
      },
    },
    policy: input.resolved.policy,
    rpc: input.context.rpc,
    jupiter: input.context.jupiter,
    dflow: input.context.dflow,
    drift: input.context.drift,
    mango: input.context.mango,
    openbook: input.context.openbook,
    orca: input.context.orca,
    raydium: input.context.raydium,
    ...(spotExecutionInput ?? {}),
    privyWalletId: input.privyWalletId,
    intent: input.resolved.intent,
    log(level, message, meta) {
      console[level]("runtime.strategy_desk_runner", {
        scenarioRunId: input.requestRef.split(":")[0],
        legId: input.resolved.leg.legId,
        message,
        ...(meta ?? {}),
      });
    },
  } as Parameters<typeof executeIntentViaRouter>[0]);
}

function buildLegRun(input: {
  run: RuntimeStrategyDeskScenarioRun;
  legId: string;
  stage: RuntimeStrategyDeskScenarioReport["stage"];
  state: RuntimeStrategyDeskScenarioRun["legRuns"][number]["state"];
  requestRef?: string;
  notes?: string;
}): RuntimeStrategyDeskScenarioRun["legRuns"][number] {
  const existing = input.run.legRuns.find(
    (legRun) => legRun.legId === input.legId,
  );
  return {
    legId: input.legId,
    stage: input.stage,
    state: input.state,
    ...(input.requestRef ? { requestRef: input.requestRef } : {}),
    ...((input.notes ?? existing?.notes)
      ? { notes: input.notes ?? existing?.notes }
      : {}),
  };
}

function replaceLegRun(
  run: RuntimeStrategyDeskScenarioRun,
  replacement: RuntimeStrategyDeskScenarioRun["legRuns"][number],
): RuntimeStrategyDeskScenarioRun {
  return {
    ...run,
    legRuns: run.legRuns.map((legRun) =>
      legRun.legId === replacement.legId ? replacement : legRun,
    ),
  };
}

type StrategyDeskScorecard = NonNullable<
  RuntimeStrategyDeskScenarioReport["scorecard"]
>;

type StrategyDeskRiskOverlay = NonNullable<
  RuntimeStrategyDeskScenarioReport["riskOverlays"]
>[number];

type StrategyDeskPortfolioSummary = NonNullable<
  RuntimeStrategyDeskScenarioReport["portfolioSummary"]
>;

type StrategyDeskReportBuildResult = {
  report: RuntimeStrategyDeskScenarioReport;
  terminalState: RuntimeStrategyDeskScenarioRun["state"];
  blockingOverlay: StrategyDeskRiskOverlay | null;
};

function readUsd(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value: number): string {
  return value.toFixed(2);
}

function readLegTargetNotionalUsd(leg: RuntimeStrategyDeskScenarioLeg): number {
  return readUsd(leg.sizing.targetNotionalUsd);
}

function readLegReserveUsd(leg: RuntimeStrategyDeskScenarioLeg): number {
  return readUsd(leg.sizing.reserveUsd ?? leg.sizing.targetNotionalUsd);
}

function readLegGrossExposureUsd(leg: RuntimeStrategyDeskScenarioLeg): number {
  return readLegTargetNotionalUsd(leg);
}

export function readLegNetExposureUsd(
  leg: RuntimeStrategyDeskScenarioLeg,
): number {
  const notional = readLegTargetNotionalUsd(leg);
  const side = String(leg.intent?.side ?? "")
    .trim()
    .toLowerCase();

  switch (leg.intentFamily) {
    case "spot_swap":
    case "conditional_spot_order":
    case "clob_order":
      return side === "sell" ? -notional : notional;
    case "perp_order":
      if (side === "short" || side === "close_long") {
        return -notional;
      }
      return notional;
    case "prediction_order":
      if (side === "buy_no" || side === "sell_yes") {
        return -notional;
      }
      if (side === "sell_no") {
        return notional;
      }
      return notional;
    case "flash_atomic":
      return 0;
    default:
      return 0;
  }
}

function readMaxNotionalUsd(leg: RuntimeStrategyDeskScenarioLeg): number {
  return readUsd(leg.sizing.maxNotionalUsd ?? leg.sizing.targetNotionalUsd);
}

function sumScenarioCapitalAllocatedUsd(
  scenario: RuntimeStrategyDeskScenarioManifest,
): number {
  return scenario.legs.reduce(
    (total, leg) => total + readLegReserveUsd(leg),
    0,
  );
}

function sumScenarioGrossExposureBudgetUsd(
  scenario: RuntimeStrategyDeskScenarioManifest,
): number {
  return scenario.legs.reduce(
    (total, leg) => total + readMaxNotionalUsd(leg),
    0,
  );
}

function buildLegOutcome(input: {
  scenarioRunId: string;
  leg: RuntimeStrategyDeskScenarioLeg;
  artifact?: StrategyDeskRunArtifact;
}): RuntimeStrategyDeskScenarioReport["legOutcomes"][number] {
  const { artifact, leg, scenarioRunId } = input;
  if (!artifact || artifact.status === "skipped") {
    return {
      legId: leg.legId,
      status: "not_applicable",
      evidenceRefs: [
        {
          kind: "strategy_desk_leg_receipt",
          ref: `${scenarioRunId}:${leg.legId}`,
          notes: "leg-skipped",
        },
      ],
      notes: ["leg skipped after upstream failure"],
    };
  }

  const passed =
    artifact.status !== "blocked" &&
    artifact.status !== "skipped" &&
    artifact.status !== "simulate_error" &&
    artifact.status !== "error";

  return {
    legId: leg.legId,
    status: passed ? "pass" : "blocked",
    evidenceRefs: [
      {
        kind: "strategy_desk_leg_receipt",
        ref: artifact.requestRef,
        notes: `${artifact.venueKey}:${artifact.status}`,
      },
    ],
    notes: [
      `adapter:${artifact.adapterKey}`,
      `status:${artifact.status}`,
      ...(artifact.error ? [artifact.error] : []),
    ],
  };
}

function buildScorecardLegMetric(input: {
  leg: RuntimeStrategyDeskScenarioLeg;
  outcome: RuntimeStrategyDeskScenarioReport["legOutcomes"][number];
}): StrategyDeskScorecard["legMetrics"][number] {
  const executed = input.outcome.status === "pass";
  const targetNotionalUsd = readLegTargetNotionalUsd(input.leg);
  const reservedCapitalUsd = executed ? readLegReserveUsd(input.leg) : 0;
  const grossExposureUsd = executed ? readLegGrossExposureUsd(input.leg) : 0;
  const netExposureUsd = executed ? readLegNetExposureUsd(input.leg) : 0;

  return {
    legId: input.leg.legId,
    venueKey: input.leg.venueKey,
    intentFamily: input.leg.intentFamily,
    marketType: input.leg.marketType,
    status: input.outcome.status,
    ...(targetNotionalUsd > 0
      ? { targetNotionalUsd: formatUsd(targetNotionalUsd) }
      : {}),
    ...(reservedCapitalUsd > 0
      ? { reservedCapitalUsd: formatUsd(reservedCapitalUsd) }
      : {}),
    ...(grossExposureUsd > 0
      ? { grossExposureUsd: formatUsd(grossExposureUsd) }
      : {}),
    ...(netExposureUsd !== 0
      ? { netExposureUsd: formatUsd(netExposureUsd) }
      : {}),
    ...(input.outcome.netPnlUsd ? { netPnlUsd: input.outcome.netPnlUsd } : {}),
    ...(input.outcome.costUsd ? { costUsd: input.outcome.costUsd } : {}),
    ...(input.outcome.notes ? { notes: input.outcome.notes } : {}),
  };
}

function sumMetricUsd(
  metrics: StrategyDeskScorecard["legMetrics"],
  key:
    | "reservedCapitalUsd"
    | "grossExposureUsd"
    | "costUsd"
    | "targetNotionalUsd",
): number {
  return metrics.reduce((total, metric) => total + readUsd(metric[key]), 0);
}

function sumMetricNumericUsd(
  metrics: StrategyDeskScorecard["legMetrics"],
  key: "netExposureUsd" | "netPnlUsd",
): number {
  return metrics.reduce((total, metric) => total + readUsd(metric[key]), 0);
}

function addExposure(
  record: Record<string, string>,
  key: string,
  amountUsd: number,
): void {
  if (!key || amountUsd <= 0) return;
  record[key] = formatUsd(readUsd(record[key]) + amountUsd);
}

function buildPortfolioSummary(input: {
  scenario: RuntimeStrategyDeskScenarioManifest;
  legMetrics: StrategyDeskScorecard["legMetrics"];
  legOutcomes: RuntimeStrategyDeskScenarioReport["legOutcomes"];
}): StrategyDeskPortfolioSummary {
  const capitalAllocatedUsd = sumScenarioCapitalAllocatedUsd(input.scenario);
  const grossExposureBudgetUsd = sumScenarioGrossExposureBudgetUsd(
    input.scenario,
  );
  const reservedUsd = sumMetricUsd(input.legMetrics, "reservedCapitalUsd");
  const grossExposureUsd = sumMetricUsd(input.legMetrics, "grossExposureUsd");
  const netExposureUsd = sumMetricNumericUsd(
    input.legMetrics,
    "netExposureUsd",
  );
  const realizedPnlUsd = 0;
  const unrealizedPnlUsd = 0;
  const grossPnlUsd = input.legOutcomes.reduce(
    (total, outcome) =>
      total + readUsd(outcome.netPnlUsd) + readUsd(outcome.costUsd),
    0,
  );
  const netPnlUsd = input.legOutcomes.reduce(
    (total, outcome) => total + readUsd(outcome.netPnlUsd),
    0,
  );
  const equityUsd = capitalAllocatedUsd + realizedPnlUsd + unrealizedPnlUsd;
  const availableUsd = equityUsd - reservedUsd;

  const venueExposureUsd: Record<string, string> = {};
  const venueFamilyExposureUsd: Record<string, string> = {};
  const marketTypeExposureUsd: Record<string, string> = {};
  for (const metric of input.legMetrics) {
    const exposureUsd = readUsd(metric.grossExposureUsd);
    addExposure(venueExposureUsd, metric.venueKey, exposureUsd);
    addExposure(venueFamilyExposureUsd, metric.intentFamily, exposureUsd);
    addExposure(marketTypeExposureUsd, metric.marketType, exposureUsd);
  }

  const activeLegCount = input.legMetrics.filter(
    (metric) => metric.status === "pass",
  ).length;
  const blockedLegCount = input.legMetrics.filter(
    (metric) => metric.status === "blocked",
  ).length;
  const skippedLegCount = input.legMetrics.filter(
    (metric) => metric.status === "not_applicable",
  ).length;

  return {
    capitalAllocatedUsd: formatUsd(capitalAllocatedUsd),
    grossExposureBudgetUsd: formatUsd(grossExposureBudgetUsd),
    equityUsd: formatUsd(equityUsd),
    availableUsd: formatUsd(availableUsd),
    reservedUsd: formatUsd(reservedUsd),
    realizedPnlUsd: formatUsd(realizedPnlUsd),
    unrealizedPnlUsd: formatUsd(unrealizedPnlUsd),
    grossPnlUsd: formatUsd(grossPnlUsd),
    netPnlUsd: formatUsd(netPnlUsd),
    grossExposureUsd: formatUsd(grossExposureUsd),
    netExposureUsd: formatUsd(netExposureUsd),
    maxDrawdownBps: 0,
    tradeCount: activeLegCount,
    activeLegCount,
    venueExposureUsd,
    venueFamilyExposureUsd,
    marketTypeExposureUsd,
    notes: [
      `passed_legs:${activeLegCount}`,
      `blocked_legs:${blockedLegCount}`,
      `skipped_legs:${skippedLegCount}`,
    ],
  };
}

function buildScorecard(input: {
  legMetrics: StrategyDeskScorecard["legMetrics"];
  portfolioSummary: StrategyDeskPortfolioSummary;
}): StrategyDeskScorecard {
  const passedLegCount = input.legMetrics.filter(
    (metric) => metric.status === "pass",
  ).length;
  const blockedLegCount = input.legMetrics.filter(
    (metric) => metric.status === "blocked",
  ).length;
  const skippedLegCount = input.legMetrics.filter(
    (metric) => metric.status === "not_applicable",
  ).length;

  return {
    aggregate: {
      passedLegCount,
      blockedLegCount,
      skippedLegCount,
      activeLegCount: input.portfolioSummary.activeLegCount,
      tradeCount: input.portfolioSummary.tradeCount,
      reservedCapitalUsd: input.portfolioSummary.reservedUsd,
      grossExposureUsd: input.portfolioSummary.grossExposureUsd,
      netExposureUsd: input.portfolioSummary.netExposureUsd,
      grossPnlUsd: input.portfolioSummary.grossPnlUsd,
      netPnlUsd: input.portfolioSummary.netPnlUsd,
      totalCostUsd: formatUsd(sumMetricUsd(input.legMetrics, "costUsd")),
      maxDrawdownBps: input.portfolioSummary.maxDrawdownBps,
    },
    legMetrics: input.legMetrics,
  };
}

function evaluateOverlay(input: {
  overlayId: string;
  category: StrategyDeskRiskOverlay["category"];
  observedValue: number;
  thresholdValue?: number;
  message: string;
  format?: "usd" | "bps";
  legIds?: string[];
}): StrategyDeskRiskOverlay {
  const blocked =
    input.thresholdValue !== undefined &&
    input.observedValue > input.thresholdValue + Number.EPSILON;
  const formatValue = (value: number): string =>
    input.format === "bps" ? String(Math.round(value)) : formatUsd(value);
  return {
    overlayId: input.overlayId,
    category: input.category,
    status: blocked ? "blocked" : "pass",
    observedValue: formatValue(input.observedValue),
    ...(input.thresholdValue !== undefined
      ? { thresholdValue: formatValue(input.thresholdValue) }
      : {}),
    ...(input.legIds && input.legIds.length > 0
      ? { legIds: input.legIds }
      : {}),
    message: input.message,
  };
}

function buildRiskOverlays(input: {
  scenario: RuntimeStrategyDeskScenarioManifest;
  legMetrics: StrategyDeskScorecard["legMetrics"];
  portfolioSummary: StrategyDeskPortfolioSummary;
  terminalState: RuntimeStrategyDeskScenarioRun["state"];
  failureMessage?: string;
}): StrategyDeskRiskOverlay[] {
  const grossExposureBudgetUsd = readUsd(
    input.portfolioSummary.grossExposureBudgetUsd,
  );
  const grossExposureUsd = readUsd(input.portfolioSummary.grossExposureUsd);
  const netExposureUsd = Math.abs(
    readUsd(input.portfolioSummary.netExposureUsd),
  );
  const reservedUsd = readUsd(input.portfolioSummary.reservedUsd);
  const riskLimits = input.scenario.riskLimits ?? {};
  const maxLegMetric = input.legMetrics.reduce(
    (current, metric) => {
      const grossExposure = readUsd(metric.grossExposureUsd);
      if (grossExposure <= current.grossExposureUsd) return current;
      return { legId: metric.legId, grossExposureUsd: grossExposure };
    },
    { legId: "", grossExposureUsd: 0 },
  );
  const venueFamilyEntries = Object.entries(
    input.portfolioSummary.venueFamilyExposureUsd ?? {},
  );
  const maxVenueFamilyEntry = venueFamilyEntries.reduce(
    (current, entry) => {
      const exposure = readUsd(entry[1]);
      if (exposure <= current.exposureUsd) return current;
      return {
        family: entry[0],
        exposureUsd: exposure,
      };
    },
    { family: "", exposureUsd: 0 },
  );
  const maxLegConcentrationBps =
    grossExposureBudgetUsd > 0
      ? (maxLegMetric.grossExposureUsd / grossExposureBudgetUsd) * 10_000
      : 0;
  const maxVenueFamilyConcentrationBps =
    grossExposureBudgetUsd > 0
      ? (maxVenueFamilyEntry.exposureUsd / grossExposureBudgetUsd) * 10_000
      : 0;

  const overlays: StrategyDeskRiskOverlay[] = [
    evaluateOverlay({
      overlayId: "reserved-capital",
      category: "capital",
      observedValue: reservedUsd,
      thresholdValue: riskLimits.maxReservedCapitalUsd
        ? readUsd(riskLimits.maxReservedCapitalUsd)
        : readUsd(input.portfolioSummary.capitalAllocatedUsd),
      message: "Reserved capital remains within the configured desk budget.",
    }),
    evaluateOverlay({
      overlayId: "gross-exposure",
      category: "exposure",
      observedValue: grossExposureUsd,
      thresholdValue: riskLimits.maxGrossExposureUsd
        ? readUsd(riskLimits.maxGrossExposureUsd)
        : grossExposureBudgetUsd,
      message: "Gross exposure remains within the configured composite budget.",
    }),
    evaluateOverlay({
      overlayId: "net-exposure",
      category: "exposure",
      observedValue: netExposureUsd,
      thresholdValue: riskLimits.maxNetExposureUsd
        ? readUsd(riskLimits.maxNetExposureUsd)
        : grossExposureBudgetUsd,
      message:
        "Net directional exposure remains within the configured desk budget.",
    }),
    evaluateOverlay({
      overlayId: "leg-concentration",
      category: "concentration",
      observedValue: maxLegConcentrationBps,
      thresholdValue: riskLimits.maxLegConcentrationBps ?? 10_000,
      format: "bps",
      ...(maxLegMetric.legId ? { legIds: [maxLegMetric.legId] } : {}),
      message: "No single leg breaches the configured concentration bound.",
    }),
    evaluateOverlay({
      overlayId: "venue-family-concentration",
      category: "venue_family",
      observedValue: maxVenueFamilyConcentrationBps,
      thresholdValue: riskLimits.maxVenueFamilyConcentrationBps ?? 10_000,
      format: "bps",
      message: "Venue-family concentration remains within configured bounds.",
    }),
    evaluateOverlay({
      overlayId: "drawdown",
      category: "margin",
      observedValue: input.portfolioSummary.maxDrawdownBps ?? 0,
      thresholdValue: riskLimits.maxDrawdownBps ?? 10_000,
      format: "bps",
      message: "Observed drawdown remains within the configured desk limit.",
    }),
    {
      overlayId: "failure-state-demotion",
      category: "failure_state",
      status:
        input.terminalState === "failed" || input.terminalState === "rejected"
          ? "blocked"
          : "pass",
      observedValue: input.terminalState,
      thresholdValue: "completed",
      message:
        input.terminalState === "failed" || input.terminalState === "rejected"
          ? (input.failureMessage ??
            "A leg or overlay failed, so the composite desk result was demoted.")
          : "Composite execution completed without fail-closed demotion.",
    },
  ];

  return overlays;
}

function buildReport(input: {
  scenario: RuntimeStrategyDeskScenarioManifest;
  run: RuntimeStrategyDeskScenarioRun;
  runKind: StrategyDeskExecuteRunKind;
  terminalState: RuntimeStrategyDeskScenarioRun["state"];
  failureMessage?: string;
  generatedAt: string;
  reportId: string;
  artifacts: Record<string, StrategyDeskRunArtifact>;
}): StrategyDeskReportBuildResult {
  const legOutcomes = input.scenario.legs.map((leg) =>
    buildLegOutcome({
      scenarioRunId: input.run.scenarioRunId,
      leg,
      artifact: input.artifacts[leg.legId],
    }),
  );
  const legMetrics = legOutcomes.map((outcome, index) => {
    const leg = input.scenario.legs[index];
    if (!leg) {
      throw new Error(
        `runtime-strategy-desk-leg-outcome-mismatch:${input.scenario.scenarioId}:${index}`,
      );
    }
    return buildScorecardLegMetric({
      leg,
      outcome,
    });
  });
  const portfolioSummary = buildPortfolioSummary({
    scenario: input.scenario,
    legMetrics,
    legOutcomes,
  });
  const scorecard = buildScorecard({
    legMetrics,
    portfolioSummary,
  });
  const passedCount = legOutcomes.filter(
    (outcome) => outcome.status === "pass",
  ).length;
  const blockedCount = legOutcomes.filter(
    (outcome) => outcome.status === "blocked",
  ).length;
  let reportTerminalState = input.terminalState;
  let riskOverlays = buildRiskOverlays({
    scenario: input.scenario,
    legMetrics,
    portfolioSummary,
    terminalState: reportTerminalState,
    failureMessage: input.failureMessage,
  });
  const blockingOverlay =
    reportTerminalState === "completed"
      ? (riskOverlays.find((overlay) => overlay.status === "blocked") ?? null)
      : null;
  if (blockingOverlay) {
    reportTerminalState = "rejected";
    riskOverlays = buildRiskOverlays({
      scenario: input.scenario,
      legMetrics,
      portfolioSummary,
      terminalState: reportTerminalState,
      failureMessage: blockingOverlay.message,
    });
  }
  const overallStatus =
    blockedCount > 0 ||
    riskOverlays.some((overlay) => overlay.status === "blocked") ||
    reportTerminalState === "failed" ||
    reportTerminalState === "rejected"
      ? ("blocked" as const)
      : ("pass" as const);
  const stage = stageForRunKind(input.runKind);
  return {
    terminalState: reportTerminalState,
    blockingOverlay,
    report: {
      schemaVersion: "v1",
      reportId: input.reportId,
      scenarioId: input.scenario.scenarioId,
      scenarioRunId: input.run.scenarioRunId,
      stage,
      status: overallStatus,
      summary:
        overallStatus === "pass"
          ? `Composite ${input.runKind} scenario completed with ${passedCount}/${input.scenario.legs.length} successful legs.`
          : `Composite ${input.runKind} scenario failed closed after ${blockedCount + riskOverlays.filter((overlay) => overlay.status === "blocked").length} blocked condition(s).`,
      generatedAt: input.generatedAt,
      legOutcomes,
      portfolioSummary,
      scorecard,
      riskOverlays,
      evidence: [
        {
          stage,
          summary: `Composite ${input.runKind} run evidence for ${input.scenario.title}.`,
          evidenceRefs: [
            {
              kind: "strategy_desk_run",
              ref: input.run.scenarioRunId,
            },
            ...Object.values(input.artifacts).map((artifact) => ({
              kind: "strategy_desk_leg_receipt",
              ref: artifact.requestRef,
              notes: `${artifact.venueKey}:${artifact.status}`,
            })),
          ],
          latestReportId: input.reportId,
        },
      ],
      checks: [
        {
          checkId: "scenario-ready-state",
          status: "pass",
          observedValue: input.scenario.state,
          thresholdValue:
            input.runKind === "shadow" ? "shadow_ready+" : "paper_ready+",
          message: "Scenario state allowed composite execution.",
        },
        {
          checkId: "legs-completed",
          status: blockedCount > 0 ? "blocked" : "pass",
          observedValue: `${passedCount}/${input.scenario.legs.length}`,
          thresholdValue: `${input.scenario.legs.length}/${input.scenario.legs.length}`,
          message:
            blockedCount === 0
              ? "The composite run captured per-leg execution receipts for every leg."
              : "At least one leg failed or was unsupported, so the scenario failed closed.",
        },
        {
          checkId: "portfolio-scorecard",
          status: "pass",
          observedValue: `active=${scorecard.aggregate.activeLegCount ?? 0}, gross=${scorecard.aggregate.grossExposureUsd ?? "0.00"}, net=${scorecard.aggregate.netExposureUsd ?? "0.00"}`,
          thresholdValue: "aggregate + per-leg scorecard present",
          message:
            "Scenario report includes unified desk ledger totals and per-leg metrics.",
        },
        {
          checkId: "risk-overlays",
          status: riskOverlays.some((overlay) => overlay.status === "blocked")
            ? "blocked"
            : "pass",
          observedValue: `${riskOverlays.filter((overlay) => overlay.status === "blocked").length}/${riskOverlays.length}`,
          thresholdValue: "0 blocked overlays",
          message: riskOverlays.some((overlay) => overlay.status === "blocked")
            ? "At least one cross-leg risk overlay blocked the scenario."
            : "Cross-leg risk overlays remained within configured bounds.",
        },
        {
          checkId: "router-gates-enforced",
          status: "pass",
          message:
            "Each leg ran through the existing Worker router with venue capability checks enabled.",
        },
      ],
      approvals: [],
      metadata: {
        runKind: input.runKind,
        artifacts: input.artifacts,
      },
    },
  };
}

export async function executeRuntimeStrategyDeskScenarioWorkflow(
  input: RuntimeStrategyDeskExecuteWorkflowInput,
  deps?: StrategyDeskExecutionDeps,
): Promise<RuntimeStrategyDeskExecuteWorkflowResult> {
  const { scenario } = await getRuntimeStrategyDeskScenarioWorkflow({
    env: input.env,
    scenarioId: input.scenarioId,
  });
  if (!scenarioStateAllowsRun(scenario, input.runKind)) {
    throw new Error(
      `runtime-strategy-desk-scenario-state-not-ready:${scenario.scenarioId}:${scenario.state}:${input.runKind}`,
    );
  }

  const stage = stageForRunKind(input.runKind);
  const createdAt = nowIso(deps);
  const orderedLegs = topologicalScenarioLegs(scenario);
  let run: RuntimeStrategyDeskScenarioRun = {
    schemaVersion: "v1",
    scenarioRunId:
      input.scenarioRunId ??
      createDeskId(`desk_run_${scenario.scenarioId}_${input.runKind}`, deps),
    scenarioId: scenario.scenarioId,
    scenarioState: scenario.state,
    runKind: input.runKind,
    state: "pending",
    requestedBy: input.requestedBy,
    trigger: defaultTrigger(createdAt, input.trigger),
    createdAt,
    updatedAt: createdAt,
    legRuns: defaultLegRuns(scenario, stage),
    metadata: {
      walletAddress: input.walletAddress,
      maxRetriesPerLeg: readPositiveInt(input.maxRetriesPerLeg, 0),
    },
  };
  run = (
    await upsertRuntimeStrategyDeskScenarioRunWorkflow({
      env: input.env,
      run,
    })
  ).run;

  const context = buildRunnerContext(input.env, deps);
  const artifacts: Record<string, StrategyDeskRunArtifact> = {};
  const maxRetriesPerLeg = readPositiveInt(input.maxRetriesPerLeg, 0);

  run = (
    await upsertRuntimeStrategyDeskScenarioRunWorkflow({
      env: input.env,
      run: {
        ...run,
        state: "legs_requested",
        startedAt: createdAt,
        updatedAt: nowIso(deps),
        metadata: {
          ...(run.metadata ?? {}),
          orderedLegIds: orderedLegs.map((leg) => leg.legId),
        },
      },
    })
  ).run;

  let terminalState: RuntimeStrategyDeskScenarioRun["state"] = "completed";
  let failureCode: string | undefined;
  let failureMessage: string | undefined;

  for (const leg of orderedLegs) {
    const requestRef = `${run.scenarioRunId}:${leg.legId}`;
    run = (
      await upsertRuntimeStrategyDeskScenarioRunWorkflow({
        env: input.env,
        run: replaceLegRun(
          {
            ...run,
            state: "legs_running",
            updatedAt: nowIso(deps),
          },
          buildLegRun({
            run,
            legId: leg.legId,
            stage,
            state: "submitted",
            requestRef,
            notes: `queued:${leg.venueKey}:${leg.intentFamily}`,
          }),
        ),
      })
    ).run;

    let result: ExecuteSwapResult | null = null;
    let attemptCount = 0;
    try {
      const resolved = await resolveStrategyDeskLeg({
        env: input.env,
        leg,
        runKind: input.runKind,
        walletAddress: input.walletAddress,
        context,
        deps,
      });

      while (attemptCount <= maxRetriesPerLeg) {
        attemptCount += 1;
        result = await executeResolvedLeg({
          env: input.env,
          resolved,
          runKind: input.runKind,
          walletAddress: input.walletAddress,
          privyWalletId: input.privyWalletId,
          requestRef,
          context,
          deps,
        });
        if (isExecutionSuccessStatus(result.status)) {
          break;
        }
      }

      const artifact: StrategyDeskRunArtifact = {
        legId: leg.legId,
        attemptCount,
        adapterKey: resolved.adapter.adapterKey,
        venueKey: leg.venueKey,
        requestRef,
        status: result?.status ?? "blocked",
        signature: result?.signature ?? null,
        ...(result?.usedQuote
          ? {
              quote: {
                inputMint: String(result.usedQuote.inputMint ?? ""),
                outputMint: String(result.usedQuote.outputMint ?? ""),
                inAmount: String(result.usedQuote.inAmount ?? ""),
                outAmount: String(result.usedQuote.outAmount ?? ""),
              },
            }
          : {}),
        executionMeta: summarizeExecutionMeta(result?.executionMeta),
        ...(result && !isExecutionSuccessStatus(result.status)
          ? {
              error: readExecutionError(result.err),
              errorCode: readExecutionErrorCode(result.err) ?? result.status,
            }
          : {}),
      };
      artifacts[leg.legId] = artifact;

      if (!result || !isExecutionSuccessStatus(result.status)) {
        terminalState = "failed";
        failureCode =
          artifact.errorCode ?? "strategy-desk-leg-execution-failed";
        failureMessage =
          artifact.error ??
          `strategy-desk-leg-execution-failed:${leg.legId}:${artifact.status}`;
        run = replaceLegRun(
          run,
          buildLegRun({
            run,
            legId: leg.legId,
            stage,
            state: "failed",
            requestRef,
            notes: failureMessage,
          }),
        );
        break;
      }

      run = replaceLegRun(
        run,
        buildLegRun({
          run,
          legId: leg.legId,
          stage,
          state: "completed",
          requestRef,
          notes: `completed:${result.status}`,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      artifacts[leg.legId] = {
        legId: leg.legId,
        attemptCount: Math.max(1, attemptCount),
        adapterKey: leg.intent?.adapterKey ?? defaultAdapterKey(leg),
        venueKey: leg.venueKey,
        requestRef,
        status: "blocked",
        signature: null,
        error: message,
        errorCode: message.split(":")[0] || "strategy-desk-leg-blocked",
      };
      terminalState =
        message.includes("not-supported") || message.includes("disabled")
          ? "rejected"
          : "failed";
      failureCode = message.split(":")[0] || "strategy-desk-leg-blocked";
      failureMessage = message;
      run = replaceLegRun(
        run,
        buildLegRun({
          run,
          legId: leg.legId,
          stage,
          state: "failed",
          requestRef,
          notes: message,
        }),
      );
      break;
    }
  }

  if (terminalState !== "completed") {
    run = {
      ...run,
      legRuns: run.legRuns.map((legRun) =>
        legRun.state === "pending"
          ? {
              ...legRun,
              state: "skipped",
              notes: "skipped after prior leg failure",
            }
          : legRun,
      ),
    };
    for (const legRun of run.legRuns) {
      if (legRun.state === "skipped") {
        const scenarioLeg =
          scenario.legs.find((leg) => leg.legId === legRun.legId) ?? null;
        artifacts[legRun.legId] = {
          legId: legRun.legId,
          attemptCount: 0,
          adapterKey: scenarioLeg
            ? (scenarioLeg.intent?.adapterKey ?? defaultAdapterKey(scenarioLeg))
            : "unknown",
          venueKey: scenarioLeg?.venueKey ?? "unknown",
          requestRef: `${run.scenarioRunId}:${legRun.legId}`,
          status: "skipped",
          signature: null,
        };
      }
    }
  }

  const collectingAt = nowIso(deps);
  run = (
    await upsertRuntimeStrategyDeskScenarioRunWorkflow({
      env: input.env,
      run: {
        ...run,
        state: "collecting_evidence",
        updatedAt: collectingAt,
        ...(failureCode ? { failureCode } : {}),
        ...(failureMessage ? { failureMessage } : {}),
        metadata: {
          ...(run.metadata ?? {}),
          artifacts,
        },
      },
    })
  ).run;

  const completedAt = nowIso(deps);
  const reportBuild = buildReport({
    scenario,
    run,
    runKind: input.runKind,
    terminalState,
    failureMessage,
    generatedAt: completedAt,
    reportId:
      input.reportId ??
      createDeskId(`desk_report_${scenario.scenarioId}_${input.runKind}`, deps),
    artifacts,
  });
  terminalState = reportBuild.terminalState;
  if (terminalState === "rejected" && !failureCode) {
    failureCode = "strategy-desk-risk-overlay-blocked";
  }
  if (terminalState === "rejected" && !failureMessage) {
    failureMessage =
      reportBuild.blockingOverlay?.message ??
      "Scenario exceeded a configured cross-leg risk overlay.";
  }
  const report = (
    await upsertRuntimeStrategyDeskScenarioReportWorkflow({
      env: input.env,
      report: reportBuild.report,
    })
  ).report;

  run = (
    await upsertRuntimeStrategyDeskScenarioRunWorkflow({
      env: input.env,
      run: {
        ...run,
        state: terminalState,
        updatedAt: completedAt,
        completedAt,
        ...(failureCode ? { failureCode } : {}),
        ...(failureMessage ? { failureMessage } : {}),
        metadata: {
          ...(run.metadata ?? {}),
          latestReportId: report.reportId,
          artifacts,
        },
      },
    })
  ).run;

  return {
    scenario,
    run,
    report,
  };
}
