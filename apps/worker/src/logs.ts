import type { Env } from "./types";

export async function appendLog(env: Env, key: string, line: string) {
  const existing = await env.LOGS_BUCKET.get(key);
  const prefix = existing ? await existing.text() : "";
  const body = prefix ? `${prefix}\n${line}` : line;
  await env.LOGS_BUCKET.put(key, body, {
    httpMetadata: { contentType: "application/json" },
  });
}

export function makeLogKey(tenantId: string, date = new Date()) {
  const iso = date.toISOString().slice(0, 10);
  return `logs/${tenantId}/${iso}.jsonl`;
}
