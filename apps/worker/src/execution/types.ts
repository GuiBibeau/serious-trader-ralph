import type { DFlowClient } from "../dflow";
import type { DriftClient } from "../drift";
import type { JupiterClient, JupiterQuoteResponse } from "../jupiter";
import type { MangoClient } from "../mango";
import type { OpenBookClient } from "../openbook";
import type { OrcaClient } from "../orca";
import type { NormalizedPolicy } from "../policy";
import type { RaydiumClient } from "../raydium";
import type { RuntimeMode } from "../runtime_contracts";
import type { SolanaRpc } from "../solana_rpc";
import type { Env, ExecutionConfig } from "../types";
import type { LowLatencyExecutionMeta } from "./low_latency";

export type ExecutionLogFn = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
) => void;

export type ExecutionIntentFamily =
  | "spot_swap"
  | "conditional_spot_order"
  | "clob_order"
  | "perp_order"
  | "prediction_order"
  | "flash_atomic";

export type ExecutionIntentLifecycleSnapshot = {
  orderState?:
    | "accepted"
    | "open"
    | "triggered"
    | "partially_filled"
    | "filled"
    | "cancel_requested"
    | "cancelled"
    | "expired"
    | "rejected";
  fillState?: "pending" | "partial" | "filled" | "settled" | "failed";
  positionState?:
    | "flat"
    | "opening"
    | "open"
    | "closing"
    | "closed"
    | "liquidating"
    | "liquidated";
  settlementState?:
    | "pending"
    | "landed"
    | "confirmed"
    | "finalized"
    | "redeemed"
    | "failed";
  notes?: string[];
};

export type SpotSwapExecutionIntent = {
  family: "spot_swap";
  wallet: string;
  venueKey?: string;
  marketType: "spot";
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  slippageBps: number;
  lifecycle?: ExecutionIntentLifecycleSnapshot;
};

export type NonSwapExecutionIntent = {
  family: Exclude<ExecutionIntentFamily, "spot_swap">;
  wallet: string;
  venueKey: string;
  marketType: "spot" | "perp" | "prediction";
  instrumentId: string;
  outcomeId?: string;
  side?: string;
  quantityAtomic?: string;
  collateralAtomic?: string;
  referenceId?: string;
  settlementMint?: string;
  borrowLegs?: Array<{
    provider: string;
    mint: string;
    amountAtomic: string;
  }>;
  params?: Record<string, unknown> | null;
  lifecycle?: ExecutionIntentLifecycleSnapshot;
};

export type ExecutionRouterIntent =
  | SpotSwapExecutionIntent
  | NonSwapExecutionIntent;

type ExecuteIntentInputBase = {
  env: Env;
  venueKey?: string;
  runtimeMode?: RuntimeMode;
  requireVenueRouting?: boolean;
  subjectControlBypassReason?: "strategy_lab_readiness_canary";
  execution?: ExecutionConfig;
  policy: NormalizedPolicy;
  rpc: SolanaRpc;
  jupiter: JupiterClient;
  dflow?: DFlowClient;
  drift?: DriftClient;
  mango?: MangoClient;
  orca?: OrcaClient;
  openbook?: OpenBookClient;
  raydium?: RaydiumClient;
  log: ExecutionLogFn;
  guardEnabled?: () => Promise<void>;
  privyWalletId?: string;
};

export type ExecuteIntentInput =
  | (ExecuteIntentInputBase & {
      intent: SpotSwapExecutionIntent;
      quoteResponse: JupiterQuoteResponse;
      userPublicKey: string;
    })
  | (ExecuteIntentInputBase & {
      intent: NonSwapExecutionIntent;
      quoteResponse?: never;
      userPublicKey?: string;
    });

export type ExecuteSwapInput = {
  env: Env;
  venueKey?: string;
  runtimeMode?: RuntimeMode;
  requireVenueRouting?: boolean;
  subjectControlBypassReason?: "strategy_lab_readiness_canary";
  execution?: ExecutionConfig;
  policy: NormalizedPolicy;
  rpc: SolanaRpc;
  jupiter: JupiterClient;
  orca?: OrcaClient;
  raydium?: RaydiumClient;
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
  privyWalletId?: string;
  log: ExecutionLogFn;
  guardEnabled?: () => Promise<void>;
};

export type ExecuteSwapResult = {
  status:
    | "dry_run"
    | "simulated"
    | "simulate_error"
    | "processed"
    | "confirmed"
    | "finalized"
    | "error";
  signature: string | null;
  usedQuote: JupiterQuoteResponse;
  refreshed: boolean;
  lastValidBlockHeight: number | null;
  err?: unknown;
  executionMeta?: {
    route: string;
    classification:
      | "dry_run"
      | "simulated"
      | "submitted"
      | "landed"
      | "confirmed"
      | "finalized"
      | "error";
    bundleId?: string | null;
    tipAccount?: string | null;
    intentId?: string | null;
    venueSessionId?: string | null;
    settlementRef?: string | null;
    lifecycle?: ExecutionIntentLifecycleSnapshot;
    lowLatency?: LowLatencyExecutionMeta;
    referencePrice?: {
      verdict: "allow" | "pause" | "reject";
      reason: string | null;
      executionPrice: string | null;
      executionDivergenceBps: number | null;
      snapshot?: Record<string, unknown> | null;
    };
    composedPlan?: {
      mode: "instructions" | "prebuilt_fallback" | "flash_atomic";
      fallbackReason?: string | null;
      routeHopCount: number;
      routeLabels: string[];
      instructionCount: number;
      computeBudgetInstructionCount: number;
      setupInstructionCount: number;
      cleanupInstructionCount: number;
      otherInstructionCount: number;
      addressLookupTableCount: number;
      addressLookupTableAddresses?: string[];
      computeUnitLimit: number | null;
      computeUnitPriceMicroLamports: string | null;
      simulationUnitsConsumed?: number | null;
      flashBorrowLegCount?: number;
      flashProviderCount?: number;
      flashBorrowMints?: string[];
      flashProviderLegs?: Array<{
        provider: string;
        mint: string;
        amountAtomic: string;
        estimatedFeeAtomic: string;
      }>;
      flashEstimatedFeeByMint?: Record<string, string>;
      settlementMint?: string | null;
    };
    trace?: {
      txBuiltAt?: string;
      simulatedAt?: string;
      sentAt?: string;
      landedAt?: string;
      confirmedAt?: string;
      finalizedAt?: string;
      failedAt?: string;
    };
  };
};
