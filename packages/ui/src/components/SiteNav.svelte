<script lang="ts">
  import BrandMark from "./BrandMark.svelte";
  import Button from "./Button.svelte";

  let { cta = "Open terminal", ctaHref = "/terminal" } = $props();
</script>

<header class="navbar">
  <div class="nav">
    <a class="brand" href="/">
      <span class="brand-mark"><BrandMark /></span>
      RALPH<span>·TERMINAL</span>
    </a>
    <nav>
      <a href="/news">News</a>
      <a href="/equities">Equities</a>
      <a href="/pre-ipo">Pre-IPO</a>
      <a href="/crypto">Crypto</a>
    </nav>
    <Button href={ctaHref}>{cta}</Button>
  </div>
</header>

<style>
  .navbar {
    position: sticky;
    top: 0;
    z-index: 50;
    background: rgba(10, 11, 14, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line-soft);
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 2rem;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.1rem 1.5rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-weight: 800;
    letter-spacing: 0.12em;
    font-size: 0.95rem;
    color: var(--ink);
    text-decoration: none;
  }
  .brand span.brand-mark { display: flex; width: 1.15rem; height: 1.15rem; color: var(--ink); }
  .brand span { color: var(--accent); }
  nav { display: flex; gap: 1.4rem; flex: 1; }
  nav a { color: var(--muted); font-size: 0.86rem; text-decoration: none; }
  nav a:hover { color: var(--ink); }
  @media (max-width: 880px) {
    nav { display: none; }
  }
</style>
