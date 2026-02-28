export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type SupportedTradingToken = {
  symbol: string;
  mint: string;
  decimals: number;
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
