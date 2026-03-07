import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Env,
  LoopConfig,
  MarketSnapshot,
} from "../../apps/worker/src/types";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const DEFAULT_MERCHANT_WALLET =
  "6F6A1zpGpRGmqrXpqgBFYGjC9WFo6iovrRVYoJNBHZqF";
const DEFAULT_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const runWorkerLive =
  process.env.RUN_WORKER_LIVE_TESTS === "1" ||
  process.env.RUN_X402_LIVE_TESTS === "1";

export const runWorkerLiveIntegration = runIntegration && runWorkerLive;

let cachedDevVars: Record<string, string> | null = null;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadWorkerDevVars(): Record<string, string> {
  if (cachedDevVars) return cachedDevVars;
  const repoRoot = path.resolve(
    fileURLToPath(new URL("../..", import.meta.url)),
  );
  const devVarsPath = path.join(repoRoot, "apps/worker/.dev.vars");
  if (!existsSync(devVarsPath)) {
    cachedDevVars = {};
    return cachedDevVars;
  }

  const out: Record<string, string> = {};
  const raw = readFileSync(devVarsPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = stripQuotes(trimmed.slice(idx + 1));
    out[key] = value;
  }
  cachedDevVars = out;
  return out;
}

export function readLiveEnv(name: string, fallback = ""): string {
  const fromProcess = process.env[name];
  if (typeof fromProcess === "string" && fromProcess.trim()) {
    return fromProcess.trim();
  }
  const fromFile = loadWorkerDevVars()[name];
  if (typeof fromFile === "string" && fromFile.trim()) {
    return fromFile.trim();
  }
  return fallback;
}

export function requireLiveEnv(name: string): string {
  const value = readLiveEnv(name, "");
  if (!value) {
    throw new Error(
      `Missing required integration env var: ${name}. Set it in shell env or apps/worker/.dev.vars`,
    );
  }
  return value;
}

export function hasLiveOhlcvProviderConfig(): boolean {
  const hasBirdeye = Boolean(readLiveEnv("BIRDEYE_API_KEY", ""));
  const hasDune =
    Boolean(readLiveEnv("DUNE_API_KEY", "")) &&
    Boolean(readLiveEnv("DUNE_QUERY_ID", ""));
  return hasBirdeye || hasDune;
}

function createMockDb(config?: LoopConfig) {
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            run: async () => ({ meta: { changes: 1 } }),
            all: async () => ({ results: [] }),
            first: async () => {
              if (
                config &&
                /from\s+loop_configs/i.test(sql) &&
                /config_json/i.test(sql)
              ) {
                return { configJson: JSON.stringify(config) };
              }
              return null;
            },
          };
        },
      };
    },
  };
}

function createMockKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string, _type?: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
}

function createMockDoNamespace() {
  return {
    idFromName(name: string) {
      return { toString: () => `id:${name}` };
    },
    idFromString(id: string) {
      return { toString: () => id };
    },
    get() {
      return {
        fetch: async () =>
          new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          }),
      };
    },
  };
}

function createMockR2() {
  return {
    put: async () => null,
    get: async () => null,
    head: async () => null,
  };
}

export function createWorkerLiveEnv(options?: {
  loopConfig?: LoopConfig;
  overrides?: Partial<Env>;
}): Env {
  const rpcEndpoint =
    readLiveEnv("BALANCE_RPC_ENDPOINT", "") ||
    readLiveEnv("RPC_ENDPOINT", "") ||
    DEFAULT_MAINNET_RPC;
  const env = {
    WAITLIST_DB: createMockDb(options?.loopConfig) as never,
    CONFIG_KV: createMockKv() as never,
    BOT_LOOP: createMockDoNamespace() as never,
    BACKTEST_QUEUE: createMockDoNamespace() as never,
    LOGS_BUCKET: createMockR2() as never,
    ALLOWED_ORIGINS: "*",
    LOOP_ENABLED_DEFAULT: "false",
    X402_NETWORK: readLiveEnv("X402_NETWORK", "solana-devnet"),
    X402_PAY_TO: readLiveEnv("X402_PAY_TO", DEFAULT_MERCHANT_WALLET),
    X402_ASSET_MINT: readLiveEnv("X402_ASSET_MINT", DEVNET_USDC_MINT),
    X402_ENFORCE_ONCHAIN: readLiveEnv("X402_ENFORCE_ONCHAIN", "0"),
    X402_MAX_TIMEOUT_SECONDS: readLiveEnv("X402_MAX_TIMEOUT_SECONDS", "60"),
    X402_EXEC_SUBMIT_PRICE_USD: readLiveEnv(
      "X402_EXEC_SUBMIT_PRICE_USD",
      "0.01",
    ),
    X402_MARKET_SNAPSHOT_PRICE_USD: readLiveEnv(
      "X402_MARKET_SNAPSHOT_PRICE_USD",
      "0.01",
    ),
    X402_MARKET_SNAPSHOT_V2_PRICE_USD: readLiveEnv(
      "X402_MARKET_SNAPSHOT_V2_PRICE_USD",
      "0.01",
    ),
    X402_MARKET_TOKEN_BALANCE_PRICE_USD: readLiveEnv(
      "X402_MARKET_TOKEN_BALANCE_PRICE_USD",
      "0.01",
    ),
    X402_MARKET_JUPITER_QUOTE_PRICE_USD: readLiveEnv(
      "X402_MARKET_JUPITER_QUOTE_PRICE_USD",
      "0.01",
    ),
    X402_MARKET_JUPITER_QUOTE_BATCH_PRICE_USD: readLiveEnv(
      "X402_MARKET_JUPITER_QUOTE_BATCH_PRICE_USD",
      "0.01",
    ),
    X402_MARKET_OHLCV_PRICE_USD: readLiveEnv(
      "X402_MARKET_OHLCV_PRICE_USD",
      "0.01",
    ),
    X402_MARKET_INDICATORS_PRICE_USD: readLiveEnv(
      "X402_MARKET_INDICATORS_PRICE_USD",
      "0.01",
    ),
    X402_MACRO_SIGNALS_PRICE_USD: readLiveEnv(
      "X402_MACRO_SIGNALS_PRICE_USD",
      "0.01",
    ),
    X402_MACRO_FRED_INDICATORS_PRICE_USD: readLiveEnv(
      "X402_MACRO_FRED_INDICATORS_PRICE_USD",
      "0.01",
    ),
    X402_MACRO_ETF_FLOWS_PRICE_USD: readLiveEnv(
      "X402_MACRO_ETF_FLOWS_PRICE_USD",
      "0.01",
    ),
    X402_MACRO_STABLECOIN_HEALTH_PRICE_USD: readLiveEnv(
      "X402_MACRO_STABLECOIN_HEALTH_PRICE_USD",
      "0.01",
    ),
    X402_MACRO_OIL_ANALYTICS_PRICE_USD: readLiveEnv(
      "X402_MACRO_OIL_ANALYTICS_PRICE_USD",
      "0.01",
    ),
    X402_PERPS_FUNDING_SURFACE_PRICE_USD: readLiveEnv(
      "X402_PERPS_FUNDING_SURFACE_PRICE_USD",
      "0.01",
    ),
    X402_PERPS_OPEN_INTEREST_SURFACE_PRICE_USD: readLiveEnv(
      "X402_PERPS_OPEN_INTEREST_SURFACE_PRICE_USD",
      "0.01",
    ),
    X402_PERPS_VENUE_SCORE_PRICE_USD: readLiveEnv(
      "X402_PERPS_VENUE_SCORE_PRICE_USD",
      "0.01",
    ),
    RPC_ENDPOINT: readLiveEnv("RPC_ENDPOINT", rpcEndpoint),
    BALANCE_RPC_ENDPOINT: rpcEndpoint,
    JUPITER_BASE_URL: readLiveEnv(
      "JUPITER_BASE_URL",
      "https://lite-api.jup.ag",
    ),
    JUPITER_API_KEY: readLiveEnv("JUPITER_API_KEY", ""),
    BIRDEYE_API_KEY: readLiveEnv("BIRDEYE_API_KEY", ""),
    DUNE_API_KEY: readLiveEnv("DUNE_API_KEY", ""),
    DUNE_QUERY_ID: readLiveEnv("DUNE_QUERY_ID", ""),
    DUNE_API_URL: readLiveEnv("DUNE_API_URL", "https://api.dune.com"),
  } as Env;
  return {
    ...env,
    ...(options?.overrides ?? {}),
  } as Env;
}

export function createExecutionContextStub(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  } as ExecutionContext;
}

export function decodeBase64JsonHeader<T = Record<string, unknown>>(
  value: string | null,
): T {
  if (!value) throw new Error("missing-base64-header");
  const json = Buffer.from(value, "base64").toString("utf8");
  return JSON.parse(json) as T;
}

export function resolveSnapshotWallet(env: Env): string {
  return String(env.X402_PAY_TO || DEFAULT_MERCHANT_WALLET).trim();
}

export function createInitialSnapshot(): MarketSnapshot {
  return {
    ts: new Date(0).toISOString(),
    baseMint: SOL_MINT,
    quoteMint: MAINNET_USDC_MINT,
    quoteDecimals: 6,
    baseBalanceAtomic: "0",
    quoteBalanceAtomic: "0",
    basePriceQuote: "0.00",
    portfolioValueQuote: "0.00",
    baseAllocationPct: 0,
  };
}

function isTransientError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /429|502|503|504|ECONNRESET|ETIMEDOUT|timeout|fetch failed/i.test(
    message,
  );
}

export async function withRetries<T>(
  run: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const last = i === attempts - 1;
      if (last || !isTransientError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
    }
  }
  throw lastError ?? new Error("retry-exhausted");
}
