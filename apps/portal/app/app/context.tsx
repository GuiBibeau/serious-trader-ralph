"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type HeaderState = {
  title?: string;
  onboardingStatus: "active" | "being_onboarded";
  walletBalances: {
    sol: { lamports: string };
    usdc: { atomic: string };
  } | null;
  walletBalanceError: string | null;
  showFundButton: boolean;
  showBalance: boolean;
  isRefreshing: boolean;
};

type HeaderActions = {
  setOnboardingStatus: (status: "active" | "being_onboarded") => void;
  setWalletBalances: (balances: HeaderState["walletBalances"]) => void;
  setWalletBalanceError: (error: string | null) => void;
  setFundAction: (fn: (() => void) | null) => void;
  setRefreshAction: (fn: (() => void) | null) => void;
  setIsRefreshing: (refreshing: boolean) => void;
  setShowFundButton: (show: boolean) => void;
  setShowBalance: (show: boolean) => void;
};

const DashboardContext = createContext<
  | (HeaderState &
      HeaderActions & { onFund?: () => void; onRefresh?: () => void })
  | null
>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [onboardingStatus, setOnboardingStatus] = useState<
    "active" | "being_onboarded"
  >("being_onboarded");
  const [walletBalances, setWalletBalances] =
    useState<HeaderState["walletBalances"]>(null);
  const [walletBalanceError, setWalletBalanceError] = useState<string | null>(
    null,
  );
  const [showFundButton, setShowFundButton] = useState(false);
  const [showBalance, setShowBalance] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [onFund, setOnFund] = useState<(() => void) | undefined>(undefined);
  const [onRefresh, setOnRefresh] = useState<(() => void) | undefined>(
    undefined,
  );

  const setFundAction = useCallback((fn: (() => void) | null) => {
    setOnFund(() => fn || undefined);
  }, []);

  const setRefreshAction = useCallback((fn: (() => void) | null) => {
    setOnRefresh(() => fn || undefined);
  }, []);

  const value = useMemo(
    () => ({
      onboardingStatus,
      setOnboardingStatus,
      walletBalances,
      setWalletBalances,
      walletBalanceError,
      setWalletBalanceError,
      showFundButton,
      setShowFundButton,
      showBalance,
      setShowBalance,
      isRefreshing,
      setIsRefreshing,
      onFund,
      setFundAction,
      onRefresh,
      setRefreshAction,
    }),
    [
      onboardingStatus,
      walletBalances,
      walletBalanceError,
      showFundButton,
      showBalance,
      isRefreshing,
      onFund,
      onRefresh,
      setFundAction,
      setRefreshAction,
    ],
  );

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx)
    throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}
