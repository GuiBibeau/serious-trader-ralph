---
name: factory-prd
description: Intake a PRD and decompose it into dispatchable work orders under .factory/orders/. Use when Guillaume supplies a PRD, feature request, or asks to "run this through the factory".
---

# factory-prd — PRD intake and decomposition

Turn a PRD (argument text, a file path, or the current conversation) into
work orders ready for `/factory-dispatch`. This skill produces PLANNING
ARTIFACTS ONLY — no code changes, no delegate invocations.

## Procedure

1. **Read the PRD.** If the argument is a file path, read it; if it's inline
   text, use it; if empty, ask Guillaume for the PRD. Restate the goal in one
   sentence and list acceptance criteria you can verify.

2. **Interrogate repo state before decomposing.** Grep/read the touched
   areas (respect reading discipline: grep first, bounded reads). Identify
   existing utilities to reuse — never order new code where a suitable
   implementation exists. Check `.factory/PITFALLS.md` for constraints that
   shape the design.

   For UI/layout WPs: **measure the component's real rendered size range
   before writing acceptance criteria** — check its grid span, the page's
   media queries, and compute (or probe) the actual min/max container
   width. Never anchor acceptance to an assumed viewport. (Learned on
   monitor-row-overlap: the order fixed "no overlap at ~900px viewport"
   without knowing the panel shrinks to ~230px there — the delegate
   executed a perfect fix to an insufficient spec.)

3. **Decompose into 1–N work packages.** Each WP must be:
   - Independently validatable (the full validation suite passes after it).
   - ≤ ~400 changed lines.
   - Assigned to a delegate per the CLAUDE.md routing table (GLM 5.2 =
     implementation, GPT 5.5 = backend/config/scripts, north-mini = routine
     read-heavy tasks). Work needing judgment, ambiguity resolution, or
     taste stays with Claude.
   - Free of product ambiguity. If the PRD leaves a real decision open,
     STOP and ask Guillaume — never resolve product ambiguity by assumption.

4. **Write the orders.** Slug the feature (`<slug>`), then write
   `.factory/orders/<slug>/wp1.md`, `wp2.md`, … from
   `.factory/ORDER_TEMPLATE.md`. Fill every section — exact absolute file
   lists, verbatim load-bearing payloads, acceptance criteria, validation
   commands. An order a delegate could misread is a defective order.

5. **Print the dispatch plan** as a table: WP → goal → delegate → risk notes
   → suggested order (note WPs that must run serially vs can parallel).

6. **Confirm before dispatch.** End by asking Guillaume to confirm (or
   amend) the plan. Do not invoke `/factory-dispatch` without confirmation
   while the factory is human-in-the-loop.

## Retro duty

After the feature ships, fold anything that creaked (bad decomposition,
missing pitfall, unclear order section) back into `CLAUDE.md`,
`.factory/PITFALLS.md`, or these skills.
