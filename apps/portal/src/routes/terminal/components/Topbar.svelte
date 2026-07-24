<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { chatState } from "$lib/chat";
  import { privyAuth } from "$lib/privy-auth";
  import {
    shortAddress,
    shortEmail,
    walletStatusText,
  } from "$lib/terminal/account-format";
  import { alertsStore } from "$lib/terminal/alerts";
  import { formatNumber } from "$lib/utils";
  import {
    formatDisplayMoney,
    type DisplayCurrencyCode,
  } from "$lib/terminal/display-currency";
  import { BrandMark } from "@harness-trade/ui";

  const { alerts } = alertsStore;

  // Auth/tx actions stay page-side (signing plumbing + modal open flags);
  // the topbar only renders account state and calls back.
  let {
    wallet,
    layoutCustomized,
    logoutBusy,
    paperMode = false,
    paperFundsLabel = "",
    displayCurrency = "USD",
    fxRate = 1,
    height = $bindable(0),
    onopenauth,
    onopenfunds,
    onopensettings,
    onopenalerts,
    onresetlayout,
    onToggleChat,
    onlogout,
    oncopyaddress,
    onrefreshbalances,
    ontogglepaper,
  }: {
    wallet: {
      balanceText: string;
      gasText: string;
      status: "idle" | "loading" | "ready" | "error";
      error: string;
      usdcValue: number | null;
      phoenixCollateral: number;
      screen: { flagged: boolean; checked: boolean };
      whitelisted: boolean | null;
      copied: boolean;
    };
    layoutCustomized: boolean;
    logoutBusy: boolean;
    paperMode?: boolean;
    /** Shown on the paper Funds button, e.g. "$10,000". */
    paperFundsLabel?: string;
    displayCurrency?: DisplayCurrencyCode;
    fxRate?: number;
    height?: number;
    onopenauth: () => void;
    onopenfunds: () => void;
    onopensettings: () => void;
    onopenalerts: () => void;
    onresetlayout: () => void;
    onToggleChat: () => void;
    onlogout: () => void | Promise<void>;
    oncopyaddress: () => void | Promise<void>;
    onrefreshbalances: () => void;
    ontogglepaper: () => void;
  } = $props();

  // Aliases keep the moved markup verbatim against the page's names.
  const balanceText = $derived(wallet.balanceText);
  const walletBalanceText = $derived(wallet.gasText);
  const walletBalanceStatus = $derived(wallet.status);
  const walletBalanceError = $derived(wallet.error);
  const usdcBalanceValue = $derived(wallet.usdcValue);
  const phoenixTotalCollateral = $derived(wallet.phoenixCollateral);
  const walletScreen = $derived(wallet.screen);
  const phoenixWhitelisted = $derived(wallet.whitelisted);
  const walletCopied = $derived(wallet.copied);

  const connectLabel = $derived(
    $privyAuth.status === "loading"
      ? "Connecting…"
      : $privyAuth.status === "error"
        ? "Retry connect"
        : !$privyAuth.configured
          ? "Auth unavailable"
          : "Connect account",
  );
  const walletStatusLabel = $derived(walletStatusText($privyAuth.walletStatus));
  const pendingAlertCount = $derived(
    $alerts.filter((a) => !a.triggered).length,
  );

  const money = (usd: number, digits = 2) =>
    formatDisplayMoney(usd, displayCurrency, fxRate, digits);

  // The account menu is fully local; the window handlers own outside-click
  // and Escape close (moved from the page together with the markup).
  let accountMenuOpen = $state(false);

  function toggleAccountMenu(event: MouseEvent): void {
    event.stopPropagation();
    accountMenuOpen = !accountMenuOpen;
  }

  function closeAccountMenuFromWindow(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".account-menu")) return;
    accountMenuOpen = false;
  }

  function closeAccountMenuOnKey(event: KeyboardEvent): void {
    if (event.key === "Escape") accountMenuOpen = false;
  }

  async function handleLogout(): Promise<void> {
    await onlogout();
    // The page closed the menu only after a successful logout; mirror that
    // by checking the auth store instead of assuming the call succeeded.
    if (!$privyAuth.authenticated) accountMenuOpen = false;
  }
</script>

<svelte:window
  onclick={closeAccountMenuFromWindow}
  onkeydown={closeAccountMenuOnKey}
/>

<header class="topbar" bind:clientHeight={height}>
  <a class="brand" href="/terminal" aria-label="Harness terminal">
    <span class="brand-mark"><BrandMark /></span>
    <!-- Wordmark per docs/BRAND.md: HARNESS·TERMINAL -->
    <span>HARNESS</span>
    <strong>·TERMINAL</strong>
  </a>
  <div class="topbar-actions">
    <div class="mode-toggle" class:is-paper={paperMode} role="group" aria-label="Trading mode">
      <span class="mode-pill" aria-hidden="true"></span>
      <button
        type="button"
        class:active={!paperMode}
        aria-pressed={!paperMode}
        onclick={() => paperMode && ontogglepaper()}
        title="Live trading with real funds"
      >
        LIVE
      </button>
      <button
        type="button"
        class:active={paperMode}
        class:paper={paperMode}
        aria-pressed={paperMode}
        onclick={() => !paperMode && ontogglepaper()}
        title="Paper trading — simulated balance on live prices"
      >
        PAPER
      </button>
    </div>
    {#if layoutCustomized}
      <button class="ghost" type="button" onclick={onresetlayout}>Reset layout</button>
    {/if}
    <button class="secondary alerts-btn" type="button" onclick={onopenalerts}>
      Alerts{#if pendingAlertCount}
        <span class="alerts-count">{pendingAlertCount}</span>
      {/if}
    </button>
    <button
      class="ghost"
      type="button"
      aria-expanded={$chatState.open}
      onclick={onToggleChat}
    >
      desk
    </button>
    <button
      class="ghost settings-btn"
      type="button"
      aria-label="Settings"
      title="Settings"
      onclick={onopensettings}
    >
      <svg
        class="settings-gear"
        viewBox="0 0 24 24"
        width="17"
        height="17"
        aria-hidden="true"
        fill="currentColor"
      >
        <!-- Circular cogwheel: teeth around a ring, hole in the hub. -->
        <path
          fill-rule="evenodd"
          d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 0 12 8.4a3.6 3.6 0 0 0 0 7.2z"
        />
      </svg>
    </button>
    <div class="account-bay">
    {#if $privyAuth.authenticated && !paperMode}
      <div class="account-slot" in:fade|local={{ duration: 160 }} out:fade|local={{ duration: 120 }}>
      <div class="account-menu">
        <button
          class="account-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          onclick={toggleAccountMenu}
        >
          <span class="account-trigger-text">
            <small>{$privyAuth.email ? shortEmail($privyAuth.email) : "Account"}</small>
            <strong>{balanceText}</strong>
          </span>
          <span class="account-caret" class:open={accountMenuOpen} aria-hidden="true"></span>
        </button>
        {#if accountMenuOpen}
          <div
            class="account-dropdown"
            role="menu"
            tabindex="-1"
            in:fly={{ y: -4, duration: 160 }}
            out:fade={{ duration: 100 }}
            onclick={(event) => event.stopPropagation()}
            onkeydown={(event) => event.stopPropagation()}
          >
            <div class="account-dropdown-head">
              <div class="account-identity">
                <small>Signed in</small>
                <strong>{$privyAuth.email ?? "Privy account"}</strong>
              </div>
              <span class="wallet-badge {$privyAuth.walletStatus}">{walletStatusLabel}</span>
            </div>

            <button
              class="account-row copyable"
              type="button"
              disabled={!$privyAuth.walletAddress}
              onclick={oncopyaddress}
            >
              <span class="account-row-label">Wallet</span>
              <span class="account-row-value mono">
                {$privyAuth.walletAddress ? shortAddress($privyAuth.walletAddress) : "Not provisioned"}
              </span>
              {#if $privyAuth.walletAddress}
                <span class="copy-hint" class:done={walletCopied}>{walletCopied ? "Copied" : "Copy"}</span>
              {/if}
            </button>

            {#if walletScreen.checked}
              <div class="account-row">
                <span class="account-row-label">Screening</span>
                <span class="account-row-value">OFAC SDN</span>
                <span class="macro-chip {walletScreen.flagged ? 'down' : 'up'}">
                  {walletScreen.flagged ? "Flagged" : "Clear"}
                </span>
              </div>
            {/if}

            {#if phoenixWhitelisted !== null}
              <div class="account-row">
                <span class="account-row-label">Phoenix</span>
                <span class="account-row-value">beta access</span>
                <span class="macro-chip {phoenixWhitelisted ? 'up' : 'warn'}">
                  {phoenixWhitelisted ? "Active" : "Pending"}
                </span>
              </div>

            {/if}

            <div class="account-row">
              <span class="account-row-label">Funds</span>
              <span class="account-row-value mono">
                {balanceText}
                {#if phoenixTotalCollateral > 0 && usdcBalanceValue !== null}
                  <small class="funds-split">
                    {money(usdcBalanceValue, 2)} wallet · {money(phoenixTotalCollateral, 2)} phoenix
                  </small>
                {/if}
              </span>
              <button
                class="row-action"
                type="button"
                disabled={!$privyAuth.walletAddress || walletBalanceStatus === "loading"}
                onclick={onrefreshbalances}
              >
                {walletBalanceStatus === "loading" ? "…" : "Refresh"}
              </button>
            </div>

            <div class="account-row">
              <span class="account-row-label">Gas</span>
              <span class="account-row-value mono">{walletBalanceText}</span>
            </div>

            {#if walletBalanceError}
              <p class="account-dropdown-note warn">{walletBalanceError}</p>
            {/if}

            <button
              class="account-action accent"
              type="button"
              disabled={!$privyAuth.walletAddress || walletScreen.flagged}
              onclick={onopenfunds}
            >
              {walletScreen.flagged ? "Funding blocked (flagged)" : "Add funds"}
            </button>

            <button class="account-action danger" type="button" disabled={logoutBusy} onclick={handleLogout}>
              {logoutBusy ? "Logging out…" : "Log out"}
            </button>
          </div>
        {/if}
      </div>
      </div>
    {:else if paperMode}
      <div class="account-slot" in:fade|local={{ duration: 160 }} out:fade|local={{ duration: 120 }}>
        <button
          class="secondary account-cta paper-funds-btn"
          type="button"
          onclick={onopenfunds}
          title="Paper funds"
        >
          <small>Funds</small>
          <strong>{paperFundsLabel || "$0"}</strong>
        </button>
      </div>
    {:else}
      <div class="account-slot" in:fade|local={{ duration: 160 }} out:fade|local={{ duration: 120 }}>
      <button
        class="primary connect-btn account-cta"
        type="button"
        disabled={$privyAuth.status === "loading" || !$privyAuth.configured}
        onclick={onopenauth}
        title={
          !$privyAuth.configured
            ? "Live auth needs Privy — use PAPER for practice"
            : $privyAuth.status === "error"
              ? "Connection failed — retry"
              : undefined
        }
      >
        {#if $privyAuth.status === "loading"}
          <span class="spinner" aria-hidden="true"></span>
        {/if}
        {connectLabel}
      </button>
      </div>
    {/if}
    </div>
  </div>
</header>

<style>
  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem clamp(0.75rem, 2vw, 1.5rem);
    border-bottom: 1px solid var(--line);
    background: rgba(8, 10, 13, 0.9);
    backdrop-filter: blur(16px);
  }

  .brand {
    display: flex;
    gap: 0.55rem;
    align-items: center;
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .brand .brand-mark {
    display: flex;
    width: 1.05rem;
    height: 1.05rem;
    color: var(--ink);
  }

  .brand strong {
    color: var(--muted);
    font-weight: 500;
  }

  .topbar-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    justify-content: flex-end;
    min-width: 0;
    min-height: 2.3rem;
    flex-wrap: wrap;
  }

  .mode-toggle {
    position: relative;
    display: inline-grid;
    grid-template-columns: 3.4rem 3.4rem;
    border: 1px solid var(--line);
    border-radius: 0;
    isolation: isolate;
    flex-shrink: 0;
  }

  .mode-pill {
    position: absolute;
    inset: 0 auto 0 0;
    width: 50%;
    background: var(--paper);
    z-index: 0;
    transition: transform 220ms cubic-bezier(0.2, 0.85, 0.3, 1);
    pointer-events: none;
  }

  .mode-toggle.is-paper .mode-pill {
    transform: translateX(100%);
    background: color-mix(in srgb, var(--accent) 18%, var(--paper));
  }

  .mode-toggle button {
    position: relative;
    z-index: 1;
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--muted);
    font: inherit;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 0.35rem 0;
    cursor: pointer;
    transition: color 180ms ease;
  }

  .mode-toggle button:hover {
    color: var(--ink);
  }

  .mode-toggle button.active {
    color: var(--ink);
  }

  .mode-toggle button.paper.active {
    color: var(--accent);
  }

  /* Fixed bay so LIVE ↔ PAPER fades don't push Alerts/desk around.
     Absolute slots can overlap during crossfade without growing the bar. */
  .account-bay {
    position: relative;
    width: 11rem;
    height: 2.2rem;
    flex-shrink: 0;
  }

  .settings-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    flex-shrink: 0;
  }

  .settings-gear {
    display: block;
  }

  .account-slot {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: stretch;
  }

  .account-cta,
  .account-menu,
  .account-trigger {
    width: 100%;
  }

  .account-trigger {
    justify-content: space-between;
  }

  .paper-funds-btn {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.05rem;
    min-height: 2.2rem;
    padding: 0.25rem 0.6rem;
    text-align: left;
    line-height: 1.1;
  }

  .paper-funds-btn small {
    color: var(--muted);
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .paper-funds-btn strong {
    font-size: 0.82rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .alerts-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
    transition:
      color 160ms ease,
      border-color 160ms ease,
      background 160ms ease;
  }

  .alerts-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.05rem;
    height: 1.05rem;
    padding: 0 0.25rem;
    border-radius: 0;
    background: var(--accent);
    color: #04130d;
    font-size: 0.6rem;
    font-weight: 800;
  }

  .connect-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-width: 0;
    font-weight: 700;
    transition: opacity 160ms ease, background 160ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .mode-pill,
    .mode-toggle button,
    .alerts-btn,
    .connect-btn {
      transition: none;
    }
  }

  .account-menu {
    position: relative;
  }

  .account-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--ink);
    min-height: 2.2rem;
    padding: 0.3rem 0.6rem;
    transition: border-color 160ms ease, background 160ms ease;
  }

  .account-trigger:hover {
    border-color: rgba(255, 77, 151, 0.5);
  }

  .account-trigger-text {
    display: grid;
    text-align: left;
    line-height: 1.15;
    min-width: 0;
  }

  .account-trigger-text small {
    color: var(--muted);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 13rem;
  }

  .account-trigger-text strong {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .account-caret {
    width: 0.4rem;
    height: 0.4rem;
    border-right: 2px solid var(--muted);
    border-bottom: 2px solid var(--muted);
    transform: translateY(-0.1rem) rotate(45deg);
    transition: transform 160ms ease;
  }

  .account-caret.open {
    transform: translateY(0.05rem) rotate(-135deg);
  }

  .account-dropdown {
    position: absolute;
    top: calc(100% + 0.45rem);
    right: 0;
    z-index: 40;
    width: min(20rem, calc(100vw - 1.5rem));
    display: grid;
    gap: 0.5rem;
    padding: 0.7rem;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface);
    box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.5);
  }

  .account-dropdown-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding-bottom: 0.55rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .account-identity {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .account-identity small {
    color: var(--faint);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .account-identity strong {
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* .wallet-badge, .account-row*, .copy-hint, .account-action live in
     terminal.css — the funds modal renders them too. */

  /* Wallet/phoenix split under the combined Funds figure. */
  .funds-split {
    display: block;
    color: var(--faint);
    font-size: 0.64rem;
  }

  .account-dropdown-note {
    margin: 0;
    font-size: 0.72rem;
  }

  .account-dropdown-note.warn {
    color: var(--amber);
  }

  /* Component copy of the macro chip (same pattern as MacroPanel) — the
     screening/whitelist rows tone their status pills with it. */
  .macro-chip {
    justify-self: end;
    border-radius: 0;
    padding: 0.1rem 0.5rem;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border: 1px solid transparent;
  }

  .macro-chip.up {
    color: var(--up);
    background: var(--up-soft);
    border-color: rgba(44, 233, 127, 0.35);
  }

  .macro-chip.down {
    color: var(--red);
    background: rgba(240, 107, 99, 0.12);
    border-color: rgba(240, 107, 99, 0.35);
  }

  .macro-chip.warn {
    color: var(--amber);
    background: rgba(228, 173, 79, 0.12);
    border-color: rgba(228, 173, 79, 0.35);
  }

  @media (max-width: 1100px) {
    .topbar {
      position: static;
      align-items: flex-start;
      flex-direction: column;
    }

    .topbar-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .account-dropdown {
      right: auto;
      left: 0;
      width: min(22rem, calc(100vw - 1.5rem));
    }
  }

  @media (max-width: 720px) {
    .account-trigger-text small {
      max-width: 9rem;
    }
  }

  @media (max-width: 480px) {
    .topbar {
      gap: 0.65rem;
    }

    .mode-toggle {
      order: 0;
    }

    .account-bay {
      order: 1;
      width: 11rem;
      min-width: 0;
      flex: 0 0 11rem;
    }

    .paper-funds-btn {
      width: 100%;
      min-width: 0;
      overflow: hidden;
    }

    .topbar-actions > button {
      order: 2;
      flex: 1 1 auto;
    }

    .account-dropdown {
      right: 0;
      left: auto;
      width: calc(100vw - 1.5rem);
    }
  }
</style>
