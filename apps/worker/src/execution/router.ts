import {
  requireRuntimeVenueCapability,
  runtimeVenueSupportsAdapter,
  runtimeVenueSupportsMode,
} from "../../../../src/runtime/venues/catalog.js";
import type { RuntimeMode } from "../runtime_contracts";
import { executeHeliusSenderSwap } from "./helius_sender_executor";
import { executeJitoBundleSwap } from "./jito_bundle_executor";
import { executeJupiterSwap } from "./jupiter_executor";
import { executeMagicBlockEphemeralRollupSwap } from "./magicblock_ephemeral_rollup_executor";
import type { ExecuteSwapInput, ExecuteSwapResult } from "./types";

export type ExecutionAdapterFn = (
  input: ExecuteSwapInput,
) => Promise<ExecuteSwapResult>;

export type ExecutionAdapterRegistration = {
  adapterKey: string;
  venueKey: string;
  supportedModes: RuntimeMode[];
  adapter: ExecutionAdapterFn;
};

type RegisterExecutionAdapterOptions = {
  venueKey?: string;
  supportedModes?: RuntimeMode[];
};

const DEFAULT_SUPPORTED_MODES: RuntimeMode[] = ["shadow", "paper", "live"];

const ADAPTERS = new Map<string, ExecutionAdapterRegistration>([
  [
    "jupiter",
    {
      adapterKey: "jupiter",
      venueKey: "jupiter",
      supportedModes: ["shadow", "paper", "live"],
      adapter: executeJupiterSwap,
    },
  ],
  [
    "helius_sender",
    {
      adapterKey: "helius_sender",
      venueKey: "jupiter",
      supportedModes: ["live"],
      adapter: executeHeliusSenderSwap,
    },
  ],
  [
    "jito_bundle",
    {
      adapterKey: "jito_bundle",
      venueKey: "jupiter",
      supportedModes: ["live"],
      adapter: executeJitoBundleSwap,
    },
  ],
  [
    "magicblock_ephemeral_rollup",
    {
      adapterKey: "magicblock_ephemeral_rollup",
      venueKey: "magicblock",
      supportedModes: ["shadow", "paper"],
      adapter: executeMagicBlockEphemeralRollupSwap,
    },
  ],
]);

export function registerExecutionAdapter(
  name: string,
  adapter: ExecutionAdapterFn,
  options?: RegisterExecutionAdapterOptions,
): void {
  const key = String(name || "").trim();
  if (!key) {
    throw new Error("invalid-execution-adapter-name");
  }
  ADAPTERS.set(key, {
    adapterKey: key,
    venueKey: String(options?.venueKey ?? key).trim() || key,
    supportedModes: options?.supportedModes
      ? [...options.supportedModes]
      : [...DEFAULT_SUPPORTED_MODES],
    adapter,
  });
}

export function isRegisteredExecutionAdapter(name: string): boolean {
  return ADAPTERS.has(String(name ?? "").trim());
}

export function resolveExecutionAdapterRegistration(
  name: string,
): ExecutionAdapterRegistration | null {
  return ADAPTERS.get(String(name ?? "").trim()) ?? null;
}

export async function executeSwapViaRouter(
  input: ExecuteSwapInput,
): Promise<ExecuteSwapResult> {
  const adapterName =
    (input.execution?.adapter ?? "jupiter").trim() || "jupiter";
  const venueKey = String(input.venueKey ?? "").trim();
  const runtimeMode = input.runtimeMode;
  const registration = ADAPTERS.get(adapterName);
  if (!registration) {
    throw new Error(`execution-adapter-not-registered:${adapterName}`);
  }
  if (input.requireVenueRouting && !venueKey) {
    throw new Error("runtime-venue-required");
  }
  if (input.requireVenueRouting && !runtimeMode) {
    throw new Error("runtime-mode-required");
  }
  if (venueKey && !runtimeMode) {
    throw new Error("runtime-mode-required");
  }
  if (runtimeMode && !venueKey) {
    throw new Error("runtime-venue-required");
  }
  if (venueKey) {
    const capability = requireRuntimeVenueCapability(venueKey);
    if (registration.venueKey !== venueKey) {
      throw new Error(
        `execution-adapter-venue-mismatch:${venueKey}:${adapterName}`,
      );
    }
    if (!runtimeVenueSupportsAdapter(capability, adapterName)) {
      throw new Error(
        `runtime-venue-adapter-not-supported:${venueKey}:${adapterName}`,
      );
    }
    if (runtimeMode && !runtimeVenueSupportsMode(capability, runtimeMode)) {
      throw new Error(
        `runtime-venue-mode-not-supported:${venueKey}:${runtimeMode}`,
      );
    }
  }
  if (runtimeMode && !registration.supportedModes.includes(runtimeMode)) {
    throw new Error(
      `execution-adapter-mode-unsupported:${adapterName}:${runtimeMode}`,
    );
  }
  return await registration.adapter(input);
}
