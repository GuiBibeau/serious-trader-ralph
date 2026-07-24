import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { error, json } from "@sveltejs/kit";
import { dev } from "$app/environment";
import type { RequestHandler } from "./$types";

/** Repo-root .logs — Vite cwd is apps/portal. */
function logPath(): string {
  return join(process.cwd(), "..", "..", ".logs", "paper-upnl.jsonl");
}

async function ensureLogDir(): Promise<void> {
  await mkdir(join(process.cwd(), "..", "..", ".logs"), { recursive: true });
}

export const POST: RequestHandler = async ({ request }) => {
  if (!dev) error(404, "Not found");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    error(400, "Expected JSON body");
  }
  if (!body || typeof body !== "object") error(400, "Expected object body");

  const row = {
    ...(body as Record<string, unknown>),
    receivedAt: new Date().toISOString(),
  };
  await ensureLogDir();
  await appendFile(logPath(), `${JSON.stringify(row)}\n`, "utf8");
  return json({ ok: true }, { headers: { "cache-control": "no-store" } });
};

/** Tail recent samples (default 48 ≈ 24h at 30m). */
export const GET: RequestHandler = async ({ url }) => {
  if (!dev) error(404, "Not found");

  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") ?? "48") || 48),
  );
  try {
    const raw = await readFile(logPath(), "utf8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const slice = lines
      .slice(-limit)
      .map((line) => JSON.parse(line) as unknown);
    return json(
      { path: logPath(), count: slice.length, samples: slice },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return json(
      { path: logPath(), count: 0, samples: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }
};
