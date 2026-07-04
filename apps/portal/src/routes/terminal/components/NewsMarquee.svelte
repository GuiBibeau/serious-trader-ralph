<script lang="ts">
  import type { NewsItem } from "$lib/intel";

  let { news }: { news: NewsItem[] } = $props();
</script>

<div class="news-ticker" aria-label="Market headlines">
  {#if news.length}
    <div class="news-track">
      {#each [...news.slice(0, 14), ...news.slice(0, 14)] as item}
        <a class="news-item" href={item.url} target="_blank" rel="noopener noreferrer">
          <span class="news-domain">{item.domain}</span>
          {item.title}
        </a>
      {/each}
    </div>
  {:else}
    <div class="news-placeholder" aria-hidden="true">
      <i></i><i></i><i></i><i></i>
    </div>
  {/if}
</div>

<style>
  .news-ticker {
    /* Fixed footprint: present from first paint, headlines fade in. */
    height: 2rem;
    overflow: hidden;
    border-top: 1px solid var(--line-soft);
    background: rgba(8, 10, 13, 0.6);
    white-space: nowrap;
    /* Soft fade at both edges so items don't hard-clip. */
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 3rem, #000 calc(100% - 3rem), transparent);
    mask-image: linear-gradient(90deg, transparent, #000 3rem, #000 calc(100% - 3rem), transparent);
  }

  .news-placeholder {
    display: flex;
    gap: 2.5rem;
    align-items: center;
    height: 100%;
    padding-left: 3.5rem;
  }

  .news-placeholder i {
    display: block;
    width: clamp(8rem, 18vw, 16rem);
    height: 0.45rem;
    border-radius: 0;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.03) 25%,
      rgba(255, 255, 255, 0.07) 50%,
      rgba(255, 255, 255, 0.03) 75%
    );
    background-size: 280% 100%;
    animation: shimmer 2.4s ease-in-out infinite;
  }

  .news-placeholder i:nth-child(2) { animation-delay: 150ms; }
  .news-placeholder i:nth-child(3) { animation-delay: 300ms; }
  .news-placeholder i:nth-child(4) { animation-delay: 450ms; }

  .news-track {
    display: inline-flex;
    align-items: center;
    gap: 2.5rem;
    height: 100%;
    animation: news-scroll 90s linear infinite, fade-in 600ms ease;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .news-ticker:hover .news-track {
    animation-play-state: paused;
  }

  @keyframes news-scroll {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-50%);
    }
  }

  .news-item {
    display: inline-flex;
    align-items: baseline;
    gap: 0.45rem;
    font-size: 0.74rem;
    color: var(--muted);
    text-decoration: none;
  }

  .news-item:hover {
    color: var(--ink);
  }
</style>
