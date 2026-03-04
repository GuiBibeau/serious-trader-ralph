import { isRecord } from "../lib";

export const TERMINAL_MODE_STORAGE_KEY = "terminal-mode:v1";
export const TERMINAL_MODE_OPTIONS = ["regular", "degen", "custom"] as const;

export type TerminalMode = (typeof TERMINAL_MODE_OPTIONS)[number];
export const TERMINAL_MODE_ROLLOUT_COHORT_OPTIONS = [
  "all",
  "onboarded",
  "experienced",
  "degen_acknowledged",
] as const;
export type TerminalModeRolloutCohort =
  (typeof TERMINAL_MODE_ROLLOUT_COHORT_OPTIONS)[number];
export type TerminalModeRolloutContext = {
  experienceLevel?: string | null;
  onboardingCompleted?: boolean;
  degenAcknowledgedAt?: string | null;
};

export type TerminalModule =
  | "market"
  | "wallet"
  | "macro_radar"
  | "macro_fred"
  | "macro_etf"
  | "macro_stablecoin"
  | "macro_oil"
  | "degen_watchlist"
  | "degen_event_hooks";

export type TerminalAction = "quick_trade" | "macro_trade" | "layout_edit";

type TerminalModeCapabilities = {
  label: string;
  description: string;
  visibleModules: readonly TerminalModule[];
  actions: Record<TerminalAction, boolean>;
};

const TERMINAL_MODE_CAPABILITIES: Record<
  TerminalMode,
  TerminalModeCapabilities
> = {
  regular: {
    label: "Regular",
    description: "Core market + wallet workspace with lower-risk actions.",
    visibleModules: ["market", "wallet", "macro_radar", "macro_fred"],
    actions: {
      quick_trade: true,
      macro_trade: false,
      layout_edit: false,
    },
  },
  degen: {
    label: "Degen",
    description: "All modules and fast tactical trading controls.",
    visibleModules: [
      "market",
      "wallet",
      "macro_radar",
      "macro_fred",
      "macro_etf",
      "macro_stablecoin",
      "macro_oil",
      "degen_watchlist",
      "degen_event_hooks",
    ],
    actions: {
      quick_trade: true,
      macro_trade: true,
      layout_edit: true,
    },
  },
  custom: {
    label: "Custom",
    description: "All modules with personal layout controls.",
    visibleModules: [
      "market",
      "wallet",
      "macro_radar",
      "macro_fred",
      "macro_etf",
      "macro_stablecoin",
      "macro_oil",
      "degen_watchlist",
      "degen_event_hooks",
    ],
    actions: {
      quick_trade: true,
      macro_trade: true,
      layout_edit: true,
    },
  },
};

function parseModeAllowlist(raw: unknown): readonly TerminalMode[] {
  const parsed = String(raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is TerminalMode => isTerminalMode(entry));
  if (parsed.length < 1) return TERMINAL_MODE_OPTIONS;
  const deduped = Array.from(new Set(parsed));
  if (!deduped.includes("regular")) {
    deduped.unshift("regular");
  }
  return deduped;
}

function parseRolloutCohort(
  raw: unknown,
  fallback: TerminalModeRolloutCohort,
): TerminalModeRolloutCohort {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  return (TERMINAL_MODE_ROLLOUT_COHORT_OPTIONS as readonly string[]).includes(
    normalized,
  )
    ? (normalized as TerminalModeRolloutCohort)
    : fallback;
}

function normalizeExperienceLevel(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

function rolloutCohortAllowsMode(
  context: TerminalModeRolloutContext | null | undefined,
  cohort: TerminalModeRolloutCohort,
): boolean {
  if (cohort === "all") return true;
  if (cohort === "onboarded") return context?.onboardingCompleted === true;
  if (cohort === "experienced") {
    const level = normalizeExperienceLevel(context?.experienceLevel);
    return level === "advanced" || level === "degen";
  }
  return Boolean(String(context?.degenAcknowledgedAt ?? "").trim());
}

export function resolveTerminalModeRolloutPolicy(
  env: Record<string, unknown> = process.env,
): {
  allowedModes: readonly TerminalMode[];
  degenCohort: TerminalModeRolloutCohort;
  customCohort: TerminalModeRolloutCohort;
} {
  return {
    allowedModes: parseModeAllowlist(env.NEXT_PUBLIC_TERMINAL_ALLOWED_MODES),
    degenCohort: parseRolloutCohort(
      env.NEXT_PUBLIC_TERMINAL_DEGEN_COHORT,
      "all",
    ),
    customCohort: parseRolloutCohort(
      env.NEXT_PUBLIC_TERMINAL_CUSTOM_COHORT,
      "all",
    ),
  };
}

export function isTerminalModeAllowedByRollout(
  mode: TerminalMode,
  input: {
    context?: TerminalModeRolloutContext | null;
    env?: Record<string, unknown>;
  } = {},
): boolean {
  const policy = resolveTerminalModeRolloutPolicy(input.env ?? process.env);
  if (!policy.allowedModes.includes(mode)) return false;
  if (mode === "degen") {
    return rolloutCohortAllowsMode(input.context, policy.degenCohort);
  }
  if (mode === "custom") {
    return rolloutCohortAllowsMode(input.context, policy.customCohort);
  }
  return true;
}

export function getRolloutAllowedTerminalModes(
  input: {
    context?: TerminalModeRolloutContext | null;
    env?: Record<string, unknown>;
  } = {},
): TerminalMode[] {
  const allowed = TERMINAL_MODE_OPTIONS.filter((mode) =>
    isTerminalModeAllowedByRollout(mode, input),
  );
  if (allowed.length > 0) return [...allowed];
  return ["regular"];
}

export function coerceTerminalModeForRollout(
  mode: TerminalMode,
  input: {
    context?: TerminalModeRolloutContext | null;
    env?: Record<string, unknown>;
  } = {},
): TerminalMode {
  if (isTerminalModeAllowedByRollout(mode, input)) return mode;
  const allowed = getRolloutAllowedTerminalModes(input);
  return allowed.includes("regular") ? "regular" : (allowed[0] ?? "regular");
}

export function isTerminalMode(value: unknown): value is TerminalMode {
  return (
    typeof value === "string" &&
    (TERMINAL_MODE_OPTIONS as readonly string[]).includes(value)
  );
}

export function resolveDefaultTerminalMode(raw: unknown): TerminalMode {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (isTerminalMode(normalized)) return normalized;
  return "regular";
}

export function readLocalTerminalMode(): TerminalMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TERMINAL_MODE_STORAGE_KEY);
    return isTerminalMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeLocalTerminalMode(mode: TerminalMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TERMINAL_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage errors and keep runtime behavior deterministic.
  }
}

export function readTerminalModeFromProfile(
  profile: Record<string, unknown> | null,
): TerminalMode | null {
  if (!isRecord(profile)) return null;
  const terminal = profile.terminal;
  if (!isRecord(terminal)) return null;
  return isTerminalMode(terminal.mode) ? terminal.mode : null;
}

export function mergeProfileWithTerminalMode(
  profile: Record<string, unknown> | null,
  input: {
    mode: TerminalMode;
    source: "manual" | "local_fallback" | "default_fallback";
  },
): Record<string, unknown> {
  const base = isRecord(profile) ? { ...profile } : {};
  const terminalExisting = isRecord(base.terminal) ? { ...base.terminal } : {};
  base.terminal = {
    ...terminalExisting,
    mode: input.mode,
    source: input.source,
    updatedAt: new Date().toISOString(),
  };
  return base;
}

export function getTerminalModeCapabilities(
  mode: TerminalMode,
): TerminalModeCapabilities {
  return TERMINAL_MODE_CAPABILITIES[mode];
}

export function modeShowsModule(
  mode: TerminalMode,
  module: TerminalModule,
): boolean {
  return getTerminalModeCapabilities(mode).visibleModules.includes(module);
}

export function modeAllowsAction(
  mode: TerminalMode,
  action: TerminalAction,
): boolean {
  return getTerminalModeCapabilities(mode).actions[action];
}
