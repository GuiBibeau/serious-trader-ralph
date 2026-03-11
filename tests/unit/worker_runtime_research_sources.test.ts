import { describe, expect, test } from "bun:test";
import { parseRuntimeResearchSourceRecord } from "../../apps/worker/src/runtime_contracts";
import { acquireAndStoreRuntimeResearchSources } from "../../apps/worker/src/runtime_research_sources";
import type { Env } from "../../apps/worker/src/types";

describe("worker runtime research source orchestration", () => {
  test("preserves first-seen metadata and collapses canonical duplicates", async () => {
    const existingRecord = parseRuntimeResearchSourceRecord({
      schemaVersion: "v1",
      sourceId: "source_article_existing",
      sourceKind: "article",
      title: "Momentum Alpha in Crypto",
      url: "https://research.example.com/posts/momentum-alpha",
      canonicalUrl: "https://research.example.com/posts/momentum-alpha",
      authors: ["Ada Researcher"],
      publishedAt: "2026-03-01T12:00:00Z",
      retrievedAt: "2026-03-05T12:00:00Z",
      contentDigest: "sha256:old",
      provenance: {
        acquisitionKind: "manual_url",
        collectedFrom: "https://research.example.com/posts/momentum-alpha",
        hostname: "research.example.com",
        publisher: "Research Example",
        firstSeenAt: "2026-03-05T12:00:00Z",
        lastSeenAt: "2026-03-05T12:00:00Z",
      },
      venueKeys: ["jupiter"],
      assetKeys: ["SOL"],
      tags: ["signal"],
    });

    const writes: ReturnType<typeof parseRuntimeResearchSourceRecord>[] = [];

    const result = await acquireAndStoreRuntimeResearchSources({
      env: {} as Env,
      request: {
        kind: "manual_url",
        url: "https://research.example.com/posts/momentum-alpha?utm_source=feed",
        sourceKind: "article",
        venueKeys: ["jupiter"],
        assetKeys: ["SOL"],
        tags: ["signal", "momentum"],
        retrievedAt: "2026-03-10T18:15:00Z",
      },
      fetchImpl: async () =>
        new Response(
          `
            <html>
              <head>
                <title>Momentum Alpha in Crypto</title>
                <link rel="canonical" href="https://research.example.com/posts/momentum-alpha" />
                <meta name="author" content="Ada Researcher" />
              </head>
              <body><p>Updated summary.</p></body>
            </html>
          `,
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      readExistingSources: async () => ({ records: [existingRecord] }),
      writeSource: async ({ sourceRecord }) => {
        const parsed = parseRuntimeResearchSourceRecord(sourceRecord);
        writes.push(parsed);
        return {
          ok: true,
          payload: {
            ok: true,
            created: false,
            sourceRecord: parsed,
          },
        };
      },
    });

    expect(result.createdCount).toBe(0);
    expect(result.existingCount).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].sourceId).toBe("source_article_existing");
    expect(writes[0].provenance.firstSeenAt).toBe("2026-03-05T12:00:00Z");
    expect(writes[0].provenance.lastSeenAt).toBe("2026-03-10T18:15:00.000Z");
    expect(writes[0].tags).toEqual(["signal", "momentum"]);
  });
});
