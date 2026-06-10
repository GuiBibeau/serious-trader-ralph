// Shared OG-card toolkit: fonts, palette, render pipeline, and the small
// pieces every card reuses (brand row, chips, formatters). All cards are
// 1200×630 satori trees rendered to PNG via resvg with bundled Inter — no
// network fonts, no client involvement.

import { read } from "$app/server";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import interRegular from "$lib/server/fonts/Inter-Regular.ttf";
import interBold from "$lib/server/fonts/Inter-Bold.ttf";

export const OG_W = 1200;
export const OG_H = 630;

// Terminal palette — keep cards visually identical to the product.
export const C = {
  paper: "#0a0b0e",
  surface: "#121419",
  line: "#272b34",
  ink: "#eef1f6",
  muted: "#8c95a4",
  faint: "#5a6472",
  accent: "#ff4d97",
  up: "#2ce97f",
  down: "#ff5a6a",
};

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

/** Terse element builder — satori requires explicit display:flex everywhere. */
export function el(
  type: string,
  style: Record<string, unknown>,
  children?: unknown,
): Record<string, unknown> {
  return {
    type,
    props: {
      style: { display: "flex", ...style },
      ...(children !== undefined ? { children } : {}),
    },
  };
}

export function text(
  content: string,
  style: Record<string, unknown>,
): Record<string, unknown> {
  return el("div", style, content);
}

/** The Candle R mark as a satori-compatible inline SVG. */
export function brandMark(size = 34): Record<string, unknown> {
  return {
    type: "svg",
    props: {
      width: size,
      height: size,
      viewBox: "0 0 512 512",
      style: { display: "flex" },
      children: [
        { type: "rect", props: { x: 170, y: 74, width: 20, height: 54, fill: C.accent } },
        { type: "rect", props: { x: 170, y: 384, width: 20, height: 54, fill: C.accent } },
        { type: "rect", props: { x: 152, y: 126, width: 56, height: 260, fill: C.ink } },
        {
          type: "path",
          props: {
            d: "M 206 126 H 284 A 78 78 0 0 1 284 282 H 206 V 226 H 284 A 22 22 0 0 0 284 182 H 206 Z",
            fill: C.ink,
          },
        },
        {
          type: "path",
          props: { d: "M 240 280 L 296 280 L 360 386 L 304 386 Z", fill: C.ink },
        },
      ],
    },
  };
}

/** Top row: mark + brand left, context (url / timestamp) right. */
export function brandRow(right: string): Record<string, unknown> {
  return el(
    "div",
    { justifyContent: "space-between", alignItems: "center", width: "100%" },
    [
      el("div", { alignItems: "center", gap: "14px" }, [
        brandMark(34),
        el("div", { fontSize: "26px", fontWeight: 700, letterSpacing: "4px" }, [
          text("RALPH", { color: C.ink }),
          text("·TERMINAL", { color: C.accent }),
        ]),
      ]),
      text(right, { fontSize: "21px", color: C.muted }),
    ],
  );
}

/** Bordered data chip for the fact strips. */
export function chip(label: string, tone: string = C.muted): Record<string, unknown> {
  return el(
    "div",
    {
      border: `1px solid ${C.line}`,
      borderRadius: "4px",
      padding: "10px 18px",
      fontSize: "22px",
      fontWeight: 700,
      color: tone,
      backgroundColor: C.surface,
    },
    label,
  );
}

export const fmtPrice = (value: number | null): string =>
  value === null
    ? "—"
    : `$${
        value >= 1000
          ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
          : value >= 1
            ? value.toFixed(2)
            : value.toLocaleString("en-US", { maximumFractionDigits: 5 })
      }`;

export const fmtPct = (value: number | null): string =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export const utcStamp = (): string =>
  `${new Date().toUTCString().slice(17, 22)} UTC`;

/**
 * Fetch a token logo and inline it as a data URI (resvg cannot fetch network
 * resources at raster time). PNG/JPEG only; anything else returns null and
 * the card renders without a logo.
 */
export async function fetchImageDataUri(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_800);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!/image\/(png|jpe?g)/.test(type)) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 600_000) return null;
    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function renderOgPng(
  tree: Record<string, unknown>,
): Promise<Uint8Array<ArrayBuffer>> {
  const fonts = await loadFonts();
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: OG_W,
    height: OG_H,
    fonts: [
      { name: "Inter", data: fonts.regular, weight: 400, style: "normal" },
      { name: "Inter", data: fonts.bold, weight: 700, style: "normal" },
    ],
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: OG_W } }).render().asPng();
  return new Uint8Array(png);
}

/** Standard page frame: dark paper, padding, column layout. */
export function frame(children: unknown[]): Record<string, unknown> {
  return el(
    "div",
    {
      width: `${OG_W}px`,
      height: `${OG_H}px`,
      flexDirection: "column",
      backgroundColor: C.paper,
      padding: "56px 72px",
      fontFamily: "Inter",
      color: C.ink,
    },
    children,
  );
}
