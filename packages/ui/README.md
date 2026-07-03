# @trader-ralph/ui

Design tokens, format helpers, and Svelte 5 components for the Trader Ralph
marketing and portal surfaces. Consumed source-direct via bun workspaces;
there is no build step — the portal's Vite/Svelte pipeline compiles the
`.svelte` files directly (`vite.config.ts` sets
`ssr: { noExternal: ["@trader-ralph/ui"] }`).

## Entry points

Four exports (see `package.json`). Server-side code (`apps/portal/src/lib/server/`,
`routes/og/`) may import **only** `./tokens` or `./format` — pure TS, no `.svelte`.

| Export           | Resolves to               | Who may import                                  |
| ---------------- | ------------------------- | ----------------------------------------------- |
| `.` (barrel)     | `src/index.ts` (`.svelte`) | Client / SSR components only                    |
| `./tokens`       | `src/tokens/index.ts`     | Anyone (pure TS: `colors`, `cssVar`, `ColorToken`) |
| `./tokens.css`   | `src/tokens.css`          | Client / SSR components (CSS custom props)      |
| `./format`       | `src/format.ts`           | Anyone (pure TS: `fmtPrice`/`fmtPct`/`fmtCompact`/`fmtUsd`) |

## Components

All Svelte 5 runes (`$props` / `$state` / `$derived` / `Snippet`); relative
imports only.

- **AssetTable** — asset list; `showMarketCap` prop adds a market-cap column.
- **BrandMark** — inline SVG wordmark (uses `currentColor` + baked accent).
- **Button** — `variant: "cta" | "ghost"`; `href` renders an anchor; `block`
  for full-width. Every variant carries the hard-shadow press mechanics
  (hover lift, active stamp, reduced-motion guarded). All button-shaped
  elements on marketing surfaces must be this component (tabs → TabNav;
  the slug trade rail mirrors the same interaction states).
- **NewsItem** — source + title link row.
- **SiteFooter** — footer nav + provenance/legal copy.
- **SiteNav** — sticky navbar with `cta` / `ctaHref` props.
- **StatCard** — `value` / `label` / `hint?` stat tile with hard shadow.
- **TabNav** — `tabs` / `active` / `onselect`; `compact` variant. 3px underline.
- **UpDown** — signed percent, green/red via `fmtPct`.

## Tokens

`src/tokens/colors.ts` is canonical (TS object + `cssVar` map + `ColorToken`
type). `src/tokens.css` hand-mirrors every value as a CSS custom property.
`src/tokens/colors.test.ts` parses `tokens.css` and asserts each token matches
1:1 — `bun test` fails on drift.

To add a token:

1. Add the key + value to `colors` and the `cssVar` name in `colors.ts`.
2. Mirror it as a `--name: #value;` declaration in `tokens.css`.
3. The test auto-covers every `colors` key, so no new assertion is needed —
   it will fail if the two files disagree.

CSS-only extras that have **no** TS counterpart (soft/alpha variants,
`--radius`, `--shadow-hard`, `--shadow-hard-sm`) live only in `tokens.css`.
`--radius: 0` is the neo-brutalist default (dead square); hard offset shadows
are marketing-surface only. `static/brand` assets bake accent/ink hexes —
re-export them if accent or ink ever change.

## Conventions

- Svelte 5 runes only — no legacy stores or `$lib` / `$app` / `$env` imports.
  Use relative paths (`../format`, `./UpDown.svelte`).
- Biome lints `.ts` strictly and skips `.svelte` (see root `biome.json`).
- Scoped `<style>` blocks must move with their markup when a component is
  relocated. The build warns on `unused css selector` (must stay 0) but does
  **not** warn about markup classes that lost their styles — check that
  direction by hand.
- Formatting dialect: this package renders `"—"` (em dash) for null
  values. The terminal (`apps/portal/src/lib/utils.ts`) renders `"--"`. The
  two have different null/digit semantics — do not merge them.

## Validation

```bash
bun run --cwd packages/ui typecheck && bun run --cwd packages/ui test && bun run --cwd packages/ui lint
```
