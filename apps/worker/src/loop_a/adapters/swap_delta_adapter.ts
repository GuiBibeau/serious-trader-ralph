import type { ProtocolEvent } from "../../../../../src/loops/contracts/loop_a";
import type {
  DecodingContext,
  ProtocolAdapter,
  TokenBalance,
} from "../decoder_registry";

type OwnerMintDelta = Map<string, bigint>;

type SwapPair = {
  inMint: string;
  inAmount: string;
  outMint: string;
  outAmount: string;
};

export type SwapDeltaAdapterConfig = {
  id: string;
  protocol: string;
  venue: string;
  programIds: string[];
};

function parseAtomicAmount(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function applyDelta(
  state: Map<string, OwnerMintDelta>,
  owner: string,
  mint: string,
  delta: bigint,
): void {
  const byMint = state.get(owner) ?? new Map<string, bigint>();
  byMint.set(mint, (byMint.get(mint) ?? 0n) + delta);
  state.set(owner, byMint);
}

function buildOwnerMintDeltas(
  context: DecodingContext,
): Map<string, OwnerMintDelta> {
  const state = new Map<string, OwnerMintDelta>();

  const applyBalances = (balances: TokenBalance[], sign: 1n | -1n) => {
    for (const balance of balances) {
      const owner = balance.owner ?? context.feePayer;
      if (!owner) continue;
      const amount = parseAtomicAmount(balance.amountAtomic);
      applyDelta(state, owner, balance.mint, amount * sign);
    }
  };

  applyBalances(context.tokenBalances.pre, -1n);
  applyBalances(context.tokenBalances.post, 1n);

  return state;
}

function hasSwapLikeDeltas(deltas: OwnerMintDelta): boolean {
  let hasIn = false;
  let hasOut = false;
  for (const delta of deltas.values()) {
    if (delta < 0n) hasIn = true;
    if (delta > 0n) hasOut = true;
    if (hasIn && hasOut) return true;
  }
  return false;
}

function chooseOwner(
  deltasByOwner: Map<string, OwnerMintDelta>,
  feePayer?: string,
): string | null {
  if (feePayer) {
    const payerDeltas = deltasByOwner.get(feePayer);
    if (payerDeltas && hasSwapLikeDeltas(payerDeltas)) {
      return feePayer;
    }
  }

  let bestOwner: string | null = null;
  let bestMagnitude = 0n;

  for (const [owner, deltas] of deltasByOwner.entries()) {
    let negativeMagnitude = 0n;
    let positiveMagnitude = 0n;

    for (const delta of deltas.values()) {
      if (delta < 0n) {
        const magnitude = delta * -1n;
        if (magnitude > negativeMagnitude) negativeMagnitude = magnitude;
      }
      if (delta > 0n && delta > positiveMagnitude) {
        positiveMagnitude = delta;
      }
    }

    if (negativeMagnitude > 0n && positiveMagnitude > 0n) {
      const magnitude = negativeMagnitude + positiveMagnitude;
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude;
        bestOwner = owner;
      }
    }
  }

  return bestOwner;
}

function chooseSwapPair(deltas: OwnerMintDelta): SwapPair | null {
  let inMint: string | null = null;
  let inDelta = 0n;
  let outMint: string | null = null;
  let outDelta = 0n;

  for (const [mint, delta] of deltas.entries()) {
    if (delta < inDelta) {
      inDelta = delta;
      inMint = mint;
    }
    if (delta > outDelta) {
      outDelta = delta;
      outMint = mint;
    }
  }

  if (!inMint || !outMint || inDelta >= 0n || outDelta <= 0n) {
    return null;
  }

  return {
    inMint,
    inAmount: (inDelta * -1n).toString(),
    outMint,
    outAmount: outDelta.toString(),
  };
}

function findProgramMatch(
  context: DecodingContext,
  programIds: string[],
): string | null {
  const idSet = new Set(programIds);
  for (const ix of context.instructions) {
    if (idSet.has(ix.programId)) return ix.programId;
  }
  for (const ix of context.innerInstructions) {
    if (idSet.has(ix.programId)) return ix.programId;
  }
  return null;
}

export function createSwapDeltaAdapter(
  config: SwapDeltaAdapterConfig,
): ProtocolAdapter {
  return {
    id: config.id,
    programIds: config.programIds,
    decode(context: DecodingContext): ProtocolEvent[] {
      const deltasByOwner = buildOwnerMintDeltas(context);
      const owner = chooseOwner(deltasByOwner, context.feePayer);
      if (!owner) return [];

      const ownerDeltas = deltasByOwner.get(owner);
      if (!ownerDeltas) return [];

      const swapPair = chooseSwapPair(ownerDeltas);
      if (!swapPair) return [];

      const matchedProgram = findProgramMatch(context, config.programIds);

      return [
        {
          schemaVersion: "v1",
          generatedAt: context.generatedAt,
          kind: "swap",
          protocol: config.protocol,
          slot: context.slot,
          sig: context.signature,
          ts: context.timestamp,
          user: owner,
          venue: config.venue,
          inMint: swapPair.inMint,
          outMint: swapPair.outMint,
          inAmount: swapPair.inAmount,
          outAmount: swapPair.outAmount,
          meta: {
            inferredFrom: "token_balance_deltas",
            sourceProgram: matchedProgram ?? undefined,
          },
        },
      ];
    },
  };
}
