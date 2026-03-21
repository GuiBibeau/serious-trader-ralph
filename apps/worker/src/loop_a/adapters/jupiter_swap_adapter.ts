import type { ProtocolAdapter } from "../decoder_registry";
import { createBalanceDeltaSwapAdapter } from "./balance_delta_swap_adapter";

const JUPITER_V6_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const JUPITER_V4_PROGRAM_ID = "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB";

const JUPITER_PROGRAM_IDS = [JUPITER_V6_PROGRAM_ID, JUPITER_V4_PROGRAM_ID];

export function createJupiterSwapAdapter(): ProtocolAdapter {
  return createBalanceDeltaSwapAdapter({
    id: "jupiter-swap",
    protocol: "jupiter",
    venue: "jupiter",
    marketType: "spot",
    programIds: JUPITER_PROGRAM_IDS,
    logHintPatterns: ["jupiter", "route"],
  });
}
