<script lang="ts">
  // Side-chat dock — the visible half of PRD #563 (WP3).
  //
  // Summon-only right-dock: zero weight when closed (the page lazy-mounts this
  // component only on first open). The panel never imports page state — the
  // page hands it a buildContext closure that snapshots the live desk at send
  // time, and an onRequestAuth callback for the sign-in nudge. All transport +
  // state live in $lib/chat (WP2); this component is presentation only.
  //
  // Svelte 5 runes only (pitfall 5): $props/$state/$effect, no export let / $:.
  import {
    chatState,
    closeChat,
    sendChatMessage,
    setModelChoice,
  } from "$lib/chat";
  import { PRO_LABEL, type ChatModelChoice } from "$lib/chat-models";

  let {
    buildContext,
    onRequestAuth,
  }: {
    buildContext: () => Record<string, unknown>;
    onRequestAuth: () => void;
  } = $props();

  let draft = $state("");
  let scrollEl: HTMLDivElement | null = $state(null);

  const modelChoices: { value: ChatModelChoice; label: string }[] = [
    { value: "auto", label: "Auto" },
    { value: "free", label: "Free" },
    { value: "pro", label: "Pro" },
  ];

  // Pin the conversation to its newest turn whenever the list grows or the
  // phase flips to the waiting skeleton.
  $effect(() => {
    if (!scrollEl) return;
    void $chatState.messages.length;
    void $chatState.phase;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const text = draft;
    draft = "";
    void sendChatMessage(text, buildContext());
  }
</script>

<div class="desk-dock" role="complementary" aria-label="Desk chat">
  <header class="desk-head">
    <div class="desk-title-row">
      <span class="desk-title">Desk</span>
      <div class="desk-model-picker" role="radiogroup" aria-label="Chat model">
        {#each modelChoices as choice (choice.value)}
          <button
            class:active={$chatState.modelChoice === choice.value}
            type="button"
            aria-pressed={$chatState.modelChoice === choice.value}
            onclick={() => setModelChoice(choice.value)}
          >
            {choice.label}
          </button>
        {/each}
      </div>
    </div>
    <button class="ghost" type="button" onclick={closeChat}>Close</button>
  </header>

  <div class="desk-scroll" bind:this={scrollEl}>
    {#if $chatState.messages.length === 0 && $chatState.phase === "idle"}
      <p class="desk-empty">Ask the desk about your book or the tape.</p>
    {/if}

    {#each $chatState.messages as message, index (index)}
      <div class="desk-msg {message.role}">{#if message.role === "assistant" && message.proLabel}<span class="desk-pro-tag">{PRO_LABEL}</span>{/if}{message.content}</div>
    {/each}

    {#if $chatState.phase === "waiting"}
      <div class="desk-skeleton" aria-hidden="true">
        <i></i>
        <i></i>
      </div>
    {/if}

    {#if $chatState.phase === "auth"}
      <div class="desk-state">
        <p>Sign in to talk to the desk.</p>
        <button class="primary desk-state-action" type="button" onclick={onRequestAuth}>
          Sign in
        </button>
      </div>
    {:else if $chatState.phase === "limit"}
      <p class="desk-state">Daily limit reached — resets at UTC midnight.</p>
    {:else if $chatState.phase === "error"}
      <p class="desk-state desk-state-error">{$chatState.error ?? "chat-error"}</p>
    {/if}
  </div>

  <form class="desk-form" onsubmit={submit}>
    <label class="desk-input-label" for="desk-input">Message the desk</label>
    <textarea
      id="desk-input"
      class="desk-input"
      bind:value={draft}
      rows="2"
      placeholder="Message the desk…"
      disabled={$chatState.phase === "waiting"}
    ></textarea>
    <button
      class="secondary desk-send"
      type="submit"
      disabled={$chatState.phase === "waiting" || draft.trim().length === 0}
    >
      Send
    </button>
  </form>
</div>

<style>
  /* Desktop: a sticky right column in the dashboard's reserved 380px track.
     The page adds that track (via .dashboard.chat-open) only when open, so
     closed = this component isn't mounted = zero layout effect. The dock
     spans many grid rows so position:sticky keeps it pinned for the whole
     dashboard scroll (the dashboard has no explicit grid-template-rows, so
     `1 / -1` can't be used — a generous span is the reliable form). */
  .desk-dock {
    /* Fixed, not sticky-in-grid: the grid places row 1 below the rail's
       actual content offset (~97px past --anchor-top), so a sticky panel
       sized to 100dvh - anchor starts that much too low and pushes the
       input below the fold at scroll 0 (geometry-probed). Fixed pins the
       whole panel — input included — into the viewport; the dashboard's
       empty 380px 13th track (.chat-open) reserves the layout space this
       panel visually occupies. --anchor-top still inherits from .dashboard. */
    position: fixed;
    right: 0;
    top: var(--anchor-top, 3rem);
    width: 380px;
    height: calc(100dvh - var(--anchor-top, 3rem));
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border-left: 1px solid var(--line);
    z-index: 15; /* below topbar (20), above panel content */
  }

  .desk-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .desk-title-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }

  .desk-title {
    color: var(--accent);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .desk-model-picker {
    display: inline-flex;
    border: 1px solid var(--line-soft);
    background: var(--surface-2);
  }

  .desk-model-picker button {
    color: var(--muted);
    font: inherit;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 0.22rem 0.35rem;
    border: 0;
    border-right: 1px solid var(--line-soft);
    background: transparent;
    cursor: pointer;
  }

  .desk-model-picker button:last-child {
    border-right: 0;
  }

  .desk-model-picker button.active {
    color: var(--accent);
    background: var(--surface);
  }

  .desk-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
  }

  .desk-empty {
    margin: auto;
    color: var(--faint);
    font-size: 0.76rem;
    line-height: 1.45;
    text-align: center;
  }

  /* Plain text only — no markdown. pre-wrap preserves the model's line breaks. */
  .desk-msg {
    color: var(--ink);
    font-size: 0.8rem;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .desk-pro-tag {
    display: block;
    width: fit-content;
    margin-bottom: 0.25rem;
    color: var(--accent);
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .desk-msg.user {
    align-self: flex-end;
    max-width: 85%;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--line-soft);
    background: var(--surface-2);
  }

  /* Assistant turns wear the same accent left-rule as AiReadLine's desk note
     (--pink isn't a token; #ff4d97 is --accent). */
  .desk-msg.assistant {
    border-left: 2px solid var(--accent);
    padding-left: 0.5rem;
  }

  /* Waiting skeleton — AiReadLine's rhythm (two bars, 2.2s sweep) copied in so
     this chunk doesn't pull AiReadLine. Token-only gradient (no fallback hex). */
  .desk-skeleton {
    border-left: 2px solid var(--accent);
    padding-left: 0.5rem;
    display: grid;
    gap: 0.45rem;
  }

  .desk-skeleton i {
    display: block;
    height: 0.5rem;
    background-color: var(--surface-2);
    background-image: linear-gradient(
      90deg,
      transparent 25%,
      var(--accent-soft) 50%,
      transparent 75%
    );
    background-size: 280% 100%;
    animation: desk-shimmer 2.2s ease-in-out infinite;
  }

  .desk-skeleton i:last-child {
    width: 62%;
    animation-delay: 180ms;
  }

  @keyframes desk-shimmer {
    0% {
      background-position: 150% 0;
    }
    100% {
      background-position: -150% 0;
    }
  }

  /* Honest limit/auth/error notes, centered like the empty state. */
  .desk-state {
    margin: auto;
    display: grid;
    gap: 0.5rem;
    justify-items: center;
    color: var(--muted);
    font-size: 0.78rem;
    line-height: 1.45;
    text-align: center;
  }

  .desk-state p {
    margin: 0;
  }

  .desk-state-error {
    color: var(--red);
  }

  .desk-form {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem 0.75rem;
    border-top: 1px solid var(--line-soft);
  }

  /* Visually-hidden label (a11y): the textarea's placeholder is not a label. */
  .desk-input-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .desk-input {
    resize: none;
    width: 100%;
    color: var(--ink);
    font: inherit;
    font-size: 0.8rem;
    padding: 0.45rem 0.55rem;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }

  .desk-input:focus {
    border-color: var(--accent);
    outline: 1px solid var(--accent);
    outline-offset: 0;
  }

  .desk-input::placeholder {
    color: var(--faint);
  }

  .desk-send {
    align-self: flex-end;
  }

  /* Mobile (<1101px): the dashboard stops reserving a track; the dock becomes
     a full-viewport sheet under the sticky chrome. */
  @media (max-width: 1100px) {
    .desk-dock {
      position: fixed;
      inset: 0;
      top: var(--anchor-top, 3rem);
      width: auto;
      height: auto;
      grid-column: auto;
      grid-row: auto;
      z-index: 30;
      border-left: none;
    }
  }
</style>
