import { describe, expect, test } from "bun:test";
import {
  type BotWalletRow,
  pickLatestUpdatedWallet,
  selectValuedWallet,
  shouldCreateNewWallet,
  type WalletValue,
} from "../../apps/worker/scripts/migrate-bot-wallets-to-users";

function makeBotRow(input: {
  botId: string;
  updatedAt: string;
  userId?: string;
}): BotWalletRow {
  return {
    botId: input.botId,
    userId: input.userId ?? "user-1",
    privyWalletId: `wallet-${input.botId}`,
    walletAddress: `address-${input.botId}`,
    updatedAt: input.updatedAt,
  };
}

function makeValue(input: {
  botId: string;
  usdAtomic: string;
  updatedAt: string;
}): WalletValue {
  return {
    botId: input.botId,
    walletAddress: `address-${input.botId}`,
    privyWalletId: `wallet-${input.botId}`,
    updatedAt: input.updatedAt,
    solLamports: "0",
    usdcAtomic: "0",
    totalUsdAtomic: input.usdAtomic,
  };
}

describe("wallet migration selection", () => {
  test("picks highest wallet >= $10 when available", () => {
    const selected = selectValuedWallet([
      makeValue({
        botId: "bot-a",
        usdAtomic: "9800000",
        updatedAt: "2026-02-10T00:00:00.000Z",
      }),
      makeValue({
        botId: "bot-b",
        usdAtomic: "15000000",
        updatedAt: "2026-02-10T00:00:00.000Z",
      }),
      makeValue({
        botId: "bot-c",
        usdAtomic: "12000000",
        updatedAt: "2026-02-11T00:00:00.000Z",
      }),
    ]);

    expect(selected.botId).toBe("bot-b");
  });

  test("falls back to highest wallet when all are below $10", () => {
    const selected = selectValuedWallet([
      makeValue({
        botId: "bot-a",
        usdAtomic: "9000000",
        updatedAt: "2026-02-10T00:00:00.000Z",
      }),
      makeValue({
        botId: "bot-b",
        usdAtomic: "7000000",
        updatedAt: "2026-02-10T00:00:00.000Z",
      }),
      makeValue({
        botId: "bot-c",
        usdAtomic: "8000000",
        updatedAt: "2026-02-11T00:00:00.000Z",
      }),
    ]);

    expect(selected.botId).toBe("bot-a");
  });

  test("uses deterministic tie-breakers for equal valuations", () => {
    const newerUpdated = selectValuedWallet([
      makeValue({
        botId: "bot-a",
        usdAtomic: "13000000",
        updatedAt: "2026-02-10T00:00:00.000Z",
      }),
      makeValue({
        botId: "bot-b",
        usdAtomic: "13000000",
        updatedAt: "2026-02-12T00:00:00.000Z",
      }),
    ]);
    expect(newerUpdated.botId).toBe("bot-b");

    const lexicalBotId = selectValuedWallet([
      makeValue({
        botId: "bot-z",
        usdAtomic: "13000000",
        updatedAt: "2026-02-12T00:00:00.000Z",
      }),
      makeValue({
        botId: "bot-a",
        usdAtomic: "13000000",
        updatedAt: "2026-02-12T00:00:00.000Z",
      }),
    ]);
    expect(lexicalBotId.botId).toBe("bot-a");
  });

  test("falls back to latest updated wallet on valuation error", () => {
    const selected = pickLatestUpdatedWallet([
      makeBotRow({
        botId: "bot-a",
        updatedAt: "2026-02-09T00:00:00.000Z",
      }),
      makeBotRow({
        botId: "bot-b",
        updatedAt: "2026-02-12T00:00:00.000Z",
      }),
    ]);

    expect(selected.botId).toBe("bot-b");
  });

  test("signals wallet creation when user has zero bot wallets", () => {
    expect(shouldCreateNewWallet([])).toBe(true);
    expect(
      shouldCreateNewWallet([
        makeBotRow({
          botId: "bot-a",
          updatedAt: "2026-02-12T00:00:00.000Z",
        }),
      ]),
    ).toBe(false);
  });
});
