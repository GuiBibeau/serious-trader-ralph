import type { Env, LoopConfig } from "./types";

const CONFIG_KEY = "loop:config";

export async function getLoopConfig(env: Env): Promise<LoopConfig> {
  const stored = await env.CONFIG_KV.get(CONFIG_KEY, "json");
  if (stored && typeof stored === "object") {
    return stored as LoopConfig;
  }
  const enabledDefault = (env.LOOP_ENABLED_DEFAULT ?? "false") === "true";
  return { enabled: enabledDefault };
}

export async function updateLoopConfig(
  env: Env,
  update: Partial<LoopConfig>,
): Promise<LoopConfig> {
  const current = await getLoopConfig(env);
  const next: LoopConfig = {
    ...current,
    ...update,
    updatedAt: new Date().toISOString(),
  };
  await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(next));
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
