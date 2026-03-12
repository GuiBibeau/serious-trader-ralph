import type {
  RuntimeResearchBriefArtifact,
  RuntimeResearchBriefRequest,
} from "../../../src/runtime/research/briefs.js";
import {
  buildRuntimeResearchBrief,
  buildRuntimeResearchBriefMarkdown,
  resolveRuntimeResearchApprovedHosts,
  resolveRuntimeResearchBriefRequests,
  validateRuntimeResearchBriefRequests,
} from "../../../src/runtime/research/briefs.js";
import type { FetchLike } from "../../../src/runtime/research/source_acquisition.js";
import type { RuntimeResearchSourceRecord } from "./runtime_contracts";
import { acquireAndStoreRuntimeResearchSources } from "./runtime_research_sources";
import type { Env } from "./types";

export type RuntimeResearchBriefWorkflowResult = {
  brief: RuntimeResearchBriefArtifact;
  markdown: string;
  storedSources: RuntimeResearchSourceRecord[];
};

export async function runRuntimeResearchBriefWorkflow(input: {
  env: Env;
  request: RuntimeResearchBriefRequest;
  fetchImpl?: FetchLike;
}): Promise<RuntimeResearchBriefWorkflowResult> {
  const requests = resolveRuntimeResearchBriefRequests(input.request);
  if (requests.length === 0) {
    throw new Error("runtime-research-brief-no-requests");
  }

  const approvedHosts = resolveRuntimeResearchApprovedHosts(input.request);
  validateRuntimeResearchBriefRequests({
    requests,
    approvedHosts,
  });

  const storedSourcesById = new Map<string, RuntimeResearchSourceRecord>();
  const sourceMaterialsById = new Map<
    string,
    { record: RuntimeResearchSourceRecord; contentMaterial: string }
  >();
  let createdCount = 0;
  let existingCount = 0;

  for (const request of requests) {
    const result = await acquireAndStoreRuntimeResearchSources({
      env: input.env,
      request,
      fetchImpl: input.fetchImpl,
    });
    createdCount += result.createdCount;
    existingCount += result.existingCount;
    for (const record of result.records) {
      storedSourcesById.set(record.sourceId, record);
    }
    for (const sourceMaterial of result.sourceMaterials) {
      const current = sourceMaterialsById.get(sourceMaterial.record.sourceId);
      if (
        !current ||
        Date.parse(sourceMaterial.record.retrievedAt) >=
          Date.parse(current.record.retrievedAt)
      ) {
        sourceMaterialsById.set(sourceMaterial.record.sourceId, sourceMaterial);
      }
    }
  }

  const brief = buildRuntimeResearchBrief({
    request: input.request,
    sourceMaterials: Array.from(sourceMaterialsById.values()),
    createdCount,
    existingCount,
  });

  return {
    brief,
    markdown: buildRuntimeResearchBriefMarkdown(brief),
    storedSources: Array.from(storedSourcesById.values()).sort((left, right) =>
      right.retrievedAt.localeCompare(left.retrievedAt),
    ),
  };
}
