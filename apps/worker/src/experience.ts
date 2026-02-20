export type ExperienceLevel = "beginner" | "intermediate" | "pro" | "degen";
export type LevelSource = "auto" | "manual";

export type GoalPrimary =
  | "preserve_capital"
  | "grow_steadily"
  | "learn_active_trading"
  | "high_risk_opportunities";

export type TimeHorizon = "short" | "medium" | "long";
export type LossTolerance = "lt_10" | "10_25" | "gt_25";
export type MarketBehavior = "buy_dip" | "hold" | "reduce_risk" | "panic_exit";

export type LiteracyAnswer = "A" | "B" | "C" | "D";

export type RiskBand = "conservative" | "balanced" | "aggressive";

export type OnboardingInput = {
  goalPrimary: GoalPrimary;
  timeHorizon: TimeHorizon;
  lossTolerance: LossTolerance;
  literacyAnswers: {
    q1: LiteracyAnswer;
    q2: LiteracyAnswer;
    q3: LiteracyAnswer;
  };
  marketBehavior: MarketBehavior;
};

export type FeedSeedThemes = {
  stable_yield: number;
  btc_eth_momentum: number;
  active_swing: number;
  high_beta_alt: number;
};

export type FeedSeed = {
  themes: FeedSeedThemes;
  riskBand: RiskBand;
  levelAtOnboarding: ExperienceLevel;
  version: 1;
};

export type ConsumerProfileStored = {
  goalPrimary: GoalPrimary;
  riskBand: RiskBand;
  timeHorizon: TimeHorizon;
  lossTolerance: LossTolerance;
  marketBehavior: MarketBehavior;
  literacyAnswers: {
    q1: LiteracyAnswer;
    q2: LiteracyAnswer;
    q3: LiteracyAnswer;
  };
  literacyScore: number;
  feedSeed: FeedSeed;
  completedAt: string;
};

export type ConsumerProfileSummary = {
  goalPrimary: GoalPrimary;
  riskBand: RiskBand;
  timeHorizon: TimeHorizon;
  literacyScore: number;
  feedSeedVersion: number;
};

export type ExperienceView = {
  level: ExperienceLevel;
  levelSource: LevelSource;
  onboardingCompleted: boolean;
  onboardingCompletedAt: string | null;
  onboardingVersion: number;
};

const GOAL_SET = new Set<GoalPrimary>([
  "preserve_capital",
  "grow_steadily",
  "learn_active_trading",
  "high_risk_opportunities",
]);
const TIME_HORIZON_SET = new Set<TimeHorizon>(["short", "medium", "long"]);
const LOSS_TOLERANCE_SET = new Set<LossTolerance>(["lt_10", "10_25", "gt_25"]);
const MARKET_BEHAVIOR_SET = new Set<MarketBehavior>([
  "buy_dip",
  "hold",
  "reduce_risk",
  "panic_exit",
]);
const LITERACY_SET = new Set<LiteracyAnswer>(["A", "B", "C", "D"]);
const LEVEL_SET = new Set<ExperienceLevel>([
  "beginner",
  "intermediate",
  "pro",
  "degen",
]);
const LEVEL_SOURCE_SET = new Set<LevelSource>(["auto", "manual"]);

const CORRECT_LITERACY_ANSWERS: Record<
  keyof OnboardingInput["literacyAnswers"],
  LiteracyAnswer
> = {
  q1: "C",
  q2: "B",
  q3: "D",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeThemeTotals(themes: FeedSeedThemes): FeedSeedThemes {
  const rawValues = {
    stable_yield: Math.max(0, themes.stable_yield),
    btc_eth_momentum: Math.max(0, themes.btc_eth_momentum),
    active_swing: Math.max(0, themes.active_swing),
    high_beta_alt: Math.max(0, themes.high_beta_alt),
  } as FeedSeedThemes;

  const total =
    rawValues.stable_yield +
    rawValues.btc_eth_momentum +
    rawValues.active_swing +
    rawValues.high_beta_alt;
  if (total <= 0) {
    return {
      stable_yield: 0.25,
      btc_eth_momentum: 0.25,
      active_swing: 0.25,
      high_beta_alt: 0.25,
    };
  }

  const rounded = {
    stable_yield: Number((rawValues.stable_yield / total).toFixed(3)),
    btc_eth_momentum: Number((rawValues.btc_eth_momentum / total).toFixed(3)),
    active_swing: Number((rawValues.active_swing / total).toFixed(3)),
    high_beta_alt: Number((rawValues.high_beta_alt / total).toFixed(3)),
  } as FeedSeedThemes;

  const remainder = Number(
    (
      1 -
      (rounded.stable_yield +
        rounded.btc_eth_momentum +
        rounded.active_swing +
        rounded.high_beta_alt)
    ).toFixed(3),
  );
  rounded.high_beta_alt = Number(
    (rounded.high_beta_alt + remainder).toFixed(3),
  );
  return rounded;
}

export function validateOnboardingInput(
  payload: unknown,
): { ok: true; input: OnboardingInput } | { ok: false; error: string } {
  if (!isRecord(payload)) {
    return { ok: false, error: "invalid-onboarding-payload" };
  }

  const goalPrimary = String(payload.goalPrimary ?? "").trim() as GoalPrimary;
  const timeHorizon = String(payload.timeHorizon ?? "").trim() as TimeHorizon;
  const lossTolerance = String(
    payload.lossTolerance ?? "",
  ).trim() as LossTolerance;
  const marketBehavior = String(
    payload.marketBehavior ?? "",
  ).trim() as MarketBehavior;
  const literacyRaw = payload.literacyAnswers;

  if (
    !GOAL_SET.has(goalPrimary) ||
    !TIME_HORIZON_SET.has(timeHorizon) ||
    !LOSS_TOLERANCE_SET.has(lossTolerance) ||
    !MARKET_BEHAVIOR_SET.has(marketBehavior)
  ) {
    return { ok: false, error: "invalid-onboarding-payload" };
  }

  if (!isRecord(literacyRaw)) {
    return { ok: false, error: "invalid-onboarding-payload" };
  }

  const q1 = String(literacyRaw.q1 ?? "").trim() as LiteracyAnswer;
  const q2 = String(literacyRaw.q2 ?? "").trim() as LiteracyAnswer;
  const q3 = String(literacyRaw.q3 ?? "").trim() as LiteracyAnswer;

  if (!LITERACY_SET.has(q1) || !LITERACY_SET.has(q2) || !LITERACY_SET.has(q3)) {
    return { ok: false, error: "invalid-onboarding-payload" };
  }

  return {
    ok: true,
    input: {
      goalPrimary,
      timeHorizon,
      lossTolerance,
      marketBehavior,
      literacyAnswers: { q1, q2, q3 },
    },
  };
}

export function computeLiteracyScore(
  answers: OnboardingInput["literacyAnswers"],
): number {
  let score = 0;
  if (answers.q1 === CORRECT_LITERACY_ANSWERS.q1) score += 1;
  if (answers.q2 === CORRECT_LITERACY_ANSWERS.q2) score += 1;
  if (answers.q3 === CORRECT_LITERACY_ANSWERS.q3) score += 1;
  return score;
}

export function deriveRiskBand(input: {
  timeHorizon: TimeHorizon;
  lossTolerance: LossTolerance;
  marketBehavior: MarketBehavior;
}): RiskBand {
  const toleranceScore =
    input.lossTolerance === "lt_10"
      ? 0
      : input.lossTolerance === "10_25"
        ? 1
        : 2;
  const horizonScore =
    input.timeHorizon === "short" ? 0 : input.timeHorizon === "medium" ? 1 : 2;
  const behaviorScore =
    input.marketBehavior === "panic_exit"
      ? 0
      : input.marketBehavior === "reduce_risk"
        ? 1
        : 2;

  const total = toleranceScore + horizonScore + behaviorScore;
  if (total <= 2) return "conservative";
  if (total <= 4) return "balanced";
  return "aggressive";
}

export function autoAssignLevel(
  input: OnboardingInput,
  literacyScore: number,
  riskBand: RiskBand,
): ExperienceLevel {
  if (literacyScore <= 1) return "beginner";
  if (input.goalPrimary === "preserve_capital" && riskBand === "conservative") {
    return "beginner";
  }
  if (
    (input.goalPrimary === "learn_active_trading" ||
      input.goalPrimary === "high_risk_opportunities") &&
    literacyScore === 3 &&
    riskBand === "aggressive"
  ) {
    return "pro";
  }
  if (riskBand === "balanced" && literacyScore >= 2) {
    return "intermediate";
  }
  return "intermediate";
}

export function buildFeedSeed(
  goalPrimary: GoalPrimary,
  riskBand: RiskBand,
  levelAtOnboarding: ExperienceLevel,
): FeedSeed {
  const baseByGoal: Record<GoalPrimary, FeedSeedThemes> = {
    preserve_capital: {
      stable_yield: 0.7,
      btc_eth_momentum: 0.15,
      active_swing: 0.1,
      high_beta_alt: 0.05,
    },
    grow_steadily: {
      stable_yield: 0.45,
      btc_eth_momentum: 0.3,
      active_swing: 0.2,
      high_beta_alt: 0.05,
    },
    learn_active_trading: {
      stable_yield: 0.15,
      btc_eth_momentum: 0.35,
      active_swing: 0.35,
      high_beta_alt: 0.15,
    },
    high_risk_opportunities: {
      stable_yield: 0.05,
      btc_eth_momentum: 0.2,
      active_swing: 0.3,
      high_beta_alt: 0.45,
    },
  };

  const themes = { ...baseByGoal[goalPrimary] };

  if (riskBand === "conservative") {
    themes.stable_yield += 0.1;
    themes.high_beta_alt -= 0.06;
    themes.active_swing -= 0.04;
  } else if (riskBand === "aggressive") {
    themes.high_beta_alt += 0.1;
    themes.active_swing += 0.04;
    themes.stable_yield -= 0.14;
  }

  return {
    themes: normalizeThemeTotals(themes),
    riskBand,
    levelAtOnboarding,
    version: 1,
  };
}

export function evaluateOnboarding(input: OnboardingInput): {
  level: ExperienceLevel;
  riskBand: RiskBand;
  literacyScore: number;
  consumerProfile: Omit<ConsumerProfileStored, "completedAt">;
} {
  const literacyScore = computeLiteracyScore(input.literacyAnswers);
  const riskBand = deriveRiskBand(input);
  const level = autoAssignLevel(input, literacyScore, riskBand);
  const feedSeed = buildFeedSeed(input.goalPrimary, riskBand, level);

  return {
    level,
    riskBand,
    literacyScore,
    consumerProfile: {
      goalPrimary: input.goalPrimary,
      riskBand,
      timeHorizon: input.timeHorizon,
      lossTolerance: input.lossTolerance,
      marketBehavior: input.marketBehavior,
      literacyAnswers: input.literacyAnswers,
      literacyScore,
      feedSeed,
    },
  };
}

export function mergeConsumerProfile(
  existingProfile: Record<string, unknown> | null,
  consumer: ConsumerProfileStored,
): Record<string, unknown> {
  const profile = isRecord(existingProfile) ? { ...existingProfile } : {};
  profile.consumer = consumer;
  return profile;
}

export function parseExperienceLevel(value: unknown): ExperienceLevel {
  const raw = String(value ?? "").trim() as ExperienceLevel;
  return LEVEL_SET.has(raw) ? raw : "beginner";
}

export function parseLevelSource(value: unknown): LevelSource {
  const raw = String(value ?? "").trim() as LevelSource;
  return LEVEL_SOURCE_SET.has(raw) ? raw : "auto";
}

export function parseConsumerProfileSummary(
  profile: Record<string, unknown> | null,
  feedSeedVersion: number,
): ConsumerProfileSummary | null {
  if (!isRecord(profile)) return null;
  const consumerRaw = profile.consumer;
  if (!isRecord(consumerRaw)) return null;

  const goalPrimary = String(consumerRaw.goalPrimary ?? "") as GoalPrimary;
  const riskBand = String(consumerRaw.riskBand ?? "") as RiskBand;
  const timeHorizon = String(consumerRaw.timeHorizon ?? "") as TimeHorizon;
  const literacyScore = Number(consumerRaw.literacyScore);

  if (
    !GOAL_SET.has(goalPrimary) ||
    !(
      riskBand === "conservative" ||
      riskBand === "balanced" ||
      riskBand === "aggressive"
    ) ||
    !TIME_HORIZON_SET.has(timeHorizon) ||
    !Number.isFinite(literacyScore)
  ) {
    return null;
  }

  return {
    goalPrimary,
    riskBand,
    timeHorizon,
    literacyScore: Math.max(0, Math.min(3, Math.floor(literacyScore))),
    feedSeedVersion: Number.isFinite(feedSeedVersion) ? feedSeedVersion : 1,
  };
}
