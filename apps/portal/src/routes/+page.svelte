<script lang="ts">
  import { onMount } from "svelte";
  import BrandMark from "$lib/site/BrandMark.svelte";

  let { data } = $props();

  let tab = $state<"all" | "crypto" | "equities" | "pre-ipo">("all");
  let filter = $state("");
  let live = $state<Record<string, { price: number | null; change: number | null }>>({});

  const fmtPrice = (value: number | null) =>
    value === null
      ? "—"
      : value >= 1000
        ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
        : value >= 1
          ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : value.toLocaleString(undefined, { maximumFractionDigits: 5 });
  const fmtPct = (value: number | null) =>
    value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  const fmtCompact = (value: number | null) => {
    if (value === null) return "—";
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  const universe = $derived(
    data.universe.filter((asset) => {
      if (tab !== "all" && asset.hub !== tab) return false;
      if (!filter.trim()) return true;
      const q = filter.trim().toLowerCase();
      return (
        asset.symbol.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q)
      );
    }),
  );

  const priceOf = (asset: { symbol: string; price: number | null }) =>
    live[asset.symbol]?.price ?? asset.price;
  const changeOf = (asset: { symbol: string; change24hPct: number | null }) =>
    live[asset.symbol]?.change ?? asset.change24hPct;

  const regime = $derived(
    data.vix === null
      ? null
      : data.vix >= 25
        ? { label: `RISK-OFF · VIX ${data.vix.toFixed(1)}`, tone: "down" }
        : data.vix >= 20
          ? { label: `CAUTION · VIX ${data.vix.toFixed(1)}`, tone: "warn" }
          : data.vix >= 16
            ? { label: `NEUTRAL · VIX ${data.vix.toFixed(1)}`, tone: "flat" }
            : { label: `RISK-ON · VIX ${data.vix.toFixed(1)}`, tone: "up" },
  );

  const stampUtc = (ts: number) => new Date(ts).toUTCString().slice(17, 22);

  // Hydrate to live prices (same proxy path in dev and prod).
  onMount(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/tokensxyz/v1/assets/curated");
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { assets?: any[] };
        const next: typeof live = {};
        for (const item of payload.assets ?? []) {
          if (item?.symbol) {
            next[item.symbol] = {
              price: item?.stats?.price ?? null,
              change: item?.stats?.priceChange24hPercent ?? null,
            };
          }
        }
        if (!cancelled) live = next;
      } catch {
        // keep SSR snapshot
      }
    };
    void refresh();
    const timer = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  });
</script>

<svelte:head>
  <title>Trader Ralph — SOL to SPACEX. One account.</title>
  <meta
    name="description"
    content={`Spot and perps across ${data.marketCount} Solana markets: crypto, tokenized stocks, pre-IPO names. Settled in USDC. Email login, no seed phrase.`}
  />
  <link rel="canonical" href="https://traderralph.com/" />
  <meta property="og:title" content="Trader Ralph — SOL to SPACEX. One account." />
  <meta property="og:description" content={`Spot and perps across ${data.marketCount} Solana markets. Settled in USDC. Email login, no seed phrase.`} />
  <meta property="og:image" content="https://traderralph.com/og/home.png" />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="site">
  <!-- Tape -->
  <div class="tape" aria-label="Live market tape">
    <div class="tape-track">
      {#each [...data.tape, ...data.tape] as asset, index (index)}
        <a href={`/${asset.slug}`} class="tape-cell">
          <span class="sym">{asset.symbol}</span>
          <span class="px">{fmtPrice(priceOf(asset))}</span>
          <span class="chg" class:up={(changeOf(asset) ?? 0) >= 0} class:down={(changeOf(asset) ?? 0) < 0}>
            {fmtPct(changeOf(asset))}
          </span>
        </a>
      {/each}
    </div>
  </div>

  <!-- Nav -->
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
      <a class="cta" href="/terminal">Open terminal</a>
    </div>
  </header>

  <!-- Hero -->
  <section class="hero">
    <div class="hero-copy">
      <h1>SOL to SPACEX.<br />One account.</h1>
      <p>
        Spot and perps across {data.marketCount} Solana markets: crypto,
        tokenized stocks, pre-IPO names. Settled in USDC. Email login, no seed
        phrase.
      </p>
      <div class="hero-ctas">
        <a class="cta" href="/terminal">Open the terminal</a>
        <a class="ghost" href="#universe">Browse the markets</a>
      </div>
      <p class="hero-foot">Jupiter routes spot. Phoenix runs perps.</p>
    </div>
    <div class="hero-panel" aria-label="Live desk snapshot">
      <div class="panel-head">
        <span>THE DESK</span>
        {#if regime}<span class="chip {regime.tone}">{regime.label}</span>{/if}
      </div>
      {#each data.tape.slice(0, 7) as asset (asset.slug)}
        <a class="quote-row" href={`/${asset.slug}`}>
          <span class="sym">{asset.symbol}</span>
          <span class="name">{asset.name}</span>
          <span class="px">{fmtPrice(priceOf(asset))}</span>
          <span class="chg" class:up={(changeOf(asset) ?? 0) >= 0} class:down={(changeOf(asset) ?? 0) < 0}>
            {fmtPct(changeOf(asset))}
          </span>
        </a>
      {/each}
      <div class="panel-foot">live · {stampUtc(data.generatedAt)} UTC</div>
    </div>
  </section>

  <!-- Universe -->
  <section class="universe" id="universe">
    <div class="universe-head">
      <h2>The universe</h2>
      <span class="count">{data.marketCount} markets</span>
      <div class="tabs" role="tablist">
        {#each [["all", "All"], ["crypto", "Crypto"], ["equities", "Equities"], ["pre-ipo", "Pre-IPO"]] as [key, label] (key)}
          <button
            role="tab"
            aria-selected={tab === key}
            class:active={tab === key}
            onclick={() => (tab = key as typeof tab)}
          >
            {label}
          </button>
        {/each}
      </div>
      <input class="filter" placeholder="Filter…" bind:value={filter} aria-label="Filter assets" />
    </div>
    <div class="list">
      <div class="list-row list-header" aria-hidden="true">
        <span></span><span>Asset</span><span class="r">Price</span><span class="r">24h</span>
        <span class="r wide">Volume</span>
      </div>
      {#each universe.slice(0, 14) as asset (asset.slug)}
        <a class="list-row" href={`/${asset.slug}`}>
          <span class="logo">{#if asset.imageUrl}<img src={asset.imageUrl} alt="" loading="lazy" />{/if}</span>
          <span class="id"><b>{asset.symbol}</b><small>{asset.name}</small></span>
          <span class="r mono">{fmtPrice(priceOf(asset))}</span>
          <span class="r mono chg" class:up={(changeOf(asset) ?? 0) >= 0} class:down={(changeOf(asset) ?? 0) < 0}>
            {fmtPct(changeOf(asset))}
          </span>
          <span class="r mono wide">{fmtCompact(asset.volume24hUsd)}</span>
        </a>
      {/each}
    </div>
    <a class="more" href={tab === "all" ? "/equities" : `/${tab}`}>
      All {tab === "all" ? "markets" : tab === "pre-ipo" ? "pre-IPO names" : tab} →
    </a>
  </section>

  <!-- How it works: asymmetric editorial, no cards -->
  <section class="how">
    <div class="how-lead">
      <h2>One balance.<br />Every market.</h2>
    </div>
    <ol class="how-steps">
      <li>
        <span class="n">1</span>
        <div>
          <h3>Log in with email</h3>
          <p>A Solana wallet is created for you. Receive USDC, or convert SOL in one click.</p>
        </div>
      </li>
      <li>
        <span class="n">2</span>
        <div>
          <h3>Buy spot on anything</h3>
          <p>The full universe, routed for best execution by Jupiter.</p>
          <a href="/terminal?venue=spot&asset=nvidia">Trade NVDA spot →</a>
        </div>
      </li>
      <li>
        <span class="n">3</span>
        <div>
          <h3>Go long or short with perps</h3>
          <p>Leverage on Phoenix, with take-profit and stop-loss built into the ticket.</p>
          <a href="/terminal?venue=perp&asset=SOL&side=long">Long SOL →</a>
        </div>
      </li>
    </ol>
  </section>

  <!-- News strip -->
  {#if data.news.length}
    <section class="newsstrip">
      <h2>On the wire</h2>
      <div class="news-list">
        {#each data.news as item (item.url)}
          <a class="news-item" href={item.url} target="_blank" rel="noopener noreferrer">
            <span class="src">{item.source}</span>
            <span class="ttl">{item.title}</span>
          </a>
        {/each}
      </div>
      <a class="more" href="/news">All news →</a>
    </section>
  {/if}

  <!-- Footer directory -->
  <footer class="footer">
    {#each [["equities", "Equities"], ["pre-ipo", "Pre-IPO"], ["crypto", "Crypto"]] as [hub, label] (hub)}
      <div class="dir">
        <h4><a href={`/${hub}`}>{label}</a></h4>
        <div class="dir-links">
          {#each data.directory.filter((entry) => entry.hub === hub).slice(0, 30) as entry (entry.slug)}
            <a href={`/${entry.slug}`}>{entry.symbol}</a>
          {/each}
        </div>
      </div>
    {/each}
    <div class="legal">
      <p class="provenance">
        Data: tokens.xyz, Phoenix, Jupiter, Yahoo Finance. Prices as of
        {stampUtc(data.generatedAt)} UTC. Wallets by Privy, screened against OFAC.
      </p>
      Trading involves risk. Tokenized equities provide synthetic exposure and carry no
      shareholder rights. Desk commentary is informational, not financial advice.
      <a href="/llms.txt">llms.txt</a>
    </div>
  </footer>
</div>

<style>
  .site {
    min-height: 100vh;
    background: var(--paper);
    color: var(--ink);
  }

  a { text-decoration: none; }

  /* Tape */
  .tape {
    height: 2.5rem;
    overflow: hidden;
    border-bottom: 1px solid var(--line-soft);
    background: rgba(255, 255, 255, 0.015);
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 2rem, #000 calc(100% - 2rem), transparent);
    mask-image: linear-gradient(90deg, transparent, #000 2rem, #000 calc(100% - 2rem), transparent);
  }
  .tape-track {
    display: inline-flex;
    gap: 2rem;
    align-items: center;
    height: 100%;
    animation: tape-scroll 120s linear infinite;
    white-space: nowrap;
  }
  .tape:hover .tape-track { animation-play-state: paused; }
  @keyframes tape-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  @media (prefers-reduced-motion: reduce) { .tape-track { animation: none; } }
  .tape-cell {
    display: inline-flex;
    gap: 0.5rem;
    align-items: baseline;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.74rem;
  }
  .tape-cell .sym { color: var(--ink); font-weight: 700; }
  .tape-cell .px { color: var(--muted); }

  .chg.up, .up { color: var(--up); }
  .chg.down, .down { color: var(--down); }
  .chip.warn { color: var(--amber); }
  .chip.flat { color: var(--muted); }

  /* Nav — sticky after the tape scrolls away */
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
  }
  .brand span.brand-mark { display: flex; width: 1.15rem; height: 1.15rem; color: var(--ink); }
  .brand span { color: var(--accent); }
  .nav nav { display: flex; gap: 1.4rem; flex: 1; }
  .nav nav a { color: var(--muted); font-size: 0.86rem; }
  .nav nav a:hover { color: var(--ink); }
  .cta {
    background: var(--accent);
    color: #14060c;
    font-weight: 700;
    padding: 0.55rem 1.1rem;
    border-radius: var(--radius);
    font-size: 0.88rem;
  }
  .cta:hover { filter: brightness(1.08); }
  .ghost {
    border: 1px solid var(--line);
    color: var(--ink);
    padding: 0.55rem 1.1rem;
    border-radius: var(--radius);
    font-size: 0.88rem;
  }

  /* Hero — copy column sits higher than the panel on purpose */
  .hero {
    display: grid;
    grid-template-columns: 7fr 5fr;
    gap: 3rem;
    max-width: 72rem;
    margin: 0 auto;
    padding: 4.5rem 1.5rem 5.5rem;
    align-items: start;
  }
  .hero-copy h1 {
    margin: 0 0 1.2rem;
    font-size: clamp(2.4rem, 5.5vw, 4.2rem);
    line-height: 1.02;
    letter-spacing: -0.03em;
  }
  .hero-copy p { color: var(--muted); font-size: 1.05rem; line-height: 1.6; max-width: 32rem; }
  .hero-ctas { display: flex; gap: 0.8rem; margin: 1.8rem 0 1rem; }
  .hero-foot { font-size: 0.78rem !important; color: var(--faint) !important; }

  .hero-panel {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    overflow: hidden;
    margin-top: 2.5rem;
  }
  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
    font-size: 0.66rem;
    letter-spacing: 0.1em;
    color: var(--accent);
    font-weight: 800;
  }
  .chip { font-family: ui-monospace, monospace; font-size: 0.66rem; letter-spacing: 0.04em; }
  .quote-row {
    display: grid;
    grid-template-columns: 3.4rem minmax(0,1fr) auto 4.6rem;
    gap: 0.6rem;
    align-items: baseline;
    padding: 0.55rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .quote-row:hover { background: rgba(255,77,151,0.05); }
  .quote-row .sym { color: var(--ink); font-weight: 700; }
  .quote-row .name { color: var(--faint); font-family: Inter, sans-serif; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .quote-row .px { color: var(--ink); }
  .quote-row .chg { text-align: right; }
  .panel-foot { padding: 0.5rem 0.9rem; color: var(--faint); font-size: 0.66rem; font-family: ui-monospace, monospace; }

  /* Universe — dense list, information-first */
  .universe { max-width: 72rem; margin: 0 auto; padding: 0 1.5rem 5rem; }
  .universe-head { display: flex; align-items: baseline; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
  .universe-head h2 { margin: 0; font-size: 1.4rem; letter-spacing: -0.01em; }
  .count { color: var(--faint); font-size: 0.76rem; font-family: ui-monospace, monospace; }
  .tabs { display: flex; gap: 0.2rem; margin-left: 1rem; }
  .tabs button {
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted);
    padding: 0.35rem 0.7rem;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }
  .tabs button:hover { color: var(--ink); }
  .tabs button.active { color: var(--ink); border-bottom-color: var(--accent); }
  .filter {
    margin-left: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    padding: 0.4rem 0.7rem;
    font-size: 0.82rem;
    width: 11rem;
  }

  .list { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
  .list-row {
    display: grid;
    grid-template-columns: 2.4rem minmax(0, 1fr) 6.5rem 5rem 6rem;
    gap: 0.7rem;
    align-items: center;
    padding: 0.55rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
    color: var(--ink);
  }
  .list-row:last-child { border-bottom: 0; }
  a.list-row:hover { background: rgba(255, 77, 151, 0.04); }
  .list-header {
    color: var(--faint);
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-family: ui-monospace, monospace;
    background: rgba(255, 255, 255, 0.015);
  }
  .logo { width: 1.6rem; height: 1.6rem; }
  .logo img { width: 100%; height: 100%; border-radius: 50%; display: block; }
  .id { display: grid; line-height: 1.25; min-width: 0; }
  .id b { font-size: 0.9rem; }
  .id small { color: var(--faint); font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .r { text-align: right; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; font-size: 0.84rem; }
  .more { color: var(--accent); font-size: 0.86rem; font-weight: 600; display: inline-block; margin-top: 0.9rem; }

  /* How it works — asymmetric editorial */
  .how {
    display: grid;
    grid-template-columns: 5fr 7fr;
    gap: 3rem;
    max-width: 72rem;
    margin: 0 auto;
    padding: 0 1.5rem 5rem;
    align-items: start;
  }
  .how-lead h2 {
    margin: 0;
    font-size: clamp(1.8rem, 3.5vw, 2.6rem);
    line-height: 1.08;
    letter-spacing: -0.02em;
  }
  .how-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
  .how-steps li {
    display: grid;
    grid-template-columns: 2.6rem minmax(0, 1fr);
    gap: 1rem;
    padding: 1.3rem 0;
    border-bottom: 1px solid var(--line-soft);
  }
  .how-steps li:first-child { padding-top: 0.4rem; }
  .how-steps li:last-child { border-bottom: 0; }
  .how-steps .n {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    color: var(--accent);
    font-weight: 700;
    padding-top: 0.2rem;
  }
  .how-steps h3 { margin: 0 0 0.35rem; font-size: 1rem; }
  .how-steps p { margin: 0; color: var(--muted); font-size: 0.88rem; line-height: 1.55; }
  .how-steps a { color: var(--accent); font-weight: 600; font-size: 0.86rem; display: inline-block; margin-top: 0.45rem; }

  /* News strip */
  .newsstrip { max-width: 72rem; margin: 0 auto; padding: 0 1.5rem 4rem; }
  .newsstrip h2 { font-size: 1.4rem; margin: 0 0 1rem; }
  .news-list { display: grid; gap: 0.1rem; }
  .news-item {
    display: grid;
    grid-template-columns: 9rem minmax(0,1fr);
    gap: 1rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--line-soft);
  }
  .news-item .src { color: var(--accent); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .news-item .ttl { color: var(--ink); font-size: 0.92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .news-item:hover .ttl { color: var(--accent); }

  /* Footer */
  .footer {
    border-top: 1px solid var(--line-soft);
    max-width: 72rem;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 3rem;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2rem;
  }
  .dir h4 { margin: 0 0 0.7rem; font-size: 0.82rem; }
  .dir h4 a { color: var(--ink); }
  .dir-links { display: flex; flex-wrap: wrap; gap: 0.45rem 0.8rem; }
  .dir-links a { color: var(--faint); font-size: 0.74rem; font-family: ui-monospace, monospace; }
  .dir-links a:hover { color: var(--accent); }
  .legal { grid-column: 1 / -1; color: var(--faint); font-size: 0.74rem; line-height: 1.6; border-top: 1px solid var(--line-soft); padding-top: 1.2rem; }
  .legal a { color: var(--muted); }
  .provenance { margin: 0 0 0.5rem; color: var(--muted); }

  @media (max-width: 880px) {
    .hero { grid-template-columns: 1fr; padding-top: 2.5rem; }
    .hero-panel { margin-top: 0; }
    .how { grid-template-columns: 1fr; gap: 1.5rem; }
    .footer { grid-template-columns: 1fr; }
    .nav nav { display: none; }
    .list-row { grid-template-columns: 2.2rem minmax(0, 1fr) 5.6rem 4.4rem; }
    .wide { display: none; }
  }
</style>
