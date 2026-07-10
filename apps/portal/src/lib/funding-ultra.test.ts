import { describe, expect, test } from "bun:test";
import {
  deriveUltraGasless,
  executeUltraOrder,
  getUltraOrder,
  parseUltraOrder,
} from "./funding";

type FetchCall = {
  input: Parameters<typeof fetch>[0];
  init: Parameters<typeof fetch>[1];
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function makeJsonFetcher(responses: Response[]): {
  calls: FetchCall[];
  fetcher: typeof fetch;
} {
  const calls: FetchCall[] = [];
  const fetcher = Object.assign(
    async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const [input, init] = args;
      calls.push({ input, init });
      const response = responses.shift();
      if (!response) throw new Error("unexpected-fetch-call");
      return response;
    },
    { preconnect: fetch.preconnect },
  );
  return { calls, fetcher };
}

describe("deriveUltraGasless", () => {
  test("detects gasless from explicit booleans", () => {
    expect(deriveUltraGasless({ gasless: true })).toBe(true);
    expect(deriveUltraGasless({ gasless: false })).toBe(false);
  });

  test("detects gasless RFQ routes", () => {
    expect(deriveUltraGasless({ router: "JupiterZ" })).toBe(true);
    expect(deriveUltraGasless({ swapType: "rfq" })).toBe(true);
  });

  test("detects gasless from signature fee when present", () => {
    expect(deriveUltraGasless({ signatureFee: 0 })).toBe(true);
    expect(deriveUltraGasless({ signatureFee: 5000 })).toBe(false);
  });

  test("returns null when gasless eligibility cannot be determined", () => {
    expect(deriveUltraGasless({})).toBeNull();
  });
});

describe("parseUltraOrder", () => {
  test("parses known fields and preserves raw payload", () => {
    const raw = {
      requestId: "req-1",
      transaction: "unsigned-tx",
      inAmount: "100",
      outAmount: "90",
      gasless: true,
      router: "JupiterZ",
    };

    expect(parseUltraOrder(raw)).toEqual({
      requestId: "req-1",
      transaction: "unsigned-tx",
      inAmount: "100",
      outAmount: "90",
      gasless: true,
      router: "JupiterZ",
      raw,
    });
  });

  test("missing or malformed optional fields become nulls and raw is preserved", () => {
    const raw = {
      requestId: 7,
      transaction: 8,
      inAmount: null,
      outAmount: false,
      router: 9,
    };
    const order = parseUltraOrder(raw);

    expect(order).toEqual({
      requestId: "",
      transaction: null,
      inAmount: null,
      outAmount: null,
      gasless: null,
      router: null,
      raw,
    });
    expect(order.raw).toBe(raw);
  });
});

describe("getUltraOrder", () => {
  test("builds the Ultra order URL and returns a parsed order", async () => {
    const raw = {
      requestId: "req-1",
      transaction: "unsigned-tx",
      inAmount: "12345",
      outAmount: "67890",
      router: "JupiterZ",
    };
    const { calls, fetcher } = makeJsonFetcher([jsonResponse(raw)]);

    const order = await getUltraOrder(
      "So111",
      "USDC111",
      "12345",
      "TakerPubkey",
      fetcher,
    );

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "/jupiter/ultra/v1/order?inputMint=So111&outputMint=USDC111&amount=12345&taker=TakerPubkey",
    );
    expect(calls[0]?.init).toBeUndefined();
    expect(order).toEqual({
      requestId: "req-1",
      transaction: "unsigned-tx",
      inAmount: "12345",
      outAmount: "67890",
      gasless: true,
      router: "JupiterZ",
      raw,
    });
  });

  test("throws coded error on HTTP failure", async () => {
    const { fetcher } = makeJsonFetcher([
      jsonResponse({ error: "boom" }, { status: 500 }),
    ]);

    await expect(
      getUltraOrder("So111", "USDC111", "12345", "TakerPubkey", fetcher),
    ).rejects.toThrow("ultra-order-500");
  });

  test("throws when requestId is missing", async () => {
    const { fetcher } = makeJsonFetcher([jsonResponse({ transaction: "tx" })]);

    await expect(
      getUltraOrder("So111", "USDC111", "12345", "TakerPubkey", fetcher),
    ).rejects.toThrow("ultra-no-request-id");
  });
});

describe("executeUltraOrder", () => {
  test("posts the signed transaction and returns status plus signature", async () => {
    const { calls, fetcher } = makeJsonFetcher([
      jsonResponse({ status: "Success", signature: "sig-1" }),
    ]);

    const result = await executeUltraOrder("signed-tx", "req-1", fetcher);

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe("/jupiter/ultra/v1/execute");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({
      "content-type": "application/json",
    });
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ signedTransaction: "signed-tx", requestId: "req-1" }),
    );
    expect(result).toEqual({
      status: "Success",
      signature: "sig-1",
      raw: { status: "Success", signature: "sig-1" },
    });
  });

  test("throws when Ultra reports failed execution", async () => {
    const { fetcher } = makeJsonFetcher([
      jsonResponse({ status: "Failed", error: "slippage" }),
    ]);

    await expect(
      executeUltraOrder("signed-tx", "req-1", fetcher),
    ).rejects.toThrow("ultra-execute-failed-slippage");
  });

  test("throws coded error on HTTP failure", async () => {
    const { fetcher } = makeJsonFetcher([
      jsonResponse({ error: "bad gateway" }, { status: 502 }),
    ]);

    await expect(
      executeUltraOrder("signed-tx", "req-1", fetcher),
    ).rejects.toThrow("ultra-execute-502");
  });
});

test("parseUltraOrder normalizes empty-string transaction to null (live API shape)", () => {
  const order = parseUltraOrder({ requestId: "r1", transaction: "" });
  expect(order.transaction).toBeNull();
});
