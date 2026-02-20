export type JupiterQuoteResponse = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string | number;
  slippageBps?: number | string;
  swapMode?: string;
  routePlan?: Array<{
    swapInfo?: {
      label?: string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
};

export type JupiterSwapResponse = {
  swapTransaction: string;
  lastValidBlockHeight: number;
  [k: string]: unknown;
};

export type TokenInfo = {
  id: string;
  name?: string;
  symbol?: string;
  icon?: string | null;
  decimals: number;
  usdPrice?: number | null;
};

export type QuoteRequest = {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  swapMode?: "ExactIn" | "ExactOut";
  dexes?: string[];
  excludeDexes?: string[];
  onlyDirectRoutes?: boolean;
  restrictIntermediateTokens?: boolean;
};

export class JupiterClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  async quote(request: QuoteRequest): Promise<JupiterQuoteResponse> {
    const url = new URL("/swap/v1/quote", this.baseUrl);
    url.searchParams.set("inputMint", request.inputMint);
    url.searchParams.set("outputMint", request.outputMint);
    url.searchParams.set("amount", request.amount);
    url.searchParams.set("slippageBps", request.slippageBps.toString());
    if (request.swapMode) url.searchParams.set("swapMode", request.swapMode);
    if (request.dexes?.length)
      url.searchParams.set("dexes", request.dexes.join(","));
    if (request.excludeDexes?.length) {
      url.searchParams.set("excludeDexes", request.excludeDexes.join(","));
    }
    if (request.onlyDirectRoutes !== undefined) {
      url.searchParams.set(
        "onlyDirectRoutes",
        request.onlyDirectRoutes ? "true" : "false",
      );
    }
    if (request.restrictIntermediateTokens !== undefined) {
      url.searchParams.set(
        "restrictIntermediateTokens",
        request.restrictIntermediateTokens ? "true" : "false",
      );
    }

    const headers: Record<string, string> = {};
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    const response = await fetch(url.toString(), { method: "GET", headers });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Jupiter quote failed: ${response.status}${text ? ` ${text}` : ""}`,
      );
    }
    const data = (await response.json()) as unknown;
    if (!data || typeof data !== "object") {
      throw new Error("Jupiter quote invalid response");
    }
    return data as JupiterQuoteResponse;
  }

  async swap(request: {
    quoteResponse: JupiterQuoteResponse;
    userPublicKey: string;
  }): Promise<JupiterSwapResponse> {
    const url = new URL("/swap/v1/swap", this.baseUrl);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        quoteResponse: request.quoteResponse,
        userPublicKey: request.userPublicKey,
        wrapAndUnwrapSol: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const requestId =
        response.headers.get("x-request-id") ??
        response.headers.get("x-request-id".toLowerCase()) ??
        "";
      const idSuffix = requestId ? ` requestId=${requestId}` : "";
      throw new Error(
        `Jupiter swap failed: ${response.status}${idSuffix} ${body}`,
      );
    }

    const data = (await response.json()) as unknown;
    if (!data || typeof data !== "object") {
      throw new Error("Jupiter swap invalid response");
    }
    const parsed = data as Partial<JupiterSwapResponse>;
    if (typeof parsed.swapTransaction !== "string") {
      throw new Error("Jupiter swap missing swapTransaction");
    }
    if (typeof parsed.lastValidBlockHeight !== "number") {
      throw new Error("Jupiter swap missing lastValidBlockHeight");
    }
    return parsed as JupiterSwapResponse;
  }

  async programIdToLabel(): Promise<Record<string, string>> {
    const url = new URL("/swap/v1/program-id-to-label", this.baseUrl);
    const headers: Record<string, string> = {};
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    const response = await fetch(url.toString(), { method: "GET", headers });
    if (!response.ok) {
      throw new Error(`Jupiter program-id-to-label failed: ${response.status}`);
    }
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {};
    }
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "string" && value.trim()) {
        output[key] = value.trim();
      }
    }
    return output;
  }

  async searchTokens(query: string): Promise<TokenInfo[]> {
    const q = String(query ?? "").trim();
    if (!q) return [];
    const url = new URL("/tokens/v2/search", this.baseUrl);
    url.searchParams.set("query", q);
    const headers: Record<string, string> = {};
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    const response = await fetch(url.toString(), { method: "GET", headers });
    if (!response.ok) {
      throw new Error(`Jupiter token search failed: ${response.status}`);
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!Array.isArray(payload)) return [];
    return payload
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          typeof (item as Record<string, unknown>).id === "string" &&
          typeof (item as Record<string, unknown>).decimals === "number",
      )
      .map((item) => ({
        id: String(item.id ?? ""),
        name: typeof item.name === "string" ? item.name : undefined,
        symbol: typeof item.symbol === "string" ? item.symbol : undefined,
        icon:
          typeof item.icon === "string" || item.icon === null
            ? (item.icon as string | null)
            : undefined,
        decimals: Number(item.decimals),
        usdPrice: Number.isFinite(Number(item.usdPrice))
          ? Number(item.usdPrice)
          : null,
      }))
      .filter((item) => item.id && Number.isFinite(item.decimals));
  }
}
