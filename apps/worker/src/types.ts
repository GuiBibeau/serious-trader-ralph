export type LoopConfig = {
  enabled: boolean;
  policy?: LoopPolicy;
  execution?: ExecutionConfig;
  dataSources?: DataSourcesConfig;
  strategy?: Record<string, unknown>;
  updatedAt?: string;
};

export type LoopPolicy = {
  killSwitch?: boolean;
  allowedMints?: string[];
  // "0" means unlimited.
  maxTradeAmountAtomic?: string;
  maxPriceImpactPct?: number;
  slippageBps?: number;
  simulateOnly?: boolean;
  dryRun?: boolean;
  skipPreflight?: boolean;
  commitment?: "processed" | "confirmed" | "finalized";
  minSolReserveLamports?: string;
};

export type ExecutionConfig = {
  adapter?: string;
  params?: Record<string, unknown>;
};

export type DataSourcesConfig = {
  priority?: string[];
  cacheTtlMinutes?: number;
  fixturePattern?: "uptrend" | "downtrend" | "whipsaw";
  providers?: Record<string, unknown>;
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
  CONFIG_KV?: KVNamespace;
  LOGS_BUCKET?: R2Bucket;
  LOOP_A_COORDINATOR_DO?: DurableObjectNamespace;
  LOOP_B_MINUTE_ACCUMULATOR_DO?: DurableObjectNamespace;
  LOOP_C_RECOMMENDER_DO?: DurableObjectNamespace;
  EXECUTION_COORDINATOR_DO?: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
  ADMIN_TOKEN?: string;
  PRIVY_APP_ID?: string;
  PRIVY_APP_SECRET?: string;
  PRIVY_WALLET_ID?: string;
  DRYRUN_WALLET_ADDRESS?: string;
  RPC_ENDPOINT?: string;
  BALANCE_RPC_ENDPOINT?: string;
  JUPITER_BASE_URL?: string;
  JUPITER_API_KEY?: string;
  JITO_BLOCK_ENGINE_URL?: string;
  BILLING_MERCHANT_WALLET?: string;
  BILLING_STABLE_MINT?: string;
  BILLING_RPC_ENDPOINT?: string;
  BIRDEYE_API_KEY?: string;
  DUNE_API_KEY?: string;
  DUNE_QUERY_ID?: string;
  DUNE_API_URL?: string;
  KALSHI_BASE_URL?: string;
  FRED_API_KEY?: string;
  EIA_API_KEY?: string;
  X402_NETWORK?: string;
  X402_PAY_TO?: string;
  X402_ASSET_MINT?: string;
  X402_MAX_TIMEOUT_SECONDS?: string;
  X402_MARKET_SNAPSHOT_PRICE_USD?: string;
  X402_MARKET_SNAPSHOT_V2_PRICE_USD?: string;
  X402_MARKET_TOKEN_BALANCE_PRICE_USD?: string;
  X402_MARKET_JUPITER_QUOTE_PRICE_USD?: string;
  X402_MARKET_JUPITER_QUOTE_BATCH_PRICE_USD?: string;
  X402_MARKET_OHLCV_PRICE_USD?: string;
  X402_MARKET_INDICATORS_PRICE_USD?: string;
  X402_MACRO_SIGNALS_PRICE_USD?: string;
  X402_MACRO_FRED_INDICATORS_PRICE_USD?: string;
  X402_MACRO_ETF_FLOWS_PRICE_USD?: string;
  X402_MACRO_STABLECOIN_HEALTH_PRICE_USD?: string;
  X402_MACRO_OIL_ANALYTICS_PRICE_USD?: string;
  LOOP_A_SLOT_SOURCE_ENABLED?: string;
  LOOP_A_SLOT_SOURCE_BACKFILL_COMMITMENTS?: string;
  LOOP_A_BLOCK_FETCH_ENABLED?: string;
  LOOP_A_BLOCK_FETCH_COMMITMENTS?: string;
  LOOP_A_BLOCK_FETCH_MAX_CONCURRENCY?: string;
  LOOP_A_BLOCK_FETCH_MAX_RETRIES?: string;
  LOOP_A_BLOCK_FETCH_BASE_BACKOFF_MS?: string;
  LOOP_A_BLOCK_FETCH_MAX_SLOTS_PER_TICK?: string;
  LOOP_A_DECODER_ENABLED?: string;
  LOOP_A_STATE_STORE_ENABLED?: string;
  LOOP_A_STATE_COMMITMENT?: string;
  LOOP_A_SNAPSHOT_EVERY_SLOTS?: string;
  LOOP_A_BACKFILL_RESOLVER_ENABLED?: string;
  LOOP_A_BACKFILL_MAX_TASKS_PER_TICK?: string;
  LOOP_A_BACKFILL_MAX_SLOTS_PER_TASK?: string;
  LOOP_A_BACKFILL_MAX_TOTAL_SLOTS_PER_TICK?: string;
  LOOP_A_MARK_ENGINE_ENABLED?: string;
  LOOP_A_MARK_COMMITMENT?: string;
  LOOP_A_COORDINATOR_ENABLED?: string;
  LOOP_B_MINUTE_ACCUMULATOR_ENABLED?: string;
  LOOP_B_TOP_MOVERS_LIMIT?: string;
  LOOP_C_RECOMMENDER_ENABLED?: string;
  LOOP_C_RECOMMENDER_DEFAULT_LIMIT?: string;
  LOOP_C_CANDIDATE_POOL_LIMIT?: string;
  LOOP_C_MIN_LIQUIDITY_SCORE?: string;
  LOOP_C_MAX_STALENESS_MS?: string;
  LOOP_C_EXCLUDED_ASSETS?: string;
  LOOP_C_EXCLUDED_PROTOCOLS?: string;
  EXECUTION_COORDINATOR_ENABLED?: string;
  EXECUTION_AUCTION_WINDOW_MS?: string;
};
