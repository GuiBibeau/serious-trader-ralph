// Static OG card for the landing, hubs and /news — same satori pipeline as
// the spotlight cards.

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { read } from "$app/server";
import interBold from "$lib/server/fonts/Inter-Bold.ttf";
import interRegular from "$lib/server/fonts/Inter-Regular.ttf";
import { brandMark, C } from "$lib/server/og";
import type { RequestHandler } from "./$types";

const W = 1200;
const H = 630;

let fontsPromise: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | null =
  null;
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
        backgroundColor: C.paper,
        padding: "64px 80px",
        fontFamily: "Inter",
        color: C.ink,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              fontSize: "26px",
              fontWeight: 700,
              letterSpacing: "4px",
            },
            children: [
              brandMark(34),
              {
                type: "span",
                props: { style: { marginLeft: "14px" }, children: "RALPH" },
              },
              {
                type: "span",
                props: { style: { color: C.accent }, children: "·TERMINAL" },
              },
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
              {
                type: "div",
                props: {
                  style: { display: "flex" },
                  children: "SOL to SPACEX.",
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", color: C.accent },
                  children: "One account.",
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
              fontSize: "30px",
              color: C.muted,
              marginTop: "40px",
            },
            children: "Spot and perps on 300+ Solana markets, settled in USDC",
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              marginTop: "auto",
              fontSize: "24px",
              color: C.muted,
            },
            children:
              "Spot by Jupiter · perps on Phoenix · email login, no seed phrase",
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

  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } })
    .render()
    .asPng();
  setHeaders({
    "content-type": "image/png",
    "cache-control": "public, s-maxage=604800, stale-while-revalidate=86400",
  });
  return new Response(new Uint8Array(png));
};
