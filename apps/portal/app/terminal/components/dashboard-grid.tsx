// import RGL from "react-grid-layout"; // Commented out to avoid ESM issues
import { type ReactNode, useCallback, useState } from "react";
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
}

const DASHBOARD_LAYOUT_STORAGE_KEY = "dashboard-grid-layouts:v3";
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
    { i: "market", x: 0, y: 0, w: 12, h: 4 },
    { i: "wallet", x: 0, y: 4, w: 4, h: 3 },
    { i: "macro_radar", x: 4, y: 4, w: 4, h: 3 },
    { i: "macro_fred", x: 8, y: 4, w: 4, h: 3 },
    { i: "macro_etf", x: 0, y: 7, w: 4, h: 3 },
    { i: "macro_stablecoin", x: 4, y: 7, w: 4, h: 3 },
    { i: "macro_oil", x: 8, y: 7, w: 4, h: 3 },
  ],
  md: [
    { i: "market", x: 0, y: 0, w: 10, h: 4 },
    { i: "wallet", x: 0, y: 4, w: 10, h: 3 },
    { i: "macro_radar", x: 0, y: 7, w: 5, h: 3 },
    { i: "macro_fred", x: 5, y: 7, w: 5, h: 3 },
    { i: "macro_etf", x: 0, y: 10, w: 5, h: 3 },
    { i: "macro_stablecoin", x: 5, y: 10, w: 5, h: 3 },
    { i: "macro_oil", x: 0, y: 13, w: 10, h: 3 },
  ],
  sm: [
    { i: "market", x: 0, y: 0, w: 6, h: 4 },
    { i: "wallet", x: 0, y: 4, w: 6, h: 2 },
    { i: "macro_radar", x: 0, y: 6, w: 6, h: 3 },
    { i: "macro_fred", x: 0, y: 9, w: 6, h: 3 },
    { i: "macro_etf", x: 0, y: 12, w: 6, h: 3 },
    { i: "macro_stablecoin", x: 0, y: 15, w: 6, h: 3 },
    { i: "macro_oil", x: 0, y: 18, w: 6, h: 3 },
  ],
};

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

function readStoredDashboardLayouts(): unknown | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearDashboardGridLayouts(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DASHBOARD_LAYOUT_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function hasCustomDashboardGridLayouts(): boolean {
  const stored = readStoredDashboardLayouts();
  if (!stored) return false;
  return isDashboardLayoutModified(stored);
}

export function DashboardGrid({
  children,
  className,
  onLayoutChange,
  allowLayoutEditing = true,
}: DashboardGridProps) {
  // Use the hook to get width
  const { width, containerRef, mounted } = useContainerWidth();

  const [layouts, setLayouts] = useState<DashboardLayouts>(() => {
    const stored = readStoredDashboardLayouts();
    if (!stored || !isDashboardLayoutModified(stored)) {
      clearDashboardGridLayouts();
      return DEFAULT_DASHBOARD_LAYOUTS as DashboardLayouts;
    }

    return {
      ...DEFAULT_DASHBOARD_LAYOUTS,
      ...(stored as Record<string, unknown>),
    };
  });

  const handleLayoutChange = useCallback(
    (layout: Layout[], allLayouts: DashboardLayouts) => {
      setLayouts(allLayouts);
      if (isDashboardLayoutModified(allLayouts)) {
        try {
          window.localStorage.setItem(
            DASHBOARD_LAYOUT_STORAGE_KEY,
            JSON.stringify(allLayouts),
          );
        } catch {
          // Ignore storage errors and keep in-memory behavior.
        }
      } else {
        clearDashboardGridLayouts();
      }
      if (onLayoutChange) onLayoutChange(layout);
    },
    [onLayoutChange],
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
