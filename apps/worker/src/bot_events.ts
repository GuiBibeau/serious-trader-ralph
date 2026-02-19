import type { Env } from "./types";

export type BotLogEvent = {
  ts: string;
  level: string;
  message: string;
  runId: string | null;
  reason: string | null;
  details: Record<string, unknown>;
};

export type BotEventQuery = {
  tenantId: string;
  limit?: number;
};

function parseLogEventLine(line: string): BotLogEvent | null {
  if (!line.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const row = parsed as Record<string, unknown>;
  const ts = typeof row.ts === "string" ? row.ts : "";
  const level = typeof row.level === "string" ? row.level : "info";
  const message = typeof row.message === "string" ? row.message : "";
  if (!ts || !message) return null;

  const runId = typeof row.runId === "string" ? row.runId : null;
  const reason = typeof row.reason === "string" ? row.reason : null;
  const details: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (
      key === "ts" ||
      key === "level" ||
      key === "message" ||
      key === "runId" ||
      key === "reason"
    ) {
      continue;
    }
    details[key] = value;
  }

  return {
    ts,
    level,
    message,
    runId,
    reason,
    details,
  };
}

function eventTsMs(value: BotLogEvent): number {
  const ms = Date.parse(value.ts);
  return Number.isFinite(ms) ? ms : 0;
}

export async function listRecentBotEvents(
  env: Env,
  input: BotEventQuery,
): Promise<BotLogEvent[]> {
  if (!env.LOGS_BUCKET) return [];

  const limit = Math.max(1, Math.min(240, Math.floor(input.limit ?? 40)));
  const prefix = `logs/${input.tenantId}/`;
  const objects: R2Object[] = [];
  let cursor: string | undefined;

  for (let i = 0; i < 6; i += 1) {
    const listed = await env.LOGS_BUCKET.list({
      prefix,
      cursor,
      limit: 120,
    });
    objects.push(...listed.objects);
    if (!listed.truncated || !listed.cursor) break;
    cursor = listed.cursor;
  }

  objects.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime());
  const newestObjects = objects.slice(0, 8);
  const events: BotLogEvent[] = [];

  for (const obj of newestObjects) {
    const body = await env.LOGS_BUCKET.get(obj.key);
    if (!body) continue;
    const text = await body.text();
    for (const line of text.split(/\r?\n/)) {
      const event = parseLogEventLine(line);
      if (event) events.push(event);
    }
  }

  events.sort((a, b) => eventTsMs(b) - eventTsMs(a));
  return events.slice(0, limit);
}
