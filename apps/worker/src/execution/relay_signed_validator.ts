import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { SolanaRpc } from "../solana_rpc";
import type { Env } from "../types";
import type { ExecSubmitRequestV1 } from "./submit_contract";

const MAINNET_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";
const DEVNET_RPC_ENDPOINT = "https://api.devnet.solana.com";
const MAX_RELAY_TX_BYTES = 2_048;

type RelaySignedPayload = NonNullable<ExecSubmitRequestV1["relaySigned"]>;
type BlockhashCommitment = "processed" | "confirmed" | "finalized";

type ParsedRelayTransaction = {
  transactionVersion: "legacy" | "v0";
  signatureCount: number;
  recentBlockhash: string;
  feePayer: string;
  programIds: string[];
  txSizeBytes: number;
};

export type RelaySignedValidationResult =
  | {
      ok: true;
      parsed: ParsedRelayTransaction;
    }
  | {
      ok: false;
      error: "invalid-transaction" | "policy-denied";
      reason: string;
    };

function parseCsvSet(raw: string | undefined): Set<string> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function normalizeBlockhashCommitment(raw: unknown): BlockhashCommitment {
  const value = String(raw ?? "confirmed")
    .trim()
    .toLowerCase();
  if (value === "processed") return "processed";
  if (value === "finalized") return "finalized";
  return "confirmed";
}

function shouldValidateBlockhash(env: Env): boolean {
  const value = String(env.EXEC_RELAY_VALIDATE_BLOCKHASH ?? "1")
    .trim()
    .toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
}

function resolveRelayRpcEndpoint(env: Env): string {
  const explicit = String(env.EXEC_RELAY_RPC_ENDPOINT ?? "").trim();
  if (explicit) return explicit;
  const balance = String(env.BALANCE_RPC_ENDPOINT ?? "").trim();
  if (balance) return balance;
  const rpc = String(env.RPC_ENDPOINT ?? "").trim();
  if (rpc) return rpc;
  const network = String(env.X402_NETWORK ?? "")
    .trim()
    .toLowerCase();
  if (network.includes("devnet")) return DEVNET_RPC_ENDPOINT;
  return MAINNET_RPC_ENDPOINT;
}

function decodeBase64ToBytes(value: string): Uint8Array {
  const decoded = atob(value);
  const out = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    out[i] = decoded.charCodeAt(i);
  }
  return out;
}

function isZeroedSignature(signature: Uint8Array): boolean {
  for (let i = 0; i < signature.length; i += 1) {
    if (signature[i] !== 0) return false;
  }
  return true;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function parseLegacyTransaction(
  rawBytes: Uint8Array,
): ParsedRelayTransaction | null {
  try {
    const tx = Transaction.from(rawBytes as unknown as Buffer);
    const signatureCount = tx.signatures.length;
    const hasValidSignature = tx.signatures.some(
      (entry) => entry.signature && !isZeroedSignature(entry.signature),
    );
    if (signatureCount < 1 || !hasValidSignature) return null;

    if (!tx.recentBlockhash || !tx.recentBlockhash.trim()) return null;
    const feePayer = tx.feePayer?.toBase58()?.trim() ?? "";
    if (!feePayer) return null;
    if (!tx.instructions || tx.instructions.length < 1) return null;

    const programIds = unique(
      tx.instructions.map((ix) => ix.programId.toBase58()).filter(Boolean),
    );
    if (programIds.length < 1) return null;

    return {
      transactionVersion: "legacy",
      signatureCount,
      recentBlockhash: tx.recentBlockhash,
      feePayer,
      programIds,
      txSizeBytes: rawBytes.length,
    };
  } catch {
    return null;
  }
}

function parseVersionedTransaction(
  rawBytes: Uint8Array,
): ParsedRelayTransaction | null {
  try {
    const tx = VersionedTransaction.deserialize(rawBytes);
    const signatureCount = tx.signatures.length;
    const hasValidSignature = tx.signatures.some(
      (signature) => !isZeroedSignature(signature),
    );
    if (signatureCount < 1 || !hasValidSignature) return null;
    if (!tx.message.recentBlockhash || !tx.message.recentBlockhash.trim()) {
      return null;
    }

    const feePayer = tx.message.staticAccountKeys[0]?.toBase58()?.trim() ?? "";
    if (!feePayer) return null;

    const compiledInstructions = tx.message.compiledInstructions ?? [];
    if (compiledInstructions.length < 1) return null;
    const programIds = unique(
      compiledInstructions
        .map((ix) =>
          tx.message.staticAccountKeys[ix.programIdIndex]?.toBase58(),
        )
        .filter((value): value is string => Boolean(value)),
    );
    if (programIds.length < 1) return null;

    return {
      transactionVersion: "v0",
      signatureCount,
      recentBlockhash: tx.message.recentBlockhash,
      feePayer,
      programIds,
      txSizeBytes: rawBytes.length,
    };
  } catch {
    return null;
  }
}

async function validateBlockhashFreshness(
  env: Env,
  recentBlockhash: string,
): Promise<boolean> {
  const commitment = normalizeBlockhashCommitment(
    env.EXEC_RELAY_BLOCKHASH_COMMITMENT,
  );
  const rpc = new SolanaRpc(resolveRelayRpcEndpoint(env));
  return await rpc.isBlockhashValid(recentBlockhash, { commitment });
}

function validateProgramPolicy(
  env: Env,
  programIds: string[],
): RelaySignedValidationResult | null {
  const denylist = parseCsvSet(env.EXEC_RELAY_PROGRAM_DENYLIST);
  const allowlist = parseCsvSet(env.EXEC_RELAY_PROGRAM_ALLOWLIST);

  const denied = programIds.find((programId) => denylist.has(programId));
  if (denied) {
    return {
      ok: false,
      error: "policy-denied",
      reason: `program-denylisted:${denied}`,
    };
  }

  if (allowlist.size > 0) {
    const notAllowed = programIds.find(
      (programId) => !allowlist.has(programId),
    );
    if (notAllowed) {
      return {
        ok: false,
        error: "policy-denied",
        reason: `program-not-allowlisted:${notAllowed}`,
      };
    }
  }

  return null;
}

export async function validateRelaySignedSubmission(
  env: Env,
  payload: RelaySignedPayload,
): Promise<RelaySignedValidationResult> {
  if (payload.encoding !== "base64") {
    return {
      ok: false,
      error: "invalid-transaction",
      reason: "unsupported-encoding",
    };
  }

  let rawBytes: Uint8Array;
  try {
    rawBytes = decodeBase64ToBytes(payload.signedTransaction);
  } catch {
    return {
      ok: false,
      error: "invalid-transaction",
      reason: "invalid-base64",
    };
  }

  if (rawBytes.length < 64 || rawBytes.length > MAX_RELAY_TX_BYTES) {
    return {
      ok: false,
      error: "invalid-transaction",
      reason: "invalid-transaction-size",
    };
  }

  const parsed =
    parseLegacyTransaction(rawBytes) ?? parseVersionedTransaction(rawBytes);
  if (!parsed) {
    return {
      ok: false,
      error: "invalid-transaction",
      reason: "decode-failed-or-missing-signature",
    };
  }

  const policyResult = validateProgramPolicy(env, parsed.programIds);
  if (policyResult) return policyResult;

  if (shouldValidateBlockhash(env)) {
    let blockhashValid = false;
    try {
      blockhashValid = await validateBlockhashFreshness(
        env,
        parsed.recentBlockhash,
      );
    } catch {
      return {
        ok: false,
        error: "invalid-transaction",
        reason: "blockhash-check-failed",
      };
    }
    if (!blockhashValid) {
      return {
        ok: false,
        error: "invalid-transaction",
        reason: "stale-blockhash",
      };
    }
  }

  return {
    ok: true,
    parsed,
  };
}
