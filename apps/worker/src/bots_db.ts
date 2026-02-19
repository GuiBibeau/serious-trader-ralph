import type { Env } from "./types";

export type OnboardingStatus = "being_onboarded" | "active";

export type UserRow = {
  id: string;
  privyUserId: string;
  onboardingStatus: OnboardingStatus;
  profile: Record<string, unknown> | null;
  createdAt: string;
};

export type BotRow = {
  id: string;
  userId: string;
  name: string;
  enabled: boolean;
  signerType: string;
  privyWalletId: string;
  walletAddress: string;
  lastTickAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizePrivyIdCandidates(privyUserId: string): string[] {
  const trimmedId = privyUserId.trim();
  const normalizedId = trimmedId.startsWith("did:privy:")
    ? trimmedId
    : `did:privy:${trimmedId}`;
  const fallbackId = trimmedId.startsWith("did:privy:")
    ? trimmedId.replace(/^did:privy:/, "")
    : normalizedId;
  return Array.from(new Set([trimmedId, normalizedId, fallbackId])).filter(
    Boolean,
  );
}

function mapUserRow(row: Record<string, unknown>): UserRow {
  const onboardingStatusRaw = String(row.onboardingStatus ?? "being_onboarded");
  const onboardingStatus: OnboardingStatus =
    onboardingStatusRaw === "active" ? "active" : "being_onboarded";
  return {
    id: String(row.id),
    privyUserId: String(row.privyUserId),
    onboardingStatus,
    profile: parseProfile(row.profile),
    createdAt: String(row.createdAt),
  };
}

function mapBotRow(row: Record<string, unknown>): BotRow {
  return {
    id: String(row.id),
    userId: String(row.userId),
    name: String(row.name),
    enabled: Number(row.enabled) === 1,
    signerType: String(row.signerType),
    privyWalletId: String(row.privyWalletId),
    walletAddress: String(row.walletAddress),
    lastTickAt: row.lastTickAt ? String(row.lastTickAt) : null,
    lastError: row.lastError ? String(row.lastError) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function parseProfile(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export async function findUserByPrivyUserId(
  env: Env,
  privyUserId: string,
): Promise<UserRow | null> {
  const ids = normalizePrivyIdCandidates(privyUserId);
  if (ids.length === 0) return null;

  const placeholders = ids.map((_, idx) => `?${idx + 1}`).join(",");
  const existing = (await env.WAITLIST_DB.prepare(
    `SELECT id, privy_user_id as privyUserId, onboarding_status as onboardingStatus, profile, created_at as createdAt FROM users WHERE privy_user_id IN (${placeholders})`,
  )
    .bind(...ids)
    .first()) as unknown;

  if (!existing || typeof existing !== "object") return null;
  return mapUserRow(existing as Record<string, unknown>);
}

export async function upsertUser(
  env: Env,
  privyUserId: string,
): Promise<UserRow> {
  const ids = normalizePrivyIdCandidates(privyUserId);
  const existing = await findUserByPrivyUserId(env, privyUserId);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const normalizedId = ids.find((candidate) =>
    candidate.startsWith("did:privy:"),
  );
  if (!normalizedId) throw new Error("invalid-privy-user-id");
  try {
    await env.WAITLIST_DB.prepare(
      "INSERT INTO users (id, privy_user_id, onboarding_status) VALUES (?1, ?2, 'being_onboarded')",
    )
      .bind(id, normalizedId)
      .run();
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const alreadyExists = rawMessage.includes("UNIQUE constraint failed");
    if (!alreadyExists) throw error;

    const placeholders = ids.map((_, idx) => `?${idx + 1}`).join(",");
    const existing = (await env.WAITLIST_DB.prepare(
      `SELECT id, privy_user_id as privyUserId, onboarding_status as onboardingStatus, profile, created_at as createdAt FROM users WHERE privy_user_id IN (${placeholders})`,
    )
      .bind(...ids)
      .first()) as unknown;

    if (existing && typeof existing === "object") {
      return mapUserRow(existing as Record<string, unknown>);
    }
    throw error;
  }

  return {
    id,
    privyUserId: normalizedId,
    onboardingStatus: "being_onboarded",
    profile: null,
    createdAt: new Date().toISOString(),
  };
}

export async function setUserProfile(
  env: Env,
  userId: string,
  profile: Record<string, unknown>,
): Promise<void> {
  await env.WAITLIST_DB.prepare("UPDATE users SET profile = ?1 WHERE id = ?2")
    .bind(JSON.stringify(profile), userId)
    .run();
}

export async function setUserOnboardingStatus(
  env: Env,
  userId: string,
  onboardingStatus: OnboardingStatus,
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    "UPDATE users SET onboarding_status = ?1 WHERE id = ?2",
  )
    .bind(onboardingStatus, userId)
    .run();
}

export async function listBotsForUser(
  env: Env,
  userId: string,
): Promise<BotRow[]> {
  const result = await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      user_id as userId,
      name,
      enabled,
      signer_type as signerType,
      privy_wallet_id as privyWalletId,
      wallet_address as walletAddress,
      last_tick_at as lastTickAt,
      last_error as lastError,
      created_at as createdAt,
      updated_at as updatedAt
    FROM bots
    WHERE user_id = ?1
    ORDER BY created_at DESC, id DESC
    `,
  )
    .bind(userId)
    .all();

  return (result.results ?? []).map((row) =>
    mapBotRow(row as Record<string, unknown>),
  );
}

export async function listOldestBotsForUser(
  env: Env,
  userId: string,
  limit: number,
): Promise<BotRow[]> {
  const maxLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const result = await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      user_id as userId,
      name,
      enabled,
      signer_type as signerType,
      privy_wallet_id as privyWalletId,
      wallet_address as walletAddress,
      last_tick_at as lastTickAt,
      last_error as lastError,
      created_at as createdAt,
      updated_at as updatedAt
    FROM bots
    WHERE user_id = ?1
    ORDER BY created_at ASC, id ASC
    LIMIT ?2
    `,
  )
    .bind(userId, maxLimit)
    .all();

  return (result.results ?? []).map((row) =>
    mapBotRow(row as Record<string, unknown>),
  );
}

export async function getBotForUser(
  env: Env,
  userId: string,
  botId: string,
): Promise<BotRow | null> {
  const row = (await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      user_id as userId,
      name,
      enabled,
      signer_type as signerType,
      privy_wallet_id as privyWalletId,
      wallet_address as walletAddress,
      last_tick_at as lastTickAt,
      last_error as lastError,
      created_at as createdAt,
      updated_at as updatedAt
    FROM bots
    WHERE id = ?1 AND user_id = ?2
    `,
  )
    .bind(botId, userId)
    .first()) as unknown;

  if (!row || typeof row !== "object") return null;
  return mapBotRow(row as Record<string, unknown>);
}

export async function createBotRow(
  env: Env,
  input: {
    userId: string;
    name: string;
    enabled: boolean;
    signerType: string;
    privyWalletId: string;
    walletAddress: string;
  },
): Promise<BotRow> {
  const id = crypto.randomUUID();
  await env.WAITLIST_DB.prepare(
    `
    INSERT INTO bots (
      id,
      user_id,
      name,
      enabled,
      signer_type,
      privy_wallet_id,
      wallet_address,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
    `,
  )
    .bind(
      id,
      input.userId,
      input.name,
      input.enabled ? 1 : 0,
      input.signerType,
      input.privyWalletId,
      input.walletAddress,
    )
    .run();

  const bot = await getBotForUser(env, input.userId, id);
  if (!bot) throw new Error("bot-create-failed");
  return bot;
}

export async function setBotEnabledForUser(
  env: Env,
  userId: string,
  botId: string,
  enabled: boolean,
): Promise<BotRow> {
  const res = await env.WAITLIST_DB.prepare(
    `
    UPDATE bots
    SET enabled = ?1, updated_at = datetime('now')
    WHERE id = ?2 AND user_id = ?3
    `,
  )
    .bind(enabled ? 1 : 0, botId, userId)
    .run();

  if ((res.meta?.changes ?? 0) <= 0) throw new Error("not-found");

  const bot = await getBotForUser(env, userId, botId);
  if (!bot) throw new Error("not-found");
  return bot;
}

export async function setBotEnabledById(
  env: Env,
  botId: string,
  enabled: boolean,
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    `
    UPDATE bots
    SET enabled = ?1, updated_at = datetime('now')
    WHERE id = ?2
    `,
  )
    .bind(enabled ? 1 : 0, botId)
    .run();
}

export async function getBotById(
  env: Env,
  botId: string,
): Promise<BotRow | null> {
  const row = (await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      user_id as userId,
      name,
      enabled,
      signer_type as signerType,
      privy_wallet_id as privyWalletId,
      wallet_address as walletAddress,
      last_tick_at as lastTickAt,
      last_error as lastError,
      created_at as createdAt,
      updated_at as updatedAt
    FROM bots
    WHERE id = ?1
    `,
  )
    .bind(botId)
    .first()) as unknown;

  if (!row || typeof row !== "object") return null;
  return mapBotRow(row as Record<string, unknown>);
}

export async function listEnabledBots(env: Env, limit = 10): Promise<BotRow[]> {
  const result = await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      user_id as userId,
      name,
      enabled,
      signer_type as signerType,
      privy_wallet_id as privyWalletId,
      wallet_address as walletAddress,
      last_tick_at as lastTickAt,
      last_error as lastError,
      created_at as createdAt,
      updated_at as updatedAt
    FROM bots
    WHERE enabled = 1
    ORDER BY updated_at DESC
    LIMIT ?1
    `,
  )
    .bind(limit)
    .all();

  return (result.results ?? []).map((row) =>
    mapBotRow(row as Record<string, unknown>),
  );
}

export async function recordBotTickResult(
  env: Env,
  input: {
    botId: string;
    ok: boolean;
    error?: string | null;
  },
): Promise<void> {
  const err = (input.error ?? "").slice(0, 500);
  await env.WAITLIST_DB.prepare(
    `
    UPDATE bots
    SET last_tick_at = datetime('now'), last_error = ?1, updated_at = datetime('now')
    WHERE id = ?2
    `,
  )
    .bind(input.ok ? null : err || "tick-failed", input.botId)
    .run();
}
