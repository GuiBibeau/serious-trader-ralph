<script lang="ts">
  import type {
    PhoenixDailyStat,
    PhoenixMarketConfig,
  } from "$lib/phoenix-market-data";
  import { panelStyle, usePanelLayout } from "$lib/terminal/layout";
  import { buildMonitorRows, type MonitorSort } from "$lib/terminal/panels";
  import { formatNumber, formatPercent, formatPrice } from "$lib/utils";
  import type { AiRead } from "$lib/ai";
  import AiReadLine from "./AiReadLine.svelte";
  import DragHead from "./DragHead.svelte";

  let {
    markets,
    marketMids,
    dailyStats,
    selectedSymbol,
    tradeMode,
    scannerRead,
    onselect,
  }: {
    markets: PhoenixMarketConfig[];
    marketMids: Record<string, number>;
    dailyStats: Record<string, PhoenixDailyStat>;
    selectedSymbol: string;
    tradeMode: "perps" | "spot";
    // Absorbed from the retired PhoenixMarketsPanel: the AI scanner line.
    scannerRead: AiRead;
    onselect: (symbol: string) => void;
  } = $props();

  const {
    panelOrder,
    draggedPanel,
    dragOverPanel,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  } = usePanelLayout();

  // Not persisted — resets per session by design.
  let monitorSort: MonitorSort = $state("volume");
  const monitorRows = $derived(
    buildMonitorRows(markets, marketMids, dailyStats, monitorSort),
  );
</script>

<section
  id="section-markets"
  class="panel monitor-panel"
  role="group"
  data-panel="monitor"
  style={panelStyle("monitor", $panelOrder)}
  class:dragging={$draggedPanel === "monitor"}
  class:drag-over={$dragOverPanel === "monitor"}
  ondragover={(event) => onPanelDragOver(event, "monitor")}
  ondragleave={() => onPanelDragLeave("monitor")}
  ondrop={(event) => onPanelDrop(event, "monitor")}
>
  <div class="panel-head">
    <DragHead panelId="monitor" kicker="MARKETS" title={`${markets.length} perp markets`} />
    <div class="monitor-sorts" role="group" aria-label="Sort monitor">
      {#each ["volume", "change", "symbol"] as key (key)}
        <button
          type="button"
          class:active={monitorSort === key}
          onclick={() => (monitorSort = key as typeof monitorSort)}
        >{key}</button>
      {/each}
    </div>
  </div>
  <AiReadLine read={scannerRead} />
  <div class="monitor-list">
    <div class="monitor-row monitor-head" aria-hidden="true">
      <span>Market</span><span class="r">Mark</span><span class="r">24h</span><span class="r">Volume</span>
    </div>
    {#each monitorRows as row (row.symbol)}
      <button
        type="button"
        class="monitor-row"
        class:active={row.symbol === selectedSymbol && tradeMode === "perps"}
        onclick={() => onselect(row.symbol)}
      >
        <span class="monitor-sym">
          {row.symbol}
          {#if row.lev}<i>{row.lev}x</i>{/if}
        </span>
        <span class="r mono">{formatPrice(row.mid)}</span>
        <span
          class="r mono"
          class:positive={(row.change ?? 0) > 0}
          class:negative={(row.change ?? 0) < 0}
        >{row.change === null ? "--" : formatPercent(row.change)}</span>
        <span class="r mono">{row.volume === null ? "--" : `$${formatNumber(row.volume, 0)}`}</span>
      </button>
    {:else}
      <div class="empty">Markets loading…</div>
    {/each}
  </div>
</section>

<style>
  .monitor-panel {
    grid-column: span 4;
    display: flex;
    flex-direction: column;
    max-height: 26rem;
  }

  /* ── Markets monitor panel ───────────────────────────────────────── */
  .monitor-sorts {
    display: flex;
    gap: 0.2rem;
  }

  .monitor-sorts button {
    border: 0;
    background: transparent;
    color: var(--faint);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.2rem 0.35rem;
    cursor: pointer;
  }

  .monitor-sorts button.active { color: var(--accent); }

  .monitor-list {
    overflow-y: auto;
    min-height: 0;
    flex: 1;
  }

  .monitor-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 5.5rem 4.5rem 6rem;
    gap: 0.5rem;
    width: 100%;
    padding: 0.3rem 0.9rem;
    border: 0;
    border-bottom: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink);
    font-size: 0.78rem;
    text-align: left;
    cursor: pointer;
  }

  .monitor-row:hover { background: rgba(255, 77, 151, 0.04); }
  .monitor-row.active { box-shadow: inset 2px 0 0 var(--accent); background: var(--surface-2); }

  .monitor-head {
    color: var(--faint);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-family: ui-monospace, monospace;
    cursor: default;
    position: sticky;
    top: 0;
    background: var(--surface);
  }

  .monitor-sym { font-weight: 700; display: flex; gap: 0.35rem; align-items: baseline; }
  .monitor-sym i {
    font-style: normal;
    font-family: ui-monospace, monospace;
    font-size: 0.6rem;
    color: var(--muted);
    border: 1px solid var(--line);
    padding: 0 0.25rem;
  }
</style>
