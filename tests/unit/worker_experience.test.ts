import { describe, expect, test } from "bun:test";
import {
  autoAssignLevel,
  computeLiteracyScore,
  deriveRiskBand,
  evaluateOnboarding,
  validateOnboardingInput,
} from "../../apps/worker/src/experience";

describe("worker experience onboarding", () => {
  test("validates onboarding payload", () => {
    const valid = validateOnboardingInput({
      goalPrimary: "grow_steadily",
      timeHorizon: "medium",
      lossTolerance: "10_25",
      marketBehavior: "hold",
      literacyAnswers: { q1: "C", q2: "B", q3: "D" },
    });
    expect(valid.ok).toBe(true);

    const invalid = validateOnboardingInput({
      goalPrimary: "unknown",
      literacyAnswers: { q1: "A" },
    });
    expect(invalid.ok).toBe(false);
  });

  test("computes literacy score from keyed answers", () => {
    expect(computeLiteracyScore({ q1: "C", q2: "B", q3: "D" })).toBe(3);
    expect(computeLiteracyScore({ q1: "A", q2: "B", q3: "A" })).toBe(1);
  });

  test("derives conservative/balanced/aggressive risk bands", () => {
    expect(
      deriveRiskBand({
        lossTolerance: "lt_10",
        timeHorizon: "short",
        marketBehavior: "panic_exit",
      }),
    ).toBe("conservative");

    expect(
      deriveRiskBand({
        lossTolerance: "10_25",
        timeHorizon: "medium",
        marketBehavior: "reduce_risk",
      }),
    ).toBe("balanced");

    expect(
      deriveRiskBand({
        lossTolerance: "gt_25",
        timeHorizon: "long",
        marketBehavior: "buy_dip",
      }),
    ).toBe("aggressive");
  });

  test("auto assignment never promotes degen", () => {
    const level = autoAssignLevel(
      {
        goalPrimary: "high_risk_opportunities",
        timeHorizon: "long",
        lossTolerance: "gt_25",
        marketBehavior: "buy_dip",
        literacyAnswers: { q1: "C", q2: "B", q3: "D" },
      },
      3,
      "aggressive",
    );
    expect(level).toBe("pro");
  });

  test("evaluates onboarding and returns feed seed", () => {
    const evaluated = evaluateOnboarding({
      goalPrimary: "preserve_capital",
      timeHorizon: "short",
      lossTolerance: "lt_10",
      marketBehavior: "panic_exit",
      literacyAnswers: { q1: "C", q2: "B", q3: "D" },
    });

    expect(evaluated.level).toBe("beginner");
    expect(evaluated.consumerProfile.feedSeed.version).toBe(1);
    expect(
      evaluated.consumerProfile.feedSeed.themes.stable_yield,
    ).toBeGreaterThan(evaluated.consumerProfile.feedSeed.themes.high_beta_alt);
  });
});
