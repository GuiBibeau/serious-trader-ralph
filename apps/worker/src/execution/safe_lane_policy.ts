import { Transaction, VersionedTransaction } from "@solana/web3.js";
import type { Env } from "../types";

const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const DEFAULT_MAX_TX_BYTES = 1_232;
const DEFAULT_MAX_INSTRUCTION_COUNT = 24;
const DEFAULT_MAX_ACCOUNT_KEYS = 96;
const DEFAULT_MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const DEFAULT_MAX_ESTIMATED_FEE_LAMPORTS = 2_000_000n;
const DEFAULT_COMPUTE_UNIT_LIMIT_FOR_ESTIMATE = 200_000;
const BASE_FEE_LAMPORTS_PER_SIGNATURE = 5_000n;

export type SafeLaneTxProfile = {
  txSizeBytes: number;
  instructionCount: number;
  accountKeyCount: number;
  addressTableLookupCount: number;
  signatureCount: number;
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: string | null;
  estimatedFeeLamports: string;
};

export type SafeLanePolicyLimits = {
  maxTxBytes: number;
  maxInstructionCount: number;
  maxAccountKeys: number;
  maxComputeUnitLimit: number;
  maxEstimatedFeeLamports: string;
};

type SafeLaneLimitsInternal = {
  maxTxBytes: number;
  maxInstructionCount: number;
  maxAccountKeys: number;
  maxComputeUnitLimit: number;
  maxEstimatedFeeLamports: bigint;
};

export type SafeLanePolicyResult =
  | {
      ok: true;
      profile: SafeLaneTxProfile;
      limits: SafeLanePolicyLimits;
    }
  | {
      ok: false;
      reason:
        | "safe-lane-invalid-transaction"
        | "safe-lane-max-tx-bytes-exceeded"
        | "safe-lane-max-instruction-count-exceeded"
        | "safe-lane-max-account-keys-exceeded"
        | "safe-lane-max-compute-unit-limit-exceeded"
        | "safe-lane-max-estimated-fee-exceeded";
      profile: SafeLaneTxProfile | null;
      limits: SafeLanePolicyLimits;
    };

type ComputeBudgetSnapshot = {
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: bigint | null;
};

function parseBoundedInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.floor(parsed);
  if (bounded < min) return min;
  if (bounded > max) return max;
  return bounded;
}

function parseBoundedBigInt(
  raw: unknown,
  fallback: bigint,
  min: bigint,
  max: bigint,
): bigint {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  let parsed: bigint;
  try {
    parsed = BigInt(text);
  } catch {
    return fallback;
  }
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function resolveLimits(env: Env): SafeLaneLimitsInternal {
  return {
    maxTxBytes: parseBoundedInt(
      env.EXEC_SAFE_MAX_TX_BYTES,
      DEFAULT_MAX_TX_BYTES,
      256,
      2_048,
    ),
    maxInstructionCount: parseBoundedInt(
      env.EXEC_SAFE_MAX_INSTRUCTION_COUNT,
      DEFAULT_MAX_INSTRUCTION_COUNT,
      1,
      64,
    ),
    maxAccountKeys: parseBoundedInt(
      env.EXEC_SAFE_MAX_ACCOUNT_KEYS,
      DEFAULT_MAX_ACCOUNT_KEYS,
      8,
      256,
    ),
    maxComputeUnitLimit: parseBoundedInt(
      env.EXEC_SAFE_MAX_COMPUTE_UNIT_LIMIT,
      DEFAULT_MAX_COMPUTE_UNIT_LIMIT,
      100_000,
      2_000_000,
    ),
    maxEstimatedFeeLamports: parseBoundedBigInt(
      env.EXEC_SAFE_MAX_ESTIMATED_FEE_LAMPORTS,
      DEFAULT_MAX_ESTIMATED_FEE_LAMPORTS,
      10_000n,
      100_000_000n,
    ),
  };
}

function publicLimits(input: SafeLaneLimitsInternal): SafeLanePolicyLimits {
  return {
    maxTxBytes: input.maxTxBytes,
    maxInstructionCount: input.maxInstructionCount,
    maxAccountKeys: input.maxAccountKeys,
    maxComputeUnitLimit: input.maxComputeUnitLimit,
    maxEstimatedFeeLamports: input.maxEstimatedFeeLamports.toString(),
  };
}

function decodeBase64ToBytes(value: string): Uint8Array {
  const decoded = atob(value);
  const out = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    out[i] = decoded.charCodeAt(i);
  }
  return out;
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
  for (let i = 0; i < 8; i += 1) {
    value += BigInt(data[offset + i] ?? 0) << (8n * BigInt(i));
  }
  return value;
}

function updateComputeBudgetSnapshot(
  snapshot: ComputeBudgetSnapshot,
  data: Uint8Array,
): void {
  const discriminator = data[0];
  if (discriminator === 2) {
    const limit = readU32Le(data, 1);
    if (limit !== null) snapshot.computeUnitLimit = limit;
    return;
  }
  if (discriminator === 3) {
    const microLamports = readU64LeBigInt(data, 1);
    if (microLamports !== null) {
      snapshot.computeUnitPriceMicroLamports = microLamports;
    }
  }
}

function estimateFeeLamports(input: {
  signatureCount: number;
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: bigint | null;
}): bigint {
  const baseFee =
    BigInt(Math.max(0, Math.floor(input.signatureCount))) *
    BASE_FEE_LAMPORTS_PER_SIGNATURE;
  const unitLimit = BigInt(
    input.computeUnitLimit ?? DEFAULT_COMPUTE_UNIT_LIMIT_FOR_ESTIMATE,
  );
  const unitPrice = input.computeUnitPriceMicroLamports ?? 0n;
  const priorityFee = (unitLimit * unitPrice + 999_999n) / 1_000_000n;
  return baseFee + priorityFee;
}

function buildProfile(input: {
  txSizeBytes: number;
  instructionCount: number;
  accountKeyCount: number;
  addressTableLookupCount: number;
  signatureCount: number;
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: bigint | null;
}): SafeLaneTxProfile {
  const estimatedFeeLamports = estimateFeeLamports({
    signatureCount: input.signatureCount,
    computeUnitLimit: input.computeUnitLimit,
    computeUnitPriceMicroLamports: input.computeUnitPriceMicroLamports,
  });
  return {
    txSizeBytes: input.txSizeBytes,
    instructionCount: input.instructionCount,
    accountKeyCount: input.accountKeyCount,
    addressTableLookupCount: input.addressTableLookupCount,
    signatureCount: input.signatureCount,
    computeUnitLimit: input.computeUnitLimit,
    computeUnitPriceMicroLamports:
      input.computeUnitPriceMicroLamports === null
        ? null
        : input.computeUnitPriceMicroLamports.toString(),
    estimatedFeeLamports: estimatedFeeLamports.toString(),
  };
}

function inspectLegacyTransaction(
  rawBytes: Uint8Array,
): SafeLaneTxProfile | null {
  try {
    const tx = Transaction.from(rawBytes as unknown as Buffer);
    const computeBudget: ComputeBudgetSnapshot = {
      computeUnitLimit: null,
      computeUnitPriceMicroLamports: null,
    };
    const instructions = tx.instructions ?? [];
    for (const ix of instructions) {
      if (ix.programId.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) continue;
      updateComputeBudgetSnapshot(computeBudget, ix.data);
    }
    return buildProfile({
      txSizeBytes: rawBytes.length,
      instructionCount: instructions.length,
      accountKeyCount: tx.compileMessage().accountKeys.length,
      addressTableLookupCount: 0,
      signatureCount: tx.signatures.length,
      computeUnitLimit: computeBudget.computeUnitLimit,
      computeUnitPriceMicroLamports:
        computeBudget.computeUnitPriceMicroLamports,
    });
  } catch {
    return null;
  }
}

function inspectVersionedTransaction(
  rawBytes: Uint8Array,
): SafeLaneTxProfile | null {
  try {
    const tx = VersionedTransaction.deserialize(rawBytes);
    const computeBudget: ComputeBudgetSnapshot = {
      computeUnitLimit: null,
      computeUnitPriceMicroLamports: null,
    };
    const instructions = tx.message.compiledInstructions ?? [];
    for (const ix of instructions) {
      const programId = tx.message.staticAccountKeys[ix.programIdIndex]
        ?.toBase58()
        .trim();
      if (programId !== COMPUTE_BUDGET_PROGRAM_ID) continue;
      updateComputeBudgetSnapshot(computeBudget, ix.data);
    }
    const lookups = tx.message.addressTableLookups ?? [];
    const lookupAccountCount = lookups.reduce((total, lookup) => {
      return (
        total + lookup.writableIndexes.length + lookup.readonlyIndexes.length
      );
    }, 0);
    return buildProfile({
      txSizeBytes: rawBytes.length,
      instructionCount: instructions.length,
      accountKeyCount: tx.message.staticAccountKeys.length + lookupAccountCount,
      addressTableLookupCount: lookups.length,
      signatureCount: tx.signatures.length,
      computeUnitLimit: computeBudget.computeUnitLimit,
      computeUnitPriceMicroLamports:
        computeBudget.computeUnitPriceMicroLamports,
    });
  } catch {
    return null;
  }
}

function inspectSignedTransaction(
  signedTransactionBase64: string,
): SafeLaneTxProfile | null {
  let rawBytes: Uint8Array;
  try {
    rawBytes = decodeBase64ToBytes(signedTransactionBase64);
  } catch {
    return null;
  }
  return (
    inspectVersionedTransaction(rawBytes) ?? inspectLegacyTransaction(rawBytes)
  );
}

export function evaluateSafeLaneTransaction(input: {
  env: Env;
  signedTransactionBase64: string;
}): SafeLanePolicyResult {
  const limits = resolveLimits(input.env);
  const publicLimitsSnapshot = publicLimits(limits);
  const profile = inspectSignedTransaction(input.signedTransactionBase64);

  if (!profile) {
    return {
      ok: false,
      reason: "safe-lane-invalid-transaction",
      profile: null,
      limits: publicLimitsSnapshot,
    };
  }

  if (profile.txSizeBytes > limits.maxTxBytes) {
    return {
      ok: false,
      reason: "safe-lane-max-tx-bytes-exceeded",
      profile,
      limits: publicLimitsSnapshot,
    };
  }
  if (profile.instructionCount > limits.maxInstructionCount) {
    return {
      ok: false,
      reason: "safe-lane-max-instruction-count-exceeded",
      profile,
      limits: publicLimitsSnapshot,
    };
  }
  if (profile.accountKeyCount > limits.maxAccountKeys) {
    return {
      ok: false,
      reason: "safe-lane-max-account-keys-exceeded",
      profile,
      limits: publicLimitsSnapshot,
    };
  }
  if (
    profile.computeUnitLimit !== null &&
    profile.computeUnitLimit > limits.maxComputeUnitLimit
  ) {
    return {
      ok: false,
      reason: "safe-lane-max-compute-unit-limit-exceeded",
      profile,
      limits: publicLimitsSnapshot,
    };
  }
  if (BigInt(profile.estimatedFeeLamports) > limits.maxEstimatedFeeLamports) {
    return {
      ok: false,
      reason: "safe-lane-max-estimated-fee-exceeded",
      profile,
      limits: publicLimitsSnapshot,
    };
  }

  return {
    ok: true,
    profile,
    limits: publicLimitsSnapshot,
  };
}
