import type { LoopBScoreRow } from "../loop_b/minute_accumulator";

export const LOOP_C_SCHEMA_VERSION = "v1" as const;
export const LOOP_C_CANDIDATE_POOL_LATEST_KEY = "loopC:v1:candidates:latest";
export const LOOP_C_CANDIDATE_POOL_DEFAULT_LIMIT = 24;
export const LOOP_C_CANDIDATE_POOL_MAX_LIMIT = 200;

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

function acceptancePriorFromScore(finalScore: number): number {
  const scaled = finalScore / 10;
  return clamp01(1 / (1 + Math.exp(-scaled)));
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
}): LoopCCandidatePool {
  const minute = minuteIdFrom(input.minute);
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
    const curiosity =
      Math.abs(row.contributions.momentum) + row.contributions.activity * 0.2;
    const riskPenalty = Math.max(0, row.contributions.stabilityPenalty);
    const stabilityBonus = Math.max(0, row.contributions.confidence);
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
      revision: row.revision,
      explain: [
        `source=loopB`,
        `score_ref=loopB:v1:scores:latest:pair:${row.pairId}`,
        `evidence_refs=${evidenceRefs.length}`,
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
