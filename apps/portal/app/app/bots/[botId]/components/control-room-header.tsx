import {
  ArrowLeft,
  CirclePlay,
  PauseCircle,
  Settings2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { cn } from "../../../../cn";
import { type Bot, BTN_PRIMARY, BTN_SECONDARY } from "../../../../lib";

type ControlRoomHeaderProps = {
  bot: Bot;
  loading: boolean;
  canStart: boolean;
  startBlockedReason?: string | null;
  runState: string;
  pendingSteering: number;
  nextTickAt: string | null;
  onStart: () => void;
  onStop: () => void;
  onFund: () => void;
  onOpenSettings: () => void;
};

export function ControlRoomHeader({
  bot,
  loading,
  canStart,
  startBlockedReason,
  runState,
  pendingSteering,
  nextTickAt,
  onStart,
  onStop,
  onFund,
  onOpenSettings,
}: ControlRoomHeaderProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/app"
          className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Control Room
        </Link>
        <div className="inline-flex items-center gap-2 text-xs">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 uppercase tracking-wide",
              runState === "running"
                ? "border-emerald-500/50 text-emerald-400"
                : runState === "blocked_inference"
                  ? "border-amber-500/60 text-amber-400"
                  : "border-border text-muted",
            )}
          >
            {runState}
          </span>
          <span className="rounded-full border border-border px-2 py-0.5 text-muted">
            {pendingSteering} pending steer
          </span>
          <span className="rounded-full border border-border px-2 py-0.5 text-muted">
            next tick:{" "}
            {nextTickAt
              ? new Date(nextTickAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "n/a"}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{bot.name}</h1>
          <p className="mt-1 text-xs text-muted font-mono">
            wallet {bot.walletAddress.slice(0, 8)}...
            {bot.walletAddress.slice(-8)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={cn(BTN_SECONDARY, "h-9 px-3")}
            onClick={onOpenSettings}
            disabled={loading}
          >
            <Settings2 className="h-4 w-4" />
            Settings
          </button>
          <button
            className={cn(BTN_SECONDARY, "h-9 px-3")}
            onClick={onFund}
            disabled={loading}
          >
            <Wallet className="h-4 w-4" />
            Fund
          </button>
          {bot.enabled ? (
            <button
              className={cn(BTN_SECONDARY, "h-9 px-3")}
              onClick={onStop}
              disabled={loading}
            >
              <PauseCircle className="h-4 w-4" />
              Stop
            </button>
          ) : (
            <button
              className={cn(BTN_PRIMARY, "h-9 px-3")}
              onClick={onStart}
              disabled={loading || !canStart}
              title={canStart ? undefined : startBlockedReason ?? undefined}
            >
              <CirclePlay className="h-4 w-4" />
              Start
            </button>
          )}
        </div>
      </div>
      {!canStart ? (
        <p className="mt-2 text-xs text-amber-400">
          {startBlockedReason ?? "Configure inference provider before starting."}
        </p>
      ) : null}
    </div>
  );
}
