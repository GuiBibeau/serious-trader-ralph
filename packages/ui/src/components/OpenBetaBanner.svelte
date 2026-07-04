<script lang="ts">
  let {
    title = "Trader Ralph Terminal is in open beta",
    body = "Market data, account access, and trading tools may change while we harden the experience.",
    dismissLabel = "Dismiss open beta banner",
    ondismiss,
  }: {
    title?: string;
    body?: string;
    dismissLabel?: string;
    ondismiss?: () => void;
  } = $props();
</script>

<section class="open-beta-banner" aria-label="Open beta notice">
  <div class="copy">
    <span>Open beta</span>
    <div>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  </div>

  {#if ondismiss}
    <button class="dismiss" type="button" aria-label={dismissLabel} onclick={ondismiss}>
      <span aria-hidden="true">x</span>
    </button>
  {/if}
</section>

<style>
  .open-beta-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent),
      var(--surface);
    color: var(--ink);
    padding: 0.65rem 0.75rem;
  }

  .copy {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .copy span {
    flex: 0 0 auto;
    color: var(--accent);
    font-size: 0.66rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .copy div {
    display: grid;
    gap: 0.12rem;
    min-width: 0;
  }

  .copy strong {
    font-size: 0.84rem;
  }

  .copy p {
    margin: 0;
    color: var(--muted);
    font-size: 0.74rem;
    line-height: 1.35;
  }

  .dismiss {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-weight: 800;
    cursor: pointer;
  }

  .dismiss:hover {
    border-color: var(--accent);
    color: var(--ink);
  }

  @media (max-width: 720px) {
    .open-beta-banner,
    .copy {
      align-items: flex-start;
    }

    .copy {
      flex-direction: column;
      gap: 0.35rem;
    }
  }
</style>
