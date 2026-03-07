import { expect, test } from "bun:test";
import {
  buildRunnerFailureComment,
  buildRunnerSuccessComment,
} from "../../src/runner/comments";
import {
  buildIssueBranchName,
  formatRunnerSummaries,
  type RunnerIssue,
  selectRunnableIssues,
  slugifyIssueTitle,
} from "../../src/runner/service";

const config = {
  repository: "GuiBibeau/serious-trader-ralph",
  readyLabels: ["harness", "agent-ready"],
  excludeLabels: ["blocked", "agent-running", "human-review"],
  branchPrefix: "codex/",
  branchFormat: "codex/issue-<number>-<slug>",
  defaultPrBase: "main",
};

function buildIssue(
  number: number,
  title: string,
  labels: string[],
): RunnerIssue {
  return {
    number,
    title,
    body: "",
    url: `https://github.com/GuiBibeau/serious-trader-ralph/issues/${number}`,
    labels,
  };
}

test("selectRunnableIssues requires all ready labels and excludes blocked states", () => {
  const issues = [
    buildIssue(239, "[Runner] Build GitHub Issues adapter", [
      "harness",
      "agent-ready",
    ]),
    buildIssue(240, "[PR Handoff] Standardize proof", ["harness"]),
    buildIssue(241, "[Env Simplification] Remove deprecated lane", [
      "harness",
      "agent-ready",
      "human-review",
    ]),
  ];

  expect(
    selectRunnableIssues(issues, config).map((issue) => issue.number),
  ).toEqual([239]);
});

test("buildIssueBranchName follows the codex issue format", () => {
  expect(
    buildIssueBranchName(
      buildIssue(239, "[Runner] Build GitHub Issues adapter", [
        "harness",
        "agent-ready",
      ]),
      config,
    ),
  ).toBe("codex/issue-239-build-github-issues-adapter");
});

test("slugifyIssueTitle strips bracket prefixes and punctuation", () => {
  expect(slugifyIssueTitle("[Ops] Add kill switches & rollback", 64)).toBe(
    "add-kill-switches-rollback",
  );
});

test("runner comments include the key handoff details", () => {
  const issue = buildIssue(239, "[Runner] Build GitHub Issues adapter", [
    "harness",
    "agent-ready",
  ]);

  const success = buildRunnerSuccessComment({
    issue,
    branch: "codex/issue-239-build-github-issues-adapter",
    pr: {
      number: 250,
      url: "https://github.com/GuiBibeau/serious-trader-ralph/pull/250",
      checksUrl:
        "https://github.com/GuiBibeau/serious-trader-ralph/pull/250/checks",
    },
    summary: {
      status: "success",
      issueNumber: 239,
      branch: "codex/issue-239-build-github-issues-adapter",
      worktreePath: "/tmp/runner/issue-239",
      logFile: "/tmp/runner/log.txt",
      lastMessageFile: "/tmp/runner/last-message.md",
      commitSha: "abc123",
      prUrl: "https://github.com/GuiBibeau/serious-trader-ralph/pull/250",
      error: null,
    },
  });
  const failure = buildRunnerFailureComment({
    issue,
    branch: "codex/issue-239-build-github-issues-adapter",
    error: "codex exec failed",
  });

  expect(success).toContain("Harness Proof Bundle");
  expect(success).toContain("<!-- harness-proof-bundle -->");
  expect(success).toContain("<!-- pr-preview -->");
  expect(success).toContain("- browser-proof: pending");
  expect(success).not.toContain("/tmp/runner");
  expect(failure).toContain("Harness Runner Failure");
  expect(failure).toContain("codex exec failed");
});

test("formatRunnerSummaries prints a compact status list", () => {
  expect(
    formatRunnerSummaries([
      {
        status: "success",
        issueNumber: 239,
        branch: "codex/issue-239-build-github-issues-adapter",
        worktreePath: "/tmp/runner/issue-239",
        logFile: "/tmp/runner/log.txt",
        lastMessageFile: "/tmp/runner/last-message.md",
        commitSha: "abc123",
        prUrl: "https://github.com/GuiBibeau/serious-trader-ralph/pull/250",
        error: null,
      },
    ]),
  ).toContain("#239 success");
});
