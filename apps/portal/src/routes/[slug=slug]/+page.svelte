<script lang="ts">
  import { NewsItem, SiteFooter, SiteNav, StatCard } from "@trader-ralph/ui";
  import { fmtPct, fmtUsd } from "@trader-ralph/ui/format";

  let { data } = $props();

  let deskRead = $state<string | null>(null);
  let deskState = $state<"loading" | "ready" | "absent">("loading");
  let livePrice = $state<number | null>(null);
  let liveChange = $state<number | null>(null);

  const asset = $derived(data.asset);
  const price = $derived(livePrice ?? asset.price);
  const change = $derived(liveChange ?? asset.change24hPct);

  // SSR sparkline path from 7d of closes.
  const sparkPath = $derived.by(() => {
    const points = data.spark;
    if (points.length < 2) return null;
    const closes = points.map((point) => point.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    const coords = points.map((point, index) => {
      const x = (index / (points.length - 1)) * 600;
      const y = 110 - ((point.close - min) / span) * 100;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return {
      line: `M${coords.join(" L")}`,
      fill: `M0,120 L${coords.join(" L")} L600,120 Z`,
      up: closes[closes.length - 1] >= closes[0],
    };
  });

  const sparkRange = $derived.by(() => {
    if (data.spark.length < 2) return null;
    const first = data.spark[0].close;
    const last = data.spark[data.spark.length - 1].close;
    return ((last - first) / first) * 100;
  });

  // Real dates beat "7 days" — e.g. "Jun 3 → Jun 10".
  const sparkSpan = $derived.by(() => {
    if (data.spark.length < 2) return null;
    const fmt = (ts: number) =>
      new Date(ts).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    return `${fmt(data.spark[0].ts)} → ${fmt(data.spark[data.spark.length - 1].ts)}`;
  });

  const faq = $derived([
    {
      q: `Can I really buy ${asset.symbol} on Solana?`,
      a: `Yes. ${asset.name} trades on Solana as a tokenized asset (${asset.symbol}). You get onchain price exposure settled in USDC, 24/7, without a brokerage account. Tokenized stocks track the underlying but carry no shareholder rights.`,
    },
    {
      q: `What do I need to start?`,
      a: `An email address. Logging into the terminal creates a Solana wallet for you. No seed phrase, no extension. Fund it with USDC, or convert SOL in one click, and you can trade.`,
    },
    {
      q: `What's the difference between spot and perps here?`,
      a: `Spot buys the tokenized asset itself via Jupiter routing. Perps (where listed) let you go long or short with leverage on Phoenix, with take-profit and stop-loss built into the ticket.`,
    },
  ]);

  // Keyed on the asset, not onMount: SvelteKit reuses this component when
  // navigating between spotlight pages (related rail, breadcrumbs), so all
  // per-asset client state must reset and re-fetch when `data` changes.
  $effect(() => {
    const currentId = asset.assetId;
    const currentSlug = asset.slug;
    deskRead = null;
    deskState = "loading";
    livePrice = null;
    liveChange = null;

    let cancelled = false;

    // Live price refresh (same proxy path in dev and prod).
    const refresh = async () => {
      try {
        const response = await fetch("/tokensxyz/v1/assets/curated");
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as { assets?: any[] };
        const match = (payload.assets ?? []).find(
          (item) => item?.assetId === currentId,
        );
        if (match && !cancelled) {
          livePrice = match?.stats?.price ?? null;
          liveChange = match?.stats?.priceChange24hPercent ?? null;
        }
      } catch {
        // keep SSR snapshot
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30_000);

    // Desk read — cached server-side for hours; absence is fine.
    fetch(`/api/desk/${currentSlug}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled) return;
        if (payload?.read) {
          deskRead = payload.read;
          deskState = "ready";
        } else {
          deskState = "absent";
        }
      })
      .catch(() => {
        if (!cancelled) deskState = "absent";
      });

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  });
</script>

<svelte:head>
  <title>{asset.symbol} — {asset.name} price, news & trading | Trader Ralph</title>
  <meta
    name="description"
    content={`Live ${asset.name} (${asset.symbol}) price, desk analysis and news. Trade ${asset.symbol} spot${data.hasPerp ? " or perps" : ""} on Solana with USDC — email login, no seed phrase.`}
  />
  <link rel="canonical" href={`https://traderralph.com/${asset.slug}`} />
  <meta property="og:title" content={`${asset.symbol} — ${asset.name} | Trader Ralph`} />
  <meta
    property="og:description"
    content={`Live ${asset.name} (${asset.symbol}) price, desk analysis and news. Trade ${asset.symbol} on Solana with USDC.`}
  />
  <meta property="og:image" content={`https://traderralph.com/og/${asset.slug}.png`} />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="site">
  <SiteNav cta={`Trade ${asset.symbol}`} ctaHref={`/terminal?asset=${asset.assetId}&venue=spot`} />

  <main class="page">
    <!-- Identity row -->
    <section class="identity">
      <div class="who">
        {#if asset.imageUrl}<img src={asset.imageUrl} alt="" />{/if}
        <div>
          <h1>{asset.name} <span class="sym">{asset.symbol}</span></h1>
          <p class="crumbs">
            <a href="/">Markets</a> / <a href={`/${asset.hub}`}>{asset.hub === "pre-ipo" ? "Pre-IPO" : asset.hub}</a>
          </p>
        </div>
      </div>
      <div class="px-block">
        <div class="px">{fmtUsd(price)}</div>
        <div class="chg" class:up={(change ?? 0) >= 0} class:down={(change ?? 0) < 0}>
          {fmtPct(change)} <span class="sub">24h</span>
        </div>
      </div>
    </section>

    <!-- Chart + CTA rail -->
    <section class="hero-grid">
      <div class="chart-card">
        {#if sparkPath}
          <svg viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="7 day price chart">
            <defs>
              <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color={sparkPath.up ? "var(--up)" : "var(--down)"} stop-opacity="0.18" />
                <stop offset="100%" stop-color={sparkPath.up ? "var(--up)" : "var(--down)"} stop-opacity="0" />
              </linearGradient>
            </defs>
            <path d={sparkPath.fill} fill="url(#spark-fill)" />
            <path d={sparkPath.line} fill="none" stroke={sparkPath.up ? "var(--up)" : "var(--down)"} stroke-width="1.6" />
          </svg>
          <div class="chart-foot">
            <span>{sparkSpan ?? "7 days"}</span>
            {#if sparkRange !== null}
              <span class:up={sparkRange >= 0} class:down={sparkRange < 0}>{fmtPct(sparkRange)}</span>
            {/if}
            <a href={`/terminal?asset=${asset.assetId}&venue=spot`}>Full chart in terminal →</a>
          </div>
        {:else}
          <div class="chart-empty">Chart warming up</div>
        {/if}
      </div>

      <aside class="cta-rail">
        <div class="rail-head">Trade {asset.symbol}</div>
        <a class="rail-btn spot" href={`/terminal?asset=${asset.assetId}&venue=spot&side=buy`}>
          Buy spot <small>USDC · routed by Jupiter</small>
        </a>
        {#if data.hasPerp}
          <a class="rail-btn long" href={`/terminal?asset=${asset.symbol}&venue=perp&side=long`}>
            Long perp <small>leverage on Phoenix</small>
          </a>
          <a class="rail-btn short" href={`/terminal?asset=${asset.symbol}&venue=perp&side=short`}>
            Short perp <small>leverage on Phoenix</small>
          </a>
        {/if}
      </aside>
    </section>

    <!-- Stats -->
    <section class="stats">
      <StatCard value={fmtUsd(asset.marketCap, true)} label="Market cap" hint="what the market says it's all worth" />
      <StatCard value={fmtUsd(asset.volume24hUsd, true)} label="24h volume" hint="how much changed hands today" />
      <StatCard value={fmtUsd(asset.liquidityUsd, true)} label="Liquidity" hint="how easily you can get in and out" />
      <StatCard value={fmtUsd(data.profile?.allTimeHigh ?? null)} label="All-time high" hint="the highest it has ever traded" />
    </section>

    <div class="columns">
      <div class="main-col">
        <!-- Desk read -->
        <section class="desk">
          <h2>From the desk</h2>
          {#if deskState === "loading"}
            <div class="desk-skeleton" aria-hidden="true">
              <span></span><span></span><span style="width: 62%"></span>
            </div>
          {:else if deskState === "ready" && deskRead}
            <p class="desk-read">{deskRead}</p>
          {:else if data.pulse.length}
            <ul class="pulse">
              {#each data.pulse as line (line)}<li>{line}</li>{/each}
            </ul>
          {/if}
        </section>

        <!-- Pulse -->
        {#if deskState === "ready" && data.pulse.length}
          <section class="pulse-card">
            <h2>Today's pulse</h2>
            <ul class="pulse">
              {#each data.pulse as line (line)}<li>{line}</li>{/each}
            </ul>
          </section>
        {/if}

        <!-- News -->
        {#if data.news.length}
          <section class="news">
            <h2>{data.newsIsAssetScoped ? `${asset.symbol} in the news` : "Market headlines"}</h2>
            <div class="news-list">
              {#each data.news as item (item.url)}
                <NewsItem source={item.source} title={item.title} href={item.url} />
              {/each}
            </div>
          </section>
        {/if}

        <!-- About -->
        {#if data.description}
          <section class="about">
            <h2>About {asset.name}</h2>
            <p>{data.description}</p>
          </section>
        {/if}

        <!-- FAQ -->
        {#if data.showFaq}
          <section class="faq">
            <h2>Common questions</h2>
            {#each faq as entry (entry.q)}
              <details>
                <summary>{entry.q}</summary>
                <p>{entry.a}</p>
              </details>
            {/each}
          </section>
        {/if}
      </div>

      <aside class="side-col">
        {#if data.related.length}
          <section class="related">
            <h3>More {asset.hub === "pre-ipo" ? "pre-IPO" : asset.hub}</h3>
            {#each data.related as entry (entry.slug)}
              <a class="rel-row" href={`/${entry.slug}`}>
                <!-- Cell always rendered so logo-less assets keep the grid aligned -->
                <span class="rel-logo">
                  {#if entry.imageUrl}<img src={entry.imageUrl} alt="" loading="lazy" />{/if}
                </span>
                <span class="rel-sym">{entry.symbol}</span>
                <span class="rel-px">{fmtUsd(entry.price)}</span>
                <span class="rel-chg" class:up={(entry.change24hPct ?? 0) >= 0} class:down={(entry.change24hPct ?? 0) < 0}>
                  {fmtPct(entry.change24hPct)}
                </span>
              </a>
            {/each}
          </section>
        {/if}
      </aside>
    </div>
  </main>

  <SiteFooter />
</div>

<style>
  .site { min-height: 100vh; background: var(--paper); color: var(--ink); }
  .page { max-width: 72rem; margin: 0 auto; padding: 0 1.5rem; }
  /* Section headers as small mono caps — labels, not titles. The numbers
     carry the hierarchy on this page. */
  h2,
  h3 {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
    margin: 0 0 0.9rem;
  }
  a { text-decoration: none; }
  .up { color: var(--up); }
  .down { color: var(--down); }

  /* Identity */
  .identity {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    padding: 1.6rem 0 1.2rem;
    flex-wrap: wrap;
  }
  .who { display: flex; gap: 0.9rem; align-items: center; }
  .who img { width: 2.6rem; height: 2.6rem; border-radius: 50%; }
  .who h1 { margin: 0; font-size: 1.6rem; letter-spacing: -0.02em; }
  .who .sym { color: var(--muted); font-family: ui-monospace, monospace; font-size: 1rem; font-weight: 600; }
  .crumbs { margin: 0.15rem 0 0; font-size: 0.74rem; color: var(--faint); }
  .crumbs a { color: var(--faint); text-transform: capitalize; }
  .crumbs a:hover { color: var(--accent); }
  .px-block { text-align: right; }
  /* Scoped under .px-block: bare .px/.chg selectors would also hit the
     related-rail spans and blow their font-size up. The price is the page's
     headline number — display scale, biggest thing on the page. */
  .px-block .px {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 3rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.05;
    letter-spacing: -0.02em;
  }
  .px-block .chg { font-family: ui-monospace, monospace; font-size: 0.92rem; font-variant-numeric: tabular-nums; }
  .px-block .chg .sub { color: var(--faint); font-size: 0.7rem; }

  /* Chart + rail */
  .hero-grid { display: grid; grid-template-columns: minmax(0, 1fr) 17rem; gap: 0.9rem; }
  .chart-card {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }
  .chart-card svg { display: block; width: 100%; height: 13rem; }
  .chart-foot {
    display: flex;
    gap: 1rem;
    padding: 0.6rem 0.9rem;
    border-top: 1px solid var(--line-soft);
    font-size: 0.74rem;
    color: var(--muted);
    font-family: ui-monospace, monospace;
  }
  .chart-foot a { margin-left: auto; color: var(--accent); }
  .chart-empty {
    height: 14rem;
    display: grid;
    place-items: center;
    color: var(--faint);
    font-size: 0.85rem;
  }

  .cta-rail {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    align-self: start;
    position: sticky;
    top: 4.6rem; /* clears the sticky nav */
  }
  .rail-head { font-size: 0.68rem; letter-spacing: 0.1em; color: var(--muted); font-weight: 800; text-transform: uppercase; }
  .rail-btn {
    display: grid;
    gap: 0.1rem;
    padding: 0.7rem 0.85rem;
    border-radius: var(--radius);
    font-weight: 700;
    font-size: 0.92rem;
    border: 1px solid var(--line);
    color: var(--ink);
    transition: border-color 140ms ease, background 140ms ease;
    box-shadow: var(--shadow-hard-sm);
  }
  .rail-btn:hover {
    transform: translate(-1px, -1px);
    box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.55);
  }
  .rail-btn:active {
    transform: translate(2px, 2px);
    box-shadow: none;
  }
  .rail-btn small { font-weight: 500; font-size: 0.68rem; color: var(--muted); }
  .rail-btn.spot { background: var(--accent); border-color: transparent; color: var(--accent-contrast); }
  .rail-btn.spot small { color: rgba(20, 6, 12, 0.65); }
  .rail-btn.spot:hover { filter: brightness(1.08); }
  .rail-btn.long:hover { border-color: var(--up); }
  .rail-btn.short:hover { border-color: var(--down); }
  @media (prefers-reduced-motion: reduce) {
    .rail-btn:hover,
    .rail-btn:active {
      transform: none;
    }
  }
  /* Stats */
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.7rem;
    margin: 0.9rem 0 2rem;
  }

  /* Columns */
  .columns { display: grid; grid-template-columns: minmax(0, 1fr) 17rem; gap: 2rem; }
  .main-col section { margin-bottom: 3.2rem; }

  .desk-read { color: var(--ink); font-size: 0.95rem; line-height: 1.65; margin: 0; }
  .desk-skeleton { display: grid; gap: 0.55rem; }
  .desk-skeleton span {
    height: 0.8rem;
    border-radius: var(--radius);
    background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.4s ease infinite;
  }
  @keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .desk-skeleton span { animation: none; } }

  .pulse { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.45rem; }
  .pulse li {
    color: var(--muted);
    font-size: 0.88rem;
    padding-left: 1rem;
    position: relative;
  }
  .pulse li::before { content: "·"; position: absolute; left: 0.2rem; color: var(--accent); font-weight: 800; }

  .news-list { display: grid; }

  .about p { color: var(--muted); font-size: 0.9rem; line-height: 1.65; }

  .faq details {
    border-bottom: 1px solid var(--line-soft);
    padding: 0.7rem 0;
  }
  .faq summary { cursor: pointer; font-size: 0.92rem; font-weight: 600; }
  .faq summary:hover { color: var(--accent); }
  .faq p { color: var(--muted); font-size: 0.86rem; line-height: 1.6; margin: 0.6rem 0 0; }

  /* Side column */
  .side-col { display: grid; gap: 1.2rem; align-content: start; }
  .related {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 1rem;
  }
  .rel-row {
    display: grid;
    grid-template-columns: 1.4rem 3.2rem minmax(0, 1fr) auto;
    gap: 0.55rem;
    align-items: center;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--line-soft);
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  .rel-row:last-child { border-bottom: 0; }
  .rel-logo { width: 1.4rem; height: 1.4rem; }
  .rel-logo img { width: 100%; height: 100%; border-radius: 50%; display: block; }
  .rel-sym { color: var(--ink); font-weight: 700; }
  .rel-px {
    color: var(--muted);
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rel-chg { text-align: right; }
  .rel-row:hover .rel-sym { color: var(--accent); }

  @media (max-width: 880px) {
    .hero-grid, .columns { grid-template-columns: 1fr; }
    .cta-rail { position: static; }
    .stats { grid-template-columns: repeat(2, 1fr); }
    .px-block .px { font-size: 1.6rem; }
  }
</style>
