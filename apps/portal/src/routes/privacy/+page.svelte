<script lang="ts">
  import { SiteFooter, SiteNav } from "@trader-ralph/ui";
</script>

<svelte:head>
  <title>Privacy Policy — Trader Ralph</title>
  <meta
    name="description"
    content="What Trader Ralph collects — email, wallet address, usage telemetry, approximate region — and the third parties it relies on."
  />
</svelte:head>

<div class="site">
  <SiteNav />

  <main class="page">
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: July 6, 2026</p>

    <section class="doc">
      <h2>What we collect</h2>
      <ul class="list">
        <li>
          <strong>Email address</strong> — used by Privy to authenticate you and
          create your embedded wallet. We see the email you sign in with.
        </li>
        <li>
          <strong>Wallet address</strong> — public by nature; used to display
          your balances and positions and to build your transactions.
        </li>
        <li>
          <strong>Usage telemetry</strong> — anonymous product events (orders
          submitted, markets viewed, errors) tied to session identifiers, stored
          in aggregate logs to improve the product.
        </li>
        <li>
          <strong>Approximate location</strong> — country/region inferred from
          your IP by our hosting provider at request time, recorded in
          telemetry. We do not store your IP address in our logs.
        </li>
      </ul>

      <h2>What we do NOT collect</h2>
      <p>
        Private keys (they live in Privy's isolated infrastructure — we never
        see them), government ID, payment cards, or bank details. We do not sell
        or rent any of your data, and we do not use advertising trackers.
      </p>

      <h2>Third parties we rely on</h2>
      <ul class="list">
        <li>
          <strong>Privy</strong> — authentication and embedded wallets (email,
          wallet keys).
        </li>
        <li><strong>Vercel</strong> — hosting and request-time geolocation.</li>
        <li>
          <strong>Solana RPC, Phoenix, Jupiter, market-data providers</strong>
          — receive the public wallet addresses and transactions inherent to
          using them.
        </li>
      </ul>
      <p>Each processes data under its own privacy policy.</p>

      <h2>Retention and your choices</h2>
      <p>
        Telemetry is retained in rolling aggregate logs. You can stop using the
        Service at any time; your wallet remains yours through Privy
        independently of us. For data questions or deletion requests:
        <a href="mailto:gui.bibeau@solana.org">gui.bibeau@solana.org</a>.
      </p>

      <h2>Changes</h2>
      <p>
        Material changes will be reflected in the "Last updated" date above.
      </p>
    </section>
  </main>

  <SiteFooter />
</div>

<style>
  .site { min-height: 100vh; background: var(--paper); color: var(--ink); }
  .page { max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem 5rem; }
  h1 { font-size: clamp(2rem, 4.5vw, 2.8rem); letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 0.5rem; }
  .updated {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.74rem;
    color: var(--faint);
    margin: 0 0 2.5rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .doc h2 { font-size: 1.15rem; letter-spacing: -0.01em; margin: 2.4rem 0 0.7rem; }
  .doc p { color: var(--muted); font-size: 0.95rem; line-height: 1.7; margin: 0; }
  .list { list-style: none; margin: 0; padding: 0; }
  .list li {
    color: var(--muted);
    font-size: 0.95rem;
    line-height: 1.65;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--line-soft);
  }
  .list strong { color: var(--ink); font-weight: 600; }
</style>
