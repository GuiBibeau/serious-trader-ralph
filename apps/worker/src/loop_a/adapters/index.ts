import {
  createDecoderRegistry,
  type DecoderRegistry,
  type ProtocolAdapter,
} from "../decoder_registry";
import { createJupiterSwapAdapter } from "./jupiter_swap_adapter";
import { createSplTokenTransferAdapter } from "./spl_token_transfer_adapter";
import { createSwapDeltaAdapter } from "./swap_delta_adapter";

const RAYDIUM_AMM_V4_PROGRAM_ID =
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const RAYDIUM_CLMM_PROGRAM_ID = "CAMMCzo5YL8w4VFF8KVHrK22GGUQ5x1r3YbshzNjWqf";
const ORCA_WHIRLPOOL_PROGRAM_ID = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";

export function createDefaultLoopAAdapters(): ProtocolAdapter[] {
  return [
    createSplTokenTransferAdapter(),
    createJupiterSwapAdapter(),
    createSwapDeltaAdapter({
      id: "raydium-swap",
      protocol: "raydium",
      venue: "raydium",
      programIds: [RAYDIUM_AMM_V4_PROGRAM_ID, RAYDIUM_CLMM_PROGRAM_ID],
    }),
    createSwapDeltaAdapter({
      id: "orca-whirlpool-swap",
      protocol: "orca",
      venue: "orca",
      programIds: [ORCA_WHIRLPOOL_PROGRAM_ID],
    }),
  ];
}

export function createDefaultDecoderRegistry(): DecoderRegistry {
  return createDecoderRegistry(createDefaultLoopAAdapters());
}
