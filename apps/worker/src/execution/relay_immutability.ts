import type { JsonObject } from "./repository";

export const RELAY_IMMUTABILITY_HASH_ALGORITHM = "sha256";

export type RelayImmutabilitySnapshot = {
  hashAlgorithm: typeof RELAY_IMMUTABILITY_HASH_ALGORITHM;
  receivedTxHash: string;
  submittedTxHash: string;
  verifiedTxHash: string;
  verifiedAt: string;
};

type RelayImmutabilityVerifyResult =
  | {
      ok: true;
      snapshot: RelayImmutabilitySnapshot;
    }
  | {
      ok: false;
      error: "invalid-transaction" | "policy-denied";
      reason: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeIso(input: string | undefined): string {
  if (!input) return new Date().toISOString();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function decodeBase64ToBytes(input: string): Uint8Array {
  const decoded = atob(input);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

async function sha256HexFromBytes(input: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", input);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function hashRelaySignedTransactionBase64(
  signedTransactionBase64: string,
): Promise<string | null> {
  const normalized = String(signedTransactionBase64 ?? "").trim();
  if (!normalized) return null;
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64ToBytes(normalized);
  } catch {
    return null;
  }
  if (bytes.length < 1) return null;
  const digestHex = await sha256HexFromBytes(bytes);
  return `${RELAY_IMMUTABILITY_HASH_ALGORITHM}:${digestHex}`;
}

export async function createRelayImmutabilitySnapshot(input: {
  signedTransactionBase64: string;
  verifiedAt?: string;
}): Promise<RelayImmutabilitySnapshot | null> {
  const txHash = await hashRelaySignedTransactionBase64(
    input.signedTransactionBase64,
  );
  if (!txHash) return null;
  return {
    hashAlgorithm: RELAY_IMMUTABILITY_HASH_ALGORITHM,
    receivedTxHash: txHash,
    submittedTxHash: txHash,
    verifiedTxHash: txHash,
    verifiedAt: normalizeIso(input.verifiedAt),
  };
}

export function readRelayImmutabilitySnapshot(
  metadata: JsonObject | null | undefined,
): RelayImmutabilitySnapshot | null {
  if (!metadata) return null;
  const raw = (metadata as Record<string, unknown>).relayImmutability;
  if (!isRecord(raw)) return null;

  const hashAlgorithm = stringOrNull(raw.hashAlgorithm);
  const receivedTxHash = stringOrNull(raw.receivedTxHash);
  const submittedTxHash = stringOrNull(raw.submittedTxHash);
  const verifiedTxHash = stringOrNull(raw.verifiedTxHash);
  const verifiedAt = stringOrNull(raw.verifiedAt);
  if (
    hashAlgorithm !== RELAY_IMMUTABILITY_HASH_ALGORITHM ||
    !receivedTxHash ||
    !submittedTxHash ||
    !verifiedTxHash ||
    !verifiedAt
  ) {
    return null;
  }

  return {
    hashAlgorithm: RELAY_IMMUTABILITY_HASH_ALGORITHM,
    receivedTxHash,
    submittedTxHash,
    verifiedTxHash,
    verifiedAt,
  };
}

export async function verifyRelayImmutabilitySnapshot(input: {
  expectedReceivedTxHash: string;
  signedTransactionBase64: string;
  verifiedAt?: string;
}): Promise<RelayImmutabilityVerifyResult> {
  const expectedReceivedTxHash = String(
    input.expectedReceivedTxHash ?? "",
  ).trim();
  if (
    !expectedReceivedTxHash ||
    !expectedReceivedTxHash.startsWith(`${RELAY_IMMUTABILITY_HASH_ALGORITHM}:`)
  ) {
    return {
      ok: false,
      error: "invalid-transaction",
      reason: "invalid-relay-immutability-hash",
    };
  }

  const submittedTxHash = await hashRelaySignedTransactionBase64(
    input.signedTransactionBase64,
  );
  if (!submittedTxHash) {
    return {
      ok: false,
      error: "invalid-transaction",
      reason: "invalid-base64",
    };
  }

  if (submittedTxHash !== expectedReceivedTxHash) {
    return {
      ok: false,
      error: "policy-denied",
      reason: "relay-immutability-mismatch",
    };
  }

  return {
    ok: true,
    snapshot: {
      hashAlgorithm: RELAY_IMMUTABILITY_HASH_ALGORITHM,
      receivedTxHash: expectedReceivedTxHash,
      submittedTxHash,
      verifiedTxHash: submittedTxHash,
      verifiedAt: normalizeIso(input.verifiedAt),
    },
  };
}
