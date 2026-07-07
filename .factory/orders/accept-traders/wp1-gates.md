# WP1 — Feature-gate layer + dismissable policy banner (ships dark)

You are implementing one scoped work package in the `serious-trader-ralph`
repo (ticket #494, PRD #493). Follow this order exactly. Read `AGENTS.md`
and `.factory/PITFALLS.md` before touching anything — every rule is binding.

## Goal

Policy capacity, enforcing nothing: a tiny feature-gate module (config +
pure resolver) and a slim dismissable banner component. With the default
(empty) config, NOTHING renders and NO behavior changes anywhere. Nothing
mounts the banner in this WP — later tickets consume it.

## Non-goals

- Do NOT mount PolicyBanner anywhere (no edits to any page or existing
  component).
- Do NOT implement geo lookup (separate ticket) — the resolver just takes a
  country string.
- No remote config, no US restrictions — capacity only, config ships empty.

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/gates.ts
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/gates.test.ts
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/components/PolicyBanner.svelte

Modify: none
Delete: none

Touch NOTHING outside these lists.

## Load-bearing payloads

1. `gates.ts` — exactly this module (comments included):

```ts
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
  const gate = GATES[feature];
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
```

Refactor note: implement `resolveGate` as `resolveGateWith(GATES, ...)` —
one shared code path, both exports kept.

2. `gates.test.ts` — bun test, pure. Cover AT MINIMUM (use
`resolveGateWith` with inline configs):
- missing feature → OPEN
- `enabled: false` → OPEN
- enabled, no regions, level "warn" → banner set, allowed, not submitBlocked
- level "submit-block" → allowed true, submitBlocked true
- level "block" → allowed false, submitBlocked true
- regions ["US"], country "US" → applies; country "us" lowercase → applies;
  country "CA" → OPEN; country null → OPEN (fail-open documented)
- `GATES` itself is empty: `Object.keys(GATES).length === 0` and
  `resolveGate("perps", "US")` is OPEN (locks the ships-dark contract)

3. `PolicyBanner.svelte` — Svelte 5 runes, self-contained dismiss
persistence:

```svelte
<script lang="ts">
  const DISMISS_KEY = "trader-ralph-terminal/policy-dismiss/v1";

  let { gateKey, message }: { gateKey: string; message: string } = $props();

  function readDismissed(): string[] {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
    } catch {
      return [];
    }
  }

  let dismissed = $state(false);
  $effect(() => {
    dismissed = readDismissed().includes(gateKey);
  });

  function dismiss(): void {
    dismissed = true;
    try {
      const keys = new Set(readDismissed());
      keys.add(gateKey);
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...keys]));
    } catch {
      /* storage unavailable: session-only dismiss */
    }
  }
</script>

{#if !dismissed}
  <div class="policy-banner" role="status">
    <span class="policy-msg">{message}</span>
    <button type="button" class="policy-dismiss" aria-label="Dismiss notice" onclick={dismiss}>×</button>
  </div>
{/if}

<style>
  .policy-banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--line);
    border-left: 2px solid var(--amber, #d9a441);
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.72rem;
    line-height: 1.4;
  }
  .policy-msg { flex: 1; min-width: 0; }
  .policy-dismiss {
    border: 0;
    background: transparent;
    color: var(--faint);
    font-size: 0.9rem;
    line-height: 1;
    cursor: pointer;
    padding: 0.1rem 0.25rem;
  }
  .policy-dismiss:hover { color: var(--ink); }
</style>
```

## Acceptance criteria

- All gate-resolution tests above pass; `GATES` is empty and locked by test.
- PolicyBanner compiles; since nothing mounts it, the terminal build and
  every page are byte-identical in behavior.
- Zero new `unused css selector` warnings.

## Validation (run all, paste FULL output)

```bash
bun run typecheck
bun run lint
bun run test
cd apps/portal && bun test
bun run build
```

Also grep the build output for `unused css selector` — must be 0 occurrences.

## Report format

1. Summary of what changed, per file.
2. Full validation output (verbatim, no truncation).
3. Anything you could not do, skipped, or are unsure about — say so plainly.
4. NO claims of success without the validation output to back them.

## Rules (non-negotiable)

- Git is READ-ONLY for you: `git status` / `git diff` / `git log` only.
  Never commit, push, stash, restore, reset, or clean.
- Stay inside the file lists above.
- Kill any dev server you start.
- All pitfalls in `.factory/PITFALLS.md` apply.
