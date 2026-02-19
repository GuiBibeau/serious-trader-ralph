import type {
  AgentStrategy,
  DcaStrategy,
  LoopConfig,
  PredictionMarketStrategy,
  RebalanceStrategy,
  StrategyConfig,
  StrategyRuntimeStateRow,
} from "../types";
import type { StrategyValidationRun } from "./repo";

type DescriptorInput = {
  config: LoopConfig;
  strategy: StrategyConfig;
  runtimeState: StrategyRuntimeStateRow | null;
  latestValidation: StrategyValidationRun | null;
};

export type StrategyConversationDescriptor = {
  headline: string;
  bullets: string[];
};

export type StrategyStateDescriptor = {
  describe(input: DescriptorInput): StrategyConversationDescriptor;
};

const REGISTRY = new Map<string, StrategyStateDescriptor>();

function safeNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(value: unknown, fallback: string): string {
  const next = String(value ?? "").trim();
  return next.length > 0 ? next : fallback;
}

function registerBuiltInDescriptors() {
  registerStrategyDescriptor("dca", {
    describe({ strategy, runtimeState, latestValidation }) {
      const dca = strategy as DcaStrategy;
      const intervalMinutes = safeNumber(dca.everyMinutes, 60);
      const amount = safeString(dca.amount, "0");
      const status = runtimeState?.lifecycleState ?? "candidate";
      const validationStatus = latestValidation?.status ?? "pending";
      const bullets = [
        `direction: ${dca.inputMint} -> ${dca.outputMint}`,
        `every: ${Math.max(1, Math.floor(intervalMinutes))}m`,
        `amount: ${amount}`,
      ];
      if (latestValidation?.metrics) {
        bullets.push(
          `latest validation: ${validationStatus} (${safeNumber(latestValidation.metrics.netReturnPct, 0).toFixed(2)}% net)`,
        );
      }
      if (status !== "candidate") {
        bullets.push(`lifecycle: ${status}`);
      }
      return {
        headline: "DCA strategy",
        bullets,
      };
    },
  });

  registerStrategyDescriptor("rebalance", {
    describe({ strategy, runtimeState, latestValidation }) {
      const rebalance = strategy as RebalanceStrategy;
      const targetBasePct = safeNumber(rebalance.targetBasePct, 0.5) * 100;
      const thresholdPct =
        safeNumber(rebalance.thresholdPct ?? 0.01, 0.01) * 100;
      const status = runtimeState?.lifecycleState ?? "candidate";
      const validationStatus = latestValidation?.status ?? "pending";
      const bullets = [
        `pair: ${rebalance.baseMint}/${rebalance.quoteMint}`,
        `target SOL allocation: ${targetBasePct.toFixed(1)}%`,
        `rebalance threshold: ${thresholdPct.toFixed(3)}%`,
      ];
      if (latestValidation?.metrics) {
        bullets.push(
          `latest validation: ${validationStatus} (${safeNumber(latestValidation.metrics.profitFactor, 0).toFixed(2)} PF)`,
        );
      }
      if (status !== "candidate") {
        bullets.push(`lifecycle: ${status}`);
      }
      return {
        headline: "Rebalance strategy",
        bullets,
      };
    },
  });

  registerStrategyDescriptor("agent", {
    describe({ strategy, runtimeState }) {
      const agent = strategy as AgentStrategy;
      const mandate = safeString(
        (agent as { mandate?: unknown }).mandate,
        "No mandate configured.",
      );
      const status = runtimeState?.lifecycleState ?? "candidate";
      return {
        headline: "Agent strategy",
        bullets: [`mandate: ${mandate}`, `lifecycle: ${status}`],
      };
    },
  });

  registerStrategyDescriptor("prediction_market", {
    describe({ strategy, runtimeState }) {
      const market = strategy as PredictionMarketStrategy;
      return {
        headline: "Prediction-market strategy",
        bullets: [
          `venue: ${safeString(market.venue, "unknown")}`,
          `market: ${safeString(market.marketId, "unknown")}`,
          `side: ${safeString(market.side, "any")}`,
          `max stake: ${safeString(market.maxStakeAtomic, "unset")}`,
          `lifecycle: ${runtimeState?.lifecycleState ?? "candidate"}`,
        ],
      };
    },
  });
}

registerBuiltInDescriptors();

export function registerStrategyDescriptor(
  strategyType: string,
  descriptor: StrategyStateDescriptor,
): void {
  const key = String(strategyType || "").trim();
  if (!key) throw new Error("invalid-strategy-descriptor-type");
  REGISTRY.set(key, descriptor);
}

export function describeStrategyState(input: {
  strategy: StrategyConfig;
  config: LoopConfig;
  runtimeState: StrategyRuntimeStateRow | null;
  latestValidation: StrategyValidationRun | null;
}): StrategyConversationDescriptor {
  const descriptor = REGISTRY.get(input.strategy.type);
  if (!descriptor) {
    return {
      headline: `Strategy: ${input.strategy.type}`,
      bullets: [
        `strategy type: ${input.strategy.type}`,
        `lifecycle: ${input.runtimeState?.lifecycleState ?? "candidate"}`,
        `config keys: ${Object.keys(input.config).length}`,
      ],
    };
  }
  return descriptor.describe(input);
}
