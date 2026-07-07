<script lang="ts">
  const DISMISS_KEY = "trader-ralph-terminal/policy-dismiss/v1";

  let { gateKey, message }: { gateKey: string; message: string } = $props();

  function readDismissed(): string[] {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
    } catch {
      return [];
    }
  }

  let dismissed = $state(false);
  $effect(() => {
    dismissed = readDismissed().includes(gateKey);
  });

  function dismiss(): void {
    dismissed = true;
    try {
      const keys = new Set(readDismissed());
      keys.add(gateKey);
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...keys]));
    } catch {
      /* storage unavailable: session-only dismiss */
    }
  }
</script>

{#if !dismissed}
  <div class="policy-banner" role="status">
    <span class="policy-msg">{message}</span>
    <button type="button" class="policy-dismiss" aria-label="Dismiss notice" onclick={dismiss}>×</button>
  </div>
{/if}

<style>
  .policy-banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--line);
    border-left: 2px solid var(--amber);
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.72rem;
    line-height: 1.4;
  }
  .policy-msg { flex: 1; min-width: 0; }
  .policy-dismiss {
    border: 0;
    background: transparent;
    color: var(--faint);
    font-size: 0.9rem;
    line-height: 1;
    cursor: pointer;
    padding: 0.1rem 0.25rem;
  }
  .policy-dismiss:hover { color: var(--ink); }
</style>
