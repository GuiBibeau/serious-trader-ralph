<script lang="ts">
  import type { PhoenixMarketConfig } from "$lib/phoenix-market-data";
  import type { SpotAsset } from "$lib/spot";
  import { buildWatchRows, type WatchRow } from "$lib/terminal/panels";
  import { formatNumber, formatPercent, formatPrice } from "$lib/utils";

  let {
    watchlist,
    spotAssets,
    marketMids,
    markets,
    onopenrow,
  }: {
    watchlist: string[];
    spotAssets: SpotAsset[];
    marketMids: Record<string, number>;
    markets: PhoenixMarketConfig[];
    onopenrow: (row: WatchRow) => void;
  } = $props();

  // Watchlist rows: price from spot, fall back to perp mid; basis when both.
  const watchRows = $derived(
    buildWatchRows(watchlist, spotAssets, marketMids, markets),
  );
</script>

<div class="watch-dock" aria-label="Watchlist">
  <div class="markets-list">
    {#each watchRows as row (row.sym)}
      <button type="button" onclick={() => onopenrow(row)}>
        <span>
          {row.sym}
          {#if row.basisBps !== null}
            <small
              class="basis-tag"
              class:positive={row.basisBps >= 0}
              class:negative={row.basisBps < 0}
            >{row.basisBps >= 0 ? "+" : ""}{formatNumber(row.basisBps, 0)}bp</small>
          {/if}
        </span>
        <b>{formatPrice(row.price)}</b>
        <em
          class:positive={(row.change ?? 0) >= 0}
          class:negative={(row.change ?? 0) < 0}
        >{row.change !== null ? formatPercent(row.change) : row.hasPerp ? "perp" : ""}</em>
      </button>
    {:else}
      <div class="empty">Star a market (☆ in the ticker) to track it here.</div>
    {/each}
  </div>
</div>

<style>
  .watch-dock {
    min-height: 0;
  }

  .basis-tag {
    font-size: 0.6rem;
    font-weight: 600;
    margin-left: 0.3rem;
    opacity: 0.9;
  }

  .empty {
    padding: 0.65rem 0.35rem;
    color: var(--muted);
    font-size: 0.78rem;
    line-height: 1.4;
  }
</style>
