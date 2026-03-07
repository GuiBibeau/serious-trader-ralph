import type {
  RunnerIssue,
  RunnerPullRequestSummary,
  RunnerRunSummary,
} from "./service.js";

const REQUIRED_CHECKS = [
  "lint",
  "typecheck",
  "unit-tests",
  "integration-tests",
  "terminal-e2e-tests",
  "browser-proof",
  "preview-smoke",
  "artifact-publication",
];

function buildSection(
  title: string,
  markerName: string,
  lines: string[],
): string[] {
  return [
    `### ${title}`,
    `<!-- proof:${markerName}:start -->`,
    ...lines,
    `<!-- proof:${markerName}:end -->`,
    "",
  ];
}

export function buildRunnerSuccessComment(input: {
  issue: RunnerIssue;
  branch: string;
  pr: RunnerPullRequestSummary;
  summary: RunnerRunSummary;
}): string {
  const summaryLines = [
    `- Issue: #${input.issue.number}`,
    `- Branch: \`${input.branch}\``,
    `- PR: ${input.pr.url}`,
    `- Commit: \`${input.summary.commitSha ?? "pending"}\``,
    "- Change summary: pending runner-authored detail or reviewer notes.",
  ];
  const previewLines = [
    "<!-- pr-preview -->",
    "- Portal: pending",
    "- Worker: pending",
    "- Worker name: pending",
    "- Preview metadata artifact: pending",
  ];
  const checkLines = REQUIRED_CHECKS.map((check) => `- ${check}: pending`);
  const artifactLines = [
    "- Workflow run: pending",
    "- Browser proof bundle: pending",
    "- Benchmark bundle: pending",
    "- Browser proof: pending",
    "- Benchmark delta: pending",
  ];
  const canaryLines = [
    "- Status: production canary unchanged until this change reaches `main`.",
  ];
  const riskLines = [
    "- Human review is still required; this handoff stops at `human-review`.",
    "- Issue-specific risk notes are pending and should be updated before merge if the change introduces rollout or contract risk.",
  ];
  return [
    "<!-- harness-proof-bundle -->",
    "## Harness Proof Bundle",
    "",
    ...buildSection("Summary", "summary", summaryLines),
    ...buildSection("Preview", "preview", previewLines),
    ...buildSection("Required Checks", "checks", checkLines),
    ...buildSection("Artifacts", "artifacts", artifactLines),
    ...buildSection("Canary Status", "canary", canaryLines),
    ...buildSection("Risk Notes", "risk", riskLines),
    "",
    "This comment is the single repo-owned handoff summary for runner-created PRs.",
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
