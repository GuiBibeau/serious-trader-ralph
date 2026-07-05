import { describe, expect, test } from "bun:test";
import type { DepthLevel } from "$lib/phoenix-market-data";
import {
  bookLevelNotional,
  bookLevelTotalNotional,
  depthWidth,
  formatBookPrice,
  maxBookNotional,
} from "./book";

function level(price: number, size: number, cum: number): DepthLevel {
  return { price, size, cum };
}

describe("bookLevelNotional", () => {
  test("price × size", () => {
    expect(bookLevelNotional(level(100, 2.5, 0))).toBe(250);
  });

  test("null level → null", () => {
    expect(bookLevelNotional(null)).toBeNull();
    expect(bookLevelNotional(undefined)).toBeNull();
  });
});

describe("bookLevelTotalNotional", () => {
  test("uses cumulative size, not level size", () => {
    expect(bookLevelTotalNotional(level(100, 2, 7))).toBe(700);
  });

  test("null level → 0", () => {
    expect(bookLevelTotalNotional(null)).toBe(0);
  });
});

describe("maxBookNotional", () => {
  test("max cumulative notional across both sides", () => {
    const asks = [level(101, 1, 1), level(102, 2, 3)];
    const bids = [level(99, 5, 5), level(98, 1, 6)];
    // deepest bid: 98 × 6 = 588 vs deepest ask: 102 × 3 = 306
    expect(maxBookNotional(asks, bids)).toBe(588);
  });

  test("floors at 1 so depthWidth never divides by zero", () => {
    expect(maxBookNotional([], [])).toBe(1);
  });
});

describe("depthWidth", () => {
  test("proportional width against the passed max", () => {
    expect(depthWidth(level(100, 1, 5), 1000)).toBe(50);
  });

  test("clamps small levels up to 2%", () => {
    expect(depthWidth(level(1, 1, 0.001), 1000)).toBe(2);
  });

  test("clamps at 100%", () => {
    expect(depthWidth(level(100, 1, 50), 1000)).toBe(100);
  });
});

describe("formatBookPrice", () => {
  test("≥1000 → 0 decimal places", () => {
    expect(formatBookPrice(98123.4)).toBe(
      (98123.4).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
    );
  });

  test("≥1 → 2 decimal places", () => {
    expect(formatBookPrice(150.2)).toBe(
      (150.2).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    );
  });

  test("<1 → 4 decimal places", () => {
    expect(formatBookPrice(0.1234567)).toBe(
      (0.1234567).toLocaleString(undefined, {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }),
    );
  });

  test('non-finite and nullish guard → "--"', () => {
    expect(formatBookPrice(null)).toBe("--");
    expect(formatBookPrice(undefined)).toBe("--");
    expect(formatBookPrice(Number.NaN)).toBe("--");
    expect(formatBookPrice(Number.POSITIVE_INFINITY)).toBe("--");
  });
});

describe("sub-cent (meme) pricing", () => {
  test("formatBookPrice uses subscript-zero below 0.001", () => {
    expect(formatBookPrice(0.00004821)).toBe("0.0₄4821");
    expect(formatBookPrice(0.0001234)).toBe("0.0₃1234");
    expect(formatBookPrice(-0.00004821)).toBe("-0.0₄4821");
  });

  test("0.001 and above keep fixed decimals", () => {
    expect(formatBookPrice(0.0012)).toContain("0.0012");
  });
});
