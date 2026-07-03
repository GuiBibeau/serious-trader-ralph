// Hub OG cards (/og/equities.png, /og/pre-ipo.png, /og/crypto.png): a live
// mover table for the hub — the share IS the market data.

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
import { getCatalog } from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

const COPY: Record<string, { title: string; tagline: string }> = {
  equities: {
    title: "TOKENIZED STOCKS",
    tagline: "NVDA to SPY, onchain, 24/7 — no brokerage account",
  },
  "pre-ipo": {
    title: "PRE-IPO MARKETS",
    tagline: "SpaceX, Anthropic, OpenAI — priced before they list",
  },
  crypto: {
    title: "CRYPTO MAJORS",
    tagline: "Spot by Jupiter, perps on Phoenix, settled in USDC",
  },
};

export const GET: RequestHandler = async ({ params, setHeaders }) => {
  const copy = COPY[params.hub];
  if (!copy) error(404, "Unknown hub");
  const assets = await getCatalog().catch(() => {
    error(503, "Catalog unavailable");
  });

  const rows = assets
    .filter((asset) => asset.hub === params.hub && asset.price !== null)
    .sort(
      (a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0),
    )
    .slice(0, 5);
  const count = assets.filter((asset) => asset.hub === params.hub).length;

  const tree = frame([
    brandRow(`traderralph.com/${params.hub} · ${utcStamp()}`),

    el("div", { alignItems: "baseline", gap: "20px", marginTop: "36px" }, [
      text(copy.title, {
        fontSize: "44px",
        fontWeight: 700,
        letterSpacing: "4px",
      }),
      text(`${count} MARKETS`, {
        fontSize: "20px",
        fontWeight: 700,
        color: C.accent,
        letterSpacing: "3px",
      }),
    ]),

    // Mover table
    el(
      "div",
      {
        flexDirection: "column",
        marginTop: "28px",
        width: "100%",
        border: `1px solid ${C.line}`,
        borderRadius: "0",
        backgroundColor: C.surface,
      },
      rows.map((asset, index) =>
        el(
          "div",
          {
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 28px",
            borderBottom:
              index === rows.length - 1 ? "none" : `1px solid ${C.line}`,
            width: "100%",
          },
          [
            el("div", { gap: "20px", alignItems: "baseline", width: "420px" }, [
              text(asset.symbol, { fontSize: "30px", fontWeight: 700 }),
              text(asset.name.slice(0, 22), {
                fontSize: "20px",
                color: C.faint,
              }),
            ]),
            text(fmtPrice(asset.price), {
              fontSize: "30px",
              fontWeight: 700,
              color: C.muted,
            }),
            text(fmtPct(asset.change24hPct), {
              fontSize: "30px",
              fontWeight: 700,
              color: (asset.change24hPct ?? 0) >= 0 ? C.up : C.down,
              width: "170px",
              justifyContent: "flex-end",
            }),
          ],
        ),
      ),
    ),

    el(
      "div",
      {
        marginTop: "auto",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
      },
      [
        text(copy.tagline, { fontSize: "22px", color: C.muted }),
        text("Email login · no seed phrase", {
          fontSize: "20px",
          color: C.faint,
        }),
      ],
    ),
  ]);

  setHeaders({
    "content-type": "image/png",
    "cache-control": "public, s-maxage=900, stale-while-revalidate=3600",
  });
  return new Response(await renderOgPng(tree));
};
