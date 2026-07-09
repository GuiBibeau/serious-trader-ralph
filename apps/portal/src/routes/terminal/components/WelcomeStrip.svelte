<script lang="ts">
  let {
    address,
    funded,
    traded,
    onopen,
    ondismiss,
  }: {
    /** shortened wallet address, e.g. "3Qw1…9xKe" */
    address: string;
    funded: boolean;
    traded: boolean;
    /** opens the funding wizard — the strip is the wizard's re-entry point. */
    onopen: () => void;
    ondismiss: () => void;
  } = $props();
</script>

<div class="welcome-strip" role="status">
  <button class="strip-open" type="button" aria-label="Open funding wizard" onclick={onopen}>
    <span class="step step-done">
      <span class="check">✓</span> Wallet ready
      <span class="mono">{address}</span>
      <span class="hint">self-custodial via Privy</span>
    </span>

    {#if funded}
      <span class="step step-done">
        <span class="check">✓</span> Funded
      </span>
    {:else}
      <span class="step">
        <span class="step-action">2. Fund it</span>
        <span class="hint">USDC to trade · keep ~0.04 SOL for rent + fees</span>
      </span>
    {/if}

    {#if traded}
      <span class="step step-done">
        <span class="check">✓</span> First trade placed
      </span>
    {:else}
      <span class="step">
        <span class="hint">3. Place your first trade — start small</span>
      </span>
    {/if}
  </button>

  <button class="strip-dismiss" aria-label="Dismiss welcome" onclick={ondismiss}
    >×</button
  >
</div>

<style>
  .welcome-strip {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.74rem;
  }
  .strip-open {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0;
    cursor: pointer;
  }
  .strip-open:hover {
    color: var(--ink);
  }
  .step {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .check {
    color: var(--up);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .hint {
    color: var(--muted);
  }
  .step-action {
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink);
    padding: 0.15rem 0.5rem;
    font: inherit;
    cursor: pointer;
  }
  .step-action:hover {
    border-color: var(--accent);
  }
  .strip-dismiss {
    margin-left: auto;
    border: none;
    background: transparent;
    color: var(--faint);
    font: inherit;
    cursor: pointer;
  }
  .strip-dismiss:hover {
    color: var(--ink);
  }
  @media (max-width: 720px) {
    .welcome-strip {
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .strip-open {
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  }
</style>
