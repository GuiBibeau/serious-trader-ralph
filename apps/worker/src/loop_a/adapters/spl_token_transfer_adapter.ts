import bs58 from "bs58";

import type { ProtocolEvent } from "../../../../../src/loops/contracts/loop_a";
import type { DecodingContext, ProtocolAdapter } from "../decoder_registry";

const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const SPL_TRANSFER_PROGRAM_IDS = [
  SPL_TOKEN_PROGRAM_ID,
  SPL_TOKEN_2022_PROGRAM_ID,
];

type TransferInstructionKind = "transfer" | "transfer_checked";

type DecodedTransfer = {
  kind: TransferInstructionKind;
  amountAtomic: string;
};

function readU64LE(bytes: Uint8Array, offset: number): bigint | null {
  if (bytes.length < offset + 8) return null;

  let value = 0n;
  for (let i = 0; i < 8; i += 1) {
    value |= BigInt(bytes[offset + i] ?? 0) << BigInt(i * 8);
  }
  return value;
}

function decodeTransferInstructionData(
  data: string | undefined,
): DecodedTransfer | null {
  if (!data) return null;

  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(data);
  } catch {
    return null;
  }

  const instructionTag = bytes[0];
  if (instructionTag === 3) {
    const amount = readU64LE(bytes, 1);
    if (amount === null) return null;
    return {
      kind: "transfer",
      amountAtomic: amount.toString(),
    };
  }

  if (instructionTag === 12) {
    const amount = readU64LE(bytes, 1);
    if (amount === null) return null;
    return {
      kind: "transfer_checked",
      amountAtomic: amount.toString(),
    };
  }

  return null;
}

function buildMintByAccountIndex(
  context: DecodingContext,
): Map<number, string> {
  const byIndex = new Map<number, string>();
  for (const balance of [
    ...context.tokenBalances.pre,
    ...context.tokenBalances.post,
  ]) {
    if (!byIndex.has(balance.accountIndex)) {
      byIndex.set(balance.accountIndex, balance.mint);
    }
  }
  return byIndex;
}

function resolveTransferMint(
  mintByIndex: Map<number, string>,
  instructionKind: TransferInstructionKind,
  instructionAccounts: string[],
  instructionAccountIndices: number[],
): string | null {
  if (instructionKind === "transfer_checked") {
    return (
      instructionAccounts[1] ??
      mintByIndex.get(instructionAccountIndices[1] ?? Number.NaN) ??
      null
    );
  }

  return (
    mintByIndex.get(instructionAccountIndices[0] ?? Number.NaN) ??
    mintByIndex.get(instructionAccountIndices[1] ?? Number.NaN) ??
    null
  );
}

export function createSplTokenTransferAdapter(): ProtocolAdapter {
  return {
    id: "spl-token-transfer",
    programIds: SPL_TRANSFER_PROGRAM_IDS,
    decode(context: DecodingContext): ProtocolEvent[] {
      const mintByIndex = buildMintByAccountIndex(context);
      const events: ProtocolEvent[] = [];

      for (const instruction of [
        ...context.instructions,
        ...context.innerInstructions,
      ]) {
        if (!SPL_TRANSFER_PROGRAM_IDS.includes(instruction.programId)) {
          continue;
        }

        const decodedTransfer = decodeTransferInstructionData(instruction.data);
        if (!decodedTransfer) continue;

        const source = instruction.accounts[0];
        const destination =
          decodedTransfer.kind === "transfer_checked"
            ? instruction.accounts[2]
            : instruction.accounts[1];
        const owner =
          decodedTransfer.kind === "transfer_checked"
            ? instruction.accounts[3]
            : instruction.accounts[2];

        if (!source || !destination) continue;

        const mint = resolveTransferMint(
          mintByIndex,
          decodedTransfer.kind,
          instruction.accounts,
          instruction.accountIndices,
        );
        if (!mint) continue;

        events.push({
          schemaVersion: "v1",
          generatedAt: context.generatedAt,
          kind: "fee_transfer",
          protocol: "spl_token",
          slot: context.slot,
          sig: context.signature,
          ts: context.timestamp,
          user: owner ?? context.feePayer,
          venue: "spl_token",
          mint,
          amount: decodedTransfer.amountAtomic,
          to: destination,
          meta: {
            source,
            destination,
            tokenProgramId: instruction.programId,
            instructionKind: decodedTransfer.kind,
          },
        });
      }

      return events;
    },
  };
}
