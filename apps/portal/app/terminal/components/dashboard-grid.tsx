// import RGL from "react-grid-layout"; // Commented out to avoid ESM issues
import { type ReactNode, useCallback, useEffect, useState } from "react";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// Force CommonJS require to avoid ESM issues with react-grid-layout v2 in Next.js
const RGL = require("react-grid-layout");
const ResponsiveGridLayout = RGL.Responsive;
const useContainerWidth = RGL.useContainerWidth;

// Define local Layout interface to avoid type conflicts
interface Layout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  static?: boolean;
}

interface DashboardGridProps {
  children: ReactNode[];
  className?: string;
  onLayoutChange?: (layout: Layout[]) => void;
  allowLayoutEditing?: boolean;
  storageKey?: string;
}

const DASHBOARD_LAYOUT_STORAGE_KEY = "dashboard-grid-layouts:v6";
const LAYOUT_BREAKPOINTS = ["lg", "md", "sm"] as const;

type LayoutBreakpoint = (typeof LAYOUT_BREAKPOINTS)[number];
type ComparableLayout = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
};
type ComparableLayouts = Record<LayoutBreakpoint, ComparableLayout[]>;
type DashboardLayouts = Record<string, Layout[]>;

const DEFAULT_DASHBOARD_LAYOUTS: Record<LayoutBreakpoint, Layout[]> = {
  lg: [
    { i: "chart", x: 0, y: 0, w: 7, h: 6 },
    { i: "orderbook", x: 7, y: 0, w: 3, h: 4 },
    { i: "order_entry", x: 10, y: 0, w: 2, h: 3 },
    { i: "trades_tape", x: 10, y: 3, w: 2, h: 3 },
    { i: "positions", x: 7, y: 4, w: 3, h: 2 },
    { i: "account_risk", x: 0, y: 6, w: 4, h: 3 },
    { i: "macro_radar", x: 4, y: 6, w: 4, h: 3 },
    { i: "macro_fred", x: 8, y: 6, w: 4, h: 3 },
    { i: "macro_etf", x: 0, y: 9, w: 4, h: 3 },
    { i: "macro_stablecoin", x: 4, y: 9, w: 4, h: 3 },
    { i: "macro_oil", x: 8, y: 9, w: 4, h: 3 },
    { i: "degen_watchlist", x: 0, y: 12, w: 6, h: 3 },
    { i: "degen_event_hooks", x: 6, y: 12, w: 6, h: 3 },
  ],
  md: [
    { i: "chart", x: 0, y: 0, w: 6, h: 6 },
    { i: "orderbook", x: 6, y: 0, w: 2, h: 3 },
    { i: "order_entry", x: 8, y: 0, w: 2, h: 3 },
    { i: "trades_tape", x: 8, y: 3, w: 2, h: 3 },
    { i: "positions", x: 6, y: 3, w: 2, h: 3 },
    { i: "account_risk", x: 0, y: 6, w: 5, h: 3 },
    { i: "macro_radar", x: 5, y: 6, w: 5, h: 3 },
    { i: "macro_fred", x: 0, y: 9, w: 5, h: 3 },
    { i: "macro_etf", x: 5, y: 9, w: 5, h: 3 },
    { i: "macro_stablecoin", x: 0, y: 12, w: 5, h: 3 },
    { i: "macro_oil", x: 5, y: 12, w: 5, h: 3 },
    { i: "degen_watchlist", x: 0, y: 15, w: 5, h: 3 },
    { i: "degen_event_hooks", x: 5, y: 15, w: 5, h: 3 },
  ],
  sm: [
    { i: "chart", x: 0, y: 0, w: 6, h: 5 },
    { i: "orderbook", x: 0, y: 5, w: 3, h: 3 },
    { i: "order_entry", x: 3, y: 5, w: 3, h: 3 },
    { i: "trades_tape", x: 0, y: 8, w: 6, h: 3 },
    { i: "positions", x: 0, y: 11, w: 6, h: 3 },
    { i: "account_risk", x: 0, y: 14, w: 6, h: 3 },
    { i: "macro_radar", x: 0, y: 17, w: 6, h: 3 },
    { i: "macro_fred", x: 0, y: 20, w: 6, h: 3 },
    { i: "macro_etf", x: 0, y: 23, w: 6, h: 3 },
    { i: "macro_stablecoin", x: 0, y: 26, w: 6, h: 3 },
    { i: "macro_oil", x: 0, y: 29, w: 6, h: 3 },
    { i: "degen_watchlist", x: 0, y: 32, w: 6, h: 3 },
    { i: "degen_event_hooks", x: 0, y: 35, w: 6, h: 3 },
  ],
};

const KNOWN_PANEL_IDS = new Set(
  LAYOUT_BREAKPOINTS.flatMap((breakpoint) =>
    DEFAULT_DASHBOARD_LAYOUTS[breakpoint].map((entry) => entry.i),
  ),
);

const GRID_OVERLAY_STYLES = `
  .react-grid-item.react-grid-placeholder {
    background: rgba(16, 185, 129, 0.1) !important;
    border: 1px dashed #10b981 !important;
    border-radius: 4px !important;
    opacity: 0.5 !important;
  }
  .react-resizable-handle {
    background-image: none !important;
    z-index: 100;
  }
  .react-resizable-handle::after {
    content: "";
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 8px;
    height: 8px;
    border-right: 2px solid rgba(255, 255, 255, 0.4);
    border-bottom: 2px solid rgba(255, 255, 255, 0.4);
    cursor: se-resize;
  }
  .react-resizable-handle:hover::after {
    border-right: 2px solid rgba(16, 185, 129, 0.8);
    border-bottom: 2px solid rgba(16, 185, 129, 0.8);
  }
`;

function normalizeLayoutsForCompare(layouts: unknown): ComparableLayouts {
  const result: ComparableLayouts = {
    lg: [],
    md: [],
    sm: [],
  };
  if (!layouts || typeof layouts !== "object") return result;

  const record = layouts as Record<string, unknown>;
  for (const breakpoint of LAYOUT_BREAKPOINTS) {
    const value = record[breakpoint];
    if (!Array.isArray(value)) continue;

    result[breakpoint] = value
      .filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object",
      )
      .map((entry) => ({
        i: String(entry.i ?? ""),
        x: Number(entry.x ?? 0),
        y: Number(entry.y ?? 0),
        w: Number(entry.w ?? 0),
        h: Number(entry.h ?? 0),
      }))
      .sort((a, b) => a.i.localeCompare(b.i));
  }

  return result;
}

function isDashboardLayoutModified(layouts: unknown): boolean {
  const normalizedCurrent = normalizeLayoutsForCompare(layouts);
  const normalizedDefault = normalizeLayoutsForCompare(
    DEFAULT_DASHBOARD_LAYOUTS,
  );
  return (
    JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedDefault)
  );
}

function resolveLayoutStorageKey(storageKey?: string): string {
  const normalized = String(storageKey ?? "").trim();
  return normalized || DASHBOARD_LAYOUT_STORAGE_KEY;
}

function cloneDefaultDashboardLayouts(): DashboardLayouts {
  return {
    lg: DEFAULT_DASHBOARD_LAYOUTS.lg.map((entry) => ({ ...entry })),
    md: DEFAULT_DASHBOARD_LAYOUTS.md.map((entry) => ({ ...entry })),
    sm: DEFAULT_DASHBOARD_LAYOUTS.sm.map((entry) => ({ ...entry })),
  };
}

function sanitizeLayoutEntry(raw: unknown): Layout | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const i = String(entry.i ?? "").trim();
  if (!i || !KNOWN_PANEL_IDS.has(i)) return null;
  const x = Number(entry.x ?? 0);
  const y = Number(entry.y ?? 0);
  const w = Number(entry.w ?? 0);
  const h = Number(entry.h ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w <= 0 || h <= 0) return null;

  return {
    i,
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
    w: Math.max(1, Math.floor(w)),
    h: Math.max(1, Math.floor(h)),
  };
}

function sanitizeDashboardLayouts(layouts: unknown): DashboardLayouts | null {
  if (!layouts || typeof layouts !== "object") return null;
  const record = layouts as Record<string, unknown>;
  const sanitized = cloneDefaultDashboardLayouts();

  for (const breakpoint of LAYOUT_BREAKPOINTS) {
    const rawEntries = Array.isArray(record[breakpoint])
      ? record[breakpoint]
      : [];
    const entriesById = new Map<string, Layout>();

    for (const rawEntry of rawEntries) {
      const parsed = sanitizeLayoutEntry(rawEntry);
      if (!parsed) continue;
      if (entriesById.has(parsed.i)) continue;
      entriesById.set(parsed.i, parsed);
    }

    if (entriesById.size < 1) continue;

    const nextEntries = Array.from(entriesById.values());
    const missingDefaults = DEFAULT_DASHBOARD_LAYOUTS[breakpoint]
      .filter((entry) => !entriesById.has(entry.i))
      .map((entry) => ({ ...entry }));
    sanitized[breakpoint] = [...nextEntries, ...missingDefaults];
  }

  return sanitized;
}

function readStoredDashboardLayouts(
  storageKey?: string,
): DashboardLayouts | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      resolveLayoutStorageKey(storageKey),
    );
    if (!raw) return null;
    return sanitizeDashboardLayouts(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearDashboardGridLayouts(storageKey?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(resolveLayoutStorageKey(storageKey));
  } catch {
    // Ignore storage errors.
  }
}

export function hasCustomDashboardGridLayouts(storageKey?: string): boolean {
  const stored = readStoredDashboardLayouts(storageKey);
  if (!stored) return false;
  return isDashboardLayoutModified(stored);
}

export function DashboardGrid({
  children,
  className,
  onLayoutChange,
  allowLayoutEditing = true,
  storageKey,
}: DashboardGridProps) {
  // Use the hook to get width
  const { width, containerRef, mounted } = useContainerWidth();
  const resolvedStorageKey = resolveLayoutStorageKey(storageKey);

  const [layouts, setLayouts] = useState<DashboardLayouts>(() => {
    const stored = readStoredDashboardLayouts(resolvedStorageKey);
    if (!stored || !isDashboardLayoutModified(stored)) {
      clearDashboardGridLayouts(resolvedStorageKey);
      return cloneDefaultDashboardLayouts();
    }

    return stored;
  });

  useEffect(() => {
    const stored = readStoredDashboardLayouts(resolvedStorageKey);
    if (!stored || !isDashboardLayoutModified(stored)) {
      clearDashboardGridLayouts(resolvedStorageKey);
      setLayouts(cloneDefaultDashboardLayouts());
      return;
    }
    setLayouts(stored);
  }, [resolvedStorageKey]);

  const handleLayoutChange = useCallback(
    (layout: Layout[], allLayouts: DashboardLayouts) => {
      const sanitized =
        sanitizeDashboardLayouts(allLayouts) ?? cloneDefaultDashboardLayouts();
      setLayouts(sanitized);
      if (isDashboardLayoutModified(sanitized)) {
        try {
          window.localStorage.setItem(
            resolvedStorageKey,
            JSON.stringify(sanitized),
          );
        } catch {
          // Ignore storage errors and keep in-memory behavior.
        }
      } else {
        clearDashboardGridLayouts(resolvedStorageKey);
      }
      if (onLayoutChange) onLayoutChange(layout);
    },
    [onLayoutChange, resolvedStorageKey],
  );

  return (
    <div className={className} ref={containerRef}>
      <style>{GRID_OVERLAY_STYLES}</style>
      {mounted && (
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={80}
          width={width}
          margin={[1, 1]}
          containerPadding={[0, 0]}
          onLayoutChange={handleLayoutChange}
          isDraggable={allowLayoutEditing}
          isResizable={allowLayoutEditing}
          draggableHandle=".dashboard-drag-handle"
          draggableCancel=".no-drag"
        >
          {children}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
