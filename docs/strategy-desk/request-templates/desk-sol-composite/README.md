# Desk SOL Composite Request Templates

These files are the checked-in inputs for the sample strategy-desk proof bundle
and drill flows.

Use them with:

- `bun run strategy-desk:registry` for scenario upsert, study, shadow, and
  paper runs
- direct `curl` calls to the Worker admin surface for handoff preparation,
  transitions, and detail reads

The handoff transition files do not contain the handoff id because the route
uses the path parameter:

```text
/api/admin/ops/runtime/strategy-desk/handoffs/<handoff-id>/transition
```
