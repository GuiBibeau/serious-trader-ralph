import {
  LOOP_B_SCORES_LATEST_KEY,
  type LoopBScoreRow,
} from "../loop_b/minute_accumulator";
import type { Env } from "../types";

const LOOP_C_SCHEMA_VERSION = "v1" as const;
const STATE_KEY = "loop_c:recommender_state:v1";
const DEFAULT_LIMIT = 10;

export const LOOP_C_RECOMMENDER_NAME = "loop-c-recommender-v1";

export type UserPersonaInput = {
  riskBudget?: "low" | "medium" | "high" | number;
  horizon?: "short" | "medium" | "long";
  sectorPreferences?: string[];
  excludedAssets?: string[];
};

export type RecommendationRow = {
  recommendationId: string;
  pairId: string;
  baseMint: string;
  quoteMint: string;
  finalScore: number;
  baseSignal: number;
  riskPenalty: number;
  personaBoost: number;
  modelVersion: typeof LOOP_C_SCHEMA_VERSION;
  explain: string[];
};

export type RecommendationView = {
  schemaVersion: typeof LOOP_C_SCHEMA_VERSION;
  generatedAt: string;
  minute: string;
  userId: string;
  wallet: string;
  freshnessMs: number;
  recommendations: RecommendationRow[];
};

type RecommendationRequest = {
  userId?: string;
  wallet?: string;
  limit?: number;
  observedAt?: string;
  persona?: UserPersonaInput;
};

type RecommenderState = {
  schemaVersion: typeof LOOP_C_SCHEMA_VERSION;
  updatedAt: string;
  lastMinute: string | null;
  cachedView: RecommendationView | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseDefaultLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 100) return parsed;
  return DEFAULT_LIMIT;
}

function toMinuteId(input: string): string | null {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCSeconds(0, 0);
  return parsed.toISOString();
}

function parseScoreRow(raw: unknown): LoopBScoreRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  if (row.schemaVersion !== "v1") return null;
  if (typeof row.pairId !== "string" || !row.pairId) return null;
  if (typeof row.baseMint !== "string" || typeof row.quoteMint !== "string") {
    return null;
  }
  if (typeof row.finalScore !== "number" || !Number.isFinite(row.finalScore)) {
    return null;
  }
  const contributions = asRecord(row.contributions);
  if (!contributions) return null;
  if (
    typeof contributions.momentum !== "number" ||
    typeof contributions.confidence !== "number" ||
    typeof contributions.stabilityPenalty !== "number" ||
    typeof contributions.activity !== "number"
  ) {
    return null;
  }

  return {
    schemaVersion: "v1",
    generatedAt:
      typeof row.generatedAt === "string"
        ? row.generatedAt
        : new Date().toISOString(),
    minute:
      typeof row.minute === "string" ? row.minute : new Date().toISOString(),
    pairId: row.pairId,
    baseMint: row.baseMint,
    quoteMint: row.quoteMint,
    finalScore: row.finalScore,
    contributions: {
      momentum: contributions.momentum,
      confidence: contributions.confidence,
      stabilityPenalty: contributions.stabilityPenalty,
      activity: contributions.activity,
    },
    featuresRef: typeof row.featuresRef === "string" ? row.featuresRef : "",
    revision:
      typeof row.revision === "number" && Number.isInteger(row.revision)
        ? row.revision
        : 0,
    explain: Array.isArray(row.explain)
      ? row.explain.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function parseScoreRows(raw: string | null): LoopBScoreRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { rows?: unknown[] };
    if (!Array.isArray(parsed.rows)) return [];
    const rows: LoopBScoreRow[] = [];
    for (const row of parsed.rows) {
      const parsedRow = parseScoreRow(row);
      if (parsedRow) rows.push(parsedRow);
    }
    return rows;
  } catch {
    return [];
  }
}

function riskMultiplier(input: UserPersonaInput | undefined): number {
  const budget = input?.riskBudget;
  if (budget === "low") return 1.4;
  if (budget === "high") return 0.6;
  if (typeof budget === "number" && Number.isFinite(budget)) {
    return Math.max(0.3, Math.min(2, budget));
  }
  return 1;
}

function normalizeSet(input: string[] | undefined): Set<string> {
  return new Set(
    (input ?? []).map((item) => item.trim()).filter((item) => item.length > 0),
  );
}

function recommendationKey(userId: string, wallet: string): string {
  return `loopC:${LOOP_C_SCHEMA_VERSION}:recs:latest:user:${userId}:wallet:${wallet}`;
}

function sanitizeToken(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function recommendationR2Key(input: {
  minute: string;
  generatedAt: string;
  userId: string;
  wallet: string;
}): string {
  const date = new Date(input.minute);
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const at = input.generatedAt.replaceAll(":", "-");
  return `loopC/${LOOP_C_SCHEMA_VERSION}/recommendations/date=${yyyy}-${mm}-${dd}/hour=${hh}/minute=${yyyy}-${mm}-${dd}T${hh}:${minute}:00Z/user=${sanitizeToken(input.userId)}/wallet=${sanitizeToken(input.wallet)}/at=${at}.json`;
}

function buildRecommendations(input: {
  rows: LoopBScoreRow[];
  userId: string;
  wallet: string;
  limit: number;
  minute: string;
  generatedAt: string;
  persona?: UserPersonaInput;
}): RecommendationView {
  const preferred = normalizeSet(input.persona?.sectorPreferences);
  const excluded = normalizeSet(input.persona?.excludedAssets);
  const risk = riskMultiplier(input.persona);

  const recommendations: RecommendationRow[] = [];
  for (const row of input.rows) {
    if (excluded.has(row.baseMint) || excluded.has(row.quoteMint)) continue;

    const personaBoost =
      preferred.has(row.baseMint) || preferred.has(row.quoteMint) ? 2.5 : 0;
    const riskPenalty = row.contributions.stabilityPenalty * risk;
    const finalScore = row.finalScore + personaBoost - riskPenalty;

    recommendations.push({
      recommendationId: `${input.minute}:${row.pairId}`,
      pairId: row.pairId,
      baseMint: row.baseMint,
      quoteMint: row.quoteMint,
      finalScore: Math.round(finalScore * 1e8) / 1e8,
      baseSignal: row.finalScore,
      riskPenalty: Math.round(riskPenalty * 1e8) / 1e8,
      personaBoost,
      modelVersion: LOOP_C_SCHEMA_VERSION,
      explain: [
        `base_signal=${row.finalScore.toFixed(4)}`,
        `persona_boost=${personaBoost.toFixed(4)}`,
        `risk_penalty=${riskPenalty.toFixed(4)}`,
      ],
    });
  }

  recommendations.sort((a, b) => {
    if (a.finalScore !== b.finalScore) return b.finalScore - a.finalScore;
    if (a.pairId < b.pairId) return -1;
    if (a.pairId > b.pairId) return 1;
    return 0;
  });

  return {
    schemaVersion: LOOP_C_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    minute: input.minute,
    userId: input.userId,
    wallet: input.wallet,
    freshnessMs: Math.max(
      0,
      Date.parse(input.generatedAt) - Date.parse(input.minute),
    ),
    recommendations: recommendations.slice(0, input.limit),
  };
}

function parseState(input: unknown): RecommenderState {
  const record = asRecord(input);
  if (!record || record.schemaVersion !== LOOP_C_SCHEMA_VERSION) {
    return {
      schemaVersion: LOOP_C_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      lastMinute: null,
      cachedView: null,
    };
  }

  const cachedViewRecord = asRecord(record.cachedView);
  let cachedView: RecommendationView | null = null;
  if (cachedViewRecord) {
    const recommendationsRaw = Array.isArray(cachedViewRecord.recommendations)
      ? cachedViewRecord.recommendations
      : [];
    const recommendations: RecommendationRow[] = [];
    for (const item of recommendationsRaw) {
      const row = asRecord(item);
      if (!row) continue;
      if (
        typeof row.recommendationId !== "string" ||
        typeof row.pairId !== "string" ||
        typeof row.baseMint !== "string" ||
        typeof row.quoteMint !== "string" ||
        typeof row.finalScore !== "number" ||
        typeof row.baseSignal !== "number" ||
        typeof row.riskPenalty !== "number" ||
        typeof row.personaBoost !== "number"
      ) {
        continue;
      }
      recommendations.push({
        recommendationId: row.recommendationId,
        pairId: row.pairId,
        baseMint: row.baseMint,
        quoteMint: row.quoteMint,
        finalScore: row.finalScore,
        baseSignal: row.baseSignal,
        riskPenalty: row.riskPenalty,
        personaBoost: row.personaBoost,
        modelVersion:
          row.modelVersion === LOOP_C_SCHEMA_VERSION
            ? LOOP_C_SCHEMA_VERSION
            : "v1",
        explain: Array.isArray(row.explain)
          ? row.explain.filter(
              (entry): entry is string => typeof entry === "string",
            )
          : [],
      });
    }

    if (
      typeof cachedViewRecord.generatedAt === "string" &&
      typeof cachedViewRecord.minute === "string" &&
      typeof cachedViewRecord.userId === "string" &&
      typeof cachedViewRecord.wallet === "string" &&
      typeof cachedViewRecord.freshnessMs === "number"
    ) {
      cachedView = {
        schemaVersion: LOOP_C_SCHEMA_VERSION,
        generatedAt: cachedViewRecord.generatedAt,
        minute: cachedViewRecord.minute,
        userId: cachedViewRecord.userId,
        wallet: cachedViewRecord.wallet,
        freshnessMs: cachedViewRecord.freshnessMs,
        recommendations,
      };
    }
  }

  return {
    schemaVersion: LOOP_C_SCHEMA_VERSION,
    updatedAt:
      typeof record.updatedAt === "string"
        ? record.updatedAt
        : new Date().toISOString(),
    lastMinute:
      typeof record.lastMinute === "string" ? record.lastMinute : null,
    cachedView,
  };
}

type RecommenderDeps = {
  now?: () => string;
};

export class Recommender {
  private readonly now: () => string;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    deps: RecommenderDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  private async readState(): Promise<RecommenderState> {
    const raw = await this.state.storage.get(STATE_KEY);
    return parseState(raw);
  }

  private async writeState(next: RecommenderState): Promise<void> {
    await this.state.storage.put(STATE_KEY, next);
  }

  private async handleRecommend(request: Request): Promise<Response> {
    const payload = (await request.json()) as RecommendationRequest;
    const userId = String(payload.userId ?? "").trim();
    const wallet = String(payload.wallet ?? "").trim();
    if (!userId || !wallet) {
      return new Response(
        JSON.stringify({ ok: false, error: "missing-user-or-wallet" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const observedAt = payload.observedAt ?? this.now();
    const minute = toMinuteId(observedAt);
    if (!minute) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid-observedAt" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const limit = Number.isFinite(payload.limit)
      ? Math.max(1, Math.min(50, Math.floor(payload.limit ?? DEFAULT_LIMIT)))
      : parseDefaultLimit(this.env.LOOP_C_RECOMMENDER_DEFAULT_LIMIT);

    const state = await this.readState();
    if (
      state.lastMinute === minute &&
      state.cachedView &&
      state.cachedView.userId === userId &&
      state.cachedView.wallet === wallet
    ) {
      return new Response(
        JSON.stringify({ ok: true, cacheHit: true, view: state.cachedView }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const scoreRows = parseScoreRows(
      this.env.CONFIG_KV
        ? await this.env.CONFIG_KV.get(LOOP_B_SCORES_LATEST_KEY)
        : null,
    );
    const view = buildRecommendations({
      rows: scoreRows,
      userId,
      wallet,
      limit,
      minute,
      generatedAt: observedAt,
      persona: payload.persona,
    });

    const nextState: RecommenderState = {
      schemaVersion: LOOP_C_SCHEMA_VERSION,
      updatedAt: observedAt,
      lastMinute: minute,
      cachedView: view,
    };
    await this.writeState(nextState);

    if (this.env.CONFIG_KV) {
      await this.env.CONFIG_KV.put(
        recommendationKey(userId, wallet),
        JSON.stringify(view),
      );
    }
    if (this.env.LOGS_BUCKET) {
      await this.env.LOGS_BUCKET.put(
        recommendationR2Key({
          minute,
          generatedAt: observedAt,
          userId,
          wallet,
        }),
        JSON.stringify(view),
      );
    }

    return new Response(JSON.stringify({ ok: true, cacheHit: false, view }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method === "POST" &&
      (url.pathname === "/loop-c/recommend" ||
        url.pathname === "/internal/loop-c/recommend")
    ) {
      return await this.handleRecommend(request);
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/loop-c/state" ||
        url.pathname === "/internal/loop-c/state")
    ) {
      const state = await this.readState();
      return new Response(JSON.stringify({ ok: true, state }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "not-found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
}

export async function requestLoopCRecommendations(
  env: Env,
  input: {
    userId: string;
    wallet: string;
    limit?: number;
    observedAt?: string;
    persona?: UserPersonaInput;
  },
): Promise<RecommendationView | null> {
  if (!env.LOOP_C_RECOMMENDER_DO) return null;
  const enabled = String(env.LOOP_C_RECOMMENDER_ENABLED ?? "0").trim() === "1";
  if (!enabled) return null;

  const id = env.LOOP_C_RECOMMENDER_DO.idFromName(
    `${input.userId.trim()}:${input.wallet.trim()}`,
  );
  const stub = env.LOOP_C_RECOMMENDER_DO.get(id);
  const response = await stub.fetch("https://internal/loop-c/recommend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`loop-c-recommendation-request-failed:${response.status}`);
  }
  const payload = (await response.json()) as {
    ok: boolean;
    view?: RecommendationView;
  };
  return payload.ok && payload.view ? payload.view : null;
}
