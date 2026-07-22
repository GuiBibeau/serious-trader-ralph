// DeepSeek-backed "interpretation layer" for the terminal.
//
// Hard rule: AI only narrates / parses language. It never computes a price,
// PnL, size, or liquidation level, and never places an order. Every number it
// sees is already computed deterministically and passed in as read-only input.
//
// Calls go to the same-origin /deepseek proxy (see vite.config.ts), which
// injects the API key server-side — the key is never in the client bundle.

const AI_ENDPOINT = "/deepseek/chat/completions";
const MODEL = "deepseek-chat";

export type AiPhase = "idle" | "loading" | "ready" | "error";

export type AiRead = {
  phase: AiPhase;
  text: string;
  error?: string;
  /** When the read landed — rendered as an "as of" stamp. */
  asOf?: number;
};

export const IDLE_READ: AiRead = { phase: "idle", text: "" };

export type OrderIntent = {
  side: "buy" | "sell";
  symbol: string | null;
  orderType: "market" | "limit";
  sizeUsd: number | null;
  leverage: number | null;
  limitPrice: number | null;
  stopPercent: number | null;
  note: string;
};

const textCache = new Map<string, string>();

export function aiDisabled(): boolean {
  const env = import.meta.env as Record<string, string | undefined>;
  return env.VITE_AI_DISABLED === "1";
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

async function complete(input: {
  system: string;
  user: string;
  cacheKey?: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  if (input.cacheKey) {
    const hit = textCache.get(input.cacheKey);
    if (hit !== undefined) return hit;
  }
  const response = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 140,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      ...(input.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "ai-proxy-unavailable"
        : `ai-http-${response.status}`,
    );
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = String(data.choices?.[0]?.message?.content ?? "").trim();
  if (input.cacheKey) textCache.set(input.cacheKey, text);
  return text;
}

const ANALYST_SYSTEM =
  "You are the desk strategist inside a focused Solana + internet-capital-markets trading terminal. " +
  "You receive pre-computed market data as JSON and write one tight, trader-grade read. " +
  "Rules: max 2 short sentences, no hype, no disclaimers, no emojis, no markdown. " +
  "Never invent numbers — only reason about the values given. If data is missing or zero, say so plainly.";

export async function aiMacroRead(snapshot: unknown): Promise<string> {
  const user = JSON.stringify(snapshot);
  return complete({
    system: ANALYST_SYSTEM,
    user: `Macro signal blend. Summarize the regime (risk-on/off), call out the dominant and any conflicting signals.\n\n${user}`,
    cacheKey: `macro:${hash(user)}`,
    maxTokens: 110,
  });
}

export async function aiPositionBrief(
  snapshot: unknown,
  paper = false,
): Promise<string> {
  const user = JSON.stringify(snapshot);
  const book = paper
    ? "The trader's SIMULATED paper book (not real funds; never call it a real or on-chain position)"
    : "The trader's open book";
  return complete({
    system: ANALYST_SYSTEM,
    user: `${book}. Brief them like a morning note: what they're carrying, what the funding/basis costs them, and the one thing to watch. Address them as "you".\n\n${user}`,
    cacheKey: `brief:${paper ? "paper:" : ""}${hash(user)}`,
    maxTokens: 120,
  });
}

export async function aiSessionRecap(
  snapshot: unknown,
  paper = false,
): Promise<string> {
  const user = JSON.stringify(snapshot);
  const log = paper
    ? "Today's SIMULATED paper trade log (not real funds; recap it as paper trading)"
    : "Today's trade log for one trader";
  return complete({
    system: ANALYST_SYSTEM,
    user: `${log}. Recap the session in plain desk language: activity, concentration, and anything notable about the pattern. No advice.\n\n${user}`,
    cacheKey: `recap:${paper ? "paper:" : ""}${hash(user)}`,
    maxTokens: 110,
  });
}

export async function aiFundingRead(snapshot: unknown): Promise<string> {
  const user = JSON.stringify(snapshot);
  return complete({
    system: ANALYST_SYSTEM,
    user: `Perp funding + basis read. Note who pays whom, whether positioning looks crowded, and what the carry favors.\n\n${user}`,
    cacheKey: `funding:${hash(user)}`,
    maxTokens: 100,
  });
}

export async function aiScannerSetups(snapshot: unknown): Promise<string> {
  const user = JSON.stringify(snapshot);
  return complete({
    system: ANALYST_SYSTEM,
    user: `Scanner of Solana perp markets. Pick the 1-2 most interesting setups from the data and say why in one line each. Reference tickers.\n\n${user}`,
    cacheKey: `scan:${hash(user)}`,
    maxTokens: 130,
  });
}

export async function aiTradeRead(snapshot: unknown): Promise<string> {
  const user = JSON.stringify(snapshot);
  return complete({
    system: ANALYST_SYSTEM,
    user: `Pre-trade read on the order below. Comment on slippage vs the book, spread, funding cost, and distance to liquidation. Be a risk check, not a cheerleader.\n\n${user}`,
    cacheKey: `trade:${hash(user)}`,
    maxTokens: 110,
  });
}

export async function aiEventRead(headlines: unknown): Promise<string> {
  const user = JSON.stringify(headlines);
  return complete({
    system: ANALYST_SYSTEM,
    user: `Live headlines. In one line, give the market-relevant takeaway and the risk skew (risk-on / risk-off / neutral). Ignore noise.\n\n${user}`,
    cacheKey: `event:${hash(user)}`,
    maxTokens: 90,
  });
}

export async function aiTradeIdeas(snapshot: unknown): Promise<string> {
  const user = JSON.stringify(snapshot);
  return complete({
    system:
      ANALYST_SYSTEM +
      " For this task you may suggest 1-2 concrete, cited trade ideas (direction + the data point that supports it). Keep each to one line. These are observations for a human to confirm, not orders.",
    user: `Synthesize the macro regime, perp funding, and market scan below into at most two cited ideas.\n\n${user}`,
    cacheKey: `ideas:${hash(user)}`,
    maxTokens: 150,
  });
}

const COMMAND_SYSTEM =
  "You translate a trader's natural-language order into strict JSON for a Solana perp ticket. " +
  "Output ONLY a JSON object with keys: side ('buy'|'sell'), symbol (uppercase base like 'SOL' or null), " +
  "orderType ('market'|'limit'), sizeUsd (number USD notional or null), leverage (number or null), " +
  "limitPrice (number or null), stopPercent (number percent or null), note (short string). " +
  "Map long->buy, short->sell. Infer nothing you cannot justify; use null when unspecified.";

export async function aiParseCommand(
  text: string,
  symbols: string[],
): Promise<OrderIntent> {
  const raw = await complete({
    system: COMMAND_SYSTEM,
    user: `Known symbols: ${symbols.slice(0, 40).join(", ")}\nCommand: ${text}`,
    json: true,
    temperature: 0,
    maxTokens: 160,
  });
  const parsed = JSON.parse(raw) as Partial<OrderIntent>;
  const side = parsed.side === "sell" ? "sell" : "buy";
  const orderType = parsed.orderType === "limit" ? "limit" : "market";
  const symbol =
    typeof parsed.symbol === "string" && parsed.symbol.trim()
      ? parsed.symbol.trim().toUpperCase()
      : null;
  return {
    side,
    symbol,
    orderType,
    sizeUsd: numberOrNull(parsed.sizeUsd),
    leverage: numberOrNull(parsed.leverage),
    limitPrice: numberOrNull(parsed.limitPrice),
    stopPercent: numberOrNull(parsed.stopPercent),
    note: typeof parsed.note === "string" ? parsed.note : "",
  };
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
