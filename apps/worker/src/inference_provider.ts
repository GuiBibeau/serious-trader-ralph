import type { Env } from "./types";

const INFERENCE_KEY_VERSION = "v1";

export type InferenceProviderKind = "openai_compatible";

export type InferenceProviderRuntime = {
  providerKind: InferenceProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  updatedAt?: string | null;
  lastPingAt?: string | null;
  lastPingError?: string | null;
};

export type InferenceProviderView = {
  providerKind: InferenceProviderKind;
  baseUrl: string;
  model: string;
  configured: boolean;
  apiKeyMasked: string | null;
  updatedAt: string | null;
  lastPingAt?: string | null;
  lastPingError?: string | null;
};

export type ProviderSnapshot = {
  providerKind: InferenceProviderKind;
  baseUrl: string;
  baseUrlHash: string;
  model: string;
  apiKey: string;
  resolvedAt: string;
  resolutionSource: "bot_config";
  lastPingAt: string | null;
  lastPingError: string | null;
  pingAgeMs: number | null;
};

type ProviderRow = {
  providerKind: InferenceProviderKind;
  baseUrl: string;
  model: string;
  apiKeyCiphertext: string;
  apiKeyIv: string;
  keyVersion: string;
  createdAt: string | null;
  updatedAt: string;
  lastPingAt: string | null;
  lastPingError: string | null;
};

type NormalizedProviderConfig = {
  providerKind: InferenceProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

let cachedKeyRaw: string | null = null;
let cachedKey: CryptoKey | null = null;

async function encryptionKey(env: Env): Promise<CryptoKey> {
  const raw = String(env.INFERENCE_ENCRYPTION_KEY_B64 ?? "").trim();
  if (!raw) throw new Error("inference-encryption-key-missing");
  if (cachedKey && cachedKeyRaw === raw) return cachedKey;

  const keyBytes = fromBase64(raw);
  if (keyBytes.byteLength !== 32) {
    throw new Error("invalid-inference-encryption-key");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  cachedKeyRaw = raw;
  cachedKey = key;
  return key;
}

function normalizeProviderKind(value: unknown): InferenceProviderKind {
  const kind = String(value ?? "openai_compatible")
    .trim()
    .toLowerCase();
  if (kind !== "openai_compatible") {
    throw new Error("invalid-inference-provider-kind");
  }
  return "openai_compatible";
}

function parseIpv4(hostname: string): number[] | null {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4) return null;
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  if (host === "0.0.0.0" || host === "::" || host === "::1") {
    return true;
  }

  const ipv4 = parseIpv4(host);
  if (ipv4) {
    const [a, b] = ipv4;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return false;
  }

  const unbracketed = host.replace(/^\[/, "").replace(/\]$/, "");
  if (unbracketed.includes(":")) {
    const v6 = unbracketed.toLowerCase();
    if (v6 === "::" || v6 === "::1") return true;
    if (v6.startsWith("fe80:")) return true;
    if (v6.startsWith("fc") || v6.startsWith("fd")) return true;
    return false;
  }

  return false;
}

function normalizeBaseUrl(value: unknown): string {
  const base = String(value ?? "").trim();
  if (!base) throw new Error("invalid-inference-base-url");
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error("invalid-inference-base-url");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("invalid-inference-base-url");
  }
  if (parsed.username || parsed.password) {
    throw new Error("invalid-inference-base-url");
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error("invalid-inference-base-url");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeModel(value: unknown): string {
  const model = String(value ?? "").trim();
  if (!model || model.length > 120) throw new Error("invalid-inference-model");
  return model;
}

function normalizeApiKey(value: unknown): string {
  const key = String(value ?? "").trim();
  if (!key || key.length < 8) throw new Error("invalid-inference-api-key");
  if (key.length > 4096) throw new Error("invalid-inference-api-key");
  return key;
}

function trimErrorSnippet(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return "empty-error";
  return collapsed.slice(0, 200);
}

function pingAgeMs(
  lastPingAt: string | null,
  nowMs = Date.now(),
): number | null {
  if (!lastPingAt) return null;
  const ts = Date.parse(lastPingAt);
  if (!Number.isFinite(ts)) return null;
  const age = nowMs - ts;
  if (!Number.isFinite(age) || age < 0) return null;
  return age;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let out = "";
  for (const value of view) {
    out += value.toString(16).padStart(2, "0");
  }
  return out;
}

function toNormalizedProviderConfig(input: {
  providerKind?: unknown;
  baseUrl: unknown;
  model: unknown;
  apiKey: unknown;
}): NormalizedProviderConfig {
  return {
    providerKind: normalizeProviderKind(input.providerKind),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    model: normalizeModel(input.model),
    apiKey: normalizeApiKey(input.apiKey),
  };
}

async function pingOpenAiCompatibleProvider(
  config: NormalizedProviderConfig,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(
      `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0,
          stream: false,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `inference-provider-ping-failed:${response.status}:${trimErrorSnippet(errorText)}`,
      );
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("inference-provider-ping-timeout");
    }
    if (err instanceof Error && err.message.startsWith("inference-provider-")) {
      throw err;
    }
    throw new Error(
      `inference-provider-ping-failed:request:${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function pingProviderConfig(
  config: NormalizedProviderConfig,
): Promise<void> {
  if (config.providerKind === "openai_compatible") {
    await pingOpenAiCompatibleProvider(config);
    return;
  }
  throw new Error("invalid-inference-provider-kind");
}

function maskApiKey(apiKey: string): string {
  const len = apiKey.length;
  if (len <= 8) return `${apiKey[0] ?? "*"}***${apiKey[len - 1] ?? "*"}`;
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

async function encryptApiKey(
  env: Env,
  plaintextApiKey: string,
): Promise<{ ciphertextB64: string; ivB64: string; keyVersion: string }> {
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(plaintextApiKey);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    payload,
  );
  return {
    ciphertextB64: toBase64(new Uint8Array(encrypted)),
    ivB64: toBase64(iv),
    keyVersion: INFERENCE_KEY_VERSION,
  };
}

async function decryptApiKey(
  env: Env,
  input: { ciphertextB64: string; ivB64: string },
): Promise<string> {
  const key = await encryptionKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(input.ivB64) },
    key,
    fromBase64(input.ciphertextB64),
  );
  const plain = new TextDecoder().decode(decrypted);
  if (!plain.trim()) throw new Error("invalid-inference-api-key");
  return plain;
}

async function getProviderRow(
  env: Env,
  botId: string,
): Promise<ProviderRow | null> {
  const row = (await env.WAITLIST_DB.prepare(
    `
    SELECT
      provider_kind as providerKind,
      base_url as baseUrl,
      model,
      api_key_ciphertext as apiKeyCiphertext,
      api_key_iv as apiKeyIv,
      key_version as keyVersion,
      created_at as createdAt,
      last_ping_at as lastPingAt,
      last_ping_error as lastPingError,
      updated_at as updatedAt
    FROM bot_inference_providers
    WHERE bot_id = ?1
    `,
  )
    .bind(botId)
    .first()) as unknown;

  if (!row || typeof row !== "object") return null;
  const obj = row as Record<string, unknown>;
  const providerKind = normalizeProviderKind(obj.providerKind);
  return {
    providerKind,
    baseUrl: String(obj.baseUrl ?? ""),
    model: String(obj.model ?? ""),
    apiKeyCiphertext: String(obj.apiKeyCiphertext ?? ""),
    apiKeyIv: String(obj.apiKeyIv ?? ""),
    keyVersion: String(obj.keyVersion ?? ""),
    createdAt:
      typeof obj.createdAt === "string" && obj.createdAt.trim()
        ? String(obj.createdAt)
        : null,
    updatedAt: String(obj.updatedAt ?? ""),
    lastPingAt:
      typeof obj.lastPingAt === "string" && obj.lastPingAt.trim()
        ? String(obj.lastPingAt)
        : null,
    lastPingError:
      typeof obj.lastPingError === "string" && obj.lastPingError.trim()
        ? String(obj.lastPingError)
        : null,
  };
}

async function updateProviderPingStatus(
  env: Env,
  botId: string,
  input: {
    lastPingAt: string | null;
    lastPingError: string | null;
  },
): Promise<void> {
  await env.WAITLIST_DB.prepare(
    `
    UPDATE bot_inference_providers
    SET
      last_ping_at = ?1,
      last_ping_error = ?2,
      updated_at = datetime('now')
    WHERE bot_id = ?3
    `,
  )
    .bind(input.lastPingAt, input.lastPingError, botId)
    .run()
    .catch(() => {});
}

function normalizePingErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (
    raw.startsWith("inference-provider-ping-failed") ||
    raw === "inference-provider-ping-timeout"
  ) {
    return raw;
  }
  return `inference-provider-ping-failed:request:${trimErrorSnippet(raw)}`;
}

export async function getBotInferenceProviderRuntime(
  env: Env,
  botId: string,
): Promise<InferenceProviderRuntime | null> {
  const row = await getProviderRow(env, botId);
  if (!row) return null;

  const apiKey = await decryptApiKey(env, {
    ciphertextB64: row.apiKeyCiphertext,
    ivB64: row.apiKeyIv,
  });
  return {
    providerKind: row.providerKind,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKey,
    updatedAt: row.updatedAt,
    lastPingAt: row.lastPingAt,
    lastPingError: row.lastPingError,
  };
}

export async function getBotInferenceProviderView(
  env: Env,
  botId: string,
): Promise<InferenceProviderView> {
  const runtime = await getBotInferenceProviderRuntime(env, botId).catch(
    () => null,
  );
  const row = await getProviderRow(env, botId);
  if (!runtime || !row) {
    return {
      providerKind: "openai_compatible",
      baseUrl: "",
      model: "",
      configured: false,
      apiKeyMasked: null,
      updatedAt: null,
    };
  }
  return {
    providerKind: runtime.providerKind,
    baseUrl: runtime.baseUrl,
    model: runtime.model,
    configured: true,
    apiKeyMasked: maskApiKey(runtime.apiKey),
    updatedAt: row.updatedAt,
    lastPingAt: row.lastPingAt,
    lastPingError: row.lastPingError,
  };
}

export async function resolveBotProviderSnapshot(
  env: Env,
  botId: string,
  options?: {
    verify?: boolean;
  },
): Promise<ProviderSnapshot> {
  const runtime = await getBotInferenceProviderRuntime(env, botId);
  if (!runtime) {
    throw new Error("inference-provider-not-configured");
  }

  const verify = options?.verify === true;
  const nowIso = new Date().toISOString();
  let lastPingAt = runtime.lastPingAt ?? null;
  let lastPingError = runtime.lastPingError ?? null;
  if (verify) {
    try {
      await pingProviderConfig({
        providerKind: runtime.providerKind,
        baseUrl: runtime.baseUrl,
        model: runtime.model,
        apiKey: runtime.apiKey,
      });
      lastPingAt = nowIso;
      lastPingError = null;
      await updateProviderPingStatus(env, botId, {
        lastPingAt,
        lastPingError,
      });
    } catch (error) {
      const pingError = normalizePingErrorMessage(error);
      await updateProviderPingStatus(env, botId, {
        lastPingAt,
        lastPingError: pingError,
      });
      throw new Error("inference-provider-unreachable");
    }
  }

  return {
    providerKind: runtime.providerKind,
    baseUrl: runtime.baseUrl,
    baseUrlHash: await sha256Hex(runtime.baseUrl),
    model: runtime.model,
    apiKey: runtime.apiKey,
    resolvedAt: nowIso,
    resolutionSource: "bot_config",
    lastPingAt,
    lastPingError,
    pingAgeMs: pingAgeMs(lastPingAt),
  };
}

export async function assertBotInferenceProviderHealthy(
  env: Env,
  botId: string,
): Promise<ProviderSnapshot> {
  return resolveBotProviderSnapshot(env, botId, { verify: true });
}

export async function pingInferenceProviderConfig(input: {
  providerKind?: unknown;
  baseUrl: unknown;
  model: unknown;
  apiKey: unknown;
}): Promise<void> {
  const config = toNormalizedProviderConfig(input);
  await pingProviderConfig(config);
}

export async function pingBotInferenceProvider(
  env: Env,
  input: {
    botId: string;
    providerKind?: unknown;
    baseUrl?: unknown;
    model?: unknown;
    apiKey?: unknown;
  },
): Promise<void> {
  const row = await getProviderRow(env, input.botId);
  if (
    !row &&
    input.providerKind === undefined &&
    input.baseUrl === undefined &&
    input.model === undefined &&
    input.apiKey === undefined
  ) {
    throw new Error("inference-provider-not-configured");
  }

  const runtime = row
    ? await getBotInferenceProviderRuntime(env, input.botId)
    : null;
  const config = toNormalizedProviderConfig({
    providerKind: input.providerKind ?? row?.providerKind,
    baseUrl: input.baseUrl ?? row?.baseUrl,
    model: input.model ?? row?.model,
    apiKey: input.apiKey ?? runtime?.apiKey,
  });
  try {
    await pingProviderConfig(config);
    if (
      row &&
      input.providerKind === undefined &&
      input.baseUrl === undefined &&
      input.model === undefined &&
      input.apiKey === undefined
    ) {
      await updateProviderPingStatus(env, input.botId, {
        lastPingAt: new Date().toISOString(),
        lastPingError: null,
      });
    }
  } catch (error) {
    if (
      row &&
      input.providerKind === undefined &&
      input.baseUrl === undefined &&
      input.model === undefined &&
      input.apiKey === undefined
    ) {
      await updateProviderPingStatus(env, input.botId, {
        lastPingAt: row.lastPingAt,
        lastPingError: normalizePingErrorMessage(error),
      });
    }
    throw error;
  }
}

export async function setBotInferenceProvider(
  env: Env,
  input: {
    botId: string;
    providerKind?: unknown;
    baseUrl: unknown;
    model: unknown;
    apiKey: unknown;
  },
  options?: { skipPing?: boolean },
): Promise<InferenceProviderView> {
  const config = toNormalizedProviderConfig(input);
  const pingedAt = options?.skipPing ? null : new Date().toISOString();
  if (!options?.skipPing) {
    await pingProviderConfig(config);
  }

  const providerKind = config.providerKind;
  const baseUrl = config.baseUrl;
  const model = config.model;
  const apiKey = config.apiKey;
  const encrypted = await encryptApiKey(env, apiKey);

  await env.WAITLIST_DB.prepare(
    `
    INSERT INTO bot_inference_providers (
      bot_id,
      provider_kind,
      base_url,
      model,
      api_key_ciphertext,
      api_key_iv,
      key_version,
      last_ping_at,
      last_ping_error,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, datetime('now'))
    ON CONFLICT(bot_id) DO UPDATE SET
      provider_kind = excluded.provider_kind,
      base_url = excluded.base_url,
      model = excluded.model,
      api_key_ciphertext = excluded.api_key_ciphertext,
      api_key_iv = excluded.api_key_iv,
      key_version = excluded.key_version,
      last_ping_at = excluded.last_ping_at,
      last_ping_error = excluded.last_ping_error,
      updated_at = excluded.updated_at
    `,
  )
    .bind(
      input.botId,
      providerKind,
      baseUrl,
      model,
      encrypted.ciphertextB64,
      encrypted.ivB64,
      encrypted.keyVersion,
      pingedAt,
    )
    .run();

  return {
    providerKind,
    baseUrl,
    model,
    configured: true,
    apiKeyMasked: maskApiKey(apiKey),
    updatedAt: new Date().toISOString(),
    lastPingAt: pingedAt,
    lastPingError: null,
  };
}

export async function patchBotInferenceProvider(
  env: Env,
  input: {
    botId: string;
    providerKind?: unknown;
    baseUrl?: unknown;
    model?: unknown;
    apiKey?: unknown;
  },
  options?: { skipPing?: boolean },
): Promise<InferenceProviderView> {
  const row = await getProviderRow(env, input.botId);
  if (!row) throw new Error("inference-provider-not-configured");

  const providerKind = normalizeProviderKind(
    input.providerKind ?? row.providerKind,
  );
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? row.baseUrl);
  const model = normalizeModel(input.model ?? row.model);

  let apiKeyCiphertext = row.apiKeyCiphertext;
  let apiKeyIv = row.apiKeyIv;
  let keyVersion = row.keyVersion || INFERENCE_KEY_VERSION;
  let apiKeyPlain = "";
  let lastPingAt = row.lastPingAt;
  let lastPingError = row.lastPingError;
  if (input.apiKey !== undefined) {
    apiKeyPlain = normalizeApiKey(input.apiKey);
    const encrypted = await encryptApiKey(env, apiKeyPlain);
    apiKeyCiphertext = encrypted.ciphertextB64;
    apiKeyIv = encrypted.ivB64;
    keyVersion = encrypted.keyVersion;
  } else {
    const runtime = await getBotInferenceProviderRuntime(env, input.botId);
    apiKeyPlain = normalizeApiKey(runtime?.apiKey ?? "");
  }

  if (!options?.skipPing) {
    await pingProviderConfig({
      providerKind,
      baseUrl,
      model,
      apiKey: apiKeyPlain,
    });
    lastPingAt = new Date().toISOString();
    lastPingError = null;
  }

  await env.WAITLIST_DB.prepare(
    `
    UPDATE bot_inference_providers
    SET
      provider_kind = ?1,
      base_url = ?2,
      model = ?3,
      api_key_ciphertext = ?4,
      api_key_iv = ?5,
      key_version = ?6,
      last_ping_at = ?7,
      last_ping_error = ?8,
      updated_at = datetime('now')
    WHERE bot_id = ?9
    `,
  )
    .bind(
      providerKind,
      baseUrl,
      model,
      apiKeyCiphertext,
      apiKeyIv,
      keyVersion,
      lastPingAt,
      lastPingError,
      input.botId,
    )
    .run();

  return {
    providerKind,
    baseUrl,
    model,
    configured: true,
    apiKeyMasked: maskApiKey(apiKeyPlain),
    updatedAt: new Date().toISOString(),
    lastPingAt,
    lastPingError,
  };
}
