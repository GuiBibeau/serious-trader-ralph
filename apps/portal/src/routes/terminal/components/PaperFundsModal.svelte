<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { formatNumber } from "$lib/utils";

  let {
    open,
    freeUsd,
    equityUsd,
    marginUsd,
    openPositions,
    onclose,
    ontopup,
    onreset,
  }: {
    open: boolean;
    freeUsd: number;
    equityUsd: number;
    marginUsd: number;
    openPositions: number;
    onclose: () => void;
    ontopup: (amount: number) => void;
    onreset: () => void;
  } = $props();

  let panel = $state<HTMLDivElement>();
  let previousFocus: HTMLElement | null = null;
  let wasOpen = false;

  const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");

  function focusableControls(): HTMLElement[] {
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
  }

  function restorePreviousFocus(): void {
    const target = previousFocus;
    previousFocus = null;
    if (target?.isConnected) target.focus();
  }

  $effect(() => {
    if (open && !wasOpen) {
      wasOpen = true;
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      void tick().then(() => {
        if (open) panel?.focus();
      });
    } else if (!open && wasOpen) {
      wasOpen = false;
      void tick().then(restorePreviousFocus);
    }
  });

  onDestroy(() => {
    if (wasOpen) restorePreviousFocus();
  });

  function trapTab(event: KeyboardEvent): void {
    if (!panel) return;
    const focusables = focusableControls();
    if (focusables.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
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

  function onWindowKeydown(event: KeyboardEvent): void {
    if (!open) return;
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      onclose();
      return;
    }
    if (event.key === "Tab") trapTab(event);
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Escape") {
      onclose();
      return;
    }
    if (event.key === "Tab") trapTab(event);
  }

  function pullFocusInside(event: FocusEvent): void {
    if (!open || !panel || panel.contains(event.target as Node)) return;
    const [first] = focusableControls();
    (first ?? panel).focus();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onfocusin={pullFocusInside} />

{#if open}
  <div class="modal-backdrop" role="presentation" onclick={() => onclose()}>
    <div
      bind:this={panel}
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Paper funds"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={onPanelKeydown}
    >
      <div class="panel-head">
        <div>
          <p>PAPER_FUNDS</p>
          <h2>${formatNumber(equityUsd, 2)}</h2>
        </div>
        <button class="modal-close" type="button" aria-label="Close" onclick={() => onclose()}>×</button>
      </div>
      <div class="modal-body">
        <p class="auth-lead">
          Simulated USDC on live market data — nothing here is real money.
        </p>
        <div class="ticket-preview">
          <div class="preview-row">
            <span>Equity</span>
            <b>${formatNumber(equityUsd, 2)}</b>
          </div>
          <div class="preview-row">
            <span>Free cash</span>
            <b>${formatNumber(freeUsd, 2)}</b>
          </div>
          <div class="preview-row">
            <span>In positions</span>
            <b>${formatNumber(marginUsd, 2)}</b>
          </div>
          <div class="preview-row">
            <span>Open positions</span>
            <b>{openPositions}</b>
          </div>
        </div>
        <div class="ticket-grid-2">
          <button class="primary" type="button" onclick={() => ontopup(1_000)}>
            Top up +$1,000
          </button>
          <button class="account-action" type="button" onclick={() => ontopup(5_000)}>
            Top up +$5,000
          </button>
        </div>
        <button class="account-action wide" type="button" onclick={onreset}>
          Reset to $10,000
        </button>
      </div>
    </div>
  </div>
{/if}
