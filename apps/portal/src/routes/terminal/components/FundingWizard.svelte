<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  let {
    address,
    funded,
    collateralized,
    traded,
    onopenfunds,
    onclose,
  }: {
    // Full wallet address — step 1 copies this verbatim. Display wraps.
    address: string;
    funded: boolean;
    collateralized: boolean;
    /** plumbed for later tickets (W5 first-trade); the spine ends at "ready". */
    traded: boolean;
    onopenfunds: () => void;
    onclose: () => void;
  } = $props();

  // Active step derives from real state — never stored. No funds → 1; funds
  // but no Phoenix collateral → 2; collateral present → 3. The wizard is the
  // welcome strip's expanded form: advancing here mirrors the strip's state.
  const step = $derived(!funded ? 1 : !collateralized ? 2 : 3);

  let panel: HTMLDivElement | undefined;
  // Single mount flips these to drive the CSS-transition entrances (no
  // keyframes — interruptible by design; the page's {#if} unmounts cleanly).
  let mounted = $state(false);
  let copied = $state(false);
  let stepBodyReady = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  // QR of the wallet address, generated lazily so the `qrcode` package
  // stays out of the entry chunk (same pattern as FundsModal).
  let qrSvg = $state<string | null>(null);
  // Funds-detected beat: a brief celebratory pulse when the balance flips
  // to funded while the wizard is open. It renders as an overlay outside the
  // step branches — the same flip advances `step` past 1, so a beat rendered
  // inside step 1 would unmount before it was ever visible.
  let fundsJustArrived = $state(false);
  let fundsBeatTimer: ReturnType<typeof setTimeout> | null = null;
  // Previous `funded` value across effect runs; starts undefined so the first
  // run primes it without firing a spurious beat on mount. (Reading the
  // reactive prop at init would only capture its initial value.)
  let prevFunded: boolean | undefined;

  // Focus the dialog on open so keys originate here: terminal hotkeys are
  // swallowed below instead of flipping the ticket behind the overlay. The
  // page's global keydown handler closes other modals on Escape but doesn't
  // know about this one, so Escape is handled here and at the window.
  onMount(() => {
    panel?.focus();
    mounted = true;
  });

  // Step crossfade + 8px slide replays on every step change (manual or
  // state-driven auto-advance). The transition lives on `.ready`, so dropping
  // it snaps the body back to its initial offset instantly (no fade-out) and
  // re-adding it animates the new body in. Double-rAF guarantees the hidden
  // frame paints before the flip, so the transition always fires.
  $effect(() => {
    step;
    stepBodyReady = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => (stepBodyReady = true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  });

  // QR regenerates whenever the address changes (wallet switch). The lazy
  // import keeps `qrcode` (+ dijkstrajs) out of the entry chunk; later opens
  // hit the module cache. toString options mirror FundsModal verbatim.
  $effect(() => {
    if (!address) return;
    let cancelled = false;
    void import("qrcode")
      .then(async ({ default: QRCode }) => {
        const svg = await QRCode.toString(address, {
          type: "svg",
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#f5eff7", light: "#00000000" },
        });
        if (!cancelled) qrSvg = svg;
      })
      .catch(() => {
        /* generation failed — keep the skeleton tile */
      });
    return () => {
      cancelled = true;
    };
  });

  // Funds-detected flip: funded going false→true fires the beat for 1400ms.
  // The wizard only mounts while open, so "while the wizard is open" is
  // implicit; opening onto an already-funded step (prevFunded starts true)
  // does not fire it. The step indicator advances via the `step` derivation —
  // the beat overlaps that transition, it never drives it.
  $effect(() => {
    const now = funded;
    if (prevFunded === undefined) {
      prevFunded = now;
      return;
    }
    if (!prevFunded && now) {
      fundsJustArrived = true;
      if (fundsBeatTimer) clearTimeout(fundsBeatTimer);
      fundsBeatTimer = setTimeout(() => (fundsJustArrived = false), 1400);
    }
    prevFunded = now;
  });

  onDestroy(() => {
    if (copyTimer) clearTimeout(copyTimer);
    if (fundsBeatTimer) clearTimeout(fundsBeatTimer);
  });

  // Real focus trap: Tab cycles within the dialog's controls, and if focus
  // ever ends up outside the panel it is pulled back — the wizard must own
  // the whole interaction while open. Adapted verbatim from AckModal.svelte.
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

  async function copyAddress(): Promise<void> {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1500);
    } catch {
      /* clipboard unavailable: leave the hint as "Copy" */
    }
  }
</script>

<svelte:window onkeydown={onWinKeydown} />

<div class="wizard-scrim" role="presentation" class:ready={mounted} onclick={() => onclose()}>
  <div
    bind:this={panel}
    class="wizard-dialog"
    class:ready={mounted}
    role="dialog"
    aria-modal="true"
    aria-label="Funding wizard"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={onPanelKeydown}
  >
    <div class="panel-head">
      <div>
        <p>GET_FUNDED</p>
        <h2>Three steps to your first trade</h2>
      </div>
      <button class="modal-close" type="button" aria-label="Close wizard" onclick={() => onclose()}>×</button>
    </div>

    <div class="wizard-scroll">
      <ol class="wizard-spine" aria-label="Funding wizard progress">
        <li class="spine-seg" class:done={1 < step} class:active={step === 1}>
          {#if 1 < step}<span class="spine-check" aria-hidden="true">✓</span>{:else}<span class="spine-num">1</span>{/if}
          Receive
        </li>
        <li class="spine-seg" class:done={2 < step} class:active={step === 2}>
          {#if 2 < step}<span class="spine-check" aria-hidden="true">✓</span>{:else}<span class="spine-num">2</span>{/if}
          Activate
        </li>
        <li class="spine-seg" class:active={step === 3}>
          <span class="spine-num">3</span> Trade
        </li>
      </ol>

      {#if fundsJustArrived}
        <p class="funds-beat" role="status">✓ Funds received</p>
      {/if}

      <div class="step-body" class:ready={stepBodyReady}>
        {#if step === 1}
          <h3 class="step-title">Send funds to your wallet</h3>
          <p class="step-copy">USDC or SOL on Solana. Your address:</p>
          <div class="qr-wrap">
            <div class="qr-tile" aria-hidden={qrSvg === null}>
              {#if qrSvg}{@html qrSvg}{/if}
            </div>
          </div>
          <button class="address-copy" type="button" onclick={copyAddress}>
            <span class="mono">{address || "—"}</span>
            <span class="copy-hint">{copied ? "Copied" : "Copy"}</span>
          </button>
          <p class="step-hint">
            Sends of $10+ unlock gasless setup. This screen will advance on its own when funds arrive.
          </p>
        {:else if step === 2}
          <h3 class="step-title">Make it tradable</h3>
          <p class="step-copy">
            Move USDC into your Phoenix margin account — rent ~0.04 SOL, explained before you sign.
          </p>
          <button class="primary wide" type="button" onclick={onopenfunds}>Open funding</button>
        {:else}
          <h3 class="step-title">You're set</h3>
          <p class="step-copy">Funded and ready. Start small.</p>
          <button class="primary wide" type="button" onclick={onclose}>Go to the desk</button>
        {/if}
      </div>
    </div>

    <p class="wizard-foot mono">step {step} of 3</p>
  </div>
</div>

<style>
  .wizard-scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    opacity: 0;
  }
  .wizard-scrim.ready {
    opacity: 1;
    transition: opacity 220ms ease;
  }

  .wizard-dialog {
    display: flex;
    flex-direction: column;
    width: min(40rem, 92vw);
    max-height: 86vh;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 1.5rem 5rem rgba(0, 0, 0, 0.5);
    opacity: 0;
    transform: translateY(12px);
  }
  .wizard-dialog.ready {
    opacity: 1;
    transform: translateY(0);
    transition:
      opacity 260ms cubic-bezier(0.23, 1, 0.32, 1),
      transform 260ms cubic-bezier(0.23, 1, 0.32, 1);
  }

  .wizard-scroll {
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    display: grid;
    gap: 0.85rem;
    padding: 1rem;
  }

  .wizard-spine {
    display: flex;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .spine-seg {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding-bottom: 0.3rem;
    color: var(--faint);
    font-size: 0.76rem;
    border-bottom: 2px solid transparent;
  }
  .spine-seg.active {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .spine-seg.done {
    color: var(--up);
  }
  .spine-num {
    font-weight: 700;
  }
  .spine-check {
    color: var(--up);
    font-weight: 700;
  }

  .step-body {
    opacity: 0;
    transform: translateX(8px);
  }
  .step-body.ready {
    opacity: 1;
    transform: translateX(0);
    transition:
      opacity 240ms cubic-bezier(0.23, 1, 0.32, 1),
      transform 240ms cubic-bezier(0.23, 1, 0.32, 1);
  }

  .step-title {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 700;
  }
  .step-copy {
    margin: 0;
    color: var(--muted);
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .step-hint {
    margin: 0;
    color: var(--faint);
    font-size: 0.76rem;
    line-height: 1.4;
  }

  .qr-wrap {
    display: flex;
    justify-content: center;
  }
  .qr-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 10rem;
    height: 10rem;
    padding: 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0;
    background: rgba(255, 255, 255, 0.02);
  }
  .qr-tile :global(svg) {
    width: 100%;
    height: 100%;
  }

  /* Overlays top-right of the scroll area (out of flow) so its 1400ms
     appearance never reflows the step body under it. */
  .funds-beat {
    position: absolute;
    top: 1rem;
    right: 1rem;
    margin: 0;
    color: var(--up);
    font-size: 0.8rem;
    animation: funds-pulse 480ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  @keyframes funds-pulse {
    0% {
      transform: scale(0.94);
      opacity: 0;
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .address-copy {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--ink);
    padding: 0.55rem 0.65rem;
    font: inherit;
    cursor: pointer;
  }
  .address-copy:hover {
    border-color: var(--accent);
  }
  .address-copy .mono {
    overflow-wrap: anywhere;
    font-size: 0.74rem;
  }
  .copy-hint {
    flex: 0 0 auto;
    color: var(--muted);
    font-size: 0.74rem;
  }

  .wizard-foot {
    margin: 0;
    padding: 0.55rem 0.9rem;
    border-top: 1px solid var(--line-soft);
    color: var(--faint);
    font-size: 0.72rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .wizard-scrim,
    .wizard-dialog,
    .step-body {
      opacity: 1 !important;
      transform: none !important;
      transition: none !important;
    }
    .funds-beat {
      animation: none;
    }
  }
</style>
