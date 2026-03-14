import { isRecord } from "../lib";

export const TERMINAL_VENUE_KEYS = [
  "jupiter",
  "raydium",
  "orca",
  "openbook_v2",
  "phoenix",
  "drift",
  "dflow",
  "monaco",
] as const;

export const TERMINAL_INTENT_FAMILIES = [
  "spot_swap",
  "conditional_spot_order",
  "clob_order",
  "perp_order",
  "prediction_order",
  "flash_atomic",
] as const;

export const TERMINAL_MARKET_TYPES = ["spot", "perp", "prediction"] as const;

export type TerminalVenueKey = (typeof TERMINAL_VENUE_KEYS)[number];
export type TerminalIntentFamily = (typeof TERMINAL_INTENT_FAMILIES)[number];
export type TerminalMarketType = (typeof TERMINAL_MARKET_TYPES)[number];
export type TerminalProviderStatus =
  | "healthy"
  | "degraded"
  | "pending"
  | "disabled"
  | "unknown";

export type TerminalOracleStatus = {
  freshnessMs: number | null;
  source: string | null;
  stale: boolean;
};

export type TerminalVenueDefinition = {
  venueKey: TerminalVenueKey;
  label: string;
  shortLabel: string;
  marketTypes: readonly TerminalMarketType[];
  families: readonly TerminalIntentFamily[];
  rolloutFlag: string;
  badges: readonly string[];
};

const TERMINAL_VENUE_REGISTRY: Record<
  TerminalVenueKey,
  TerminalVenueDefinition
> = {
  jupiter: {
    venueKey: "jupiter",
    label: "Jupiter",
    shortLabel: "JUP",
    marketTypes: ["spot"],
    families: ["spot_swap", "conditional_spot_order", "flash_atomic"],
    rolloutFlag: "spot_router",
    badges: ["agg", "custody"],
  },
  raydium: {
    venueKey: "raydium",
    label: "Raydium",
    shortLabel: "RAYD",
    marketTypes: ["spot"],
    families: ["spot_swap", "flash_atomic"],
    rolloutFlag: "spot_router",
    badges: ["amm", "router"],
  },
  orca: {
    venueKey: "orca",
    label: "Orca",
    shortLabel: "ORCA",
    marketTypes: ["spot"],
    families: ["spot_swap", "flash_atomic"],
    rolloutFlag: "spot_router",
    badges: ["clmm", "lp"],
  },
  openbook_v2: {
    venueKey: "openbook_v2",
    label: "OpenBook v2",
    shortLabel: "OBV2",
    marketTypes: ["spot"],
    families: ["clob_order"],
    rolloutFlag: "spot_clob",
    badges: ["clob", "maker"],
  },
  phoenix: {
    venueKey: "phoenix",
    label: "Phoenix",
    shortLabel: "PHNX",
    marketTypes: ["spot"],
    families: ["clob_order"],
    rolloutFlag: "phoenix",
    badges: ["clob", "maker"],
  },
  drift: {
    venueKey: "drift",
    label: "Drift",
    shortLabel: "DRFT",
    marketTypes: ["perp"],
    families: ["perp_order"],
    rolloutFlag: "perps",
    badges: ["perps", "margin"],
  },
  dflow: {
    venueKey: "dflow",
    label: "DFlow",
    shortLabel: "DFLW",
    marketTypes: ["prediction"],
    families: ["prediction_order"],
    rolloutFlag: "prediction",
    badges: ["events", "tokenized"],
  },
  monaco: {
    venueKey: "monaco",
    label: "Monaco",
    shortLabel: "MONA",
    marketTypes: ["prediction"],
    families: ["prediction_order"],
    rolloutFlag: "prediction",
    badges: ["events", "native"],
  },
};

export type TerminalVenueRolloutPolicy = {
  enabledVenues: readonly TerminalVenueKey[];
  enabledFamilies: readonly TerminalIntentFamily[];
};

function parseEnumList<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): T[] | null {
  if (Array.isArray(raw)) {
    const normalized = raw
      .map((entry) =>
        String(entry ?? "")
          .trim()
          .toLowerCase(),
      )
      .filter((entry): entry is T =>
        (allowed as readonly string[]).includes(entry),
      );
    return normalized.length > 0 ? Array.from(new Set(normalized)) : null;
  }
  const normalized = String(raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is T =>
      (allowed as readonly string[]).includes(entry),
    );
  return normalized.length > 0 ? Array.from(new Set(normalized)) : null;
}

function readTerminalProfile(
  profile: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!isRecord(profile)) return null;
  const terminal = profile.terminal;
  return isRecord(terminal) ? terminal : null;
}

export function getTerminalVenueDefinition(
  venueKey: TerminalVenueKey | null | undefined,
): TerminalVenueDefinition | null {
  if (!venueKey) return null;
  return TERMINAL_VENUE_REGISTRY[venueKey] ?? null;
}

export function getTerminalIntentFamilyLabel(
  family: TerminalIntentFamily | null | undefined,
): string | null {
  switch (family) {
    case "spot_swap":
      return "Spot Swap";
    case "conditional_spot_order":
      return "Conditional";
    case "clob_order":
      return "CLOB";
    case "perp_order":
      return "Perps";
    case "prediction_order":
      return "Prediction";
    case "flash_atomic":
      return "Flash";
    default:
      return null;
  }
}

export function resolveTerminalVenueRolloutPolicy(
  input: {
    env?: Record<string, unknown>;
    profile?: Record<string, unknown> | null;
  } = {},
): TerminalVenueRolloutPolicy {
  const env = input.env ?? process.env;
  const terminalProfile = readTerminalProfile(input.profile ?? null);
  const enabledVenues = parseEnumList(
    terminalProfile?.enabledVenues ?? env.NEXT_PUBLIC_TERMINAL_ENABLED_VENUES,
    TERMINAL_VENUE_KEYS,
  ) ?? ["jupiter"];
  const enabledFamilies = parseEnumList(
    terminalProfile?.enabledFamilies ??
      env.NEXT_PUBLIC_TERMINAL_ENABLED_FAMILIES,
    TERMINAL_INTENT_FAMILIES,
  ) ?? ["spot_swap", "conditional_spot_order"];

  return {
    enabledVenues,
    enabledFamilies,
  };
}

export function isTerminalVenueEnabled(
  venueKey: TerminalVenueKey,
  input: {
    env?: Record<string, unknown>;
    profile?: Record<string, unknown> | null;
  } = {},
): boolean {
  const policy = resolveTerminalVenueRolloutPolicy(input);
  if (!policy.enabledVenues.includes(venueKey)) return false;
  if (venueKey === "phoenix") {
    const env = input.env ?? process.env;
    const terminalProfile = readTerminalProfile(input.profile ?? null);
    const phoenixEnabled =
      terminalProfile?.enablePhoenix ??
      env.NEXT_PUBLIC_TERMINAL_ENABLE_PHOENIX ??
      "0";
    return String(phoenixEnabled).trim() === "1";
  }
  return true;
}

export function isTerminalIntentFamilyEnabled(
  family: TerminalIntentFamily,
  input: {
    env?: Record<string, unknown>;
    profile?: Record<string, unknown> | null;
  } = {},
): boolean {
  return resolveTerminalVenueRolloutPolicy(input).enabledFamilies.includes(
    family,
  );
}

export function parseTerminalProviderStatus(
  value: unknown,
): TerminalProviderStatus | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    normalized === "healthy" ||
    normalized === "degraded" ||
    normalized === "pending" ||
    normalized === "disabled" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return null;
}

export function parseTerminalMarketType(
  value: unknown,
): TerminalMarketType | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return (TERMINAL_MARKET_TYPES as readonly string[]).includes(normalized)
    ? (normalized as TerminalMarketType)
    : null;
}

export function parseTerminalVenueKey(value: unknown): TerminalVenueKey | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return (TERMINAL_VENUE_KEYS as readonly string[]).includes(normalized)
    ? (normalized as TerminalVenueKey)
    : null;
}

export function parseTerminalIntentFamily(
  value: unknown,
): TerminalIntentFamily | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return (TERMINAL_INTENT_FAMILIES as readonly string[]).includes(normalized)
    ? (normalized as TerminalIntentFamily)
    : null;
}

export function parseTerminalOracleStatus(input: {
  freshnessMs: unknown;
  source: unknown;
  stale: unknown;
}): TerminalOracleStatus | null {
  const freshnessMs = Number(input.freshnessMs);
  const source = String(input.source ?? "").trim() || null;
  const stale = input.stale === true;
  if (!Number.isFinite(freshnessMs) && !source && stale === false) {
    return null;
  }
  return {
    freshnessMs: Number.isFinite(freshnessMs) ? Math.max(0, freshnessMs) : null,
    source,
    stale,
  };
}

export function formatTerminalOracleFreshness(
  freshnessMs: number | null | undefined,
): string | null {
  if (!Number.isFinite(freshnessMs)) return null;
  if ((freshnessMs ?? 0) < 1000) return `${Math.round(freshnessMs ?? 0)}ms`;
  const seconds = Math.round((freshnessMs ?? 0) / 100) / 10;
  return `${seconds}s`;
}
