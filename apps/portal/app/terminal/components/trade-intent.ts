export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;

export type TradeDirection = "buy" | "sell";

export type TradeIntent = {
  source: string;
  reason: string;
  direction: TradeDirection;
  inputMint: string;
  outputMint: string;
  inputSymbol: "SOL" | "USDC";
  outputSymbol: "SOL" | "USDC";
  amountUi: string;
  slippageBps: number;
};

export function createSolUsdcIntent(
  direction: TradeDirection,
  source: string,
  opts?: {
    reason?: string;
    amountUi?: string;
    slippageBps?: number;
  },
): TradeIntent {
  const buy = direction === "buy";
  return {
    source,
    reason: opts?.reason ?? (buy ? "Bullish setup" : "Risk-off setup"),
    direction,
    inputMint: buy ? USDC_MINT : SOL_MINT,
    outputMint: buy ? SOL_MINT : USDC_MINT,
    inputSymbol: buy ? "USDC" : "SOL",
    outputSymbol: buy ? "SOL" : "USDC",
    amountUi: opts?.amountUi ?? (buy ? "50" : "0.25"),
    slippageBps: opts?.slippageBps ?? 50,
  };
}
