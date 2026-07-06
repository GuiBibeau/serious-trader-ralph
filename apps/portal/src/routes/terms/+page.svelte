<script lang="ts">
  import { SiteFooter, SiteNav } from "@trader-ralph/ui";
</script>

<svelte:head>
  <title>Terms of Service — Trader Ralph</title>
  <meta
    name="description"
    content="The terms that govern your use of Trader Ralph, a self-custodial trading interface for spot and perpetual futures on Solana."
  />
</svelte:head>

<div class="site">
  <SiteNav />

  <main class="page">
    <h1>Terms of Service</h1>
    <p class="updated">Last updated: July 6, 2026</p>

    <section class="doc">
      <h2>1. What Trader Ralph is</h2>
      <p>
        Trader Ralph ("the Service") is a self-custodial trading interface. It
        displays market data and lets you construct transactions — spot swaps
        and perpetual futures orders — that you sign with your own wallet and
        that execute on public Solana protocols (Phoenix, Jupiter). We do not
        take custody of your funds, execute trades on your behalf, operate an
        exchange, or act as a broker, dealer, or investment adviser.
      </p>

      <h2>2. Your wallet, your keys</h2>
      <p>
        Signing in creates an embedded self-custodial wallet operated by Privy.
        You control it; we cannot move your funds, reverse your transactions, or
        recover assets sent to the wrong address. On-chain transactions are
        final.
      </p>

      <h2>3. Eligibility</h2>
      <p>
        You must be of legal age in your jurisdiction and permitted under the
        laws that apply to you to use self-custodial trading software. You are
        responsible for your own tax and legal obligations. Wallets are screened
        against the OFAC SDN list; access from sanctioned jurisdictions is
        prohibited. Availability of specific features may be restricted by
        region.
      </p>

      <h2>4. Risk disclosure</h2>
      <p>
        Trading digital assets involves substantial risk of loss. Leveraged
        perpetual futures can be liquidated: you can lose your entire margin,
        and markets can move faster than you can react. Tokenized equities
        provide synthetic price exposure only — they carry no shareholder
        rights, no dividends, and no claim on any issuer. Prices, market data,
        and desk commentary shown in the Service are informational, may be
        delayed or wrong, and are not financial advice. Trade only what you can
        afford to lose.
      </p>

      <h2>5. The protocols are not ours</h2>
      <p>
        Orders execute on third-party protocols and infrastructure (Solana,
        Phoenix, Jupiter, RPC providers). We do not control them and are not
        responsible for their availability, behavior, fees, or failures.
      </p>

      <h2>6. Acceptable use</h2>
      <p>
        Do not use the Service to break the law, evade sanctions, manipulate
        markets, or probe, disrupt, or reverse-engineer the Service or the
        protocols it connects to.
      </p>

      <h2>7. No warranties; limitation of liability</h2>
      <p>
        The Service is provided "as is", without warranties of any kind. To the
        maximum extent permitted by law, we are not liable for trading losses,
        lost profits, or any indirect, incidental, or consequential damages
        arising from your use of the Service — including losses caused by data
        errors, downtime, network failures, or protocol behavior.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update the Service and these terms. Continued use after an update
        constitutes acceptance. Material changes will be reflected in the "Last
        updated" date above.
      </p>

      <h2>9. Contact</h2>
      <p>Questions about these terms: gui.bibeau@solana.org.</p>
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
</style>
