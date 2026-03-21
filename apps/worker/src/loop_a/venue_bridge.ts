import type { Mark } from "../../../../src/loops/contracts/loop_a";
import { SUPPORTED_TRADING_TOKENS, USDC_MINT } from "../defaults";
import {
  DFlowClient,
  type DFlowPredictionMarket,
  type DFlowPredictionMarketAccount,
} from "../dflow";
import {
  DriftClient,
  type DriftContractSnapshot,
  type DriftFundingRateSnapshot,
} from "../drift";
import type { MangoIntentPreview } from "../mango";
import type { Env } from "../types";
import { LOOP_A_SCHEMA_VERSION, type SlotCommitment } from "./types";

export type LoopAVenueParityMode =
  | "live_api_bridge"
  | "snapshot_bridge"
  | "blocked";

export type LoopAVenueParityStatus = {
  venueKey: string;
  marketType: "perp" | "prediction";
  mode: LoopAVenueParityMode;
  summary: string;
  artifactRef: string;
  adapterRef: string | null;
  blockerCodes: string[];
};

export type LoopAVenueBridgeTickResult = {
  commitment: SlotCommitment;
  slot: number;
  observedAt: string;
  marks: Mark[];
  observedVenues: string[];
  parityStatuses: LoopAVenueParityStatus[];
};

const DEFAULT_DFLOW_BRIDGE_LIMIT = 8;
const DEFAULT_DRIFT_SETTLEMENT_MINT = USDC_MINT;

const LOOP_A_VENUE_PARITY_STATUSES: LoopAVenueParityStatus[] = [
  {
    venueKey: "drift",
    marketType: "perp",
    mode: "live_api_bridge",
    summary:
      "Public Drift market and funding snapshots can produce Loop A perp marks without forcing the venue through swap decoding.",
    artifactRef: "docs/strategy-lab/loop-a-perp-prediction-venue-parity.md",
    adapterRef: "apps/worker/src/loop_a/venue_bridge.ts",
    blockerCodes: [],
  },
  {
    venueKey: "mango",
    marketType: "perp",
    mode: "snapshot_bridge",
    summary:
      "Checked Mango market and margin-account snapshots can produce venue-native perp marks with preserved account lineage.",
    artifactRef: "docs/strategy-lab/loop-a-perp-prediction-venue-parity.md",
    adapterRef: "apps/worker/src/loop_a/venue_bridge.ts",
    blockerCodes: [],
  },
  {
    venueKey: "jupiter_perps",
    marketType: "perp",
    mode: "blocked",
    summary:
      "Jupiter Perps stays fail-closed until the WIP lifecycle surface has deterministic replay fixtures and paper reconciliation coverage.",
    artifactRef: "docs/strategy-lab/pilots/jupiter-perps-readiness/README.md",
    adapterRef: null,
    blockerCodes: [
      "wip_public_api",
      "missing_replay_fixture",
      "missing_paper_lifecycle",
    ],
  },
  {
    venueKey: "raydium_perps",
    marketType: "perp",
    mode: "blocked",
    summary:
      "Raydium Perps stays fail-closed because order entry depends on private Orderly auth and a non-U.S. restricted external account model.",
    artifactRef: "docs/strategy-lab/pilots/raydium-perps-readiness/README.md",
    adapterRef: null,
    blockerCodes: [
      "private_orderly_auth",
      "external_account_dependency",
      "us_restricted",
    ],
  },
  {
    venueKey: "dflow",
    marketType: "prediction",
    mode: "live_api_bridge",
    summary:
      "DFlow market metadata can produce venue-native prediction marks with market, account, and settlement lineage.",
    artifactRef: "docs/strategy-lab/loop-a-perp-prediction-venue-parity.md",
    adapterRef: "apps/worker/src/loop_a/venue_bridge.ts",
    blockerCodes: [],
  },
  {
    venueKey: "drift_bet",
    marketType: "prediction",
    mode: "blocked",
    summary:
      "Drift BET stays fail-closed until maintained discovery, order, and settlement fixtures exist for Drift prediction contracts.",
    artifactRef: "docs/strategy-lab/pilots/drift-bet-readiness/README.md",
    adapterRef: null,
    blockerCodes: [
      "fragmented_docs",
      "missing_discovery_fixture",
      "missing_settlement_fixture",
    ],
  },
  {
    venueKey: "monaco",
    marketType: "prediction",
    mode: "blocked",
    summary:
      "Monaco stays fail-closed until the maintained client path, operator-lifecycle boundary, and reconciliation fixtures are locked.",
    artifactRef: "docs/strategy-lab/pilots/monaco-readiness/README.md",
    adapterRef: null,
    blockerCodes: [
      "sdk_surface_unsettled",
      "operator_boundary_missing",
      "missing_reconciliation_fixture",
    ],
  },
];

function cloneParityStatus(
  status: LoopAVenueParityStatus,
): LoopAVenueParityStatus {
  return {
    ...status,
    blockerCodes: [...status.blockerCodes],
  };
}

function hashStringFNV1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function asTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIsoTimestamp(value: unknown, fallback: string): string {
  const trimmed = asTrimmedString(value);
  if (!trimmed) return fallback;
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) {
      const millis = parsed >= 10_000_000_000 ? parsed : parsed * 1000;
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.05;
  return Math.max(0.05, Math.min(0.99, value));
}

function decimalString(value: number, digits = 8): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

function positiveDecimalString(
  value: number | null | undefined,
  digits = 8,
): string | null {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return null;
  const normalized = decimalString(value ?? 0, digits);
  return normalized === "0" ? null : normalized;
}

function stableIdentifier(prefix: string, raw: string): string {
  const safe =
    raw
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "UNKNOWN";
  const hash = hashStringFNV1a(`${prefix}:${raw}`);
  const suffix = `:${hash}`;
  const maxBodyLength = Math.max(1, 64 - prefix.length - suffix.length - 1);
  const body = safe.slice(0, maxBodyLength);
  let output = `${prefix}:${body}${suffix}`;
  while (output.length < 32) {
    output = `${output}_${hash}`;
    if (output.length > 64) {
      output = output.slice(0, 64);
      break;
    }
  }
  return output;
}

function resolvePerpUnderlyingMint(
  venueKey: string,
  instrumentId: string,
): string {
  const normalized = instrumentId
    .trim()
    .toUpperCase()
    .replace(/[-_/ ]?PERP$/, "");
  const token =
    SUPPORTED_TRADING_TOKENS.find(
      (entry) => entry.symbol.toUpperCase() === normalized,
    ) ?? null;
  return (
    token?.mint ?? stableIdentifier(`instrument:${venueKey}:perp`, instrumentId)
  );
}

function resolveSettlementMint(
  venueKey: string,
  marketId: string,
  settlementMint?: string | null,
): string {
  return (
    asTrimmedString(settlementMint) ??
    stableIdentifier(`settlement:${venueKey}`, marketId)
  );
}

function driftConfidence(input: {
  contract: DriftContractSnapshot;
  funding: DriftFundingRateSnapshot | null;
}): number {
  let confidence = 0.55;
  if (input.contract.status?.toLowerCase() === "active") confidence += 0.1;
  if (input.contract.oracleSource) confidence += 0.05;
  if (
    input.funding?.markPrice !== null &&
    input.funding?.oraclePrice !== null
  ) {
    confidence += 0.15;
    const oracle = input.funding.oraclePrice;
    const mark = input.funding.markPrice;
    if (oracle > 0 && mark > 0) {
      const divergence = Math.abs(mark - oracle) / oracle;
      confidence -= Math.min(0.2, divergence * 4);
    }
  } else if (
    input.funding?.markPrice !== null ||
    input.funding?.oraclePrice !== null
  ) {
    confidence += 0.05;
  }
  return clampConfidence(confidence);
}

function dflowConfidence(input: {
  bid: number | null;
  ask: number | null;
  openInterest: number | null;
}): number {
  let confidence = 0.45;
  if (input.bid !== null && input.ask !== null && input.ask >= input.bid) {
    confidence += 0.2;
    const midpoint = (input.bid + input.ask) / 2;
    if (midpoint > 0) {
      const spread = (input.ask - input.bid) / midpoint;
      confidence -= Math.min(0.2, spread);
    }
  } else if (input.bid !== null || input.ask !== null) {
    confidence += 0.1;
  }
  if ((input.openInterest ?? 0) > 0) confidence += 0.1;
  return clampConfidence(confidence);
}

function predictionMidpoint(input: {
  bid: number | null;
  ask: number | null;
}): { px: string; bid?: string; ask?: string } | null {
  const bid = input.bid;
  const ask = input.ask;
  if (bid !== null && ask !== null && bid > 0 && ask > 0 && ask >= bid) {
    const px = positiveDecimalString((bid + ask) / 2, 6);
    if (!px) return null;
    return {
      px,
      bid: positiveDecimalString(bid, 6) ?? undefined,
      ask: positiveDecimalString(ask, 6) ?? undefined,
    };
  }
  const fallback = positiveDecimalString(ask ?? bid, 6);
  return fallback ? { px: fallback } : null;
}

export function listLoopAVenueParityStatuses(): LoopAVenueParityStatus[] {
  return LOOP_A_VENUE_PARITY_STATUSES.map(cloneParityStatus);
}

export function buildDriftPerpObservationMark(input: {
  contract: DriftContractSnapshot;
  funding: DriftFundingRateSnapshot | null;
  slot: number;
  observedAt: string;
  positionAccount?: string | null;
  settlementMint?: string | null;
}): Mark | null {
  const marketName = asTrimmedString(input.contract.marketName)?.toUpperCase();
  if (!marketName) return null;
  const pxValue =
    input.funding?.markPrice ?? input.funding?.oraclePrice ?? null;
  const px = positiveDecimalString(pxValue, 8);
  if (!px) return null;

  const settlementMint = resolveSettlementMint(
    "drift",
    marketName,
    input.settlementMint ?? DEFAULT_DRIFT_SETTLEMENT_MINT,
  );
  const positionAccount = asTrimmedString(input.positionAccount);
  const ts = normalizeIsoTimestamp(input.funding?.sourceTs, input.observedAt);

  return {
    schemaVersion: LOOP_A_SCHEMA_VERSION,
    generatedAt: input.observedAt,
    slot: Math.max(0, Math.floor(input.slot)),
    ts,
    baseMint: resolvePerpUnderlyingMint("drift", marketName),
    quoteMint: settlementMint,
    px,
    confidence: driftConfidence({
      contract: input.contract,
      funding: input.funding,
    }),
    venue: "drift",
    lineage: {
      protocol: "drift",
      venue: "drift",
      marketType: "perp",
      market: marketName,
      ...(positionAccount ? { positionAccount } : {}),
      settlementMint,
    },
    evidence: {
      markets: [marketName],
      ...(positionAccount ? { positionAccounts: [positionAccount] } : {}),
      settlementMints: [settlementMint],
      inputs: [`loopA:v1:bridge:drift:slot:${input.slot}:market:${marketName}`],
    },
    version: LOOP_A_SCHEMA_VERSION,
  };
}

export function buildMangoPerpObservationMark(input: {
  preview: MangoIntentPreview;
  slot: number;
  observedAt: string;
  settlementMint?: string | null;
}): Mark | null {
  if (input.preview.market.marketType !== "perp") return null;
  const instrumentId = asTrimmedString(input.preview.market.instrumentId);
  const positionAccount = asTrimmedString(input.preview.account.accountRef);
  const px = positiveDecimalString(input.preview.market.referencePriceQuote, 8);
  if (!instrumentId || !px || !positionAccount) return null;

  const settlementMint = resolveSettlementMint(
    "mango",
    instrumentId,
    input.settlementMint ?? DEFAULT_DRIFT_SETTLEMENT_MINT,
  );

  return {
    schemaVersion: LOOP_A_SCHEMA_VERSION,
    generatedAt: input.observedAt,
    slot: Math.max(0, Math.floor(input.slot)),
    ts: normalizeIsoTimestamp(
      input.preview.account.capturedAt,
      input.observedAt,
    ),
    baseMint: resolvePerpUnderlyingMint("mango", instrumentId),
    quoteMint: settlementMint,
    px,
    confidence: clampConfidence(
      0.6 +
        (input.preview.market.status?.toLowerCase() === "active" ? 0.1 : 0) +
        (input.preview.market.oracleProvider ? 0.05 : 0),
    ),
    venue: "mango",
    lineage: {
      protocol: "mango",
      venue: "mango",
      marketType: "perp",
      market: instrumentId,
      positionAccount,
      settlementMint,
    },
    evidence: {
      markets: [instrumentId],
      positionAccounts: [positionAccount],
      settlementMints: [settlementMint],
      inputs: [
        `loopA:v1:bridge:mango:slot:${input.slot}:market:${instrumentId}:account:${positionAccount}`,
      ],
    },
    version: LOOP_A_SCHEMA_VERSION,
  };
}

function buildDFlowOutcomeMark(input: {
  marketId: string;
  slot: number;
  observedAt: string;
  account: DFlowPredictionMarketAccount;
  outcomeSide: "yes" | "no";
  outcomeMint: string | null;
  bid: number | null;
  ask: number | null;
}): Mark | null {
  const outcomeMint = asTrimmedString(input.outcomeMint);
  if (!outcomeMint) return null;
  const quote = predictionMidpoint({ bid: input.bid, ask: input.ask });
  if (!quote) return null;

  const positionAccount =
    asTrimmedString(input.account.accountId) ??
    asTrimmedString(input.account.ledgerMint);
  const settlementMint = resolveSettlementMint(
    "dflow",
    input.marketId,
    input.account.settlementMint,
  );
  const confidence = dflowConfidence({
    bid: input.bid,
    ask: input.ask,
    openInterest: input.account.openInterest,
  });

  return {
    schemaVersion: LOOP_A_SCHEMA_VERSION,
    generatedAt: input.observedAt,
    slot: Math.max(0, Math.floor(input.slot)),
    ts: input.observedAt,
    baseMint: outcomeMint,
    quoteMint: settlementMint,
    px: quote.px,
    ...(quote.bid ? { bid: quote.bid } : {}),
    ...(quote.ask ? { ask: quote.ask } : {}),
    confidence,
    venue: "dflow",
    ...(positiveDecimalString(input.account.openInterest, 2)
      ? {
          liquidityUsd: positiveDecimalString(input.account.openInterest, 2),
        }
      : {}),
    lineage: {
      protocol: "dflow",
      venue: "dflow",
      marketType: "prediction",
      market: input.marketId,
      ...(positionAccount ? { positionAccount } : {}),
      settlementMint,
    },
    evidence: {
      markets: [input.marketId],
      ...(positionAccount ? { positionAccounts: [positionAccount] } : {}),
      settlementMints: [settlementMint],
      inputs: [
        `loopA:v1:bridge:dflow:slot:${input.slot}:market:${input.marketId}:side:${input.outcomeSide}`,
      ],
    },
    version: LOOP_A_SCHEMA_VERSION,
  };
}

export function buildDFlowPredictionObservationMarks(input: {
  market: DFlowPredictionMarket;
  slot: number;
  observedAt: string;
}): Mark[] {
  const marketId = asTrimmedString(input.market.marketId);
  if (!marketId) return [];

  const marks: Mark[] = [];
  for (const account of input.market.accounts) {
    const yesMark = buildDFlowOutcomeMark({
      marketId,
      slot: input.slot,
      observedAt: input.observedAt,
      account,
      outcomeSide: "yes",
      outcomeMint: account.yesMint,
      bid: asFiniteNumber(account.yesBid),
      ask: asFiniteNumber(account.yesAsk),
    });
    if (yesMark) marks.push(yesMark);

    const noMark = buildDFlowOutcomeMark({
      marketId,
      slot: input.slot,
      observedAt: input.observedAt,
      account,
      outcomeSide: "no",
      outcomeMint: account.noMint,
      bid: asFiniteNumber(account.noBid),
      ask: asFiniteNumber(account.noAsk),
    });
    if (noMark) marks.push(noMark);
  }

  return marks.sort((a, b) => b.slot - a.slot);
}

function enabled(raw: string | undefined): boolean {
  return String(raw ?? "0").trim() === "1";
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function csvSet(raw: string | undefined): Set<string> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );
}

export async function collectLoopAVenueBridgeMarks(
  env: Env,
  input: {
    commitment: SlotCommitment;
    slot: number;
    observedAt?: string;
  },
): Promise<LoopAVenueBridgeTickResult> {
  const observedAt = input.observedAt ?? new Date().toISOString();
  if (!enabled(env.LOOP_A_VENUE_BRIDGE_ENABLED)) {
    return {
      commitment: input.commitment,
      slot: input.slot,
      observedAt,
      marks: [],
      observedVenues: [],
      parityStatuses: listLoopAVenueParityStatuses(),
    };
  }

  const marks: Mark[] = [];
  const observedVenues = new Set<string>();

  if (enabled(env.LOOP_A_VENUE_BRIDGE_DRIFT_ENABLED)) {
    const drift = new DriftClient(env);
    const allowedMarkets = csvSet(env.LOOP_A_VENUE_BRIDGE_DRIFT_MARKETS);
    const contracts = await drift.listContracts();
    for (const contract of contracts) {
      const marketName = asTrimmedString(contract.marketName)?.toUpperCase();
      if (!marketName) continue;
      if (allowedMarkets.size > 0 && !allowedMarkets.has(marketName)) continue;
      const funding =
        (await drift.getFundingRates(marketName).catch(() => []))[0] ?? null;
      const mark = buildDriftPerpObservationMark({
        contract,
        funding,
        slot: input.slot,
        observedAt,
      });
      if (!mark) continue;
      marks.push(mark);
      observedVenues.add("drift");
    }
  }

  if (enabled(env.LOOP_A_VENUE_BRIDGE_DFLOW_ENABLED)) {
    const dflow = new DFlowClient(env);
    const markets = await dflow.listPredictionMarkets({
      status: "active",
      limit: positiveInteger(
        env.LOOP_A_VENUE_BRIDGE_DFLOW_LIMIT,
        DEFAULT_DFLOW_BRIDGE_LIMIT,
      ),
    });
    for (const market of markets) {
      const nextMarks = buildDFlowPredictionObservationMarks({
        market,
        slot: input.slot,
        observedAt,
      });
      if (nextMarks.length < 1) continue;
      marks.push(...nextMarks);
      observedVenues.add("dflow");
    }
  }

  return {
    commitment: input.commitment,
    slot: input.slot,
    observedAt,
    marks,
    observedVenues: [...observedVenues].sort(),
    parityStatuses: listLoopAVenueParityStatuses(),
  };
}
