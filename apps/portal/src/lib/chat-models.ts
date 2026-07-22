export type ChatTier = "free" | "pro";
export type TaskClass = "chat" | "analysis";
export type ChatModelChoice = "auto" | "free" | "pro";

export type ResolvedModel = {
  tier: ChatTier;
  /** AI Gateway "provider/model" string for pro; sentinel "deepseek-chat"
   * for free (raw DeepSeek path the endpoint already owns). */
  model: string;
  /** true when a frontier/pro model was actually selected — drives the
   * honest "Pro (open beta)" response label. */
  proLabel: boolean;
};

export const FREE_MODEL = "deepseek-chat";
export const PRO_MODEL = "anthropic/claude-opus-4.8";
export const PRO_LABEL = "Pro (open beta)";

/**
 * Resolve the model for a request.
 * - proAllowed = the server-side tier flag (PUBLIC_CHAT_PRO_OPEN on).
 * - choice = the user's picker value.
 * - taskClass = classifier output ("analysis" prefers pro under Auto).
 * Rules: choice "pro" AND proAllowed → pro. choice "free" → free.
 * choice "auto" → pro when proAllowed AND taskClass==="analysis", else free.
 * When proAllowed is false, pro is NEVER selected regardless of choice
 * (server is the authority — a client asking for pro without the flag gets
 * free). proLabel === (tier === "pro").
 */
export function resolveModel(
  choice: ChatModelChoice,
  taskClass: TaskClass,
  proAllowed: boolean,
): ResolvedModel {
  const tier: ChatTier =
    proAllowed &&
    (choice === "pro" || (choice === "auto" && taskClass === "analysis"))
      ? "pro"
      : "free";

  return {
    tier,
    model: tier === "pro" ? PRO_MODEL : FREE_MODEL,
    proLabel: tier === "pro",
  };
}
