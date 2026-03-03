# Ralph Execution API v1 Contract

Status: draft contract for implementation gating (`X402-001`).

## Versioning

- `schemaVersion`: `"v1"`.
- Backward-compatible additions are allowed for optional fields only.
- Breaking changes require a new schema version.

## Public Endpoints

1. `POST /api/x402/exec/submit`
2. `GET /api/x402/exec/status/:requestId`
3. `GET /api/x402/exec/receipt/:requestId`

## Submit Headers

- Required: `Idempotency-Key`
- Optional auth/payment depending actor path:
  - `Authorization` for authenticated first-party flows.
  - `payment-signature` for paid x402 flows.

## Submit Modes

### `relay_signed`

- Caller sends a fully signed transaction payload.
- Ralph validates/routes/retries/tracks.
- Transaction bytes are immutable.

### `privy_execute`

- Caller sends execution intent for server-controlled Privy custody.
- Ralph builds/signs/submits transaction server-side.

## Error Envelope

All non-2xx responses should use a common shape:

```json
{
  "ok": false,
  "error": {
    "code": "invalid-request",
    "message": "human-readable summary"
  }
}
```

Canonical error codes (v1 target set):

- `payment-required`
- `auth-required`
- `invalid-request`
- `invalid-transaction`
- `policy-denied`
- `unsupported-lane`
- `insufficient-balance`
- `venue-timeout`
- `submission-failed`
- `expired-blockhash`
- `not-found`
- `not-ready`

## Schemas

- `docs/execution/schemas/exec.submit.request.v1.schema.json`
- `docs/execution/schemas/exec.submit.response.v1.schema.json`
- `docs/execution/schemas/exec.status.response.v1.schema.json`
- `docs/execution/schemas/exec.receipt.response.v1.schema.json`
- `docs/execution/schemas/error.envelope.v1.schema.json`

## Fixtures

- Valid and invalid fixtures are under `docs/execution/fixtures`.
- Unit tests validate fixtures against schemas.
