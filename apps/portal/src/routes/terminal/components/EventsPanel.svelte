<script lang="ts">
  import { onMount } from "svelte";
  import type { AiRead } from "$lib/ai";
  import type { NewsItem } from "$lib/intel";
  import { headlineMatches } from "$lib/terminal/alerts";
  import { panelStyle, usePanelLayout } from "$lib/terminal/layout";
  import { formatAge } from "$lib/utils";
  import AiReadLine from "./AiReadLine.svelte";
  import DragHead from "./DragHead.svelte";

  let {
    news,
    selectedSymbol,
    spotSymbol,
    tradeMode,
    eventRead,
  }: {
    news: NewsItem[];
    selectedSymbol: string;
    spotSymbol: string | null;
    tradeMode: "perps" | "spot";
    eventRead: AiRead;
  } = $props();

  // Headline velocity counts a 1-hour window — per-second recompute is
  // meaningless resolution, so the panel keeps its own coarse ~10 s clock
  // instead of the page's 1 s tick (plan 7.6, sanctioned cadence change).
  let velocityNowMs = $state(Date.now());
  onMount(() => {
    const timer = window.setInterval(() => {
      velocityNowMs = Date.now();
    }, 10_000);
    return () => window.clearInterval(timer);
  });

  const {
    panelOrder,
    draggedPanel,
    dragOverPanel,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  } = usePanelLayout();

  // News coded to the tape: filter the headline panel to the active
  // market (toggleable), and track last-hour headline velocity for it.
  let newsLinked = $state(true);
  const activeNewsSymbol = $derived(
    tradeMode === "spot" ? spotSymbol : selectedSymbol,
  );
  const linkedNews = $derived(
    newsLinked && activeNewsSymbol
      ? news.filter((item) => headlineMatches(item.title, activeNewsSymbol))
      : news,
  );
  const headlineVelocity = $derived(
    activeNewsSymbol
      ? news.filter(
          (item) =>
            headlineMatches(item.title, activeNewsSymbol) &&
            velocityNowMs - item.seenMs < 3_600_000,
        ).length
      : 0,
  );
</script>

<section
  class="panel macro-panel"
  role="group"
  data-panel="events"
  style={panelStyle("events", $panelOrder)}
  class:dragging={$draggedPanel === "events"}
  class:drag-over={$dragOverPanel === "events"}
  ondragover={(event) => onPanelDragOver(event, "events")}
  ondragleave={() => onPanelDragLeave("events")}
  ondrop={(event) => onPanelDrop(event, "events")}
>
  <div class="panel-head">
    <DragHead panelId="events" kicker="EVENT_RADAR" title="Live headlines" />
    <button
      class="link-chip"
      class:on={newsLinked}
      type="button"
      title="Filter headlines to the active market"
      onclick={() => (newsLinked = !newsLinked)}
    >{newsLinked && activeNewsSymbol ? activeNewsSymbol : "ALL"}</button>
    {#if newsLinked && headlineVelocity > 3}
      <span class="velocity-chip">{headlineVelocity}/h</span>
    {/if}
  </div>
  <AiReadLine read={eventRead} />
  <div class="news-list">
    {#each linkedNews.slice(0, 6) as item (item.url)}
      <a class="news-row" href={item.url} target="_blank" rel="noopener noreferrer">
        <span class="news-row-title">{item.title}</span>
        <em>{item.domain} · {formatAge(item.seenMs)}</em>
      </a>
    {:else}
      <div class="empty">
        {newsLinked && activeNewsSymbol
          ? `No ${activeNewsSymbol} headlines in feed.`
          : "No headlines loaded."}
      </div>
    {/each}
  </div>
</section>

<style>
  .macro-panel {
    grid-column: span 4;
  }

  /* ── News linking chips ──────────────────────────────────────────── */
  .link-chip {
    border: 1px solid var(--line);
    background: transparent;
    color: var(--faint);
    font-family: ui-monospace, monospace;
    font-size: 0.62rem;
    padding: 0.1rem 0.4rem;
    cursor: pointer;
  }

  .link-chip.on { color: var(--accent); border-color: rgba(255, 77, 151, 0.6); }

  .velocity-chip {
    font-family: ui-monospace, monospace;
    font-size: 0.62rem;
    color: var(--amber);
    border: 1px solid rgba(255, 180, 84, 0.5);
    padding: 0.1rem 0.35rem;
  }

  .news-list {
    display: grid;
    gap: 0.1rem;
    padding: 0.4rem 0.65rem 0.65rem;
  }

  .news-row {
    display: grid;
    gap: 0.1rem;
    padding: 0.38rem 0;
    border-bottom: 1px solid var(--line-soft);
    text-decoration: none;
    color: var(--ink);
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .news-row:hover .news-row-title {
    color: var(--accent);
  }

  .news-row em {
    color: var(--faint);
    font-size: 0.66rem;
  }

  @media (max-width: 1100px) {
    .macro-panel {
      grid-column: span 6;
    }
  }

  @media (max-width: 720px) {
    .macro-panel {
      grid-column: span 1;
    }
  }
</style>
