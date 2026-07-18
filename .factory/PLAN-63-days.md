# Harness — The Cursor Path: 63 Days of Daily Ships

*Proposal — 2026-07-15 (rev 2). One feature or one post per day. Charts get
great first; then AI inserts itself the way Cursor's tab did — autocomplete →
AI features accrete → the mode flips to a full in-terminal trading agent. No
separate "agent product," no external tool surface — one terminal whose
autonomy slider moves. (Meme-coin markets are a later expansion — explicitly
NOT designed for in this plan.)*

---

## The Arc

**Phase 0 — The Chart Earns It.** Before any AI, the chart becomes a place
you can trade from: levels, click-to-trade, draggable stops. This is also
the AI's foundation in disguise — the structure math that draws prev-day and
swing levels in Week 1 is exactly what the ghosts consume in Week 3.

**Phase 1 — The Tab Moment.** AI arrives as ghost suggestions inside the
exact fields traders already use. Deterministic, structure-derived, instant,
ignorable. Every accept/reject is telemetered — the flywheel that trains
Phase 2 and earns Phase 3's trust.

**Phase 2 — The Side Panel Era.** A dockable AI panel joins the terminal —
summon-only, zero weight when closed, fed the desk's real context
(positions, book, tape, candles). Underneath it: a model-routing layer with
auto-select by task. **Free tier runs DeepSeek; Pro unlocks frontier models
(Fable-class).** Cmd-K is the keyboard entry point into panel actions. Every
AI-initiated change is a reviewable diff — nothing commits without the human
seeing exactly what changes.

**Phase 3 — Agent Mode.** Same terminal, agent at the controls, human
watching. Governed by a Claude Code-style permission model: allow/ask/deny
rules over order properties, observe → copilot → session-auto modes, one
signing choke point, a money-PAUSE kill switch, an append-only decision
ledger. Fills are irreversible, so checkpoints are approval gates *before*
actions — never rollbacks after.

**The constitution (all phases):** the honest-data rule. Ghosts derive from
visible structure and the user's real history — provenance exists in the
data (and telemetry) but stays out of the UI: discoverable on hover at most,
never a visible caption. AI narrates facts we computed — it never invents
numbers. Failure states are explicit. Receipts over vibes, and no
self-narrating chrome: the system doesn't explain itself unasked.

**The seamlessness rule (equal rank):** AI inserts itself the way Cursor's
tab did — inside the motion the trader is already making, never as a
destination. No sparkle branding, no badges, no pulses begging for clicks,
no "AI CENTER." Ghosts appear where the cursor already is; answers appear
where the question arose; the panel stays collapsed until summoned and
weighs nothing when closed. Heuristics render in the same frame; model
responses stream in quietly. If a feature needs to announce itself, it
failed the bar — the tab key is the whole marketing department. When an AI
touch and a heavier AI surface both solve the problem, ship the touch.

---

## Week 1 — Charts Week (Phase 0: the chart earns it)

| Day | Ship | Size |
|---|---|---|
| 1 | 📏 **Structure levels overlay** — prev-day high/low + session high/low + swing pivots drawn as quiet lines (toggleable); the same pure lib the ghosts will use in Week 3 | M |
| 2 | 🖱 **Click-to-trade** — click a price on the chart → limit ticket pre-filled at that level | M |
| 3–4 | ✋ **Drag TP/SL handles** — open position's stop and target as draggable lines on the chart (tease → ship; the most filmable feature on the list) | L |
| 5 | 📐 Drawing basics — horizontal ray + measure tool (price/% between two points) | M |
| 6 | 📸 **Daily market recap image** — auto-generated from live movers; the post engine for every quiet day after | S |
| 7 | 🧵 Week recap: "the chart is now a trading surface" | post |

## Week 2 — Ergonomics (the terminal gets fast)

| Day | Ship | Size |
|---|---|---|
| 8 | ⌨️ Hotkey trading mode with a visible ARMED state chip | S |
| 9 | 🔄 One-click reverse (close + flip, one signing flow) | S |
| 10 | 📋 Order templates — save "my usual" as one-tap presets | S |
| 11 | ⚖️ Risk-first sizing polish ("risk $5 to this stop", extends from-stop) | S |
| 12 | 📊 Session stats bar — today's PnL, win rate, fees paid | S |
| 13 | ⏱ Funding countdown chip + 🎯 break-even button | S |
| 14 | 🔊 Fill sounds + 🔥 streak flame (video post) + week recap | S |

## Week 3 — The Tab Moment (Phase 1: AI arrives, silently)

| Day | Ship | Size |
|---|---|---|
| 15 | 👻 **Ghost TP/SL from chart structure** — the Week-1 levels, now appearing as tab-to-accept ghosts in the ticket fields (wp1 + wp2, orders written) | M |
| 16 | 👻 Ghost size/leverage — "$25 @ 5x" from your own history (wp3, order written) | S |
| 17 | 👻 **Chart-hover ghost ticket** — phantom ticket assembles at the hovered level (marries Week 1's chart to the ghosts) | M |
| 18 | 🤖 Explain-this-move — the DeepSeek desk narrator, surfaced as one quiet button | S |
| 19 | 📰 News→position tagging — wire headlines flagged when they touch your book | S |
| 20 | 🧠 Ghost accept-rate visible internally; heuristic tuning from first week of telemetry | S |
| 21 | 🧵 Week recap + first public accept-rate numbers (the flywheel, public) | post |

## Week 4 — Honesty Week (the brand moat)

| Day | Ship | Size |
|---|---|---|
| 22–23 | 🧾 **Trade receipts** — per-trade fees, funding paid, slippage vs mark (tease → ship) | M |
| 24 | 🌡 Funding heatmap — current + historical 8h funding, all perp markets | S |
| 25 | 📓 Auto trade journal upgrade + CSV export | S |
| 26 | 🤖 AI post-trade critique — facts-only, from your fills + the candles | M |
| 27 | 🚰 "Exit liquidity" meter — book imbalance + tape pressure, honestly labeled descriptive | M |
| 28 | 🧵 "The terminal that shows you what trading actually costs" | post |

## Week 5 — Side Panel Week (Phase 2 core)

| Day | Ship | Size |
|---|---|---|
| 29 | 📱 **AI side panel shell** — summon-only (hotkey + one quiet toggle), zero weight when closed, no badge/pulse ever; desk context piped in; inline answers stay inline — the panel is for conversation, not for every response | M |
| 30 | 🧠 **Model routing layer** — provider abstraction + auto-select by task class (explain → fast/cheap, analysis → premium); model picker in the panel with "Auto" default | M |
| 31 | 💎 **Free/Pro tiering** — free = DeepSeek, Pro = Fable-class frontier models; entitlement check + honest "Pro model" labeling on responses | M |
| 32 | 💬 Natural-language ticket edits from the panel ("halve size, widen stop 1%") — diff preview, never auto-submit; ⌘K opens the panel with the command pre-typed | M |
| 33 | ⌘K position commands ("move stop to break-even" → reviewable diff → confirm) | M |
| 34 | 📉 Depth-aware slippage preview from the live book | M |
| 35 | 🧵 Week recap: "the terminal grew a brain — and a sidebar" | post |

## Week 6 — Sharing (virality infrastructure)

| Day | Ship | Size |
|---|---|---|
| 36 | 🖼 PnL share cards v2 — real candle backdrop, entry/exit markers | M |
| 37 | 🏅 Milestone cards — first trade, first green week, streaks | S |
| 38 | 💬 One-click share-to-Discord (#trading, via the bot) | S |
| 39 | 🔗 Shareable chart states — URL encodes symbol/timeframe/drawings | M |
| 40 | 🤖 Discord daily digest cron (UTC close movers + community stats) | S |
| 41 | 🪜 Trailing stop — client-armed on the conditional-order rails | M |
| 42 | 🧵 Week recap | post |

## Week 7 — Permission Rails (Phase 3 groundwork)

| Day | Ship | Size |
|---|---|---|
| 43 | 🛡 **Permission rules v1** — allow/ask/deny over market/side/notional/leverage + settings UI | M |
| 44 | 🛑 Money-PAUSE kill switch + append-only decision ledger | M |
| 45 | 👁 Observe mode — the agent watches and narrates, proposes nothing binding | M |
| 46 | 🤝 Copilot mode — agent proposes tickets, ask-per-order, you sign | M |
| 47 | 🪜 Ladder entries — split one order across N levels, one signing ceremony | M |
| 48 | 🧠 Ghosts go model-ranked — trained on weeks of accept/reject telemetry (full-circle post) | M |
| 49 | 🧵 "A permission model for money" — the essay | post |

## Week 8 — Agent Mode (the flip)

| Day | Ship | Size |
|---|---|---|
| 50–52 | 🤖 **AGENT MODE** — architecture post → ship → demo video of the agent operating the visible terminal under the rules | L |
| 53 | ⏲ Session auto mode — time-boxed, loss-capped auto-approval | M |
| 54 | 📄 Paper mode — clearly-labeled simulated balance on real live data | M |
| 55 | 🏆 Weekly leaderboard — opt-in, on-chain-verified PnL%, min-5-trades floor | M |
| 56 | 🧵 Week recap | post |

## Week 9 — Finish the Funnel

| Day | Ship | Size |
|---|---|---|
| 57–59 | ⚡ **Wizard screen 2: gasless "Prepare my trading account"** — Jupiter Ultra; USDC-only wallet → funded Phoenix account with zero SOL (tease → ship → how-it-works thread) | L |
| 60 | 🎫 Wizard screen 3 — pre-filled starter trade ticket | M |
| 61 | 🔑 Keyless read-only market-data API + docs page | M |
| 62 | 📺 Embeddable price widget (one script tag, branded, links back) | M |
| 63 | 🧵 "63 days, 50 ships" mega-thread | post |

---

## Flex Bench (swap in when a day slips or prod interrupts)

- Opt-in public trader profiles (win rate, best trade, OG card)
- "Profitable Week" Discord role (auto-granted, expires weekly)
- Delayed signal channel (verified traders' closed trades, 15-min delay)
- Card / Apple Pay onramp
- Markdown pages for AI crawlers (expand slug.md / llms.txt)
- Konami code easter egg
- Isolated-margin support in the Discord $10 gate (known follow-up)
- Pro payment rail decision: USDC-native (pay with the balance you trade
  with) vs Stripe — deserves its own design day before Week 5 Day 31

## Deferred (acknowledged, deliberately not designed for yet)

- Meme-coin markets — later expansion; nothing in this plan assumes or
  precludes it.

## Cut (deliberately)

- ~~MCP server / external agent tool surface~~ — the harness is the terminal
  itself; the permission model exists for the in-app agent only.
- ~~Strategy desk resurrection (SD0–SD7, loops A/B/C)~~ — prior corpus stays
  archived; its values (fail-closed gates, receipts, provenance-in-data)
  carry, its machinery doesn't.

## Operating Rules

1. Every ship goes through the full factory pipeline — validate → PR →
   preview QA where user-facing → gate → prod verify. The cadence never buys
   its way past validation.
2. Prod regression eats the day: revert first, investigate second, the
   day's post becomes the honest post-mortem.
3. M/L items get tease-day posts so no day goes dark.
4. Guillaume approves every dispatch plan and QAs every approval-lane PR —
   the cadence is human-in-the-loop or it doesn't count.
5. Heuristic defaults (5-bar pivots, 0.3% stop buffer, 2R fallback, 5-trade
   sizing floor) are v1 constants — revisit with telemetry, not vibes.

## Dispatch State

- Day 1 (structure levels overlay): order to be written on dispatch — its
  pure lib IS `.factory/orders/ticket-autocomplete/wp1.md`'s swing/level
  math, promoted to chart rendering first (wp1 ships Day 1; the ticket
  ghosts in wp2/wp3 consume it Day 15-16).
- `.factory/orders/ticket-autocomplete/wp1.md` — ready (Day 1 foundation)
- `wp2.md` / `wp3.md` — ready, no-chrome contract applied (Day 15–16)
