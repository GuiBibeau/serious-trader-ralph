import { describe, expect, test } from "bun:test";
import {
  hasAutoOpenedWizard,
  hasDismissedWelcome,
  recordWelcomeDismissed,
  recordWizardAutoOpened,
} from "./welcome";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

// Map-backed fake so tests never touch the real localStorage. The welcome
// module persists under its versioned key; seeding raw values there
// exercises the corrupt/non-array branches without leaking through to
// other tests.
const WELCOME_KEY = "trader-ralph-terminal/welcome-dismissed/v1";
const WIZARD_KEY = "trader-ralph-terminal/wizard-auto/v1";

function fakeStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe("hasDismissedWelcome / recordWelcomeDismissed", () => {
  test("null wallet: not dismissed, record is a no-throw no-op", () => {
    const storage = fakeStorage();
    expect(hasDismissedWelcome(null, storage)).toBe(false);
    expect(() => recordWelcomeDismissed(null, storage)).not.toThrow();
    expect(storage.getItem(WELCOME_KEY)).toBeNull();
  });

  test("unknown wallet is not dismissed", () => {
    const storage = fakeStorage();
    expect(hasDismissedWelcome("WALLET_A", storage)).toBe(false);
  });

  test("recordWelcomeDismissed then hasDismissedWelcome is true", () => {
    const storage = fakeStorage();
    recordWelcomeDismissed("WALLET_A", storage);
    expect(hasDismissedWelcome("WALLET_A", storage)).toBe(true);
  });

  test("two wallets are independent", () => {
    const storage = fakeStorage();
    recordWelcomeDismissed("WALLET_A", storage);
    expect(hasDismissedWelcome("WALLET_A", storage)).toBe(true);
    expect(hasDismissedWelcome("WALLET_B", storage)).toBe(false);
    recordWelcomeDismissed("WALLET_B", storage);
    expect(hasDismissedWelcome("WALLET_B", storage)).toBe(true);
    expect(hasDismissedWelcome("WALLET_A", storage)).toBe(true);
  });
});

describe("corrupt storage", () => {
  test("corrupted JSON reads as not dismissed (no throw)", () => {
    const storage = fakeStorage();
    storage.setItem(WELCOME_KEY, "{not json");
    expect(() => hasDismissedWelcome("WALLET_A", storage)).not.toThrow();
    expect(hasDismissedWelcome("WALLET_A", storage)).toBe(false);
  });

  test("non-array JSON reads as not dismissed", () => {
    const storage = fakeStorage();
    storage.setItem(WELCOME_KEY, '"WALLET_A"');
    expect(hasDismissedWelcome("WALLET_A", storage)).toBe(false);
  });
});

describe("hasAutoOpenedWizard / recordWizardAutoOpened", () => {
  test("null wallet: not opened, record is a no-throw no-op", () => {
    const storage = fakeStorage();
    expect(hasAutoOpenedWizard(null, storage)).toBe(false);
    expect(() => recordWizardAutoOpened(null, storage)).not.toThrow();
    expect(storage.getItem(WIZARD_KEY)).toBeNull();
  });

  test("unknown wallet has not auto-opened", () => {
    const storage = fakeStorage();
    expect(hasAutoOpenedWizard("WALLET_A", storage)).toBe(false);
  });

  test("recordWizardAutoOpened then hasAutoOpenedWizard is true", () => {
    const storage = fakeStorage();
    recordWizardAutoOpened("WALLET_A", storage);
    expect(hasAutoOpenedWizard("WALLET_A", storage)).toBe(true);
  });

  test("two wallets are independent", () => {
    const storage = fakeStorage();
    recordWizardAutoOpened("WALLET_A", storage);
    expect(hasAutoOpenedWizard("WALLET_A", storage)).toBe(true);
    expect(hasAutoOpenedWizard("WALLET_B", storage)).toBe(false);
    recordWizardAutoOpened("WALLET_B", storage);
    expect(hasAutoOpenedWizard("WALLET_B", storage)).toBe(true);
    expect(hasAutoOpenedWizard("WALLET_A", storage)).toBe(true);
  });

  test("wizard and dismissal keys are independent stores", () => {
    const storage = fakeStorage();
    recordWizardAutoOpened("WALLET_A", storage);
    expect(hasAutoOpenedWizard("WALLET_A", storage)).toBe(true);
    expect(hasDismissedWelcome("WALLET_A", storage)).toBe(false);
  });
});

describe("corrupt wizard storage", () => {
  test("corrupted JSON reads as not opened (no throw)", () => {
    const storage = fakeStorage();
    storage.setItem(WIZARD_KEY, "{not json");
    expect(() => hasAutoOpenedWizard("WALLET_A", storage)).not.toThrow();
    expect(hasAutoOpenedWizard("WALLET_A", storage)).toBe(false);
  });

  test("non-array JSON reads as not opened", () => {
    const storage = fakeStorage();
    storage.setItem(WIZARD_KEY, '"WALLET_A"');
    expect(hasAutoOpenedWizard("WALLET_A", storage)).toBe(false);
  });
});
