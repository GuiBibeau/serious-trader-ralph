// Spot ticket STATE + the Jupiter quote engine (debounce + generation
// tokens). The page owns the money paths (executeSpotSwap /
// submitSpotLimitOrder via the shared signing pipeline) and the spot asset
// selection (venue-switch spine) — this module reads the asset through a
// live getter and owns the four user-editable fields plus the quote
// lifecycle. Quote state is exposed as writables because the page's submit
// paths drive the post-trade transitions (error surfacing, re-arm).
import { get, writable } from "svelte/store";
import {
  getSpotQuote,
  type SpotAsset,
  type SpotQuote,
  tokenToAtoms,
  USDC_MINT,
  usdcToAtoms,
} from "$lib/spot";
import { fmtTriggerPrice } from "./trade-math";

export type SpotSide = "buy" | "sell";
export type SpotOrderType = "market" | "limit";
export type SpotQuoteStatus = "idle" | "quoting" | "quoted" | "error";

export type SpotTicketOptions = {
  /** Live view of the page's selected spot asset (venue-switch spine). */
  getAsset: () => SpotAsset | null;
  /**
   * Fired whenever a (re)quote invalidates prior pricing — the page clears
   * its last-swap signature here so a stale "view tx" line never sits next
   * to fresh quote state.
   */
  onQuoteInvalidated?: () => void;
  /** Test seam; defaults to the real Jupiter quote fetcher. */
  fetchQuote?: typeof getSpotQuote;
};

export function createSpotTicket(options: SpotTicketOptions) {
  const fetchQuote = options.fetchQuote ?? getSpotQuote;

  const spotSide = writable<SpotSide>("buy");
  const spotAmount = writable("25");
  const spotOrderType = writable<SpotOrderType>("market");
  const spotLimitPrice = writable("");
  // Meme execution preset: 50 bps default; volatile pairs need 1–5%.
  const spotSlippageBps = writable(50);
  const spotQuote = writable<SpotQuote | null>(null);
  const spotQuoteStatus = writable<SpotQuoteStatus>("idle");
  const spotQuoteError = writable("");

  let quoteTimer: ReturnType<typeof setTimeout> | null = null;
  // Generation token: invalidates in-flight quote responses when the user
  // changes asset/side/amount (out-of-order fetch protection).
  let quoteSeq = 0;
  let quotedAt = 0;

  function scheduleQuote(): void {
    if (quoteTimer) clearTimeout(quoteTimer);
    // Bumping the sequence invalidates any in-flight quote — covers every
    // mutation path (amount edits, side flips, asset switches).
    quoteSeq += 1;
    const seq = quoteSeq;
    options.onQuoteInvalidated?.();
    const amount = Number(get(spotAmount));
    if (!options.getAsset() || !Number.isFinite(amount) || amount <= 0) {
      spotQuote.set(null);
      spotQuoteStatus.set("idle");
      return;
    }
    spotQuoteStatus.set("quoting");
    quoteTimer = setTimeout(() => void runQuote(seq), 450);
  }

  async function runQuote(seq: number): Promise<void> {
    const asset = options.getAsset();
    const amount = Number(get(spotAmount));
    if (!asset || !Number.isFinite(amount) || amount <= 0) return;
    try {
      const quote =
        get(spotSide) === "buy"
          ? await fetchQuote(
              USDC_MINT,
              asset.mint,
              usdcToAtoms(amount),
              asset.decimals,
              get(spotSlippageBps),
            )
          : await fetchQuote(
              asset.mint,
              USDC_MINT,
              tokenToAtoms(amount, asset.decimals),
              6,
              get(spotSlippageBps),
            );
      if (seq !== quoteSeq) return; // stale response — newer request owns state
      spotQuote.set(quote);
      spotQuoteStatus.set("quoted");
      quotedAt = Date.now();
      // Quotes go stale: auto-requote so displayed pricing stays honest.
      quoteTimer = setTimeout(() => scheduleQuote(), 20_000);
    } catch (error) {
      if (seq !== quoteSeq) return;
      spotQuoteStatus.set("error");
      spotQuoteError.set(
        error instanceof Error ? error.message : "quote-failed",
      );
    }
  }

  // ── Spot side flip ─────────────────────────────────────────────────
  // spotAmount means USDC-spent on buy but tokens-sold on sell; flipping
  // the side without converting turns a $25 buy into a 25-token sell one
  // keypress later. Convert through the asset price so the ticket keeps
  // the same economic size. Every flip path (buttons + B/S hotkeys) goes
  // through here.
  function flipSide(side: SpotSide): void {
    if (side !== get(spotSide)) {
      const amount = Number(get(spotAmount));
      const price = options.getAsset()?.price;
      if (price && price > 0 && Number.isFinite(amount) && amount > 0) {
        spotAmount.set(
          fmtTriggerPrice(side === "sell" ? amount / price : amount * price),
        );
      }
      spotSide.set(side);
    }
    scheduleQuote();
  }

  // Post-swap success path: a late in-flight quote must not re-arm the
  // button, so bump the sequence while clearing the used quote.
  function invalidateQuote(): void {
    quoteSeq += 1;
    spotQuote.set(null);
    spotQuoteStatus.set("idle");
  }

  /** When the current quote was received (0 = never) — freshness gate. */
  function quotedAtMs(): number {
    return quotedAt;
  }

  function dispose(): void {
    if (quoteTimer) clearTimeout(quoteTimer);
  }

  return {
    spotSide,
    spotAmount,
    spotSlippageBps,
    spotOrderType,
    spotLimitPrice,
    spotQuote,
    spotQuoteStatus,
    spotQuoteError,
    scheduleQuote,
    flipSide,
    invalidateQuote,
    quotedAtMs,
    dispose,
  };
}

export type SpotTicket = ReturnType<typeof createSpotTicket>;
