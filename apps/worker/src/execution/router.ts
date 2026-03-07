import { executeHeliusSenderSwap } from "./helius_sender_executor";
import { executeJitoBundleSwap } from "./jito_bundle_executor";
import { executeJupiterSwap } from "./jupiter_executor";
import { executeMagicBlockEphemeralRollupSwap } from "./magicblock_ephemeral_rollup_executor";
import type { ExecuteSwapInput, ExecuteSwapResult } from "./types";

export type ExecutionAdapterFn = (
  input: ExecuteSwapInput,
) => Promise<ExecuteSwapResult>;

const ADAPTERS = new Map<string, ExecutionAdapterFn>([
  ["jupiter", executeJupiterSwap],
  ["helius_sender", executeHeliusSenderSwap],
  ["jito_bundle", executeJitoBundleSwap],
  ["magicblock_ephemeral_rollup", executeMagicBlockEphemeralRollupSwap],
]);

export function registerExecutionAdapter(
  name: string,
  adapter: ExecutionAdapterFn,
): void {
  const key = String(name || "").trim();
  if (!key) {
    throw new Error("invalid-execution-adapter-name");
  }
  ADAPTERS.set(key, adapter);
}

export async function executeSwapViaRouter(
  input: ExecuteSwapInput,
): Promise<ExecuteSwapResult> {
  const adapterName =
    (input.execution?.adapter ?? "jupiter").trim() || "jupiter";
  const adapter = ADAPTERS.get(adapterName);
  if (!adapter) {
    throw new Error(`execution-adapter-not-registered:${adapterName}`);
  }
  return await adapter(input);
}
