import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRuntimeResearchPostLiveRequest } from "../runtime/research/post_live.js";

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
    readArg("--output-dir") ?? ".tmp/strategy-lab-post-live",
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

  const requestBody = parseRuntimeResearchPostLiveRequest(
    readJsonFile(resolve(requestFile)),
  );

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/admin/ops/runtime/research/post-live`,
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
        payload.error ?? `runtime-research-post-live-failed:${response.status}`,
      ),
    );
  }

  mkdirSync(outputDir, { recursive: true });
  const artifactPath = join(outputDir, "post-live.json");
  const markdownPath = join(outputDir, "post-live.md");
  writeFileSync(artifactPath, `${JSON.stringify(payload.artifact, null, 2)}\n`);
  writeFileSync(markdownPath, `${String(payload.markdown ?? "")}\n`);
  if (payload.promotion) {
    writeFileSync(
      join(outputDir, "follow-up-promotion.json"),
      `${JSON.stringify(payload.promotion, null, 2)}\n`,
    );
  }
  if (payload.event) {
    writeFileSync(
      join(outputDir, "follow-up-promotion-event.json"),
      `${JSON.stringify(payload.event, null, 2)}\n`,
    );
  }
  if (payload.control) {
    writeFileSync(
      join(outputDir, "follow-up-control.json"),
      `${JSON.stringify(payload.control, null, 2)}\n`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        outputDir,
        artifactPath,
        markdownPath,
        postLiveId:
          typeof payload.artifact === "object" && payload.artifact
            ? (payload.artifact as Record<string, unknown>).postLiveId
            : null,
        status:
          typeof payload.artifact === "object" && payload.artifact
            ? (payload.artifact as Record<string, unknown>).status
            : null,
      },
      null,
      2,
    ),
  );
}

await main();
