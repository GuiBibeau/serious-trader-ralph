import { describe, expect, test } from "bun:test";
import { hasAcked, recordAck } from "./ack";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

// Map-backed fake so tests never touch the real localStorage. The ack module
// persists under its versioned key; seeding raw values there exercises the
// corrupt/non-array branches without leaking through to other tests.
const ACK_KEY = "trader-ralph-terminal/trade-ack/v1";

function fakeStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe("hasAcked / recordAck", () => {
  test("null wallet: not acked, recordAck is a no-throw no-op", () => {
    const storage = fakeStorage();
    expect(hasAcked(null, storage)).toBe(false);
    expect(() => recordAck(null, storage)).not.toThrow();
    expect(storage.getItem(ACK_KEY)).toBeNull();
  });

  test("unknown wallet is not acked", () => {
    const storage = fakeStorage();
    expect(hasAcked("WALLET_A", storage)).toBe(false);
  });

  test("recordAck then hasAcked is true", () => {
    const storage = fakeStorage();
    recordAck("WALLET_A", storage);
    expect(hasAcked("WALLET_A", storage)).toBe(true);
  });

  test("two wallets are independent", () => {
    const storage = fakeStorage();
    recordAck("WALLET_A", storage);
    expect(hasAcked("WALLET_A", storage)).toBe(true);
    expect(hasAcked("WALLET_B", storage)).toBe(false);
    recordAck("WALLET_B", storage);
    expect(hasAcked("WALLET_B", storage)).toBe(true);
    expect(hasAcked("WALLET_A", storage)).toBe(true);
  });

  test("recordAck is idempotent (no duplicate entries)", () => {
    const storage = fakeStorage();
    recordAck("WALLET_A", storage);
    recordAck("WALLET_A", storage);
    expect(hasAcked("WALLET_A", storage)).toBe(true);
    expect(JSON.parse(storage.getItem(ACK_KEY) ?? "[]")).toEqual(["WALLET_A"]);
  });
});

describe("corrupt storage", () => {
  test("corrupted JSON reads as not acked (no throw)", () => {
    const storage = fakeStorage();
    storage.setItem(ACK_KEY, "{not json");
    expect(() => hasAcked("WALLET_A", storage)).not.toThrow();
    expect(hasAcked("WALLET_A", storage)).toBe(false);
  });

  test("non-array JSON reads as not acked", () => {
    const storage = fakeStorage();
    storage.setItem(ACK_KEY, '"WALLET_A"');
    expect(hasAcked("WALLET_A", storage)).toBe(false);
  });

  test("non-string entries are filtered out, valid ones kept", () => {
    const storage = fakeStorage();
    storage.setItem(
      ACK_KEY,
      JSON.stringify(["WALLET_A", 42, null, { bad: true }, "WALLET_B"]),
    );
    expect(hasAcked("WALLET_A", storage)).toBe(true);
    expect(hasAcked("WALLET_B", storage)).toBe(true);
    expect(hasAcked("42", storage)).toBe(false);
  });

  test("recordAck repairs a corrupted key in place", () => {
    const storage = fakeStorage();
    storage.setItem(ACK_KEY, "{not json");
    recordAck("WALLET_A", storage);
    expect(hasAcked("WALLET_A", storage)).toBe(true);
    expect(JSON.parse(storage.getItem(ACK_KEY) ?? "[]")).toEqual(["WALLET_A"]);
  });
});
