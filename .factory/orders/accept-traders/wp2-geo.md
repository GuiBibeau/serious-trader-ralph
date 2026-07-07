# WP2 — Geo-location capability (Vercel headers → telemetry only)

You are implementing one scoped work package in the `serious-trader-ralph`
repo (ticket #495, PRD #493). Follow this order exactly. Read `AGENTS.md`
and `.factory/PITFALLS.md` before touching anything — every rule is binding.

## Goal

Know where a user is, surface it NOWHERE: a `/api/geo` endpoint reading
Vercel's geo headers, a pure parser, a client store that resolves once per
session and emits one `geo_resolved` telemetry event. No UI. No gating —
the gate layer consumes this later.

## Non-goals

- No third-party IP lookup services; Vercel headers only.
- No UI surface, no gating behavior, no edits to gates.ts.
- Do not persist geo to localStorage (session memory only).

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/geo.ts
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/geo.test.ts
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/api/geo/+server.ts

Modify:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/+layout.svelte
  — ONLY add the init call described in payload 4. Change nothing else in
  the file (imports stay, styles stay, markup stays).

Delete: none

## Load-bearing payloads

1. `src/lib/geo.ts`:

```ts
// Geo capacity (PRD #493): country/region resolved from Vercel's edge
// headers, recorded to telemetry, surfaced in no UI. Consumers (the
// feature-gate layer, later) read `geo` — a session-scoped store.

import { writable } from "svelte/store";
import { track } from "$lib/telemetry";

export type Geo = {
  country: string | null;
  region: string | null;
  resolved: boolean;
};

/** Pure parser — testable without a request. */
export function parseGeoHeaders(headers: Headers): Omit<Geo, "resolved"> {
  const country = headers.get("x-vercel-ip-country");
  const region = headers.get("x-vercel-ip-country-region");
  return {
    country: country && country.length === 2 ? country.toUpperCase() : null,
    region: region && region.length > 0 ? region.toUpperCase() : null,
  };
}

export const geo = writable<Geo>({ country: null, region: null, resolved: false });

let started = false;

/** Fetch once per session; safe to call repeatedly. */
export function initGeo(fetcher: typeof fetch = fetch): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void fetcher("/api/geo")
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { country: string | null; region: string | null } | null) => {
      if (!data) return;
      geo.set({ country: data.country, region: data.region, resolved: true });
      track("geo_resolved", { country: data.country ?? "unknown", region: data.region ?? "unknown" });
    })
    .catch(() => {
      /* geo is best-effort capacity; failures stay silent */
    });
}
```

2. `src/routes/api/geo/+server.ts`:

```ts
import { json } from "@sveltejs/kit";
import { parseGeoHeaders } from "$lib/geo";
import type { RequestHandler } from "./$types";

// Country/region from Vercel's edge geo headers (absent in local dev →
// nulls). Capacity only (PRD #493): recorded to telemetry, gates nothing.
export const GET: RequestHandler = ({ request }) => {
  return json(parseGeoHeaders(request.headers), {
    headers: { "cache-control": "no-store" },
  });
};
```

3. `src/lib/geo.test.ts` — bun test, pure, via `new Headers()`:
- both headers present ("ca", "qc") → { country: "CA", region: "QC" }
- absent headers → both null
- malformed country ("USA", "") → null country
- region empty string → null region

4. `+layout.svelte` modification — in its `<script>`, add the import and a
browser-only init (match the file's existing style; if it already has an
`onMount`, add the call inside it, otherwise add one):

```ts
import { onMount } from "svelte";
import { initGeo } from "$lib/geo";
```

```ts
onMount(() => {
  initGeo();
});
```

## Acceptance criteria

- Local dev: `curl -s localhost:3000/api/geo` → `{"country":null,"region":null}`.
- geo tests pass; no network in tests.
- `geo_resolved` fires once per session (guard flag), never throws when
  fetch fails.
- No visual or behavioral change anywhere.

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
4. NO claims of success without validation output to back them.

## Rules (non-negotiable)

- Git is READ-ONLY for you: `status` / `diff` / `log` only. Never commit,
  push, stash, restore, reset, or clean.
- Stay inside the file lists above.
- Kill any dev server you start.
- All pitfalls in `.factory/PITFALLS.md` apply.
