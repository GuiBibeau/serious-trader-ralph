import { describe, expect, test } from "bun:test";
import { type Alert, headlineMatches, matchAlerts } from "./alerts";

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "a1",
    symbol: "SOL",
    op: "above",
    price: 150,
    tier: "PRIORITY",
    triggered: false,
    ...overrides,
  };
}

describe("matchAlerts", () => {
  test("above fires at >= threshold; below at <=", () => {
    expect(matchAlerts([alert()], 150, "SOL")?.length).toBe(1);
    expect(matchAlerts([alert()], 149.99, "SOL")).toBeNull();
    expect(
      matchAlerts([alert({ op: "below", price: 100 })], 100, "SOL")?.length,
    ).toBe(1);
    expect(
      matchAlerts([alert({ op: "below", price: 100 })], 100.01, "SOL"),
    ).toBeNull();
  });

  test("already-triggered alerts never refire", () => {
    expect(matchAlerts([alert({ triggered: true })], 200, "SOL")).toBeNull();
  });

  test("symbol scoping: other markets' alerts are ignored", () => {
    expect(matchAlerts([alert({ symbol: "BTC" })], 200, "SOL")).toBeNull();
  });

  test("no-hit path is allocation-free (returns null, not [])", () => {
    expect(matchAlerts([], 100, "SOL")).toBeNull();
    expect(matchAlerts([alert()], 1, "SOL")).toBeNull();
  });

  test("multiple hits return in alert order", () => {
    const hits = matchAlerts(
      [alert({ id: "x", price: 100 }), alert({ id: "y", price: 120 })],
      150,
      "SOL",
    );
    expect(hits?.map((a) => a.id)).toEqual(["x", "y"]);
  });
});

describe("headlineMatches", () => {
  test("case-insensitive substring", () => {
    expect(headlineMatches("Solana rallies as SOL breaks out", "sol")).toBe(
      true,
    );
    expect(headlineMatches("Bitcoin ETF flows", "SOL")).toBe(false);
  });
});
