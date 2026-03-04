export type TerminalHotkeyAction =
  | "openPalette"
  | "quickBuy"
  | "quickSell"
  | "focusChart"
  | "focusOrderbook"
  | "focusOrderEntry"
  | "focusTradesTape"
  | "focusPositions"
  | "focusRisk"
  | "resetLayout"
  | "refreshWallet"
  | "openFunding"
  | "tradeSubmit"
  | "tradeCancel"
  | "tradePreset1"
  | "tradePreset2"
  | "tradePreset3";

export type TerminalHotkeyProfileId = "standard" | "precision";

export type TerminalHotkeyBindings = Record<TerminalHotkeyAction, string>;

export type TerminalHotkeyProfile = {
  id: TerminalHotkeyProfileId;
  label: string;
  description: string;
  bindings: TerminalHotkeyBindings;
};

export type HotkeyLikeEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export const TERMINAL_HOTKEY_PROFILE_STORAGE_KEY = "terminal.hotkey.profile.v1";

export const DEFAULT_TERMINAL_HOTKEY_PROFILE_ID: TerminalHotkeyProfileId =
  "standard";

const STANDARD_BINDINGS: TerminalHotkeyBindings = {
  openPalette: "mod+k",
  quickBuy: "b",
  quickSell: "s",
  focusChart: "1",
  focusOrderbook: "2",
  focusOrderEntry: "3",
  focusTradesTape: "4",
  focusPositions: "5",
  focusRisk: "6",
  resetLayout: "r",
  refreshWallet: "shift+r",
  openFunding: "f",
  tradeSubmit: "mod+enter",
  tradeCancel: "escape",
  tradePreset1: "alt+1",
  tradePreset2: "alt+2",
  tradePreset3: "alt+3",
};

const PRECISION_BINDINGS: TerminalHotkeyBindings = {
  openPalette: "mod+k",
  quickBuy: "shift+b",
  quickSell: "shift+s",
  focusChart: "alt+1",
  focusOrderbook: "alt+2",
  focusOrderEntry: "alt+3",
  focusTradesTape: "alt+4",
  focusPositions: "alt+5",
  focusRisk: "alt+6",
  resetLayout: "shift+l",
  refreshWallet: "shift+r",
  openFunding: "shift+f",
  tradeSubmit: "mod+enter",
  tradeCancel: "escape",
  tradePreset1: "alt+1",
  tradePreset2: "alt+2",
  tradePreset3: "alt+3",
};

export const TERMINAL_HOTKEY_PROFILES: Record<
  TerminalHotkeyProfileId,
  TerminalHotkeyProfile
> = {
  standard: {
    id: "standard",
    label: "Standard",
    description: "Fast single-key workflow for active trading.",
    bindings: STANDARD_BINDINGS,
  },
  precision: {
    id: "precision",
    label: "Precision",
    description: "Modifier-heavy bindings to reduce accidental triggers.",
    bindings: PRECISION_BINDINGS,
  },
};

export const TERMINAL_HOTKEY_ACTION_LABELS: Record<
  TerminalHotkeyAction,
  string
> = {
  openPalette: "Open command palette",
  quickBuy: "Open buy ticket",
  quickSell: "Open sell ticket",
  focusChart: "Focus chart panel",
  focusOrderbook: "Focus orderbook panel",
  focusOrderEntry: "Focus order-entry panel",
  focusTradesTape: "Focus trades tape panel",
  focusPositions: "Focus positions panel",
  focusRisk: "Focus account risk panel",
  resetLayout: "Reset dashboard layout",
  refreshWallet: "Refresh terminal data",
  openFunding: "Open funding modal",
  tradeSubmit: "Submit active trade ticket",
  tradeCancel: "Cancel active trade ticket",
  tradePreset1: "Apply preset #1 in trade ticket",
  tradePreset2: "Apply preset #2 in trade ticket",
  tradePreset3: "Apply preset #3 in trade ticket",
};

function normalizeKey(value: string): string {
  const key = value.trim().toLowerCase();
  if (!key) return "";
  if (key === "esc") return "escape";
  if (key === "return") return "enter";
  if (key === "spacebar") return "space";
  if (key === " ") return "space";
  return key;
}

export function resolveTerminalHotkeyProfileId(
  raw: unknown,
): TerminalHotkeyProfileId {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "standard" || value === "precision") {
    return value;
  }
  return DEFAULT_TERMINAL_HOTKEY_PROFILE_ID;
}

export function formatHotkeyChord(chord: string): string {
  const tokens = chord
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const labels = tokens.map((token) => {
    if (token === "mod") return "Cmd/Ctrl";
    if (token === "ctrl") return "Ctrl";
    if (token === "meta") return "Cmd";
    if (token === "alt") return "Alt";
    if (token === "shift") return "Shift";
    if (token === "escape") return "Esc";
    if (token === "enter") return "Enter";
    if (token === "space") return "Space";
    return token.length === 1 ? token.toUpperCase() : token;
  });
  return labels.join("+");
}

export function toAriaKeyShortcuts(chord: string): string {
  const tokens = chord
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length < 1) return "";

  const modifiers = tokens.filter((token) =>
    ["mod", "ctrl", "meta", "alt", "shift"].includes(token),
  );
  const keyToken = tokens.find(
    (token) => !["mod", "ctrl", "meta", "alt", "shift"].includes(token),
  );
  if (!keyToken) return "";

  const baseKey = keyToken.length === 1 ? keyToken.toUpperCase() : keyToken;
  const baseMods = modifiers.filter((token) => token !== "mod");
  const withBaseMods = [...baseMods];

  if (modifiers.includes("mod")) {
    const ctrlCombo = [...withBaseMods, "Control", baseKey].join("+");
    const metaCombo = [...withBaseMods, "Meta", baseKey].join("+");
    return `${ctrlCombo} ${metaCombo}`;
  }

  const normalizedMods = withBaseMods.map((token) => {
    if (token === "ctrl") return "Control";
    if (token === "meta") return "Meta";
    if (token === "alt") return "Alt";
    if (token === "shift") return "Shift";
    return token;
  });

  return [...normalizedMods, baseKey].join("+");
}

export function matchesHotkey(event: HotkeyLikeEvent, chord: string): boolean {
  const tokens = chord
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length < 1) return false;

  let expectMod = false;
  let expectCtrl = false;
  let expectMeta = false;
  let expectAlt = false;
  let expectShift = false;
  let keyToken = "";

  for (const token of tokens) {
    if (token === "mod") {
      expectMod = true;
      continue;
    }
    if (token === "ctrl") {
      expectCtrl = true;
      continue;
    }
    if (token === "meta") {
      expectMeta = true;
      continue;
    }
    if (token === "alt") {
      expectAlt = true;
      continue;
    }
    if (token === "shift") {
      expectShift = true;
      continue;
    }
    keyToken = token;
  }

  if (!keyToken) return false;

  const eventKey = normalizeKey(event.key);
  const expectedKey = normalizeKey(keyToken);
  if (!eventKey || eventKey !== expectedKey) return false;

  const hasMod = event.ctrlKey || event.metaKey;
  if (expectMod) {
    if (!hasMod) return false;
  } else {
    if (expectCtrl !== event.ctrlKey) return false;
    if (expectMeta !== event.metaKey) return false;
  }

  if (expectAlt !== event.altKey) return false;
  if (expectShift !== event.shiftKey) return false;

  if (expectMod && expectCtrl && !event.ctrlKey) return false;
  if (expectMod && expectMeta && !event.metaKey) return false;

  return true;
}
