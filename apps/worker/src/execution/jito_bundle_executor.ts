import type { ExecuteSwapInput, ExecuteSwapResult } from "./types";

export async function executeJitoBundleSwap(
  _input: ExecuteSwapInput,
): Promise<ExecuteSwapResult> {
  throw new Error("jito-bundle-not-configured");
}
