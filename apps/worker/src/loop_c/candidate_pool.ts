import type { LoopBScoreRow } from "../loop_b/minute_accumulator";

export const LOOP_C_SCHEMA_VERSION = "v1" as const;
export const LOOP_C_CANDIDATE_POOL_LATEST_KEY = "loopC:v1:candidates:latest";
export const LOOP_C_CANDIDATE_POOL_DEFAULT_LIMIT = 24;
export const LOOP_C_CANDIDATE_POOL_MAX_LIMIT = 200;

const KNOWN_PROTOCOLS = ["jupiter", "raydium", "orca", "meteora"] as const;

export type LoopCCandidateFeatureHints = {
  markCount: number;
  volatilityPct: number;
  confidenceAvg: number;
};

export type LoopCCandidateRow = {
  schemaVersion: typeof LOOP_C_SCHEMA_VERSION;
  generatedAt: string;
  minute: string;
  candidateId: string;
  pairId: string;
  baseMint: string;
  quoteMint: string;
  finalScore: number;
  baseSignal: number;
  curiosity: number;
  riskPenalty: number;
  stabilityBonus: number;
  acceptProbPrior: number;
  featuresRef: string;
  scoreRef: string;
  evidenceRefs: string[];
  sourceProtocols: string[];
  freshnessMs: number;
  liquidityScore: number;
  markCount: number;
  volatilityPct: number;
  confidenceAvg: number;
  riskTags: string[];
  stabilityTags: string[];
  revision: number;
  explain: string[];
};

export type LoopCCandidatePool = {
  schemaVersion: typeof LOOP_C_SCHEMA_VERSION;
  generatedAt: string;
  minute: string;
  source: "loopB";
  maxCandidates: number;
  count: number;
  rows: LoopCCandidateRow[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function round(value: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function minuteIdFrom(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

function normalizeEvidenceRefs(input: string[] | undefined): string[] {
  return [...new Set((input ?? []).filter((value) => value.length > 0))].sort();
}

function normalizeStringList(input: string[] | undefined): string[] {
  return [
    ...new Set((input ?? []).map((value) => value.trim()).filter(Boolean)),
  ].sort();
}

function acceptancePriorFromScore(finalScore: number): number {
  const scaled = finalScore / 10;
  return clamp01(1 / (1 + Math.exp(-scaled)));
}

function inferProtocolsFromEvidenceRefs(input: string[]): string[] {
  const lower = input.join(" ").toLowerCase();
  const protocols = KNOWN_PROTOCOLS.filter((protocol) =>
    lower.includes(protocol),
  );
  return protocols.length > 0 ? [...protocols] : [];
}

function parseFeatureHints(input: LoopCCandidateFeatureHints | undefined): {
  markCount: number;
  volatilityPct: number;
  confidenceAvg: number;
} {
  const markCount = Number.isFinite(input?.markCount)
    ? Math.max(0, input?.markCount ?? 0)
    : 0;
  const volatilityPct = Number.isFinite(input?.volatilityPct)
    ? Math.max(0, input?.volatilityPct ?? 0)
    : 0;
  const confidenceAvg = Number.isFinite(input?.confidenceAvg)
    ? clamp01(input?.confidenceAvg ?? 0)
    : 0;
  return {
    markCount,
    volatilityPct,
    confidenceAvg,
  };
}

function deriveRiskTags(input: {
  volatilityPct: number;
  confidenceAvg: number;
  markCount: number;
}): string[] {
  const tags: string[] = [];
  if (input.volatilityPct >= 3) tags.push("high_volatility");
  if (input.confidenceAvg <= 0.7) tags.push("low_confidence");
  if (input.markCount <= 1) tags.push("thin_liquidity");
  return tags;
}

function deriveStabilityTags(input: {
  volatilityPct: number;
  confidenceAvg: number;
  markCount: number;
}): string[] {
  const tags: string[] = [];
  if (input.volatilityPct <= 1) tags.push("low_volatility");
  if (input.confidenceAvg >= 0.9) tags.push("high_confidence");
  if (input.markCount >= 3) tags.push("multi_sample");
  return tags;
}

export function parseLoopCCandidatePoolLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (
    Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed <= LOOP_C_CANDIDATE_POOL_MAX_LIMIT
  ) {
    return parsed;
  }
  return LOOP_C_CANDIDATE_POOL_DEFAULT_LIMIT;
}

export function buildLoopCCandidatePool(input: {
  generatedAt: string;
  minute: string;
  maxCandidates: number;
  scoreRows: LoopBScoreRow[];
  evidenceRefsByPair: Map<string, string[]>;
  featureHintsByPair: Map<string, LoopCCandidateFeatureHints>;
}): LoopCCandidatePool {
  const minute = minuteIdFrom(input.minute);
  const freshnessMs = Math.max(
    0,
    Date.parse(input.generatedAt) - Date.parse(minute),
  );
  const sorted = [...input.scoreRows].sort((a, b) => {
    if (a.finalScore !== b.finalScore) return b.finalScore - a.finalScore;
    if (a.pairId < b.pairId) return -1;
    if (a.pairId > b.pairId) return 1;
    return 0;
  });

  const rows: LoopCCandidateRow[] = [];
  for (const row of sorted.slice(0, input.maxCandidates)) {
    const evidenceRefs = normalizeEvidenceRefs(
      input.evidenceRefsByPair.get(row.pairId),
    );
    const sourceProtocols = inferProtocolsFromEvidenceRefs(evidenceRefs);
    const hints = parseFeatureHints(input.featureHintsByPair.get(row.pairId));

    const curiosity =
      Math.abs(row.contributions.momentum) + row.contributions.activity * 0.2;
    const riskPenalty = Math.max(0, row.contributions.stabilityPenalty);
    const stabilityBonus = Math.max(0, row.contributions.confidence);
    const liquidityScore = hints.markCount * hints.confidenceAvg;
    const riskTags = deriveRiskTags(hints);
    const stabilityTags = deriveStabilityTags(hints);

    const candidate: LoopCCandidateRow = {
      schemaVersion: LOOP_C_SCHEMA_VERSION,
      generatedAt: input.generatedAt,
      minute,
      candidateId: `${minute}:${row.pairId}`,
      pairId: row.pairId,
      baseMint: row.baseMint,
      quoteMint: row.quoteMint,
      finalScore: round(row.finalScore),
      baseSignal: round(row.finalScore),
      curiosity: round(curiosity),
      riskPenalty: round(riskPenalty),
      stabilityBonus: round(stabilityBonus),
      acceptProbPrior: round(acceptancePriorFromScore(row.finalScore)),
      featuresRef: row.featuresRef,
      scoreRef: `loopB:v1:scores:latest:pair:${row.pairId}`,
      evidenceRefs,
      sourceProtocols,
      freshnessMs,
      liquidityScore: round(liquidityScore),
      markCount: hints.markCount,
      volatilityPct: round(hints.volatilityPct),
      confidenceAvg: round(hints.confidenceAvg),
      riskTags,
      stabilityTags,
      revision: row.revision,
      explain: [
        `source=loopB`,
        `score_ref=loopB:v1:scores:latest:pair:${row.pairId}`,
        `evidence_refs=${evidenceRefs.length}`,
        `risk_tags=${riskTags.join("|") || "none"}`,
        `stability_tags=${stabilityTags.join("|") || "none"}`,
      ],
    };
    rows.push(candidate);
  }

  return {
    schemaVersion: LOOP_C_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    minute,
    source: "loopB",
    maxCandidates: input.maxCandidates,
    count: rows.length,
    rows,
  };
}

function parseLoopCCandidateRow(raw: unknown): LoopCCandidateRow | null {
  const row = asRecord(raw);
  if (!row || row.schemaVersion !== LOOP_C_SCHEMA_VERSION) return null;
  if (
    typeof row.generatedAt !== "string" ||
    typeof row.minute !== "string" ||
    typeof row.candidateId !== "string" ||
    typeof row.pairId !== "string" ||
    typeof row.baseMint !== "string" ||
    typeof row.quoteMint !== "string" ||
    typeof row.finalScore !== "number" ||
    typeof row.baseSignal !== "number" ||
    typeof row.curiosity !== "number" ||
    typeof row.riskPenalty !== "number" ||
    typeof row.stabilityBonus !== "number" ||
    typeof row.acceptProbPrior !== "number" ||
    typeof row.featuresRef !== "string" ||
    typeof row.scoreRef !== "string" ||
    typeof row.revision !== "number"
  ) {
    return null;
  }

  return {
    schemaVersion: LOOP_C_SCHEMA_VERSION,
    generatedAt: row.generatedAt,
    minute: row.minute,
    candidateId: row.candidateId,
    pairId: row.pairId,
    baseMint: row.baseMint,
    quoteMint: row.quoteMint,
    finalScore: row.finalScore,
    baseSignal: row.baseSignal,
    curiosity: row.curiosity,
    riskPenalty: row.riskPenalty,
    stabilityBonus: row.stabilityBonus,
    acceptProbPrior: row.acceptProbPrior,
    featuresRef: row.featuresRef,
    scoreRef: row.scoreRef,
    evidenceRefs: Array.isArray(row.evidenceRefs)
      ? row.evidenceRefs.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    sourceProtocols: Array.isArray(row.sourceProtocols)
      ? normalizeStringList(
          row.sourceProtocols.filter(
            (entry): entry is string => typeof entry === "string",
          ),
        )
      : [],
    freshnessMs:
      typeof row.freshnessMs === "number" && Number.isFinite(row.freshnessMs)
        ? Math.max(0, row.freshnessMs)
        : 0,
    liquidityScore:
      typeof row.liquidityScore === "number" &&
      Number.isFinite(row.liquidityScore)
        ? Math.max(0, row.liquidityScore)
        : 0,
    markCount:
      typeof row.markCount === "number" && Number.isFinite(row.markCount)
        ? Math.max(0, Math.floor(row.markCount))
        : 0,
    volatilityPct:
      typeof row.volatilityPct === "number" &&
      Number.isFinite(row.volatilityPct)
        ? Math.max(0, row.volatilityPct)
        : 0,
    confidenceAvg:
      typeof row.confidenceAvg === "number" &&
      Number.isFinite(row.confidenceAvg)
        ? clamp01(row.confidenceAvg)
        : 0,
    riskTags: Array.isArray(row.riskTags)
      ? normalizeStringList(
          row.riskTags.filter(
            (entry): entry is string => typeof entry === "string",
          ),
        )
      : [],
    stabilityTags: Array.isArray(row.stabilityTags)
      ? normalizeStringList(
          row.stabilityTags.filter(
            (entry): entry is string => typeof entry === "string",
          ),
        )
      : [],
    revision: Math.max(0, Math.floor(row.revision)),
    explain: Array.isArray(row.explain)
      ? row.explain.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
}

export function parseLoopCCandidateRows(
  raw: string | null,
): LoopCCandidateRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { rows?: unknown[] };
    if (!Array.isArray(parsed.rows)) return [];
    const rows: LoopCCandidateRow[] = [];
    for (const row of parsed.rows) {
      const parsedRow = parseLoopCCandidateRow(row);
      if (parsedRow) rows.push(parsedRow);
    }
    return rows;
  } catch {
    return [];
  }
}
