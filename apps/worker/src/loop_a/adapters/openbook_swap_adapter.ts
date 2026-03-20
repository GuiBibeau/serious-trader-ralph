import { OPENBOOK_PROGRAM_ID } from "@openbook-dex/openbook-v2";
import type { ProtocolAdapter } from "../decoder_registry";
import { createBalanceDeltaSwapAdapter } from "./balance_delta_swap_adapter";

export function createOpenBookSwapAdapter(): ProtocolAdapter {
  return createBalanceDeltaSwapAdapter({
    id: "openbook-swap",
    protocol: "openbook",
    venue: "openbook",
    marketType: "clob",
    programIds: [OPENBOOK_PROGRAM_ID.toBase58()],
    identifierKind: "market",
    identifierAccountIndex: 0,
    logHintPatterns: ["openbook", "orderbook"],
  });
}
