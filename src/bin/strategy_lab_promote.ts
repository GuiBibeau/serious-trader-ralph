import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRuntimeResearchPromotionRequest } from "../runtime/research/promotion.js";

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
    readArg("--output-dir") ?? ".tmp/strategy-lab-promotion",
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

  const requestBody = parseRuntimeResearchPromotionRequest(
    readJsonFile(resolve(requestFile)),
  );

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/admin/ops/runtime/research/promotions`,
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
        payload.error ?? `runtime-research-promotion-failed:${response.status}`,
      ),
    );
  }

  mkdirSync(outputDir, { recursive: true });
  const promotionPath = join(outputDir, "promotion.json");
  const eventPath = join(outputDir, "promotion-event.json");
  const markdownPath = join(outputDir, "promotion.md");
  writeFileSync(
    promotionPath,
    `${JSON.stringify(payload.promotion, null, 2)}\n`,
  );
  writeFileSync(eventPath, `${JSON.stringify(payload.event, null, 2)}\n`);
  writeFileSync(markdownPath, `${String(payload.markdown ?? "")}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        outputDir,
        promotionPath,
        eventPath,
        markdownPath,
        promotionId:
          typeof payload.promotion === "object" && payload.promotion
            ? (payload.promotion as Record<string, unknown>).promotionId
            : null,
        status:
          typeof payload.promotion === "object" && payload.promotion
            ? (payload.promotion as Record<string, unknown>).status
            : null,
      },
      null,
      2,
    ),
  );
}

await main();
