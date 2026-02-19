import { getRuntimeState } from "./apps/worker/src/strategy_validation/repo";
import { createConversationTestEnv } from "./tests/unit/_conversation_test_utils";

const tenantId = "bot-context-1";
const baseEnv = createConversationTestEnv({
  tenantId,
  config: {
    enabled: true,
    strategy: {
      type: "dca",
      inputMint: "USDC",
      outputMint: "SOL",
      amount: "1",
      everyMinutes: 60,
    },
  },
  runtimeState: {
    tenantId,
    lifecycleState: "active",
    activeStrategyHash: "hash-ok",
    lastValidationId: 11,
    consecutiveFailures: 0,
    lastTunedAt: null,
    nextRevalidateAt: "2026-02-14T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
  },
  validationRuns: [],
});

const rs = await getRuntimeState(baseEnv, tenantId);
console.log("runtime", rs);
