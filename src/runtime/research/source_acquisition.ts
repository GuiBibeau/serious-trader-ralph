import { createHash } from "node:crypto";
import {
  parseRuntimeResearchSourceRecord,
  type RuntimeResearchSourceAcquisitionKind,
  type RuntimeResearchSourceKind,
  type RuntimeResearchSourceRecord,
} from "../contracts/autonomous_runtime.js";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type SourceAcquisitionBase = {
  venueKeys?: string[];
  assetKeys?: string[];
  tags?: string[];
  retrievedAt?: string;
};

export type ManualUrlSourceAcquisitionRequest = SourceAcquisitionBase & {
  kind: "manual_url";
  url: string;
  sourceKind?: RuntimeResearchSourceKind;
};

export type PaperFeedSourceAcquisitionRequest = SourceAcquisitionBase & {
  kind: "paper_feed";
  feedUrl: string;
  maxItems?: number;
};

export type VenueDocsSourceAcquisitionRequest = SourceAcquisitionBase & {
  kind: "venue_docs";
  url: string;
  venueKey: string;
  documentKind?: "docs" | "changelog";
  sourceKind?: RuntimeResearchSourceKind;
};

export type RuntimeResearchSourceAcquisitionRequest =
  | ManualUrlSourceAcquisitionRequest
  | PaperFeedSourceAcquisitionRequest
  | VenueDocsSourceAcquisitionRequest;

type NormalizedResearchSourceInput = {
  acquisitionKind: RuntimeResearchSourceAcquisitionKind;
  collectedFrom: string;
  sourceKind: RuntimeResearchSourceKind;
  title: string;
  url: string;
  canonicalUrl: string;
  authors: string[];
  publishedAt?: string;
  retrievedAt: string;
  hostname: string;
  publisher?: string;
  venueKeys: string[];
  assetKeys: string[];
  tags: string[];
  contentMaterial: string;
};

const DEFAULT_FETCH: FetchLike = async (input, init) => fetch(input, init);
const TRACKING_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "ref",
  "source",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
]);

export async function acquireRuntimeResearchSources(input: {
  request: RuntimeResearchSourceAcquisitionRequest;
  fetchImpl?: FetchLike;
}): Promise<RuntimeResearchSourceRecord[]> {
  const fetchImpl = input.fetchImpl ?? DEFAULT_FETCH;
  const request = input.request;
  const retrievedAt = request.retrievedAt ?? new Date().toISOString();

  if (request.kind === "manual_url") {
    return [
      await acquireHtmlLikeSource({
        fetchImpl,
        acquisitionKind: "manual_url",
        collectedFrom: request.url,
        url: request.url,
        sourceKind: request.sourceKind ?? "article",
        retrievedAt,
        venueKeys: request.venueKeys ?? [],
        assetKeys: request.assetKeys ?? [],
        tags: request.tags ?? [],
      }),
    ];
  }

  if (request.kind === "venue_docs") {
    return [
      await acquireHtmlLikeSource({
        fetchImpl,
        acquisitionKind: "venue_docs",
        collectedFrom: request.url,
        url: request.url,
        sourceKind: request.sourceKind ?? "article",
        retrievedAt,
        venueKeys: [request.venueKey, ...(request.venueKeys ?? [])],
        assetKeys: request.assetKeys ?? [],
        tags: [
          request.documentKind === "changelog"
            ? "venue-changelog"
            : "venue-doc",
          ...(request.tags ?? []),
        ],
      }),
    ];
  }

  return await acquirePaperFeedSources({
    fetchImpl,
    feedUrl: request.feedUrl,
    retrievedAt,
    venueKeys: request.venueKeys ?? [],
    assetKeys: request.assetKeys ?? [],
    tags: request.tags ?? [],
    maxItems: request.maxItems ?? 10,
  });
}

async function acquireHtmlLikeSource(input: {
  fetchImpl: FetchLike;
  acquisitionKind: RuntimeResearchSourceAcquisitionKind;
  collectedFrom: string;
  url: string;
  sourceKind: RuntimeResearchSourceKind;
  retrievedAt: string;
  venueKeys: string[];
  assetKeys: string[];
  tags: string[];
}): Promise<RuntimeResearchSourceRecord> {
  const response = await input.fetchImpl(input.url, {
    headers: {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(
      `research-source-fetch-failed:${response.status}:${input.url}`,
    );
  }
  const html = await response.text();
  const responseUrl = response.url || input.url;
  const title = extractHtmlTitle(html);
  const canonicalUrl = extractCanonicalUrl(html, responseUrl);
  const publishedAt = extractPublishedAt(html);
  const authors = extractAuthors(html);
  const publisher = extractPublisher(html, canonicalUrl);
  const textMaterial = collapseWhitespace(stripTags(html)).slice(0, 4000);

  return createNormalizedResearchSource({
    acquisitionKind: input.acquisitionKind,
    collectedFrom: input.collectedFrom,
    sourceKind: input.sourceKind,
    title,
    url: responseUrl,
    canonicalUrl,
    authors,
    publishedAt,
    retrievedAt: input.retrievedAt,
    hostname: new URL(canonicalUrl).hostname.toLowerCase(),
    publisher,
    venueKeys: input.venueKeys,
    assetKeys: input.assetKeys,
    tags: input.tags,
    contentMaterial: `${title}\n${textMaterial}`,
  });
}

async function acquirePaperFeedSources(input: {
  fetchImpl: FetchLike;
  feedUrl: string;
  retrievedAt: string;
  venueKeys: string[];
  assetKeys: string[];
  tags: string[];
  maxItems: number;
}): Promise<RuntimeResearchSourceRecord[]> {
  const response = await input.fetchImpl(input.feedUrl, {
    headers: {
      accept: "application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(
      `research-feed-fetch-failed:${response.status}:${input.feedUrl}`,
    );
  }
  const xml = await response.text();
  const feedPublisher =
    extractXmlText(xml, "title") ?? new URL(input.feedUrl).hostname;
  const records = new Map<string, RuntimeResearchSourceRecord>();

  for (const entryXml of matchBlocks(xml, "entry").slice(0, input.maxItems)) {
    const title = extractXmlText(entryXml, "title");
    if (!title) continue;
    const entryUrl =
      extractAtomAlternateLink(entryXml) ??
      extractXmlText(entryXml, "id") ??
      input.feedUrl;
    const canonicalUrl = normalizeResearchUrl(entryUrl);
    const publishedAt =
      extractXmlText(entryXml, "published") ??
      extractXmlText(entryXml, "updated");
    const authors = extractXmlAuthors(entryXml);
    const summary = extractXmlText(entryXml, "summary") ?? "";
    const publisher = feedPublisher || new URL(canonicalUrl).hostname;
    const record = createNormalizedResearchSource({
      acquisitionKind: "paper_feed",
      collectedFrom: input.feedUrl,
      sourceKind: "paper",
      title,
      url: entryUrl,
      canonicalUrl,
      authors,
      publishedAt,
      retrievedAt: input.retrievedAt,
      hostname: new URL(canonicalUrl).hostname.toLowerCase(),
      publisher,
      venueKeys: input.venueKeys,
      assetKeys: input.assetKeys,
      tags: input.tags,
      contentMaterial: `${title}\n${summary}`,
    });
    records.set(record.sourceId, record);
  }

  return Array.from(records.values()).sort((left, right) =>
    right.retrievedAt.localeCompare(left.retrievedAt),
  );
}

function createNormalizedResearchSource(
  input: NormalizedResearchSourceInput,
): RuntimeResearchSourceRecord {
  const normalizedTitle = collapseWhitespace(input.title);
  const canonicalUrl = normalizeResearchUrl(input.canonicalUrl);
  const publishedAt = normalizeOptionalIsoDatetime(input.publishedAt);
  const authors = normalizePeople(input.authors);
  const publisher = collapseWhitespace(input.publisher ?? "");
  const stableIdentity = createStableSourceIdentity({
    sourceKind: input.sourceKind,
    canonicalUrl,
    title: normalizedTitle,
    authors,
    publishedAt,
    publisher,
  });
  const sourceId = `source_${input.sourceKind}_${stableIdentity.slice(0, 20)}`;
  return parseRuntimeResearchSourceRecord({
    schemaVersion: "v1",
    sourceId,
    sourceKind: input.sourceKind,
    title: normalizedTitle,
    url: normalizeResearchUrl(input.url),
    canonicalUrl,
    authors,
    publishedAt,
    retrievedAt: normalizeIsoDatetime(input.retrievedAt),
    contentDigest: `sha256:${sha256Hex(
      `${normalizedTitle}\n${canonicalUrl}\n${collapseWhitespace(input.contentMaterial)}`,
    )}`,
    provenance: {
      acquisitionKind: input.acquisitionKind,
      collectedFrom: normalizeResearchUrl(input.collectedFrom),
      hostname: input.hostname.toLowerCase(),
      ...(publisher ? { publisher } : {}),
      firstSeenAt: normalizeIsoDatetime(input.retrievedAt),
      lastSeenAt: normalizeIsoDatetime(input.retrievedAt),
    },
    venueKeys: normalizeKeys(input.venueKeys),
    assetKeys: normalizeKeys(input.assetKeys),
    tags: normalizeTags(input.tags),
  });
}

export function normalizeResearchUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }
  if (
    parsed.hostname === "arxiv.org" &&
    parsed.pathname.startsWith("/pdf/") &&
    parsed.pathname.endsWith(".pdf")
  ) {
    parsed.pathname = parsed.pathname
      .replace(/^\/pdf\//, "/abs/")
      .replace(/\.pdf$/, "");
    parsed.search = "";
  }
  if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function createStableSourceIdentity(input: {
  sourceKind: RuntimeResearchSourceKind;
  canonicalUrl: string;
  title: string;
  authors: string[];
  publishedAt?: string;
  publisher?: string;
}): string {
  const material =
    input.sourceKind === "paper"
      ? [
          input.sourceKind,
          normalizeTextForIdentity(input.title),
          input.authors.map(normalizeTextForIdentity).sort().join("|"),
          input.publishedAt ?? "",
          normalizeTextForIdentity(input.publisher ?? ""),
        ].join("\n")
      : [
          input.sourceKind,
          normalizeTextForIdentity(input.title),
          input.publishedAt ?? "",
          normalizeTextForIdentity(input.canonicalUrl),
        ].join("\n");
  return sha256Hex(material);
}

function normalizeTags(tags: string[]): string[] {
  const values = tags
    .map((tag) => collapseWhitespace(tag).toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(values)).slice(0, 16);
}

function normalizeKeys(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => collapseWhitespace(value)).filter(Boolean)),
  );
}

function normalizePeople(values: string[]): string[] {
  const normalized = values
    .flatMap((value) => value.split(/[,;]+/g))
    .map((value) => collapseWhitespace(value))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeIsoDatetime(value: string): string {
  return new Date(value).toISOString();
}

function normalizeOptionalIsoDatetime(value?: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
}

function extractHtmlTitle(html: string): string {
  return (
    extractMetaContent(html, "property", "og:title") ??
    extractMetaContent(html, "name", "twitter:title") ??
    extractTagText(html, "title") ??
    "Untitled research source"
  );
}

function extractCanonicalUrl(html: string, fallbackUrl: string): string {
  const canonical =
    extractLinkHref(html, "canonical") ??
    extractMetaContent(html, "property", "og:url") ??
    fallbackUrl;
  return normalizeResearchUrl(canonical);
}

function extractPublishedAt(html: string): string | undefined {
  return normalizeOptionalIsoDatetime(
    extractMetaContent(html, "property", "article:published_time") ??
      extractMetaContent(html, "name", "citation_publication_date") ??
      extractMetaContent(html, "name", "dc.date") ??
      extractTimeDatetime(html),
  );
}

function extractAuthors(html: string): string[] {
  const authorContent =
    extractMetaContent(html, "name", "author") ??
    extractMetaContent(html, "property", "article:author") ??
    extractMetaContent(html, "name", "citation_author") ??
    "";
  return normalizePeople(authorContent ? [authorContent] : []);
}

function extractPublisher(
  html: string,
  canonicalUrl: string,
): string | undefined {
  return (
    extractMetaContent(html, "property", "og:site_name") ??
    extractMetaContent(html, "name", "publisher") ??
    new URL(canonicalUrl).hostname
  );
}

function extractTimeDatetime(html: string): string | undefined {
  const match = html.match(/<time[^>]*datetime=["']([^"']+)["'][^>]*>/i);
  return match?.[1]?.trim();
}

function extractMetaContent(
  html: string,
  attrName: "name" | "property",
  attrValue: string,
): string | undefined {
  const re = new RegExp(
    `<meta[^>]*${attrName}=["']${escapeRegex(attrValue)}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const reverseRe = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*${attrName}=["']${escapeRegex(attrValue)}["'][^>]*>`,
    "i",
  );
  return (
    decodeHtmlEntities(
      re.exec(html)?.[1]?.trim() ?? reverseRe.exec(html)?.[1]?.trim() ?? "",
    ) || undefined
  );
}

function extractLinkHref(html: string, relValue: string): string | undefined {
  const re = new RegExp(
    `<link[^>]*rel=["'][^"']*${escapeRegex(relValue)}[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const reverseRe = new RegExp(
    `<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*${escapeRegex(relValue)}[^"']*["'][^>]*>`,
    "i",
  );
  return (
    decodeHtmlEntities(
      re.exec(html)?.[1]?.trim() ?? reverseRe.exec(html)?.[1]?.trim() ?? "",
    ) || undefined
  );
}

function extractTagText(
  xmlOrHtml: string,
  tagName: string,
): string | undefined {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = re.exec(xmlOrHtml);
  if (!match) return undefined;
  return decodeHtmlEntities(collapseWhitespace(stripTags(match[1])));
}

function extractXmlText(xml: string, tagName: string): string | undefined {
  return extractTagText(xml, tagName);
}

function extractXmlAuthors(xml: string): string[] {
  const authors = matchBlocks(xml, "author")
    .map((block) => extractXmlText(block, "name") ?? "")
    .filter(Boolean);
  return normalizePeople(authors);
}

function extractAtomAlternateLink(entryXml: string): string | undefined {
  const linkMatch = entryXml.match(
    /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i,
  );
  if (linkMatch?.[1]) {
    return decodeHtmlEntities(linkMatch[1].trim());
  }
  const hrefFirst = entryXml.match(
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*\/?>/i,
  );
  if (hrefFirst?.[1]) {
    return decodeHtmlEntities(hrefFirst[1].trim());
  }
  return undefined;
}

function matchBlocks(value: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "gi");
  const blocks: string[] = [];
  for (const match of value.matchAll(re)) {
    blocks.push(match[0]);
  }
  return blocks;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function collapseWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function normalizeTextForIdentity(value: string): string {
  return collapseWhitespace(value).toLowerCase();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
