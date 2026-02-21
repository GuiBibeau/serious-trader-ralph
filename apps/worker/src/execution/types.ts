import type { JupiterClient, JupiterQuoteResponse } from "../jupiter";
import type { NormalizedPolicy } from "../policy";
import type { SolanaRpc } from "../solana_rpc";
import type { Env, ExecutionConfig } from "../types";

export type ExecutionLogFn = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
) => void;

export type ExecuteSwapInput = {
  env: Env;
  execution?: ExecutionConfig;
  policy: NormalizedPolicy;
  rpc: SolanaRpc;
  jupiter: JupiterClient;
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
