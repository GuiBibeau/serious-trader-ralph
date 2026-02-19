export type MandateProfile = {
  aggressive: boolean;
  opportunistic: boolean;
  defaultMinConfidence: "low" | "medium";
  defaultMaxStepsPerTick: number;
  defaultMaxToolCallsPerStep: number;
};

const AGGRESSIVE_HINTS = [
  "aggressive",
  "degen",
  "maximize pnl",
  "max pnl",
  "high beta",
  "high conviction",
  "press winners",
  "risk on",
  "momentum",
];

const OPPORTUNISTIC_HINTS = [
  "opportun",
  "defi",
  "meme",
  "rotation",
  "altcoin",
  "small cap",
];

function containsAny(text: string, hints: string[]): boolean {
  for (const hint of hints) {
    if (text.includes(hint)) return true;
  }
  return false;
}

export function inferMandateProfile(
  mandate: string | undefined,
): MandateProfile {
  const raw = String(mandate ?? "")
    .trim()
    .toLowerCase();
  const aggressive = raw.length === 0 || containsAny(raw, AGGRESSIVE_HINTS);
  const opportunistic = aggressive || containsAny(raw, OPPORTUNISTIC_HINTS);

  return {
    aggressive,
    opportunistic,
    defaultMinConfidence: aggressive ? "low" : "medium",
    defaultMaxStepsPerTick: aggressive ? 8 : 4,
    defaultMaxToolCallsPerStep: aggressive ? 8 : 4,
  };
}
