import type {
  RuntimeExecutionIntentFamily,
  RuntimeMode,
  RuntimeVenueCapability,
} from "../contracts/index.js";

const BUILTIN_RUNTIME_VENUE_CAPABILITIES = [
  {
    schemaVersion: "v1",
    venueKey: "jupiter",
    displayName: "Jupiter",
    adapterKeys: ["jupiter", "helius_sender", "jito_bundle"],
    marketTypes: ["spot"],
    orderTypes: ["market", "limit", "trigger"],
    intentFamilies: ["spot_swap", "conditional_spot_order"],
    authModel: "privy_solana_wallet",
    feeModel: "venue_quote_inclusive",
    precision: {
      priceDecimals: 6,
      sizeDecimals: 9,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 250,
      expectedSubmitMs: 750,
      expectedSettlementMs: 5000,
    },
    settlementBehavior: "swap_atomic",
    lifecycle: {
      supportsOrderLifecycle: true,
      supportsPositionLifecycle: false,
      requiresExternalOracle: false,
      settlementModel: "atomic_swap",
    },
    oracleRequirements: ["venue_reference"],
    supportedModes: ["shadow", "paper", "live"],
    onboardingState: "broad_live_ready",
    notes:
      "Primary bounded live venue for managed runtime execution and canaries.",
  },
  {
    schemaVersion: "v1",
    venueKey: "magicblock",
    displayName: "MagicBlock",
    adapterKeys: ["magicblock_ephemeral_rollup"],
    marketTypes: ["spot"],
    orderTypes: ["market"],
    intentFamilies: ["spot_swap"],
    authModel: "privy_solana_wallet",
    feeModel: "fixed_bps",
    precision: {
      priceDecimals: 6,
      sizeDecimals: 9,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 200,
      expectedSubmitMs: 400,
      expectedSettlementMs: 3000,
    },
    settlementBehavior: "swap_atomic",
    lifecycle: {
      supportsOrderLifecycle: false,
      supportsPositionLifecycle: false,
      requiresExternalOracle: false,
      settlementModel: "atomic_swap",
    },
    oracleRequirements: ["none"],
    supportedModes: ["shadow", "paper"],
    onboardingState: "paper_ready",
    notes:
      "Experimental venue path kept bounded to shadow and paper until later rollout issues land.",
  },
  {
    schemaVersion: "v1",
    venueKey: "raydium",
    displayName: "Raydium",
    adapterKeys: ["raydium"],
    marketTypes: ["spot"],
    orderTypes: ["market"],
    intentFamilies: ["spot_swap"],
    authModel: "privy_solana_wallet",
    feeModel: "venue_quote_inclusive",
    precision: {
      priceDecimals: 6,
      sizeDecimals: 9,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 250,
      expectedSubmitMs: 900,
      expectedSettlementMs: 5000,
    },
    settlementBehavior: "swap_atomic",
    lifecycle: {
      supportsOrderLifecycle: false,
      supportsPositionLifecycle: false,
      requiresExternalOracle: false,
      settlementModel: "atomic_swap",
    },
    oracleRequirements: ["venue_reference"],
    supportedModes: ["shadow", "paper"],
    onboardingState: "paper_ready",
    notes:
      "Native Raydium spot routing kept bounded to shadow and paper while venue evidence accumulates ahead of any live rollout issue.",
  },
  {
    schemaVersion: "v1",
    venueKey: "raydium_perps",
    displayName: "Raydium Perps",
    adapterKeys: ["raydium_perps"],
    marketTypes: ["perp"],
    orderTypes: ["market", "limit", "trigger"],
    intentFamilies: ["perp_order"],
    authModel: "server_signer",
    feeModel: "maker_taker_bps",
    precision: {
      priceDecimals: 6,
      sizeDecimals: 9,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 300,
      expectedSubmitMs: 700,
      expectedSettlementMs: 4000,
    },
    settlementBehavior: "orderbook_partial",
    lifecycle: {
      supportsOrderLifecycle: true,
      supportsPositionLifecycle: true,
      requiresExternalOracle: true,
      settlementModel: "position_account",
    },
    oracleRequirements: ["venue_reference"],
    supportedModes: ["shadow"],
    onboardingState: "candidate",
    notes:
      "Research-gated Raydium Perps candidate. Official Raydium docs route the product through Orderly infrastructure, expose public APIs as read-only market data, and note the venue is not available to U.S. residents as of 2026-03-13. Keep live disabled and fail closed until a later issue models private API auth, account creation, and external dependency health.",
  },
  {
    schemaVersion: "v1",
    venueKey: "orca",
    displayName: "Orca Whirlpools",
    adapterKeys: ["orca"],
    marketTypes: ["spot"],
    orderTypes: ["market"],
    intentFamilies: ["spot_swap"],
    authModel: "privy_solana_wallet",
    feeModel: "venue_quote_inclusive",
    precision: {
      priceDecimals: 6,
      sizeDecimals: 9,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 350,
      expectedSubmitMs: 950,
      expectedSettlementMs: 5000,
    },
    settlementBehavior: "swap_atomic",
    lifecycle: {
      supportsOrderLifecycle: false,
      supportsPositionLifecycle: false,
      requiresExternalOracle: false,
      settlementModel: "atomic_swap",
    },
    oracleRequirements: ["venue_reference"],
    supportedModes: ["shadow", "paper"],
    onboardingState: "paper_ready",
    notes:
      "Direct Orca Whirlpools concentrated-liquidity routing kept bounded to shadow and paper while pool-level route quality evidence accumulates.",
  },
  {
    schemaVersion: "v1",
    venueKey: "jupiter_perps",
    displayName: "Jupiter Perps",
    adapterKeys: ["jupiter_perps"],
    marketTypes: ["perp"],
    orderTypes: ["market", "limit", "trigger"],
    intentFamilies: ["perp_order"],
    authModel: "privy_solana_wallet",
    feeModel: "maker_taker_bps",
    precision: {
      priceDecimals: 6,
      sizeDecimals: 9,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 250,
      expectedSubmitMs: 700,
      expectedSettlementMs: 4000,
    },
    settlementBehavior: "orderbook_partial",
    lifecycle: {
      supportsOrderLifecycle: true,
      supportsPositionLifecycle: true,
      requiresExternalOracle: true,
      settlementModel: "position_account",
    },
    oracleRequirements: ["pyth", "switchboard", "venue_reference"],
    supportedModes: ["shadow", "paper"],
    onboardingState: "integrated",
    notes:
      "Dated research-gated Jupiter Perps capability kept separate from Jupiter spot. The official docs still describe the Perps API as work in progress, so live stays disabled until a later issue lands replay fixtures, paper lifecycle evidence, and venue-specific canary controls.",
  },
  {
    schemaVersion: "v1",
    venueKey: "mango",
    displayName: "Mango v4",
    adapterKeys: ["mango"],
    marketTypes: ["spot", "perp"],
    orderTypes: ["market", "limit", "trigger"],
    intentFamilies: ["clob_order", "perp_order"],
    authModel: "privy_solana_wallet",
    feeModel: "maker_taker_bps",
    precision: {
      priceDecimals: 6,
      sizeDecimals: 9,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 350,
      expectedSubmitMs: 900,
      expectedSettlementMs: 4500,
    },
    settlementBehavior: "orderbook_partial",
    lifecycle: {
      supportsOrderLifecycle: true,
      supportsPositionLifecycle: true,
      requiresExternalOracle: true,
      settlementModel: "position_account",
    },
    oracleRequirements: ["pyth", "switchboard", "venue_reference"],
    supportedModes: ["shadow", "paper"],
    onboardingState: "integrated",
    notes:
      "Bounded Mango v4 cross-margin substrate for shadow and paper. Official Mango sources describe cross-collateral accounts, OpenBook-backed spot margin, Mango perp orderbooks, and dedicated health/liquidation services. Live stays disabled until a later issue lands account-health canaries, oracle freshness evidence, and reconciliation proof.",
  },
  {
    schemaVersion: "v1",
    venueKey: "drift",
    displayName: "Drift",
    adapterKeys: ["drift", "drift_swift"],
    marketTypes: ["perp"],
    orderTypes: ["market", "limit", "trigger"],
    intentFamilies: ["perp_order"],
    authModel: "privy_solana_wallet",
    feeModel: "maker_taker_bps",
    precision: {
      priceDecimals: 6,
      sizeDecimals: 9,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 200,
      expectedSubmitMs: 450,
      expectedSettlementMs: 4000,
    },
    settlementBehavior: "orderbook_partial",
    lifecycle: {
      supportsOrderLifecycle: true,
      supportsPositionLifecycle: true,
      requiresExternalOracle: true,
      settlementModel: "position_account",
    },
    oracleRequirements: ["pyth", "switchboard", "venue_reference"],
    supportedModes: ["shadow", "paper"],
    onboardingState: "integrated",
    notes:
      "Bounded Drift perps substrate for shadow and paper; live stays blocked until oracle, margin, and Swift canary evidence land.",
  },
  {
    schemaVersion: "v1",
    venueKey: "drift_bet",
    displayName: "Drift BET",
    adapterKeys: ["drift_prediction"],
    marketTypes: ["prediction"],
    orderTypes: ["market", "limit"],
    intentFamilies: ["prediction_order"],
    authModel: "privy_solana_wallet",
    feeModel: "maker_taker_bps",
    precision: {
      priceDecimals: 6,
      sizeDecimals: 9,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 250,
      expectedSubmitMs: 650,
      expectedSettlementMs: 5000,
    },
    settlementBehavior: "orderbook_partial",
    lifecycle: {
      supportsOrderLifecycle: true,
      supportsPositionLifecycle: true,
      requiresExternalOracle: true,
      settlementModel: "position_account",
    },
    oracleRequirements: ["pyth", "venue_reference"],
    supportedModes: ["shadow"],
    onboardingState: "candidate",
    notes:
      "Drift BET is a Drift-family prediction market rather than a separate custody venue. Official Drift materials describe prediction markets as perp markets with `contract_type=Prediction`, fully collateralized margin, and prelaunch-oracle valuation, but the current developer surface is still fragmented across older docs repos instead of the main docs site. Keep it candidate-only until a later issue lands maintained discovery, order, and settlement fixtures.",
  },
  {
    schemaVersion: "v1",
    venueKey: "monaco",
    displayName: "Monaco Protocol",
    adapterKeys: ["monaco"],
    marketTypes: ["prediction"],
    orderTypes: ["market", "limit"],
    intentFamilies: ["prediction_order"],
    authModel: "privy_solana_wallet",
    feeModel: "maker_taker_bps",
    precision: {
      priceDecimals: 4,
      sizeDecimals: 6,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 250,
      expectedSubmitMs: 600,
      expectedSettlementMs: 5000,
    },
    settlementBehavior: "orderbook_partial",
    lifecycle: {
      supportsOrderLifecycle: true,
      supportsPositionLifecycle: true,
      requiresExternalOracle: false,
      settlementModel: "position_account",
    },
    oracleRequirements: ["none"],
    supportedModes: ["shadow"],
    onboardingState: "candidate",
    notes:
      "Monaco has an active protocol repo with order, trade, matching-pool, and market-position client docs, but the previously prominent SDK repo is archived and the venue still depends on operator-managed market lifecycle and settlement flows. Keep it candidate-only until a later issue locks the maintained client path, operator authority model, and reconciliation fixtures.",
  },
  {
    schemaVersion: "v1",
    venueKey: "phoenix",
    displayName: "Phoenix",
    adapterKeys: ["phoenix_orderbook"],
    marketTypes: ["spot"],
    orderTypes: ["market", "limit"],
    intentFamilies: ["clob_order"],
    authModel: "privy_solana_wallet",
    feeModel: "maker_taker_bps",
    precision: {
      priceDecimals: 6,
      sizeDecimals: 9,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 150,
      expectedSubmitMs: 350,
      expectedSettlementMs: 4000,
    },
    settlementBehavior: "orderbook_atomic",
    lifecycle: {
      supportsOrderLifecycle: true,
      supportsPositionLifecycle: false,
      requiresExternalOracle: false,
      settlementModel: "resting_order",
    },
    oracleRequirements: ["venue_reference"],
    supportedModes: ["shadow", "paper"],
    onboardingState: "candidate",
    notes:
      "Stubbed non-current venue proving the runtime can add a new venue through the shared capability and adapter abstractions.",
  },
  {
    schemaVersion: "v1",
    venueKey: "openbook",
    displayName: "OpenBook v2",
    adapterKeys: ["openbook_v2"],
    marketTypes: ["spot"],
    orderTypes: ["market", "limit"],
    intentFamilies: ["clob_order"],
    authModel: "privy_solana_wallet",
    feeModel: "maker_taker_bps",
    precision: {
      priceDecimals: 6,
      sizeDecimals: 9,
      minOrderIncrement: "0.000001",
      minQuoteNotionalUsd: "0.01",
    },
    sizeLimits: {
      minNotionalUsd: "0.01",
    },
    latencyProfile: {
      expectedQuoteMs: 150,
      expectedSubmitMs: 350,
      expectedSettlementMs: 4000,
    },
    settlementBehavior: "orderbook_atomic",
    lifecycle: {
      supportsOrderLifecycle: true,
      supportsPositionLifecycle: false,
      requiresExternalOracle: false,
      settlementModel: "resting_order",
    },
    oracleRequirements: ["venue_reference"],
    supportedModes: ["shadow", "paper"],
    onboardingState: "integrated",
    notes:
      "Bounded OpenBook v2 spot CLOB integration for shadow and paper only; live stays blocked until venue-specific canary notes and kill controls land.",
  },
] as const satisfies readonly RuntimeVenueCapability[];

const CAPABILITY_INDEX = new Map<string, RuntimeVenueCapability>(
  BUILTIN_RUNTIME_VENUE_CAPABILITIES.map((capability) => [
    capability.venueKey,
    capability,
  ]),
);

export function listRuntimeVenueCapabilities(): RuntimeVenueCapability[] {
  return BUILTIN_RUNTIME_VENUE_CAPABILITIES.map((capability) => ({
    ...capability,
    adapterKeys: [...capability.adapterKeys],
    marketTypes: [...capability.marketTypes],
    orderTypes: [...capability.orderTypes],
    ...(capability.intentFamilies
      ? { intentFamilies: [...capability.intentFamilies] }
      : {}),
    supportedModes: [...capability.supportedModes],
    precision: { ...capability.precision },
    sizeLimits: { ...capability.sizeLimits },
    latencyProfile: { ...capability.latencyProfile },
    ...(capability.lifecycle ? { lifecycle: { ...capability.lifecycle } } : {}),
    ...(capability.oracleRequirements
      ? { oracleRequirements: [...capability.oracleRequirements] }
      : {}),
  }));
}

export function getRuntimeVenueCapability(
  venueKey: string,
): RuntimeVenueCapability | null {
  return CAPABILITY_INDEX.get(venueKey) ?? null;
}

export function requireRuntimeVenueCapability(
  venueKey: string,
): RuntimeVenueCapability {
  const capability = getRuntimeVenueCapability(venueKey);
  if (!capability) {
    throw new Error(`runtime-venue-not-supported:${venueKey}`);
  }
  return capability;
}

export function runtimeVenueSupportsMode(
  capability: RuntimeVenueCapability,
  mode: RuntimeMode,
): boolean {
  return capability.supportedModes.includes(mode);
}

export function runtimeVenueSupportsAdapter(
  capability: RuntimeVenueCapability,
  adapterKey: string,
): boolean {
  return capability.adapterKeys.includes(adapterKey);
}

export function runtimeVenueSupportsIntentFamily(
  capability: RuntimeVenueCapability,
  intentFamily: RuntimeExecutionIntentFamily,
): boolean {
  const configured = capability.intentFamilies;
  if (!configured || configured.length < 1) {
    return intentFamily === "spot_swap";
  }
  return configured.includes(intentFamily);
}
