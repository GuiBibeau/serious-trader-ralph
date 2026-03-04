import { describe, expect, test } from "bun:test";
import {
  buildFillLedgerCsv,
  FILLS_LEDGER_CSV_COLUMNS,
  type FillLedgerRow,
  filterFillLedgerRows,
  paginateFillLedgerRows,
} from "../../apps/portal/app/terminal/components/fills-ledger";

function row(input: Partial<FillLedgerRow> & { id: string }): FillLedgerRow {
  return {
    id: input.id,
    ts: input.ts ?? 0,
    requestId: input.requestId ?? `req_${input.id}`,
    receiptId: input.receiptId ?? `rcpt_${input.id}`,
    pairId: input.pairId ?? "SOL/USDC",
    side: input.side ?? "buy",
    sizeBaseUi: input.sizeBaseUi ?? 1,
    quoteFilledUi: input.quoteFilledUi ?? 100,
    price: input.price ?? 100,
    feeUi: input.feeUi ?? 0.00001,
    feeSymbol: input.feeSymbol ?? "SOL",
    status: input.status ?? "finalized",
    provider: input.provider ?? "helius-sender",
    signature: input.signature ?? "sig",
  };
}

describe("portal terminal fills ledger helpers", () => {
  test("filters by side, pair, status, and search query", () => {
    const rows = [
      row({ id: "1", pairId: "SOL/USDC", side: "buy", provider: "jito" }),
      row({
        id: "2",
        pairId: "SOL/USDT",
        side: "sell",
        status: "failed",
        provider: "helius-sender",
      }),
      row({ id: "3", pairId: "USDC/USDT", side: "buy", provider: "jito" }),
    ];

    const filtered = filterFillLedgerRows(rows, {
      side: "buy",
      pairId: "all",
      status: "successful",
      query: "jito",
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((entry) => entry.id)).toEqual(["1", "3"]);

    const failedOnly = filterFillLedgerRows(rows, {
      side: "all",
      pairId: "SOL/USDT",
      status: "failed",
      query: "",
    });
    expect(failedOnly).toHaveLength(1);
    expect(failedOnly[0]?.id).toBe("2");
  });

  test("paginates deterministically", () => {
    const rows = [row({ id: "1" }), row({ id: "2" }), row({ id: "3" })];
    expect(paginateFillLedgerRows(rows, 1, 2).map((entry) => entry.id)).toEqual(
      ["1", "2"],
    );
    expect(paginateFillLedgerRows(rows, 2, 2).map((entry) => entry.id)).toEqual(
      ["3"],
    );
    expect(paginateFillLedgerRows(rows, 4, 2)).toEqual([]);
  });

  test("exports stable csv header and escapes fields", () => {
    const csv = buildFillLedgerCsv([
      row({
        id: "csv",
        requestId: 'req_"1"',
        provider: "provider,one",
        signature: "sig\nline",
      }),
    ]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(FILLS_LEDGER_CSV_COLUMNS.join(","));
    expect(lines[1]).toContain('"req_""1"""');
    expect(lines[1]).toContain('"provider,one"');
    expect(lines[1]).toContain('"sig');
  });
});
