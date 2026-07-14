// Terminal OG card: the trading desk at a glance — brand bar, live SOL
// price with 24h badge, and a real 7-day sparkline in a chart panel.
// Every number comes from tokens.xyz; any fetch failure — or a bundle
// without enough candles to draw the chart — is a 503.

import { error } from "@sveltejs/kit";
import {
  brandMark,
  C,
  chip,
  el,
  fmtPct,
  fmtPrice,
  frame,
  renderOgPng,
  text,
  utcStamp,
} from "$lib/server/og";
import { getCatalog, getSpotlightBundle } from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

// Frame inner width (1200 − 2×72 padding); panel chart sits inside borders.
const PANEL_W = 1056;
const SPARK_W = 1004;
const SPARK_H = 168;

export const GET: RequestHandler = async ({ setHeaders }) => {
  const assets = await getCatalog().catch(() => {
    error(503, "Catalog unavailable");
  });
  const sol = assets.find(
    (asset) => asset.symbol.toUpperCase() === "SOL" && asset.price !== null,
  );
  if (!sol) error(503, "SOL market data unavailable");

  const bundle = await getSpotlightBundle(sol).catch(() => {
    error(503, "SOL market data unavailable");
  });

  const change = sol.change24hPct;
  const up = (change ?? 0) >= 0;
  const trendColor = up ? C.up : C.down;

  // Sparkline — same idiom as the spotlight card, sized as a wide band.
  // The panel advertises "SOL / USDC · 7 DAYS"; without a drawable line the
  // card is a silent bad-data render (and cacheable), so 503 instead.
  const closes = bundle.candles.map((candle) => candle.close);
  if (closes.length < 2) error(503, "SOL market data unavailable");
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const sparkPoints = closes
    .map((close, index) => {
      const x = (index / (closes.length - 1)) * SPARK_W;
      const y = SPARK_H - 12 - ((close - min) / span) * (SPARK_H - 24);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const tree = frame([
    // Top bar: mark + desk label left, live chip right.
    el(
      "div",
      { justifyContent: "space-between", alignItems: "center", width: "100%" },
      [
        el("div", { alignItems: "center", gap: "14px" }, [
          brandMark(30),
          text("TRADER RALPH — TERMINAL", {
            fontSize: "22px",
            fontWeight: 700,
            letterSpacing: "4px",
            color: C.muted,
          }),
        ]),
        chip("LIVE ON SOLANA", C.accent),
      ],
    ),

    // Hero row: SOL, live price, 24h badge.
    el(
      "div",
      {
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginTop: "40px",
        width: "100%",
      },
      [
        el("div", { alignItems: "baseline", gap: "28px" }, [
          text("SOL", {
            fontSize: "68px",
            fontWeight: 700,
            letterSpacing: "-1px",
          }),
          text(fmtPrice(sol.price), {
            fontSize: "92px",
            fontWeight: 700,
            letterSpacing: "-3px",
          }),
        ]),
        el(
          "div",
          {
            backgroundColor: up
              ? "rgba(44,233,127,0.12)"
              : "rgba(255,90,106,0.12)",
            border: `2px solid ${trendColor}`,
            borderRadius: "0",
            padding: "12px 24px",
            flexDirection: "column",
            alignItems: "flex-end",
          },
          [
            text(fmtPct(change), {
              fontSize: "44px",
              fontWeight: 700,
              color: trendColor,
            }),
            text("24 HOURS", {
              fontSize: "16px",
              color: C.muted,
              letterSpacing: "2px",
            }),
          ],
        ),
      ],
    ),

    // Chart panel: thin-bordered surface, header strip, wide sparkline band.
    el(
      "div",
      {
        flexDirection: "column",
        width: `${PANEL_W}px`,
        marginTop: "32px",
        border: `1px solid ${C.line}`,
        borderRadius: "0",
        backgroundColor: C.surface,
      },
      [
        el(
          "div",
          {
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
            padding: "14px 24px",
            borderBottom: `1px solid ${C.line}`,
          },
          [
            text("SOL / USDC · 7 DAYS", {
              fontSize: "18px",
              fontWeight: 700,
              letterSpacing: "3px",
              color: C.muted,
            }),
            text(utcStamp(), { fontSize: "18px", color: C.faint }),
          ],
        ),
        {
          type: "svg",
          props: {
            width: SPARK_W,
            height: SPARK_H,
            viewBox: `0 0 ${SPARK_W} ${SPARK_H}`,
            style: { margin: "8px 24px", display: "flex" },
            children: [
              {
                type: "polyline",
                props: {
                  points: sparkPoints,
                  fill: "none",
                  stroke: trendColor,
                  "stroke-width": 4,
                },
              },
              {
                type: "polygon",
                props: {
                  points: `0,${SPARK_H} ${sparkPoints} ${SPARK_W},${SPARK_H}`,
                  fill: trendColor,
                  opacity: 0.08,
                },
              },
            ],
          },
        },
      ],
    ),

    // Footer: venue facts + destination.
    el(
      "div",
      {
        marginTop: "auto",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
      },
      [
        text("Perps on Phoenix · Spot by Jupiter · one USDC account", {
          fontSize: "22px",
          color: C.muted,
        }),
        text("traderralph.com/terminal", {
          fontSize: "22px",
          fontWeight: 700,
          color: C.ink,
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
