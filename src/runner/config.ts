import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

type WorkflowFrontmatter = {
  tracker?: {
    repository?: string;
    ready_labels?: string[];
    exclude_labels?: string[];
  };
  branching?: {
    branch_prefix?: string;
    branch_format?: string;
    default_pr_base?: string;
  };
};

export type RunnerWorkflowConfig = {
  repository: string;
  readyLabels: string[];
  excludeLabels: string[];
  branchPrefix: string;
  branchFormat: string;
  defaultPrBase: string;
};

const DEFAULT_CONFIG: RunnerWorkflowConfig = {
  repository: "GuiBibeau/serious-trader-ralph",
  readyLabels: ["harness", "agent-ready"],
  excludeLabels: ["blocked", "agent-running", "human-review"],
  branchPrefix: "codex/",
  branchFormat: "codex/issue-<number>-<slug>",
  defaultPrBase: "main",
};

function coerceStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
}

export function parseWorkflowContract(contents: string): RunnerWorkflowConfig {
  const match = contents.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return { ...DEFAULT_CONFIG };
  }

  const frontmatter = (parse(match[1]) ?? {}) as WorkflowFrontmatter;
  return {
    repository:
      String(frontmatter.tracker?.repository ?? "").trim() ||
      DEFAULT_CONFIG.repository,
    readyLabels:
      coerceStringList(frontmatter.tracker?.ready_labels).length > 0
        ? coerceStringList(frontmatter.tracker?.ready_labels)
        : [...DEFAULT_CONFIG.readyLabels],
    excludeLabels:
      coerceStringList(frontmatter.tracker?.exclude_labels).length > 0
        ? coerceStringList(frontmatter.tracker?.exclude_labels)
        : [...DEFAULT_CONFIG.excludeLabels],
    branchPrefix:
      String(frontmatter.branching?.branch_prefix ?? "").trim() ||
      DEFAULT_CONFIG.branchPrefix,
    branchFormat:
      String(frontmatter.branching?.branch_format ?? "").trim() ||
      DEFAULT_CONFIG.branchFormat,
    defaultPrBase:
      String(frontmatter.branching?.default_pr_base ?? "").trim() ||
      DEFAULT_CONFIG.defaultPrBase,
  };
}

export function loadWorkflowContract(root: string): RunnerWorkflowConfig {
  const filePath = join(resolve(root), "WORKFLOW.md");
  const contents = readFileSync(filePath, "utf8");
  return parseWorkflowContract(contents);
}
