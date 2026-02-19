import { Bot, Send, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../../cn";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
}

interface AgentChatProps {
  messages: Message[];
  onSendMessage: (message: string) => Promise<void>;
  onSteerMessage?: (message: string) => Promise<void>;
  loading?: boolean;
  steeringBusy?: boolean;
  className?: string;
}

export function AgentChat({
  messages,
  onSendMessage,
  onSteerMessage,
  loading,
  steeringBusy,
  className,
}: AgentChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);
  const latestMessage = messages[messages.length - 1];
  const latestMessageKey = latestMessage
    ? `${latestMessage.id}:${latestMessage.ts}:${latestMessage.content}`
    : "__empty__";

  const scrollToLatest = (behavior: ScrollBehavior) => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({
      top: node.scrollHeight,
      behavior,
    });
  };

  useEffect(() => {
    const behavior: ScrollBehavior = hasMountedRef.current ? "smooth" : "auto";
    hasMountedRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      scrollToLatest(behavior);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [latestMessageKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const msg = input;
    setInput("");
    await onSendMessage(msg);
  };

  const handleSteer = async () => {
    if (!onSteerMessage || !input.trim() || loading || steeringBusy) return;
    const msg = input;
    setInput("");
    await onSteerMessage(msg);
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-surface border-l border-border",
        className,
      )}
    >
      <div className="p-4 border-b border-border bg-surface/50 backdrop-blur">
        <h3 className="font-medium text-sm text-ink">Chat with Agent</h3>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4"
      >
        <div className="flex min-h-full flex-col justify-end gap-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3 max-w-[85%]",
                msg.role === "user" ? "ml-auto flex-row-reverse" : "",
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                  msg.role === "assistant"
                    ? "bg-accent/10 text-accent"
                    : "bg-neutral-800 text-neutral-400",
                )}
              >
                {msg.role === "assistant" ? (
                  <Bot size={16} />
                ) : (
                  <User size={16} />
                )}
              </div>

              <div
                className={cn(
                  "p-3 rounded-lg text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-none"
                    : "bg-surface-highlight border border-border rounded-tl-none",
                )}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
                <Bot size={16} className="text-accent" />
              </div>
              <div className="bg-surface-highlight border border-border p-3 rounded-lg rounded-tl-none">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce"></span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-border bg-surface"
      >
        <div className="relative flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything..."
            className="w-full bg-neutral-900 border border-neutral-700 rounded-full px-4 py-3 text-sm focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
            disabled={loading || steeringBusy}
          />
          {onSteerMessage ? (
            <button
              type="button"
              disabled={!input.trim() || loading || steeringBusy}
              className="px-3 py-2 rounded-full border border-border bg-paper text-xs text-ink hover:bg-paper/80 disabled:opacity-50"
              onClick={() => void handleSteer()}
            >
              {steeringBusy ? "Queuing..." : "Steer"}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="p-2 bg-accent text-white rounded-full hover:bg-accent/90 disabled:opacity-50 disabled:hover:bg-accent transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}
