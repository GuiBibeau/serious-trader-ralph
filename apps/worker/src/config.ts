import type { Env, LoopConfig } from "./types";

const LEGACY_CONFIG_KEY = "loop:config";

function configKey(tenantId: string): string {
  return `loop:config:${tenantId}`;
}

export async function getLoopConfig(
  env: Env,
  tenantId?: string,
): Promise<LoopConfig> {
  const key = tenantId ? configKey(tenantId) : LEGACY_CONFIG_KEY;
  const stored = await env.CONFIG_KV.get(key, "json");
  if (stored && typeof stored === "object") {
    return stored as LoopConfig;
  }
  const enabledDefault = (env.LOOP_ENABLED_DEFAULT ?? "false") === "true";
  return { enabled: enabledDefault };
}

export async function updateLoopConfig(
  env: Env,
  update: Partial<LoopConfig>,
  tenantId?: string,
): Promise<LoopConfig> {
  const key = tenantId ? configKey(tenantId) : LEGACY_CONFIG_KEY;
  const current = await getLoopConfig(env, tenantId);
  const next: LoopConfig = {
    ...current,
    ...update,
    updatedAt: new Date().toISOString(),
  };
  await env.CONFIG_KV.put(key, JSON.stringify(next));
  return next;
}

export function requireAdmin(request: Request, env: Env): void {
  const token = env.ADMIN_TOKEN;
  if (!token) {
    throw new Error("admin-token-not-configured");
  }
  const auth = request.headers.get("authorization") ?? "";
  const value = auth.replace(/^Bearer\s+/i, "").trim();
  if (!value || value !== token) {
    throw new Error("unauthorized");
  }
}
