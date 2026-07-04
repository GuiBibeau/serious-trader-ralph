<script lang="ts">
  import { alertsStore } from "$lib/terminal/alerts";

  const { toasts } = alertsStore;
</script>

{#if $toasts.length > 0}
  <div class="toast-stack" role="status" aria-live="polite">
    {#each $toasts as toast (toast.toastId)}
      <div class="toast">
        <b>{toast.title}</b>
        <span>{toast.body}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-stack {
    position: fixed;
    top: 4rem;
    right: 1rem;
    z-index: 90;
    display: grid;
    gap: 0.4rem;
  }

  .toast {
    display: grid;
    gap: 0.1rem;
    min-width: 16rem;
    max-width: 22rem;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--accent);
    background: var(--surface);
    font-size: 0.74rem;
  }

  .toast b { color: var(--accent); font-size: 0.68rem; letter-spacing: 0.04em; }
</style>
