import { describe, expect, test } from "bun:test";
import {
  detectBrowserTimezone,
  formatClockInZone,
  formatTimeHmInZone,
  isDisplayTimezoneId,
  isValidIanaTimezone,
  timezoneAbbrev,
} from "./display-timezone";

describe("display-timezone", () => {
  test("validates curated and IANA ids", () => {
    expect(isDisplayTimezoneId("UTC")).toBe(true);
    expect(isDisplayTimezoneId("America/New_York")).toBe(true);
    expect(isDisplayTimezoneId("Not/AZone")).toBe(false);
    expect(isValidIanaTimezone("Asia/Tokyo")).toBe(true);
    expect(isValidIanaTimezone("Mars/Phobos")).toBe(false);
  });

  test("formats UTC clock", () => {
    // 2024-01-15T12:34:56.000Z
    const ms = Date.UTC(2024, 0, 15, 12, 34, 56);
    expect(formatClockInZone(ms, "UTC")).toBe("12:34:56 UTC");
    expect(formatTimeHmInZone(ms, "UTC")).toBe("12:34");
    expect(timezoneAbbrev(ms, "UTC")).toBe("UTC");
  });

  test("shifts into New York", () => {
    const ms = Date.UTC(2024, 0, 15, 17, 0, 0); // 12:00 EST
    expect(formatTimeHmInZone(ms, "America/New_York")).toBe("12:00");
  });

  test("detectBrowserTimezone returns a valid id", () => {
    expect(isValidIanaTimezone(detectBrowserTimezone())).toBe(true);
  });
});
