import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRuntimeResearchBriefRequest } from "../runtime/research/briefs.js";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function readMultiArg(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag) {
      const value = process.argv[index + 1];
      if (!value) {
        throw new Error(`missing-arg:${flag}`);
      }
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

async function main(): Promise<void> {
  const baseUrl = readArg("--base-url") ?? "http://127.0.0.1:8888";
  const outputDir = resolve(
    readArg("--output-dir") ?? ".tmp/strategy-lab-research",
  );
  const adminToken =
    readArg("--admin-token") ?? String(process.env.ADMIN_TOKEN ?? "").trim();
  if (!adminToken) {
    throw new Error("missing-admin-token");
  }

  const requestFile = readArg("--request-file");
  const requestPayload = requestFile ? readJsonFile(resolve(requestFile)) : {};
  const mergedPayload =
    Array.isArray(requestPayload) || !requestPayload
      ? { requests: requestPayload ?? [] }
      : { ...(requestPayload as Record<string, unknown>) };

  const profile = readArg("--profile");
  const title = readArg("--title");
  const maxSourcesRaw = readArg("--max-sources");
  const maxSources =
    maxSourcesRaw && Number.isFinite(Number(maxSourcesRaw))
      ? Number(maxSourcesRaw)
      : undefined;
  const explicitAllowedHosts = readMultiArg("--allow-host");

  const requestBody = parseRuntimeResearchBriefRequest({
    ...mergedPayload,
    ...(profile ? { profile } : {}),
    ...(title ? { title } : {}),
    ...(typeof maxSources === "number" ? { maxSources } : {}),
    ...(explicitAllowedHosts.length > 0 ? { explicitAllowedHosts } : {}),
  });

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/admin/ops/runtime/research/briefs`,
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
        payload.error ?? `runtime-research-brief-failed:${response.status}`,
      ),
    );
  }

  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "brief.json");
  const markdownPath = join(outputDir, "brief.md");
  writeFileSync(jsonPath, `${JSON.stringify(payload.brief, null, 2)}\n`);
  writeFileSync(markdownPath, `${String(payload.markdown ?? "")}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        outputDir,
        briefPath: jsonPath,
        markdownPath,
        briefId:
          typeof payload.brief === "object" && payload.brief
            ? (payload.brief as Record<string, unknown>).briefId
            : null,
      },
      null,
      2,
    ),
  );
}

await main();
