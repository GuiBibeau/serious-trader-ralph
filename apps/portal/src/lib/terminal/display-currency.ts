// Display-currency preference — UI conversion only. Markets, tickets, and
// settlement stay USD/USDC; we multiply shown amounts by a USD→fiat rate.

import { formatNumber } from "$lib/utils";

export const DISPLAY_CURRENCIES = [
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "CAD", label: "Canadian Dollar", symbol: "CA$" },
  { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  { code: "JPY", label: "Japanese Yen", symbol: "¥" },
  { code: "CHF", label: "Swiss Franc", symbol: "CHF " },
  { code: "SGD", label: "Singapore Dollar", symbol: "S$" },
  { code: "HKD", label: "Hong Kong Dollar", symbol: "HK$" },
  { code: "INR", label: "Indian Rupee", symbol: "₹" },
  { code: "BRL", label: "Brazilian Real", symbol: "R$" },
  { code: "MXN", label: "Mexican Peso", symbol: "MX$" },
] as const;

export type DisplayCurrencyCode = (typeof DISPLAY_CURRENCIES)[number]["code"];

export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrencyCode = "USD";

const CODE_SET = new Set<string>(DISPLAY_CURRENCIES.map((row) => row.code));

export function isDisplayCurrencyCode(
  value: unknown,
): value is DisplayCurrencyCode {
  return typeof value === "string" && CODE_SET.has(value);
}

export function displayCurrencyMeta(code: DisplayCurrencyCode): {
  code: DisplayCurrencyCode;
  label: string;
  symbol: string;
} {
  return (
    DISPLAY_CURRENCIES.find((row) => row.code === code) ?? DISPLAY_CURRENCIES[0]
  );
}

/** Digits for money labels — JPY has no minor units in everyday UI. */
export function displayCurrencyDigits(code: DisplayCurrencyCode): number {
  return code === "JPY" ? 0 : 2;
}

/**
 * Format a USD amount in the user's display currency.
 * `rate` is units of display currency per 1 USD (USD → 1).
 */
export function formatDisplayMoney(
  usdAmount: number,
  currency: DisplayCurrencyCode,
  rate = 1,
  digits?: number,
): string {
  const meta = displayCurrencyMeta(currency);
  const safeRate =
    currency === "USD" ? 1 : Number.isFinite(rate) && rate > 0 ? rate : 1;
  const converted = usdAmount * safeRate;
  const places =
    digits ??
    (Math.abs(converted) >= 1000 ? 0 : displayCurrencyDigits(currency));
  const sign = converted < 0 ? "-" : "";
  return `${sign}${meta.symbol}${formatNumber(Math.abs(converted), places)}`;
}

export function formatDisplayMoneySigned(
  usdAmount: number,
  currency: DisplayCurrencyCode,
  rate = 1,
  digits = 2,
): string {
  const abs = formatDisplayMoney(Math.abs(usdAmount), currency, rate, digits);
  if (usdAmount > 0) return `+${abs}`;
  if (usdAmount < 0) return `-${abs}`;
  return abs;
}

const FX_CACHE_KEY = "trader-ralph-terminal/fx-usd/v1";
const FX_TTL_MS = 6 * 60 * 60_000;

/** Rough fallbacks if the FX endpoint is unreachable (USD = 1). */
export const FALLBACK_USD_RATES: Record<DisplayCurrencyCode, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.53,
  JPY: 157,
  CHF: 0.88,
  SGD: 1.34,
  HKD: 7.8,
  INR: 83,
  BRL: 5.1,
  MXN: 17.2,
};

type FxCache = {
  fetchedAt: number;
  rates: Partial<Record<DisplayCurrencyCode, number>>;
};

function readFxCache(): FxCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FxCache;
    if (
      !parsed ||
      typeof parsed.fetchedAt !== "number" ||
      typeof parsed.rates !== "object" ||
      parsed.rates === null
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeFxCache(
  rates: Partial<Record<DisplayCurrencyCode, number>>,
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: FxCache = { fetchedAt: Date.now(), rates };
    window.localStorage.setItem(FX_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // private mode / quota — non-fatal
  }
}

export function rateForCurrency(
  currency: DisplayCurrencyCode,
  rates: Partial<Record<DisplayCurrencyCode, number>>,
): number {
  if (currency === "USD") return 1;
  const live = rates[currency];
  if (typeof live === "number" && Number.isFinite(live) && live > 0)
    return live;
  return FALLBACK_USD_RATES[currency] ?? 1;
}

/**
 * Load USD→fiat rates (Frankfurter / ECB). Returns merged fallbacks on failure.
 * Non-USD codes only; USD is always 1.
 */
export async function fetchUsdFxRates(
  force = false,
): Promise<Partial<Record<DisplayCurrencyCode, number>>> {
  const cached = readFxCache();
  if (
    !force &&
    cached &&
    Date.now() - cached.fetchedAt < FX_TTL_MS &&
    cached.rates
  ) {
    return { USD: 1, ...cached.rates };
  }

  const targets = DISPLAY_CURRENCIES.map((row) => row.code).filter(
    (code) => code !== "USD",
  );
  try {
    const url = `https://api.frankfurter.app/latest?from=USD&to=${targets.join(",")}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fx-http-${res.status}`);
    const body = (await res.json()) as { rates?: Record<string, number> };
    const rates: Partial<Record<DisplayCurrencyCode, number>> = { USD: 1 };
    for (const code of targets) {
      const value = body.rates?.[code];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        rates[code] = value;
      }
    }
    writeFxCache(rates);
    return rates;
  } catch {
    return { ...FALLBACK_USD_RATES };
  }
}
