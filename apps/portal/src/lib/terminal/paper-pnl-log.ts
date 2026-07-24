import { browser, dev } from "$app/environment";

export const PAPER_PNL_LOG_INTERVAL_MS = 30 * 60 * 1000;

export type PaperPnlPositionSnap = {
  symbol: string;
  size: number;
  entry: number | null;
  upnl: number | null;
  marginUsd: number | null;
};

export type PaperPnlSnapshot = {
  ts: number;
  reason: string;
  upnlUsd: number;
  equityUsd: number;
  freeCollateralUsd: number;
  positions: PaperPnlPositionSnap[];
};

/** Latest values for the interval callback (avoids stale closures). */
export type PaperPnlSnapRef = {
  paperMode: boolean;
  upnlUsd: number;
  equityUsd: number;
  freeCollateralUsd: number;
  positions: PaperPnlPositionSnap[];
};

export async function postPaperPnlSnapshot(
  snap: PaperPnlSnapshot,
): Promise<boolean> {
  if (!browser || !dev) return false;
  try {
    const res = await fetch("/api/dev/paper-pnl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snap),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function startPaperPnlLogger(
  ref: PaperPnlSnapRef,
  intervalMs = PAPER_PNL_LOG_INTERVAL_MS,
): () => void {
  if (!browser || !dev) return () => {};

  const flush = (reason: string): void => {
    if (!ref.paperMode) return;
    void postPaperPnlSnapshot({
      ts: Date.now(),
      reason,
      upnlUsd: ref.upnlUsd,
      equityUsd: ref.equityUsd,
      freeCollateralUsd: ref.freeCollateralUsd,
      positions: ref.positions,
    });
  };

  // Baseline is posted from the page when PAPER turns on; this timer only
  // handles the recurring 30-minute samples.
  const timer = window.setInterval(() => flush("interval"), intervalMs);
  return () => window.clearInterval(timer);
}
