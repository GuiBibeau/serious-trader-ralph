// Pure order-book ladder helpers for the terminal page — level notionals,
// the depth-bar width math, and the book price formatter. No component
// state; the ladder max is passed in explicitly.

import type { DepthLevel } from "$lib/phoenix-market-data";
import { cachedNumberFormat, formatSubZeroPrice } from "$lib/utils";

export const BOOK_LADDER_LEVELS = 10;
// Stacked desktop shares the panel with the ticket — cap the ladder so
// both stay readable; the narrow-viewport tabs keep the full depth.
export const BOOK_LADDER_LEVELS_STACKED = 8;

export function bookLevelNotional(
  level: DepthLevel | null | undefined,
): number | null {
  if (!level) return null;
  return level.price * level.size;
}

export function bookLevelTotalNotional(
  level: DepthLevel | null | undefined,
): number {
  if (!level) return 0;
  return level.price * level.cum;
}

export function maxBookNotional(
  askLevels: DepthLevel[],
  bidLevels: DepthLevel[],
): number {
  return Math.max(
    1,
    ...askLevels.map(bookLevelTotalNotional),
    ...bidLevels.map(bookLevelTotalNotional),
  );
}

export function depthWidth(level: DepthLevel, maxNotional: number): number {
  return Math.min(
    100,
    Math.max(2, (bookLevelTotalNotional(level) / maxNotional) * 100),
  );
}

export function formatBookPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  const abs = Math.abs(value);
  // Sub-cent (meme) prices: 4 fixed decimals render as 0.0000 — use the
  // subscript-zero dialect instead.
  if (abs > 0 && abs < 0.001) return formatSubZeroPrice(value);
  const digits = abs >= 1_000 ? 0 : abs >= 1 ? 2 : 4;
  // Cached formatter — this runs 3× per ladder row per rAF book frame.
  return cachedNumberFormat(digits, digits).format(value);
}
