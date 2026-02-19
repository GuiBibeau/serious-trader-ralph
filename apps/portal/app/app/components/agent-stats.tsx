"use client";

import { ExternalLink, PlayCircle, StopCircle } from "lucide-react";
import Link from "next/link";
import { cn } from "../../cn";

interface AgentStatsProps {
  bots: { id: string; name: string; enabled: boolean }[];
  selectedBotId: string;
  onSelectBot: (id: string) => void;
  onCreateBot: () => void;
  onStartBot: (id: string) => void;
  onStopBot: (id: string) => void;
  loading: boolean;
  hasManualAccess: boolean;
  selectedBotInferenceConfigured: boolean;
}

export function AgentStats({
  bots,
  selectedBotId,
  onSelectBot,
  onCreateBot,
  onStartBot,
  onStopBot,
  loading,
  hasManualAccess,
  selectedBotInferenceConfigured,
}: AgentStatsProps) {
  const selectedBot = bots.find((b) => b.id === selectedBotId);

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Agent List */}
        <div className="space-y-2">
          <p className="text-xs text-muted uppercase tracking-wider opacity-60 pl-1">
            Agents
          </p>
          {bots.map((bot) => (
            <button
              key={bot.id}
              type="button"
              onClick={() => onSelectBot(bot.id)}
              className={cn(
                "w-full text-left px-3 py-2.5 rounded border text-sm font-mono transition-all duration-200 group relative overflow-hidden",
                selectedBotId === bot.id
                  ? "bg-accent/10 border-accent/40 text-accent shadow-[0_0_15px_rgba(59,130,246,0.1)]"
                  : "bg-paper border-border text-muted hover:border-border-strong hover:bg-surface",
              )}
            >
              <div className="flex justify-between items-center relative z-10">
                <span className="font-semibold">{bot.name}</span>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-[10px]",
                      bot.enabled ? "text-emerald-500" : "text-muted",
                    )}
                  >
                    {bot.enabled ? "RUNNING" : "STOPPED"}
                  </span>
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor]",
                      bot.enabled
                        ? "bg-emerald-500 text-emerald-500"
                        : "bg-red-500 text-red-500",
                    )}
                  />
                </div>
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={onCreateBot}
            className="w-full py-2 border border-dashed border-border text-xs text-muted hover:text-ink hover:border-muted hover:bg-white/5 transition-colors rounded uppercase tracking-wide opacity-60 hover:opacity-100"
          >
            + New Agent
          </button>
        </div>

        {/* Global Metrics Mockup */}
        <div className="pt-4 border-t border-border space-y-3">
          <p className="text-xs text-muted uppercase tracking-wider opacity-60 pl-1">
            Metrics (24h)
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-paper border border-border rounded p-2">
              <p className="text-[10px] text-muted">Win Rate</p>
              <p className="text-lg font-mono text-emerald-400">---%</p>
            </div>
            <div className="bg-paper border border-border rounded p-2">
              <p className="text-[10px] text-muted">PnL (Est)</p>
              <p className="text-lg font-mono text-ink">---</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <div className="mt-auto border-t border-border p-4 bg-surface/50">
        <div className="grid grid-cols-2 gap-3">
          <Link
            href={selectedBot ? `/app/bots/${selectedBot.id}` : "#"}
            className={cn(
              "no-drag flex items-center justify-center gap-2 h-9 rounded bg-surface border border-border text-muted hover:text-ink hover:border-border-strong transition-all text-xs font-bold uppercase tracking-wide",
              !selectedBot && "pointer-events-none opacity-50",
            )}
          >
            <ExternalLink className="w-3 h-3" />
            View Details
          </Link>
          <button
            type="button"
            disabled={
              !selectedBot ||
              loading ||
              !hasManualAccess ||
              !selectedBot.enabled
            }
            onClick={() => selectedBot && onStopBot(selectedBot.id)}
            className="no-drag flex items-center justify-center h-9 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 hover:border-rose-500/50 transition-all text-xs font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <StopCircle className="w-3.5 h-3.5 mr-1" />
            Stop Agent
          </button>
          <button
            type="button"
            disabled={
              !selectedBot ||
              loading ||
              !hasManualAccess ||
              selectedBot.enabled ||
              !selectedBotInferenceConfigured
            }
            onClick={() => selectedBot && onStartBot(selectedBot.id)}
            className="no-drag flex items-center justify-center h-9 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all text-xs font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              !selectedBotInferenceConfigured
                ? "Configure inference provider before starting"
                : undefined
            }
          >
            <PlayCircle className="w-3.5 h-3.5 mr-1" />
            Start Agent
          </button>
        </div>
        {selectedBot &&
        !selectedBot.enabled &&
        !selectedBotInferenceConfigured ? (
          <p className="mt-2 text-[11px] text-amber-400">
            Inference is not configured. Open bot details to set provider and
            key.
          </p>
        ) : null}
        {selectedBot?.enabled ? (
          <p className="mt-2 text-[11px] text-emerald-400">Ticking started.</p>
        ) : null}
      </div>
    </div>
  );
}
