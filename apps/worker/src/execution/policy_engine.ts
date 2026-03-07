import { SOL_MINT } from "../defaults";
import type { Env } from "../types";
import {
  type ParsedRelayTransaction,
  validateRelaySignedSubmission,
} from "./relay_signed_validator";
import type {
  ExecutionActorType,
  ExecutionLane,
  ExecutionMode,
  JsonObject,
} from "./repository";
import type { ExecSubmitRequestV1 } from "./submit_contract";

type PolicyEnvironment = "dev" | "production";
type PolicyCheckStatus = "pass" | "fail" | "skip";

type PolicyCheck = {
  id: string;
  status: PolicyCheckStatus;
  reason: string | null;
  details: JsonObject | null;
};

export type SubmitPolicyDecision = {
  policyVersion: "x402-021-v1";
  environment: PolicyEnvironment;
  mode: ExecutionMode;
  lane: ExecutionLane;
  actorType: ExecutionActorType;
  outcome: "allow" | "deny";
  reason: string | null;
  checks: PolicyCheck[];
  defaults: JsonObject;
};

export type SubmitPolicyRuntime = {
  requireSimulation: boolean;
  maxNotionalAtomic: string;
  enforceBalanceChecks: boolean;
};

export type SubmitPolicyEvaluationResult =
  | {
      ok: true;
      decision: SubmitPolicyDecision;
      metadata: JsonObject;
      relayParsed?: ParsedRelayTransaction;
      runtime?: SubmitPolicyRuntime;
    }
  | {
      ok: false;
      error: "policy-denied" | "invalid-transaction";
      reason: string;
      status: number;
      decision: SubmitPolicyDecision;
      metadata: JsonObject;
    };

type PrivyRuntimePolicyRpc = {
  getBalanceLamports(walletAddress: string): Promise<bigint>;
  getTokenBalanceAtomic(walletAddress: string, mint: string): Promise<bigint>;
};

export type PrivyRuntimePolicyDecision = {
  policyVersion: "x402-021-v1";
  environment: PolicyEnvironment;
  mode: "privy_execute";
  lane: ExecutionLane;
  checks: PolicyCheck[];
  defaults: JsonObject;
};

export type PrivyRuntimePolicyResult =
  | {
      ok: true;
      decision: PrivyRuntimePolicyDecision;
      metadata: JsonObject;
    }
  | {
      ok: false;
      reason: string;
      decision: PrivyRuntimePolicyDecision;
      metadata: JsonObject;
    };

function parseCsvSet(raw: unknown): Set<string> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  return fallback;
}

function normalizeAtomicLimit(raw: unknown, fallback: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return fallback;
  if (!/^[0-9]+$/.test(value)) return fallback;
  const normalized = value.replace(/^0+(?=\d)/, "");
  return normalized || "0";
}

function check(
  id: string,
  status: PolicyCheckStatus,
  reason: string | null,
  details: JsonObject | null = null,
): PolicyCheck {
  return {
    id,
    status,
    reason,
    details,
  };
}

function toMetadata(decision: SubmitPolicyDecision): JsonObject {
  return {
    policyVersion: decision.policyVersion,
    environment: decision.environment,
    mode: decision.mode,
    lane: decision.lane,
    actorType: decision.actorType,
    outcome: decision.outcome,
    reason: decision.reason,
    defaults: decision.defaults,
    checks: decision.checks.map((entry) => ({
      id: entry.id,
      status: entry.status,
      reason: entry.reason,
      details: entry.details,
    })),
  };
}

function toRuntimeMetadata(decision: PrivyRuntimePolicyDecision): JsonObject {
  return {
    policyVersion: decision.policyVersion,
    environment: decision.environment,
    mode: decision.mode,
    lane: decision.lane,
    defaults: decision.defaults,
    checks: decision.checks.map((entry) => ({
      id: entry.id,
      status: entry.status,
      reason: entry.reason,
      details: entry.details,
    })),
  };
}

function resolvePolicyEnvironment(env: Env): PolicyEnvironment {
  const explicit = String(env.EXEC_POLICY_ENV ?? "")
    .trim()
    .toLowerCase();
  if (explicit === "dev") return "dev";
  if (explicit === "production") return "production";
  const network = String(env.X402_NETWORK ?? "")
    .trim()
    .toLowerCase();
  if (network.includes("devnet")) return "dev";
  return "production";
}

function readProfiledPolicyValue(
  env: Env,
  environment: PolicyEnvironment,
  keySuffix: string,
): string {
  const envRecord = env as Record<string, unknown>;
  const envPrefix = environment.toUpperCase();
  const envKey = `EXEC_POLICY_${envPrefix}_${keySuffix}`;
  const globalKey = `EXEC_POLICY_${keySuffix}`;
  const envValue = String(envRecord[envKey] ?? "").trim();
  if (envValue) return envValue;
  return String(envRecord[globalKey] ?? "").trim();
}

type ResolvedPrivyPolicyDefaults = {
  environment: PolicyEnvironment;
  walletAllowlist: Set<string>;
  walletDenylist: Set<string>;
  maxNotionalAtomic: string;
  requireSimulation: boolean;
  enforceBalanceChecks: boolean;
};

function resolvePrivyPolicyDefaults(input: {
  env: Env;
  lane: ExecutionLane;
}): ResolvedPrivyPolicyDefaults {
  const environment = resolvePolicyEnvironment(input.env);
  const laneSuffix = input.lane.toUpperCase();

  const walletAllowlist = parseCsvSet(
    readProfiledPolicyValue(input.env, environment, "PRIVY_WALLET_ALLOWLIST"),
  );
  const walletDenylist = parseCsvSet(
    readProfiledPolicyValue(input.env, environment, "PRIVY_WALLET_DENYLIST"),
  );

  const laneMaxNotional = readProfiledPolicyValue(
    input.env,
    environment,
    `PRIVY_MAX_NOTIONAL_${laneSuffix}_ATOMIC`,
  );
  const maxNotionalRaw =
    laneMaxNotional ||
    readProfiledPolicyValue(
      input.env,
      environment,
      "PRIVY_MAX_NOTIONAL_ATOMIC",
    );
  const maxNotionalAtomic = normalizeAtomicLimit(maxNotionalRaw, "0");

  const laneRequireSimulationRaw = readProfiledPolicyValue(
    input.env,
    environment,
    `PRIVY_REQUIRE_SIMULATION_${laneSuffix}`,
  );
  const requireSimulationRaw =
    laneRequireSimulationRaw ||
    readProfiledPolicyValue(input.env, environment, "PRIVY_REQUIRE_SIMULATION");
  const requireSimulation = requireSimulationRaw
    ? readBoolean(requireSimulationRaw, input.lane === "safe")
    : input.lane === "safe";

  const enforceBalanceChecksRaw = readProfiledPolicyValue(
    input.env,
    environment,
    "PRIVY_ENFORCE_BALANCE_CHECKS",
  );
  const enforceBalanceChecks = enforceBalanceChecksRaw
    ? readBoolean(enforceBalanceChecksRaw, true)
    : true;

  return {
    environment,
    walletAllowlist,
    walletDenylist,
    maxNotionalAtomic,
    requireSimulation,
    enforceBalanceChecks,
  };
}

function evaluateRelayPolicy(input: {
  env: Env;
  request: ExecSubmitRequestV1;
  lane: ExecutionLane;
  actorType: ExecutionActorType;
}): Promise<SubmitPolicyEvaluationResult> {
  const relayPayload = input.request.relaySigned;
  if (!relayPayload) {
    const environment = resolvePolicyEnvironment(input.env);
    const decision: SubmitPolicyDecision = {
      policyVersion: "x402-021-v1",
      environment,
      mode: "relay_signed",
      lane: input.lane,
      actorType: input.actorType,
      outcome: "deny",
      reason: "relay-payload-missing",
      checks: [
        check("relay-signed-validation", "fail", "relay-payload-missing", null),
      ],
      defaults: {
        blockhashValidationEnabled: readBoolean(
          input.env.EXEC_RELAY_VALIDATE_BLOCKHASH,
          true,
        ),
      },
    };
    return Promise.resolve({
      ok: false,
      error: "invalid-transaction",
      reason: "relay-payload-missing",
      status: 400,
      metadata: toMetadata(decision),
      decision,
    });
  }
  return validateRelaySignedSubmission(input.env, relayPayload)
    .then((relayValidation) => {
      const environment = resolvePolicyEnvironment(input.env);
      const defaults: JsonObject = {
        blockhashValidationEnabled: readBoolean(
          input.env.EXEC_RELAY_VALIDATE_BLOCKHASH,
          true,
        ),
        blockhashCommitment: String(
          input.env.EXEC_RELAY_BLOCKHASH_COMMITMENT ?? "confirmed",
        )
          .trim()
          .toLowerCase(),
        allowlistConfigured:
          parseCsvSet(input.env.EXEC_RELAY_PROGRAM_ALLOWLIST).size > 0,
        denylistConfigured:
          parseCsvSet(input.env.EXEC_RELAY_PROGRAM_DENYLIST).size > 0,
      };

      if (!relayValidation.ok) {
        const decision: SubmitPolicyDecision = {
          policyVersion: "x402-021-v1",
          environment,
          mode: "relay_signed",
          lane: input.lane,
          actorType: input.actorType,
          outcome: "deny",
          reason: relayValidation.reason,
          checks: [
            check(
              "relay-signed-validation",
              "fail",
              relayValidation.reason,
              null,
            ),
          ],
          defaults,
        };
        return {
          ok: false as const,
          error: relayValidation.error,
          reason: relayValidation.reason,
          status: relayValidation.error === "policy-denied" ? 403 : 400,
          metadata: toMetadata(decision),
          decision,
        };
      }

      const decision: SubmitPolicyDecision = {
        policyVersion: "x402-021-v1",
        environment,
        mode: "relay_signed",
        lane: input.lane,
        actorType: input.actorType,
        outcome: "allow",
        reason: null,
        checks: [
          check("relay-signed-validation", "pass", null, {
            transactionVersion: relayValidation.parsed.transactionVersion,
            signatureCount: relayValidation.parsed.signatureCount,
            txSizeBytes: relayValidation.parsed.txSizeBytes,
          }),
        ],
        defaults,
      };
      return {
        ok: true as const,
        decision,
        metadata: toMetadata(decision),
        relayParsed: relayValidation.parsed,
      };
    })
    .catch(() => {
      const environment = resolvePolicyEnvironment(input.env);
      const decision: SubmitPolicyDecision = {
        policyVersion: "x402-021-v1",
        environment,
        mode: "relay_signed",
        lane: input.lane,
        actorType: input.actorType,
        outcome: "deny",
        reason: "relay-validation-failed",
        checks: [
          check(
            "relay-signed-validation",
            "fail",
            "relay-validation-failed",
            null,
          ),
        ],
        defaults: {
          blockhashValidationEnabled: readBoolean(
            input.env.EXEC_RELAY_VALIDATE_BLOCKHASH,
            true,
          ),
        },
      };
      return {
        ok: false as const,
        error: "invalid-transaction" as const,
        reason: "relay-validation-failed",
        status: 400,
        metadata: toMetadata(decision),
        decision,
      };
    });
}

function evaluatePrivyPolicy(input: {
  env: Env;
  request: ExecSubmitRequestV1;
  lane: ExecutionLane;
  actorType: ExecutionActorType;
}): SubmitPolicyEvaluationResult {
  const defaults = resolvePrivyPolicyDefaults({
    env: input.env,
    lane: input.lane,
  });

  const checks: PolicyCheck[] = [];
  let denyReason: string | null = null;
  const wallet = input.request.privyExecute?.wallet ?? "";

  if (input.actorType === "anonymous_x402") {
    denyReason = "privy-mode-requires-identified-actor";
    checks.push(
      check("privy-actor-identity", "fail", denyReason, {
        actorType: input.actorType,
      }),
    );
  } else {
    checks.push(
      check("privy-actor-identity", "pass", null, {
        actorType: input.actorType,
      }),
    );
  }

  if (!denyReason && defaults.walletDenylist.has(wallet)) {
    denyReason = "privy-wallet-denylisted";
    checks.push(check("privy-wallet-denylist", "fail", denyReason, null));
  } else {
    checks.push(
      check(
        "privy-wallet-denylist",
        defaults.walletDenylist.size > 0 ? "pass" : "skip",
        null,
        defaults.walletDenylist.size > 0
          ? {
              denylistEnabled: true,
            }
          : null,
      ),
    );
  }

  if (!denyReason && defaults.walletAllowlist.size > 0) {
    if (!defaults.walletAllowlist.has(wallet)) {
      denyReason = "privy-wallet-not-allowlisted";
      checks.push(check("privy-wallet-allowlist", "fail", denyReason, null));
    } else {
      checks.push(check("privy-wallet-allowlist", "pass", null, null));
    }
  } else {
    checks.push(
      check(
        "privy-wallet-allowlist",
        defaults.walletAllowlist.size > 0 ? "pass" : "skip",
        null,
        defaults.walletAllowlist.size > 0
          ? {
              allowlistEnabled: true,
            }
          : null,
      ),
    );
  }

  const amountAtomic = BigInt(
    input.request.privyExecute?.swap.amountAtomic ?? "0",
  );
  const maxNotionalAtomic = BigInt(defaults.maxNotionalAtomic);
  if (
    !denyReason &&
    maxNotionalAtomic > 0n &&
    amountAtomic > maxNotionalAtomic
  ) {
    denyReason = "privy-spend-cap-exceeded";
    checks.push(
      check("privy-spend-cap", "fail", denyReason, {
        amountAtomic: amountAtomic.toString(),
        maxNotionalAtomic: maxNotionalAtomic.toString(),
      }),
    );
  } else {
    checks.push(
      check("privy-spend-cap", maxNotionalAtomic > 0n ? "pass" : "skip", null, {
        amountAtomic: amountAtomic.toString(),
        maxNotionalAtomic: maxNotionalAtomic.toString(),
      }),
    );
  }

  checks.push(
    check("privy-simulation-policy", "pass", null, {
      requireSimulation: defaults.requireSimulation,
      lane: input.lane,
    }),
  );

  const defaultsSnapshot: JsonObject = {
    requireSimulation: defaults.requireSimulation,
    maxNotionalAtomic: defaults.maxNotionalAtomic,
    enforceBalanceChecks: defaults.enforceBalanceChecks,
    walletAllowlistCount: defaults.walletAllowlist.size,
    walletDenylistCount: defaults.walletDenylist.size,
  };

  const decision: SubmitPolicyDecision = {
    policyVersion: "x402-021-v1",
    environment: defaults.environment,
    mode: "privy_execute",
    lane: input.lane,
    actorType: input.actorType,
    outcome: denyReason ? "deny" : "allow",
    reason: denyReason,
    checks,
    defaults: defaultsSnapshot,
  };

  if (denyReason) {
    return {
      ok: false,
      error: "policy-denied",
      reason: denyReason,
      status: 403,
      decision,
      metadata: toMetadata(decision),
    };
  }

  return {
    ok: true,
    decision,
    metadata: toMetadata(decision),
    runtime: {
      requireSimulation: defaults.requireSimulation,
      maxNotionalAtomic: defaults.maxNotionalAtomic,
      enforceBalanceChecks: defaults.enforceBalanceChecks,
    },
  };
}

export async function evaluateExecutionSubmitPolicy(input: {
  env: Env;
  request: ExecSubmitRequestV1;
  lane: ExecutionLane;
  actorType: ExecutionActorType;
}): Promise<SubmitPolicyEvaluationResult> {
  if (input.request.mode === "relay_signed") {
    return await evaluateRelayPolicy(input);
  }
  return evaluatePrivyPolicy(input);
}

export async function evaluatePrivyRuntimeBalancePolicy(input: {
  env: Env;
  lane: ExecutionLane;
  walletAddress: string;
  inputMint: string;
  amountAtomic: string;
  minSolReserveLamports: string;
  rpc: PrivyRuntimePolicyRpc;
  runtimeDefaults: SubmitPolicyRuntime | null;
}): Promise<PrivyRuntimePolicyResult> {
  const defaults = resolvePrivyPolicyDefaults({
    env: input.env,
    lane: input.lane,
  });
  const enforceBalanceChecks =
    input.runtimeDefaults?.enforceBalanceChecks ??
    defaults.enforceBalanceChecks;
  const checks: PolicyCheck[] = [];
  const defaultsSnapshot: JsonObject = {
    enforceBalanceChecks,
    minSolReserveLamports: input.minSolReserveLamports,
  };

  if (!enforceBalanceChecks) {
    checks.push(
      check("privy-balance-check", "skip", null, {
        enabled: false,
      }),
    );
    const decision: PrivyRuntimePolicyDecision = {
      policyVersion: "x402-021-v1",
      environment: defaults.environment,
      mode: "privy_execute",
      lane: input.lane,
      checks,
      defaults: defaultsSnapshot,
    };
    return {
      ok: true,
      decision,
      metadata: toRuntimeMetadata(decision),
    };
  }

  const amountAtomic = BigInt(input.amountAtomic);
  if (input.inputMint === SOL_MINT) {
    const balanceLamports = await input.rpc.getBalanceLamports(
      input.walletAddress,
    );
    const minReserveLamports = BigInt(input.minSolReserveLamports);
    if (amountAtomic + minReserveLamports > balanceLamports) {
      checks.push(
        check("privy-sol-reserve", "fail", "privy-insufficient-sol-reserve", {
          amountAtomic: amountAtomic.toString(),
          minSolReserveLamports: minReserveLamports.toString(),
          balanceLamports: balanceLamports.toString(),
        }),
      );
      const decision: PrivyRuntimePolicyDecision = {
        policyVersion: "x402-021-v1",
        environment: defaults.environment,
        mode: "privy_execute",
        lane: input.lane,
        checks,
        defaults: defaultsSnapshot,
      };
      return {
        ok: false,
        reason: "privy-insufficient-sol-reserve",
        decision,
        metadata: toRuntimeMetadata(decision),
      };
    }
    checks.push(check("privy-sol-reserve", "pass", null, null));
  } else {
    const tokenBalance = await input.rpc.getTokenBalanceAtomic(
      input.walletAddress,
      input.inputMint,
    );
    if (amountAtomic > tokenBalance) {
      checks.push(
        check(
          "privy-token-balance",
          "fail",
          "privy-insufficient-token-balance",
          {
            amountAtomic: amountAtomic.toString(),
            tokenBalanceAtomic: tokenBalance.toString(),
            mint: input.inputMint,
          },
        ),
      );
      const decision: PrivyRuntimePolicyDecision = {
        policyVersion: "x402-021-v1",
        environment: defaults.environment,
        mode: "privy_execute",
        lane: input.lane,
        checks,
        defaults: defaultsSnapshot,
      };
      return {
        ok: false,
        reason: "privy-insufficient-token-balance",
        decision,
        metadata: toRuntimeMetadata(decision),
      };
    }
    checks.push(check("privy-token-balance", "pass", null, null));
  }

  const decision: PrivyRuntimePolicyDecision = {
    policyVersion: "x402-021-v1",
    environment: defaults.environment,
    mode: "privy_execute",
    lane: input.lane,
    checks,
    defaults: defaultsSnapshot,
  };
  return {
    ok: true,
    decision,
    metadata: toRuntimeMetadata(decision),
  };
}
