import { PublicKey } from "@solana/web3.js";
import { SOL_MINT } from "../defaults";
import { signTransactionWithPrivyById } from "../privy";
import type { RaydiumApiEnvelope, RaydiumQuoteResponse } from "../raydium";
import { evaluateSafeLaneTransaction } from "./safe_lane_policy";
import type { ExecuteSwapInput, ExecuteSwapResult } from "./types";

type RaydiumExecutorDeps = {
  signTransactionWithPrivyById?: typeof signTransactionWithPrivyById;
  evaluateSafeLaneTransaction?: typeof evaluateSafeLaneTransaction;
};

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

function nowIso(): string {
  return new Date().toISOString();
}

function isSafeLaneExecution(input: ExecuteSwapInput): boolean {
  const lane = String(input.execution?.params?.lane ?? "")
    .trim()
    .toLowerCase();
  return lane === "safe";
}

function readsTruthyExecutionParam(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

function readPriorityMicroLamports(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.round(value));
  }
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function normalizeConfirmationStatus(
  status: string | undefined,
): Extract<
  ExecuteSwapResult["status"],
  "processed" | "confirmed" | "finalized" | "error"
> {
  if (
    status === "processed" ||
    status === "confirmed" ||
    status === "finalized"
  ) {
    return status;
  }
  return "error";
}

function readRaydiumQuoteEnvelope(
  input: ExecuteSwapInput,
): RaydiumApiEnvelope<RaydiumQuoteResponse> {
  const envelope = (input.quoteResponse as Record<string, unknown>)
    ?.raydiumQuoteEnvelope;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("raydium-quote-envelope-missing");
  }
  return envelope as RaydiumApiEnvelope<RaydiumQuoteResponse>;
}

function maybeDeriveAssociatedTokenAccount(input: {
  wallet: string;
  mint: string;
}): string | undefined {
  try {
    const wallet = new PublicKey(input.wallet);
    const mint = new PublicKey(input.mint);
    const [ata] = PublicKey.findProgramAddressSync(
      [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    return ata.toBase58();
  } catch {
    return undefined;
  }
}

export async function executeRaydiumSwap(
  input: ExecuteSwapInput,
  deps: RaydiumExecutorDeps = {},
): Promise<ExecuteSwapResult> {
  const route = "raydium";
  const { policy, rpc, quoteResponse, log, guardEnabled } = input;
  const safeLane = isSafeLaneExecution(input);

  if (policy.dryRun) {
    return {
      status: "dry_run",
      signature: null,
      usedQuote: quoteResponse,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route,
        classification: "dry_run",
      },
    };
  }

  if (!input.raydium) {
    throw new Error("raydium-client-missing");
  }
  if (!input.privyWalletId) {
    throw new Error("missing-privy-wallet-id");
  }

  if (guardEnabled) await guardEnabled();

  const buildStartedAt = nowIso();
  const quoteEnvelope = readRaydiumQuoteEnvelope(input);
  const computeUnitPriceMicroLamports = readPriorityMicroLamports(
    input.execution?.params?.priorityMicroLamports,
  );
  const { transactions } = await input.raydium.buildSwapTransactions({
    quoteEnvelope,
    wallet: input.userPublicKey,
    wrapSol: input.quoteResponse.inputMint === SOL_MINT,
    unwrapSol: input.quoteResponse.outputMint === SOL_MINT,
    ...(input.quoteResponse.inputMint !== SOL_MINT
      ? {
          inputAccount: maybeDeriveAssociatedTokenAccount({
            wallet: input.userPublicKey,
            mint: input.quoteResponse.inputMint,
          }),
        }
      : {}),
    ...(input.quoteResponse.outputMint !== SOL_MINT
      ? {
          outputAccount: maybeDeriveAssociatedTokenAccount({
            wallet: input.userPublicKey,
            mint: input.quoteResponse.outputMint,
          }),
        }
      : {}),
    computeUnitPriceMicroLamports,
    txVersion: "V0",
  });

  const signWithPrivy =
    deps.signTransactionWithPrivyById ?? signTransactionWithPrivyById;
  const signedTransactions: string[] = [];
  for (const transaction of transactions) {
    signedTransactions.push(
      await signWithPrivy(input.env, input.privyWalletId, transaction),
    );
  }

  const evaluateSafeLane =
    deps.evaluateSafeLaneTransaction ?? evaluateSafeLaneTransaction;
  if (safeLane) {
    for (const signedTransaction of signedTransactions) {
      const evaluation = evaluateSafeLane({
        env: input.env,
        signedTransactionBase64: signedTransaction,
      });
      log(evaluation.ok ? "info" : "warn", "safe lane tx guardrails", {
        ok: evaluation.ok,
        reason: evaluation.ok ? null : evaluation.reason,
        profile: evaluation.profile,
        limits: evaluation.limits,
        route,
      });
      if (!evaluation.ok) {
        const failedAt = nowIso();
        return {
          status: "simulate_error",
          signature: null,
          usedQuote: quoteResponse,
          refreshed: false,
          lastValidBlockHeight: null,
          err: {
            code: "policy-denied",
            reason: evaluation.reason,
            profile: evaluation.profile,
            limits: evaluation.limits,
          },
          executionMeta: {
            route,
            classification: "error",
            lifecycle: {
              notes: [
                `raydium-transactions:${signedTransactions.length}`,
                "safe-lane-denied",
              ],
            },
            trace: {
              txBuiltAt: buildStartedAt,
              failedAt,
            },
          },
        };
      }
    }
  }

  const requiresSimulation =
    safeLane ||
    policy.simulateOnly ||
    readsTruthyExecutionParam(input.execution?.params?.requireSimulation);
  let simulatedAt: string | undefined;
  if (requiresSimulation) {
    for (const signedTransaction of signedTransactions) {
      const simulation = await rpc.simulateTransactionBase64(
        signedTransaction,
        {
          commitment: policy.commitment,
          sigVerify: true,
        },
      );
      simulatedAt = nowIso();
      const ok = !simulation.err;
      log(ok ? "info" : "warn", "raydium tx simulated", {
        ok,
        err: simulation.err ?? null,
        unitsConsumed: simulation.unitsConsumed ?? null,
        route,
      });
      if (!ok) {
        return {
          status: "simulate_error",
          signature: null,
          usedQuote: quoteResponse,
          refreshed: false,
          lastValidBlockHeight: null,
          err: safeLane
            ? {
                code: "policy-denied",
                reason: "safe-lane-simulation-failed",
                simulationError: simulation.err ?? null,
              }
            : (simulation.err ?? null),
          executionMeta: {
            route,
            classification: "error",
            lifecycle: {
              notes: [`raydium-transactions:${signedTransactions.length}`],
            },
            trace: {
              txBuiltAt: buildStartedAt,
              simulatedAt,
              failedAt: simulatedAt,
            },
          },
        };
      }
    }
  }

  if (policy.simulateOnly) {
    return {
      status: "simulated",
      signature: null,
      usedQuote: quoteResponse,
      refreshed: false,
      lastValidBlockHeight: null,
      executionMeta: {
        route,
        classification: "simulated",
        lifecycle: {
          notes: [`raydium-transactions:${signedTransactions.length}`],
        },
        trace: {
          txBuiltAt: buildStartedAt,
          ...(simulatedAt ? { simulatedAt } : {}),
        },
      },
    };
  }

  if (guardEnabled) await guardEnabled();

  const signatures: string[] = [];
  let sentAt: string | undefined;
  let confirmedAt: string | undefined;
  let finalStatus: ExecuteSwapResult["status"] = "error";
  let finalError: unknown = null;
  for (const signedTransaction of signedTransactions) {
    const signature = await rpc.sendTransactionBase64(signedTransaction, {
      skipPreflight: policy.skipPreflight,
      preflightCommitment: policy.commitment,
    });
    signatures.push(signature);
    sentAt = nowIso();
    log("info", "raydium tx submitted", {
      route,
      signature,
      sequence: signatures.length,
      total: signedTransactions.length,
    });

    const confirmation = await rpc.confirmSignature(signature, {
      commitment: policy.commitment,
    });
    confirmedAt = nowIso();
    finalStatus = confirmation.ok
      ? normalizeConfirmationStatus(confirmation.status)
      : "error";
    finalError = confirmation.err ?? null;
    log(confirmation.ok ? "info" : "warn", "raydium tx confirmation", {
      route,
      signature,
      status: finalStatus,
      err: confirmation.err ?? null,
      sequence: signatures.length,
      total: signedTransactions.length,
    });
    if (finalStatus === "error") {
      break;
    }
  }

  return {
    status: finalStatus,
    signature: signatures.length > 0 ? signatures[signatures.length - 1] : null,
    usedQuote: quoteResponse,
    refreshed: false,
    lastValidBlockHeight: null,
    err: finalError,
    executionMeta: {
      route,
      classification:
        finalStatus === "processed"
          ? "landed"
          : finalStatus === "confirmed"
            ? "confirmed"
            : finalStatus === "finalized"
              ? "finalized"
              : "error",
      ...(signatures.length > 1
        ? {
            settlementRef: signatures.join(","),
          }
        : {}),
      lifecycle: {
        notes: [`raydium-transactions:${signedTransactions.length}`],
      },
      trace: {
        txBuiltAt: buildStartedAt,
        ...(simulatedAt ? { simulatedAt } : {}),
        ...(sentAt ? { sentAt } : {}),
        ...(finalStatus === "processed" && confirmedAt
          ? { landedAt: confirmedAt }
          : {}),
        ...(finalStatus === "confirmed" && confirmedAt
          ? {
              landedAt: confirmedAt,
              confirmedAt,
            }
          : {}),
        ...(finalStatus === "finalized" && confirmedAt
          ? {
              landedAt: confirmedAt,
              confirmedAt,
              finalizedAt: confirmedAt,
            }
          : {}),
        ...(finalStatus === "error" && confirmedAt
          ? { failedAt: confirmedAt }
          : {}),
      },
    },
  };
}
