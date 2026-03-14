import type { Env } from "./types";

const DEFAULT_DFLOW_METADATA_API_BASE =
  "https://dev-prediction-markets-api.dflow.net/api/v1";
const DEFAULT_DFLOW_NOTIONAL_DECIMALS = 6;
const DEFAULT_DFLOW_MARKET_NOTIONAL_CAP_USD = 25;
const DEFAULT_DFLOW_OPEN_INTEREST_SHARE_PCT = 20;

export type DFlowPredictionOrderOptions = {
  orderType?: "market" | "limit" | "trigger" | null;
  timeInForce?: "gtc" | "ioc" | "fok" | null;
  quantityMode?: "base" | "quote" | "notional" | null;
  limitPriceAtomic?: string | null;
  marketSnapshot?: unknown;
  marketNotionalCapUsd?: number | string | null;
  maxOpenInterestSharePct?: number | string | null;
};

export type DFlowPredictionMarketAccount = {
  accountId: string | null;
  yesMint: string | null;
  noMint: string | null;
  ledgerMint: string | null;
  settlementMint: string | null;
  scalarOutcomePct: number | null;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  volume: number | null;
  openInterest: number | null;
  redemptionStatus: string | null;
  status: string | null;
};

export type DFlowPredictionMarket = {
  marketId: string;
  title: string;
  eventTitle: string | null;
  status: string | null;
  result: string | null;
  endTime: string | null;
  settleTime: string | null;
  accounts: DFlowPredictionMarketAccount[];
};

export type DFlowPredictionIntentPreview = {
  market: DFlowPredictionMarket;
  marketAccount: DFlowPredictionMarketAccount;
  outcomeMint: string;
  outcomeSide: "yes" | "no";
  side: "buy_yes" | "buy_no" | "sell_yes" | "sell_no";
  orderType: "market" | "limit";
  timeInForce: "gtc" | "ioc" | "fok";
  quantityMode: "base" | "quote" | "notional";
  quantityAtomic: string;
  settlementMint: string | null;
  priceQuote: number | null;
  estimatedNotionalUsd: number | null;
  liveReady: boolean;
  notes: string[];
};

type DFlowClientDeps = {
  fetch?: typeof fetch;
};

type DFlowClientConfig = {
  metadataApiBase?: string;
  apiKey?: string | null;
};

type DFlowMarketsEnvelope = {
  markets?: unknown;
  data?: unknown;
};

type DFlowMarketEnvelope = {
  market?: unknown;
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPositiveAtomic(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return /^[1-9][0-9]*$/.test(normalized) ? normalized : null;
}

function readMarketsPayload(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  if (Array.isArray(value.markets)) {
    return value.markets.filter(isRecord);
  }
  if (Array.isArray(value.data)) {
    return value.data.filter(isRecord);
  }
  return [];
}

function readAccountPayload(
  value: unknown,
): Array<{ accountId: string | null; record: Record<string, unknown> }> {
  if (Array.isArray(value)) {
    return value
      .filter(isRecord)
      .map((record) => ({ accountId: null, record }));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter(([, record]) => isRecord(record))
    .map(([accountId, record]) => ({
      accountId: accountId.trim() || null,
      record: record as Record<string, unknown>,
    }));
}

function mapMarketAccount(input: {
  accountId: string | null;
  record: Record<string, unknown>;
}): DFlowPredictionMarketAccount {
  return {
    accountId: input.accountId,
    yesMint:
      readTrimmedString(input.record.yesMint) ??
      readTrimmedString(input.record.yes_mint),
    noMint:
      readTrimmedString(input.record.noMint) ??
      readTrimmedString(input.record.no_mint),
    ledgerMint:
      readTrimmedString(input.record.ledgerMint) ??
      readTrimmedString(input.record.ledger_mint),
    settlementMint:
      readTrimmedString(input.record.settlementMint) ??
      readTrimmedString(input.record.inputMint) ??
      readTrimmedString(input.record.quoteMint),
    scalarOutcomePct:
      readFiniteNumber(input.record.scalarOutcomePct) ??
      readFiniteNumber(input.record.scalar_outcome_pct),
    yesBid:
      readFiniteNumber(input.record.yesBid) ??
      readFiniteNumber(input.record.yes_bid),
    yesAsk:
      readFiniteNumber(input.record.yesAsk) ??
      readFiniteNumber(input.record.yes_ask),
    noBid:
      readFiniteNumber(input.record.noBid) ??
      readFiniteNumber(input.record.no_bid),
    noAsk:
      readFiniteNumber(input.record.noAsk) ??
      readFiniteNumber(input.record.no_ask),
    volume:
      readFiniteNumber(input.record.volume) ??
      readFiniteNumber(input.record.volumeUsd),
    openInterest:
      readFiniteNumber(input.record.openInterest) ??
      readFiniteNumber(input.record.open_interest),
    redemptionStatus:
      readTrimmedString(input.record.redemptionStatus) ??
      readTrimmedString(input.record.redemption_status),
    status: readTrimmedString(input.record.status),
  };
}

function mapPredictionMarket(
  record: Record<string, unknown>,
): DFlowPredictionMarket | null {
  const marketId =
    readTrimmedString(record.ticker) ??
    readTrimmedString(record.marketId) ??
    readTrimmedString(record.id);
  if (!marketId) return null;
  const title =
    readTrimmedString(record.title) ??
    readTrimmedString(record.question) ??
    marketId;
  return {
    marketId,
    title,
    eventTitle:
      readTrimmedString(record.eventTitle) ??
      readTrimmedString(record.event_title),
    status: readTrimmedString(record.status),
    result: readTrimmedString(record.result),
    endTime:
      readTrimmedString(record.endTime) ??
      readTrimmedString(record.closeTime) ??
      readTrimmedString(record.close_time),
    settleTime:
      readTrimmedString(record.settleTime) ??
      readTrimmedString(record.settlementTime) ??
      readTrimmedString(record.settlement_time),
    accounts: readAccountPayload(record.accounts).map(mapMarketAccount),
  };
}

function normalizeOrderType(value: unknown): "market" | "limit" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "limit") return "limit";
  if (normalized === "trigger") {
    throw new Error("dflow-trigger-orders-not-supported");
  }
  return "market";
}

function normalizeTimeInForce(value: unknown): "gtc" | "ioc" | "fok" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "ioc") return "ioc";
  if (normalized === "fok") return "fok";
  return "gtc";
}

function normalizeQuantityMode(value: unknown): "base" | "quote" | "notional" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "base") return "base";
  if (normalized === "quote") return "quote";
  return "notional";
}

function atomicToNumber(value: string, decimals: number): number | null {
  if (!/^[0-9]+$/.test(value)) return null;
  const normalized =
    decimals > 0 ? value.padStart(decimals + 1, "0") : value || "0";
  const whole =
    decimals > 0 ? normalized.slice(0, -decimals) || "0" : normalized;
  const fraction =
    decimals > 0 ? normalized.slice(-decimals).replace(/0+$/, "") : "";
  const joined = fraction ? `${whole}.${fraction}` : whole;
  const parsed = Number(joined);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTradableStatus(value: string | null): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return (
    normalized === "" ||
    normalized === "open" ||
    normalized === "active" ||
    normalized === "live" ||
    normalized === "trading"
  );
}

function pickBestPrice(
  ...candidates: Array<number | null | undefined>
): number | null {
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    if (!Number.isFinite(value)) continue;
    if (value > 0) return value;
  }
  return null;
}

function resolveMatchedOutcomeSide(input: {
  account: DFlowPredictionMarketAccount;
  outcomeMint: string;
  side: DFlowPredictionIntentPreview["side"];
}): "yes" | "no" {
  const matchYes = input.account.yesMint === input.outcomeMint;
  const matchNo = input.account.noMint === input.outcomeMint;
  if (!matchYes && !matchNo) {
    throw new Error("dflow-outcome-mint-not-found");
  }
  if (input.side.endsWith("_yes") && !matchYes) {
    throw new Error("dflow-outcome-side-mismatch");
  }
  if (input.side.endsWith("_no") && !matchNo) {
    throw new Error("dflow-outcome-side-mismatch");
  }
  return matchYes ? "yes" : "no";
}

function resolvePriceQuote(input: {
  account: DFlowPredictionMarketAccount;
  outcomeSide: "yes" | "no";
  side: DFlowPredictionIntentPreview["side"];
  limitPriceAtomic?: string | null;
}): number | null {
  const limitPriceQuote = input.limitPriceAtomic
    ? atomicToNumber(input.limitPriceAtomic, DEFAULT_DFLOW_NOTIONAL_DECIMALS)
    : null;
  if (limitPriceQuote !== null) return limitPriceQuote;

  const buy = input.side.startsWith("buy");
  if (input.outcomeSide === "yes") {
    return buy
      ? pickBestPrice(
          input.account.yesAsk,
          input.account.yesBid,
          input.account.noBid === null ? null : 1 - input.account.noBid,
        )
      : pickBestPrice(
          input.account.yesBid,
          input.account.yesAsk,
          input.account.noAsk === null ? null : 1 - input.account.noAsk,
        );
  }
  return buy
    ? pickBestPrice(
        input.account.noAsk,
        input.account.noBid,
        input.account.yesBid === null ? null : 1 - input.account.yesBid,
      )
    : pickBestPrice(
        input.account.noBid,
        input.account.noAsk,
        input.account.yesAsk === null ? null : 1 - input.account.yesAsk,
      );
}

function estimateNotionalUsd(input: {
  quantityAtomic: string;
  quantityMode: "base" | "quote" | "notional";
  priceQuote: number | null;
}): number | null {
  if (input.quantityMode === "notional" || input.quantityMode === "quote") {
    return atomicToNumber(
      input.quantityAtomic,
      DEFAULT_DFLOW_NOTIONAL_DECIMALS,
    );
  }
  const baseQuantity = atomicToNumber(
    input.quantityAtomic,
    DEFAULT_DFLOW_NOTIONAL_DECIMALS,
  );
  if (baseQuantity === null || input.priceQuote === null) return null;
  return Number((baseQuantity * input.priceQuote).toFixed(6));
}

function findMatchingAccount(
  market: DFlowPredictionMarket,
  outcomeMint: string,
): DFlowPredictionMarketAccount | null {
  return (
    market.accounts.find(
      (account) =>
        account.yesMint === outcomeMint ||
        account.noMint === outcomeMint ||
        account.ledgerMint === outcomeMint,
    ) ?? null
  );
}

function readDFlowOptions(
  options: DFlowPredictionOrderOptions | Record<string, unknown> | null,
): DFlowPredictionOrderOptions | null {
  if (!options || !isRecord(options)) return null;
  return options as DFlowPredictionOrderOptions;
}

async function readJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${label} failed: ${response.status}${body ? ` ${body}` : ""}`,
    );
  }
  return await response.json();
}

function buildDFlowUrl(path: string, baseUrl: string): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  return new URL(normalizedPath, normalizedBase);
}

export class DFlowClient {
  private readonly fetchImpl: typeof fetch;
  private readonly metadataApiBase: string;
  private readonly apiKey: string | null;

  constructor(input: Env | DFlowClientConfig, deps?: DFlowClientDeps) {
    this.fetchImpl = deps?.fetch ?? fetch;
    const config: DFlowClientConfig =
      "metadataApiBase" in input
        ? input
        : {
            metadataApiBase: input.DFLOW_METADATA_API_BASE,
            apiKey: input.DFLOW_API_KEY,
          };
    this.metadataApiBase =
      readTrimmedString(config.metadataApiBase) ??
      DEFAULT_DFLOW_METADATA_API_BASE;
    this.apiKey = readTrimmedString(config.apiKey);
  }

  async listPredictionMarkets(input?: {
    status?: string;
    limit?: number;
  }): Promise<DFlowPredictionMarket[]> {
    const url = buildDFlowUrl("markets", this.metadataApiBase);
    if (input?.status) {
      url.searchParams.set("status", input.status);
    }
    if (typeof input?.limit === "number" && input.limit > 0) {
      url.searchParams.set("limit", String(input.limit));
    }
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
      },
    });
    const payload = (await readJson(
      response,
      "DFlow markets",
    )) as DFlowMarketsEnvelope;
    return readMarketsPayload(payload.markets ?? payload.data)
      .map(mapPredictionMarket)
      .filter((market): market is DFlowPredictionMarket => Boolean(market));
  }

  async getPredictionMarketByMint(
    mint: string,
  ): Promise<DFlowPredictionMarket | null> {
    const normalizedMint = readTrimmedString(mint);
    if (!normalizedMint) {
      throw new Error("dflow-outcome-mint-required");
    }
    const url = buildDFlowUrl(
      `markets/by-mint/${encodeURIComponent(normalizedMint)}`,
      this.metadataApiBase,
    );
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
      },
    });
    const payload = (await readJson(
      response,
      "DFlow market by mint",
    )) as DFlowMarketEnvelope;
    const record = isRecord(payload.market)
      ? payload.market
      : isRecord(payload.data)
        ? payload.data
        : null;
    return record ? mapPredictionMarket(record) : null;
  }

  async describePredictionIntent(input: {
    instrumentId: string;
    outcomeId: string;
    side: DFlowPredictionIntentPreview["side"];
    quantityAtomic: string;
    options?: DFlowPredictionOrderOptions | Record<string, unknown> | null;
  }): Promise<DFlowPredictionIntentPreview> {
    const quantityAtomic = readPositiveAtomic(input.quantityAtomic);
    if (!quantityAtomic) {
      throw new Error("dflow-quantity-atomic-invalid");
    }
    const options = readDFlowOptions(input.options ?? null);
    const orderType = normalizeOrderType(options?.orderType);
    const timeInForce = normalizeTimeInForce(options?.timeInForce);
    const quantityMode = normalizeQuantityMode(options?.quantityMode);
    const outcomeId = readTrimmedString(input.outcomeId);
    if (!outcomeId) {
      throw new Error("dflow-outcome-id-required");
    }

    const snapshot = isRecord(options?.marketSnapshot)
      ? mapPredictionMarket(options?.marketSnapshot)
      : null;
    const market =
      snapshot ?? (await this.getPredictionMarketByMint(outcomeId));
    if (!market) {
      throw new Error("dflow-market-unavailable");
    }
    if (
      market.marketId !== input.instrumentId &&
      market.marketId.toLowerCase() !== input.instrumentId.toLowerCase()
    ) {
      throw new Error("dflow-market-id-mismatch");
    }

    if (!isTradableStatus(market.status)) {
      throw new Error("dflow-market-not-open");
    }

    const marketAccount = findMatchingAccount(market, outcomeId);
    if (!marketAccount) {
      throw new Error("dflow-outcome-mint-not-found");
    }
    if (!isTradableStatus(marketAccount.status)) {
      throw new Error("dflow-market-account-not-open");
    }

    const outcomeSide = resolveMatchedOutcomeSide({
      account: marketAccount,
      outcomeMint: outcomeId,
      side: input.side,
    });
    const priceQuote = resolvePriceQuote({
      account: marketAccount,
      outcomeSide,
      side: input.side,
      limitPriceAtomic: options?.limitPriceAtomic ?? null,
    });
    const estimatedNotionalUsd = estimateNotionalUsd({
      quantityAtomic,
      quantityMode,
      priceQuote,
    });
    const marketNotionalCapUsd =
      readFiniteNumber(options?.marketNotionalCapUsd) ??
      DEFAULT_DFLOW_MARKET_NOTIONAL_CAP_USD;
    if (
      estimatedNotionalUsd !== null &&
      estimatedNotionalUsd > marketNotionalCapUsd
    ) {
      throw new Error("dflow-market-notional-cap-exceeded");
    }
    const maxOpenInterestSharePct =
      readFiniteNumber(options?.maxOpenInterestSharePct) ??
      DEFAULT_DFLOW_OPEN_INTEREST_SHARE_PCT;
    if (
      estimatedNotionalUsd !== null &&
      marketAccount.openInterest !== null &&
      marketAccount.openInterest > 0
    ) {
      const sharePct =
        (estimatedNotionalUsd / marketAccount.openInterest) * 100;
      if (sharePct > maxOpenInterestSharePct) {
        throw new Error("dflow-market-concentration-exceeded");
      }
    }

    const notes = [
      `dflow:${input.side}:${outcomeSide}`,
      `market:${market.marketId}`,
      ...(market.status ? [`status:${market.status}`] : []),
      ...(marketAccount.redemptionStatus
        ? [`redemption:${marketAccount.redemptionStatus}`]
        : []),
      "prediction-market-live-requires-proof",
    ];

    return {
      market,
      marketAccount,
      outcomeMint: outcomeId,
      outcomeSide,
      side: input.side,
      orderType,
      timeInForce,
      quantityMode,
      quantityAtomic,
      settlementMint: marketAccount.settlementMint,
      priceQuote,
      estimatedNotionalUsd,
      liveReady: false,
      notes,
    };
  }

  buildSyntheticQuote(preview: DFlowPredictionIntentPreview): {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    priceImpactPct: number;
    routePlan: Array<{ poolId: string; swapInfo: { label: string } }>;
  } {
    const buy = preview.side.startsWith("buy");
    return {
      inputMint: buy
        ? (preview.settlementMint ?? preview.market.marketId)
        : preview.outcomeMint,
      outputMint: buy
        ? preview.outcomeMint
        : (preview.settlementMint ?? preview.market.marketId),
      inAmount: preview.quantityAtomic,
      outAmount: preview.quantityAtomic,
      priceImpactPct: 0,
      routePlan: [
        {
          poolId: preview.market.marketId,
          swapInfo: { label: "DFlow Prediction" },
        },
      ],
    };
  }
}
