<script lang="ts">
  let {
    tabs,
    active,
    onselect,
    compact = false,
  }: {
    tabs: { key: string; label: string }[];
    active: string;
    onselect: (key: string) => void;
    compact?: boolean;
  } = $props();
</script>

<div class="tabs" class:compact role="tablist">
  {#each tabs as { key, label } (key)}
    <button
      role="tab"
      aria-selected={active === key}
      class:active={active === key}
      onclick={() => onselect(key)}
    >
      {label}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: 0.2rem;
    margin-left: 1rem;
  }
  .tabs button {
    border: 0;
    border-bottom: 3px solid transparent;
    background: transparent;
    color: var(--muted);
    padding: 0.35rem 0.7rem;
    /* Self-contained: don't rely on the app's global button font reset. */
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }
  .tabs button:hover {
    color: var(--ink);
  }
  .tabs button.active {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .tabs.compact {
    gap: 0.3rem;
  }
  .compact button {
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem;
  }
</style>
