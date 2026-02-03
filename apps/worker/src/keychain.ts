import type { Env } from "./types";

export type PrivySignerConfig = {
  appId: string;
  appSecret: string;
  walletId: string;
};

export async function getPrivySigner(env: Env) {
  const appId = env.PRIVY_APP_ID;
  const appSecret = env.PRIVY_APP_SECRET;
  const walletId = env.PRIVY_WALLET_ID;

  if (!appId || !appSecret || !walletId) {
    throw new Error("privy-config-missing");
  }

  const mod: Record<string, unknown> = await import("@solana/keychain-privy");
  const PrivySigner =
    (mod.PrivySigner as unknown) ?? (mod.default as unknown) ?? mod;

  if (typeof PrivySigner !== "function") {
    throw new Error("privy-signer-not-found");
  }

  return new (PrivySigner as new (config: PrivySignerConfig) => unknown)({
    appId,
    appSecret,
    walletId,
  });
}
