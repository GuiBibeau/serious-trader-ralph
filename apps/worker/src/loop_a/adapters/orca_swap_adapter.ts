import type { ProtocolAdapter } from "../decoder_registry";
import {
  createBalanceDeltaSwapAdapter,
  JUPITER_ROUTE_PROGRAM_IDS,
} from "./balance_delta_swap_adapter";

// Mainnet Whirlpool program id from Orca's official whirlpools repository.
const ORCA_WHIRLPOOLS_PROGRAM_ID =
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";

export function createOrcaSwapAdapter(): ProtocolAdapter {
  return createBalanceDeltaSwapAdapter({
    id: "orca-swap",
    protocol: "orca",
    venue: "orca",
    marketType: "spot",
    programIds: [ORCA_WHIRLPOOLS_PROGRAM_ID],
    identifierKind: "pool",
    identifierAccountIndex: 0,
    logHintPatterns: ["orca", "whirlpool"],
    blockedTopLevelProgramIds: [...JUPITER_ROUTE_PROGRAM_IDS],
  });
}
