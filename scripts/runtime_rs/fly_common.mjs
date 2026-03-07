#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FLYCTL_BIN = process.env.FLYCTL_BIN ?? "flyctl";

export function resolveRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function readRuntimeFlyConfig(options = {}) {
  const appName = String(process.env.FLY_APP_NAME ?? "ralph-runtime-rs").trim();
  const orgSlug = String(process.env.FLY_ORG_SLUG ?? "personal").trim();
  const primaryRegion = String(process.env.FLY_PRIMARY_REGION ?? "ord").trim();
  const standbyRegion = String(process.env.FLY_STANDBY_REGION ?? "iad").trim();
  const configPath = String(
    process.env.FLY_CONFIG_PATH ?? "fly.runtime-rs.toml",
  ).trim();
  const workerApiBase = String(
    process.env.RUNTIME_WORKER_API_BASE ?? "https://api.trader-ralph.com",
  )
    .trim()
    .replace(/\/+$/g, "");
  const environment = String(process.env.RUNTIME_RS_ENV ?? "production").trim();
  const logLevel = String(process.env.RUNTIME_RS_LOG ?? "info").trim();
  const localOnly =
    String(process.env.FLY_DEPLOY_LOCAL_ONLY ?? "1").trim() !== "0";
  const serviceToken = String(
    process.env.RUNTIME_INTERNAL_SERVICE_TOKEN ?? "",
  ).trim();
  const databaseUrl = String(process.env.RUNTIME_DATABASE_URL ?? "").trim();
  const publicUrl = `https://${appName}.fly.dev`;
  const healthUrl = `${publicUrl}/health`;

  if (!appName) {
    throw new Error("FLY_APP_NAME is required");
  }
  if (!orgSlug) {
    throw new Error("FLY_ORG_SLUG is required");
  }
  if (!primaryRegion) {
    throw new Error("FLY_PRIMARY_REGION is required");
  }
  if (!standbyRegion) {
    throw new Error("FLY_STANDBY_REGION is required");
  }
  if (options.requireServiceToken === true && !serviceToken) {
    throw new Error("RUNTIME_INTERNAL_SERVICE_TOKEN is required");
  }

  return {
    appName,
    configPath,
    databaseUrl,
    environment,
    healthUrl,
    localOnly,
    logLevel,
    orgSlug,
    primaryRegion,
    publicUrl,
    serviceToken,
    standbyRegion,
    workerApiBase,
  };
}

export function runCommand(
  command,
  args,
  {
    allowFailure = false,
    cwd = resolveRepoRoot(),
    env = {},
    input = undefined,
    stdio = "pipe",
  } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    input,
    stdio,
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      [result.stdout, result.stderr]
        .map((chunk) => String(chunk ?? "").trim())
        .filter((chunk) => chunk.length > 0)
        .join("\n") || `${command} ${args.join(" ")} failed`,
    );
  }

  return result;
}

export function runFly(args, options = {}) {
  return runCommand(FLYCTL_BIN, args, options);
}

export function runFlyJson(args, options = {}) {
  const result = runFly([...args, "--json"], options);
  return JSON.parse(String(result.stdout ?? "").trim());
}

export function findStandbyFor(machine) {
  return (
    machine?.config?.env?.FLY_STANDBY_FOR ??
    machine?.config?.metadata?.standby_for ??
    machine?.config?.metadata?.["fly.standby_for"] ??
    machine?.config?.standbys?.[0] ??
    machine?.standby_for ??
    null
  );
}

export function isDestroyedMachine(machine) {
  return ["destroyed", "failed"].includes(
    String(machine?.state ?? "").toLowerCase(),
  );
}
