import { describe, expect, test } from "bun:test";
import bs58 from "bs58";

import { createDefaultDecoderRegistry } from "../../apps/worker/src/loop_a/adapters";
import type { ProtocolAdapter } from "../../apps/worker/src/loop_a/decoder_registry";
import {
  createDecoderRegistry,
  decodeProtocolEventsFromBlock,
} from "../../apps/worker/src/loop_a/decoder_registry";
import { safeParseProtocolEvent } from "../../src/loops/contracts/loop_a.js";

const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const RAYDIUM_PROGRAM_ID = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
const ORCA_PROGRAM_ID = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const OPENBOOK_PROGRAM_ID = "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb";
const PHOENIX_PROGRAM_ID = "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function encodeU64Transfer(amount: bigint): string {
  const payload = new Uint8Array(9);
  payload[0] = 3;

  let cursor = amount;
  for (let i = 0; i < 8; i += 1) {
    payload[1 + i] = Number(cursor & 0xffn);
    cursor >>= 8n;
  }

  return bs58.encode(payload);
}

function venueSwapTransaction(input: {
  signature: string;
  user: string;
  sourceTokenAccount: string;
  destinationTokenAccount: string;
  venueAccount: string;
  programId: string;
  sourceMint: string;
  destinationMint: string;
  preSourceAmount: string;
  postSourceAmount: string;
  preDestinationAmount: string;
  postDestinationAmount: string;
  logLine: string;
}): Record<string, unknown> {
  return {
    transaction: {
      signatures: [input.signature],
      message: {
        accountKeys: [
          input.venueAccount,
          input.user,
          input.sourceTokenAccount,
          input.destinationTokenAccount,
          input.programId,
        ],
        instructions: [
          {
            programIdIndex: 4,
            accounts: [0, 2, 3, 1],
            data: "3Bxs4f",
          },
        ],
      },
    },
    meta: {
      logMessages: [`Program ${input.programId} invoke [1]`, input.logLine],
      preTokenBalances: [
        {
          accountIndex: 2,
          mint: input.sourceMint,
          owner: input.user,
          uiTokenAmount: { amount: input.preSourceAmount },
        },
        {
          accountIndex: 3,
          mint: input.destinationMint,
          owner: input.user,
          uiTokenAmount: { amount: input.preDestinationAmount },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 2,
          mint: input.sourceMint,
          owner: input.user,
          uiTokenAmount: { amount: input.postSourceAmount },
        },
        {
          accountIndex: 3,
          mint: input.destinationMint,
          owner: input.user,
          uiTokenAmount: { amount: input.postDestinationAmount },
        },
      ],
    },
  };
}

describe("worker loop A decoder registry", () => {
  test("routes adapters by program id and supports incremental registration", () => {
    const customAdapter: ProtocolAdapter = {
      id: "custom-adapter",
      programIds: ["Program111111111111111111111111111111111111111"],
      decode: (context) => [
        {
          schemaVersion: "v1",
          generatedAt: context.generatedAt,
          kind: "unknown",
          protocol: "custom",
          slot: context.slot,
          sig: context.signature,
          ts: context.timestamp,
          rawKind: "custom-hit",
        },
      ],
    };

    const registry = createDecoderRegistry([customAdapter]);
    expect(
      registry.getAdaptersForProgramId(
        "Program111111111111111111111111111111111111111",
      ),
    ).toHaveLength(1);
  });

  test("default adapters decode SPL transfer and Jupiter swap from block fixture", () => {
    const sourceTokenAccount =
      "SrcTokenAcct11111111111111111111111111111111111";
    const destinationTokenAccount =
      "DstTokenAcct11111111111111111111111111111111111";
    const userOne = "UserOne111111111111111111111111111111111111111";
    const userTwo = "UserTwo111111111111111111111111111111111111111";
    const jupSourceTokenAccount =
      "JupSourceTok1111111111111111111111111111111111";
    const jupDestinationTokenAccount =
      "JupDestTok111111111111111111111111111111111111";

    const block = {
      blockTime: 1_708_480_000,
      transactions: [
        {
          transaction: {
            signatures: ["spl-signature"],
            message: {
              accountKeys: [
                sourceTokenAccount,
                destinationTokenAccount,
                userOne,
                SPL_TOKEN_PROGRAM_ID,
              ],
              instructions: [
                {
                  programIdIndex: 3,
                  accounts: [0, 1, 2],
                  data: encodeU64Transfer(250n),
                },
              ],
            },
          },
          meta: {
            logMessages: [
              `Program ${SPL_TOKEN_PROGRAM_ID} invoke [1]`,
              "Program log: Instruction: Transfer",
            ],
            preTokenBalances: [
              {
                accountIndex: 0,
                mint: USDC_MINT,
                owner: userOne,
                uiTokenAmount: { amount: "1000" },
              },
              {
                accountIndex: 1,
                mint: USDC_MINT,
                owner: userOne,
                uiTokenAmount: { amount: "0" },
              },
            ],
            postTokenBalances: [
              {
                accountIndex: 0,
                mint: USDC_MINT,
                owner: userOne,
                uiTokenAmount: { amount: "750" },
              },
              {
                accountIndex: 1,
                mint: USDC_MINT,
                owner: userOne,
                uiTokenAmount: { amount: "250" },
              },
            ],
          },
        },
        {
          transaction: {
            signatures: ["jupiter-signature"],
            message: {
              accountKeys: [
                userTwo,
                jupSourceTokenAccount,
                jupDestinationTokenAccount,
                JUPITER_PROGRAM_ID,
              ],
              instructions: [
                {
                  programIdIndex: 3,
                  accounts: [1, 2, 0],
                  data: "3Bxs4f",
                },
              ],
            },
          },
          meta: {
            logMessages: [
              `Program ${JUPITER_PROGRAM_ID} invoke [1]`,
              "Program log: jupiter route",
            ],
            preTokenBalances: [
              {
                accountIndex: 1,
                mint: SOL_MINT,
                owner: userTwo,
                uiTokenAmount: { amount: "1000000000" },
              },
              {
                accountIndex: 2,
                mint: USDC_MINT,
                owner: userTwo,
                uiTokenAmount: { amount: "5000000" },
              },
            ],
            postTokenBalances: [
              {
                accountIndex: 1,
                mint: SOL_MINT,
                owner: userTwo,
                uiTokenAmount: { amount: "900000000" },
              },
              {
                accountIndex: 2,
                mint: USDC_MINT,
                owner: userTwo,
                uiTokenAmount: { amount: "5400000" },
              },
            ],
          },
        },
      ],
    } as Record<string, unknown>;

    const registry = createDefaultDecoderRegistry();
    const events = decodeProtocolEventsFromBlock({
      slot: 400,
      commitment: "confirmed",
      block,
      registry,
      observedAt: "2026-02-21T04:10:00.000Z",
    });

    expect(events).toHaveLength(2);

    for (const event of events) {
      const parsed = safeParseProtocolEvent(event);
      expect(parsed.success).toBe(true);
    }

    const transferEvent = events.find((event) => event.kind === "fee_transfer");
    expect(transferEvent).toBeDefined();
    expect(transferEvent?.protocol).toBe("spl_token");
    expect(transferEvent?.mint).toBe(USDC_MINT);
    expect(transferEvent?.amount).toBe("250");

    const swapEvent = events.find((event) => event.kind === "swap");
    expect(swapEvent).toBeDefined();
    expect(swapEvent?.protocol).toBe("jupiter");
    expect(swapEvent?.inMint).toBe(SOL_MINT);
    expect(swapEvent?.outMint).toBe(USDC_MINT);
    expect(swapEvent?.inAmount).toBe("100000000");
    expect(swapEvent?.outAmount).toBe("400000");
  });

  test("default adapters decode Raydium, Orca, OpenBook, and Phoenix venue-native swaps", () => {
    const user = "VenueUser11111111111111111111111111111111111111";
    const block = {
      blockTime: 1_708_480_100,
      transactions: [
        venueSwapTransaction({
          signature: "raydium-signature",
          user,
          sourceTokenAccount: "RaySrc1111111111111111111111111111111111111",
          destinationTokenAccount:
            "RayDst1111111111111111111111111111111111111",
          venueAccount: "RayPool111111111111111111111111111111111111",
          programId: RAYDIUM_PROGRAM_ID,
          sourceMint: SOL_MINT,
          destinationMint: USDC_MINT,
          preSourceAmount: "1000000000",
          postSourceAmount: "900000000",
          preDestinationAmount: "1000000",
          postDestinationAmount: "1400000",
          logLine: "Program log: Raydium cpmm swap",
        }),
        venueSwapTransaction({
          signature: "orca-signature",
          user,
          sourceTokenAccount: "OrcaSrc111111111111111111111111111111111111",
          destinationTokenAccount:
            "OrcaDst111111111111111111111111111111111111",
          venueAccount: "OrcaPool11111111111111111111111111111111111",
          programId: ORCA_PROGRAM_ID,
          sourceMint: SOL_MINT,
          destinationMint: USDC_MINT,
          preSourceAmount: "1000000000",
          postSourceAmount: "950000000",
          preDestinationAmount: "2000000",
          postDestinationAmount: "2250000",
          logLine: "Program log: Orca whirlpool swap",
        }),
        venueSwapTransaction({
          signature: "openbook-signature",
          user,
          sourceTokenAccount: "OpenBookSrc111111111111111111111111111111111",
          destinationTokenAccount:
            "OpenBookDst111111111111111111111111111111111",
          venueAccount: "OpenBookMkt111111111111111111111111111111111",
          programId: OPENBOOK_PROGRAM_ID,
          sourceMint: SOL_MINT,
          destinationMint: USDC_MINT,
          preSourceAmount: "1000000000",
          postSourceAmount: "920000000",
          preDestinationAmount: "3000000",
          postDestinationAmount: "3350000",
          logLine: "Program log: OpenBook fill",
        }),
        venueSwapTransaction({
          signature: "phoenix-signature",
          user,
          sourceTokenAccount: "PhoenixSrc1111111111111111111111111111111111",
          destinationTokenAccount:
            "PhoenixDst1111111111111111111111111111111111",
          venueAccount: "PhoenixMkt1111111111111111111111111111111111",
          programId: PHOENIX_PROGRAM_ID,
          sourceMint: SOL_MINT,
          destinationMint: USDC_MINT,
          preSourceAmount: "1000000000",
          postSourceAmount: "930000000",
          preDestinationAmount: "4000000",
          postDestinationAmount: "4300000",
          logLine: "Program log: Phoenix fill",
        }),
      ],
    } as Record<string, unknown>;

    const registry = createDefaultDecoderRegistry();
    const events = decodeProtocolEventsFromBlock({
      slot: 401,
      commitment: "confirmed",
      block,
      registry,
      observedAt: "2026-02-21T04:11:00.000Z",
    });

    expect(events).toHaveLength(4);
    for (const event of events) {
      expect(safeParseProtocolEvent(event).success).toBe(true);
    }

    expect(events.map((event) => event.protocol).sort()).toEqual([
      "openbook",
      "orca",
      "phoenix",
      "raydium",
    ]);
    expect(
      events.find((event) => event.protocol === "raydium")?.meta?.pool,
    ).toBe("RayPool111111111111111111111111111111111111");
    expect(events.find((event) => event.protocol === "orca")?.meta?.pool).toBe(
      "OrcaPool11111111111111111111111111111111111",
    );
    expect(
      events.find((event) => event.protocol === "openbook")?.meta?.market,
    ).toBe("OpenBookMkt111111111111111111111111111111111");
    expect(
      events.find((event) => event.protocol === "phoenix")?.meta?.market,
    ).toBe("PhoenixMkt1111111111111111111111111111111111");
  });

  test("skips failed transactions when meta.err is present", () => {
    const sourceTokenAccount =
      "FailSrcToken111111111111111111111111111111111111";
    const destinationTokenAccount =
      "FailDstToken111111111111111111111111111111111111";
    const user = "FailUser111111111111111111111111111111111111111";

    const block = {
      blockTime: 1_708_480_050,
      transactions: [
        {
          transaction: {
            signatures: ["failed-signature"],
            message: {
              accountKeys: [
                sourceTokenAccount,
                destinationTokenAccount,
                user,
                SPL_TOKEN_PROGRAM_ID,
              ],
              instructions: [
                {
                  programIdIndex: 3,
                  accounts: [0, 1, 2],
                  data: encodeU64Transfer(999n),
                },
              ],
            },
          },
          meta: {
            err: { InstructionError: [0, "Custom"] },
            preTokenBalances: [
              {
                accountIndex: 0,
                mint: USDC_MINT,
                owner: user,
                uiTokenAmount: { amount: "1000" },
              },
            ],
            postTokenBalances: [
              {
                accountIndex: 0,
                mint: USDC_MINT,
                owner: user,
                uiTokenAmount: { amount: "1" },
              },
            ],
          },
        },
      ],
    } as Record<string, unknown>;

    const registry = createDefaultDecoderRegistry();
    const events = decodeProtocolEventsFromBlock({
      slot: 400,
      commitment: "confirmed",
      block,
      registry,
      observedAt: "2026-02-21T04:10:00.000Z",
    });

    expect(events).toEqual([]);
  });

  test("ignores transactions with no supported programs", () => {
    const block = {
      blockTime: 1_708_480_100,
      transactions: [
        {
          transaction: {
            signatures: ["ignored-signature"],
            message: {
              accountKeys: [
                "UserThree1111111111111111111111111111111111111",
                "SomeProgram11111111111111111111111111111111111",
              ],
              instructions: [
                {
                  programIdIndex: 1,
                  accounts: [0],
                  data: "abc",
                },
              ],
            },
          },
          meta: {
            preTokenBalances: [],
            postTokenBalances: [],
          },
        },
      ],
    } as Record<string, unknown>;

    const registry = createDefaultDecoderRegistry();
    const events = decodeProtocolEventsFromBlock({
      slot: 401,
      commitment: "confirmed",
      block,
      registry,
      observedAt: "2026-02-21T04:11:00.000Z",
    });

    expect(events).toEqual([]);
  });
});
