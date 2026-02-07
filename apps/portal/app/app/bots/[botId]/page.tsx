"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Bot = {
  id: string;
  name: string;
  enabled: boolean;
  signerType: string;
  privyWalletId: string;
  walletAddress: string;
  lastTickAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type Trade = {
  id: number;
  tenantId: string;
  runId: string | null;
  venue: string | null;
  market: string | null;
  side: string | null;
  size: string | null;
  price: string | null;
  status: string | null;
  logKey: string | null;
  signature: string | null;
  createdAt: string;
};

type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
};

type Thread = {
  id: string;
  title: string;
  updatedAt: string;
  messages: ThreadMessage[];
};

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_EDGE_API_BASE ?? "").replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function apiFetchJson(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<unknown> {
  const base = apiBase();
  if (!base) throw new Error("missing NEXT_PUBLIC_EDGE_API_BASE");

  const headers = new Headers(init?.headers);
  const token = accessToken.trim();
  headers.set(
    "authorization",
    /^bearer\\s+/i.test(token) ? token : `Bearer ${token}`,
  );
  // Only set content-type when we actually send a body (avoids unnecessary CORS preflights).
  if (init?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
  });

  const json = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const msg =
      isRecord(json) && typeof json.error === "string"
        ? String(json.error)
        : `http-${response.status}`;
    throw new Error(msg);
  }
  return json;
}

function formatRelativeTime(input: string): string {
  const ts = Date.parse(input);
  if (!Number.isFinite(ts)) return "";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "now";
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function storageKey(botId: string): string {
  return `ralph:threads:${botId}`;
}

function defaultThread(): Thread {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "General",
    updatedAt: now,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        ts: now,
        content:
          "This is your bot workspace. Chat threads are local-only for now. Use the controls to start/stop and tick the loop.",
      },
    ],
  };
}

function loadThreads(botId: string): Thread[] {
  try {
    const raw = localStorage.getItem(storageKey(botId));
    if (!raw) return [defaultThread()];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [defaultThread()];
    const threads = parsed.filter((t) => isRecord(t)) as Thread[];
    return threads.length > 0 ? threads : [defaultThread()];
  } catch {
    return [defaultThread()];
  }
}

function saveThreads(botId: string, threads: Thread[]): void {
  try {
    localStorage.setItem(storageKey(botId), JSON.stringify(threads));
  } catch {
    // Ignore localStorage failures (private mode, quota, etc).
  }
}

export default function BotWorkspacePage() {
  const params = useParams<{ botId: string }>();
  const botId = params?.botId ?? "";

  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return (
      <main>
        <div className="topbar">
          <div className="container topbar-row">
            <a href="/" className="kicker">
              Serious Trader Ralph
            </a>
          </div>
        </div>
        <section className="section">
          <div className="container">
            <h1 className="fade-up">Bot workspace</h1>
            <div className="card" style={{ marginTop: "2rem" }}>
              <p className="label">Config</p>
              <h2 style={{ marginTop: "0.6rem" }}>Missing Privy app id</h2>
              <p className="muted" style={{ marginTop: "0.9rem" }}>
                Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in{" "}
                <code>apps/portal/.env.local</code>.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return <BotWorkspace botId={botId} />;
}

function BotWorkspace({ botId }: { botId: string }) {
  const { ready, authenticated, user, login, logout, getAccessToken } =
    usePrivy();

  const [bots, setBots] = useState<Bot[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bottomPanel, setBottomPanel] = useState<{
    open: boolean;
    tab: "trades" | "logs" | "config";
  }>({ open: true, tab: "trades" });

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  const bot = useMemo(
    () => bots.find((b) => b.id === botId) ?? null,
    [bots, botId],
  );

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const refreshMe = useCallback(async (): Promise<void> => {
    if (!authenticated) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const payload = await apiFetchJson("/api/me", token, { method: "GET" });
      const nextBotsRaw = isRecord(payload) ? payload.bots : null;
      const nextBots = Array.isArray(nextBotsRaw) ? (nextBotsRaw as Bot[]) : [];
      setBots(nextBots);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken]);

  const refreshTrades = useCallback(async (): Promise<void> => {
    if (!authenticated || !botId) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const payload = await apiFetchJson(
        `/api/bots/${botId}/trades?limit=50`,
        token,
        { method: "GET" },
      );
      const nextTradesRaw = isRecord(payload) ? payload.trades : null;
      const nextTrades = Array.isArray(nextTradesRaw)
        ? (nextTradesRaw as Trade[])
        : [];
      setTrades(nextTrades);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken, botId]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void refreshMe();
  }, [ready, authenticated, refreshMe]);

  useEffect(() => {
    if (!ready) return;
    if (!botId) return;
    setThreads(loadThreads(botId));
  }, [ready, botId]);

  useEffect(() => {
    if (threads.length === 0) return;
    if (activeThreadId) return;
    setActiveThreadId(threads[0]?.id ?? null);
  }, [threads, activeThreadId]);

  useEffect(() => {
    if (!authenticated) return;
    void refreshTrades();
  }, [authenticated, refreshTrades]);

  useEffect(() => {
    // Auto-scroll to newest message.
    void activeThread?.id;
    void activeThread?.updatedAt;
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeThread?.id, activeThread?.updatedAt]);

  const createThread = useCallback(() => {
    if (!botId) return;
    const now = new Date().toISOString();
    const next: Thread = {
      id: crypto.randomUUID(),
      title: `Thread ${threads.length + 1}`,
      updatedAt: now,
      messages: [],
    };
    const nextThreads = [next, ...threads];
    setThreads(nextThreads);
    setActiveThreadId(next.id);
    saveThreads(botId, nextThreads);
  }, [botId, threads]);

  const appendMessage = useCallback(
    (threadId: string, msg: ThreadMessage) => {
      if (!botId) return;
      const nextThreads = threads.map((t) => {
        if (t.id !== threadId) return t;
        return {
          ...t,
          updatedAt: msg.ts,
          messages: [...t.messages, msg],
        };
      });
      setThreads(nextThreads);
      saveThreads(botId, nextThreads);
    },
    [botId, threads],
  );

  const sendMessage = useCallback(async (): Promise<void> => {
    if (!activeThread || !bot) return;
    const trimmed = composerText.trim();
    if (!trimmed) return;
    setComposerText("");

    const now = new Date().toISOString();
    appendMessage(activeThread.id, {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      ts: now,
    });

    // Placeholder: real “agent chat” will be wired to a proper thread store + tool loop.
    appendMessage(activeThread.id, {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Chat-driven control is not wired yet. Use Start/Stop/Tick and the bottom panels for trades/logs. (Next step: persist threads + route messages to an agent runtime.)",
      ts: new Date().toISOString(),
    });
  }, [activeThread, bot, composerText, appendMessage]);

  async function startBot(): Promise<void> {
    if (!bot) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${bot.id}/start`, token, {
        method: "POST",
      });
      await refreshMe();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function stopBot(): Promise<void> {
    if (!bot) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${bot.id}/stop`, token, { method: "POST" });
      await refreshMe();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function tickNow(): Promise<void> {
    if (!bot) return;
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${bot.id}/tick`, token, { method: "POST" });
      await refreshMe();
      await refreshTrades();
      setBottomPanel((p) => ({ ...p, open: true, tab: "trades" }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function copyWallet(address: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(address);
      setMessage("Copied wallet address.");
    } catch {
      setMessage("Copy failed.");
    }
  }

  if (!process.env.NEXT_PUBLIC_EDGE_API_BASE) {
    return (
      <main className="workspace">
        <div className="ws-sidebar">
          <div className="ws-brand">
            <Link href="/" className="ws-brand-title">
              Serious Trader Ralph
            </Link>
            <span className="ws-brand-sub">Workspace</span>
          </div>
        </div>
        <div className="ws-main">
          <div className="ws-topbar">
            <div className="ws-topbar-left">
              <span className="ws-title">Bot</span>
              <span className="ws-pill">Offline</span>
            </div>
          </div>
          <div className="ws-empty">
            <p className="ws-muted">
              Missing <code>NEXT_PUBLIC_EDGE_API_BASE</code> in{" "}
              <code>apps/portal/.env.local</code>.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="workspace">
      <aside className="ws-sidebar">
        <div className="ws-brand">
          <Link href="/" className="ws-brand-title">
            Serious Trader Ralph
          </Link>
          <span className="ws-brand-sub">Bot workspace</span>
        </div>

        <div className="ws-nav">
          <button
            type="button"
            className="ws-nav-primary"
            onClick={createThread}
            disabled={!authenticated || loading}
            title={!authenticated ? "Sign in first" : "Create a new thread"}
          >
            New thread
          </button>

          <button
            type="button"
            className="ws-nav-item"
            disabled
            title="Coming soon"
          >
            Automations
          </button>
          <button
            type="button"
            className="ws-nav-item"
            disabled
            title="Coming soon"
          >
            Skills
          </button>
        </div>

        <div className="ws-section">
          <div className="ws-section-head">
            <span>Threads</span>
            <span className="ws-muted">{threads.length}</span>
          </div>
          <div className="ws-thread-list">
            {threads.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`ws-thread ${t.id === activeThreadId ? "active" : ""}`}
                onClick={() => setActiveThreadId(t.id)}
              >
                <div className="ws-thread-row">
                  <span className="ws-thread-title">{t.title}</span>
                  <span className="ws-thread-time">
                    {formatRelativeTime(t.updatedAt)}
                  </span>
                </div>
                <span className="ws-thread-preview ws-muted">
                  {t.messages.at(-1)?.content?.slice(0, 60) ??
                    "No messages yet"}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="ws-footer">
          {ready && authenticated ? (
            <div className="ws-footer-row">
              <span className="ws-muted small">
                {user?.id ? `User ${user.id.slice(0, 10)}…` : "Signed in"}
              </span>
              <button
                type="button"
                className="ws-link"
                onClick={() => void logout()}
              >
                Log out
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="ws-nav-primary"
              onClick={() => void login()}
              disabled={!ready}
            >
              Sign in
            </button>
          )}
          <Link href="/app" className="ws-link" style={{ marginTop: "0.6rem" }}>
            Back to control room
          </Link>
        </div>
      </aside>

      <section className="ws-main">
        <header className="ws-topbar">
          <div className="ws-topbar-left">
            <span className="ws-title">
              {bot ? bot.name : botId ? "Loading bot…" : "No bot selected"}
            </span>
            <span className={`ws-pill ${bot?.enabled ? "on" : ""}`}>
              {bot?.enabled ? "On" : "Off"}
            </span>
            <div className="ws-quick">
              <button type="button" className="ws-chip" disabled>
                P&L
              </button>
              <button type="button" className="ws-chip" disabled>
                Holdings
              </button>
              <button type="button" className="ws-chip" disabled>
                Risk
              </button>
            </div>
          </div>

          <div className="ws-topbar-right">
            {bot ? (
              <>
                <button
                  type="button"
                  className="ws-action"
                  onClick={() => void copyWallet(bot.walletAddress)}
                  disabled={loading}
                  title="Copy bot wallet address"
                >
                  Copy wallet
                </button>
                {bot.enabled ? (
                  <button
                    type="button"
                    className="ws-action danger"
                    onClick={() => void stopBot()}
                    disabled={loading}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ws-action primary"
                    onClick={() => void startBot()}
                    disabled={loading}
                  >
                    Start
                  </button>
                )}
                <button
                  type="button"
                  className="ws-action"
                  onClick={() => void tickNow()}
                  disabled={loading}
                >
                  Tick
                </button>
              </>
            ) : null}
          </div>
        </header>

        {message ? (
          <output className="ws-banner">
            <span className="ws-muted">{message}</span>
          </output>
        ) : null}

        {bot?.lastError ? (
          <output className="ws-banner warn">
            <span className="ws-muted">
              Last error: <code>{bot.lastError}</code>
            </span>
          </output>
        ) : null}

        <div className="ws-content">
          <div className="ws-chat" ref={chatScrollRef}>
            {activeThread?.messages.length ? (
              <div className="ws-messages">
                {activeThread.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`ws-msg ${m.role === "user" ? "user" : "assistant"}`}
                  >
                    <div className="ws-msg-meta">
                      <span className="ws-muted small">
                        {m.role === "user" ? "You" : "Ralph"}
                      </span>
                      <span className="ws-muted small">
                        {formatRelativeTime(m.ts)}
                      </span>
                    </div>
                    <div className="ws-msg-body">{m.content}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ws-empty">
                <p className="ws-muted">No messages yet.</p>
              </div>
            )}
          </div>

          <div className="ws-composer">
            <input
              className="ws-input"
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  void sendMessage();
                }
              }}
              placeholder="Message (Cmd/Ctrl+Enter to send)"
              disabled={!authenticated || !bot}
            />
            <button
              type="button"
              className="ws-action primary"
              onClick={() => void sendMessage()}
              disabled={!authenticated || !bot || loading}
            >
              Send
            </button>
          </div>
        </div>

        <div className="ws-bottom">
          <div className="ws-bottom-bar">
            <button
              type="button"
              className={`ws-bottom-tab ${
                bottomPanel.tab === "trades" ? "active" : ""
              }`}
              onClick={() =>
                setBottomPanel((_p) => ({
                  open: true,
                  tab: "trades",
                }))
              }
            >
              Trades
            </button>
            <button
              type="button"
              className={`ws-bottom-tab ${
                bottomPanel.tab === "logs" ? "active" : ""
              }`}
              onClick={() =>
                setBottomPanel((_p) => ({
                  open: true,
                  tab: "logs",
                }))
              }
            >
              Logs
            </button>
            <button
              type="button"
              className={`ws-bottom-tab ${
                bottomPanel.tab === "config" ? "active" : ""
              }`}
              onClick={() =>
                setBottomPanel((_p) => ({
                  open: true,
                  tab: "config",
                }))
              }
            >
              Config
            </button>

            <div className="ws-bottom-spacer" />

            <button
              type="button"
              className="ws-bottom-toggle"
              onClick={() =>
                setBottomPanel((p) => ({
                  ...p,
                  open: !p.open,
                }))
              }
            >
              {bottomPanel.open ? "Hide" : "Show"}
            </button>
          </div>

          {bottomPanel.open ? (
            <div className="ws-bottom-panel">
              {bottomPanel.tab === "trades" ? (
                <div className="ws-panel">
                  <div className="ws-panel-head">
                    <span>Recent trades</span>
                    <button
                      type="button"
                      className="ws-link"
                      onClick={() => void refreshTrades()}
                      disabled={loading}
                    >
                      Refresh
                    </button>
                  </div>
                  {trades.length === 0 ? (
                    <p className="ws-muted">
                      No trades yet. Start the bot and tick it.
                    </p>
                  ) : (
                    <div className="ws-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Market</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trades.slice(0, 20).map((t) => (
                            <tr key={t.id}>
                              <td className="ws-muted small">{t.createdAt}</td>
                              <td className="small">{t.market ?? "-"}</td>
                              <td className="small">
                                <span className="ws-pill">
                                  {t.status ?? "-"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}

              {bottomPanel.tab === "logs" ? (
                <div className="ws-panel">
                  <div className="ws-panel-head">
                    <span>Logs</span>
                    <span className="ws-muted small">Viewer coming soon</span>
                  </div>
                  <p className="ws-muted">
                    Logs are written per tick to R2 as JSONL. For now, use
                    trades as your index (each trade includes a{" "}
                    <code>logKey</code> in the API).
                  </p>
                </div>
              ) : null}

              {bottomPanel.tab === "config" ? (
                <div className="ws-panel">
                  <div className="ws-panel-head">
                    <span>Bot</span>
                    <span className="ws-muted small">Read-only</span>
                  </div>
                  {bot ? (
                    <div className="ws-kv">
                      <div className="ws-kv-row">
                        <span className="ws-muted">Wallet</span>
                        <code className="ws-code">{bot.walletAddress}</code>
                      </div>
                      <div className="ws-kv-row">
                        <span className="ws-muted">Signer</span>
                        <code className="ws-code">{bot.signerType}</code>
                      </div>
                      <div className="ws-kv-row">
                        <span className="ws-muted">Enabled</span>
                        <code className="ws-code">
                          {bot.enabled ? "true" : "false"}
                        </code>
                      </div>
                    </div>
                  ) : (
                    <p className="ws-muted">Loading…</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
