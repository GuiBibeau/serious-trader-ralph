"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";

export function Providers({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const privyTheme = resolvedTheme === "dark" ? "dark" : "light";

  // Privy UI components have historically had some DOM nesting quirks that can
  // trigger Next.js hydration warnings. Rendering the provider only after mount
  // avoids SSR markup mismatches while keeping the rest of the app SSR-able.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!mounted || !appId) {
    return (
      <>
        {children}
        <Toaster
          theme={privyTheme}
          richColors
          position="top-right"
          closeButton
        />
      </>
    );
  }

  return (
    <>
      <PrivyProvider
        appId={appId}
        config={{
          appearance: {
            // Keep this explicit to avoid showing providers we don't want yet.
            // Note: the Privy dashboard still needs Email enabled for this to work.
            loginMethods: ["email"],
            theme: privyTheme,
            accentColor: "#ff4fa3",
            logo: undefined,
            showWalletLoginFirst: false,
          },
          embeddedWallets: {
            ethereum: { createOnLogin: "off" },
            solana: { createOnLogin: "off" },
          },
        }}
      >
        {children}
      </PrivyProvider>
      <Toaster theme={privyTheme} richColors position="top-right" closeButton />
    </>
  );
}
