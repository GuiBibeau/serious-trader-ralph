<script lang="ts">
  import type { DepthLevel } from "$lib/phoenix-market-data";
  import { bookLevelNotional, formatBookPrice } from "$lib/terminal/book";
  import type { PerpTicket } from "$lib/terminal/perp-ticket";
  import { stepInput } from "$lib/terminal/step-input";
  import { SL_CHIP_PCTS, TP_CHIP_PCTS } from "$lib/terminal/trade-math";
  import { formatNumber, formatPercent, formatPrice } from "$lib/utils";

  // Perp ticket form: state (the nine fields + every ticket-only derived)
  // lives in the shared perp-ticket store, so the two render sites (right
  // rail + trade modal) stay in sync by construction. Money logic — the
  // submit pipeline, busy keys, tx stages, limit arm/confirm — stays in
  // +page.svelte; this component only reads its outputs and calls back.
  type TxStageEntry = {
    stage: "idle" | "simulating" | "signing" | "confirming" | "confirmed" | "failed";
    sinceMs: number;
  };

  let {
    ticket,
    sizeInput = $bindable(null),
    // Hot market inputs (WS tick cadence).
    asks,
    bids,
    spread,
    spreadPercent,
    spreadBps,
    latestPrice,
    fundingPercent,
    // Venue / position context.
    selectedSymbol,
    selectedPosition,
    // Account snapshot (chain-first collateral facts).
    phoenixAuthority,
    phoenixStateKnown,
    phoenixCollateral,
    phoenixTotalCollateral,
    accountEquityUsd,
    marginUsedPct,
    selectedLiqDistancePct,
    accountUpnlUsd,
    paperMode = false,
    // Submit gating + status (the signing pipeline stays in the page).
    canSubmit,
    orderBusy,
    orderStageEntry,
    nowMs,
    limitArmed,
    limitBlocked,
    limitDeviationPct,
    limitCrossesBook,
    perpGate,
    actionError,
    actionErrorDetail,
    actionRetry,
    lastTradeSignature,
    txStageText,
    // Mini-book gate: the desktop stack has the real ladder above.
    tradeOpen,
    stackedBook,
    // Callbacks into the page.
    onsubmit,
    onrequestaccess,
    onopenauth,
    onopenfunds,
    onpick,
    onmanualsize,
    onsizechip,
    onriskchip,
  }: {
    ticket: PerpTicket;
    sizeInput?: HTMLInputElement | null;
    asks: DepthLevel[];
    bids: DepthLevel[];
    spread: number;
    spreadPercent: number;
    spreadBps: number;
    latestPrice: number | null;
    fundingPercent: number | null;
    selectedSymbol: string;
    selectedPosition: { size: number } | null;
    phoenixAuthority: string;
    phoenixStateKnown: boolean;
    phoenixCollateral: number;
    phoenixTotalCollateral: number;
    accountEquityUsd: number;
    marginUsedPct: number;
    selectedLiqDistancePct: number | null;
    accountUpnlUsd: number;
    paperMode?: boolean;
    canSubmit: boolean;
    orderBusy: boolean;
    orderStageEntry: TxStageEntry | null;
    nowMs: number;
    limitArmed: boolean;
    limitBlocked: boolean;
    limitDeviationPct: number | null;
    limitCrossesBook: boolean;
    perpGate: { show: boolean; busy: boolean };
    actionError: string;
    actionErrorDetail: string;
    actionRetry: (() => void) | null;
    lastTradeSignature: string;
    txStageText: (entry: TxStageEntry, now: number) => string;
    tradeOpen: boolean;
    stackedBook: boolean;
    onsubmit: () => void;
    onrequestaccess: () => void;
    onopenauth: () => void;
    onopenfunds: () => void;
    onpick: (price: number, side: "ask" | "bid") => void;
    onmanualsize: () => void;
    onsizechip: (pct: number | "max") => void;
    onriskchip: (pct: number) => void;
  } = $props();

  // The store bundle is created once by the page and never replaced —
  // destructuring keeps every `$` subscription identical to the page's.
  // svelte-ignore state_referenced_locally
  const {
    tradeSide,
    sizingMode,
    tradeAmount,
    tradeRiskUsd,
    tradeLeverage,
    tradeType,
    tradeLimitPrice,
    tradeTakeProfit,
    tradeStopLoss,
    tradeReduceOnly,
    tradePreview,
    requiredMarginUsd,
    needsPhoenixFunding,
    triggerRefPrice,
    tpWrongSide,
    slWrongSide,
    slSet,
    tpPct,
    slPct,
    tpPnlUsd,
    slPnlUsd,
    riskNotionalUsd,
    setTakeProfitPct,
    setStopLossPct,
  } = ticket;

  // ── Size presets ───────────────────────────────────────────────────
  // USD mode: % of free collateral × leverage; Max keeps the same $0.01
  // margin buffer the funding gate tolerates so a Max ticket can't flash
  // "Deposit first". Risk mode: % of account equity put at risk.
  // (The chip *semantics* — chipNotionalUsd, sizeSource tracking, leverage
  // re-follow — live in the page; these are just the offered percentages.)
  const SIZE_CHIP_PCTS = [10, 25, 50];
  const RISK_CHIP_PCTS = [0.5, 1, 2];
</script>

<div class="side-toggle" role="group" aria-label="Side">
  <button class:active={$tradeSide === "buy"} type="button" onclick={() => ($tradeSide = "buy")}>Long</button>
  <button class:active={$tradeSide === "sell"} type="button" onclick={() => ($tradeSide = "sell")}>Short</button>
</div>

<div class="ticket-grid-2">
  <div class="field">
    <label>
      <span class="label-row">
        {$sizingMode === "usd" ? "Size (USD)" : "Risk (USD)"}
        <button
          class="mode-flip"
          type="button"
          onclick={() => ($sizingMode = $sizingMode === "usd" ? "risk" : "usd")}
        >{$sizingMode === "usd" ? "from stop →" : "← plain size"}</button>
      </span>
      {#if $sizingMode === "usd"}
        <input
          bind:this={sizeInput}
          bind:value={$tradeAmount}
          inputmode="decimal"
          use:stepInput={{ kind: "usd" }}
          oninput={() => onmanualsize()}
        />
      {:else}
        <input
          bind:this={sizeInput}
          bind:value={$tradeRiskUsd}
          inputmode="decimal"
          placeholder="25"
          use:stepInput={{ kind: "usd" }}
          oninput={() => onmanualsize()}
        />
      {/if}
    </label>
    {#if $sizingMode === "usd"}
      <div class="chip-row" role="group" aria-label="Quick size">
        {#each SIZE_CHIP_PCTS as pct (pct)}
          <button
            class="pct-chip"
            type="button"
            disabled={phoenixCollateral <= 0}
            onclick={() => onsizechip(pct)}
          >
            {pct}%
          </button>
        {/each}
        <button
          class="pct-chip"
          type="button"
          disabled={phoenixCollateral <= 0}
          onclick={() => onsizechip("max")}
        >
          Max
        </button>
      </div>
    {:else}
      <div class="chip-row" role="group" aria-label="Quick risk">
        {#each RISK_CHIP_PCTS as pct (pct)}
          <button
            class="pct-chip"
            type="button"
            disabled={accountEquityUsd <= 0}
            onclick={() => onriskchip(pct)}
          >
            {pct}%
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <label>
    Leverage
    <select bind:value={$tradeLeverage}>
      <option value={1}>1x</option>
      <option value={2}>2x</option>
      <option value={5}>5x</option>
      <option value={10}>10x</option>
      <option value={20}>20x</option>
    </select>
  </label>
  <label>
    Type
    <select bind:value={$tradeType}>
      <option value="market">market</option>
      <option value="limit">limit</option>
    </select>
  </label>
  <label class:ticket-field-muted={$tradeType !== "limit"}>
    <span class="label-row">
      Limit price
      {#if limitCrossesBook}
        <em class="field-note field-note-amber">crosses book — fills immediately as taker</em>
      {/if}
    </span>
    <input
      bind:value={$tradeLimitPrice}
      inputmode="decimal"
      placeholder={formatPrice(latestPrice)}
      disabled={$tradeType !== "limit"}
      use:stepInput={{ kind: "price" }}
    />
  </label>
  <div class="field" class:field-error={$tpWrongSide}>
    <label>
      <span class="label-row">
        Take profit
        {#if $tpWrongSide}
          <em class="field-note">{$tradeSide === "buy" ? "above" : "below"} entry</em>
        {/if}
      </span>
      <input
        bind:value={$tradeTakeProfit}
        inputmode="decimal"
        placeholder="optional"
        use:stepInput={{ kind: "price" }}
      />
    </label>
    <div class="chip-row" role="group" aria-label="Quick take profit">
      {#each TP_CHIP_PCTS as pct (pct)}
        <button
          class="pct-chip"
          type="button"
          disabled={!$triggerRefPrice}
          onclick={() => setTakeProfitPct(pct)}
        >
          {$tradeSide === "buy" ? "+" : "-"}{pct}%
        </button>
      {/each}
    </div>
  </div>
  <div
    class="field"
    class:field-error={$slWrongSide}
    class:field-wanted={$sizingMode === "risk" && !$slSet}
  >
    <label>
      <span class="label-row">
        Stop loss
        {#if $slWrongSide}
          <em class="field-note">{$tradeSide === "buy" ? "below" : "above"} entry</em>
        {:else if $sizingMode === "risk" && !$slSet}
          <em class="field-note field-note-amber">sets your size</em>
        {/if}
      </span>
      <input
        bind:value={$tradeStopLoss}
        inputmode="decimal"
        placeholder={$sizingMode === "risk" ? "required" : "optional"}
        use:stepInput={{ kind: "price" }}
      />
    </label>
    <div class="chip-row" role="group" aria-label="Quick stop loss">
      {#each SL_CHIP_PCTS as pct (pct)}
        <button
          class="pct-chip"
          type="button"
          disabled={!$triggerRefPrice}
          onclick={() => setStopLossPct(pct)}
        >
          {$tradeSide === "buy" ? "-" : "+"}{pct}%
        </button>
      {/each}
    </div>
  </div>
</div>

{#if selectedPosition}
  <!-- Only shown against a live position: without it a ticket sell opens
       a second isolated position with fresh margin instead of reducing. -->
  <label class="reduce-only">
    <input type="checkbox" bind:checked={$tradeReduceOnly} />
    Reduce only — trade against the open {selectedPosition.size > 0 ? "long" : "short"}, no new margin
  </label>
{/if}

<div class="ticket-preview">
  {#if $sizingMode === "risk"}
    <div class="preview-row">
      <span>Size from stop</span>
      <b>{$riskNotionalUsd !== null ? `$${formatNumber($riskNotionalUsd, 2)}` : "set a stop loss"}</b>
    </div>
  {/if}
  <div class="preview-row"><span>Est. entry</span><b>{formatPrice($tradePreview?.entry)}</b></div>
  <div class="preview-row">
    <span>Slippage</span>
    <b>{$tradePreview?.slippageBps != null ? `${formatNumber($tradePreview.slippageBps, 1)} bps` : "--"}</b>
  </div>
  <div class="preview-row"><span>Spread</span><b>{formatNumber(spreadBps, 1)} bps</b></div>
  <div class="preview-row">
    <span>Funding / 8h</span>
    <b class:positive={(fundingPercent ?? 0) >= 0} class:negative={(fundingPercent ?? 0) < 0}>
      {formatPercent(fundingPercent)}
    </b>
  </div>
  <div class="preview-row">
    <span>Est. liquidation</span>
    <b class="negative">{formatPrice($tradePreview?.liqPrice)}</b>
    {#if $tradePreview && !$tradePreview.fillable}
      <em class="warn ticket-thin-note">thin book</em>
    {/if}
  </div>
  {#if $tpPct !== null && !$tpWrongSide}
    <div class="preview-row">
      <span>At take profit</span>
      <b class="positive">
        {$tpPct >= 0 ? "+" : ""}{formatNumber($tpPct, 1)}%
        {#if $tpPnlUsd !== null}· +${formatNumber(Math.abs($tpPnlUsd), 2)}{/if}
      </b>
    </div>
  {/if}
  {#if $slPct !== null && !$slWrongSide}
    <div class="preview-row">
      <span>At stop loss</span>
      <b class="negative">
        {$slPct >= 0 ? "+" : ""}{formatNumber($slPct, 1)}%
        {#if $slPnlUsd !== null}· -${formatNumber(Math.abs($slPnlUsd), 2)}{/if}
      </b>
    </div>
  {/if}
  <div class="preview-row">
    <span>Margin required</span>
    <b class:negative={$needsPhoenixFunding}>
      ${formatNumber($requiredMarginUsd, 2)}
      {#if phoenixAuthority}· bal ${formatNumber(phoenixCollateral, 2)}{/if}
    </b>
  </div>
</div>

{#if tradeOpen || !stackedBook}
  <!-- Compact ladder for tickets that can't see the full book (modal,
       narrow-viewport tabs); the desktop stack has the real one above. -->
  <div class="mini-book" aria-label="Order book preview">
    {#each asks.slice(0, 5).reverse() as level (level.price)}
      <button type="button" class="mini-row ask" onclick={() => onpick(level.price, "ask")}>
        <span>{formatBookPrice(level.price)}</span>
        <span>{formatNumber(bookLevelNotional(level), 0)}</span>
      </button>
    {/each}
    <div class="mini-spread">
      <span>{formatBookPrice(spread)}</span>
      <em>spread</em>
      <span>{formatNumber(spreadPercent, 3)}%</span>
    </div>
    {#each bids.slice(0, 5) as level (level.price)}
      <button type="button" class="mini-row bid" onclick={() => onpick(level.price, "bid")}>
        <span>{formatBookPrice(level.price)}</span>
        <span>{formatNumber(bookLevelNotional(level), 0)}</span>
      </button>
    {:else}
      <div class="mini-empty">book warming up</div>
    {/each}
  </div>
{/if}

<div class="ticket-actions">
  {#if phoenixAuthority && phoenixTotalCollateral > 0}
    <div
      class="risk-strip"
      class:warn={marginUsedPct > 60}
      class:danger={marginUsedPct > 85 ||
        (selectedLiqDistancePct !== null && selectedLiqDistancePct < 5)}
    >
      <span>EQ ${formatNumber(accountEquityUsd, 2)}</span>
      <span>USED {formatNumber(marginUsedPct, 0)}%</span>
      <span>
        {selectedLiqDistancePct !== null
          ? `LIQ Δ ${formatNumber(selectedLiqDistancePct, 1)}%`
          : "LIQ --"}
      </span>
      <span
        class:positive={accountUpnlUsd >= 0}
        class:negative={accountUpnlUsd < 0}
      >uPNL ${formatNumber(accountUpnlUsd, 2)}</span>
    </div>
  {/if}
  <!-- Single reserved status line: error, live tx stage, tx link, or quiet hint. -->
  <p
    class="ticket-status"
    class:error={Boolean(actionError)}
    title={actionErrorDetail || undefined}
    role="status"
    aria-live="polite"
  >
    {#if actionError}
      {actionError}
      {#if actionRetry}
        <button class="row-action" type="button" onclick={actionRetry}>Retry</button>
      {/if}
    {:else if paperMode}
      {#if lastTradeSignature}
        {$tradeType === "market" || limitCrossesBook ? "Paper order filled" : "Paper order placed"}
        · ref {lastTradeSignature}
      {:else}
        &nbsp;
      {/if}
    {:else if orderStageEntry}
      {txStageText(orderStageEntry, nowMs)}
    {:else if lastTradeSignature}
      Confirmed ·
      <a class="news-domain" href={`https://solscan.io/tx/${lastTradeSignature}`} target="_blank" rel="noopener noreferrer">view tx</a>
    {:else}
      &nbsp;
    {/if}
  </p>

  {#if !phoenixAuthority && !paperMode}
    <button class="primary wide" type="button" onclick={onopenauth}>
      Connect account to trade
    </button>
  {:else if !phoenixStateKnown}
    <!-- Account state still loading: show the real action, disabled —
         never the "Deposit first" claim before we actually know. -->
    <button class="primary wide" type="button" disabled>
      <span class="spinner" aria-hidden="true"></span>
      {$tradeSide === "buy" ? "Long" : "Short"} {selectedSymbol}-PERP · {$tradeLeverage}x
    </button>
  {:else if $needsPhoenixFunding}
    <button class="primary wide" type="button" onclick={onopenfunds}>
      {paperMode ? "Top up paper" : "Deposit first"} · ${formatNumber(Math.max(0, $requiredMarginUsd - phoenixCollateral), 2)}
    </button>
  {:else if perpGate.show && !paperMode}
    <div class="perp-gate" role="status">
      <p>One step left: activate perp access with the Harness invite — a single signature, then deposit and trade.</p>
      <button
        class="primary wide"
        type="button"
        disabled={perpGate.busy}
        onclick={onrequestaccess}
      >
        {#if perpGate.busy}<span class="spinner" aria-hidden="true"></span>{/if}
        {perpGate.busy ? "Activating…" : "Activate perp access"}
      </button>
    </div>
  {:else}
    <!-- Two-stage armed when the limit is far from mark; the reserved
         wide button self-documents each state, no extra layout. -->
    <button
      class="primary wide"
      class:armed={limitArmed}
      type="button"
      disabled={!canSubmit || limitBlocked}
      onclick={onsubmit}
    >
      {#if orderBusy}<span class="spinner" aria-hidden="true"></span>{/if}
      {orderBusy
        ? orderStageEntry
          ? txStageText(orderStageEntry, nowMs)
          : "Simulating…"
        : limitBlocked
          ? `Price ${formatNumber(Math.abs(limitDeviationPct ?? 0), 1)}% from mark — check decimals`
          : limitArmed
            ? `Confirm limit ${formatNumber(Math.abs(limitDeviationPct ?? 0), 1)}% from mark`
            : $sizingMode === "risk" && !$slSet
              ? "Set a stop loss to size"
              : !$tradePreview
                ? "Enter a size"
                : `${paperMode ? "PAPER · " : ""}${$tradeSide === "buy" ? "Long" : "Short"} ${selectedSymbol}-PERP · ${$tradeLeverage}x`}
    </button>
  {/if}
</div>

<style>
  /* ── Trade ticket ─────────────────────────────────────────────────── */
  .perp-gate {
    display: grid;
    gap: 0.4rem;
  }

  .perp-gate p {
    margin: 0;
    color: var(--muted);
    font-size: 0.74rem;
    line-height: 1.4;
  }

  .field {
    display: grid;
    gap: 0.3rem;
    align-content: start;
  }

  .pct-chip {
    flex: 1;
    min-height: 1.4rem;
    padding: 0.05rem 0.2rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.66rem;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--line);
    cursor: pointer;
  }

  .pct-chip:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--muted);
  }

  .pct-chip:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Reduce-only toggle: a one-line row, not a grid field. */
  .reduce-only {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.68rem;
    color: var(--muted);
    cursor: pointer;
  }

  .reduce-only input {
    width: auto;
    min-height: 0;
    margin: 0;
    accent-color: var(--accent);
  }

  .field-error input {
    border-color: var(--down);
  }

  .field-wanted input {
    border-color: rgba(255, 180, 84, 0.55);
  }

  .field-note-amber {
    color: var(--amber);
  }

  .field-note {
    color: var(--down);
    font-size: 0.62rem;
    font-style: normal;
    font-weight: 600;
  }

  .label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem;
    /* Mode/side flips change these strings — never let them wrap, so the
       fields below sit at identical positions in every mode. Clip inside
       the cell rather than bleeding into the neighboring label. */
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
    gap: 0.5rem;
  }
  .mode-flip {
    background: transparent;
    border: 0;
    color: var(--accent);
    font-size: 0.62rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    white-space: nowrap;
  }
  .mode-flip:hover { filter: brightness(1.15); }

  .ticket-field-muted {
    opacity: 0.45;
    transition: opacity 160ms ease;
  }

  .warn {
    color: var(--amber);
  }

  .ticket-thin-note {
    margin-left: 0.4rem;
    font-style: normal;
    font-size: 0.62rem;
    text-transform: uppercase;
  }

  /* ── Ambient risk strip ──────────────────────────────────────────── */
  .risk-strip {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.25rem 0.45rem;
    border: 1px solid var(--line-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.64rem;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.02);
  }

  .risk-strip.warn {
    border-color: rgba(255, 180, 84, 0.5);
    color: var(--amber);
  }

  .risk-strip.danger {
    border-color: rgba(255, 90, 106, 0.6);
    color: var(--down);
  }

  /* ── Mini book inside the ticket ─────────────────────────────────── */
  .mini-book {
    border: 1px solid var(--line-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.7rem;
  }

  .mini-row {
    display: flex;
    justify-content: space-between;
    width: 100%;
    border: 0;
    background: transparent;
    padding: 0.14rem 0.5rem;
    cursor: pointer;
    font: inherit;
  }

  .mini-row.ask { color: var(--down); }
  .mini-row.bid { color: var(--up); }
  .mini-row:hover { background: rgba(255, 255, 255, 0.04); }
  .mini-row span:last-child { color: var(--muted); }

  .mini-spread {
    display: flex;
    justify-content: space-between;
    padding: 0.14rem 0.5rem;
    border-block: 1px solid var(--line-soft);
    color: var(--muted);
  }

  .mini-spread em { font-style: normal; color: var(--faint); }
  .mini-empty { padding: 0.4rem 0.5rem; color: var(--faint); }

  /* Reserved single-line status (error / tx link / blank). */
  .ticket-status {
    margin: 0;
    min-height: 1.2rem;
    font-size: 0.74rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ticket-status.error {
    color: var(--red);
  }

  /* The primary action never requires scrolling: status + submit stick to
     the bottom of the ticket scroller on an opaque footer. */
  .ticket-actions {
    position: sticky;
    bottom: 0;
    display: grid;
    gap: 0.45rem;
    margin: 0 -0.65rem;
    padding: 0.35rem 0.65rem 0.6rem;
    background: var(--surface);
    border-top: 1px solid var(--line-soft);
  }
</style>
