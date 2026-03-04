import { isRecord } from "../lib";

export const TERMINAL_MODE_STORAGE_KEY = "terminal-mode:v1";
export const TERMINAL_MODE_OPTIONS = ["regular", "degen", "custom"] as const;

export type TerminalMode = (typeof TERMINAL_MODE_OPTIONS)[number];

export type TerminalModule =
  | "market"
  | "wallet"
  | "macro_radar"
  | "macro_fred"
  | "macro_etf"
  | "macro_stablecoin"
  | "macro_oil";

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
    ],
    actions: {
      quick_trade: true,
      macro_trade: true,
      layout_edit: true,
    },
  },
};

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
