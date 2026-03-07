#!/usr/bin/env node

import {
  findStandbyFor,
  isDestroyedMachine,
  readRuntimeFlyConfig,
  runFlyJson,
} from "./fly_common.mjs";

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`request to ${url} failed with ${response.status}`);
  }
  return await response.json();
}

async function main() {
  const config = readRuntimeFlyConfig();
  const health = await fetchJson(config.healthUrl);

  if (health?.serviceName !== "runtime-rs") {
    throw new Error("runtime-rs health serviceName mismatch");
  }
  if (health?.status !== "ok") {
    throw new Error("runtime-rs health status mismatch");
  }
  if (health?.environment !== config.environment) {
    throw new Error("runtime-rs environment mismatch");
  }
  if (
    health?.execHealthUrl !==
    `${config.workerApiBase}/api/internal/runtime/health`
  ) {
    throw new Error("runtime-rs exec health URL mismatch");
  }
  if (health?.workerServiceAuthConfigured !== true) {
    throw new Error("runtime-rs worker service auth should be configured");
  }

  const machines = runFlyJson(["machine", "list", "--app", config.appName]);
  const primaryMachines = machines
    .filter(
      (machine) =>
        machine?.region === config.primaryRegion &&
        !findStandbyFor(machine) &&
        !isDestroyedMachine(machine),
    )
    .sort(
      (left, right) =>
        Date.parse(String(right?.updated_at ?? right?.created_at ?? 0)) -
        Date.parse(String(left?.updated_at ?? left?.created_at ?? 0)),
    );
  if (primaryMachines.length !== 1) {
    throw new Error(
      `expected exactly one primary machine in ${config.primaryRegion}, found ${primaryMachines.length}`,
    );
  }
  const [primary] = primaryMachines;
  const standbyMachines = machines.filter(
    (machine) =>
      machine?.region === config.standbyRegion &&
      findStandbyFor(machine) === primary.id &&
      !isDestroyedMachine(machine),
  );
  if (standbyMachines.length !== 1) {
    throw new Error(
      `expected exactly one standby machine in ${config.standbyRegion}, found ${standbyMachines.length}`,
    );
  }
  const [standby] = standbyMachines;

  const summary = {
    appName: config.appName,
    healthUrl: config.healthUrl,
    primaryRegion: config.primaryRegion,
    standbyRegion: config.standbyRegion,
    primaryMachineId: primary.id,
    standbyMachineId: standby.id,
    runtimeHealth: health,
  };

  console.log(JSON.stringify(summary, null, 2));
}

await main();
