// Pure decision logic for the Discord market-move alert cron
// (/api/cron/market-moves). Same convention as discord-verify.ts: no env
// reads, no network, no Date.now() inside any function — callers inject the
// clock so the adjacent test can exercise every branch deterministically.
//
// Tier model:
// - fast:    |price now vs our own snapshot ~1h ago| >= 3% (majors only)
// - session: |change24hPct| >= 5% (majors only)
// - big:     |change24hPct| >= 10% (every catalog asset)
// The fast baseline comes from our own rolling snapshots — we never
// extrapolate: no snapshot in the honest ~1h window means the fast tier is
// simply not evaluable for that asset this run.

export type MoveTier = "fast" | "session" | "big";

export type AssetInput = {
  assetId: string;
  symbol: string;
  price: number | null;
  change24hPct: number | null;
};

export type PricePoint = { t: number; price: number };

export type MarketState = {
  /** Rolling own-price history per major asset (fast-tier baseline). */
  snapshots: Record<string, PricePoint[]>;
  /** Dedup marks: "assetId:tier" -> UTC day ("YYYY-MM-DD") it fired. */
  posted: Record<string, string>;
};

export type MoveAlert = {
  assetId: string;
  symbol: string;
  tier: MoveTier;
  price: number;
  /** Signed percent move: ~1h for fast, 24h for session/big. */
  movePct: number;
};

export const FAST_THRESHOLD_PCT = 3;
export const SESSION_THRESHOLD_PCT = 5;
export const BIG_THRESHOLD_PCT = 10;

/** Majors are evaluated for every tier; everything else only for `big`. */
export const MAJOR_ASSET_IDS: ReadonlySet<string> = new Set([
  "solana",
  "bitcoin",
]);

/** Snapshots older than this are pruned every run. */
export const SNAPSHOT_RETENTION_MS = 25 * 60 * 60 * 1000;
// The fast baseline must be an honest "~1h ago" price. Younger than 45min
// is not a 1h window yet; older than 75min (e.g. after a cron outage) would
// silently report a multi-hour move as a 1h move — both are skipped rather
// than extrapolated.
export const FAST_BASELINE_MIN_AGE_MS = 45 * 60 * 1000;
export const FAST_BASELINE_MAX_AGE_MS = 75 * 60 * 1000;
const FAST_BASELINE_TARGET_AGE_MS = 60 * 60 * 1000;

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Deep-validate a persisted state blob. Anything malformed degrades to a
 * fresh state: the cost is at most one duplicate alert per asset/tier that
 * day and an hour without fast baselines — far better than a crashed cron.
 */
export function parseMarketState(raw: unknown): MarketState {
  const fresh: MarketState = { snapshots: {}, posted: {} };
  if (typeof raw !== "object" || raw === null) return fresh;
  const record = raw as Record<string, unknown>;
  const state: MarketState = { snapshots: {}, posted: {} };
  if (typeof record.snapshots === "object" && record.snapshots !== null) {
    for (const [assetId, points] of Object.entries(
      record.snapshots as Record<string, unknown>,
    )) {
      if (!Array.isArray(points)) continue;
      const clean: PricePoint[] = [];
      for (const point of points) {
        if (typeof point !== "object" || point === null) continue;
        const { t, price } = point as Record<string, unknown>;
        if (typeof t !== "number" || !Number.isFinite(t)) continue;
        // price must be a usable fast-tier divisor — drop zero/negative.
        if (
          typeof price !== "number" ||
          !Number.isFinite(price) ||
          price <= 0
        ) {
          continue;
        }
        clean.push({ t, price });
      }
      if (clean.length > 0) state.snapshots[assetId] = clean;
    }
  }
  if (typeof record.posted === "object" && record.posted !== null) {
    for (const [key, day] of Object.entries(
      record.posted as Record<string, unknown>,
    )) {
      if (typeof day === "string") state.posted[key] = day;
    }
  }
  return state;
}

/**
 * The snapshot closest to 1h old within the honest [45min, 75min] window,
 * or null when the fast tier is not evaluable.
 */
export function fastBaseline(
  points: PricePoint[],
  nowMs: number,
): PricePoint | null {
  let best: PricePoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const age = nowMs - point.t;
    if (age < FAST_BASELINE_MIN_AGE_MS || age > FAST_BASELINE_MAX_AGE_MS) {
      continue;
    }
    const distance = Math.abs(age - FAST_BASELINE_TARGET_AGE_MS);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * One run of the alert engine: appends this run's snapshots (majors only —
 * fast is only evaluated for majors), prunes stale history and stale dedup
 * marks, and returns the alerts that should post plus the next state.
 * Dedup is one post per asset per tier per UTC day; a `big` alert marks the
 * same-day `session` slot consumed (big supersedes session).
 */
export function computeAlerts(
  assets: AssetInput[],
  prev: MarketState,
  nowMs: number,
): { alerts: MoveAlert[]; next: MarketState } {
  const day = utcDay(nowMs);
  const alerts: MoveAlert[] = [];

  const posted = pruneDedupMarks(prev.posted, day);

  // Prune history beyond retention (also drops bogus future-dated points).
  const snapshots: Record<string, PricePoint[]> = {};
  for (const [assetId, points] of Object.entries(prev.snapshots)) {
    const kept = points.filter((point) => {
      const age = nowMs - point.t;
      return age >= 0 && age <= SNAPSHOT_RETENTION_MS;
    });
    if (kept.length > 0) snapshots[assetId] = kept;
  }

  for (const asset of assets) {
    const isMajor = MAJOR_ASSET_IDS.has(asset.assetId);
    const hasPrice = asset.price !== null && asset.price > 0;

    // Fast tier: majors only, against our own history. Baseline is read
    // before this run's snapshot is appended (a 0-age point could never
    // qualify anyway, but the intent should not depend on that).
    if (isMajor && hasPrice && asset.price !== null) {
      const baseline = fastBaseline(snapshots[asset.assetId] ?? [], nowMs);
      if (baseline) {
        const movePct = ((asset.price - baseline.price) / baseline.price) * 100;
        const key = `${asset.assetId}:fast`;
        if (Math.abs(movePct) >= FAST_THRESHOLD_PCT && !posted[key]) {
          alerts.push({
            assetId: asset.assetId,
            symbol: asset.symbol,
            tier: "fast",
            price: asset.price,
            movePct,
          });
          posted[key] = day;
        }
      }
      snapshots[asset.assetId] = [
        ...(snapshots[asset.assetId] ?? []),
        { t: nowMs, price: asset.price },
      ];
    }

    // 24h tiers, from the catalog's own change24hPct — null means the feed
    // does not know, so neither do we (no alert, never extrapolate).
    if (asset.change24hPct !== null && hasPrice && asset.price !== null) {
      const abs = Math.abs(asset.change24hPct);
      const bigKey = `${asset.assetId}:big`;
      const sessionKey = `${asset.assetId}:session`;
      if (abs >= BIG_THRESHOLD_PCT) {
        if (!posted[bigKey]) {
          alerts.push({
            assetId: asset.assetId,
            symbol: asset.symbol,
            tier: "big",
            price: asset.price,
            movePct: asset.change24hPct,
          });
          posted[bigKey] = day;
          // Big supersedes session for the rest of the day.
          posted[sessionKey] = day;
        }
      } else if (
        isMajor &&
        abs >= SESSION_THRESHOLD_PCT &&
        !posted[sessionKey]
      ) {
        alerts.push({
          assetId: asset.assetId,
          symbol: asset.symbol,
          tier: "session",
          price: asset.price,
          movePct: asset.change24hPct,
        });
        posted[sessionKey] = day;
      }
    }
  }

  return { alerts, next: { snapshots, posted } };
}

// ── Dedup marks (per-chunk persistence) ───────────────────────────────

/** Dedup marks from previous UTC days can never match again — drop them. */
export function pruneDedupMarks(
  posted: Record<string, string>,
  day: string,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, markedDay] of Object.entries(posted)) {
    if (markedDay === day) kept[key] = markedDay;
  }
  return kept;
}

/**
 * The dedup marks a group of alerts consumes once posted: each alert takes
 * its own asset:tier slot for the day, and a `big` alert also takes the
 * same-day `session` slot (big supersedes session — mirrors computeAlerts).
 */
export function alertDedupMarks(
  alerts: readonly MoveAlert[],
  day: string,
): Record<string, string> {
  const marks: Record<string, string> = {};
  for (const alert of alerts) {
    marks[`${alert.assetId}:${alert.tier}`] = day;
    if (alert.tier === "big") marks[`${alert.assetId}:session`] = day;
  }
  return marks;
}

// ── Embeds ────────────────────────────────────────────────────────────

export type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  /** ISO8601, rendered by Discord in the reader's locale. */
  timestamp?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
};

// Repo palette: --up / --down from packages/ui tokens, as embed color ints.
export const UP_COLOR = 0x2ce97f;
export const DOWN_COLOR = 0xff5a6a;

/** Discord allows at most 10 embeds per message. */
export const MAX_EMBEDS_PER_MESSAGE = 10;

/** Split alerts into Discord-postable groups of at most `size`. */
export function chunkEmbeds<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

const TIER_LABELS: Record<MoveTier, string> = {
  fast: "1h move",
  session: "24h session move",
  big: "big 24h move",
};

export function signedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Display-only USD formatting (never feed the output back to Number()). */
export function formatUsd(price: number): string {
  if (price >= 1) {
    return `$${price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  const sig = price.toPrecision(4);
  // toPrecision switches to exponent notation below 1e-6 — expand it.
  return `$${sig.includes("e") ? Number(sig).toFixed(12).replace(/0+$/, "") : sig}`;
}

/**
 * One embed per alert. Callers are responsible for chunking to Discord's
 * 10-embed cap (chunkEmbeds) — no silent truncation here.
 */
export function buildMoveEmbeds(
  alerts: MoveAlert[],
  nowMs: number,
): DiscordEmbed[] {
  const timestamp = new Date(nowMs).toISOString();
  return alerts.map((alert) => ({
    title: `${alert.symbol} ${signedPct(alert.movePct)} — ${TIER_LABELS[alert.tier]}`,
    description: `Last price ${formatUsd(alert.price)} · ${signedPct(alert.movePct)} ${
      alert.tier === "fast" ? "over the last hour" : "over the last 24 hours"
    }`,
    color: alert.movePct >= 0 ? UP_COLOR : DOWN_COLOR,
    timestamp,
  }));
}
