import { format } from "date-fns";
import { useEffect, useRef } from "react";
import { cn } from "../../../../cn";

interface Thought {
  id: string;
  ts: number;
  content: string;
  category: "planning" | "execution" | "reflection";
}

interface AgentThoughtsLogProps {
  thoughts: Thought[];
  className?: string;
}

function formatThoughtTime(ts: number): string {
  if (!Number.isFinite(ts)) return "--:--:--";
  try {
    return format(new Date(ts), "HH:mm:ss");
  } catch {
    return "--:--:--";
  }
}

export function AgentThoughtsLog({
  thoughts,
  className,
}: AgentThoughtsLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);
  const latestThought = thoughts[thoughts.length - 1];
  const latestThoughtKey = latestThought
    ? `${latestThought.id}:${latestThought.ts}:${latestThought.content}`
    : "__empty__";

  const scrollToLatest = (behavior: ScrollBehavior) => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
  };

  useEffect(() => {
    const behavior: ScrollBehavior = hasMountedRef.current ? "smooth" : "auto";
    hasMountedRef.current = true;

    const frame = window.requestAnimationFrame(() => {
      scrollToLatest(behavior);
    });
    // Second pass ensures we stay pinned after late layout/paint work on refresh.
    const settleTimer = window.setTimeout(() => {
      scrollToLatest("auto");
    }, 90);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
    };
  }, [latestThoughtKey]);

  return (
    <div
      className={cn(
        "flex flex-col h-full min-h-0 bg-[#0a0a0a] font-mono text-xs overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-800">
        <span className="font-semibold text-neutral-400 uppercase tracking-wider">
          Agent Thoughts
        </span>
        <div className="flex gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4"
      >
        <div className="flex min-h-full flex-col justify-end gap-3">
          {thoughts.length === 0 && (
            <div className="text-neutral-600 italic text-center py-8">
              No thoughts recorded yet...
            </div>
          )}
          {thoughts.map((thought) => (
            <div
              key={thought.id}
              className="flex gap-3 group animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              <div className="flex-shrink-0 w-16 text-neutral-600 text-[10px] pt-0.5">
                {formatThoughtTime(thought.ts)}
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded uppercase font-bold",
                      thought.category === "planning"
                        ? "bg-blue-500/10 text-blue-400"
                        : thought.category === "execution"
                          ? "bg-purple-500/10 text-purple-400"
                          : "bg-orange-500/10 text-orange-400",
                    )}
                  >
                    {thought.category}
                  </span>
                </div>
                <p className="text-neutral-300 leading-relaxed font-mono">
                  {thought.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
