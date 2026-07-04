<script lang="ts">
  import { alertsStore, type Alert } from "$lib/terminal/alerts";
  import { formatPrice } from "$lib/utils";

  let {
    open,
    symbol,
    latestPrice,
    onclose,
  }: {
    open: boolean;
    symbol: string;
    latestPrice: number | null;
    onclose: () => void;
  } = $props();

  const { alerts, alertLog } = alertsStore;

  // Form state lives here (not behind the {#if open}) so condition/tier
  // choices persist across open/close, exactly like the old page state.
  let alertOp: "above" | "below" = $state("above");
  let alertPrice = $state("");
  let alertTier: Alert["tier"] = $state("PRIORITY");
  let notifyReady = $state(
    typeof Notification !== "undefined" &&
      Notification.permission === "granted",
  );

  // Modals may keep keys away from the global hotkeys, but never Escape —
  // the window handler owns close-on-Esc no matter where focus sits.
  function swallowKeysExceptEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape") event.stopPropagation();
  }

  async function addAlert(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const price = Number(alertPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        notifyReady = (await Notification.requestPermission()) === "granted";
      } catch {
        notifyReady = false;
      }
    }
    alertsStore.arm({ symbol, op: alertOp, price, tier: alertTier });
    alertPrice = "";
    alertsStore.check(latestPrice, symbol);
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
          <p>ALERTS</p>
          <h2>{symbol}-PERP · {formatPrice(latestPrice)}</h2>
        </div>
        <button class="modal-close" type="button" aria-label="Close" onclick={() => onclose()}>×</button>
      </div>
      <div class="modal-body">
        <form class="alert-form" onsubmit={addAlert}>
          <select bind:value={alertOp} aria-label="Condition">
            <option value="above">above</option>
            <option value="below">below</option>
          </select>
          <input bind:value={alertPrice} inputmode="decimal" placeholder={formatPrice(latestPrice)} aria-label="Price" />
          <select bind:value={alertTier} aria-label="Tier">
            <option value="FLASH">FLASH</option>
            <option value="PRIORITY">PRIORITY</option>
            <option value="ROUTINE">ROUTINE</option>
          </select>
          <button class="primary" type="submit">Arm</button>
        </form>
        {#if !notifyReady}
          <p class="auth-note">Arming an alert will ask for browser-notification permission so you get pinged off-screen.</p>
        {/if}
        <div class="alert-list">
          {#each $alerts as alert (alert.id)}
            <div class="alert-row" class:done={alert.triggered}>
              <span class="alert-tier {alert.tier.toLowerCase()}">{alert.tier}</span>
              <b>{alert.symbol} {alert.op} {formatPrice(alert.price)}</b>
              <em>{alert.triggered ? "triggered" : "armed"}</em>
              <button class="row-action" type="button" onclick={() => alertsStore.remove(alert.id)}>Remove</button>
            </div>
          {:else}
            <div class="empty">No alerts armed. Add a price trigger above.</div>
          {/each}
        </div>
        {#if $alertLog.length > 0}
          <div class="venue-section">Fired</div>
          <div class="alert-list">
            {#each $alertLog.slice(0, 10) as fired (fired.ts)}
              <div class="alert-row done">
                <span class="mono alert-when">{new Date(fired.ts).toISOString().slice(5, 16).replace("T", " ")}Z</span>
                <b>{fired.title}</b>
                <em>{fired.body}</em>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>
{/if}

<style>
  .alert-form {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: 0.4rem;
    align-items: center;
  }

  .alert-list {
    display: grid;
    gap: 0.3rem;
  }

  .alert-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 0;
    background: rgba(255, 255, 255, 0.02);
    font-size: 0.78rem;
  }

  .alert-row.done {
    opacity: 0.55;
  }

  .alert-row em {
    color: var(--muted);
    font-size: 0.68rem;
  }

  .alert-tier {
    border-radius: 0;
    padding: 0.1rem 0.45rem;
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.04em;
  }

  .alert-tier.flash {
    color: var(--red);
    background: rgba(240, 107, 99, 0.14);
  }

  .alert-tier.priority {
    color: var(--amber);
    background: rgba(228, 173, 79, 0.14);
  }

  .alert-tier.routine {
    color: var(--muted);
    background: var(--surface-2);
  }

  .alert-when { color: var(--faint); font-size: 0.62rem; }
</style>
