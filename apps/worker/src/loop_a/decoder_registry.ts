import type { ProtocolEvent } from "../../../../src/loops/contracts/loop_a";
import type { SlotCommitment } from "./types";

type JsonRecord = Record<string, unknown>;

export type DecodedInstruction = {
  programId: string;
  accounts: string[];
  accountIndices: number[];
  data?: string;
  raw: JsonRecord;
};

export type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  amountAtomic: string;
};

export type DecodingContext = {
  slot: number;
  commitment: SlotCommitment;
  signature: string;
  txIndex: number;
  blockTime: number | null;
  timestamp: string;
  generatedAt: string;
  observedAt: string;
  feePayer?: string;
  accountKeys: string[];
  instructions: DecodedInstruction[];
  innerInstructions: DecodedInstruction[];
  logMessages: string[];
  tokenBalances: {
    pre: TokenBalance[];
    post: TokenBalance[];
  };
  rawTransaction: JsonRecord;
};

export interface ProtocolAdapter {
  id: string;
  programIds: string[];
  decode(context: DecodingContext): ProtocolEvent[];
}

export type BlockDecodeInput = {
  slot: number;
  commitment: SlotCommitment;
  block: JsonRecord;
  registry: DecoderRegistry;
  observedAt?: string;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function unixSecondsToIso(value: number): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  const millis = value * 1000;
  if (!Number.isFinite(millis)) return undefined;
  return new Date(millis).toISOString();
}

function parseAccountKey(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  const record = asRecord(value);
  if (!record) return null;
  const pubkey = asString(record.pubkey);
  if (!pubkey || pubkey.length === 0) return null;
  return pubkey;
}

function parseAccountKeys(
  messageRecord: JsonRecord,
  metaRecord: JsonRecord | null,
): string[] {
  const staticKeys = asArray(messageRecord.accountKeys)
    .map((entry) => parseAccountKey(entry))
    .filter((entry): entry is string => Boolean(entry));

  const loadedAddresses = asRecord(metaRecord?.loadedAddresses);
  const loadedWritable = asArray(loadedAddresses?.writable)
    .map((entry) => parseAccountKey(entry))
    .filter((entry): entry is string => Boolean(entry));
  const loadedReadonly = asArray(loadedAddresses?.readonly)
    .map((entry) => parseAccountKey(entry))
    .filter((entry): entry is string => Boolean(entry));

  return [...staticKeys, ...loadedWritable, ...loadedReadonly];
}

function parseInstruction(
  rawInstruction: unknown,
  accountKeys: string[],
): DecodedInstruction | null {
  const instructionRecord = asRecord(rawInstruction);
  if (!instructionRecord) return null;

  let programId = asString(instructionRecord.programId);
  const programIdIndex = asNumber(instructionRecord.programIdIndex);
  if (!programId && Number.isInteger(programIdIndex)) {
    const resolved = accountKeys[programIdIndex as number];
    if (resolved) {
      programId = resolved;
    }
  }
  if (!programId) return null;

  const accountIndices: number[] = [];
  const accounts: string[] = [];
  for (const rawAccount of asArray(instructionRecord.accounts)) {
    const accountIndex = asNumber(rawAccount);
    if (Number.isInteger(accountIndex)) {
      const safeIndex = accountIndex as number;
      accountIndices.push(safeIndex);
      const key = accountKeys[safeIndex];
      if (key) {
        accounts.push(key);
      }
      continue;
    }

    const accountKey = asString(rawAccount);
    if (accountKey) {
      accounts.push(accountKey);
    }
  }

  return {
    programId,
    accounts,
    accountIndices,
    data: asString(instructionRecord.data),
    raw: instructionRecord,
  };
}

function parseInstructions(
  rawInstructions: unknown,
  accountKeys: string[],
): DecodedInstruction[] {
  const instructions: DecodedInstruction[] = [];
  for (const rawInstruction of asArray(rawInstructions)) {
    const parsed = parseInstruction(rawInstruction, accountKeys);
    if (parsed) {
      instructions.push(parsed);
    }
  }
  return instructions;
}

function parseInnerInstructions(
  metaRecord: JsonRecord | null,
  accountKeys: string[],
): DecodedInstruction[] {
  const results: DecodedInstruction[] = [];
  for (const rawInnerEntry of asArray(metaRecord?.innerInstructions)) {
    const innerEntry = asRecord(rawInnerEntry);
    if (!innerEntry) continue;
    const parsed = parseInstructions(innerEntry.instructions, accountKeys);
    results.push(...parsed);
  }
  return results;
}

function parseTokenAmountAtomic(rawTokenAmount: unknown): string | null {
  const tokenAmount = asRecord(rawTokenAmount);
  const amount = tokenAmount ? asString(tokenAmount.amount) : null;
  if (!amount || !/^\d+$/.test(amount)) return null;
  return amount;
}

function parseTokenBalance(rawBalance: unknown): TokenBalance | null {
  const record = asRecord(rawBalance);
  if (!record) return null;

  const accountIndex = asNumber(record.accountIndex);
  const mint = asString(record.mint);
  const amountAtomic = parseTokenAmountAtomic(record.uiTokenAmount);
  if (!Number.isInteger(accountIndex) || !mint || !amountAtomic) {
    return null;
  }

  const owner = asString(record.owner);
  return {
    accountIndex: accountIndex as number,
    mint,
    owner,
    amountAtomic,
  };
}

function parseTokenBalances(metaRecord: JsonRecord | null): {
  pre: TokenBalance[];
  post: TokenBalance[];
} {
  const pre: TokenBalance[] = [];
  const post: TokenBalance[] = [];

  for (const rawBalance of asArray(metaRecord?.preTokenBalances)) {
    const parsed = parseTokenBalance(rawBalance);
    if (parsed) pre.push(parsed);
  }

  for (const rawBalance of asArray(metaRecord?.postTokenBalances)) {
    const parsed = parseTokenBalance(rawBalance);
    if (parsed) post.push(parsed);
  }

  return { pre, post };
}

function parseSignature(transactionRecord: JsonRecord): string | null {
  for (const rawSignature of asArray(transactionRecord.signatures)) {
    const signature = asString(rawSignature);
    if (signature && signature.length > 0) {
      return signature;
    }
  }
  return null;
}

function parseMessageRecord(transactionRecord: JsonRecord): JsonRecord | null {
  return asRecord(transactionRecord.message);
}

function buildTimestamp(blockTime: number | null, observedAt: string): string {
  if (blockTime !== null) {
    const iso = unixSecondsToIso(blockTime);
    if (iso) return iso;
  }
  return observedAt;
}

export class DecoderRegistry {
  private readonly adaptersById = new Map<string, ProtocolAdapter>();
  private readonly adaptersByProgramId = new Map<string, ProtocolAdapter[]>();

  register(adapter: ProtocolAdapter): void {
    if (!adapter.id || adapter.programIds.length === 0) return;

    this.adaptersById.set(adapter.id, adapter);

    for (const programId of adapter.programIds) {
      const normalizedProgramId = programId.trim();
      if (!normalizedProgramId) continue;

      const existing = this.adaptersByProgramId.get(normalizedProgramId) ?? [];
      if (!existing.some((entry) => entry.id === adapter.id)) {
        existing.push(adapter);
      }
      this.adaptersByProgramId.set(normalizedProgramId, existing);
    }
  }

  getAdaptersForProgramId(programId: string): ProtocolAdapter[] {
    if (!programId) return [];
    return this.adaptersByProgramId.get(programId) ?? [];
  }

  decodeTransaction(context: DecodingContext): ProtocolEvent[] {
    const adapters = new Map<string, ProtocolAdapter>();

    for (const instruction of [
      ...context.instructions,
      ...context.innerInstructions,
    ]) {
      for (const adapter of this.getAdaptersForProgramId(
        instruction.programId,
      )) {
        adapters.set(adapter.id, adapter);
      }
    }

    const events: ProtocolEvent[] = [];
    for (const adapter of adapters.values()) {
      const decoded = adapter.decode(context);
      if (decoded.length > 0) {
        events.push(...decoded);
      }
    }

    return events;
  }
}

export function createDecoderRegistry(
  adapters: ProtocolAdapter[],
): DecoderRegistry {
  const registry = new DecoderRegistry();
  for (const adapter of adapters) {
    registry.register(adapter);
  }
  return registry;
}

export function decodeProtocolEventsFromBlock(
  input: BlockDecodeInput,
): ProtocolEvent[] {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const blockRecord = asRecord(input.block);
  if (!blockRecord) return [];

  const blockTime = asNumber(blockRecord.blockTime) ?? null;
  const transactions = asArray(blockRecord.transactions);

  const events: ProtocolEvent[] = [];
  for (let txIndex = 0; txIndex < transactions.length; txIndex += 1) {
    const txEnvelope = asRecord(transactions[txIndex]);
    if (!txEnvelope) continue;

    const transactionRecord = asRecord(txEnvelope.transaction);
    if (!transactionRecord) continue;

    const signature = parseSignature(transactionRecord);
    if (!signature) continue;

    const messageRecord = parseMessageRecord(transactionRecord);
    if (!messageRecord) continue;

    const metaRecord = asRecord(txEnvelope.meta);
    const accountKeys = parseAccountKeys(messageRecord, metaRecord);
    if (accountKeys.length === 0) continue;

    const instructions = parseInstructions(
      messageRecord.instructions,
      accountKeys,
    );
    const innerInstructions = parseInnerInstructions(metaRecord, accountKeys);
    if (instructions.length === 0 && innerInstructions.length === 0) {
      continue;
    }

    const timestamp = buildTimestamp(blockTime, observedAt);
    const context: DecodingContext = {
      slot: input.slot,
      commitment: input.commitment,
      signature,
      txIndex,
      blockTime,
      timestamp,
      generatedAt: observedAt,
      observedAt,
      feePayer: accountKeys[0],
      accountKeys,
      instructions,
      innerInstructions,
      logMessages: asArray(metaRecord?.logMessages)
        .map((entry) => asString(entry))
        .filter((entry): entry is string => Boolean(entry)),
      tokenBalances: parseTokenBalances(metaRecord),
      rawTransaction: txEnvelope,
    };

    const decoded = input.registry.decodeTransaction(context);
    if (decoded.length > 0) {
      events.push(...decoded);
    }
  }

  return events;
}
