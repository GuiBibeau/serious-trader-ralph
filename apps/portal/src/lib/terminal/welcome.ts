// Welcome-strip dismissal (PRD #493 / #499). One dismissal per wallet,
// stored locally like the trade-ack key. storage is injectable so tests
// never touch the real localStorage.

const WELCOME_KEY = "trader-ralph-terminal/welcome-dismissed/v1";

// Wizard auto-open (PRD #510): the funding wizard auto-opens once per wallet
// for fresh authed accounts that still need onboarding; afterwards the strip
// is the re-entry point. Same shape as the dismissal key so tests mirror.
const WIZARD_KEY = "trader-ralph-terminal/wizard-auto/v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function readDismissed(storage: StorageLike): string[] {
  try {
    const raw = storage.getItem(WELCOME_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

export function hasDismissedWelcome(
  wallet: string | null,
  storage?: StorageLike,
): boolean {
  if (!wallet) return false;
  const store =
    storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return false;
  return readDismissed(store).includes(wallet);
}

export function recordWelcomeDismissed(
  wallet: string | null,
  storage?: StorageLike,
): void {
  if (!wallet) return;
  const store =
    storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return;
  try {
    const dismissed = new Set(readDismissed(store));
    dismissed.add(wallet);
    store.setItem(WELCOME_KEY, JSON.stringify([...dismissed]));
  } catch {
    /* storage unavailable: dismissal lasts the session via caller state */
  }
}

function readWizardOpened(storage: StorageLike): string[] {
  try {
    const raw = storage.getItem(WIZARD_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

export function hasAutoOpenedWizard(
  wallet: string | null,
  storage?: StorageLike,
): boolean {
  if (!wallet) return false;
  const store =
    storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return false;
  return readWizardOpened(store).includes(wallet);
}

export function recordWizardAutoOpened(
  wallet: string | null,
  storage?: StorageLike,
): void {
  if (!wallet) return;
  const store =
    storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return;
  try {
    const opened = new Set(readWizardOpened(store));
    opened.add(wallet);
    store.setItem(WIZARD_KEY, JSON.stringify([...opened]));
  } catch {
    /* storage unavailable: auto-open lasts the session via caller state */
  }
}
