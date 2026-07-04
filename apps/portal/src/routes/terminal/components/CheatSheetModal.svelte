<script lang="ts">
  let { onclose }: { onclose: () => void } = $props();

  // Modals may keep keys away from the global hotkeys, but never Escape —
  // the window handler owns close-on-Esc no matter where focus sits.
  function swallowKeysExceptEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape") event.stopPropagation();
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={() => onclose()}>
  <div
    class="modal cheat"
    role="dialog"
    aria-modal="true"
    aria-label="Keyboard shortcuts"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={swallowKeysExceptEscape}
  >
    <div class="panel-head">
      <div><p>KEYBOARD</p><h2>Shortcuts</h2></div>
      <button class="modal-close" type="button" aria-label="Close" onclick={() => onclose()}>×</button>
    </div>
    <div class="modal-body cheat-body">
      {#each [
        ["/", "Market palette"],
        ["B / S", "Long / Short — flips a live ticket in place"],
        ["M / L", "Ticket order type market / limit"],
        ["C C", "Market-close the selected position (press twice)"],
        ["X X", "Cancel the selected market's orders (press twice)"],
        ["[ ]", "Previous / next timeframe"],
        [", .", "Cycle watchlist"],
        ["F", "Fit chart + re-arm autoscale"],
        ["Alt+Click", "Set price alert at cursor"],
        ["Drag axis", "Scale price/time · double-click resets"],
        ["?", "This sheet"],
        ["Esc", "Close any overlay"],
      ] as [keys, what] (keys)}
        <div class="cheat-row"><kbd>{keys}</kbd><span>{what}</span></div>
      {/each}
    </div>
  </div>
</div>

<style>
  .cheat-body { display: grid; gap: 0.3rem; }

  .cheat-row {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.8rem;
    align-items: baseline;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .cheat-row kbd {
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    padding: 0.08rem 0.4rem;
    text-align: center;
  }
</style>
