// Static OG card for the landing, hubs and /news — same satori pipeline as
// the spotlight cards.

import { read } from "$app/server";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
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

export const GET: RequestHandler = async ({ setHeaders }) => {
  const fonts = await loadFonts();

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
            style: { display: "flex", fontSize: "26px", fontWeight: 700, letterSpacing: "4px" },
            children: [
              { type: "span", props: { children: "RALPH" } },
              { type: "span", props: { style: { color: "#ff4d97" }, children: "·TERMINAL" } },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              fontSize: "86px",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-2px",
              marginTop: "96px",
            },
            children: [
              { type: "div", props: { style: { display: "flex" }, children: "SOL to SPACEX." } },
              { type: "div", props: { style: { display: "flex", color: "#ff4d97" }, children: "One account." } },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", fontSize: "30px", color: "#8c95a4", marginTop: "40px" },
            children: "Spot and perps on 300+ Solana markets, settled in USDC",
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", marginTop: "auto", fontSize: "24px", color: "#8c95a4" },
            children: "Spot by Jupiter · perps on Phoenix · email login, no seed phrase",
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
    "cache-control": "public, s-maxage=604800, stale-while-revalidate=86400",
  });
  return new Response(new Uint8Array(png));
};
