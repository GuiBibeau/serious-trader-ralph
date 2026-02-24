import { describe, expect, test } from "bun:test";
import { createSwapDeltaAdapter } from "../../apps/worker/src/loop_a/adapters/swap_delta_adapter";
import type { DecodingContext } from "../../apps/worker/src/loop_a/decoder_registry";

function createContext(
  overrides: Partial<DecodingContext> = {},
): DecodingContext {
  return {
    slot: 123,
    commitment: "confirmed",
    signature: "sig-1",
    txIndex: 0,
    blockTime: 1_700_000_000,
    timestamp: "2026-02-22T00:00:00.000Z",
    generatedAt: "2026-02-22T00:00:01.000Z",
    observedAt: "2026-02-22T00:00:01.000Z",
    feePayer: "owner-1",
    accountKeys: ["owner-1", "program-1"],
    instructions: [
      {
        programId: "program-1",
        accounts: [],
        accountIndices: [],
        raw: {},
      },
    ],
    innerInstructions: [],
    logMessages: [],
    tokenBalances: {
      pre: [
        {
          accountIndex: 0,
          owner: "owner-1",
          mint: "mint-in",
          amountAtomic: "1000",
        },
        {
          accountIndex: 1,
          owner: "owner-1",
          mint: "mint-out",
          amountAtomic: "100",
        },
      ],
      post: [
        {
          accountIndex: 0,
          owner: "owner-1",
          mint: "mint-in",
          amountAtomic: "900",
        },
        {
          accountIndex: 1,
          owner: "owner-1",
          mint: "mint-out",
          amountAtomic: "160",
        },
      ],
    },
    rawTransaction: {},
    ...overrides,
  };
}

describe("worker loop A swap delta adapter", () => {
  test("decodes swap-like owner deltas for configured programs", () => {
    const adapter = createSwapDeltaAdapter({
      id: "raydium-swap",
      protocol: "raydium",
      venue: "raydium",
      programIds: ["program-1"],
    });

    const events = adapter.decode(createContext());
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe("swap");
    expect(events[0]?.protocol).toBe("raydium");
    expect(events[0]?.inMint).toBe("mint-in");
    expect(events[0]?.outMint).toBe("mint-out");
    expect(events[0]?.inAmount).toBe("100");
    expect(events[0]?.outAmount).toBe("60");
  });

  test("returns no events when owner does not have both in and out deltas", () => {
    const adapter = createSwapDeltaAdapter({
      id: "orca-swap",
      protocol: "orca",
      venue: "orca",
      programIds: ["program-1"],
    });

    const context = createContext({
      tokenBalances: {
        pre: [
          {
            accountIndex: 0,
            owner: "owner-1",
            mint: "mint-in",
            amountAtomic: "1000",
          },
        ],
        post: [
          {
            accountIndex: 0,
            owner: "owner-1",
            mint: "mint-in",
            amountAtomic: "900",
          },
        ],
      },
    });

    const events = adapter.decode(context);
    expect(events).toEqual([]);
  });
});
