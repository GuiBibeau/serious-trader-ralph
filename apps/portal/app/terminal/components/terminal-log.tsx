"use client";

import { useEffect, useRef } from "react";
import { cn } from "../../cn";
import { formatTick } from "../../lib";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "EXEC";

export type LogEntry = {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
};

interface TerminalLogProps {
  logs: LogEntry[];
  className?: string;
}

export function TerminalLog({ logs, className }: TerminalLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    // Keep autoscroll confined to the log panel so page-level scroll does not jump.
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-[var(--color-chart-bg)] font-mono text-xs h-full",
        className,
      )}
    >
      <div
        ref={scrollRef}
        className="flex-1 p-3 overflow-y-auto space-y-1 font-mono"
      >
        {logs.length === 0 && (
          <p className="text-muted opacity-30 italic">
            Console ready. Waiting for input...
          </p>
        )}
        {logs.map((log) => (
          <div key={log.id} className="break-all whitespace-pre-wrap">
            <span className="text-muted opacity-50 mr-2">
              [{formatTick(log.timestamp)}]
            </span>
            <span
              className={cn(
                "font-bold mr-2",
                log.level === "INFO" && "text-blue-400",
                log.level === "WARN" && "text-amber-400",
                log.level === "ERROR" && "text-red-400",
                log.level === "EXEC" && "text-emerald-400",
              )}
            >
              {log.level}
            </span>
            <span
              className={cn(
                "text-ink/90",
                log.level === "EXEC" && "text-emerald-500/90",
              )}
            >
              {log.message}
            </span>
          </div>
        ))}
        <p className="animate-pulse text-accent mt-2">_</p>
      </div>
    </div>
  );
}
