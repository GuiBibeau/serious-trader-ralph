// Markdown mirror of the spotlight page — cheap for LLMs and agents to read.
// Linked from llms.txt; same data, zero chrome.

import { error } from "@sveltejs/kit";
import { getPerpSymbols } from "$lib/server/phoenix-markets";
import {
  computePulse,
  findBySlug,
  getSpotlightBundle,
} from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

const SITE = "https://traderralph.com";

export const GET: RequestHandler = async ({ params, setHeaders }) => {
  const asset = await findBySlug(params.slug);
  if (!asset) error(404, "Unknown asset");

  const [bundle, perps] = await Promise.all([
    getSpotlightBundle(asset),
    getPerpSymbols().catch(() => new Set<string>()),
  ]);
  const pulse = computePulse(bundle);
  const hasPerp = perps.has(asset.symbol.toUpperCase());

  const fmt = (value: number | null) =>
    value === null ? "n/a" : `$${value.toLocaleString()}`;

  const lines = [
    `# ${asset.name} (${asset.symbol})`,
    "",
    `> Tokenized ${asset.hub === "pre-ipo" ? "pre-IPO exposure" : asset.hub === "equities" ? "stock" : "crypto asset"} on Solana. Trade spot${hasPerp ? " or perps" : ""} at ${SITE}/${asset.slug}`,
    "",
    "## Market",
    "",
    `- Price: ${fmt(asset.price)}`,
    `- 24h change: ${asset.change24hPct === null ? "n/a" : `${asset.change24hPct.toFixed(2)}%`}`,
    `- 24h volume: ${fmt(asset.volume24hUsd)}`,
    `- Market cap: ${fmt(asset.marketCap)}`,
    `- All-time high: ${fmt(bundle.profile?.allTimeHigh ?? null)}`,
    `- Mint: \`${asset.mint}\``,
    "",
  ];

  if (pulse.length) {
    lines.push("## Pulse", "", ...pulse.map((line) => `- ${line}`), "");
  }
  if (bundle.description) {
    lines.push("## About", "", bundle.description, "");
  }
  if (bundle.news.length) {
    lines.push(
      `## ${bundle.newsIsAssetScoped ? "News" : "Market headlines"}`,
      "",
      ...bundle.news.map(
        (item) => `- [${item.title}](${item.url}) — ${item.source}`,
      ),
      "",
    );
  }
  lines.push(
    "## Trade",
    "",
    `- [Buy ${asset.symbol} spot](${SITE}/terminal?asset=${asset.assetId}&venue=spot&side=buy)`,
    ...(hasPerp
      ? [
          `- [Long ${asset.symbol} perp](${SITE}/terminal?asset=${asset.symbol}&venue=perp&side=long)`,
          `- [Short ${asset.symbol} perp](${SITE}/terminal?asset=${asset.symbol}&venue=perp&side=short)`,
        ]
      : []),
    "",
    "Tokenized equities provide synthetic exposure, not shareholder rights. Not financial advice.",
    "",
  );

  setHeaders({
    "content-type": "text/markdown; charset=utf-8",
    "cache-control": "public, s-maxage=300, stale-while-revalidate=3600",
    // The HTML spotlight is the indexed version; the mirror is for agents.
    link: `<${SITE}/${asset.slug}>; rel="canonical"`,
    "x-robots-tag": "noindex",
  });
  return new Response(lines.join("\n"));
};
