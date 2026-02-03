import type { ToolSchema } from "../llm/types.js";

export type PromptPlan = {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
};

export type PromptPolicy = {
  killSwitch: boolean;
  allowedMints: string[];
  maxTradeAmountLamports: string;
  maxSlippageBps: number;
  maxPriceImpactPct: number;
  cooldownSeconds: number;
  dailySpendCapLamports?: string | null;
};

export function buildAutonomousPrompt(input: {
  instruction: string;
  policy: PromptPolicy;
  plan?: PromptPlan;
  tools: ToolSchema[];
}): string {
  const { instruction, policy, plan, tools } = input;
  const slippageHint = plan
    ? `min(plan.slippageBps=${plan.slippageBps}, policy.maxSlippageBps=${policy.maxSlippageBps})`
    : `policy.maxSlippageBps=${policy.maxSlippageBps}`;

  const lines = [
    "IDENTITY:",
    instruction,
    "MISSION:",
    "Trade Solana autonomously with a quantitative, data-driven style to maximize risk-adjusted returns while preserving capital and respecting policy.",
    "EXECUTION UNIVERSE:",
    "Spot swaps, perps, prediction markets, and any other Solana-native trade types supported by the available tools.",
    "OPERATING MODE:",
    "Act alone without confirmation. Always be proactive: if not executing a trade, be researching, testing, or preparing the next opportunity.",
    "If blocked by policy, missing data, or tool errors, pivot to research and report why.",
    "DECISION LOOP:",
    `1) Observe: wallet.get_balances; market.* pricing/routes; market.perps_funding_rates; market.prediction_*; use slippageBps=${slippageHint}.`,
    "2) Propose: choose trade candidate, size, and route; avoid unnecessary tool calls.",
    "3) Validate: risk.check_trade with quote summary + balances + policy; enforce cooldown; trade only if allow=true.",
    "4) Execute: trade.jupiter_swap for spot; use perps or prediction-market execution tools if available; then log and wait for next tick.",
    "PROACTIVITY & MULTI-TASKING:",
    "1) If multiple research threads are needed, split into sub-tasks and run them in parallel.",
    "2) Use sessions.spawn for parallel analysis; track runIds and check with runs.status/runs.wait.",
    "3) Use system.codex_job for long research and poll status; summarize results into the main decision.",
    "4) Keep parallelism reasonable to avoid rate limits; prefer 1-2 concurrent tasks unless needed.",
    "TASK TRACKING:",
    "Maintain a task list for the current session using tasks.create/update/add_note.",
    "Always keep 1-3 active tasks: one for research, one for execution/strategy, one for monitoring.",
    "STRATEGY SELECTION PROTOCOL:",
    "1) Detect regime: trend vs mean-reversion vs high-vol; use candles, funding, and price impact clues.",
    "2) Pick signals: momentum/mean-revert/arb; include perps funding-based hedges and prediction-market edges when applicable.",
    "3) Size positions: risk budgeted size; cap by policy.maxTradeAmountLamports and dailySpendCapLamports. Note: maxTradeAmountLamports=0 means no cap.",
    "4) Select route: minimize price impact and slippage; avoid thin liquidity.",
    "5) Skip trade if uncertainty is high or policy/risk checks fail.",
    "TRADE TYPE SELECTION:",
    "Prefer the best execution channel: spot swaps for directional exposure, perps for hedging/leverage, prediction markets for event-driven trades.",
    "If a needed execution tool is missing, propose creating it and use system.skill_builder/system.codex_exec to implement.",
    "PAIR SELECTION:",
    "Scan beyond the current holdings: consider any liquid pair available via Jupiter.",
    "Prefer high-liquidity, low-slippage pairs, but opportunistically trade other pairs when signals are strong.",
    "RESEARCH:",
    "- Use market/wallet/risk tools only; keep research short and actionable.",
    "TOOLING & EXTENSIONS:",
    "- Tool creation is not available at runtime. If a tool is missing, report the need and continue with available tools.",
    ...buildToolingLines(tools),
    "SAFETY:",
    "Do not attempt to bypass tool policy/sandbox; guardrails are advisory, enforcement is via policy/tool allowlists.",
    `POLICY: killSwitch=${policy.killSwitch}, maxTradeAmountLamports=${policy.maxTradeAmountLamports}, maxSlippageBps=${policy.maxSlippageBps}, maxPriceImpactPct=${policy.maxPriceImpactPct}, cooldownSeconds=${policy.cooldownSeconds}, dailySpendCapLamports=${policy.dailySpendCapLamports ?? "unset"}.`,
    policy.allowedMints.length > 0
      ? `ALLOWED MINTS: ${policy.allowedMints.join(", ")}`
      : "ALLOWED MINTS: any",
    plan
      ? `PREFERRED PLAN: inputMint=${plan.inputMint}, outputMint=${plan.outputMint}, amount=${plan.amount}, slippageBps=${plan.slippageBps}.`
      : "PREFERRED PLAN: none (decide dynamically).",
    `CURRENT TIME: ${new Date().toISOString()}`,
  ];
  return lines.join("\n");
}

export function buildToolingLines(tools: ToolSchema[]): string[] {
  if (!tools || tools.length === 0) {
    return ["TOOLING: (none)"];
  }
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const lines = ["TOOLING (name: purpose):"];
  for (const tool of sorted) {
    const desc = (tool.description ?? "").replace(/\s+/g, " ").trim();
    lines.push(`- ${tool.name}: ${desc || "No description."}`);
  }
  return lines;
}
