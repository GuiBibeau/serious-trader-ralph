import type { AgentMemory, AgentObservation, Env } from "./types";

const MAX_OBSERVATIONS = 50;
const MAX_REFLECTIONS = 20;

const DEFAULT_MEMORY: AgentMemory = {
  thesis: "",
  observations: [],
  reflections: [],
  tradesProposedToday: 0,
  lastTradeDate: "",
  updatedAt: new Date().toISOString(),
  compaction: {
    updatedAt: new Date().toISOString(),
    compactedCount: 0,
    messageWindowCount: 0,
    summaries: [],
  },
};

function memoryKey(tenantId: string): string {
  return `agent:memory:${tenantId}`;
}

function normalizeMemory(value: unknown): AgentMemory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const thesis = typeof row.thesis === "string" ? row.thesis : "";
  const observations = Array.isArray(row.observations)
    ? row.observations.filter(
        (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
  const reflections = Array.isArray(row.reflections)
    ? row.reflections.filter((entry): entry is string => typeof entry === "string")
    : [];
  const tradesProposedToday = Number(row.tradesProposedToday);
  const updatedAt =
    typeof row.updatedAt === "string" && row.updatedAt.trim()
      ? row.updatedAt
      : new Date().toISOString();
  const lastTradeDate =
    typeof row.lastTradeDate === "string" ? row.lastTradeDate : "";

  const compactionRaw =
    row.compaction && typeof row.compaction === "object" && !Array.isArray(row.compaction)
      ? (row.compaction as Record<string, unknown>)
      : null;
  const compactionUpdatedAt =
    typeof compactionRaw?.updatedAt === "string" && compactionRaw.updatedAt.trim()
      ? compactionRaw.updatedAt
      : new Date().toISOString();
  const compactedCount = Number(compactionRaw?.compactedCount);
  const messageWindowCount = Number(compactionRaw?.messageWindowCount);
  const summariesRaw = Array.isArray(compactionRaw?.summaries)
    ? compactionRaw.summaries
    : [];
  const summaries = summariesRaw
    .filter((entry): entry is Record<string, unknown> => {
      return Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);
    })
    .map((entry) => {
      const toStrings = (value: unknown): string[] =>
        Array.isArray(value)
          ? value
              .map((item) => String(item ?? "").trim())
              .filter((item) => item.length > 0)
              .slice(0, 12)
          : [];
      return {
        generatedAt:
          typeof entry.generatedAt === "string" && entry.generatedAt.trim()
            ? entry.generatedAt
            : new Date().toISOString(),
        source: "deterministic" as const,
        compactedMessages: Math.max(
          0,
          Number.isFinite(Number(entry.compactedMessages))
            ? Math.trunc(Number(entry.compactedMessages))
            : 0,
        ),
        facts: toStrings(entry.facts),
        decisions: toStrings(entry.decisions),
        openThreads: toStrings(entry.openThreads),
        riskFlags: toStrings(entry.riskFlags),
        pendingSteering: toStrings(entry.pendingSteering),
      };
    })
    .slice(-12);
  return {
    thesis,
    observations: observations as AgentMemory["observations"],
    reflections,
    tradesProposedToday: Number.isFinite(tradesProposedToday)
      ? Math.max(0, Math.trunc(tradesProposedToday))
      : 0,
    lastTradeDate,
    updatedAt,
    compaction: {
      updatedAt: compactionUpdatedAt,
      compactedCount: Number.isFinite(compactedCount)
        ? Math.max(0, Math.trunc(compactedCount))
        : 0,
      messageWindowCount: Number.isFinite(messageWindowCount)
        ? Math.max(0, Math.trunc(messageWindowCount))
        : 0,
      summaries,
    },
  };
}

async function getAgentMemoryFromD1(
  env: Env,
  tenantId: string,
): Promise<AgentMemory | null> {
  try {
    const row = await env.WAITLIST_DB.prepare(
      `
      SELECT memory_json as memoryJson
      FROM bot_agent_memory
      WHERE bot_id = ?1
      `,
    )
      .bind(tenantId)
      .first();
    if (!row || typeof row !== "object") return null;
    const raw = (row as Record<string, unknown>).memoryJson;
    if (typeof raw !== "string" || !raw.trim()) return null;
    const parsed = JSON.parse(raw) as unknown;
    return normalizeMemory(parsed);
  } catch {
    return null;
  }
}

async function saveAgentMemoryToD1(
  env: Env,
  tenantId: string,
  memory: AgentMemory,
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    `
    INSERT INTO bot_agent_memory (
      bot_id,
      memory_json,
      updated_at
    ) VALUES (?1, ?2, datetime('now'))
    ON CONFLICT(bot_id) DO UPDATE SET
      memory_json = excluded.memory_json,
      updated_at = excluded.updated_at
    `,
  )
    .bind(tenantId, JSON.stringify(memory))
    .run();
}

export async function getAgentMemory(
  env: Env,
  tenantId: string,
): Promise<AgentMemory> {
  const d1Memory = await getAgentMemoryFromD1(env, tenantId);
  if (d1Memory) {
    return { ...d1Memory, updatedAt: new Date().toISOString() };
  }
  const stored = await env.CONFIG_KV.get(memoryKey(tenantId), "json");
  const normalized = normalizeMemory(stored);
  if (normalized) {
    return normalized;
  }
  return { ...DEFAULT_MEMORY, updatedAt: new Date().toISOString() };
}

export async function saveAgentMemory(
  env: Env,
  tenantId: string,
  memory: AgentMemory,
): Promise<void> {
  const next = { ...memory, updatedAt: new Date().toISOString() };
  await saveAgentMemoryToD1(env, tenantId, next).catch(() => {});
  await env.CONFIG_KV.put(
    memoryKey(tenantId),
    JSON.stringify(next),
  );
}

export function appendObservation(
  memory: AgentMemory,
  obs: AgentObservation,
  maxObservations = MAX_OBSERVATIONS,
): AgentMemory {
  const observations = [...memory.observations, obs].slice(-maxObservations);
  return { ...memory, observations };
}

export function updateThesis(memory: AgentMemory, thesis: string): AgentMemory {
  return { ...memory, thesis };
}

export function addReflection(
  memory: AgentMemory,
  reflection: string,
  maxReflections = MAX_REFLECTIONS,
): AgentMemory {
  const reflections = [...memory.reflections, reflection].slice(
    -maxReflections,
  );
  return { ...memory, reflections };
}

export function resetDailyTradeCount(memory: AgentMemory): AgentMemory {
  const today = new Date().toISOString().slice(0, 10);
  if (memory.lastTradeDate !== today) {
    return { ...memory, tradesProposedToday: 0, lastTradeDate: today };
  }
  return memory;
}
