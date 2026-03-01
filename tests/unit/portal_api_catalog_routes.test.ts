import { describe, expect, test } from "bun:test";
import { GET as getJsonCatalog } from "../../apps/portal/app/api/endpoints.json/route";
import { GET as getTextCatalog } from "../../apps/portal/app/api/endpoints.txt/route";
import { GET as getLlmsTxt } from "../../apps/portal/app/llms.txt/route";

const EXPECTED_X402_PATHS = [
  "/x402/read/market_snapshot",
  "/x402/read/market_snapshot_v2",
  "/x402/read/market_token_balance",
  "/x402/read/market_jupiter_quote",
  "/x402/read/market_jupiter_quote_batch",
  "/x402/read/market_ohlcv",
  "/x402/read/market_indicators",
  "/x402/read/solana_marks_latest",
  "/x402/read/solana_scores_latest",
  "/x402/read/solana_views_top",
  "/x402/read/macro_signals",
  "/x402/read/macro_fred_indicators",
  "/x402/read/macro_etf_flows",
  "/x402/read/macro_stablecoin_health",
  "/x402/read/macro_oil_analytics",
  "/x402/read/perps_funding_surface",
  "/x402/read/perps_open_interest_surface",
  "/x402/read/perps_venue_score",
] as const;

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

describe("portal x402 api catalog routes", () => {
  test("GET /api/endpoints.json returns public x402 catalog only", async () => {
    const response = getJsonCatalog(
      new Request("https://portal.example/api/endpoints.json"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const payload = (await response.json()) as unknown;
    const payloadRecord = toRecord(payload);
    expect(payloadRecord).not.toBeNull();

    const endpointsRaw = Array.isArray(payloadRecord?.endpoints)
      ? payloadRecord.endpoints
      : [];
    expect(endpointsRaw.length).toBe(18);

    const endpointRecords = endpointsRaw
      .map((item) => toRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null);
    const endpointPaths = endpointRecords.map((item) =>
      String(item.path ?? ""),
    );

    for (const expectedPath of EXPECTED_X402_PATHS) {
      expect(endpointPaths.includes(expectedPath)).toBe(true);
    }

    expect(endpointPaths.includes("/api/me")).toBe(false);
    expect(endpointPaths.includes("/api/trade/swap")).toBe(false);
    expect(
      endpointPaths.every((path) => path.startsWith("/x402/read/")),
    ).toBe(true);

    expect(
      endpointRecords.every((endpoint) => toRecord(endpoint.requestExample)),
    ).toBe(true);
    expect(
      endpointRecords.every((endpoint) => toRecord(endpoint.responseExample)),
    ).toBe(true);

    const supportedTrading = toRecord(payloadRecord?.supportedTrading);
    expect(supportedTrading).not.toBeNull();
    const supportedPairs = Array.isArray(supportedTrading?.pairs)
      ? supportedTrading.pairs
      : [];
    const supportedTokens = Array.isArray(supportedTrading?.tokens)
      ? supportedTrading.tokens
      : [];
    expect(supportedPairs.length).toBeGreaterThan(10);
    expect(supportedPairs.some((row) => toRecord(row)?.id === "SOL/USDT")).toBe(
      true,
    );
    expect(
      supportedTokens.some((row) => toRecord(row)?.symbol === "USDT"),
    ).toBe(true);

    const oilEndpoint =
      endpointRecords.find(
        (endpoint) => endpoint.path === "/x402/read/macro_oil_analytics",
      ) ?? null;
    const oilExample = oilEndpoint
      ? toRecord(oilEndpoint.responseExample)
      : null;
    expect(oilExample).not.toBeNull();
    expect(String(oilExample?.configured ?? "")).toBe("true");
  });

  test("GET /api/endpoints.txt returns plain text with x402 endpoints", async () => {
    const response = getTextCatalog(
      new Request("https://portal.example/api/endpoints.txt"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");

    const body = await response.text();
    expect(body.toLowerCase().includes("x402")).toBe(true);
    expect(body.toLowerCase().includes("example response")).toBe(true);
    for (const expectedPath of EXPECTED_X402_PATHS) {
      expect(body.includes(expectedPath)).toBe(true);
    }
  });

  test("GET /llms.txt includes discovery links", async () => {
    const response = getLlmsTxt(new Request("https://portal.example/llms.txt"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");

    const body = await response.text();
    expect(body.includes("https://portal.example/api")).toBe(true);
    expect(body.includes("https://portal.example/endpoints.json")).toBe(
      true,
    );
    expect(body.includes("https://portal.example/endpoints.txt")).toBe(
      true,
    );
    for (const expectedPath of EXPECTED_X402_PATHS) {
      expect(body.includes(expectedPath)).toBe(true);
    }
  });
});
