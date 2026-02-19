type TimelineEvent = {
  id: string;
  ts: string;
  label: string;
  detail?: string;
};

export function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <h3 className="text-sm font-medium text-ink">Activity Timeline</h3>
      <div className="mt-3 max-h-56 overflow-y-auto space-y-2">
        {events.length === 0 ? (
          <p className="text-xs text-muted">No activity yet.</p>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="rounded border border-border/70 bg-paper/40 p-2"
            >
              <p className="text-xs text-ink">{event.label}</p>
              {event.detail ? (
                <p className="mt-1 text-[11px] text-muted">{event.detail}</p>
              ) : null}
              <p className="mt-1 text-[11px] text-muted">
                {formatTs(event.ts)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatTs(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
