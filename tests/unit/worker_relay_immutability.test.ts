import { describe, expect, test } from "bun:test";
import {
  createRelayImmutabilitySnapshot,
  readRelayImmutabilitySnapshot,
  verifyRelayImmutabilitySnapshot,
} from "../../apps/worker/src/execution/relay_immutability";
import { buildRelaySignedPayload } from "./_relay_signed_test_utils";

describe("relay immutability helpers", () => {
  test("creates deterministic relay immutability snapshot from signed tx", async () => {
    const payload = buildRelaySignedPayload();
    const snapshot = await createRelayImmutabilitySnapshot({
      signedTransactionBase64: payload.relaySigned.signedTransaction,
      verifiedAt: "2026-03-03T05:00:00.000Z",
    });
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.hashAlgorithm).toBe("sha256");
    expect(snapshot.receivedTxHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(snapshot.submittedTxHash).toBe(snapshot.receivedTxHash);
    expect(snapshot.verifiedTxHash).toBe(snapshot.receivedTxHash);
    expect(snapshot.verifiedAt).toBe("2026-03-03T05:00:00.000Z");
  });

  test("verifies matching relay tx hash and rejects mutated payloads", async () => {
    const original = buildRelaySignedPayload();
    const mutated = buildRelaySignedPayload({ lamports: 2 });

    const created = await createRelayImmutabilitySnapshot({
      signedTransactionBase64: original.relaySigned.signedTransaction,
    });
    expect(created).not.toBeNull();
    if (!created) return;

    const verified = await verifyRelayImmutabilitySnapshot({
      expectedReceivedTxHash: created.receivedTxHash,
      signedTransactionBase64: original.relaySigned.signedTransaction,
      verifiedAt: "2026-03-03T05:10:00.000Z",
    });
    expect(verified.ok).toBe(true);

    const mismatch = await verifyRelayImmutabilitySnapshot({
      expectedReceivedTxHash: created.receivedTxHash,
      signedTransactionBase64: mutated.relaySigned.signedTransaction,
    });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.error).toBe("policy-denied");
    expect(mismatch.reason).toBe("relay-immutability-mismatch");
  });

  test("reads relay immutability snapshot from execution metadata", () => {
    const snapshot = readRelayImmutabilitySnapshot({
      relayImmutability: {
        hashAlgorithm: "sha256",
        receivedTxHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        submittedTxHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        verifiedTxHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        verifiedAt: "2026-03-03T05:20:00.000Z",
      },
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.hashAlgorithm).toBe("sha256");
  });
});
