import type { ChatTool, ChatToolCall } from "./agent_llm";
import { getLoopConfig } from "./config";
import type { JupiterClient } from "./jupiter";
import { addReflection, appendObservation, updateThesis } from "./memory";
import type { NormalizedPolicy } from "./policy";
import { enforcePolicy, normalizePolicy } from "./policy";
import { signTransactionWithPrivyById } from "./privy";
import { gatherMarketSnapshot } from "./research";
import type { SolanaRpc } from "./solana_rpc";
import { swapWithRetry } from "./swap";
import type { TradeIndexResult } from "./trade_index";
import { insertTradeIndex, listTrades } from "./trade_index";
import type { AgentMemory, AgentStrategy, Env, MarketSnapshot } from "./types";

const SOL_MINT = "So11111111111111111111111111111111111111112";

type LogFn = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
) => void;

export type AgentToolRuntime = {
  env: Env;
  tenantId: string;
  configTenantId?: string;
  runId: string;
  logKey: string;
  log: LogFn;
  rpc: SolanaRpc;
  jupiter: JupiterClient;
  wallet: string;
  policy: NormalizedPolicy;
  strategy: AgentStrategy;
  privyWalletId?: string;
  memory: AgentMemory;
  snapshot: MarketSnapshot;
  recentTrades: TradeIndexResult[];
  stopRequested: boolean;
  tradeExecuted: boolean;
};

export type AgentToolHandler = (
  args: Record<string, unknown>,
  rt: AgentToolRuntime,
  call?: ChatToolCall,
) => Promise<unknown>;

type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  action?: NonNullable<AgentStrategy["allowedActions"]>[number];
  handler: AgentToolHandler;
};

export function buildAgentToolset(strategy: AgentStrategy): {
  tools: ChatTool[];
  handlers: Record<string, AgentToolHandler>;
} {
  const defs = filterTools(TOOLS, strategy);
  return {
    tools: defs.map((d) => ({
      type: "function",
      function: {
        name: d.name,
        description: d.description,
        parameters: d.parameters,
      },
    })),
    handlers: Object.fromEntries(defs.map((d) => [d.name, d.handler])),
  };
}

function filterTools(all: ToolDef[], strategy: AgentStrategy): ToolDef[] {
  let out = [...all];
  const mustHave = "control_finish";
  let denied = new Set<string>();

  // allowedActions is a coarse “can the agent do X” switch. It applies only to
  // action tools; observation/research tools remain available by default.
  if (strategy.allowedActions && strategy.allowedActions.length > 0) {
    const allow = new Set(strategy.allowedActions);
    out = out.filter((t) => !t.action || allow.has(t.action));
  }

  // toolPolicy is a fine-grained allow/deny list by tool name.
  const policy = strategy.toolPolicy;
  if (policy) {
    const deny = new Set(
      Array.isArray(policy.deny)
        ? policy.deny.filter((x): x is string => typeof x === "string")
        : [],
    );
    denied = deny;
    const allow = new Set(
      Array.isArray(policy.allow)
        ? policy.allow.filter((x): x is string => typeof x === "string")
        : [],
    );

    const allowAll = Boolean(policy.allowAll);
    if (!allowAll && allow.size > 0) {
      out = out.filter((t) => allow.has(t.name) && !deny.has(t.name));
    } else {
      out = out.filter((t) => !deny.has(t.name));
    }
  }

  // Ensure the agent always has a deterministic way to stop the tick, even when
  // tool allow-lists are enabled. It can still be explicitly denied.
  if (!out.some((t) => t.name === mustHave) && !denied.has(mustHave)) {
    const control = all.find((t) => t.name === mustHave);
    if (control) out = [control, ...out];
  }

  return out;
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function quoteSummary(quote: Record<string, unknown>): Record<string, unknown> {
  const inputMint = typeof quote.inputMint === "string" ? quote.inputMint : "";
  const outputMint =
    typeof quote.outputMint === "string" ? quote.outputMint : "";
  const inAmount = typeof quote.inAmount === "string" ? quote.inAmount : "";
  const outAmount = typeof quote.outAmount === "string" ? quote.outAmount : "";
  const priceImpactPct = quote.priceImpactPct ?? 0;
  const routePlan = Array.isArray(quote.routePlan) ? quote.routePlan : [];
  const labels: string[] = [];
  for (const hop of routePlan) {
    const info = (hop as { swapInfo?: { label?: unknown } }).swapInfo;
    const label = info?.label;
    if (typeof label === "string" && label.trim()) labels.push(label.trim());
    if (labels.length >= 3) break;
  }

  return {
    inputMint,
    outputMint,
    inAmount,
    outAmount,
    priceImpactPct,
    ...(labels.length > 0 ? { route: labels.join(" -> ") } : {}),
  };
}

function confidenceRank(value: string): number {
  if (value === "high") return 2;
  if (value === "medium") return 1;
  return 0;
}

const TOOLS: ToolDef[] = [
  {
    name: "control_finish",
    description:
      "Finish the tick. Use this when you are done (traded or decided not to).",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What you did and why" },
      },
      required: ["summary"],
    },
    handler: async (args, rt) => {
      const summary = String(args.summary ?? "").trim();
      rt.log("info", "agent finished", { summary });
      rt.stopRequested = true;
      return { ok: true };
    },
  },

  {
    name: "market_snapshot",
    description:
      "Get the latest market snapshot for this bot (portfolio balances + SOL price in quote mint).",
    parameters: { type: "object", properties: {}, required: [] },
    handler: async (_args, rt) => {
      const snapshot = await gatherMarketSnapshot(
        rt.rpc,
        rt.jupiter,
        rt.wallet,
        rt.policy,
        {
          quoteMint: rt.strategy.quoteMint,
          quoteDecimals: rt.strategy.quoteDecimals,
        },
      );
      rt.snapshot = snapshot;
      rt.log("info", "agent tool market snapshot", {
        basePriceQuote: snapshot.basePriceQuote,
        portfolioValueQuote: snapshot.portfolioValueQuote,
        baseAllocationPct: snapshot.baseAllocationPct,
      });
      return { ok: true, snapshot };
    },
  },

  {
    name: "market_token_balance",
    description:
      "Get this bot's token balance for a mint. For SOL use the canonical SOL mint.",
    parameters: {
      type: "object",
      properties: {
        mint: { type: "string", description: "Token mint address" },
      },
      required: ["mint"],
    },
    handler: async (args, rt) => {
      const mint = String(args.mint ?? "").trim();
      if (!mint) return { ok: false, error: "missing-mint" };
      if (mint === SOL_MINT) {
        const lamports = await rt.rpc.getBalanceLamports(rt.wallet);
        return { ok: true, mint, balanceAtomic: lamports.toString() };
      }
      const bal = await rt.rpc.getTokenBalanceAtomic(rt.wallet, mint);
      return { ok: true, mint, balanceAtomic: bal.toString() };
    },
  },

  {
    name: "market_jupiter_quote",
    description:
      "Get a Jupiter quote for a swap (ExactIn by default). Quote is validated against policy constraints.",
    parameters: {
      type: "object",
      properties: {
        inputMint: { type: "string" },
        outputMint: { type: "string" },
        amount: { type: "string", description: "Atomic units of inputMint" },
        swapMode: { type: "string", enum: ["ExactIn", "ExactOut"] },
        slippageBps: {
          type: "number",
          description:
            "Optional. Clamped to policy slippage tolerance; defaults to policy.",
        },
      },
      required: ["inputMint", "outputMint", "amount"],
    },
    handler: async (args, rt) => {
      const inputMint = String(args.inputMint ?? "").trim();
      const outputMint = String(args.outputMint ?? "").trim();
      const amount = String(args.amount ?? "").trim();
      const swapModeRaw = String(args.swapMode ?? "ExactIn");
      const swapMode = swapModeRaw === "ExactOut" ? "ExactOut" : "ExactIn";
      const slippageBps = clampInt(
        args.slippageBps,
        rt.policy.slippageBps,
        0,
        rt.policy.slippageBps,
      );

      if (!inputMint || !outputMint || !amount) {
        return { ok: false, error: "missing-params" };
      }

      const quote = await rt.jupiter.quote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
        swapMode,
      });
      enforcePolicy(rt.policy, quote);
      const summary = quoteSummary(quote as Record<string, unknown>);
      rt.log("info", "agent tool jupiter quote", summary);
      return { ok: true, quote: summary };
    },
  },

  {
    name: "trades_list_recent",
    description: "List recent trades for this bot (from D1 trade_index).",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rows (1..200)" },
      },
      required: [],
    },
    handler: async (args, rt) => {
      const limit = clampInt(args.limit, 10, 1, 200);
      const trades = await listTrades(rt.env, rt.tenantId, limit);
      rt.recentTrades = trades;
      return { ok: true, trades };
    },
  },

  {
    name: "memory_update_thesis",
    description:
      "Update the agent's thesis (persists between ticks). Use when your view changes.",
    parameters: {
      type: "object",
      properties: {
        thesis: { type: "string", description: "Complete updated thesis" },
        reasoning: { type: "string", description: "What changed and why" },
      },
      required: ["thesis", "reasoning"],
    },
    action: "update_thesis",
    handler: async (args, rt) => {
      const thesis = String(args.thesis ?? "");
      const reasoning = String(args.reasoning ?? "");
      rt.memory = updateThesis(rt.memory, thesis);
      if (reasoning.trim()) {
        rt.memory = addReflection(
          rt.memory,
          `Thesis update: ${reasoning.trim()}`,
        );
      }
      rt.log("info", "agent tool thesis updated", {
        reasoning: reasoning.trim(),
      });
      return { ok: true };
    },
  },

  {
    name: "memory_log_observation",
    description: "Record a market observation in memory for future reference.",
    parameters: {
      type: "object",
      properties: {
        observation: { type: "string", description: "What you observed" },
        category: {
          type: "string",
          enum: ["market", "pattern", "risk", "opportunity"],
        },
      },
      required: ["observation", "category"],
    },
    action: "log_observation",
    handler: async (args, rt) => {
      const observation = String(args.observation ?? "").trim();
      const categoryRaw = String(args.category ?? "market");
      const category =
        categoryRaw === "pattern" ||
        categoryRaw === "risk" ||
        categoryRaw === "opportunity"
          ? categoryRaw
          : "market";
      if (!observation) return { ok: false, error: "empty-observation" };
      rt.memory = appendObservation(rt.memory, {
        ts: new Date().toISOString(),
        category,
        content: observation,
      });
      rt.log("info", "agent tool observation logged", {
        category,
        observation,
      });
      return { ok: true };
    },
  },

  {
    name: "memory_add_reflection",
    description:
      "Append a short learning/reflection to memory (persists between ticks).",
    parameters: {
      type: "object",
      properties: {
        reflection: { type: "string", description: "One concise learning" },
      },
      required: ["reflection"],
    },
    action: "log_observation",
    handler: async (args, rt) => {
      const reflection = String(args.reflection ?? "").trim();
      if (!reflection) return { ok: false, error: "empty-reflection" };
      rt.memory = addReflection(rt.memory, reflection);
      rt.log("info", "agent tool reflection added");
      return { ok: true };
    },
  },

  {
    name: "trade_jupiter_swap",
    description:
      "Execute a Jupiter swap for this bot. Honors policy (allowed mints, price impact, caps, dryRun/simulateOnly).",
    parameters: {
      type: "object",
      properties: {
        inputMint: { type: "string" },
        outputMint: { type: "string" },
        amount: { type: "string", description: "Atomic units of inputMint" },
        reasoning: { type: "string", description: "Why this trade, why now" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: [
        "inputMint",
        "outputMint",
        "amount",
        "reasoning",
        "confidence",
      ],
    },
    action: "trade",
    handler: async (args, rt) => {
      if (rt.tradeExecuted) {
        return { ok: false, error: "trade-already-executed-this-tick" };
      }

      const inputMint = String(args.inputMint ?? "").trim();
      const outputMint = String(args.outputMint ?? "").trim();
      const amount = String(args.amount ?? "").trim();
      const reasoning = String(args.reasoning ?? "").trim();
      const confidenceRaw = String(args.confidence ?? "low");
      const confidence =
        confidenceRaw === "high" || confidenceRaw === "medium"
          ? confidenceRaw
          : "low";

      if (!inputMint || !outputMint || !amount || !reasoning) {
        return { ok: false, error: "missing-params" };
      }
      if (!/^\d+$/.test(amount) || amount === "0") {
        return { ok: false, error: "invalid-amount" };
      }
      if (!rt.memory.thesis.trim()) {
        return { ok: false, error: "missing-thesis" };
      }
      const minConfidence = rt.strategy.minConfidence ?? "medium";
      if (confidenceRank(confidence) < confidenceRank(minConfidence)) {
        return {
          ok: false,
          error: "confidence-too-low",
          minConfidence,
          confidence,
        };
      }

      const maxTradesPerDay = rt.strategy.maxTradesPerDay ?? 5;
      if (rt.memory.tradesProposedToday >= maxTradesPerDay) {
        return { ok: false, error: "daily-trade-cap-reached" };
      }

      // Basic balance checks (best-effort). Policy enforcement still happens on the quote.
      const reserveLamports = BigInt(rt.policy.minSolReserveLamports);
      const solBalanceLamports = await rt.rpc.getBalanceLamports(rt.wallet);
      const amountAtomic = BigInt(amount);
      if (inputMint === SOL_MINT) {
        const needed = amountAtomic + reserveLamports;
        if (solBalanceLamports < needed) {
          rt.log("warn", "insufficient SOL for trade (after reserve)", {
            solBalanceLamports: solBalanceLamports.toString(),
            reserveLamports: reserveLamports.toString(),
            amount,
          });
          if (!rt.policy.dryRun)
            return { ok: false, error: "insufficient-sol" };
        }
      } else {
        if (solBalanceLamports < reserveLamports) {
          rt.log("warn", "insufficient SOL for fees (reserve)", {
            solBalanceLamports: solBalanceLamports.toString(),
            reserveLamports: reserveLamports.toString(),
          });
          if (!rt.policy.dryRun)
            return { ok: false, error: "insufficient-sol-reserve" };
        }
        const inBal = await rt.rpc.getTokenBalanceAtomic(rt.wallet, inputMint);
        if (inBal < amountAtomic) {
          rt.log("warn", "insufficient input token balance", {
            mint: inputMint,
            have: inBal.toString(),
            need: amount,
          });
          if (!rt.policy.dryRun)
            return { ok: false, error: "insufficient-input-balance" };
        }
      }

      const quote = await rt.jupiter.quote({
        inputMint,
        outputMint,
        amount,
        slippageBps: rt.policy.slippageBps,
        swapMode: "ExactIn",
      });
      enforcePolicy(rt.policy, quote);

      // Count this trade attempt once we've got a valid quote.
      rt.memory.tradesProposedToday += 1;
      rt.memory.lastTradeDate = new Date().toISOString().slice(0, 10);
      rt.tradeExecuted = true;

      rt.log("info", "agent tool trade quote", {
        ...quoteSummary(quote as Record<string, unknown>),
        reasoning,
        confidence,
      });

      if (rt.policy.dryRun) {
        await insertTradeIndex(rt.env, {
          tenantId: rt.tenantId,
          runId: rt.runId,
          venue: "jupiter",
          market: `${quote.inputMint}->${quote.outputMint}`,
          side: "agent_swap",
          size: quote.inAmount,
          price: quote.outAmount,
          status: "dry_run",
          logKey: rt.logKey,
          signature: null,
          reasoning,
        });
        return {
          ok: true,
          status: "dry_run",
          quote: quoteSummary(quote as Record<string, unknown>),
        };
      }

      await assertLoopStillEnabled(rt.env, rt.log, rt.configTenantId);

      const {
        swap,
        quoteResponse: usedQuote,
        refreshed,
      } = await swapWithRetry(rt.jupiter, quote, rt.wallet, rt.policy);
      if (refreshed) {
        rt.log("warn", "agent: quote refreshed due to swap 422", {
          inAmount: usedQuote.inAmount,
          outAmount: usedQuote.outAmount,
        });
      }

      if (!rt.privyWalletId) throw new Error("missing-privy-wallet-id");
      rt.log("info", "signing transaction", { walletId: rt.privyWalletId });
      const signedBase64 = await signTransactionWithPrivyById(
        rt.env,
        rt.privyWalletId,
        swap.swapTransaction,
      );
      rt.log("info", "transaction signed");

      if (rt.policy.simulateOnly) {
        const sim = await rt.rpc.simulateTransactionBase64(signedBase64, {
          commitment: rt.policy.commitment,
          sigVerify: true,
        });
        const ok = !sim.err;
        rt.log(ok ? "info" : "warn", "agent trade simulated", {
          ok,
          err: sim.err ?? null,
          unitsConsumed: sim.unitsConsumed ?? null,
        });
        await insertTradeIndex(rt.env, {
          tenantId: rt.tenantId,
          runId: rt.runId,
          venue: "jupiter",
          market: `${usedQuote.inputMint}->${usedQuote.outputMint}`,
          side: "agent_swap",
          size: usedQuote.inAmount,
          price: usedQuote.outAmount,
          status: ok ? "simulated" : "simulate_error",
          logKey: rt.logKey,
          signature: null,
          reasoning,
        });
        return {
          ok: true,
          status: ok ? "simulated" : "simulate_error",
          err: sim.err ?? null,
        };
      }

      await assertLoopStillEnabled(rt.env, rt.log, rt.configTenantId);

      const signature = await rt.rpc.sendTransactionBase64(signedBase64, {
        skipPreflight: rt.policy.skipPreflight,
        preflightCommitment: rt.policy.commitment,
      });

      rt.log("info", "agent tx submitted", {
        signature,
        lastValidBlockHeight: swap.lastValidBlockHeight,
      });

      const confirmation = await rt.rpc.confirmSignature(signature, {
        commitment: rt.policy.commitment,
      });
      const status = confirmation.ok
        ? (confirmation.status ?? "confirmed")
        : "error";
      rt.log(confirmation.ok ? "info" : "warn", "agent tx confirmation", {
        signature,
        status,
        err: confirmation.err ?? null,
      });

      await insertTradeIndex(rt.env, {
        tenantId: rt.tenantId,
        runId: rt.runId,
        venue: "jupiter",
        market: `${usedQuote.inputMint}->${usedQuote.outputMint}`,
        side: "agent_swap",
        size: usedQuote.inAmount,
        price: usedQuote.outAmount,
        status,
        logKey: rt.logKey,
        signature,
        reasoning,
      });

      return {
        ok: confirmation.ok,
        signature,
        status,
        err: confirmation.err ?? null,
      };
    },
  },
];

async function assertLoopStillEnabled(
  env: Env,
  log: LogFn,
  tenantId?: string,
): Promise<void> {
  const config = await getLoopConfig(env, tenantId);
  if (!config.enabled) {
    log("warn", "loop disabled during tick, aborting before execution");
    throw new Error("loop-disabled");
  }
  const p = normalizePolicy(config.policy);
  if (p.killSwitch) {
    log("warn", "kill switch enabled during tick, aborting before execution");
    throw new Error("kill-switch-enabled");
  }
}
