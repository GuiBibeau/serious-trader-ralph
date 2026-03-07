#!/usr/bin/env node

import {
  findStandbyFor,
  readRuntimeFlyConfig,
  runFly,
  runFlyJson,
} from "./fly_common.mjs";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function machineSummary(machine) {
  return {
    id: machine?.id ?? null,
    region: machine?.region ?? null,
    state: machine?.state ?? null,
    standbyFor: findStandbyFor(machine),
  };
}

function listMachines(appName) {
  return runFlyJson(["machine", "list", "--app", appName]);
}

function compareMachines(left, right) {
  return (
    Date.parse(String(right?.updated_at ?? right?.created_at ?? 0)) -
    Date.parse(String(left?.updated_at ?? left?.created_at ?? 0))
  );
}

function listPrimaryMachines(config, machines) {
  return machines
    .filter(
      (machine) =>
        machine?.region === config.primaryRegion &&
        !findStandbyFor(machine) &&
        machine?.state !== "destroyed",
    )
    .sort(compareMachines);
}

function selectPrimaryMachine(config, machines) {
  const primary = listPrimaryMachines(config, machines)[0];
  if (!primary) {
    throw new Error(
      `no primary machine found in ${config.primaryRegion} for ${config.appName}`,
    );
  }
  return primary;
}

function pruneExtraPrimaryMachines(config, machines, keepMachineId) {
  const extras = listPrimaryMachines(config, machines).filter(
    (machine) => machine?.id !== keepMachineId,
  );

  for (const machine of extras) {
    runFly(
      ["machine", "destroy", machine.id, "--app", config.appName, "--force"],
      { stdio: "inherit" },
    );
  }
}

function selectStandbyMachine(config, machines, primaryMachineId) {
  return (
    machines.find(
      (machine) =>
        machine?.region === config.standbyRegion &&
        findStandbyFor(machine) === primaryMachineId &&
        machine?.state !== "destroyed",
    ) ?? null
  );
}

function destroyMismatchedStandbys(config, machines, primaryMachineId) {
  const mismatched = machines.filter(
    (machine) =>
      machine?.region === config.standbyRegion &&
      findStandbyFor(machine) !== primaryMachineId &&
      machine?.state !== "destroyed",
  );

  for (const machine of mismatched) {
    runFly(
      ["machine", "destroy", machine.id, "--app", config.appName, "--force"],
      { stdio: "inherit" },
    );
  }
}

function ensureApp(config) {
  const status = runFly(["status", "--app", config.appName], {
    allowFailure: true,
  });
  if (status.status === 0) {
    return;
  }

  runFly(["apps", "create", config.appName, "--org", config.orgSlug], {
    stdio: "inherit",
  });
}

function stageSecrets(config) {
  const secrets = [`RUNTIME_INTERNAL_SERVICE_TOKEN=${config.serviceToken}`];
  if (config.databaseUrl) {
    secrets.push(`RUNTIME_DATABASE_URL=${config.databaseUrl}`);
  }

  runFly(["secrets", "set", "--stage", "--app", config.appName, ...secrets], {
    stdio: "inherit",
  });
}

function deployRuntime(config) {
  const args = [
    "deploy",
    "--app",
    config.appName,
    "--config",
    config.configPath,
    "--strategy",
    "immediate",
    "--wait-timeout",
    "600",
  ];
  if (config.localOnly) {
    args.push("--local-only");
  }
  runFly(args, { stdio: "inherit" });
}

async function ensureStandby(config, primaryMachineId) {
  let machines = listMachines(config.appName);
  let standby = selectStandbyMachine(config, machines, primaryMachineId);
  if (standby) {
    return standby;
  }

  runFly(
    [
      "machine",
      "clone",
      primaryMachineId,
      "--app",
      config.appName,
      "--region",
      config.standbyRegion,
      "--standby-for",
      primaryMachineId,
    ],
    { stdio: "inherit" },
  );

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(2_000);
    machines = listMachines(config.appName);
    standby = selectStandbyMachine(config, machines, primaryMachineId);
    if (standby) {
      return standby;
    }
  }

  throw new Error(
    `standby machine in ${config.standbyRegion} was not created for ${config.appName}`,
  );
}

async function main() {
  const config = readRuntimeFlyConfig({ requireServiceToken: true });

  ensureApp(config);
  stageSecrets(config);
  deployRuntime(config);

  let machines = listMachines(config.appName);
  const primary = selectPrimaryMachine(config, machines);
  pruneExtraPrimaryMachines(config, machines, primary.id);
  machines = listMachines(config.appName);
  destroyMismatchedStandbys(config, machines, primary.id);
  machines = listMachines(config.appName);
  const standby = await ensureStandby(config, primary.id);

  console.log(
    JSON.stringify(
      {
        appName: config.appName,
        publicUrl: config.publicUrl,
        healthUrl: config.healthUrl,
        primaryRegion: config.primaryRegion,
        standbyRegion: config.standbyRegion,
        primaryMachine: machineSummary(primary),
        standbyMachine: machineSummary(standby),
      },
      null,
      2,
    ),
  );
}

await main();
