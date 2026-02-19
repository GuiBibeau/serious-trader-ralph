import { cn } from "../../../../cn";
import { BTN_SECONDARY } from "../../../../lib";

type InferenceHealthCardProps = {
  configured: boolean;
  model: string | null;
  providerBaseUrlHash: string | null;
  pingAgeMs: number | null;
  lastPingError: string | null;
  onOpenSettings: () => void;
  onPingCurrent: () => Promise<void>;
  pinging: boolean;
};

export function InferenceHealthCard({
  configured,
  model,
  providerBaseUrlHash,
  pingAgeMs,
  lastPingError,
  onOpenSettings,
  onPingCurrent,
  pinging,
}: InferenceHealthCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">Inference Health</h3>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
            configured
              ? "border-emerald-500/50 text-emerald-400"
              : "border-amber-500/60 text-amber-400",
          )}
        >
          {configured ? "configured" : "missing"}
        </span>
      </div>

      <dl className="mt-3 space-y-1 text-xs text-muted">
        <div className="flex justify-between gap-3">
          <dt>model</dt>
          <dd className="text-ink">{model ?? "n/a"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>base url hash</dt>
          <dd className="text-ink font-mono">
            {providerBaseUrlHash
              ? `${providerBaseUrlHash.slice(0, 10)}...`
              : "n/a"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>ping age</dt>
          <dd className="text-ink">
            {pingAgeMs === null ? "n/a" : `${Math.round(pingAgeMs / 1000)}s`}
          </dd>
        </div>
      </dl>

      {lastPingError ? (
        <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
          {lastPingError}
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          className={BTN_SECONDARY}
          onClick={onOpenSettings}
          type="button"
        >
          Edit
        </button>
        <button
          className={BTN_SECONDARY}
          onClick={() => void onPingCurrent()}
          type="button"
          disabled={!configured || pinging}
        >
          {pinging ? "Testing..." : "Test"}
        </button>
      </div>
    </div>
  );
}
