import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type {
  JupiterQuoteResponse,
  JupiterSerializedInstruction,
} from "../jupiter";
import { evaluateOracleReferencePriceGuard } from "../oracle_reference";
import type { ExecutionConfig } from "../types";
import type { ExecuteSwapInput } from "./types";

const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";

export type JupiterComposedPlanSummary = {
  mode: "instructions";
  routeHopCount: number;
  routeLabels: string[];
  instructionCount: number;
  computeBudgetInstructionCount: number;
  setupInstructionCount: number;
  cleanupInstructionCount: number;
  otherInstructionCount: number;
  addressLookupTableCount: number;
  addressLookupTableAddresses: string[];
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: string | null;
};

export type BuiltJupiterComposedPlan = {
  serializedBase64: string;
  usedQuote: JupiterQuoteResponse;
  txBuiltAt: string;
  lastValidBlockHeight: number;
  summary: JupiterComposedPlanSummary;
  referenceGuard: Awaited<ReturnType<typeof evaluateOracleReferencePriceGuard>>;
};

function readsTruthyExecutionParam(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

export function shouldUseJupiterComposedPlan(input: ExecuteSwapInput): boolean {
  return (
    readsTruthyExecutionParam(input.execution?.params?.composePlan) ||
    readsTruthyExecutionParam(input.execution?.params?.useSwapInstructions) ||
    String(input.execution?.params?.transactionShape ?? "")
      .trim()
      .toLowerCase() === "instructions"
  );
}

function encodeBase64Bytes(value: Uint8Array): string {
  let binary = "";
  for (const item of value) {
    binary += String.fromCharCode(item);
  }
  return btoa(binary);
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function toTransactionInstruction(
  input: JupiterSerializedInstruction,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(input.programId),
    keys: (Array.isArray(input.accounts) ? input.accounts : []).map(
      (account) => ({
        pubkey: new PublicKey(account.pubkey),
        isSigner: Boolean(account.isSigner),
        isWritable: Boolean(account.isWritable),
      }),
    ),
    data: decodeBase64Bytes(String(input.data ?? "")),
  });
}

function readInstructionDiscriminator(
  input: JupiterSerializedInstruction,
): number | null {
  if (input.programId !== COMPUTE_BUDGET_PROGRAM_ID) return null;
  const data = decodeBase64Bytes(String(input.data ?? ""));
  return data.length > 0 ? (data[0] ?? null) : null;
}

function parseOverrideInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function appendComputeBudgetOverrides(input: {
  instructions: JupiterSerializedInstruction[];
  execution?: ExecutionConfig;
}): TransactionInstruction[] {
  const computeUnitLimit = parseOverrideInt(
    input.execution?.params?.computeUnitLimit,
  );
  const priorityMicroLamports = parseOverrideInt(
    input.execution?.params?.priorityMicroLamports,
  );
  const filtered = input.instructions.filter((instruction) => {
    const discriminator = readInstructionDiscriminator(instruction);
    if (computeUnitLimit !== null && discriminator === 2) {
      return false;
    }
    if (priorityMicroLamports !== null && discriminator === 3) {
      return false;
    }
    return true;
  });
  const output = filtered.map((instruction) =>
    toTransactionInstruction(instruction),
  );
  if (computeUnitLimit !== null) {
    output.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: computeUnitLimit,
      }),
    );
  }
  if (priorityMicroLamports !== null) {
    output.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityMicroLamports,
      }),
    );
  }
  return output;
}

function readU32Le(data: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > data.length) return null;
  const view = new DataView(
    data.buffer,
    data.byteOffset + offset,
    data.byteLength - offset,
  );
  return view.getUint32(0, true);
}

function readU64LeBigInt(data: Uint8Array, offset: number): bigint | null {
  if (offset < 0 || offset + 8 > data.length) return null;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value += BigInt(data[offset + index] ?? 0) << (8n * BigInt(index));
  }
  return value;
}

function summarizeComputeBudget(
  instructions: TransactionInstruction[],
): Pick<
  JupiterComposedPlanSummary,
  "computeUnitLimit" | "computeUnitPriceMicroLamports"
> {
  let computeUnitLimit: number | null = null;
  let computeUnitPriceMicroLamports: string | null = null;
  for (const instruction of instructions) {
    if (instruction.programId.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) {
      continue;
    }
    const discriminator = instruction.data[0];
    if (discriminator === 2) {
      computeUnitLimit = readU32Le(instruction.data, 1);
    } else if (discriminator === 3) {
      const price = readU64LeBigInt(instruction.data, 1);
      computeUnitPriceMicroLamports = price === null ? null : price.toString();
    }
  }
  return {
    computeUnitLimit,
    computeUnitPriceMicroLamports,
  };
}

function routeLabelsFromQuote(quote: JupiterQuoteResponse): string[] {
  const labels = new Set<string>();
  for (const hop of Array.isArray(quote.routePlan) ? quote.routePlan : []) {
    const label = String(hop?.swapInfo?.label ?? "").trim();
    if (label) labels.add(label);
  }
  return Array.from(labels);
}

function shouldAssembleComposedPlan(input: ExecuteSwapInput): boolean {
  if (input.policy.simulateOnly) return true;
  return input.runtimeMode === "shadow" || input.runtimeMode === "paper";
}

export function shouldFallbackToPrebuiltJupiterSwap(
  input: ExecuteSwapInput,
): boolean {
  return (
    shouldUseJupiterComposedPlan(input) && !shouldAssembleComposedPlan(input)
  );
}

export async function buildJupiterComposedPlan(
  input: ExecuteSwapInput,
): Promise<BuiltJupiterComposedPlan> {
  const priorityMicroLamports = parseOverrideInt(
    input.execution?.params?.priorityMicroLamports,
  );
  const instructionsResponse = await input.jupiter.swapInstructions({
    quoteResponse: input.quoteResponse,
    userPublicKey: input.userPublicKey,
    dynamicComputeUnitLimit: true,
  });
  const addressLookupTableAddresses = Array.from(
    new Set(
      (Array.isArray(instructionsResponse.addressLookupTableAddresses)
        ? instructionsResponse.addressLookupTableAddresses
        : []
      )
        .map((value) => String(value ?? "").trim())
        .filter((value) => Boolean(value)),
    ),
  );
  const lookupTableAccounts = await input.rpc.getAddressLookupTableAccounts(
    addressLookupTableAddresses,
  );
  const latestBlockhash = await input.rpc.getLatestBlockhash(
    input.policy.commitment,
  );
  const computeBudgetInstructions = appendComputeBudgetOverrides({
    instructions: Array.isArray(instructionsResponse.computeBudgetInstructions)
      ? instructionsResponse.computeBudgetInstructions
      : [],
    execution: input.execution,
  });
  const otherInstructions = (
    Array.isArray(instructionsResponse.otherInstructions)
      ? instructionsResponse.otherInstructions
      : []
  ).map((instruction) => toTransactionInstruction(instruction));
  const setupInstructions = (
    Array.isArray(instructionsResponse.setupInstructions)
      ? instructionsResponse.setupInstructions
      : []
  ).map((instruction) => toTransactionInstruction(instruction));
  const tokenLedgerInstruction = instructionsResponse.tokenLedgerInstruction
    ? [toTransactionInstruction(instructionsResponse.tokenLedgerInstruction)]
    : [];
  const swapInstruction = toTransactionInstruction(
    instructionsResponse.swapInstruction,
  );
  const cleanupInstructions = instructionsResponse.cleanupInstruction
    ? [toTransactionInstruction(instructionsResponse.cleanupInstruction)]
    : [];
  const instructions = [
    ...computeBudgetInstructions,
    ...otherInstructions,
    ...setupInstructions,
    ...tokenLedgerInstruction,
    swapInstruction,
    ...cleanupInstructions,
  ];
  const compiledMessage = new TransactionMessage({
    payerKey: new PublicKey(input.userPublicKey),
    recentBlockhash: latestBlockhash.blockhash,
    instructions,
  }).compileToV0Message(lookupTableAccounts);
  const transaction = new VersionedTransaction(compiledMessage);
  transaction.signatures = Array.from(
    { length: compiledMessage.header.numRequiredSignatures },
    () => new Uint8Array(64),
  );
  const serializedBase64 = encodeBase64Bytes(transaction.serialize());
  const computeBudget = summarizeComputeBudget(instructions);
  const referenceGuard = await evaluateOracleReferencePriceGuard({
    env: input.env,
    mode: input.runtimeMode ?? "paper",
    inputMint: input.quoteResponse.inputMint,
    outputMint: input.quoteResponse.outputMint,
    inputAmountAtomic: String(input.quoteResponse.inAmount ?? ""),
    expectedOutputAmountAtomic: String(input.quoteResponse.outAmount ?? ""),
    jupiter: input.jupiter,
  });
  return {
    serializedBase64,
    usedQuote: input.quoteResponse,
    txBuiltAt: new Date().toISOString(),
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    summary: {
      mode: "instructions",
      routeHopCount: Array.isArray(input.quoteResponse.routePlan)
        ? input.quoteResponse.routePlan.length
        : 0,
      routeLabels: routeLabelsFromQuote(input.quoteResponse),
      instructionCount: instructions.length,
      computeBudgetInstructionCount: computeBudgetInstructions.length,
      setupInstructionCount:
        setupInstructions.length + tokenLedgerInstruction.length,
      cleanupInstructionCount: cleanupInstructions.length,
      otherInstructionCount: otherInstructions.length,
      addressLookupTableCount: lookupTableAccounts.length,
      addressLookupTableAddresses,
      computeUnitLimit: computeBudget.computeUnitLimit,
      computeUnitPriceMicroLamports:
        priorityMicroLamports !== null
          ? String(priorityMicroLamports)
          : computeBudget.computeUnitPriceMicroLamports,
    },
    referenceGuard,
  };
}
