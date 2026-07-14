// Landing OG card: brand statement plus a LIVE strip of curated flagships.
// Same honest-data rule as the hub cards: catalog failure is a 503, never
// placeholder numbers.

import { error } from "@sveltejs/kit";
import {
  brandRow,
  C,
  el,
  fmtPct,
  fmtPrice,
  frame,
  renderOgPng,
  text,
  utcStamp,
} from "$lib/server/og";
import { type CatalogAsset, getCatalog } from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

function moverCell(asset: CatalogAsset): Record<string, unknown> {
  const up = (asset.change24hPct ?? 0) >= 0;
  return el(
    "div",
    {
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
      border: `1px solid ${C.line}`,
      borderRadius: "0",
      backgroundColor: C.surface,
      padding: "18px 24px",
      gap: "6px",
    },
    [
      text(asset.symbol, {
        fontSize: "22px",
        fontWeight: 700,
        letterSpacing: "2px",
        color: C.ink,
      }),
      text(fmtPrice(asset.price), {
        fontSize: "30px",
        fontWeight: 700,
        color: C.muted,
      }),
      text(fmtPct(asset.change24hPct), {
        fontSize: "22px",
        fontWeight: 700,
        color: up ? C.up : C.down,
      }),
    ],
  );
}

export const GET: RequestHandler = async ({ setHeaders }) => {
  const assets = await getCatalog().catch(() => {
    error(503, "Catalog unavailable");
  });

  // Curated flagship lineup — this is a marketing card, so it delivers the
  // hero tagline ("SOL to SPACEX. One account."): SOL, BTC, NVDA, SpaceX.
  // Top-mover selection was tried and surfaced crash-outliers and sub-penny
  // unknowns (extreme tokens.xyz prints are often data artifacts) — never
  // lead an acquisition card with those. Real prices only: any of the four
  // that is missing or unpriced is honestly omitted, never faked.
  const FLAGSHIP_ASSET_IDS = ["solana", "bitcoin", "nvidia", "spacex"];
  const movers = FLAGSHIP_ASSET_IDS.map(
    (id) =>
      assets.find((asset) => asset.assetId === id && asset.price !== null) ??
      null,
  ).filter((asset): asset is CatalogAsset => asset !== null);
  if (movers.length === 0) error(503, "Market data unavailable");

  const tree = frame([
    brandRow(`LIVE ${utcStamp()}`),

    // Hero — the brand statement.
    el(
      "div",
      {
        flexDirection: "column",
        fontSize: "84px",
        fontWeight: 700,
        lineHeight: 1.05,
        letterSpacing: "-2px",
        marginTop: "52px",
      },
      [
        text("SOL to SPACEX.", { color: C.ink }),
        text("One account.", { color: C.accent }),
      ],
    ),

    // Live movers strip.
    el(
      "div",
      { gap: "16px", width: "100%", marginTop: "48px" },
      movers.map((asset) => moverCell(asset)),
    ),

    text("Spot and perps on Solana — settled in USDC · traderralph.com", {
      marginTop: "auto",
      fontSize: "24px",
      color: C.muted,
    }),
  ]);

  setHeaders({
    "content-type": "image/png",
    "cache-control": "public, s-maxage=900, stale-while-revalidate=3600",
  });
  return new Response(await renderOgPng(tree));
};
