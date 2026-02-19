import { defaultAgentStrategy } from "../../apps/worker/src/defaults";
import { inferMandateProfile } from "../../apps/worker/src/agent_mandate";

describe("worker agent mandate profile", () => {
  test("defaults to aggressive/autonomous profile when mandate is missing", () => {
    const profile = inferMandateProfile(undefined);
    expect(profile.aggressive).toBe(true);
    expect(profile.opportunistic).toBe(true);
    expect(profile.defaultMinConfidence).toBe("low");
  });

  test("default agent strategy is mandate-first and aggressive", () => {
    const strategy = defaultAgentStrategy();
    expect(strategy.type).toBe("agent");
    expect(strategy.minConfidence).toBe("low");
    expect(strategy.maxStepsPerTick).toBe(8);
    expect(strategy.maxToolCallsPerStep).toBe(8);
    expect(String(strategy.mandate ?? "").toLowerCase()).toContain(
      "aggressive",
    );
  });
});
