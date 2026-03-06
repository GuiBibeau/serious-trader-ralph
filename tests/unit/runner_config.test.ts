import { expect, test } from "bun:test";
import { parseWorkflowContract } from "../../src/runner/config";

test("parseWorkflowContract reads runner settings from frontmatter", () => {
  const config = parseWorkflowContract(`---
tracker:
  repository: GuiBibeau/serious-trader-ralph
  ready_labels:
    - harness
    - agent-ready
  exclude_labels:
    - blocked
branching:
  branch_prefix: codex/
  branch_format: codex/issue-<number>-<slug>
  default_pr_base: dev
---

# Contract
`);

  expect(config.repository).toBe("GuiBibeau/serious-trader-ralph");
  expect(config.readyLabels).toEqual(["harness", "agent-ready"]);
  expect(config.excludeLabels).toEqual(["blocked"]);
  expect(config.branchPrefix).toBe("codex/");
  expect(config.defaultPrBase).toBe("dev");
});

test("parseWorkflowContract falls back to defaults when frontmatter is absent", () => {
  const config = parseWorkflowContract("# No frontmatter");

  expect(config.repository).toBe("GuiBibeau/serious-trader-ralph");
  expect(config.readyLabels).toEqual(["harness", "agent-ready"]);
  expect(config.excludeLabels).toEqual([
    "blocked",
    "agent-running",
    "human-review",
  ]);
});
