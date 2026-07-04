// Alerts: pure matching layer + the cross-cutting store (armed alerts,
// fired-alert log, toasts). matchAlerts runs on every price tick, so the
// no-hit path is allocation-free — it returns null rather than a fresh
// empty array. The store keeps a plain array alongside the writable so
// check() reads it without get()/subscribe churn on the hot path.

import { type Readable, writable } from "svelte/store";
import { track } from "$lib/telemetry";
import { ALERT_LOG_KEY, ALERTS_STORAGE_KEY } from "$lib/terminal/prefs";
import { formatPrice } from "$lib/utils";

export type Alert = {
  id: string;
  symbol: string;
  op: "above" | "below";
  price: number;
  tier: "FLASH" | "PRIORITY" | "ROUTINE";
  triggered: boolean;
};

/**
 * Untriggered alerts for `symbol` whose threshold the price has crossed —
 * `above` fires at price >= threshold, `below` at price <= threshold.
 * Returns null when nothing fired (reference-stable for the hot path).
 */
export function matchAlerts(
  alerts: Alert[],
  price: number,
  symbol: string,
): Alert[] | null {
  let hits: Alert[] | null = null;
  for (const alert of alerts) {
    if (alert.triggered || alert.symbol !== symbol) continue;
    const hit =
      alert.op === "above" ? price >= alert.price : price <= alert.price;
    if (hit) {
      if (!hits) hits = [];
      hits.push(alert);
    }
  }
  return hits;
}

export function headlineMatches(title: string, symbol: string): boolean {
  return title.toUpperCase().includes(symbol.toUpperCase());
}

// Fired alerts become a persistent, timestamped log plus toasts —
// Bloomberg's message-pane pattern in miniature.
export type FiredAlert = { ts: number; title: string; body: string };
export type Toast = FiredAlert & { toastId: number };

export type AlertsStore = {
  alerts: Readable<Alert[]>;
  alertLog: Readable<FiredAlert[]>;
  toasts: Readable<Toast[]>;
  load(options?: { trackContext?: () => Record<string, unknown> }): void;
  save(): void;
  check(price: number | null, symbol: string): void;
  fire(title: string, body: string): Promise<void>;
  arm(input: Omit<Alert, "id" | "triggered">): void;
  remove(id: string): void;
  pushToast(entry: FiredAlert): void;
};

function createAlertsStore(): AlertsStore {
  // Plain mirrors of the writables: check() is on the WS-tick hot path and
  // must read state without allocating a subscription per tick.
  let alerts: Alert[] = [];
  let alertLog: FiredAlert[] = [];
  let toastSeq = 0;
  // Analytics market snapshot for alert_fired — provided by the page
  // (marketContext stays page-level plumbing).
  let trackContext: () => Record<string, unknown> = () => ({});

  const alertsStore = writable<Alert[]>(alerts);
  const alertLogStore = writable<FiredAlert[]>(alertLog);
  const toastsStore = writable<Toast[]>([]);

  function setAlerts(next: Alert[]): void {
    alerts = next;
    alertsStore.set(next);
  }

  function load(options?: {
    trackContext?: () => Record<string, unknown>;
  }): void {
    if (options?.trackContext) trackContext = options.trackContext;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(ALERTS_STORAGE_KEY);
      if (raw) setAlerts(JSON.parse(raw) as Alert[]);
    } catch {
      // ignore malformed alerts
    }
    try {
      const raw = window.localStorage.getItem(ALERT_LOG_KEY);
      const parsed = raw ? (JSON.parse(raw) as FiredAlert[]) : [];
      if (Array.isArray(parsed)) {
        alertLog = parsed.slice(0, 50);
        alertLogStore.set(alertLog);
      }
    } catch {
      // storage unavailable — start empty
    }
  }

  function save(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
    } catch {
      // storage unavailable — non-fatal
    }
  }

  function arm(input: Omit<Alert, "id" | "triggered">): void {
    setAlerts([
      ...alerts,
      {
        id: `${input.symbol}-${input.op}-${input.price}-${alerts.length}`,
        ...input,
        triggered: false,
      },
    ]);
    save();
  }

  function remove(id: string): void {
    setAlerts(alerts.filter((alert) => alert.id !== id));
    save();
  }

  function check(price: number | null, symbol: string): void {
    if (price === null) return;
    const hits = matchAlerts(alerts, price, symbol);
    if (!hits) return;
    for (const alert of hits) {
      alert.triggered = true;
      void fire(
        `${alert.tier} · ${alert.symbol}-PERP`,
        `${alert.symbol} ${alert.op} ${alert.price} — now ${formatPrice(price)}`,
      );
    }
    setAlerts([...alerts]);
    save();
  }

  function pushToast(entry: FiredAlert): void {
    const toastId = ++toastSeq;
    toastsStore.update((toasts) => [...toasts, { ...entry, toastId }]);
    window.setTimeout(() => {
      toastsStore.update((toasts) =>
        toasts.filter((toast) => toast.toastId !== toastId),
      );
    }, 6_000);
  }

  function recordFiredAlert(title: string, body: string): void {
    track("alert_fired", { ...trackContext(), title, body });
    const entry: FiredAlert = { ts: Date.now(), title, body };
    alertLog = [entry, ...alertLog].slice(0, 50);
    alertLogStore.set(alertLog);
    try {
      window.localStorage.setItem(ALERT_LOG_KEY, JSON.stringify(alertLog));
    } catch {
      // non-fatal
    }
    pushToast(entry);
  }

  async function fire(title: string, body: string): Promise<void> {
    recordFiredAlert(title, body);
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      try {
        new Notification(title, { body });
      } catch {
        // notification construction can throw on some platforms
      }
    }
    try {
      await fetch("/notify-discord", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: `🔔 ${title} — ${body}` }),
      });
    } catch {
      // Discord webhook optional / not configured
    }
  }

  return {
    alerts: { subscribe: alertsStore.subscribe },
    alertLog: { subscribe: alertLogStore.subscribe },
    toasts: { subscribe: toastsStore.subscribe },
    load,
    save,
    check,
    fire,
    arm,
    remove,
    pushToast,
  };
}

export const alertsStore = createAlertsStore();
