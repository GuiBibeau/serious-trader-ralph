import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ExecuteSwapInput } from "../../apps/worker/src/execution/types";

const signTransactionWithPrivyByIdMock = mock(async () => "signed-base64-tx");
const swapWithRetryMock = mock(async () => ({
  swap: {
    swapTransaction: "unsigned-base64-tx",
    lastValidBlockHeight: 12345,
  },
  quoteResponse: {
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    inAmount: "1000000",
    outAmount: "999000",
  },
  refreshed: false,
}));

mock.module("../../apps/worker/src/privy", () => ({
  signTransactionWithPrivyById: signTransactionWithPrivyByIdMock,
}));
mock.module("../../apps/worker/src/swap", () => ({
  swapWithRetry: swapWithRetryMock,
}));

const { buildAndSignPrivySwapTransaction } = await import(
  "../../apps/worker/src/execution/privy_swap_builder"
);

function createInput(overrides?: Partial<ExecuteSwapInput>): ExecuteSwapInput {
  return {
    env: {} as ExecuteSwapInput["env"],
    execution: { adapter: "jupiter" },
    policy: {} as ExecuteSwapInput["policy"],
    rpc: {} as ExecuteSwapInput["rpc"],
    jupiter: {} as ExecuteSwapInput["jupiter"],
    quoteResponse: {
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      inAmount: "1000000",
      outAmount: "999000",
    },
    userPublicKey: "11111111111111111111111111111111",
    privyWalletId: "wallet_123",
    log: () => {},
    ...overrides,
  };
}

describe("worker privy swap builder", () => {
  beforeEach(() => {
    signTransactionWithPrivyByIdMock.mockClear();
    swapWithRetryMock.mockClear();
  });

  test("builds and signs swap transactions with privy custody", async () => {
    const result = await buildAndSignPrivySwapTransaction(createInput());
    expect(result.signedBase64).toBe("signed-base64-tx");
    expect(result.lastValidBlockHeight).toBe(12345);
    expect(result.usedQuote.outputMint).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    expect(signTransactionWithPrivyByIdMock).toHaveBeenCalledTimes(1);
    expect(swapWithRetryMock).toHaveBeenCalledTimes(1);
  });

  test("fails fast when privy wallet id is missing", async () => {
    await expect(
      buildAndSignPrivySwapTransaction(
        createInput({ privyWalletId: undefined }),
      ),
    ).rejects.toThrow("missing-privy-wallet-id");
    expect(signTransactionWithPrivyByIdMock).not.toHaveBeenCalled();
    expect(swapWithRetryMock).not.toHaveBeenCalled();
  });
});
