import type {
  RunnerIssue,
  RunnerPullRequestSummary,
  RunnerRunSummary,
} from "./service.js";

export function buildRunnerSuccessComment(input: {
  issue: RunnerIssue;
  branch: string;
  pr: RunnerPullRequestSummary;
  summary: RunnerRunSummary;
}): string {
  const checksLink = input.pr.checksUrl
    ? `[Latest checks](${input.pr.checksUrl})`
    : "Latest checks: pending";
  return [
    "<!-- harness-runner-status -->",
    "## Harness Runner Status",
    `- Issue: #${input.issue.number}`,
    `- Branch: \`${input.branch}\``,
    `- PR: ${input.pr.url}`,
    `- Preview/proof bundle: pending on CI publication`,
    `- ${checksLink}`,
    `- Commit: \`${input.summary.commitSha ?? "pending"}\``,
    "",
    "CI is expected to attach preview, browser-proof, and artifact links after the PR workflows finish.",
  ].join("\n");
}

export function buildRunnerFailureComment(input: {
  issue: RunnerIssue;
  branch: string;
  error: string;
}): string {
  return [
    "<!-- harness-runner-failure -->",
    "## Harness Runner Failure",
    `- Issue: #${input.issue.number}`,
    `- Branch: \`${input.branch}\``,
    `- Error: ${input.error}`,
    "",
    "The runner removed `agent-running` so the issue can be retried after investigation.",
  ].join("\n");
}
