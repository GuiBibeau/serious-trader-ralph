<script lang="ts">
  import { SiteFooter, SiteNav } from "@trader-ralph/ui";
  import { fmtCompact, fmtPct, fmtPrice } from "@trader-ralph/ui/format";

  let { data } = $props();

  let sortKey = $state<"volume" | "change" | "cap">("volume");

  const sorted = $derived(
    [...data.assets].sort((a, b) => {
      if (sortKey === "change")
        return Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0);
      if (sortKey === "cap") return (b.marketCap ?? 0) - (a.marketCap ?? 0);
      return (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0);
    }),
  );
</script>

<svelte:head>
  <title>{data.title} — trade on Solana | Trader Ralph</title>
  <meta name="description" content={data.blurb} />
  <link rel="canonical" href={`https://traderralph.com/${data.hub}`} />
  <meta property="og:title" content={`${data.title} — trade on Solana | Trader Ralph`} />
  <meta property="og:description" content={data.blurb} />
  <meta property="og:image" content={`https://traderralph.com/og/${data.hub}.png`} />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="site">
  <SiteNav />

  <main class="page">
    <header class="head">
      <h1>{data.title}</h1>
      <p>{data.blurb}</p>
    </header>

    <div class="controls">
      <span class="count">{data.assets.length} markets</span>
      <div class="sorts">
        {#each [["volume", "Volume"], ["change", "Movers"], ["cap", "Market cap"]] as [key, label] (key)}
          <button class:active={sortKey === key} onclick={() => (sortKey = key as typeof sortKey)}>
            {label}
          </button>
        {/each}
      </div>
    </div>

    <div class="table">
      <div class="row header" aria-hidden="true">
        <span></span><span>Asset</span><span class="r">Price</span><span class="r">24h</span>
        <span class="r wide">Volume</span><span class="r wide">Mkt cap</span>
      </div>
      {#each sorted as asset (asset.slug)}
        <a class="row" href={`/${asset.slug}`}>
          <span class="logo">{#if asset.imageUrl}<img src={asset.imageUrl} alt="" loading="lazy" />{/if}</span>
          <span class="id"><b>{asset.symbol}</b><small>{asset.name}</small></span>
          <span class="r mono">{fmtPrice(asset.price)}</span>
          <span class="r mono" class:up={(asset.change24hPct ?? 0) >= 0} class:down={(asset.change24hPct ?? 0) < 0}>
            {fmtPct(asset.change24hPct)}
          </span>
          <span class="r mono wide">{fmtCompact(asset.volume24hUsd)}</span>
          <span class="r mono wide">{fmtCompact(asset.marketCap)}</span>
        </a>
      {/each}
    </div>
  </main>

  <SiteFooter />
</div>

<style>
  .site { min-height: 100vh; background: var(--paper); color: var(--ink); }
  .page { max-width: 72rem; margin: 0 auto; padding: 0 1.5rem; }
  .head { padding: 1.6rem 0 0.4rem; max-width: 38rem; }
  .head h1 { font-size: 1.7rem; letter-spacing: -0.02em; margin: 0 0 0.5rem; }
  .head p { color: var(--muted); font-size: 0.95rem; line-height: 1.6; }

  .controls { display: flex; align-items: center; gap: 1rem; margin: 1.2rem 0 0.6rem; }
  .count { color: var(--faint); font-size: 0.78rem; font-family: ui-monospace, monospace; }
  .sorts { display: flex; gap: 0.3rem; margin-left: auto; }
  .sorts button {
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted);
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }
  .sorts button:hover { color: var(--ink); }
  .sorts button.active { color: var(--ink); border-bottom-color: var(--accent); }

  .table { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
  .row {
    display: grid;
    grid-template-columns: 2.4rem minmax(0, 1fr) 6rem 5rem 6rem 6rem;
    gap: 0.7rem;
    align-items: center;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
    text-decoration: none;
    color: var(--ink);
  }
  .row:last-child { border-bottom: 0; }
  a.row:hover { background: rgba(255, 77, 151, 0.04); }
  .row.header {
    color: var(--faint);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-family: ui-monospace, monospace;
    background: rgba(255, 255, 255, 0.015);
  }
  .logo img { width: 1.6rem; height: 1.6rem; border-radius: 50%; display: block; }
  .id { display: grid; line-height: 1.25; min-width: 0; }
  .id b { font-size: 0.9rem; }
  .id small { color: var(--faint); font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .r { text-align: right; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; font-size: 0.84rem; }
  .up { color: var(--up); }
  .down { color: var(--down); }

  @media (max-width: 720px) {
    .row { grid-template-columns: 2.2rem minmax(0, 1fr) 5.4rem 4.4rem; }
    .wide { display: none; }
  }
</style>
