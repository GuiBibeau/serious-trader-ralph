<script lang="ts">
  import type { AiRead } from "$lib/ai";
  import { journalToCsv, type JournalEntry } from "$lib/journal";
  import { panelStyle, usePanelLayout } from "$lib/terminal/layout";
  import {
    formatTimeHmInZone,
    type DisplayTimezoneId,
  } from "$lib/terminal/display-timezone";
  import { formatNumber } from "$lib/utils";
  import AiReadLine from "./AiReadLine.svelte";
  import DragHead from "./DragHead.svelte";

  let {
    journalEntries,
    journalToday,
    recapRead,
    sessionPnlUsd,
    displayTimezone = "UTC",
    onwipe,
  }: {
    journalEntries: JournalEntry[];
    journalToday: JournalEntry[];
    recapRead: AiRead;
    /** Day P&L from the equity baseline — null when no wallet/history. */
    sessionPnlUsd: number | null;
    displayTimezone?: DisplayTimezoneId;
    // Wiping resets page-owned state too (entries source + recap AI state),
    // so the clear action stays a page callback.
    onwipe: () => void;
  } = $props();

  const {
    panelOrder,
    draggedPanel,
    dragOverPanel,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  } = usePanelLayout();

  function exportJournalCsv(): void {
    const blob = new Blob([journalToCsv(journalEntries)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "harness-journal.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
</script>

<section
  class="panel watchlist-panel"
  role="group"
  data-panel="journal"
  style={panelStyle("journal", $panelOrder)}
  class:dragging={$draggedPanel === "journal"}
  class:drag-over={$dragOverPanel === "journal"}
  ondragover={(event) => onPanelDragOver(event, "journal")}
  ondragleave={() => onPanelDragLeave("journal")}
  ondrop={(event) => onPanelDrop(event, "journal")}
>
  <div class="panel-head">
    <DragHead panelId="journal" kicker="JOURNAL" title={`${journalToday.length} today · ${journalEntries.length} total`} />
    {#if journalEntries.length > 0}
      <button class="row-action" type="button" onclick={exportJournalCsv}>CSV</button>
      <button class="row-action" type="button" onclick={onwipe}>Clear</button>
    {/if}
  </div>
  <!-- Session strip: honest numbers only — trade count and notional come
       from the journal; day P&L from the equity baseline. Win rates wait
       for a real fills feed. -->
  <div class="session-strip">
    <span>Trades <b>{journalToday.length}</b></span>
    <span>
      Notional
      <b>
        ${formatNumber(
          journalToday.reduce((sum, entry) => sum + (entry.notionalUsd ?? 0), 0),
          0,
        )}
      </b>
    </span>
    {#if sessionPnlUsd !== null}
      <span class={sessionPnlUsd >= 0 ? "up" : "down"}>
        Day P&L <b>{sessionPnlUsd >= 0 ? "+" : "-"}${formatNumber(Math.abs(sessionPnlUsd), 2)}</b>
      </span>
    {/if}
  </div>
  {#if journalToday.length >= 2}
    <AiReadLine read={recapRead} />
  {/if}
  <div class="journal-list">
    {#each [...journalEntries].reverse().slice(0, 12) as entry (entry.ts)}
      <div class="journal-row">
        <span class="journal-time">{formatTimeHmInZone(entry.ts, displayTimezone)}</span>
        <span
          class="journal-action"
          class:positive={entry.action === "buy" || entry.action === "long" || entry.action === "limit-buy"}
          class:negative={entry.action === "sell" || entry.action === "short" || entry.action === "limit-sell"}
        >{entry.action.toUpperCase()}</span>
        <span class="journal-mode" class:live={entry.mode === "live"} class:paper={entry.mode === "paper"}>
          {entry.mode === "live" ? "LIVE" : entry.mode === "paper" ? "PAPER" : "LEGACY"}
        </span>
        <span class="journal-sym">{entry.symbol}</span>
        <b>{entry.notionalUsd !== null ? `$${formatNumber(entry.notionalUsd, 0)}` : "--"}{entry.leverage ? ` · ${entry.leverage}x` : ""}</b>
        {#if entry.mode === "live" && entry.signature}
          <a
            class="journal-tx"
            href={`https://solscan.io/tx/${entry.signature}`}
            target="_blank"
            rel="noopener noreferrer"
          >tx</a>
        {:else if entry.signature}
          <span class="journal-ref" title={entry.signature}>ref</span>
        {/if}
      </div>
    {:else}
      <div class="empty">Orders you place are logged here, locally.</div>
    {/each}
  </div>
</section>

<style>
  .session-strip {
    display: flex;
    gap: 0.9rem;
    padding: 0.35rem 0;
    font-size: 0.72rem;
    color: var(--muted);
    border-bottom: 1px solid var(--line-soft);
  }
  .session-strip b {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .session-strip .up b { color: var(--up); }
  .session-strip .down b { color: var(--down); }
  .journal-list { display: grid; }
  .journal-row {
    display: grid;
    grid-template-columns: 2.6rem 3.6rem auto minmax(0, 1fr) auto auto;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.32rem 0;
    border-bottom: 1px solid var(--line-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }
  .journal-row:last-child { border-bottom: 0; }
  .journal-time { color: var(--faint); }
  .journal-action { font-weight: 700; }
  .journal-mode {
    color: var(--faint);
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.03em;
  }
  .journal-mode.live { color: var(--up); }
  .journal-mode.paper { color: var(--amber); }
  .journal-sym { color: var(--ink); }
  .journal-row b { font-weight: 500; color: var(--muted); }
  .journal-tx { color: var(--accent); font-size: 0.66rem; text-decoration: none; }
  .journal-ref { color: var(--faint); font-size: 0.66rem; }
</style>
