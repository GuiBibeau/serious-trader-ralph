import type {
  TerminalIntentFamily,
  TerminalVenueKey,
} from "../terminal-venues";

export type PerpTradeSide = "long" | "short" | "close_long" | "close_short";

export type PerpTradeIntent = {
  instrumentId: string;
  instrumentLabel: string;
  venueKey: Extract<TerminalVenueKey, "drift">;
  intentFamily: Extract<TerminalIntentFamily, "perp_order">;
  marketType: "perp";
  side: PerpTradeSide;
  source: string;
  reason: string;
  quantityUi: string;
  collateralUi: string;
};

export function createPerpTradeIntent(
  side: PerpTradeSide,
  source: string,
  instrumentId: string,
  opts?: {
    instrumentLabel?: string;
    reason?: string;
    quantityUi?: string;
    collateralUi?: string;
  },
): PerpTradeIntent {
  const instrumentLabel = opts?.instrumentLabel?.trim() || instrumentId;
  const defaultReason =
    side === "long"
      ? `Open long ${instrumentLabel}`
      : side === "short"
        ? `Open short ${instrumentLabel}`
        : side === "close_long"
          ? `Close long ${instrumentLabel}`
          : `Close short ${instrumentLabel}`;
  return {
    instrumentId,
    instrumentLabel,
    venueKey: "drift",
    intentFamily: "perp_order",
    marketType: "perp",
    side,
    source,
    reason: opts?.reason ?? defaultReason,
    quantityUi: opts?.quantityUi ?? "1",
    collateralUi: opts?.collateralUi ?? "25",
  };
}
