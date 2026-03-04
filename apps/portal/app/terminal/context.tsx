"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  resolveDefaultTerminalMode,
  TERMINAL_MODE_OPTIONS,
  type TerminalMode,
} from "./terminal-modes";

type HeaderState = {
  title?: string;
  walletBalances: {
    sol: { lamports: string };
    usdc: { atomic: string };
  } | null;
  walletBalanceError: string | null;
  showFundButton: boolean;
  showBalance: boolean;
  isRefreshing: boolean;
  terminalMode: TerminalMode;
  terminalAllowedModes: readonly TerminalMode[];
  terminalModeSaving: boolean;
};

type HeaderActions = {
  setWalletBalances: (balances: HeaderState["walletBalances"]) => void;
  setWalletBalanceError: (error: string | null) => void;
  setFundAction: (fn: (() => void) | null) => void;
  setRefreshAction: (fn: (() => void) | null) => void;
  setIsRefreshing: (refreshing: boolean) => void;
  setShowFundButton: (show: boolean) => void;
  setShowBalance: (show: boolean) => void;
  setTerminalMode: (mode: TerminalMode) => void;
  setTerminalAllowedModes: (modes: readonly TerminalMode[]) => void;
  setTerminalModeSaving: (saving: boolean) => void;
  setModeAction: (fn: ((mode: TerminalMode) => void) | null) => void;
};

const DashboardContext = createContext<
  | (HeaderState &
      HeaderActions & {
        onFund?: () => void;
        onRefresh?: () => void;
        onModeChange?: (mode: TerminalMode) => void;
      })
  | null
>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [walletBalances, setWalletBalances] =
    useState<HeaderState["walletBalances"]>(null);
  const [walletBalanceError, setWalletBalanceError] = useState<string | null>(
    null,
  );
  const [showFundButton, setShowFundButton] = useState(false);
  const [showBalance, setShowBalance] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [terminalMode, setTerminalMode] = useState<TerminalMode>(() =>
    resolveDefaultTerminalMode(process.env.NEXT_PUBLIC_TERMINAL_DEFAULT_MODE),
  );
  const [terminalAllowedModes, setTerminalAllowedModes] = useState<
    readonly TerminalMode[]
  >(TERMINAL_MODE_OPTIONS);
  const [terminalModeSaving, setTerminalModeSaving] = useState(false);

  const [onFund, setOnFund] = useState<(() => void) | undefined>(undefined);
  const [onRefresh, setOnRefresh] = useState<(() => void) | undefined>(
    undefined,
  );
  const [onModeChange, setOnModeChange] = useState<
    ((mode: TerminalMode) => void) | undefined
  >(undefined);

  const setFundAction = useCallback((fn: (() => void) | null) => {
    setOnFund(() => fn || undefined);
  }, []);

  const setRefreshAction = useCallback((fn: (() => void) | null) => {
    setOnRefresh(() => fn || undefined);
  }, []);

  const setModeAction = useCallback(
    (fn: ((mode: TerminalMode) => void) | null) => {
      setOnModeChange(() => fn || undefined);
    },
    [],
  );

  const value = useMemo(
    () => ({
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
      terminalMode,
      setTerminalMode,
      terminalAllowedModes,
      setTerminalAllowedModes,
      terminalModeSaving,
      setTerminalModeSaving,
      onFund,
      setFundAction,
      onRefresh,
      setRefreshAction,
      onModeChange,
      setModeAction,
    }),
    [
      walletBalances,
      walletBalanceError,
      showFundButton,
      showBalance,
      isRefreshing,
      terminalMode,
      terminalAllowedModes,
      terminalModeSaving,
      onFund,
      onRefresh,
      onModeChange,
      setFundAction,
      setRefreshAction,
      setModeAction,
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
