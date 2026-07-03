<script lang="ts">
  let { source, title, href }: { source: string; title: string; href: string } = $props();
</script>

<a class="news-item" {href} target="_blank" rel="noopener noreferrer">
  <span class="src">{source}</span>
  <span class="ttl">{title}</span>
</a>

<style>
  .news-item {
    display: grid;
    grid-template-columns: 8.5rem minmax(0, 1fr);
    gap: 1rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--line-soft);
    text-decoration: none;
  }
  .news-item .src {
    color: var(--accent);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .news-item .ttl {
    color: var(--ink);
    font-size: 0.92rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .news-item:hover .ttl {
    color: var(--accent);
  }
</style>
