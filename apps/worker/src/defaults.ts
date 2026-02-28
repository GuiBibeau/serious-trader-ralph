export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type SupportedTradingToken = {
  symbol: string;
  mint: string;
  decimals: number;
};

export type SupportedTradingPair = {
  id: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseMint: string;
  quoteMint: string;
};

export const SUPPORTED_TRADING_TOKENS: SupportedTradingToken[] = [
  {
    symbol: "SOL",
    mint: SOL_MINT,
    decimals: 9,
  },
  {
    symbol: "USDC",
    mint: USDC_MINT,
    decimals: 6,
  },
  {
    symbol: "USDT",
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
  },
  {
    symbol: "PYUSD",
    mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    decimals: 6,
  },
  {
    symbol: "USD1",
    mint: "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
    decimals: 6,
  },
  {
    symbol: "USDG",
    mint: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
    decimals: 6,
  },
  {
    symbol: "JITOSOL",
    mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    decimals: 9,
  },
  {
    symbol: "MSOL",
    mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    decimals: 9,
  },
  {
    symbol: "JUPSOL",
    mint: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
    decimals: 9,
  },
  {
    symbol: "RAY",
    mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    decimals: 6,
  },
  {
    symbol: "WIF",
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    decimals: 6,
  },
  {
    symbol: "JUP",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    decimals: 6,
  },
  {
    symbol: "BONK",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    decimals: 5,
  },
  {
    symbol: "JTO",
    mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    decimals: 9,
  },
  {
    symbol: "PYTH",
    mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    decimals: 6,
  },
];

const TRADING_TOKEN_BY_SYMBOL: Record<string, SupportedTradingToken> =
  SUPPORTED_TRADING_TOKENS.reduce<Record<string, SupportedTradingToken>>(
    (acc, token) => {
      acc[token.symbol] = token;
      return acc;
    },
    {},
  );

const SUPPORTED_TRADING_PAIR_SYMBOLS: Array<{
  id: string;
  baseSymbol: string;
  quoteSymbol: string;
}> = [
  { id: "SOL/USDC", baseSymbol: "SOL", quoteSymbol: "USDC" },
  { id: "SOL/USDT", baseSymbol: "SOL", quoteSymbol: "USDT" },
  { id: "USDC/USDT", baseSymbol: "USDC", quoteSymbol: "USDT" },
  { id: "USDC/PYUSD", baseSymbol: "USDC", quoteSymbol: "PYUSD" },
  { id: "USDC/USD1", baseSymbol: "USDC", quoteSymbol: "USD1" },
  { id: "USDC/USDG", baseSymbol: "USDC", quoteSymbol: "USDG" },
  { id: "SOL/JITOSOL", baseSymbol: "SOL", quoteSymbol: "JITOSOL" },
  { id: "SOL/MSOL", baseSymbol: "SOL", quoteSymbol: "MSOL" },
  { id: "SOL/JUPSOL", baseSymbol: "SOL", quoteSymbol: "JUPSOL" },
  { id: "RAY/USDC", baseSymbol: "RAY", quoteSymbol: "USDC" },
  { id: "WIF/USDC", baseSymbol: "WIF", quoteSymbol: "USDC" },
  { id: "JUP/USDC", baseSymbol: "JUP", quoteSymbol: "USDC" },
  { id: "BONK/USDC", baseSymbol: "BONK", quoteSymbol: "USDC" },
  { id: "JTO/USDC", baseSymbol: "JTO", quoteSymbol: "USDC" },
  { id: "PYTH/USDC", baseSymbol: "PYTH", quoteSymbol: "USDC" },
];

export const SUPPORTED_TRADING_PAIRS: SupportedTradingPair[] =
  SUPPORTED_TRADING_PAIR_SYMBOLS.map((pair) => {
    const base = TRADING_TOKEN_BY_SYMBOL[pair.baseSymbol];
    const quote = TRADING_TOKEN_BY_SYMBOL[pair.quoteSymbol];
    if (!base || !quote) {
      throw new Error(`invalid-supported-trading-pair:${pair.id}`);
    }
    return {
      id: pair.id,
      baseSymbol: pair.baseSymbol,
      quoteSymbol: pair.quoteSymbol,
      baseMint: base.mint,
      quoteMint: quote.mint,
    };
  });

export const SUPPORTED_TRADING_PAIR_IDS = SUPPORTED_TRADING_PAIRS.map(
  (pair) => pair.id,
);

export const SUPPORTED_TRADING_MINTS = SUPPORTED_TRADING_TOKENS.map(
  (token) => token.mint,
);

export const SUPPORTED_WALLET_TOKEN_BALANCES = SUPPORTED_TRADING_TOKENS.filter(
  (token) => token.mint !== SOL_MINT,
);

export const TRADING_TOKEN_BY_MINT: Record<string, SupportedTradingToken> =
  SUPPORTED_TRADING_TOKENS.reduce<Record<string, SupportedTradingToken>>(
    (acc, token) => {
      acc[token.mint] = token;
      return acc;
    },
    {},
  );
