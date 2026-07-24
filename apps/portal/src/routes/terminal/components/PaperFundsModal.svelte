<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import {
    formatDisplayMoney,
    type DisplayCurrencyCode,
  } from "$lib/terminal/display-currency";

  let {
    open,
    freeUsd,
    equityUsd,
    marginUsd,
    openPositions,
    requiredMarginUsd = 0,
    displayCurrency = "USD",
    fxRate = 1,
    onclose,
    ontopup,
    onreset,
  }: {
    open: boolean;
    freeUsd: number;
    equityUsd: number;
    marginUsd: number;
    openPositions: number;
    /** Margin the open ticket needs — shown when free cash is short. */
    requiredMarginUsd?: number;
    displayCurrency?: DisplayCurrencyCode;
    fxRate?: number;
    onclose: () => void;
    ontopup: (amount: number) => void;
    onreset: () => void;
  } = $props();

  const money = (usd: number, digits = 2) =>
    formatDisplayMoney(usd, displayCurrency, fxRate, digits);

  const shortfallUsd = $derived(
    requiredMarginUsd > 0 ? Math.max(0, requiredMarginUsd - freeUsd) : 0,
  );
  const hasTicketNeed = $derived(requiredMarginUsd > 0.01);
  const canFundTicket = $derived(hasTicketNeed && shortfallUsd <= 0.01);

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
          <h2>{money(equityUsd, 2)}</h2>
        </div>
        <button class="modal-close" type="button" aria-label="Close" onclick={() => onclose()}>×</button>
      </div>
      <div class="modal-body">
        <p class="auth-lead">
          Simulated USDC on live market data (perps + spot) — nothing here is real money.
          {#if displayCurrency !== "USD"}
            Amounts below are shown in {displayCurrency} (approx).
          {/if}
        </p>
        <div class="ticket-preview">
          <div class="preview-row">
            <span>Equity</span>
            <b>{money(equityUsd, 2)}</b>
          </div>
          <div class="preview-row">
            <span>Free cash</span>
            <b>{money(freeUsd, 2)}</b>
          </div>
          <div class="preview-row">
            <span>In positions</span>
            <b>{money(marginUsd, 2)}</b>
          </div>
          <div class="preview-row">
            <span>Open positions</span>
            <b>{openPositions}</b>
          </div>
          {#if hasTicketNeed}
            <div class="preview-row">
              <span>This ticket needs</span>
              <b>{money(requiredMarginUsd, 2)}</b>
            </div>
          {/if}
        </div>
        {#if hasTicketNeed && shortfallUsd > 0.01}
          <p class="fund-note short">
            Not enough free cash — short {money(shortfallUsd, 2)}. Equity can look high while margin is locked in open positions.
          </p>
        {:else if canFundTicket}
          <p class="fund-note ok">
            Free cash covers this ticket — close this and press Long/Short.
          </p>
        {/if}
        <div class="ticket-grid-2">
          <button class="primary" type="button" onclick={() => ontopup(1_000)}>
            Top up +{money(1_000, 0)}
          </button>
          <button class="account-action" type="button" onclick={() => ontopup(5_000)}>
            Top up +{money(5_000, 0)}
          </button>
        </div>
        <button class="account-action wide" type="button" onclick={onreset}>
          Reset to {money(10_000, 0)}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .fund-note {
    margin: 0.65rem 0 0.85rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--line-soft);
    font-size: 0.78rem;
    line-height: 1.35;
    color: var(--muted);
  }

  .fund-note.short {
    border-color: rgba(255, 77, 151, 0.45);
    color: var(--ink);
    background: rgba(255, 77, 151, 0.08);
  }

  .fund-note.ok {
    border-color: rgba(141, 236, 195, 0.35);
    color: var(--muted);
    background: rgba(141, 236, 195, 0.06);
  }
</style>
