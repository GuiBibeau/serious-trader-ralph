import {
  DEFAULT_PAIR_ID,
  getPairConfig,
  type PairId,
  TOKEN_CONFIGS,
  type TokenSymbol,
} from "./trade-pairs";

export type TradeDirection = "buy" | "sell";

export type TradeIntent = {
  pairId: PairId;
  source: string;
  reason: string;
  direction: TradeDirection;
  inputMint: string;
  outputMint: string;
  inputSymbol: TokenSymbol;
  outputSymbol: TokenSymbol;
  inputDecimals: number;
  outputDecimals: number;
  inputMinAmountUi: string;
  amountPresets: readonly string[];
  amountUi: string;
  slippageBps: number;
};

export function createTradeIntent(
  direction: TradeDirection,
  source: string,
  pairId: PairId = DEFAULT_PAIR_ID,
  opts?: {
    reason?: string;
    amountUi?: string;
    slippageBps?: number;
  },
): TradeIntent {
  const pair = getPairConfig(pairId);
  const buy = direction === "buy";
  const inputSymbol = buy ? pair.quoteSymbol : pair.baseSymbol;
  const outputSymbol = buy ? pair.baseSymbol : pair.quoteSymbol;
  const inputToken = TOKEN_CONFIGS[inputSymbol];
  const outputToken = TOKEN_CONFIGS[outputSymbol];

  return {
    pairId: pair.id,
    source,
    reason:
      opts?.reason ?? (buy ? `Buy ${outputSymbol}` : `Sell ${inputSymbol}`),
    direction,
    inputMint: inputToken.mint,
    outputMint: outputToken.mint,
    inputSymbol,
    outputSymbol,
    inputDecimals: inputToken.decimals,
    outputDecimals: outputToken.decimals,
    inputMinAmountUi: inputToken.minAmountUi,
    amountPresets: inputToken.amountPresets,
    amountUi: opts?.amountUi ?? inputToken.amountPresets[1] ?? "1",
    slippageBps: opts?.slippageBps ?? 50,
  };
}

export function createSolUsdcIntent(
  direction: TradeDirection,
  source: string,
  opts?: {
    reason?: string;
    amountUi?: string;
    slippageBps?: number;
  },
): TradeIntent {
  return createTradeIntent(direction, source, "SOL/USDC", opts);
}
