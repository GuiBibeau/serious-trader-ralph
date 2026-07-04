<script lang="ts">
  import { Button, SiteFooter, SiteNav } from "@trader-ralph/ui";
  import { fmtPct, fmtPrice } from "@trader-ralph/ui/format";

  let { data } = $props();

  const ago = (publishedAt: number | null, now: number) => {
    if (!publishedAt) return "";
    const ms = now - (publishedAt > 1e12 ? publishedAt : publishedAt * 1000);
    const minutes = Math.max(1, Math.floor(ms / 60_000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };
</script>

<svelte:head>
  <title>Market news — crypto & tokenized stocks | Trader Ralph</title>
  <meta
    name="description"
    content="The wire: live headlines across crypto, tokenized equities and pre-IPO names, tagged to tradable markets."
  />
  <link rel="canonical" href="https://traderralph.com/news" />
  <meta property="og:title" content="Market news — crypto & tokenized stocks | Trader Ralph" />
  <meta
    property="og:description"
    content="The wire: live headlines across crypto, tokenized equities and pre-IPO names, tagged to tradable markets."
  />
  <meta property="og:image" content="https://traderralph.com/og/news.png" />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="site">
  <SiteNav />

  <main class="page">
    <h1>On the wire</h1>
    <div class="layout">
      <div class="feed">
        {#each data.items as item (item.url)}
          <article class="item">
            <div class="meta">
              <span class="src">{item.source}</span>
              {#if item.publishedAt}<span class="time">{ago(item.publishedAt, data.generatedAt)}</span>{/if}
            </div>
            <a class="ttl" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
            {#if item.tags.length}
              <div class="tags">
                {#each item.tags as tag (tag.slug)}
                  <a class="tag" href={`/${tag.slug}`}>{tag.symbol}</a>
                {/each}
              </div>
            {/if}
          </article>
        {:else}
          <p class="wire-empty">The wire is quiet — check back shortly.</p>
        {/each}
      </div>

      <aside class="side">
        <h3>Top movers</h3>
        {#each data.movers as mover (mover.slug)}
          <a class="mover" href={`/${mover.slug}`}>
            <span class="sym">{mover.symbol}</span>
            <span class="px">{fmtPrice(mover.price)}</span>
            <span class="chg" class:up={(mover.change24hPct ?? 0) >= 0} class:down={(mover.change24hPct ?? 0) < 0}>
              {fmtPct(mover.change24hPct)}
            </span>
          </a>
        {/each}
        <div class="side-cta"><Button block href="/terminal">Open terminal</Button></div>
      </aside>
    </div>
  </main>

  <SiteFooter />
</div>

<style>
  .site { min-height: 100vh; background: var(--paper); color: var(--ink); }
  .page { max-width: 72rem; margin: 0 auto; padding: 0 1.5rem; }
  h1 { font-size: 1.7rem; letter-spacing: -0.02em; margin: 1.4rem 0 1.4rem; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 16rem; gap: 2.5rem; }

  .item { padding: 0.85rem 0; border-bottom: 1px solid var(--line-soft); }
  .meta { display: flex; gap: 0.8rem; font-family: ui-monospace, monospace; font-size: 0.66rem; margin-bottom: 0.25rem; }
  .src { color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; }
  .time { color: var(--faint); }
  .ttl { color: var(--ink); font-size: 0.98rem; line-height: 1.45; text-decoration: none; }
  .ttl:hover { color: var(--accent); }
  .tags { display: flex; gap: 0.4rem; margin-top: 0.45rem; }
  .tag {
    font-family: ui-monospace, monospace;
    font-size: 0.66rem;
    font-weight: 700;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: var(--radius);
    padding: 0.12rem 0.55rem;
    text-decoration: none;
  }
  .tag:hover {
    color: var(--ink);
  }
  /* Not ".empty": the terminal route's global stylesheet has an .empty rule
     (padding/font-size) that would leak here after any /terminal visit. */
  .wire-empty { color: var(--faint); }

  .side { align-self: start; position: sticky; top: 4.6rem; /* clears the sticky nav */ }
  .side h3 { font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 0.6rem; }
  .mover {
    display: grid;
    grid-template-columns: 3.6rem minmax(0, 1fr) auto;
    gap: 0.5rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--line-soft);
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    text-decoration: none;
  }
  .mover .sym { color: var(--ink); font-weight: 700; }
  .mover .px { color: var(--muted); text-align: right; }
  .mover:hover .sym { color: var(--accent); }
  .up { color: var(--up); }
  .down { color: var(--down); }
  .side-cta { margin-top: 1rem; }

  @media (max-width: 880px) {
    .layout { grid-template-columns: 1fr; }
    .side { position: static; }
  }
</style>
