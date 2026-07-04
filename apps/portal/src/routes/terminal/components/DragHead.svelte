<script lang="ts">
  import { usePanelLayout } from "$lib/terminal/layout";

  let {
    panelId,
    kicker,
    title,
  }: { panelId: string; kicker: string; title: string } = $props();

  const { onPanelDragStart, onPanelDragEnd } = usePanelLayout();
</script>

<div
  class="panel-head-main"
  draggable="true"
  role="button"
  tabindex="0"
  aria-label="Drag to reorder {kicker} panel"
  ondragstart={(event) => onPanelDragStart(event, panelId)}
  ondragend={onPanelDragEnd}
>
  <span class="drag-grip" aria-hidden="true">⠿</span>
  <div>
    <p>{kicker}</p>
    <h2>{title}</h2>
  </div>
</div>

<style>
  /* Draggable panel header (grab the title to move the widget) */
  .panel-head-main {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    cursor: grab;
  }

  .panel-head-main:active {
    cursor: grabbing;
  }

  .drag-grip {
    color: var(--faint);
    font-size: 0.85rem;
    line-height: 1;
    letter-spacing: -0.1em;
    opacity: 0;
    transition: opacity 120ms ease, color 120ms ease;
  }

  .panel-head-main:hover .drag-grip {
    color: var(--accent);
  }
</style>
