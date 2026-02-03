import type { Keypair } from "@solana/web3.js";

export type KeychainConfig = {
  provider: "keychain" | "raw";
  secretKey?: Uint8Array;
};

// Placeholder adapter. The Solana keychain SDK will be integrated here.
export async function getKeychainSigner(
  _config: KeychainConfig,
): Promise<Keypair | null> {
  return null;
}
