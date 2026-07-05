const SOL_DECIMALS = 9;
const USDC_DECIMALS = 6;
const DISPLAY_DECIMALS = 2;

export type AccountWallet = {
  signerType: string;
  privyWalletId: string;
  walletAddress: string;
  walletMigratedAt?: string | null;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function zeroDisplay(): string {
  return `0.${"0".repeat(DISPLAY_DECIMALS)}`;
}

function formatAtomicFixed(raw: unknown, decimals: number): string {
  if (typeof raw !== "string" || raw.trim() === "") return zeroDisplay();
  try {
    let value = BigInt(raw);
    const negative = value < BigInt(0);
    if (negative) value = -value;
    const scale = BigInt(10) ** BigInt(decimals);
    const displayScale = BigInt(10) ** BigInt(DISPLAY_DECIMALS);
    const scaled = (value * displayScale + scale / BigInt(2)) / scale;
    const whole = scaled / displayScale;
    const frac = (scaled % displayScale)
      .toString()
      .padStart(DISPLAY_DECIMALS, "0");
    return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
  } catch {
    return zeroDisplay();
  }
}

export function formatSolBalanceDisplay(lamportsRaw: unknown): string {
  return formatAtomicFixed(lamportsRaw, SOL_DECIMALS);
}

export function formatUsdcBalanceDisplay(atomicRaw: unknown): string {
  return formatAtomicFixed(atomicRaw, USDC_DECIMALS);
}

export function formatBalanceSummary(
  lamportsRaw: unknown,
  usdcAtomicRaw: unknown,
): string {
  return `${formatSolBalanceDisplay(lamportsRaw)} SOL · ${formatUsdcBalanceDisplay(usdcAtomicRaw)} USDC`;
}

export function formatAge(ts: number | string | null | undefined): string {
  if (!ts) return "never";
  const ms = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) return "unknown";
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// toLocaleString constructs a fresh Intl.NumberFormat on every call, and
// these formatters run in the highest-frequency DOM regions (book ladder,
// tape, preview and position rows — per rAF book frame). Cache formatters
// by fraction-digit pair; output is spec-identical to toLocaleString with
// the same options.
const numberFormats = new Map<string, Intl.NumberFormat>();

export function cachedNumberFormat(
  minimumFractionDigits: number,
  maximumFractionDigits: number,
): Intl.NumberFormat {
  const key = `${minimumFractionDigits}:${maximumFractionDigits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(undefined, {
      minimumFractionDigits,
      maximumFractionDigits,
    });
    numberFormats.set(key, format);
  }
  return format;
}

export function formatNumber(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return cachedNumberFormat(digits, digits).format(value);
}

const SUBSCRIPT_DIGITS =
  "\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089";

/**
 * Meme-coin price dialect: 0.00004821 -> "0.0\u20844821" (subscript counts
 * the zeros after the point). Display-only — never feed this back into a
 * Number() parse. Falls through for anything >= 0.001.
 */
export function formatSubZeroPrice(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const zeros = Math.max(0, -Math.floor(Math.log10(abs)) - 1);
  const digits = Math.round(abs * 10 ** (zeros + 4))
    .toString()
    .padStart(4, "0")
    .replace(/0+$/, "");
  const sub = String(zeros)
    .split("")
    .map((ch) => SUBSCRIPT_DIGITS[Number(ch)])
    .join("");
  return `${sign}0.0${sub}${digits || "0"}`;
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  const abs = Math.abs(value);
  // Sub-cent (meme) territory: subscript-zero notation stays legible where
  // fixed decimals turn into a wall of zeros.
  if (abs > 0 && abs < 0.001) return formatSubZeroPrice(value);
  const maximumFractionDigits =
    abs >= 1_000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  const minimumFractionDigits = abs >= 1 ? 2 : 0;
  return cachedNumberFormat(
    minimumFractionDigits,
    maximumFractionDigits,
  ).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function toNumericString(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw)).toString();
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

export function parseAtomic(raw: unknown): bigint | null {
  const value = toNumericString(raw);
  if (value === null) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function parseAccountWallet(raw: unknown): AccountWallet | null {
  if (!isRecord(raw)) return null;
  const walletAddress = String(raw.walletAddress ?? "").trim();
  if (!walletAddress) return null;
  return {
    signerType: String(raw.signerType ?? "unknown"),
    privyWalletId: String(raw.privyWalletId ?? ""),
    walletAddress,
    walletMigratedAt:
      typeof raw.walletMigratedAt === "string" ? raw.walletMigratedAt : null,
  };
}
