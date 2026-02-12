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
};

function memoryKey(tenantId: string): string {
  return `agent:memory:${tenantId}`;
}

export async function getAgentMemory(
  env: Env,
  tenantId: string,
): Promise<AgentMemory> {
  const stored = await env.CONFIG_KV.get(memoryKey(tenantId), "json");
  if (stored && typeof stored === "object") {
    return stored as AgentMemory;
  }
  return { ...DEFAULT_MEMORY, updatedAt: new Date().toISOString() };
}

export async function saveAgentMemory(
  env: Env,
  tenantId: string,
  memory: AgentMemory,
): Promise<void> {
  await env.CONFIG_KV.put(
    memoryKey(tenantId),
    JSON.stringify({ ...memory, updatedAt: new Date().toISOString() }),
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
