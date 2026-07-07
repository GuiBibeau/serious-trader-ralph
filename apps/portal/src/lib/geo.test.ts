import { describe, expect, test } from "bun:test";
import { parseGeoHeaders } from "./geo";

describe("parseGeoHeaders", () => {
  test("uppercases present country and region headers", () => {
    const headers = new Headers({
      "x-vercel-ip-country": "ca",
      "x-vercel-ip-country-region": "qc",
    });

    expect(parseGeoHeaders(headers)).toEqual({ country: "CA", region: "QC" });
  });

  test("returns nulls for absent headers", () => {
    expect(parseGeoHeaders(new Headers())).toEqual({
      country: null,
      region: null,
    });
  });

  test("returns null country for malformed country headers", () => {
    expect(
      parseGeoHeaders(new Headers({ "x-vercel-ip-country": "USA" })).country,
    ).toBeNull();
    expect(
      parseGeoHeaders(new Headers({ "x-vercel-ip-country": "" })).country,
    ).toBeNull();
  });

  test("returns null region for an empty region header", () => {
    expect(
      parseGeoHeaders(new Headers({ "x-vercel-ip-country-region": "" })).region,
    ).toBeNull();
  });
});
