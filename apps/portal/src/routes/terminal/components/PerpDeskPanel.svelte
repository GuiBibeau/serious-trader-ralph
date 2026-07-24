<script lang="ts">
  import type { AiRead } from "$lib/ai";
  import type {
    PhoenixOpenOrder,
    PhoenixPosition,
    PhoenixSide,
    PhoenixTraderState,
  } from "$lib/phoenix-trade";
  import { panelStyle, usePanelLayout } from "$lib/terminal/layout";
  import type { SignalRow } from "$lib/terminal/panels";
  import { liqDistancePct, orderCancelKey } from "$lib/terminal/trade-math";
  import {
    formatDisplayMoney,
    formatDisplayMoneySigned,
    type DisplayCurrencyCode,
  } from "$lib/terminal/display-currency";
  import { formatNumber, formatPercent, formatPrice } from "$lib/utils";
  import AiReadLine from "./AiReadLine.svelte";
  import DragHead from "./DragHead.svelte";
  import Spark from "./Spark.svelte";

  // Optimistic order shape mirrors the page's `pendingOrder` — the burst
  // poll replaces it with the real row or drops it on timeout.
  type PendingOrder = {
    symbol: string;
    side: PhoenixSide;
    notionalUsd: number;
    refPrice: number;
    leverage: number;
  };

  let {
    authority,
    trader,
    positions,
    openOrders,
    pendingOrder,
    account,
    sessionPnlUsd,
    sessionPnlPct,
    equityValues,
    fundingRead,
    briefRead,
    actionError,
    actionErrorDetail,
    actionRetry,
    busyKeys,
    closingKeys,
    apiSlotLag,
    marketMids,
    selectedSymbol,
    latestPrice,
    marketRows,
    freeCollateralUsd,
    flattenArmed,
    flattenBusy,
    bidSweepSymbols,
    askSweepSymbols,
    cancelSweepBusy,
    marginAddKey,
    marginAddValue = $bindable(),
    paperMode = false,
    displayCurrency = "USD",
    fxRate = 1,
    ontrade,
    ondeposit,
    onselectsymbol,
    onshare,
    onclose,
    onclosepartial,
    oncancelorder,
    oncancelside,
    onflatten,
    onmarginopen,
    onmarginsubmit,
    onresetpaper,
  }: {
    authority: string;
    trader: PhoenixTraderState | null;
    positions: PhoenixPosition[];
    openOrders: PhoenixOpenOrder[];
    pendingOrder: PendingOrder | null;
    account: { upnl: number; exposure: number; leverage: number | null };
    sessionPnlUsd: number | null;
    sessionPnlPct: number | null;
    equityValues: number[];
    fundingRead: AiRead;
    briefRead: AiRead;
    actionError: string;
    actionErrorDetail: string;
    actionRetry: (() => void) | null;
    busyKeys: Set<string>;
    closingKeys: Set<string>;
    apiSlotLag: number | null;
    marketMids: Record<string, number>;
    selectedSymbol: string;
    latestPrice: number | null;
    marketRows: SignalRow[];
    freeCollateralUsd: number;
    flattenArmed: boolean;
    flattenBusy: boolean;
    bidSweepSymbols: string[];
    askSweepSymbols: string[];
    cancelSweepBusy: boolean;
    marginAddKey: string | null;
    marginAddValue: string;
    paperMode?: boolean;
    displayCurrency?: DisplayCurrencyCode;
    fxRate?: number;
    // Every money handler stays in the page (signing plumbing) — the panel
    // only reports intent through these callbacks.
    ontrade: (side: "buy" | "sell") => void;
    ondeposit: () => void;
    onselectsymbol: (symbol: string) => void;
    onshare: (position: PhoenixPosition) => void;
    onclose: (position: PhoenixPosition) => void;
    onclosepartial: (position: PhoenixPosition, fraction: number) => void;
    oncancelorder: (order: PhoenixOpenOrder) => void;
    oncancelside: (side: PhoenixSide) => void;
    onflatten: () => void;
    onmarginopen: (position: PhoenixPosition) => void;
    onmarginsubmit: (position: PhoenixPosition) => void;
    onresetpaper?: () => void;
  } = $props();

  const money = (usd: number, digits = 2) =>
    formatDisplayMoney(usd, displayCurrency, fxRate, digits);
  const moneySigned = (usd: number, digits = 2) =>
    formatDisplayMoneySigned(usd, displayCurrency, fxRate, digits);

  const {
    panelOrder,
    draggedPanel,
    dragOverPanel,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  } = usePanelLayout();

  function liqDistancePctOf(position: PhoenixPosition): number | null {
    return liqDistancePct(
      position,
      marketMids[position.symbol] ??
        (position.symbol === selectedSymbol ? latestPrice : null),
    );
  }
</script>

<section
  id="section-perp"
  class="panel perp-panel"
  role="group"
  data-panel="perp"
  style={panelStyle("perp", $panelOrder)}
  class:dragging={$draggedPanel === "perp"}
  class:drag-over={$dragOverPanel === "perp"}
  ondragover={(event) => onPanelDragOver(event, "perp")}
  ondragleave={() => onPanelDragLeave("perp")}
  ondrop={(event) => onPanelDrop(event, "perp")}
>
  <div class="panel-head">
    <DragHead
      panelId="perp"
      kicker={paperMode ? "PAPER_DESK" : "PERP_DESK"}
      title={paperMode ? "Paper account" : "Phoenix account"}
    />
    {#if positions.length > 0}
      <!-- Two-stage armed; fixed width so the relabel never shifts layout. -->
      <button
        class="row-action flatten-btn"
        class:armed={flattenArmed}
        type="button"
        disabled={flattenBusy}
        onclick={onflatten}
      >
        {#if flattenBusy}<span class="spinner" aria-hidden="true"></span>{/if}
        {flattenBusy ? "Flattening…" : flattenArmed ? "Confirm flatten" : "FLATTEN"}
      </button>
    {/if}
    {#if paperMode && onresetpaper}
      <button class="row-action" type="button" onclick={onresetpaper} title="Reset paper balance to $10,000">
        Reset
      </button>
    {/if}
    <button class="primary" type="button" onclick={() => ontrade("buy")}>Trade</button>
  </div>
  <AiReadLine read={fundingRead} />

  {#if authority && trader}
    <div class="venue-strip">
      <div><span>Collateral</span><b>{trader.collateralUsd !== null ? money(trader.collateralUsd, 2) : "--"}</b></div>
      <div><span>uPnL</span>
        <b
          class:positive={(trader.unrealizedPnlUsd ?? 0) >= 0}
          class:negative={(trader.unrealizedPnlUsd ?? 0) < 0}
        >{trader.unrealizedPnlUsd !== null ? money(trader.unrealizedPnlUsd, 2) : "--"}</b>
      </div>
      <div><span>Risk</span><b>{trader.riskTier ?? "--"}</b></div>
      <div>
        <span>Exposure</span>
        <b
          class:warn={(account.leverage ?? 0) > 10 && (account.leverage ?? 0) <= 15}
          class:negative={(account.leverage ?? 0) > 15}
        >
          {account.exposure > 0
            ? `${money(account.exposure, 0)} · ${formatNumber(account.leverage, 1)}x`
            : "--"}
        </b>
      </div>
      {#if sessionPnlUsd !== null && equityValues.length >= 2}
        <!-- Since the UTC day's first equity sample, deposit/withdraw
             shifted out — needs two points before it means anything. -->
        <div>
          <span>Day P&L</span>
          <b class:positive={sessionPnlUsd >= 0} class:negative={sessionPnlUsd < 0}>
            {moneySigned(sessionPnlUsd, 2)}
            {#if sessionPnlPct !== null}({formatPercent(sessionPnlPct)}){/if}
            <Spark values={equityValues} tone={sessionPnlUsd >= 0 ? "up" : "down"} />
          </b>
        </div>
      {/if}
      <button class="row-action" type="button" onclick={ondeposit}>{paperMode ? "Top up" : "Deposit"}</button>
    </div>

    {#if trader.positions.length > 0}
      <AiReadLine read={briefRead} />
    {/if}

    {#if actionError}
      <p class="auth-note error venue-note" title={actionErrorDetail || undefined}>
        {actionError}
        {#if actionRetry}
          <button class="row-action" type="button" onclick={actionRetry}>Retry</button>
        {/if}
      </p>
    {/if}

    {#if positions.length > 0 || pendingOrder}
      <div class="venue-section">Positions</div>
      {#if pendingOrder}
        <!-- Optimistic row while the indexer catches up; the burst poll
             replaces it with the real row or drops it on timeout. -->
        <div class="pos-card pos-pending">
          <div class="pos-card-top">
            <span class="pos-side">{pendingOrder.side === "bid" ? "LONG" : "SHORT"}</span>
            <span class="pos-symbol-static">{pendingOrder.symbol}</span>
            <b class="mono">
              {money(pendingOrder.notionalUsd, 2)}
              @ {formatPrice(pendingOrder.refPrice)} · {pendingOrder.leverage}x
            </b>
          </div>
          <div class="pos-card-mid mono">
            <span>
              confirming with indexer{apiSlotLag !== null ? ` · SYNC −${apiSlotLag}` : ""}
            </span>
          </div>
        </div>
      {/if}
      {#each positions as position (`${position.symbol}:${position.subaccountIndex}`)}
        {@const roePct =
          position.unrealizedPnl !== null && position.marginUsd
            ? (position.unrealizedPnl / position.marginUsd) * 100
            : null}
        {@const liqDist = liqDistancePctOf(position)}
        {@const rowKey = `${position.symbol}:${position.subaccountIndex}`}
        {@const closeBusy = busyKeys.has(`close:${rowKey}`)}
        <div class="pos-card">
          <div class="pos-card-top">
            <span
              class="pos-side"
              class:positive={position.size > 0}
              class:negative={position.size < 0}
            >{position.size > 0 ? "LONG" : "SHORT"}</span>
            <button
              class="pos-symbol"
              type="button"
              title="Show on chart"
              onclick={() => onselectsymbol(position.symbol)}
            >{position.symbol}</button>
            <b class="mono">
              {formatNumber(Math.abs(position.size), 4)}
              {#if position.positionValue !== null}({money(position.positionValue, 2)}){/if}
            </b>
            <em
              class="mono"
              class:positive={(position.unrealizedPnl ?? 0) >= 0}
              class:negative={(position.unrealizedPnl ?? 0) < 0}
            >
              {position.unrealizedPnl !== null
                ? moneySigned(position.unrealizedPnl, 2)
                : "--"}
              {#if roePct !== null}({roePct >= 0 ? "+" : ""}{formatNumber(roePct, 1)}%){/if}
            </em>
          </div>
          <div class="pos-card-mid mono">
            <span>entry {formatPrice(position.entryPrice)}</span>
            <span>
              mark {formatPrice(
                marketMids[position.symbol] ??
                  (position.symbol === selectedSymbol ? latestPrice : null),
              )}
            </span>
            <span>
              TP {position.takeProfitPrice !== null ? formatPrice(position.takeProfitPrice) : "--"}
              · SL {position.stopLossPrice !== null ? formatPrice(position.stopLossPrice) : "--"}
            </span>
          </div>
          <div class="pos-card-bottom">
            {#if liqDist !== null}
              <div
                class="liq-bar"
                class:warn={liqDist < 25}
                class:danger={liqDist < 10}
                title={`Liquidation est ${formatNumber(liqDist, 1)}% away`}
              >
                <i style={`width: ${Math.min(100, (liqDist / 50) * 100)}%;`}></i>
                <span class="mono">liq {formatNumber(liqDist, 1)}% away</span>
              </div>
            {:else}
              <span class="mono liq-none">liq --</span>
            {/if}
            {#if liqDist !== null && liqDist < 25}
              <!-- The remedy that actually moves an isolated liq price:
                   margin into the child subaccount, not an account deposit. -->
              <button
                class="row-action"
                type="button"
                onclick={() => onmarginopen(position)}
              >
                Margin +
              </button>
            {/if}
            {#if position.unrealizedPnl !== null}
              <button
                class="row-action"
                type="button"
                onclick={() => onshare(position)}
              >
                Share
              </button>
            {/if}
            {#each [25, 50, 75] as pct (pct)}
              <button
                class="pct-chip"
                type="button"
                disabled={closeBusy || closingKeys.has(rowKey)}
                title={`Close ${pct}% — TP/SL remain attached`}
                onclick={() => onclosepartial(position, pct / 100)}
              >
                {pct}%
              </button>
            {/each}
            <button
              class="row-action"
              type="button"
              disabled={closeBusy || closingKeys.has(rowKey)}
              onclick={() => onclose(position)}
            >
              {#if closeBusy}<span class="spinner" aria-hidden="true"></span>{/if}
              {closingKeys.has(rowKey) ? "Closing…" : "Close"}
            </button>
          </div>
          {#if marginAddKey === rowKey}
            {@const marginBusy = busyKeys.has(`margin:${rowKey}`)}
            <div class="margin-add mono">
              <input
                bind:value={marginAddValue}
                inputmode="decimal"
                aria-label="Margin to add (USDC)"
                placeholder="USDC"
              />
              <button
                class="row-action"
                type="button"
                disabled={marginBusy || !(Number(marginAddValue) > 0)}
                onclick={() => onmarginsubmit(position)}
              >
                {#if marginBusy}<span class="spinner" aria-hidden="true"></span>{/if}
                Add margin
              </button>
              <span class="margin-add-note">free {money(Math.max(0, freeCollateralUsd), 2)}</span>
            </div>
          {/if}
        </div>
      {/each}
      <div class="pos-total mono">
        <span>TOTAL</span>
        <span>
          exp {money(
            positions.reduce(
              (sum, position) => sum + (position.positionValue ?? 0),
              0,
            ),
            2,
          )}
        </span>
        <span
          class:positive={account.upnl >= 0}
          class:negative={account.upnl < 0}
        >uPNL {moneySigned(account.upnl, 2)}</span>
      </div>
    {/if}

    {#if openOrders.length > 0}
      <div class="venue-section venue-section-row">
        <span>Open orders</span>
        {#if bidSweepSymbols.length > 0}
          <button
            class="row-action"
            type="button"
            disabled={cancelSweepBusy}
            onclick={() => oncancelside("bid")}
          >
            Cancel all bids
          </button>
        {/if}
        {#if askSweepSymbols.length > 0}
          <button
            class="row-action"
            type="button"
            disabled={cancelSweepBusy}
            onclick={() => oncancelside("ask")}
          >
            Cancel all asks
          </button>
        {/if}
      </div>
      {#each openOrders as order (order.orderSequenceNumber)}
        {@const mark = marketMids[order.symbol] ?? (order.symbol === selectedSymbol ? latestPrice : null)}
        {@const cancelBusy = busyKeys.has(orderCancelKey(order))}
        <div class="venue-row">
          <span class={order.side === "bid" ? "positive" : "negative"}>
            {order.isStopLoss ? "STOP" : "LIMIT"} {order.side.toUpperCase()} {order.symbol}
          </span>
          <b class="mono">
            {order.remaining !== null ? formatNumber(order.remaining, 4) : "--"}
            @ {formatPrice(order.price)}
          </b>
          <em class="mono">
            {mark !== null && order.price !== null
              ? `${formatNumber((Math.abs(order.price - mark) / mark) * 100, 2)}% away`
              : "--"}
          </em>
          <em class="mono order-seq">#{order.orderSequenceNumber.slice(0, 8)}</em>
          <button
            class="row-action"
            type="button"
            disabled={cancelBusy}
            onclick={() => oncancelorder(order)}
          >
            {#if cancelBusy}<span class="spinner" aria-hidden="true"></span>{/if}
            Cancel
          </button>
        </div>
      {/each}
    {/if}

    {#if trader.positions.length === 0 && trader.orders.length === 0 && !pendingOrder}
      <div class="empty">
        {trader.registered
          ? "No open positions or orders."
          : "No Phoenix account yet — your first order or deposit creates it."}
      </div>
    {/if}
  {:else if authority}
    <div class="empty">Loading Phoenix account…</div>
  {:else}
    <div class="empty">
      {paperMode
        ? "Paper desk ready — place a trade to start."
        : "Connect your account to trade on Phoenix."}
    </div>
  {/if}

  <div class="table">
    {#each marketRows as row}
      <div class="table-row">
        <span>{row.label}</span>
        <b>{row.value}</b>
        <em>{row.status}</em>
      </div>
    {/each}
  </div>
</section>

<style>
  /* Two-stage flatten in the PERP_DESK head: reserved width so the
     FLATTEN ↔ Confirm flatten relabel never shifts the layout. */
  .flatten-btn {
    min-width: 7.5rem;
    letter-spacing: 0.05em;
  }

  .flatten-btn.armed {
    color: var(--down);
    border-color: rgba(255, 90, 106, 0.6);
  }

  /* ── Phoenix venue (account strip + position/order rows) ─────────── */
  .venue-strip {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr auto;
    gap: 0.5rem;
    align-items: center;
    margin: 0 0.65rem 0.4rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0;
    background: rgba(255, 255, 255, 0.02);
  }

  .venue-strip span {
    display: block;
    color: var(--faint);
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .venue-strip b {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.8rem;
  }

  /* Day P&L sparkline rides the stat value line (svg lives in Spark.svelte). */
  .venue-strip :global(.spark) {
    vertical-align: -0.25rem;
  }

  .venue-note {
    margin: 0 0.75rem 0.4rem;
  }

  /* ── Position cards ──────────────────────────────────────────────── */
  .pos-card {
    display: grid;
    gap: 0.3rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .pos-card-top {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .pos-side {
    font-family: ui-monospace, monospace;
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    border: 1px solid currentcolor;
    padding: 0.05rem 0.3rem;
  }

  .pos-symbol {
    border: 0;
    background: transparent;
    color: var(--ink);
    font-weight: 800;
    font-size: 0.85rem;
    padding: 0;
    cursor: pointer;
  }

  .pos-symbol:hover {
    color: var(--accent);
  }

  .pos-card-top b {
    font-size: 0.76rem;
    color: var(--muted);
    font-weight: 500;
  }

  .pos-card-top em {
    margin-left: auto;
    font-style: normal;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .pos-card-mid {
    display: flex;
    gap: 0.9rem;
    font-size: 0.68rem;
    color: var(--muted);
    flex-wrap: wrap;
  }

  /* Optimistic row while the indexer catches up — visibly interim. */
  .pos-pending {
    color: var(--faint);
  }

  .pos-symbol-static {
    color: var(--muted);
    font-weight: 800;
    font-size: 0.85rem;
  }

  .pos-card-bottom {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Partial-close chips: fixed-size, never fight the liq bar for width. */
  .pos-card-bottom .pct-chip {
    flex: 0 0 auto;
    min-width: 2.2rem;
  }

  /* Inline margin top-up editor under the liq bar. */
  .margin-add {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.68rem;
  }

  .margin-add input {
    width: 6rem;
    min-height: 1.6rem;
    padding: 0.15rem 0.4rem;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--ink);
    font: inherit;
  }

  .margin-add-note {
    color: var(--faint);
    font-size: 0.62rem;
  }

  .liq-bar {
    position: relative;
    flex: 1;
    height: 1.05rem;
    border: 1px solid var(--line-soft);
    overflow: hidden;
  }

  .liq-bar i {
    position: absolute;
    inset: 0 auto 0 0;
    background: rgba(44, 233, 127, 0.14);
  }

  .liq-bar.warn i {
    background: rgba(255, 180, 84, 0.18);
  }

  .liq-bar.danger i {
    background: rgba(255, 90, 106, 0.22);
  }

  .liq-bar span {
    position: relative;
    display: block;
    padding: 0.08rem 0.4rem;
    font-size: 0.62rem;
    color: var(--muted);
  }

  .liq-bar.warn span { color: var(--amber); }
  .liq-bar.danger span { color: var(--down); }

  .liq-none {
    flex: 1;
    font-size: 0.62rem;
    color: var(--faint);
  }

  .pos-total {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.4rem 0.75rem;
    font-size: 0.68rem;
    color: var(--muted);
    border-bottom: 1px solid var(--line-soft);
  }

  /* ── Selected-market signal table ────────────────────────────────── */
  .table {
    display: grid;
    gap: 0.15rem;
    padding: 0.65rem;
  }

  .table-row {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr) 4.25rem 4rem;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    min-height: 1.8rem;
    font-size: 0.75rem;
    text-align: left;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .table-row {
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    padding: 0.5rem 0.5rem;
    border-bottom: 1px solid var(--line-soft);
    color: var(--muted);
  }

  .table-row b {
    color: var(--ink);
  }

  /* Size-chip copy — the ticket keeps its own in the page's scoped style. */
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

  /* Amber copy — the tone-palette original stays in the page style. */
  .warn {
    color: var(--amber);
  }

  @media (max-width: 720px) {
    .venue-strip {
      grid-template-columns: 1fr 1fr;
    }

    .table-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .table-row em {
      display: none;
    }
  }
</style>
