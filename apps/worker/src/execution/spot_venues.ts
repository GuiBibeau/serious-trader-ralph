import type { JupiterClient, JupiterQuoteResponse } from "../jupiter";
import type { OrcaClient, OrcaPoolSnapshot } from "../orca";
import type { RaydiumClient } from "../raydium";
import type { RuntimeMode } from "../runtime_contracts";

export type SpotVenueQuoteTelemetry = {
  venueKey: string;
  quoteProvider: string;
  routeHopCount: number;
  routeLabels: string[];
  poolIds: string[];
  quotedOutAmountAtomic: string;
  minExpectedOutAmountAtomic: string | null;
  priceImpactPct: number | null;
  poolAddress?: string | null;
  poolFeeRateBps?: number | null;
  poolTickSpacing?: number | null;
  poolCurrentTickIndex?: number | null;
  poolTvlUsd?: string | null;
  poolLiquidityAtomic?: string | null;
  adaptiveFeeEnabled?: boolean | null;
  warningActive?: boolean | null;
  addressLookupTable?: string | null;
  dailyVolumeUsd?: string | null;
};

function readQuotePriceImpactPct(quoteResponse: JupiterQuoteResponse): number {
  const raw = quoteResponse.priceImpactPct;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  const parsed = Number(raw ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readOrcaPoolSnapshot(
  quoteResponse: JupiterQuoteResponse,
): OrcaPoolSnapshot | null {
  const record = (quoteResponse as Record<string, unknown>)?.orcaPoolSnapshot;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  return record as OrcaPoolSnapshot;
}

export function buildSpotVenueQuoteTelemetry(input: {
  venueKey: string;
  quoteProvider: string;
  quoteResponse: JupiterQuoteResponse;
}): SpotVenueQuoteTelemetry {
  const routePlan = Array.isArray(input.quoteResponse.routePlan)
    ? input.quoteResponse.routePlan
    : [];
  const routeLabels = Array.from(
    new Set(
      routePlan
        .map((hop) => String(hop?.swapInfo?.label ?? "").trim())
        .filter(Boolean),
    ),
  );
  const poolIds = Array.from(
    new Set(
      routePlan
        .map((hop) =>
          String(
            (hop as Record<string, unknown>)?.poolId ??
              (hop?.swapInfo as Record<string, unknown> | undefined)?.poolId ??
              "",
          ).trim(),
        )
        .filter(Boolean),
    ),
  );
  const minExpectedOutAmountAtomic = String(
    (input.quoteResponse as Record<string, unknown>)?.otherAmountThreshold ??
      "",
  ).trim();

  const base = {
    venueKey: input.venueKey,
    quoteProvider: input.quoteProvider,
    routeHopCount: routePlan.length,
    routeLabels,
    poolIds,
    quotedOutAmountAtomic: String(input.quoteResponse.outAmount ?? ""),
    minExpectedOutAmountAtomic: minExpectedOutAmountAtomic || null,
    priceImpactPct: readQuotePriceImpactPct(input.quoteResponse),
  };
  const orcaPool = readOrcaPoolSnapshot(input.quoteResponse);
  if (!orcaPool) {
    return base;
  }
  return {
    ...base,
    poolAddress: readTrimmedString(orcaPool.address),
    poolFeeRateBps: readFiniteNumber(orcaPool.feeRate),
    poolTickSpacing: readFiniteNumber(orcaPool.tickSpacing),
    poolCurrentTickIndex: readFiniteNumber(orcaPool.tickCurrentIndex),
    poolTvlUsd: readTrimmedString(orcaPool.tvlUsdc),
    poolLiquidityAtomic: readTrimmedString(orcaPool.liquidity),
    adaptiveFeeEnabled:
      typeof orcaPool.adaptiveFeeEnabled === "boolean"
        ? orcaPool.adaptiveFeeEnabled
        : null,
    warningActive:
      typeof orcaPool.hasWarning === "boolean" ? orcaPool.hasWarning : null,
    addressLookupTable: readTrimmedString(orcaPool.addressLookupTable),
    dailyVolumeUsd: readTrimmedString(orcaPool.stats?.["24h"]?.volume),
  };
}

export async function quoteSpotSwap(input: {
  venueKey?: string;
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  slippageBps: number;
  jupiter: JupiterClient;
  orca?: OrcaClient;
  raydium?: RaydiumClient;
}): Promise<{
  venueKey: string;
  quoteProvider: string;
  quoteResponse: JupiterQuoteResponse;
  routeQuality: SpotVenueQuoteTelemetry;
}> {
  const venueKey = String(input.venueKey ?? "jupiter").trim() || "jupiter";
  if (venueKey === "orca") {
    if (!input.orca) {
      throw new Error("orca-client-missing");
    }
    const { normalizedQuote } = await input.orca.quoteBaseIn({
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      amount: input.amountAtomic,
      slippageBps: input.slippageBps,
    });
    return {
      venueKey,
      quoteProvider: "orca",
      quoteResponse: normalizedQuote,
      routeQuality: buildSpotVenueQuoteTelemetry({
        venueKey,
        quoteProvider: "orca",
        quoteResponse: normalizedQuote,
      }),
    };
  }
  if (venueKey === "raydium") {
    if (!input.raydium) {
      throw new Error("raydium-client-missing");
    }
    const { normalizedQuote } = await input.raydium.quoteBaseIn({
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      amount: input.amountAtomic,
      slippageBps: input.slippageBps,
      txVersion: "V0",
    });
    return {
      venueKey,
      quoteProvider: "raydium",
      quoteResponse: normalizedQuote,
      routeQuality: buildSpotVenueQuoteTelemetry({
        venueKey,
        quoteProvider: "raydium",
        quoteResponse: normalizedQuote,
      }),
    };
  }

  const quoteResponse = await input.jupiter.quote({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amountAtomic,
    slippageBps: input.slippageBps,
    swapMode: "ExactIn",
  });
  return {
    venueKey,
    quoteProvider: "jupiter",
    quoteResponse,
    routeQuality: buildSpotVenueQuoteTelemetry({
      venueKey,
      quoteProvider: "jupiter",
      quoteResponse,
    }),
  };
}

export function resolveSpotVenueExecutionAdapter(input: {
  venueKey?: string;
  runtimeMode?: RuntimeMode;
  defaultAdapter: string;
}): string {
  const venueKey = String(input.venueKey ?? "").trim();
  if (venueKey === "orca") {
    return "orca";
  }
  if (venueKey === "raydium") {
    return "raydium";
  }
  return input.defaultAdapter;
}
