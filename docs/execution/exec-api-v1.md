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

## Copy/Paste Examples

Set your API base:

```bash
API_BASE="https://dev.api.trader-ralph.com"
```

Relay-signed submit (x402 paid):

```bash
curl -X POST "$API_BASE/api/x402/exec/submit" \
  -H "content-type: application/json" \
  -H "Idempotency-Key: relay-001" \
  -H "payment-signature: <solana_tx_signature>" \
  -d '{
    "schemaVersion": "v1",
    "mode": "relay_signed",
    "lane": "fast",
    "metadata": {
      "source": "external-agent",
      "reason": "market-entry",
      "clientRequestId": "relay-001"
    },
    "relaySigned": {
      "encoding": "base64",
      "signedTransaction": "AQABAgMEBQYH"
    }
  }'
```

Privy execute submit (trusted first-party path):

```bash
curl -X POST "$API_BASE/api/x402/exec/submit" \
  -H "content-type: application/json" \
  -H "Idempotency-Key: privy-001" \
  -d '{
    "schemaVersion": "v1",
    "mode": "privy_execute",
    "lane": "safe",
    "metadata": {
      "source": "terminal-ui",
      "reason": "rebalance",
      "clientRequestId": "privy-001"
    },
    "privyExecute": {
      "intentType": "swap",
      "wallet": "4Nd1mYjtY9p7jW3nX5z9r4s1v6u8t2q3m5n7p9r1s2t3",
      "swap": {
        "inputMint": "So11111111111111111111111111111111111111112",
        "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "amountAtomic": "100000000",
        "slippageBps": 50
      },
      "options": {
        "commitment": "confirmed"
      }
    }
  }'
```

Status polling (public):

```bash
curl "$API_BASE/api/x402/exec/status/execreq_01HZWXQ6V4KR2Y2XP9VJ6Y3Q7A"
```

Receipt polling (public):

```bash
curl "$API_BASE/api/x402/exec/receipt/execreq_01HZWXQ6V4KR2Y2XP9VJ6Y3Q7A"
```

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
