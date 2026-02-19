import { useState } from "react";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../../../lib";

type SteeringItem = {
  id: number;
  message: string;
  status: string;
  queuedAt: string;
  appliedAt: string | null;
  appliedRunId: string | null;
};

type SteeringQueuePanelProps = {
  items: SteeringItem[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onQueue: (message: string) => Promise<void>;
};

export function SteeringQueuePanel({
  items,
  loading,
  onRefresh,
  onQueue,
}: SteeringQueuePanelProps) {
  const [draft, setDraft] = useState("");

  async function submit(): Promise<void> {
    const message = draft.trim();
    if (!message || loading) return;
    await onQueue(message);
    setDraft("");
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">Steering Queue</h3>
        <button className={BTN_SECONDARY} onClick={() => void onRefresh()}>
          Refresh
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Guide the current run..."
          disabled={loading}
        />
        <button className={BTN_PRIMARY} onClick={() => void submit()} disabled={loading}>
          Queue
        </button>
      </div>
      <div className="mt-3 max-h-40 overflow-y-auto space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-muted">No steering messages yet.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded border border-border/70 bg-paper/40 p-2">
              <p className="text-xs text-ink">{item.message}</p>
              <p className="mt-1 text-[11px] text-muted">
                #{item.id} · {item.status} · {formatTs(item.queuedAt)}
                {item.appliedRunId ? ` · run ${item.appliedRunId.slice(0, 8)}` : ""}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatTs(value: string | null): string {
  if (!value) return "n/a";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
