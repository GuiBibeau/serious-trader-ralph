<script lang="ts">
  import type { TradeTick } from "$lib/phoenix-market-data";
  import { formatBookPrice } from "$lib/terminal/book";
  import {
    formatTimeHmsInZone,
    type DisplayTimezoneId,
  } from "$lib/terminal/display-timezone";
  import { formatNumber } from "$lib/utils";

  // Hot leaf: `trades` is a new array per stream flush — the page passes it
  // through untouched and Svelte scopes the per-print DOM updates here.
  let {
    trades,
    displayTimezone = "UTC",
  }: {
    trades: TradeTick[];
    displayTimezone?: DisplayTimezoneId;
  } = $props();
</script>

<!-- Time & sales: the prints are the heartbeat. -->
<div class="tape" aria-label="Time and sales">
  <div class="tape-header"><span>Time</span><span>Price</span><span>Size</span></div>
  {#each trades.slice(0, 18) as tick (tick.seq)}
    <div class="tape-row" class:bid={tick.side === "buy"} class:ask={tick.side === "sell"}>
      <span>{formatTimeHmsInZone(tick.ts, displayTimezone)}</span>
      <span>{formatBookPrice(tick.price)}</span>
      <span>{formatNumber(tick.size * tick.price, 0)}</span>
    </div>
  {:else}
    <div class="empty">No prints yet.</div>
  {/each}
</div>

<style>
  /* ── Time & sales ────────────────────────────────────────────────── */
  .tape {
    border-top: 1px solid var(--line-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.68rem;
    overflow-y: auto;
    max-height: 12rem;
  }

  .tape-header,
  .tape-row {
    display: grid;
    grid-template-columns: 4.6rem 1fr 4.5rem;
    gap: 0.6rem;
    padding: 0.12rem 0.9rem;
  }

  .tape-header {
    color: var(--faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.6rem;
    position: sticky;
    top: 0;
    background: var(--surface);
  }

  .tape-row span:first-child { color: var(--faint); }
  .tape-row.bid span:nth-child(2) { color: var(--up); }
  .tape-row.ask span:nth-child(2) { color: var(--down); }
  .tape-row span:last-child { text-align: right; color: var(--muted); }
</style>
