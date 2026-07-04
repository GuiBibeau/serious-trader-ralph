<script lang="ts">
  import type { AiRead } from "$lib/ai";
  import type { DataPanel } from "$lib/edge-data";
  import { panelStyle, usePanelLayout } from "$lib/terminal/layout";
  import AiReadLine from "./AiReadLine.svelte";
  import DragHead from "./DragHead.svelte";
  import Spark from "./Spark.svelte";

  let {
    title,
    subtitle,
    panel,
    panelId,
    id,
    read,
  }: {
    title: string;
    subtitle: string;
    panel: DataPanel;
    panelId: string;
    id?: string;
    read?: AiRead;
  } = $props();

  const {
    panelOrder,
    draggedPanel,
    dragOverPanel,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  } = usePanelLayout();
</script>

<section
  class="panel macro-panel"
  {id}
  role="group"
  data-panel={panelId}
  style={panelStyle(panelId, $panelOrder)}
  class:dragging={$draggedPanel === panelId}
  class:drag-over={$dragOverPanel === panelId}
  ondragover={(event) => onPanelDragOver(event, panelId)}
  ondragleave={() => onPanelDragLeave(panelId)}
  ondrop={(event) => onPanelDrop(event, panelId)}
>
  <div class="panel-head">
    <DragHead {panelId} kicker={title} title={subtitle} />
    {#if panel.summary}
      <span class="verdict-badge {panel.summary.tone ?? 'flat'}">
        {panel.summary.label}
      </span>
    {/if}
  </div>
  {#if read}
    <AiReadLine {read} />
  {/if}
  <div class="table macro-table">
    {#each panel.rows.slice(0, 6) as row}
      <div class="macro-row">
        <span class="macro-label">{row.label}</span>
        <span class="macro-spark">
          {#if row.spark && row.spark.length > 1}
            <Spark values={row.spark} tone={row.tone ?? "flat"} />
          {/if}
        </span>
        <span class="macro-value">
          <b class={row.tone ?? "flat"}>{row.value}</b>
          {#if row.change}
            <em class="macro-delta {row.tone ?? 'flat'}">{row.change}</em>
          {/if}
        </span>
        <span class="macro-chip {row.tone ?? 'flat'}">{row.status}</span>
      </div>
    {/each}
  </div>
</section>

<style>
  .macro-panel {
    grid-column: span 4;
  }

  /* ── Macro panels: verdict badge, signal rows, sparklines ─────────── */
  .verdict-badge {
    flex: 0 0 auto;
    border-radius: 0;
    padding: 0.2rem 0.55rem;
    font-size: 0.62rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .table {
    display: grid;
    gap: 0.15rem;
    padding: 0.65rem;
  }

  .macro-table {
    gap: 0;
  }

  .macro-row {
    display: grid;
    grid-template-columns: minmax(3.5rem, 1fr) 3.4rem minmax(0, auto) auto;
    align-items: center;
    gap: 0.55rem;
    min-height: 2.2rem;
    padding: 0.5rem 0.25rem;
    border-bottom: 1px solid var(--line-soft);
    font-size: 0.75rem;
  }

  .macro-label {
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .macro-spark {
    display: flex;
    align-items: center;
    height: 1.15rem;
  }

  .macro-value {
    display: inline-flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 0.35rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .macro-value b {
    color: var(--ink);
    font-weight: 700;
  }

  .macro-delta {
    color: var(--muted);
    font-size: 0.68rem;
    font-style: normal;
    font-weight: 600;
  }

  .macro-chip {
    justify-self: end;
    border-radius: 0;
    padding: 0.1rem 0.5rem;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border: 1px solid transparent;
  }

  /* Tone palette shared by badge / value / delta / chip */
  .up {
    color: #8decc3;
    stroke: var(--up);
  }

  .down {
    color: var(--red);
    stroke: var(--red);
  }

  .warn {
    color: var(--amber);
    stroke: var(--amber);
  }

  .verdict-badge.up,
  .macro-chip.up {
    color: var(--up);
    background: var(--up-soft);
    border-color: rgba(44, 233, 127, 0.35);
  }

  .verdict-badge.down,
  .macro-chip.down {
    color: var(--red);
    background: rgba(240, 107, 99, 0.12);
    border-color: rgba(240, 107, 99, 0.35);
  }

  .verdict-badge.warn,
  .macro-chip.warn {
    color: var(--amber);
    background: rgba(228, 173, 79, 0.12);
    border-color: rgba(228, 173, 79, 0.35);
  }

  .verdict-badge.flat,
  .macro-chip.flat {
    color: var(--muted);
    background: var(--surface-2);
    border-color: var(--line);
  }

  @media (max-width: 1100px) {
    .macro-panel {
      grid-column: span 6;
    }
  }

  @media (max-width: 720px) {
    .macro-panel {
      grid-column: span 1;
    }

    .macro-row {
      grid-template-columns: minmax(3rem, 1fr) auto auto;
    }

    .macro-spark {
      display: none;
    }
  }
</style>
