import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildOpsDashboardMarkdown,
  normalizeRunnerHealth,
  type OpsDashboardSnapshot,
  type PreviewHealthResult,
  parsePreviewCommentBody,
} from "../ops/dashboard.js";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function requireArg(flag: string): string {
  const value = readArg(flag);
  if (!value) {
    throw new Error(`missing-arg:${flag}`);
  }
  return value;
}

function readJsonFile(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

async function fetchJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "serious-trader-ralph-ops-dashboard",
    },
  });
  if (!response.ok) {
    throw new Error(`github-fetch-failed:${response.status}`);
  }
  return (await response.json()) as unknown;
}

async function checkUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function collectPreviewHealth(input: {
  repo: string | null;
  githubToken: string | null;
  apiBase: string;
}): Promise<PreviewHealthResult[]> {
  if (!input.repo || !input.githubToken) return [];
  const [owner, repo] = input.repo.split("/", 2);
  if (!owner || !repo) return [];

  const pulls = (await fetchJson(
    `${input.apiBase}/repos/${owner}/${repo}/pulls?state=open&per_page=30`,
    input.githubToken,
  )) as unknown[];
  const results: PreviewHealthResult[] = [];

  for (const pull of pulls) {
    const prNumber = Number(
      typeof pull === "object" && pull
        ? (pull as Record<string, unknown>).number
        : NaN,
    );
    if (!Number.isFinite(prNumber)) continue;

    const comments = (await fetchJson(
      `${input.apiBase}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
      input.githubToken,
    )) as unknown[];
    const previewComment = comments
      .filter((comment) => typeof comment === "object" && comment)
      .map((comment) => (comment as Record<string, unknown>).body)
      .map((body) => String(body ?? ""))
      .find((body) => body.includes("<!-- pr-preview -->"));
    if (!previewComment) continue;
    const preview = parsePreviewCommentBody(previewComment);
    if (!preview) continue;

    const [portalOk, workerOk] = await Promise.all([
      checkUrl(preview.portalUrl),
      checkUrl(`${preview.workerUrl}/api/health`),
    ]);
    results.push({
      prNumber,
      portalUrl: preview.portalUrl,
      workerUrl: preview.workerUrl,
      workerName: preview.workerName,
      portalOk,
      workerOk,
    });
  }

  return results;
}

async function main(): Promise<void> {
  const executionPath = requireArg("--execution");
  const canaryPath = requireArg("--canary");
  const controlsPath = requireArg("--controls");
  const outputJsonPath = requireArg("--output-json");
  const outputMarkdownPath = requireArg("--output-markdown");
  const runnerHeartbeatPath = readArg("--runner-heartbeat");
  const githubApiBase =
    readArg("--github-api-base") ?? "https://api.github.com";

  const runner =
    runnerHeartbeatPath && existsSync(runnerHeartbeatPath)
      ? normalizeRunnerHealth(readJsonFile(runnerHeartbeatPath))
      : normalizeRunnerHealth(null);
  const previews = await collectPreviewHealth({
    repo: process.env.GITHUB_REPOSITORY ?? null,
    githubToken: process.env.GITHUB_TOKEN ?? null,
    apiBase: githubApiBase,
  });

  const snapshot: OpsDashboardSnapshot = {
    generatedAt: new Date().toISOString(),
    execution: readJsonFile(executionPath),
    canary: readJsonFile(canaryPath),
    controls: readJsonFile(controlsPath),
    previews,
    runner,
  };

  writeFileSync(outputJsonPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(outputMarkdownPath, `${buildOpsDashboardMarkdown(snapshot)}\n`);
}

await main();
