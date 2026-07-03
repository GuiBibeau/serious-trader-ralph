// Asset spotlight OG card. Built for the feed-scroll: huge live price,
// colored 24h badge, sparkline, and a strip of computed "alpha" facts
// (volume multiple, ATH distance, venues). Every number is real — the
// attention comes from hierarchy, not decoration.

import { error } from "@sveltejs/kit";
import {
  brandRow,
  C,
  chip,
  el,
  fetchImageDataUri,
  fmtPct,
  fmtPrice,
  frame,
  renderOgPng,
  text,
  utcStamp,
} from "$lib/server/og";
import { getPerpSymbols } from "$lib/server/phoenix-markets";
import { findBySlug, getSpotlightBundle } from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, setHeaders }) => {
  const asset = await findBySlug(params.slug);
  if (!asset) error(404, "Unknown asset");

  const [bundle, perps, logo] = await Promise.all([
    getSpotlightBundle(asset),
    getPerpSymbols().catch(() => new Set<string>()),
    fetchImageDataUri(asset.imageUrl),
  ]);
  const hasPerp = perps.has(asset.symbol.toUpperCase());
  const change = asset.change24hPct;
  const up = (change ?? 0) >= 0;

  // ── Alpha facts, computed not narrated ──
  const facts: { label: string; tone: string }[] = [];
  const closes = bundle.candles.map((candle) => candle.close);
  if (bundle.candles.length > 100) {
    const recent = bundle.candles.slice(-96);
    const prior = bundle.candles.slice(0, -96);
    const recentVol = recent.reduce((sum, candle) => sum + candle.volume, 0);
    const priorAvg =
      (prior.reduce((sum, candle) => sum + candle.volume, 0) / prior.length) *
      96;
    if (priorAvg > 0) {
      const ratio = recentVol / priorAvg;
      facts.push({
        label: `VOL ${ratio.toFixed(1)}× 7-DAY AVG`,
        tone: ratio >= 1.5 ? C.up : C.muted,
      });
    }
  }
  if (asset.price !== null && bundle.profile?.allTimeHigh) {
    const drawdown =
      ((bundle.profile.allTimeHigh - asset.price) /
        bundle.profile.allTimeHigh) *
      100;
    facts.push(
      drawdown <= 1
        ? { label: "AT ALL-TIME HIGH", tone: C.up }
        : { label: `${drawdown.toFixed(0)}% OFF ATH`, tone: C.muted },
    );
  }
  facts.push(
    hasPerp
      ? { label: "SPOT + PERPS LIVE", tone: C.accent }
      : { label: "SPOT 24/7", tone: C.accent },
  );

  // ── Sparkline ──
  let sparkPoints = "";
  if (closes.length > 1) {
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    sparkPoints = closes
      .map((close, index) => {
        const x = (index / (closes.length - 1)) * 1056;
        const y = 132 - ((close - min) / span) * 116;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }
  const sparkColor = up ? C.up : C.down;

  const tree = frame([
    brandRow(`traderralph.com/${asset.slug} · LIVE ${utcStamp()}`),

    // Identity + price block
    el(
      "div",
      {
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginTop: "44px",
        width: "100%",
      },
      [
        el("div", { flexDirection: "column" }, [
          el("div", { alignItems: "center", gap: "18px" }, [
            ...(logo
              ? [
                  {
                    type: "img",
                    props: {
                      src: logo,
                      width: 58,
                      height: 58,
                      style: { borderRadius: "50%", display: "flex" },
                    },
                  },
                ]
              : []),
            text(asset.name.toUpperCase(), {
              fontSize: "30px",
              color: C.muted,
              letterSpacing: "2px",
            }),
          ]),
          el("div", { alignItems: "baseline", gap: "26px", marginTop: "6px" }, [
            text(asset.symbol, {
              fontSize: "64px",
              fontWeight: 700,
              letterSpacing: "-1px",
            }),
            text(fmtPrice(asset.price), {
              fontSize: "96px",
              fontWeight: 700,
              letterSpacing: "-3px",
            }),
          ]),
        ]),
        // 24h change badge — the thing the eye lands on
        el(
          "div",
          {
            backgroundColor: up
              ? "rgba(44,233,127,0.12)"
              : "rgba(255,90,106,0.12)",
            border: `2px solid ${sparkColor}`,
            borderRadius: "0",
            padding: "14px 26px",
            flexDirection: "column",
            alignItems: "flex-end",
          },
          [
            text(fmtPct(change), {
              fontSize: "52px",
              fontWeight: 700,
              color: sparkColor,
            }),
            text("24 HOURS", {
              fontSize: "18px",
              color: C.muted,
              letterSpacing: "2px",
            }),
          ],
        ),
      ],
    ),

    // Sparkline
    sparkPoints
      ? {
          type: "svg",
          props: {
            width: 1056,
            height: 150,
            viewBox: "0 0 1056 150",
            style: { marginTop: "36px", display: "flex" },
            children: [
              {
                type: "polyline",
                props: {
                  points: `${sparkPoints}`,
                  fill: "none",
                  stroke: sparkColor,
                  "stroke-width": 4,
                },
              },
              {
                type: "polygon",
                props: {
                  points: `0,150 ${sparkPoints} 1056,150`,
                  fill: sparkColor,
                  opacity: 0.08,
                },
              },
            ],
          },
        }
      : el("div", { flex: 1 }),

    // Fact chips + CTA line
    el(
      "div",
      {
        marginTop: "auto",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
      },
      [
        el(
          "div",
          { gap: "14px" },
          facts.slice(0, 3).map((fact) => chip(fact.label, fact.tone)),
        ),
        text(`Trade ${asset.symbol} · settled in USDC`, {
          fontSize: "22px",
          color: C.faint,
        }),
      ],
    ),
  ]);

  setHeaders({
    "content-type": "image/png",
    "cache-control": "public, s-maxage=900, stale-while-revalidate=86400",
  });
  return new Response(await renderOgPng(tree));
};
