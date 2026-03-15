import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseRuntimeResearchReadinessCanaryRequest,
  parseRuntimeResearchReadinessRequest,
  parseRuntimeResearchSubjectControlPatch,
  parseRuntimeResearchVenueTxSmokeRequest,
} from "../runtime/research/readiness.js";

type Operation = "readiness" | "canary" | "control" | "smoke";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function resolveOperation(): Operation {
  const raw = readArg("--operation") ?? "readiness";
  if (
    raw === "readiness" ||
    raw === "canary" ||
    raw === "control" ||
    raw === "smoke"
  ) {
    return raw;
  }
  throw new Error("invalid-arg:--operation");
}

async function main(): Promise<void> {
  const operation = resolveOperation();
  const baseUrl = readArg("--base-url") ?? "http://127.0.0.1:8888";
  const outputDir = resolve(
    readArg("--output-dir") ?? ".tmp/strategy-lab-readiness",
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
  const requestPayload = readJsonFile(resolve(requestFile));
  const requestBody =
    operation === "readiness"
      ? parseRuntimeResearchReadinessRequest(requestPayload)
      : operation === "canary"
        ? parseRuntimeResearchReadinessCanaryRequest(requestPayload)
        : operation === "smoke"
          ? parseRuntimeResearchVenueTxSmokeRequest(requestPayload)
          : parseRuntimeResearchSubjectControlPatch(requestPayload);

  const endpoint =
    operation === "readiness"
      ? "/api/admin/ops/runtime/research/readiness"
      : operation === "canary"
        ? "/api/admin/ops/runtime/research/readiness/canary"
        : operation === "smoke"
          ? "/api/admin/ops/runtime/research/readiness/smoke"
          : "/api/admin/ops/runtime/research/subject-controls";

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      String(
        payload.error ??
          `strategy-lab-readiness-operation-failed:${operation}:${response.status}`,
      ),
    );
  }

  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, `${operation}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);

  let markdownPath: string | null = null;
  if (typeof payload.markdown === "string" && payload.markdown.trim()) {
    markdownPath = join(outputDir, `${operation}.md`);
    writeFileSync(markdownPath, `${payload.markdown}\n`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        operation,
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
