import type { NonSwapExecutionIntent } from "./execution/types";
import type { JupiterQuoteResponse } from "./jupiter";
import type { ExecutionConfig, LoopPolicy } from "./types";

const SUPPORTED_FLASH_PROVIDERS = ["marginfi", "kamino"] as const;

export type FlashLiquidityProviderKey =
  (typeof SUPPORTED_FLASH_PROVIDERS)[number];

export type FlashBorrowLeg = {
  provider: FlashLiquidityProviderKey;
  mint: string;
  amountAtomic: string;
};

export type FlashProviderPreview = {
  provider: FlashLiquidityProviderKey;
  displayName: string;
  borrowLegCount: number;
  estimatedFeeBps: number;
  notes: string[];
};

export type FlashAtomicPlan = {
  referenceId: string;
  settlementMint: string;
  borrowLegs: Array<
    FlashBorrowLeg & {
      estimatedFeeAtomic: string;
    }
  >;
  providerPreviews: FlashProviderPreview[];
  flashEstimatedFeeByMint: Record<string, string>;
  instructionSummary: {
    routeHopCount: number;
    routeLabels: string[];
    instructionCount: number;
    computeBudgetInstructionCount: number;
    setupInstructionCount: number;
    cleanupInstructionCount: number;
    otherInstructionCount: number;
    addressLookupTableCount: number;
    addressLookupTableAddresses: string[];
    computeUnitLimit: number | null;
    computeUnitPriceMicroLamports: string | null;
    flashBorrowLegCount: number;
    flashProviderCount: number;
    flashBorrowMints: string[];
    flashProviderLegs: Array<{
      provider: string;
      mint: string;
      amountAtomic: string;
      estimatedFeeAtomic: string;
    }>;
    settlementMint: string;
  };
  notes: string[];
  syntheticQuote: JupiterQuoteResponse;
};

type FlashLiquidityControls = {
  enabled: boolean;
  disabledProviders: Set<FlashLiquidityProviderKey>;
  feeBpsByProvider: Record<FlashLiquidityProviderKey, number>;
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: string | null;
};

function readTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function readTruthyFlag(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "on", "yes", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) {
    return false;
  }
  return null;
}

function readPositiveAtomic(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return /^[1-9][0-9]*$/.test(normalized) ? normalized : null;
}

function readPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseProviderList(
  value: unknown,
): Set<FlashLiquidityProviderKey> | null {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : null;
  if (!rawValues) return null;
  const output = new Set<FlashLiquidityProviderKey>();
  for (const rawValue of rawValues) {
    const normalized = normalizeFlashProvider(rawValue);
    if (normalized) output.add(normalized);
  }
  return output;
}

function readExecutionParams(
  execution: ExecutionConfig | undefined,
): Record<string, unknown> | null {
  const params = execution?.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  return params;
}

function normalizeFlashProvider(
  value: unknown,
): FlashLiquidityProviderKey | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "marginfi") return "marginfi";
  if (normalized === "kamino") return "kamino";
  return null;
}

function estimateFeeAtomic(amountAtomic: string, bps: number): string {
  if (bps <= 0) return "0";
  const amount = BigInt(amountAtomic);
  const numerator = amount * BigInt(bps);
  const fee = numerator / 10_000n;
  const remainder = numerator % 10_000n;
  if (remainder === 0n) return fee.toString();
  return (fee + 1n).toString();
}

function sumAtomicAmounts(values: string[]): string {
  return values.reduce((sum, value) => sum + BigInt(value), 0n).toString();
}

function readProviderFeeBpsOverrides(
  params: Record<string, unknown> | null,
): Partial<Record<FlashLiquidityProviderKey, number>> {
  const raw =
    params &&
    typeof params.flashLiquidityFeeBps === "object" &&
    params.flashLiquidityFeeBps &&
    !Array.isArray(params.flashLiquidityFeeBps)
      ? (params.flashLiquidityFeeBps as Record<string, unknown>)
      : null;
  if (!raw) return {};
  const output: Partial<Record<FlashLiquidityProviderKey, number>> = {};
  for (const provider of SUPPORTED_FLASH_PROVIDERS) {
    const parsed = readPositiveInt(raw[provider]);
    if (parsed !== null) {
      output[provider] = parsed;
    }
  }
  return output;
}

export function resolveFlashLiquidityControls(input: {
  env: {
    FLASH_LIQUIDITY_ENABLED?: string;
    FLASH_LIQUIDITY_DISABLED_PROVIDERS?: string;
    FLASH_LIQUIDITY_MARGINFI_ENABLED?: string;
    FLASH_LIQUIDITY_KAMINO_ENABLED?: string;
  };
  execution?: ExecutionConfig;
}): FlashLiquidityControls {
  const params = readExecutionParams(input.execution);
  const globalFlag =
    readTruthyFlag(params?.flashLiquidityEnabled) ??
    readTruthyFlag(input.env.FLASH_LIQUIDITY_ENABLED) ??
    true;
  const disabledProviders = new Set<FlashLiquidityProviderKey>();
  const explicitDisabled =
    parseProviderList(params?.flashLiquidityDisabledProviders) ??
    parseProviderList(input.env.FLASH_LIQUIDITY_DISABLED_PROVIDERS) ??
    new Set<FlashLiquidityProviderKey>();
  for (const provider of explicitDisabled) {
    disabledProviders.add(provider);
  }
  const providerEnabledFlags: Record<
    FlashLiquidityProviderKey,
    boolean | null
  > = {
    marginfi:
      readTruthyFlag(params?.flashLiquidityMarginfiEnabled) ??
      readTruthyFlag(input.env.FLASH_LIQUIDITY_MARGINFI_ENABLED),
    kamino:
      readTruthyFlag(params?.flashLiquidityKaminoEnabled) ??
      readTruthyFlag(input.env.FLASH_LIQUIDITY_KAMINO_ENABLED),
  };
  for (const provider of SUPPORTED_FLASH_PROVIDERS) {
    if (providerEnabledFlags[provider] === false) {
      disabledProviders.add(provider);
    }
  }
  const feeOverrides = readProviderFeeBpsOverrides(params);
  const feeBpsByProvider: Record<FlashLiquidityProviderKey, number> = {
    marginfi: feeOverrides.marginfi ?? 8,
    kamino: feeOverrides.kamino ?? 10,
  };
  return {
    enabled: globalFlag,
    disabledProviders,
    feeBpsByProvider,
    computeUnitLimit: readPositiveInt(params?.computeUnitLimit),
    computeUnitPriceMicroLamports:
      readPositiveAtomic(params?.priorityMicroLamports) ??
      readPositiveAtomic(params?.computeUnitPriceMicroLamports),
  };
}

function buildProviderPreview(input: {
  provider: FlashLiquidityProviderKey;
  borrowLegCount: number;
  estimatedFeeBps: number;
}): FlashProviderPreview {
  return {
    provider: input.provider,
    displayName: input.provider === "marginfi" ? "marginfi" : "Kamino",
    borrowLegCount: input.borrowLegCount,
    estimatedFeeBps: input.estimatedFeeBps,
    notes: [
      `provider:${input.provider}`,
      `borrow-legs:${input.borrowLegCount}`,
      `estimated-fee-bps:${input.estimatedFeeBps}`,
      "paper-only-flash-liquidity-preview",
    ],
  };
}

function normalizeFlashBorrowLegs(
  intent: NonSwapExecutionIntent,
): FlashBorrowLeg[] {
  const legs = Array.isArray(intent.borrowLegs) ? intent.borrowLegs : [];
  if (legs.length < 1) {
    throw new Error("flash-liquidity-borrow-legs-required");
  }
  return legs.map((leg) => {
    const provider = normalizeFlashProvider(leg.provider);
    const mint = readTrimmedString(leg.mint);
    const amountAtomic = readPositiveAtomic(leg.amountAtomic);
    if (!provider) {
      throw new Error(`flash-liquidity-provider-unsupported:${leg.provider}`);
    }
    if (!mint || !amountAtomic) {
      throw new Error("flash-liquidity-borrow-leg-invalid");
    }
    return {
      provider,
      mint,
      amountAtomic,
    };
  });
}

export function buildFlashAtomicPlan(input: {
  intent: NonSwapExecutionIntent;
  execution?: ExecutionConfig;
  policy?: LoopPolicy;
  env: {
    FLASH_LIQUIDITY_ENABLED?: string;
    FLASH_LIQUIDITY_DISABLED_PROVIDERS?: string;
    FLASH_LIQUIDITY_MARGINFI_ENABLED?: string;
    FLASH_LIQUIDITY_KAMINO_ENABLED?: string;
  };
}): FlashAtomicPlan {
  if (input.intent.family !== "flash_atomic") {
    throw new Error("invalid-flash-intent-family");
  }
  const referenceId = readTrimmedString(input.intent.referenceId);
  const settlementMint = readTrimmedString(input.intent.settlementMint);
  if (!referenceId) {
    throw new Error("flash-liquidity-reference-id-required");
  }
  if (!settlementMint) {
    throw new Error("flash-liquidity-settlement-mint-required");
  }

  const controls = resolveFlashLiquidityControls({
    env: input.env,
    execution: input.execution,
  });
  if (!controls.enabled) {
    throw new Error("flash-liquidity-disabled");
  }

  const borrowLegs = normalizeFlashBorrowLegs(input.intent).map((leg) => {
    if (controls.disabledProviders.has(leg.provider)) {
      throw new Error(`flash-liquidity-provider-disabled:${leg.provider}`);
    }
    return {
      ...leg,
      estimatedFeeAtomic: estimateFeeAtomic(
        leg.amountAtomic,
        controls.feeBpsByProvider[leg.provider],
      ),
    };
  });

  const providerCounts = new Map<FlashLiquidityProviderKey, number>();
  const feeByMint = new Map<string, bigint>();
  for (const leg of borrowLegs) {
    providerCounts.set(
      leg.provider,
      (providerCounts.get(leg.provider) ?? 0) + 1,
    );
    feeByMint.set(
      leg.mint,
      (feeByMint.get(leg.mint) ?? 0n) + BigInt(leg.estimatedFeeAtomic),
    );
  }

  const providerPreviews = Array.from(providerCounts.entries()).map(
    ([provider, borrowLegCount]) =>
      buildProviderPreview({
        provider,
        borrowLegCount,
        estimatedFeeBps: controls.feeBpsByProvider[provider],
      }),
  );
  const feeByMintRecord = Object.fromEntries(
    Array.from(feeByMint.entries()).map(([mint, amount]) => [
      mint,
      amount.toString(),
    ]),
  );
  const routeLabels = [
    ...providerPreviews.map((preview) => preview.displayName),
    `reference:${referenceId}`,
  ];
  const settlementBorrowAmounts = borrowLegs
    .filter((leg) => leg.mint === settlementMint)
    .map((leg) => leg.amountAtomic);
  const syntheticAmountAtomic =
    settlementBorrowAmounts.length > 0
      ? sumAtomicAmounts(settlementBorrowAmounts)
      : (borrowLegs[0]?.amountAtomic ?? "0");

  return {
    referenceId,
    settlementMint,
    borrowLegs,
    providerPreviews,
    flashEstimatedFeeByMint: feeByMintRecord,
    instructionSummary: {
      routeHopCount: routeLabels.length,
      routeLabels,
      instructionCount: borrowLegs.length * 2 + 1,
      computeBudgetInstructionCount:
        controls.computeUnitLimit !== null ||
        controls.computeUnitPriceMicroLamports !== null
          ? 1
          : 0,
      setupInstructionCount: borrowLegs.length,
      cleanupInstructionCount: borrowLegs.length,
      otherInstructionCount: 1,
      addressLookupTableCount: 0,
      addressLookupTableAddresses: [],
      computeUnitLimit: controls.computeUnitLimit,
      computeUnitPriceMicroLamports: controls.computeUnitPriceMicroLamports,
      flashBorrowLegCount: borrowLegs.length,
      flashProviderCount: providerPreviews.length,
      flashBorrowMints: Array.from(new Set(borrowLegs.map((leg) => leg.mint))),
      flashProviderLegs: borrowLegs.map((leg) => ({
        provider: leg.provider,
        mint: leg.mint,
        amountAtomic: leg.amountAtomic,
        estimatedFeeAtomic: leg.estimatedFeeAtomic,
      })),
      settlementMint,
    },
    notes: [
      `reference:${referenceId}`,
      `settlement-mint:${settlementMint}`,
      ...providerPreviews.flatMap((preview) => preview.notes),
      "flash-liquidity-live-blocked",
    ],
    syntheticQuote: {
      inputMint: settlementMint,
      outputMint: settlementMint,
      inAmount: syntheticAmountAtomic,
      outAmount: syntheticAmountAtomic,
      priceImpactPct: 0,
      routePlan: providerPreviews.map((preview) => ({
        poolId: `${preview.provider}:${referenceId}`,
        swapInfo: { label: preview.displayName },
      })),
    },
  };
}
