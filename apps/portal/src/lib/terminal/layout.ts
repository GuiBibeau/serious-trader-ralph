// Draggable dashboard layout — panel order + drag state as a small store
// bundle. The page creates one instance, shares it with panel components
// via Svelte context, and keeps persistence to itself: `onOrderChange`
// fires only on user-driven reorders (drop / reset), mirroring the old
// saveLayout call sites. Handler bodies moved verbatim from the page.

import { getContext, setContext, tick } from "svelte";
import { get, type Readable, writable } from "svelte/store";

const PANEL_LAYOUT_CONTEXT = Symbol("terminal-panel-layout");

export type PanelLayout = {
  panelOrder: Readable<string[]>;
  draggedPanel: Readable<string | null>;
  dragOverPanel: Readable<string | null>;
  /** Replace the order without persisting (used by the page's loadLayout). */
  setOrder: (order: string[]) => void;
  /** Restore the defaults and persist (the topbar "Reset layout" button). */
  reset: () => void;
  onPanelDragStart: (event: DragEvent, id: string) => void;
  onPanelDragOver: (event: DragEvent, id: string) => void;
  onPanelDragLeave: (id: string) => void;
  onPanelDrop: (event: DragEvent, id: string) => void;
  onPanelDragEnd: () => void;
};

export function panelStyle(id: string, order: string[]): string {
  const index = order.indexOf(id);
  return `order: ${index < 0 ? 50 : index + 2};`;
}

/**
 * Saved-layout migration for the duplicate `"markets"` panel id: the
 * monitor panel and the Phoenix markets list both persisted as
 * `"markets"`. The monitor panel now owns `"monitor"` — the first
 * `"markets"` occurrence in an old payload maps to it, and `mergeLayout`
 * restores/drops the rest. Payloads that already contain `"monitor"`
 * are post-migration and pass through untouched.
 */
export function migrateLayout(saved: unknown): unknown {
  if (!Array.isArray(saved)) return saved;
  if (saved.includes("monitor")) return saved;
  const index = saved.indexOf("markets");
  if (index < 0) return saved;
  const next = [...saved];
  next[index] = "monitor";
  return next;
}

// FLIP: animate panels sliding from their old to new positions on reorder.
async function flipReorder(mutate: () => void): Promise<void> {
  if (typeof document === "undefined") {
    mutate();
    return;
  }
  const before = new Map<string, DOMRect>();
  for (const el of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    const key = el.dataset.panel;
    if (key) before.set(key, el.getBoundingClientRect());
  }
  mutate();
  await tick();
  for (const el of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    const key = el.dataset.panel;
    const first = key ? before.get(key) : undefined;
    if (!first) continue;
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (!dx && !dy) continue;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    void el.offsetWidth; // force reflow so the inverted start applies
    requestAnimationFrame(() => {
      el.style.transition = "transform 240ms cubic-bezier(0.2, 0.85, 0.3, 1)";
      el.style.transform = "";
    });
  }
}

export function createPanelLayout(
  defaults: string[],
  onOrderChange?: (order: string[]) => void,
): PanelLayout {
  const panelOrder = writable<string[]>([...defaults]);
  const draggedPanel = writable<string | null>(null);
  const dragOverPanel = writable<string | null>(null);

  function onPanelDragStart(event: DragEvent, id: string): void {
    draggedPanel.set(id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    }
  }

  function onPanelDragOver(event: DragEvent, id: string): void {
    if (!get(draggedPanel)) return;
    // Must preventDefault on every dragover for the drop to be accepted.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dragOverPanel.set(get(draggedPanel) === id ? null : id);
  }

  function onPanelDragLeave(id: string): void {
    dragOverPanel.update((current) => (current === id ? null : current));
  }

  function onPanelDrop(event: DragEvent, id: string): void {
    event.preventDefault();
    const dragged = get(draggedPanel);
    draggedPanel.set(null);
    dragOverPanel.set(null);
    if (!dragged || dragged === id) return;
    // Reorder + FLIP-animate the panels sliding to their new positions.
    void flipReorder(() => {
      const current = get(panelOrder);
      const fromIndex = current.indexOf(dragged);
      const toIndex = current.indexOf(id);
      const order = current.filter((panel) => panel !== dragged);
      let targetIndex = order.indexOf(id);
      if (targetIndex < 0) {
        targetIndex = order.length;
      } else if (fromIndex < toIndex) {
        // Dragging forward → drop AFTER the target, not before it.
        targetIndex += 1;
      }
      order.splice(targetIndex, 0, dragged);
      panelOrder.set(order);
      onOrderChange?.(order);
    });
  }

  function onPanelDragEnd(): void {
    draggedPanel.set(null);
    dragOverPanel.set(null);
  }

  return {
    panelOrder,
    draggedPanel,
    dragOverPanel,
    setOrder: (order) => panelOrder.set(order),
    reset: () => {
      const order = [...defaults];
      panelOrder.set(order);
      onOrderChange?.(order);
    },
    onPanelDragStart,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
    onPanelDragEnd,
  };
}

export function providePanelLayout(layout: PanelLayout): PanelLayout {
  setContext(PANEL_LAYOUT_CONTEXT, layout);
  return layout;
}

export function usePanelLayout(): PanelLayout {
  const layout = getContext<PanelLayout | undefined>(PANEL_LAYOUT_CONTEXT);
  if (!layout) {
    throw new Error("usePanelLayout() requires providePanelLayout() upstream");
  }
  return layout;
}
