import {
  parseRuntimeAssetRecord,
  parseRuntimeBacktestReport,
  parseRuntimeResearchEvidenceBundleRecord,
  parseRuntimeResearchReproducibilityBundleRecord,
} from "../../../src/runtime/contracts/autonomous_runtime.js";
import type {
  RuntimeResearchPolicyGateArtifact,
  RuntimeResearchPolicyGateRequest,
} from "../../../src/runtime/research/policy_gate.js";
import {
  buildRuntimeResearchPolicyGate,
  buildRuntimeResearchPolicyGateMarkdown,
} from "../../../src/runtime/research/policy_gate.js";
import {
  readRuntimeAssetRegistry,
  readRuntimeBacktests,
  readRuntimeResearchRegistry,
} from "./runtime_internal";
import type { Env } from "./types";

export type RuntimeResearchPolicyGateWorkflowResult = {
  policyGate: RuntimeResearchPolicyGateArtifact;
  markdown: string;
};

export async function runRuntimeResearchPolicyGateWorkflow(input: {
  env: Env;
  request: RuntimeResearchPolicyGateRequest;
}): Promise<RuntimeResearchPolicyGateWorkflowResult> {
  const synthesis = input.request.synthesis;
  const strategyKey = synthesis.strategySpecDraft.strategyKey;
  const venueKey = synthesis.evaluationPlan.venueKey;
  const marketType = synthesis.evaluationPlan.marketType;

  const [registryResponse, assetRegistryResponse, backtestsResponse] =
    await Promise.all([
      readRuntimeResearchRegistry({
        env: input.env,
        strategyKey,
        venueKey,
      }),
      readRuntimeAssetRegistry({
        env: input.env,
      }),
      readRuntimeBacktests({
        env: input.env,
        strategyKey,
        venueKey,
        marketType,
      }),
    ]);

  if (!registryResponse.ok) {
    throw new Error(
      String(
        registryResponse.payload.error ??
          "runtime-research-policy-gate-registry-read-failed",
      ),
    );
  }
  if (!assetRegistryResponse.ok) {
    throw new Error(
      String(
        assetRegistryResponse.payload.error ??
          "runtime-research-policy-gate-assets-read-failed",
      ),
    );
  }
  if (!backtestsResponse.ok) {
    throw new Error(
      String(
        backtestsResponse.payload.error ??
          "runtime-research-policy-gate-backtests-read-failed",
      ),
    );
  }

  const rawRegistry = asRecord(registryResponse.payload.registry);
  const rawAssetRegistry = asRecord(assetRegistryResponse.payload.registry);
  const rawAssetRecords = Array.isArray(assetRegistryResponse.payload.assets)
    ? assetRegistryResponse.payload.assets
    : Array.isArray(rawAssetRegistry.assets)
      ? rawAssetRegistry.assets
      : [];
  const assetRecords = rawAssetRecords
    .map((entry) => {
      try {
        return parseRuntimeAssetRecord(entry);
      } catch {
        return null;
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .filter((entry) =>
      synthesis.evaluationPlan.assetKeys.includes(entry.assetKey),
    );
  const evidenceBundles = Array.isArray(rawRegistry.evidenceBundles)
    ? (rawRegistry.evidenceBundles ?? [])
        .map((entry) => {
          try {
            return parseRuntimeResearchEvidenceBundleRecord(entry);
          } catch {
            return null;
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .filter((entry) => entry.strategyKey === strategyKey)
    : [];
  const reproducibilityBundle = Array.isArray(
    rawRegistry.reproducibilityBundles,
  )
    ? (rawRegistry.reproducibilityBundles ?? [])
        .map((entry) => {
          try {
            return parseRuntimeResearchReproducibilityBundleRecord(entry);
          } catch {
            return null;
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .filter((entry) => entry.strategyKey === strategyKey)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    : undefined;
  const rawBacktests = Array.isArray(backtestsResponse.payload.backtests)
    ? backtestsResponse.payload.backtests
    : Array.isArray(backtestsResponse.payload.reports)
      ? backtestsResponse.payload.reports
      : [];
  const backtestReport = rawBacktests
    .map((entry) => {
      try {
        return parseRuntimeBacktestReport(entry);
      } catch {
        return null;
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .filter((entry) => entry.strategyKey === strategyKey)
    .sort((left, right) =>
      right.generatedAt.localeCompare(left.generatedAt),
    )[0];

  const policyGate = buildRuntimeResearchPolicyGate({
    request: {
      ...input.request,
      assetRecords,
      ...(backtestReport ? { backtestReport } : {}),
      ...(reproducibilityBundle ? { reproducibilityBundle } : {}),
      ...(evidenceBundles.length > 0 ? { evidenceBundles } : {}),
    },
  });

  return {
    policyGate,
    markdown: buildRuntimeResearchPolicyGateMarkdown(policyGate),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
