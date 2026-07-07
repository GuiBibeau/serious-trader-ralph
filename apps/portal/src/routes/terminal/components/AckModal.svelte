<script lang="ts">
  import { onMount } from "svelte";

  let {
    onagree,
    onclose,
  }: { onagree: () => void; onclose: () => void } = $props();

  let panel: HTMLElement | undefined;

  // Focus the dialog on open so keys originate here: terminal hotkeys are
  // swallowed below instead of flipping the ticket behind the overlay. The
  // page's global keydown handler closes other modals on Escape but doesn't
  // know about this one, so Escape is handled here and at the window.
  onMount(() => {
    panel?.focus();
  });

  // Real focus trap: Tab cycles within the dialog's controls, and if focus
  // ever ends up outside the panel it is pulled back — the ack must own the
  // whole interaction while open (review: keyboard users could Tab to the
  // ticket behind the overlay).
  function trapTab(event: KeyboardEvent): void {
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!panel.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onWinKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      onclose();
      return;
    }
    if (event.key === "Tab") trapTab(event);
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      onclose();
      return;
    }
    if (event.key === "Tab") {
      trapTab(event);
      return;
    }
    event.stopPropagation();
  }
</script>

<svelte:window onkeydown={onWinKeydown} />

<div class="modal-backdrop" role="presentation" onclick={() => onclose()}>
  <div
    bind:this={panel}
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label="Trade risk acknowledgment"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={onPanelKeydown}
  >
    <div class="panel-head">
      <div>
        <p>RISK_ACK</p>
        <h2>Before your first trade</h2>
      </div>
      <button class="modal-close" type="button" aria-label="Close" onclick={() => onclose()}>×</button>
    </div>

    <div class="modal-body">
      <ul class="ack-list">
        <li>Trading digital assets involves substantial risk of loss. Leveraged positions can be liquidated — you can lose your entire margin.</li>
        <li>Tokenized equities are synthetic price exposure only: no shareholder rights, no dividends.</li>
        <li>Your wallet is self-custodial. Transactions are final; nobody can reverse them or recover misdirected funds.</li>
        <li>Prices and desk commentary are informational, not financial advice.</li>
      </ul>

      <a class="ack-terms" href="/terms" target="_blank" rel="noreferrer">Read the full Terms of Service</a>

      <div class="ack-actions">
        <button class="secondary" type="button" onclick={() => onclose()}>Not now</button>
        <button class="primary" type="button" onclick={() => onagree()}>I agree to the Terms</button>
      </div>
    </div>
  </div>
</div>

<style>
  .ack-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.55rem;
  }

  .ack-list li {
    position: relative;
    padding-left: 0.9rem;
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.45;
  }

  .ack-list li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.5rem;
    width: 0.32rem;
    height: 0.32rem;
    background: var(--accent);
  }

  .ack-terms {
    font-size: 0.78rem;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .ack-terms:hover {
    color: var(--ink);
  }

  .ack-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .ack-actions button {
    flex: 1;
  }
</style>
