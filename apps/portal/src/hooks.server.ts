// Server hooks. The terminal is a pure client app (`ssr = false` in
// src/routes/terminal/+layout.ts), so its <svelte:head> never runs on the
// server and scrapers only see the bare app shell. Inject the /terminal
// OG/meta tags into the served HTML here instead.

import type { Handle } from "@sveltejs/kit";

const TERMINAL_HEAD = [
  "<title>Trader Ralph Terminal — perps &amp; spot on Solana</title>",
  '<meta property="og:title" content="Trader Ralph Terminal — perps &amp; spot on Solana" />',
  '<meta property="og:description" content="Phoenix perps and Jupiter spot from one USDC account. Email login, no seed phrase." />',
  '<meta property="og:image" content="https://traderralph.com/og/terminal.png" />',
  '<meta name="twitter:card" content="summary_large_image" />',
].join("\n    ");

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname !== "/terminal") return resolve(event);

  // Anchor choice: `</head>` from src/app.html. With SSR disabled the shell
  // is the rendered template, where `</head>` appears exactly once and is a
  // stable literal (unlike %sveltekit.head%, which is substituted away
  // before transformPageChunk runs). String#replace only touches the first
  // occurrence, and the pathname guard above keeps every other route
  // untouched — no double injection.
  return resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace("</head>", `${TERMINAL_HEAD}\n  </head>`),
  });
};
