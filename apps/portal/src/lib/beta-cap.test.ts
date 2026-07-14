import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BETA_USER_CAP,
  parseBetaCap,
  resolveBetaEligibility,
} from "./beta-cap";

describe("resolveBetaEligibility", () => {
  test("fails open when the server is unconfigured", () => {
    expect(
      resolveBetaEligibility({
        configured: false,
        existing: null,
        count: null,
        cap: 150,
      }),
    ).toEqual({ allowed: true, reason: "unconfigured" });
  });

  test("existing users are always allowed, even at or past the cap", () => {
    expect(
      resolveBetaEligibility({
        configured: true,
        existing: true,
        count: 150,
        cap: 150,
      }),
    ).toEqual({ allowed: true, reason: "existing" });
    expect(
      resolveBetaEligibility({
        configured: true,
        existing: true,
        count: null,
        cap: 150,
      }),
    ).toEqual({ allowed: true, reason: "existing" });
  });

  test("fails open when the email lookup errored", () => {
    expect(
      resolveBetaEligibility({
        configured: true,
        existing: null,
        count: 200,
        cap: 150,
      }),
    ).toEqual({ allowed: true, reason: "unavailable" });
  });

  test("fails open when the user count errored", () => {
    expect(
      resolveBetaEligibility({
        configured: true,
        existing: false,
        count: null,
        cap: 150,
      }),
    ).toEqual({ allowed: true, reason: "unavailable" });
  });

  test("blocks a new user exactly at the cap boundary", () => {
    expect(
      resolveBetaEligibility({
        configured: true,
        existing: false,
        count: 150,
        cap: 150,
      }),
    ).toEqual({ allowed: false, reason: "beta-full" });
  });

  test("blocks a new user past the cap", () => {
    expect(
      resolveBetaEligibility({
        configured: true,
        existing: false,
        count: 151,
        cap: 150,
      }),
    ).toEqual({ allowed: false, reason: "beta-full" });
  });

  test("allows a new user one below the cap", () => {
    expect(
      resolveBetaEligibility({
        configured: true,
        existing: false,
        count: 149,
        cap: 150,
      }),
    ).toEqual({ allowed: true, reason: "open" });
  });

  test("cap of zero closes the beta to all new users", () => {
    expect(
      resolveBetaEligibility({
        configured: true,
        existing: false,
        count: 0,
        cap: 0,
      }),
    ).toEqual({ allowed: false, reason: "beta-full" });
  });
});

describe("parseBetaCap", () => {
  test("defaults to 150", () => {
    expect(DEFAULT_BETA_USER_CAP).toBe(150);
    expect(parseBetaCap(undefined)).toBe(150);
    expect(parseBetaCap("")).toBe(150);
    expect(parseBetaCap("   ")).toBe(150);
  });

  test("parses a valid integer", () => {
    expect(parseBetaCap("200")).toBe(200);
    expect(parseBetaCap(" 75 ")).toBe(75);
    expect(parseBetaCap("0")).toBe(0);
  });

  test("rejects garbage and negatives", () => {
    expect(parseBetaCap("abc")).toBe(150);
    expect(parseBetaCap("-5")).toBe(150);
    expect(parseBetaCap("NaN")).toBe(150);
  });
});
