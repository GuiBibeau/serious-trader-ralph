<script lang="ts">
  import { Button, SiteFooter, SiteNav } from "@harness-trade/ui";

  let { data } = $props();

  const share = $derived(data.share);
  const imageUrl = $derived(`https://harness.trade/og/position.png?${data.query}`);
  const up = $derived(share.pnl >= 0);
  const pnlText = $derived(
    `${up ? "+" : "-"}$${Math.abs(share.pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  );
</script>

<svelte:head>
  <title
    >{share.paper ? "PAPER " : ""}{share.side.toUpperCase()} {share.symbol}
    {pnlText} | Harness</title
  >
  <meta name="robots" content="noindex" />
  <meta
    property="og:title"
    content={`${share.paper ? "Paper trade: " : ""}${share.side.toUpperCase()} ${share.symbol} ${pnlText} on Harness`}
  />
  <meta
    property="og:description"
    content={share.paper
      ? "Simulated paper trade on live prices — not real funds."
      : "Perps on Phoenix, spot by Jupiter — one USDC account on Solana."}
  />
  <meta property="og:image" content={imageUrl} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content={imageUrl} />
</svelte:head>

<div class="site">
  <SiteNav />
  <main class="page">
    <img class="card" src={`/og/position.png?${data.query}`} alt={`${share.side} ${share.symbol} ${pnlText}`} />
    <div class="actions">
      <Button href={`/terminal?asset=${share.symbol}&venue=perp&side=${share.side}`}>
        Trade {share.symbol} yourself
      </Button>
      <p>Email login · wallet created for you · no seed phrase</p>
    </div>
  </main>
  <SiteFooter />
</div>

<style>
  .site { min-height: 100vh; background: var(--paper); color: var(--ink); }
  .page { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.5rem 0; text-align: center; }
  .card {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.4);
  }
  .actions { margin-top: 1.6rem; }
  .actions p { color: var(--faint); font-size: 0.76rem; margin-top: 0.7rem; }
</style>
