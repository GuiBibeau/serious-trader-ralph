import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolvePersistedCollectionRecord } from "../../apps/worker/src/runtime_research_curation";
import {
  parseRuntimeAssetRecord,
  parseRuntimeResearchExperimentRecord,
} from "../../src/runtime/contracts/autonomous_runtime.js";

function loadFixture<T>(filename: string): T {
  return JSON.parse(
    readFileSync(
      resolve(
        import.meta.dir,
        "..",
        "..",
        "docs",
        "runtime-contracts",
        "fixtures",
        filename,
      ),
      "utf8",
    ),
  ) as T;
}

describe("resolvePersistedCollectionRecord", () => {
  test("falls back to the original asset when the persisted response uses null optional fields", () => {
    const asset = loadFixture<Record<string, unknown>>(
      "runtime.asset_record.valid.v1.json",
    );
    const persisted = {
      ...asset,
      promotedAt: null,
      pausedAt: null,
      deprecatedAt: null,
    };

    const resolved = resolvePersistedCollectionRecord({
      payloadValue: persisted,
      fallbackValue: parseRuntimeAssetRecord(asset),
      parseItem: parseRuntimeAssetRecord,
    });

    expect(resolved.assetKey).toBe("SOL");
    expect(resolved.aliases).toEqual(["WSOL"]);
  });

  test("falls back to the original experiment when the persisted response adds null citation notes", () => {
    const experiment = loadFixture<Record<string, unknown>>(
      "runtime.research_experiment.valid.v1.json",
    );
    const sourceCitations = Array.isArray(experiment.sourceCitations)
      ? experiment.sourceCitations
      : [];
    const persisted = {
      ...experiment,
      sourceCitations: sourceCitations.map((citation) => ({
        ...citation,
        notes: null,
      })),
    };

    const resolved = resolvePersistedCollectionRecord({
      payloadValue: persisted,
      fallbackValue: parseRuntimeResearchExperimentRecord(experiment),
      parseItem: parseRuntimeResearchExperimentRecord,
    });

    expect(resolved.experimentId).toBe("experiment_signal_trend_shadow");
    expect(resolved.sourceCitations[0]?.sourceId).toBe(
      "source_paper_microstructure",
    );
  });
});
