import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildRunnerFailureComment,
  buildRunnerSuccessComment,
} from "./comments.js";
import { loadWorkflowContract, type RunnerWorkflowConfig } from "./config.js";
import { writeRunnerHeartbeat } from "./heartbeat.js";

export type RunnerIssue = {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
};

export type RunnerPullRequestSummary = {
  number: number;
  url: string;
  checksUrl: string | null;
};

export type RunnerRunSummary = {
  status: "success" | "failed" | "idle";
  issueNumber: number | null;
  branch: string | null;
  worktreePath: string | null;
  logFile: string | null;
  lastMessageFile: string;
  commitSha: string | null;
  prUrl: string | null;
  error: string | null;
};

type RunnerJsonIssue = {
  number: number;
  title: string;
  body?: string | null;
  url: string;
  labels?: Array<{ name?: string | null }>;
};

type RunnerJsonPullRequest = {
  number: number;
  url: string;
};

type RunnerOptions = {
  root?: string;
  concurrency?: number;
  pollIntervalMs?: number;
};

type ProcessIssueContext = {
  root: string;
  config: RunnerWorkflowConfig;
  issue: RunnerIssue;
};

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_POLL_INTERVAL_MS = 30_000;

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    input?: string;
    env?: NodeJS.ProcessEnv;
    allowFailure?: boolean;
  },
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
    input: options.input,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      [result.stdout, result.stderr]
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length > 0)
        .join("\n") || `${command} ${args.join(" ")} failed`,
    );
  }
  return result.stdout.trim();
}

function runJsonCommand<T>(command: string, args: string[], cwd: string): T {
  const output = runCommand(command, args, { cwd });
  return JSON.parse(output) as T;
}

function resolveRepoRoot(cwd = process.cwd()): string {
  return runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function hasAllLabels(issue: RunnerIssue, labels: string[]): boolean {
  return labels.every((label) => issue.labels.includes(label));
}

function hasAnyExcludedLabel(issue: RunnerIssue, labels: string[]): boolean {
  return labels.some((label) => issue.labels.includes(label));
}

export function selectRunnableIssues(
  issues: RunnerIssue[],
  config: RunnerWorkflowConfig,
): RunnerIssue[] {
  return issues
    .filter(
      (issue) =>
        hasAllLabels(issue, config.readyLabels) &&
        !hasAnyExcludedLabel(issue, config.excludeLabels),
    )
    .sort((left, right) => left.number - right.number);
}

export function slugifyIssueTitle(title: string, maxLength = 48): string {
  const normalized = title
    .toLowerCase()
    .replace(/\[[^\]]+\]\s*/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = normalized.slice(0, maxLength).replace(/-+$/g, "");
  return trimmed || "task";
}

export function buildIssueBranchName(
  issue: Pick<RunnerIssue, "number" | "title">,
  config: RunnerWorkflowConfig,
): string {
  return `${config.branchPrefix}issue-${issue.number}-${slugifyIssueTitle(issue.title)}`;
}

function resolveRunnerRoot(root: string): string {
  return join(resolve(root), ".tmp", "runner");
}

function resolveRunRoot(root: string): string {
  return join(resolveRunnerRoot(root), "runs");
}

function resolveWorkspaceRoot(root: string): string {
  return join(resolveRunnerRoot(root), "worktrees");
}

function resolveIssueWorktreePath(root: string, issue: RunnerIssue): string {
  return join(
    resolveWorkspaceRoot(root),
    `issue-${issue.number}-${slugifyIssueTitle(issue.title, 24)}`,
  );
}

function resolveRunPaths(
  root: string,
  issue: RunnerIssue,
): {
  runDir: string;
  logFile: string;
  lastMessageFile: string;
  summaryFile: string;
  prBodyFile: string;
} {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(
    resolveRunRoot(root),
    `issue-${issue.number}-${timestamp}`,
  );
  return {
    runDir,
    logFile: join(runDir, "codex.log"),
    lastMessageFile: join(runDir, "last-message.md"),
    summaryFile: join(runDir, "summary.json"),
    prBodyFile: join(runDir, "pr-body.md"),
  };
}

function listOpenIssues(root: string, repository: string): RunnerIssue[] {
  const issues = runJsonCommand<RunnerJsonIssue[]>(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repository,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,body,url,labels",
    ],
    root,
  );
  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    url: issue.url,
    labels: (issue.labels ?? [])
      .map((label) => String(label.name ?? "").trim())
      .filter((label) => label.length > 0),
  }));
}

function editIssueLabels(
  root: string,
  repository: string,
  issueNumber: number,
  changes: { add?: string[]; remove?: string[] },
): void {
  const args = ["issue", "edit", String(issueNumber), "--repo", repository];
  for (const label of changes.add ?? []) {
    args.push("--add-label", label);
  }
  for (const label of changes.remove ?? []) {
    args.push("--remove-label", label);
  }
  runCommand("gh", args, { cwd: root });
}

function commentOnIssue(
  root: string,
  repository: string,
  issueNumber: number,
  body: string,
): void {
  runCommand(
    "gh",
    [
      "issue",
      "comment",
      String(issueNumber),
      "--repo",
      repository,
      "--body",
      body,
    ],
    { cwd: root },
  );
}

function commentOnPr(
  root: string,
  repository: string,
  prNumber: number,
  body: string,
): void {
  runCommand(
    "gh",
    ["pr", "comment", String(prNumber), "--repo", repository, "--body", body],
    { cwd: root },
  );
}

function findOpenPullRequest(
  root: string,
  repository: string,
  branch: string,
): RunnerPullRequestSummary | null {
  const prs = runJsonCommand<RunnerJsonPullRequest[]>(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repository,
      "--state",
      "open",
      "--head",
      branch,
      "--json",
      "number,url",
    ],
    root,
  );
  const pr = prs[0];
  if (!pr) {
    return null;
  }
  return {
    number: pr.number,
    url: pr.url,
    checksUrl: `${pr.url}/checks`,
  };
}

function createPullRequest(input: {
  root: string;
  repository: string;
  issue: RunnerIssue;
  branch: string;
  prBase: string;
  prBodyFile: string;
}): RunnerPullRequestSummary {
  const title = input.issue.title.replace(/^\[[^\]]+\]\s*/, "").trim();
  writeFileSync(
    input.prBodyFile,
    [
      `Fixes #${input.issue.number}`,
      "",
      "## Summary",
      "- Implemented by the harness runner in a dedicated worktree.",
      "- CI and preview workflows will attach proof artifacts on this PR.",
      "",
      "## Source issue",
      `- ${input.issue.url}`,
    ].join("\n"),
    "utf8",
  );
  const url = runCommand(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      input.repository,
      "--base",
      input.prBase,
      "--head",
      input.branch,
      "--title",
      title,
      "--body-file",
      input.prBodyFile,
    ],
    { cwd: input.root },
  )
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("https://"));
  if (!url) {
    throw new Error("gh pr create did not return a PR URL");
  }
  const number = Number(url.match(/\/pull\/(\d+)$/)?.[1] ?? Number.NaN);
  return {
    number,
    url,
    checksUrl: `${url}/checks`,
  };
}

function updatePullRequestBase(
  root: string,
  repository: string,
  prNumber: number,
  prBase: string,
): void {
  runCommand(
    "gh",
    ["pr", "edit", String(prNumber), "--repo", repository, "--base", prBase],
    { cwd: root },
  );
}

function remoteBranchExists(root: string, branch: string): boolean {
  const result = spawnSync(
    "git",
    ["ls-remote", "--exit-code", "--heads", "origin", branch],
    {
      cwd: root,
      stdio: "ignore",
    },
  );
  return result.status === 0;
}

function isGitWorktree(path: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: path,
    stdio: "ignore",
  });
  return result.status === 0;
}

function ensureWorktreeDependencies(worktreePath: string): void {
  const rootNodeModules = join(worktreePath, "node_modules");
  const portalNodeModules = join(
    worktreePath,
    "apps",
    "portal",
    "node_modules",
  );
  const workerNodeModules = join(
    worktreePath,
    "apps",
    "worker",
    "node_modules",
  );
  if (
    existsSync(rootNodeModules) &&
    existsSync(portalNodeModules) &&
    existsSync(workerNodeModules)
  ) {
    return;
  }
  runCommand("bun", ["install", "--frozen-lockfile"], { cwd: worktreePath });
}

function ensureIssueWorktree(input: {
  root: string;
  issue: RunnerIssue;
  branch: string;
  prBase: string;
}): string {
  ensureDirectory(resolveWorkspaceRoot(input.root));
  runCommand("git", ["fetch", "origin", input.prBase], { cwd: input.root });
  if (remoteBranchExists(input.root, input.branch)) {
    runCommand("git", ["fetch", "origin", input.branch], { cwd: input.root });
  }

  const worktreePath = resolveIssueWorktreePath(input.root, input.issue);
  const startPoint = remoteBranchExists(input.root, input.branch)
    ? `origin/${input.branch}`
    : `origin/${input.prBase}`;

  if (!existsSync(worktreePath)) {
    runCommand(
      "git",
      ["worktree", "add", "-B", input.branch, worktreePath, startPoint],
      { cwd: input.root },
    );
  } else if (!isGitWorktree(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true });
    runCommand(
      "git",
      ["worktree", "add", "-B", input.branch, worktreePath, startPoint],
      { cwd: input.root },
    );
  } else if (remoteBranchExists(input.root, input.branch)) {
    runCommand("git", ["checkout", input.branch], { cwd: worktreePath });
    runCommand("git", ["reset", "--hard", `origin/${input.branch}`], {
      cwd: worktreePath,
    });
  } else {
    runCommand(
      "git",
      ["checkout", "-B", input.branch, `origin/${input.prBase}`],
      {
        cwd: worktreePath,
      },
    );
  }

  ensureWorktreeDependencies(worktreePath);
  return worktreePath;
}

function buildRunnerPrompt(
  issue: RunnerIssue,
  config: RunnerWorkflowConfig,
): string {
  return [
    `Work GitHub issue #${issue.number} in ${config.repository}.`,
    "Use WORKFLOW.md in the repo root as the execution contract.",
    "Make the smallest complete set of code, test, and docs changes needed for the issue.",
    "Run the narrowest relevant validation commands before stopping.",
    "Do not open or merge PRs. Do not push. Leave the worktree ready for the runner to commit and push.",
    "",
    `Issue title: ${issue.title}`,
    "",
    "Issue body:",
    issue.body.trim() || "(no issue body provided)",
  ].join("\n");
}

function runLoggedCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  logFile: string;
}): Promise<void> {
  ensureDirectory(dirname(input.logFile));
  return new Promise((resolvePromise, rejectPromise) => {
    const stdoutFd = openSync(input.logFile, "a");
    const stderrFd = openSync(input.logFile, "a");
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    child.once("error", (error) => rejectPromise(error));
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `${input.command} ${input.args.join(" ")} failed with code ${code}`,
        ),
      );
    });
  });
}

function commitAndPushWorktree(
  worktreePath: string,
  branch: string,
  issue: RunnerIssue,
): string {
  const status = runCommand("git", ["status", "--short"], {
    cwd: worktreePath,
  });
  if (!status) {
    throw new Error("runner completed without producing any file changes");
  }
  runCommand("git", ["add", "-A"], { cwd: worktreePath });
  runCommand("git", ["commit", "-m", `feat: resolve #${issue.number}`], {
    cwd: worktreePath,
  });
  runCommand("git", ["push", "-u", "origin", branch], { cwd: worktreePath });
  return runCommand("git", ["rev-parse", "HEAD"], { cwd: worktreePath });
}

async function processIssue(
  context: ProcessIssueContext,
): Promise<RunnerRunSummary> {
  const branch = buildIssueBranchName(context.issue, context.config);
  const runPaths = resolveRunPaths(context.root, context.issue);
  ensureDirectory(runPaths.runDir);

  try {
    editIssueLabels(
      context.root,
      context.config.repository,
      context.issue.number,
      {
        add: ["agent-running"],
      },
    );

    const worktreePath = ensureIssueWorktree({
      root: context.root,
      issue: context.issue,
      branch,
      prBase: context.config.defaultPrBase,
    });

    await runLoggedCommand({
      command: "codex",
      args: [
        "exec",
        "--cd",
        worktreePath,
        "--dangerously-bypass-approvals-and-sandbox",
        "--output-last-message",
        runPaths.lastMessageFile,
        buildRunnerPrompt(context.issue, context.config),
      ],
      cwd: context.root,
      logFile: runPaths.logFile,
    });

    const commitSha = commitAndPushWorktree(
      worktreePath,
      branch,
      context.issue,
    );
    let pr =
      findOpenPullRequest(context.root, context.config.repository, branch) ??
      createPullRequest({
        root: context.root,
        repository: context.config.repository,
        issue: context.issue,
        branch,
        prBase: context.config.defaultPrBase,
        prBodyFile: runPaths.prBodyFile,
      });
    updatePullRequestBase(
      context.root,
      context.config.repository,
      pr.number,
      context.config.defaultPrBase,
    );
    pr =
      findOpenPullRequest(context.root, context.config.repository, branch) ??
      pr;

    const summary: RunnerRunSummary = {
      status: "success",
      issueNumber: context.issue.number,
      branch,
      worktreePath,
      logFile: runPaths.logFile,
      lastMessageFile: runPaths.lastMessageFile,
      commitSha,
      prUrl: pr.url,
      error: null,
    };
    writeFileSync(
      runPaths.summaryFile,
      JSON.stringify(summary, null, 2),
      "utf8",
    );

    commentOnPr(
      context.root,
      context.config.repository,
      pr.number,
      buildRunnerSuccessComment({
        issue: context.issue,
        branch,
        pr,
        summary,
      }),
    );
    editIssueLabels(
      context.root,
      context.config.repository,
      context.issue.number,
      {
        add: ["human-review"],
        remove: ["agent-running"],
      },
    );
    return summary;
  } catch (error) {
    const summary: RunnerRunSummary = {
      status: "failed",
      issueNumber: context.issue.number,
      branch,
      worktreePath: resolveIssueWorktreePath(context.root, context.issue),
      logFile: runPaths.logFile,
      lastMessageFile: runPaths.lastMessageFile,
      commitSha: null,
      prUrl:
        findOpenPullRequest(context.root, context.config.repository, branch)
          ?.url ?? null,
      error: error instanceof Error ? error.message : String(error),
    };
    writeFileSync(
      runPaths.summaryFile,
      JSON.stringify(summary, null, 2),
      "utf8",
    );
    commentOnIssue(
      context.root,
      context.config.repository,
      context.issue.number,
      buildRunnerFailureComment({
        issue: context.issue,
        branch,
        error: summary.error ?? "unknown runner error",
      }),
    );
    editIssueLabels(
      context.root,
      context.config.repository,
      context.issue.number,
      {
        remove: ["agent-running"],
      },
    );
    return summary;
  }
}

export async function runRunnerOnce(
  options: RunnerOptions = {},
): Promise<RunnerRunSummary[]> {
  const root = resolve(options.root ?? resolveRepoRoot());
  const config = loadWorkflowContract(root);
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const issues = selectRunnableIssues(
    listOpenIssues(root, config.repository),
    config,
  );

  if (issues.length === 0) {
    writeRunnerHeartbeat(root, {
      status: "idle",
      concurrency,
      activeRuns: 0,
      note: "No agent-ready harness issues found.",
    });
    return [
      {
        status: "idle",
        issueNumber: null,
        branch: null,
        worktreePath: null,
        logFile: null,
        lastMessageFile: join(resolveRunRoot(root), "none"),
        commitSha: null,
        prUrl: null,
        error: null,
      },
    ];
  }

  const selectedIssues = issues.slice(0, concurrency);
  writeRunnerHeartbeat(root, {
    status: "running",
    concurrency,
    activeRuns: selectedIssues.length,
    note: `Processing issues ${selectedIssues.map((issue) => `#${issue.number}`).join(", ")}.`,
  });

  const results = await Promise.all(
    selectedIssues.map((issue) =>
      processIssue({
        root,
        config,
        issue,
      }),
    ),
  );

  const failures = results.filter((result) => result.status === "failed");
  writeRunnerHeartbeat(root, {
    status: failures.length > 0 ? "degraded" : "idle",
    concurrency,
    activeRuns: 0,
    note:
      failures.length > 0
        ? `Failures: ${failures.map((result) => `#${result.issueNumber}`).join(", ")}.`
        : `Completed ${results.length} issue run(s).`,
  });
  return results;
}

export async function startRunner(options: RunnerOptions = {}): Promise<void> {
  const root = resolve(options.root ?? resolveRepoRoot());
  const pollIntervalMs = Math.max(
    5_000,
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  );
  while (true) {
    await runRunnerOnce(options);
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, pollIntervalMs),
    );
    writeRunnerHeartbeat(root, {
      status: "polling",
      concurrency: Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY),
      activeRuns: 0,
      note: "Waiting for the next GitHub issue poll.",
    });
  }
}

export function formatRunnerSummaries(results: RunnerRunSummary[]): string {
  return results
    .map((result) => {
      const headline =
        result.status === "idle"
          ? "- idle"
          : `- #${result.issueNumber} ${result.status}`;
      const branchLine = result.branch ? `  branch: ${result.branch}` : null;
      const prLine = result.prUrl ? `  pr: ${result.prUrl}` : null;
      const errorLine = result.error ? `  error: ${result.error}` : null;
      return [headline, branchLine, prLine, errorLine]
        .filter((line) => line !== null)
        .join("\n");
    })
    .join("\n");
}
