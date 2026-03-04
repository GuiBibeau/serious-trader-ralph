"use client";

import { usePrivy } from "@privy-io/react-auth";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../cn";
import {
  type AccountWallet,
  apiFetchJson,
  type BalanceResponse,
  BTN_SECONDARY,
  isRecord,
} from "../lib";
import { PresenceCard } from "../motion";
import {
  type AccountRiskLevel,
  type AccountRiskSnapshot,
  buildAccountRiskSnapshot,
  resolveAccountRiskThresholds,
} from "./components/account-risk";
import {
  clearDashboardGridLayouts,
  DashboardGrid,
  hasCustomDashboardGridLayouts,
} from "./components/dashboard-grid";
import {
  buildDepthChartModel,
  findNearestDepthPoint,
} from "./components/depth-chart";
import { ExecutionInspectorDrawer } from "./components/execution-inspector-drawer";
import {
  buildFillLedgerCsv,
  type FillLedgerRow,
  type FillLedgerSideFilter,
  type FillLedgerStatusFilter,
  filterFillLedgerRows,
  paginateFillLedgerRows,
} from "./components/fills-ledger";
import {
  buildLivePositions,
  type PositionFill,
  summarizeLivePositions,
} from "./components/live-positions";
import { MacroEtfWidget } from "./components/macro-etf-widget";
import { MacroFredWidget } from "./components/macro-fred-widget";
import { MacroOilWidget } from "./components/macro-oil-widget";
import { MacroRadarWidget } from "./components/macro-radar-widget";
import { MacroStablecoinWidget } from "./components/macro-stablecoin-widget";
import {
  amendOpenOrder as applyAmendOpenOrder,
  cancelAllOpenOrders as applyCancelAllOpenOrders,
  cancelOpenOrder as applyCancelOpenOrder,
  executeOpenOrderSlice,
  type OpenOrderRow,
  type OpenOrderStatus,
  promotePendingOrders,
  queueOpenOrder,
} from "./components/open-orders";
import { buildOrderbookLadder } from "./components/orderbook-ladder";
import {
  type RealtimeTradeTick,
  type TerminalRealtimeState,
  useTerminalRealtimeTransport,
} from "./components/realtime-transport";
import {
  formatAgeMs,
  formatPrice,
  type MarketState,
  useMarketFeed,
} from "./components/sol-market-feed";
import {
  TerminalCommandPalette,
  type TerminalCommandPaletteCommand,
} from "./components/terminal-command-palette";
import {
  DEFAULT_TERMINAL_HOTKEY_PROFILE_ID,
  formatHotkeyChord,
  matchesHotkey,
  resolveTerminalHotkeyProfileId,
  TERMINAL_HOTKEY_ACTION_LABELS,
  TERMINAL_HOTKEY_PROFILE_STORAGE_KEY,
  TERMINAL_HOTKEY_PROFILES,
  type TerminalHotkeyAction,
  type TerminalHotkeyBindings,
  type TerminalHotkeyProfileId,
} from "./components/terminal-hotkeys";
import { TerminalStatusBar } from "./components/terminal-status-bar";
import { createTradeIntent, type TradeIntent } from "./components/trade-intent";
import {
  DEFAULT_PAIR_ID,
  getPairConfig,
  type PairId,
  SUPPORTED_PAIRS,
  TOKEN_CONFIGS,
} from "./components/trade-pairs";
import type {
  QueuedTerminalOrder,
  TradeTicketCompletion,
} from "./components/trade-ticket-modal";
import {
  countMissingTradeTicks,
  filterTradeTicks,
  type TapeDisplayMode,
  type TapeSideFilter,
} from "./components/trades-tape";
import {
  buildCustomWorkspaceLayoutStorageKey,
  CUSTOM_WORKSPACE_ID_DEFAULT,
  CUSTOM_WORKSPACE_MODULES,
  type CustomWorkspaceStore,
  createWorkspacePreset,
  parseCustomWorkspaceStore,
  readCustomWorkspaceStoreFromLocalStorage,
  resolveActiveWorkspace,
  sanitizeWorkspaceModules,
  type WorkspaceModuleVisibility,
  writeCustomWorkspaceStoreToLocalStorage,
} from "./components/workspace-presets";
import { useDashboard } from "./context";
import {
  getTerminalModeCapabilities,
  mergeProfileWithTerminalMode,
  modeAllowsAction,
  modeShowsModule,
  readLocalTerminalMode,
  readTerminalModeFromProfile,
  resolveDefaultTerminalMode,
  type TerminalMode,
  type TerminalModule,
  writeLocalTerminalMode,
} from "./terminal-modes";

type Balances = BalanceResponse;
type ExecutionActivityRow = {
  id: string;
  ts: number;
  requestId: string;
  receiptId: string | null;
  pairId: PairId;
  direction: "buy" | "sell";
  leg: string;
  lane: "fast" | "protected" | "safe";
  baseFilledUi: number;
  quoteFilledUi: number;
  fillPrice: number | null;
  feeUi: number | null;
  feeSymbol: string | null;
  status: string;
  provider: string | null;
  signature: string | null;
  qualitySummary: string;
};

type LadderPrefill = {
  side: "buy" | "sell";
  price: number;
  size: number;
  seq: number;
  ts: number;
};

type TerminalFocusablePanelId =
  | "chart"
  | "orderbook"
  | "order_entry"
  | "trades_tape"
  | "positions"
  | "account_risk";

const FOCUSABLE_PANEL_ORDER: readonly TerminalFocusablePanelId[] = [
  "chart",
  "orderbook",
  "order_entry",
  "trades_tape",
  "positions",
  "account_risk",
];

const FOCUSABLE_PANEL_LABELS: Record<TerminalFocusablePanelId, string> = {
  chart: "Chart panel",
  orderbook: "Orderbook panel",
  order_entry: "Order entry panel",
  trades_tape: "Trades tape panel",
  positions: "Positions panel",
  account_risk: "Account risk panel",
};

const PANEL_ACTION_BY_ID: Record<
  TerminalFocusablePanelId,
  Extract<
    TerminalHotkeyAction,
    | "focusChart"
    | "focusOrderbook"
    | "focusOrderEntry"
    | "focusTradesTape"
    | "focusPositions"
    | "focusRisk"
  >
> = {
  chart: "focusChart",
  orderbook: "focusOrderbook",
  order_entry: "focusOrderEntry",
  trades_tape: "focusTradesTape",
  positions: "focusPositions",
  account_risk: "focusRisk",
};

const CUSTOM_MODULE_LABELS: Record<TerminalModule, string> = {
  market: "Market",
  wallet: "Wallet",
  macro_radar: "Macro Radar",
  macro_fred: "Macro FRED",
  macro_etf: "Macro ETF",
  macro_stablecoin: "Stablecoin",
  macro_oil: "Oil",
};

function buildModeLayoutStorageKey(input: {
  mode: TerminalMode;
  workspaceId: string;
}): string {
  if (input.mode === "custom") {
    return buildCustomWorkspaceLayoutStorageKey(input.workspaceId);
  }
  return `dashboard-grid-layouts:v6:${input.mode}`;
}

const FundingModal = dynamic(
  () => import("../funding-modal").then((mod) => mod.FundingModal),
  { ssr: false },
);

const TradeTicketModal = dynamic(
  () =>
    import("./components/trade-ticket-modal").then(
      (mod) => mod.TradeTicketModal,
    ),
  { ssr: false },
);

const MarketChart = dynamic<{
  className?: string;
  market: MarketState;
  pairLabel: string;
}>(() => import("./components/market-chart").then((mod) => mod.MarketChart), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500" />
    </div>
  ),
});

function toNumericString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  return null;
}

function parseAtomic(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function formatAtomicTokenBalance(
  atomicRaw: string | null | undefined,
  decimals: number,
  maxFractionDigits = 6,
): string {
  if (!atomicRaw || !/^\d+$/.test(atomicRaw)) return "0.00";
  try {
    const atomic = BigInt(atomicRaw);
    const safeDecimals = Math.max(0, Math.min(18, Math.floor(decimals)));
    const scale = BigInt(10) ** BigInt(safeDecimals);
    const whole = atomic / scale;
    if (safeDecimals === 0) return whole.toString();

    const fractionRaw = (atomic % scale).toString().padStart(safeDecimals, "0");
    const shownFraction = fractionRaw.slice(
      0,
      Math.min(safeDecimals, maxFractionDigits),
    );
    const trimmed = shownFraction.replace(/0+$/, "");
    if (trimmed.length > 0) return `${whole.toString()}.${trimmed}`;
    return `${whole.toString()}.00`;
  } catch {
    return "0.00";
  }
}

function parseAccountWallet(payload: unknown): AccountWallet | null {
  if (!isRecord(payload)) return null;
  const signerType = String(payload.signerType ?? "").trim();
  const privyWalletId = String(payload.privyWalletId ?? "").trim();
  const walletAddress = String(payload.walletAddress ?? "").trim();
  if (!signerType || !privyWalletId || !walletAddress) return null;
  return {
    signerType,
    privyWalletId,
    walletAddress,
    walletMigratedAt:
      typeof payload.walletMigratedAt === "string"
        ? payload.walletMigratedAt
        : null,
  };
}

function parseUserProfile(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  const user = isRecord(payload.user) ? payload.user : null;
  if (!user) return null;
  return isRecord(user.profile) ? user.profile : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function parseOpenOrderExecutionMarker(reason: string): {
  orderId: string;
  fraction: 0.5 | 1;
} | null {
  const match = reason.match(/\[order:([A-Za-z0-9_-]+);fraction:(0\.5|1)\]/);
  if (!match) return null;
  const orderId = match[1] ?? "";
  const fraction = match[2] === "0.5" ? 0.5 : 1;
  if (!orderId) return null;
  return { orderId, fraction };
}

const FILLS_LEDGER_PAGE_SIZE = 8;
const ACCOUNT_RISK_THRESHOLDS = resolveAccountRiskThresholds();

export default function AppPage() {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <main>
        <div className="sticky top-0 z-10 bg-paper border-b border-border py-4">
          <div className="w-[min(1120px,92vw)] mx-auto flex items-center justify-between gap-4">
            <a href="/" className="text-sm font-semibold tracking-tight">
              Trader Ralph
            </a>
          </div>
        </div>
        <section className="py-[clamp(3rem,6vw,6rem)] border-t border-border">
          <div className="w-[min(1120px,92vw)] mx-auto">
            <h1>Control room</h1>
            <div className="card card-flat p-6 mt-8">
              <p className="label">Config</p>
              <h2 className="mt-2.5">Missing Privy app id</h2>
              <p className="text-muted mt-3.5">
                Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in{" "}
                <code>apps/portal/.env.local</code>.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return <ControlRoom />;
}

function ControlRoom() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const router = useRouter();

  const [wallet, setWallet] = useState<AccountWallet | null>(null);
  const [walletBalances, setWalletBalances] = useState<Balances | null>(null);
  const [tokenBalancesByMint, setTokenBalancesByMint] = useState<
    Record<string, string>
  >({});
  const [walletBalanceError, setWalletBalanceError] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeIntent, setTradeIntent] = useState<TradeIntent | null>(null);
  const [selectedPairId, setSelectedPairId] = useState<PairId>(DEFAULT_PAIR_ID);
  const [gridRevision, setGridRevision] = useState(0);
  const [hasCustomGridLayout, setHasCustomGridLayout] = useState(false);
  const [terminalMode, setTerminalMode] = useState<TerminalMode>(() =>
    resolveDefaultTerminalMode(process.env.NEXT_PUBLIC_TERMINAL_DEFAULT_MODE),
  );
  const [terminalModeSaving, setTerminalModeSaving] = useState(false);
  const [userProfile, setUserProfile] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [recentExecutions, setRecentExecutions] = useState<
    ExecutionActivityRow[]
  >([]);
  const [openOrders, setOpenOrders] = useState<OpenOrderRow[]>([]);
  const [ladderPrefill, setLadderPrefill] = useState<LadderPrefill | null>(
    null,
  );
  const [customWorkspaceStore, setCustomWorkspaceStore] =
    useState<CustomWorkspaceStore>(() =>
      readCustomWorkspaceStoreFromLocalStorage(),
    );
  const [focusedPanelId, setFocusedPanelId] =
    useState<TerminalFocusablePanelId | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [hotkeyProfileId, setHotkeyProfileId] =
    useState<TerminalHotkeyProfileId>(DEFAULT_TERMINAL_HOTKEY_PROFILE_ID);
  const panelRefs = useRef<
    Partial<Record<TerminalFocusablePanelId, HTMLDivElement | null>>
  >({});
  const panelFocusTimerRef = useRef<number | null>(null);
  const terminalModeRef = useRef<TerminalMode>(terminalMode);
  const fallbackModePersistControllerRef = useRef<AbortController | null>(null);
  const modeCapabilities = getTerminalModeCapabilities(terminalMode);
  const activeCustomWorkspace = useMemo(
    () => resolveActiveWorkspace(customWorkspaceStore),
    [customWorkspaceStore],
  );
  const customWorkspaceModules = useMemo<WorkspaceModuleVisibility>(
    () => sanitizeWorkspaceModules(activeCustomWorkspace.modules),
    [activeCustomWorkspace.modules],
  );
  const isCustomMode = terminalMode === "custom";
  const canQuickTrade = modeAllowsAction(terminalMode, "quick_trade");
  const canMacroTrade = modeAllowsAction(terminalMode, "macro_trade");
  const canLayoutEdit = modeAllowsAction(terminalMode, "layout_edit");
  const showMarketModule =
    modeShowsModule(terminalMode, "market") &&
    (!isCustomMode || customWorkspaceModules.market);
  const showWalletModule =
    modeShowsModule(terminalMode, "wallet") &&
    (!isCustomMode || customWorkspaceModules.wallet);
  const showMacroRadarModule =
    modeShowsModule(terminalMode, "macro_radar") &&
    (!isCustomMode || customWorkspaceModules.macro_radar);
  const showMacroFredModule =
    modeShowsModule(terminalMode, "macro_fred") &&
    (!isCustomMode || customWorkspaceModules.macro_fred);
  const showMacroEtfModule =
    modeShowsModule(terminalMode, "macro_etf") &&
    (!isCustomMode || customWorkspaceModules.macro_etf);
  const showMacroStablecoinModule =
    modeShowsModule(terminalMode, "macro_stablecoin") &&
    (!isCustomMode || customWorkspaceModules.macro_stablecoin);
  const showMacroOilModule =
    modeShowsModule(terminalMode, "macro_oil") &&
    (!isCustomMode || customWorkspaceModules.macro_oil);
  const layoutStorageKey = useMemo(
    () =>
      buildModeLayoutStorageKey({
        mode: terminalMode,
        workspaceId: activeCustomWorkspace.id,
      }),
    [activeCustomWorkspace.id, terminalMode],
  );
  const hotkeyProfile = useMemo(
    () => TERMINAL_HOTKEY_PROFILES[hotkeyProfileId],
    [hotkeyProfileId],
  );
  const hotkeyBindings: TerminalHotkeyBindings = hotkeyProfile.bindings;
  const panelVisibility = useMemo<Record<TerminalFocusablePanelId, boolean>>(
    () => ({
      chart: showMarketModule,
      orderbook: showMarketModule,
      order_entry: showMarketModule,
      trades_tape: showMarketModule,
      positions: showMarketModule,
      account_risk: showWalletModule,
    }),
    [showMarketModule, showWalletModule],
  );

  useEffect(() => {
    terminalModeRef.current = terminalMode;
  }, [terminalMode]);

  useEffect(
    () => () => {
      fallbackModePersistControllerRef.current?.abort();
      if (panelFocusTimerRef.current !== null) {
        window.clearTimeout(panelFocusTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(
      TERMINAL_HOTKEY_PROFILE_STORAGE_KEY,
    );
    setHotkeyProfileId(resolveTerminalHotkeyProfileId(stored));
  }, []);

  useEffect(() => {
    if (!tradeOpen) return;
    setCommandPaletteOpen(false);
  }, [tradeOpen]);

  const resetDashboardLayout = useCallback(() => {
    clearDashboardGridLayouts(layoutStorageKey);
    setHasCustomGridLayout(false);
    setGridRevision((value) => value + 1);
  }, [layoutStorageKey]);

  const updateCustomWorkspaceStore = useCallback(
    (
      updater: (current: CustomWorkspaceStore) => CustomWorkspaceStore,
    ): void => {
      setCustomWorkspaceStore((current) => {
        const next = parseCustomWorkspaceStore(updater(current));
        writeCustomWorkspaceStoreToLocalStorage(next);
        return next;
      });
    },
    [],
  );

  const setActiveCustomWorkspace = useCallback(
    (workspaceId: string): void => {
      updateCustomWorkspaceStore((current) => ({
        ...current,
        activeId: workspaceId,
      }));
    },
    [updateCustomWorkspaceStore],
  );

  const createCustomWorkspace = useCallback((): void => {
    const suggested = `Workspace ${customWorkspaceStore.presets.length + 1}`;
    const raw = window.prompt("New workspace name", suggested);
    if (raw === null) return;
    const name = raw.trim() || suggested;
    const nowIso = new Date().toISOString();
    const preset = createWorkspacePreset({
      name,
      nowIso,
      modules: customWorkspaceModules,
    });
    const sourceKey = buildCustomWorkspaceLayoutStorageKey(
      activeCustomWorkspace.id,
    );
    const targetKey = buildCustomWorkspaceLayoutStorageKey(preset.id);
    if (sourceKey !== targetKey) {
      try {
        const source = window.localStorage.getItem(sourceKey);
        if (source) {
          window.localStorage.setItem(targetKey, source);
        } else {
          clearDashboardGridLayouts(targetKey);
        }
      } catch {
        // Ignore storage failures while still creating preset metadata.
      }
    }
    updateCustomWorkspaceStore((current) => ({
      ...current,
      activeId: preset.id,
      presets: [...current.presets, preset],
    }));
    setGridRevision((value) => value + 1);
  }, [
    activeCustomWorkspace.id,
    customWorkspaceModules,
    customWorkspaceStore.presets.length,
    updateCustomWorkspaceStore,
  ]);

  const renameCustomWorkspace = useCallback((): void => {
    const active = activeCustomWorkspace;
    const raw = window.prompt("Rename workspace", active.name);
    if (raw === null) return;
    const name = raw.trim();
    if (!name) return;
    updateCustomWorkspaceStore((current) => ({
      ...current,
      presets: current.presets.map((preset) =>
        preset.id === active.id
          ? {
              ...preset,
              name,
              updatedAtIso: new Date().toISOString(),
            }
          : preset,
      ),
    }));
  }, [activeCustomWorkspace, updateCustomWorkspaceStore]);

  const deleteCustomWorkspace = useCallback((): void => {
    const active = activeCustomWorkspace;
    if (active.id === CUSTOM_WORKSPACE_ID_DEFAULT) {
      window.alert("Default workspace cannot be deleted.");
      return;
    }
    if (customWorkspaceStore.presets.length <= 1) return;
    const confirmed = window.confirm(
      `Delete workspace "${active.name}" and its saved layout?`,
    );
    if (!confirmed) return;
    clearDashboardGridLayouts(buildCustomWorkspaceLayoutStorageKey(active.id));
    updateCustomWorkspaceStore((current) => {
      const remaining = current.presets.filter(
        (preset) => preset.id !== active.id,
      );
      const fallback =
        remaining[0] ??
        createWorkspacePreset({
          id: CUSTOM_WORKSPACE_ID_DEFAULT,
          name: "Default workspace",
        });
      return {
        activeId: fallback.id,
        presets: remaining.length > 0 ? remaining : [fallback],
      };
    });
    setGridRevision((value) => value + 1);
  }, [
    activeCustomWorkspace,
    customWorkspaceStore.presets.length,
    updateCustomWorkspaceStore,
  ]);

  const setCustomWorkspaceModuleEnabled = useCallback(
    (module: TerminalModule, enabled: boolean): void => {
      if (!isCustomMode) return;
      updateCustomWorkspaceStore((current) => ({
        ...current,
        presets: current.presets.map((preset) => {
          if (preset.id !== current.activeId) return preset;
          const nextModules = sanitizeWorkspaceModules({
            ...preset.modules,
            [module]: enabled,
          });
          return {
            ...preset,
            modules: nextModules,
            updatedAtIso: new Date().toISOString(),
          };
        }),
      }));
    },
    [isCustomMode, updateCustomWorkspaceStore],
  );

  const updateHotkeyProfile = useCallback(
    (nextProfile: TerminalHotkeyProfileId): void => {
      setHotkeyProfileId(nextProfile);
      window.localStorage.setItem(
        TERMINAL_HOTKEY_PROFILE_STORAGE_KEY,
        nextProfile,
      );
    },
    [],
  );

  const setPanelRef = useCallback(
    (panelId: TerminalFocusablePanelId) =>
      (node: HTMLDivElement | null): void => {
        panelRefs.current[panelId] = node;
      },
    [],
  );

  const focusPanel = useCallback(
    (panelId: TerminalFocusablePanelId): boolean => {
      const node = panelRefs.current[panelId];
      if (!node) return false;
      node.focus({ preventScroll: true });
      node.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth",
      });
      setFocusedPanelId(panelId);
      if (panelFocusTimerRef.current !== null) {
        window.clearTimeout(panelFocusTimerRef.current);
      }
      panelFocusTimerRef.current = window.setTimeout(() => {
        setFocusedPanelId((current) => (current === panelId ? null : current));
        panelFocusTimerRef.current = null;
      }, 1600);
      return true;
    },
    [],
  );

  const panelClassName = useCallback(
    (panelId: TerminalFocusablePanelId, baseClassName: string) =>
      cn(
        baseClassName,
        "outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-400/80",
        focusedPanelId === panelId && "ring-2 ring-inset ring-emerald-500/60",
      ),
    [focusedPanelId],
  );

  useEffect(() => {
    setCustomWorkspaceStore(readCustomWorkspaceStoreFromLocalStorage());
  }, []);

  useEffect(() => {
    setHasCustomGridLayout(hasCustomDashboardGridLayouts(layoutStorageKey));
  }, [layoutStorageKey]);

  const persistTerminalMode = useCallback(
    async (input: {
      mode: TerminalMode;
      profileSnapshot: Record<string, unknown> | null;
      source: "manual" | "local_fallback" | "default_fallback";
      previousMode: TerminalMode | null;
      emitTelemetry: boolean;
    }): Promise<Record<string, unknown> | null> => {
      if (!authenticated) return input.profileSnapshot;
      const token = await getAccessToken();
      if (!token) return input.profileSnapshot;

      if (input.source === "manual") {
        fallbackModePersistControllerRef.current?.abort();
        fallbackModePersistControllerRef.current = null;
      } else {
        fallbackModePersistControllerRef.current?.abort();
        fallbackModePersistControllerRef.current = new AbortController();
      }
      const signal = fallbackModePersistControllerRef.current?.signal;

      if (input.source !== "manual" && terminalModeRef.current !== input.mode) {
        return null;
      }

      let mergeBase = input.profileSnapshot;
      try {
        const latestPayload = await apiFetchJson("/api/me", token, {
          method: "GET",
          ...(signal ? { signal } : {}),
        });
        const latestProfile = parseUserProfile(latestPayload);
        if (latestProfile) mergeBase = latestProfile;
      } catch {
        if (signal?.aborted) return null;
      }

      if (input.source !== "manual" && terminalModeRef.current !== input.mode) {
        return null;
      }

      const mergedProfile = mergeProfileWithTerminalMode(mergeBase, {
        mode: input.mode,
        source: input.source,
      });
      await apiFetchJson("/api/me/profile", token, {
        method: "PATCH",
        body: JSON.stringify({
          profile: mergedProfile,
        }),
        ...(signal ? { signal } : {}),
      });
      if (signal?.aborted) return null;

      if (input.emitTelemetry) {
        await apiFetchJson("/api/events", token, {
          method: "POST",
          body: JSON.stringify({
            name: "terminal_mode_changed",
            properties: {
              from: input.previousMode,
              to: input.mode,
              source: input.source,
            },
          }),
        }).catch(() => {
          // Do not block UX on telemetry write failures.
        });
      }
      return mergedProfile;
    },
    [authenticated, getAccessToken],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!authenticated) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const payload = await apiFetchJson("/api/me", token, { method: "GET" });

      const walletRaw = isRecord(payload) ? payload.wallet : null;
      setWallet(parseAccountWallet(walletRaw));
      const profile = parseUserProfile(payload);
      setUserProfile(profile);
      const serverMode = readTerminalModeFromProfile(profile);
      const localMode = readLocalTerminalMode();
      const defaultMode = resolveDefaultTerminalMode(
        process.env.NEXT_PUBLIC_TERMINAL_DEFAULT_MODE,
      );
      const resolvedMode = serverMode ?? localMode ?? defaultMode;
      setTerminalMode(resolvedMode);
      // Keep local fallback synced with chosen mode.
      writeLocalTerminalMode(resolvedMode);
      if (!serverMode) {
        const source = localMode ? "local_fallback" : "default_fallback";
        void persistTerminalMode({
          mode: resolvedMode,
          profileSnapshot: profile,
          source,
          previousMode: null,
          emitTelemetry: false,
        })
          .then((mergedProfile) => {
            if (mergedProfile) setUserProfile(mergedProfile);
          })
          .catch(() => {
            // Ignore fallback persistence failures.
          });
      }
      setLoaded(true);
    } catch (error) {
      setLoaded(true);
      setMessage(error instanceof Error ? error.message : "failed-to-load");
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken, persistTerminalMode]);

  const refreshWalletBalances = useCallback(async (): Promise<void> => {
    if (!authenticated || !wallet) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const payload = await apiFetchJson("/api/wallet/balance", token, {
        method: "GET",
      });
      const balancesRaw = isRecord(payload) ? payload.balances : null;
      const hasError =
        isRecord(payload) &&
        (Array.isArray(payload.errors) ||
          (typeof payload.errors === "string" && payload.errors.trim() !== ""));
      if (hasError) {
        const errorPayload = (payload as Record<string, unknown>).errors;
        if (typeof errorPayload === "string") {
          setWalletBalanceError(errorPayload);
        } else if (Array.isArray(errorPayload)) {
          setWalletBalanceError(
            errorPayload.map((item) => String(item)).join(", "),
          );
        } else {
          setWalletBalanceError("Invalid balance payload");
        }
        return;
      }

      if (
        isRecord(balancesRaw) &&
        isRecord(balancesRaw.sol) &&
        isRecord(balancesRaw.usdc)
      ) {
        const solLamports = toNumericString(
          (balancesRaw.sol as Record<string, unknown>).lamports,
        );
        const usdcAtomic = toNumericString(
          (balancesRaw.usdc as Record<string, unknown>).atomic,
        );
        setWalletBalances({
          sol: { lamports: solLamports ?? "0" },
          usdc: { atomic: usdcAtomic ?? "0" },
        });
        const nextTokenBalancesByMint: Record<string, string> = {
          [TOKEN_CONFIGS.SOL.mint]: solLamports ?? "0",
          [TOKEN_CONFIGS.USDC.mint]: usdcAtomic ?? "0",
        };
        if (Array.isArray(balancesRaw.tokens)) {
          for (const tokenRow of balancesRaw.tokens) {
            if (!isRecord(tokenRow)) continue;
            const mint = String(tokenRow.mint ?? "").trim();
            const atomic = toNumericString(tokenRow.atomic);
            if (!mint || atomic === null) continue;
            nextTokenBalancesByMint[mint] = atomic;
          }
        }
        setTokenBalancesByMint(nextTokenBalancesByMint);
        setWalletBalanceError(null);
        return;
      }
      setWalletBalanceError("Invalid balance payload");
    } catch {
      setWalletBalanceError("Failed to fetch wallet balance");
    }
  }, [authenticated, getAccessToken, wallet]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void refresh();
  }, [ready, authenticated, refresh]);

  useEffect(() => {
    if (!ready || authenticated) return;
    router.replace("/login");
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (!wallet) {
      setWalletBalances(null);
      setTokenBalancesByMint({});
      setWalletBalanceError(null);
      return;
    }
    void refreshWalletBalances();
  }, [wallet, refreshWalletBalances]);

  const hasWallet = wallet !== null;
  const selectedPair = getPairConfig(selectedPairId);
  const marketFeed = useMarketFeed(selectedPairId);
  const realtimeTransport = useTerminalRealtimeTransport({
    pairId: selectedPairId,
    walletAddress: wallet?.walletAddress ?? null,
    getAccessToken,
    fallbackPrice: marketFeed.latestPrice,
  });
  const accountRiskSnapshot = useMemo<AccountRiskSnapshot>(() => {
    const baseToken = TOKEN_CONFIGS[selectedPair.baseSymbol];
    const quoteToken = TOKEN_CONFIGS[selectedPair.quoteSymbol];
    const baseDisplay = formatAtomicTokenBalance(
      tokenBalancesByMint[baseToken.mint] ?? "0",
      baseToken.decimals,
      9,
    );
    const quoteDisplay = formatAtomicTokenBalance(
      tokenBalancesByMint[quoteToken.mint] ?? "0",
      quoteToken.decimals,
      9,
    );
    const baseQty = Number(baseDisplay);
    const quoteQty = Number(quoteDisplay);
    return buildAccountRiskSnapshot({
      baseQty: Number.isFinite(baseQty) ? baseQty : null,
      quoteQty: Number.isFinite(quoteQty) ? quoteQty : null,
      markPrice:
        marketFeed.latestPrice !== null &&
        Number.isFinite(marketFeed.latestPrice)
          ? marketFeed.latestPrice
          : null,
      thresholds: ACCOUNT_RISK_THRESHOLDS,
    });
  }, [
    marketFeed.latestPrice,
    selectedPair.baseSymbol,
    selectedPair.quoteSymbol,
    tokenBalancesByMint,
  ]);
  const handlePairChange = useCallback((nextPairId: PairId): void => {
    setSelectedPairId(nextPairId);
    setLadderPrefill(null);
  }, []);

  const openTradeTicket = useCallback(
    (intent: TradeIntent): void => {
      if (!hasWallet) {
        setMessage("wallet-unavailable");
        return;
      }
      setTradeIntent(intent);
      setTradeOpen(true);
    },
    [hasWallet],
  );

  const handleOrderQueued = useCallback((order: QueuedTerminalOrder): void => {
    setOpenOrders((current) => queueOpenOrder(current, order));
  }, []);

  const cancelOpenOrder = useCallback((orderId: string): void => {
    setOpenOrders((current) =>
      applyCancelOpenOrder(current, orderId, Date.now()),
    );
  }, []);

  const cancelAllOpenOrders = useCallback((): void => {
    if (openOrders.length === 0) return;
    setOpenOrders((current) => applyCancelAllOpenOrders(current, Date.now()));
  }, [openOrders.length]);

  const amendOpenOrder = useCallback(
    (orderId: string): void => {
      const target = openOrders.find((order) => order.id === orderId);
      if (!target) return;

      const amountRaw = window.prompt(
        "Amend remaining amount",
        target.remainingAmountUi,
      );
      if (amountRaw === null) return;
      const nextPriceRaw =
        target.orderType === "limit"
          ? window.prompt("Amend limit price", target.limitPriceUi ?? "")
          : window.prompt("Amend trigger price", target.triggerPriceUi ?? "");
      if (nextPriceRaw === null) return;
      setOpenOrders(
        (current) =>
          applyAmendOpenOrder({
            current,
            orderId,
            amountUi: amountRaw,
            priceUi: nextPriceRaw,
            now: Date.now(),
          }).next,
      );
    },
    [openOrders],
  );

  const executeOpenOrder = useCallback(
    (input: { orderId: string; fraction: 0.5 | 1 }): void => {
      const target = openOrders.find((order) => order.id === input.orderId);
      if (!target) return;
      const execution = executeOpenOrderSlice({
        current: openOrders,
        orderId: input.orderId,
        fraction: input.fraction,
        now: Date.now(),
      });
      if (!execution.ok) {
        setOpenOrders(execution.next);
        return;
      }

      const now = Date.now();
      openTradeTicket(
        createTradeIntent(
          target.direction,
          "OPEN_ORDERS_PANEL",
          target.pairId,
          {
            reason: `${target.orderType.toUpperCase()} order manual execution [order:${target.id};fraction:${input.fraction}]`,
            amountUi: execution.executeAmountUi,
            slippageBps: target.slippageBps,
          },
        ),
      );

      setOpenOrders((current) =>
        current.map((order) =>
          order.id === input.orderId
            ? {
                ...order,
                status: "working",
                updatedAt: now,
                lastError: null,
              }
            : order,
        ),
      );
    },
    [openOrders, openTradeTicket],
  );

  useEffect(() => {
    if (openOrders.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setOpenOrders((current) => promotePendingOrders(current, now));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [openOrders.length]);

  const handleLadderPrefill = useCallback((nextPrefill: LadderPrefill) => {
    setLadderPrefill((current) => {
      if (
        current &&
        current.side === nextPrefill.side &&
        current.seq === nextPrefill.seq &&
        current.price === nextPrefill.price
      ) {
        return null;
      }
      return nextPrefill;
    });
  }, []);

  const clearLadderPrefill = useCallback(() => {
    setLadderPrefill(null);
  }, []);

  const buildActionReason = useCallback(
    (action: "buy" | "sell"): string => {
      const base =
        action === "buy"
          ? `Market action: buy ${selectedPair.baseSymbol}`
          : `Market action: reduce ${selectedPair.baseSymbol}`;
      if (!ladderPrefill) return base;
      const modeLabel = ladderPrefill.side === action ? "prefill" : "offset";
      return `${base} • ${modeLabel} ${ladderPrefill.price.toFixed(4)} x ${ladderPrefill.size.toFixed(2)}`;
    },
    [ladderPrefill, selectedPair.baseSymbol],
  );

  const openMarketBuyTrade = useCallback(() => {
    if (!canQuickTrade) return;
    openTradeTicket(
      createTradeIntent("buy", "MARKET_MONITOR", selectedPairId, {
        reason: buildActionReason("buy"),
      }),
    );
  }, [buildActionReason, canQuickTrade, openTradeTicket, selectedPairId]);

  const openMarketSellTrade = useCallback(() => {
    if (!canQuickTrade) return;
    openTradeTicket(
      createTradeIntent("sell", "MARKET_MONITOR", selectedPairId, {
        reason: buildActionReason("sell"),
      }),
    );
  }, [buildActionReason, canQuickTrade, openTradeTicket, selectedPairId]);

  const openFundingModal = useCallback(() => {
    setFundOpen(true);
  }, []);

  const handleTerminalModeChange = useCallback(
    (nextMode: TerminalMode): void => {
      if (nextMode === terminalMode) return;
      const previousMode = terminalMode;
      setTerminalMode(nextMode);
      writeLocalTerminalMode(nextMode);
      setTerminalModeSaving(true);
      void persistTerminalMode({
        mode: nextMode,
        profileSnapshot: userProfile,
        source: "manual",
        previousMode,
        emitTelemetry: true,
      })
        .then((mergedProfile) => {
          if (mergedProfile) setUserProfile(mergedProfile);
        })
        .catch(() => {
          // Keep local mode active even if server persistence fails.
        })
        .finally(() => {
          setTerminalModeSaving(false);
        });
    },
    [persistTerminalMode, terminalMode, userProfile],
  );

  const triggerRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const focusHotkeyActions: Array<{
      panelId: TerminalFocusablePanelId;
      action: TerminalHotkeyAction;
    }> = FOCUSABLE_PANEL_ORDER.map((panelId) => ({
      panelId,
      action: PANEL_ACTION_BY_ID[panelId],
    }));

    function onKeyDown(event: KeyboardEvent): void {
      if (matchesHotkey(event, hotkeyBindings.openPalette)) {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
        return;
      }

      if (commandPaletteOpen) return;
      if (tradeOpen) return;
      if (isTypingTarget(event.target)) return;

      if (matchesHotkey(event, hotkeyBindings.quickBuy)) {
        if (!canQuickTrade) return;
        event.preventDefault();
        openMarketBuyTrade();
        return;
      }

      if (matchesHotkey(event, hotkeyBindings.quickSell)) {
        if (!canQuickTrade) return;
        event.preventDefault();
        openMarketSellTrade();
        return;
      }

      if (matchesHotkey(event, hotkeyBindings.resetLayout)) {
        if (!canLayoutEdit) return;
        event.preventDefault();
        resetDashboardLayout();
        return;
      }

      if (matchesHotkey(event, hotkeyBindings.refreshWallet)) {
        event.preventDefault();
        triggerRefresh();
        return;
      }

      if (matchesHotkey(event, hotkeyBindings.openFunding)) {
        if (!wallet) return;
        event.preventDefault();
        openFundingModal();
        return;
      }

      for (const focusAction of focusHotkeyActions) {
        if (!panelVisibility[focusAction.panelId]) continue;
        const chord = hotkeyBindings[focusAction.action];
        if (!matchesHotkey(event, chord)) continue;
        event.preventDefault();
        focusPanel(focusAction.panelId);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    canLayoutEdit,
    canQuickTrade,
    commandPaletteOpen,
    focusPanel,
    hotkeyBindings,
    openFundingModal,
    openMarketBuyTrade,
    openMarketSellTrade,
    panelVisibility,
    resetDashboardLayout,
    tradeOpen,
    triggerRefresh,
    wallet,
  ]);

  const applyOptimisticTradeBalances = useCallback(
    (trade: TradeTicketCompletion): void => {
      const inAmount = parseAtomic(trade.inAmountAtomic);
      const outAmount = parseAtomic(trade.outAmountAtomic);
      if (inAmount === null || outAmount === null) return;

      setTokenBalancesByMint((current) => {
        const next = { ...current };
        const inputCurrent =
          parseAtomic(next[trade.inputMint] ?? "0") ?? BigInt(0);
        const outputCurrent =
          parseAtomic(next[trade.outputMint] ?? "0") ?? BigInt(0);
        const nextInput = inputCurrent - inAmount;
        next[trade.inputMint] = (
          nextInput > BigInt(0) ? nextInput : BigInt(0)
        ).toString();
        next[trade.outputMint] = (outputCurrent + outAmount).toString();
        return next;
      });

      setWalletBalances((current) => {
        if (!current) return current;

        let nextSol = parseAtomic(current.sol.lamports) ?? BigInt(0);
        let nextUsdc = parseAtomic(current.usdc.atomic) ?? BigInt(0);

        if (trade.inputMint === TOKEN_CONFIGS.SOL.mint) nextSol -= inAmount;
        if (trade.inputMint === TOKEN_CONFIGS.USDC.mint) nextUsdc -= inAmount;

        if (trade.outputMint === TOKEN_CONFIGS.SOL.mint) nextSol += outAmount;
        if (trade.outputMint === TOKEN_CONFIGS.USDC.mint) nextUsdc += outAmount;

        if (nextSol < BigInt(0)) nextSol = BigInt(0);
        if (nextUsdc < BigInt(0)) nextUsdc = BigInt(0);

        return {
          sol: { lamports: nextSol.toString() },
          usdc: { atomic: nextUsdc.toString() },
        };
      });
      setWalletBalanceError(null);
    },
    [],
  );

  const handleTradeComplete = useCallback(
    (trade: TradeTicketCompletion): void => {
      applyOptimisticTradeBalances(trade);
      const openOrderExecution = parseOpenOrderExecutionMarker(trade.reason);
      if (openOrderExecution) {
        setOpenOrders(
          (current) =>
            executeOpenOrderSlice({
              current,
              orderId: openOrderExecution.orderId,
              fraction: openOrderExecution.fraction,
              now: Date.now(),
            }).next,
        );
      }
      setRecentExecutions((current) => {
        const entry: ExecutionActivityRow = {
          id: crypto.randomUUID(),
          ts: Date.now(),
          requestId: trade.requestId,
          receiptId: trade.receiptId,
          pairId: trade.pairId,
          direction: trade.direction,
          leg: `${trade.inputSymbol} -> ${trade.outputSymbol}`,
          lane: trade.lane,
          baseFilledUi: trade.baseFilledUi,
          quoteFilledUi: trade.quoteFilledUi,
          fillPrice: trade.fillPrice,
          feeUi: trade.feeUi,
          feeSymbol: trade.feeSymbol,
          status: trade.status,
          provider: trade.provider,
          signature: trade.signature,
          qualitySummary: `lane ${trade.lane} • sim ${trade.simulationPreference} • slip ${trade.slippageBps} bps • prio ${trade.priorityLevel}`,
        };
        return [entry, ...current].slice(0, 250);
      });
      void refreshWalletBalances();
    },
    [applyOptimisticTradeBalances, refreshWalletBalances],
  );

  useEffect(() => {
    if (!wallet) return;
    const timer = window.setInterval(() => {
      void refreshWalletBalances();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [wallet, refreshWalletBalances]);

  const {
    setWalletBalances: setGlobalWalletBalances,
    setWalletBalanceError: setGlobalWalletBalanceError,
    setFundAction,
    setTerminalMode: setGlobalTerminalMode,
    setTerminalModeSaving: setGlobalTerminalModeSaving,
    setModeAction,
    setRefreshAction,
    setIsRefreshing,
    setShowFundButton,
    setShowBalance,
  } = useDashboard();

  useEffect(() => {
    if (wallet) {
      setGlobalWalletBalances(walletBalances);
      setGlobalWalletBalanceError(walletBalanceError);
    } else {
      setGlobalWalletBalances(null);
      setGlobalWalletBalanceError(null);
    }
    setFundAction(wallet ? openFundingModal : null);
    setGlobalTerminalMode(terminalMode);
    setGlobalTerminalModeSaving(terminalModeSaving);
    setModeAction(handleTerminalModeChange);
    setRefreshAction(triggerRefresh);
    setIsRefreshing(loading);
    setShowFundButton(Boolean(wallet));
    setShowBalance(true);

    return () => {
      setFundAction(null);
      setModeAction(null);
      setRefreshAction(null);
    };
  }, [
    wallet,
    walletBalances,
    walletBalanceError,
    loading,
    setGlobalWalletBalances,
    setGlobalWalletBalanceError,
    setFundAction,
    setGlobalTerminalMode,
    setGlobalTerminalModeSaving,
    setModeAction,
    setRefreshAction,
    setIsRefreshing,
    setShowFundButton,
    setShowBalance,
    openFundingModal,
    terminalMode,
    terminalModeSaving,
    handleTerminalModeChange,
    triggerRefresh,
  ]);

  const tradeTicketHotkeys = useMemo(
    () => ({
      submit: hotkeyBindings.tradeSubmit,
      cancel: hotkeyBindings.tradeCancel,
      preset1: hotkeyBindings.tradePreset1,
      preset2: hotkeyBindings.tradePreset2,
      preset3: hotkeyBindings.tradePreset3,
    }),
    [hotkeyBindings],
  );

  const commandPaletteCommands = useMemo<
    TerminalCommandPaletteCommand[]
  >(() => {
    const commands: TerminalCommandPaletteCommand[] = [
      {
        id: "buy-ticket",
        title: TERMINAL_HOTKEY_ACTION_LABELS.quickBuy,
        description: `Open ${selectedPairId} buy ticket`,
        hotkey: hotkeyBindings.quickBuy,
        keywords: ["trade", "buy", "execute"],
        disabled: !canQuickTrade,
        onSelect: openMarketBuyTrade,
      },
      {
        id: "sell-ticket",
        title: TERMINAL_HOTKEY_ACTION_LABELS.quickSell,
        description: `Open ${selectedPairId} sell ticket`,
        hotkey: hotkeyBindings.quickSell,
        keywords: ["trade", "sell", "execute"],
        disabled: !canQuickTrade,
        onSelect: openMarketSellTrade,
      },
      {
        id: "refresh-data",
        title: TERMINAL_HOTKEY_ACTION_LABELS.refreshWallet,
        description: "Reload profile, wallet balances, and mode state",
        hotkey: hotkeyBindings.refreshWallet,
        keywords: ["refresh", "wallet", "reload"],
        onSelect: triggerRefresh,
      },
      {
        id: "open-funding",
        title: TERMINAL_HOTKEY_ACTION_LABELS.openFunding,
        description: "Open Privy funding modal",
        hotkey: hotkeyBindings.openFunding,
        keywords: ["fund", "wallet", "deposit"],
        disabled: !wallet,
        onSelect: openFundingModal,
      },
      {
        id: "reset-layout",
        title: TERMINAL_HOTKEY_ACTION_LABELS.resetLayout,
        description: "Reset terminal grid to default panel layout",
        hotkey: hotkeyBindings.resetLayout,
        keywords: ["layout", "grid", "reset"],
        disabled: !canLayoutEdit,
        onSelect: resetDashboardLayout,
      },
    ];

    for (const panelId of FOCUSABLE_PANEL_ORDER) {
      const action = PANEL_ACTION_BY_ID[panelId];
      commands.push({
        id: `focus-${panelId}`,
        title: TERMINAL_HOTKEY_ACTION_LABELS[action],
        description: FOCUSABLE_PANEL_LABELS[panelId],
        hotkey: hotkeyBindings[action],
        keywords: ["focus", "panel", panelId.replaceAll("_", " ")],
        disabled: !panelVisibility[panelId],
        onSelect: () => {
          focusPanel(panelId);
        },
      });
    }

    commands.push(
      {
        id: "profile-standard",
        title: "Switch hotkeys: Standard",
        description: TERMINAL_HOTKEY_PROFILES.standard.description,
        keywords: ["profile", "hotkeys", "standard"],
        disabled: hotkeyProfileId === "standard",
        onSelect: () => updateHotkeyProfile("standard"),
      },
      {
        id: "profile-precision",
        title: "Switch hotkeys: Precision",
        description: TERMINAL_HOTKEY_PROFILES.precision.description,
        keywords: ["profile", "hotkeys", "precision"],
        disabled: hotkeyProfileId === "precision",
        onSelect: () => updateHotkeyProfile("precision"),
      },
    );
    return commands;
  }, [
    canLayoutEdit,
    canQuickTrade,
    focusPanel,
    hotkeyBindings,
    hotkeyProfileId,
    openFundingModal,
    openMarketBuyTrade,
    openMarketSellTrade,
    resetDashboardLayout,
    panelVisibility,
    selectedPairId,
    triggerRefresh,
    updateHotkeyProfile,
    wallet,
  ]);

  return (
    <>
      {wallet && fundOpen ? (
        <FundingModal
          walletAddress={wallet.walletAddress}
          open
          onClose={() => setFundOpen(false)}
        />
      ) : null}
      {tradeOpen && tradeIntent ? (
        <TradeTicketModal
          open
          intent={tradeIntent}
          walletAddress={wallet?.walletAddress ?? null}
          tokenBalancesByMint={tokenBalancesByMint}
          riskSnapshot={accountRiskSnapshot}
          hotkeyBindings={tradeTicketHotkeys}
          getAccessToken={getAccessToken}
          onClose={() => setTradeOpen(false)}
          onTradeComplete={handleTradeComplete}
          onOrderQueued={handleOrderQueued}
        />
      ) : null}
      <TerminalCommandPalette
        open={commandPaletteOpen}
        commands={commandPaletteCommands}
        hotkeyProfileId={hotkeyProfileId}
        onClose={() => setCommandPaletteOpen(false)}
        onHotkeyProfileChange={updateHotkeyProfile}
      />

      <section className="flex-1 min-h-0 w-full">
        <div className="w-full h-full min-h-0">
          <PresenceCard show={Boolean(message)}>
            <div className="mb-4 rounded-md border-l-4 border-red-500 bg-red-500/10 p-3 text-sm text-red-400">
              {message}
            </div>
          </PresenceCard>

          {!ready || !loaded ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-accent" />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-1">
              <TerminalStatusBar
                realtime={realtimeTransport}
                market={marketFeed}
              />
              <div className="relative min-h-0 flex-1">
                <div className="pointer-events-none absolute left-2 top-2 z-20 hidden sm:flex sm:items-center sm:gap-1.5">
                  <div
                    className="rounded border border-border/70 bg-paper/90 px-2.5 py-1 text-[11px] text-muted backdrop-blur"
                    title={modeCapabilities.description}
                  >
                    Mode:{" "}
                    <span className="font-semibold text-ink">
                      {modeCapabilities.label}
                    </span>
                  </div>
                  <button
                    className={cn(
                      BTN_SECONDARY,
                      "pointer-events-auto h-7 border-border/70 bg-paper/90 px-2.5 text-[11px] backdrop-blur",
                    )}
                    onClick={() => setCommandPaletteOpen(true)}
                    title="Open command palette"
                    type="button"
                  >
                    Cmd • {formatHotkeyChord(hotkeyBindings.openPalette)}
                  </button>
                </div>
                {hasCustomGridLayout && canLayoutEdit && (
                  <div className="pointer-events-none absolute right-2 top-2 z-20">
                    <button
                      className={cn(
                        BTN_SECONDARY,
                        "pointer-events-auto h-7 border-border/70 bg-paper/90 px-2.5 text-[11px] backdrop-blur",
                      )}
                      onClick={resetDashboardLayout}
                      title={`Reorganize layout (${formatHotkeyChord(hotkeyBindings.resetLayout)})`}
                      type="button"
                    >
                      Reset layout
                    </button>
                  </div>
                )}
                {isCustomMode ? (
                  <div className="pointer-events-none absolute right-2 top-10 z-20">
                    <div className="pointer-events-auto w-[min(380px,90vw)] rounded border border-border/70 bg-paper/90 p-2 text-[11px] text-muted shadow-lg backdrop-blur">
                      <div className="flex items-center justify-between gap-2">
                        <p className="label">WORKSPACE_PRESET</p>
                        <span className="text-[10px]">
                          {customWorkspaceStore.presets.length} saved
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <select
                          className="h-7 min-w-0 flex-1 rounded border border-border bg-paper px-2 text-[11px]"
                          value={activeCustomWorkspace.id}
                          onChange={(event) =>
                            setActiveCustomWorkspace(event.target.value)
                          }
                          title="Switch workspace preset"
                        >
                          {customWorkspaceStore.presets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className={cn(BTN_SECONDARY, "h-7 px-2 text-[10px]")}
                          onClick={createCustomWorkspace}
                          type="button"
                        >
                          New
                        </button>
                        <button
                          className={cn(BTN_SECONDARY, "h-7 px-2 text-[10px]")}
                          onClick={renameCustomWorkspace}
                          type="button"
                        >
                          Rename
                        </button>
                        <button
                          className={cn(BTN_SECONDARY, "h-7 px-2 text-[10px]")}
                          onClick={deleteCustomWorkspace}
                          type="button"
                          disabled={
                            activeCustomWorkspace.id ===
                            CUSTOM_WORKSPACE_ID_DEFAULT
                          }
                        >
                          Delete
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {CUSTOM_WORKSPACE_MODULES.map((module) => (
                          <label
                            key={module}
                            className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[10px] uppercase tracking-wider"
                          >
                            <input
                              className="h-3.5 w-3.5 accent-emerald-500"
                              type="checkbox"
                              checked={customWorkspaceModules[module]}
                              onChange={(event) =>
                                setCustomWorkspaceModuleEnabled(
                                  module,
                                  event.target.checked,
                                )
                              }
                            />
                            <span>{CUSTOM_MODULE_LABELS[module]}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                <DashboardGrid
                  key={`${layoutStorageKey}:${gridRevision.toString()}`}
                  className="h-full w-full border border-border bg-border pb-1"
                  allowLayoutEditing={canLayoutEdit}
                  storageKey={layoutStorageKey}
                  onLayoutChange={() =>
                    setHasCustomGridLayout(
                      hasCustomDashboardGridLayouts(layoutStorageKey),
                    )
                  }
                >
                  {showMarketModule ? (
                    <div
                      key="chart"
                      ref={setPanelRef("chart")}
                      tabIndex={-1}
                      className={panelClassName(
                        "chart",
                        "flex flex-col overflow-hidden bg-surface",
                      )}
                    >
                      <ChartPanel
                        pairId={selectedPairId}
                        market={marketFeed}
                        onPairChange={handlePairChange}
                      />
                    </div>
                  ) : null}

                  {showMarketModule ? (
                    <div
                      key="orderbook"
                      ref={setPanelRef("orderbook")}
                      tabIndex={-1}
                      className={panelClassName(
                        "orderbook",
                        "flex flex-col overflow-hidden bg-surface",
                      )}
                    >
                      <OrderbookDepthPanel
                        market={marketFeed}
                        realtime={realtimeTransport}
                        selectedPrefill={ladderPrefill}
                        onPrefill={handleLadderPrefill}
                      />
                    </div>
                  ) : null}

                  {showMarketModule ? (
                    <div
                      key="order_entry"
                      ref={setPanelRef("order_entry")}
                      tabIndex={-1}
                      className={panelClassName(
                        "order_entry",
                        "flex flex-col overflow-hidden bg-surface",
                      )}
                    >
                      <OrderEntryPanel
                        pairId={selectedPairId}
                        onBuy={openMarketBuyTrade}
                        onSell={openMarketSellTrade}
                        tradingEnabled={canQuickTrade}
                        prefill={ladderPrefill}
                        onClearPrefill={clearLadderPrefill}
                      />
                    </div>
                  ) : null}

                  {showMarketModule ? (
                    <div
                      key="trades_tape"
                      ref={setPanelRef("trades_tape")}
                      tabIndex={-1}
                      className={panelClassName(
                        "trades_tape",
                        "flex flex-col overflow-hidden bg-surface",
                      )}
                    >
                      <TradesTapePanel realtime={realtimeTransport} />
                    </div>
                  ) : null}

                  {showMarketModule ? (
                    <div
                      key="positions"
                      ref={setPanelRef("positions")}
                      tabIndex={-1}
                      className={panelClassName(
                        "positions",
                        "flex flex-col overflow-hidden bg-surface",
                      )}
                    >
                      <PositionsOrdersFillsPanel
                        entries={recentExecutions}
                        openOrders={openOrders}
                        selectedPairId={selectedPairId}
                        selectedPairMark={marketFeed.latestPrice}
                        tokenBalancesByMint={tokenBalancesByMint}
                        tradingEnabled={canQuickTrade}
                        onQuickAction={openTradeTicket}
                        onCancelOrder={cancelOpenOrder}
                        onCancelAllOrders={cancelAllOpenOrders}
                        onAmendOrder={amendOpenOrder}
                        onExecuteOrder={executeOpenOrder}
                      />
                    </div>
                  ) : null}

                  {showWalletModule ? (
                    <div
                      key="account_risk"
                      ref={setPanelRef("account_risk")}
                      tabIndex={-1}
                      className={panelClassName(
                        "account_risk",
                        "flex flex-col overflow-hidden bg-surface",
                      )}
                    >
                      <AccountRiskPanel
                        pairId={selectedPairId}
                        tokenBalancesByMint={tokenBalancesByMint}
                        market={marketFeed}
                        realtime={realtimeTransport}
                        snapshot={accountRiskSnapshot}
                      />
                    </div>
                  ) : null}

                  {showMacroRadarModule ? (
                    <div key="macro_radar" className="overflow-hidden">
                      <MacroRadarWidget
                        onTradeAction={
                          canMacroTrade ? openTradeTicket : undefined
                        }
                      />
                    </div>
                  ) : null}
                  {showMacroFredModule ? (
                    <div key="macro_fred" className="overflow-hidden">
                      <MacroFredWidget />
                    </div>
                  ) : null}
                  {showMacroEtfModule ? (
                    <div key="macro_etf" className="overflow-hidden">
                      <MacroEtfWidget />
                    </div>
                  ) : null}
                  {showMacroStablecoinModule ? (
                    <div key="macro_stablecoin" className="overflow-hidden">
                      <MacroStablecoinWidget
                        onTradeAction={
                          canMacroTrade ? openTradeTicket : undefined
                        }
                      />
                    </div>
                  ) : null}
                  {showMacroOilModule ? (
                    <div key="macro_oil" className="overflow-hidden">
                      <MacroOilWidget />
                    </div>
                  ) : null}
                </DashboardGrid>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

const ChartPanel = memo(function ChartPanel(props: {
  pairId: PairId;
  market: MarketState;
  onPairChange: (pairId: PairId) => void;
}) {
  const { pairId, market, onPairChange } = props;
  const pair = getPairConfig(pairId);
  const pairLabel = `${pair.baseSymbol}/${pair.quoteSymbol}`;
  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label flex items-center gap-2 dashboard-drag-handle cursor-move select-none">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          CHART
        </p>
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
          <select
            className="h-6 rounded border border-border bg-paper px-2 text-[10px] text-muted uppercase tracking-wider"
            value={pairId}
            onChange={(event) => onPairChange(event.target.value as PairId)}
            title="Select pair"
          >
            {SUPPORTED_PAIRS.map((pairOption) => (
              <option key={pairOption.id} value={pairOption.id}>
                {pairOption.id}
              </option>
            ))}
          </select>
          <span
            className={cn(
              "tabular-nums",
              (market.change24hPct ?? 0) >= 0
                ? "text-emerald-400"
                : "text-red-400",
            )}
          >
            {formatPrice(market.latestPrice)} {pair.quoteSymbol}
          </span>
        </div>
      </div>
      <div className="flex-1 relative bg-[var(--color-chart-bg)]">
        <MarketChart
          className="opacity-80"
          market={market}
          pairLabel={pairLabel}
        />
      </div>
    </>
  );
});

function formatTransportBadge(realtime: TerminalRealtimeState): string {
  if (realtime.mode === "poll") {
    return realtime.isStale ? "poll stale" : "poll fallback";
  }
  if (realtime.health === "connecting") return "stream connecting";
  if (realtime.isStale) return "stream stale";
  return "stream live";
}

const OrderbookDepthPanel = memo(function OrderbookDepthPanel(props: {
  market: MarketState;
  realtime: TerminalRealtimeState;
  selectedPrefill: LadderPrefill | null;
  onPrefill: (prefill: LadderPrefill) => void;
}) {
  const { market, realtime, selectedPrefill, onPrefill } = props;
  const [groupingBps, setGroupingBps] = useState(5);
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const lastPrice = market.latestPrice ?? null;
  const depth = realtime.depth;
  const asks = depth?.asks ?? [];
  const bids = depth?.bids ?? [];
  const hasRealtimeDepth = Boolean(
    depth && depth.asks.length > 0 && depth.bids.length > 0,
  );
  const fallbackBasePrice =
    Number.isFinite(lastPrice) && (lastPrice ?? 0) > 0
      ? (lastPrice as number)
      : null;
  const fallbackLevels = [0.05, 0.1, 0.15, 0.2, 0.25];
  const fallbackAsks =
    fallbackBasePrice === null
      ? []
      : fallbackLevels.map((pct, index) => ({
          price: fallbackBasePrice * (1 + pct / 100),
          size: 80 + index * 25,
        }));
  const fallbackBids =
    fallbackBasePrice === null
      ? []
      : fallbackLevels.map((pct, index) => ({
          price: fallbackBasePrice * (1 - pct / 100),
          size: 75 + index * 22,
        }));
  const renderedAsks = hasRealtimeDepth ? asks : fallbackAsks;
  const renderedBids = hasRealtimeDepth ? bids : fallbackBids;
  const ladder = useMemo(
    () =>
      buildOrderbookLadder({
        asks: renderedAsks,
        bids: renderedBids,
        groupingBps,
        maxRows: 10,
      }),
    [groupingBps, renderedAsks, renderedBids],
  );
  const statusLabel = formatTransportBadge(realtime);
  const spreadLabel =
    ladder.spreadAbs === null || ladder.spreadBps === null
      ? "--"
      : `${ladder.spreadAbs.toFixed(4)} (${ladder.spreadBps.toFixed(2)} bps)`;
  const groupingOptions = [2, 5, 10, 25];
  const depthChart = useMemo(
    () =>
      buildDepthChartModel({
        bids: ladder.bids,
        asks: ladder.asks,
        sequence: depth?.seq ?? null,
      }),
    [depth?.seq, ladder.asks, ladder.bids],
  );
  const chartSpec = useMemo(() => {
    const width = 320;
    const height = 140;
    const padLeft = 28;
    const padRight = 10;
    const padTop = 8;
    const padBottom = 20;

    const bidLow = depthChart.bids[depthChart.bids.length - 1]?.price ?? null;
    const bidHigh = depthChart.bids[0]?.price ?? null;
    const askLow = depthChart.asks[0]?.price ?? null;
    const askHigh = depthChart.asks[depthChart.asks.length - 1]?.price ?? null;

    const minPrice = Math.min(
      bidLow ?? Number.POSITIVE_INFINITY,
      askLow ?? Number.POSITIVE_INFINITY,
    );
    const maxPrice = Math.max(
      bidHigh ?? Number.NEGATIVE_INFINITY,
      askHigh ?? Number.NEGATIVE_INFINITY,
    );
    const maxCumulative = Math.max(
      depthChart.totalBidSize,
      depthChart.totalAskSize,
      1,
    );
    if (
      !Number.isFinite(minPrice) ||
      !Number.isFinite(maxPrice) ||
      maxPrice <= minPrice
    ) {
      return null;
    }

    const innerWidth = width - padLeft - padRight;
    const innerHeight = height - padTop - padBottom;
    const xForPrice = (price: number): number =>
      padLeft + ((price - minPrice) / (maxPrice - minPrice)) * innerWidth;
    const yForCumulative = (cumulative: number): number =>
      padTop + (1 - cumulative / maxCumulative) * innerHeight;
    const toPath = (
      points: Array<{ price: number; cumulativeSize: number }>,
    ): string =>
      points
        .map((point, index) => {
          const x = xForPrice(point.price).toFixed(2);
          const y = yForCumulative(point.cumulativeSize).toFixed(2);
          return `${index === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .join(" ");

    return {
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      minPrice,
      maxPrice,
      innerWidth,
      bidPath: toPath(depthChart.bids),
      askPath: toPath(depthChart.asks),
      xForPrice,
    };
  }, [
    depthChart.asks,
    depthChart.bids,
    depthChart.totalAskSize,
    depthChart.totalBidSize,
  ]);
  const hoverBidPoint = useMemo(
    () =>
      hoverPrice === null
        ? null
        : findNearestDepthPoint(depthChart.bids, hoverPrice),
    [depthChart.bids, hoverPrice],
  );
  const hoverAskPoint = useMemo(
    () =>
      hoverPrice === null
        ? null
        : findNearestDepthPoint(depthChart.asks, hoverPrice),
    [depthChart.asks, hoverPrice],
  );
  const imbalanceLabel =
    depthChart.imbalance === null
      ? "--"
      : `${(depthChart.imbalance * 100).toFixed(1)}%`;

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          ORDERBOOK_DEPTH
        </p>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
              realtime.mode === "poll"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : realtime.isStale
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
            )}
          >
            {statusLabel}
          </span>
          <span className="text-[10px] font-mono text-muted">
            {formatAgeMs(realtime.lastEventMs ?? market.lastUpdatedMs)}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 text-[11px] font-mono">
        <div className="mb-2 flex items-center justify-between rounded border border-border/60 bg-subtle px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted">
            spread {spreadLabel}
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted">
              group
            </span>
            <select
              className="h-6 rounded border border-border bg-paper px-1.5 text-[10px] uppercase tracking-wider text-muted"
              value={groupingBps}
              onChange={(event) => setGroupingBps(Number(event.target.value))}
              title="Group levels"
            >
              {groupingOptions.map((option) => (
                <option key={option} value={option}>
                  {option} bps
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mb-2 rounded border border-border/60 bg-subtle px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
            <span>Depth chart</span>
            <span>
              seq {depthChart.sequence ?? "--"} • imbalance {imbalanceLabel}
            </span>
          </div>
          {chartSpec ? (
            <>
              <svg
                className="h-[130px] w-full rounded border border-border/40 bg-paper/70"
                viewBox={`0 0 ${chartSpec.width} ${chartSpec.height}`}
                onMouseLeave={() => setHoverPrice(null)}
                onMouseMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const rawX = event.clientX - rect.left;
                  const clampedX = Math.max(
                    chartSpec.padLeft,
                    Math.min(rawX, chartSpec.width - chartSpec.padRight),
                  );
                  const ratio =
                    (clampedX - chartSpec.padLeft) / chartSpec.innerWidth;
                  const price =
                    chartSpec.minPrice +
                    ratio * (chartSpec.maxPrice - chartSpec.minPrice);
                  setHoverPrice(price);
                }}
              >
                <title>Cumulative bid and ask depth chart</title>
                <path
                  d={chartSpec.bidPath}
                  fill="none"
                  stroke="rgba(16,185,129,0.95)"
                  strokeWidth="2"
                />
                <path
                  d={chartSpec.askPath}
                  fill="none"
                  stroke="rgba(248,113,113,0.95)"
                  strokeWidth="2"
                />
                {hoverPrice !== null ? (
                  <line
                    x1={chartSpec.xForPrice(hoverPrice)}
                    x2={chartSpec.xForPrice(hoverPrice)}
                    y1={chartSpec.padTop}
                    y2={chartSpec.height - chartSpec.padBottom}
                    stroke="rgba(148,163,184,0.7)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                ) : null}
              </svg>
              <div className="mt-1 grid grid-cols-2 gap-2 text-[10px] text-muted">
                <p>
                  Hover price:{" "}
                  {hoverPrice === null ? "--" : hoverPrice.toFixed(4)}
                </p>
                <p className="text-right">
                  Spread:{" "}
                  {depthChart.spreadAbs === null
                    ? "--"
                    : depthChart.spreadAbs.toFixed(4)}
                </p>
                <p>
                  Bid cum:{" "}
                  {hoverBidPoint
                    ? hoverBidPoint.cumulativeSize.toFixed(2)
                    : "--"}
                </p>
                <p className="text-right">
                  Ask cum:{" "}
                  {hoverAskPoint
                    ? hoverAskPoint.cumulativeSize.toFixed(2)
                    : "--"}
                </p>
              </div>
            </>
          ) : (
            <p className="rounded border border-border/40 bg-paper/70 px-2 py-2 text-[10px] text-muted">
              Not enough depth points to render synchronized chart.
            </p>
          )}
        </div>
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-2 px-1 pb-1 text-[10px] uppercase tracking-wider text-muted">
          <span>Side</span>
          <span>Price</span>
          <span>Size</span>
          <span>Cum</span>
        </div>
        <div className="space-y-1">
          {ladder.asks.length === 0 && ladder.bids.length === 0 ? (
            <p className="rounded border border-border/50 bg-subtle px-2 py-2 text-muted">
              Waiting for market depth...
            </p>
          ) : null}
          {ladder.asks.map((row) => {
            const nextPrefillSide = "buy";
            const sourceSeq = depth?.seq ?? 0;
            const active =
              selectedPrefill?.side === nextPrefillSide &&
              selectedPrefill.price === row.price &&
              selectedPrefill.seq === sourceSeq;
            return (
              <button
                key={`ask-${row.price}`}
                className={cn(
                  "grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded border px-2 py-1 text-left transition-colors",
                  "border-red-500/20 bg-red-500/5 hover:bg-red-500/10",
                  active && "border-red-400 bg-red-500/15",
                )}
                onClick={() =>
                  onPrefill({
                    side: nextPrefillSide,
                    price: row.price,
                    size: row.size,
                    seq: sourceSeq,
                    ts: depth?.ts ?? Date.now(),
                  })
                }
                type="button"
              >
                <span className="text-[10px] uppercase text-red-300">
                  ask {row.isTopOfBook ? "*" : ""}
                </span>
                <span className="text-red-300">{row.price.toFixed(4)}</span>
                <span className="text-muted">{row.size.toFixed(2)}</span>
                <span className="text-muted">
                  {row.cumulativeSize.toFixed(2)}
                </span>
              </button>
            );
          })}

          {ladder.bestAsk && ladder.bestBid ? (
            <div className="rounded border border-border/70 bg-paper/80 px-2 py-1 text-center text-[10px] uppercase tracking-wider text-muted">
              top: bid {ladder.bestBid.price.toFixed(4)} / ask{" "}
              {ladder.bestAsk.price.toFixed(4)}
            </div>
          ) : null}

          {ladder.bids.map((row) => {
            const nextPrefillSide = "sell";
            const sourceSeq = depth?.seq ?? 0;
            const active =
              selectedPrefill?.side === nextPrefillSide &&
              selectedPrefill.price === row.price &&
              selectedPrefill.seq === sourceSeq;
            return (
              <button
                key={`bid-${row.price}`}
                className={cn(
                  "grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded border px-2 py-1 text-left transition-colors",
                  "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10",
                  active && "border-emerald-400 bg-emerald-500/15",
                )}
                onClick={() =>
                  onPrefill({
                    side: nextPrefillSide,
                    price: row.price,
                    size: row.size,
                    seq: sourceSeq,
                    ts: depth?.ts ?? Date.now(),
                  })
                }
                type="button"
              >
                <span className="text-[10px] uppercase text-emerald-300">
                  bid {row.isTopOfBook ? "*" : ""}
                </span>
                <span className="text-emerald-300">{row.price.toFixed(4)}</span>
                <span className="text-muted">{row.size.toFixed(2)}</span>
                <span className="text-muted">
                  {row.cumulativeSize.toFixed(2)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
});

const OrderEntryPanel = memo(function OrderEntryPanel(props: {
  pairId: PairId;
  onBuy: () => void;
  onSell: () => void;
  tradingEnabled: boolean;
  prefill: LadderPrefill | null;
  onClearPrefill: () => void;
}) {
  const { pairId, onBuy, onSell, tradingEnabled, prefill, onClearPrefill } =
    props;
  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          ORDER_ENTRY
        </p>
        <span className="text-[10px] font-mono text-emerald-400">{pairId}</span>
      </div>
      <div className="flex-1 p-3 text-xs space-y-3">
        <div className="rounded border border-border bg-subtle p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted">
            Execution
          </p>
          <p className="mt-1 font-mono text-sm text-ink">Market • IOC</p>
          <p className="text-[10px] text-muted">Routing: fast lane default</p>
          {prefill ? (
            <div className="mt-2 rounded border border-border/70 bg-paper/80 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted">
                Prefill
              </p>
              <p className="mt-1 font-mono text-[11px] text-ink">
                {prefill.side.toUpperCase()} {prefill.price.toFixed(4)} x{" "}
                {prefill.size.toFixed(2)}
              </p>
              <button
                className={cn(
                  BTN_SECONDARY,
                  "mt-2 h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                )}
                onClick={onClearPrefill}
                type="button"
              >
                Clear prefill
              </button>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-2">
          <button
            className={cn(
              BTN_SECONDARY,
              "!h-8 !rounded !text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
              !tradingEnabled && "opacity-60 pointer-events-none",
            )}
            onClick={onBuy}
            type="button"
            disabled={!tradingEnabled}
          >
            Buy / Lift
          </button>
          <button
            className={cn(
              BTN_SECONDARY,
              "!h-8 !rounded !text-xs bg-red-500/10 border-red-500/30 text-red-300",
              !tradingEnabled && "opacity-60 pointer-events-none",
            )}
            onClick={onSell}
            type="button"
            disabled={!tradingEnabled}
          >
            Sell / Hit
          </button>
        </div>
      </div>
    </>
  );
});

const TradesTapePanel = memo(function TradesTapePanel(props: {
  realtime: TerminalRealtimeState;
}) {
  const { realtime } = props;
  const [paused, setPaused] = useState(false);
  const [sideFilter, setSideFilter] = useState<TapeSideFilter>("all");
  const [minSize, setMinSize] = useState(0);
  const [displayMode, setDisplayMode] = useState<TapeDisplayMode>("compact");
  const [displayedTrades, setDisplayedTrades] = useState<RealtimeTradeTick[]>(
    () => realtime.trades.slice(0, 80),
  );
  const [bufferedCount, setBufferedCount] = useState(0);
  const latestHeadSeqRef = useRef<number | null>(
    realtime.trades[0]?.seq ?? null,
  );

  useEffect(() => {
    const currentHeadSeq = realtime.trades[0]?.seq ?? null;
    const previousHeadSeq = latestHeadSeqRef.current;
    latestHeadSeqRef.current = currentHeadSeq;

    if (paused) {
      if (
        currentHeadSeq !== null &&
        previousHeadSeq !== null &&
        currentHeadSeq > previousHeadSeq
      ) {
        setBufferedCount((count) => count + (currentHeadSeq - previousHeadSeq));
      }
      return;
    }

    setDisplayedTrades(realtime.trades.slice(0, 80));
    setBufferedCount(0);
  }, [paused, realtime.trades]);

  const filteredTrades = useMemo(
    () =>
      filterTradeTicks({
        trades: displayedTrades,
        side: sideFilter,
        minSize,
        mode: displayMode,
      }),
    [displayMode, displayedTrades, minSize, sideFilter],
  );
  const missedCount = useMemo(
    () => countMissingTradeTicks(displayedTrades),
    [displayedTrades],
  );

  const togglePaused = useCallback(() => {
    setPaused((current) => {
      const next = !current;
      if (!next) {
        setDisplayedTrades(realtime.trades.slice(0, 80));
        setBufferedCount(0);
      }
      return next;
    });
  }, [realtime.trades]);

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          TRADES_TAPE
        </p>
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          <button
            className={cn(
              BTN_SECONDARY,
              "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
              paused && "border-amber-500/40 bg-amber-500/10 text-amber-300",
            )}
            onClick={togglePaused}
            type="button"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 uppercase tracking-wider",
              realtime.mode === "poll"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : realtime.isStale
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
            )}
          >
            {realtime.mode === "poll" ? "fallback" : "stream"}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 text-xs space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select
            className="h-7 rounded border border-border bg-paper px-2 text-[10px] uppercase tracking-wider text-muted"
            value={sideFilter}
            onChange={(event) =>
              setSideFilter(event.target.value as TapeSideFilter)
            }
            title="Filter side"
          >
            <option value="all">All sides</option>
            <option value="buy">Buys</option>
            <option value="sell">Sells</option>
          </select>
          <select
            className="h-7 rounded border border-border bg-paper px-2 text-[10px] uppercase tracking-wider text-muted"
            value={String(minSize)}
            onChange={(event) => setMinSize(Number(event.target.value))}
            title="Minimum size"
          >
            <option value="0">Min size 0</option>
            <option value="10">Min size 10</option>
            <option value="20">Min size 20</option>
            <option value="30">Min size 30</option>
          </select>
        </div>
        <div className="flex items-center justify-between rounded border border-border/60 bg-subtle px-2 py-1.5">
          <div className="flex items-center gap-2 text-[10px] text-muted uppercase tracking-wider">
            <span>{displayedTrades.length} cached</span>
            {bufferedCount > 0 ? <span>{bufferedCount} buffered</span> : null}
            {missedCount > 0 ? <span>{missedCount} missed</span> : null}
          </div>
          <button
            className={cn(
              BTN_SECONDARY,
              "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
            )}
            onClick={() =>
              setDisplayMode((current) =>
                current === "compact" ? "expanded" : "compact",
              )
            }
            type="button"
          >
            {displayMode === "compact" ? "Expanded" : "Compact"}
          </button>
        </div>
        <div className="space-y-1">
          {filteredTrades.length === 0 ? (
            <p className="rounded border border-border/50 bg-subtle px-2 py-2 text-muted">
              No trades matching current tape filters.
            </p>
          ) : null}
          {filteredTrades.map((trade) => (
            <div
              key={`tape-${trade.seq}`}
              className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded border border-border/60 px-2 py-1"
            >
              <p
                className={cn(
                  "text-[10px] uppercase",
                  trade.side === "buy" ? "text-emerald-300" : "text-red-300",
                )}
              >
                {trade.side}
              </p>
              <p className="font-mono text-[11px] text-ink">
                {trade.price.toFixed(4)}
              </p>
              <p className="text-[10px] text-muted">{trade.size.toFixed(2)}</p>
              {displayMode === "expanded" ? (
                <p className="text-[10px] text-muted">
                  {new Date(trade.ts).toLocaleTimeString()}
                </p>
              ) : (
                <p className="text-[10px] text-muted">#{trade.seq}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
});

const PositionsOrdersFillsPanel = memo(
  function PositionsOrdersFillsPanel(props: {
    entries: ExecutionActivityRow[];
    openOrders: OpenOrderRow[];
    selectedPairId: PairId;
    selectedPairMark: number | null;
    tokenBalancesByMint: Record<string, string>;
    tradingEnabled: boolean;
    onQuickAction: (intent: TradeIntent) => void;
    onCancelOrder: (orderId: string) => void;
    onCancelAllOrders: () => void;
    onAmendOrder: (orderId: string) => void;
    onExecuteOrder: (input: { orderId: string; fraction: 0.5 | 1 }) => void;
  }) {
    const {
      entries,
      openOrders,
      selectedPairId,
      selectedPairMark,
      tokenBalancesByMint,
      tradingEnabled,
      onQuickAction,
      onCancelOrder,
      onCancelAllOrders,
      onAmendOrder,
      onExecuteOrder,
    } = props;
    const markByPair = useMemo(
      () =>
        ({
          [selectedPairId]: selectedPairMark,
        }) as Partial<Record<PairId, number | null>>,
      [selectedPairId, selectedPairMark],
    );
    const quoteBalanceBySymbol = useMemo(() => {
      const balances: Record<string, number | null> = {};
      for (const [symbol, token] of Object.entries(TOKEN_CONFIGS)) {
        const formatted = formatAtomicTokenBalance(
          tokenBalancesByMint[token.mint] ?? "0",
          token.decimals,
          9,
        );
        const parsed = Number(formatted);
        balances[symbol] = Number.isFinite(parsed) ? parsed : null;
      }
      return balances;
    }, [tokenBalancesByMint]);
    const fills = useMemo<PositionFill[]>(
      () =>
        entries.map((entry) => ({
          id: entry.id,
          ts: entry.ts,
          pairId: entry.pairId,
          direction: entry.direction,
          status: entry.status,
          signature: entry.signature,
          baseFilledUi: entry.baseFilledUi,
          quoteFilledUi: entry.quoteFilledUi,
          fillPrice: entry.fillPrice,
          qualitySummary: entry.qualitySummary,
        })),
      [entries],
    );
    const positions = useMemo(
      () =>
        buildLivePositions({
          fills,
          markByPair,
          quoteBalanceBySymbol,
        }),
      [fills, markByPair, quoteBalanceBySymbol],
    );
    const totals = useMemo(
      () => summarizeLivePositions(positions),
      [positions],
    );

    const formatAmountUi = useCallback((value: number): string => {
      const normalized = Number.isFinite(value) ? value : 0;
      return normalized.toFixed(4).replace(/\.?0+$/, "") || "0";
    }, []);

    const openReduceIntent = useCallback(
      (pairId: PairId, sizeBase: number) => {
        if (!tradingEnabled) return;
        const reduceSize = Math.max(sizeBase * 0.25, 0.0001);
        onQuickAction(
          createTradeIntent("sell", "POSITIONS_PANEL", pairId, {
            reason: `Reduce 25% position size`,
            amountUi: formatAmountUi(reduceSize),
          }),
        );
      },
      [formatAmountUi, onQuickAction, tradingEnabled],
    );

    const openCloseIntent = useCallback(
      (pairId: PairId, sizeBase: number) => {
        if (!tradingEnabled) return;
        onQuickAction(
          createTradeIntent("sell", "POSITIONS_PANEL", pairId, {
            reason: "Close full position",
            amountUi: formatAmountUi(sizeBase),
          }),
        );
      },
      [formatAmountUi, onQuickAction, tradingEnabled],
    );

    const formatSignedPnl = useCallback((value: number | null): string => {
      if (value === null || !Number.isFinite(value)) return "--";
      const sign = value >= 0 ? "+" : "";
      return `${sign}${value.toFixed(2)}`;
    }, []);

    const riskBadgeClass = useCallback(
      (riskLevel: "low" | "medium" | "high") => {
        if (riskLevel === "high") {
          return "border-red-500/40 bg-red-500/10 text-red-300";
        }
        if (riskLevel === "medium") {
          return "border-amber-500/40 bg-amber-500/10 text-amber-300";
        }
        return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
      },
      [],
    );
    const orderStatusClass = useCallback((status: OpenOrderStatus) => {
      if (status === "pending") {
        return "border-sky-500/40 bg-sky-500/10 text-sky-300";
      }
      if (status === "working") {
        return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
      }
      if (status === "partial") {
        return "border-amber-500/40 bg-amber-500/10 text-amber-300";
      }
      if (status === "cancelled") {
        return "border-border bg-paper text-muted";
      }
      return "border-red-500/40 bg-red-500/10 text-red-300";
    }, []);
    const [ledgerSide, setLedgerSide] = useState<FillLedgerSideFilter>("all");
    const [ledgerPair, setLedgerPair] = useState<PairId | "all">("all");
    const [ledgerStatus, setLedgerStatus] =
      useState<FillLedgerStatusFilter>("all");
    const [ledgerQuery, setLedgerQuery] = useState("");
    const [ledgerPage, setLedgerPage] = useState(1);
    const [inspectorOpen, setInspectorOpen] = useState(false);
    const [inspectorRequestId, setInspectorRequestId] = useState<string | null>(
      null,
    );
    const ledgerRows = useMemo<FillLedgerRow[]>(
      () =>
        entries.map((entry) => ({
          id: entry.id,
          ts: entry.ts,
          requestId: entry.requestId,
          receiptId: entry.receiptId,
          pairId: entry.pairId,
          side: entry.direction,
          sizeBaseUi: entry.baseFilledUi,
          quoteFilledUi: entry.quoteFilledUi,
          price: entry.fillPrice,
          feeUi: entry.feeUi,
          feeSymbol: entry.feeSymbol,
          status: entry.status,
          provider: entry.provider,
          signature: entry.signature,
        })),
      [entries],
    );
    const filteredLedgerRows = useMemo(
      () =>
        filterFillLedgerRows(ledgerRows, {
          side: ledgerSide,
          pairId: ledgerPair,
          status: ledgerStatus,
          query: ledgerQuery,
        }),
      [ledgerPair, ledgerQuery, ledgerRows, ledgerSide, ledgerStatus],
    );
    const ledgerPageCount = Math.max(
      1,
      Math.ceil(filteredLedgerRows.length / FILLS_LEDGER_PAGE_SIZE),
    );
    useEffect(() => {
      setLedgerPage((current) => Math.min(current, ledgerPageCount));
    }, [ledgerPageCount]);
    const pagedLedgerRows = useMemo(
      () =>
        paginateFillLedgerRows(
          filteredLedgerRows,
          ledgerPage,
          FILLS_LEDGER_PAGE_SIZE,
        ),
      [filteredLedgerRows, ledgerPage],
    );
    const exportLedgerCsv = useCallback(() => {
      if (filteredLedgerRows.length === 0) return;
      const csv = buildFillLedgerCsv(filteredLedgerRows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `terminal-fills-ledger-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    }, [filteredLedgerRows]);
    const formatLedgerFee = useCallback((entry: FillLedgerRow): string => {
      if (entry.feeUi === null || !Number.isFinite(entry.feeUi)) return "--";
      return `${entry.feeUi.toFixed(6)} ${entry.feeSymbol ?? ""}`.trim();
    }, []);
    const shortExecutionId = useCallback((value: string | null): string => {
      if (!value) return "--";
      if (value.length <= 16) return value;
      return `${value.slice(0, 8)}...${value.slice(-6)}`;
    }, []);
    const openInspector = useCallback((requestId: string) => {
      setInspectorRequestId(requestId);
      setInspectorOpen(true);
    }, []);
    const closeInspector = useCallback(() => {
      setInspectorOpen(false);
    }, []);

    return (
      <>
        <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
          <p className="label dashboard-drag-handle cursor-move select-none">
            POSITIONS_ORDERS_FILLS
          </p>
          <span className="text-[10px] font-mono text-muted">
            {entries.length} recent
          </span>
        </div>
        <div className="flex-1 overflow-auto p-3 text-xs space-y-3">
          <div className="rounded border border-border bg-subtle p-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">
              Position Totals (Session)
            </p>
            <p className="mt-1 font-mono text-ink">
              Notional: {totals.notional.toFixed(2)} USDC
            </p>
            <p
              className={cn(
                "font-mono",
                totals.unrealizedPnl >= 0 ? "text-emerald-300" : "text-red-300",
              )}
            >
              Unrealized: {formatSignedPnl(totals.unrealizedPnl)} USDC
            </p>
            <p
              className={cn(
                "font-mono",
                totals.realizedPnl >= 0 ? "text-emerald-300" : "text-red-300",
              )}
            >
              Realized: {formatSignedPnl(totals.realizedPnl)} USDC
            </p>
          </div>
          <div className="rounded border border-border bg-subtle p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wider text-muted">
                Open Orders
              </p>
              <button
                className={cn(
                  BTN_SECONDARY,
                  "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                  openOrders.length === 0 && "opacity-60 pointer-events-none",
                )}
                onClick={onCancelAllOrders}
                type="button"
                disabled={openOrders.length === 0}
              >
                Cancel all
              </button>
            </div>
            <div className="mt-2 space-y-1.5">
              {openOrders.length === 0 ? (
                <p className="text-muted">No pending or working orders.</p>
              ) : null}
              {openOrders.map((order) => (
                <div
                  key={`open-order-${order.id}`}
                  className="rounded border border-border/60 px-2 py-1.5 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-ink truncate">
                        {order.pairId} • {order.direction.toUpperCase()} •{" "}
                        {order.orderType.toUpperCase()}
                      </p>
                      <p className="text-[10px] text-muted">
                        Remaining {order.remainingAmountUi} •{" "}
                        {order.orderType === "limit"
                          ? `LMT ${order.limitPriceUi ?? "--"}`
                          : `TRG ${order.triggerPriceUi ?? "--"}`}{" "}
                        • {order.timeInForce.toUpperCase()}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                        orderStatusClass(order.status),
                      )}
                    >
                      {order.status}
                    </span>
                  </div>
                  {order.lastError ? (
                    <p className="text-[10px] text-red-300">
                      action-error: {order.lastError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      className={cn(
                        BTN_SECONDARY,
                        "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                        (!tradingEnabled ||
                          order.status === "cancelled" ||
                          order.status === "failed") &&
                          "opacity-60 pointer-events-none",
                      )}
                      onClick={() =>
                        onExecuteOrder({ orderId: order.id, fraction: 0.5 })
                      }
                      type="button"
                      disabled={
                        !tradingEnabled ||
                        order.status === "cancelled" ||
                        order.status === "failed"
                      }
                    >
                      Exec 50%
                    </button>
                    <button
                      className={cn(
                        BTN_SECONDARY,
                        "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                        (!tradingEnabled ||
                          order.status === "cancelled" ||
                          order.status === "failed") &&
                          "opacity-60 pointer-events-none",
                      )}
                      onClick={() =>
                        onExecuteOrder({ orderId: order.id, fraction: 1 })
                      }
                      type="button"
                      disabled={
                        !tradingEnabled ||
                        order.status === "cancelled" ||
                        order.status === "failed"
                      }
                    >
                      Execute all
                    </button>
                    <button
                      className={cn(
                        BTN_SECONDARY,
                        "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                      )}
                      onClick={() => onAmendOrder(order.id)}
                      type="button"
                    >
                      Amend
                    </button>
                    <button
                      className={cn(
                        BTN_SECONDARY,
                        "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                      )}
                      onClick={() => onCancelOrder(order.id)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded border border-border bg-subtle p-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">
              Live Positions
            </p>
            <div className="mt-2 space-y-1.5">
              {positions.length === 0 ? (
                <p className="text-muted">
                  No open position from this session yet.
                </p>
              ) : null}
              {positions.map((position) => (
                <div
                  key={`position-${position.pairId}`}
                  className="rounded border border-border/60 px-2 py-1.5 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-ink truncate">
                        {position.pairId} • {position.sizeBase.toFixed(4)}{" "}
                        {position.baseSymbol}
                      </p>
                      <p className="text-[10px] text-muted">
                        Entry{" "}
                        {position.avgEntry === null
                          ? "--"
                          : position.avgEntry.toFixed(4)}{" "}
                        • Mark{" "}
                        {position.mark === null
                          ? "--"
                          : position.mark.toFixed(4)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                        riskBadgeClass(position.riskLevel),
                      )}
                    >
                      {position.riskLevel} risk
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <p className="text-muted">
                      Unrealized:{" "}
                      <span
                        className={
                          (position.unrealizedPnl ?? 0) >= 0
                            ? "text-emerald-300"
                            : "text-red-300"
                        }
                      >
                        {formatSignedPnl(position.unrealizedPnl)}
                      </span>
                    </p>
                    <p className="text-muted text-right">
                      Realized:{" "}
                      <span
                        className={
                          position.realizedPnl >= 0
                            ? "text-emerald-300"
                            : "text-red-300"
                        }
                      >
                        {formatSignedPnl(position.realizedPnl)}
                      </span>
                    </p>
                    <p className="text-muted">
                      Leverage:{" "}
                      <span className="font-mono text-ink">
                        {position.leverage === null
                          ? "--"
                          : `${position.leverage.toFixed(2)}x`}
                      </span>
                    </p>
                    <p className="text-muted text-right truncate">
                      {position.warning ?? "Risk within normal bounds."}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      className={cn(
                        BTN_SECONDARY,
                        "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                        !tradingEnabled && "opacity-60 pointer-events-none",
                      )}
                      onClick={() =>
                        openReduceIntent(position.pairId, position.sizeBase)
                      }
                      type="button"
                      disabled={!tradingEnabled}
                    >
                      Reduce 25%
                    </button>
                    <button
                      className={cn(
                        BTN_SECONDARY,
                        "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                        !tradingEnabled && "opacity-60 pointer-events-none",
                      )}
                      onClick={() =>
                        openCloseIntent(position.pairId, position.sizeBase)
                      }
                      type="button"
                      disabled={!tradingEnabled}
                    >
                      Close
                    </button>
                    <button
                      className={cn(
                        BTN_SECONDARY,
                        "h-6 rounded px-2 text-[10px] uppercase tracking-wider opacity-60",
                      )}
                      type="button"
                      disabled
                      title="Reverse requires shorting/margin support."
                    >
                      Reverse
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded border border-border bg-subtle p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wider text-muted">
                Fills Ledger
              </p>
              <button
                className={cn(
                  BTN_SECONDARY,
                  "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                  filteredLedgerRows.length === 0 &&
                    "opacity-60 pointer-events-none",
                )}
                onClick={exportLedgerCsv}
                type="button"
                disabled={filteredLedgerRows.length === 0}
              >
                Export CSV
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-muted">
                Side
                <select
                  className="h-7 rounded border border-border bg-paper px-1.5 text-[11px] text-ink"
                  value={ledgerSide}
                  onChange={(event) => {
                    setLedgerSide(event.target.value as FillLedgerSideFilter);
                    setLedgerPage(1);
                  }}
                >
                  <option value="all">All</option>
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-muted">
                Pair
                <select
                  className="h-7 rounded border border-border bg-paper px-1.5 text-[11px] text-ink"
                  value={ledgerPair}
                  onChange={(event) => {
                    setLedgerPair(event.target.value as PairId | "all");
                    setLedgerPage(1);
                  }}
                >
                  <option value="all">All</option>
                  {SUPPORTED_PAIRS.map((pair) => (
                    <option key={`ledger-pair-${pair.id}`} value={pair.id}>
                      {pair.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-muted">
                Status
                <select
                  className="h-7 rounded border border-border bg-paper px-1.5 text-[11px] text-ink"
                  value={ledgerStatus}
                  onChange={(event) => {
                    setLedgerStatus(
                      event.target.value as FillLedgerStatusFilter,
                    );
                    setLedgerPage(1);
                  }}
                >
                  <option value="all">All</option>
                  <option value="successful">Successful</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-muted">
                Search
                <input
                  className="h-7 rounded border border-border bg-paper px-1.5 text-[11px] text-ink"
                  placeholder="request/signature/provider"
                  value={ledgerQuery}
                  onChange={(event) => {
                    setLedgerQuery(event.target.value);
                    setLedgerPage(1);
                  }}
                />
              </label>
            </div>
            <div className="mt-2 space-y-1.5">
              {filteredLedgerRows.length === 0 ? (
                <p className="text-muted">
                  No fills match current filters for this session.
                </p>
              ) : null}
              {pagedLedgerRows.map((entry) => (
                <div
                  key={`fill-ledger-${entry.id}`}
                  className="grid grid-cols-[1fr_auto] gap-2 rounded border border-border/60 px-2 py-1"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] text-ink truncate">
                      {entry.pairId} • {entry.side.toUpperCase()}{" "}
                      {entry.sizeBaseUi.toFixed(4)}{" "}
                      {getPairConfig(entry.pairId).baseSymbol} @{" "}
                      {entry.price === null ? "--" : entry.price.toFixed(4)}
                    </p>
                    <p className="text-[10px] text-muted">
                      {new Date(entry.ts).toLocaleTimeString()} • Fee{" "}
                      {formatLedgerFee(entry)}
                    </p>
                    <p className="text-[10px] text-muted truncate">
                      req {shortExecutionId(entry.requestId)} • rcpt{" "}
                      {shortExecutionId(entry.receiptId)} •{" "}
                      {entry.provider ?? "provider --"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] uppercase text-muted">
                      {entry.status}
                    </span>
                    <button
                      className={cn(
                        BTN_SECONDARY,
                        "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                      )}
                      onClick={() => openInspector(entry.requestId)}
                      type="button"
                    >
                      Inspect
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted">
              <span>
                Showing {pagedLedgerRows.length} of {filteredLedgerRows.length}{" "}
                fills
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  className={cn(
                    BTN_SECONDARY,
                    "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                    ledgerPage <= 1 && "opacity-60 pointer-events-none",
                  )}
                  onClick={() =>
                    setLedgerPage((current) => Math.max(1, current - 1))
                  }
                  type="button"
                  disabled={ledgerPage <= 1}
                >
                  Prev
                </button>
                <span>
                  Page {ledgerPage} / {ledgerPageCount}
                </span>
                <button
                  className={cn(
                    BTN_SECONDARY,
                    "h-6 rounded px-2 text-[10px] uppercase tracking-wider",
                    ledgerPage >= ledgerPageCount &&
                      "opacity-60 pointer-events-none",
                  )}
                  onClick={() =>
                    setLedgerPage((current) =>
                      Math.min(ledgerPageCount, current + 1),
                    )
                  }
                  type="button"
                  disabled={ledgerPage >= ledgerPageCount}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
        <ExecutionInspectorDrawer
          open={inspectorOpen}
          requestId={inspectorRequestId}
          onClose={closeInspector}
        />
      </>
    );
  },
);

const AccountRiskPanel = memo(function AccountRiskPanel(props: {
  pairId: PairId;
  tokenBalancesByMint: Record<string, string>;
  market: MarketState;
  realtime: TerminalRealtimeState;
  snapshot: AccountRiskSnapshot;
}) {
  const { pairId, tokenBalancesByMint, market, realtime, snapshot } = props;
  const pair = getPairConfig(pairId);
  const baseToken = TOKEN_CONFIGS[pair.baseSymbol];
  const quoteToken = TOKEN_CONFIGS[pair.quoteSymbol];
  const baseAtomic = tokenBalancesByMint[baseToken.mint] ?? "0";
  const quoteAtomic = tokenBalancesByMint[quoteToken.mint] ?? "0";
  const baseDisplay = formatAtomicTokenBalance(baseAtomic, baseToken.decimals);
  const quoteDisplay = formatAtomicTokenBalance(
    quoteAtomic,
    quoteToken.decimals,
  );
  const change24h = market.change24hPct ?? null;
  const formatQuote = (value: number | null): string =>
    value === null || !Number.isFinite(value)
      ? "--"
      : `${value.toFixed(2)} ${quoteToken.symbol}`;
  const formatRatio = (value: number | null): string =>
    value === null || !Number.isFinite(value) ? "--" : `${value.toFixed(2)}x`;
  const formatPct = (value: number | null): string =>
    value === null || !Number.isFinite(value) ? "--" : `${value.toFixed(2)}%`;
  const riskClass = (level: AccountRiskLevel): string => {
    if (level === "critical") return "text-red-300";
    if (level === "warning") return "text-amber-300";
    return "text-emerald-300";
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 shrink-0">
        <p className="label dashboard-drag-handle cursor-move select-none">
          ACCOUNT_RISK
        </p>
        <span className="text-[10px] font-mono text-emerald-400">{pairId}</span>
      </div>
      <div className="flex-1 overflow-auto p-3 text-xs space-y-2">
        <div className="rounded border border-border bg-subtle px-2 py-1.5">
          <p className="text-[10px] text-muted uppercase tracking-wider">
            Transport
          </p>
          <p className="mt-1 font-mono text-ink">
            {formatTransportBadge(realtime)}
          </p>
          <p className="text-[10px] text-muted">
            Last event: {formatAgeMs(realtime.lastEventMs)}
          </p>
        </div>
        <div className="rounded border border-border bg-subtle px-2 py-1.5">
          <p className="text-[10px] text-muted uppercase tracking-wider">
            Balances
          </p>
          <p className="mt-1 font-mono text-ink">
            {baseDisplay} {baseToken.symbol}
          </p>
          <p className="font-mono text-ink">
            {quoteDisplay} {quoteToken.symbol}
          </p>
          {realtime.account ? (
            <p className="text-[10px] text-muted">
              Stream snapshot seq {realtime.account.seq}
            </p>
          ) : null}
        </div>
        <div className="rounded border border-border bg-subtle px-2 py-1.5">
          <p className="text-[10px] text-muted uppercase tracking-wider">
            Margin + Exposure
          </p>
          <p className="mt-1 font-mono text-ink">
            Equity: {formatQuote(snapshot.equityQuote)}
          </p>
          <p className="font-mono text-ink">
            Used margin: {formatQuote(snapshot.usedMarginQuote)}
          </p>
          <p className="font-mono text-ink">
            Free collateral: {formatQuote(snapshot.freeCollateralQuote)}
          </p>
          <p className="font-mono text-ink">
            Maint requirement:{" "}
            {formatQuote(snapshot.maintenanceRequirementQuote)}
          </p>
          <p className="font-mono text-ink">
            Maintenance ratio: {formatRatio(snapshot.maintenanceRatio)}
          </p>
          <p
            className={cn("font-mono", riskClass(snapshot.concentrationLevel))}
          >
            Concentration: {formatPct(snapshot.concentrationRatio)}
          </p>
          <p
            className={cn(
              "font-mono",
              change24h === null
                ? "text-muted"
                : change24h >= 0
                  ? "text-emerald-300"
                  : "text-red-300",
            )}
          >
            24h change: {change24h === null ? "--" : `${change24h.toFixed(2)}%`}
          </p>
        </div>
        <div className="rounded border border-border bg-subtle px-2 py-1.5">
          <p className="text-[10px] text-muted uppercase tracking-wider">
            Liquidation Awareness
          </p>
          <p
            className={cn(
              "mt-1 font-mono",
              riskClass(snapshot.liquidationRiskLevel),
            )}
          >
            Buffer: {formatPct(snapshot.liquidationBufferPct)}
          </p>
          <p
            className={cn(
              "font-mono",
              snapshot.blockNewExposure ? "text-red-300" : "text-emerald-300",
            )}
          >
            New exposure: {snapshot.blockNewExposure ? "restricted" : "allowed"}
          </p>
          <p className="text-[10px] text-muted">
            Thresholds • init{" "}
            {(snapshot.thresholds.initialMarginRatio * 100).toFixed(1)}% • maint{" "}
            {(snapshot.thresholds.maintenanceMarginRatio * 100).toFixed(1)}% •
            conc warn{" "}
            {(snapshot.thresholds.concentrationWarningRatio * 100).toFixed(0)}%
          </p>
          {snapshot.warnings.length === 0 ? (
            <p className="text-[10px] text-emerald-300">
              No active risk warnings.
            </p>
          ) : (
            snapshot.warnings.slice(0, 2).map((warning) => (
              <p
                key={`risk-warning-${warning}`}
                className="text-[10px] text-amber-300"
              >
                {warning}
              </p>
            ))
          )}
        </div>
      </div>
    </>
  );
});
