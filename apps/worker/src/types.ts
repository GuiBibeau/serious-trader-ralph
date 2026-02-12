export type LoopConfig = {
  enabled: boolean;
  policy?: LoopPolicy;
  strategy?: StrategyConfig;
  updatedAt?: string;
};

export type LoopPolicy = {
  killSwitch?: boolean;
  allowedMints?: string[];
  // "0" means unlimited.
  maxTradeAmountAtomic?: string;
  maxPriceImpactPct?: number;
  slippageBps?: number;
  // If true, build + sign + simulate the swap on Solana RPC, but do not broadcast.
  // This is the best "mainnet tool test" mode (hits Jupiter + Privy + RPC).
  simulateOnly?: boolean;
  dryRun?: boolean;
  skipPreflight?: boolean;
  commitment?: "processed" | "confirmed" | "finalized";
  // Keep some SOL to pay fees / rent; expressed in lamports.
  minSolReserveLamports?: string;
};

export type DcaStrategy = {
  type: "dca";
  inputMint: string;
  outputMint: string;
  // Atomic units of the input mint (e.g. lamports for SOL, micro for USDC).
  amount: string;
  // Minimum time between executions.
  everyMinutes?: number;
};

export type RebalanceStrategy = {
  type: "rebalance";
  // For now, designed primarily for SOL/USDC but works for any pair that has Jupiter routes.
  baseMint: string;
  quoteMint: string;
  targetBasePct: number; // 0..1
  thresholdPct?: number; // 0..1
  // Caps expressed in atomic units of the respective input mint.
  maxSellBaseAmount?: string;
  maxBuyQuoteAmount?: string;
};

export type AgentStrategy = {
  type: "agent";
  /** LLM model override — falls back to ZAI_MODEL env var */
  model?: string;
  /** User-provided mandate — high-level instructions the agent must follow */
  mandate?: string;
  /** Minimum confidence required to execute a trade */
  minConfidence?: "low" | "medium" | "high";
  /** Max trades per day (safety cap) */
  maxTradesPerDay?: number;
  /** Allowed actions: which tools the agent can use */
  allowedActions?: ("trade" | "update_thesis" | "log_observation" | "skip")[];
  /** Tool loop: max number of LLM/tool steps per tick */
  maxStepsPerTick?: number;
  /** Tool loop: max number of tool calls allowed in a single LLM response */
  maxToolCallsPerStep?: number;
  /** Tool allow/deny policy by tool name */
  toolPolicy?: {
    allow?: string[];
    deny?: string[];
    allowAll?: boolean;
  };
  /** Quote mint used for portfolio valuation (default: USDC) */
  quoteMint?: string;
  /** Quote mint decimals for display (default: 6 for USDC) */
  quoteDecimals?: number;
};

export type StrategyConfig =
  | { type: "noop" }
  | DcaStrategy
  | RebalanceStrategy
  | AgentStrategy;

export type LoopState = {
  dca?: {
    lastAt?: string;
  };
  agent?: {
    lastTickAt?: string;
  };
};

export type AgentMemory = {
  thesis: string;
  observations: AgentObservation[];
  reflections: string[];
  tradesProposedToday: number;
  lastTradeDate: string;
  updatedAt: string;
};

export type AgentObservation = {
  ts: string;
  category: "market" | "pattern" | "risk" | "opportunity";
  content: string;
};

export type AgentDecision =
  | {
      action: "trade";
      inputMint: string;
      outputMint: string;
      amount: string;
      reasoning: string;
      confidence: "low" | "medium" | "high";
    }
  | {
      action: "update_thesis";
      thesis: string;
      reasoning: string;
    }
  | {
      action: "log_observation";
      observation: string;
      category: "market" | "pattern" | "risk" | "opportunity";
    }
  | {
      action: "skip";
      reasoning: string;
    };

export type MarketSnapshot = {
  ts: string;
  baseMint: string;
  quoteMint: string;
  quoteDecimals: number;
  baseBalanceAtomic: string;
  quoteBalanceAtomic: string;
  basePriceQuote: string;
  portfolioValueQuote: string;
  baseAllocationPct: number;
};

export type Env = {
  WAITLIST_DB: D1Database;
  CONFIG_KV: KVNamespace;
  BOT_LOOP: DurableObjectNamespace;
  // Optional while R2 is not enabled on the account; logs will fall back to console only.
  LOGS_BUCKET?: R2Bucket;
  ADMIN_TOKEN?: string;
  PRIVY_APP_ID?: string;
  PRIVY_APP_SECRET?: string;
  PRIVY_WALLET_ID?: string;
  // Used for local/mainnet dry-runs so you can test quoting + policy without Privy.
  // Must be a valid base58 Solana pubkey string.
  DRYRUN_WALLET_ADDRESS?: string;
  RPC_ENDPOINT?: string;
  JUPITER_BASE_URL?: string;
  JUPITER_API_KEY?: string;
  TENANT_ID?: string;
  LOOP_ENABLED_DEFAULT?: string;
  ALLOWED_ORIGINS?: string;
  ZAI_API_KEY?: string;
  ZAI_BASE_URL?: string;
  ZAI_MODEL?: string;
};
