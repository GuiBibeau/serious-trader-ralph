<script lang="ts">
  import { AssetTable, SiteFooter, SiteNav, TabNav } from "@trader-ralph/ui";

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
        <TabNav
          compact
          tabs={[
            { key: "volume", label: "Volume" },
            { key: "change", label: "Movers" },
            { key: "cap", label: "Market cap" },
          ]}
          active={sortKey}
          onselect={(key) => (sortKey = key as typeof sortKey)}
        />
      </div>
    </div>

    <AssetTable assets={sorted} showMarketCap />
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
  .sorts { margin-left: auto; }
</style>
