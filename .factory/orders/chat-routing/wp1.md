# WP1 — Chat model routing + Free/Pro tiering (PRD #571, PR1)

Working in the WORKTREE `/Users/guillaume/Github/serious-trader-ralph-router`
(branch codex/chat-routing). ALL paths below are inside that worktree —
never touch other checkouts. Read AGENTS.md and .factory/PITFALLS.md first —
every rule binds. Bun only. Git read-only for you; Claude commits.

## Goal

Replace the chat's hardcoded `deepseek-chat` call with a task-class model
registry routed through the Vercel AI Gateway for the premium tier, add a
flag-gated "Pro (open beta)" tier, and expose an "Auto"-default model picker
in the panel. Pure, tested selection logic; the endpoint and UI are thin
wiring. NO money path, NO change to grounding/rate-caps/tool-loop behavior.

## Non-goals

- No NL ticket edits, no slippage preview (later PRs).
- No real billing/entitlement — the flag stands in.
- Do not change the grounding validator, rate caps, tool loop, or system
  prompt semantics. Do not touch paper-ledger or any signing path.

## Files

Create:
- apps/portal/src/lib/chat-models.ts
- apps/portal/src/lib/chat-models.test.ts

Modify:
- apps/portal/src/lib/chat-core.ts — export a task-class classifier (payload below)
- apps/portal/src/lib/chat-core.test.ts — tests for the classifier
- apps/portal/src/routes/api/chat/+server.ts — route via the registry; enforce tier server-side
- apps/portal/src/lib/chat.ts — carry the chosen model tier in the request + state
- apps/portal/src/routes/terminal/components/SidePanel.svelte — model picker (Auto default)

Delete: none. Touch NOTHING outside these lists — STOP and report if it
seems necessary.

## Load-bearing payloads

`chat-models.ts` — PURE, fully tested, no env/network:
```ts
export type ChatTier = "free" | "pro";
export type TaskClass = "chat" | "analysis";
export type ChatModelChoice = "auto" | "free" | "pro";

export type ResolvedModel = {
  tier: ChatTier;
  /** AI Gateway "provider/model" string for pro; sentinel "deepseek-chat"
   * for free (raw DeepSeek path the endpoint already owns). */
  model: string;
  /** true when a frontier/pro model was actually selected — drives the
   * honest "Pro (open beta)" response label. */
  proLabel: boolean;
};

export const FREE_MODEL = "deepseek-chat"; // raw DeepSeek path (existing)
export const PRO_MODEL = "anthropic/claude-opus-4.8"; // AI Gateway provider/model; swap freely
export const PRO_LABEL = "Pro (open beta)";

/**
 * Resolve the model for a request.
 * - proAllowed = the server-side tier flag (PUBLIC_CHAT_PRO_OPEN on).
 * - choice = the user's picker value.
 * - taskClass = classifier output ("analysis" prefers pro under Auto).
 * Rules: choice "pro" AND proAllowed → pro. choice "free" → free.
 * choice "auto" → pro when proAllowed AND taskClass==="analysis", else free.
 * When proAllowed is false, pro is NEVER selected regardless of choice
 * (server is the authority — a client asking for pro without the flag gets
 * free). proLabel === (tier === "pro").
 */
export function resolveModel(
  choice: ChatModelChoice,
  taskClass: TaskClass,
  proAllowed: boolean,
): ResolvedModel;
```

`chat-core.ts` add:
```ts
/** Cheap keyword classifier for Auto routing. "analysis" for asks that want
 * reasoning over the book/macro/portfolio (why/analy[sz]e/compare/should/
 * risk/regime/scenario/explain-in-depth); "chat" otherwise. Deterministic,
 * lower-cased substring match — no model call. */
export function classifyTaskClass(latestUserMessage: string): TaskClass;
```
(Import the `TaskClass` type from `./chat-models`.)

`+server.ts` wiring:
- Read the tier flag from env: `PUBLIC_CHAT_PRO_OPEN === "1"` → proAllowed.
  (PUBLIC_ prefix so build exposes it; the SERVER still enforces it — the
  client cannot force pro when the flag is off.)
- Parse an optional `modelChoice: "auto"|"free"|"pro"` from the body
  (default "auto"; validate, bad → 400 same as other fields).
- `classifyTaskClass(lastUserContent)` → `resolveModel(choice, taskClass, proAllowed)`.
- If `resolved.tier === "free"`: keep the EXISTING raw DeepSeek path
  (`DEEPSEEK_URL`, `model: "deepseek-chat"`) unchanged.
- If `resolved.tier === "pro"`: call the **AI Gateway OpenAI-compatible
  endpoint via raw fetch** — NO new dependency, NO `ai` import. It is the
  SAME OpenAI request shape the free DeepSeek path already builds; only the
  constants differ:
  - URL: `https://ai-gateway.vercel.sh/v1/chat/completions`
  - Header: `Authorization: Bearer ${process.env.AI_GATEWAY_API_KEY}`
  - Body `model`: `resolved.model` (e.g. `anthropic/claude-opus-4.8`)
  - identical `messages`, `tools`, `temperature`, and the SAME 3-round tool
    loop + grounding as the free path.
  Refactor the existing DeepSeek call into a small shared
  `callChatModel({ url, apiKey, model, messages, tools })` helper so free
  and pro share one code path with different constants (keeps the tool loop
  DRY). If `AI_GATEWAY_API_KEY` is missing or the pro call throws, FALL BACK
  to the free DeepSeek path (never fail the request for a routing reason)
  and set tier=free/proLabel=false in the response.
- Response JSON gains `model: resolved.model` and `proLabel: resolved.proLabel`.
  When proLabel, the reply is prefixed with a single quiet line
  `${PRO_LABEL} · ` is NOT added to content — instead return proLabel in the
  payload and let the client render the badge (provenance in data, chrome
  minimal — constitution). Grounding still runs on the model's raw text.

`chat.ts`:
- `chatState` gains `modelChoice: ChatModelChoice` (default "auto") and the
  last reply's `proLabel`/`model` for display. `sendChatMessage` includes
  `modelChoice` in the POST body. Add `setModelChoice(choice)` persisting to
  the existing `harness.chat.v1` localStorage key (extend the persisted
  shape; keep `open` working).

`SidePanel.svelte` (Svelte 5 runes, match file style):
- A small, quiet picker (Auto / Free / Pro) — text control matching the
  panel's existing tokens; no icon-candy, no pulse. Bound to
  `setModelChoice`. When a reply carried `proLabel`, show a subtle
  "Pro (open beta)" tag on that assistant message (token-only color, no
  fallback hex). Picker reflects current `modelChoice`.

## Acceptance criteria

- `resolveModel` + `classifyTaskClass` fully unit-tested incl.: auto+analysis+flag→pro,
  auto+chat→free, auto+analysis+flag OFF→free, choice pro+flag OFF→free
  (server authority), choice free always free, proLabel mirrors tier.
- Free tier path byte-identical to today's behavior (regression: existing
  chat-core tests still pass).
- Endpoint compiles; no `any`, no non-null assertions.
- Panel picker renders, persists, and a Pro-labeled reply shows the tag.
- No new deps beyond `ai` (already present).

## Validation (run all from worktree root, paste FULL output)

```bash
bun run typecheck
bun run lint
bun run test
cd apps/portal && bun test && cd ../..
bun run build
```
Also grep the build output for `unused css selector` — must be 0.

## Report format

1. Summary per file. 2. Full validation output verbatim. 3. The exact
`resolveModel` truth table you implemented. 4. Anything skipped/unsure.
5. No success claim without validation output.

## Rules (non-negotiable)

- Git READ-ONLY (`status`/`diff`/`log`). Never commit/push/stash/reset.
- Stay inside the file lists. Worktree paths only. Kill any dev server.
- All `.factory/PITFALLS.md` rules apply.
