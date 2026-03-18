import {
  type SupportedTradingToken,
  TRADING_TOKEN_BY_MINT,
  USDC_MINT,
} from "./defaults";
import type {
  RuntimeStrategyDeskRunKind,
  RuntimeStrategyDeskScenarioLeg,
  RuntimeStrategyDeskScenarioManifest,
  RuntimeStrategyDeskScenarioReport,
  RuntimeStrategyDeskScenarioRun,
} from "./runtime_contracts";
import { upsertRuntimeStrategyDeskScenarioWorkflow } from "./runtime_strategy_desk";
import { executeRuntimeStrategyDeskScenarioWorkflow } from "./runtime_strategy_desk_runner";
import type { Env } from "./types";

type StrategyDeskResearchRunKind = Extract<
  RuntimeStrategyDeskRunKind,
  "shadow" | "paper"
>;

type StrategyDeskRunnerDeps = NonNullable<
  Parameters<typeof executeRuntimeStrategyDeskScenarioWorkflow>[1]
>;

type StrategyDeskResearchPromptProfile = {
  tokens: Set<string>;
  assets: string[];
  requestedFamilies: Set<string>;
  requestedVenues: Set<string>;
};

type StrategyDeskAssetPreset = {
  symbol: string;
  pairSymbol: string;
  baseMint: string;
  quoteMint: string;
  decimals: number;
  referencePriceUsd: number;
};

type StrategyDeskBlueprintContext = {
  promptProfile: StrategyDeskResearchPromptProfile;
  selectedSpotAssets: StrategyDeskAssetPreset[];
  scenarioIndex: number;
  runKind: StrategyDeskResearchRunKind;
  now: string;
  promptSlug: string;
  ownerUserId: string;
};

type StrategyDeskBlueprintScenario = {
  blueprintId: string;
  title: string;
  summary: string;
  thesis: string;
  strategyKey: string;
  sleeveId: string;
  tags: string[];
  legs: RuntimeStrategyDeskScenarioLeg[];
  keywordMatches: string[];
  grossEdgeBps: number;
  rationale: string[];
};

type StrategyDeskBlueprint = {
  blueprintId: string;
  label: string;
  keywords: string[];
  baseScore: number;
  buildScenario: (
    input: StrategyDeskBlueprintContext,
  ) => StrategyDeskBlueprintScenario;
};

type StrategyDeskScenarioResearchMetrics = {
  promptFitScore: number;
  executionScore: number;
  diversityScore: number;
  estimatedGrossEdgeUsd: number;
  estimatedCostUsd: number;
  estimatedNetPnlUsd: number;
  totalScore: number;
};

export type RuntimeStrategyDeskResearchWorkflowInput = {
  env: Env;
  prompt: string;
  requestedBy: string;
  ownerUserId?: string;
  runKind?: StrategyDeskResearchRunKind;
  walletAddress?: string;
  privyWalletId?: string;
  candidateCount?: number;
  scenarioPrefix?: string;
  maxRetriesPerLeg?: number;
  maxConcurrency?: number;
};

export type RuntimeStrategyDeskResearchWorkflowScenarioResult = {
  blueprintId: string;
  blueprintLabel: string;
  scenario: RuntimeStrategyDeskScenarioManifest;
  run: RuntimeStrategyDeskScenarioRun;
  report: RuntimeStrategyDeskScenarioReport;
  metrics: StrategyDeskScenarioResearchMetrics;
  keywordMatches: string[];
  rationale: string[];
};

export type RuntimeStrategyDeskResearchWorkflowResult = {
  prompt: string;
  requestedBy: string;
  runKind: StrategyDeskResearchRunKind;
  generatedAt: string;
  candidateCount: number;
  rankings: RuntimeStrategyDeskResearchWorkflowScenarioResult[];
  markdownSummary: string;
};

type StrategyDeskResearchDeps = {
  now?: () => string;
  createId?: (prefix: string) => string;
};

const DEFAULT_RESEARCH_CANDIDATE_COUNT = 10;
const MAX_RESEARCH_CANDIDATE_COUNT = 16;
const DEFAULT_MAX_CONCURRENCY = 4;
const MAX_MAX_CONCURRENCY = 8;
const DEFAULT_WALLET_ADDRESS = "11111111111111111111111111111111";

const REFERENCE_PRICE_BY_SYMBOL: Record<string, number> = {
  SOL: 142,
  JUP: 1.2,
  RAY: 2.6,
  WIF: 2.15,
  BONK: 0.000028,
  JTO: 3.4,
};

const FAMILY_COST_BPS: Record<
  RuntimeStrategyDeskScenarioLeg["intentFamily"],
  number
> = {
  spot_swap: 18,
  conditional_spot_order: 15,
  clob_order: 12,
  perp_order: 20,
  prediction_order: 28,
  flash_atomic: 9,
};

const FAMILY_KEYWORD_MAP: Record<string, string[]> = {
  spot_swap: ["spot", "amm", "jupiter", "raydium", "orca", "swap"],
  clob_order: ["clob", "orderbook", "openbook", "maker", "book"],
  perp_order: ["perp", "perps", "basis", "funding", "hedge", "carry"],
  prediction_order: [
    "prediction",
    "event",
    "macro",
    "election",
    "overlay",
    "kalshi",
  ],
  flash_atomic: ["flash", "rebalance", "inventory", "latency", "routing"],
};

const BLUEPRINTS: StrategyDeskBlueprint[] = [
  {
    blueprintId: "basis_carry_sol",
    label: "Spot/perp basis carry",
    keywords: ["basis", "perp", "carry", "funding", "hedge"],
    baseScore: 84,
    buildScenario: (input) => {
      const asset = selectPerpAsset(input.selectedSpotAssets[0]);
      const spotLeg = buildSpotLeg({
        legId: "leg_spot_basis_alpha",
        label: `${asset.symbol} spot entry`,
        role: "primary_alpha",
        venueKey: "jupiter",
        asset,
        side: "buy",
        targetNotionalUsd: 1200,
        reserveUsd: 1200,
        maxNotionalUsd: 1800,
        tags: ["basis", "spot"],
        thesis: "Acquire the underlying where spot routing is deepest.",
      });
      const hedgeLeg = buildPerpLeg({
        legId: "leg_perp_basis_hedge",
        label: `${asset.symbol} perp hedge`,
        role: "hedge",
        venueKey: "drift",
        asset,
        side: "short",
        targetNotionalUsd: 700,
        reserveUsd: 350,
        maxNotionalUsd: 900,
        dependencies: [spotLeg.legId],
        tags: ["basis", "perp"],
        thesis:
          "Lean short perps against spot to harvest basis dislocations without taking full directional beta.",
      });
      return {
        blueprintId: "basis_carry_sol",
        title: `${asset.symbol} basis carry desk`,
        summary:
          "Long spot through Jupiter while leaning short perps on Drift to harvest funding and basis dislocations.",
        thesis:
          "Capture cross-venue basis while keeping spot execution on the deepest aggregator route and hedging directional beta through bounded perp exposure.",
        strategyKey: "strategy_desk::research::basis_carry_sol",
        sleeveId: `research_basis_${asset.symbol.toLowerCase()}`,
        tags: ["basis", "carry", "perp", asset.symbol.toLowerCase()],
        legs: [spotLeg, hedgeLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "basis",
          "perp",
          "carry",
          "hedge",
          asset.symbol.toLowerCase(),
        ]),
        grossEdgeBps: 92,
        rationale: [
          "Pairs deep Jupiter spot liquidity with a bounded Drift hedge.",
          "Targets funding and basis dispersion rather than pure direction.",
        ],
      };
    },
  },
  {
    blueprintId: "event_overlay_sol",
    label: "Spot alpha with prediction overlay",
    keywords: ["prediction", "event", "macro", "overlay", "hedge"],
    baseScore: 79,
    buildScenario: (input) => {
      const asset = selectPerpAsset(input.selectedSpotAssets[0]);
      const spotLeg = buildSpotLeg({
        legId: "leg_spot_event_alpha",
        label: `${asset.symbol} spot alpha`,
        role: "primary_alpha",
        venueKey: "jupiter",
        asset,
        side: "buy",
        targetNotionalUsd: 900,
        reserveUsd: 900,
        maxNotionalUsd: 1400,
        tags: ["spot", "alpha"],
        thesis:
          "Own the underlying when the prompt points toward directional inefficiency.",
      });
      const predictionLeg = buildPredictionLeg({
        legId: "leg_event_overlay",
        label: "Macro prediction overlay",
        instrumentId: `${asset.symbol.toLowerCase()}-macro-weekly`,
        side: "buy_yes",
        targetNotionalUsd: 20,
        dependencies: [spotLeg.legId],
        tags: ["prediction", "macro"],
        thesis:
          "Use a tiny prediction leg to cheaply express event risk around the core book.",
      });
      const rebalanceLeg = buildFlashLeg({
        legId: "leg_flash_cleanup",
        label: "Flash cleanup",
        asset,
        targetNotionalUsd: 180,
        dependencies: [spotLeg.legId, predictionLeg.legId],
        tags: ["flash", "inventory"],
        thesis:
          "Use the flash leg to clean up inventory after the event leg lands.",
      });
      return {
        blueprintId: "event_overlay_sol",
        title: `${asset.symbol} event overlay desk`,
        summary:
          "Directional spot exposure cushioned by a prediction overlay and a flash rebalance leg.",
        thesis:
          "Use event markets as a cheap hedge or confirmation signal while keeping the core risk in liquid spot routing.",
        strategyKey: "strategy_desk::research::event_overlay_sol",
        sleeveId: `research_event_${asset.symbol.toLowerCase()}`,
        tags: ["event", "prediction", "flash", asset.symbol.toLowerCase()],
        legs: [spotLeg, predictionLeg, rebalanceLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "prediction",
          "event",
          "macro",
          "overlay",
        ]),
        grossEdgeBps: 74,
        rationale: [
          "Blends a liquid spot leg with cheap event optionality.",
          "Keeps the prediction notional tiny to avoid dominating the book.",
        ],
      };
    },
  },
  {
    blueprintId: "amm_rotation",
    label: "Cross-AMM rotation",
    keywords: ["amm", "rotation", "raydium", "orca", "dislocation"],
    baseScore: 77,
    buildScenario: (input) => {
      const asset = selectSpotAsset(
        input.selectedSpotAssets,
        input.scenarioIndex,
      );
      const raydiumLeg = buildSpotLeg({
        legId: "leg_raydium_entry",
        label: `${asset.symbol} Raydium entry`,
        role: "primary_alpha",
        venueKey: "raydium",
        asset,
        side: "buy",
        targetNotionalUsd: 700,
        reserveUsd: 700,
        maxNotionalUsd: 950,
        tags: ["raydium", "amm"],
        thesis:
          "Enter through Raydium when route quality or pool state is advantaged.",
      });
      const orcaLeg = buildSpotLeg({
        legId: "leg_orca_exit",
        label: `${asset.symbol} Orca recycle`,
        role: "liquidity",
        venueKey: "orca",
        asset,
        side: "sell",
        targetNotionalUsd: 420,
        reserveUsd: 180,
        maxNotionalUsd: 600,
        dependencies: [raydiumLeg.legId],
        tags: ["orca", "liquidity"],
        thesis:
          "Recycle inventory through Orca when the concentrated pool is richer than the entry route.",
      });
      const flashLeg = buildFlashLeg({
        legId: "leg_flash_inventory_reset",
        label: "Flash inventory reset",
        asset,
        targetNotionalUsd: 160,
        dependencies: [raydiumLeg.legId, orcaLeg.legId],
        tags: ["flash", "inventory"],
        thesis:
          "Clean up leftover inventory atomically after the AMM rotation completes.",
      });
      return {
        blueprintId: "amm_rotation",
        title: `${asset.symbol} cross-AMM rotation`,
        summary:
          "Enter through Raydium, recycle through Orca, and use flash liquidity to close the inventory loop.",
        thesis:
          "Exploit temporary route-quality differences between Solana AMMs without forcing the runtime into a single venue.",
        strategyKey: "strategy_desk::research::amm_rotation",
        sleeveId: `research_amm_${asset.symbol.toLowerCase()}`,
        tags: ["amm", "rotation", "flash", asset.symbol.toLowerCase()],
        legs: [raydiumLeg, orcaLeg, flashLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "amm",
          "raydium",
          "orca",
          "rotation",
        ]),
        grossEdgeBps: 71,
        rationale: [
          "Spreads execution across two paper-ready AMMs.",
          "Uses flash liquidity as bounded inventory glue rather than directional risk.",
        ],
      };
    },
  },
  {
    blueprintId: "openbook_exit",
    label: "Aggregator-to-orderbook recycle",
    keywords: ["openbook", "orderbook", "maker", "taker", "microstructure"],
    baseScore: 73,
    buildScenario: (input) => {
      const asset = selectSpotAsset(
        input.selectedSpotAssets,
        input.scenarioIndex,
      );
      const spotLeg = buildSpotLeg({
        legId: "leg_aggregator_entry",
        label: `${asset.symbol} aggregator entry`,
        role: "primary_alpha",
        venueKey: "jupiter",
        asset,
        side: "buy",
        targetNotionalUsd: 800,
        reserveUsd: 800,
        maxNotionalUsd: 1200,
        tags: ["jupiter", "entry"],
        thesis: "Use Jupiter for the fastest bounded entry into the asset.",
      });
      const clobLeg = buildClobLeg({
        legId: "leg_openbook_exit",
        label: `${asset.symbol} OpenBook exit`,
        venueKey: "openbook",
        asset,
        side: "sell",
        targetNotionalUsd: 380,
        dependencies: [spotLeg.legId],
        tags: ["openbook", "orderbook"],
        thesis:
          "Lean on OpenBook to recycle into resting liquidity instead of crossing another AMM.",
      });
      return {
        blueprintId: "openbook_exit",
        title: `${asset.symbol} aggregator-to-orderbook recycle`,
        summary:
          "Open through Jupiter and recycle part of the book through OpenBook to capture microstructure dislocations.",
        thesis:
          "Combine deep aggregator liquidity for entry with orderbook inventory management for exit quality.",
        strategyKey: "strategy_desk::research::openbook_exit",
        sleeveId: `research_openbook_${asset.symbol.toLowerCase()}`,
        tags: [
          "openbook",
          "maker",
          "microstructure",
          asset.symbol.toLowerCase(),
        ],
        legs: [spotLeg, clobLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "openbook",
          "orderbook",
          "maker",
          "microstructure",
        ]),
        grossEdgeBps: 63,
        rationale: [
          "Uses the existing router families the repo already supports.",
          "Keeps the CLOB leg bounded and dependent on the spot entry.",
        ],
      };
    },
  },
  {
    blueprintId: "drift_event_hedge",
    label: "Perp hedge with event overlay",
    keywords: ["perp", "prediction", "hedge", "macro", "volatility"],
    baseScore: 80,
    buildScenario: (input) => {
      const asset = selectPerpAsset(input.selectedSpotAssets[0]);
      const spotLeg = buildSpotLeg({
        legId: "leg_spot_vol_entry",
        label: `${asset.symbol} spot vol entry`,
        role: "primary_alpha",
        venueKey: "orca",
        asset,
        side: "buy",
        targetNotionalUsd: 850,
        reserveUsd: 850,
        maxNotionalUsd: 1200,
        tags: ["volatility", "spot"],
        thesis: "Take the directional leg in liquid spot first.",
      });
      const hedgeLeg = buildPerpLeg({
        legId: "leg_drift_shock_hedge",
        label: `${asset.symbol} shock hedge`,
        role: "hedge",
        venueKey: "drift",
        asset,
        side: "short",
        targetNotionalUsd: 500,
        reserveUsd: 260,
        maxNotionalUsd: 700,
        dependencies: [spotLeg.legId],
        tags: ["perp", "hedge"],
        thesis:
          "Keep a bounded short perp hedge against sudden risk-off shocks.",
      });
      const eventLeg = buildPredictionLeg({
        legId: "leg_macro_confirmation",
        label: "Macro confirmation",
        instrumentId: "risk-off-weekly",
        side: "buy_yes",
        targetNotionalUsd: 18,
        dependencies: [spotLeg.legId],
        tags: ["prediction", "macro"],
        thesis: "Express event risk in a low-notional prediction overlay.",
      });
      return {
        blueprintId: "drift_event_hedge",
        title: `${asset.symbol} perp hedge + event overlay`,
        summary:
          "Spot alpha on Orca with a bounded Drift hedge and a DFlow event overlay.",
        thesis:
          "Combine spot momentum with two distinct hedging channels so the strategy can survive event-driven volatility.",
        strategyKey: "strategy_desk::research::drift_event_hedge",
        sleeveId: `research_drift_event_${asset.symbol.toLowerCase()}`,
        tags: ["perp", "prediction", "volatility", asset.symbol.toLowerCase()],
        legs: [spotLeg, hedgeLeg, eventLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "perp",
          "prediction",
          "volatility",
          "macro",
        ]),
        grossEdgeBps: 82,
        rationale: [
          "Diversifies hedge expression across perps and prediction markets.",
          "Keeps execution on paper-ready venues only.",
        ],
      };
    },
  },
  {
    blueprintId: "mango_cross_margin",
    label: "Cross-margin carry desk",
    keywords: ["mango", "cross", "margin", "carry", "inventory"],
    baseScore: 78,
    buildScenario: (input) => {
      const asset = selectPerpAsset(input.selectedSpotAssets[0]);
      const spotLeg = buildSpotLeg({
        legId: "leg_spot_margin_seed",
        label: `${asset.symbol} margin seed`,
        role: "inventory",
        venueKey: "jupiter",
        asset,
        side: "buy",
        targetNotionalUsd: 950,
        reserveUsd: 950,
        maxNotionalUsd: 1350,
        tags: ["inventory", "spot"],
        thesis: "Seed inventory in spot before layering cross-margin overlays.",
      });
      const mangoLeg = buildPerpLeg({
        legId: "leg_mango_overlay",
        label: `${asset.symbol} Mango overlay`,
        role: "carry",
        venueKey: "mango",
        asset,
        side: "short",
        targetNotionalUsd: 520,
        reserveUsd: 300,
        maxNotionalUsd: 740,
        dependencies: [spotLeg.legId],
        tags: ["mango", "carry"],
        thesis:
          "Use Mango's cross-margin path to keep the hedge capital-efficient.",
      });
      return {
        blueprintId: "mango_cross_margin",
        title: `${asset.symbol} cross-margin carry`,
        summary:
          "Spot inventory seeded on Jupiter with the hedge layered through Mango cross-margin.",
        thesis:
          "Exploit capital efficiency and cross-venue carry by separating spot inventory from the hedge venue.",
        strategyKey: "strategy_desk::research::mango_cross_margin",
        sleeveId: `research_mango_${asset.symbol.toLowerCase()}`,
        tags: ["mango", "carry", "cross-margin", asset.symbol.toLowerCase()],
        legs: [spotLeg, mangoLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "mango",
          "carry",
          "margin",
          "cross",
        ]),
        grossEdgeBps: 86,
        rationale: [
          "Tests the repo's Mango adapter in the exact research harness path the user wants.",
          "Separates balance sheet efficiency from entry routing.",
        ],
      };
    },
  },
  {
    blueprintId: "inventory_rebalance",
    label: "Inventory recycle with flash",
    keywords: ["inventory", "flash", "rebalance", "liquidity"],
    baseScore: 68,
    buildScenario: (input) => {
      const asset = selectSpotAsset(
        input.selectedSpotAssets,
        input.scenarioIndex + 1,
      );
      const entryLeg = buildSpotLeg({
        legId: "leg_inventory_build",
        label: `${asset.symbol} inventory build`,
        role: "inventory",
        venueKey: "raydium",
        asset,
        side: "buy",
        targetNotionalUsd: 650,
        reserveUsd: 650,
        maxNotionalUsd: 920,
        tags: ["inventory", "raydium"],
        thesis: "Build inventory on one venue before rebalancing it elsewhere.",
      });
      const recycleLeg = buildClobLeg({
        legId: "leg_inventory_openbook",
        label: `${asset.symbol} inventory recycle`,
        venueKey: "openbook",
        asset,
        side: "sell",
        targetNotionalUsd: 260,
        dependencies: [entryLeg.legId],
        tags: ["openbook", "inventory"],
        thesis:
          "Lean on the orderbook to recycle part of the inventory without another AMM hop.",
      });
      const flashLeg = buildFlashLeg({
        legId: "leg_inventory_flash",
        label: "Inventory flash rebalance",
        asset,
        targetNotionalUsd: 140,
        dependencies: [entryLeg.legId, recycleLeg.legId],
        tags: ["flash", "rebalance"],
        thesis:
          "Use flash liquidity to close the remaining inventory gap atomically.",
      });
      return {
        blueprintId: "inventory_rebalance",
        title: `${asset.symbol} inventory recycle desk`,
        summary:
          "Build inventory in an AMM, recycle on the book, and close the loop with flash liquidity.",
        thesis:
          "Treat venue fragmentation as an inventory-management opportunity instead of forcing every leg through the same venue family.",
        strategyKey: "strategy_desk::research::inventory_rebalance",
        sleeveId: `research_inventory_${asset.symbol.toLowerCase()}`,
        tags: ["inventory", "flash", "rebalance", asset.symbol.toLowerCase()],
        legs: [entryLeg, recycleLeg, flashLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "inventory",
          "flash",
          "rebalance",
          "liquidity",
        ]),
        grossEdgeBps: 61,
        rationale: [
          "Explicitly exercises the flash + orderbook path together.",
          "Keeps each leg small and dependency-aware.",
        ],
      };
    },
  },
  {
    blueprintId: "orderbook_basis",
    label: "Orderbook + perp basis recycle",
    keywords: ["orderbook", "perp", "basis", "maker", "hedge"],
    baseScore: 76,
    buildScenario: (input) => {
      const asset = selectPerpAsset(input.selectedSpotAssets[0]);
      const openbookLeg = buildClobLeg({
        legId: "leg_openbook_build",
        label: `${asset.symbol} OpenBook build`,
        venueKey: "openbook",
        asset,
        side: "buy",
        targetNotionalUsd: 540,
        tags: ["orderbook", "maker"],
        thesis:
          "Build the first chunk on the book when microstructure looks favorable.",
      });
      const driftLeg = buildPerpLeg({
        legId: "leg_drift_basis_recycle",
        label: `${asset.symbol} Drift recycle`,
        role: "hedge",
        venueKey: "drift",
        asset,
        side: "short",
        targetNotionalUsd: 460,
        reserveUsd: 260,
        maxNotionalUsd: 620,
        dependencies: [openbookLeg.legId],
        tags: ["basis", "perp"],
        thesis: "Hedge the orderbook inventory with a bounded short perp leg.",
      });
      return {
        blueprintId: "orderbook_basis",
        title: `${asset.symbol} orderbook basis recycle`,
        summary:
          "Open on the orderbook and hedge the resulting inventory with a Drift perp leg.",
        thesis:
          "Use the orderbook for inventory formation and perps for bounded balance-sheet compression.",
        strategyKey: "strategy_desk::research::orderbook_basis",
        sleeveId: `research_book_basis_${asset.symbol.toLowerCase()}`,
        tags: ["orderbook", "perp", "basis", asset.symbol.toLowerCase()],
        legs: [openbookLeg, driftLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "orderbook",
          "basis",
          "perp",
          "maker",
        ]),
        grossEdgeBps: 79,
        rationale: [
          "Exercises two non-aggregator families together.",
          "Good fit when the prompt emphasizes microstructure rather than raw momentum.",
        ],
      };
    },
  },
  {
    blueprintId: "mean_reversion_stack",
    label: "Mean-reversion stack",
    keywords: ["mean", "reversion", "microstructure", "inventory", "flash"],
    baseScore: 66,
    buildScenario: (input) => {
      const asset = selectSpotAsset(
        input.selectedSpotAssets,
        input.scenarioIndex + 2,
      );
      const entryLeg = buildSpotLeg({
        legId: "leg_orca_reversion_entry",
        label: `${asset.symbol} reversion entry`,
        role: "primary_alpha",
        venueKey: "orca",
        asset,
        side: "buy",
        targetNotionalUsd: 620,
        reserveUsd: 620,
        maxNotionalUsd: 880,
        tags: ["mean-reversion", "orca"],
        thesis:
          "Enter through concentrated liquidity when short-horizon dislocations snap back.",
      });
      const exitLeg = buildSpotLeg({
        legId: "leg_jupiter_reversion_exit",
        label: `${asset.symbol} reversion exit`,
        role: "liquidity",
        venueKey: "jupiter",
        asset,
        side: "sell",
        targetNotionalUsd: 320,
        reserveUsd: 120,
        maxNotionalUsd: 450,
        dependencies: [entryLeg.legId],
        tags: ["mean-reversion", "jupiter"],
        thesis: "Exit through the aggregator once the spread compresses.",
      });
      const flashLeg = buildFlashLeg({
        legId: "leg_reversion_flash",
        label: "Reversion flash unwind",
        asset,
        targetNotionalUsd: 110,
        dependencies: [entryLeg.legId, exitLeg.legId],
        tags: ["flash", "mean-reversion"],
        thesis: "Clear residual inventory after the reversion cycle finishes.",
      });
      return {
        blueprintId: "mean_reversion_stack",
        title: `${asset.symbol} mean-reversion stack`,
        summary:
          "Exploit short-lived AMM dislocations and use the aggregator plus flash liquidity to complete the cycle.",
        thesis:
          "Treat venue routing differences as reversion opportunities, not just price-taking surfaces.",
        strategyKey: "strategy_desk::research::mean_reversion_stack",
        sleeveId: `research_reversion_${asset.symbol.toLowerCase()}`,
        tags: [
          "mean-reversion",
          "flash",
          "routing",
          asset.symbol.toLowerCase(),
        ],
        legs: [entryLeg, exitLeg, flashLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "mean",
          "reversion",
          "microstructure",
          "flash",
        ]),
        grossEdgeBps: 58,
        rationale: [
          "Designed for prompts that emphasize dislocation rather than trend.",
          "Keeps the flash leg as an operational cleanup path rather than leverage.",
        ],
      };
    },
  },
  {
    blueprintId: "prediction_hedged_carry",
    label: "Carry + prediction hedge",
    keywords: ["carry", "prediction", "hedge", "macro", "tail"],
    baseScore: 75,
    buildScenario: (input) => {
      const asset = selectPerpAsset(input.selectedSpotAssets[0]);
      const spotLeg = buildSpotLeg({
        legId: "leg_spot_carry_core",
        label: `${asset.symbol} carry core`,
        role: "carry",
        venueKey: "jupiter",
        asset,
        side: "buy",
        targetNotionalUsd: 1020,
        reserveUsd: 1020,
        maxNotionalUsd: 1400,
        tags: ["carry", "spot"],
        thesis: "Hold the carry leg in liquid spot.",
      });
      const predictionLeg = buildPredictionLeg({
        legId: "leg_prediction_tail",
        label: "Tail hedge",
        instrumentId: "tail-risk-weekly",
        side: "buy_yes",
        targetNotionalUsd: 22,
        dependencies: [spotLeg.legId],
        tags: ["prediction", "tail"],
        thesis: "Add a tiny tail hedge on an event market.",
      });
      const perpLeg = buildPerpLeg({
        legId: "leg_carry_compress",
        label: `${asset.symbol} carry compress`,
        role: "hedge",
        venueKey: "mango",
        asset,
        side: "short",
        targetNotionalUsd: 420,
        reserveUsd: 240,
        maxNotionalUsd: 620,
        dependencies: [spotLeg.legId],
        tags: ["carry", "mango"],
        thesis:
          "Compress residual beta through Mango once the carry leg is on.",
      });
      return {
        blueprintId: "prediction_hedged_carry",
        title: `${asset.symbol} carry + prediction hedge`,
        summary:
          "Core carry in spot, residual beta compressed through Mango, and a tiny DFlow tail hedge.",
        thesis:
          "Mix carry and event hedging so tail risk is explicit instead of hidden inside the directional book.",
        strategyKey: "strategy_desk::research::prediction_hedged_carry",
        sleeveId: `research_prediction_carry_${asset.symbol.toLowerCase()}`,
        tags: ["carry", "prediction", "tail", asset.symbol.toLowerCase()],
        legs: [spotLeg, predictionLeg, perpLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "carry",
          "prediction",
          "macro",
          "tail",
        ]),
        grossEdgeBps: 83,
        rationale: [
          "Expresses tail risk explicitly through the prediction venue instead of only shrinking size.",
          "Good fit for prompts that ask for asymmetric hedges.",
        ],
      };
    },
  },
  {
    blueprintId: "liquidity_vacuum",
    label: "Liquidity vacuum recycler",
    keywords: ["liquidity", "vacuum", "flash", "openbook", "route"],
    baseScore: 70,
    buildScenario: (input) => {
      const asset = selectSpotAsset(
        input.selectedSpotAssets,
        input.scenarioIndex + 3,
      );
      const spotLeg = buildSpotLeg({
        legId: "leg_jupiter_vacuum_entry",
        label: `${asset.symbol} liquidity vacuum entry`,
        role: "primary_alpha",
        venueKey: "jupiter",
        asset,
        side: "buy",
        targetNotionalUsd: 730,
        reserveUsd: 730,
        maxNotionalUsd: 1020,
        tags: ["liquidity", "route"],
        thesis: "Enter quickly where routing quality is deepest.",
      });
      const clobLeg = buildClobLeg({
        legId: "leg_openbook_vacuum_exit",
        label: `${asset.symbol} liquidity vacuum exit`,
        venueKey: "openbook",
        asset,
        side: "sell",
        targetNotionalUsd: 350,
        dependencies: [spotLeg.legId],
        tags: ["liquidity", "openbook"],
        thesis: "Recycle inventory onto the book once the vacuum closes.",
      });
      const flashLeg = buildFlashLeg({
        legId: "leg_vacuum_flash",
        label: "Vacuum flash settle",
        asset,
        targetNotionalUsd: 150,
        dependencies: [spotLeg.legId, clobLeg.legId],
        tags: ["flash", "settle"],
        thesis: "Use the flash leg as a fast settlement bridge across venues.",
      });
      return {
        blueprintId: "liquidity_vacuum",
        title: `${asset.symbol} liquidity vacuum recycler`,
        summary:
          "Fill into a routing vacuum, recycle on the orderbook, then finish with flash settlement.",
        thesis:
          "Use the harness to test venue transitions that are too operationally awkward to express in a single runtime deployment today.",
        strategyKey: "strategy_desk::research::liquidity_vacuum",
        sleeveId: `research_vacuum_${asset.symbol.toLowerCase()}`,
        tags: ["liquidity", "flash", "openbook", asset.symbol.toLowerCase()],
        legs: [spotLeg, clobLeg, flashLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "liquidity",
          "vacuum",
          "flash",
          "route",
        ]),
        grossEdgeBps: 67,
        rationale: [
          "Specifically targets multi-hop operational inefficiencies.",
          "Good harness-native scenario because the current managed runtime cannot express it as one deployment.",
        ],
      };
    },
  },
  {
    blueprintId: "spread_dispersion",
    label: "Spread dispersion basket",
    keywords: ["dispersion", "spread", "basket", "routing", "hedge"],
    baseScore: 72,
    buildScenario: (input) => {
      const asset = selectSpotAsset(
        input.selectedSpotAssets,
        input.scenarioIndex + 4,
      );
      const spotLeg = buildSpotLeg({
        legId: "leg_spread_entry",
        label: `${asset.symbol} spread entry`,
        role: "primary_alpha",
        venueKey: "orca",
        asset,
        side: "buy",
        targetNotionalUsd: 560,
        reserveUsd: 560,
        maxNotionalUsd: 820,
        tags: ["spread", "dispersion"],
        thesis: "Take the tighter spot side where spread dispersion opens up.",
      });
      const raydiumLeg = buildSpotLeg({
        legId: "leg_spread_release",
        label: `${asset.symbol} spread release`,
        role: "liquidity",
        venueKey: "raydium",
        asset,
        side: "sell",
        targetNotionalUsd: 260,
        reserveUsd: 110,
        maxNotionalUsd: 380,
        dependencies: [spotLeg.legId],
        tags: ["spread", "raydium"],
        thesis: "Release into the alternate AMM once the spread normalizes.",
      });
      const hedgeLeg = buildPerpLeg({
        legId: "leg_dispersion_hedge",
        label: `${selectPerpAsset(asset).symbol} dispersion hedge`,
        role: "hedge",
        venueKey: "drift",
        asset: selectPerpAsset(asset),
        side: "short",
        targetNotionalUsd: 360,
        reserveUsd: 220,
        maxNotionalUsd: 520,
        dependencies: [spotLeg.legId],
        tags: ["hedge", "perp"],
        thesis:
          "Use a small hedge to keep the basket from turning into a pure beta bet.",
      });
      return {
        blueprintId: "spread_dispersion",
        title: `${asset.symbol} spread dispersion basket`,
        summary:
          "Exploit AMM spread dispersion with a small perp hedge to keep the basket bounded.",
        thesis:
          "Treat venue-to-venue spread differences as the primary signal and perps as the risk compressor.",
        strategyKey: "strategy_desk::research::spread_dispersion",
        sleeveId: `research_dispersion_${asset.symbol.toLowerCase()}`,
        tags: ["dispersion", "spread", "hedge", asset.symbol.toLowerCase()],
        legs: [spotLeg, raydiumLeg, hedgeLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "dispersion",
          "spread",
          "routing",
          "hedge",
        ]),
        grossEdgeBps: 76,
        rationale: [
          "Mixes two AMMs plus a hedge venue in one bounded composite.",
          "Matches the user's requested multi-venue inefficiency framing closely.",
        ],
      };
    },
  },
  {
    blueprintId: "defensive_overlay",
    label: "Defensive overlay stack",
    keywords: ["defensive", "overlay", "tail", "event", "carry"],
    baseScore: 69,
    buildScenario: (input) => {
      const asset = selectPerpAsset(input.selectedSpotAssets[0]);
      const spotLeg = buildSpotLeg({
        legId: "leg_defensive_spot",
        label: `${asset.symbol} defensive spot`,
        role: "primary_alpha",
        venueKey: "jupiter",
        asset,
        side: "buy",
        targetNotionalUsd: 780,
        reserveUsd: 780,
        maxNotionalUsd: 1100,
        tags: ["defensive", "spot"],
        thesis:
          "Keep the core risk in the most liquid spot venue available in the repo.",
      });
      const predictionLeg = buildPredictionLeg({
        legId: "leg_defensive_prediction",
        label: "Defensive event hedge",
        instrumentId: "risk-off-tail-probability",
        side: "buy_yes",
        targetNotionalUsd: 16,
        dependencies: [spotLeg.legId],
        tags: ["defensive", "prediction"],
        thesis: "Use a tiny prediction hedge to defend against regime breaks.",
      });
      const hedgeLeg = buildPerpLeg({
        legId: "leg_defensive_perp",
        label: `${asset.symbol} defensive hedge`,
        role: "hedge",
        venueKey: "drift",
        asset,
        side: "short",
        targetNotionalUsd: 300,
        reserveUsd: 190,
        maxNotionalUsd: 420,
        dependencies: [spotLeg.legId],
        tags: ["defensive", "perp"],
        thesis: "Only layer the hedge once the spot leg is in place.",
      });
      return {
        blueprintId: "defensive_overlay",
        title: `${asset.symbol} defensive overlay stack`,
        summary:
          "A defensive spot book with explicit event and perp overlays instead of bluntly shrinking exposure.",
        thesis:
          "Build a resilient multi-venue book that survives adverse regimes without abandoning the underlying thesis.",
        strategyKey: "strategy_desk::research::defensive_overlay",
        sleeveId: `research_defensive_${asset.symbol.toLowerCase()}`,
        tags: ["defensive", "overlay", "tail", asset.symbol.toLowerCase()],
        legs: [spotLeg, predictionLeg, hedgeLeg],
        keywordMatches: intersectKeywords(input.promptProfile.tokens, [
          "defensive",
          "overlay",
          "tail",
          "event",
        ]),
        grossEdgeBps: 64,
        rationale: [
          "Makes the hedge expression explicit and bounded.",
          "Useful when the user wants robust composite ideas rather than pure aggressiveness.",
        ],
      };
    },
  },
];

function nowIso(deps?: StrategyDeskResearchDeps): string {
  return deps?.now?.() ?? new Date().toISOString();
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value ?? fallback)));
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "research";
}

function tokenizePrompt(prompt: string): Set<string> {
  return new Set(
    prompt
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter(Boolean),
  );
}

function intersectKeywords(tokens: Set<string>, keywords: string[]): string[] {
  return keywords.filter((keyword) => tokens.has(keyword.toLowerCase()));
}

function buildPromptProfile(prompt: string): StrategyDeskResearchPromptProfile {
  const tokens = tokenizePrompt(prompt);
  const assets = ["SOL", "JUP", "RAY", "WIF", "BONK", "JTO"].filter((symbol) =>
    tokens.has(symbol.toLowerCase()),
  );
  const requestedFamilies = new Set<string>();
  const requestedVenues = new Set<string>();

  for (const [family, familyKeywords] of Object.entries(FAMILY_KEYWORD_MAP)) {
    if (familyKeywords.some((keyword) => tokens.has(keyword))) {
      requestedFamilies.add(family);
    }
  }

  for (const venue of [
    "jupiter",
    "raydium",
    "orca",
    "openbook",
    "mango",
    "drift",
    "dflow",
    "flash",
  ]) {
    if (tokens.has(venue)) {
      requestedVenues.add(venue);
    }
  }

  return {
    tokens,
    assets,
    requestedFamilies,
    requestedVenues,
  };
}

function buildTokenBySymbol(): Map<string, SupportedTradingToken> {
  const entries = Object.values(TRADING_TOKEN_BY_MINT).map((token) => [
    token.symbol,
    token,
  ]);
  return new Map(entries);
}

const TOKEN_BY_SYMBOL = buildTokenBySymbol();

function buildAssetPreset(symbol: string): StrategyDeskAssetPreset {
  const token = TOKEN_BY_SYMBOL.get(symbol) ?? TOKEN_BY_SYMBOL.get("SOL");
  const usdc = TOKEN_BY_SYMBOL.get("USDC");
  if (!token || !usdc) {
    throw new Error("runtime-strategy-desk-research-token-config-missing");
  }
  return {
    symbol: token.symbol,
    pairSymbol: `${token.symbol}/USDC`,
    baseMint: token.mint,
    quoteMint: usdc.mint,
    decimals: token.decimals,
    referencePriceUsd: REFERENCE_PRICE_BY_SYMBOL[token.symbol] ?? 1,
  };
}

function selectSpotAssets(
  profile: StrategyDeskResearchPromptProfile,
): StrategyDeskAssetPreset[] {
  const symbols = [
    ...profile.assets,
    "SOL",
    "JUP",
    "RAY",
    "WIF",
    "BONK",
    "JTO",
  ];
  const unique = symbols.filter(
    (symbol, index) => symbols.indexOf(symbol) === index,
  );
  return unique.map((symbol) => buildAssetPreset(symbol));
}

function selectSpotAsset(
  assets: StrategyDeskAssetPreset[],
  scenarioIndex: number,
): StrategyDeskAssetPreset {
  return assets[scenarioIndex % assets.length] ?? buildAssetPreset("SOL");
}

function selectPerpAsset(
  asset: StrategyDeskAssetPreset,
): StrategyDeskAssetPreset {
  return asset.symbol === "SOL" ? asset : buildAssetPreset("SOL");
}

function decimalToAtomic(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  const [whole, fractionRaw = ""] = fixed.split(".");
  const fraction = fractionRaw.padEnd(decimals, "0").slice(0, decimals);
  return String(
    BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction || "0"),
  );
}

function usdToStableAtomic(usd: number): string {
  return decimalToAtomic(usd, 6);
}

function usdToBaseAtomic(usd: number, asset: StrategyDeskAssetPreset): string {
  return decimalToAtomic(usd / asset.referencePriceUsd, asset.decimals);
}

function buildSpotLeg(input: {
  legId: string;
  label: string;
  role: RuntimeStrategyDeskScenarioLeg["role"];
  venueKey: "jupiter" | "raydium" | "orca";
  asset: StrategyDeskAssetPreset;
  side: "buy" | "sell";
  targetNotionalUsd: number;
  reserveUsd: number;
  maxNotionalUsd: number;
  dependencies?: string[];
  tags: string[];
  thesis: string;
}): RuntimeStrategyDeskScenarioLeg {
  return {
    legId: input.legId,
    label: input.label,
    role: input.role,
    venueKey: input.venueKey,
    intentFamily: "spot_swap",
    marketType: "spot",
    pair: {
      symbol: input.asset.pairSymbol,
      baseMint: input.asset.baseMint,
      quoteMint: input.asset.quoteMint,
      marketType: "spot",
    },
    assetKeys: [input.asset.symbol, "USDC"],
    enabledModes: ["shadow", "paper"],
    sizing: {
      targetNotionalUsd: formatUsd(input.targetNotionalUsd),
      maxNotionalUsd: formatUsd(input.maxNotionalUsd),
      reserveUsd: formatUsd(input.reserveUsd),
      maxSlippageBps: 50,
    },
    intent: {
      side: input.side,
      ...(input.side === "sell"
        ? {
            quantityAtomic: usdToBaseAtomic(
              input.targetNotionalUsd,
              input.asset,
            ),
          }
        : {}),
    },
    thesis: input.thesis,
    ...(input.dependencies && input.dependencies.length > 0
      ? { dependencies: input.dependencies }
      : {}),
    tags: input.tags,
  };
}

function buildPerpLeg(input: {
  legId: string;
  label: string;
  role: RuntimeStrategyDeskScenarioLeg["role"];
  venueKey: "drift" | "mango";
  asset: StrategyDeskAssetPreset;
  side: "long" | "short" | "close_long" | "close_short";
  targetNotionalUsd: number;
  reserveUsd: number;
  maxNotionalUsd: number;
  dependencies?: string[];
  tags: string[];
  thesis: string;
}): RuntimeStrategyDeskScenarioLeg {
  const perpAsset = selectPerpAsset(input.asset);
  return {
    legId: input.legId,
    label: input.label,
    role: input.role,
    venueKey: input.venueKey,
    intentFamily: "perp_order",
    marketType: "perp",
    pair: {
      symbol: `${perpAsset.symbol}-PERP`,
      baseMint: perpAsset.baseMint,
      quoteMint: USDC_MINT,
      marketType: "perp",
    },
    instrumentId: `${perpAsset.symbol}-PERP`,
    assetKeys: [perpAsset.symbol, "USDC"],
    enabledModes: ["shadow", "paper"],
    sizing: {
      targetNotionalUsd: formatUsd(input.targetNotionalUsd),
      maxNotionalUsd: formatUsd(input.maxNotionalUsd),
      reserveUsd: formatUsd(input.reserveUsd),
      maxSlippageBps: 35,
    },
    intent: {
      side: input.side,
      quantityAtomic: usdToBaseAtomic(input.targetNotionalUsd, perpAsset),
      collateralAtomic: usdToStableAtomic(input.reserveUsd),
    },
    thesis: input.thesis,
    ...(input.dependencies && input.dependencies.length > 0
      ? { dependencies: input.dependencies }
      : {}),
    tags: input.tags,
  };
}

function buildPredictionLeg(input: {
  legId: string;
  label: string;
  instrumentId: string;
  side: "buy_yes" | "buy_no" | "sell_yes" | "sell_no";
  targetNotionalUsd: number;
  dependencies?: string[];
  tags: string[];
  thesis: string;
}): RuntimeStrategyDeskScenarioLeg {
  return {
    legId: input.legId,
    label: input.label,
    role: "prediction",
    venueKey: "dflow",
    intentFamily: "prediction_order",
    marketType: "prediction",
    instrumentId: input.instrumentId,
    assetKeys: ["USDC"],
    enabledModes: ["shadow", "paper"],
    sizing: {
      targetNotionalUsd: formatUsd(input.targetNotionalUsd),
      maxNotionalUsd: formatUsd(
        Math.min(25, Math.max(25, input.targetNotionalUsd)),
      ),
      reserveUsd: formatUsd(input.targetNotionalUsd),
      maxSlippageBps: 100,
    },
    intent: {
      side: input.side,
      outcomeId: input.side.includes("yes") ? "yes" : "no",
      settlementMint: USDC_MINT,
      quantityAtomic: usdToStableAtomic(input.targetNotionalUsd),
    },
    thesis: input.thesis,
    ...(input.dependencies && input.dependencies.length > 0
      ? { dependencies: input.dependencies }
      : {}),
    tags: input.tags,
  };
}

function buildFlashLeg(input: {
  legId: string;
  label: string;
  asset: StrategyDeskAssetPreset;
  targetNotionalUsd: number;
  dependencies?: string[];
  tags: string[];
  thesis: string;
}): RuntimeStrategyDeskScenarioLeg {
  return {
    legId: input.legId,
    label: input.label,
    role: "flash_rebalance",
    venueKey: "flash_liquidity",
    intentFamily: "flash_atomic",
    marketType: "spot",
    pair: {
      symbol: input.asset.pairSymbol,
      baseMint: input.asset.baseMint,
      quoteMint: input.asset.quoteMint,
      marketType: "spot",
    },
    assetKeys: [input.asset.symbol, "USDC"],
    enabledModes: ["shadow", "paper"],
    sizing: {
      targetNotionalUsd: formatUsd(input.targetNotionalUsd),
      maxNotionalUsd: formatUsd(input.targetNotionalUsd * 1.6),
      reserveUsd: formatUsd(input.targetNotionalUsd * 0.5),
      maxSlippageBps: 40,
    },
    intent: {
      referenceId: `${input.legId}_${input.asset.symbol.toLowerCase()}`,
      settlementMint: input.asset.quoteMint,
      borrowLegs: [
        {
          provider: "marginfi",
          mint: input.asset.quoteMint,
          amountAtomic: usdToStableAtomic(input.targetNotionalUsd),
        },
      ],
    },
    thesis: input.thesis,
    ...(input.dependencies && input.dependencies.length > 0
      ? { dependencies: input.dependencies }
      : {}),
    tags: input.tags,
  };
}

function buildClobLeg(input: {
  legId: string;
  label: string;
  venueKey: "openbook";
  asset: StrategyDeskAssetPreset;
  side: "buy" | "sell";
  targetNotionalUsd: number;
  dependencies?: string[];
  tags: string[];
  thesis: string;
}): RuntimeStrategyDeskScenarioLeg {
  return {
    legId: input.legId,
    label: input.label,
    role: "liquidity",
    venueKey: input.venueKey,
    intentFamily: "clob_order",
    marketType: "spot",
    pair: {
      symbol: input.asset.pairSymbol,
      baseMint: input.asset.baseMint,
      quoteMint: input.asset.quoteMint,
      marketType: "spot",
    },
    instrumentId: input.asset.pairSymbol,
    assetKeys: [input.asset.symbol, "USDC"],
    enabledModes: ["shadow", "paper"],
    sizing: {
      targetNotionalUsd: formatUsd(input.targetNotionalUsd),
      maxNotionalUsd: formatUsd(input.targetNotionalUsd * 1.4),
      reserveUsd: formatUsd(input.targetNotionalUsd * 0.5),
      maxSlippageBps: 25,
    },
    intent: {
      side: input.side,
      quantityAtomic: usdToBaseAtomic(input.targetNotionalUsd, input.asset),
    },
    thesis: input.thesis,
    ...(input.dependencies && input.dependencies.length > 0
      ? { dependencies: input.dependencies }
      : {}),
    tags: input.tags,
  };
}

function readUsd(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value: number): string {
  return value.toFixed(2);
}

function buildRiskLimits(
  scenario: StrategyDeskBlueprintScenario,
): NonNullable<RuntimeStrategyDeskScenarioManifest["riskLimits"]> {
  const reserved = scenario.legs.reduce(
    (total, leg) => total + readUsd(leg.sizing.reserveUsd),
    0,
  );
  const gross = scenario.legs.reduce(
    (total, leg) =>
      total +
      readUsd(leg.sizing.maxNotionalUsd ?? leg.sizing.targetNotionalUsd),
    0,
  );
  const net = Math.abs(
    scenario.legs.reduce((total, leg) => {
      const target = readUsd(leg.sizing.targetNotionalUsd);
      const side = String(leg.intent?.side ?? "")
        .trim()
        .toLowerCase();
      if (
        leg.intentFamily === "perp_order" &&
        (side === "short" || side === "close_long")
      ) {
        return total - target;
      }
      if (leg.intentFamily === "prediction_order" && side === "buy_no") {
        return total - target;
      }
      if (
        (leg.intentFamily === "spot_swap" ||
          leg.intentFamily === "clob_order") &&
        side === "sell"
      ) {
        return total - target;
      }
      return total + target;
    }, 0),
  );
  const maxLegTarget = Math.max(
    ...scenario.legs.map((leg) => readUsd(leg.sizing.targetNotionalUsd)),
  );
  const maxLegConcentrationBps =
    gross > 0
      ? Math.min(9500, Math.round((maxLegTarget / gross) * 10_000) + 400)
      : 9000;
  return {
    maxReservedCapitalUsd: formatUsd(reserved),
    maxGrossExposureUsd: formatUsd(gross),
    maxNetExposureUsd: formatUsd(Math.max(net, maxLegTarget)),
    maxLegConcentrationBps,
    maxVenueFamilyConcentrationBps: 9500,
    maxDrawdownBps: 1200,
  };
}

function buildScenarioManifest(input: {
  scenario: StrategyDeskBlueprintScenario;
  scenarioId: string;
  ownerUserId: string;
  runKind: StrategyDeskResearchRunKind;
  now: string;
  prompt: string;
}): RuntimeStrategyDeskScenarioManifest {
  return {
    schemaVersion: "v1",
    scenarioId: input.scenarioId,
    title: input.scenario.title,
    summary: input.scenario.summary,
    ownerUserId: input.ownerUserId,
    strategyKey: input.scenario.strategyKey,
    thesis: input.scenario.thesis,
    sleeveId: input.scenario.sleeveId,
    state: input.runKind === "paper" ? "paper_ready" : "shadow_ready",
    createdAt: input.now,
    updatedAt: input.now,
    reviewedAt: input.now,
    riskLimits: buildRiskLimits(input.scenario),
    legs: input.scenario.legs,
    evidence: [],
    implementationReferences: [],
    tags: input.scenario.tags,
    metadata: {
      researchPrompt: input.prompt,
      blueprintId: input.scenario.blueprintId,
      keywordMatches: input.scenario.keywordMatches,
      rationale: input.scenario.rationale,
    },
  };
}

function scoreBlueprint(
  blueprint: StrategyDeskBlueprint,
  profile: StrategyDeskResearchPromptProfile,
): number {
  const keywordMatches = intersectKeywords(
    profile.tokens,
    blueprint.keywords,
  ).length;
  const venueBonus =
    Array.from(profile.requestedVenues).filter((venue) =>
      blueprint.keywords.includes(venue),
    ).length * 4;
  const familyBonus =
    Array.from(profile.requestedFamilies).filter((family) =>
      FAMILY_KEYWORD_MAP[family]?.some((keyword) =>
        blueprint.keywords.includes(keyword),
      ),
    ).length * 3;
  return blueprint.baseScore + keywordMatches * 8 + venueBonus + familyBonus;
}

function selectBlueprints(
  profile: StrategyDeskResearchPromptProfile,
  candidateCount: number,
): StrategyDeskBlueprint[] {
  return [...BLUEPRINTS]
    .sort((left, right) => {
      const scoreDiff =
        scoreBlueprint(right, profile) - scoreBlueprint(left, profile);
      if (scoreDiff !== 0) return scoreDiff;
      return left.blueprintId.localeCompare(right.blueprintId);
    })
    .slice(0, candidateCount);
}

function estimatedLegCostUsd(leg: RuntimeStrategyDeskScenarioLeg): number {
  const target = readUsd(leg.sizing.targetNotionalUsd);
  const familyCostBps = FAMILY_COST_BPS[leg.intentFamily] ?? 20;
  return (target * familyCostBps) / 10_000;
}

function estimatedScenarioGrossEdgeUsd(
  scenario: StrategyDeskBlueprintScenario,
): number {
  const alphaNotional = scenario.legs
    .filter(
      (leg) =>
        leg.role === "primary_alpha" ||
        leg.role === "carry" ||
        leg.role === "liquidity",
    )
    .reduce((total, leg) => total + readUsd(leg.sizing.targetNotionalUsd), 0);
  return (alphaNotional * scenario.grossEdgeBps) / 10_000;
}

function countPassingLegs(report: RuntimeStrategyDeskScenarioReport): number {
  return report.legOutcomes.filter((outcome) => outcome.status === "pass")
    .length;
}

function countBlockedLegs(report: RuntimeStrategyDeskScenarioReport): number {
  return report.legOutcomes.filter((outcome) => outcome.status === "blocked")
    .length;
}

function buildScenarioMetrics(input: {
  scenario: StrategyDeskBlueprintScenario;
  report: RuntimeStrategyDeskScenarioReport;
  promptProfile: StrategyDeskResearchPromptProfile;
}): StrategyDeskScenarioResearchMetrics {
  const estimatedCostUsd = input.scenario.legs.reduce(
    (total, leg) => total + estimatedLegCostUsd(leg),
    0,
  );
  const estimatedGrossEdgeUsd = estimatedScenarioGrossEdgeUsd(input.scenario);
  const estimatedNetPnlUsd = estimatedGrossEdgeUsd - estimatedCostUsd;
  const keywordMatches = input.scenario.keywordMatches.length;
  const promptFitScore = Math.min(
    100,
    35 + keywordMatches * 15 + (input.promptProfile.assets.length > 0 ? 10 : 0),
  );
  const passedLegs = countPassingLegs(input.report);
  const blockedLegs = countBlockedLegs(input.report);
  const totalLegs = input.report.legOutcomes.length || 1;
  const executionScore = Math.max(
    0,
    Math.round((passedLegs / totalLegs) * 100) - blockedLegs * 12,
  );
  const uniqueVenues = new Set(input.scenario.legs.map((leg) => leg.venueKey))
    .size;
  const uniqueFamilies = new Set(
    input.scenario.legs.map((leg) => leg.intentFamily),
  ).size;
  const diversityScore = Math.min(100, uniqueVenues * 18 + uniqueFamilies * 12);
  const totalScore =
    promptFitScore * 0.3 +
    executionScore * 0.35 +
    diversityScore * 0.15 +
    Math.max(-40, Math.min(40, estimatedNetPnlUsd)) * 0.5;

  return {
    promptFitScore: roundNumber(promptFitScore),
    executionScore: roundNumber(executionScore),
    diversityScore: roundNumber(diversityScore),
    estimatedGrossEdgeUsd: roundNumber(estimatedGrossEdgeUsd),
    estimatedCostUsd: roundNumber(estimatedCostUsd),
    estimatedNetPnlUsd: roundNumber(estimatedNetPnlUsd),
    totalScore: roundNumber(totalScore),
  };
}

function roundNumber(value: number): number {
  return Number(value.toFixed(2));
}

const deterministicQuoteSpotSwap: NonNullable<
  StrategyDeskRunnerDeps["quoteSpotSwap"]
> = async (input) => {
  const inputToken = TRADING_TOKEN_BY_MINT[input.inputMint];
  const outputToken = TRADING_TOKEN_BY_MINT[input.outputMint];
  const inputDecimals = inputToken?.decimals ?? 6;
  const outputDecimals = outputToken?.decimals ?? 6;
  const inputPriceUsd =
    REFERENCE_PRICE_BY_SYMBOL[inputToken?.symbol ?? "USDC"] ?? 1;
  const outputPriceUsd =
    REFERENCE_PRICE_BY_SYMBOL[outputToken?.symbol ?? "USDC"] ?? 1;
  const inputUnits = Number(input.amountAtomic) / 10 ** inputDecimals;
  const inputUsd = inputUnits * inputPriceUsd;
  const outputUnits = (inputUsd * 0.9965) / outputPriceUsd;
  const outAmount = decimalToAtomic(outputUnits, outputDecimals);
  return {
    venueKey: input.venueKey ?? "jupiter",
    quoteProvider: "deterministic_research",
    quoteResponse: {
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      inAmount: input.amountAtomic,
      outAmount,
      priceImpactPct: 0.0035,
      routePlan: [
        {
          poolId: `research_${input.venueKey ?? "jupiter"}_pool`,
          swapInfo: { label: "DeterministicResearchRoute" },
        },
      ],
    },
    routeQuality: {
      venueKey: input.venueKey ?? "jupiter",
      quoteProvider: "deterministic_research",
      routeHopCount: 1,
      routeLabels: ["DeterministicResearchRoute"],
      poolIds: [`research_${input.venueKey ?? "jupiter"}_pool`],
      quotedOutAmountAtomic: outAmount,
      minExpectedOutAmountAtomic: outAmount,
      priceImpactPct: 0.0035,
    },
  };
};

const deterministicExecuteIntentViaRouter: NonNullable<
  StrategyDeskRunnerDeps["executeIntentViaRouter"]
> = async (input) => {
  const intent = input.intent;
  const quantityAtomic =
    "quantityAtomic" in intent && typeof intent.quantityAtomic === "string"
      ? intent.quantityAtomic
      : "1000000";
  const settlementMint =
    "settlementMint" in intent && typeof intent.settlementMint === "string"
      ? intent.settlementMint
      : USDC_MINT;
  return {
    status: input.runtimeMode === "shadow" ? "dry_run" : "simulated",
    signature: null,
    usedQuote:
      intent.family === "spot_swap"
        ? {
            inputMint: intent.inputMint,
            outputMint: intent.outputMint,
            inAmount: intent.amountAtomic,
            outAmount: intent.amountAtomic,
            priceImpactPct: 0.0035,
            routePlan: [],
          }
        : {
            inputMint: settlementMint,
            outputMint: settlementMint,
            inAmount: quantityAtomic,
            outAmount: quantityAtomic,
            priceImpactPct: 0,
            routePlan: [],
          },
    refreshed: false,
    lastValidBlockHeight: null,
    executionMeta: {
      route: input.execution?.adapter ?? input.venueKey,
      classification: "simulated",
      lifecycle: {
        fillState: "pending",
        settlementState: "pending",
        notes: [`research-family:${intent.family}`],
      },
    },
  };
};

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length || 1) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index] as T, index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function buildMarkdownSummary(
  input: Omit<RuntimeStrategyDeskResearchWorkflowResult, "markdownSummary">,
): string {
  const top = input.rankings.slice(0, 3);
  const lines = [
    `# Strategy Desk Research`,
    ``,
    `Prompt: ${input.prompt}`,
    `Run kind: ${input.runKind}`,
    `Generated at: ${input.generatedAt}`,
    `Candidate count: ${input.candidateCount}`,
    ``,
    `## Top Candidates`,
  ];

  for (const result of top) {
    lines.push(
      `- ${result.scenario.title} (${result.scenario.scenarioId})`,
      `  score=${result.metrics.totalScore}, est_net_usd=${formatUsd(
        result.metrics.estimatedNetPnlUsd,
      )}, venues=${Array.from(new Set(result.scenario.legs.map((leg) => leg.venueKey))).join(", ")}`,
    );
  }

  lines.push("", "## All Results");
  for (const result of input.rankings) {
    lines.push(
      `- ${result.scenario.scenarioId}: ${result.blueprintLabel} | total=${result.metrics.totalScore} | prompt_fit=${result.metrics.promptFitScore} | execution=${result.metrics.executionScore} | est_net=${formatUsd(result.metrics.estimatedNetPnlUsd)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function executeRuntimeStrategyDeskResearchWorkflow(
  input: RuntimeStrategyDeskResearchWorkflowInput,
  deps?: StrategyDeskResearchDeps,
): Promise<RuntimeStrategyDeskResearchWorkflowResult> {
  const prompt = String(input.prompt ?? "").trim();
  const requestedBy = String(input.requestedBy ?? "").trim();
  if (!prompt || !requestedBy) {
    throw new Error("runtime-strategy-desk-research-invalid-input");
  }

  const generatedAt = nowIso(deps);
  const runKind = input.runKind ?? "paper";
  const candidateCount = clampInteger(
    input.candidateCount,
    DEFAULT_RESEARCH_CANDIDATE_COUNT,
    1,
    MAX_RESEARCH_CANDIDATE_COUNT,
  );
  const maxConcurrency = clampInteger(
    input.maxConcurrency,
    DEFAULT_MAX_CONCURRENCY,
    1,
    MAX_MAX_CONCURRENCY,
  );
  const promptProfile = buildPromptProfile(prompt);
  const selectedSpotAssets = selectSpotAssets(promptProfile);
  const promptSlug = slugify(input.scenarioPrefix ?? prompt);
  const ownerUserId =
    String(input.ownerUserId ?? requestedBy).trim() || requestedBy;
  const scenarioBlueprints = selectBlueprints(
    promptProfile,
    candidateCount,
  ).map((blueprint, index) =>
    blueprint.buildScenario({
      promptProfile,
      selectedSpotAssets,
      scenarioIndex: index,
      runKind,
      now: generatedAt,
      promptSlug,
      ownerUserId,
    }),
  );

  const scenarios = scenarioBlueprints.map((scenario, index) =>
    buildScenarioManifest({
      scenario,
      scenarioId: `${promptSlug}_${String(index + 1).padStart(2, "0")}_${scenario.blueprintId}`,
      ownerUserId,
      runKind,
      now: generatedAt,
      prompt,
    }),
  );

  for (const scenario of scenarios) {
    await upsertRuntimeStrategyDeskScenarioWorkflow({
      env: input.env,
      scenario,
    });
  }

  const executionDeps: StrategyDeskRunnerDeps = {
    now: deps?.now,
    createId: deps?.createId,
    quoteSpotSwap: deterministicQuoteSpotSwap,
    executeIntentViaRouter: deterministicExecuteIntentViaRouter,
  };

  const walletAddress =
    String(input.walletAddress ?? "").trim() || DEFAULT_WALLET_ADDRESS;

  const results = await mapWithConcurrency(
    scenarios,
    maxConcurrency,
    async (
      scenario,
      index,
    ): Promise<RuntimeStrategyDeskResearchWorkflowScenarioResult> => {
      const executionResult = await executeRuntimeStrategyDeskScenarioWorkflow(
        {
          env: input.env,
          scenarioId: scenario.scenarioId,
          runKind,
          requestedBy,
          walletAddress,
          ...(input.privyWalletId
            ? { privyWalletId: input.privyWalletId }
            : {}),
          ...(typeof input.maxRetriesPerLeg === "number"
            ? { maxRetriesPerLeg: input.maxRetriesPerLeg }
            : {}),
        },
        executionDeps,
      );
      const blueprintScenario = scenarioBlueprints[index];
      const metrics = buildScenarioMetrics({
        scenario: blueprintScenario,
        report: executionResult.report,
        promptProfile,
      });
      return {
        blueprintId: blueprintScenario.blueprintId,
        blueprintLabel:
          BLUEPRINTS.find(
            (blueprint) =>
              blueprint.blueprintId === blueprintScenario.blueprintId,
          )?.label ?? blueprintScenario.blueprintId,
        scenario: executionResult.scenario,
        run: executionResult.run,
        report: executionResult.report,
        metrics,
        keywordMatches: blueprintScenario.keywordMatches,
        rationale: blueprintScenario.rationale,
      };
    },
  );

  const rankings = [...results].sort((left, right) => {
    const scoreDiff = right.metrics.totalScore - left.metrics.totalScore;
    if (scoreDiff !== 0) return scoreDiff;
    return left.scenario.scenarioId.localeCompare(right.scenario.scenarioId);
  });

  const payload = {
    prompt,
    requestedBy,
    runKind,
    generatedAt,
    candidateCount: rankings.length,
    rankings,
  };

  return {
    ...payload,
    markdownSummary: buildMarkdownSummary(payload),
  };
}
