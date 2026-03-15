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

export type JupiterInstructionAccount = {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
};

export type JupiterSerializedInstruction = {
  programId: string;
  accounts: JupiterInstructionAccount[];
  data: string;
};

export type JupiterSwapInstructionsResponse = {
  tokenLedgerInstruction?: JupiterSerializedInstruction | null;
  computeBudgetInstructions?: JupiterSerializedInstruction[];
  setupInstructions?: JupiterSerializedInstruction[];
  swapInstruction: JupiterSerializedInstruction;
  cleanupInstruction?: JupiterSerializedInstruction | null;
  otherInstructions?: JupiterSerializedInstruction[];
  addressLookupTableAddresses?: string[];
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

export type JupiterPriceV3Record = {
  id: string;
  usdPrice?: number | null;
  price?: number | null;
  time?: number | string | null;
  blockId?: number | string | null;
  [k: string]: unknown;
};

export type JupiterTriggerCondition = "above" | "below";

export type JupiterTriggerOrderStatusRequest = "active" | "history";

export type JupiterTriggerOrderTrade = {
  inputAmount?: string;
  rawInputAmount?: string;
  outputAmount?: string;
  rawOutputAmount?: string;
  tx?: string | null;
  txUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [k: string]: unknown;
};

export type JupiterTriggerOrderRecord = {
  order?: string | null;
  orderKey?: string | null;
  maker?: string | null;
  userPubkey?: string | null;
  payer?: string | null;
  inputMint?: string | null;
  outputMint?: string | null;
  makingAmount?: string | null;
  rawMakingAmount?: string | null;
  takingAmount?: string | null;
  rawTakingAmount?: string | null;
  remainingMakingAmount?: string | null;
  rawRemainingMakingAmount?: string | null;
  remainingTakingAmount?: string | null;
  rawRemainingTakingAmount?: string | null;
  status?: string | null;
  openTx?: string | null;
  closeTx?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  expiredAt?: string | number | null;
  feeBps?: number | null;
  triggerCondition?: string | null;
  trades?: JupiterTriggerOrderTrade[];
  [k: string]: unknown;
};

export type JupiterTriggerOrdersResponse = {
  orders: JupiterTriggerOrderRecord[];
  totalOrders: number;
  page: number;
  [k: string]: unknown;
};

export type JupiterTriggerCreateOrderRequest = {
  inputMint: string;
  outputMint: string;
  maker: string;
  payer?: string;
  params: {
    makingAmount: string;
    takingAmount: string;
    triggerCondition: JupiterTriggerCondition;
    slippageBps?: string | number;
    expiredAt?: number;
    feeBps?: number;
  };
};

export type JupiterTriggerCreateOrderResponse = {
  transaction: string;
  requestId: string;
  order: string;
  [k: string]: unknown;
};

export type JupiterTriggerCancelOrderRequest = {
  maker: string;
  payer?: string;
  order: string;
};

export type JupiterTriggerCancelOrderResponse = {
  transaction: string;
  requestId: string;
  order: string;
  [k: string]: unknown;
};

export type JupiterGetTriggerOrdersRequest = {
  maker: string;
  user?: string;
  orderStatus: JupiterTriggerOrderStatusRequest;
  inputMint?: string;
  outputMint?: string;
  page?: number;
  includeFailedTx?: boolean;
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

  private buildAuthHeaders(
    extra?: Record<string, string>,
  ): Record<string, string> {
    const headers = extra ? { ...extra } : {};
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    return headers;
  }

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

    const headers = this.buildAuthHeaders();
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
    const headers = this.buildAuthHeaders({
      "content-type": "application/json",
    });
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

  async swapInstructions(request: {
    quoteResponse: JupiterQuoteResponse;
    userPublicKey: string;
    dynamicComputeUnitLimit?: boolean;
  }): Promise<JupiterSwapInstructionsResponse> {
    const url = new URL("/swap/v1/swap-instructions", this.baseUrl);
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
        dynamicComputeUnitLimit:
          request.dynamicComputeUnitLimit !== undefined
            ? request.dynamicComputeUnitLimit
            : true,
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
        `Jupiter swap-instructions failed: ${response.status}${idSuffix} ${body}`,
      );
    }

    const data = (await response.json()) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Jupiter swap-instructions invalid response");
    }
    const parsed = data as Partial<JupiterSwapInstructionsResponse>;
    if (
      !parsed.swapInstruction ||
      typeof parsed.swapInstruction !== "object" ||
      Array.isArray(parsed.swapInstruction)
    ) {
      throw new Error("Jupiter swap-instructions missing swapInstruction");
    }
    return parsed as JupiterSwapInstructionsResponse;
  }

  async programIdToLabel(): Promise<Record<string, string>> {
    const url = new URL("/swap/v1/program-id-to-label", this.baseUrl);
    const headers = this.buildAuthHeaders();
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
    const headers = this.buildAuthHeaders();
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

  async priceV3(ids: string[]): Promise<Record<string, JupiterPriceV3Record>> {
    const uniqueIds = Array.from(
      new Set(
        ids
          .map((value) => String(value ?? "").trim())
          .filter((value) => Boolean(value)),
      ),
    );
    if (uniqueIds.length < 1) {
      return {};
    }
    const url = new URL("/price/v3", this.baseUrl);
    url.searchParams.set("ids", uniqueIds.join(","));
    const headers = this.buildAuthHeaders();
    const response = await fetch(url.toString(), { method: "GET", headers });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Jupiter price v3 failed: ${response.status}${text ? ` ${text}` : ""}`,
      );
    }
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Jupiter price v3 invalid response");
    }
    const root = payload.data;
    const records =
      root && typeof root === "object" && !Array.isArray(root)
        ? (root as Record<string, unknown>)
        : payload;
    const output: Record<string, JupiterPriceV3Record> = {};
    for (const [key, value] of Object.entries(records)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const record = value as Record<string, unknown>;
      const usdPriceRaw =
        typeof record.usdPrice === "number"
          ? record.usdPrice
          : Number(record.usdPrice);
      const priceRaw =
        typeof record.price === "number" ? record.price : Number(record.price);
      output[key] = {
        id: String(record.id ?? key),
        usdPrice: Number.isFinite(usdPriceRaw) ? usdPriceRaw : null,
        price: Number.isFinite(priceRaw) ? priceRaw : null,
        time:
          typeof record.time === "number" || typeof record.time === "string"
            ? record.time
            : null,
        blockId:
          typeof record.blockId === "number" ||
          typeof record.blockId === "string"
            ? record.blockId
            : null,
        ...record,
      };
    }
    return output;
  }

  async createTriggerOrder(
    request: JupiterTriggerCreateOrderRequest,
  ): Promise<JupiterTriggerCreateOrderResponse> {
    const url = new URL("/trigger/v1/createOrder", this.baseUrl);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: this.buildAuthHeaders({
        "content-type": "application/json",
      }),
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Jupiter trigger createOrder failed: ${response.status}${text ? ` ${text}` : ""}`,
      );
    }
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Jupiter trigger createOrder invalid response");
    }
    const transaction = String(payload.transaction ?? "").trim();
    const requestId = String(payload.requestId ?? "").trim();
    const order = String(payload.order ?? "").trim();
    if (!transaction || !requestId || !order) {
      throw new Error("Jupiter trigger createOrder missing fields");
    }
    return {
      transaction,
      requestId,
      order,
      ...payload,
    };
  }

  async cancelTriggerOrder(
    request: JupiterTriggerCancelOrderRequest,
  ): Promise<JupiterTriggerCancelOrderResponse> {
    const url = new URL("/trigger/v1/cancelOrder", this.baseUrl);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: this.buildAuthHeaders({
        "content-type": "application/json",
      }),
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Jupiter trigger cancelOrder failed: ${response.status}${text ? ` ${text}` : ""}`,
      );
    }
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Jupiter trigger cancelOrder invalid response");
    }
    const transaction = String(payload.transaction ?? "").trim();
    const requestId = String(payload.requestId ?? "").trim();
    const order = String(payload.order ?? "").trim();
    if (!transaction || !requestId || !order) {
      throw new Error("Jupiter trigger cancelOrder missing fields");
    }
    return {
      transaction,
      requestId,
      order,
      ...payload,
    };
  }

  async getTriggerOrders(
    request: JupiterGetTriggerOrdersRequest,
  ): Promise<JupiterTriggerOrdersResponse> {
    const url = new URL("/trigger/v1/getTriggerOrders", this.baseUrl);
    const user = String(request.user ?? request.maker ?? "").trim();
    if (!user) {
      throw new Error("Jupiter trigger getTriggerOrders requires user");
    }
    url.searchParams.set("user", user);
    url.searchParams.set("orderStatus", request.orderStatus);
    if (request.inputMint) url.searchParams.set("inputMint", request.inputMint);
    if (request.outputMint) {
      url.searchParams.set("outputMint", request.outputMint);
    }
    if (Number.isFinite(request.page) && (request.page as number) >= 1) {
      url.searchParams.set("page", String(Math.floor(request.page as number)));
    }
    if (request.includeFailedTx !== undefined) {
      url.searchParams.set(
        "includeFailedTx",
        request.includeFailedTx ? "true" : "false",
      );
    }
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.buildAuthHeaders(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Jupiter trigger getTriggerOrders failed: ${response.status}${text ? ` ${text}` : ""}`,
      );
    }
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Jupiter trigger getTriggerOrders invalid response");
    }
    const orders = Array.isArray(payload.orders)
      ? payload.orders
          .filter(
            (value): value is JupiterTriggerOrderRecord =>
              Boolean(value) &&
              typeof value === "object" &&
              !Array.isArray(value),
          )
          .map((order) => ({
            ...order,
            order:
              typeof order.order === "string" && order.order.trim()
                ? order.order
                : typeof order.orderKey === "string" && order.orderKey.trim()
                  ? order.orderKey
                  : "",
            maker:
              typeof order.maker === "string" && order.maker.trim()
                ? order.maker
                : typeof order.userPubkey === "string" &&
                    order.userPubkey.trim()
                  ? order.userPubkey
                  : null,
          }))
          .filter((order) => Boolean(order.order))
      : [];
    return {
      orders,
      totalOrders:
        Number(payload.totalOrders ?? orders.length) || orders.length,
      page: Number(payload.page ?? request.page ?? 1) || 1,
      ...payload,
    };
  }
}
