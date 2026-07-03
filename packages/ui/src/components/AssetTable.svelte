<script lang="ts">
  import { fmtCompact, fmtPrice } from "../format";
  import UpDown from "./UpDown.svelte";

  type AssetRow = {
    slug: string;
    symbol: string;
    name: string;
    imageUrl: string | null;
    price: number | null;
    change24hPct: number | null;
    volume24hUsd: number | null;
    marketCap?: number | null;
  };

  let { assets, showMarketCap = false }: { assets: AssetRow[]; showMarketCap?: boolean } = $props();
</script>

<div class="list" class:cap={showMarketCap}>
  <div class="list-row list-header" aria-hidden="true">
    <span></span><span>Asset</span><span class="r">Price</span><span class="r">24h</span>
    <span class="r wide">Volume</span>
    {#if showMarketCap}<span class="r wide">Mkt cap</span>{/if}
  </div>
  {#each assets as asset (asset.slug)}
    <a class="list-row" href={`/${asset.slug}`}>
      <span class="logo">{#if asset.imageUrl}<img src={asset.imageUrl} alt="" loading="lazy" />{/if}</span>
      <span class="id"><b>{asset.symbol}</b><small>{asset.name}</small></span>
      <span class="r mono">{fmtPrice(asset.price)}</span>
      <span class="r mono"><UpDown value={asset.change24hPct} /></span>
      <span class="r mono wide">{fmtCompact(asset.volume24hUsd)}</span>
      {#if showMarketCap}<span class="r mono wide">{fmtCompact(asset.marketCap ?? null)}</span>{/if}
    </a>
  {/each}
</div>

<style>
  .list {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
    box-shadow: var(--shadow-hard);
  }
  .list-row {
    display: grid;
    grid-template-columns: 2.4rem minmax(0, 1fr) 6.5rem 5rem 6rem;
    gap: 0.7rem;
    align-items: center;
    padding: 0.55rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
    text-decoration: none;
    color: var(--ink);
  }
  .list-row:last-child {
    border-bottom: 0;
  }
  a.list-row:hover {
    background: rgba(255, 77, 151, 0.04);
  }
  .list-header {
    color: var(--faint);
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-family: ui-monospace, monospace;
    background: rgba(255, 255, 255, 0.015);
  }
  .logo {
    width: 1.6rem;
    height: 1.6rem;
  }
  .logo img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    display: block;
  }
  .id {
    display: grid;
    line-height: 1.25;
    min-width: 0;
  }
  .id b {
    font-size: 0.9rem;
  }
  .id small {
    color: var(--faint);
    font-size: 0.7rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .r {
    text-align: right;
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.84rem;
  }

  .list.cap .list-row {
    grid-template-columns: 2.4rem minmax(0, 1fr) 6rem 5rem 6rem 6rem;
  }

  @media (max-width: 720px) {
    .list-row {
      grid-template-columns: 2.2rem minmax(0, 1fr) 5.6rem 4.4rem;
    }
    .list.cap .list-row {
      grid-template-columns: 2.2rem minmax(0, 1fr) 5.4rem 4.4rem;
    }
    .wide {
      display: none;
    }
  }
</style>
