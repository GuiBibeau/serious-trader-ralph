import type { PairId } from "./trade-pairs";

export type FillLedgerRow = {
  id: string;
  ts: number;
  requestId: string;
  receiptId: string | null;
  pairId: PairId;
  side: "buy" | "sell";
  sizeBaseUi: number;
  quoteFilledUi: number;
  price: number | null;
  feeUi: number | null;
  feeSymbol: string | null;
  status: string;
  provider: string | null;
  signature: string | null;
};

export type FillLedgerSideFilter = "all" | "buy" | "sell";
export type FillLedgerStatusFilter = "all" | "successful" | "failed";

export type FillLedgerFilters = {
  side: FillLedgerSideFilter;
  pairId: PairId | "all";
  status: FillLedgerStatusFilter;
  query: string;
};

export const FILLS_LEDGER_CSV_COLUMNS = [
  "timestamp_iso",
  "request_id",
  "receipt_id",
  "pair",
  "side",
  "size_base",
  "quote_notional",
  "price",
  "fee",
  "fee_symbol",
  "status",
  "provider",
  "signature",
] as const;

function normalizeStatus(value: string): string {
  return value.trim().toLowerCase();
}

function isSuccessfulStatus(value: string): boolean {
  const normalized = normalizeStatus(value);
  return normalized === "landed" || normalized === "finalized";
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function rowMatchesQuery(row: FillLedgerRow, query: string): boolean {
  if (!query) return true;
  return (
    row.requestId.toLowerCase().includes(query) ||
    row.pairId.toLowerCase().includes(query) ||
    row.side.toLowerCase().includes(query) ||
    (row.receiptId ?? "").toLowerCase().includes(query) ||
    (row.signature ?? "").toLowerCase().includes(query) ||
    (row.provider ?? "").toLowerCase().includes(query) ||
    normalizeStatus(row.status).includes(query)
  );
}

export function filterFillLedgerRows(
  rows: readonly FillLedgerRow[],
  filters: FillLedgerFilters,
): FillLedgerRow[] {
  const query = normalizeQuery(filters.query);
  const output: FillLedgerRow[] = [];
  for (const row of rows) {
    if (filters.side !== "all" && row.side !== filters.side) continue;
    if (filters.pairId !== "all" && row.pairId !== filters.pairId) continue;
    if (filters.status === "successful" && !isSuccessfulStatus(row.status)) {
      continue;
    }
    if (filters.status === "failed" && isSuccessfulStatus(row.status)) {
      continue;
    }
    if (!rowMatchesQuery(row, query)) continue;
    output.push(row);
  }
  return output;
}

export function paginateFillLedgerRows(
  rows: readonly FillLedgerRow[],
  page: number,
  pageSize: number,
): FillLedgerRow[] {
  if (!Number.isFinite(pageSize) || pageSize <= 0) return [];
  const normalizedPage =
    Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const start = (normalizedPage - 1) * pageSize;
  if (start >= rows.length) return [];
  return rows.slice(start, start + pageSize);
}

function escapeCsvField(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function formatCsvNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return value.toString();
}

export function buildFillLedgerCsv(rows: readonly FillLedgerRow[]): string {
  const header = FILLS_LEDGER_CSV_COLUMNS.join(",");
  const lines = rows.map((row) =>
    [
      new Date(row.ts).toISOString(),
      row.requestId,
      row.receiptId ?? "",
      row.pairId,
      row.side,
      formatCsvNumber(row.sizeBaseUi),
      formatCsvNumber(row.quoteFilledUi),
      formatCsvNumber(row.price),
      formatCsvNumber(row.feeUi),
      row.feeSymbol ?? "",
      row.status,
      row.provider ?? "",
      row.signature ?? "",
    ]
      .map((value) => escapeCsvField(value))
      .join(","),
  );
  return `${header}\n${lines.join("\n")}\n`;
}
