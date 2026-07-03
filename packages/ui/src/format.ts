// Marketing/OG formatting dialect ("—" placeholder for missing values).
// The terminal keeps its own "--" dialect in apps/portal/src/lib/utils.ts —
// different null/digit semantics; do not merge the two.

/** Bare number, no "$": ≥1000 → integer, ≥1 → 2dp, <1 → up to 5dp. */
export const fmtPrice = (value: number | null): string =>
  value === null
    ? "—"
    : value >= 1000
      ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : value >= 1
        ? value.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : value.toLocaleString(undefined, { maximumFractionDigits: 5 });

/** Signed percent with two decimals: "+1.23%" / "-4.56%". */
export const fmtPct = (value: number | null): string =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

/** Compact dollars: $1.2B / $3.4M / $56K / $789. */
export const fmtCompact = (value: number | null): string => {
  if (value === null) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

/** Dollar-prefixed price; compact=true switches to B/M/K above $1000. */
export const fmtUsd = (value: number | null, compact = false): string => {
  if (value === null) return "—";
  if (compact) {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  }
  return `$${
    value >= 1000
      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : value >= 1
        ? value.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : value.toLocaleString(undefined, { maximumFractionDigits: 5 })
  }`;
};
