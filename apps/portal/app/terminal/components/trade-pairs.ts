export type TokenSymbol =
  | "SOL"
  | "USDC"
  | "USDT"
  | "PYUSD"
  | "USD1"
  | "USDG"
  | "JITOSOL"
  | "MSOL"
  | "JUPSOL"
  | "RAY"
  | "WIF"
  | "JUP"
  | "BONK"
  | "JTO"
  | "PYTH";

export type TokenConfig = {
  symbol: TokenSymbol;
  name: string;
  mint: string;
  decimals: number;
  minAmountUi: string;
  amountPresets: readonly string[];
};

export type PairId =
  | "SOL/USDC"
  | "SOL/USDT"
  | "USDC/USDT"
  | "USDC/PYUSD"
  | "USDC/USD1"
  | "USDC/USDG"
  | "SOL/JITOSOL"
  | "SOL/MSOL"
  | "SOL/JUPSOL"
  | "RAY/USDC"
  | "WIF/USDC"
  | "JUP/USDC"
  | "BONK/USDC"
  | "JTO/USDC"
  | "PYTH/USDC";

export type PairConfig = {
  id: PairId;
  baseSymbol: TokenSymbol;
  quoteSymbol: TokenSymbol;
};

const T = {
  SOL: {
    symbol: "SOL",
    name: "Wrapped SOL",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    minAmountUi: "0.01",
    amountPresets: ["0.1", "0.25", "0.5"],
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    minAmountUi: "1",
    amountPresets: ["25", "50", "100"],
  },
  USDT: {
    symbol: "USDT",
    name: "Tether",
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
    minAmountUi: "1",
    amountPresets: ["25", "50", "100"],
  },
  PYUSD: {
    symbol: "PYUSD",
    name: "PayPal USD",
    mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    decimals: 6,
    minAmountUi: "1",
    amountPresets: ["25", "50", "100"],
  },
  USD1: {
    symbol: "USD1",
    name: "World Liberty Financial USD",
    mint: "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
    decimals: 6,
    minAmountUi: "1",
    amountPresets: ["25", "50", "100"],
  },
  USDG: {
    symbol: "USDG",
    name: "Global Dollar",
    mint: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
    decimals: 6,
    minAmountUi: "1",
    amountPresets: ["25", "50", "100"],
  },
  JITOSOL: {
    symbol: "JITOSOL",
    name: "Jito Staked SOL",
    mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    decimals: 9,
    minAmountUi: "0.01",
    amountPresets: ["0.1", "0.25", "0.5"],
  },
  MSOL: {
    symbol: "MSOL",
    name: "Marinade Staked SOL",
    mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    decimals: 9,
    minAmountUi: "0.01",
    amountPresets: ["0.1", "0.25", "0.5"],
  },
  JUPSOL: {
    symbol: "JUPSOL",
    name: "Jupiter Staked SOL",
    mint: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
    decimals: 9,
    minAmountUi: "0.01",
    amountPresets: ["0.1", "0.25", "0.5"],
  },
  RAY: {
    symbol: "RAY",
    name: "Raydium",
    mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    decimals: 6,
    minAmountUi: "1",
    amountPresets: ["10", "25", "50"],
  },
  WIF: {
    symbol: "WIF",
    name: "dogwifhat",
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    decimals: 6,
    minAmountUi: "0.5",
    amountPresets: ["5", "10", "25"],
  },
  JUP: {
    symbol: "JUP",
    name: "Jupiter",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    decimals: 6,
    minAmountUi: "1",
    amountPresets: ["10", "25", "50"],
  },
  BONK: {
    symbol: "BONK",
    name: "Bonk",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    decimals: 5,
    minAmountUi: "1000",
    amountPresets: ["100000", "500000", "1000000"],
  },
  JTO: {
    symbol: "JTO",
    name: "Jito",
    mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    decimals: 9,
    minAmountUi: "0.1",
    amountPresets: ["1", "2.5", "5"],
  },
  PYTH: {
    symbol: "PYTH",
    name: "Pyth Network",
    mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    decimals: 6,
    minAmountUi: "1",
    amountPresets: ["25", "50", "100"],
  },
} as const satisfies Record<TokenSymbol, TokenConfig>;

export const TOKEN_CONFIGS: Record<TokenSymbol, TokenConfig> = T;

export const TOKEN_BY_MINT = Object.values(TOKEN_CONFIGS).reduce<
  Record<string, TokenConfig>
>((acc, token) => {
  acc[token.mint] = token;
  return acc;
}, {});

export const SUPPORTED_PAIRS: PairConfig[] = [
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

export const DEFAULT_PAIR_ID: PairId = "SOL/USDC";

export function getPairConfig(pairId: PairId): PairConfig {
  const pair = SUPPORTED_PAIRS.find((item) => item.id === pairId);
  return pair ?? SUPPORTED_PAIRS[0];
}

function unitAtomic(decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return "1";
  return (BigInt(10) ** BigInt(decimals)).toString();
}

export function marketQuoteAmountAtomic(pairId: PairId): string {
  const pair = getPairConfig(pairId);
  const base = TOKEN_CONFIGS[pair.baseSymbol];
  return unitAtomic(base.decimals);
}
