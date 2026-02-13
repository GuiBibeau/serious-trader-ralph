import type { Env } from "../types";

type UpsertFeatureInput = {
  source: string;
  instrument: string;
  feature: string;
  ts: string;
  value: unknown;
  qualityScore?: number | null;
};

export async function upsertFeaturePoint(
  env: Env,
  input: UpsertFeatureInput,
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    `
    INSERT INTO market_features (source, instrument, feature, ts, value_json, quality_score, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
    ON CONFLICT(source, instrument, feature, ts) DO UPDATE SET
      value_json = excluded.value_json,
      quality_score = excluded.quality_score,
      updated_at = excluded.updated_at
    `,
  )
    .bind(
      input.source,
      input.instrument,
      input.feature,
      input.ts,
      JSON.stringify(input.value ?? null),
      input.qualityScore ?? null,
    )
    .run();
}

export async function listFeaturePoints(
  env: Env,
  input: {
    instrument: string;
    feature: string;
    startTs: string;
    endTs: string;
    source?: string;
    limit?: number;
  },
): Promise<Array<{ source: string; ts: string; value: unknown }>> {
  const limit = Math.max(1, Math.min(5000, Math.floor(input.limit ?? 2000)));
  const sql = input.source
    ? `
      SELECT source, ts, value_json as valueJson
      FROM market_features
      WHERE instrument = ?1 AND feature = ?2 AND source = ?3 AND ts >= ?4 AND ts <= ?5
      ORDER BY ts ASC
      LIMIT ?6
    `
    : `
      SELECT source, ts, value_json as valueJson
      FROM market_features
      WHERE instrument = ?1 AND feature = ?2 AND ts >= ?3 AND ts <= ?4
      ORDER BY ts ASC
      LIMIT ?5
    `;

  const result = input.source
    ? await env.WAITLIST_DB.prepare(sql)
        .bind(
          input.instrument,
          input.feature,
          input.source,
          input.startTs,
          input.endTs,
          limit,
        )
        .all()
    : await env.WAITLIST_DB.prepare(sql)
        .bind(input.instrument, input.feature, input.startTs, input.endTs, limit)
        .all();

  return (result.results ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const raw = typeof r.valueJson === "string" ? r.valueJson : "null";
    let value: unknown = null;
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
    return {
      source: String(r.source ?? ""),
      ts: String(r.ts ?? ""),
      value,
    };
  });
}
