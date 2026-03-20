import {
  createDecoderRegistry,
  type DecoderRegistry,
  type ProtocolAdapter,
} from "../decoder_registry";
import { createJupiterSwapAdapter } from "./jupiter_swap_adapter";
import { createOpenBookSwapAdapter } from "./openbook_swap_adapter";
import { createOrcaSwapAdapter } from "./orca_swap_adapter";
import { createPhoenixSwapAdapter } from "./phoenix_swap_adapter";
import { createRaydiumSwapAdapter } from "./raydium_swap_adapter";
import { createSplTokenTransferAdapter } from "./spl_token_transfer_adapter";

export function createDefaultLoopAAdapters(): ProtocolAdapter[] {
  return [
    createSplTokenTransferAdapter(),
    createJupiterSwapAdapter(),
    createRaydiumSwapAdapter(),
    createOrcaSwapAdapter(),
    createOpenBookSwapAdapter(),
    createPhoenixSwapAdapter(),
  ];
}

export function createDefaultDecoderRegistry(): DecoderRegistry {
  return createDecoderRegistry(createDefaultLoopAAdapters());
}
