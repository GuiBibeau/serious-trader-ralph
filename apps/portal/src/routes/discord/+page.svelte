<script lang="ts">
  import { onMount } from "svelte";
  import { BrandMark, Button } from "@trader-ralph/ui";
  import { page } from "$app/state";
  import {
    getPrivyAccessToken,
    initializePrivyAuth,
    loginPrivyWithCode,
    privyAuth,
    sendPrivyEmailCode,
  } from "$lib/privy-auth";

  const status = $derived(page.url.searchParams.get("status"));

  // Inline Privy email login (same flow as the terminal's auth modal,
  // rebuilt here so the terminal components stay untouched).
  let email = $state("");
  let code = $state("");
  let step = $state<"email" | "code">("email");
  let authBusy = $state(false);
  let authNote = $state("");

  // Verification kickoff state.
  let verifyBusy = $state(false);
  let refusal = $state<{ reason: string; totalUsd?: number } | null>(null);

  onMount(() => {
    void initializePrivyAuth();
  });

  // Beta-cap check before the OTP fires — same fail-open policy as the
  // terminal: only an explicit { allowed: false } blocks the send.
  async function checkBetaEligibility(address: string): Promise<boolean> {
    try {
      const response = await fetch("/api/beta/eligibility", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: address }),
      });
      if (!response.ok) return true;
      const data = (await response.json()) as { allowed?: boolean };
      return data.allowed !== false;
    } catch {
      return true;
    }
  }

  async function submitEmail(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    authBusy = true;
    authNote = "";
    try {
      if (!(await checkBetaEligibility(email))) {
        authNote = "The beta is full right now — check back soon.";
        return;
      }
      await sendPrivyEmailCode(email);
      step = "code";
      authNote = "Code sent.";
    } catch {
      authNote = "Could not send the code. Check the address and try again.";
    } finally {
      authBusy = false;
    }
  }

  async function submitCode(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    authBusy = true;
    authNote = "";
    try {
      await loginPrivyWithCode(email, code);
      code = "";
    } catch {
      authNote = "That code didn't work. Try again or resend.";
    } finally {
      authBusy = false;
    }
  }

  async function startVerification(): Promise<void> {
    verifyBusy = true;
    refusal = null;
    try {
      const token = await getPrivyAccessToken();
      if (!token) {
        refusal = { reason: "error" };
        return;
      }
      const response = await fetch("/api/discord/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ privyToken: token }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        url?: unknown;
        reason?: unknown;
        totalUsd?: unknown;
      };
      if (response.ok && typeof data.url === "string") {
        window.location.href = data.url;
        return;
      }
      refusal = {
        reason: typeof data.reason === "string" ? data.reason : "error",
        totalUsd: typeof data.totalUsd === "number" ? data.totalUsd : undefined,
      };
    } catch {
      refusal = { reason: "error" };
    } finally {
      verifyBusy = false;
    }
  }

  const fmtUsd = (value: number) =>
    `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
</script>

<svelte:head>
  <title>Trader Ralph Discord — verified active traders</title>
  <meta
    name="description"
    content="Join the Trader Ralph Discord as a verified active trader: confirm your email and hold at least $10 of USDC + SOL in your trading wallet or Phoenix margin balance."
  />
  <link rel="canonical" href="https://traderralph.com/discord" />
  <meta property="og:title" content="Trader Ralph Discord — verified active traders" />
  <meta
    property="og:description"
    content="A Discord role for traders with skin in the game: email-confirmed account, at least $10 of USDC + SOL on the platform."
  />
  <meta property="og:image" content="https://traderralph.com/og/home.png" />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="site">
  <header class="navbar">
    <div class="nav">
      <a class="brand" href="/">
        <span class="brand-mark"><BrandMark /></span>
        RALPH<span>·TERMINAL</span>
      </a>
      <Button href="/terminal">Open terminal</Button>
    </div>
  </header>

  <main class="wrap">
    <p class="eyebrow">DISCORD_VERIFY</p>
    <h1>Active traders only.</h1>
    <p class="lead">
      The Trader Ralph Discord grants the <b>Active Trader</b> role to
      accounts with skin in the game. Two requirements, checked on-chain:
    </p>

    <ol class="reqs">
      <li>
        <span class="n">1</span>
        <div>
          <h2>Email-confirmed account</h2>
          <p>Log in with the email you use for the terminal. No seed phrase, no wallet extension.</p>
        </div>
      </li>
      <li>
        <span class="n">2</span>
        <div>
          <h2>At least $10 on the platform</h2>
          <p>USDC + SOL in your wallet or Phoenix margin balance, valued at current prices when you verify.</p>
        </div>
      </li>
    </ol>

    {#if status === "success"}
      <div class="callout ok">
        <strong>You're verified.</strong>
        <span>The Active Trader role is on your account and you've been added to the server.</span>
        <div class="callout-cta">
          <Button href="https://discord.com/app">Open Discord</Button>
        </div>
      </div>
    {:else if status === "already-linked"}
      <div class="callout warn">
        <strong>Already linked.</strong>
        <span>
          This wallet or Discord account is already tied to a different
          verification. One wallet, one Discord account — no re-use.
        </span>
      </div>
    {:else if status === "expired"}
      <div class="callout warn">
        <strong>That link expired.</strong>
        <span>Verification links are valid for 10 minutes. Start again below.</span>
      </div>
    {:else if status === "not-funded"}
      <div class="callout warn">
        <strong>Wallet below the threshold.</strong>
        <span>
          Your balance was re-checked during verification and came in under
          $10 of USDC + SOL, wallet and Phoenix margin combined.
          <a href="/terminal">Fund your wallet in the terminal</a> and try again.
        </span>
      </div>
    {:else if status === "error"}
      <div class="callout err">
        <strong>Verification failed.</strong>
        <span>Something went wrong talking to Discord. Try again below.</span>
      </div>
    {/if}

    {#if status !== "success"}
      <section class="action">
        {#if !$privyAuth.configured}
          <div class="callout err">
            <strong>Login is not configured.</strong>
            <span>This deployment has no Privy app id set, so verification is unavailable.</span>
          </div>
        {:else if $privyAuth.authenticated}
          <p class="signed-in">
            Signed in as <b>{$privyAuth.email ?? "your account"}</b>
          </p>
          <Button onclick={startVerification} disabled={verifyBusy}>
            {verifyBusy ? "Checking your wallet…" : "Verify & join Discord"}
          </Button>

          {#if refusal}
            {#if refusal.reason === "not-funded"}
              <div class="callout warn">
                <strong>Wallet below the threshold.</strong>
                <span>
                  You hold
                  {refusal.totalUsd !== undefined ? fmtUsd(refusal.totalUsd) : "less than $10"}
                  of USDC + SOL across your wallet and Phoenix margin — the
                  role needs at least $10.
                  <a href="/terminal">Fund your wallet in the terminal</a> and try again.
                </span>
              </div>
            {:else if refusal.reason === "email-required"}
              <div class="callout warn">
                <strong>Email confirmation required.</strong>
                <span>
                  Your account has no confirmed email. Log in to the
                  <a href="/terminal">terminal</a> with an email code first, then verify here.
                </span>
              </div>
            {:else if refusal.reason === "wallet-required"}
              <div class="callout warn">
                <strong>No trading wallet yet.</strong>
                <span>
                  Open the <a href="/terminal">terminal</a> once so your wallet is
                  created, then come back.
                </span>
              </div>
            {:else if refusal.reason === "funding-unknown"}
              <div class="callout err">
                <strong>Could not read your balance.</strong>
                <span>
                  The balance check is temporarily unavailable — your funding
                  status is unknown, not rejected. Try again in a minute.
                </span>
              </div>
            {:else if refusal.reason === "unconfigured"}
              <div class="callout err">
                <strong>Verification is not configured.</strong>
                <span>This deployment has no Discord credentials set.</span>
              </div>
            {:else}
              <div class="callout err">
                <strong>Verification failed.</strong>
                <span>Something went wrong. Try again in a minute.</span>
              </div>
            {/if}
          {/if}
        {:else}
          <p class="signed-in">Log in with your terminal email to start.</p>
          {#if step === "email"}
            <form class="auth-form" onsubmit={submitEmail}>
              <label>
                Email address
                <input
                  bind:value={email}
                  autocomplete="email"
                  inputmode="email"
                  placeholder="you@example.com"
                  required
                  type="email"
                />
              </label>
              <Button disabled={authBusy || !$privyAuth.ready}>
                {authBusy ? "Sending code…" : !$privyAuth.ready ? "Preparing…" : "Send code"}
              </Button>
            </form>
          {:else}
            <form class="auth-form" onsubmit={submitCode}>
              <label>
                Code sent to {email}
                <input
                  class="code-input"
                  bind:value={code}
                  autocomplete="one-time-code"
                  inputmode="numeric"
                  maxlength="6"
                  placeholder="123456"
                  required
                />
              </label>
              <Button disabled={authBusy || !code.trim()}>
                {authBusy ? "Verifying…" : "Log in"}
              </Button>
              <button
                class="linklike"
                type="button"
                disabled={authBusy}
                onclick={() => {
                  step = "email";
                  code = "";
                  authNote = "";
                }}
              >
                Use another email
              </button>
            </form>
          {/if}
          {#if authNote}
            <p class="auth-note">{authNote}</p>
          {/if}
        {/if}
      </section>
    {/if}

    <p class="fine">
      Verification links a wallet to one Discord account. Balances are read
      from the Solana chain at verification time; the role is not revoked if
      you later move funds.
    </p>
  </main>
</div>

<style>
  .site {
    min-height: 100vh;
    background: var(--paper);
    color: var(--ink);
  }

  a {
    text-decoration: none;
  }

  .navbar {
    border-bottom: 1px solid var(--line-soft);
  }

  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.1rem 1.5rem;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-weight: 800;
    letter-spacing: 0.12em;
    font-size: 0.95rem;
    color: var(--ink);
  }

  .brand span.brand-mark {
    display: flex;
    width: 1.15rem;
    height: 1.15rem;
    color: var(--ink);
  }

  .brand span {
    color: var(--accent);
  }

  .wrap {
    max-width: 36rem;
    margin: 0 auto;
    padding: 4rem 1.5rem 5rem;
  }

  .eyebrow {
    margin: 0 0 0.8rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    color: var(--accent);
    font-weight: 800;
  }

  h1 {
    margin: 0 0 1rem;
    font-size: clamp(2rem, 5vw, 3rem);
    line-height: 1.05;
    letter-spacing: -0.03em;
  }

  .lead {
    color: var(--muted);
    font-size: 1rem;
    line-height: 1.6;
    margin: 0 0 2rem;
  }

  .reqs {
    list-style: none;
    margin: 0 0 2.2rem;
    padding: 0;
  }

  .reqs li {
    display: grid;
    grid-template-columns: 2.4rem minmax(0, 1fr);
    gap: 1rem;
    padding: 1.1rem 0;
    border-bottom: 1px solid var(--line-soft);
  }

  .reqs li:first-child {
    border-top: 1px solid var(--line-soft);
  }

  .reqs .n {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    color: var(--accent);
    font-weight: 700;
    padding-top: 0.15rem;
  }

  .reqs h2 {
    margin: 0 0 0.3rem;
    font-size: 1rem;
  }

  .reqs p {
    margin: 0;
    color: var(--muted);
    font-size: 0.88rem;
    line-height: 1.55;
  }

  .action {
    display: grid;
    gap: 0.9rem;
    justify-items: start;
    margin-bottom: 2rem;
  }

  .signed-in {
    margin: 0;
    color: var(--muted);
    font-size: 0.88rem;
  }

  .auth-form {
    display: grid;
    gap: 0.7rem;
    width: 100%;
    max-width: 22rem;
    justify-items: start;
  }

  .auth-form label {
    display: grid;
    gap: 0.35rem;
    width: 100%;
    color: var(--muted);
    font-size: 0.78rem;
  }

  .auth-form input {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    padding: 0.55rem 0.7rem;
    font-size: 0.9rem;
    width: 100%;
    box-sizing: border-box;
  }

  .code-input {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 1.2rem;
    letter-spacing: 0.4rem;
  }

  .linklike {
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 0.76rem;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .linklike:hover:not(:disabled) {
    color: var(--ink);
  }

  .auth-note {
    margin: 0;
    color: var(--muted);
    font-size: 0.8rem;
  }

  .callout {
    display: grid;
    gap: 0.35rem;
    padding: 0.9rem 1rem;
    background: var(--surface);
    border: 1px solid var(--line);
    font-size: 0.85rem;
    line-height: 1.5;
    margin-bottom: 1.4rem;
    max-width: 100%;
  }

  .callout strong {
    color: var(--ink);
  }

  .callout span {
    color: var(--muted);
  }

  .callout span a {
    color: var(--accent);
    font-weight: 600;
  }

  .callout.ok {
    border-color: var(--up);
  }

  .callout.warn {
    border-color: var(--amber);
  }

  .callout.err {
    border-color: var(--down);
  }

  .callout-cta {
    margin-top: 0.5rem;
  }

  .fine {
    color: var(--faint);
    font-size: 0.74rem;
    line-height: 1.6;
    border-top: 1px solid var(--line-soft);
    padding-top: 1.2rem;
    margin: 0;
  }
</style>
