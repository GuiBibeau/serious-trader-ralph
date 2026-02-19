import { describe, expect, test } from "bun:test";
import {
  runResearchSpecialist,
  runRiskSpecialist,
  type SpecialistRuntime,
} from "../../apps/worker/src/agents/specialists";

describe("worker agent specialists", () => {
  test("research and risk specialists share the same provider snapshot identity", async () => {
    const runtime = {
      env: {} as never,
      tenantId: "bot-1",
      wallet: "wallet-1",
      policy: {} as never,
      strategy: {
        type: "agent",
        mandate: "trade momentum",
        quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        quoteDecimals: 6,
      },
      rpc: {} as never,
      jupiter: {} as never,
      provider: {
        providerKind: "openai_compatible",
        baseUrl: "https://api.example.com",
        baseUrlHash:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        model: "gpt-test",
        apiKey: "sk-live-12345678",
        resolvedAt: new Date().toISOString(),
        resolutionSource: "bot_config" as const,
        lastPingAt: new Date().toISOString(),
        lastPingError: null,
        pingAgeMs: 10,
      },
    } as unknown as SpecialistRuntime;

    const research = await runResearchSpecialist(runtime, {
      gatherSnapshot: async () =>
        ({
          ts: new Date().toISOString(),
          baseMint: "So11111111111111111111111111111111111111112",
          quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          quoteDecimals: 6,
          baseBalanceAtomic: "1",
          quoteBalanceAtomic: "1",
          basePriceQuote: "1",
          portfolioValueQuote: "2",
          baseAllocationPct: 50,
        }) as never,
      listRecentTrades: async () => [],
    });
    const risk = await runRiskSpecialist({
      runtime,
      memory: {
        thesis: "keep trend exposure",
        observations: [],
        reflections: [],
        tradesProposedToday: 0,
        lastTradeDate: "",
        updatedAt: new Date().toISOString(),
      },
    });

    expect(research.providerBaseUrlHash).toBe(runtime.provider.baseUrlHash);
    expect(risk.providerBaseUrlHash).toBe(runtime.provider.baseUrlHash);
    expect(risk.blocked).toBe(false);
  });

  test("risk specialist blocks when both mandate and thesis are missing", async () => {
    const runtime = {
      env: {} as never,
      tenantId: "bot-2",
      wallet: "wallet-2",
      policy: {} as never,
      strategy: { type: "agent", mandate: "" },
      rpc: {} as never,
      jupiter: {} as never,
      provider: {
        providerKind: "openai_compatible",
        baseUrl: "https://api.example.com",
        baseUrlHash:
          "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        model: "gpt-test",
        apiKey: "sk-live-12345678",
        resolvedAt: new Date().toISOString(),
        resolutionSource: "bot_config" as const,
        lastPingAt: null,
        lastPingError: null,
        pingAgeMs: null,
      },
    } as unknown as SpecialistRuntime;

    const risk = await runRiskSpecialist({
      runtime,
      memory: {
        thesis: "",
        observations: [],
        reflections: [],
        tradesProposedToday: 0,
        lastTradeDate: "",
        updatedAt: new Date().toISOString(),
      },
    });

    expect(risk.blocked).toBe(true);
    expect(risk.reasons).toContain("missing-mandate-and-thesis");
  });
});
