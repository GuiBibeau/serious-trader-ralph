# WP1 — Jupiter Ultra client: order/execute + gasless eligibility (no UI)

You are implementing one scoped work package in the `serious-trader-ralph`
repo (ticket #511, PRD #510). Follow this order exactly. Read `AGENTS.md`
and `.factory/PITFALLS.md` before touching anything — every rule is binding.

## Goal

A typed client for Jupiter Ultra (order → sign → execute, RPC-less,
gasless-capable) in the funding lib, fully unit-tested with injected
fetch. Capability only: NOTHING consumes it yet (the funding wizard does,
next tickets). The existing Convert flow (getJupiterQuote /
getJupiterSwapTransaction) stays byte-identical.

## Non-goals

- No call-site changes anywhere (no +page.svelte, no FundsModal).
- No proxy changes — `/jupiter` already targets https://lite-api.jup.ag,
  so Ultra is reachable at `/jupiter/ultra/v1/...`.
- No retries/queues; callers own retry policy.

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/funding-ultra.test.ts

Modify:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/funding.ts
  — append the Ultra section below. Touch nothing above it.

Delete: none

## Load-bearing payloads

Append to `funding.ts` (adjust ONLY if biome formatting requires):

```ts
// ── Jupiter Ultra (RPC-less swaps, gasless-capable) ────────────────────
// Order → sign → execute: Ultra builds the transaction, we sign it with
// the user's wallet, Ultra broadcasts and polls. Routed through the
// same-origin /jupiter proxy (lite-api.jup.ag). Gasless eligibility is
// derived defensively from the order response — a null means "could not
// determine", and callers must treat null as NOT gasless (honest-data
// rule: never promise free gas we can't verify).

export type UltraOrder = {
  requestId: string;
  /** base64 unsigned transaction; null when Ultra returned no route. */
  transaction: string | null;
  inAmount: string | null;
  outAmount: string | null;
  gasless: boolean | null;
  router: string | null;
  raw: Record<string, unknown>;
};

export type UltraExecuteResult = {
  status: string;
  signature: string | null;
  raw: Record<string, unknown>;
};

/** Best-effort gasless detection across Ultra response variants. */
export function deriveUltraGasless(raw: Record<string, unknown>): boolean | null {
  if (raw.gasless === true) return true;
  if (raw.gasless === false) return false;
  const router = typeof raw.router === "string" ? raw.router.toLowerCase() : "";
  const swapType = typeof raw.swapType === "string" ? raw.swapType.toLowerCase() : "";
  // JupiterZ / RFQ routes: the market maker is the fee payer.
  if (router.includes("rfq") || router.includes("jupiterz") || swapType === "rfq") return true;
  const sigFee = raw.signatureFee ?? raw.signatureFeeLamports;
  if (typeof sigFee === "number") return sigFee === 0;
  return null;
}

export function parseUltraOrder(raw: Record<string, unknown>): UltraOrder {
  return {
    requestId: typeof raw.requestId === "string" ? raw.requestId : "",
    transaction: typeof raw.transaction === "string" ? raw.transaction : null,
    inAmount: typeof raw.inAmount === "string" ? raw.inAmount : null,
    outAmount: typeof raw.outAmount === "string" ? raw.outAmount : null,
    gasless: deriveUltraGasless(raw),
    router: typeof raw.router === "string" ? raw.router : null,
    raw,
  };
}

export async function getUltraOrder(
  inputMint: string,
  outputMint: string,
  amountAtoms: string,
  taker: string,
  fetcher: typeof fetch = fetch,
): Promise<UltraOrder> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountAtoms,
    taker,
  });
  const response = await fetcher(`/jupiter/ultra/v1/order?${params}`);
  if (!response.ok) throw new Error(`ultra-order-${response.status}`);
  const data = (await response.json()) as Record<string, unknown>;
  const order = parseUltraOrder(data);
  if (!order.requestId) throw new Error("ultra-no-request-id");
  return order;
}

export async function executeUltraOrder(
  signedTransactionBase64: string,
  requestId: string,
  fetcher: typeof fetch = fetch,
): Promise<UltraExecuteResult> {
  const response = await fetcher("/jupiter/ultra/v1/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedTransaction: signedTransactionBase64, requestId }),
  });
  if (!response.ok) throw new Error(`ultra-execute-${response.status}`);
  const data = (await response.json()) as Record<string, unknown>;
  const status = typeof data.status === "string" ? data.status : "unknown";
  if (status.toLowerCase() === "failed") {
    const err = typeof data.error === "string" ? data.error : "unknown";
    throw new Error(`ultra-execute-failed-${err}`);
  }
  return {
    status,
    signature: typeof data.signature === "string" ? data.signature : null,
    raw: data,
  };
}
```

`funding-ultra.test.ts` — bun test, pure, fetch injected as a stub that
records calls and returns canned Response objects. Cover AT MINIMUM:
- getUltraOrder builds `/jupiter/ultra/v1/order?...` with all four params
  (assert exact URL), returns parsed order, throws `ultra-order-500` on
  !ok and `ultra-no-request-id` when requestId missing.
- deriveUltraGasless: `{gasless:true}`→true; `{gasless:false}`→false;
  `{router:"JupiterZ"}`→true; `{swapType:"rfq"}`→true;
  `{signatureFee:0}`→true; `{signatureFee:5000}`→false; `{}`→null.
- parseUltraOrder: missing/malformed fields → nulls, raw preserved.
- executeUltraOrder: posts exact JSON body; success returns
  status+signature; `{status:"Failed",error:"slippage"}` → throws
  `ultra-execute-failed-slippage`; HTTP 502 → `ultra-execute-502`.

Run `bunx biome check --write` on both files before validating.

## Acceptance criteria

- All tests above pass; no network in tests.
- Existing funding.ts exports and behavior untouched (getJupiterQuote /
  getJupiterSwapTransaction byte-identical).
- Nothing imports the new functions yet (`rg "getUltraOrder" apps` shows
  only funding.ts + the test).

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
