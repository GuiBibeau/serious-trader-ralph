import { describe, expect, test } from "bun:test";
import {
  getRuntimeVenueCapability,
  listRuntimeVenueCapabilities,
  runtimeVenueSupportsIntentFamily,
  runtimeVenueSupportsMode,
} from "../../src/runtime/venues/catalog.js";

describe("runtime venue catalog", () => {
  test("keeps Jupiter Perps separate from Jupiter spot with bounded modes", () => {
    const spot = getRuntimeVenueCapability("jupiter");
    const perps = getRuntimeVenueCapability("jupiter_perps");

    expect(spot).not.toBeNull();
    expect(perps).not.toBeNull();
    if (!perps) {
      throw new Error("expected-jupiter-perps-capability");
    }
    expect(spot?.marketTypes).toEqual(["spot"]);
    expect(perps?.marketTypes).toEqual(["perp"]);
    expect(perps?.venueKey).toBe("jupiter_perps");
    expect(perps?.onboardingState).toBe("integrated");
    expect(perps?.supportedModes).toEqual(["shadow", "paper"]);
    expect(runtimeVenueSupportsMode(perps, "paper")).toBe(true);
    expect(runtimeVenueSupportsMode(perps, "live")).toBe(false);
    expect(runtimeVenueSupportsIntentFamily(perps, "perp_order")).toBe(true);
    expect(runtimeVenueSupportsIntentFamily(perps, "spot_swap")).toBe(false);
    expect(perps?.notes).toContain("work in progress");
    expect(
      listRuntimeVenueCapabilities().some(
        (capability) => capability.venueKey === "jupiter_perps",
      ),
    ).toBe(true);
  });
});
