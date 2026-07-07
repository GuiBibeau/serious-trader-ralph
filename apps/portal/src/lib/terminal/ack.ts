// First-trade risk acknowledgment (PRD #493 / #497). One ack per wallet,
// stored locally like the Phoenix referral onboarding key. storage is
// injectable so tests never touch the real localStorage.

const ACK_KEY = "trader-ralph-terminal/trade-ack/v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function readAcked(storage: StorageLike): string[] {
  try {
    const raw = storage.getItem(ACK_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

export function hasAcked(
  wallet: string | null,
  storage?: StorageLike,
): boolean {
  if (!wallet) return false;
  const store =
    storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return false;
  return readAcked(store).includes(wallet);
}

export function recordAck(wallet: string | null, storage?: StorageLike): void {
  if (!wallet) return;
  const store =
    storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return;
  try {
    const acked = new Set(readAcked(store));
    acked.add(wallet);
    store.setItem(ACK_KEY, JSON.stringify([...acked]));
  } catch {
    /* storage unavailable: ack lasts the session via caller state */
  }
}
