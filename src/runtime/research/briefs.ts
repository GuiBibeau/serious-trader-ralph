import { createHash } from "node:crypto";
import type {
  RuntimeResearchSourceKind,
  RuntimeResearchSourceRecord,
} from "../contracts/autonomous_runtime.js";
import type {
  RuntimeResearchSourceAcquisitionRequest,
  RuntimeResearchSourceMaterial,
} from "./source_acquisition.js";
import { normalizeResearchUrl } from "./source_acquisition.js";

export type RuntimeResearchBriefProfileKey =
  | "latest_strategy_papers"
  | "custom";

export type RuntimeResearchBriefRequest = {
  profile?: RuntimeResearchBriefProfileKey;
  title?: string;
  requests?: RuntimeResearchSourceAcquisitionRequest[];
  explicitAllowedHosts?: string[];
  maxSources?: number;
  generatedAt?: string;
};

export type RuntimeResearchBriefSource = {
  sourceId: string;
  sourceKind: RuntimeResearchSourceKind;
  title: string;
  url: string;
  canonicalUrl: string;
  authors: string[];
  publishedAt?: string;
  retrievedAt: string;
  venueKeys: string[];
  assetKeys: string[];
  tags: string[];
  digest: string;
};

export type RuntimeResearchBriefArtifact = {
  briefId: string;
  generatedAt: string;
  profile: RuntimeResearchBriefProfileKey;
  title: string;
  summary: string;
  findings: string[];
  approvedHosts: string[];
  requestCount: number;
  sourceCount: number;
  createdCount: number;
  existingCount: number;
  citations: Array<{
    sourceId: string;
    materialDigest: string;
    notes?: string;
  }>;
  sources: RuntimeResearchBriefSource[];
};

const BUILTIN_RESEARCH_BRIEF_REQUESTS: Record<
  Exclude<RuntimeResearchBriefProfileKey, "custom">,
  RuntimeResearchSourceAcquisitionRequest[]
> = {
  latest_strategy_papers: [
    {
      kind: "paper_feed",
      feedUrl:
        "https://export.arxiv.org/api/query?search_query=all:%22algorithmic+trading%22+OR+all:%22market+microstructure%22+OR+all:%22crypto+trading%22&start=0&max_results=8&sortBy=submittedDate&sortOrder=descending",
      tags: ["strategy-lab", "latest-research", "papers"],
    },
  ],
};

const BUILTIN_APPROVED_HOSTS = new Set([
  "arxiv.org",
  "export.arxiv.org",
  "github.com",
  "raw.githubusercontent.com",
  "station.jup.ag",
  "docs.phoenix.trade",
  "solana.com",
  "www.solana.com",
]);

export function resolveRuntimeResearchBriefRequests(
  input: RuntimeResearchBriefRequest,
): RuntimeResearchSourceAcquisitionRequest[] {
  const profile = input.profile ?? "latest_strategy_papers";
  const builtIn =
    profile === "custom" ? [] : BUILTIN_RESEARCH_BRIEF_REQUESTS[profile];
  return [...builtIn, ...(input.requests ?? [])];
}

export function resolveRuntimeResearchApprovedHosts(
  input: RuntimeResearchBriefRequest,
): string[] {
  return Array.from(
    new Set([
      ...BUILTIN_APPROVED_HOSTS,
      ...(input.explicitAllowedHosts ?? [])
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ]),
  ).sort();
}

export function parseRuntimeResearchBriefRequest(
  input: unknown,
): RuntimeResearchBriefRequest {
  const record = isRecord(input) ? input : {};
  const profile =
    record.profile === "latest_strategy_papers" || record.profile === "custom"
      ? record.profile
      : undefined;
  const requests = Array.isArray(record.requests)
    ? record.requests
        .map(parseSourceAcquisitionRequest)
        .filter(
          (value): value is RuntimeResearchSourceAcquisitionRequest =>
            value !== null,
        )
    : undefined;
  const explicitAllowedHosts = Array.isArray(record.explicitAllowedHosts)
    ? record.explicitAllowedHosts
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    : undefined;
  const title = String(record.title ?? "").trim() || undefined;
  const generatedAt = String(record.generatedAt ?? "").trim() || undefined;
  const maxSources =
    typeof record.maxSources === "number" && Number.isFinite(record.maxSources)
      ? record.maxSources
      : undefined;
  return {
    ...(profile ? { profile } : {}),
    ...(title ? { title } : {}),
    ...(generatedAt ? { generatedAt } : {}),
    ...(typeof maxSources === "number" ? { maxSources } : {}),
    ...(requests && requests.length > 0 ? { requests } : {}),
    ...(explicitAllowedHosts && explicitAllowedHosts.length > 0
      ? { explicitAllowedHosts }
      : {}),
  };
}

export function validateRuntimeResearchBriefRequests(input: {
  requests: RuntimeResearchSourceAcquisitionRequest[];
  approvedHosts: string[];
}) {
  const approvedHosts = new Set(
    input.approvedHosts.map((value) => value.trim().toLowerCase()),
  );
  for (const request of input.requests) {
    const urls =
      request.kind === "paper_feed" ? [request.feedUrl] : [request.url];
    for (const rawUrl of urls) {
      const normalized = normalizeResearchUrl(rawUrl);
      const hostname = new URL(normalized).hostname.toLowerCase();
      if (!approvedHosts.has(hostname)) {
        throw new Error(`research-source-not-allowed:${hostname}`);
      }
    }
  }
}

export function buildRuntimeResearchBrief(input: {
  request: RuntimeResearchBriefRequest;
  sourceMaterials: RuntimeResearchSourceMaterial[];
  createdCount: number;
  existingCount: number;
}): RuntimeResearchBriefArtifact {
  const generatedAt = new Date(
    input.request.generatedAt ?? new Date().toISOString(),
  ).toISOString();
  const profile = input.request.profile ?? "latest_strategy_papers";
  const approvedHosts = resolveRuntimeResearchApprovedHosts(input.request);
  const requestCount = resolveRuntimeResearchBriefRequests(
    input.request,
  ).length;
  const selectedSources = [...input.sourceMaterials]
    .sort(compareSourceMaterialRecency)
    .slice(0, normalizeMaxSources(input.request.maxSources))
    .map(toBriefSource);
  const findings = input.sourceMaterials
    .sort(compareSourceMaterialRecency)
    .slice(0, 3)
    .map((entry) => summarizeSourceMaterial(entry))
    .filter(Boolean);
  const titles = selectedSources.slice(0, 3).map((source) => source.title);
  const summary =
    selectedSources.length === 0
      ? "No approved research sources were retrieved for this brief."
      : [
          `Reviewed ${selectedSources.length} approved sources across ${requestCount} acquisition request${requestCount === 1 ? "" : "s"}.`,
          titles.length > 0
            ? `Most recent coverage: ${titles.join("; ")}.`
            : null,
        ]
          .filter(Boolean)
          .join(" ");
  const title =
    input.request.title?.trim() ||
    (profile === "latest_strategy_papers"
      ? "Latest strategy research brief"
      : "Custom research brief");
  const briefId = `brief_${sha256Hex(
    JSON.stringify({
      profile,
      generatedAt,
      sourceIds: selectedSources.map((source) => source.sourceId),
    }),
  ).slice(0, 20)}`;

  return {
    briefId,
    generatedAt,
    profile,
    title,
    summary,
    findings,
    approvedHosts,
    requestCount,
    sourceCount: selectedSources.length,
    createdCount: input.createdCount,
    existingCount: input.existingCount,
    citations: selectedSources.map((source) => ({
      sourceId: source.sourceId,
      materialDigest: source.digest,
      notes: source.publishedAt
        ? `published ${source.publishedAt}`
        : `retrieved ${source.retrievedAt}`,
    })),
    sources: selectedSources,
  };
}

export function buildRuntimeResearchBriefMarkdown(
  brief: RuntimeResearchBriefArtifact,
): string {
  const lines = [
    `# ${brief.title}`,
    "",
    `- Generated at: ${brief.generatedAt}`,
    `- Profile: ${brief.profile}`,
    `- Sources reviewed: ${brief.sourceCount}`,
    `- Requests executed: ${brief.requestCount}`,
    `- Created sources: ${brief.createdCount}`,
    `- Existing sources refreshed: ${brief.existingCount}`,
    "",
    "## Summary",
    "",
    brief.summary,
    "",
  ];

  if (brief.findings.length > 0) {
    lines.push("## Findings", "");
    for (const finding of brief.findings) {
      lines.push(`- ${finding}`);
    }
    lines.push("");
  }

  lines.push("## Citations", "");
  for (const source of brief.sources) {
    const dating = source.publishedAt
      ? `published ${source.publishedAt}`
      : `retrieved ${source.retrievedAt}`;
    const authors =
      source.authors.length > 0 ? ` by ${source.authors.join(", ")}` : "";
    lines.push(
      `- ${source.title}${authors} (${dating})`,
      `  ${source.canonicalUrl}`,
      `  sourceId: ${source.sourceId}`,
    );
  }
  lines.push("");

  lines.push("## Provenance", "");
  lines.push(
    `- Approved hosts: ${brief.approvedHosts.join(", ") || "none"}`,
    `- Brief id: ${brief.briefId}`,
  );

  return lines.join("\n");
}

function toBriefSource(
  sourceMaterial: RuntimeResearchSourceMaterial,
): RuntimeResearchBriefSource {
  const record = sourceMaterial.record;
  return {
    sourceId: record.sourceId,
    sourceKind: record.sourceKind,
    title: record.title,
    url: record.url,
    canonicalUrl: record.canonicalUrl,
    authors: record.authors,
    publishedAt: record.publishedAt,
    retrievedAt: record.retrievedAt,
    venueKeys: record.venueKeys,
    assetKeys: record.assetKeys,
    tags: record.tags,
    digest: record.contentDigest,
  };
}

function summarizeSourceMaterial(
  sourceMaterial: RuntimeResearchSourceMaterial,
): string {
  const source = toBriefSource(sourceMaterial);
  const sentences = sourceMaterial.contentMaterial
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 24)
    .filter((value) => normalizeText(value) !== normalizeText(source.title));
  const firstSentence =
    sentences[0] ??
    sourceMaterial.contentMaterial
      .replace(source.title, "")
      .trim()
      .slice(0, 180)
      .trim();
  const dating = source.publishedAt
    ? `published ${source.publishedAt}`
    : `retrieved ${source.retrievedAt}`;
  return `${source.title} (${dating}): ${firstSentence}`;
}

function compareSourceMaterialRecency(
  left: RuntimeResearchSourceMaterial,
  right: RuntimeResearchSourceMaterial,
): number {
  return recencyTimestamp(right.record) - recencyTimestamp(left.record);
}

function recencyTimestamp(record: RuntimeResearchSourceRecord): number {
  const value = Date.parse(record.publishedAt ?? record.retrievedAt);
  return Number.isNaN(value) ? 0 : value;
}

function normalizeMaxSources(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 8;
  }
  return Math.max(1, Math.min(20, Math.trunc(value)));
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseSourceAcquisitionRequest(
  input: unknown,
): RuntimeResearchSourceAcquisitionRequest | null {
  if (!isRecord(input) || typeof input.kind !== "string") {
    return null;
  }
  const venueKeys = normalizeStringArray(input.venueKeys);
  const assetKeys = normalizeStringArray(input.assetKeys);
  const tags = normalizeStringArray(input.tags);
  const retrievedAt = String(input.retrievedAt ?? "").trim() || undefined;

  if (input.kind === "manual_url") {
    const url = String(input.url ?? "").trim();
    if (!url) return null;
    const sourceKind = parseResearchSourceKind(input.sourceKind);
    return {
      kind: "manual_url",
      url,
      ...(sourceKind ? { sourceKind } : {}),
      ...(venueKeys.length > 0 ? { venueKeys } : {}),
      ...(assetKeys.length > 0 ? { assetKeys } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(retrievedAt ? { retrievedAt } : {}),
    };
  }

  if (input.kind === "paper_feed") {
    const feedUrl = String(input.feedUrl ?? "").trim();
    if (!feedUrl) return null;
    const maxItems =
      typeof input.maxItems === "number" && Number.isFinite(input.maxItems)
        ? input.maxItems
        : undefined;
    return {
      kind: "paper_feed",
      feedUrl,
      ...(typeof maxItems === "number" ? { maxItems } : {}),
      ...(venueKeys.length > 0 ? { venueKeys } : {}),
      ...(assetKeys.length > 0 ? { assetKeys } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(retrievedAt ? { retrievedAt } : {}),
    };
  }

  if (input.kind === "venue_docs") {
    const url = String(input.url ?? "").trim();
    const venueKey = String(input.venueKey ?? "").trim();
    if (!url || !venueKey) return null;
    const documentKind =
      input.documentKind === "docs" || input.documentKind === "changelog"
        ? input.documentKind
        : undefined;
    const sourceKind = parseResearchSourceKind(input.sourceKind);
    return {
      kind: "venue_docs",
      url,
      venueKey,
      ...(documentKind ? { documentKind } : {}),
      ...(sourceKind ? { sourceKind } : {}),
      ...(venueKeys.length > 0 ? { venueKeys } : {}),
      ...(assetKeys.length > 0 ? { assetKeys } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(retrievedAt ? { retrievedAt } : {}),
    };
  }

  return null;
}

function parseResearchSourceKind(
  input: unknown,
): RuntimeResearchSourceKind | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  switch (input) {
    case "paper":
    case "article":
    case "repository":
    case "dataset":
    case "notebook":
    case "internal_note":
    case "market_report":
      return input;
    default:
      return undefined;
  }
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
