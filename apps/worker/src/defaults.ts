import type { AgentStrategy } from "./types";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function defaultAgentStrategy(): AgentStrategy {
  return {
    type: "agent",
    mandate:
      "Operate as a cautious SOL/USDC trading agent. Research before acting. Build and maintain a clear thesis. Prefer no trade over a bad trade. Log observations and update thesis when the market changes.",
    minConfidence: "medium",
    maxTradesPerDay: 2,
    maxStepsPerTick: 4,
    maxToolCallsPerStep: 4,
    quoteMint: USDC_MINT,
    quoteDecimals: 6,
  };
}
