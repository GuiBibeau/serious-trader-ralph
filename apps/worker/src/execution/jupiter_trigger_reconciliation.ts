import { JupiterClient, type JupiterTriggerOrderRecord } from "../jupiter";
import type { Env } from "../types";
import {
  findJupiterTriggerOrderByKey,
  type JupiterTrackedTriggerOrder,
  type JupiterTriggerLifecycleSummary,
  readTrackedJupiterTriggerOrder,
  summarizeJupiterTriggerOrder,
} from "./jupiter_trigger";
import {
  type ExecutionLatestStatusRecord,
  getExecutionLatestStatus,
  type JsonObject,
  terminalizeExecutionRequest,
  upsertExecutionReceiptIdempotent,
} from "./repository";
import type { ExecutionIntentLifecycleSnapshot } from "./types";

const DEFAULT_JUPITER_BASE_URL = "https://lite-api.jup.ag";

type JupiterConditionalOrderReconciliation = {
  latest: ExecutionLatestStatusRecord;
  lifecycle: ExecutionIntentLifecycleSnapshot | null;
  trackedOrder: JupiterTrackedTriggerOrder | null;
  orderRecord: JupiterTriggerOrderRecord | null;
  summary: JupiterTriggerLifecycleSummary | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function newExecutionReceiptId(): string {
  return `exec_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function readIntentFamily(latest: ExecutionLatestStatusRecord): string | null {
  const intent = isRecord(latest.request.metadata?.intent)
    ? latest.request.metadata?.intent
    : null;
  return readString(intent?.family);
}

function readPersistedLifecycle(
  latest: ExecutionLatestStatusRecord,
): ExecutionIntentLifecycleSnapshot | null {
  const receiptLifecycle = isRecord(latest.receipt?.receipt?.lifecycle)
    ? latest.receipt?.receipt?.lifecycle
    : null;
  if (receiptLifecycle) {
    return receiptLifecycle as ExecutionIntentLifecycleSnapshot;
  }
  const executionMeta = isRecord(
    latest.latestAttempt?.providerResponse?.executionMeta,
  )
    ? latest.latestAttempt?.providerResponse?.executionMeta
    : null;
  const lifecycle = isRecord(executionMeta?.lifecycle)
    ? executionMeta?.lifecycle
    : null;
  return lifecycle ? (lifecycle as ExecutionIntentLifecycleSnapshot) : null;
}

export function buildTerminalJupiterTriggerReceipt(input: {
  latest: ExecutionLatestStatusRecord;
  trackedOrder: JupiterTrackedTriggerOrder;
  orderRecord: JupiterTriggerOrderRecord | null;
  summary: JupiterTriggerLifecycleSummary;
}): {
  finalizedStatus: "landed" | "failed" | "expired";
  statusReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  receipt: JsonObject;
} {
  const terminalReason = input.summary.terminalReason;
  const finalizedStatus =
    terminalReason === "filled"
      ? "landed"
      : terminalReason === "expired"
        ? "expired"
        : "failed";
  const statusReason =
    terminalReason === "cancelled"
      ? "conditional-order-cancelled"
      : terminalReason === "expired"
        ? "conditional-order-expired"
        : null;
  const errorCode =
    terminalReason === "cancelled"
      ? "order-cancelled"
      : terminalReason === "expired"
        ? "order-expired"
        : null;
  const errorMessage =
    terminalReason === "cancelled"
      ? "Conditional spot order was cancelled."
      : terminalReason === "expired"
        ? "Conditional spot order expired before fill."
        : null;
  return {
    finalizedStatus,
    statusReason,
    errorCode,
    errorMessage,
    receipt: {
      mode: input.latest.request.mode,
      route: input.latest.latestAttempt?.provider ?? "jupiter",
      outcome: finalizedStatus,
      lifecycle: input.summary.lifecycle as unknown as JsonObject,
      triggerOrder: {
        ...input.trackedOrder,
        status: readString(input.orderRecord?.status),
        filledInputAtomic: input.summary.filledInputAtomic,
        filledOutputAtomic: input.summary.filledOutputAtomic,
        signature: input.summary.signature,
      },
      quote: {
        inputMint: input.trackedOrder.inputMint,
        outputMint: input.trackedOrder.outputMint,
        inAmount:
          input.trackedOrder.makingAmount ?? input.summary.filledInputAtomic,
        outAmount:
          input.trackedOrder.takingAmount ?? input.summary.filledOutputAtomic,
      },
    },
  };
}

async function fetchTrackedJupiterOrder(input: {
  env: Env;
  trackedOrder: JupiterTrackedTriggerOrder;
}): Promise<JupiterTriggerOrderRecord | null> {
  const jupiter = new JupiterClient(
    String(input.env.JUPITER_BASE_URL ?? "").trim() || DEFAULT_JUPITER_BASE_URL,
    input.env.JUPITER_API_KEY,
  );
  const active = await jupiter.getTriggerOrders({
    maker: input.trackedOrder.maker,
    orderStatus: "active",
    ...(input.trackedOrder.inputMint
      ? { inputMint: input.trackedOrder.inputMint }
      : {}),
    ...(input.trackedOrder.outputMint
      ? { outputMint: input.trackedOrder.outputMint }
      : {}),
    includeFailedTx: true,
  });
  const activeMatch = findJupiterTriggerOrderByKey(
    active.orders,
    input.trackedOrder.order,
  );
  if (activeMatch) return activeMatch;

  const history = await jupiter.getTriggerOrders({
    maker: input.trackedOrder.maker,
    orderStatus: "history",
    ...(input.trackedOrder.inputMint
      ? { inputMint: input.trackedOrder.inputMint }
      : {}),
    ...(input.trackedOrder.outputMint
      ? { outputMint: input.trackedOrder.outputMint }
      : {}),
    includeFailedTx: true,
  });
  return findJupiterTriggerOrderByKey(history.orders, input.trackedOrder.order);
}

export async function reconcileJupiterConditionalOrder(input: {
  env: Env;
  latest: ExecutionLatestStatusRecord;
}): Promise<JupiterConditionalOrderReconciliation> {
  const persistedLifecycle = readPersistedLifecycle(input.latest);
  if (readIntentFamily(input.latest) !== "conditional_spot_order") {
    return {
      latest: input.latest,
      lifecycle: persistedLifecycle,
      trackedOrder: null,
      orderRecord: null,
      summary: null,
    };
  }
  const trackedOrder = readTrackedJupiterTriggerOrder(
    input.latest.latestAttempt?.providerResponse?.triggerOrder,
  );
  if (!trackedOrder) {
    return {
      latest: input.latest,
      lifecycle: persistedLifecycle,
      trackedOrder: null,
      orderRecord: null,
      summary: null,
    };
  }

  let orderRecord: JupiterTriggerOrderRecord | null = null;
  let summary: JupiterTriggerLifecycleSummary | null = null;
  try {
    orderRecord = await fetchTrackedJupiterOrder({
      env: input.env,
      trackedOrder,
    });
    summary = summarizeJupiterTriggerOrder(orderRecord);
  } catch {
    return {
      latest: input.latest,
      lifecycle: persistedLifecycle,
      trackedOrder,
      orderRecord: null,
      summary: null,
    };
  }

  let latest = input.latest;
  if (summary.terminalReason && !latest.receipt) {
    const readyAt = new Date().toISOString();
    const receipt = buildTerminalJupiterTriggerReceipt({
      latest,
      trackedOrder,
      orderRecord,
      summary,
    });
    await upsertExecutionReceiptIdempotent(input.env.WAITLIST_DB, {
      requestId: latest.request.requestId,
      receiptId: newExecutionReceiptId(),
      finalizedStatus: receipt.finalizedStatus,
      lane: latest.request.lane,
      provider: latest.latestAttempt?.provider ?? "jupiter",
      signature: summary.signature,
      slot: null,
      errorCode: receipt.errorCode,
      errorMessage: receipt.errorMessage,
      receipt: receipt.receipt,
      readyAt,
    });
    await terminalizeExecutionRequest(input.env.WAITLIST_DB, {
      requestId: latest.request.requestId,
      status: receipt.finalizedStatus,
      statusReason: receipt.statusReason,
      details: {
        provider: latest.latestAttempt?.provider ?? "jupiter",
        orderState: summary.lifecycle.orderState ?? null,
        terminalReason: summary.terminalReason,
        ...(summary.signature ? { signature: summary.signature } : {}),
      },
      nowIso: readyAt,
    });
    const refreshed = await getExecutionLatestStatus(
      input.env.WAITLIST_DB,
      latest.request.requestId,
    );
    if (refreshed) latest = refreshed;
  }

  return {
    latest,
    lifecycle: summary.lifecycle,
    trackedOrder,
    orderRecord,
    summary,
  };
}
