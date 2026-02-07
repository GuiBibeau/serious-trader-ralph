"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return children;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        // Keep this explicit to avoid showing providers we don't want yet.
        // Note: the Privy dashboard still needs Email enabled for this to work.
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "light",
          accentColor: "#ff7ac8",
          logo: undefined,
          walletChainType: "solana-only",
          showWalletLoginFirst: true,
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
