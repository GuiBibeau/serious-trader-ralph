<script lang="ts">
  import { privyAuth } from "$lib/privy-auth";
  import {
    shortAddress,
    shortEmail,
    walletStatusText,
  } from "$lib/terminal/account-format";
  import { alertsStore } from "$lib/terminal/alerts";
  import { formatNumber } from "$lib/utils";
  import { BrandMark } from "@harness-trade/ui";

  const { alerts } = alertsStore;

  // Auth/tx actions stay page-side (signing plumbing + modal open flags);
  // the topbar only renders account state and calls back.
  let {
    wallet,
    layoutCustomized,
    logoutBusy,
    height = $bindable(0),
    onopenauth,
    onopenfunds,
    onopenalerts,
    onresetlayout,
    onlogout,
    oncopyaddress,
    onrefreshbalances,
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
    height?: number;
    onopenauth: () => void;
    onopenfunds: () => void;
    onopenalerts: () => void;
    onresetlayout: () => void;
    onlogout: () => void | Promise<void>;
    oncopyaddress: () => void | Promise<void>;
    onrefreshbalances: () => void;
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
    {#if layoutCustomized}
      <button class="ghost" type="button" onclick={onresetlayout}>Reset layout</button>
    {/if}
    <button class="secondary alerts-btn" type="button" onclick={onopenalerts}>
      Alerts{#if pendingAlertCount}
        <span class="alerts-count">{pendingAlertCount}</span>
      {/if}
    </button>
    {#if $privyAuth.authenticated}
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
                    {formatNumber(usdcBalanceValue, 2)} wallet · {formatNumber(phoenixTotalCollateral, 2)} phoenix
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
    {:else}
      {#if !$privyAuth.configured}
        <span class="connect-status error">
          <span class="stream-dot offline" aria-hidden="true"></span>
          Auth not configured
        </span>
      {:else if $privyAuth.status === "error"}
        <span class="connect-status error">
          <span class="stream-dot offline" aria-hidden="true"></span>
          Connection failed
        </span>
      {/if}
      <button
        class="primary connect-btn"
        type="button"
        disabled={$privyAuth.status === "loading" || !$privyAuth.configured}
        onclick={onopenauth}
      >
        {#if $privyAuth.status === "loading"}
          <span class="spinner" aria-hidden="true"></span>
        {/if}
        {connectLabel}
      </button>
    {/if}
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

  .alerts-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
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

  .connect-status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.74rem;
    color: var(--muted);
    white-space: nowrap;
  }

  .connect-status.error {
    color: var(--red);
  }

  /* Only the offline dot renders here; the live/pulse variants belong to
     the ticker rail's stream indicator. */
  .stream-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--faint);
    box-shadow: 0 0 0 0 rgba(255, 77, 151, 0.5);
  }

  .stream-dot.offline {
    background: var(--red);
  }

  .connect-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-width: 11rem;
    font-weight: 700;
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
</style>
