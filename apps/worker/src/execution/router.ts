import {
  requireRuntimeVenueCapability,
  runtimeVenueSupportsAdapter,
  runtimeVenueSupportsIntentFamily,
  runtimeVenueSupportsMode,
} from "../../../../src/runtime/venues/catalog.js";
import { TRADING_TOKEN_BY_MINT } from "../defaults";
import type { RuntimeMode } from "../runtime_contracts";
import { getStrategyLabSubjectControl } from "../strategy_lab_readiness_repository";
import { executeHeliusSenderSwap } from "./helius_sender_executor";
import { executeJitoBundleSwap } from "./jito_bundle_executor";
import { executeJupiterSwap } from "./jupiter_executor";
import { resolveJupiterConditionalSpotOrder } from "./jupiter_trigger";
import { executeJupiterConditionalSpotOrder } from "./jupiter_trigger_executor";
import { executeMagicBlockEphemeralRollupSwap } from "./magicblock_ephemeral_rollup_executor";
import { executeRaydiumSwap } from "./raydium_executor";
import type {
  ExecuteIntentInput,
  ExecuteSwapInput,
  ExecuteSwapResult,
  ExecutionIntentFamily,
} from "./types";

export type ExecutionAdapterFn = (
  input: ExecuteSwapInput,
) => Promise<ExecuteSwapResult>;

export type ExecutionAdapterRegistration = {
  adapterKey: string;
  venueKey: string;
  supportedModes: RuntimeMode[];
  supportedIntentFamilies: ExecutionIntentFamily[];
  adapter: ExecutionAdapterFn;
};

type RegisterExecutionAdapterOptions = {
  venueKey?: string;
  supportedModes?: RuntimeMode[];
  supportedIntentFamilies?: ExecutionIntentFamily[];
};

const DEFAULT_SUPPORTED_MODES: RuntimeMode[] = ["shadow", "paper", "live"];
const DEFAULT_SUPPORTED_INTENT_FAMILIES: ExecutionIntentFamily[] = [
  "spot_swap",
];

const ADAPTERS = new Map<string, ExecutionAdapterRegistration>([
  [
    "jupiter",
    {
      adapterKey: "jupiter",
      venueKey: "jupiter",
      supportedModes: ["shadow", "paper", "live"],
      supportedIntentFamilies: ["spot_swap", "conditional_spot_order"],
      adapter: executeJupiterSwap,
    },
  ],
  [
    "helius_sender",
    {
      adapterKey: "helius_sender",
      venueKey: "jupiter",
      supportedModes: ["live"],
      supportedIntentFamilies: ["spot_swap"],
      adapter: executeHeliusSenderSwap,
    },
  ],
  [
    "jito_bundle",
    {
      adapterKey: "jito_bundle",
      venueKey: "jupiter",
      supportedModes: ["live"],
      supportedIntentFamilies: ["spot_swap"],
      adapter: executeJitoBundleSwap,
    },
  ],
  [
    "magicblock_ephemeral_rollup",
    {
      adapterKey: "magicblock_ephemeral_rollup",
      venueKey: "magicblock",
      supportedModes: ["shadow", "paper"],
      supportedIntentFamilies: ["spot_swap"],
      adapter: executeMagicBlockEphemeralRollupSwap,
    },
  ],
  [
    "raydium",
    {
      adapterKey: "raydium",
      venueKey: "raydium",
      supportedModes: ["shadow", "paper"],
      supportedIntentFamilies: ["spot_swap"],
      adapter: executeRaydiumSwap,
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
    supportedIntentFamilies: options?.supportedIntentFamilies
      ? [...options.supportedIntentFamilies]
      : [...DEFAULT_SUPPORTED_INTENT_FAMILIES],
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

async function enforceStrategyLabSubjectControls(input: {
  db: D1Database;
  venueKey: string;
  inputMint?: string;
  outputMint?: string;
  bypassReason?: ExecuteSwapInput["subjectControlBypassReason"];
}): Promise<void> {
  const venueControl = await getStrategyLabSubjectControl(
    input.db,
    "venue",
    input.venueKey,
  );
  if (venueControl?.killSwitchEnabled) {
    throw new Error(`runtime-venue-disabled-by-operator:${input.venueKey}`);
  }
  if (!input.bypassReason && venueControl && !venueControl.liveAllowed) {
    throw new Error(`runtime-venue-not-allowlisted:${input.venueKey}`);
  }

  const assetKeys = Array.from(
    new Set(
      [input.inputMint, input.outputMint]
        .map((mint) => (mint ? TRADING_TOKEN_BY_MINT[mint]?.symbol : null))
        .filter((value): value is string => Boolean(value)),
    ),
  );
  for (const assetKey of assetKeys) {
    const assetControl = await getStrategyLabSubjectControl(
      input.db,
      "asset",
      assetKey,
    );
    if (assetControl?.killSwitchEnabled) {
      throw new Error(`runtime-asset-disabled-by-operator:${assetKey}`);
    }
    if (!input.bypassReason && assetControl && !assetControl.liveAllowed) {
      throw new Error(`runtime-asset-not-allowlisted:${assetKey}`);
    }
  }
}

async function resolveExecutionAdapterForIntent(input: {
  env: ExecuteIntentInput["env"];
  execution: ExecuteIntentInput["execution"];
  venueKey: string;
  runtimeMode?: RuntimeMode;
  requireVenueRouting?: boolean;
  subjectControlBypassReason?: ExecuteIntentInput["subjectControlBypassReason"];
  intentFamily: ExecutionIntentFamily;
  inputMint?: string;
  outputMint?: string;
}): Promise<ExecutionAdapterRegistration> {
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
    if (!runtimeVenueSupportsIntentFamily(capability, input.intentFamily)) {
      throw new Error(
        `runtime-venue-intent-family-not-supported:${venueKey}:${input.intentFamily}`,
      );
    }
    if (runtimeMode && !runtimeVenueSupportsMode(capability, runtimeMode)) {
      throw new Error(
        `runtime-venue-mode-not-supported:${venueKey}:${runtimeMode}`,
      );
    }
    if (runtimeMode === "live") {
      await enforceStrategyLabSubjectControls({
        db: input.env.WAITLIST_DB,
        venueKey,
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        bypassReason: input.subjectControlBypassReason,
      });
    }
  }
  if (runtimeMode && !registration.supportedModes.includes(runtimeMode)) {
    throw new Error(
      `execution-adapter-mode-unsupported:${adapterName}:${runtimeMode}`,
    );
  }
  if (!registration.supportedIntentFamilies.includes(input.intentFamily)) {
    throw new Error(
      `execution-adapter-intent-not-supported:${adapterName}:${input.intentFamily}`,
    );
  }
  return registration;
}

export async function executeIntentViaRouter(
  input: ExecuteIntentInput,
): Promise<ExecuteSwapResult> {
  const venueKey = String(input.venueKey ?? input.intent.venueKey ?? "").trim();
  const conditionalSpotOrderMints =
    input.intent.family === "conditional_spot_order" &&
    input.intent.venueKey === "jupiter"
      ? resolveJupiterConditionalSpotOrder(input.intent)
      : null;
  const registration = await resolveExecutionAdapterForIntent({
    env: input.env,
    execution: input.execution,
    venueKey,
    runtimeMode: input.runtimeMode,
    requireVenueRouting: input.requireVenueRouting,
    subjectControlBypassReason: input.subjectControlBypassReason,
    intentFamily: input.intent.family,
    inputMint:
      input.intent.family === "spot_swap"
        ? input.intent.inputMint
        : conditionalSpotOrderMints?.inputMint,
    outputMint:
      input.intent.family === "spot_swap"
        ? input.intent.outputMint
        : conditionalSpotOrderMints?.outputMint,
  });

  if (input.intent.family !== "spot_swap") {
    if (
      input.intent.family === "conditional_spot_order" &&
      registration.adapterKey === "jupiter"
    ) {
      return await executeJupiterConditionalSpotOrder(input);
    }
    throw new Error(
      `execution-intent-family-not-implemented:${input.intent.family}:${registration.adapterKey}`,
    );
  }

  return await registration.adapter({
    env: input.env,
    venueKey,
    runtimeMode: input.runtimeMode,
    requireVenueRouting: input.requireVenueRouting,
    subjectControlBypassReason: input.subjectControlBypassReason,
    execution: input.execution,
    policy: input.policy,
    rpc: input.rpc,
    jupiter: input.jupiter,
    raydium: input.raydium,
    quoteResponse: input.quoteResponse,
    userPublicKey: input.userPublicKey,
    privyWalletId: input.privyWalletId,
    log: input.log,
    guardEnabled: input.guardEnabled,
  });
}

export async function executeSwapViaRouter(
  input: ExecuteSwapInput,
): Promise<ExecuteSwapResult> {
  return await executeIntentViaRouter({
    ...input,
    intent: {
      family: "spot_swap",
      wallet: input.userPublicKey,
      venueKey: input.venueKey,
      marketType: "spot",
      inputMint: String(input.quoteResponse?.inputMint ?? ""),
      outputMint: String(input.quoteResponse?.outputMint ?? ""),
      amountAtomic: String(input.quoteResponse?.inAmount ?? ""),
      slippageBps: input.policy.slippageBps,
    },
  });
}
