"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type { ReactNode } from "react";
import { useEffect } from "react";

function EnforceSystemTheme() {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (theme !== "system") setTheme("system");
  }, [theme, setTheme]);

  return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <EnforceSystemTheme />
      {children}
    </NextThemesProvider>
  );
}
