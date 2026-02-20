import type { Env } from "./types";

export type OnboardingStatus = "being_onboarded" | "active";
export type ExperienceLevel = "beginner" | "intermediate" | "pro" | "degen";
export type LevelSource = "auto" | "manual";

export type UserRow = {
  id: string;
  privyUserId: string;
  onboardingStatus: OnboardingStatus;
  profile: Record<string, unknown> | null;
  signerType: string | null;
  privyWalletId: string | null;
  walletAddress: string | null;
  walletMigratedAt: string | null;
  experienceLevel: ExperienceLevel;
  levelSource: LevelSource;
  onboardingCompletedAt: string | null;
  onboardingVersion: number;
  feedSeedVersion: number;
  degenAcknowledgedAt: string | null;
  createdAt: string;
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

function parseProfile(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function mapUserRow(row: Record<string, unknown>): UserRow {
  const onboardingStatusRaw = String(row.onboardingStatus ?? "being_onboarded");
  const onboardingStatus: OnboardingStatus =
    onboardingStatusRaw === "active" ? "active" : "being_onboarded";
  const signerTypeRaw = String(row.signerType ?? "").trim();
  const privyWalletIdRaw = String(row.privyWalletId ?? "").trim();
  const walletAddressRaw = String(row.walletAddress ?? "").trim();
  const walletMigratedAtRaw = String(row.walletMigratedAt ?? "").trim();
  const experienceLevelRaw = String(row.experienceLevel ?? "beginner").trim();
  const levelSourceRaw = String(row.levelSource ?? "auto").trim();
  const onboardingCompletedAtRaw = String(
    row.onboardingCompletedAt ?? "",
  ).trim();
  const degenAcknowledgedAtRaw = String(row.degenAcknowledgedAt ?? "").trim();
  const onboardingVersionRaw = Number(row.onboardingVersion);
  const feedSeedVersionRaw = Number(row.feedSeedVersion);

  return {
    id: String(row.id),
    privyUserId: String(row.privyUserId),
    onboardingStatus,
    profile: parseProfile(row.profile),
    signerType: signerTypeRaw ? signerTypeRaw : null,
    privyWalletId: privyWalletIdRaw ? privyWalletIdRaw : null,
    walletAddress: walletAddressRaw ? walletAddressRaw : null,
    walletMigratedAt: walletMigratedAtRaw ? walletMigratedAtRaw : null,
    experienceLevel:
      experienceLevelRaw === "beginner" ||
      experienceLevelRaw === "intermediate" ||
      experienceLevelRaw === "pro" ||
      experienceLevelRaw === "degen"
        ? experienceLevelRaw
        : "beginner",
    levelSource:
      levelSourceRaw === "manual" || levelSourceRaw === "auto"
        ? levelSourceRaw
        : "auto",
    onboardingCompletedAt: onboardingCompletedAtRaw
      ? onboardingCompletedAtRaw
      : null,
    onboardingVersion:
      Number.isFinite(onboardingVersionRaw) && onboardingVersionRaw > 0
        ? Math.floor(onboardingVersionRaw)
        : 1,
    feedSeedVersion:
      Number.isFinite(feedSeedVersionRaw) && feedSeedVersionRaw > 0
        ? Math.floor(feedSeedVersionRaw)
        : 1,
    degenAcknowledgedAt: degenAcknowledgedAtRaw ? degenAcknowledgedAtRaw : null,
    createdAt: String(row.createdAt),
  };
}

async function findUserByPrivyUserIdCandidates(
  env: Env,
  ids: string[],
): Promise<UserRow | null> {
  if (ids.length === 0) return null;
  const placeholders = ids.map((_, idx) => `?${idx + 1}`).join(",");
  const existing = (await env.WAITLIST_DB.prepare(
    `
    SELECT
      id,
      privy_user_id as privyUserId,
      onboarding_status as onboardingStatus,
      profile,
      signer_type as signerType,
      privy_wallet_id as privyWalletId,
      wallet_address as walletAddress,
      wallet_migrated_at as walletMigratedAt,
      experience_level as experienceLevel,
      level_source as levelSource,
      onboarding_completed_at as onboardingCompletedAt,
      onboarding_version as onboardingVersion,
      feed_seed_version as feedSeedVersion,
      degen_acknowledged_at as degenAcknowledgedAt,
      created_at as createdAt
    FROM users
    WHERE privy_user_id IN (${placeholders})
    `,
  )
    .bind(...ids)
    .first()) as unknown;
  if (!existing || typeof existing !== "object") return null;
  return mapUserRow(existing as Record<string, unknown>);
}

export async function findUserByPrivyUserId(
  env: Env,
  privyUserId: string,
): Promise<UserRow | null> {
  return findUserByPrivyUserIdCandidates(
    env,
    normalizePrivyIdCandidates(privyUserId),
  );
}

export async function upsertUser(
  env: Env,
  privyUserId: string,
): Promise<UserRow> {
  const ids = normalizePrivyIdCandidates(privyUserId);
  const existing = await findUserByPrivyUserIdCandidates(env, ids);
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
    const raced = await findUserByPrivyUserIdCandidates(env, ids);
    if (raced) return raced;
    throw error;
  }

  return {
    id,
    privyUserId: normalizedId,
    onboardingStatus: "being_onboarded",
    profile: null,
    signerType: null,
    privyWalletId: null,
    walletAddress: null,
    walletMigratedAt: null,
    experienceLevel: "beginner",
    levelSource: "auto",
    onboardingCompletedAt: null,
    onboardingVersion: 1,
    feedSeedVersion: 1,
    degenAcknowledgedAt: null,
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

export async function setUserWallet(
  env: Env,
  input: {
    userId: string;
    signerType: string;
    privyWalletId: string;
    walletAddress: string;
    walletMigratedAt?: string | null;
  },
): Promise<void> {
  const walletMigratedAt = input.walletMigratedAt ?? new Date().toISOString();
  await env.WAITLIST_DB.prepare(
    `
    UPDATE users
    SET
      signer_type = ?1,
      privy_wallet_id = ?2,
      wallet_address = ?3,
      wallet_migrated_at = ?4
    WHERE id = ?5
    `,
  )
    .bind(
      input.signerType,
      input.privyWalletId,
      input.walletAddress,
      walletMigratedAt,
      input.userId,
    )
    .run();
}

export async function setUserExperience(
  env: Env,
  input: {
    userId: string;
    experienceLevel: ExperienceLevel;
    levelSource: LevelSource;
    onboardingCompletedAt?: string | null;
    onboardingVersion?: number;
    feedSeedVersion?: number;
    degenAcknowledgedAt?: string | null;
  },
): Promise<void> {
  const onboardingVersion =
    input.onboardingVersion && Number.isFinite(input.onboardingVersion)
      ? Math.max(1, Math.floor(input.onboardingVersion))
      : 1;
  const feedSeedVersion =
    input.feedSeedVersion && Number.isFinite(input.feedSeedVersion)
      ? Math.max(1, Math.floor(input.feedSeedVersion))
      : 1;

  await env.WAITLIST_DB.prepare(
    `
    UPDATE users
    SET
      experience_level = ?1,
      level_source = ?2,
      onboarding_completed_at = ?3,
      onboarding_version = ?4,
      feed_seed_version = ?5,
      degen_acknowledged_at = ?6
    WHERE id = ?7
    `,
  )
    .bind(
      input.experienceLevel,
      input.levelSource,
      input.onboardingCompletedAt ?? null,
      onboardingVersion,
      feedSeedVersion,
      input.degenAcknowledgedAt ?? null,
      input.userId,
    )
    .run();
}
