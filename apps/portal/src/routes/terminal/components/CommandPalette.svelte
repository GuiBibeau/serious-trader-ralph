<script lang="ts">
  import { tick } from "svelte";
  import type {
    PhoenixDailyStat,
    PhoenixMarketConfig,
  } from "$lib/phoenix-market-data";
  import type { PhoenixOpenOrder, PhoenixPosition } from "$lib/phoenix-trade";
  import type { SpotAsset } from "$lib/spot";
  import {
    buildPaletteRows,
    PALETTE_TABS,
    type PaletteRow,
    type PaletteTab,
  } from "$lib/terminal/palette";
  import { formatNumber, formatPercent, formatPrice } from "$lib/utils";

  let {
    markets,
    spotAssets,
    marketMids,
    dailyStats,
    watchlist,
    positions,
    openOrders,
    oncloseposition,
    oncancelorders,
    onflatten,
    onselect,
    ontogglewatch,
    onclose,
  }: {
    markets: PhoenixMarketConfig[];
    spotAssets: SpotAsset[];
    marketMids: Record<string, number>;
    dailyStats: Record<string, PhoenixDailyStat>;
    watchlist: string[];
    positions: PhoenixPosition[];
    openOrders: PhoenixOpenOrder[];
    oncloseposition: (position: PhoenixPosition) => void;
    oncancelorders: (symbol: string) => void;
    onflatten: () => void;
    onselect: (row: PaletteRow) => void;
    ontogglewatch: (symbol: string) => void;
    onclose: () => void;
  } = $props();

  // Mount-time state replaces the page's old openPalette() reset — the
  // component only exists while the palette is open, so every open starts
  // from a blank query on the "All" tab. That is also the perf win: the
  // row build below no longer runs on every mids tick while closed.
  let query = $state("");
  let tab: PaletteTab = $state("all");
  let index = $state(0);
  let input: HTMLInputElement | null = $state(null);
  let list: HTMLDivElement | null = $state(null);

  const rows = $derived(
    buildPaletteRows(
      markets,
      spotAssets,
      marketMids,
      dailyStats,
      query,
      tab,
      positions,
      openOrders,
      oncloseposition,
      oncancelorders,
      onflatten,
    ),
  );
  $effect(() => {
    if (index >= rows.length) index = Math.max(0, rows.length - 1);
  });
  // Focus-on-mount replaces openPalette()'s tick() focus.
  $effect(() => {
    input?.focus();
  });

  function scrollRowIntoView(): void {
    void tick().then(() =>
      list?.children[index]?.scrollIntoView({ block: "nearest" }),
    );
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      index = Math.min(index + 1, rows.length - 1);
      scrollRowIntoView();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      index = Math.max(index - 1, 0);
      scrollRowIntoView();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[index];
      if (row) onselect(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onclose();
    }
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={() => onclose()}>
  <div
    class="modal palette"
    role="dialog"
    aria-modal="true"
    aria-label="Select market"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={onKeydown}
  >
    <div class="palette-search">
      <span class="palette-glass" aria-hidden="true">⌕</span>
      <input
        bind:this={input}
        bind:value={query}
        placeholder="Search markets"
        aria-label="Search markets"
        oninput={() => (index = 0)}
      />
    </div>
    <div class="palette-tabs" role="tablist" aria-label="Market category">
      {#each PALETTE_TABS as tabOption (tabOption.key)}
        <button
          role="tab"
          aria-selected={tab === tabOption.key}
          class:active={tab === tabOption.key}
          type="button"
          onclick={() => {
            tab = tabOption.key;
            index = 0;
          }}
        >
          {tabOption.label}
        </button>
      {/each}
    </div>
    <div class="palette-row palette-head" aria-hidden="true">
      <span></span>
      <span>Market</span>
      <span class="r">Price</span>
      <span class="r">24h</span>
      <span class="r pal-wide">Volume</span>
    </div>
    <div class="palette-list" bind:this={list}>
      {#each rows as row, rowIndex (row.key)}
        <button
          type="button"
          class="palette-row"
          class:active={rowIndex === index}
          onclick={() => onselect(row)}
          onmousemove={() => (index = rowIndex)}
        >
          {#if row.kind === "action"}
            <span class="pal-star" aria-hidden="true">▸</span>
            <span class="pal-id">
              <b>{row.name}</b>
              <small>ACTION</small>
            </span>
          {:else}
            <span
              class="pal-star"
              class:starred={watchlist.includes(row.symbol.toUpperCase())}
              role="presentation"
              onclick={(event) => {
                event.stopPropagation();
                ontogglewatch(row.symbol);
              }}
            >{watchlist.includes(row.symbol.toUpperCase()) ? "★" : "☆"}</span>
            <span class="pal-id">
              {#if row.imageUrl}<img src={row.imageUrl} alt="" loading="lazy" />{/if}
              <b>{row.kind === "perp" ? `${row.symbol}` : row.symbol}</b>
              {#if row.lev}<i class="pal-lev">{row.lev}x</i>{/if}
              <small>{row.kind === "perp" ? "PERP · Phoenix" : row.name}</small>
            </span>
          {/if}
          <span class="r mono">{formatPrice(row.price)}</span>
          <span
            class="r mono"
            class:positive={(row.change24hPct ?? 0) > 0 && row.change24hPct !== null}
            class:negative={(row.change24hPct ?? 0) < 0}
          >{row.change24hPct === null ? "--" : formatPercent(row.change24hPct)}</span>
          <span class="r mono pal-wide">
            {row.volumeUsd === null ? "--" : `$${formatNumber(row.volumeUsd, 0)}`}
          </span>
        </button>
      {:else}
        <p class="palette-empty">No markets match “{query}”.</p>
      {/each}
    </div>
    <div class="palette-foot" aria-hidden="true">
      <span><kbd>/</kbd> Open</span>
      <span><kbd>↑↓</kbd> Navigate</span>
      <span><kbd>Enter</kbd> Select</span>
      <span><kbd>Esc</kbd> Close</span>
    </div>
  </div>
</div>

<style>
  .modal.palette {
    width: min(52rem, 100%);
    max-height: min(40rem, calc(100dvh - 4rem));
  }

  .palette-search {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .palette-glass {
    color: var(--faint);
    font-size: 1.1rem;
  }

  .palette-search input {
    flex: 1;
    border: 0;
    background: transparent;
    font-size: 1rem;
    color: var(--ink);
  }

  .palette-search input:focus {
    outline: none;
  }

  .palette-tabs {
    display: flex;
    gap: 0.2rem;
    padding: 0 0.6rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .palette-tabs button {
    border: 0;
    border-bottom: 3px solid transparent;
    background: transparent;
    color: var(--muted);
    padding: 0.5rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .palette-tabs button:hover {
    color: var(--ink);
  }

  .palette-tabs button.active {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }

  .palette-row {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr) 7rem 5.5rem 8rem;
    gap: 0.6rem;
    align-items: center;
    width: 100%;
    padding: 0.5rem 1rem;
    border: 0;
    border-bottom: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .palette-head {
    color: var(--faint);
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-family: ui-monospace, monospace;
    cursor: default;
    padding-block: 0.4rem;
  }

  .palette-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .palette-list .palette-row.active {
    background: var(--surface-2);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .pal-star {
    color: var(--faint);
    cursor: pointer;
    text-align: center;
  }

  .pal-star:hover,
  .pal-star.starred {
    color: var(--amber);
  }

  .pal-id {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    min-width: 0;
  }

  .pal-id img {
    width: 1.15rem;
    height: 1.15rem;
    border-radius: 50%;
    align-self: center;
    flex: 0 0 auto;
  }

  .pal-id b {
    font-size: 0.9rem;
  }

  .pal-id small {
    color: var(--faint);
    font-size: 0.7rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pal-lev {
    font-style: normal;
    font-family: ui-monospace, monospace;
    font-size: 0.64rem;
    color: var(--muted);
    border: 1px solid var(--line);
    padding: 0.02rem 0.3rem;
  }

  .palette-empty {
    padding: 1.2rem 1rem;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .palette-foot {
    display: flex;
    gap: 1.2rem;
    padding: 0.55rem 1rem;
    border-top: 1px solid var(--line-soft);
    color: var(--muted);
    font-size: 0.72rem;
  }

  .palette-foot kbd {
    font-family: ui-monospace, monospace;
    font-size: 0.68rem;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    padding: 0.05rem 0.35rem;
    margin-right: 0.3rem;
  }

  @media (max-width: 720px) {
    .palette-row {
      grid-template-columns: 2rem minmax(0, 1fr) 6rem 4.5rem;
    }

    .pal-wide {
      display: none;
    }
  }
</style>
