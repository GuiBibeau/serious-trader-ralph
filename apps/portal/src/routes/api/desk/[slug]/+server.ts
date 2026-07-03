// Cached desk read for spotlight pages. Same hard rule as the terminal's AI
// layer: the model narrates facts we computed — it never invents numbers. A
// post-validator drops any response containing a number that wasn't in the
// input facts, falling back to null (the page then shows the pulse instead).

import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { getPerpSymbols } from "$lib/server/phoenix-markets";
import {
  computePulse,
  findBySlug,
  getSpotlightBundle,
} from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

const READ_TTL_MS = 4 * 60 * 60_000; // matches s-maxage=14400
const NULL_TTL_MS = 60_000; // retry failed generations quickly
// Keyed by assetId, not slug — slug ownership can change between catalog
// refreshes and must never serve another asset's note.
const readCache = new Map<string, { read: string | null; at: number }>();

const SYSTEM =
  "You are a buy-side desk strategist writing a two-to-three sentence morning note on one asset. " +
  "Plain, confident, concrete - the tone of an experienced trader, not marketing. " +
  "Use ONLY the numbers given in the facts; never compute or invent any figure. " +
  "No advice, no 'you should', no exclamation points, no emojis, no preamble.";

export const GET: RequestHandler = async ({ params, setHeaders }) => {
  // Long CDN cache only for successful reads — a 404 or a transient null
  // (DeepSeek down, validator rejection) must not pin a blank note for 4h.
  const longCache = () =>
    setHeaders({
      "cache-control": "public, s-maxage=14400, stale-while-revalidate=86400",
    });
  const shortCache = () =>
    setHeaders({ "cache-control": "public, s-maxage=60" });

  const asset = await findBySlug(params.slug);
  if (!asset) {
    shortCache();
    return json({ read: null }, { status: 404 });
  }

  const cached = readCache.get(asset.assetId);
  if (cached) {
    const age = Date.now() - cached.at;
    if (age < (cached.read === null ? NULL_TTL_MS : READ_TTL_MS)) {
      cached.read === null ? shortCache() : longCache();
      return json({ read: cached.read });
    }
  }

  const read = await generateRead(asset).catch(() => null);
  readCache.set(asset.assetId, { read, at: Date.now() });
  read === null ? shortCache() : longCache();
  return json({ read });
};

type Asset = NonNullable<Awaited<ReturnType<typeof findBySlug>>>;

async function generateRead(asset: Asset): Promise<string | null> {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const bundle = await getSpotlightBundle(asset);
  const pulse = computePulse(bundle);
  const perps = await getPerpSymbols().catch(() => new Set<string>());

  const facts = [
    `Asset: ${asset.name} (${asset.symbol}), a ${asset.hub} asset tokenized on Solana.`,
    ...pulse.map((line) => `Fact: ${line}`),
    ...bundle.news
      .slice(0, 5)
      .map((item) => `Headline (${item.source}): ${item.title}`),
    `Venues: spot${perps.has(asset.symbol.toUpperCase()) ? " and perps" : " only"}.`,
  ].join("\n");

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.5,
      max_tokens: 220,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: facts },
      ],
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text || text.length < 40) return null;
  return numbersAreGrounded(text, facts) ? text : null;
}

/** Every numeric token in the output must appear in the input facts. */
function numbersAreGrounded(output: string, facts: string): boolean {
  const factNumbers = new Set(
    (facts.match(/\d[\d,]*\.?\d*/g) ?? []).map((value) =>
      value.replace(/,/g, ""),
    ),
  );
  const outputNumbers = (output.match(/\d[\d,]*\.?\d*/g) ?? []).map((value) =>
    value.replace(/,/g, ""),
  );
  return outputNumbers.every(
    (value) =>
      factNumbers.has(value) ||
      // Allow re-formatting like "24" from "24 hours" / "7" from "7-day".
      ["24", "7", "30"].includes(value),
  );
}
