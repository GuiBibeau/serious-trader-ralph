import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRuntimeResearchCurationRequest } from "../runtime/research/curation.js";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

async function main(): Promise<void> {
  const baseUrl = readArg("--base-url") ?? "http://127.0.0.1:8888";
  const outputDir = resolve(
    readArg("--output-dir") ?? ".tmp/strategy-lab-curation",
  );
  const adminToken =
    readArg("--admin-token") ?? String(process.env.ADMIN_TOKEN ?? "").trim();
  if (!adminToken) {
    throw new Error("missing-admin-token");
  }

  const requestFile = readArg("--request-file");
  if (!requestFile) {
    throw new Error("missing-arg:--request-file");
  }

  const requestBody = parseRuntimeResearchCurationRequest(
    readJsonFile(resolve(requestFile)),
  );

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/admin/ops/runtime/research/curation`,
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
        payload.error ?? `runtime-research-curation-failed:${response.status}`,
      ),
    );
  }

  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "curation.json");
  const markdownPath = join(outputDir, "curation.md");
  writeFileSync(jsonPath, `${JSON.stringify(payload.summary, null, 2)}\n`);
  writeFileSync(markdownPath, `${String(payload.markdown ?? "")}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        outputDir,
        curationPath: jsonPath,
        markdownPath,
      },
      null,
      2,
    ),
  );
}

await main();
