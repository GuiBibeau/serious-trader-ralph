<script lang="ts">
  import BrandMark from "./BrandMark.svelte";
</script>

<footer class="footer">
  <div class="links">
    <span class="footer-mark"><BrandMark /></span>
    <a href="/">Home</a>
    <a href="/news">News</a>
    <a href="/equities">Equities</a>
    <a href="/pre-ipo">Pre-IPO</a>
    <a href="/crypto">Crypto</a>
    <a href="/terminal">Terminal</a>
    <a href="/terms">Terms</a>
    <a href="/privacy">Privacy</a>
  </div>
  <p class="provenance">
    Data: tokens.xyz, Phoenix, Jupiter, Yahoo Finance. Wallets by Privy,
    screened against OFAC.
  </p>
  <p class="legal">
    Trading involves risk. Tokenized equities provide synthetic exposure and
    carry no shareholder rights. Desk commentary is informational, not
    financial advice.
  </p>
</footer>

<style>
  .footer {
    border-top: 1px solid var(--line-soft);
    max-width: 72rem;
    margin: 3rem auto 0;
    padding: 1.8rem 1.5rem 2.5rem;
  }
  .links { display: flex; gap: 1.4rem; flex-wrap: wrap; align-items: center; }
  .footer-mark { display: flex; width: 0.95rem; height: 0.95rem; color: var(--muted); }
  .links a { color: var(--muted); font-size: 0.8rem; text-decoration: none; }
  .links a:hover { color: var(--accent); }
  .provenance { color: var(--muted); font-size: 0.72rem; line-height: 1.6; margin: 1rem 0 0.3rem; }
  .legal { color: var(--faint); font-size: 0.72rem; line-height: 1.6; margin-top: 0; }
</style>
