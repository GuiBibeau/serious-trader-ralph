// Vercel-cron endpoint: tiered market-move alerts to the Discord market
// channel. All tier/dedup/embed decisions live in $lib/market-moves (pure,
// unit-tested); this handler only wires auth, the catalog, blob state, and
// the Discord post together. Every skip is an explicit reason — we never
// post partial or invented data.

import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import {
  buildMoveEmbeds,
  computeAlerts,
  parseMarketState,
} from "$lib/market-moves";
import * as discord from "$lib/server/discord";
import { type CatalogAsset, getCatalog } from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

const STATE_PATH = "discord-ops/market-state.json";

export const GET: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });

  // Fail closed: without a configured CRON_SECRET there is no way to tell
  // Vercel's scheduler from a random caller, and an unauthenticated caller
  // must never be able to trigger posts.
  const secret = String(env.CRON_SECRET ?? "").trim();
  if (!secret) return json({ skipped: "unconfigured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ reason: "unauthorized" }, { status: 401 });
  }

  const channelId = String(env.DISCORD_MARKET_CHANNEL_ID ?? "").trim();
  if (!channelId || !discord.hasBotToken()) {
    return json({ skipped: "discord-unconfigured" });
  }

  // State first: the blob carries the dedup marks and fast-tier snapshots.
  // Without it we cannot know what already posted today, and re-alerting
  // every 5 minutes is duplicate spam — so no state means no posting.
  const stateRead = await discord.readOpsState(STATE_PATH);
  if (stateRead.status === "unavailable") {
    return json({ skipped: "state-unavailable" });
  }
  const prev = parseMarketState(
    stateRead.status === "ok" ? stateRead.value : null,
  );

  let catalog: CatalogAsset[];
  try {
    catalog = await getCatalog();
  } catch {
    return json({ skipped: "catalog-unavailable" });
  }

  const now = Date.now();
  const { alerts, next } = computeAlerts(
    catalog.map((asset) => ({
      assetId: asset.assetId,
      symbol: asset.symbol,
      price: asset.price,
      change24hPct: asset.change24hPct,
    })),
    prev,
    now,
  );

  // Persist the dedup marks BEFORE posting: if this write fails we skip the
  // post entirely. A missed alert self-heals (the next qualifying run posts);
  // posting without durable dedup would repeat the alert every 5 minutes.
  const persisted = await discord.writeOpsState(STATE_PATH, next);
  if (!persisted) return json({ skipped: "state-unavailable" });

  if (alerts.length === 0) return json({ ok: true, alerts: 0, posted: 0 });

  const posted = await discord.postChannelMessage(channelId, {
    embeds: buildMoveEmbeds(alerts, now),
  });
  // Honest report either way: the dedup marks are already written, so a
  // failed post is a dropped alert for the day, not a retry loop.
  return json({
    ok: posted,
    alerts: alerts.length,
    posted: posted ? alerts.length : 0,
  });
};
