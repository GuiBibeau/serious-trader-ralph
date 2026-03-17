import type { Env } from "./types";

export type DriftOrderOptions = {
  orderType?: "market" | "limit" | "trigger" | null;
  timeInForce?: "gtc" | "ioc" | "fok" | null;
  reduceOnly?: boolean | null;
  limitPriceAtomic?: string | null;
  triggerPriceAtomic?: string | null;
};

export type DriftContractSnapshot = {
  marketName: string;
  marketIndex: number | null;
  oracle: string | null;
  oracleSource: string | null;
  status: string | null;
  contractType: string | null;
  initialMarginRatio: number | null;
  maintenanceMarginRatio: number | null;
};

export type DriftFundingRateSnapshot = {
  marketName: string;
  fundingRate1h: number | null;
  fundingRate1hBps: number | null;
  oraclePrice: number | null;
  markPrice: number | null;
  sourceTs: string | null;
};

export type DriftPerpIntentPreview = {
  instrument: DriftContractSnapshot;
  funding: DriftFundingRateSnapshot | null;
  side: "long" | "short" | "close_long" | "close_short";
  direction: "long" | "short";
  reduceOnly: boolean;
  orderType: "market" | "limit" | "trigger";
  timeInForce: "gtc" | "ioc" | "fok";
  quantityAtomic: string;
  collateralAtomic: string | null;
  limitPriceAtomic: string | null;
  triggerPriceAtomic: string | null;
  swiftSupported: boolean;
};

type DriftContractsEnvelope = {
  contracts?: unknown;
  data?: unknown;
};

type DriftFundingRatesEnvelope = {
  fundingRates?: unknown;
  data?: unknown;
};

type DriftClientDeps = {
  fetch?: typeof fetch;
};

function readTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readScaledNumber(
  value: unknown,
  threshold: number,
  scale: number,
): number | null {
  const parsed = readFiniteNumber(value);
  if (parsed === null) return null;
  return Math.abs(parsed) >= threshold ? parsed / scale : parsed;
}

function readPositiveAtomic(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return /^[1-9][0-9]*$/.test(normalized) ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeInstrumentId(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeMarketName(value: unknown): string | null {
  const normalized = readTrimmedString(value);
  return normalized ? normalizeInstrumentId(normalized) : null;
}

function normalizeOrderType(value: unknown): "market" | "limit" | "trigger" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "limit") return "limit";
  if (normalized === "trigger") return "trigger";
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

function normalizeReduceOnly(side: string, reduceOnly: unknown): boolean {
  if (side === "close_long" || side === "close_short") return true;
  return reduceOnly === true;
}

function normalizeDirection(
  side: "long" | "short" | "close_long" | "close_short",
): "long" | "short" {
  if (side === "short" || side === "close_long") {
    return "short";
  }
  return "long";
}

function readContractsPayload(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  if (Array.isArray(value.contracts)) {
    return value.contracts.filter(isRecord);
  }
  if (Array.isArray(value.data)) {
    return value.data.filter(isRecord);
  }
  return [];
}

function readFundingRatesPayload(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  if (Array.isArray(value.fundingRates)) {
    return value.fundingRates.filter(isRecord);
  }
  if (Array.isArray(value.data)) {
    return value.data.filter(isRecord);
  }
  return [];
}

function mapContractSnapshot(
  record: Record<string, unknown>,
): DriftContractSnapshot | null {
  const marketName =
    normalizeMarketName(record.marketName) ??
    normalizeMarketName(record.ticker_id) ??
    normalizeMarketName(record.symbol) ??
    normalizeMarketName(record.contractName);
  if (!marketName) return null;
  return {
    marketName,
    marketIndex:
      readFiniteNumber(record.marketIndex) ??
      readFiniteNumber(record.contract_index) ??
      readFiniteNumber(record.index) ??
      null,
    oracle: readTrimmedString(record.oracle),
    oracleSource:
      readTrimmedString(record.oracleSource) ??
      readTrimmedString(record.oracleSourceName),
    status:
      readTrimmedString(record.status) ??
      (readTrimmedString(record.end_timestamp) ? "active" : null),
    contractType:
      readTrimmedString(record.contractType) ??
      readTrimmedString(record.product_type) ??
      readTrimmedString(record.marketType),
    initialMarginRatio:
      readFiniteNumber(record.initialMarginRatio) ??
      readFiniteNumber(record.imfFactor),
    maintenanceMarginRatio:
      readFiniteNumber(record.maintenanceMarginRatio) ??
      readFiniteNumber(record.marginRatioMaintenance),
  };
}

function mapFundingRateSnapshot(
  marketName: string,
  record: Record<string, unknown>,
): DriftFundingRateSnapshot {
  const fundingRate1h =
    readScaledNumber(record.fundingRate, 100, 1_000_000_000) ??
    readFiniteNumber(record.fundingRateHour) ??
    readFiniteNumber(record.hourlyFundingRate) ??
    readFiniteNumber(record.next_funding_rate);
  return {
    marketName,
    fundingRate1h,
    fundingRate1hBps:
      fundingRate1h === null
        ? null
        : Number((fundingRate1h * 10_000).toFixed(4)),
    oraclePrice:
      readFiniteNumber(record.oraclePrice) ??
      readScaledNumber(record.oraclePriceTwap, 100_000, 1_000_000),
    markPrice:
      readFiniteNumber(record.markPrice) ??
      readScaledNumber(record.markPriceTwap, 100_000, 1_000_000),
    sourceTs:
      readTrimmedString(record.ts) ??
      readTrimmedString(record.timestamp) ??
      readTrimmedString(record.fundingRateTs),
  };
}

function buildSyntheticPerpQuote(preview: DriftPerpIntentPreview): {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  routePlan: Array<{ poolId: string; swapInfo: { label: string } }>;
} {
  return {
    inputMint: preview.instrument.marketName,
    outputMint: preview.instrument.marketName,
    inAmount: preview.collateralAtomic ?? preview.quantityAtomic,
    outAmount: preview.quantityAtomic,
    priceImpactPct: 0,
    routePlan: [
      {
        poolId: preview.instrument.marketName,
        swapInfo: {
          label: preview.swiftSupported ? "Drift Swift" : "Drift",
        },
      },
    ],
  };
}

export class DriftClient {
  private readonly fetchImpl: typeof fetch;
  private readonly dataApiBase: string;
  private readonly swiftApiBase: string | null;

  constructor(
    input:
      | Env
      | {
          dataApiBase?: string;
          swiftApiBase?: string | null;
        },
    deps?: DriftClientDeps,
  ) {
    this.fetchImpl = deps?.fetch ?? ((resource, init) => fetch(resource, init));
    this.dataApiBase =
      readTrimmedString(
        "DRIFT_DATA_API_BASE" in input
          ? input.DRIFT_DATA_API_BASE
          : input.dataApiBase,
      ) ?? "https://data.api.drift.trade";
    this.swiftApiBase = readTrimmedString(
      "DRIFT_SWIFT_API_BASE" in input
        ? input.DRIFT_SWIFT_API_BASE
        : input.swiftApiBase,
    );
  }

  swiftConfigured(): boolean {
    return Boolean(this.swiftApiBase);
  }

  async listContracts(): Promise<DriftContractSnapshot[]> {
    const url = new URL("/contracts", this.dataApiBase);
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`drift-contracts-fetch-failed:${response.status}`);
    }
    const payload = (await response.json()) as DriftContractsEnvelope;
    return readContractsPayload(payload)
      .map(mapContractSnapshot)
      .filter((value): value is DriftContractSnapshot => Boolean(value));
  }

  async getFundingRates(
    marketName: string,
  ): Promise<DriftFundingRateSnapshot[]> {
    const normalizedMarket = normalizeMarketName(marketName);
    if (!normalizedMarket) throw new Error("drift-market-name-invalid");
    const url = new URL("/fundingRates", this.dataApiBase);
    url.searchParams.set("marketName", normalizedMarket);
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`drift-funding-rates-fetch-failed:${response.status}`);
    }
    const payload = (await response.json()) as DriftFundingRatesEnvelope;
    return readFundingRatesPayload(payload).map((record) =>
      mapFundingRateSnapshot(normalizedMarket, record),
    );
  }

  async describePerpIntent(input: {
    instrumentId: string;
    side: "long" | "short" | "close_long" | "close_short";
    quantityAtomic: string;
    collateralAtomic?: string | null;
    options?: DriftOrderOptions | null;
    executionAdapter?: string | null;
  }): Promise<DriftPerpIntentPreview> {
    const instrumentId = normalizeMarketName(input.instrumentId);
    if (!instrumentId) {
      throw new Error("drift-instrument-id-invalid");
    }
    const quantityAtomic = readPositiveAtomic(input.quantityAtomic);
    if (!quantityAtomic) {
      throw new Error("drift-quantity-atomic-invalid");
    }
    const collateralAtomic = input.collateralAtomic
      ? readPositiveAtomic(input.collateralAtomic)
      : null;
    if (input.collateralAtomic && !collateralAtomic) {
      throw new Error("drift-collateral-atomic-invalid");
    }
    const contracts = await this.listContracts();
    const instrument =
      contracts.find((record) => record.marketName === instrumentId) ?? null;
    if (!instrument) {
      throw new Error(`drift-contract-not-found:${instrumentId}`);
    }
    const funding =
      (await this.getFundingRates(instrument.marketName).catch(() => []))[0] ??
      null;
    const options = input.options ?? null;
    return {
      instrument,
      funding,
      side: input.side,
      direction: normalizeDirection(input.side),
      reduceOnly: normalizeReduceOnly(input.side, options?.reduceOnly),
      orderType: normalizeOrderType(options?.orderType),
      timeInForce: normalizeTimeInForce(options?.timeInForce),
      quantityAtomic,
      collateralAtomic,
      limitPriceAtomic: readPositiveAtomic(options?.limitPriceAtomic),
      triggerPriceAtomic: readPositiveAtomic(options?.triggerPriceAtomic),
      swiftSupported:
        String(input.executionAdapter ?? "").trim() === "drift_swift" &&
        this.swiftConfigured(),
    };
  }

  buildSyntheticQuote(preview: DriftPerpIntentPreview) {
    return buildSyntheticPerpQuote(preview);
  }
}
