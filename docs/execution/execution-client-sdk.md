# Execution Client SDK (Portal)

`apps/portal/app/execution-client.ts` is the typed internal SDK for the execution fabric.

## Supported Calls

- `submit(payload, options)`
- `status(requestId)`
- `receipt(requestId)`
- `waitForTerminalReceipt({ requestId })`

## Built-In Utilities

- `newExecutionIdempotencyKey(prefix)`
- canonical error decoding into `ExecutionClientError`
- retry helper for transient execution errors in status/receipt polling

## Browser Usage (Portal)

```ts
const client = createExecutionClient({ authToken });
const idempotencyKey = newExecutionIdempotencyKey("trade");

const submit = await client.submit(payload, { idempotencyKey, signal });
const terminal = await client.waitForTerminalReceipt({
  requestId: submit.requestId,
  signal,
});
```

## Custom Transport Usage (Jobs/Automation)

The client accepts a custom `transport` so internal services can run against local worker stubs, test harnesses, or alternate request runners while preserving the same decoding and retry behavior.
