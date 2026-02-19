import type { Env } from "../types";
import type { ConversationMessage, ConversationSource } from "./types";

function parseSources(value: unknown): ConversationSource[] {
  if (!Array.isArray(value)) return [];
  const out: ConversationSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const type = String(source.type ?? "runtime").trim();
    const label = String(source.label ?? "").trim();
    if (!label) continue;

    out.push({
      type: type as ConversationSource["type"],
      id: typeof source.id === "string" ? source.id : undefined,
      label,
      hint: typeof source.hint === "string" ? source.hint : undefined,
    });
  }
  return out;
}

function toRecord(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  return row as Record<string, unknown>;
}

function mapConversationRow(row: Record<string, unknown>): ConversationMessage {
  return {
    id: Number(row.id ?? 0),
    tenantId: String(row.tenantId ?? ""),
    role: String(row.role ?? "user") as ConversationMessage["role"],
    actor: String(row.actor ?? "user") as ConversationMessage["actor"],
    question: row.question ? String(row.question) : null,
    answer: row.answer ? String(row.answer) : null,
    model: row.model ? String(row.model) : null,
    sources: parseSources(row.sourcesJson),
    createdAt: String(row.createdAt ?? ""),
    error: row.error ? String(row.error) : null,
  };
}

export async function createConversationMessage(
  env: Env,
  input: {
    tenantId: string;
    role: "user" | "assistant";
    actor: "user" | "admin";
    question?: string | null;
    answer?: string | null;
    model?: string | null;
    sources?: ConversationSource[] | null;
    error?: string | null;
  },
): Promise<number> {
  const result = await env.WAITLIST_DB.prepare(
    `
    INSERT INTO bot_conversations (
      tenant_id,
      role,
      actor,
      question,
      answer,
      model,
      sources_json,
      error,
      created_at
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
    `,
  )
    .bind(
      input.tenantId,
      input.role,
      input.actor,
      input.question ?? null,
      input.answer ?? null,
      input.model ?? null,
      input.sources ? JSON.stringify(input.sources) : null,
      input.error ?? null,
    )
    .run();

  return Number(result.meta?.last_row_id ?? 0);
}

export async function listConversationMessages(
  env: Env,
  tenantId: string,
  limit = 50,
): Promise<ConversationMessage[]> {
  const capped = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows =
    (
      await env.WAITLIST_DB.prepare(
        `
    SELECT
      id,
      tenant_id as tenantId,
      role,
      actor,
      question,
      answer,
      model,
      sources_json as sourcesJson,
      created_at as createdAt,
      error
    FROM bot_conversations
    WHERE tenant_id = ?1
    ORDER BY id DESC
    LIMIT ?2
    `,
      )
        .bind(tenantId, capped)
        .all()
    ).results ?? [];

  return rows.map((row) => mapConversationRow(toRecord(row)));
}
