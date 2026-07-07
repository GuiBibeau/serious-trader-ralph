import { describe, expect, test } from "bun:test";
import { GATES, type GateConfig, resolveGate, resolveGateWith } from "./gates";

const OPEN = { allowed: true, submitBlocked: false, banner: null, level: null };

const enabled = (cfg: Omit<GateConfig, "enabled">): GateConfig => ({
  enabled: true,
  ...cfg,
});

describe("resolveGateWith", () => {
  test("missing feature resolves OPEN", () => {
    expect(resolveGateWith({}, "perps", "US")).toEqual(OPEN);
  });

  test("enabled: false resolves OPEN even with a level + regions", () => {
    const gates = {
      perps: enabled({
        level: "block",
        regions: ["US"],
        message: "blocked",
      }),
    };
    expect(
      resolveGateWith(
        { perps: { ...gates.perps, enabled: false } },
        "perps",
        "US",
      ),
    ).toEqual(OPEN);
  });

  test("warn: banner set, allowed true, not submitBlocked", () => {
    const gates = { perps: enabled({ level: "warn", message: "heads up" }) };
    expect(resolveGateWith(gates, "perps", "US")).toEqual({
      allowed: true,
      submitBlocked: false,
      banner: "heads up",
      level: "warn",
    });
  });

  test("submit-block: allowed true, submitBlocked true", () => {
    const gates = {
      perps: enabled({ level: "submit-block", message: "no submits" }),
    };
    expect(resolveGateWith(gates, "perps", "US")).toEqual({
      allowed: true,
      submitBlocked: true,
      banner: "no submits",
      level: "submit-block",
    });
  });

  test("block: allowed false, submitBlocked true", () => {
    const gates = { perps: enabled({ level: "block", message: "blocked" }) };
    expect(resolveGateWith(gates, "perps", "US")).toEqual({
      allowed: false,
      submitBlocked: true,
      banner: "blocked",
      level: "block",
    });
  });
});

describe("resolveGateWith region matching", () => {
  const gates = {
    perps: enabled({ level: "block", regions: ["US"], message: "blocked" }),
  };

  test("exact country match applies (US / US)", () => {
    expect(resolveGateWith(gates, "perps", "US").allowed).toBe(false);
  });

  test("lowercase country still applies (us -> US)", () => {
    expect(resolveGateWith(gates, "perps", "us").allowed).toBe(false);
  });

  test("non-listed country resolves OPEN", () => {
    expect(resolveGateWith(gates, "perps", "CA")).toEqual(OPEN);
  });

  test("unknown country (null) fails OPEN — documented capacity behavior", () => {
    expect(resolveGateWith(gates, "perps", null)).toEqual(OPEN);
  });
});

describe("ships-dark contract", () => {
  test("GATES ships empty", () => {
    expect(Object.keys(GATES).length).toBe(0);
  });

  test('resolveGate against empty GATES is OPEN for "perps"/"US"', () => {
    expect(resolveGate("perps", "US")).toEqual(OPEN);
  });
});
