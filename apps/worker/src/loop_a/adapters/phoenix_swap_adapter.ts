import type { ProtocolAdapter } from "../decoder_registry";
import { createBalanceDeltaSwapAdapter } from "./balance_delta_swap_adapter";

// Phoenix legacy verified-build program id from Ellipsis Labs' official repo.
const PHOENIX_PROGRAM_ID = "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY";

export function createPhoenixSwapAdapter(): ProtocolAdapter {
  return createBalanceDeltaSwapAdapter({
    id: "phoenix-swap",
    protocol: "phoenix",
    venue: "phoenix",
    marketType: "clob",
    programIds: [PHOENIX_PROGRAM_ID],
    identifierKind: "market",
    identifierAccountIndex: 0,
    logHintPatterns: ["phoenix", "orderbook"],
  });
}
