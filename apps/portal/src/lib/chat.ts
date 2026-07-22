// Side-chat client: a thin Svelte store + fetch transport (PRD #563, WP2).
//
// The store holds only user/assistant turns plus a coarse phase; the pure
// desk-context serializer (chat-context.ts) builds the payload and this
// module POSTs it to the same-origin /api/chat endpoint. Auth uses the Privy
// access token — the app's sole credential, which the edge layer reuses too
// (edge-data.ts), so it doubles as the edge tool token when present. State
// machine: push user turn → "waiting" → on reply push assistant turn +
// "idle"; on a null reply push a literal fallback + "idle"; 401 → "auth";
// 429 → "limit"; any other non-ok status or a network failure → "error".
// Never auto-retries. No transport test by design (anti-flake); the pure
// serializer is the unit-tested surface.

import { get, type Writable, writable } from "svelte/store";
import type { ChatMessage } from "./chat-core";
import type { ChatModelChoice } from "./chat-models";
import { getPrivyAccessToken } from "./privy-auth";

const CHAT_OPEN_KEY = "harness.chat.v1";
const CHAT_ENDPOINT = "/api/chat";
const UNGROUNDED_FALLBACK = "I can't ground that answer in the data I have.";

export type ChatUiMessage = ChatMessage & {
  model?: string;
  proLabel?: boolean;
};

export type ChatState = {
  open: boolean;
  phase: "idle" | "waiting" | "error" | "limit" | "auth";
  messages: ChatUiMessage[]; // user/assistant turns only
  error: string | null;
  modelChoice: ChatModelChoice;
  lastReplyModel: string | null;
  lastReplyProLabel: boolean;
};

type PersistedChatState = {
  open: boolean;
  modelChoice: ChatModelChoice;
};

const persisted = readPersistedChatState();

export const chatState: Writable<ChatState> = writable<ChatState>({
  open: persisted.open,
  phase: "idle",
  messages: [],
  error: null,
  modelChoice: persisted.modelChoice,
  lastReplyModel: null,
  lastReplyProLabel: false,
});

// Persist ONLY the open/closed flag and model choice, lazily and SSR-safe.
// Best-effort: a blocked quota / private mode is non-fatal — the store keeps
// working. Legacy "1"/"0" payloads remain readable.
if (typeof localStorage !== "undefined") {
  chatState.subscribe((state) => {
    try {
      localStorage.setItem(
        CHAT_OPEN_KEY,
        JSON.stringify({ open: state.open, modelChoice: state.modelChoice }),
      );
    } catch {
      // localStorage unavailable — persistence is best-effort.
    }
  });
}

export function toggleChat(): void {
  chatState.update((state) => ({ ...state, open: !state.open }));
}

export function closeChat(): void {
  chatState.update((state) => ({ ...state, open: false }));
}

export function setModelChoice(modelChoice: ChatModelChoice): void {
  chatState.update((state) => ({ ...state, modelChoice }));
}

/** POST /api/chat. Attaches Authorization from getPrivyAccessToken() and the
 * edge token when one resolves. See module header for the state machine. */
export async function sendChatMessage(
  text: string,
  context: Record<string, unknown>,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  pushMessage({ role: "user", content: trimmed });
  setPhase("waiting");

  let token: string | null = null;
  try {
    token = await getPrivyAccessToken();
  } catch {
    // No usable credential (Privy unconfigured/unavailable) — same lane as 401.
    setPhase("auth");
    return;
  }

  let response: Response;
  try {
    const state = get(chatState);
    response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify(
        buildBody(token, state.messages, context, state.modelChoice),
      ),
    });
  } catch (error) {
    setError(networkErrorMessage(error));
    return;
  }

  if (response.status === 401) {
    setPhase("auth");
    return;
  }
  if (response.status === 429) {
    setPhase("limit");
    return;
  }
  if (!response.ok) {
    setError(`chat-http-${response.status}`);
    return;
  }

  let payload: { reply?: string | null; model?: unknown; proLabel?: unknown } =
    {};
  try {
    payload = (await response.json()) as {
      reply?: string | null;
      model?: unknown;
      proLabel?: unknown;
    };
  } catch {
    setError("chat-bad-response");
    return;
  }

  const reply = typeof payload.reply === "string" ? payload.reply.trim() : "";
  const model = typeof payload.model === "string" ? payload.model : null;
  const proLabel = payload.proLabel === true;
  pushMessage({
    role: "assistant",
    content: reply.length > 0 ? reply : UNGROUNDED_FALLBACK,
    ...(model ? { model } : {}),
    proLabel,
  });
  recordReplyMetadata(model, proLabel);
  setPhase("idle");
}

function pushMessage(message: ChatUiMessage): void {
  chatState.update((state) => ({
    ...state,
    messages: [...state.messages, message],
  }));
}

function recordReplyMetadata(model: string | null, proLabel: boolean): void {
  chatState.update((state) => ({
    ...state,
    lastReplyModel: model,
    lastReplyProLabel: proLabel,
  }));
}

function setPhase(phase: ChatState["phase"]): void {
  chatState.update((state) => ({ ...state, phase, error: null }));
}

function setError(message: string): void {
  chatState.update((state) => ({ ...state, phase: "error", error: message }));
}

function buildHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

function buildBody(
  token: string | null,
  history: ChatUiMessage[],
  context: Record<string, unknown>,
  modelChoice: ChatModelChoice,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    history: history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    context,
    modelChoice,
  };
  if (token) {
    body.edgeToken = token;
  }
  return body;
}

function networkErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "chat-network-error";
}

function readPersistedChatState(): PersistedChatState {
  const fallback: PersistedChatState = { open: false, modelChoice: "auto" };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(CHAT_OPEN_KEY);
    if (raw === "1") return { ...fallback, open: true };
    if (raw === "0" || raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return fallback;
    return {
      open: typeof parsed.open === "boolean" ? parsed.open : fallback.open,
      modelChoice: isChatModelChoice(parsed.modelChoice)
        ? parsed.modelChoice
        : fallback.modelChoice,
    };
  } catch {
    return fallback;
  }
}

function isChatModelChoice(value: unknown): value is ChatModelChoice {
  return value === "auto" || value === "free" || value === "pro";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
