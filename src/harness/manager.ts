import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { basename, join, resolve } from "node:path";

const PORTAL_PORT_BASE = 3000;
const WORKER_PORT_BASE = 8800;
const PORT_SCAN_WINDOW = 400;
const STARTUP_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_000;

export type HarnessState = {
  version: 1;
  root: string;
  branch: string;
  worktreeId: string;
  portalPort: number;
  workerPort: number;
  portalPid: number;
  workerPid: number;
  startedAt: string;
  paths: {
    harnessDir: string;
    logsDir: string;
    portalLog: string;
    workerLog: string;
    workerStateDir: string;
    stateFile: string;
  };
};

export type HarnessPaths = HarnessState["paths"];

export type HarnessStatus = {
  worktreeId: string;
  branch: string;
  root: string;
  portalUrl: string;
  workerUrl: string;
  portalHealth: "healthy" | "unhealthy" | "stopped";
  workerHealth: "healthy" | "unhealthy" | "stopped";
  portalPid: number | null;
  workerPid: number | null;
  stateFile: string;
  logsDir: string;
};

export function resolveWorktreeId(root: string): string {
  const normalizedRoot = resolve(root);
  const leaf =
    basename(normalizedRoot)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "worktree";
  const digest = createHash("sha256").update(normalizedRoot).digest("hex");
  return `${leaf}-${digest.slice(0, 8)}`;
}

export function resolveHarnessPaths(root: string): HarnessPaths {
  const worktreeId = resolveWorktreeId(root);
  const harnessDir = join(root, ".tmp", "harness", worktreeId);
  const logsDir = join(harnessDir, "logs");
  return {
    harnessDir,
    logsDir,
    portalLog: join(logsDir, "portal.log"),
    workerLog: join(logsDir, "worker.log"),
    workerStateDir: join(harnessDir, "worker-state"),
    stateFile: join(harnessDir, "state.json"),
  };
}

export function resolvePreferredPorts(root: string): {
  portalPort: number;
  workerPort: number;
} {
  const digest = createHash("sha256").update(resolve(root)).digest("hex");
  const offset = Number.parseInt(digest.slice(0, 8), 16) % PORT_SCAN_WINDOW;
  return {
    portalPort: PORTAL_PORT_BASE + offset,
    workerPort: WORKER_PORT_BASE + offset,
  };
}

export function loadHarnessState(root: string): HarnessState | null {
  const paths = resolveHarnessPaths(root);
  if (!existsSync(paths.stateFile)) {
    return null;
  }
  return JSON.parse(readFileSync(paths.stateFile, "utf8")) as HarnessState;
}

function saveHarnessState(state: HarnessState): void {
  mkdirSync(state.paths.harnessDir, { recursive: true });
  writeFileSync(state.paths.stateFile, JSON.stringify(state, null, 2), "utf8");
}

function removeHarnessState(root: string): void {
  rmSync(resolveHarnessPaths(root).harnessDir, {
    recursive: true,
    force: true,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolvePromise) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => {
      resolvePromise(false);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolvePromise(true));
    });
  });
}

async function findAvailablePort(start: number): Promise<number> {
  for (let port = start; port < start + PORT_SCAN_WINDOW; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`no available port found starting at ${start}`);
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch (_err) {
      // Keep polling until the timeout is reached.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

function isPidRunning(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (_err) {
    return false;
  }
}

function resolveRepoRoot(cwd = process.cwd()): string {
  return spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  }).stdout.trim();
}

function resolveCurrentBranch(root: string): string {
  return spawnSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
}

function ensureHarnessDirs(paths: HarnessPaths): void {
  mkdirSync(paths.logsDir, { recursive: true });
  mkdirSync(paths.workerStateDir, { recursive: true });
}

function hasWorkspaceDependencies(root: string): boolean {
  return (
    existsSync(join(root, "node_modules")) &&
    existsSync(join(root, "apps", "portal", "node_modules")) &&
    existsSync(join(root, "apps", "worker", "node_modules"))
  );
}

function ensureWorkspaceDependencies(root: string): void {
  if (hasWorkspaceDependencies(root)) {
    return;
  }

  const result = spawnSync("bun", ["install", "--frozen-lockfile"], {
    cwd: root,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error("failed to install workspace dependencies for harness");
  }
}

function runWorkerMigration(workerDir: string, workerStateDir: string): void {
  const result = spawnSync(
    "bunx",
    [
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "WAITLIST_DB",
      "--local",
      "--persist-to",
      workerStateDir,
    ],
    {
      cwd: workerDir,
      stdio: ["pipe", "inherit", "inherit"],
      input: "y\n",
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    throw new Error("failed to apply local worker migrations for harness");
  }
}

function startProcess(input: {
  cwd: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  logFile: string;
}): number {
  const stdoutFd = openSync(input.logFile, "a");
  const stderrFd = openSync(input.logFile, "a");
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: { ...process.env, ...(input.env ?? {}) },
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
  });
  child.unref();
  if (!child.pid) {
    throw new Error(`failed to start process for ${input.logFile}`);
  }
  return child.pid;
}

function killPid(pid: number | null | undefined): void {
  if (!pid || pid <= 0) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (_err) {
    return;
  }
}

export async function getHarnessStatus(
  root = resolveRepoRoot(),
): Promise<HarnessStatus> {
  const state = loadHarnessState(root);
  const branch = resolveCurrentBranch(root);
  const paths = resolveHarnessPaths(root);
  if (!state) {
    return {
      worktreeId: resolveWorktreeId(root),
      branch,
      root,
      portalUrl: "not-running",
      workerUrl: "not-running",
      portalHealth: "stopped",
      workerHealth: "stopped",
      portalPid: null,
      workerPid: null,
      stateFile: paths.stateFile,
      logsDir: paths.logsDir,
    };
  }

  const portalRunning = isPidRunning(state.portalPid);
  const workerRunning = isPidRunning(state.workerPid);
  const portalUrl = `http://localhost:${state.portalPort}`;
  const workerUrl = `http://127.0.0.1:${state.workerPort}`;

  let portalHealth: HarnessStatus["portalHealth"] = portalRunning
    ? "unhealthy"
    : "stopped";
  let workerHealth: HarnessStatus["workerHealth"] = workerRunning
    ? "unhealthy"
    : "stopped";

  if (portalRunning && (await waitForHttp(`${portalUrl}/login`, 2_000))) {
    portalHealth = "healthy";
  }
  if (workerRunning && (await waitForHttp(`${workerUrl}/api/health`, 2_000))) {
    workerHealth = "healthy";
  }

  return {
    worktreeId: state.worktreeId,
    branch,
    root,
    portalUrl,
    workerUrl: `${workerUrl}/api/health`,
    portalHealth,
    workerHealth,
    portalPid: portalRunning ? state.portalPid : null,
    workerPid: workerRunning ? state.workerPid : null,
    stateFile: state.paths.stateFile,
    logsDir: state.paths.logsDir,
  };
}

export async function startHarness(root = resolveRepoRoot()): Promise<void> {
  const existing = loadHarnessState(root);
  if (
    existing &&
    isPidRunning(existing.portalPid) &&
    isPidRunning(existing.workerPid)
  ) {
    await printHarnessStatus(root);
    return;
  }

  if (existing) {
    removeHarnessState(root);
  }

  const branch = resolveCurrentBranch(root);
  const paths = resolveHarnessPaths(root);
  ensureHarnessDirs(paths);

  const preferred = resolvePreferredPorts(root);
  const portalPort = await findAvailablePort(preferred.portalPort);
  const workerPort = await findAvailablePort(preferred.workerPort);

  const workerDir = join(root, "apps", "worker");
  const portalDir = join(root, "apps", "portal");

  ensureWorkspaceDependencies(root);
  runWorkerMigration(workerDir, paths.workerStateDir);

  const workerPid = startProcess({
    cwd: workerDir,
    command: "bunx",
    args: [
      "wrangler",
      "dev",
      "--local",
      "--persist-to",
      paths.workerStateDir,
      "--test-scheduled",
      "--port",
      String(workerPort),
    ],
    logFile: paths.workerLog,
  });

  const workerHealthy = await waitForHttp(
    `http://127.0.0.1:${workerPort}/api/health`,
    STARTUP_TIMEOUT_MS,
  );
  if (!workerHealthy) {
    killPid(workerPid);
    removeHarnessState(root);
    throw new Error(`worker failed to become healthy on port ${workerPort}`);
  }

  const portalPid = startProcess({
    cwd: portalDir,
    command: "bunx",
    args: [
      "next",
      "dev",
      "--hostname",
      "localhost",
      "--port",
      String(portalPort),
    ],
    env: {
      NEXT_PUBLIC_EDGE_API_BASE: `http://127.0.0.1:${workerPort}`,
      NEXT_PUBLIC_SITE_URL: `http://localhost:${portalPort}`,
    },
    logFile: paths.portalLog,
  });

  const portalHealthy = await waitForHttp(
    `http://localhost:${portalPort}/login`,
    STARTUP_TIMEOUT_MS,
  );
  if (!portalHealthy) {
    killPid(portalPid);
    killPid(workerPid);
    removeHarnessState(root);
    throw new Error(`portal failed to become healthy on port ${portalPort}`);
  }

  saveHarnessState({
    version: 1,
    root,
    branch,
    worktreeId: resolveWorktreeId(root),
    portalPort,
    workerPort,
    portalPid,
    workerPid,
    startedAt: new Date().toISOString(),
    paths,
  });

  await printHarnessStatus(root);
}

export async function stopHarness(root = resolveRepoRoot()): Promise<void> {
  const state = loadHarnessState(root);
  if (state) {
    killPid(state.portalPid);
    killPid(state.workerPid);
    await sleep(1_000);
  }
  removeHarnessState(root);
  await printHarnessStatus(root);
}

export async function printHarnessStatus(
  root = resolveRepoRoot(),
): Promise<void> {
  const status = await getHarnessStatus(root);
  console.log(JSON.stringify(status, null, 2));
}
