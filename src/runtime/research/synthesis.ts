import { createHash } from "node:crypto";
import {
  parseRuntimeResearchHypothesisRecord,
  parseRuntimeStrategySpec,
  type RuntimeResearchHypothesisRecord,
  type RuntimeStrategySpec,
  type RuntimeVenueMarketType,
} from "../contracts/autonomous_runtime.js";
import type {
  RuntimeResearchBriefArtifact,
  RuntimeResearchBriefSource,
} from "./briefs.js";

export type RuntimeResearchSynthesisRequest = {
  brief: RuntimeResearchBriefArtifact;
  generatedAt?: string;
  strategyKey?: string;
  title?: string;
  preferredVenueKey?: string;
  preferredAssetKeys?: string[];
  marketType?: RuntimeVenueMarketType;
};

export type RuntimeResearchSynthesisEvaluationPlan = {
  marketType: RuntimeVenueMarketType;
  venueKey: string;
  pairSymbol: string;
  assetKeys: string[];
  datasetRequirements: string[];
  requiredFeatureKeys: string[];
  requiredRegimeKeys: string[];
  backtestPlan: {
    windowMode: "rolling";
    trainingWindowObservations: number;
    testingWindowObservations: number;
    stepObservations: number;
    purgeObservations: number;
    baselineStrategies: string[];
  };
  paperPlan: {
    required: true;
    minPaperRuns: number;
    notes: string[];
  };
  successCriteria: string[];
  failureModes: string[];
};

export type RuntimeResearchImplementationPlan = {
  branchName: string;
  issueTitle: string;
  issueBody: string;
  scaffoldFiles: Array<{
    path: string;
    purpose: string;
  }>;
  testFiles: Array<{
    path: string;
    purpose: string;
  }>;
  validationCommands: string[];
};

export type RuntimeResearchSynthesisArtifact = {
  synthesisId: string;
  generatedAt: string;
  briefId: string;
  briefTitle: string;
  expectedMechanism: string;
  hypothesis: RuntimeResearchHypothesisRecord;
  strategySpecDraft: RuntimeStrategySpec;
  evaluationPlan: RuntimeResearchSynthesisEvaluationPlan;
  implementationPlan: RuntimeResearchImplementationPlan;
  riskNotes: string[];
  citations: Array<{
    sourceId: string;
    title: string;
    canonicalUrl: string;
  }>;
};

type StrategyTemplate = {
  key: string;
  title: string;
  category: RuntimeStrategySpec["category"];
  marketType: RuntimeVenueMarketType;
  mechanism: string;
  summary: string;
  featureRequirements: Array<{
    featureKey: string;
    freshnessMs?: number;
    notes: string;
  }>;
  regimeRequirements: string[];
  parameterSpecs: RuntimeStrategySpec["parameterSpecs"];
  datasetRequirements: string[];
  baselineStrategies: string[];
  successCriteria: string[];
  failureModes: string[];
  riskNotes: string[];
  tags: string[];
};

const SYNTHESIS_TEMPLATES: StrategyTemplate[] = [
  {
    key: "funding_carry",
    title: "Funding carry",
    category: "advanced",
    marketType: "perp",
    mechanism:
      "Harvest persistent funding and basis dislocations while filtering for liquidity and crowding drift.",
    summary:
      "Targets persistent funding or basis dislocations while bounding crowding, liquidity, and execution risk.",
    featureRequirements: [
      {
        featureKey: "funding_rate_bps",
        freshnessMs: 60000,
        notes: "Required to estimate carry persistence across perp venues.",
      },
      {
        featureKey: "basis_bps",
        freshnessMs: 60000,
        notes: "Required to compare perp and spot dislocations.",
      },
      {
        featureKey: "open_interest_delta_bps",
        freshnessMs: 60000,
        notes: "Required to reject crowded carry states.",
      },
    ],
    regimeRequirements: ["liquidity_state", "volatility_band"],
    parameterSpecs: [
      decimalParameter(
        "policy.max_notional_usd",
        "Max notional USD",
        "25",
        "0.01",
        undefined,
        "Upper bound for any single carry deployment.",
      ),
      bpsParameter(
        "policy.max_slippage_bps",
        "Max slippage bps",
        "40",
        "1",
        "200",
        "Execution slippage ceiling for carry entries and exits.",
      ),
      bpsParameter(
        "signal.min_funding_edge_bps",
        "Min funding edge bps",
        "8",
        "1",
        "100",
        "Minimum modeled carry edge needed before opening exposure.",
      ),
    ],
    datasetRequirements: [
      "perp funding history",
      "perp open interest history",
      "paired spot and perp quote history",
    ],
    baselineStrategies: ["buy_and_hold", "flat", "trend_following"],
    successCriteria: [
      "Outperforms flat and buy-and-hold after modeled fees, slippage, and financing.",
      "Remains profitable across multiple walk-forward windows rather than a single regime.",
      "Shows bounded drawdown during funding reversals and liquidation cascades.",
    ],
    failureModes: [
      "Funding mean reverts faster than entry latency allows.",
      "Carry disappears once fees and financing costs are fully modeled.",
      "Liquidity thins during stress and turns exits into forced losses.",
    ],
    riskNotes: [
      "Perp strategies require new venue and feature coverage before shadow activation.",
      "Do not promote past draft until perp execution and reconciliation are explicitly proven.",
    ],
    tags: ["candidate", "advanced", "perp"],
  },
  {
    key: "mean_reversion",
    title: "Mean reversion",
    category: "signal",
    marketType: "spot",
    mechanism:
      "Fade short-horizon dislocations that revert once spread, volatility, and liquidity normalize.",
    summary:
      "Fades short-lived dislocations when spread, volatility, and liquidity conditions support a reversion thesis.",
    featureRequirements: [
      {
        featureKey: "short_return_bps",
        freshnessMs: 20000,
        notes: "Measures the dislocation that the strategy attempts to fade.",
      },
      {
        featureKey: "spread_bps",
        freshnessMs: 20000,
        notes: "Rejects reversion entries when spreads are already too wide.",
      },
      {
        featureKey: "realized_volatility_bps",
        freshnessMs: 20000,
        notes: "Distinguishes orderly pullbacks from unstable breakdowns.",
      },
    ],
    regimeRequirements: ["volatility_band", "liquidity_state"],
    parameterSpecs: [
      decimalParameter(
        "policy.max_notional_usd",
        "Max notional USD",
        "25",
        "0.01",
        undefined,
        "Upper bound for any single reversion entry.",
      ),
      bpsParameter(
        "signal.entry_zscore_bps",
        "Entry z-score bps",
        "35",
        "5",
        "200",
        "Minimum dislocation needed before fading the move.",
      ),
      bpsParameter(
        "signal.stop_loss_bps",
        "Stop loss bps",
        "45",
        "5",
        "250",
        "Exit threshold when the reversion thesis fails.",
      ),
    ],
    datasetRequirements: [
      "top-of-book replay history",
      "mid-price history",
      "trade print history",
    ],
    baselineStrategies: ["buy_and_hold", "flat", "trend_following"],
    successCriteria: [
      "Produces positive edge after costs across multiple walk-forward windows.",
      "Maintains win-rate and payoff stability across volatility regimes.",
      "Does not rely on a single outsized reversal event.",
    ],
    failureModes: [
      "Dislocations are momentum, not noise, so the fade keeps losing.",
      "Execution costs erase the mean-reversion edge.",
      "Wide spreads make entry and exit assumptions unrealistic.",
    ],
    riskNotes: [
      "Mean-reversion candidates need explicit spread and volatility guards before paper mode.",
    ],
    tags: ["candidate", "signal", "mean-reversion"],
  },
  {
    key: "breakout",
    title: "Breakout",
    category: "advanced",
    marketType: "spot",
    mechanism:
      "Enter only when returns and volatility expand together and liquidity confirms a genuine regime break.",
    summary:
      "Captures directional breaks that persist after volatility expansion and liquidity confirmation.",
    featureRequirements: [
      {
        featureKey: "long_return_bps",
        freshnessMs: 20000,
        notes: "Measures the directional break the strategy follows.",
      },
      {
        featureKey: "realized_volatility_bps",
        freshnessMs: 20000,
        notes: "Confirms that the move is accompanied by expanding activity.",
      },
      {
        featureKey: "spread_bps",
        freshnessMs: 20000,
        notes:
          "Rejects entries when breakout conditions are purely spread-driven.",
      },
    ],
    regimeRequirements: ["long_trend", "volatility_band"],
    parameterSpecs: [
      decimalParameter(
        "policy.max_notional_usd",
        "Max notional USD",
        "25",
        "0.01",
        undefined,
        "Upper bound for any single breakout entry.",
      ),
      bpsParameter(
        "signal.breakout_threshold_bps",
        "Breakout threshold bps",
        "40",
        "5",
        "250",
        "Minimum directional move needed before entering the breakout.",
      ),
      integerParameter(
        "signal.confirmation_windows",
        "Confirmation windows",
        "3",
        "1",
        "12",
        "Number of windows that must confirm the breakout before entry.",
      ),
    ],
    datasetRequirements: [
      "top-of-book replay history",
      "mid-price history",
      "volatility regime history",
    ],
    baselineStrategies: ["buy_and_hold", "flat", "trend_following"],
    successCriteria: [
      "Shows positive modeled edge after fees and slippage in rolling windows.",
      "Keeps false-breakout loss clusters bounded by stop discipline.",
      "Retains signal under both high and moderate volatility regimes.",
    ],
    failureModes: [
      "Breakouts fail quickly and turn into mean-reversion traps.",
      "Signal triggers only during illiquid periods where fills are unrealistic.",
      "The edge disappears when confirmation latency is modeled honestly.",
    ],
    riskNotes: [
      "Breakout candidates need strong false-break filters before paper activation.",
    ],
    tags: ["candidate", "advanced", "breakout"],
  },
  {
    key: "macro_rotation",
    title: "Macro rotation",
    category: "allocation",
    marketType: "spot",
    mechanism:
      "Rotate capital between assets when longer-horizon return and volatility regimes indicate persistent leadership change.",
    summary:
      "Rotates allocation between candidate assets when medium-horizon regimes imply durable leadership change.",
    featureRequirements: [
      {
        featureKey: "long_return_bps",
        freshnessMs: 60000,
        notes: "Measures medium-horizon leadership persistence.",
      },
      {
        featureKey: "realized_volatility_bps",
        freshnessMs: 60000,
        notes: "Controls portfolio turnover during unstable conditions.",
      },
    ],
    regimeRequirements: ["long_trend", "volatility_band"],
    parameterSpecs: [
      integerParameter(
        "policy.rebalance_interval_minutes",
        "Rebalance interval minutes",
        "60",
        "5",
        "1440",
        "Minimum time between portfolio rotation events.",
      ),
      bpsParameter(
        "policy.max_position_weight_bps",
        "Max position weight bps",
        "5000",
        "100",
        "10000",
        "Maximum concentration allowed for any single asset.",
      ),
      bpsParameter(
        "policy.max_turnover_bps",
        "Max turnover bps",
        "1500",
        "100",
        "10000",
        "Turnover ceiling for each rebalance cycle.",
      ),
    ],
    datasetRequirements: [
      "multi-asset return history",
      "volatility regime history",
      "rebalance and turnover history",
    ],
    baselineStrategies: ["equal_weight", "buy_and_hold", "flat"],
    successCriteria: [
      "Beats equal-weight after turnover and cost penalties.",
      "Does not concentrate capital into a single unstable asset.",
      "Remains stable across expanding and contracting volatility regimes.",
    ],
    failureModes: [
      "Leadership rotates too quickly and turnover destroys returns.",
      "A single asset dominates the signal and breaks diversification assumptions.",
      "Allocation changes are too sparse to justify additional complexity.",
    ],
    riskNotes: [
      "Allocation candidates need explicit capital-allocation review before paper mode.",
    ],
    tags: ["candidate", "allocation"],
  },
  {
    key: "trend_following",
    title: "Trend following",
    category: "signal",
    marketType: "spot",
    mechanism:
      "Follow persistent directional return regimes when both short and longer windows align and liquidity remains stable.",
    summary:
      "Follows persistent directional moves when short and longer return windows align under acceptable liquidity conditions.",
    featureRequirements: [
      {
        featureKey: "short_return_bps",
        freshnessMs: 20000,
        notes: "Measures immediate directional persistence.",
      },
      {
        featureKey: "long_return_bps",
        freshnessMs: 20000,
        notes: "Confirms higher-level direction before entering.",
      },
      {
        featureKey: "realized_volatility_bps",
        freshnessMs: 20000,
        notes: "Avoids trend entries when volatility is already disordered.",
      },
    ],
    regimeRequirements: ["short_trend", "long_trend"],
    parameterSpecs: [
      decimalParameter(
        "policy.max_notional_usd",
        "Max notional USD",
        "25",
        "0.01",
        undefined,
        "Upper bound for any single trend entry.",
      ),
      bpsParameter(
        "signal.entry_threshold_bps",
        "Entry threshold bps",
        "20",
        "1",
        "200",
        "Minimum momentum needed before entering the trend.",
      ),
      bpsParameter(
        "signal.exit_threshold_bps",
        "Exit threshold bps",
        "8",
        "1",
        "100",
        "Momentum decay threshold for exiting the position.",
      ),
    ],
    datasetRequirements: [
      "mid-price history",
      "top-of-book replay history",
      "volatility regime history",
    ],
    baselineStrategies: ["buy_and_hold", "flat", "mean_reversion"],
    successCriteria: [
      "Outperforms flat and mean-reversion baselines after modeled costs.",
      "Retains positive edge across multiple walk-forward windows.",
      "Shows bounded drawdown in volatility spikes and fast reversals.",
    ],
    failureModes: [
      "Momentum decays before execution can capture it.",
      "Trend signals are actually mean-reverting after costs.",
      "Volatility spikes turn entries into late chases.",
    ],
    riskNotes: [
      "Trend candidates still need fresh-feature guarantees before shadow activation.",
    ],
    tags: ["candidate", "signal", "trend"],
  },
];

export function parseRuntimeResearchSynthesisRequest(
  input: unknown,
): RuntimeResearchSynthesisRequest {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-synthesis-request");
  }

  const brief = parseRuntimeResearchBriefArtifact(input.brief);
  const generatedAt = readOptionalString(input.generatedAt);
  const strategyKey = readOptionalString(input.strategyKey);
  const title = readOptionalString(input.title);
  const preferredVenueKey = readOptionalString(input.preferredVenueKey);
  const preferredAssetKeys = normalizeStringArray(input.preferredAssetKeys);
  const marketType = parseVenueMarketType(input.marketType);

  return {
    brief,
    ...(generatedAt ? { generatedAt } : {}),
    ...(strategyKey ? { strategyKey } : {}),
    ...(title ? { title } : {}),
    ...(preferredVenueKey ? { preferredVenueKey } : {}),
    ...(preferredAssetKeys.length > 0 ? { preferredAssetKeys } : {}),
    ...(marketType ? { marketType } : {}),
  };
}

export function buildRuntimeResearchSynthesis(input: {
  request: RuntimeResearchSynthesisRequest;
}): RuntimeResearchSynthesisArtifact {
  const generatedAt = new Date(
    input.request.generatedAt ?? new Date().toISOString(),
  ).toISOString();
  const brief = input.request.brief;
  const aggregate = collectBriefContext(brief);
  const template = selectStrategyTemplate(aggregate.text);
  const venueKey =
    input.request.preferredVenueKey ??
    mostCommonValue(aggregate.venueKeys) ??
    "jupiter";
  const marketType = input.request.marketType ?? template.marketType;
  const assetKeys = normalizeAssetKeys(
    input.request.preferredAssetKeys ?? aggregate.assetKeys,
  );
  const pairSymbol = buildPairSymbol(assetKeys);
  const strategyKey =
    input.request.strategyKey ??
    buildCandidateStrategyKey({
      templateKey: template.key,
      venueKey,
      pairSymbol,
    });
  const title = input.request.title?.trim() || template.title;
  const hypothesis = parseRuntimeResearchHypothesisRecord({
    schemaVersion: "v1",
    hypothesisId: `hypothesis_${slugify(strategyKey)}`,
    strategyKey,
    title,
    thesis: buildHypothesisThesis(template, brief),
    status: "candidate",
    createdAt: generatedAt,
    updatedAt: generatedAt,
    venueKeys: [venueKey],
    assetKeys,
    sourceCitations: brief.citations.map((citation) => ({
      sourceId: citation.sourceId,
      materialDigest: citation.materialDigest,
      ...(citation.notes ? { notes: citation.notes } : {}),
    })),
    tags: uniqueStrings(["candidate", ...template.tags]).slice(0, 16),
  });
  const strategySpecDraft = parseRuntimeStrategySpec({
    schemaVersion: "v1",
    strategyKey,
    title,
    summary: buildStrategySummary(template, brief),
    category: template.category,
    pluginKey: `candidate::${slugify(strategyKey)}`,
    defaultLane: "safe",
    supportedModes: ["shadow", "paper"],
    laneEligibility: ["safe"],
    supportedVenues: [
      {
        venueKey,
        onboardingState: marketType === "perp" ? "candidate" : "paper_ready",
        notes:
          marketType === "perp"
            ? "Perp-oriented candidate requires new venue readiness proof before shadow activation."
            : "Candidate remains bounded to shadow and paper until later promotion gates are cleared.",
      },
    ],
    assetConstraints: buildAssetConstraints(assetKeys),
    featureRequirements: template.featureRequirements.map((requirement) => ({
      featureKey: requirement.featureKey,
      required: true,
      ...(requirement.freshnessMs
        ? { freshnessMs: requirement.freshnessMs }
        : {}),
      notes: requirement.notes,
    })),
    regimeRequirements: template.regimeRequirements,
    parameterSpecs: template.parameterSpecs,
    promotionPolicy: {
      requiresHumanApproval: true,
      shadowMinRuns: 5,
      paperMinRuns: 7,
      liveLaneAllowlist: ["safe"],
      requiresFreshFeatures: true,
      limitedLiveOnly: true,
      notes:
        "Candidate synthesis stays bounded to draft and later shadow/paper gates until explicit human review.",
    },
    tags: uniqueStrings([
      ...template.tags,
      marketType,
      venueKey,
      pairSymbol.replace("/", "_").toLowerCase(),
    ]).slice(0, 16),
  });

  const evaluationPlan: RuntimeResearchSynthesisEvaluationPlan = {
    marketType,
    venueKey,
    pairSymbol,
    assetKeys,
    datasetRequirements: template.datasetRequirements,
    requiredFeatureKeys: template.featureRequirements.map(
      (requirement) => requirement.featureKey,
    ),
    requiredRegimeKeys: template.regimeRequirements,
    backtestPlan: {
      windowMode: "rolling",
      trainingWindowObservations: marketType === "perp" ? 4320 : 2880,
      testingWindowObservations: marketType === "perp" ? 720 : 480,
      stepObservations: marketType === "perp" ? 180 : 120,
      purgeObservations: marketType === "perp" ? 60 : 30,
      baselineStrategies: template.baselineStrategies,
    },
    paperPlan: {
      required: true,
      minPaperRuns: 7,
      notes: [
        "Keep the candidate in paper until replay, cost, and scorecard evidence stay stable across the full paper window.",
        marketType === "perp"
          ? "Perp candidates require explicit venue readiness and reconciliation checks before any limited-live discussion."
          : "Spot candidates still require spread and liquidity verification before limited-live discussion.",
      ],
    },
    successCriteria: template.successCriteria,
    failureModes: template.failureModes,
  };

  const implementationPlan = buildImplementationPlan({
    brief,
    hypothesis,
    strategySpecDraft,
    evaluationPlan,
  });
  const synthesisId = `synthesis_${sha256Hex(
    JSON.stringify({
      briefId: brief.briefId,
      hypothesisId: hypothesis.hypothesisId,
      strategyKey,
      generatedAt,
    }),
  ).slice(0, 20)}`;

  return {
    synthesisId,
    generatedAt,
    briefId: brief.briefId,
    briefTitle: brief.title,
    expectedMechanism: template.mechanism,
    hypothesis,
    strategySpecDraft,
    evaluationPlan,
    implementationPlan,
    riskNotes: template.riskNotes,
    citations: brief.sources.map((source) => ({
      sourceId: source.sourceId,
      title: source.title,
      canonicalUrl: source.canonicalUrl,
    })),
  };
}

export function buildRuntimeResearchSynthesisMarkdown(
  synthesis: RuntimeResearchSynthesisArtifact,
): string {
  const lines = [
    `# ${synthesis.hypothesis.title}`,
    "",
    `- Synthesis id: ${synthesis.synthesisId}`,
    `- Generated at: ${synthesis.generatedAt}`,
    `- Brief id: ${synthesis.briefId}`,
    `- Strategy key: ${synthesis.hypothesis.strategyKey}`,
    `- Market type: ${synthesis.evaluationPlan.marketType}`,
    `- Venue: ${synthesis.evaluationPlan.venueKey}`,
    `- Pair: ${synthesis.evaluationPlan.pairSymbol}`,
    "",
    "## Hypothesis",
    "",
    synthesis.hypothesis.thesis,
    "",
    "## Expected Mechanism",
    "",
    synthesis.expectedMechanism,
    "",
    "## Required Features",
    "",
  ];

  for (const featureKey of synthesis.evaluationPlan.requiredFeatureKeys) {
    lines.push(`- ${featureKey}`);
  }

  lines.push("", "## Failure Modes", "");
  for (const failureMode of synthesis.evaluationPlan.failureModes) {
    lines.push(`- ${failureMode}`);
  }

  lines.push("", "## Implementation Plan", "");
  for (const scaffold of synthesis.implementationPlan.scaffoldFiles) {
    lines.push(`- ${scaffold.path}: ${scaffold.purpose}`);
  }

  lines.push(
    "",
    "## Candidate Issue",
    "",
    synthesis.implementationPlan.issueTitle,
    "",
  );
  lines.push(synthesis.implementationPlan.issueBody, "");

  lines.push("## Citations", "");
  for (const citation of synthesis.citations) {
    lines.push(`- ${citation.title}`, `  ${citation.canonicalUrl}`);
  }

  return lines.join("\n");
}

function buildImplementationPlan(input: {
  brief: RuntimeResearchBriefArtifact;
  hypothesis: RuntimeResearchHypothesisRecord;
  strategySpecDraft: RuntimeStrategySpec;
  evaluationPlan: RuntimeResearchSynthesisEvaluationPlan;
}): RuntimeResearchImplementationPlan {
  const issueTitle = `[Candidate] ${input.hypothesis.title}`;
  const branchName = `codex/${slugify(input.hypothesis.strategyKey)}`;
  const issueBody = buildCandidateIssueBody(input);

  return {
    branchName,
    issueTitle,
    issueBody,
    scaffoldFiles: [
      {
        path: "apps/worker/src/runtime_research_synthesis.ts",
        purpose:
          "Keep synthesis output compatible with the Worker-hosted research contract.",
      },
      {
        path: "apps/worker/src/execution/router.ts",
        purpose:
          "Add execution-routing logic or bounded stubs if the candidate affects terminal execution.",
      },
      {
        path: "src/runtime/contracts/autonomous_runtime.ts",
        purpose:
          "Update shared contract parsing if the candidate introduces new fields.",
      },
      {
        path: "docs/runtime-contracts/fixtures/runtime.strategy_spec.valid.v1.json",
        purpose:
          "Add or update fixture coverage if the candidate introduces new StrategySpec fields or shapes.",
      },
    ],
    testFiles: [
      {
        path: "tests/unit/runtime_research_synthesis.test.ts",
        purpose:
          "Protect synthesis behavior for Worker-hosted research payloads.",
      },
      {
        path: "tests/unit/runtime_protocol_contracts.test.ts",
        purpose:
          "Protect shared contract expectations for any synthesis-produced StrategySpec changes.",
      },
      {
        path: "tests/unit/worker_runtime_internal_routes.test.ts",
        purpose:
          "Exercise Worker and runtime bridge behavior if new internal routes or payloads are added.",
      },
    ],
    validationCommands: [
      "bun run lint",
      "bun run typecheck",
      "bun run test:unit",
      "bun run test:e2e",
    ],
  };
}

function buildCandidateIssueBody(input: {
  brief: RuntimeResearchBriefArtifact;
  hypothesis: RuntimeResearchHypothesisRecord;
  strategySpecDraft: RuntimeStrategySpec;
  evaluationPlan: RuntimeResearchSynthesisEvaluationPlan;
}): string {
  const sourceLines = input.brief.sources
    .slice(0, 5)
    .map((source) => `- ${source.title}: ${source.canonicalUrl}`);

  return [
    "## Problem",
    `Research brief \`${input.brief.briefId}\` suggests a candidate worth evaluating, but there is no repo-owned implementation slice for \`${input.hypothesis.strategyKey}\` yet.`,
    "",
    "## Outcome",
    `A PR-sized draft implementation for \`${input.hypothesis.strategyKey}\` exists with replay or backtest coverage, explicit failure modes, and a path to shadow validation.`,
    "",
    "## Scope",
    `- Add a draft StrategySpec for \`${input.hypothesis.strategyKey}\`.`,
    `- Implement the smallest evaluation slice needed for ${input.evaluationPlan.marketType} ${input.evaluationPlan.pairSymbol} on ${input.evaluationPlan.venueKey}.`,
    `- Add replay or backtest coverage tied to the candidate evaluation plan.`,
    `- Keep the candidate bounded to draft or shadow-safe behavior only.`,
    "",
    "## Acceptance Criteria",
    `- Hypothesis, mechanism, features, parameters, and failure modes are explicit for \`${input.hypothesis.strategyKey}\`.`,
    `- Replay or backtest coverage exists for ${input.evaluationPlan.pairSymbol}.`,
    `- The candidate does not widen money-state controls or bypass later promotion gates.`,
    `- The PR includes citations back to brief \`${input.brief.briefId}\`.`,
    "",
    "## Evaluation Plan",
    `- Market type: ${input.evaluationPlan.marketType}`,
    `- Venue: ${input.evaluationPlan.venueKey}`,
    `- Pair: ${input.evaluationPlan.pairSymbol}`,
    `- Required features: ${input.evaluationPlan.requiredFeatureKeys.join(", ")}`,
    `- Required regimes: ${input.evaluationPlan.requiredRegimeKeys.join(", ") || "none"}`,
    "",
    "## Source Material",
    ...sourceLines,
  ].join("\n");
}

function buildHypothesisThesis(
  template: StrategyTemplate,
  brief: RuntimeResearchBriefArtifact,
): string {
  const finding = brief.findings[0] ?? brief.summary;
  return `${template.mechanism} Research brief ${brief.briefId} indicates: ${finding}`;
}

function buildStrategySummary(
  template: StrategyTemplate,
  brief: RuntimeResearchBriefArtifact,
): string {
  return `${template.summary} Derived from research brief ${brief.briefId}: ${brief.summary}`;
}

function collectBriefContext(brief: RuntimeResearchBriefArtifact) {
  const venueKeys = brief.sources.flatMap((source) => source.venueKeys);
  const assetKeys = brief.sources.flatMap((source) => source.assetKeys);
  const text = [
    brief.title,
    brief.summary,
    ...brief.findings,
    ...brief.sources.flatMap((source) => [source.title, ...source.tags]),
  ]
    .join(" ")
    .toLowerCase();
  return {
    venueKeys,
    assetKeys,
    text,
  };
}

function selectStrategyTemplate(text: string): StrategyTemplate {
  if (includesAny(text, ["funding", "basis", "carry", "perp", "perpetual"])) {
    return templateByKey("funding_carry");
  }
  if (includesAny(text, ["mean reversion", "reversion", "contrarian"])) {
    return templateByKey("mean_reversion");
  }
  if (includesAny(text, ["breakout", "volatility expansion"])) {
    return templateByKey("breakout");
  }
  if (includesAny(text, ["allocation", "rotation", "portfolio"])) {
    return templateByKey("macro_rotation");
  }
  if (includesAny(text, ["momentum", "trend", "continuation"])) {
    return templateByKey("trend_following");
  }
  return templateByKey("trend_following");
}

function templateByKey(key: string): StrategyTemplate {
  const template = SYNTHESIS_TEMPLATES.find(
    (candidate) => candidate.key === key,
  );
  if (!template) {
    throw new Error(`runtime-research-synthesis-template-missing:${key}`);
  }
  return template;
}

function buildCandidateStrategyKey(input: {
  templateKey: string;
  venueKey: string;
  pairSymbol: string;
}): string {
  return `${slugify(input.templateKey)}_${slugify(input.venueKey)}_${slugify(
    input.pairSymbol.replace("/", "_"),
  )}_candidate`;
}

function buildAssetConstraints(
  assetKeys: string[],
): RuntimeStrategySpec["assetConstraints"] {
  const quoteAssetKeys = assetKeys.includes("USDC")
    ? ["USDC"]
    : [assetKeys.at(-1) ?? "USDC"];
  const baseAssetKeys = assetKeys.filter(
    (assetKey) => !quoteAssetKeys.includes(assetKey),
  );
  return [
    {
      role: "base",
      assetKeys: baseAssetKeys,
      required: true,
      notes:
        "Base assets are derived from the synthesized research brief and may be narrowed further during implementation.",
    },
    {
      role: "quote",
      assetKeys: quoteAssetKeys,
      required: true,
      notes:
        "The quote leg should stay stable until allocator and risk rules are reviewed.",
    },
  ];
}

function buildPairSymbol(assetKeys: string[]): string {
  const quoteAsset = assetKeys.includes("USDC")
    ? "USDC"
    : (assetKeys.at(-1) ?? "USDC");
  const baseAsset =
    assetKeys.find((assetKey) => assetKey !== quoteAsset) ?? "SOL";
  return `${baseAsset}/${quoteAsset}`;
}

function normalizeAssetKeys(assetKeys: string[]): string[] {
  const normalized = uniqueStrings(
    assetKeys
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 4),
  );
  if (normalized.length === 0) {
    return ["SOL", "USDC"];
  }
  if (normalized.length === 1 && normalized[0] !== "USDC") {
    return [normalized[0], "USDC"];
  }
  if (!normalized.includes("USDC")) {
    return [...normalized, "USDC"];
  }
  return normalized;
}

function parseRuntimeResearchBriefArtifact(
  input: unknown,
): RuntimeResearchBriefArtifact {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-brief");
  }
  const briefId = readRequiredString(input.briefId, "briefId");
  const generatedAt = new Date(
    readRequiredString(input.generatedAt, "generatedAt"),
  ).toISOString();
  const profile =
    input.profile === "latest_strategy_papers" || input.profile === "custom"
      ? input.profile
      : (() => {
          throw new Error("invalid-runtime-research-brief-profile");
        })();
  const title = readRequiredString(input.title, "title");
  const summary = readRequiredString(input.summary, "summary");
  const findings = normalizeStringArray(input.findings);
  const approvedHosts = normalizeStringArray(input.approvedHosts);
  const requestCount = readRequiredNumber(input.requestCount, "requestCount");
  const sourceCount = readRequiredNumber(input.sourceCount, "sourceCount");
  const createdCount = readRequiredNumber(input.createdCount, "createdCount");
  const existingCount = readRequiredNumber(
    input.existingCount,
    "existingCount",
  );
  const citations = Array.isArray(input.citations)
    ? input.citations.map(parseCitation)
    : [];
  const sources = Array.isArray(input.sources)
    ? input.sources.map(parseBriefSource)
    : [];

  return {
    briefId,
    generatedAt,
    profile,
    title,
    summary,
    findings,
    approvedHosts,
    requestCount,
    sourceCount,
    createdCount,
    existingCount,
    citations,
    sources,
  };
}

function parseCitation(input: unknown) {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-citation");
  }
  return {
    sourceId: readRequiredString(input.sourceId, "citation.sourceId"),
    materialDigest: readRequiredString(
      input.materialDigest,
      "citation.materialDigest",
    ),
    ...(readOptionalString(input.notes)
      ? { notes: readOptionalString(input.notes) }
      : {}),
  };
}

function parseBriefSource(input: unknown): RuntimeResearchBriefSource {
  if (!isRecord(input)) {
    throw new Error("invalid-runtime-research-brief-source");
  }
  return {
    sourceId: readRequiredString(input.sourceId, "sourceId"),
    sourceKind: parseSourceKind(input.sourceKind),
    title: readRequiredString(input.title, "title"),
    url: readRequiredString(input.url, "url"),
    canonicalUrl: readRequiredString(input.canonicalUrl, "canonicalUrl"),
    authors: normalizeStringArray(input.authors),
    ...(readOptionalString(input.publishedAt)
      ? {
          publishedAt: new Date(
            readRequiredString(input.publishedAt, "publishedAt"),
          ).toISOString(),
        }
      : {}),
    retrievedAt: new Date(
      readRequiredString(input.retrievedAt, "retrievedAt"),
    ).toISOString(),
    venueKeys: normalizeStringArray(input.venueKeys),
    assetKeys: normalizeStringArray(input.assetKeys).map((value) =>
      value.toUpperCase(),
    ),
    tags: normalizeStringArray(input.tags),
    digest: readRequiredString(input.digest, "digest"),
  };
}

function parseSourceKind(
  input: unknown,
): RuntimeResearchBriefSource["sourceKind"] {
  switch (input) {
    case "paper":
    case "article":
    case "repository":
    case "dataset":
    case "notebook":
    case "internal_note":
    case "market_report":
      return input;
    default:
      throw new Error("invalid-runtime-research-source-kind");
  }
}

function parseVenueMarketType(
  input: unknown,
): RuntimeVenueMarketType | undefined {
  switch (input) {
    case "spot":
    case "perp":
    case "options":
      return input;
    default:
      return undefined;
  }
}

function decimalParameter(
  key: string,
  label: string,
  defaultValue: string,
  minValue: string,
  maxValue: string | undefined,
  notes: string,
): RuntimeStrategySpec["parameterSpecs"][number] {
  return {
    key,
    label,
    kind: "decimal",
    required: true,
    defaultValue,
    minValue,
    ...(maxValue ? { maxValue } : {}),
    allowedValues: [],
    notes,
  };
}

function integerParameter(
  key: string,
  label: string,
  defaultValue: string,
  minValue: string,
  maxValue: string | undefined,
  notes: string,
): RuntimeStrategySpec["parameterSpecs"][number] {
  return {
    key,
    label,
    kind: "integer",
    required: true,
    defaultValue,
    minValue,
    ...(maxValue ? { maxValue } : {}),
    allowedValues: [],
    notes,
  };
}

function bpsParameter(
  key: string,
  label: string,
  defaultValue: string,
  minValue: string,
  maxValue: string | undefined,
  notes: string,
): RuntimeStrategySpec["parameterSpecs"][number] {
  return {
    key,
    label,
    kind: "bps",
    required: true,
    defaultValue,
    minValue,
    ...(maxValue ? { maxValue } : {}),
    allowedValues: [],
    notes,
  };
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function readOptionalString(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const value = input.trim();
  return value || undefined;
}

function readRequiredString(input: unknown, field: string): string {
  const value = readOptionalString(input);
  if (!value) {
    throw new Error(`invalid-runtime-research-synthesis-${field}`);
  }
  return value;
}

function readRequiredNumber(input: unknown, field: string): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new Error(`invalid-runtime-research-synthesis-${field}`);
  }
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function mostCommonValue(values: string[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  })[0]?.[0];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
