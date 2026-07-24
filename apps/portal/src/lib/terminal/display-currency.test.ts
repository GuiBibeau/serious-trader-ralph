import { describe, expect, test } from "bun:test";
import {
  formatDisplayMoney,
  formatDisplayMoneySigned,
  isDisplayCurrencyCode,
  rateForCurrency,
} from "./display-currency";

describe("display-currency", () => {
  test("whitelist", () => {
    expect(isDisplayCurrencyCode("EUR")).toBe(true);
    expect(isDisplayCurrencyCode("DOGE")).toBe(false);
  });

  test("formats USD unchanged", () => {
    expect(formatDisplayMoney(1234.5, "USD", 1, 0)).toBe("$1,235");
  });

  test("converts with rate", () => {
    expect(formatDisplayMoney(100, "EUR", 0.9, 2)).toBe("€90.00");
  });

  test("signed helper", () => {
    expect(formatDisplayMoneySigned(12.5, "USD", 1, 2)).toBe("+$12.50");
    expect(formatDisplayMoneySigned(-12.5, "USD", 1, 2)).toBe("-$12.50");
  });

  test("rateForCurrency falls back", () => {
    expect(rateForCurrency("USD", {})).toBe(1);
    expect(rateForCurrency("EUR", { EUR: 0.91 })).toBe(0.91);
    expect(rateForCurrency("EUR", {})).toBeGreaterThan(0);
  });
});
