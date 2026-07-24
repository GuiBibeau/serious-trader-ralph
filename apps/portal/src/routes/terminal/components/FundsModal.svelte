<script lang="ts">
  import { onDestroy } from "svelte";
  import { getJupiterQuote, type JupiterQuote } from "$lib/funding";
  import { formatNumber } from "$lib/utils";
  import {
    formatDisplayMoney,
    type DisplayCurrencyCode,
  } from "$lib/terminal/display-currency";

  // Money movement stays page-side (signing plumbing): deposits/withdrawals
  // fire `ondeposit`/`onwithdraw` into `submitCollateral`, and the swap
  // submit runs through `onswap`, which signs via `simulateConfirmAndSend`
  // and returns the signature. The modal owns only quote/QR/tab state.
  let {
    open,
    tab = $bindable(),
    depositAmount = $bindable(),
    withdrawAmount = $bindable(),
    walletAddress,
    walletCopied,
    usdcBalance,
    solBalanceValue,
    gasText,
    phoenixCollateralUsd,
    displayCurrency = "USD",
    fxRate = 1,
    collateral,
    onclose,
    ondeposit,
    onwithdraw,
    oncopyaddress,
    onswap,
  }: {
    open: boolean;
    tab: "receive" | "convert" | "phoenix";
    depositAmount: string;
    withdrawAmount: string;
    walletAddress: string | null;
    walletCopied: boolean;
    usdcBalance: { text: string; value: number | null };
    solBalanceValue: number | null;
    gasText: string;
    phoenixCollateralUsd: number | null;
    displayCurrency?: DisplayCurrencyCode;
    fxRate?: number;
    collateral: { busy: boolean; error: string; signature: string };
    onclose: () => void;
    ondeposit: () => void;
    onwithdraw: () => void;
    oncopyaddress: () => void | Promise<void>;
    onswap: (quote: JupiterQuote) => Promise<string>;
  } = $props();

  const money = (usd: number, digits = 2) =>
    formatDisplayMoney(usd, displayCurrency, fxRate, digits);

  // Aliases keep the moved markup verbatim against the page's names.
  const usdcBalanceText = $derived(usdcBalance.text);
  const usdcBalanceValue = $derived(usdcBalance.value);
  const walletBalanceText = $derived(gasText);
  const collateralBusy = $derived(collateral.busy);
  const collateralError = $derived(collateral.error);
  const collateralSignature = $derived(collateral.signature);

  // Add-funds (receive + swap) flow — quote/debounce state lives here.
  let fundsQr = $state("");
  let swapSol = $state("");
  let swapQuote = $state<JupiterQuote | null>(null);
  let swapStatus = $state<
    "idle" | "quoting" | "quoted" | "swapping" | "done" | "error"
  >("idle");
  let swapError = $state("");
  let swapSignature = $state("");
  let swapQuoteTimer: ReturnType<typeof setTimeout> | null = null;

  // Each open starts fresh (the page's openFunds used to reset + regenerate
  // the QR). Only the open-rise triggers this — address edits mid-session
  // don't loop the effect because `wasOpen` gates the body.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      resetSwap();
      void generateFundsQr();
    }
    wasOpen = open;
  });

  onDestroy(() => {
    if (swapQuoteTimer) clearTimeout(swapQuoteTimer);
  });

  async function generateFundsQr(): Promise<void> {
    const address = walletAddress;
    if (!address) {
      fundsQr = "";
      return;
    }
    try {
      // Lazy: qrcode (+dijkstrajs) stays out of the entry chunk; first
      // modal open pays the fetch once, later opens hit the module cache.
      const { default: QRCode } = await import("qrcode");
      fundsQr = await QRCode.toString(address, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#f5eff7", light: "#00000000" },
      });
    } catch {
      fundsQr = "";
    }
  }

  function resetSwap(): void {
    swapSol = "";
    swapQuote = null;
    swapStatus = "idle";
    swapError = "";
    swapSignature = "";
  }

  function scheduleSwapQuote(): void {
    if (swapQuoteTimer) clearTimeout(swapQuoteTimer);
    swapSignature = "";
    const amount = Number(swapSol);
    if (!Number.isFinite(amount) || amount <= 0) {
      swapQuote = null;
      swapStatus = "idle";
      return;
    }
    swapStatus = "quoting";
    swapQuoteTimer = setTimeout(() => void runSwapQuote(amount), 450);
  }

  async function runSwapQuote(amount: number): Promise<void> {
    try {
      swapQuote = await getJupiterQuote(amount);
      swapStatus = "quoted";
    } catch (error) {
      swapStatus = "error";
      swapError = error instanceof Error ? error.message : "quote-failed";
    }
  }

  async function executeSwap(): Promise<void> {
    if (!swapQuote || !walletAddress || swapStatus === "swapping") return;
    swapStatus = "swapping";
    swapError = "";
    try {
      swapSignature = await onswap(swapQuote);
      swapStatus = "done";
    } catch (error) {
      swapStatus = "error";
      swapError = error instanceof Error ? error.message : "swap-failed";
    }
  }

  // Modals may keep keys away from the global hotkeys, but never Escape —
  // the window handler owns close-on-Esc no matter where focus sits.
  function swallowKeysExceptEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape") event.stopPropagation();
  }
</script>

{#if open}
  <div class="modal-backdrop" role="presentation" onclick={() => onclose()}>
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={swallowKeysExceptEscape}
    >
      <div class="panel-head">
        <div>
          <p>ADD_FUNDS</p>
          <h2>{usdcBalanceText}</h2>
        </div>
        <button class="modal-close" type="button" aria-label="Close" onclick={() => onclose()}>×</button>
      </div>
      <div class="modal-body">
        <div class="side-toggle funds-tabs funds-tabs-3" role="group" aria-label="Funding method">
          <button class:active={tab === "receive"} type="button" onclick={() => (tab = "receive")}>Receive</button>
          <button class:active={tab === "convert"} type="button" onclick={() => (tab = "convert")}>Convert</button>
          <button class:active={tab === "phoenix"} type="button" onclick={() => (tab = "phoenix")}>Phoenix</button>
        </div>

        {#if tab === "receive"}
          <p class="auth-lead">Send <b>USDC</b> or <b>SOL</b> on the <b>Solana</b> network to this address.</p>
          {#if fundsQr}
            <div class="funds-qr">{@html fundsQr}</div>
          {/if}
          <button
            class="account-row copyable funds-address"
            type="button"
            disabled={!walletAddress}
            onclick={oncopyaddress}
          >
            <span class="account-row-value mono">{walletAddress ?? "—"}</span>
            <span class="copy-hint" class:done={walletCopied}>{walletCopied ? "Copied" : "Copy"}</span>
          </button>
          <div class="ticket-preview">
            <div class="preview-row"><span>USDC balance</span><b>{usdcBalanceText}</b></div>
            <div class="preview-row"><span>SOL (gas)</span><b>{walletBalanceText}</b></div>
          </div>
          <p class="auth-note">Deposits appear automatically. Keep a little SOL for network fees.</p>
        {:else if tab === "convert"}
          <p class="auth-lead">Swap <b>SOL → USDC</b> in your wallet via Jupiter (best route).</p>
          <label>
            Amount (SOL)
            <input bind:value={swapSol} oninput={scheduleSwapQuote} inputmode="decimal" placeholder="0.5" />
          </label>
          <div class="ticket-preview">
            <div class="preview-row">
              <span>You receive</span>
              <b>
                {#if swapStatus === "quoting"}…{:else if swapQuote}{swapQuote.outUsdc.toFixed(2)} USDC{:else}—{/if}
              </b>
            </div>
            <div class="preview-row">
              <span>Price impact</span>
              <b>{swapQuote ? `${(swapQuote.priceImpactPct * 100).toFixed(2)}%` : "--"}</b>
            </div>
            <div class="preview-row"><span>Wallet SOL</span><b>{walletBalanceText}</b></div>
          </div>
          {#if swapStatus === "done"}
            <p class="auth-note">Swap submitted. <a class="news-domain" href={`https://solscan.io/tx/${swapSignature}`} target="_blank" rel="noopener noreferrer">View tx</a></p>
          {/if}
          {#if swapStatus === "error" && swapError}
            <p class="auth-note error">{swapError}</p>
          {/if}
          <button
            class="primary wide"
            type="button"
            disabled={!swapQuote || swapStatus === "swapping" || swapStatus === "quoting"}
            onclick={executeSwap}
          >
            {#if swapStatus === "swapping"}<span class="spinner" aria-hidden="true"></span>{/if}
            {swapStatus === "swapping" ? "Swapping…" : swapStatus === "done" ? "Swap again" : "Swap to USDC"}
          </button>
        {:else}
          <p class="auth-lead">Move <b>USDC</b> between your wallet and your <b>Phoenix margin account</b>.</p>
          <div class="ticket-preview">
            <div class="preview-row"><span>Phoenix collateral</span><b>{phoenixCollateralUsd !== null ? money(phoenixCollateralUsd, 2) : "--"}</b></div>
            <div class="preview-row"><span>Wallet USDC</span><b>{usdcBalanceText}</b></div>
            <div class="preview-row"><span>SOL (gas)</span><b>{walletBalanceText}</b></div>
          </div>

          {#if usdcBalanceValue !== null && usdcBalanceValue < 0.01}
            <!-- Empty wallet: route into the funding flow instead of a dead button. -->
            <div class="funding-guide">
              <p class="auth-lead">
                Your wallet has no USDC yet — fund it first, then deposit to Phoenix.
              </p>
              <div class="ticket-grid-2">
                <button class="account-action accent" type="button" onclick={() => (tab = "receive")}>
                  Receive USDC
                </button>
                {#if (solBalanceValue ?? 0) > 0.015}
                  <button class="account-action accent" type="button" onclick={() => (tab = "convert")}>
                    Convert {formatNumber(solBalanceValue, 2)} SOL
                  </button>
                {:else}
                  <button class="account-action" type="button" onclick={() => (tab = "receive")}>
                    Send SOL for gas
                  </button>
                {/if}
              </div>
            </div>
          {:else if (solBalanceValue ?? 0) < 0.002}
            <div class="funding-guide">
              <p class="auth-lead">
                You have USDC but no <b>SOL for network fees</b> — send a little SOL first.
              </p>
              <button class="account-action accent wide" type="button" onclick={() => (tab = "receive")}>
                Receive SOL
              </button>
            </div>
          {:else}
            <div class="ticket-grid-2">
              <label>
                Deposit (USDC)
                <input bind:value={depositAmount} inputmode="decimal" placeholder="100" />
              </label>
              <label>
                Withdraw (USDC)
                <input bind:value={withdrawAmount} inputmode="decimal" placeholder="50" />
              </label>
            </div>
          {/if}
          {#if collateralSignature}
            <p class="auth-note">Submitted. <a class="news-domain" href={`https://solscan.io/tx/${collateralSignature}`} target="_blank" rel="noopener noreferrer">View tx</a></p>
          {/if}
          {#if collateralError}
            <p class="auth-note error">{collateralError}</p>
          {/if}
          {#if (usdcBalanceValue === null || usdcBalanceValue >= 0.01) && (solBalanceValue ?? 0) >= 0.002}
            <div class="ticket-grid-2">
              <button
                class="primary"
                type="button"
                disabled={collateralBusy || !Number(depositAmount)}
                onclick={() => ondeposit()}
              >
                {#if collateralBusy}<span class="spinner" aria-hidden="true"></span>{/if}
                Deposit
              </button>
              <button
                class="account-action"
                type="button"
                disabled={collateralBusy || !Number(withdrawAmount)}
                onclick={() => onwithdraw()}
              >
                Withdraw
              </button>
            </div>
            <p class="auth-note">Withdrawals settle through the Phoenix withdraw queue.</p>
          {/if}
        {/if}
      </div>
    </section>
  </div>
{/if}

<style>
  /* ── Add-funds modal ──────────────────────────────────────────────── */
  /* .side-toggle.funds-tabs / .funds-tabs-3 and .ticket-grid-2 live in
     terminal.css (shared with the ticket forms / cascade-order-sensitive
     vs the .side-toggle first/last active rules there). */
  .funding-guide {
    display: grid;
    gap: 0.6rem;
    border: 1px dashed var(--line);
    border-radius: 0;
    padding: 0.75rem;
  }

  .funding-guide .auth-lead {
    margin: 0;
  }

  .funds-qr {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 0;
    background: rgba(255, 255, 255, 0.02);
  }

  .funds-qr :global(svg) {
    width: 9.5rem;
    height: 9.5rem;
  }

  .funds-address {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .funds-address .account-row-value {
    text-align: left;
    white-space: normal;
    overflow-wrap: anywhere;
    font-size: 0.72rem;
  }
</style>
