// Feature-gate capacity layer (PRD #493). Config-driven policy gates:
// which features are available, optionally restricted by ISO country
// code, and how hard the restriction bites. The config below ships
// EMPTY on purpose — changing policy later is a one-line edit here,
// never a change to feature code.

export type GateLevel = "warn" | "submit-block" | "block";

export type GateConfig = {
  enabled: boolean;
  /** ISO 3166-1 alpha-2 codes the restriction APPLIES to. Absent = global. */
  regions?: string[];
  level: GateLevel;
  message: string;
};

export type GateResolution = {
  /** false only when the gate fully blocks this user. */
  allowed: boolean;
  /** true when order submission must be intercepted. */
  submitBlocked: boolean;
  /** banner copy to surface, or null for nothing. */
  banner: string | null;
  level: GateLevel | null;
};

/** Feature keys are free-form; consumers agree on strings like "perps". */
export const GATES: Record<string, GateConfig> = {
  // Intentionally empty: every feature is on, everywhere. See PRD #493.
};

const OPEN: GateResolution = {
  allowed: true,
  submitBlocked: false,
  banner: null,
  level: null,
};

/**
 * Resolve a feature gate for a user country (null = unknown). Unknown
 * countries fail OPEN while this layer is capacity-only — flipping to
 * fail-closed is a deliberate future policy change.
 */
export function resolveGate(
  feature: string,
  country: string | null,
): GateResolution {
  return resolveGateWith(GATES, feature, country);
}

/** Test seam: resolve against an explicit config instead of GATES. */
export function resolveGateWith(
  gates: Record<string, GateConfig>,
  feature: string,
  country: string | null,
): GateResolution {
  const gate = gates[feature];
  if (!gate || !gate.enabled) return OPEN;
  if (gate.regions && gate.regions.length > 0) {
    if (country === null) return OPEN;
    if (!gate.regions.includes(country.toUpperCase())) return OPEN;
  }
  return {
    allowed: gate.level !== "block",
    submitBlocked: gate.level === "submit-block" || gate.level === "block",
    banner: gate.message,
    level: gate.level,
  };
}
