import { describe, expect, test } from "bun:test";
import { executionCanaryTestExports } from "../../apps/worker/src/execution/canary";

describe("execution canary helpers", () => {
  test("alternates direction starting with buy", () => {
    expect(executionCanaryTestExports.nextExecutionCanaryDirection(null)).toBe(
      "buy",
    );
    expect(executionCanaryTestExports.nextExecutionCanaryDirection("buy")).toBe(
      "sell",
    );
    expect(
      executionCanaryTestExports.nextExecutionCanaryDirection("sell"),
    ).toBe("buy");
  });

  test("computes minimum output from slippage budget", () => {
    expect(
      executionCanaryTestExports.computeMinimumOutputAtomic(1_000_000n, 50),
    ).toBe(995_000n);
    expect(
      executionCanaryTestExports.computeMinimumOutputAtomic(123_456_789n, 25),
    ).toBe(123_148_147n);
  });

  test("parses usd config into usdc atomic units", () => {
    expect(executionCanaryTestExports.parseUsdAtomic("5")).toBe(5_000_000n);
    expect(executionCanaryTestExports.parseUsdAtomic("5.25")).toBe(5_250_000n);
    expect(executionCanaryTestExports.parseUsdAtomic("5.000001")).toBe(
      5_000_001n,
    );
  });

  test("reads execution canary env config with bounded defaults", () => {
    const config = executionCanaryTestExports.readExecutionCanaryConfig({
      EXEC_CANARY_ENABLED: "1",
      EXEC_CANARY_AUTO_CREATE_WALLET: "0",
      EXEC_CANARY_NOTIONAL_USD: "7.5",
      EXEC_CANARY_DAILY_CAP_USD: "30",
      EXEC_CANARY_MAX_SLIPPAGE_BPS: "75",
      EXEC_CANARY_MIN_SOL_RESERVE_LAMPORTS: "60000000",
    });

    expect(config.enabled).toBe(true);
    expect(config.autoCreateWallet).toBe(false);
    expect(config.pairId).toBe("SOL/USDC");
    expect(config.notionalUsd).toBe("7.5");
    expect(config.notionalUsdcAtomic).toBe("7500000");
    expect(config.dailyCapUsd).toBe(30);
    expect(config.maxSlippageBps).toBe(75);
    expect(config.minSolReserveLamports).toBe("60000000");
  });

  test("uses landed before finalized for successful request lifecycle", () => {
    expect(
      executionCanaryTestExports.successfulCanaryRequestStatusPlan(),
    ).toEqual({
      requestTerminalStatus: "landed",
      requestFinalStatus: "finalized",
      receiptStatus: "finalized",
    });
  });
});
