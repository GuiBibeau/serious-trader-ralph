import { afterEach, describe, expect, test } from "bun:test";
import { callLlm } from "../../apps/worker/src/agent_llm";
import {
  assertBotInferenceProviderHealthy,
  getBotInferenceProviderView,
  pingBotInferenceProvider,
  resolveBotProviderSnapshot,
  setBotInferenceProvider,
} from "../../apps/worker/src/inference_provider";
import type { Env } from "../../apps/worker/src/types";

type StoredProviderRow = {
  botId: string;
  providerKind: string;
  baseUrl: string;
  model: string;
  apiKeyCiphertext: string;
  apiKeyIv: string;
  keyVersion: string;
  createdAt: string;
  updatedAt: string;
  lastPingAt: string | null;
  lastPingError: string | null;
};

const ORIGINAL_FETCH = globalThis.fetch;

function keyB64FromBytes(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return btoa(out);
}

function createInferenceTestEnv(): {
  env: Env;
  providers: Map<string, StoredProviderRow>;
} {
  const providers = new Map<string, StoredProviderRow>();

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => {
              if (!sql.includes("FROM bot_inference_providers")) return null;
              const botId = String(args[0] ?? "");
              const row = providers.get(botId);
              if (!row) return null;
              return {
                providerKind: row.providerKind,
                baseUrl: row.baseUrl,
                model: row.model,
                apiKeyCiphertext: row.apiKeyCiphertext,
                apiKeyIv: row.apiKeyIv,
                keyVersion: row.keyVersion,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                lastPingAt: row.lastPingAt,
                lastPingError: row.lastPingError,
              };
            },
            run: async () => {
              if (sql.includes("INSERT INTO bot_inference_providers")) {
                const now = new Date().toISOString();
                const row: StoredProviderRow = {
                  botId: String(args[0] ?? ""),
                  providerKind: String(args[1] ?? "openai_compatible"),
                  baseUrl: String(args[2] ?? ""),
                  model: String(args[3] ?? ""),
                  apiKeyCiphertext: String(args[4] ?? ""),
                  apiKeyIv: String(args[5] ?? ""),
                  keyVersion: String(args[6] ?? "v1"),
                  lastPingAt:
                    typeof args[7] === "string" && String(args[7]).trim()
                      ? String(args[7])
                      : null,
                  lastPingError: null,
                  createdAt: now,
                  updatedAt: now,
                };
                providers.set(row.botId, row);
                return { meta: { changes: 1 } };
              }

              if (
                sql.includes("UPDATE bot_inference_providers") &&
                sql.includes("provider_kind = ?1")
              ) {
                const botId = String(args[8] ?? "");
                const row = providers.get(botId);
                if (!row) return { meta: { changes: 0 } };
                row.providerKind = String(args[0] ?? row.providerKind);
                row.baseUrl = String(args[1] ?? row.baseUrl);
                row.model = String(args[2] ?? row.model);
                row.apiKeyCiphertext = String(args[3] ?? row.apiKeyCiphertext);
                row.apiKeyIv = String(args[4] ?? row.apiKeyIv);
                row.keyVersion = String(args[5] ?? row.keyVersion);
                row.lastPingAt =
                  typeof args[6] === "string" && String(args[6]).trim()
                    ? String(args[6])
                    : null;
                row.lastPingError =
                  typeof args[7] === "string" && String(args[7]).trim()
                    ? String(args[7])
                    : null;
                row.updatedAt = new Date().toISOString();
                return { meta: { changes: 1 } };
              }

              if (
                sql.includes("UPDATE bot_inference_providers") &&
                sql.includes("last_ping_at = ?1") &&
                sql.includes("last_ping_error = ?2")
              ) {
                const botId = String(args[2] ?? "");
                const row = providers.get(botId);
                if (!row) return { meta: { changes: 0 } };
                row.lastPingAt =
                  typeof args[0] === "string" && String(args[0]).trim()
                    ? String(args[0])
                    : null;
                row.lastPingError =
                  typeof args[1] === "string" && String(args[1]).trim()
                    ? String(args[1])
                    : null;
                row.updatedAt = new Date().toISOString();
                return { meta: { changes: 1 } };
              }

              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  } as never;

  const env = {
    WAITLIST_DB: db,
    CONFIG_KV: {} as never,
    BOT_LOOP: {} as never,
    BACKTEST_QUEUE: {} as never,
    INFERENCE_ENCRYPTION_KEY_B64: keyB64FromBytes(new Uint8Array(32).fill(7)),
  } as Env;

  return { env, providers };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("worker inference provider", () => {
  test("set provider stores encrypted secret and returns masked view", async () => {
    const { env, providers } = createInferenceTestEnv();
    const apiKey = "sk-live-12345678";

    const saved = await setBotInferenceProvider(
      env,
      {
        botId: "bot-a",
        baseUrl: "https://api.example.com",
        model: "gpt-test",
        apiKey,
      },
      { skipPing: true },
    );
    expect(saved.configured).toBe(true);
    expect(saved.apiKeyMasked).toBe("sk-l...5678");

    const stored = providers.get("bot-a");
    expect(stored).toBeTruthy();
    expect(stored?.apiKeyCiphertext).not.toContain(apiKey);

    const view = await getBotInferenceProviderView(env, "bot-a");
    expect(view.configured).toBe(true);
    expect(view.baseUrl).toBe("https://api.example.com");
    expect(view.model).toBe("gpt-test");
  });

  test("rejects non-https and private/local inference endpoints", async () => {
    const { env } = createInferenceTestEnv();
    await expect(
      setBotInferenceProvider(
        env,
        {
          botId: "bot-http",
          baseUrl: "http://api.example.com",
          model: "gpt-test",
          apiKey: "sk-live-12345678",
        },
        { skipPing: true },
      ),
    ).rejects.toThrow(/invalid-inference-base-url/);

    await expect(
      setBotInferenceProvider(
        env,
        {
          botId: "bot-local",
          baseUrl: "https://localhost",
          model: "gpt-test",
          apiKey: "sk-live-12345678",
        },
        { skipPing: true },
      ),
    ).rejects.toThrow(/invalid-inference-base-url/);
  });

  test("healthy check resolves provider snapshot and fails closed when upstream is down", async () => {
    const { env } = createInferenceTestEnv();
    await setBotInferenceProvider(
      env,
      {
        botId: "bot-snap",
        baseUrl: "https://api.example.com",
        model: "gpt-test",
        apiKey: "sk-live-12345678",
      },
      { skipPing: true },
    );

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch;
    const snapshot = await resolveBotProviderSnapshot(env, "bot-snap", {
      verify: true,
    });
    expect(snapshot.resolutionSource).toBe("bot_config");
    expect(snapshot.baseUrlHash.length).toBe(64);
    expect(snapshot.lastPingAt).toBeTruthy();

    globalThis.fetch = (async () =>
      new Response("upstream error", { status: 503 })) as typeof fetch;
    await expect(
      assertBotInferenceProviderHealthy(env, "bot-snap"),
    ).rejects.toThrow(/inference-provider-unreachable/);
  });

  test("llm call never falls back to env defaults", async () => {
    await expect(
      callLlm({} as Env, {
        messages: [{ role: "user", content: "hello" }],
        tools: [],
      }),
    ).rejects.toThrow(/inference-provider-not-configured/);
  });

  test("ping endpoint validates stored provider config", async () => {
    const { env } = createInferenceTestEnv();
    await setBotInferenceProvider(
      env,
      {
        botId: "bot-ping",
        baseUrl: "https://api.example.com",
        model: "gpt-test",
        apiKey: "sk-live-12345678",
      },
      { skipPing: true },
    );

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch;

    await expect(
      pingBotInferenceProvider(env, { botId: "bot-ping" }),
    ).resolves.toBeUndefined();
  });
});
