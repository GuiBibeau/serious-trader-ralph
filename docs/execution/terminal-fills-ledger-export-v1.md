# Terminal Fills Ledger Export (v1)

CSV export from the terminal fills ledger is versioned by fixed column order.

## Filename pattern

- `terminal-fills-ledger-<iso-timestamp>.csv`

## Column order (stable)

1. `timestamp_iso`
2. `request_id`
3. `receipt_id`
4. `pair`
5. `side`
6. `size_base`
7. `quote_notional`
8. `price`
9. `fee`
10. `fee_symbol`
11. `status`
12. `provider`
13. `signature`

## Notes

- Values are exported in the terminal's in-memory fill history.
- CSV escaping follows RFC 4180 style (`"` escaped as `""`).
- Empty fields are emitted when source data is unavailable.
