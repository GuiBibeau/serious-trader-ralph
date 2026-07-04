// Pure account/auth display helpers for the terminal page — address/email
// truncation, wallet status copy, and the error humanizers. All close over
// no component state; moved verbatim from the page.

import type { PrivyAuthState } from "$lib/privy-auth";

export function shortAddress(value: string | null): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "--";
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export function shortEmail(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 22) return trimmed;
  const [name, domain] = trimmed.split("@");
  if (!domain) return `${trimmed.slice(0, 19)}…`;
  const head = name.length > 10 ? `${name.slice(0, 9)}…` : name;
  return `${head}@${domain}`;
}

export function walletStatusText(
  status: "missing" | "creating" | "ready" | "error",
): string {
  switch (status) {
    case "ready":
      return "Wallet ready";
    case "creating":
      return "Creating wallet…";
    case "error":
      return "Wallet error";
    default:
      return "No wallet";
  }
}

export function walletFundsLabel(
  auth: PrivyAuthState,
  balanceStatus: "idle" | "loading" | "ready" | "error",
  fundsText: string,
): string {
  if (!auth.authenticated) {
    if (!auth.configured) return "Auth unconfigured";
    if (!auth.ready) return "Privy loading";
    return "Account not connected";
  }
  if (auth.walletStatus === "creating") return "Creating wallet";
  if (auth.walletStatus === "error") return "Wallet unavailable";
  if (!auth.walletAddress) return "Wallet pending";
  if (balanceStatus === "loading") return "Loading funds";
  if (balanceStatus === "error") return "Balance unavailable";
  return fundsText;
}

export function humanizePrivyError(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const known: Record<string, string> = {
    "email-required": "Enter a valid email address.",
    "code-required": "Enter the 6-digit code we emailed you.",
    "privy-app-id-missing": "Auth is not configured for this environment.",
    "privy-not-configured": "Auth is not configured for this environment.",
    "privy-code-send-failed":
      "Couldn't send the code. Check the email and try again.",
    "privy-login-failed": "That code didn't work. Request a new one and retry.",
    "privy-logout-failed": "Couldn't log out cleanly. Try again.",
    "Code sent.": "Code sent — check your inbox.",
  };
  if (known[raw]) return known[raw];
  // Surface Privy SDK messages verbatim; tidy our internal kebab-case codes.
  if (/^[a-z0-9-]+$/.test(raw)) {
    return raw.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }
  return raw;
}

export function humanizeBalanceError(raw: string): string {
  if (/-40[13]$/.test(raw) || /forbidden/i.test(raw)) {
    return "RPC blocked the request. Set PUBLIC_SOLANA_RPC_URL to a browser-accessible endpoint.";
  }
  if (/-429$/.test(raw))
    return "RPC rate-limited. Set a dedicated PUBLIC_SOLANA_RPC_URL.";
  if (/^solana-rpc-http-/.test(raw))
    return "RPC request failed. Check PUBLIC_SOLANA_RPC_URL.";
  return raw;
}

export function aiErr(error: unknown): string {
  const message = error instanceof Error ? error.message : "ai-error";
  if (message === "ai-proxy-unavailable") return "AI offline (dev proxy only)";
  return message;
}
