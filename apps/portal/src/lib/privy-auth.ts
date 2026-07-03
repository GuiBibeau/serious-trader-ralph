import type { Connection, VersionedTransaction } from "@solana/web3.js";
import { writable } from "svelte/store";
import { browser } from "$app/environment";
import { isRecord } from "./utils";

type PrivySdkModule = typeof import("@privy-io/js-sdk-core");
type PrivyConstructor = PrivySdkModule["default"];
type PrivyClient = InstanceType<PrivyConstructor>;
type PrivyUser = Record<string, unknown>;

export type PrivyAuthStatus =
  | "unconfigured"
  | "loading"
  | "ready"
  | "authenticated"
  | "error";

export type PrivyAuthState = {
  status: PrivyAuthStatus;
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  user: PrivyUser | null;
  userId: string | null;
  email: string | null;
  walletAddress: string | null;
  walletStatus: "missing" | "creating" | "ready" | "error";
  walletError: string | null;
  accessToken: string | null;
  error: string | null;
  otpSentTo: string | null;
};

type PrivyConfig = {
  appId: string;
  clientId: string;
};

const initialConfig = readPrivyConfig();

export const privyAuth = writable<PrivyAuthState>({
  status: initialConfig.appId ? "loading" : "unconfigured",
  configured: Boolean(initialConfig.appId),
  ready: false,
  authenticated: false,
  user: null,
  userId: null,
  email: null,
  walletAddress: null,
  walletStatus: "missing",
  walletError: null,
  accessToken: null,
  error: initialConfig.appId ? null : "privy-app-id-missing",
  otpSentTo: null,
});

let client: PrivyClient | null = null;
let initializePromise: Promise<void> | null = null;
let sdkPromise: Promise<PrivySdkModule> | null = null;
let secureIframe: HTMLIFrameElement | null = null;
let secureMessageListener: ((event: MessageEvent) => void) | null = null;

export function readPrivyConfig(): PrivyConfig {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    appId: cleanEnv(
      env.PUBLIC_PRIVY_APP_ID ??
        env.VITE_PRIVY_APP_ID ??
        env.NEXT_PUBLIC_PRIVY_APP_ID,
    ),
    clientId: cleanEnv(
      env.PUBLIC_PRIVY_CLIENT_ID ??
        env.VITE_PRIVY_CLIENT_ID ??
        env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
    ),
  };
}

export async function initializePrivyAuth(): Promise<void> {
  if (!browser) return;
  if (initializePromise) return initializePromise;

  initializePromise = initializePrivyAuthInternal();
  return initializePromise;
}

export async function sendPrivyEmailCode(email: string): Promise<void> {
  const privy = await requirePrivyClient();
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("email-required");
  await privy.auth.email.sendCode(normalized);
  privyAuth.update((state) => ({
    ...state,
    status: state.authenticated ? "authenticated" : "ready",
    error: null,
    otpSentTo: normalized,
  }));
}

export async function loginPrivyWithCode(
  email: string,
  code: string,
): Promise<void> {
  const privy = await requirePrivyClient();
  const normalized = normalizeEmail(email);
  const normalizedCode = code.trim();
  if (!normalized) throw new Error("email-required");
  if (!normalizedCode) throw new Error("code-required");

  const session = await privy.auth.email.loginWithCode(
    normalized,
    normalizedCode,
    "login-or-sign-up",
    {
      embedded: {
        ethereum: { createOnLogin: "off" },
        solana: { createOnLogin: "users-without-wallets" },
      },
    },
  );
  await hydrateAuthenticatedUser(session.user as unknown as PrivyUser | null);
}

export async function logoutPrivy(): Promise<void> {
  const privy = await requirePrivyClient();
  const userId = currentUserId();
  if (userId) {
    await privy.auth.logout({ userId });
  }
  privyAuth.update((state) => ({
    ...state,
    status: "ready",
    ready: true,
    authenticated: false,
    user: null,
    userId: null,
    email: null,
    walletAddress: null,
    walletStatus: "missing",
    walletError: null,
    accessToken: null,
    error: null,
    otpSentTo: null,
  }));
}

export async function getPrivyAccessToken(): Promise<string | null> {
  const privy = await requirePrivyClient();
  const token = await privy.getAccessToken();
  privyAuth.update((state) => ({ ...state, accessToken: token }));
  return token;
}

// Sign + send a Solana transaction with the embedded wallet. Signing happens
// inside Privy's secure iframe.
export async function signAndSendSolanaTransaction(
  transaction: VersionedTransaction,
  connection: Connection,
): Promise<string> {
  const privy = await requirePrivyClient();
  const account = currentSolanaAccount();
  if (!account) throw new Error("solana-wallet-not-found");
  const address = String(account.address ?? "");
  const provider = await privy.embeddedWallet.getSolanaProvider(
    account as unknown as Parameters<
      typeof privy.embeddedWallet.getSolanaProvider
    >[0],
    address,
    "solana-address-verifier",
  );
  const result = await provider.request({
    method: "signAndSendTransaction",
    params: { transaction, connection },
  });
  return result.signature;
}

// Sign a Solana transaction without broadcasting it. Phoenix referral
// activation submits the signed transaction to Phoenix so its onboarder can
// countersign and send.
export async function signSolanaTransaction(
  transaction: VersionedTransaction,
): Promise<VersionedTransaction> {
  const privy = await requirePrivyClient();
  const account = currentSolanaAccount();
  if (!account) throw new Error("solana-wallet-not-found");
  const address = String(account.address ?? "");
  const provider = await privy.embeddedWallet.getSolanaProvider(
    account as unknown as Parameters<
      typeof privy.embeddedWallet.getSolanaProvider
    >[0],
    address,
    "solana-address-verifier",
  );
  const result = await provider.request({
    method: "signTransaction",
    params: { transaction },
  });
  return result.signedTransaction;
}

function currentSolanaAccount(): Record<string, unknown> | null {
  let user: PrivyUser | null = null;
  privyAuth.update((state) => {
    user = state.user;
    return state;
  });
  if (!user) return null;
  for (const account of readLinkedAccounts(user)) {
    const address = String(account.address ?? "").trim();
    if (!address) continue;
    const chainType = String(
      account.chain_type ?? account.chainType ?? account.chain ?? "",
    ).toLowerCase();
    const type = String(account.type ?? "").toLowerCase();
    if (chainType === "solana" || type.includes("solana")) return account;
  }
  return null;
}

export function privyAccountLabel(state: PrivyAuthState): string {
  if (state.authenticated) {
    if (state.email) return state.email;
    if (state.walletAddress) return shortValue(state.walletAddress);
    if (state.userId) return shortValue(state.userId);
    return "Privy connected";
  }
  if (!state.configured) return "Privy not configured";
  if (!state.ready) return "Privy loading";
  return "Account not connected";
}

export function shortValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

async function initializePrivyAuthInternal(): Promise<void> {
  const config = readPrivyConfig();
  if (!config.appId) {
    privyAuth.set({
      status: "unconfigured",
      configured: false,
      ready: false,
      authenticated: false,
      user: null,
      userId: null,
      email: null,
      walletAddress: null,
      walletStatus: "missing",
      walletError: null,
      accessToken: null,
      error: "privy-app-id-missing",
      otpSentTo: null,
    });
    return;
  }

  privyAuth.update((state) => ({
    ...state,
    status: "loading",
    configured: true,
    error: null,
  }));

  try {
    const { default: Privy, LocalStorage } = await loadPrivySdk();
    client = new Privy({
      appId: config.appId,
      ...(config.clientId ? { clientId: config.clientId } : {}),
      storage: new LocalStorage(),
    });
    await client.initialize();
    mountSecureContext(client);

    let user: PrivyUser | null = null;
    try {
      const response = await client.user.get();
      user = (response.user ?? null) as unknown as PrivyUser | null;
    } catch {
      user = null;
    }

    if (user) {
      await hydrateAuthenticatedUser(user);
    } else {
      privyAuth.update((state) => ({
        ...state,
        status: "ready",
        ready: true,
        authenticated: false,
        user: null,
        userId: null,
        email: null,
        walletAddress: null,
        walletStatus: "missing",
        walletError: null,
        accessToken: null,
        error: null,
      }));
    }
  } catch (error) {
    privyAuth.update((state) => ({
      ...state,
      status: "error",
      ready: false,
      authenticated: false,
      accessToken: null,
      error: errorMessage(error),
    }));
  }
}

function loadPrivySdk(): Promise<PrivySdkModule> {
  sdkPromise ??= import("@privy-io/js-sdk-core");
  return sdkPromise;
}

async function requirePrivyClient(): Promise<PrivyClient> {
  await initializePrivyAuth();
  if (!client) throw new Error("privy-not-configured");
  return client;
}

async function hydrateAuthenticatedUser(user: PrivyUser | null): Promise<void> {
  const walletAddress = extractSolanaWalletAddress(user);
  await setAuthenticatedUser(user, {
    walletStatus: walletAddress ? "ready" : user ? "creating" : "missing",
    walletError: null,
  });
  if (!user || walletAddress || !client) return;

  try {
    const ethereumAccount = extractEmbeddedEthereumWallet(user);
    const createSolana = client.embeddedWallet
      .createSolana as unknown as (opts?: {
      ethereumAccount?: Record<string, unknown>;
    }) => Promise<unknown>;
    const response = await createSolana(
      ethereumAccount ? { ethereumAccount } : undefined,
    );
    const createdUser =
      isRecord(response) && isRecord(response.user)
        ? (response.user as PrivyUser)
        : null;
    if (createdUser) {
      await setAuthenticatedUser(createdUser, {
        walletStatus: extractSolanaWalletAddress(createdUser)
          ? "ready"
          : "missing",
        walletError: null,
      });
      return;
    }

    const refreshed = await client.user.get();
    await setAuthenticatedUser(refreshed.user as unknown as PrivyUser | null, {
      walletStatus: extractSolanaWalletAddress(
        refreshed.user as unknown as PrivyUser | null,
      )
        ? "ready"
        : "missing",
      walletError: null,
    });
  } catch (error) {
    privyAuth.update((state) => ({
      ...state,
      walletStatus: "error",
      walletError: errorMessage(error),
    }));
  }
}

async function setAuthenticatedUser(
  user: PrivyUser | null,
  wallet?: Pick<PrivyAuthState, "walletStatus" | "walletError">,
): Promise<void> {
  const token = client ? await client.getAccessToken() : null;
  const walletAddress = extractSolanaWalletAddress(user);
  privyAuth.update((state) => ({
    ...state,
    status: user ? "authenticated" : "ready",
    ready: true,
    authenticated: Boolean(user),
    user,
    userId: extractUserId(user),
    email: extractEmail(user),
    walletAddress,
    walletStatus: wallet?.walletStatus ?? (walletAddress ? "ready" : "missing"),
    walletError: wallet?.walletError ?? null,
    accessToken: token,
    error: null,
    otpSentTo: null,
  }));
}

function mountSecureContext(privy: PrivyClient): void {
  if (!browser || secureIframe) return;
  const iframe = document.createElement("iframe");
  iframe.src = privy.embeddedWallet.getURL();
  iframe.title = "Privy secure wallet context";
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  if (iframe.contentWindow) {
    privy.setMessagePoster({
      postMessage: (message, targetOrigin, transfer) => {
        if (!iframe.contentWindow) return;
        if (transfer) {
          iframe.contentWindow.postMessage(message, targetOrigin, [transfer]);
        } else {
          iframe.contentWindow.postMessage(message, targetOrigin);
        }
      },
      reload: () => {
        iframe.src = privy.embeddedWallet.getURL();
      },
    });
  }

  secureMessageListener = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    try {
      const data =
        typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      privy.embeddedWallet.onMessage(data);
    } catch {
      // Ignore malformed messages from anything that is not Privy's iframe.
    }
  };
  window.addEventListener("message", secureMessageListener);
  secureIframe = iframe;
}

function currentUserId(): string | null {
  let id: string | null = null;
  privyAuth.update((state) => {
    id = state.userId;
    return state;
  });
  return id;
}

function extractUserId(user: PrivyUser | null): string | null {
  if (!user) return null;
  for (const key of ["id", "userId", "sub"]) {
    const value = user[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractEmail(user: PrivyUser | null): string | null {
  if (!user) return null;
  const direct = normalizeEmail(user.email);
  if (direct) return direct;

  const linked = readLinkedAccounts(user);
  for (const account of linked) {
    const type = String(account.type ?? "").toLowerCase();
    const email = normalizeEmail(
      account.email ?? account.address ?? account.verified_email,
    );
    if (email && type === "email") return email;
  }
  for (const account of linked) {
    const email = normalizeEmail(
      account.email ?? account.address ?? account.verified_email,
    );
    if (email) return email;
  }
  return null;
}

function extractSolanaWalletAddress(user: PrivyUser | null): string | null {
  if (!user) return null;
  const linked = readLinkedAccounts(user);
  for (const account of linked) {
    const type = String(account.type ?? "").toLowerCase();
    const chainType = String(
      account.chain_type ?? account.chainType ?? account.chain,
    ).toLowerCase();
    const address = String(
      account.address ?? account.wallet_address ?? account.walletAddress ?? "",
    ).trim();
    if (!address) continue;
    if (chainType === "solana" || type.includes("solana")) return address;
  }
  return null;
}

function extractEmbeddedEthereumWallet(
  user: PrivyUser | null,
): Record<string, unknown> | null {
  if (!user) return null;
  for (const account of readLinkedAccounts(user)) {
    const type = String(account.type ?? "").toLowerCase();
    const chainType = String(
      account.chain_type ?? account.chainType ?? account.chain,
    ).toLowerCase();
    const walletClient = String(
      account.wallet_client ?? account.walletClient ?? "",
    ).toLowerCase();
    if (
      (chainType === "ethereum" || type.includes("ethereum")) &&
      walletClient.includes("privy")
    ) {
      return account;
    }
  }
  return null;
}

function readLinkedAccounts(user: PrivyUser): Record<string, unknown>[] {
  const raw = user.linked_accounts ?? user.linkedAccounts;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord);
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function cleanEnv(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\\n$/, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "privy-error");
}
