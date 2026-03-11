export type RuntimeDeploymentRecord = {
  schemaVersion?: string;
  deploymentId: string;
  strategyKey: string;
  sleeveId: string;
  ownerUserId: string;
  venueKey: string;
  pair: {
    symbol: string;
    baseMint: string;
    quoteMint: string;
  };
  mode: string;
  state: string;
  lane: string;
  createdAt: string;
  updatedAt: string;
  promotedAt?: string;
  pausedAt?: string;
  killedAt?: string;
  policy: {
    maxNotionalUsd: string;
    dailyLossLimitUsd: string;
    maxSlippageBps: number;
    maxConcurrentRuns: number;
    rebalanceToleranceBps: number;
  };
  capital: {
    allocatedUsd: string;
    reservedUsd: string;
    availableUsd: string;
  };
  tags: readonly string[];
};

export type RuntimeRunRecord = {
  schemaVersion?: string;
  runId: string;
  deploymentId: string;
  runKey: string;
  trigger: {
    kind: string;
    source: string;
    observedAt?: string;
    featureSnapshotId?: string;
    reason?: string;
  };
  state: string;
  plannedAt: string;
  updatedAt: string;
  riskVerdictId?: string;
  executionPlanId?: string;
  submitRequestId?: string;
  receiptId?: string;
  failureCode?: string;
  failureMessage?: string;
};

export type RuntimeLedgerSnapshot = {
  schemaVersion?: string;
  snapshotId: string;
  deploymentId: string;
  sleeveId: string;
  asOf: string;
  balances: ReadonlyArray<{
    mint: string;
    symbol: string;
    decimals: number;
    freeAtomic: string;
    reservedAtomic: string;
    priceUsd?: string;
  }>;
  positions: ReadonlyArray<{
    instrumentId: string;
    side: string;
    quantityAtomic: string;
    entryPriceUsd?: string;
    markPriceUsd?: string;
    unrealizedPnlUsd?: string;
  }>;
  totals: {
    equityUsd: string;
    reservedUsd: string;
    availableUsd: string;
    realizedPnlUsd: string;
    unrealizedPnlUsd: string;
  };
};

type ParseSuccess<T> = {
  success: true;
  data: T;
};

type ParseFailure = {
  success: false;
  error: string;
};

type ParseResult<T> = ParseSuccess<T> | ParseFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readOptionalString(value: unknown): string | undefined {
  return readString(value) ?? undefined;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => Boolean(readString(entry)));
}

function fail<T>(error: string): ParseResult<T> {
  return { success: false, error };
}

export function safeParseRuntimeDeploymentRecord(
  value: unknown,
): ParseResult<RuntimeDeploymentRecord> {
  if (!isRecord(value)) return fail("deployment-not-object");
  const pair = isRecord(value.pair) ? value.pair : null;
  const policy = isRecord(value.policy) ? value.policy : null;
  const capital = isRecord(value.capital) ? value.capital : null;
  if (!pair || !policy || !capital) return fail("deployment-missing-nested");
  const deploymentId = readString(value.deploymentId);
  const strategyKey = readString(value.strategyKey);
  const sleeveId = readString(value.sleeveId);
  const ownerUserId = readString(value.ownerUserId);
  const venueKey = readString(value.venueKey) ?? "jupiter";
  const symbol = readString(pair.symbol);
  const baseMint = readString(pair.baseMint);
  const quoteMint = readString(pair.quoteMint);
  const mode = readString(value.mode);
  const state = readString(value.state);
  const lane = readString(value.lane);
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);
  const maxNotionalUsd = readString(policy.maxNotionalUsd);
  const dailyLossLimitUsd = readString(policy.dailyLossLimitUsd);
  const maxSlippageBps = readNumber(policy.maxSlippageBps);
  const maxConcurrentRuns = readNumber(policy.maxConcurrentRuns);
  const rebalanceToleranceBps = readNumber(policy.rebalanceToleranceBps);
  const allocatedUsd = readString(capital.allocatedUsd);
  const reservedUsd = readString(capital.reservedUsd);
  const availableUsd = readString(capital.availableUsd);
  if (
    !deploymentId ||
    !strategyKey ||
    !sleeveId ||
    !ownerUserId ||
    !venueKey ||
    !symbol ||
    !baseMint ||
    !quoteMint ||
    !mode ||
    !state ||
    !lane ||
    !createdAt ||
    !updatedAt ||
    !maxNotionalUsd ||
    !dailyLossLimitUsd ||
    maxSlippageBps === null ||
    maxConcurrentRuns === null ||
    rebalanceToleranceBps === null ||
    !allocatedUsd ||
    !reservedUsd ||
    !availableUsd
  ) {
    return fail("deployment-invalid");
  }

  return {
    success: true,
    data: {
      deploymentId,
      schemaVersion: readOptionalString(value.schemaVersion),
      strategyKey,
      sleeveId,
      ownerUserId,
      venueKey,
      pair: {
        symbol,
        baseMint,
        quoteMint,
      },
      mode,
      state,
      lane,
      createdAt,
      updatedAt,
      promotedAt: readOptionalString(value.promotedAt),
      pausedAt: readOptionalString(value.pausedAt),
      killedAt: readOptionalString(value.killedAt),
      policy: {
        maxNotionalUsd,
        dailyLossLimitUsd,
        maxSlippageBps,
        maxConcurrentRuns,
        rebalanceToleranceBps,
      },
      capital: {
        allocatedUsd,
        reservedUsd,
        availableUsd,
      },
      tags: readStringArray(value.tags),
    },
  };
}

export function safeParseRuntimeRunRecord(
  value: unknown,
): ParseResult<RuntimeRunRecord> {
  if (!isRecord(value)) return fail("run-not-object");
  const trigger = isRecord(value.trigger) ? value.trigger : null;
  if (!trigger) return fail("run-trigger-missing");
  const runId = readString(value.runId);
  const deploymentId = readString(value.deploymentId);
  const runKey = readString(value.runKey);
  const kind = readString(trigger.kind);
  const source = readString(trigger.source);
  const state = readString(value.state);
  const plannedAt = readString(value.plannedAt);
  const updatedAt = readString(value.updatedAt);
  if (
    !runId ||
    !deploymentId ||
    !runKey ||
    !kind ||
    !source ||
    !state ||
    !plannedAt ||
    !updatedAt
  ) {
    return fail("run-invalid");
  }

  return {
    success: true,
    data: {
      runId,
      schemaVersion: readOptionalString(value.schemaVersion),
      deploymentId,
      runKey,
      trigger: {
        kind,
        source,
        observedAt: readOptionalString(trigger.observedAt),
        featureSnapshotId: readOptionalString(trigger.featureSnapshotId),
        reason: readOptionalString(trigger.reason),
      },
      state,
      plannedAt,
      updatedAt,
      riskVerdictId: readOptionalString(value.riskVerdictId),
      executionPlanId: readOptionalString(value.executionPlanId),
      submitRequestId: readOptionalString(value.submitRequestId),
      receiptId: readOptionalString(value.receiptId),
      failureCode: readOptionalString(value.failureCode),
      failureMessage: readOptionalString(value.failureMessage),
    },
  };
}

export function safeParseRuntimeLedgerSnapshot(
  value: unknown,
): ParseResult<RuntimeLedgerSnapshot> {
  if (!isRecord(value)) return fail("snapshot-not-object");
  const totals = isRecord(value.totals) ? value.totals : null;
  if (!totals) return fail("snapshot-totals-missing");
  const snapshotId = readString(value.snapshotId);
  const deploymentId = readString(value.deploymentId);
  const sleeveId = readString(value.sleeveId);
  const asOf = readString(value.asOf);
  const equityUsd = readString(totals.equityUsd);
  const reservedUsd = readString(totals.reservedUsd);
  const availableUsd = readString(totals.availableUsd);
  const realizedPnlUsd = readString(totals.realizedPnlUsd);
  const unrealizedPnlUsd = readString(totals.unrealizedPnlUsd);
  if (
    !snapshotId ||
    !deploymentId ||
    !sleeveId ||
    !asOf ||
    !equityUsd ||
    !reservedUsd ||
    !availableUsd ||
    !realizedPnlUsd ||
    !unrealizedPnlUsd
  ) {
    return fail("snapshot-invalid");
  }

  const balances = Array.isArray(value.balances)
    ? value.balances.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const mint = readString(entry.mint);
        const symbol = readString(entry.symbol);
        const decimals = readNumber(entry.decimals);
        const freeAtomic = readString(entry.freeAtomic);
        const reservedAtomic = readString(entry.reservedAtomic);
        if (
          !mint ||
          !symbol ||
          decimals === null ||
          !freeAtomic ||
          !reservedAtomic
        ) {
          return [];
        }
        return [
          {
            mint,
            symbol,
            decimals,
            freeAtomic,
            reservedAtomic,
            priceUsd: readOptionalString(entry.priceUsd),
          },
        ];
      })
    : [];

  const positions = Array.isArray(value.positions)
    ? value.positions.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const instrumentId = readString(entry.instrumentId);
        const side = readString(entry.side);
        const quantityAtomic = readString(entry.quantityAtomic);
        if (!instrumentId || !side || !quantityAtomic) return [];
        return [
          {
            instrumentId,
            side,
            quantityAtomic,
            entryPriceUsd: readOptionalString(entry.entryPriceUsd),
            markPriceUsd: readOptionalString(entry.markPriceUsd),
            unrealizedPnlUsd: readOptionalString(entry.unrealizedPnlUsd),
          },
        ];
      })
    : [];

  return {
    success: true,
    data: {
      snapshotId,
      schemaVersion: readOptionalString(value.schemaVersion),
      deploymentId,
      sleeveId,
      asOf,
      balances,
      positions,
      totals: {
        equityUsd,
        reservedUsd,
        availableUsd,
        realizedPnlUsd,
        unrealizedPnlUsd,
      },
    },
  };
}
