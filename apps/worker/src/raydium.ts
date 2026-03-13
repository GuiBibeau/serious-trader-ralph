import type { JupiterQuoteResponse } from "./jupiter";

export type RaydiumApiEnvelope<T> = {
  id?: string;
  success?: boolean;
  version?: string;
  data?: T;
  msg?: string;
  [k: string]: unknown;
};

export type RaydiumQuoteRoutePlanStep = {
  poolId?: string;
  inputMint?: string;
  outputMint?: string;
  feeMint?: string;
  feeRate?: number;
  feeAmount?: string;
  remainingAccounts?: string[];
  [k: string]: unknown;
};

export type RaydiumQuoteResponse = {
  swapType?: string;
  inputMint?: string;
  inputAmount?: string;
  outputMint?: string;
  outputAmount?: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  priceImpactPct?: number | string;
  referrerAmount?: string;
  routePlan?: RaydiumQuoteRoutePlanStep[];
  [k: string]: unknown;
};

export type RaydiumSwapTransactionRecord = {
  transaction?: string;
  [k: string]: unknown;
};

export type RaydiumSwapTransactionEnvelope = RaydiumApiEnvelope<
  RaydiumSwapTransactionRecord[]
>;

export type RaydiumTxVersion = "V0" | "LEGACY";

function normalizeRaydiumPath(pathname: string): string {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function parseRaydiumPriceImpactPct(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readRaydiumEnvelope<T>(
  response: Response,
  label: string,
): Promise<RaydiumApiEnvelope<T>> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${label} failed: ${response.status}${body ? ` ${body}` : ""}`,
    );
  }
  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${label} invalid response`);
  }
  const envelope = payload as RaydiumApiEnvelope<T>;
  if (envelope.success === false) {
    throw new Error(`${label} failed: ${String(envelope.msg ?? "unknown")}`);
  }
  return envelope;
}

export function normalizeRaydiumQuoteResponse(
  envelope: RaydiumApiEnvelope<RaydiumQuoteResponse>,
): JupiterQuoteResponse {
  const quote = envelope.data;
  if (!quote || typeof quote !== "object" || Array.isArray(quote)) {
    throw new Error("Raydium quote missing data");
  }
  const inputMint = String(quote.inputMint ?? "").trim();
  const outputMint = String(quote.outputMint ?? "").trim();
  const inAmount = String(quote.inputAmount ?? "").trim();
  const outAmount = String(quote.outputAmount ?? "").trim();
  if (!inputMint || !outputMint || !inAmount || !outAmount) {
    throw new Error("Raydium quote missing required amounts");
  }

  return {
    inputMint,
    outputMint,
    inAmount,
    outAmount,
    priceImpactPct: parseRaydiumPriceImpactPct(quote.priceImpactPct),
    slippageBps:
      typeof quote.slippageBps === "number" ? quote.slippageBps : undefined,
    swapMode: quote.swapType === "BaseOut" ? "ExactOut" : "ExactIn",
    otherAmountThreshold:
      typeof quote.otherAmountThreshold === "string"
        ? quote.otherAmountThreshold
        : undefined,
    routePlan: Array.isArray(quote.routePlan)
      ? quote.routePlan.map((step) => ({
          poolId: step.poolId,
          inputMint: step.inputMint,
          outputMint: step.outputMint,
          feeMint: step.feeMint,
          feeRate: step.feeRate,
          feeAmount: step.feeAmount,
          swapInfo: {
            label: "Raydium",
            poolId: step.poolId,
            inputMint: step.inputMint,
            outputMint: step.outputMint,
            feeMint: step.feeMint,
            feeRate: step.feeRate,
            feeAmount: step.feeAmount,
          },
        }))
      : [],
    quoteProvider: "raydium",
    raydiumQuoteEnvelope: envelope,
  };
}

export class RaydiumClient {
  constructor(
    private readonly apiBaseUrl = "https://api-v3.raydium.io",
    private readonly transactionBaseUrl = "https://transaction-v1.raydium.io",
  ) {}

  async quoteBaseIn(request: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
    txVersion?: RaydiumTxVersion;
  }): Promise<{
    envelope: RaydiumApiEnvelope<RaydiumQuoteResponse>;
    normalizedQuote: JupiterQuoteResponse;
  }> {
    const url = new URL(
      normalizeRaydiumPath("/compute/swap-base-in"),
      this.transactionBaseUrl,
    );
    url.searchParams.set("inputMint", request.inputMint);
    url.searchParams.set("outputMint", request.outputMint);
    url.searchParams.set("amount", request.amount);
    url.searchParams.set("slippageBps", String(request.slippageBps));
    url.searchParams.set("txVersion", request.txVersion ?? "V0");

    const response = await fetch(url.toString(), { method: "GET" });
    const envelope = await readRaydiumEnvelope<RaydiumQuoteResponse>(
      response,
      "Raydium quote",
    );
    return {
      envelope,
      normalizedQuote: normalizeRaydiumQuoteResponse(envelope),
    };
  }

  async autoFee(): Promise<string> {
    const url = new URL(
      normalizeRaydiumPath("/main/auto-fee"),
      this.apiBaseUrl,
    );
    const response = await fetch(url.toString(), { method: "GET" });
    const envelope = await readRaydiumEnvelope<{
      default?: {
        vh?: number | string;
        h?: number | string;
        m?: number | string;
      };
    }>(response, "Raydium auto-fee");
    const mediumFee = envelope.data?.default?.m;
    const parsed = Number(mediumFee);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error("Raydium auto-fee missing default.m");
    }
    return String(Math.round(parsed));
  }

  async buildSwapTransactions(request: {
    quoteEnvelope: RaydiumApiEnvelope<RaydiumQuoteResponse>;
    wallet: string;
    wrapSol: boolean;
    unwrapSol: boolean;
    computeUnitPriceMicroLamports?: string;
    txVersion?: RaydiumTxVersion;
    inputAccount?: string;
    outputAccount?: string;
  }): Promise<{
    envelope: RaydiumSwapTransactionEnvelope;
    transactions: string[];
    computeUnitPriceMicroLamports: string;
  }> {
    const computeUnitPriceMicroLamports =
      String(request.computeUnitPriceMicroLamports ?? "").trim() ||
      (await this.autoFee());
    const url = new URL(
      normalizeRaydiumPath("/transaction/swap-base-in"),
      this.transactionBaseUrl,
    );
    const body: Record<string, unknown> = {
      computeUnitPriceMicroLamports,
      swapResponse: request.quoteEnvelope,
      txVersion: request.txVersion ?? "V0",
      wallet: request.wallet,
      wrapSol: request.wrapSol,
      unwrapSol: request.unwrapSol,
    };
    if (request.inputAccount) body.inputAccount = request.inputAccount;
    if (request.outputAccount) body.outputAccount = request.outputAccount;

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const envelope = await readRaydiumEnvelope<RaydiumSwapTransactionRecord[]>(
      response,
      "Raydium swap transaction",
    );
    const transactions = Array.isArray(envelope.data)
      ? envelope.data
          .map((entry) => String(entry?.transaction ?? "").trim())
          .filter(Boolean)
      : [];
    if (transactions.length < 1) {
      throw new Error("Raydium swap transaction missing transaction");
    }
    return {
      envelope,
      transactions,
      computeUnitPriceMicroLamports,
    };
  }
}
