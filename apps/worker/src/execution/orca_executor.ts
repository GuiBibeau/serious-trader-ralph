import { signTransactionWithPrivyById } from "../privy";
import { evaluateSafeLaneTransaction } from "./safe_lane_policy";
import type { ExecuteSwapInput, ExecuteSwapResult } from "./types";

type OrcaExecutorDeps = {
  signTransactionWithPrivyById?: typeof signTransactionWithPrivyById;
  evaluateSafeLaneTransaction?: typeof evaluateSafeLaneTransaction;
};

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

function readOrcaPoolAddress(input: ExecuteSwapInput): string | null {
  const pool = (input.quoteResponse as Record<string, unknown>)
    ?.orcaPoolSnapshot as Record<string, unknown> | null;
  const address = String(pool?.address ?? "").trim();
  return address || null;
}

export async function executeOrcaSwap(
  input: ExecuteSwapInput,
  deps: OrcaExecutorDeps = {},
): Promise<ExecuteSwapResult> {
  const route = "orca";
  const { policy, rpc, quoteResponse, log, guardEnabled } = input;
  const safeLane = isSafeLaneExecution(input);
  const preflightCommitment =
    policy.commitment === "finalized" ? "confirmed" : policy.commitment;

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

  if (!input.orca) {
    throw new Error("orca-client-missing");
  }
  if (!input.privyWalletId) {
    throw new Error("missing-privy-wallet-id");
  }

  if (guardEnabled) await guardEnabled();

  const txBuiltAt = nowIso();
  const built = await input.orca.buildSwapTransaction({
    quoteResponse: input.quoteResponse,
    walletPublicKey: input.userPublicKey,
  });
  const poolAddress = readOrcaPoolAddress(input);

  const signWithPrivy =
    deps.signTransactionWithPrivyById ?? signTransactionWithPrivyById;
  const signedBase64 = await signWithPrivy(
    input.env,
    input.privyWalletId,
    built.unsignedTransactionBase64,
  );

  const evaluateSafeLane =
    deps.evaluateSafeLaneTransaction ?? evaluateSafeLaneTransaction;
  if (safeLane) {
    const evaluation = evaluateSafeLane({
      env: input.env,
      signedTransactionBase64: signedBase64,
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
        lastValidBlockHeight: built.lastValidBlockHeight,
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
            fillState: "failed",
            settlementState: "failed",
            notes: [
              "orca-whirlpool",
              ...(poolAddress ? [`pool:${poolAddress}`] : []),
            ],
          },
          trace: {
            txBuiltAt,
            failedAt,
          },
        },
      };
    }
  }

  const requiresSimulation =
    safeLane ||
    policy.simulateOnly ||
    input.runtimeMode === "shadow" ||
    input.runtimeMode === "paper" ||
    readsTruthyExecutionParam(input.execution?.params?.requireSimulation);
  let simulatedAt: string | undefined;
  if (requiresSimulation) {
    const simulation = await rpc.simulateTransactionBase64(signedBase64, {
      commitment: preflightCommitment,
      sigVerify: true,
    });
    simulatedAt = nowIso();
    const ok = !simulation.err;
    log(ok ? "info" : "warn", "orca tx simulated", {
      ok,
      err: simulation.err ?? null,
      unitsConsumed: simulation.unitsConsumed ?? null,
      route,
      poolAddress,
    });
    if (!ok) {
      return {
        status: "simulate_error",
        signature: null,
        usedQuote: quoteResponse,
        refreshed: false,
        lastValidBlockHeight: built.lastValidBlockHeight,
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
            fillState: "failed",
            settlementState: "failed",
            notes: [
              "orca-whirlpool",
              `orca-additional-signers:${built.additionalSignerCount}`,
              ...(poolAddress ? [`pool:${poolAddress}`] : []),
            ],
          },
          trace: {
            txBuiltAt,
            simulatedAt,
            failedAt: simulatedAt,
          },
        },
      };
    }
  }

  if (
    policy.simulateOnly ||
    input.runtimeMode === "shadow" ||
    input.runtimeMode === "paper"
  ) {
    return {
      status: "simulated",
      signature: null,
      usedQuote: quoteResponse,
      refreshed: false,
      lastValidBlockHeight: built.lastValidBlockHeight,
      executionMeta: {
        route,
        classification: "simulated",
        lifecycle: {
          fillState: "pending",
          settlementState: "pending",
          notes: [
            "orca-whirlpool",
            `orca-additional-signers:${built.additionalSignerCount}`,
            ...(poolAddress ? [`pool:${poolAddress}`] : []),
          ],
        },
        trace: {
          txBuiltAt,
          ...(simulatedAt ? { simulatedAt } : {}),
        },
      },
    };
  }

  if (guardEnabled) await guardEnabled();

  const signature = await rpc.sendTransactionBase64(signedBase64, {
    skipPreflight: policy.skipPreflight,
    preflightCommitment,
  });
  const sentAt = nowIso();
  log("info", "orca tx submitted", {
    route,
    signature,
    poolAddress,
  });

  const confirmation = await rpc.confirmSignature(signature, {
    commitment: policy.commitment,
  });
  const confirmedAt = nowIso();
  log(confirmation.ok ? "info" : "warn", "orca tx confirmation", {
    route,
    signature,
    confirmationStatus: confirmation.status ?? null,
    err: confirmation.ok ? null : (confirmation.err ?? null),
    poolAddress,
  });

  const resultStatus = confirmation.ok
    ? normalizeConfirmationStatus(confirmation.status)
    : "error";

  return {
    status: resultStatus,
    signature,
    usedQuote: quoteResponse,
    refreshed: false,
    lastValidBlockHeight: built.lastValidBlockHeight,
    ...(confirmation.ok ? {} : { err: confirmation.err ?? null }),
    executionMeta: {
      route,
      classification:
        resultStatus === "finalized"
          ? "finalized"
          : resultStatus === "confirmed"
            ? "confirmed"
            : resultStatus === "processed"
              ? "submitted"
              : "error",
      lifecycle: {
        fillState: resultStatus === "error" ? "failed" : "filled",
        settlementState:
          resultStatus === "finalized"
            ? "finalized"
            : resultStatus === "error"
              ? "failed"
              : "confirmed",
        notes: [
          "orca-whirlpool",
          `orca-additional-signers:${built.additionalSignerCount}`,
          ...(poolAddress ? [`pool:${poolAddress}`] : []),
        ],
      },
      trace: {
        txBuiltAt,
        ...(simulatedAt ? { simulatedAt } : {}),
        sentAt,
        confirmedAt,
        ...(resultStatus === "finalized"
          ? { finalizedAt: confirmedAt }
          : resultStatus === "error"
            ? { failedAt: confirmedAt }
            : {}),
      },
    },
  };
}
