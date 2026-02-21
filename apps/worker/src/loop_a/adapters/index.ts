import {
  createDecoderRegistry,
  type DecoderRegistry,
  type ProtocolAdapter,
} from "../decoder_registry";
import { createJupiterSwapAdapter } from "./jupiter_swap_adapter";
import { createSplTokenTransferAdapter } from "./spl_token_transfer_adapter";

export function createDefaultLoopAAdapters(): ProtocolAdapter[] {
  return [createSplTokenTransferAdapter(), createJupiterSwapAdapter()];
}

export function createDefaultDecoderRegistry(): DecoderRegistry {
  return createDecoderRegistry(createDefaultLoopAAdapters());
}
