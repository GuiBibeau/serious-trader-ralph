import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { createPanelLayout, migrateLayout, panelStyle } from "./layout";
import { DEFAULT_PANEL_ORDER, mergeLayout } from "./prefs";

// Old payloads persisted BOTH the monitor panel and the Phoenix markets
// list as "markets" (the duplicate-id bug). The pre-fix default order:
const LEGACY_DEFAULT_ORDER = [
  "watch",
  "markets",
  "perp",
  "spot",
  "screener",
  "macro",
  "fred",
  "etf",
  "stablecoins",
  "oil",
  "events",
  "ideas",
  "markets",
  "journal",
];

describe("migrateLayout", () => {
  test('maps the FIRST "markets" of a legacy payload to "monitor"', () => {
    expect(migrateLayout(LEGACY_DEFAULT_ORDER)).toEqual([
      "watch",
      "monitor",
      "perp",
      "spot",
      "screener",
      "macro",
      "fred",
      "etf",
      "stablecoins",
      "oil",
      "events",
      "ideas",
      "markets",
      "journal",
    ]);
  });

  test("legacy default payload migrates to the new default order", () => {
    // The duplicate collapsed exactly onto the fixed DEFAULT_PANEL_ORDER.
    const merged = mergeLayout(
      migrateLayout(LEGACY_DEFAULT_ORDER),
      DEFAULT_PANEL_ORDER,
    );
    expect(merged).toEqual(DEFAULT_PANEL_ORDER);
  });

  test('single leftover "markets" becomes the monitor; dock-era retired ids drop', () => {
    // Dragging either "markets" panel collapsed the duplicate to ONE entry
    // (the drop handler filters every occurrence of the dragged id). The
    // day-trading grid then retires "perp" (lives in the dock) and the
    // Phoenix "markets" list (merged into the monitor) from the defaults —
    // mergeLayout drops them from old saves and appends what's missing.
    const saved = ["perp", "markets", "watch"];
    const merged = mergeLayout(migrateLayout(saved), DEFAULT_PANEL_ORDER);
    expect(merged[0]).toBe("monitor");
    expect(merged[1]).toBe("watch");
    expect(merged).not.toContain("perp");
    expect(merged).not.toContain("markets");
    expect(merged.toSorted()).toEqual([...DEFAULT_PANEL_ORDER].toSorted());
  });

  test('post-migration payloads (containing "monitor") pass through untouched', () => {
    const saved = ["monitor", "markets", "watch"];
    expect(migrateLayout(saved)).toBe(saved);
  });

  test('payloads without "markets" pass through untouched', () => {
    const saved = ["watch", "perp"];
    expect(migrateLayout(saved)).toBe(saved);
    expect(migrateLayout(null)).toBe(null);
    expect(migrateLayout("junk")).toBe("junk");
  });

  test("does not mutate its input", () => {
    const saved = ["markets", "watch"];
    expect(migrateLayout(saved)).toEqual(["monitor", "watch"]);
    expect(saved).toEqual(["markets", "watch"]);
  });
});

describe("panelStyle", () => {
  test("maps order index to CSS order (+2 for the anchored chart/book)", () => {
    expect(panelStyle("a", ["a", "b"])).toBe("order: 2;");
    expect(panelStyle("b", ["a", "b"])).toBe("order: 3;");
  });

  test("unknown panel id sinks to order 50", () => {
    expect(panelStyle("zzz", ["a", "b"])).toBe("order: 50;");
  });
});

function fakeDragEvent(): DragEvent {
  return {
    preventDefault() {},
    dataTransfer: null,
  } as unknown as DragEvent;
}

describe("createPanelLayout", () => {
  test("starts from a copy of the defaults", () => {
    const defaults = ["a", "b", "c"];
    const layout = createPanelLayout(defaults);
    expect(get(layout.panelOrder)).toEqual(defaults);
    expect(get(layout.panelOrder)).not.toBe(defaults);
  });

  test("drag forward drops AFTER the target", () => {
    const saved: string[][] = [];
    const layout = createPanelLayout(["a", "b", "c"], (o) => saved.push(o));
    layout.onPanelDragStart(fakeDragEvent(), "a");
    layout.onPanelDrop(fakeDragEvent(), "b");
    expect(get(layout.panelOrder)).toEqual(["b", "a", "c"]);
    expect(saved).toEqual([["b", "a", "c"]]);
    expect(get(layout.draggedPanel)).toBe(null);
    expect(get(layout.dragOverPanel)).toBe(null);
  });

  test("drag backward drops BEFORE the target", () => {
    const layout = createPanelLayout(["a", "b", "c"]);
    layout.onPanelDragStart(fakeDragEvent(), "c");
    layout.onPanelDrop(fakeDragEvent(), "a");
    expect(get(layout.panelOrder)).toEqual(["c", "a", "b"]);
  });

  test("drop on itself is a no-op and does not persist", () => {
    const saved: string[][] = [];
    const layout = createPanelLayout(["a", "b"], (o) => saved.push(o));
    layout.onPanelDragStart(fakeDragEvent(), "a");
    layout.onPanelDrop(fakeDragEvent(), "a");
    expect(get(layout.panelOrder)).toEqual(["a", "b"]);
    expect(saved).toEqual([]);
  });

  test("dragover/dragleave track the hovered panel (never the dragged one)", () => {
    const layout = createPanelLayout(["a", "b"]);
    // No drag in flight → dragover ignored.
    layout.onPanelDragOver(fakeDragEvent(), "b");
    expect(get(layout.dragOverPanel)).toBe(null);
    layout.onPanelDragStart(fakeDragEvent(), "a");
    layout.onPanelDragOver(fakeDragEvent(), "a");
    expect(get(layout.dragOverPanel)).toBe(null);
    layout.onPanelDragOver(fakeDragEvent(), "b");
    expect(get(layout.dragOverPanel)).toBe("b");
    // Leaving a different panel does not clear the current target.
    layout.onPanelDragLeave("a");
    expect(get(layout.dragOverPanel)).toBe("b");
    layout.onPanelDragLeave("b");
    expect(get(layout.dragOverPanel)).toBe(null);
    layout.onPanelDragEnd();
    expect(get(layout.draggedPanel)).toBe(null);
  });

  test("setOrder replaces without persisting; reset restores defaults and persists", () => {
    const saved: string[][] = [];
    const layout = createPanelLayout(["a", "b"], (o) => saved.push(o));
    layout.setOrder(["b", "a"]);
    expect(get(layout.panelOrder)).toEqual(["b", "a"]);
    expect(saved).toEqual([]);
    layout.reset();
    expect(get(layout.panelOrder)).toEqual(["a", "b"]);
    expect(saved).toEqual([["a", "b"]]);
  });
});
