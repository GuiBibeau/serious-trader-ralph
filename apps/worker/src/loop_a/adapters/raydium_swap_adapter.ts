import type { ProtocolAdapter } from "../decoder_registry";
import { createBalanceDeltaSwapAdapter } from "./balance_delta_swap_adapter";

// Mainnet Raydium program addresses from Raydium's official program-addresses doc.
const RAYDIUM_PROGRAM_IDS = [
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS",
] as const;

export function createRaydiumSwapAdapter(): ProtocolAdapter {
  return createBalanceDeltaSwapAdapter({
    id: "raydium-swap",
    protocol: "raydium",
    venue: "raydium",
    marketType: "spot",
    programIds: [...RAYDIUM_PROGRAM_IDS],
    identifierKind: "pool",
    identifierAccountIndex: 0,
    logHintPatterns: ["raydium", "cpmm", "clmm", "amm"],
  });
}
