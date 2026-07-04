<script lang="ts">
  import type { AiRead } from "$lib/ai";

  let { read }: { read: AiRead } = $props();
</script>

<!-- Always rendered: the slot is reserved so notes never shift layout. -->
<div class="desk-note">
  <span class="desk-kicker" class:desk-kicker-dim={read.phase === "idle" || (read.phase === "loading" && !read.text)}>Desk</span>
  {#if read.phase === "error"}
    <span class="desk-text desk-dim">{read.error}</span>
  {:else if read.phase === "ready" || read.text}
    <span class="desk-text" class:desk-soft-pulse={read.phase === "loading"}>{read.text}</span>
    {#if read.asOf}
      <em class="desk-asof">as of {new Date(read.asOf).toISOString().slice(11, 19)}Z</em>
    {/if}
  {:else}
    <span class="desk-skeleton" aria-hidden="true">
      <i></i>
      <i></i>
    </span>
  {/if}
</div>

<style>
  /* ── Desk note: market commentary, styled like a wire line ────────── */
  .desk-note {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    /* Reserved two-line footprint so loading → text never shifts layout. */
    min-height: 3.1rem;
    margin: 0 0.65rem 0.45rem;
    padding: 0.45rem 0.6rem;
    border-left: 2px solid rgba(255, 77, 151, 0.55);
    background: rgba(255, 255, 255, 0.015);
    border-radius: 0;
    font-size: 0.76rem;
    line-height: 1.45;
  }

  .desk-kicker {
    flex: 0 0 auto;
    color: var(--accent);
    font-size: 0.56rem;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    transform: translateY(0.05rem);
  }

  .desk-text {
    color: var(--ink);
  }

  .desk-dim {
    color: var(--muted);
  }

  .desk-kicker-dim {
    opacity: 0.45;
    transition: opacity 400ms ease;
  }

  /* Refreshing an existing read: barely-there breathing, no text swap. */
  .desk-soft-pulse {
    animation: desk-breathe 2.6s ease-in-out infinite;
  }

  @keyframes desk-breathe {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.72;
    }
  }

  /* Loading: two soft shimmer lines in place of text. */
  .desk-skeleton {
    flex: 1;
    display: grid;
    gap: 0.45rem;
    align-self: center;
  }

  .desk-skeleton i {
    display: block;
    height: 0.5rem;
    border-radius: 0;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.035) 25%,
      rgba(255, 77, 151, 0.07) 50%,
      rgba(255, 255, 255, 0.035) 75%
    );
    background-size: 280% 100%;
    animation: shimmer 2.2s ease-in-out infinite;
  }

  .desk-skeleton i:last-child {
    width: 62%;
    animation-delay: 180ms;
  }

  /* Desk note inside modals: stable footprint, text clamped to 3 lines. */
  :global(.modal) .desk-note {
    min-height: 3.1rem;
    max-height: 4.9rem;
    overflow: hidden;
  }

  :global(.modal) .desk-text {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── Desk read provenance ────────────────────────────────────────── */
  .desk-asof {
    display: block;
    font-style: normal;
    font-family: ui-monospace, monospace;
    font-size: 0.58rem;
    color: var(--faint);
    margin-top: 0.15rem;
  }
</style>
