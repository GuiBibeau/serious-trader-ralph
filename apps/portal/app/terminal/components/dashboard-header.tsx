"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Wallet } from "lucide-react";
import Link from "next/link";
import { cn } from "../../cn";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  formatBalanceSummary,
} from "../../lib";

interface DashboardHeaderProps {
  walletBalances?: {
    sol: { lamports: string };
    usdc: { atomic: string };
  } | null;
  walletBalanceError?: string | null;
  onFund?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  showFundButton?: boolean;
  showBalance?: boolean;
}

export function DashboardHeader({
  walletBalances,
  walletBalanceError,
  onFund,
  onRefresh,
  isRefreshing,
  showFundButton = false,
  showBalance = false,
}: DashboardHeaderProps) {
  const { logout } = usePrivy();
  const balanceText = walletBalanceError
    ? "Wallet unavailable"
    : walletBalances
      ? formatBalanceSummary(
          walletBalances.sol.lamports,
          walletBalances.usdc.atomic,
        )
      : "Wallet sync...";

  return (
    <div className="sticky top-0 z-20 border-b border-border bg-paper/90 backdrop-blur-md">
      <div className="mx-auto flex w-[min(1460px,96vw)] items-center justify-between gap-4 py-3">
        <Link
          href="/terminal"
          className="text-sm font-semibold tracking-tight hover:text-ink transition-colors"
        >
          Trader Ralph <span className="ml-2 text-muted font-normal">Terminal</span>
        </Link>
        <div className="flex min-w-0 items-center justify-end gap-2 overflow-x-auto text-xs">
          <span
            className={cn(
              "inline-flex h-8 w-[25ch] shrink-0 items-center justify-end rounded-md border border-border bg-surface px-2.5 font-mono tabular-nums text-muted whitespace-nowrap",
              !showBalance && "opacity-0 pointer-events-none",
            )}
            title={walletBalanceError ?? undefined}
          >
            {balanceText}
          </span>
          <button
            className={cn(
              BTN_PRIMARY,
              "h-8 w-[9.5rem] shrink-0 px-4 text-xs flex items-center justify-center gap-2",
              (!showFundButton || !onFund) && "opacity-0 pointer-events-none",
            )}
            onClick={onFund}
            type="button"
            disabled={!showFundButton || !onFund}
            aria-hidden={!showFundButton || !onFund}
            tabIndex={!showFundButton || !onFund ? -1 : 0}
          >
            <Wallet className="w-3.5 h-3.5" />
            Fund Wallet
          </button>
          <button
            className={cn(
              BTN_SECONDARY,
              "h-8 w-[5.5rem] shrink-0 px-4 text-xs",
              !onRefresh && "opacity-0 pointer-events-none",
            )}
            onClick={onRefresh}
            type="button"
            disabled={isRefreshing || !onRefresh}
            aria-hidden={!onRefresh}
            tabIndex={!onRefresh ? -1 : 0}
          >
            Refresh
          </button>
          <button
            className={cn(BTN_SECONDARY, "h-8 shrink-0 px-4 text-xs")}
            onClick={logout}
            type="button"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
