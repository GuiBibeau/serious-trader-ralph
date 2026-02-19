import { cn } from "../../../../cn";

type RunStateBannerProps = {
  state: string;
  blockedReason: string | null;
  currentRunId: string | null;
  lastTickAt: string | null;
  nextTickAt: string | null;
};

export function RunStateBanner({
  state,
  blockedReason,
  currentRunId,
  lastTickAt,
  nextTickAt,
}: RunStateBannerProps) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        state === "blocked_inference"
          ? "border-amber-500/50 bg-amber-500/10"
          : state === "running"
            ? "border-emerald-500/40 bg-emerald-500/10"
            : "border-border bg-surface",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">
            Run State
          </p>
          <p className="text-sm font-semibold text-ink">{state}</p>
          {blockedReason ? (
            <p className="text-xs text-amber-300 mt-1">{blockedReason}</p>
          ) : null}
        </div>
        <div className="grid gap-1 text-xs text-muted">
          <span>run id: {currentRunId ?? "n/a"}</span>
          <span>last tick: {formatTs(lastTickAt)}</span>
          <span>next tick: {formatTs(nextTickAt)}</span>
        </div>
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
    second: "2-digit",
  });
}
