import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

type RelayLane = "fast" | "protected" | "safe";

export function buildRelaySignedPayload(options?: {
  lane?: RelayLane;
  recentBlockhash?: string;
  lamports?: number;
  metadata?: Record<string, unknown>;
}): {
  schemaVersion: "v1";
  mode: "relay_signed";
  lane: RelayLane;
  relaySigned: {
    encoding: "base64";
    signedTransaction: string;
  };
  metadata?: Record<string, unknown>;
} {
  const payer = Keypair.fromSeed(
    Uint8Array.from([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
    ]),
  );
  const recipient = Keypair.fromSeed(
    Uint8Array.from([
      32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15,
      14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]),
  );

  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash:
      options?.recentBlockhash ?? "11111111111111111111111111111111",
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient.publicKey,
      lamports: options?.lamports ?? 1,
    }),
  );
  tx.sign(payer);

  return {
    schemaVersion: "v1",
    mode: "relay_signed",
    lane: options?.lane ?? "fast",
    relaySigned: {
      encoding: "base64",
      signedTransaction: Buffer.from(tx.serialize()).toString("base64"),
    },
    ...(options?.metadata ? { metadata: options.metadata } : {}),
  };
}
