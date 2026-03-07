import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { validateRelaySignedSubmission } from "../../apps/worker/src/execution/relay_signed_validator";
import type { Env } from "../../apps/worker/src/types";

const ORIGINAL_FETCH = globalThis.fetch;
const COMMITMENT = "confirmed";

function buildSignedLegacyTxBase64(options?: {
  recentBlockhash?: string;
  withInstruction?: boolean;
}): string {
  const payer = Keypair.generate();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash:
      options?.recentBlockhash ?? "11111111111111111111111111111111",
  });
  if (options?.withInstruction !== false) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    );
  }
  tx.sign(payer);
  return Buffer.from(tx.serialize()).toString("base64");
}

function buildUnsignedLegacyTxBase64(): string {
  const payer = Keypair.generate();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  return Buffer.from(
    tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  ).toString("base64");
}

function mockIsBlockhashValidRpc(value: boolean): void {
  globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
    if (body.method !== "isBlockhashValid") {
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "test",
        result: { value },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
}

describe("relay_signed validator", () => {
  beforeEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("rejects invalid base64 payload", async () => {
    const result = await validateRelaySignedSubmission({} as Env, {
      encoding: "base64",
      signedTransaction: "!!!not-valid-base64!!!",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid-transaction");
    expect(result.reason).toBe("invalid-base64");
  });

  test("rejects transactions without valid signatures", async () => {
    const result = await validateRelaySignedSubmission(
      { EXEC_RELAY_VALIDATE_BLOCKHASH: "0" } as Env,
      {
        encoding: "base64",
        signedTransaction: buildUnsignedLegacyTxBase64(),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid-transaction");
  });

  test("accepts signed relay transaction when blockhash check is disabled", async () => {
    const result = await validateRelaySignedSubmission(
      { EXEC_RELAY_VALIDATE_BLOCKHASH: "0" } as Env,
      {
        encoding: "base64",
        signedTransaction: buildSignedLegacyTxBase64(),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.signatureCount).toBeGreaterThanOrEqual(1);
    expect(result.parsed.feePayer).toBeString();
    expect(result.parsed.recentBlockhash).toBeString();
    expect(result.parsed.programIds.length).toBeGreaterThanOrEqual(1);
    expect(result.parsed.transactionVersion).toBe("legacy");
  });

  test("rejects stale blockhash when RPC check fails", async () => {
    mockIsBlockhashValidRpc(false);
    const result = await validateRelaySignedSubmission(
      {
        EXEC_RELAY_VALIDATE_BLOCKHASH: "1",
        EXEC_RELAY_BLOCKHASH_COMMITMENT: COMMITMENT,
        EXEC_RELAY_RPC_ENDPOINT: "https://rpc.test",
      } as Env,
      {
        encoding: "base64",
        signedTransaction: buildSignedLegacyTxBase64(),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid-transaction");
    expect(result.reason).toBe("stale-blockhash");
  });

  test("rejects denylisted programs and non-allowlisted programs", async () => {
    const systemProgram = SystemProgram.programId.toBase58();
    const denylisted = await validateRelaySignedSubmission(
      {
        EXEC_RELAY_VALIDATE_BLOCKHASH: "0",
        EXEC_RELAY_PROGRAM_DENYLIST: systemProgram,
      } as Env,
      {
        encoding: "base64",
        signedTransaction: buildSignedLegacyTxBase64(),
      },
    );
    expect(denylisted.ok).toBe(false);
    if (denylisted.ok) return;
    expect(denylisted.error).toBe("policy-denied");

    const allowlisted = await validateRelaySignedSubmission(
      {
        EXEC_RELAY_VALIDATE_BLOCKHASH: "0",
        EXEC_RELAY_PROGRAM_ALLOWLIST:
          "ComputeBudget111111111111111111111111111111",
      } as Env,
      {
        encoding: "base64",
        signedTransaction: buildSignedLegacyTxBase64(),
      },
    );
    expect(allowlisted.ok).toBe(false);
    if (allowlisted.ok) return;
    expect(allowlisted.error).toBe("policy-denied");
  });
});
