// Chart price-line specs — the pure half of refreshChartLines. Builds the
// exact option objects the page feeds to lightweight-charts'
// createPriceLine (field-for-field identical to the previous inline
// literals); the page keeps a ~10-line applier that clears and re-adds.
// This split is the prerequisite for memoizing line churn off the tick path.

import { colors } from "@trader-ralph/ui/tokens";
import type { ChartLinePrefs } from "$lib/phoenix-cache";
import type { PhoenixOpenOrder, PhoenixPosition } from "$lib/phoenix-trade";
import { formatNumber, formatPrice } from "$lib/utils";
import type { Alert } from "./alerts";

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
    const side = position.size > 0 ? "LONG" : "SHORT";
    const sideColor = position.size > 0 ? colors.up : colors.down;
    if (prefs.pos && position.entryPrice !== null) {
      const upnl =
        position.unrealizedPnl !== null
          ? ` · ${position.unrealizedPnl >= 0 ? "+" : "-"}$${formatNumber(Math.abs(position.unrealizedPnl), 2)}`
          : "";
      specs.push({
        price: position.entryPrice,
        color: sideColor,
        lineWidth: 2,
        lineStyle: 0, // solid
        axisLabelVisible: true,
        title: `${side} ${formatNumber(Math.abs(position.size), 4)} @ ${formatPrice(position.entryPrice)}${upnl}`,
      });
    }
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
    if (
      prefs.tpsl &&
      position.takeProfitPrice !== null &&
      position.entryPrice !== null
    ) {
      const gain =
        Math.abs(position.takeProfitPrice - position.entryPrice) *
        Math.abs(position.size);
      specs.push({
        price: position.takeProfitPrice,
        color: colors.up,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `TP · +$${formatNumber(gain, 2)}`,
      });
    }
    if (
      prefs.tpsl &&
      position.stopLossPrice !== null &&
      position.entryPrice !== null
    ) {
      const loss =
        Math.abs(position.stopLossPrice - position.entryPrice) *
        Math.abs(position.size);
      specs.push({
        price: position.stopLossPrice,
        color: colors.down,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `SL · -$${formatNumber(loss, 2)}`,
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
