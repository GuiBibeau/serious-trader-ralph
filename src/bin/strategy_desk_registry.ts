import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseRuntimeStrategyDeskScenarioManifest,
  parseRuntimeStrategyDeskScenarioReport,
  parseRuntimeStrategyDeskScenarioRun,
} from "../runtime/contracts/autonomous_runtime.js";

type Resource = "scenario" | "run" | "report";
type Action = "upsert" | "list" | "execute";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function resolveResource(): Resource {
  const raw = readArg("--resource") ?? "scenario";
  if (raw === "scenario" || raw === "run" || raw === "report") {
    return raw;
  }
  throw new Error("invalid-arg:--resource");
}

function resolveAction(): Action {
  const raw = readArg("--action") ?? "upsert";
  if (raw === "upsert" || raw === "list" || raw === "execute") {
    return raw;
  }
  throw new Error("invalid-arg:--action");
}

function endpointFor(input: {
  resource: Resource;
  action: Action;
  requestPayload: unknown;
}): string {
  if (input.action === "execute") {
    if (input.resource !== "scenario") {
      throw new Error("strategy-desk-execute-scenario-resource-required");
    }
    const scenarioId =
      typeof input.requestPayload === "object" &&
      input.requestPayload &&
      !Array.isArray(input.requestPayload)
        ? String(
            (input.requestPayload as Record<string, unknown>).scenarioId ?? "",
          ).trim()
        : "";
    if (!scenarioId) {
      throw new Error("strategy-desk-execute-scenario-id-required");
    }
    return `/api/admin/ops/runtime/strategy-desk/scenarios/${encodeURIComponent(
      scenarioId,
    )}/execute`;
  }
  const resource = input.resource;
  switch (resource) {
    case "scenario":
      return "/api/admin/ops/runtime/strategy-desk/scenarios";
    case "run":
      return "/api/admin/ops/runtime/strategy-desk/runs";
    case "report":
      return "/api/admin/ops/runtime/strategy-desk/reports";
  }
}

function buildUpsertBody(resource: Resource, payload: unknown): unknown {
  switch (resource) {
    case "scenario":
      return parseRuntimeStrategyDeskScenarioManifest(payload);
    case "run":
      return parseRuntimeStrategyDeskScenarioRun(payload);
    case "report":
      return parseRuntimeStrategyDeskScenarioReport(payload);
  }
}

function buildExecuteBody(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("strategy-desk-execute-invalid-body");
  }
  const { scenarioId: _scenarioId, ...rest } = payload as Record<
    string,
    unknown
  >;
  return rest;
}

function buildQueryString(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

async function main(): Promise<void> {
  const resource = resolveResource();
  const action = resolveAction();
  const baseUrl = readArg("--base-url") ?? "http://127.0.0.1:8888";
  const outputDir = resolve(
    readArg("--output-dir") ?? ".tmp/strategy-desk-registry",
  );
  const adminToken =
    readArg("--admin-token") ?? String(process.env.ADMIN_TOKEN ?? "").trim();
  if (!adminToken) {
    throw new Error("missing-admin-token");
  }

  const requestFile = readArg("--request-file");
  const requestPayload = requestFile
    ? readJsonFile(resolve(requestFile))
    : null;
  if ((action === "upsert" || action === "execute") && !requestPayload) {
    throw new Error("missing-arg:--request-file");
  }

  const endpoint = endpointFor({
    resource,
    action,
    requestPayload,
  });
  const queryString =
    action === "list" ? buildQueryString(requestPayload ?? undefined) : "";
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}${endpoint}${queryString ? `?${queryString}` : ""}`,
    {
      method: action === "list" ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        ...(action !== "list" ? { "content-type": "application/json" } : {}),
      },
      ...(action === "upsert"
        ? {
            body: JSON.stringify(
              buildUpsertBody(resource, requestPayload as unknown),
            ),
          }
        : action === "execute"
          ? {
              body: JSON.stringify(buildExecuteBody(requestPayload as unknown)),
            }
          : {}),
    },
  );

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      String(
        payload.error ??
          `strategy-desk-registry-${action}-failed:${resource}:${response.status}`,
      ),
    );
  }

  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, `${resource}.${action}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        resource,
        action,
        outputDir,
        jsonPath,
      },
      null,
      2,
    ),
  );
}

await main();
