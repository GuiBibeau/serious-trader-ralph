<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import {
    DISPLAY_CURRENCIES,
    type DisplayCurrencyCode,
  } from "$lib/terminal/display-currency";
  import {
    timezonesForPicker,
    type DisplayTimezoneId,
  } from "$lib/terminal/display-timezone";

let {
  open = false,
  currency,
  timezone,
  showLevels = true,
  layoutCustomized = false,
  onclose,
  oncurrencychange,
  ontimezonechange,
  ontogglelevels,
  onresetlayout,
  onopenshortcuts,
}: {
  open?: boolean;
  currency: DisplayCurrencyCode;
  timezone: DisplayTimezoneId;
  showLevels?: boolean;
  layoutCustomized?: boolean;
  onclose: () => void;
  oncurrencychange: (code: DisplayCurrencyCode) => void;
  ontimezonechange: (id: DisplayTimezoneId) => void;
  ontogglelevels: () => void;
  onresetlayout: () => void;
  onopenshortcuts: () => void;
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
      if (open) {
        const select = panel?.querySelector<HTMLSelectElement>(
          'select[name="currency"]',
        );
        (select ?? panel)?.focus();
      }
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

function onCurrencyInput(event: Event): void {
  const value = (event.currentTarget as HTMLSelectElement).value;
  const match = DISPLAY_CURRENCIES.find((row) => row.code === value);
  if (match) oncurrencychange(match.code);
}

function onTimezoneInput(event: Event): void {
  const value = (event.currentTarget as HTMLSelectElement).value;
  ontimezonechange(value);
}

const timezoneOptions = $derived(timezonesForPicker(timezone));
</script>

<svelte:window onkeydown={onWindowKeydown} onfocusin={pullFocusInside} />

{#if open}
  <div class="modal-backdrop" role="presentation" onclick={() => onclose()}>
    <div
      bind:this={panel}
      class="modal settings-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={onPanelKeydown}
    >
      <div class="panel-head">
        <div>
          <p>TERMINAL</p>
          <h2>Settings</h2>
        </div>
        <button
          class="modal-close"
          type="button"
          aria-label="Close"
          onclick={() => onclose()}>×</button
        >
      </div>
      <div class="modal-body settings-body">
        <label class="settings-row currency-row" for="settings-currency">
          <span class="settings-copy">
            <strong>Currency</strong>
            <span
              >Show balances in a currency you know. Trading still settles in
              USD.</span
            >
          </span>
          <select
            id="settings-currency"
            name="currency"
            value={currency}
            onchange={onCurrencyInput}
          >
            {#each DISPLAY_CURRENCIES as row (row.code)}
              <option value={row.code}>{row.code} — {row.label}</option>
            {/each}
          </select>
        </label>

        <label class="settings-row currency-row" for="settings-timezone">
          <span class="settings-copy">
            <strong>Timezone</strong>
            <span
              >Clocks, journal, tape, and alert times use this zone. Chart
              candles stay on exchange UTC.</span
            >
          </span>
          <select
            id="settings-timezone"
            name="timezone"
            value={timezone}
            onchange={onTimezoneInput}
          >
            {#each timezoneOptions as row (row.id)}
              <option value={row.id}>{row.label}</option>
            {/each}
          </select>
        </label>

        <div class="settings-row">
          <div class="settings-copy">
            <strong>Structure levels</strong>
            <span>PDH/PDL and swing pivots on the chart</span>
          </div>
          <button
            class="secondary"
            type="button"
            aria-pressed={showLevels}
            onclick={ontogglelevels}
          >
            {showLevels ? "On" : "Off"}
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-copy">
            <strong>Layout</strong>
            <span>Reset panel order to defaults</span>
          </div>
          <button
            class="secondary"
            type="button"
            disabled={!layoutCustomized}
            onclick={onresetlayout}
          >
            Reset
          </button>
        </div>

        <div class="settings-row">
          <div class="settings-copy">
            <strong>Keyboard shortcuts</strong>
            <span>Hotkeys for ticket, chart, and desk</span>
          </div>
          <button
            class="secondary"
            type="button"
            onclick={() => {
              onclose();
              onopenshortcuts();
            }}
          >
            Open
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-body {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 0;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .settings-row:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }

  .settings-copy {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .settings-copy strong {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink);
  }

  .settings-copy span {
    font-size: 0.72rem;
    line-height: 1.35;
    color: var(--muted);
  }

  .currency-row {
    flex-direction: column;
    align-items: stretch;
  }

  .currency-row select {
    width: 100%;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--line-soft);
    border-radius: 0;
    background: var(--panel, rgba(255, 255, 255, 0.03));
    color: var(--ink);
    font: inherit;
    font-size: 0.85rem;
  }

  .currency-row select:focus {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }

  .settings-row .secondary {
    flex-shrink: 0;
    min-width: 4.5rem;
  }
</style>
