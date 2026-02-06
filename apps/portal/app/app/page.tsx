"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useState } from "react";

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

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_EDGE_API_BASE ?? "").replace(/\/+$/, "");
}

async function apiFetchJson(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<unknown> {
  const base = apiBase();
  if (!base) throw new Error("missing NEXT_PUBLIC_EDGE_API_BASE");

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
  });

  const json = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const msg =
      json && typeof json === "object" && typeof json.error === "string"
        ? json.error
        : `http-${response.status}`;
    throw new Error(msg);
  }
  return json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export default function AppPage() {
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
            <h1 className="fade-up">Control room</h1>
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

  return <ControlRoom />;
}

function ControlRoom() {
  const { ready, authenticated, user, login, logout, getAccessToken } =
    usePrivy();
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedBot = useMemo(
    () => bots.find((b) => b.id === selectedBotId) ?? null,
    [bots, selectedBotId],
  );

  const refresh = useCallback(async (): Promise<void> => {
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
      if (!selectedBotId && nextBots.length > 0) {
        setSelectedBotId(nextBots[0]?.id ?? null);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken, selectedBotId]);

  const refreshTrades = useCallback(
    async (botId: string): Promise<void> => {
      if (!authenticated) return;
      setLoading(true);
      setMessage(null);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("missing-access-token");
        const payload = await apiFetchJson(
          `/api/bots/${botId}/trades?limit=25`,
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
    },
    [authenticated, getAccessToken],
  );

  useEffect(() => {
    if (!ready || !authenticated) return;
    void refresh();
  }, [ready, authenticated, refresh]);

  useEffect(() => {
    if (!selectedBotId) return;
    void refreshTrades(selectedBotId);
  }, [selectedBotId, refreshTrades]);

  const [newBotName, setNewBotName] = useState("Ralph #1");
  const [walletMode, setWalletMode] = useState<"create" | "import">("create");
  const [privateKey, setPrivateKey] = useState("");

  async function createBot(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      const payload = await apiFetchJson("/api/bots", token, {
        method: "POST",
        body: JSON.stringify({
          name: newBotName,
          walletMode,
          privateKey: walletMode === "import" ? privateKey : undefined,
        }),
      });
      const botRaw = isRecord(payload) ? payload.bot : null;
      const botId =
        isRecord(botRaw) && typeof botRaw.id === "string" ? botRaw.id : null;
      if (!botId) throw new Error("bot-create-failed");
      await refresh();
      setSelectedBotId(botId);
      setPrivateKey("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function startBot(botId: string): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${botId}/start`, token, { method: "POST" });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function stopBot(botId: string): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${botId}/stop`, token, { method: "POST" });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function tickBot(botId: string): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("missing-access-token");
      await apiFetchJson(`/api/bots/${botId}/tick`, token, { method: "POST" });
      await refresh();
      await refreshTrades(botId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="topbar">
        <div className="container topbar-row">
          <a href="/" className="kicker">
            Serious Trader Ralph
          </a>
          <div className="topbar-actions">
            {ready && authenticated ? (
              <>
                <span className="muted small">
                  {user?.id ? `User ${user.id.slice(0, 10)}…` : "Signed in"}
                </span>
                <button
                  className="button secondary"
                  onClick={logout}
                  type="button"
                >
                  Log out
                </button>
              </>
            ) : (
              <button
                className="button primary"
                onClick={() => void login()}
                disabled={!ready}
                type="button"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </div>

      <section className="section">
        <div className="container">
          <h1 className="fade-up">Control room</h1>
          <p className="muted" style={{ marginTop: "1rem", maxWidth: 760 }}>
            Create bots, toggle execution, and watch the loop. Defaults are set
            to simulate swaps on mainnet until you choose to go live.
          </p>

          {!process.env.NEXT_PUBLIC_EDGE_API_BASE ? (
            <div className="card" style={{ marginTop: "1.5rem" }}>
              <p className="label">Config</p>
              <p className="muted">
                Missing <code>NEXT_PUBLIC_EDGE_API_BASE</code>.
              </p>
            </div>
          ) : null}

          {message ? (
            <div className="card" style={{ marginTop: "1.5rem" }}>
              <p className="label">Notice</p>
              <p className="muted">{message}</p>
            </div>
          ) : null}

          {ready && authenticated ? (
            <div className="grid-2" style={{ marginTop: "2rem" }}>
              <div className="card">
                <p className="label">Bots</p>
                {bots.length === 0 ? (
                  <>
                    <h2 style={{ marginTop: "0.6rem" }}>
                      Create your first Ralph bot
                    </h2>
                    <div className="form" style={{ marginTop: "1.2rem" }}>
                      <label className="label" htmlFor="bot-name">
                        Bot name
                      </label>
                      <input
                        id="bot-name"
                        className="input"
                        value={newBotName}
                        onChange={(e) => setNewBotName(e.target.value)}
                        placeholder="Ralph #1"
                      />

                      <label className="label" htmlFor="wallet-mode">
                        Wallet mode
                      </label>
                      <select
                        id="wallet-mode"
                        className="input"
                        value={walletMode}
                        onChange={(e) =>
                          setWalletMode(
                            e.target.value === "import" ? "import" : "create",
                          )
                        }
                      >
                        <option value="create">Create new wallet</option>
                        <option value="import">
                          Import existing private key
                        </option>
                      </select>

                      {walletMode === "import" ? (
                        <>
                          <label className="label" htmlFor="private-key">
                            Solana private key (base58)
                          </label>
                          <textarea
                            id="private-key"
                            className="textarea"
                            value={privateKey}
                            onChange={(e) => setPrivateKey(e.target.value)}
                            placeholder="Paste a base58 private key. We import it into Privy (encrypted) and do not store it."
                          />
                        </>
                      ) : null}

                      <div className="row">
                        <button
                          className="button primary"
                          onClick={() => void createBot()}
                          disabled={loading}
                          type="button"
                        >
                          Create bot
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => void refresh()}
                          disabled={loading}
                          type="button"
                        >
                          Refresh
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="row" style={{ marginTop: "0.8rem" }}>
                      <button
                        className="button secondary"
                        onClick={() => void refresh()}
                        disabled={loading}
                        type="button"
                      >
                        Refresh
                      </button>
                    </div>

                    <div className="list" style={{ marginTop: "1rem" }}>
                      {bots.map((bot) => (
                        <button
                          key={bot.id}
                          className={`list-item ${
                            bot.id === selectedBotId ? "active" : ""
                          }`}
                          onClick={() => setSelectedBotId(bot.id)}
                          type="button"
                        >
                          <div className="list-item-title">
                            <span>{bot.name}</span>
                            <span className={bot.enabled ? "pill on" : "pill"}>
                              {bot.enabled ? "On" : "Off"}
                            </span>
                          </div>
                          <span className="muted small">
                            {bot.walletAddress.slice(0, 10)}…
                          </span>
                        </button>
                      ))}
                    </div>

                    <div className="divider" />

                    <h3 style={{ marginTop: "1rem" }}>Add another bot</h3>
                    <div className="form" style={{ marginTop: "0.9rem" }}>
                      <label className="label" htmlFor="bot-name-2">
                        Bot name
                      </label>
                      <input
                        id="bot-name-2"
                        className="input"
                        value={newBotName}
                        onChange={(e) => setNewBotName(e.target.value)}
                        placeholder="Ralph #2"
                      />

                      <label className="label" htmlFor="wallet-mode-2">
                        Wallet mode
                      </label>
                      <select
                        id="wallet-mode-2"
                        className="input"
                        value={walletMode}
                        onChange={(e) =>
                          setWalletMode(
                            e.target.value === "import" ? "import" : "create",
                          )
                        }
                      >
                        <option value="create">Create new wallet</option>
                        <option value="import">
                          Import existing private key
                        </option>
                      </select>

                      {walletMode === "import" ? (
                        <>
                          <label className="label" htmlFor="private-key-2">
                            Solana private key (base58)
                          </label>
                          <textarea
                            id="private-key-2"
                            className="textarea"
                            value={privateKey}
                            onChange={(e) => setPrivateKey(e.target.value)}
                            placeholder="Paste a base58 private key. We import it into Privy (encrypted) and do not store it."
                          />
                        </>
                      ) : null}

                      <div className="row">
                        <button
                          className="button primary"
                          onClick={() => void createBot()}
                          disabled={loading}
                          type="button"
                        >
                          Create bot
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="card">
                <p className="label">Selected bot</p>
                {selectedBot ? (
                  <>
                    <h2 style={{ marginTop: "0.6rem" }}>{selectedBot.name}</h2>
                    <p className="muted" style={{ marginTop: "0.75rem" }}>
                      Wallet: <code>{selectedBot.walletAddress}</code>
                    </p>

                    {selectedBot.lastError ? (
                      <p className="muted" style={{ marginTop: "0.75rem" }}>
                        Last error: <code>{selectedBot.lastError}</code>
                      </p>
                    ) : null}

                    <div className="row" style={{ marginTop: "1.25rem" }}>
                      {selectedBot.enabled ? (
                        <button
                          className="button secondary"
                          onClick={() => void stopBot(selectedBot.id)}
                          disabled={loading}
                          type="button"
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          className="button primary"
                          onClick={() => void startBot(selectedBot.id)}
                          disabled={loading}
                          type="button"
                        >
                          Start
                        </button>
                      )}

                      <button
                        className="button secondary"
                        onClick={() => void tickBot(selectedBot.id)}
                        disabled={loading}
                        type="button"
                      >
                        Tick now
                      </button>

                      <button
                        className="button secondary"
                        onClick={() => void refreshTrades(selectedBot.id)}
                        disabled={loading}
                        type="button"
                      >
                        Refresh trades
                      </button>
                    </div>

                    <div className="divider" />

                    <h3 style={{ marginTop: "1rem" }}>Recent trades</h3>
                    <div className="table" style={{ marginTop: "1rem" }}>
                      {trades.length === 0 ? (
                        <p className="muted">
                          No trades yet. Configure a strategy, then start the
                          bot (defaults simulate-only).
                        </p>
                      ) : (
                        <table>
                          <thead>
                            <tr>
                              <th>Time</th>
                              <th>Market</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trades.map((t) => (
                              <tr key={t.id}>
                                <td className="muted small">{t.createdAt}</td>
                                <td className="small">{t.market ?? "-"}</td>
                                <td className="small">
                                  <span className="pill">
                                    {t.status ?? "-"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ marginTop: "0.8rem" }}>
                    Create or select a bot.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="card" style={{ marginTop: "2rem" }}>
              <p className="label">Auth</p>
              <h2 style={{ marginTop: "0.6rem" }}>Sign in to continue</h2>
              <p className="muted" style={{ marginTop: "0.9rem" }}>
                Privy drives authentication. After signing in, you will create
                your first bot and register it in the edge worker.
              </p>
              <div className="row" style={{ marginTop: "1.2rem" }}>
                <button
                  className="button primary"
                  onClick={() => void login()}
                  disabled={!ready}
                  type="button"
                >
                  Sign in
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
