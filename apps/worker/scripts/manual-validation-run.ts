/*
 Manual local validation runs for strategy lifecycle checks.

 Usage:
   EDGE_API_BASE=http://127.0.0.1:8888 \
   ADMIN_TOKEN=local-dev \
   BOT_ID=<bot-id> \
   bun run scripts/manual-validation-run.ts
*/

type JsonRecord = Record<string, unknown>;

const EDGE_API_BASE = (process.env.EDGE_API_BASE || "http://127.0.0.1:8888").replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const BOT_ID = process.env.BOT_ID || "";

if (!ADMIN_TOKEN) {
  throw new Error("Missing ADMIN_TOKEN");
}
if (!BOT_ID) {
  throw new Error("Missing BOT_ID");
}

async function adminPost(path: string, body: JsonRecord = {}): Promise<JsonRecord> {
  const response = await fetch(`${EDGE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : `http-${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function getValidationStatus(payload: JsonRecord): string {
  const validation = payload.validation;
  if (!validation || typeof validation !== "object") return "unknown";
  return String((validation as JsonRecord).status ?? "unknown");
}

async function runA(): Promise<void> {
  console.log("\nRun A: DCA uptrend expected pass + auto-enable");
  await adminPost(`/api/admin/bots/${BOT_ID}/config`, {
    enabled: false,
    policy: {
      dryRun: false,
      simulateOnly: true,
      slippageBps: 50,
      maxPriceImpactPct: 0.05,
      maxTradeAmountAtomic: "0",
      minSolReserveLamports: "50000000",
      allowedMints: [
        "So11111111111111111111111111111111111111112",
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ],
    },
    strategy: {
      type: "dca",
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outputMint: "So11111111111111111111111111111111111111112",
      amount: "5000000",
      everyMinutes: 60,
    },
    validation: {
      enabled: true,
      lookbackDays: 45,
      profile: "balanced",
      gateMode: "hard",
      minTrades: 8,
      autoEnableOnPass: true,
      overrideAllowed: true,
    },
    autotune: {
      enabled: true,
      mode: "conservative",
      cooldownHours: 24,
      maxChangePctPerTune: 10,
    },
    dataSources: {
      priority: ["fixture"],
      fixturePattern: "uptrend",
      cacheTtlMinutes: 0,
    },
  });

  const validation = await adminPost(`/api/admin/bots/${BOT_ID}/validate`, {
    fixturePattern: "uptrend",
  });
  console.log("Run A validation:", validation.validation);
  assert(getValidationStatus(validation) === "passed", "Run A should pass");

  const inspection = await adminPost(`/api/admin/bots/${BOT_ID}/revalidate`);
  const cfg = (inspection.config ?? {}) as JsonRecord;
  const bot = (inspection.bot ?? {}) as JsonRecord;
  assert(cfg.enabled === true, "Run A should auto-enable config");
  assert(bot.enabled === true, "Run A should auto-enable bot");
  console.log("Run A inspection:", inspection.runtime);
}

async function runB(): Promise<void> {
  console.log("\nRun B: DCA downtrend expected fail + start gate 409");
  await adminPost(`/api/admin/bots/${BOT_ID}/config`, {
    enabled: false,
    strategy: {
      type: "dca",
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outputMint: "So11111111111111111111111111111111111111112",
      amount: "5000000",
      everyMinutes: 60,
    },
    dataSources: {
      priority: ["fixture"],
      fixturePattern: "downtrend",
      cacheTtlMinutes: 0,
    },
  });

  const validation = await adminPost(`/api/admin/bots/${BOT_ID}/validate`, {
    fixturePattern: "downtrend",
  });
  console.log("Run B validation:", validation.validation);
  assert(getValidationStatus(validation) === "failed", "Run B should fail");

  let blocked = false;
  try {
    await adminPost(`/api/admin/bots/${BOT_ID}/start`, {
      overrideValidation: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    blocked =
      message.includes("strategy-not-validated") ||
      message.includes("strategy-validation-stale");
    console.log("Run B start blocked:", message);
  }
  assert(blocked, "Run B start should be blocked by validation gate");
}

async function runC(): Promise<void> {
  console.log("\nRun C: Rebalance whipsaw expected revalidate/tune path");
  await adminPost(`/api/admin/bots/${BOT_ID}/config`, {
    enabled: true,
    strategy: {
      type: "rebalance",
      baseMint: "So11111111111111111111111111111111111111112",
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      targetBasePct: 0.95,
      thresholdPct: 0.005,
      maxSellBaseAmount: "100000000",
      maxBuyQuoteAmount: "15000000",
    },
    validation: {
      enabled: true,
      lookbackDays: 45,
      profile: "strict",
      gateMode: "hard",
      minTrades: 8,
      autoEnableOnPass: true,
      overrideAllowed: true,
    },
    autotune: {
      enabled: true,
      mode: "conservative",
      cooldownHours: 24,
      maxChangePctPerTune: 10,
      rails: {
        rebalance: {
          thresholdPctMin: 0.005,
          thresholdPctMax: 0.05,
        },
      },
    },
    dataSources: {
      priority: ["fixture"],
      fixturePattern: "whipsaw",
      cacheTtlMinutes: 0,
    },
  });

  const first = await adminPost(`/api/admin/bots/${BOT_ID}/revalidate`, {
    force: true,
  });
  console.log("Run C revalidate #1:", first.runtime, first.validation);

  const second = await adminPost(`/api/admin/bots/${BOT_ID}/revalidate`, {
    force: true,
  });
  console.log("Run C revalidate #2:", second.runtime, second.validation);

  const runtime = (second.runtime ?? {}) as JsonRecord;
  const state = String(runtime.lifecycleState ?? "unknown");
  assert(
    state === "watch" || state === "suspended" || state === "active",
    "Run C runtime should end in watch/active/suspended",
  );
}

(async () => {
  console.log(`Manual validation runs against ${EDGE_API_BASE} bot=${BOT_ID}`);
  await runA();
  await runB();
  await runC();
  console.log("\nAll manual runs completed.");
})().catch((err) => {
  console.error("manual-validation-run failed", err);
  process.exitCode = 1;
});
