export type RollbackTargetResolution = {
  targetSha: string;
  source: "input" | "previous-main";
};

export function resolveRollbackTarget(input: {
  requestedSha?: string | null;
  previousMainSha?: string | null;
}): RollbackTargetResolution {
  const requested = String(input.requestedSha ?? "").trim();
  if (requested) {
    return {
      targetSha: requested,
      source: "input",
    };
  }
  const previousMainSha = String(input.previousMainSha ?? "").trim();
  if (!previousMainSha) {
    throw new Error("rollback-target-missing");
  }
  return {
    targetSha: previousMainSha,
    source: "previous-main",
  };
}

export function buildRollbackSummary(input: {
  targetSha: string;
  source: "input" | "previous-main";
  portalUrl: string;
  apiUrl: string;
  status: "success" | "failed" | "dry-run";
  reason: string;
}): string {
  return [
    "## Production Rollback",
    `- status: ${input.status}`,
    `- targetSha: ${input.targetSha}`,
    `- source: ${input.source}`,
    `- portalUrl: ${input.portalUrl}`,
    `- apiUrl: ${input.apiUrl}`,
    `- reason: ${input.reason}`,
  ].join("\n");
}
