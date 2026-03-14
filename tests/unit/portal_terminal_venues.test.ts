import { describe, expect, test } from "bun:test";
import {
  formatTerminalOracleFreshness,
  getTerminalIntentFamilyLabel,
  getTerminalVenueDefinition,
  isTerminalIntentFamilyEnabled,
  isTerminalVenueEnabled,
  parseTerminalOracleStatus,
  resolveTerminalVenueRolloutPolicy,
} from "../../apps/portal/app/terminal/terminal-venues";

describe("portal terminal venue substrate", () => {
  test("resolves venue registry metadata", () => {
    expect(getTerminalVenueDefinition("jupiter")?.label).toBe("Jupiter");
    expect(getTerminalVenueDefinition("openbook_v2")?.badges).toContain("clob");
    expect(getTerminalIntentFamilyLabel("prediction_order")).toBe("Prediction");
  });

  test("parses venue and family rollout policy from profile and env", () => {
    const policy = resolveTerminalVenueRolloutPolicy({
      env: {
        NEXT_PUBLIC_TERMINAL_ENABLED_VENUES: "jupiter,drift,phoenix",
        NEXT_PUBLIC_TERMINAL_ENABLED_FAMILIES:
          "spot_swap,conditional_spot_order,perp_order",
        NEXT_PUBLIC_TERMINAL_ENABLE_PHOENIX: "0",
      },
      profile: {
        terminal: {
          enabledVenues: ["jupiter", "drift"],
          enabledFamilies: ["spot_swap", "perp_order"],
        },
      },
    });

    expect(policy.enabledVenues).toEqual(["jupiter", "drift"]);
    expect(policy.enabledFamilies).toEqual(["spot_swap", "perp_order"]);
    expect(
      isTerminalVenueEnabled("phoenix", {
        env: {
          NEXT_PUBLIC_TERMINAL_ENABLED_VENUES: "phoenix",
          NEXT_PUBLIC_TERMINAL_ENABLE_PHOENIX: "0",
        },
      }),
    ).toBe(false);
    expect(
      isTerminalIntentFamilyEnabled("perp_order", {
        profile: {
          terminal: {
            enabledFamilies: ["spot_swap", "perp_order"],
          },
        },
      }),
    ).toBe(true);
  });

  test("formats oracle freshness and parses oracle status", () => {
    expect(formatTerminalOracleFreshness(450)).toBe("450ms");
    expect(formatTerminalOracleFreshness(2_450)).toBe("2.5s");
    expect(
      parseTerminalOracleStatus({
        freshnessMs: 850,
        source: "pyth",
        stale: false,
      }),
    ).toEqual({
      freshnessMs: 850,
      source: "pyth",
      stale: false,
    });
  });
});
