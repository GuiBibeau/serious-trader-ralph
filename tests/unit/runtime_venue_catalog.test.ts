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
    expect(perps.marketTypes).toEqual(["perp"]);
    expect(perps.venueKey).toBe("jupiter_perps");
    expect(perps.onboardingState).toBe("integrated");
    expect(perps.supportedModes).toEqual(["shadow", "paper"]);
    expect(runtimeVenueSupportsMode(perps, "paper")).toBe(true);
    expect(runtimeVenueSupportsMode(perps, "live")).toBe(false);
    expect(runtimeVenueSupportsIntentFamily(perps, "perp_order")).toBe(true);
    expect(runtimeVenueSupportsIntentFamily(perps, "spot_swap")).toBe(false);
    expect(perps.notes).toContain("work in progress");
    expect(
      listRuntimeVenueCapabilities().some(
        (capability) => capability.venueKey === "jupiter_perps",
      ),
    ).toBe(true);
  });

  test("keeps Raydium Perps separate from Raydium spot and blocked to candidate shadow use", () => {
    const spot = getRuntimeVenueCapability("raydium");
    const perps = getRuntimeVenueCapability("raydium_perps");

    expect(spot).not.toBeNull();
    expect(perps).not.toBeNull();
    if (!perps) {
      throw new Error("expected-raydium-perps-capability");
    }

    expect(spot?.marketTypes).toEqual(["spot"]);
    expect(perps.marketTypes).toEqual(["perp"]);
    expect(perps.onboardingState).toBe("candidate");
    expect(perps.supportedModes).toEqual(["shadow"]);
    expect(runtimeVenueSupportsMode(perps, "shadow")).toBe(true);
    expect(runtimeVenueSupportsMode(perps, "paper")).toBe(false);
    expect(runtimeVenueSupportsIntentFamily(perps, "perp_order")).toBe(true);
    expect(runtimeVenueSupportsIntentFamily(perps, "spot_swap")).toBe(false);
    expect(perps.notes).toContain("Orderly");
    expect(perps.notes).toContain("U.S. residents");
    expect(
      listRuntimeVenueCapabilities().some(
        (capability) => capability.venueKey === "raydium_perps",
      ),
    ).toBe(true);
  });

  test("adds DFlow as an integrated prediction-market venue for shadow and paper", () => {
    const venue = getRuntimeVenueCapability("dflow");

    expect(venue).not.toBeNull();
    if (!venue) {
      throw new Error("expected-dflow-capability");
    }

    expect(venue.marketTypes).toEqual(["prediction"]);
    expect(venue.intentFamilies).toEqual(["prediction_order"]);
    expect(venue.onboardingState).toBe("integrated");
    expect(venue.supportedModes).toEqual(["shadow", "paper"]);
    expect(runtimeVenueSupportsMode(venue, "paper")).toBe(true);
    expect(runtimeVenueSupportsMode(venue, "live")).toBe(false);
    expect(runtimeVenueSupportsIntentFamily(venue, "prediction_order")).toBe(
      true,
    );
    expect(runtimeVenueSupportsIntentFamily(venue, "perp_order")).toBe(false);
    expect(venue.notes).toContain("Proof");
    expect(venue.notes).toContain("Kalshi");
    expect(
      listRuntimeVenueCapabilities().some(
        (capability) => capability.venueKey === "dflow",
      ),
    ).toBe(true);
  });

  test("adds flash liquidity as a bounded atomic planning venue", () => {
    const venue = getRuntimeVenueCapability("flash_liquidity");

    expect(venue).not.toBeNull();
    if (!venue) {
      throw new Error("expected-flash-liquidity-capability");
    }

    expect(venue.marketTypes).toEqual(["spot"]);
    expect(venue.intentFamilies).toEqual(["flash_atomic"]);
    expect(venue.onboardingState).toBe("integrated");
    expect(venue.supportedModes).toEqual(["shadow", "paper"]);
    expect(runtimeVenueSupportsMode(venue, "paper")).toBe(true);
    expect(runtimeVenueSupportsMode(venue, "live")).toBe(false);
    expect(runtimeVenueSupportsIntentFamily(venue, "flash_atomic")).toBe(true);
    expect(runtimeVenueSupportsIntentFamily(venue, "spot_swap")).toBe(false);
    expect(venue.notes).toContain("marginfi");
    expect(venue.notes).toContain("Kamino");
    expect(
      listRuntimeVenueCapabilities().some(
        (capability) => capability.venueKey === "flash_liquidity",
      ),
    ).toBe(true);
  });

  test("adds Drift BET as a candidate prediction-market follow-on of Drift", () => {
    const venue = getRuntimeVenueCapability("drift_bet");

    expect(venue).not.toBeNull();
    if (!venue) {
      throw new Error("expected-drift-bet-capability");
    }

    expect(venue.marketTypes).toEqual(["prediction"]);
    expect(venue.intentFamilies).toEqual(["prediction_order"]);
    expect(venue.onboardingState).toBe("candidate");
    expect(venue.supportedModes).toEqual(["shadow"]);
    expect(runtimeVenueSupportsMode(venue, "shadow")).toBe(true);
    expect(runtimeVenueSupportsMode(venue, "paper")).toBe(false);
    expect(runtimeVenueSupportsIntentFamily(venue, "prediction_order")).toBe(
      true,
    );
    expect(runtimeVenueSupportsIntentFamily(venue, "perp_order")).toBe(false);
    expect(venue.notes).toContain("contract_type=Prediction");
    expect(venue.notes).toContain("main docs site");
    expect(
      listRuntimeVenueCapabilities().some(
        (capability) => capability.venueKey === "drift_bet",
      ),
    ).toBe(true);
  });

  test("adds Monaco as a candidate prediction-market venue with order and position lifecycle", () => {
    const venue = getRuntimeVenueCapability("monaco");

    expect(venue).not.toBeNull();
    if (!venue) {
      throw new Error("expected-monaco-capability");
    }

    expect(venue.marketTypes).toEqual(["prediction"]);
    expect(venue.intentFamilies).toEqual(["prediction_order"]);
    expect(venue.onboardingState).toBe("candidate");
    expect(venue.supportedModes).toEqual(["shadow"]);
    expect(runtimeVenueSupportsMode(venue, "shadow")).toBe(true);
    expect(runtimeVenueSupportsMode(venue, "paper")).toBe(false);
    expect(runtimeVenueSupportsIntentFamily(venue, "prediction_order")).toBe(
      true,
    );
    expect(runtimeVenueSupportsIntentFamily(venue, "perp_order")).toBe(false);
    expect(venue.notes).toContain("archived");
    expect(venue.notes).toContain("market lifecycle");
    expect(
      listRuntimeVenueCapabilities().some(
        (capability) => capability.venueKey === "monaco",
      ),
    ).toBe(true);
  });

  test("adds Mango as a bounded cross-margin venue with spot and perp intents", () => {
    const venue = getRuntimeVenueCapability("mango");

    expect(venue).not.toBeNull();
    if (!venue) {
      throw new Error("expected-mango-capability");
    }

    expect(venue.marketTypes).toEqual(["spot", "perp"]);
    expect(venue.intentFamilies).toEqual(["clob_order", "perp_order"]);
    expect(venue.onboardingState).toBe("integrated");
    expect(venue.supportedModes).toEqual(["shadow", "paper"]);
    expect(runtimeVenueSupportsMode(venue, "paper")).toBe(true);
    expect(runtimeVenueSupportsMode(venue, "live")).toBe(false);
    expect(runtimeVenueSupportsIntentFamily(venue, "clob_order")).toBe(true);
    expect(runtimeVenueSupportsIntentFamily(venue, "perp_order")).toBe(true);
    expect(runtimeVenueSupportsIntentFamily(venue, "spot_swap")).toBe(false);
    expect(venue.notes).toContain("cross-margin");
    expect(
      listRuntimeVenueCapabilities().some(
        (capability) => capability.venueKey === "mango",
      ),
    ).toBe(true);
  });
});
