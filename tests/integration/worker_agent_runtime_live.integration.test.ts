import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readLiveEnv,
  requireLiveEnv,
  runWorkerLiveIntegration,
} from "./_worker_live_test_utils";

const hasAdminToken = Boolean(readLiveEnv("ADMIN_TOKEN", ""));
const integrationTest =
  runWorkerLiveIntegration && hasAdminToken ? test : test.skip;

const DEFAULT_WORKER_BASE_URL = "http://127.0.0.1:8888";
const DEFAULT_STATE_RELATIVE_PATH = "apps/worker/.wrangler/state";
const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 120_000;
const MAX_START_ATTEMPTS = 3;

type R2ObjectRow = {
  key: string;
  blobId: string;
  uploaded: number;
};

type LogLine = {
  ts?: string;
  level?: string;
  message?: string;
  runId?: string;
  [key: string]: unknown;
};

function resolveRepoRoot(): string {
  return path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

function resolveWorkerBaseUrl(): string {
  const raw = readLiveEnv("WORKER_LIVE_BASE_URL", DEFAULT_WORKER_BASE_URL);
  return raw.replace(/\/+$/, "");
}

function resolveWorkerStateRoot(): string {
  const explicit = readLiveEnv("WORKER_LIVE_STATE_DIR", "");
  if (explicit) {
    return path.resolve(resolveRepoRoot(), explicit);
  }
  return path.resolve(resolveRepoRoot(), DEFAULT_STATE_RELATIVE_PATH);
}

function latestSqliteFile(dirPath: string): string {
  if (!existsSync(dirPath)) {
    throw new Error(`missing-worker-state-dir:${dirPath}`);
  }

  const sqliteFiles = readdirSync(dirPath)
    .filter((name) => name.endsWith(".sqlite"))
    .map((name) => path.join(dirPath, name));

  if (sqliteFiles.length < 1) {
    throw new Error(`missing-sqlite-file:${dirPath}`);
  }

  sqliteFiles.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const newest = sqliteFiles[0];
  if (!newest) {
    throw new Error(`missing-sqlite-file:${dirPath}`);
  }
  return newest;
}

function resolveLocalBotId(stateRoot: string): string {
  const explicit = readLiveEnv("WORKER_LIVE_BOT_ID", "");
  if (explicit) return explicit;

  const d1Dir = path.join(stateRoot, "v3", "d1", "miniflare-D1DatabaseObject");
  const sqlitePath = latestSqliteFile(d1Dir);
  const db = new Database(sqlitePath, { readonly: true });

  try {
    const enabledRow = db
      .query(
        "SELECT id FROM bots WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 1",
      )
      .get() as { id?: unknown } | null;

    if (enabledRow?.id) return String(enabledRow.id);

    const fallbackRow = db
      .query("SELECT id FROM bots ORDER BY updated_at DESC LIMIT 1")
      .get() as { id?: unknown } | null;

    if (fallbackRow?.id) return String(fallbackRow.id);
  } finally {
    db.close();
  }

  throw new Error(
    "missing-live-bot-id: set WORKER_LIVE_BOT_ID or create at least one bot in local worker state",
  );
}

function resolveR2IndexDbPath(stateRoot: string): string {
  const indexDir = path.join(stateRoot, "v3", "r2", "miniflare-R2BucketObject");
  return latestSqliteFile(indexDir);
}

function resolveR2BlobRoots(stateRoot: string): string[] {
  const explicit = readLiveEnv("WORKER_LIVE_LOGS_BLOBS_DIR", "");
  if (explicit) {
    const absolute = path.resolve(resolveRepoRoot(), explicit);
    if (existsSync(absolute)) return [absolute];
  }

  const roots: string[] = [];
  const configuredBucket = readLiveEnv("WORKER_LIVE_LOGS_BUCKET", "");
  if (configuredBucket) {
    const configuredPath = path.join(
      stateRoot,
      "v3",
      "r2",
      configuredBucket,
      "blobs",
    );
    if (existsSync(configuredPath)) roots.push(configuredPath);
  }

  const r2Root = path.join(stateRoot, "v3", "r2");
  if (!existsSync(r2Root)) {
    throw new Error(`missing-r2-state-root:${r2Root}`);
  }

  for (const entry of readdirSync(r2Root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "miniflare-R2BucketObject") continue;
    const blobsPath = path.join(r2Root, entry.name, "blobs");
    if (existsSync(blobsPath) && !roots.includes(blobsPath)) {
      roots.push(blobsPath);
    }
  }

  if (roots.length < 1) {
    throw new Error(`missing-r2-blobs-dir:${r2Root}`);
  }

  return roots;
}

function listBotLogObjects(indexDbPath: string, botId: string): R2ObjectRow[] {
  const db = new Database(indexDbPath, { readonly: true });
  try {
    const rows = db
      .query(
        `
        SELECT
          key,
          blob_id as blobId,
          uploaded
        FROM _mf_objects
        WHERE key LIKE ?1
        ORDER BY uploaded DESC
        LIMIT 500
        `,
      )
      .all(`logs/${botId}/%`) as Array<{
      key?: unknown;
      blobId?: unknown;
      uploaded?: unknown;
    }>;

    return rows
      .map((row) => ({
        key: String(row.key ?? ""),
        blobId: String(row.blobId ?? ""),
        uploaded: Number(row.uploaded ?? 0),
      }))
      .filter((row) => row.key && row.blobId);
  } finally {
    db.close();
  }
}

function resolveBlobPath(blobRoots: string[], blobId: string): string | null {
  for (const root of blobRoots) {
    const candidate = path.join(root, blobId);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function parseJsonLines(text: string): LogLine[] {
  const rows: LogLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as LogLine;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        rows.push(parsed);
      }
    } catch {}
  }
  return rows;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function triggerAdminStart(input: {
  baseUrl: string;
  botId: string;
  adminToken: string;
  attempt: number;
}): Promise<void> {
  const { baseUrl, botId, adminToken, attempt } = input;
  let response: Response | null = null;
  let lastFetchError: unknown = null;
  for (let i = 0; i < 4; i += 1) {
    try {
      response = await fetch(`${baseUrl}/api/admin/bots/${botId}/start`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          overrideValidation: true,
          reason: `integration-live-loop-attempt-${attempt}`,
        }),
      });
      break;
    } catch (error) {
      lastFetchError = error;
      if (i < 3) await sleep(400 * (i + 1));
    }
  }
  if (!response) {
    throw new Error(
      `worker-unreachable:${baseUrl}:${lastFetchError instanceof Error ? lastFetchError.message : String(lastFetchError)}`,
    );
  }

  let payload: { ok?: boolean; error?: string } | null = null;
  try {
    payload = (await response.json()) as { ok?: boolean; error?: string };
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    const error = payload?.error ?? "admin-start-failed";
    throw new Error(`admin-start-failed:${response.status}:${error}`);
  }
}

async function waitForNextRunLog(input: {
  indexDbPath: string;
  blobRoots: string[];
  baselineKeys: Set<string>;
  botId: string;
  timeoutMs: number;
}): Promise<{ key: string; events: LogLine[] }> {
  const deadline = Date.now() + input.timeoutMs;

  while (Date.now() < deadline) {
    const objects = listBotLogObjects(input.indexDbPath, input.botId);
    const candidates = objects.filter(
      (row) => !input.baselineKeys.has(row.key),
    );

    for (const row of candidates) {
      const blobPath = resolveBlobPath(input.blobRoots, row.blobId);
      if (!blobPath) continue;
      const raw = readFileSync(blobPath, "utf8");
      const events = parseJsonLines(raw);
      if (events.length > 0) {
        return { key: row.key, events };
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("timed-out-waiting-for-new-run-log");
}

integrationTest(
  "worker live loop run reaches agent and executes tool calls",
  async () => {
    const adminToken = requireLiveEnv("ADMIN_TOKEN");
    const baseUrl = resolveWorkerBaseUrl();
    const stateRoot = resolveWorkerStateRoot();
    const botId = resolveLocalBotId(stateRoot);
    const indexDbPath = resolveR2IndexDbPath(stateRoot);
    const blobRoots = resolveR2BlobRoots(stateRoot);

    let lastEvents: LogLine[] = [];

    for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt += 1) {
      const baselineKeys = new Set(
        listBotLogObjects(indexDbPath, botId).map((row) => row.key),
      );

      await triggerAdminStart({
        baseUrl,
        botId,
        adminToken,
        attempt,
      });

      const nextRun = await waitForNextRunLog({
        indexDbPath,
        blobRoots,
        baselineKeys,
        botId,
        timeoutMs: POLL_TIMEOUT_MS,
      });

      lastEvents = nextRun.events;
      const messages = lastEvents
        .map((row) => String(row.message ?? "").trim())
        .filter(Boolean);

      const toolCalls = lastEvents.filter(
        (row) => String(row.message ?? "") === "agent tool call",
      );
      if (toolCalls.length < 1) {
        // Some runs can terminate early (timeouts/guard rails). Retry a few times.
        continue;
      }

      expect(messages).toContain("tick start");
      expect(messages).toContain("agent tick start");
      expect(messages).toContain("agent tick end");
      expect(messages).toContain("agent tool batch start");

      const toolNames = toolCalls
        .map((row) => String(row.name ?? "").trim())
        .filter(Boolean);
      expect(toolNames.length).toBeGreaterThan(0);

      const parallelBatch = lastEvents.find(
        (row) =>
          String(row.message ?? "") === "agent tool batch start" &&
          String(row.mode ?? "") === "parallel",
      );
      expect(Boolean(parallelBatch)).toBe(true);

      return;
    }

    const lastMessages = lastEvents
      .map((row) => String(row.message ?? "").trim())
      .filter(Boolean)
      .slice(-12)
      .join(" | ");

    throw new Error(
      `no-tool-call-observed-after-${MAX_START_ATTEMPTS}-attempts:last-messages=${lastMessages || "none"}`,
    );
  },
  420_000,
);
