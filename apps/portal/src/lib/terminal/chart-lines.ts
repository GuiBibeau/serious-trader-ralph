// Chart price-line specs — the pure half of refreshChartLines. Builds the
// exact option objects the page feeds to lightweight-charts'
// createPriceLine (field-for-field identical to the previous inline
// literals); the page keeps a ~10-line applier that clears and re-adds.
// This split is the prerequisite for memoizing line churn off the tick path.

import { colors } from "@trader-ralph/ui/tokens";
import type { ChartLinePrefs } from "$lib/phoenix-cache";
import type { PhoenixOpenOrder, PhoenixPosition } from "$lib/phoenix-trade";
import { formatNumber } from "$lib/utils";
import type { Alert } from "./alerts";
import type { StructureLevels } from "./autocomplete";
import { fmtTriggerPrice } from "./trade-math";

export type PriceLineSpec = {
  price: number;
  color: string;
  lineWidth: 1 | 2;
  lineStyle: 0 | 1 | 2; // lightweight-charts: 0 solid · 1 dotted · 2 dashed
  axisLabelVisible: boolean;
  title: string;
};

export function buildChartLineSpecs(
  positions: PhoenixPosition[],
  orders: PhoenixOpenOrder[],
  armed: Alert[],
  prefs: ChartLinePrefs,
  symbol: string,
  mode: "perps" | "spot",
): PriceLineSpec[] {
  if (mode !== "perps") return [];
  const specs: PriceLineSpec[] = [];

  for (const position of positions) {
    if (position.symbol !== symbol) continue;
    // Entry/TP/SL for the charted position moved to the draggable overlay
    // (positionLineSpecs + the page's DOM grab handles) — only the liq
    // estimate still renders from this builder, so the two layers never
    // draw duplicate lines at the same price.
    if (prefs.pos && position.liquidationPrice !== null) {
      specs.push({
        price: position.liquidationPrice,
        color: colors.down,
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: "LIQ est",
      });
    }
  }
  if (prefs.orders) {
    for (const order of orders) {
      if (order.symbol !== symbol || order.price === null) continue;
      specs.push({
        price: order.price,
        color: colors.amber,
        lineWidth: 1,
        lineStyle: 1, // dotted
        axisLabelVisible: true,
        title:
          `${order.side === "bid" ? "BID" : "ASK"} ${order.remaining !== null ? formatNumber(order.remaining, 4) : ""}`.trim(),
      });
    }
  }
  if (prefs.alerts) {
    for (const alert of armed) {
      if (alert.symbol !== symbol || alert.triggered) continue;
      specs.push({
        price: alert.price,
        color: colors.accent,
        lineWidth: 1,
        lineStyle: 1,
        axisLabelVisible: true,
        title: `ALERT ${alert.op === "above" ? "↑" : "↓"}`,
      });
    }
  }
  return specs;
}

export type PositionLineKind = "entry" | "tp" | "sl";

export type PositionLineSpec = PriceLineSpec & { kind: PositionLineKind };

/**
 * The charted position's own lines — the draggable TP/SL overlay's pure
 * half. Entry is a muted always-there anchor (whenever the position has an
 * entry price), never draggable; TP/SL render ONLY when the position has
 * that trigger set on-chain. A position without a TP (or SL) gets no line
 * for it: dragging edits existing triggers, adding new triggers by drag is
 * out of scope (the ticket sets them at order time). TP/SL carry no pane
 * title — the price text lives in the DOM grab handle the page attaches at
 * the right edge — but keep the axis label so the trigger stays readable
 * when the handle sits off-scale.
 */
export function positionLineSpecs(
  position: PhoenixPosition,
): PositionLineSpec[] {
  const specs: PositionLineSpec[] = [];
  if (position.entryPrice !== null) {
    specs.push({
      kind: "entry",
      price: position.entryPrice,
      color: colors.muted,
      lineWidth: 1,
      lineStyle: 0, // solid
      axisLabelVisible: true,
      title: "entry",
    });
  }
  if (position.takeProfitPrice !== null) {
    specs.push({
      kind: "tp",
      price: position.takeProfitPrice,
      color: colors.up,
      lineWidth: 1,
      lineStyle: 0, // solid
      axisLabelVisible: true,
      title: "",
    });
  }
  if (position.stopLossPrice !== null) {
    specs.push({
      kind: "sl",
      price: position.stopLossPrice,
      color: colors.down,
      lineWidth: 1,
      lineStyle: 0, // solid
      axisLabelVisible: true,
      title: "",
    });
  }
  return specs;
}

/** How many of the most recent swing highs — and, separately, lows — get a
 * line each. */
export const STRUCTURE_SWING_CAP = 3;

/**
 * Structure-level lines: previous-day high/low as dashed `--faint` lines
 * with axis labels, plus the STRUCTURE_SWING_CAP most recent swing highs
 * and lows as dotted whispers. Swings also use `--faint` — `--line`
 * (#272b34) was tried first and is indistinguishable from the chart grid
 * on the real canvas — so their subordination comes from style instead:
 * dotted (lighter per pixel than the PDH/PDL dashes) and no axis label
 * (six identical "swing" tags would clutter the scale; the pane title
 * still names the line). Null PDH/PDL and missing swings simply don't
 * render: honest absence, never a placeholder line.
 */
export function buildStructureLineSpecs(
  levels: StructureLevels,
): PriceLineSpec[] {
  const specs: PriceLineSpec[] = [];
  if (levels.prevDayHigh !== null) {
    specs.push({
      price: levels.prevDayHigh,
      color: colors.faint,
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: true,
      title: "PDH",
    });
  }
  if (levels.prevDayLow !== null) {
    specs.push({
      price: levels.prevDayLow,
      color: colors.faint,
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: true,
      title: "PDL",
    });
  }
  for (const kind of ["high", "low"] as const) {
    // detectSwings returns chronological order — the tail is most recent.
    const recent = levels.swings
      .filter((swing) => swing.kind === kind)
      .slice(-STRUCTURE_SWING_CAP);
    for (const swing of recent) {
      specs.push({
        price: swing.price,
        color: colors.faint,
        lineWidth: 1,
        lineStyle: 1, // dotted
        axisLabelVisible: false,
        title: "swing",
      });
    }
  }
  return specs;
}

/**
 * Click-to-trade side preview: hovering below the mark reads as a resting
 * long (buying under the market), above as a resting short. Exactly-at-mark
 * counts as long — a limit buy at mark is the natural "buy here" intent.
 */
export function clickTradeSide(
  hoverPrice: number,
  markPrice: number,
): "long" | "short" {
  return hoverPrice <= markPrice ? "long" : "short";
}

/**
 * Pill label for the armed crosshair line: "77.20 · limit long". Price is
 * rendered with fmtTriggerPrice — the same precision dialect the ticket's
 * limit field uses, so what the pill shows is exactly what a click fills.
 */
export function clickTradeLabel(hoverPrice: number, markPrice: number): string {
  return `${fmtTriggerPrice(hoverPrice)} · limit ${clickTradeSide(hoverPrice, markPrice)}`;
}
