// PnL share card. All numbers arrive via query params from the terminal's
// deterministic state (never computed here, never by AI) and are strictly
// validated/clamped — this endpoint just paints them.

import { error } from "@sveltejs/kit";
import { read } from "$app/server";
import satori from "satori";
import { brandMark } from "$lib/server/og";
import { Resvg } from "@resvg/resvg-js";
import { parsePositionParams } from "$lib/server/share";
import type { RequestHandler } from "./$types";

import interRegular from "$lib/server/fonts/Inter-Regular.ttf";
import interBold from "$lib/server/fonts/Inter-Bold.ttf";

const W = 1200;
const H = 630;

let fontsPromise: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | null = null;
function loadFonts() {
  fontsPromise ??= (async () => {
    const [regular, bold] = await Promise.all([
      read(interRegular).arrayBuffer(),
      read(interBold).arrayBuffer(),
    ]);
    return { regular, bold };
  })();
  return fontsPromise;
}

const fmtPrice = (value: number) =>
  value >= 1000
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : value >= 1
      ? value.toFixed(2)
      : value.toLocaleString(undefined, { maximumFractionDigits: 5 });

export const GET: RequestHandler = async ({ url, setHeaders }) => {
  const params = parsePositionParams(url.searchParams);
  if (!params) error(400, "Bad share params");
  const fonts = await loadFonts();

  const up = params.pnl >= 0;
  const accent = up ? "#2ce97f" : "#ff5a6a";
  const pnlText = `${up ? "+" : "-"}$${Math.abs(params.pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const tree = {
    type: "div",
    props: {
      style: {
        width: `${W}px`,
        height: `${H}px`,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0a0b0e",
        padding: "64px 80px",
        fontFamily: "Inter",
        color: "#eef1f6",
      },
      children: [
        {
          type: "div",
          props: {
            style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", fontSize: "26px", fontWeight: 700, letterSpacing: "4px" },
                  children: [
                    brandMark(34),
                    { type: "span", props: { style: { marginLeft: "14px" }, children: "RALPH" } },
                    { type: "span", props: { style: { color: "#ff4d97" }, children: "·TERMINAL" } },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", fontSize: "22px", color: "#8c95a4" },
                  children: "traderralph.com",
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: "34px",
              fontWeight: 700,
              marginTop: "84px",
              color: up ? "#2ce97f" : "#ff5a6a",
            },
            children: `${params.side.toUpperCase()} ${params.symbol}`,
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: "130px",
              fontWeight: 700,
              marginTop: "8px",
              color: accent,
            },
            children: pnlText,
          },
        },
        params.prices
          ? {
              type: "div",
              props: {
                style: { display: "flex", fontSize: "30px", color: "#8c95a4", marginTop: "18px" },
                children: `entry $${fmtPrice(params.prices.entry)}  →  mark $${fmtPrice(params.prices.mark)}`,
              },
            }
          : { type: "div", props: { style: { display: "flex" }, children: "" } },
        {
          type: "div",
          props: {
            style: { display: "flex", marginTop: "auto", fontSize: "24px", color: "#8c95a4" },
            children: "Perps on Phoenix · spot by Jupiter · settled in USDC",
          },
        },
      ],
    },
  };

  const svg = await satori(tree as Parameters<typeof satori>[0], {
    width: W,
    height: H,
    fonts: [
      { name: "Inter", data: fonts.regular, weight: 400, style: "normal" },
      { name: "Inter", data: fonts.bold, weight: 700, style: "normal" },
    ],
  });

  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  setHeaders({
    "content-type": "image/png",
    "cache-control": "public, s-maxage=86400, immutable",
  });
  return new Response(new Uint8Array(png));
};
