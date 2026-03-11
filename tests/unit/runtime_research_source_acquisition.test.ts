import { describe, expect, test } from "bun:test";
import {
  acquireRuntimeResearchSources,
  normalizeResearchUrl,
} from "../../src/runtime/research/source_acquisition.js";

describe("runtime research source acquisition", () => {
  test("acquires and normalizes a manual URL source", async () => {
    const html = `
      <html>
        <head>
          <title> Momentum Alpha in Crypto </title>
          <link rel="canonical" href="https://research.example.com/posts/momentum-alpha?utm_source=feed" />
          <meta name="author" content="Ada Researcher, Ben Builder" />
          <meta property="article:published_time" content="2026-03-01T12:00:00Z" />
          <meta property="og:site_name" content="Research Example" />
        </head>
        <body>
          <article>
            <p>Measure momentum across venue fragments and validate liquidity persistence.</p>
          </article>
        </body>
      </html>
    `;

    const [record] = await acquireRuntimeResearchSources({
      request: {
        kind: "manual_url",
        url: "https://research.example.com/posts/momentum-alpha?utm_source=newsletter",
        sourceKind: "article",
        venueKeys: ["jupiter"],
        assetKeys: ["SOL", "USDC"],
        tags: ["Momentum", "signal"],
        retrievedAt: "2026-03-10T18:00:00Z",
      },
      fetchImpl: async () =>
        new Response(html, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });

    expect(record.sourceKind).toBe("article");
    expect(record.title).toBe("Momentum Alpha in Crypto");
    expect(record.url).toBe(
      "https://research.example.com/posts/momentum-alpha",
    );
    expect(record.canonicalUrl).toBe(
      "https://research.example.com/posts/momentum-alpha",
    );
    expect(record.provenance.acquisitionKind).toBe("manual_url");
    expect(record.provenance.publisher).toBe("Research Example");
    expect(record.provenance.hostname).toBe("research.example.com");
    expect(record.provenance.firstSeenAt).toBe("2026-03-10T18:00:00.000Z");
    expect(record.publishedAt).toBe("2026-03-01T12:00:00.000Z");
    expect(record.authors).toEqual(["Ada Researcher", "Ben Builder"]);
    expect(record.tags).toEqual(["momentum", "signal"]);
  });

  test("deduplicates mirrored papers from an atom feed", async () => {
    const xml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Crypto Papers</title>
        <entry>
          <title>Microstructure Alpha</title>
          <id>http://arxiv.org/abs/2603.12345</id>
          <published>2026-03-02T00:00:00Z</published>
          <author><name>Ada Researcher</name></author>
          <author><name>Ben Builder</name></author>
          <summary>Signals from order flow imbalance.</summary>
          <link rel="alternate" href="https://arxiv.org/abs/2603.12345?utm_source=rss" />
        </entry>
        <entry>
          <title>Microstructure Alpha</title>
          <id>http://arxiv.org/pdf/2603.12345.pdf</id>
          <published>2026-03-02T00:00:00Z</published>
          <author><name>Ada Researcher</name></author>
          <author><name>Ben Builder</name></author>
          <summary>Signals from order flow imbalance.</summary>
          <link rel="alternate" href="https://arxiv.org/pdf/2603.12345.pdf" />
        </entry>
        <entry>
          <title>Cross-Venue Liquidity Rotation</title>
          <id>http://arxiv.org/abs/2603.54321</id>
          <published>2026-03-03T00:00:00Z</published>
          <author><name>Caro Quant</name></author>
          <summary>Execution quality across venues.</summary>
          <link rel="alternate" href="https://arxiv.org/abs/2603.54321" />
        </entry>
      </feed>
    `;

    const records = await acquireRuntimeResearchSources({
      request: {
        kind: "paper_feed",
        feedUrl: "https://export.arxiv.org/api/query?search_query=all:crypto",
        venueKeys: ["jupiter"],
        assetKeys: ["SOL"],
        tags: ["papers", "microstructure"],
        retrievedAt: "2026-03-10T18:05:00Z",
      },
      fetchImpl: async () =>
        new Response(xml, {
          status: 200,
          headers: { "content-type": "application/atom+xml" },
        }),
    });

    expect(records).toHaveLength(2);
    expect(records[0].sourceKind).toBe("paper");
    expect(records[0].provenance.acquisitionKind).toBe("paper_feed");
    expect(records[0].provenance.collectedFrom).toBe(
      "https://export.arxiv.org/api/query?search_query=all:crypto",
    );
    expect(records[0].canonicalUrl).toBe("https://arxiv.org/abs/2603.12345");
    expect(records[0].authors).toEqual(["Ada Researcher", "Ben Builder"]);
  });

  test("marks venue documentation sources with venue tags and provenance", async () => {
    const html = `
      <html>
        <head>
          <title>Jupiter Changelog: Route freshness update</title>
          <meta property="article:published_time" content="2026-03-08T09:30:00Z" />
        </head>
        <body>
          <p>Freshness thresholds changed for route computation.</p>
        </body>
      </html>
    `;

    const [record] = await acquireRuntimeResearchSources({
      request: {
        kind: "venue_docs",
        url: "https://station.jup.ag/changelog/route-freshness?utm_medium=email",
        venueKey: "jupiter",
        assetKeys: ["SOL", "USDC"],
        documentKind: "changelog",
        tags: ["ops"],
        retrievedAt: "2026-03-10T18:10:00Z",
      },
      fetchImpl: async () =>
        new Response(html, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });

    expect(record.provenance.acquisitionKind).toBe("venue_docs");
    expect(record.venueKeys).toEqual(["jupiter"]);
    expect(record.tags).toEqual(["venue-changelog", "ops"]);
    expect(record.publishedAt).toBe("2026-03-08T09:30:00.000Z");
    expect(record.url).toBe("https://station.jup.ag/changelog/route-freshness");
  });

  test("normalizes tracked research URLs", () => {
    expect(
      normalizeResearchUrl(
        "https://arxiv.org/pdf/2603.12345.pdf?utm_source=rss#section",
      ),
    ).toBe("https://arxiv.org/abs/2603.12345");
    expect(
      normalizeResearchUrl(
        "https://example.com/post/alpha/?utm_source=test&ref=feed",
      ),
    ).toBe("https://example.com/post/alpha");
  });
});
