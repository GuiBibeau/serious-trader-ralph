// Vercel-cron endpoint: LLM moderation sweep. Fetches new messages per
// text channel (cursor-based, via blob state), sends ONE batched DeepSeek
// classification call, deletes high-confidence phishing/spam, and flags
// borderline cases to the modlog channel. All decisions (eligibility,
// parsing, the confidence matrix, embeds) live in $lib/mod-sweep — pure and
// unit-tested; this handler wires auth, Discord I/O, the LLM, and state.

import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import type { DiscordEmbed } from "$lib/market-moves";
import {
  buildDeletedEmbed,
  buildFlaggedEmbed,
  buildModerationUserPrompt,
  type Classification,
  classifiableMessages,
  decideAction,
  decideCursorAdvances,
  eligibleChannels,
  MODERATION_SYSTEM_PROMPT,
  maxSnowflake,
  parseClassifications,
  parseFailureNote,
  parseModState,
  type SweepMessage,
  snowflakeForTimestamp,
  surrenderNote,
} from "$lib/mod-sweep";
import * as discord from "$lib/server/discord";
import type { RequestHandler } from "./$types";

const STATE_PATH = "discord-ops/mod-state.json";
const MAX_EMBEDS_PER_POST = 10; // Discord's per-message embed cap

export const GET: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });

  // Fail closed — same contract as /api/cron/market-moves.
  const secret = String(env.CRON_SECRET ?? "").trim();
  if (!secret) return json({ skipped: "unconfigured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ reason: "unauthorized" }, { status: 401 });
  }

  const guildId = String(env.DISCORD_GUILD_ID ?? "").trim();
  const modlogChannelId = String(env.DISCORD_MODLOG_CHANNEL_ID ?? "").trim();
  const marketChannelId = String(env.DISCORD_MARKET_CHANNEL_ID ?? "").trim();
  if (!guildId || !modlogChannelId || !discord.hasBotToken()) {
    return json({ skipped: "discord-unconfigured" });
  }
  // Checked before any Discord call: a sweep that cannot classify must not
  // touch cursors (never skip-classify a window).
  const deepseekKey = String(env.DEEPSEEK_API_KEY ?? "").trim();
  if (!deepseekKey) return json({ skipped: "llm-unavailable" });

  // Cursor state is load-bearing: without it, every run would re-baseline
  // channels and re-flag the same messages to the modlog. Skip when blind.
  const stateRead = await discord.readOpsState(STATE_PATH);
  if (stateRead.status === "unavailable") {
    return json({ skipped: "state-unavailable" });
  }
  const state = parseModState(
    stateRead.status === "ok" ? stateRead.value : null,
  );

  const channels = await discord.listGuildTextChannels();
  if (channels === null) return json({ skipped: "discord-unavailable" });
  const targets = eligibleChannels(channels, [
    marketChannelId,
    modlogChannelId,
  ]);
  const namesById = new Map(
    targets.map((channel) => [channel.id, channel.name]),
  );

  const now = Date.now();
  const nextCursors: Record<string, string> = { ...state.cursors };
  // Cursor advances for swept windows are held apart from first-sighting
  // baselines: baselines always persist, window advances only persist once
  // that window's batch was actually classified.
  const pendingAdvance = new Map<string, string>();
  const batch: SweepMessage[] = [];

  for (const channel of targets) {
    const cursor = state.cursors[channel.id];
    if (!cursor) {
      // First sighting of a channel: baseline the cursor to its newest
      // message WITHOUT classifying anything — retroactive sweeps punish
      // old messages under rules that did not exist when they were sent.
      const newest = await discord.fetchChannelMessages(channel.id, {
        limit: 1,
      });
      if (newest === null) continue; // fetch failed; try again next run
      // Empty channel: synthesize a "now" snowflake so only future
      // messages are ever swept.
      nextCursors[channel.id] = newest[0]?.id ?? snowflakeForTimestamp(now);
      continue;
    }

    const messages = await discord.fetchChannelMessages(channel.id, {
      after: cursor,
      limit: 100,
    });
    if (messages === null || messages.length === 0) continue;
    // The window advances past EVERYTHING fetched, including bot/system
    // messages — those are skipped by policy, not left unclassified.
    const advanced = maxSnowflake(messages.map((item) => item.id));
    if (advanced) pendingAdvance.set(channel.id, advanced);
    for (const item of messages) {
      batch.push({
        id: item.id,
        channelId: channel.id,
        channelName: namesById.get(channel.id) ?? channel.name,
        authorId: item.authorId,
        authorTag: item.authorTag,
        authorIsBot: item.authorIsBot,
        content: item.content,
        type: item.type,
      });
    }
  }

  const classifiable = classifiableMessages(batch);
  const modlogEmbeds: DiscordEmbed[] = [];
  let byId = new Map<string, Classification>();
  let parseNote: string | null = null;
  let deleted = 0;
  let flagged = 0;
  let deleteFailures = 0;

  if (classifiable.length > 0) {
    const raw = await classifyBatch(deepseekKey, classifiable);
    if (raw === null) {
      // LLM down mid-run: none of the fetched windows were classified, so
      // none of their cursors advance — the same window is retried next
      // run. First-sighting baselines still persist (they classify nothing
      // by design either way). This is an outage, not a parse hold, so the
      // per-channel retry counters carry through unchanged.
      await discord.writeOpsState(STATE_PATH, {
        cursors: nextCursors,
        parseRetries: state.parseRetries,
      });
      return json({ skipped: "llm-unavailable" });
    }

    const parsed = parseClassifications(
      raw,
      classifiable.map((item) => item.id),
    );
    byId = parsed.byId;
    if (parsed.parseFailure) parseNote = parseFailureNote(parsed.parseFailure);

    for (const item of classifiable) {
      const classification = byId.get(item.id);
      const action = decideAction(classification);
      if (action === "none" || !classification) continue;
      if (action === "delete") {
        const ok = await discord.deleteChannelMessage(item.channelId, item.id);
        if (ok) {
          deleted += 1;
        } else {
          deleteFailures += 1;
        }
        // Delete failures (missing Manage Messages) still get logged, with
        // an explicit call to action in the embed.
        modlogEmbeds.push(buildDeletedEmbed(item, classification, ok, now));
      } else {
        flagged += 1;
        modlogEmbeds.push(
          buildFlaggedEmbed(item, classification, guildId, now),
        );
      }
    }
  }

  // Only fully classified windows advance. A window with unclassified
  // messages is held (bounded — see decideCursorAdvances) so those messages
  // are refetched and retried next run; already-actioned messages in a held
  // window may be re-flagged on retry — a duplicate modlog line beats an
  // unmoderated message. Retries exhausted → advance anyway, with an honest
  // surrender note below.
  const decision = decideCursorAdvances(
    [...pendingAdvance.keys()],
    classifiable,
    new Set(byId.keys()),
    state.parseRetries,
  );
  for (const channelId of [...decision.advance, ...decision.surrendered]) {
    const cursor = pendingAdvance.get(channelId);
    if (cursor) nextCursors[channelId] = cursor;
  }
  const persisted = await discord.writeOpsState(STATE_PATH, {
    cursors: nextCursors,
    parseRetries: decision.nextRetries,
  });

  for (let i = 0; i < modlogEmbeds.length; i += MAX_EMBEDS_PER_POST) {
    await discord.postChannelMessage(modlogChannelId, {
      embeds: modlogEmbeds.slice(i, i + MAX_EMBEDS_PER_POST),
    });
  }
  if (parseNote) {
    await discord.postChannelMessage(modlogChannelId, { content: parseNote });
  }
  if (decision.surrendered.length > 0) {
    await discord.postChannelMessage(modlogChannelId, {
      content: surrenderNote(
        decision.surrendered.map((id) => `#${namesById.get(id) ?? id}`),
      ),
    });
  }

  return json({
    ok: true,
    channels: targets.length,
    scanned: batch.length,
    classified: classifiable.length,
    deleted,
    deleteFailures,
    flagged,
    heldChannels: decision.held.length,
    surrenderedChannels: decision.surrendered.length,
    statePersisted: persisted,
  });
};

// One batched DeepSeek call per run, JSON mode; same client shape as
// /api/desk. Temperature 0 — classification, not prose. null = unavailable.
async function classifyBatch(
  apiKey: string,
  messages: SweepMessage[],
): Promise<string | null> {
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0,
        max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: MODERATION_SYSTEM_PROMPT },
          { role: "user", content: buildModerationUserPrompt(messages) },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
}
