import type { AgentStrategy } from "./types";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function defaultAgentStrategy(): AgentStrategy {
  return {
    type: "agent",
    mandate:
      "Operate as an aggressive, opportunistic Solana quant trader. Maximize absolute PnL, rotate quickly into high-conviction opportunities, and use any policy-allowed mint pair including DeFi and meme assets when edge is present. Keep thesis updates explicit and execution decisive. Network note: x402 payments are Solana devnet for testing, while agentic market/trade tools ALWAYS use mainnet data/liquidity and may reference assets not available on devnet.",
    minConfidence: "low",
    maxStepsPerTick: 8,
    maxToolCallsPerStep: 8,
    quoteMint: USDC_MINT,
    quoteDecimals: 6,
  };
}
