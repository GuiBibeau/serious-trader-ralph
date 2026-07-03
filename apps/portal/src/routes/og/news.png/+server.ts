// "On the wire" OG card: the live feed, screenshotted. Three fresh
// headlines + the day's movers, stamped with the render time so shares
// always look (and are) current. Re-rendered every 15 minutes at the CDN.

import { error } from "@sveltejs/kit";
import {
  brandRow,
  C,
  el,
  fmtPct,
  frame,
  renderOgPng,
  text,
  utcStamp,
} from "$lib/server/og";
import { getCatalog, getNewsFeed } from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

export const GET: RequestHandler = async ({ setHeaders }) => {
  const [news, assets] = await Promise.all([
    getNewsFeed(12).catch(() => {
      error(503, "Feed unavailable");
    }),
    getCatalog().catch(() => []),
  ]);

  const movers = assets
    .filter(
      (asset) =>
        asset.change24hPct !== null && (asset.volume24hUsd ?? 0) > 100_000,
    )
    .sort(
      (a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0),
    )
    .slice(0, 4);

  const tree = frame([
    brandRow(`traderralph.com/news · ${utcStamp()}`),

    el("div", { alignItems: "baseline", gap: "20px", marginTop: "40px" }, [
      text("ON THE WIRE", {
        fontSize: "44px",
        fontWeight: 700,
        letterSpacing: "4px",
      }),
      text("LIVE", {
        fontSize: "20px",
        fontWeight: 700,
        color: C.accent,
        letterSpacing: "3px",
      }),
    ]),

    // Headlines
    el(
      "div",
      { flexDirection: "column", marginTop: "26px", width: "100%" },
      news.slice(0, 3).map((item) =>
        el(
          "div",
          {
            flexDirection: "column",
            borderBottom: `1px solid ${C.line}`,
            padding: "18px 0",
            width: "100%",
          },
          [
            text(item.source.toUpperCase(), {
              fontSize: "17px",
              fontWeight: 700,
              color: C.accent,
              letterSpacing: "2px",
            }),
            text(clip(item.title, 92), {
              fontSize: "27px",
              color: C.ink,
              marginTop: "6px",
              lineHeight: 1.25,
            }),
          ],
        ),
      ),
    ),

    // Movers strip
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
          { gap: "30px", alignItems: "baseline" },
          movers.map((asset) =>
            el("div", { gap: "10px", alignItems: "baseline" }, [
              text(asset.symbol, {
                fontSize: "24px",
                fontWeight: 700,
                color: C.ink,
              }),
              text(fmtPct(asset.change24hPct), {
                fontSize: "24px",
                fontWeight: 700,
                color: (asset.change24hPct ?? 0) >= 0 ? C.up : C.down,
              }),
            ]),
          ),
        ),
        text("Tagged to tradable markets", {
          fontSize: "19px",
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
