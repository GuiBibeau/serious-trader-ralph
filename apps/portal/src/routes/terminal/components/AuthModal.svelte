<script lang="ts">
  import {
    loginPrivyWithCode,
    privyAuth,
    readPrivyConfig,
    sendPrivyEmailCode,
  } from "$lib/privy-auth";
  import {
    humanizePrivyError,
    shortAddress,
    walletStatusText,
  } from "$lib/terminal/account-format";

  let {
    onclose,
    onauthenticated,
  }: {
    onclose: () => void;
    onauthenticated?: () => void | Promise<void>;
  } = $props();

  const privyConfig = readPrivyConfig();

  // Mount-time seeding replaces the page's old openAuthModal() prep: resume
  // at the code step when a code is already in flight, prefill a known email.
  let authEmail = $state($privyAuth.email ?? "");
  let authCode = $state("");
  let authBusy = $state(false);
  let authStep: "email" | "code" = $state($privyAuth.otpSentTo ? "code" : "email");
  let authMessage = $state($privyAuth.error ?? "");

  let authNote = $derived(humanizePrivyError(authMessage || $privyAuth.error));
  let authNoteIsError = $derived(
    Boolean($privyAuth.error) ||
      (Boolean(authMessage) && authMessage !== "Code sent."),
  );
  let walletStatusLabel = $derived(walletStatusText($privyAuth.walletStatus));

  // Modals may keep keys away from the global hotkeys, but never Escape —
  // the window handler owns close-on-Esc no matter where focus sits.
  function swallowKeysExceptEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape") event.stopPropagation();
  }

  async function submitAuthEmail(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    authBusy = true;
    authMessage = "";
    try {
      await sendPrivyEmailCode(authEmail);
      authStep = "code";
      authMessage = "Code sent.";
    } catch (error) {
      authMessage = error instanceof Error ? error.message : "privy-code-send-failed";
    } finally {
      authBusy = false;
    }
  }

  async function resendAuthCode(): Promise<void> {
    if (authBusy || !authEmail) return;
    authBusy = true;
    authMessage = "";
    try {
      await sendPrivyEmailCode(authEmail);
      authMessage = "Code sent.";
    } catch (error) {
      authMessage = error instanceof Error ? error.message : "privy-code-send-failed";
    } finally {
      authBusy = false;
    }
  }

  function backToEmailStep(): void {
    authStep = "email";
    authCode = "";
    authMessage = "";
  }

  async function submitAuthCode(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    authBusy = true;
    authMessage = "";
    try {
      await loginPrivyWithCode(authEmail, authCode);
      authCode = "";
      onclose();
      await onauthenticated?.();
    } catch (error) {
      authMessage = error instanceof Error ? error.message : "privy-login-failed";
    } finally {
      authBusy = false;
    }
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={() => onclose()}>
  <section
    class="modal auth-modal"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={swallowKeysExceptEscape}
  >
    <div class="panel-head">
      <div>
        <p>PRIVY_AUTH</p>
        <h2>Connect account</h2>
      </div>
      <button class="modal-close" type="button" aria-label="Close" onclick={() => onclose()}>×</button>
    </div>

    <div class="modal-body">
      {#if !privyConfig.appId}
        <div class="auth-callout error">
          <strong>Auth is not configured</strong>
          <span>Set <code>PUBLIC_PRIVY_APP_ID</code> (or <code>VITE_PRIVY_APP_ID</code> / <code>NEXT_PUBLIC_PRIVY_APP_ID</code>) for this frontend, then reload.</span>
        </div>
      {:else if $privyAuth.authenticated}
        <div class="auth-success">
          <span class="auth-check" aria-hidden="true">✓</span>
          <strong>You're connected</strong>
          <span>{$privyAuth.email ?? shortAddress($privyAuth.walletAddress)}</span>
          <span class="wallet-badge {$privyAuth.walletStatus}">{walletStatusLabel}</span>
          <button class="primary wide" type="button" onclick={() => onclose()}>Done</button>
        </div>
      {:else}
        <ol class="auth-steps" aria-hidden="true">
          <li class:active={authStep === "email"} class:done={authStep === "code"}>
            <span class="step-dot">1</span> Email
          </li>
          <li class="step-divider"></li>
          <li class:active={authStep === "code"}>
            <span class="step-dot">2</span> Verify
          </li>
        </ol>

        {#if authStep === "email"}
          <p class="auth-lead">Sign in with your email — we'll send a one-time code. A Solana wallet is provisioned automatically.</p>
          <form class="auth-form" onsubmit={submitAuthEmail}>
            <label>
              Email address
              <input
                bind:value={authEmail}
                autocomplete="email"
                inputmode="email"
                placeholder="you@example.com"
                required
                type="email"
              />
            </label>
            <button class="primary wide" type="submit" disabled={authBusy || !$privyAuth.ready}>
              {#if authBusy}<span class="spinner" aria-hidden="true"></span>{/if}
              {authBusy ? "Sending code…" : !$privyAuth.ready ? "Preparing…" : "Send code"}
            </button>
          </form>
        {:else}
          <p class="auth-lead">Enter the 6-digit code sent to <b>{authEmail || "your email"}</b>.</p>
          <form class="auth-form" onsubmit={submitAuthCode}>
            <label>
              Verification code
              <input
                class="code-input"
                bind:value={authCode}
                autocomplete="one-time-code"
                inputmode="numeric"
                maxlength="6"
                placeholder="123456"
                required
              />
            </label>
            <button class="primary wide" type="submit" disabled={authBusy || !authCode.trim()}>
              {#if authBusy}<span class="spinner" aria-hidden="true"></span>{/if}
              {authBusy ? "Verifying…" : "Verify & connect"}
            </button>
            <div class="auth-secondary">
              <button class="linklike" type="button" disabled={authBusy} onclick={backToEmailStep}>
                Use another email
              </button>
              <button class="linklike" type="button" disabled={authBusy} onclick={resendAuthCode}>
                Resend code
              </button>
            </div>
          </form>
        {/if}
      {/if}

      {#if authNote && !$privyAuth.authenticated}
        <p class="auth-note" class:error={authNoteIsError}>{authNote}</p>
      {/if}
    </div>
  </section>
</div>

<style>
  .auth-form {
    display: grid;
    gap: 0.7rem;
  }

  .auth-steps {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .auth-steps li {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--faint);
    font-size: 0.74rem;
    font-weight: 600;
  }

  .auth-steps li.active {
    color: var(--ink);
  }

  .auth-steps li.done {
    color: var(--accent);
  }

  .auth-steps .step-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    border: 1px solid currentColor;
    font-size: 0.72rem;
  }

  .auth-steps li.active .step-dot {
    background: var(--accent);
    border-color: var(--accent);
    color: #04130d;
  }

  .step-divider {
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .code-input {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 1.3rem;
    letter-spacing: 0.5rem;
    text-align: center;
  }

  .auth-secondary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .linklike {
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 0.74rem;
    padding: 0.2rem 0;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .linklike:hover:not(:disabled) {
    color: var(--ink);
  }

  .auth-callout {
    display: grid;
    gap: 0.35rem;
    border-radius: 0;
    padding: 0.85rem;
    background: var(--surface-2);
    border: 1px solid var(--line);
    font-size: 0.8rem;
    line-height: 1.45;
  }

  .auth-callout.error {
    border-color: rgba(240, 107, 99, 0.35);
  }

  .auth-callout strong {
    color: var(--ink);
  }

  .auth-callout span {
    color: var(--muted);
  }

  .auth-callout code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.74rem;
    color: var(--blue);
  }

  .auth-success {
    display: grid;
    justify-items: center;
    gap: 0.5rem;
    text-align: center;
    padding: 0.5rem 0;
  }

  .auth-success strong {
    font-size: 1rem;
  }

  .auth-success span {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .auth-success .wide {
    margin-top: 0.5rem;
  }

  .auth-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 1.3rem;
    font-weight: 800;
  }
</style>
