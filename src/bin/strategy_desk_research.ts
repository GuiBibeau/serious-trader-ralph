import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function buildRequestBody(): Record<string, unknown> {
  const requestFile = readArg("--request-file");
  if (requestFile) {
    const payload = readJsonFile(resolve(requestFile));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("strategy-desk-research-invalid-request-file");
    }
    return payload as Record<string, unknown>;
  }

  const prompt = String(readArg("--prompt") ?? "").trim();
  if (!prompt) {
    throw new Error("missing-arg:--prompt");
  }

  const requestedBy =
    String(readArg("--requested-by") ?? process.env.USER ?? "codex").trim() ||
    "codex";
  const runKind =
    readArg("--run-kind") === "shadow"
      ? "shadow"
      : readArg("--run-kind") === "paper"
        ? "paper"
        : undefined;
  const candidateCount = Number(readArg("--candidate-count"));
  const maxRetriesPerLeg = Number(readArg("--max-retries-per-leg"));
  const maxConcurrency = Number(readArg("--max-concurrency"));
  const ownerUserId = String(readArg("--owner-user-id") ?? "").trim();
  const walletAddress = String(readArg("--wallet-address") ?? "").trim();
  const privyWalletId = String(readArg("--privy-wallet-id") ?? "").trim();
  const scenarioPrefix = String(readArg("--scenario-prefix") ?? "").trim();

  return {
    prompt,
    requestedBy,
    ...(runKind ? { runKind } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(walletAddress ? { walletAddress } : {}),
    ...(privyWalletId ? { privyWalletId } : {}),
    ...(scenarioPrefix ? { scenarioPrefix } : {}),
    ...(Number.isFinite(candidateCount)
      ? { candidateCount: Math.max(1, Math.trunc(candidateCount)) }
      : {}),
    ...(Number.isFinite(maxRetriesPerLeg)
      ? { maxRetriesPerLeg: Math.max(0, Math.trunc(maxRetriesPerLeg)) }
      : {}),
    ...(Number.isFinite(maxConcurrency)
      ? { maxConcurrency: Math.max(1, Math.trunc(maxConcurrency)) }
      : {}),
  };
}

async function main(): Promise<void> {
  const baseUrl = readArg("--base-url") ?? "http://127.0.0.1:8888";
  const outputDir = resolve(
    readArg("--output-dir") ?? ".tmp/strategy-desk-research",
  );
  const adminToken =
    readArg("--admin-token") ?? String(process.env.ADMIN_TOKEN ?? "").trim();
  if (!adminToken) {
    throw new Error("missing-admin-token");
  }

  const requestBody = buildRequestBody();
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/admin/ops/runtime/strategy-desk/research`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      String(
        payload.error ?? `strategy-desk-research-failed:${response.status}`,
      ),
    );
  }

  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "research.json");
  const markdownPath = join(outputDir, "summary.md");
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(markdownPath, `${String(payload.markdownSummary ?? "")}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        outputDir,
        jsonPath,
        markdownPath,
      },
      null,
      2,
    ),
  );
}

await main();
