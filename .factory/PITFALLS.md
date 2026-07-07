# Pitfalls — binding for every delegate, every order

Learned in production on this repo. Violating any of these fails the review
gate.

1. **bun only.** `bun install` after any package.json change; never
   `bun update`, never `--frozen-lockfile` locally, never npm/pnpm/yarn.
2. **Typecheck from root.** `bun run typecheck` (it runs svelte-kit sync and
   chains packages/ui then apps/portal). Never bare `svelte-check`.
3. **No `$lib` / `$app` / `$env` inside `packages/*`** — relative imports
   only; those aliases exist only in the app.
4. **Scoped-CSS breakage is the #1 silent failure.** When moving or
   extracting Svelte markup, move its `<style>` rules with it. Grep the build
   output for `unused css selector` after every change — must stay at 0. The
   compiler does NOT warn in the other direction (markup that lost its
   styles) — check that by eye.
5. **Svelte 5 runes only in new/extracted components**: `$props()`, `$state`,
   `$derived`, Snippet/`{@render}`. No `export let`, no `$:`, no `<slot>`.
   (The legacy terminal page keeps its existing `$:` style — match the file
   you are in.)
6. **Move code byte-identically.** No reformatting, no renaming, no
   drive-by "improvements" unless the order explicitly asks.
7. **Git is read-only** (`status`/`diff`/`log`). Never commit, push, stash,
   restore, reset, or clean. Claude commits.
8. **Server-only boundaries**: `apps/portal/src/lib/server/` and
   `routes/og/` run under Node on Vercel — no `.svelte` imports, no
   client-only modules. `$lib/solana-rpc.ts` must stay free of
   @solana/web3.js.
9. **Biome doesn't lint `.svelte`, but lints `.ts` strictly**
   (noExplicitAny, noNonNullAssertion). Run `bun run lint` before reporting.
10. **Build needs no env vars; dev does.** Dev proxies 500 without keys —
    a page rendering with gated/unavailable states is acceptable in dev;
    build success is the bar.
11. **Never touch** `static/`, `.svelte-kit/`, `node_modules/`, `bun.lock`
    (except via `bun install`), or any generated directory.
12. **Two formatter dialects by design**: `@trader-ralph/ui/format` renders
    "—" (marketing/OG); `apps/portal/src/lib/utils.ts` renders "--"
    (terminal). Never merge or cross-use them. `formatSubZeroPrice` output is
    display-only — never feed it to `Number()`.
13. **Kill any dev server you start** before reporting done.
14. **No fake data.** Missing feeds render as explicit unavailable/gated
    states, never invented rows or stats.
15. **Terminal panels get much narrower than you think.** On 720–1100px
    viewports the dashboard grid stays 12-col, so a `span 4` panel is only
    ~230–340px wide. Design rows for the panel's own width (inline-size
    container queries are established practice — see MonitorPanel), and
    verify layout claims with a real-browser geometry probe, not by eye.
16. **Token-only CSS — no fallback hexes.** `var(--amber)` yes,
    `var(--amber, #d9a441)` no. Palette hexes outside `packages/ui` are
    forbidden (AGENTS.md) except the terminal chart theme and
    `static/brand`; fallbacks silently drift from the real token and dodge
    the drift guard. Applies to order payloads too — reject them in review.
17. **The codex review bot is part of the pipeline.** It reviews most PRs
    and its P2 findings are usually correct — treat them as review input,
    not noise. Unresolved threads hold the PR at BLOCKED
    (`required_conversation_resolution`): fix, reply, resolve via GraphQL
    `resolveReviewThread`.
