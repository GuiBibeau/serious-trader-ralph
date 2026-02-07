"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export function Providers({ children }: { children: ReactNode }) {
  // Privy UI components have historically had some DOM nesting quirks that can
  // trigger Next.js hydration warnings. Rendering the provider only after mount
  // avoids SSR markup mismatches while keeping the rest of the app SSR-able.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return children;
  if (!mounted) return children;

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
