"use client";

import type { ReactNode } from "react";
import { DashboardHeader } from "./components/dashboard-header";
import { DashboardProvider, useDashboard } from "./context";

function ConnectedHeader() {
  const {
    walletBalances,
    walletBalanceError,
    onFund,
    onRefresh,
    isRefreshing,
    showFundButton,
    showBalance,
    terminalMode,
    terminalModeSaving,
    onModeChange,
  } = useDashboard();

  return (
    <DashboardHeader
      walletBalances={walletBalances}
      walletBalanceError={walletBalanceError}
      onFund={onFund}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      showFundButton={showFundButton}
      showBalance={showBalance}
      terminalMode={terminalMode}
      terminalModeSaving={terminalModeSaving}
      onModeChange={onModeChange}
    />
  );
}

export function DashboardShellClient({ children }: { children: ReactNode }) {
  return (
    <DashboardProvider>
      <main className="min-h-screen bg-paper text-ink flex flex-col">
        <ConnectedHeader />
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </main>
    </DashboardProvider>
  );
}
