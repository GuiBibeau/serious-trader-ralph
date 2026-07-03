<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    variant = "cta",
    href,
    block = false,
    children,
    ...rest
  }: {
    variant?: "cta" | "ghost";
    href?: string;
    block?: boolean;
    children: Snippet;
    [key: string]: unknown;
  } = $props();
</script>

{#if href}
  <a {href} class="btn {variant}" class:block {...rest}>{@render children()}</a>
{:else}
  <button class="btn {variant}" class:block {...rest}>{@render children()}</button>
{/if}

<style>
  .btn {
    padding: 0.55rem 1.1rem;
    border-radius: var(--radius);
    /* Self-contained: <button> UA font must not diverge from the <a> path. */
    font: inherit;
    font-size: 0.88rem;
    text-decoration: none;
    white-space: nowrap;
    display: inline-block;
    cursor: pointer;
    box-shadow: var(--shadow-hard-sm);
  }
  .btn:not(:disabled):hover {
    transform: translate(-1px, -1px);
    box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.55);
  }
  .btn:not(:disabled):active {
    transform: translate(2px, 2px);
    box-shadow: none;
  }
  .cta {
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 700;
    border: 0;
  }
  .cta:hover {
    filter: brightness(1.08);
  }
  .block {
    display: block;
    text-align: center;
  }
  .ghost {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--ink);
  }
  .ghost:hover {
    border-color: var(--ink);
  }
  @media (prefers-reduced-motion: reduce) {
    .btn:not(:disabled):hover,
    .btn:not(:disabled):active {
      transform: none;
    }
  }
</style>
