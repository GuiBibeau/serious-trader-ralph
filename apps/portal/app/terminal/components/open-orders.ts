import type { QueuedTerminalOrder } from "./trade-ticket-modal";

export type OpenOrderStatus =
  | "pending"
  | "working"
  | "partial"
  | "failed"
  | "cancelled";

export type OpenOrderRow = QueuedTerminalOrder & {
  status: OpenOrderStatus;
  initialAmountUi: string;
  lastError: string | null;
};

export function formatOrderAmountUi(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

export function parseOrderAmountUi(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function queueOpenOrder(
  current: readonly OpenOrderRow[],
  order: QueuedTerminalOrder,
): OpenOrderRow[] {
  return [
    {
      ...order,
      status: "pending",
      initialAmountUi: order.amountUi,
      lastError: null,
    },
    ...current,
  ].slice(0, 64);
}

export function promotePendingOrders(
  current: readonly OpenOrderRow[],
  now: number,
  minPendingMs = 1500,
): OpenOrderRow[] {
  let changed = false;
  const next = current.map((order) => {
    if (order.status !== "pending") return order;
    if (now - order.createdAt < minPendingMs) return order;
    changed = true;
    return {
      ...order,
      status: "working" as const,
      updatedAt: now,
    };
  });
  return changed ? next : [...current];
}

export function cancelOpenOrder(
  current: readonly OpenOrderRow[],
  orderId: string,
  now: number,
): OpenOrderRow[] {
  return current.map((order) =>
    order.id === orderId
      ? {
          ...order,
          status: "cancelled",
          updatedAt: now,
          lastError: null,
        }
      : order,
  );
}

export function cancelAllOpenOrders(
  current: readonly OpenOrderRow[],
  now: number,
): OpenOrderRow[] {
  return current.map((order) => ({
    ...order,
    status: "cancelled",
    updatedAt: now,
    lastError: null,
  }));
}

export function setOrderError(
  current: readonly OpenOrderRow[],
  orderId: string,
  error: string,
  now: number,
): OpenOrderRow[] {
  return current.map((order) =>
    order.id === orderId
      ? {
          ...order,
          status: "failed",
          updatedAt: now,
          lastError: error,
        }
      : order,
  );
}

export function amendOpenOrder(input: {
  current: readonly OpenOrderRow[];
  orderId: string;
  amountUi: string;
  priceUi: string;
  now: number;
}):
  | { ok: true; next: OpenOrderRow[] }
  | { ok: false; error: string; next: OpenOrderRow[] } {
  const amount = parseOrderAmountUi(input.amountUi.trim());
  if (amount === null) {
    return {
      ok: false,
      error: "invalid-amend-amount",
      next: setOrderError(
        input.current,
        input.orderId,
        "invalid-amend-amount",
        input.now,
      ),
    };
  }
  const nextAmountUi = formatOrderAmountUi(amount);
  const normalizedPrice = input.priceUi.trim();
  if (!normalizedPrice || Number(normalizedPrice) <= 0) {
    const target = input.current.find((order) => order.id === input.orderId);
    const error =
      target?.orderType === "limit"
        ? "invalid-limit-price"
        : "invalid-trigger-price";
    return {
      ok: false,
      error,
      next: setOrderError(input.current, input.orderId, error, input.now),
    };
  }

  return {
    ok: true,
    next: input.current.map((order) =>
      order.id === input.orderId
        ? {
            ...order,
            amountUi: nextAmountUi,
            remainingAmountUi: nextAmountUi,
            status: "working",
            updatedAt: input.now,
            lastError: null,
            limitPriceUi: order.orderType === "limit" ? normalizedPrice : null,
            triggerPriceUi:
              order.orderType === "trigger" ? normalizedPrice : null,
          }
        : order,
    ),
  };
}

export function executeOpenOrderSlice(input: {
  current: readonly OpenOrderRow[];
  orderId: string;
  fraction: 0.5 | 1;
  now: number;
}):
  | {
      ok: true;
      executeAmountUi: string;
      next: OpenOrderRow[];
    }
  | {
      ok: false;
      error: string;
      next: OpenOrderRow[];
    } {
  const target = input.current.find((order) => order.id === input.orderId);
  if (!target) {
    return {
      ok: false,
      error: "order-not-found",
      next: [...input.current],
    };
  }
  const remaining = parseOrderAmountUi(target.remainingAmountUi);
  if (remaining === null) {
    const error = "invalid-order-amount";
    return {
      ok: false,
      error,
      next: setOrderError(input.current, input.orderId, error, input.now),
    };
  }
  const executeAmount =
    input.fraction === 1 ? remaining : Math.max(remaining * 0.5, 0.0001);
  const executeAmountUi = formatOrderAmountUi(executeAmount);
  const nextRemaining = Math.max(0, remaining - executeAmount);
  const nextRemainingUi = formatOrderAmountUi(nextRemaining);

  return {
    ok: true,
    executeAmountUi,
    next: input.current.flatMap((order) => {
      if (order.id !== input.orderId) return [order];
      if (nextRemaining <= 0.000001) return [];
      return [
        {
          ...order,
          remainingAmountUi: nextRemainingUi,
          status: "partial",
          updatedAt: input.now,
          lastError: null,
        },
      ];
    }),
  };
}
