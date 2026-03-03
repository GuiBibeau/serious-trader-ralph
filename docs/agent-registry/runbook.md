# Agent Registry Runbook

This runbook covers Trader Ralph registration and submission across lanes.

## Environment variables

- `AGENT_SOLANA_PRIVATE_KEY` (JSON array format)
- `AGENT_PINATA_JWT`
- `AGENT_REGISTRY_API_BASE_URL`
- `AGENT_REGISTRY_API_TOKEN`
- Optional: `AGENT_ASSET_PUBKEY` (existing agent asset to update URI)

## Validate metadata only

```bash
bun run agent-registry:validate -- --lane dev
bun run agent-registry:validate -- --lane staging
bun run agent-registry:validate -- --lane production
```

## Dry-run full sync

```bash
bun run agent-registry:sync -- --lane dev --step all --dry-run
bun run agent-registry:sync -- --lane staging --step all --dry-run
bun run agent-registry:sync -- --lane production --step all --dry-run
```

## Execute publish + register

```bash
bun run agent-registry:sync -- --lane dev --step all
bun run agent-registry:sync -- --lane staging --step all
bun run agent-registry:sync -- --lane production --step all
```

## Submit to registry API (optional)

```bash
bun run agent-registry:submit -- --lane production --step submit
```

## Lane chain mapping

- `dev` -> Solana `devnet`
- `staging` -> Solana `devnet`
- `production` -> Solana `mainnet-beta`

## Output state

State files are written to:

- `.tmp/agent-registry/dev.state.json`
- `.tmp/agent-registry/staging.state.json`
- `.tmp/agent-registry/production.state.json`

## Manual verification checklist

1. `curl -fsS https://<lane-api-domain>/openapi.json`
2. `curl -fsS https://<lane-api-domain>/agent-registry/metadata.json`
3. `curl -fsS 'https://<lane-api-domain>/api/agent/query?q=macro'`
4. Verify x402 routes still return `402` without `payment-signature`.
5. Confirm asset pubkey and metadata URI in `.tmp/agent-registry/<lane>.state.json`.
