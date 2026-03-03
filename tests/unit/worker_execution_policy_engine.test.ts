import { describe, expect, test } from "bun:test";
import { SOL_MINT } from "../../apps/worker/src/defaults";
import {
  evaluateExecutionSubmitPolicy,
  evaluatePrivyRuntimeBalancePolicy,
} from "../../apps/worker/src/execution/policy_engine";
import type { ExecSubmitRequestV1 } from "../../apps/worker/src/execution/submit_contract";
import type { Env } from "../../apps/worker/src/types";
import { buildRelaySignedPayload } from "./_relay_signed_test_utils";

function buildPrivyRequest(input?: {
  lane?: "fast" | "protected" | "safe";
  wallet?: string;
  amountAtomic?: string;
}): ExecSubmitRequestV1 {
  return {
    schemaVersion: "v1",
    mode: "privy_execute",
    lane: input?.lane ?? "protected",
    privyExecute: {
      intentType: "swap",
      wallet: input?.wallet ?? "11111111111111111111111111111111",
      swap: {
        inputMint: SOL_MINT,
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amountAtomic: input?.amountAtomic ?? "1000000",
        slippageBps: 50,
      },
    },
  };
}

describe("execution mode-aware policy engine", () => {
  test("allows valid relay_signed submit and returns parsed tx metadata", async () => {
    const relay = buildRelaySignedPayload();
    const decision = await evaluateExecutionSubmitPolicy({
      env: {
        EXEC_RELAY_VALIDATE_BLOCKHASH: "0",
      } as Env,
      request: relay,
      lane: "fast",
      actorType: "anonymous_x402",
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.relayParsed?.transactionVersion).toBeString();
    expect(decision.metadata.outcome).toBe("allow");
  });

  test("denies relay_signed submit when program allowlist fails", async () => {
    const relay = buildRelaySignedPayload();
    const decision = await evaluateExecutionSubmitPolicy({
      env: {
        EXEC_RELAY_VALIDATE_BLOCKHASH: "0",
        EXEC_RELAY_PROGRAM_ALLOWLIST:
          "ComputeBudget111111111111111111111111111111",
      } as Env,
      request: relay,
      lane: "fast",
      actorType: "anonymous_x402",
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error).toBe("policy-denied");
    expect(decision.reason).toMatch(/^program-not-allowlisted:/);
    expect(decision.metadata.outcome).toBe("deny");
  });

  test("denies privy_execute when wallet is not allowlisted", async () => {
    const decision = await evaluateExecutionSubmitPolicy({
      env: {
        EXEC_POLICY_PRIVY_WALLET_ALLOWLIST:
          "So11111111111111111111111111111111111111112",
      } as Env,
      request: buildPrivyRequest(),
      lane: "protected",
      actorType: "privy_user",
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error).toBe("policy-denied");
    expect(decision.reason).toBe("privy-wallet-not-allowlisted");
  });

  test("enforces lane-specific privy spend caps", async () => {
    const decision = await evaluateExecutionSubmitPolicy({
      env: {
        EXEC_POLICY_PRIVY_MAX_NOTIONAL_PROTECTED_ATOMIC: "100",
      } as Env,
      request: buildPrivyRequest({
        lane: "protected",
        amountAtomic: "101",
      }),
      lane: "protected",
      actorType: "privy_user",
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toBe("privy-spend-cap-exceeded");
  });

  test("applies lane-aware simulation defaults for privy executes", async () => {
    const decision = await evaluateExecutionSubmitPolicy({
      env: {
        EXEC_POLICY_PRIVY_REQUIRE_SIMULATION_PROTECTED: "1",
      } as Env,
      request: buildPrivyRequest({
        lane: "protected",
      }),
      lane: "protected",
      actorType: "privy_user",
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.runtime?.requireSimulation).toBe(true);
    expect(decision.metadata.defaults).toBeObject();
  });

  test("denies runtime execution when token balance is insufficient", async () => {
    const decision = await evaluatePrivyRuntimeBalancePolicy({
      env: {} as Env,
      lane: "protected",
      walletAddress: "11111111111111111111111111111111",
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amountAtomic: "1000",
      minSolReserveLamports: "50000000",
      rpc: {
        getBalanceLamports: async () => 0n,
        getTokenBalanceAtomic: async () => 999n,
      },
      runtimeDefaults: {
        requireSimulation: false,
        maxNotionalAtomic: "0",
        enforceBalanceChecks: true,
      },
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toBe("privy-insufficient-token-balance");
  });
});
