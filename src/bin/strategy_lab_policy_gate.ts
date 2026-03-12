import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRuntimeResearchPolicyGateRequest } from "../runtime/research/policy_gate.js";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function maybeApproval(targetMode: "paper" | "limited_live" | "broad_live") {
  const approvedBy = readArg(`--${targetMode}-approved-by`);
  const approvedAt = readArg(`--${targetMode}-approved-at`);
  if (!approvedBy || !approvedAt) return null;
  return {
    targetMode,
    approvedBy,
    approvedAt,
  };
}

async function main(): Promise<void> {
  const baseUrl = readArg("--base-url") ?? "http://127.0.0.1:8888";
  const outputDir = resolve(
    readArg("--output-dir") ?? ".tmp/strategy-lab-policy-gate",
  );
  const adminToken =
    readArg("--admin-token") ?? String(process.env.ADMIN_TOKEN ?? "").trim();
  if (!adminToken) {
    throw new Error("missing-admin-token");
  }

  const synthesisFile = readArg("--synthesis-file");
  const triageFile = readArg("--triage-file");
  if (!synthesisFile) {
    throw new Error("missing-arg:--synthesis-file");
  }
  if (!triageFile) {
    throw new Error("missing-arg:--triage-file");
  }

  const approvals = [
    maybeApproval("paper"),
    maybeApproval("limited_live"),
    maybeApproval("broad_live"),
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const requestBody = parseRuntimeResearchPolicyGateRequest({
    synthesis: readJsonFile(resolve(synthesisFile)),
    triage: readJsonFile(resolve(triageFile)),
    ...(approvals.length > 0 ? { approvals } : {}),
    ...(process.argv.includes("--limited-live-canary-passed")
      ? { limitedLiveCanaryPassed: true }
      : {}),
    ...(process.argv.includes("--limited-live-soak-passed")
      ? { limitedLiveSoakPassed: true }
      : {}),
  });

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/admin/ops/runtime/research/policy-gate`,
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
        payload.error ??
          `runtime-research-policy-gate-failed:${response.status}`,
      ),
    );
  }

  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "policy-gate.json");
  const markdownPath = join(outputDir, "policy-gate.md");
  writeFileSync(jsonPath, `${JSON.stringify(payload.policyGate, null, 2)}\n`);
  writeFileSync(markdownPath, `${String(payload.markdown ?? "")}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        outputDir,
        policyGatePath: jsonPath,
        markdownPath,
        policyGateId:
          typeof payload.policyGate === "object" && payload.policyGate
            ? (payload.policyGate as Record<string, unknown>).policyGateId
            : null,
      },
      null,
      2,
    ),
  );
}

await main();
