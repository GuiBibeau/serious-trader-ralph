import type { Env, LoopConfig, LoopPolicy, StrategyConfig } from "./types";

const LEGACY_CONFIG_KEY = "loop:config";

function parseStoredConfig(value: unknown): LoopConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as LoopConfig;
}

export async function getLoopConfig(
  env: Env,
  tenantId?: string,
): Promise<LoopConfig> {
  // Multi-tenant bot configs live in D1 for strong consistency.
  if (tenantId) {
    const row = (await env.WAITLIST_DB.prepare(
      "SELECT config_json as configJson FROM loop_configs WHERE tenant_id = ?1",
    )
      .bind(tenantId)
      .first()) as unknown;

    if (row && typeof row === "object") {
      const configJson = (row as { configJson?: unknown }).configJson;
      if (typeof configJson === "string" && configJson) {
        try {
          const parsed = JSON.parse(configJson) as unknown;
          const cfg = parseStoredConfig(parsed);
          if (cfg) return cfg;
        } catch {
          // fall through to defaults
        }
      }
    }

    // Backwards compatibility: migrate legacy per-bot KV config on first read.
    const legacyKey = `loop:config:${tenantId}`;
    const legacyStored = await env.CONFIG_KV.get(legacyKey, "json");
    const legacyCfg = parseStoredConfig(legacyStored);
    if (legacyCfg) {
      // Best-effort migration into D1; ignore failures and still return the legacy value.
      await env.WAITLIST_DB.prepare(
        `
        INSERT INTO loop_configs (tenant_id, enabled, config_json, updated_at)
        VALUES (?1, ?2, ?3, datetime('now'))
        ON CONFLICT(tenant_id) DO UPDATE SET
          enabled = excluded.enabled,
          config_json = excluded.config_json,
          updated_at = excluded.updated_at
        `,
      )
        .bind(tenantId, legacyCfg.enabled ? 1 : 0, JSON.stringify(legacyCfg))
        .run()
        .catch(() => {});
      return legacyCfg;
    }

    // Default: disabled unless explicitly configured.
    return { enabled: false };
  }

  // Legacy single-tenant config lives in KV (kept for local dev + backwards compatibility).
  const key = LEGACY_CONFIG_KEY;
  const stored = await env.CONFIG_KV.get(key, "json");
  const parsed = parseStoredConfig(stored);
  if (parsed) return parsed;
  const enabledDefault = (env.LOOP_ENABLED_DEFAULT ?? "false") === "true";
  return { enabled: enabledDefault };
}

export async function updateLoopConfig(
  env: Env,
  update: Partial<LoopConfig>,
  tenantId?: string,
): Promise<LoopConfig> {
  const current = await getLoopConfig(env, tenantId);
  const next: LoopConfig = { ...current, updatedAt: new Date().toISOString() };

  if (typeof update.enabled === "boolean") next.enabled = update.enabled;

  // Deep-merge policy: partial updates preserve existing fields (e.g. changing
  // slippageBps shouldn't wipe simulateOnly).
  if (update.policy !== undefined) {
    next.policy = {
      ...(current.policy ?? {}),
      ...(update.policy as LoopPolicy),
    };
  }

  // Replace strategy entirely: switching from DCA to Rebalance is a full swap.
  if (update.strategy !== undefined) {
    const incoming = update.strategy as StrategyConfig;
    const currentStrat = current.strategy;

    // If the strategy type is unchanged, merge updates to support partial PATCHes
    // (e.g. update mandate/maxSteps without resending the whole strategy).
    if (
      currentStrat &&
      typeof currentStrat === "object" &&
      !Array.isArray(currentStrat) &&
      incoming &&
      typeof incoming === "object" &&
      !Array.isArray(incoming) &&
      (currentStrat as { type?: unknown }).type ===
        (incoming as { type?: unknown }).type
    ) {
      const merged = {
        ...(currentStrat as Record<string, unknown>),
        ...(incoming as Record<string, unknown>),
      };
      // Deep-merge agent toolPolicy so allow/deny edits don't wipe sibling fields.
      if (
        merged.type === "agent" &&
        (currentStrat as { toolPolicy?: unknown }).toolPolicy &&
        (incoming as { toolPolicy?: unknown }).toolPolicy &&
        typeof (currentStrat as { toolPolicy?: unknown }).toolPolicy ===
          "object" &&
        typeof (incoming as { toolPolicy?: unknown }).toolPolicy === "object" &&
        !Array.isArray((currentStrat as { toolPolicy?: unknown }).toolPolicy) &&
        !Array.isArray((incoming as { toolPolicy?: unknown }).toolPolicy)
      ) {
        merged.toolPolicy = {
          ...((currentStrat as { toolPolicy?: Record<string, unknown> })
            .toolPolicy ?? {}),
          ...((incoming as { toolPolicy?: Record<string, unknown> })
            .toolPolicy ?? {}),
        };
      }
      next.strategy = merged as StrategyConfig;
    } else {
      next.strategy = incoming;
    }
  }

  if (tenantId) {
    await env.WAITLIST_DB.prepare(
      `
      INSERT INTO loop_configs (tenant_id, enabled, config_json, updated_at)
      VALUES (?1, ?2, ?3, datetime('now'))
      ON CONFLICT(tenant_id) DO UPDATE SET
        enabled = excluded.enabled,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
      `,
    )
      .bind(tenantId, next.enabled ? 1 : 0, JSON.stringify(next))
      .run();
    return next;
  }

  const key = LEGACY_CONFIG_KEY;
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
