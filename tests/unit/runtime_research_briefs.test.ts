import { describe, expect, test } from "bun:test";
import { parseRuntimeResearchSourceRecord } from "../../src/runtime/contracts/autonomous_runtime.js";
import {
  buildRuntimeResearchBrief,
  buildRuntimeResearchBriefMarkdown,
  parseRuntimeResearchBriefRequest,
  resolveRuntimeResearchBriefRequests,
  validateRuntimeResearchBriefRequests,
} from "../../src/runtime/research/briefs.js";
import type { RuntimeResearchSourceMaterial } from "../../src/runtime/research/source_acquisition.js";

function sourceMaterialFixture(input: {
  sourceId: string;
  title: string;
  url: string;
  publishedAt?: string;
  retrievedAt: string;
  contentMaterial: string;
}): RuntimeResearchSourceMaterial {
  return {
    record: parseRuntimeResearchSourceRecord({
      schemaVersion: "v1",
      sourceId: input.sourceId,
      sourceKind: "article",
      title: input.title,
      url: input.url,
      canonicalUrl: input.url,
      authors: ["Ada Researcher"],
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
      retrievedAt: input.retrievedAt,
      contentDigest: `sha256:${input.sourceId}`,
      provenance: {
        acquisitionKind: "manual_url",
        collectedFrom: input.url,
        hostname: new URL(input.url).hostname,
        publisher: "Research Example",
        firstSeenAt: input.retrievedAt,
        lastSeenAt: input.retrievedAt,
      },
      venueKeys: ["jupiter"],
      assetKeys: ["SOL"],
      tags: ["strategy-lab"],
    }),
    contentMaterial: input.contentMaterial,
  };
}

describe("runtime research briefs", () => {
  test("parses brief requests and preserves explicit source requests", () => {
    const request = parseRuntimeResearchBriefRequest({
      profile: "custom",
      title: "Venue watch",
      explicitAllowedHosts: ["docs.example.com"],
      requests: [
        {
          kind: "venue_docs",
          url: "https://docs.example.com/changelog",
          venueKey: "jupiter",
          documentKind: "changelog",
          tags: ["venue-watch"],
        },
      ],
    });

    expect(request.profile).toBe("custom");
    expect(request.explicitAllowedHosts).toEqual(["docs.example.com"]);
    expect(resolveRuntimeResearchBriefRequests(request)).toEqual([
      {
        kind: "venue_docs",
        url: "https://docs.example.com/changelog",
        venueKey: "jupiter",
        documentKind: "changelog",
        tags: ["venue-watch"],
      },
    ]);
  });

  test("rejects requests outside the approved host set", () => {
    expect(() =>
      validateRuntimeResearchBriefRequests({
        requests: [
          {
            kind: "manual_url",
            url: "https://unapproved.example.com/post",
          },
        ],
        approvedHosts: ["research.example.com"],
      }),
    ).toThrow("research-source-not-allowed:unapproved.example.com");
  });

  test("builds audit-friendly briefs with dates and citations", () => {
    const brief = buildRuntimeResearchBrief({
      request: {
        profile: "custom",
        title: "Latest signal research",
        requests: [
          {
            kind: "manual_url",
            url: "https://research.example.com/posts/momentum-alpha",
          },
        ],
        explicitAllowedHosts: ["research.example.com"],
      },
      sourceMaterials: [
        sourceMaterialFixture({
          sourceId: "source_article_latest",
          title: "Momentum Alpha in Crypto",
          url: "https://research.example.com/posts/momentum-alpha",
          publishedAt: "2026-03-11T08:00:00.000Z",
          retrievedAt: "2026-03-11T12:00:00.000Z",
          contentMaterial:
            "Momentum Alpha in Crypto. Measure momentum across venue fragments and validate liquidity persistence.",
        }),
      ],
      createdCount: 1,
      existingCount: 0,
    });

    expect(brief.summary).toContain("Reviewed 1 approved sources");
    expect(brief.findings[0]).toContain("published 2026-03-11T08:00:00.000Z");
    expect(brief.citations[0]).toEqual({
      sourceId: "source_article_latest",
      materialDigest: "sha256:source_article_latest",
      notes: "published 2026-03-11T08:00:00.000Z",
    });

    const markdown = buildRuntimeResearchBriefMarkdown(brief);
    expect(markdown).toContain("# Latest signal research");
    expect(markdown).toContain("Momentum Alpha in Crypto");
    expect(markdown).toContain(
      "https://research.example.com/posts/momentum-alpha",
    );
  });
});
