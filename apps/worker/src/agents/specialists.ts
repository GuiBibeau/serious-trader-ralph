import type { ProviderSnapshot } from "../inference_provider";
import type { JupiterClient } from "../jupiter";
import type { NormalizedPolicy } from "../policy";
import { gatherMarketSnapshot } from "../research";
import type { SolanaRpc } from "../solana_rpc";
import { listTrades, type TradeIndexResult } from "../trade_index";
import type { AgentMemory, AgentStrategy, Env, MarketSnapshot } from "../types";

export type SpecialistRuntime = {
  env: Env;
  tenantId: string;
  wallet: string;
  policy: NormalizedPolicy;
  strategy: AgentStrategy;
  rpc: SolanaRpc;
  jupiter: JupiterClient;
  provider: ProviderSnapshot;
};

export type ResearchSpecialistResult = {
  snapshot: MarketSnapshot;
  recentTrades: TradeIndexResult[];
  providerBaseUrlHash: string;
};

export type RiskSpecialistResult = {
  blocked: boolean;
  reasons: string[];
  providerBaseUrlHash: string;
};

export async function runResearchSpecialist(
  runtime: SpecialistRuntime,
  deps?: {
    gatherSnapshot?: typeof gatherMarketSnapshot;
    listRecentTrades?: typeof listTrades;
  },
): Promise<ResearchSpecialistResult> {
  const gatherSnapshot = deps?.gatherSnapshot ?? gatherMarketSnapshot;
  const listRecentTrades = deps?.listRecentTrades ?? listTrades;
  const [snapshot, recentTrades] = await Promise.all([
    gatherSnapshot(
      runtime.rpc,
      runtime.jupiter,
      runtime.wallet,
      runtime.policy,
      {
        quoteMint: runtime.strategy.quoteMint,
        quoteDecimals: runtime.strategy.quoteDecimals,
      },
    ),
    listRecentTrades(runtime.env, runtime.tenantId, 10),
  ]);
  return {
    snapshot,
    recentTrades,
    providerBaseUrlHash: runtime.provider.baseUrlHash,
  };
}

export async function runRiskSpecialist(input: {
  runtime: SpecialistRuntime;
  memory: AgentMemory;
}): Promise<RiskSpecialistResult> {
  const reasons: string[] = [];
  const mandate = String(input.runtime.strategy.mandate ?? "").trim();
  if (!mandate && !input.memory.thesis.trim()) {
    reasons.push("missing-mandate-and-thesis");
  }
  if (input.runtime.provider.lastPingError) {
    reasons.push("provider-last-ping-failed");
  }
  return {
    blocked: reasons.length > 0,
    reasons,
    providerBaseUrlHash: input.runtime.provider.baseUrlHash,
  };
}
