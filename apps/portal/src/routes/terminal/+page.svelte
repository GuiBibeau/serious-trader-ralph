<script lang="ts">
  import "./terminal.css";

  import { onMount, tick } from "svelte";
  import AiReadLine from "./components/AiReadLine.svelte";
  import AlertsModal from "./components/AlertsModal.svelte";
  import AuthModal from "./components/AuthModal.svelte";
  import CheatSheetModal from "./components/CheatSheetModal.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import DragHead from "./components/DragHead.svelte";
  import MacroPanel from "./components/MacroPanel.svelte";
  import NewsMarquee from "./components/NewsMarquee.svelte";
  import Spark from "./components/Spark.svelte";
  import ToastStack from "./components/ToastStack.svelte";
  import {
    aiDisabled,
    aiEventRead,
    aiFundingRead,
    aiPositionBrief,
    aiSessionRecap,
    aiMacroRead,
    aiParseCommand,
    aiScannerSetups,
    aiTradeIdeas,
    IDLE_READ,
    type AiRead,
  } from "$lib/ai";
  import { track } from "$lib/telemetry";
  import {
    type Alert,
    alertsStore,
    headlineMatches,
  } from "$lib/terminal/alerts";
  import { buildChartLineSpecs } from "$lib/terminal/chart-lines";
  import { parseTerminalDeepLink } from "$lib/terminal/deep-link";
  import {
    createPanelLayout,
    migrateLayout,
    panelStyle,
    providePanelLayout,
  } from "$lib/terminal/layout";
  import {
    aiErr,
    humanizeBalanceError,
    shortAddress,
    shortEmail,
    walletFundsLabel,
    walletStatusText,
  } from "$lib/terminal/account-format";
  import {
    BOOK_LADDER_LEVELS,
    BOOK_LADDER_LEVELS_STACKED,
    bookLevelNotional,
    bookLevelTotalNotional,
    depthWidth,
    formatBookPrice,
    maxBookNotional,
  } from "$lib/terminal/book";
  import {
    CACHE_MARKETS,
    CACHE_MAX_AGE,
    CACHE_NEWS,
    CACHE_PANELS,
    CACHE_READS,
    DEFAULT_PANEL_ORDER,
    LAYOUT_STORAGE_KEY,
    MARKETS_MAX_AGE,
    mergeLayout,
    ONBOARD_KEY,
    parsePrefs,
    persistPrefs,
    PREFS_STORAGE_KEY,
    SECTION_LINKS,
  } from "$lib/terminal/prefs";
  import {
    buildMonitorRows,
    buildScreenRows,
    buildWatchRows,
    disconnectedPanel,
    disconnectedRows,
    emptyMarketStats,
    selectedMarketTableRows,
    summarizeEdgeStatus,
  } from "$lib/terminal/panels";
  import {
    chartLinePrefs,
    equityBaselines,
    equityHistory,
    freshSnapshot,
    recordEquitySample,
    recordSnapshot,
    shiftEquityBaseline,
    traderSnapshots,
  } from "$lib/phoenix-cache";
  import {
    fetchNews,
    fetchOilPanel,
    fetchRatesPanel,
    screenSolanaAddress,
    type NewsItem,
  } from "$lib/intel";
  import { fetchSolanaLamports, solanaRpcUrl } from "$lib/solana-rpc";
  import { swrRead, swrWrite } from "$lib/swr";
  import {
    edgeApiBase,
    fetchEtfRows,
    fetchMacroSignalsRows,
    fetchStablecoinRows,
    type DataPanel,
    type DataRow,
  } from "$lib/edge-data";
  import {
    cacheCandles,
    connectPhoenixMarketStream,
    DEFAULT_PHOENIX_SYMBOL,
    fetchPhoenixCandles,
    fetchPhoenixInitialMarketData,
    fetchPhoenixDailyStats,
    fetchPhoenixMarkets,
    getCachedCandles,
    phoenixSource,
    PHOENIX_TIMEFRAME,
    PHOENIX_TIMEFRAMES,
    upsertLiveCandle,
    type DepthLevel,
    type MarketPoint,
    type PhoenixDailyStat,
    type PhoenixMarketConfig,
    type PhoenixMarketStats,
    type PhoenixTimeframe,
    type PhoenixWsHandle,
    type TradeTick,
  } from "$lib/phoenix-market-data";
  import {
    getPrivyAccessToken,
    initializePrivyAuth,
    logoutPrivy,
    privyAuth,
    signAndSendSolanaTransaction,
    signSolanaTransaction,
    type PrivyAuthState,
  } from "$lib/privy-auth";
  import {
    fetchUsdcBalance,
    getJupiterQuote,
    getJupiterSwapTransaction,
    type JupiterQuote,
  } from "$lib/funding";
  import { BrandMark, OpenBetaBanner } from "@trader-ralph/ui";
  import { colors } from "@trader-ralph/ui/tokens";
  import {
    clearJournal,
    entriesToday,
    journalToCsv,
    loadJournal,
    recordTrade,
    type JournalEntry,
  } from "$lib/journal";
  import {
    cancelTriggerOrder,
    createTriggerOrder,
    fetchAllTokenBalances,
    fetchSpotAssets,
    fetchTriggerOrders,
    fetchSpotCandles,
    getSpotQuote,
    getSpotSwapTransaction,
    spotIntervalFor,
    tokenToAtoms,
    triggerOrderView,
    usdcToAtoms,
    USDC_MINT as SPOT_USDC_MINT,
    type SpotAsset,
    type SpotQuote,
    type TriggerOrder,
  } from "$lib/spot";
  import {
    activatePhoenixReferral,
    buildAddIsolatedMarginIxs,
    buildCancelAllIxs,
    buildCancelSingleOrderIxs,
    buildDepositIxs,
    buildPlaceOrderPlan,
    buildSignableTransaction,
    buildWithdrawIxs,
    checkPhoenixAccess,
    ensureTraderRegisteredIxs,
    fetchExchangeConfig,
    fetchOnChainCollateralUsd,
    fetchPhoenixTraderState,
    PHOENIX_REFERRAL_CODE,
    type PhoenixOpenOrder,
    type PhoenixPosition,
    type PhoenixSide,
    type PhoenixTraderState,
  } from "$lib/phoenix-trade";
  import { Connection, VersionedTransaction } from "@solana/web3.js";
  import QRCode from "qrcode";
  import {
    formatAge,
    formatNumber,
    formatPercent,
    formatPrice,
    formatSolBalanceDisplay,
    isRecord,
  } from "$lib/utils";
  import {
    buildTradePreview,
    clampLeverage,
    enrichPosition,
    fmtTriggerPrice,
    liqDistancePct,
    riskNotional,
    SL_CHIP_PCTS,
    TP_CHIP_PCTS,
    triggerPriceForPct,
  } from "$lib/terminal/trade-math";
  import {
    computeMarketChange,
    DEFAULT_VISIBLE_CANDLES,
    formatCandleCountdown,
    formatChartRange,
    MAX_VISIBLE_CANDLES,
    sessionNote as sessionNoteOf,
    toCandle,
    toVolume,
  } from "$lib/terminal/chart-format";
  import type { PaletteRow } from "$lib/terminal/palette";
  import {
    CandlestickSeries,
    ColorType,
    createChart,
    CrosshairMode,
    HistogramSeries,
    LineStyle,
    PriceScaleMode,
    type CandlestickData,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type MouseEventParams,
    type UTCTimestamp,
  } from "lightweight-charts";

  type SignalRow = DataRow;
  type ChartScale = "price" | "percent";
  type ChartAxisMode = "linear" | "log";

  const UP_COLOR = colors.up;
  const DOWN_COLOR = colors.down; // was #ff5a5f — unified to the token red

  let selectedSymbol = DEFAULT_PHOENIX_SYMBOL;
  let selectedTimeframe: PhoenixTimeframe = PHOENIX_TIMEFRAME;
  let priceMode: "last" | "mark" = "last";
  let chartScale: ChartScale = "price";
  let chartAxisMode: ChartAxisMode = "linear";
  let visibleCandleCount = DEFAULT_VISIBLE_CANDLES;
  let chartContainer: HTMLDivElement | null = null;
  let lwChart: IChartApi | null = null;
  let candleSeries: ISeriesApi<"Candlestick"> | null = null;
  let volumeSeries: ISeriesApi<"Histogram"> | null = null;
  let lastPriceLine: IPriceLine | null = null;
  let legendCandle: MarketPoint | null = null;
  let autoFollow = true;
  let markets: PhoenixMarketConfig[] = [];
  let marketMids: Record<string, number> = {};
  let selectedMarket: PhoenixMarketConfig | null = null;
  let marketStats: PhoenixMarketStats | null = null;
  let hoveredCandle: MarketPoint | null = null;
  let phoenixStream: PhoenixWsHandle | null = null;
  let streamHealth: "connecting" | "live" | "stale" | "offline" =
    "connecting";
  let latestPrice: number | null = null;
  let lastMarketUpdate: number | null = null;
  let chartPoints: MarketPoint[] = [];
  // `hoveredCandle` removed — crosshair legend now flows through `legendCandle`.
  let bids: DepthLevel[] = [];
  let asks: DepthLevel[] = [];
  let trades: TradeTick[] = [];
  // 24h change/volume for EVERY perp market (palette + monitor); the ws
  // stream only carries stats for the subscribed market.
  let dailyStats: Record<string, PhoenixDailyStat> = {};

  async function refreshDailyStats(): Promise<void> {
    if (markets.length === 0) return;
    try {
      dailyStats = await fetchPhoenixDailyStats(
        markets.map((market) => market.symbol),
      );
    } catch {
      // sweep is best-effort; keep last values
    }
  }

  let monitorSort: "volume" | "change" | "symbol" = "volume";
  $: monitorRows = buildMonitorRows(markets, marketMids, dailyStats, monitorSort);

  function chooseMonitorRow(symbol: string): void {
    if (tradeMode !== "perps") setTradeMode("perps", false);
    if (symbol !== selectedSymbol) void switchPhoenixMarket(symbol);
  }
  let bookVersion = 0;
  let marketSourceLabel = "loading";
  let marketVolume24h: number | null = null;
  let nowMs = Date.now();
  let edgeStatus = "loading";
  let edgeSource = edgeApiBase() || "not configured";
  let macroPanel: DataPanel = disconnectedPanel("Edge macro source required");
  let fredPanel: DataPanel = disconnectedPanel("Edge FRED source required");
  let etfPanel: DataPanel = disconnectedPanel("Edge ETF flow source required");
  let stablecoinPanel: DataPanel = disconnectedPanel(
    "Edge stablecoin source required",
  );
  let oilPanel: DataPanel = disconnectedPanel("Edge energy source required");
  let authOpen = false;
  let logoutBusy = false;
  let accountMenuOpen = false;
  let walletBalanceAddress = "";
  let walletBalanceText = "-- SOL";
  let walletBalanceStatus: "idle" | "loading" | "ready" | "error" = "idle";
  let walletBalanceError = "";
  let usdcBalanceText = "-- USDC";
  let usdcBalanceValue: number | null = null;
  let solBalanceValue: number | null = null;
  let walletCopied = false;
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  // Phoenix onboarding (beta whitelist + referral attribution).
  let phoenixWhitelisted: boolean | null = null;
  let onboardedAddress = "";

  // Phoenix venue (live trading) state.
  // Derived from the persisted per-wallet store: instant on load (device
  // snapshot), corrected by the live refresh, synced across tabs. Loading
  // is null — the ticket never claims "Deposit first" for it.
  $: phoenixTrader = phoenixAuthority
    ? freshSnapshot($traderSnapshots, phoenixAuthority)
    : null;
  // Per-action busy keys (`order:SYM`, `close:SYM:IDX`, `cancel:SYM:SIDE`) so
  // a confirming open never locks Close/Cancel — confirmTransaction can take
  // ~60s under congestion. Always REASSIGNED: mutating the Set in place is
  // invisible to legacy reactivity.
  let phoenixBusyKeys: Set<string> = new Set();
  // Tx lifecycle per in-flight action (same keys), plus the latest transition
  // for the footer status line.
  type TxStage = "idle" | "simulating" | "signing" | "confirming" | "confirmed";
  let txStages: Record<string, { stage: TxStage; sinceMs: number }> = {};
  let lastTx: {
    key: string;
    label: string;
    stage: TxStage | "failed";
    sinceMs: number;
  } | null = null;
  let phoenixActionError = "";
  let phoenixActionErrorDetail = ""; // raw error, surfaced via title attribute
  let phoenixActionRetry: (() => void) | null = null;
  let lastTradeSignature = "";
  let depositAmount = "";
  let withdrawAmount = "";
  let collateralBusy = false;
  let collateralError = "";
  let collateralSignature = "";

  // Add-funds (receive + swap) flow.
  let fundsOpen = false;
  let fundsQr = "";
  let fundsTab: "receive" | "convert" | "phoenix" = "receive";
  let swapSol = "";
  let swapQuote: JupiterQuote | null = null;
  let swapStatus: "idle" | "quoting" | "quoted" | "swapping" | "done" | "error" =
    "idle";
  let swapError = "";
  let swapSignature = "";
  let swapQuoteTimer: ReturnType<typeof setTimeout> | null = null;
  let tradeOpen = false;
  let tradeSide: "buy" | "sell" = "buy";
  let tradeAmount = "25";
  let pendingBook: { bids: DepthLevel[]; asks: DepthLevel[]; mid: number | null } | null =
    null;
  let bookFrame = 0;
  let prefsReady = false;
  let activeSection = "chart";

  // AI co-pilot reads (DeepSeek). Interpretation only — never computes numbers.
  let macroRead: AiRead = IDLE_READ;
  let fundingRead: AiRead = IDLE_READ;
  let scannerRead: AiRead = IDLE_READ;
  let tradeLeverage = 2;
  let tradeType: "market" | "limit" = "market";
  let tradeLimitPrice = "";
  let tradeTakeProfit = "";
  let tradeStopLoss = "";
  // Reduce-only: sell into an existing position instead of opening a second
  // isolated one with fresh margin. Only offered while a position exists.
  let tradeReduceOnly = false;
  // Right-rail tab: order book vs inline trade ticket.
  // Trade is the default right-rail mode — trading is the product; the
  // book is one tab away. Deep links (?tab=book) still override.
  let bookTab: "book" | "trade" = "trade";
  // Desktop (>1100px) stacks ladder + ticket in the rail instead of tabs —
  // reading the book never costs the ticket. Tracked from the same
  // breakpoint where the grid collapses, so markup and CSS agree. The tape
  // shares the ladder slot up top (all three don't fit vertically).
  let stackedBook = false;
  let bookFeed: "ladder" | "tape" = "ladder";
  // Measured sticky-chrome heights: the market rail pins below the topbar
  // and jump-to-section targets land below both.
  let topbarHeight = 0;
  let marketRailHeight = 0;

  // Spot venue (tokens.xyz catalog + Jupiter execution).
  let tradeMode: "perps" | "spot" = "perps";
  let spotAssets: SpotAsset[] = [];
  let spotAsset: SpotAsset | null = null;
  let spotSearch = "";
  let spotSide: "buy" | "sell" = "buy";
  let spotAmount = "25";
  let spotQuote: SpotQuote | null = null;
  let spotQuoteStatus: "idle" | "quoting" | "quoted" | "error" = "idle";
  let spotQuoteError = "";
  let spotBusy = false;
  let spotSignature = "";
  let spotQuoteTimer: ReturnType<typeof setTimeout> | null = null;
  let spotChartTimer: ReturnType<typeof setInterval> | null = null;
  // Generation tokens: invalidate in-flight quote/chart responses when the
  // user changes asset/side/amount/timeframe (out-of-order fetch protection).
  let spotQuoteSeq = 0;
  let spotQuotedAt = 0;
  let spotChartSeq = 0;
  let spotChartPoints: MarketPoint[] = [];
  let tokenBalances: Record<string, number> = {};
  let pendingTradeMode: "spot" | null = null;
  let pendingSpotAssetId: string | null = null;

  // Watchlist: starred symbols (uppercase), persisted in prefs.
  let watchlist: string[] = [];
  // Risk-based sizing: size the perp ticket from stop distance, like a desk.
  let sizingMode: "usd" | "risk" = "usd";
  let tradeRiskUsd = "25";
  // Screener controls (persisted).
  let screenSort: "movers" | "volume" | "cap" = "movers";
  let screenHub: "all" | "crypto" | "equities" | "pre-ipo" = "all";
  // Local-first trade journal + AI desk notes over it.
  let journalEntries: JournalEntry[] = [];
  let briefRead: AiRead = IDLE_READ;
  let recapRead: AiRead = IDLE_READ;
  let briefKey = "";
  let recapKey = 0;
  // Spot limit orders (Jupiter Trigger).
  let spotOrderType: "market" | "limit" = "market";
  let spotLimitPrice = "";
  let triggerOrders: TriggerOrder[] = [];
  let triggerBusy = false;
  let triggerWallet = "";
  // Liquidation price lines for open positions on the perp chart.
  let liqLines: IPriceLine[] = [];

  // Intel feeds (Crucix-inspired): event radar, news ticker, sanctions, ideas.
  let news: NewsItem[] = [];
  let eventRead: AiRead = IDLE_READ;
  let ideasRead: AiRead = IDLE_READ;
  let walletScreen: { flagged: boolean; checked: boolean } = {
    flagged: false,
    checked: false,
  };
  let screenedAddress = "";

  // Alert engine — armed alerts, fired log, and toasts live in the shared
  // store ($lib/terminal/alerts); the page keeps only the open flag and
  // the hot-path check() call.
  const { alerts } = alertsStore;
  let alertsOpen = false;

  // Draggable dashboard layout — store bundle shared with panel
  // components via context; persistence stays here (loadLayout/saveLayout).
  const layout = providePanelLayout(
    createPanelLayout(DEFAULT_PANEL_ORDER, (order) => saveLayout(order)),
  );
  const {
    panelOrder,
    draggedPanel,
    dragOverPanel,
    reset: resetLayout,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  } = layout;

  const OPEN_BETA_BANNER_STORAGE_KEY =
    "trader-ralph-terminal/open-beta-banner/v1";
  let showOpenBetaBanner = false;

  $: selectedMarket = markets.find((market) => market.symbol === selectedSymbol) ?? null;
  // Funds = everything the user considers theirs: wallet USDC + ALL Phoenix
  // collateral (free cross margin plus isolated position margin). The
  // account dropdown row shows the wallet/phoenix split underneath.
  $: phoenixTotalCollateral =
    phoenixTrader?.totalCollateralUsd ?? phoenixCollateral;
  $: totalFundsText =
    usdcBalanceValue === null
      ? usdcBalanceText
      : `${(usdcBalanceValue + phoenixTotalCollateral).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} USDC`;
  $: balanceText = walletFundsLabel(
    $privyAuth,
    walletBalanceStatus,
    totalFundsText,
  );
  $: connectLabel =
    $privyAuth.status === "loading"
      ? "Connecting…"
      : $privyAuth.status === "error"
        ? "Retry connect"
        : !$privyAuth.configured
          ? "Auth unavailable"
          : "Connect account";
  $: walletStatusLabel = walletStatusText($privyAuth.walletStatus);
  $: normalizedWalletAddress = $privyAuth.walletAddress ?? "";
  $: if (normalizedWalletAddress !== walletBalanceAddress) {
    walletBalanceAddress = normalizedWalletAddress;
    void refreshWalletBalance(normalizedWalletAddress);
  }
  $: if (normalizedWalletAddress !== screenedAddress) {
    void screenWallet(normalizedWalletAddress);
  }
  $: phoenixAuthority = $privyAuth.authenticated ? normalizedWalletAddress : "";
  // Wallet appears (login, restore, or switch): refresh from the network;
  // the derived view above already shows the device snapshot meanwhile.
  let refreshedAuthority: string | null = null;
  $: if (phoenixAuthority && refreshedAuthority !== phoenixAuthority) {
    refreshedAuthority = phoenixAuthority;
    void refreshPhoenixTrader();
  } else if (!phoenixAuthority) {
    refreshedAuthority = null;
  }
  $: if (phoenixAuthority) void ensurePhoenixOnboarding(phoenixAuthority);
  $: if (phoenixAuthority) void refreshTokenBalances(phoenixAuthority);
  $: spotFiltered = spotSearch.trim()
    ? spotAssets.filter((asset) => {
        const query = spotSearch.trim().toLowerCase();
        return (
          asset.symbol.toLowerCase().includes(query) ||
          asset.name.toLowerCase().includes(query)
        );
      })
    : spotAssets;
  $: spotHolding = spotAsset ? tokenBalances[spotAsset.mint] ?? 0 : 0;
  $: alertsStore.check(latestPrice, selectedSymbol);
  $: spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : 0;
  $: spreadBps = latestPrice && latestPrice > 0 ? (spread / latestPrice) * 10_000 : 0;
  $: spreadPercent = latestPrice && latestPrice > 0 ? (spread / latestPrice) * 100 : 0;
  $: ladderLevelCap = stackedBook
    ? BOOK_LADDER_LEVELS_STACKED
    : BOOK_LADDER_LEVELS;
  $: visibleAskLevels = asks.slice(0, ladderLevelCap).reverse();
  $: visibleBidLevels = bids.slice(0, ladderLevelCap);
  $: bookMaxNotional = maxBookNotional(visibleAskLevels, visibleBidLevels);
  $: chartPrice =
    priceMode === "mark" ? marketStats?.markPx ?? latestPrice : latestPrice;
  // The chart surface is owned by exactly one mode; all derived UI follows it.
  $: displayPoints = tradeMode === "spot" ? spotChartPoints : chartPoints;
  $: latestCandle = displayPoints.at(-1) ?? null;
  $: activeCandle = legendCandle ?? latestCandle;
  $: chartRangeLabel = formatChartRange(displayPoints);
  $: change24h =
    tradeMode === "spot"
      ? spotAsset?.change24hPct ?? null
      : computeMarketChange(latestPrice, marketStats, chartPoints);
  $: chartPriceScaleMode =
    chartScale === "percent"
      ? PriceScaleMode.Percentage
      : chartAxisMode === "log"
        ? PriceScaleMode.Logarithmic
        : PriceScaleMode.Normal;
  $: applyPriceScaleMode(chartPriceScaleMode);
  $: if (tradeMode === "perps") applyLastPriceLine(chartPrice, change24h);
  $: marketFresh = formatAge(lastMarketUpdate);
  $: candleCountdown =
    tradeMode === "spot"
      ? "15m bars"
      : formatCandleCountdown(latestCandle, selectedTimeframe, nowMs);
  $: selectedMarketRows = selectedMarketTableRows(
    selectedMarket,
    marketStats,
    latestPrice,
  );
  $: fundingPercent =
    marketStats?.funding != null ? marketStats.funding * 100 : null;
  $: priceLoading = chartPrice === null;
  $: docTitle = (() => {
    if (tradeMode === "spot" && spotAsset) {
      return spotAsset.price !== null
        ? `${formatPrice(spotAsset.price)} ${spotAsset.symbol} · Trader Ralph`
        : `${spotAsset.symbol} · Trader Ralph`;
    }
    return latestPrice !== null
      ? `${formatPrice(latestPrice)} ${selectedSymbol}-PERP · Trader Ralph`
      : "Trader Ralph";
  })();
  $: statsLoading = marketStats === null;
  $: bookLoading = asks.length === 0 || bids.length === 0;
  $: updatedLoading = lastMarketUpdate === null;
  // Perp ticket preview/AI reads run only when a perp ticket is showing.
  // Desktop stacks the ticket permanently; narrow viewports gate on the tab.
  $: ticketActive =
    tradeOpen ||
    (tradeMode === "perps" && (stackedBook || bookTab === "trade"));
  $: tradePreview = ticketActive
    ? buildTradePreview(
        tradeSide,
        effectiveTradeAmount,
        tradeLeverage,
        tradeType,
        tradeLimitPrice,
        asks,
        bids,
        latestPrice,
        fundingPercent,
      )
    : null;
  // Funding gate: isolated orders draw margin from the parent Phoenix
  // account, so it must hold enough collateral before placing a trade.
  // Reduce-only orders transfer no margin, so they never need funding.
  $: requiredMarginUsd =
    tradePreview && !tradeReduceOnly
      ? tradePreview.notionalUsd / tradeLeverage
      : 0;
  $: phoenixCollateral = phoenixTrader?.collateralUsd ?? 0;
  $: phoenixStateKnown = phoenixTrader !== null;
  // "Deposit first" is a strong claim: it may only come from a
  // this-session on-chain read of free collateral (never the lagging
  // indexer, never a device snapshot), and the shortfall must hold for a
  // beat — transitional refreshes while funds move between subaccounts
  // can never flash it.
  $: fundingShortfallRaw =
    Boolean(phoenixAuthority) &&
    phoenixStateKnown &&
    phoenixTrader?.chainVerified === true &&
    requiredMarginUsd > 0 &&
    phoenixCollateral + 0.01 < requiredMarginUsd;
  let fundingShortfallSince: number | null = null;
  $: if (!fundingShortfallRaw) {
    fundingShortfallSince = null;
  } else if (fundingShortfallSince === null) {
    fundingShortfallSince = Date.now();
  }
  $: needsPhoenixFunding =
    fundingShortfallRaw &&
    fundingShortfallSince !== null &&
    nowMs - fundingShortfallSince >= 1_200;

  // ── Ambient risk (Bloomberg posture) ───────────────────────────────
  // The trader API stopped shipping uPnL/liq per position; reconstruct
  // client-side: uPnL from live mids, liq from the isolated subaccount's
  // margin with an estimated maintenance ratio (half the initial margin at
  // max leverage). Labeled "est." wherever rendered.
  $: enrichedPositions = (phoenixTrader?.positions ?? []).map((position) =>
    enrichPosition(
      position,
      marketMids[position.symbol] ??
        (position.symbol === selectedSymbol ? latestPrice : null),
      markets.find((m) => m.symbol === position.symbol),
    ),
  );
  $: accountUpnlUsd = enrichedPositions.reduce(
    (sum, position) => sum + (position.unrealizedPnl ?? 0),
    0,
  );
  $: accountEquityUsd = phoenixTotalCollateral + accountUpnlUsd;
  $: marginInUseUsd = enrichedPositions.reduce(
    (sum, position) => sum + (position.marginUsd ?? 0),
    0,
  );
  $: marginUsedPct =
    phoenixTotalCollateral > 0
      ? (marginInUseUsd / phoenixTotalCollateral) * 100
      : 0;
  // ── Day P&L (device-local equity history) ──────────────────────────
  // Sampled on the trader refresh; baseline = first sample of the UTC day,
  // shifted by in-app deposits/withdrawals at their confirm sites.
  $: equityPoints = phoenixAuthority
    ? $equityHistory[phoenixAuthority] ?? []
    : [];
  $: equityValues = equityPoints.map((point) => point.equity);
  $: equityBaseline = phoenixAuthority
    ? $equityBaselines[phoenixAuthority] ?? null
    : null;
  $: sessionPnlUsd = equityBaseline
    ? accountEquityUsd - equityBaseline.equity
    : null;
  $: sessionPnlPct =
    equityBaseline && equityBaseline.equity > 0 && sessionPnlUsd !== null
      ? (sessionPnlUsd / equityBaseline.equity) * 100
      : null;
  // Market context attached to every money event — the model's "state".
  function marketContext(): Record<string, unknown> {
    return {
      symbol: selectedSymbol,
      venue: tradeMode,
      mark: latestPrice,
      spreadBps: Number.isFinite(spreadBps) ? spreadBps : null,
      fundingPct8h: fundingPercent,
      openInterest: marketStats?.openInterest ?? null,
      vol24h: marketStats?.dayNtlVlm ?? null,
      wallet: phoenixAuthority || null,
      equityUsd: accountEquityUsd,
      freeCollateralUsd: phoenixCollateral,
    };
  }

  function liqDistancePctOf(position: PhoenixPosition): number | null {
    return liqDistancePct(
      position,
      marketMids[position.symbol] ??
        (position.symbol === selectedSymbol ? latestPrice : null),
    );
  }

  $: selectedPosition =
    enrichedPositions.find((position) => position.symbol === selectedSymbol) ??
    null;
  // The checkbox only means something against a live position — drop it the
  // moment the position is gone (closed, or the ticket switched symbols).
  $: if (!selectedPosition && tradeReduceOnly) tradeReduceOnly = false;
  $: selectedLiqDistancePct =
    selectedPosition?.liquidationPrice != null && latestPrice
      ? (Math.abs(latestPrice - selectedPosition.liquidationPrice) /
          latestPrice) *
        100
      : null;

  // ── TP/SL selection ────────────────────────────────────────────────
  // Chips quick-set trigger prices relative to the same reference price the
  // submit validation uses; the inputs stay the source of truth so precise
  // hand-entry still works. Wrong-side values are flagged as you type
  // instead of failing at submit.
  $: triggerRefPrice =
    tradeType === "limit" && Number(tradeLimitPrice) > 0
      ? Number(tradeLimitPrice)
      : (tradePreview?.entry ?? latestPrice) || null;
  $: tpValue = Number(tradeTakeProfit);
  $: slValue = Number(tradeStopLoss);
  $: tpSet = Number.isFinite(tpValue) && tpValue > 0;
  $: slSet = Number.isFinite(slValue) && slValue > 0;
  $: tpWrongSide =
    tpSet && triggerRefPrice !== null
      ? tradeSide === "buy"
        ? tpValue <= triggerRefPrice
        : tpValue >= triggerRefPrice
      : false;
  $: slWrongSide =
    slSet && triggerRefPrice !== null
      ? tradeSide === "buy"
        ? slValue >= triggerRefPrice
        : slValue <= triggerRefPrice
      : false;
  $: tpPct =
    tpSet && triggerRefPrice
      ? ((tpValue - triggerRefPrice) / triggerRefPrice) * 100
      : null;
  $: slPct =
    slSet && triggerRefPrice
      ? ((slValue - triggerRefPrice) / triggerRefPrice) * 100
      : null;
  $: tpPnlUsd =
    tpPct !== null && tradePreview
      ? tradePreview.notionalUsd * (tpPct / 100) * (tradeSide === "buy" ? 1 : -1)
      : null;
  $: slPnlUsd =
    slPct !== null && tradePreview
      ? tradePreview.notionalUsd * (slPct / 100) * (tradeSide === "buy" ? 1 : -1)
      : null;
  // The ticket only blocks on ITS symbol's open — Close/Cancel stay live.
  $: orderBusyKey = `order:${selectedSymbol}`;
  $: orderBusy = phoenixBusyKeys.has(orderBusyKey);
  $: orderStageEntry = txStages[orderBusyKey] ?? null;

  function setTakeProfitPct(pct: number): void {
    if (!triggerRefPrice) return;
    tradeTakeProfit = fmtTriggerPrice(
      triggerPriceForPct(triggerRefPrice, tradeSide, pct, "tp"),
    );
  }

  function setStopLossPct(pct: number): void {
    if (!triggerRefPrice) return;
    tradeStopLoss = fmtTriggerPrice(
      triggerPriceForPct(triggerRefPrice, tradeSide, pct, "sl"),
    );
  }

  // ── Size presets ───────────────────────────────────────────────────
  // USD mode: % of free collateral × leverage; Max keeps the same $0.01
  // margin buffer the funding gate tolerates so a Max ticket can't flash
  // "Deposit first". Risk mode: % of account equity put at risk.
  const SIZE_CHIP_PCTS = [10, 25, 50];
  const RISK_CHIP_PCTS = [0.5, 1, 2];
  // Chip-sized tickets re-follow leverage changes; hand-typed sizes never
  // move underneath the trader.
  let sizeSource: "chip" | "manual" = "manual";
  let sizeChipPct: number | "max" | null = null;

  function chipNotionalUsd(pct: number | "max"): number {
    const margin =
      pct === "max"
        ? Math.max(0, phoenixCollateral - 0.01)
        : (pct / 100) * phoenixCollateral;
    return margin * tradeLeverage;
  }

  function setSizeChip(pct: number | "max"): void {
    tradeAmount = chipNotionalUsd(pct).toFixed(2);
    sizeSource = "chip";
    sizeChipPct = pct;
  }

  function setRiskChip(pct: number): void {
    tradeRiskUsd = ((pct / 100) * accountEquityUsd).toFixed(2);
    sizeSource = "chip";
    // Risk chips don't depend on leverage — nothing to re-derive later.
    sizeChipPct = null;
  }

  $: recomputeChipSize(tradeLeverage);
  function recomputeChipSize(_leverage: number): void {
    if (sizeSource !== "chip" || sizeChipPct === null || sizingMode !== "usd") return;
    tradeAmount = chipNotionalUsd(sizeChipPct).toFixed(2);
  }

  // ── Keyboard: Enter submits, arrows step ───────────────────────────
  // Enter-to-submit shares the exact gate that enables each submit button.
  $: canSubmitPerp =
    Boolean(phoenixAuthority) &&
    phoenixStateKnown &&
    !needsPhoenixFunding &&
    !orderBusy &&
    Boolean(tradePreview) &&
    !walletScreen.flagged;
  $: canSubmitSpot =
    Boolean(phoenixAuthority) &&
    !spotBusy &&
    !walletScreen.flagged &&
    (spotOrderType === "limit"
      ? Number(spotLimitPrice) > 0 && Number(spotAmount) > 0
      : spotQuote !== null && spotQuoteStatus === "quoted");

  // ── Limit deviation gate ───────────────────────────────────────────
  // A dropped decimal (2450 instead of 245.0) would otherwise execute in
  // one click. Crossing the touch is informational only (marketable limits
  // are a real tactic); >5% from mark arms a two-stage confirm; >25%
  // blocks outright. Same tiers on the spot limit ticket, against the
  // catalog price (spot has no live book, so no crossing tier there).
  $: limitPriceValue = tradeType === "limit" ? Number(tradeLimitPrice) : 0;
  $: limitDeviationPct =
    limitPriceValue > 0 && latestPrice
      ? ((limitPriceValue - latestPrice) / latestPrice) * 100
      : null;
  $: limitCrossesBook =
    limitPriceValue > 0 &&
    (tradeSide === "buy"
      ? asks.length > 0 && limitPriceValue >= asks[0].price
      : bids.length > 0 && limitPriceValue <= bids[0].price);
  $: limitNeedsConfirm =
    limitDeviationPct !== null && Math.abs(limitDeviationPct) > 5;
  $: limitBlocked =
    limitDeviationPct !== null && Math.abs(limitDeviationPct) > 25;
  let limitArmedUntil = 0;
  $: limitArmed = limitNeedsConfirm && nowMs < limitArmedUntil;

  function onPerpSubmitClick(): void {
    if (!canSubmitPerp || limitBlocked) return;
    if (limitNeedsConfirm && Date.now() >= limitArmedUntil) {
      limitArmedUntil = Date.now() + 3_000;
      return;
    }
    limitArmedUntil = 0;
    void submitPhoenixOrder();
  }

  $: spotLimitPriceValue = spotOrderType === "limit" ? Number(spotLimitPrice) : 0;
  $: spotLimitDeviationPct =
    spotLimitPriceValue > 0 && spotAsset?.price
      ? ((spotLimitPriceValue - spotAsset.price) / spotAsset.price) * 100
      : null;
  $: spotLimitNeedsConfirm =
    spotLimitDeviationPct !== null && Math.abs(spotLimitDeviationPct) > 5;
  $: spotLimitBlocked =
    spotLimitDeviationPct !== null && Math.abs(spotLimitDeviationPct) > 25;
  let spotLimitArmedUntil = 0;
  $: spotLimitArmed = spotLimitNeedsConfirm && nowMs < spotLimitArmedUntil;

  function onSpotLimitSubmitClick(): void {
    if (!canSubmitSpot || spotLimitBlocked) return;
    if (spotLimitNeedsConfirm && Date.now() >= spotLimitArmedUntil) {
      spotLimitArmedUntil = Date.now() + 3_000;
      return;
    }
    spotLimitArmedUntil = 0;
    void submitSpotLimitOrder();
  }

  function onTicketKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    // Same gate + arm/confirm two-step as the submit button.
    onPerpSubmitClick();
  }

  function onSpotTicketKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    if (!canSubmitSpot) return;
    if (spotOrderType === "limit") onSpotLimitSubmitClick();
    else void executeSpotSwap();
  }

  // Arrow keys step numeric ticket inputs (Shift = ×10), clamped at zero.
  // Price fields step by the formatBookPrice magnitude rule and re-format
  // via fmtTriggerPrice so the string stays Number()-parseable; USD fields
  // step $5. Writes back through a real input event so bind:value (and any
  // oninput side effect, e.g. scheduleSpotQuote) fires.
  function stepInput(
    node: HTMLInputElement,
    params: { kind: "usd" | "price" },
  ): { update: (next: { kind: "usd" | "price" }) => void; destroy: () => void } {
    let kind = params.kind;
    function onKeydown(event: KeyboardEvent): void {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const current = Number(node.value);
      const base = Number.isFinite(current) && current > 0 ? current : 0;
      const unit =
        kind === "usd" ? 5 : base >= 1_000 ? 1 : base >= 1 ? 0.01 : 0.0001;
      const delta =
        unit * (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
      const next = Math.max(0, base + delta);
      node.value =
        kind === "price" ? fmtTriggerPrice(next) : String(Number(next.toFixed(2)));
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }
    node.addEventListener("keydown", onKeydown);
    return {
      update(next: { kind: "usd" | "price" }) {
        kind = next.kind;
      },
      destroy() {
        node.removeEventListener("keydown", onKeydown);
      },
    };
  }

  // ── Cross-venue twins: basis between the perp and its spot token ──
  $: spotTwin =
    spotAssets.find((asset) => asset.symbol.toUpperCase() === selectedSymbol) ?? null;
  $: perpMidForBasis = marketMids[selectedSymbol] ?? latestPrice;
  $: perpBasisBps =
    spotTwin?.price && perpMidForBasis
      ? ((perpMidForBasis - spotTwin.price) / spotTwin.price) * 10_000
      : null;
  $: spotPerpMid = spotAsset ? (marketMids[spotAsset.symbol.toUpperCase()] ?? null) : null;
  $: spotBasisBps =
    spotAsset?.price && spotPerpMid
      ? ((spotPerpMid - spotAsset.price) / spotAsset.price) * 10_000
      : null;

  // ── Watchlist rows: price from spot, fall back to perp mid; basis when both ──
  $: watchRows = buildWatchRows(watchlist, spotAssets, marketMids, markets);

  // ── Account exposure / leverage (margin meter, deterministic) ──
  $: accountExposureUsd = (phoenixTrader?.positions ?? []).reduce(
    (sum, position) => sum + Math.abs(position.positionValue ?? 0),
    0,
  );
  $: accountLeverage =
    phoenixCollateral > 0 && accountExposureUsd > 0
      ? accountExposureUsd / phoenixCollateral
      : null;

  // ── Risk-based sizing: notional from stop distance ──
  $: riskEntryPrice =
    tradeType === "limit" && Number(tradeLimitPrice) > 0
      ? Number(tradeLimitPrice)
      : (latestPrice ?? 0);
  $: riskStopPrice = Number(tradeStopLoss);
  $: riskNotionalUsd =
    sizingMode === "risk"
      ? riskNotional(Number(tradeRiskUsd), riskEntryPrice, riskStopPrice)
      : null;
  $: effectiveTradeAmount =
    sizingMode === "risk"
      ? riskNotionalUsd !== null
        ? String(riskNotionalUsd)
        : ""
      : tradeAmount;

  // ── Screener rows over the catalog ──
  $: screenRows = buildScreenRows(spotAssets, screenHub, screenSort);

  // ── Journal-derived views + AI notes (facts computed, AI narrates) ──
  $: journalToday = entriesToday(journalEntries, Date.now());
  $: positionBriefKey = (phoenixTrader?.positions ?? [])
    .map((position) => `${position.symbol}:${position.size.toFixed(4)}`)
    .join("|");
  $: if (positionBriefKey && positionBriefKey !== briefKey) {
    briefKey = positionBriefKey;
    void runPositionBrief();
  }
  $: if (journalToday.length >= 2 && journalToday.length !== recapKey) {
    recapKey = journalToday.length;
    void runSessionRecap();
  }

  // Liq lines re-render when positions, market, or chart mode change.
  $: lineLabelTick = Math.floor(nowMs / 2_000);
  $: perpOpenOrders = phoenixTrader?.orders ?? [];
  $: refreshChartLines(
    enrichedPositions,
    perpOpenOrders,
    $alerts,
    $chartLinePrefs,
    selectedSymbol,
    tradeMode,
  ), lineLabelTick;

  // Spot limit orders follow the connected wallet.
  $: if ($privyAuth.walletAddress !== triggerWallet) {
    triggerWallet = $privyAuth.walletAddress ?? "";
    void refreshTriggerOrders();
  }

  // Stable key: deliberately excludes live price so the desk read doesn't
  // re-run (and re-flow) on every tick while the ticket is open.
  // Desk read removed from the ticket (2026-07-02): no per-keystroke AI
  // calls for a line that no longer renders. AiReadLine still serves the
  // other panels (funding, brief, events, ideas, scanner, recap).
  $: if (prefsReady)
    persistPrefs(
      selectedSymbol,
      selectedTimeframe,
      priceMode,
      chartScale,
      chartAxisMode,
      visibleCandleCount,
      // Carry unapplied pendings through so a boot-time persist can't clobber
      // restored spot prefs before loadSpotAssets applies them.
      pendingTradeMode ?? tradeMode,
      spotAsset?.assetId ?? pendingSpotAssetId,
      watchlist,
      screenSort,
      screenHub,
      sizingMode,
      tradeAmount,
      tradeRiskUsd,
      tradeLeverage,
    );

  onMount(() => {
    loadOpenBetaBanner();
    loadPrefs();
    applyDeepLink(); // ?asset=&venue=&side=… — overrides restored prefs
    alertsStore.load({ trackContext: marketContext });
    journalEntries = loadJournal();
    loadLayout();
    hydrateWidgetCache();
    prefsReady = true;
    createChartInstance();
    void bootPhoenixMarketData();
    void refreshEdgeModules();
    void initializePrivyAuth().then(() => refreshEdgeModules());
    void loadSpotAssets();
    window.setTimeout(() => void refreshAiReads(), 4_000);

    const timers = [
      window.setInterval(() => {
        updateStreamHealth();
      }, 3_000),
      window.setInterval(() => {
        nowMs = Date.now();
      }, 1_000),
      window.setInterval(() => {
        void refreshEdgeModules();
      }, 60_000),
      window.setInterval(() => {
        if (walletBalanceAddress) {
          void refreshWalletBalance(walletBalanceAddress, { quiet: true });
        }
      }, 30_000),
      window.setInterval(() => {
        void refreshAiReads();
      }, 45_000),
      window.setInterval(() => {
        if (phoenixAuthority) void refreshPhoenixTrader();
      }, 12_000),
      window.setInterval(() => {
        void refreshDailyStats();
      }, 60_000),
      window.setInterval(() => {
        void probeRpc();
      }, 15_000),
      window.setInterval(() => {
        if (!phoenixAuthority || enrichedPositions.length === 0) return;
        track("pnl_snapshot", {
          ...marketContext(),
          positions: enrichedPositions.map((position) => ({
            symbol: position.symbol,
            size: position.size,
            entry: position.entryPrice,
            upnl: position.unrealizedPnl,
            liq: position.liquidationPrice,
            marginUsd: position.marginUsd,
          })),
        });
      }, 60_000),
    ];
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void healChartGaps(true);
        if (phoenixAuthority) void refreshPhoenixTrader();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    // Same breakpoint as the grid collapse: desktop stacks ladder + ticket,
    // narrow keeps the tab UI (matches railTicketUsable()).
    const stackMq = window.matchMedia("(max-width: 1100px)");
    stackedBook = !stackMq.matches;
    const onStackMq = (event: MediaQueryListEvent) => {
      stackedBook = !event.matches;
    };
    stackMq.addEventListener("change", onStackMq);
    return () => {
      phoenixStream?.close();
      window.cancelAnimationFrame(bookFrame);
      document.removeEventListener("visibilitychange", onVisible);
      stackMq.removeEventListener("change", onStackMq);
      for (const timer of timers) window.clearInterval(timer);
      if (fundsPollTimer !== null) window.clearInterval(fundsPollTimer);
      if (copyResetTimer) clearTimeout(copyResetTimer);
      if (swapQuoteTimer) clearTimeout(swapQuoteTimer);
      if (spotQuoteTimer) clearTimeout(spotQuoteTimer);
      if (spotChartTimer) clearInterval(spotChartTimer);
      lwChart?.remove();
      lwChart = null;
      candleSeries = null;
      volumeSeries = null;
      lastPriceLine = null;
    };
  });

  function onMarketChange(value: string): void {
    void switchPhoenixMarket(value);
  }

  function onTimeframeChange(timeframe: PhoenixTimeframe): void {
    if (timeframe === selectedTimeframe) return;
    selectedTimeframe = timeframe;
    if (tradeMode === "spot") {
      void loadSpotChart();
    } else {
      void switchPhoenixMarket(selectedSymbol);
    }
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([switchPhoenixMarket(selectedSymbol), refreshEdgeModules()]);
  }

  async function bootPhoenixMarketData(): Promise<void> {
    streamHealth = "connecting";
    try {
      markets = await fetchPhoenixMarkets();
      void refreshDailyStats();
      void probeRpc();
      const defaultMarket =
        markets.find((market) => market.symbol === selectedSymbol) ??
        markets.find((market) => market.symbol === DEFAULT_PHOENIX_SYMBOL) ??
        markets.find((market) => market.marketStatus === "active") ??
        markets[0];
      selectedSymbol = defaultMarket?.symbol ?? DEFAULT_PHOENIX_SYMBOL;
      await switchPhoenixMarket(selectedSymbol);
    } catch {
      streamHealth = "offline";
      marketSourceLabel = "Phoenix Perps unavailable";
    }
  }

  async function switchPhoenixMarket(symbol: string): Promise<void> {
    track("market_switched", { from: selectedSymbol, to: symbol, venue: "perps" });
    if (!symbol) return;
    // Price-anchored ticket fields are stale on a different market — a SOL
    // limit at 150 would cross the entire BTC book as taker. Clear them
    // (never re-anchor); size and leverage persist across the switch.
    if (symbol !== selectedSymbol) {
      tradeLimitPrice = "";
      tradeTakeProfit = "";
      tradeStopLoss = "";
      limitArmedUntil = 0;
    }
    phoenixStream?.close();
    phoenixStream = null;
    selectedSymbol = symbol;
    marketStats = null;
    legendCandle = null;
    clearMarket();

    // Paint cached candles instantly (no spinner) while fresh data loads.
    const cached = getCachedCandles(symbol, selectedTimeframe);
    if (cached && cached.length) {
      chartPoints = cached;
      latestPrice = cached.at(-1)?.close ?? null;
      lastMarketUpdate = cached.at(-1)?.ts ?? null;
      setChartData();
      if (tradeMode === "perps") setVisibleCandleRange(visibleCandleCount);
      streamHealth = "stale";
    } else {
      streamHealth = "connecting";
    }
    marketSourceLabel = `Phoenix Perps ${symbol}`;

    try {
      const snapshot = await fetchPhoenixInitialMarketData(
        symbol,
        selectedTimeframe,
      );
      latestPrice = snapshot.latestPrice;
      lastMarketUpdate = snapshot.lastMarketUpdate;
      chartPoints = snapshot.chartPoints;
      setChartData();
      if (tradeMode === "perps" && (!cached || !cached.length)) {
        setVisibleCandleRange(visibleCandleCount);
      }
      marketSourceLabel = `${snapshot.source.provider} ${snapshot.source.symbol}`;
      streamHealth = "live";
      startPhoenixStream(symbol);
    } catch {
      streamHealth = latestPrice ? "stale" : "offline";
    }
  }

  function clearMarket(): void {
    latestPrice = null;
    lastMarketUpdate = null;
    chartPoints = [];
    if (tradeMode === "perps") {
      candleSeries?.setData([]);
      volumeSeries?.setData([]);
    }
    legendCandle = null;
    bids = [];
    asks = [];
    trades = [];
    bookVersion = 0;
    marketVolume24h = null;
    marketSourceLabel = phoenixSource(selectedSymbol).displayPair;
  }

  function startPhoenixStream(symbol: string): void {
    phoenixStream = connectPhoenixMarketStream(
      symbol,
      {
      onOpen: () => {
        streamHealth = "live";
        // On reconnect, backfill candles missed while disconnected.
        if (chartPoints.length > 0) void healChartGaps(true);
      },
      onStatus: (status) => {
        if (status === "streaming") streamHealth = "live";
        if (status === "connecting" || status === "reconnecting") {
          streamHealth = latestPrice ? "stale" : "connecting";
        }
      },
      onCandle: (point) => {
        chartPoints = upsertLiveCandle(chartPoints, point);
        updateChartPoint(point);
        cacheCandles(symbol, selectedTimeframe, chartPoints);
        latestPrice = marketStats?.markPx ?? point.markClose ?? point.close;
        lastMarketUpdate = Date.now();
        streamHealth = "live";
      },
      onOrderbook: (payload) => {
        pendingBook = payload;
        if (bookFrame) return;
        bookFrame = window.requestAnimationFrame(() => {
          if (pendingBook) {
            bids = pendingBook.bids;
            asks = pendingBook.asks;
            latestPrice = marketStats?.markPx ?? pendingBook.mid ?? latestPrice;
            lastMarketUpdate = Date.now();
            bookVersion += 1;
            pendingBook = null;
            streamHealth = "live";
          }
          bookFrame = 0;
        });
      },
      onMarket: (stats) => {
        marketStats = stats;
        latestPrice = stats.markPx ?? stats.midPx ?? latestPrice;
        marketVolume24h = stats.dayNtlVlm;
        lastMarketUpdate = Date.now();
        streamHealth = "live";
      },
      onTrades: (nextTrades) => {
        trades = nextTrades;
        lastMarketUpdate = Date.now();
      },
      onFunding: (funding) => {
        marketStats = {
          ...(marketStats ?? emptyMarketStats(symbol)),
          funding,
        };
      },
      onAllMids: (mids) => {
        marketMids = mids;
        latestPrice = mids[symbol] ?? latestPrice;
      },
      },
      selectedTimeframe,
    );
  }

  function updateStreamHealth(): void {
    if (!lastMarketUpdate) return;
    if (Date.now() - lastMarketUpdate > 15_000) {
      streamHealth = latestPrice ? "stale" : "offline";
      // Stream went quiet — heal any candle gap so the chart keeps moving.
      void healChartGaps();
    }
  }

  // Refetch candle history to fill gaps after disconnects / sleep / tab-hide.
  let lastChartHeal = 0;
  async function healChartGaps(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - lastChartHeal < 30_000) return;
    lastChartHeal = now;
    try {
      const points = await fetchPhoenixCandles(selectedSymbol, selectedTimeframe);
      if (points.length < 2) return;
      chartPoints = points;
      if (tradeMode === "perps") setChartData();
      const latest = points.at(-1);
      if (latest) {
        latestPrice = marketStats?.markPx ?? latest.close;
        lastMarketUpdate = now;
        streamHealth = "live";
      }
    } catch {
      // keep current chart — stream reconnect will retry
    }
  }

  async function refreshEdgeModules(): Promise<void> {
    edgeSource = edgeApiBase() || "not configured";
    edgeStatus = "loading";
    const accessToken = await activePrivyAccessToken();
    const now = Date.now();
    const [macro, etf, stablecoin, rates, oil] = await Promise.all([
      fetchMacroSignalsRows(accessToken),
      fetchEtfRows(accessToken),
      fetchStablecoinRows(accessToken),
      fetchRatesPanel(now),
      fetchOilPanel(now),
    ]);
    macroPanel = macro;
    etfPanel = etf;
    stablecoinPanel = stablecoin;
    fredPanel = rates;
    oilPanel = oil;
    edgeStatus = summarizeEdgeStatus([macro, etf, stablecoin]);
    persistPanelCache();
    void refreshAiReads();
    void refreshIntel(now);
  }

  async function refreshIntel(nowMs: number): Promise<void> {
    try {
      news = await fetchNews(nowMs);
      if (news.length) swrWrite(CACHE_NEWS, news);
    } catch {
      // feed hiccup — keep last headlines
    }
    if (aiDisabled()) return;
    await Promise.allSettled([runEventRead(), runIdeas()]);
    persistReadCache();
  }

  async function runEventRead(): Promise<void> {
    if (news.length === 0) return;
    const headlines = news.slice(0, 10).map((item) => ({
      title: item.title,
      domain: item.domain,
    }));
    eventRead = { phase: "loading", text: eventRead.text };
    try {
      eventRead = { phase: "ready", asOf: Date.now(), text: await aiEventRead(headlines) };
    } catch (error) {
      eventRead = { phase: "error", text: "", error: aiErr(error) };
    }
  }

  async function runIdeas(): Promise<void> {
    if (markets.length === 0) return;
    const snapshot = {
      regime: fredPanel.summary?.label ?? null,
      macroVerdict: macroPanel.summary?.label ?? null,
      selected: selectedSymbol,
      fundingPct8h: fundingPercent,
      change24hPct: change24h,
      markets: markets.slice(0, 12).map((market) => ({
        symbol: market.symbol,
        mid: marketMids[market.symbol] ?? null,
      })),
    };
    ideasRead = { phase: "loading", text: ideasRead.text };
    try {
      ideasRead = { phase: "ready", asOf: Date.now(), text: await aiTradeIdeas(snapshot) };
    } catch (error) {
      ideasRead = { phase: "error", text: "", error: aiErr(error) };
    }
  }

  async function refreshAiReads(): Promise<void> {
    if (markets.length) {
      swrWrite(CACHE_MARKETS, { markets, mids: marketMids });
    }
    if (aiDisabled()) return;
    await Promise.allSettled([runMacroRead(), runFundingRead(), runScannerRead()]);
    persistReadCache();
  }

  // ── Sanctions screening ───────────────────────────────────────────
  async function screenWallet(address: string): Promise<void> {
    screenedAddress = address;
    if (!address) {
      walletScreen = { flagged: false, checked: false };
      return;
    }
    walletScreen = await screenSolanaAddress(address);
  }

  // News coded to the tape: filter the headline panel to the active
  // market (toggleable), and track last-hour headline velocity for it.
  let newsLinked = true;
  $: activeNewsSymbol =
    tradeMode === "spot" ? (spotAsset?.symbol ?? null) : selectedSymbol;
  $: linkedNews =
    newsLinked && activeNewsSymbol
      ? news.filter((item) => headlineMatches(item.title, activeNewsSymbol))
      : news;
  $: headlineVelocity = activeNewsSymbol
    ? news.filter(
        (item) =>
          headlineMatches(item.title, activeNewsSymbol) &&
          nowMs - item.seenMs < 3_600_000,
      ).length
    : 0;

  // ── Draggable dashboard layout (store lives in $lib/terminal/layout) ──
  function loadLayout(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!raw) return;
      layout.setOrder(
        mergeLayout(migrateLayout(JSON.parse(raw)), DEFAULT_PANEL_ORDER),
      );
    } catch {
      // ignore malformed layout
    }
  }

  function saveLayout(order: string[]): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(order));
    } catch {
      // storage unavailable — non-fatal
    }
  }

  // ── Stale-while-revalidate widget cache ───────────────────────────
  type ReadCache = {
    macro?: string;
    funding?: string;
    scanner?: string;
    event?: string;
    ideas?: string;
  };

  function hydrateWidgetCache(): void {
    const panels = swrRead<{
      macro: DataPanel;
      fred: DataPanel;
      etf: DataPanel;
      stablecoin: DataPanel;
      oil: DataPanel;
    }>(CACHE_PANELS, CACHE_MAX_AGE);
    if (panels) {
      macroPanel = panels.macro ?? macroPanel;
      fredPanel = panels.fred ?? fredPanel;
      etfPanel = panels.etf ?? etfPanel;
      stablecoinPanel = panels.stablecoin ?? stablecoinPanel;
      oilPanel = panels.oil ?? oilPanel;
    }
    const cachedNews = swrRead<NewsItem[]>(CACHE_NEWS, CACHE_MAX_AGE);
    if (cachedNews) news = cachedNews;
    const cachedMarkets = swrRead<{
      markets: PhoenixMarketConfig[];
      mids: Record<string, number>;
    }>(CACHE_MARKETS, MARKETS_MAX_AGE);
    if (cachedMarkets) {
      markets = cachedMarkets.markets ?? markets;
      marketMids = cachedMarkets.mids ?? marketMids;
    }
    const reads = swrRead<ReadCache>(CACHE_READS, CACHE_MAX_AGE);
    if (reads) {
      if (reads.macro) macroRead = { phase: "ready", text: reads.macro };
      if (reads.funding) fundingRead = { phase: "ready", text: reads.funding };
      if (reads.scanner) scannerRead = { phase: "ready", text: reads.scanner };
      if (reads.event) eventRead = { phase: "ready", text: reads.event };
      if (reads.ideas) ideasRead = { phase: "ready", text: reads.ideas };
    }
  }

  function persistPanelCache(): void {
    swrWrite(CACHE_PANELS, {
      macro: macroPanel,
      fred: fredPanel,
      etf: etfPanel,
      stablecoin: stablecoinPanel,
      oil: oilPanel,
    });
  }

  function persistReadCache(): void {
    const reads: ReadCache = {};
    if (macroRead.phase === "ready") reads.macro = macroRead.text;
    if (fundingRead.phase === "ready") reads.funding = fundingRead.text;
    if (scannerRead.phase === "ready") reads.scanner = scannerRead.text;
    if (eventRead.phase === "ready") reads.event = eventRead.text;
    if (ideasRead.phase === "ready") reads.ideas = ideasRead.text;
    swrWrite(CACHE_READS, reads);
  }

  $: layoutCustomized =
    $panelOrder.join(",") !== DEFAULT_PANEL_ORDER.join(",");

  async function runMacroRead(): Promise<void> {
    const meaningful = macroPanel.rows.filter(
      (row) => row.value && row.value !== "--" && row.value !== "Not connected",
    );
    if (macroPanel.status !== "ready" || meaningful.length === 0) return;
    const snapshot = {
      verdict: macroPanel.summary?.label ?? null,
      signals: macroPanel.rows.map((row) => ({
        signal: row.label,
        value: row.value,
        status: row.status,
      })),
    };
    macroRead = { phase: "loading", text: macroRead.text };
    try {
      macroRead = { phase: "ready", asOf: Date.now(), text: await aiMacroRead(snapshot) };
    } catch (error) {
      macroRead = { phase: "error", text: "", error: aiErr(error) };
    }
  }

  async function runFundingRead(): Promise<void> {
    if (!marketStats || marketStats.funding == null) return;
    const snapshot = {
      symbol: selectedSymbol,
      markPx: marketStats.markPx,
      oraclePx: marketStats.oraclePx,
      fundingPct8h: fundingPercent,
      openInterest: marketStats.openInterest,
      vol24hUsd: marketStats.dayNtlVlm,
      change24hPct: change24h,
    };
    fundingRead = { phase: "loading", text: fundingRead.text };
    try {
      fundingRead = { phase: "ready", asOf: Date.now(), text: await aiFundingRead(snapshot) };
    } catch (error) {
      fundingRead = { phase: "error", text: "", error: aiErr(error) };
    }
  }

  async function runScannerRead(): Promise<void> {
    if (markets.length === 0) return;
    const snapshot = {
      selected: selectedSymbol,
      markets: markets.slice(0, 20).map((market) => ({
        symbol: market.symbol,
        mid: marketMids[market.symbol] ?? null,
        status: market.marketStatus,
      })),
    };
    scannerRead = { phase: "loading", text: scannerRead.text };
    try {
      scannerRead = { phase: "ready", asOf: Date.now(), text: await aiScannerSetups(snapshot) };
    } catch (error) {
      scannerRead = { phase: "error", text: "", error: aiErr(error) };
    }
  }

  // Headless command parse — the visible "Parse" field is gone, but the
  // ?cmd= deep link (distribution surface contract) still lands orders by
  // filling the ticket. Failures fall back to the default ticket silently.
  async function runCommand(text: string): Promise<void> {
    if (!text.trim()) return;
    try {
      const intent = await aiParseCommand(
        text.trim(),
        markets.map((market) => market.symbol),
      );
      if (intent.symbol && intent.symbol !== selectedSymbol) {
        const match = markets.find((market) => market.symbol === intent.symbol);
        if (match) void switchPhoenixMarket(intent.symbol);
      }
      tradeSide = intent.side;
      tradeType = intent.orderType;
      if (intent.sizeUsd != null) tradeAmount = String(intent.sizeUsd);
      if (intent.leverage != null) tradeLeverage = clampLeverage(intent.leverage);
      if (intent.limitPrice != null) tradeLimitPrice = String(intent.limitPrice);
      if (intent.stopPercent != null) {
        // Convert a "1% stop" style command into a Phoenix SL trigger price.
        const ref = intent.limitPrice ?? latestPrice;
        if (ref && ref > 0) {
          const sl =
            intent.side === "buy"
              ? ref * (1 - intent.stopPercent / 100)
              : ref * (1 + intent.stopPercent / 100);
          tradeStopLoss = sl.toFixed(4);
        }
      }
      tradeOpen = true;
    } catch {
      // Deep-link parse failure: leave the default ticket in place.
    }
  }

  async function activePrivyAccessToken(): Promise<string | null> {
    if (!$privyAuth.authenticated) return $privyAuth.accessToken;
    try {
      return await getPrivyAccessToken();
    } catch {
      return $privyAuth.accessToken;
    }
  }

  async function refreshWalletBalance(
    address = walletBalanceAddress,
    opts: { quiet?: boolean } = {},
  ): Promise<void> {
    const wallet = address.trim();
    if (!wallet) {
      walletBalanceStatus = "idle";
      walletBalanceText = "-- SOL";
      usdcBalanceText = "-- USDC";
      walletBalanceError = "";
      return;
    }
    // Background polls stay quiet so the Refresh control doesn't strobe.
    if (!opts.quiet) walletBalanceStatus = "loading";
    walletBalanceError = "";
    try {
      const [lamports, usdc] = await Promise.all([
        fetchSolanaLamports(wallet),
        fetchUsdcBalance(solanaRpcUrl(), wallet).catch(() => null),
      ]);
      walletBalanceText = `${formatSolBalanceDisplay(lamports)} SOL`;
      solBalanceValue = Number(lamports) / 1e9;
      usdcBalanceValue = usdc;
      usdcBalanceText =
        usdc === null
          ? "-- USDC"
          : `${usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
      walletBalanceStatus = "ready";
    } catch (error) {
      walletBalanceStatus = "error";
      walletBalanceError = humanizeBalanceError(
        error instanceof Error ? error.message : "solana-balance-unavailable",
      );
    }
  }

  // Fast-poll balances while the funding modal is open: an incoming deposit
  // should appear in seconds (processed commitment + 4s cadence), not on the
  // 30s background tick. Timer is cleared on close and on unmount.
  let fundsPollTimer: number | null = null;
  $: if (fundsOpen && walletBalanceAddress) {
    if (fundsPollTimer === null) {
      void refreshWalletBalance(walletBalanceAddress, { quiet: true });
      fundsPollTimer = window.setInterval(() => {
        if (walletBalanceAddress) {
          void refreshWalletBalance(walletBalanceAddress, { quiet: true });
        }
      }, 4_000);
    }
  } else if (fundsPollTimer !== null) {
    window.clearInterval(fundsPollTimer);
    fundsPollTimer = null;
  }

  // Provenance: RPC round-trip + chain tip, compared with the Phoenix
  // indexer's snapshot slot — divergence is shown, not hidden.
  let rpcLatencyMs: number | null = null;
  let chainSlot: number | null = null;
  $: apiSlotLag =
    chainSlot !== null && phoenixTrader?.apiSlot != null
      ? Math.max(0, chainSlot - phoenixTrader.apiSlot)
      : null;

  async function probeRpc(): Promise<void> {
    const started = performance.now();
    try {
      const response = await fetch(solanaRpcUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "slot", method: "getSlot" }),
      });
      const payload = (await response.json()) as { result?: number };
      rpcLatencyMs = Math.round(performance.now() - started);
      if (typeof payload.result === "number") chainSlot = payload.result;
    } catch {
      rpcLatencyMs = null;
    }
  }

  // Session state for the selected market from its exchange calendar.
  $: sessionNote = sessionNoteOf(tradeMode, selectedMarket, nowMs);

  type TransactionSummary = {
    title: string;
    details: string[];
    feePayer?: string;
    programs?: string[];
  };

  function setPhoenixBusy(key: string, busy: boolean): void {
    const next = new Set(phoenixBusyKeys);
    if (busy) next.add(key);
    else next.delete(key);
    phoenixBusyKeys = next; // reassign — legacy reactivity ignores mutation
  }

  // `order:SOL` → "SOL open"; keys without a symbol segment ("flatten")
  // label as the bare kind for the footer status line.
  function txKeyLabel(key: string): string {
    const [kind, symbol] = key.split(":");
    if (!symbol) return kind;
    return `${symbol} ${kind === "order" ? "open" : kind}`;
  }

  function setTxStage(key: string, stage: TxStage): void {
    txStages = { ...txStages, [key]: { stage, sinceMs: Date.now() } };
    lastTx = { key, label: txKeyLabel(key), stage, sinceMs: Date.now() };
  }

  function clearTxStage(key: string): void {
    const next = { ...txStages };
    delete next[key];
    txStages = next;
  }

  // Only flip the footer to "failed" if THIS attempt actually entered the tx
  // pipeline: a stage entry exists iff simulateConfirmAndSend ran (the
  // caller's finally clears it after the catch). Keys repeat across attempts
  // of the same action, so without this a pre-send validation throw would
  // smear an earlier confirmed tx on the same key.
  function markLastTxFailed(key: string): void {
    if (!(key in txStages)) return;
    if (lastTx?.key === key)
      lastTx = { ...lastTx, stage: "failed", sinceMs: Date.now() };
  }

  function txStageText(
    entry: { stage: TxStage | "failed"; sinceMs: number },
    now: number,
  ): string {
    if (entry.stage === "simulating") return "Simulating…";
    if (entry.stage === "signing") return "Signing…";
    if (entry.stage === "confirming")
      return `Confirming… ${Math.max(0, Math.round((now - entry.sinceMs) / 1000))}s`;
    if (entry.stage === "confirmed") return "Confirmed";
    if (entry.stage === "failed") return "Failed";
    return "";
  }

  async function simulateConfirmAndSend(
    transaction: VersionedTransaction,
    connection: Connection,
    summary: TransactionSummary,
    latestBlockhash?: {
      blockhash: string;
      lastValidBlockHeight: number;
    },
    stageKey?: string,
  ): Promise<string> {
    if (stageKey) setTxStage(stageKey, "simulating");
    const simulation = await connection.simulateTransaction(transaction, {
      sigVerify: false,
    });
    if (simulation.value.err) {
      // Program logs carry the actual failure reason — the err object alone
      // is an opaque {"InstructionError":[n,{"Custom":x}]}. Keep the full
      // logs in the console and append the most telling line to the message.
      const logs = simulation.value.logs ?? [];
      console.error("phoenix simulation failed", simulation.value.err, logs);
      const reason = [...logs]
        .reverse()
        .find((line) => /error|failed|insufficient|invalid/i.test(line));
      throw new Error(
        `simulation-failed-${JSON.stringify(simulation.value.err)}${reason ? ` — ${reason.replace(/^Program log:\s*/, "")}` : ""}`,
      );
    }

    // Auto-sign: the button click is the consent — no blocking native
    // confirm in a fast-paced trading UI (ratified 2026-07-02). The
    // simulation above remains the safety gate (failing transactions never
    // reach the wallet); the summary goes to the console as an audit trail.
    console.info(
      "phoenix tx",
      summary.title,
      summary.details.join(" · "),
      `fee payer: ${summary.feePayer ?? transaction.message.staticAccountKeys[0]?.toBase58() ?? "unknown"}`,
      `programs: ${summary.programs?.join(", ") ?? "transaction-built route"}`,
      `simulated: ${simulation.value.unitsConsumed ?? "?"} CU`,
    );

    if (stageKey) setTxStage(stageKey, "signing");
    const signature = await signAndSendSolanaTransaction(
      transaction,
      connection,
    );
    if (stageKey) setTxStage(stageKey, "confirming");
    if (latestBlockhash) {
      await connection.confirmTransaction(
        { signature, ...latestBlockhash },
        "confirmed",
      );
    } else {
      await connection.confirmTransaction(signature, "confirmed");
    }
    if (stageKey) setTxStage(stageKey, "confirmed");
    return signature;
  }

  // ── Add funds (receive + Jupiter swap) ────────────────────────────
  function openFunds(): void {
    fundsOpen = true;
    fundsTab = "receive";
    resetSwap();
    void generateFundsQr();
    if ($privyAuth.walletAddress) void refreshWalletBalance($privyAuth.walletAddress);
  }

  async function generateFundsQr(): Promise<void> {
    const address = $privyAuth.walletAddress;
    if (!address) {
      fundsQr = "";
      return;
    }
    try {
      fundsQr = await QRCode.toString(address, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#f5eff7", light: "#00000000" },
      });
    } catch {
      fundsQr = "";
    }
  }

  function resetSwap(): void {
    swapSol = "";
    swapQuote = null;
    swapStatus = "idle";
    swapError = "";
    swapSignature = "";
  }

  function scheduleSwapQuote(): void {
    if (swapQuoteTimer) clearTimeout(swapQuoteTimer);
    swapSignature = "";
    const amount = Number(swapSol);
    if (!Number.isFinite(amount) || amount <= 0) {
      swapQuote = null;
      swapStatus = "idle";
      return;
    }
    swapStatus = "quoting";
    swapQuoteTimer = setTimeout(() => void runSwapQuote(amount), 450);
  }

  async function runSwapQuote(amount: number): Promise<void> {
    try {
      swapQuote = await getJupiterQuote(amount);
      swapStatus = "quoted";
    } catch (error) {
      swapStatus = "error";
      swapError = error instanceof Error ? error.message : "quote-failed";
    }
  }

  async function executeSwap(): Promise<void> {
    const address = $privyAuth.walletAddress;
    if (!swapQuote || !address || swapStatus === "swapping") return;
    const amount = swapQuote.inSol;
    swapStatus = "swapping";
    swapError = "";
    try {
      const base64 = await getJupiterSwapTransaction(swapQuote.raw, address);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const transaction = VersionedTransaction.deserialize(bytes);
      const connection = new Connection(solanaRpcUrl(), "confirmed");
      swapSignature = await simulateConfirmAndSend(transaction, connection, {
        title: "Swap SOL to USDC",
        details: [
          `Spend: ${formatNumber(amount, 4)} SOL`,
          `Receive est.: ${formatNumber(swapQuote.outUsdc, 2)} USDC`,
          `Price impact: ${(swapQuote.priceImpactPct * 100).toFixed(2)}%`,
        ],
        feePayer: address,
      });
      swapStatus = "done";
      track("swap_confirmed", { ...marketContext(), inSol: amount, outUsdc: swapQuote?.outUsdc ?? null });
      void refreshWalletBalance(address);
    } catch (error) {
      swapStatus = "error";
      swapError = error instanceof Error ? error.message : "swap-failed";
    }
  }

  // ── Spot venue (tokens.xyz + Jupiter) ─────────────────────────────
  async function loadSpotAssets(): Promise<void> {
    try {
      spotAssets = await fetchSpotAssets(Date.now());
      if (pendingSpotAssetId) {
        const wanted = pendingSpotAssetId.toLowerCase();
        const restored = spotAssets.find(
          (asset) =>
            asset.assetId.toLowerCase() === wanted ||
            asset.symbol.toLowerCase() === wanted,
        );
        if (restored) spotAsset = restored;
        pendingSpotAssetId = null;
      }
      if (!spotAsset && spotAssets.length > 0) {
        spotAsset =
          spotAssets.find((asset) => asset.symbol === "SOL") ?? spotAssets[0];
      } else if (spotAsset) {
        // Refresh the selected asset's live stats in place.
        spotAsset =
          spotAssets.find((asset) => asset.assetId === spotAsset?.assetId) ??
          spotAsset;
      }
      if (pendingTradeMode === "spot") {
        pendingTradeMode = null;
        // Restored pref/deep-link — keep the restored asset, don't remap.
        setTradeMode("spot", false);
      }
    } catch {
      // catalog hiccup — keep last list
    }
  }

  function setTradeMode(mode: "perps" | "spot", followAsset = true): void {
    if (tradeMode === mode) return;
    track("venue_switched", { from: tradeMode, to: mode });
    // An explicit user choice overrides any not-yet-applied restored pref.
    pendingTradeMode = null;
    tradeMode = mode;
    if (spotChartTimer) {
      clearInterval(spotChartTimer);
      spotChartTimer = null;
    }
    if (mode === "spot") {
      bookTab = "trade";
      // Take ownership of the chart surface immediately — never leave the
      // perp series sitting under a spot label while candles load.
      spotChartPoints = [];
      renderChartSeries([]);
      applyLastPriceLine(null, null);
      // Venue continuity: keep following the same asset when it also trades
      // on spot (SOL perp → SOL spot). Skipped when the switch came from an
      // explicit asset pick (selectSpotAsset) — never override that choice.
      const fromSymbol = selectedSymbol.toUpperCase();
      void loadSpotAssets().then(() => {
        const match = followAsset
          ? spotAssets.find(
              (candidate) => candidate.symbol.toUpperCase() === fromSymbol,
            )
          : null;
        if (match && spotAsset?.assetId !== match.assetId) {
          spotAsset = match;
          spotQuote = null;
          spotQuoteStatus = "idle";
          spotSignature = "";
          scheduleSpotQuote();
        }
        void loadSpotChart();
      });
      spotChartTimer = setInterval(() => void loadSpotChart(), 60_000);
    } else {
      // Restore the Phoenix perp series — on the equivalent market when the
      // spot asset also has a perp (NVDA spot → NVDA perp).
      spotChartSeq += 1; // invalidate any in-flight spot candle fetch
      const spotSymbol = spotAsset?.symbol.toUpperCase();
      const match =
        spotSymbol && spotSymbol !== selectedSymbol
          ? markets.find((market) => market.symbol === spotSymbol)
          : null;
      if (match) {
        void switchPhoenixMarket(match.symbol);
      } else {
        setChartData();
        setVisibleCandleRange(visibleCandleCount);
      }
    }
  }

  function selectSpotAsset(asset: SpotAsset): void {
    const changed = spotAsset?.assetId !== asset.assetId;
    spotAsset = asset;
    spotQuote = null;
    spotQuoteStatus = "idle";
    spotSignature = "";
    if (tradeMode !== "spot") {
      setTradeMode("spot", false); // explicit pick — don't remap the asset
    } else if (changed) {
      // New asset: blank the surface so the old series never sits mislabeled.
      spotChartPoints = [];
      renderChartSeries([]);
      void loadSpotChart();
    }
    bookTab = "trade";
    scheduleSpotQuote();
  }

  async function loadSpotChart(): Promise<void> {
    if (tradeMode !== "spot" || !spotAsset) return;
    spotChartSeq += 1;
    const seq = spotChartSeq;
    try {
      const candles = await fetchSpotCandles(
        spotAsset.assetId,
        selectedTimeframe,
        Date.now(),
      );
      // Out-of-order protection: a slower fetch for a previously selected
      // asset/timeframe must not paint over the current one.
      if (seq !== spotChartSeq || tradeMode !== "spot" || candles.length < 2) {
        return;
      }
      spotChartPoints = candles.map((candle) => ({
        ...candle,
        price: candle.close,
      }));
      renderChartSeries(spotChartPoints);
      setVisibleCandleRange(visibleCandleCount);
    } catch {
      // chart data hiccup — keep last series
    }
  }

  // ── Spot side flip ─────────────────────────────────────────────────
  // spotAmount means USDC-spent on buy but tokens-sold on sell; flipping
  // the side without converting turns a $25 buy into a 25-token sell one
  // keypress later. Convert through the asset price so the ticket keeps
  // the same economic size. Every flip path (buttons + B/S hotkeys) goes
  // through here.
  function flipSpotSide(side: "buy" | "sell"): void {
    if (side !== spotSide) {
      const amount = Number(spotAmount);
      const price = spotAsset?.price;
      if (price && price > 0 && Number.isFinite(amount) && amount > 0) {
        spotAmount = fmtTriggerPrice(side === "sell" ? amount / price : amount * price);
      }
      spotSide = side;
    }
    scheduleSpotQuote();
  }

  // ── Spot size chips ────────────────────────────────────────────────
  // % of wallet USDC on buy, % of the token holding on sell — the same
  // balances that power the ticket preview. Max buy keeps the $0.01 dust
  // buffer the perp Max chip leaves.
  const SPOT_CHIP_PCTS = [25, 50];
  $: spotChipBalance = spotSide === "buy" ? (usdcBalanceValue ?? 0) : spotHolding;

  function setSpotAmountChip(pct: number | "max"): void {
    const amount =
      pct === "max"
        ? spotSide === "buy"
          ? Math.max(0, spotChipBalance - 0.01)
          : spotChipBalance
        : (pct / 100) * spotChipBalance;
    if (amount <= 0) return;
    if (spotSide === "buy") {
      spotAmount = amount.toFixed(2);
    } else if (pct === "max") {
      // Max sell floors at fmtTriggerPrice's precision — round-half-up
      // could format above the real holding and the sell would fail
      // simulation with insufficient funds. 25/50% keep round formatting;
      // the remaining balance absorbs the half-ULP overage.
      const p = amount >= 1000 ? 1 : amount >= 10 ? 2 : amount >= 1 ? 3 : 5;
      spotAmount = (Math.floor(amount * 10 ** p) / 10 ** p).toFixed(p);
    } else {
      spotAmount = fmtTriggerPrice(amount);
    }
    scheduleSpotQuote();
  }

  function scheduleSpotQuote(): void {
    if (spotQuoteTimer) clearTimeout(spotQuoteTimer);
    // Bumping the sequence invalidates any in-flight quote — covers every
    // mutation path (amount edits, side flips, asset switches).
    spotQuoteSeq += 1;
    const seq = spotQuoteSeq;
    spotSignature = "";
    const amount = Number(spotAmount);
    if (!spotAsset || !Number.isFinite(amount) || amount <= 0) {
      spotQuote = null;
      spotQuoteStatus = "idle";
      return;
    }
    spotQuoteStatus = "quoting";
    spotQuoteTimer = setTimeout(() => void runSpotQuote(seq), 450);
  }

  async function runSpotQuote(seq: number): Promise<void> {
    const asset = spotAsset;
    const amount = Number(spotAmount);
    if (!asset || !Number.isFinite(amount) || amount <= 0) return;
    try {
      const quote =
        spotSide === "buy"
          ? await getSpotQuote(
              SPOT_USDC_MINT,
              asset.mint,
              usdcToAtoms(amount),
              asset.decimals,
            )
          : await getSpotQuote(
              asset.mint,
              SPOT_USDC_MINT,
              tokenToAtoms(amount, asset.decimals),
              6,
            );
      if (seq !== spotQuoteSeq) return; // stale response — newer request owns state
      spotQuote = quote;
      spotQuoteStatus = "quoted";
      spotQuotedAt = Date.now();
      // Quotes go stale: auto-requote so displayed pricing stays honest.
      spotQuoteTimer = setTimeout(() => scheduleSpotQuote(), 20_000);
    } catch (error) {
      if (seq !== spotQuoteSeq) return;
      spotQuoteStatus = "error";
      spotQuoteError = error instanceof Error ? error.message : "quote-failed";
    }
  }

  async function executeSpotSwap(): Promise<void> {
    const address = $privyAuth.walletAddress;
    const asset = spotAsset;
    if (!asset || !spotQuote || !address || spotBusy || walletScreen.flagged) return;
    // Freshness gate: never execute a quote older than 30s — re-quote instead.
    if (Date.now() - spotQuotedAt > 30_000) {
      scheduleSpotQuote();
      return;
    }
    spotBusy = true;
    spotQuoteError = "";
    try {
      const base64 = await getSpotSwapTransaction(spotQuote.raw, address);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const transaction = VersionedTransaction.deserialize(bytes);
      const connection = new Connection(solanaRpcUrl(), "confirmed");
      spotSignature = await simulateConfirmAndSend(transaction, connection, {
        title: `${spotSide === "buy" ? "Buy" : "Sell"} ${asset.symbol}`,
        details: [
          `Venue: Jupiter spot route`,
          `Amount: ${formatNumber(Number(spotAmount), 4)}`,
          `Receive est.: ${formatNumber(spotQuote.outUi, spotSide === "buy" ? 4 : 2)} ${spotSide === "buy" ? asset.symbol : "USDC"}`,
          `Price impact: ${(spotQuote.priceImpactPct * 100).toFixed(2)}%`,
        ],
        feePayer: address,
      });
      noteTrade({
        ts: Date.now(),
        venue: "spot",
        symbol: asset.symbol,
        action: spotSide,
        notionalUsd:
          spotSide === "buy" ? Number(spotAmount) || null : (spotQuote?.outUi ?? null),
        price: asset.price,
        leverage: null,
        signature: spotSignature,
      });
      void refreshWalletBalance(address);
      void refreshTokenBalances(address);
      spotQuoteSeq += 1; // a late in-flight quote must not re-arm the button
      spotQuote = null;
      spotQuoteStatus = "idle";
    } catch (error) {
      spotQuoteStatus = "error";
      spotQuoteError = error instanceof Error ? error.message : "swap-failed";
    } finally {
      spotBusy = false;
    }
  }

  async function refreshTokenBalances(address: string): Promise<void> {
    try {
      tokenBalances = await fetchAllTokenBalances(solanaRpcUrl(), address);
    } catch {
      // balance read hiccup — keep last map
    }
  }

  // ── Phoenix onboarding ────────────────────────────────────────────

  async function ensurePhoenixOnboarding(authority: string): Promise<void> {
    if (!authority || onboardedAddress === authority) return;
    onboardedAddress = authority;
    try {
      const access = await checkPhoenixAccess(authority);
      phoenixWhitelisted = access.whitelisted;
    } catch {
      phoenixWhitelisted = null;
    }
    // Referral onboarding: once per wallet, best-effort, never blocks market reads.
    try {
      const done = JSON.parse(
        window.localStorage.getItem(ONBOARD_KEY) ?? "[]",
      ) as string[];
      if (done.includes(authority)) return;
      const result = await activatePhoenixReferral(
        authority,
        solanaRpcUrl(),
        signSolanaTransaction,
      );
      if (
        result.ok ||
        /already|exist|self/i.test(result.message)
      ) {
        window.localStorage.setItem(
          ONBOARD_KEY,
          JSON.stringify([...done, authority]),
        );
        if (result.ok) phoenixWhitelisted = true;
      }
    } catch {
      // wallet declined the signature or transient failure — retry next visit
      onboardedAddress = "";
    }
  }

  // ── Phoenix venue actions ─────────────────────────────────────────
  async function refreshPhoenixTrader(): Promise<void> {
    const authority = phoenixAuthority;
    if (!authority) return;
    try {
      // API supplies positions/orders; the chain supplies collateral. The
      // trader PDA reflects a deposit the moment it confirms, while the
      // Phoenix indexer lags — without the overlay, "Deposit first" kept
      // showing after a successful deposit.
      const [state, chainCollateralUsd] = await Promise.all([
        fetchPhoenixTraderState(authority),
        fetchOnChainCollateralUsd(solanaRpcUrl(), authority),
      ]);
      if (chainCollateralUsd !== null) {
        state.registered = true;
        state.collateralUsd = chainCollateralUsd;
        state.chainVerified = true;
      } else {
        state.chainVerified = false;
      }
      // Store is keyed per wallet, so a mid-flight switch cannot
      // cross-pollinate — record under the authority we fetched for.
      recordSnapshot(authority, state);
      // Day P&L rides the same refresh: sample equity as the terminal
      // shows it (collateral + live uPnL), no extra RPC. Wait a tick so
      // the snapshot-derived reactives have settled first.
      await tick();
      if (authority === phoenixAuthority) {
        recordEquitySample(authority, accountEquityUsd);
      }
    } catch {
      // transient API hiccup — keep last state
    }
  }

  async function signAndSendPhoenixIxs(
    instructions: import("@solana/web3.js").TransactionInstruction[],
    summary: TransactionSummary,
    stageKey?: string,
  ): Promise<string> {
    const { transaction, connection, latestBlockhash } =
      await buildSignableTransaction(
        solanaRpcUrl(),
        phoenixAuthority,
        instructions,
      );
    return simulateConfirmAndSend(
      transaction,
      connection,
      {
        ...summary,
        feePayer: phoenixAuthority,
        programs: [
          ...new Set(
            instructions.map((instruction) => instruction.programId.toBase58()),
          ),
        ],
      },
      latestBlockhash,
      stageKey,
    );
  }

  // Raw Solana/Phoenix errors are hostile mid-trade; map the known shapes to
  // a one-line instruction. `retriable` gates the inline Retry button (only
  // where re-sending cannot double-fill); `confirmUncertain` means the tx may
  // still have landed — burst-poll instead of calling it a failure.
  const PHOENIX_CUSTOM_ERRORS: Record<number, string> = {
    // Custom:1 observed on order placement with too little free collateral.
    1: "Not enough free collateral — reduce size or deposit",
  };

  function humanizeTradeError(err: unknown): {
    text: string;
    retriable: boolean;
    confirmUncertain: boolean;
    detail: string;
  } {
    const raw = err instanceof Error ? err.message : String(err);
    // Deliberately-human throws (TP/SL side checks, the rent shortfall in
    // phoenix-trade.ts) pass through untouched.
    if (
      /^(Take profit|Stop loss) must be|^Registering your Phoenix margin/.test(raw)
    ) {
      return { text: raw, retriable: false, confirmUncertain: false, detail: "" };
    }
    if (/insufficient (funds|collateral|margin|lamports)/i.test(raw)) {
      return {
        text: "Not enough free collateral — reduce size or deposit",
        retriable: false,
        confirmUncertain: false,
        detail: raw,
      };
    }
    const custom = /"Custom":\s*(\d+)/.exec(raw);
    const customText = custom ? PHOENIX_CUSTOM_ERRORS[Number(custom[1])] : undefined;
    if (customText) {
      return { text: customText, retriable: false, confirmUncertain: false, detail: raw };
    }
    if (/429|too many requests|rate.?limit/i.test(raw)) {
      return {
        text: "RPC rate limited — retry in a few seconds",
        retriable: true,
        confirmUncertain: false,
        detail: raw,
      };
    }
    if (/blockhash|block height exceeded|expired/i.test(raw)) {
      return {
        text: "Confirmation timed out — the order may still have landed; checking…",
        retriable: false,
        confirmUncertain: true,
        detail: raw,
      };
    }
    console.warn("phoenix action failed", raw);
    return {
      text: "Transaction failed — hover for details",
      retriable: false,
      confirmUncertain: false,
      detail: raw,
    };
  }

  // ── Post-tx indexer catch-up ──────────────────────────────────────
  // Positions/orders come from a lagging indexer; after a confirmed tx the
  // panel can lie for ~12-25s. Burst-poll until the snapshot fingerprint
  // moves (or 20s), showing an explicit interim state meanwhile.
  let burstToken = 0;
  let pendingOrder: {
    symbol: string;
    side: PhoenixSide;
    notionalUsd: number;
    refPrice: number;
    leverage: number;
  } | null = null;
  let closingKeys: Set<string> = new Set(); // `${symbol}:${subaccountIndex}`

  function snapshotFingerprint(): string {
    const positions = (phoenixTrader?.positions ?? [])
      .map((position) => `${position.symbol}:${position.size.toFixed(4)}`)
      .join("|");
    const orders = (phoenixTrader?.orders ?? [])
      .map((order) => order.orderSequenceNumber)
      .join("|");
    return `${positions}#${orders}`;
  }

  async function burstRefreshPhoenix(preFingerprint: string): Promise<void> {
    const token = ++burstToken; // a newer burst supersedes this one
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && burstToken === token) {
      await refreshPhoenixTrader();
      await tick(); // let $: derivations settle before comparing
      if (snapshotFingerprint() !== preFingerprint) break;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    // Replaced by real data or timed out — either way, stop pretending.
    if (burstToken === token) {
      pendingOrder = null;
      closingKeys = new Set();
    }
  }

  async function submitPhoenixOrder(): Promise<void> {
    const symbol = selectedSymbol;
    const busyKey = `order:${symbol}`;
    if (!phoenixAuthority || phoenixBusyKeys.has(busyKey) || !tradePreview) return;
    // Freeze the ticket state before the first await — inputs stay editable
    // while the tx confirms, so a live read after an await could describe a
    // different order than the one submitted (or throw once the $:-derived
    // tradePreview turns null mid-flight).
    const preview = tradePreview;
    const orderType = tradeType;
    const leverage = tradeLeverage;
    const reduceOnly = tradeReduceOnly && selectedPosition !== null;
    const entry = preview.entry ?? latestPrice;
    if (!entry || entry <= 0) return;
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    lastTradeSignature = "";
    const preFingerprint = snapshotFingerprint();
    try {
      const side: PhoenixSide = tradeSide === "buy" ? "bid" : "ask";
      const limitPrice = Number(tradeLimitPrice);
      const refPrice =
        orderType === "limit" && Number.isFinite(limitPrice) && limitPrice > 0
          ? limitPrice
          : entry;
      const quantity = preview.notionalUsd / refPrice;
      // Phoenix-native TP/SL trigger prices, validated against the side so a
      // mis-placed trigger can't slip through.
      const tp = Number(tradeTakeProfit);
      const sl = Number(tradeStopLoss);
      const takeProfitPrice =
        Number.isFinite(tp) && tp > 0 ? tp : null;
      const stopLossPrice = Number.isFinite(sl) && sl > 0 ? sl : null;
      if (takeProfitPrice !== null) {
        const valid = side === "bid" ? takeProfitPrice > refPrice : takeProfitPrice < refPrice;
        if (!valid) throw new Error(`Take profit must be ${side === "bid" ? "above" : "below"} entry`);
      }
      if (stopLossPrice !== null) {
        const valid = side === "bid" ? stopLossPrice < refPrice : stopLossPrice > refPrice;
        if (!valid) throw new Error(`Stop loss must be ${side === "bid" ? "below" : "above"} entry`);
      }
      const registerIxs = await ensureTraderRegisteredIxs(
        solanaRpcUrl(),
        phoenixAuthority,
        phoenixTrader?.registered ?? false,
      );
      track("order_submitted", {
        ...marketContext(),
        side,
        orderType,
        notionalUsd: preview.notionalUsd,
        leverage,
        sizingMode,
        reduceOnly,
        takeProfitPrice,
        stopLossPrice,
        estEntry: preview.entry,
        slippageBps: preview.slippageBps,
        estLiqPrice: preview.liqPrice,
      });
      const plan = await buildPlaceOrderPlan({
        authority: phoenixAuthority,
        symbol,
        side,
        orderType,
        quantity,
        price: orderType === "limit" ? refPrice : undefined,
        marginUsd: reduceOnly ? undefined : preview.notionalUsd / leverage,
        takeProfitPrice,
        stopLossPrice,
        reduceOnly,
      });
      lastTradeSignature = await signAndSendPhoenixIxs(
        [...registerIxs, ...plan.instructions],
        {
          title: `${side === "bid" ? "Long" : "Short"} ${symbol}-PERP`,
          details: [
            `Venue: Phoenix Perps`,
            `Order: ${orderType}`,
            `Notional: $${formatNumber(preview.notionalUsd, 2)}`,
            reduceOnly
              ? "Reduce-only (no new margin)"
              : `Margin: $${formatNumber(preview.notionalUsd / leverage, 2)}`,
            `Entry ref.: ${formatPrice(refPrice)}`,
            `Leverage: ${leverage}x`,
            ...(takeProfitPrice ? [`Take profit: ${formatPrice(takeProfitPrice)}`] : []),
            ...(stopLossPrice ? [`Stop loss: ${formatPrice(stopLossPrice)}`] : []),
          ],
        },
        busyKey,
      );
      track("order_confirmed", {
        ...marketContext(),
        side,
        signature: lastTradeSignature,
      });
      noteTrade({
        ts: Date.now(),
        venue: "perp",
        symbol,
        action: side === "bid" ? "long" : "short",
        notionalUsd: preview.notionalUsd,
        price: refPrice,
        leverage,
        signature: lastTradeSignature,
      });
      tradeOpen = false;
      // Optimistic pending row (from the params in hand) while the lagging
      // indexer catches up; dropped by the burst if it never confirms.
      pendingOrder = {
        symbol,
        side,
        notionalUsd: preview.notionalUsd,
        refPrice,
        leverage,
      };
      void burstRefreshPhoenix(preFingerprint);
      void refreshWalletBalance(phoenixAuthority);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "order-failed";
      const human = humanizeTradeError(error);
      phoenixActionError = human.text;
      phoenixActionErrorDetail = human.detail;
      phoenixActionRetry = human.retriable ? () => void submitPhoenixOrder() : null;
      track("order_failed", { ...marketContext(), error: raw });
      // Expired confirmation is not a definite failure — the order may have
      // landed; let the burst poll find out.
      if (human.confirmUncertain) void burstRefreshPhoenix(preFingerprint);
      markLastTxFailed(busyKey);
    } finally {
      setPhoenixBusy(busyKey, false);
      clearTxStage(busyKey);
    }
  }

  async function closePhoenixPosition(
    symbol: string,
    size: number,
    subaccountIndex: number,
    fraction = 1,
  ): Promise<void> {
    const busyKey = `close:${symbol}:${subaccountIndex}`;
    if (!phoenixAuthority || phoenixBusyKeys.has(busyKey) || size === 0) return;
    const partial = fraction < 1;
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    const preFingerprint = snapshotFingerprint();
    try {
      const plan = await buildPlaceOrderPlan({
        authority: phoenixAuthority,
        symbol,
        side: size > 0 ? "ask" : "bid",
        orderType: "market",
        quantity: Math.abs(size),
        reduceOnly: true,
      });
      lastTradeSignature = await signAndSendPhoenixIxs(
        plan.instructions,
        {
          title: partial
            ? `Reduce ${symbol}-PERP ${Math.round(fraction * 100)}%`
            : `Close ${symbol}-PERP`,
          details: [
            `Venue: Phoenix Perps`,
            `Reduce-only market order`,
            `Size: ${formatNumber(Math.abs(size), 6)} ${symbol}`,
          ],
        },
        busyKey,
      );
      {
        const closing = enrichedPositions.find(
          (position) => position.symbol === symbol,
        );
        track(partial ? "position_partial_close" : "position_closed", {
          ...marketContext(),
          closedSymbol: symbol,
          size,
          ...(partial ? { fraction } : {}),
          entryPrice: closing?.entryPrice ?? null,
          realizedUpnlEst: closing?.unrealizedPnl ?? null,
          marginUsd: closing?.marginUsd ?? null,
          roePct:
            closing?.unrealizedPnl != null && closing?.marginUsd
              ? (closing.unrealizedPnl / closing.marginUsd) * 100
              : null,
          signature: lastTradeSignature,
        });
      }
      noteTrade({
        ts: Date.now(),
        venue: "perp",
        symbol,
        action: "close",
        notionalUsd: marketMids[symbol] ? Math.abs(size) * marketMids[symbol] : null,
        price: marketMids[symbol] ?? null,
        leverage: null,
        signature: lastTradeSignature,
      });
      if (partial) {
        // TP/SL are position-level triggers — a partial close leaves them
        // armed on the remainder; say so instead of letting traders wonder.
        alertsStore.pushToast({
          ts: Date.now(),
          title: `Reduced ${symbol}-PERP by ${Math.round(fraction * 100)}%`,
          body: "TP/SL remain attached to the rest of the position.",
        });
      } else {
        // Mark the row "closing…" until the indexer drops it.
        closingKeys = new Set(closingKeys).add(`${symbol}:${subaccountIndex}`);
      }
      void burstRefreshPhoenix(preFingerprint);
    } catch (error) {
      const human = humanizeTradeError(error);
      phoenixActionError = human.text;
      phoenixActionErrorDetail = human.detail;
      phoenixActionRetry = human.retriable
        ? () => void closePhoenixPosition(symbol, size, subaccountIndex, fraction)
        : null;
      if (human.confirmUncertain) void burstRefreshPhoenix(preFingerprint);
      markLastTxFailed(busyKey);
    } finally {
      setPhoenixBusy(busyKey, false);
      clearTxStage(busyKey);
    }
  }

  // 25/50/75% chips: quantize to the market's base lot so the venue can't
  // reject a dust-sized reduce; 100% goes through the plain Close path with
  // the exact position size (no quantization drift on a full exit).
  async function closePhoenixPositionFraction(
    position: PhoenixPosition,
    fraction: number,
  ): Promise<void> {
    if (fraction >= 1) {
      await closePhoenixPosition(
        position.symbol,
        position.size,
        position.subaccountIndex,
      );
      return;
    }
    let size = position.size * fraction;
    try {
      const exchange = await fetchExchangeConfig();
      const decimals =
        exchange.markets.find((market) => market.symbol === position.symbol)
          ?.baseLotsDecimals ?? 0;
      const lots = Math.floor(Math.abs(size) * 10 ** decimals);
      if (lots === 0) {
        phoenixActionError = `Position too small to reduce by ${Math.round(fraction * 100)}% — use Close`;
        phoenixActionErrorDetail = "";
        phoenixActionRetry = null;
        return;
      }
      size = (Math.sign(position.size) * lots) / 10 ** decimals;
    } catch {
      // exchange config unavailable — send the raw size and let the
      // simulation gate rule on it
    }
    await closePhoenixPosition(
      position.symbol,
      size,
      position.subaccountIndex,
      fraction,
    );
  }

  // Share card: numbers are the terminal's own deterministic state, passed
  // through as-is — the /share page + OG endpoint only paint them.
  function sharePhoenixPosition(position: PhoenixPosition, mids: Record<string, number>): void {
    if (position.unrealizedPnl === null) return;
    const params = new URLSearchParams({
      symbol: position.symbol,
      side: position.size > 0 ? "long" : "short",
      pnl: position.unrealizedPnl.toFixed(2),
    });
    if (position.entryPrice) params.set("entry", String(position.entryPrice));
    const mark = mids[position.symbol];
    if (mark) params.set("mark", String(mark));
    const shareUrl = `${window.location.origin}/share?${params.toString()}`;
    const text = `${position.size > 0 ? "Long" : "Short"} ${position.symbol} on Ralph Terminal`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`,
      "_blank",
      "noopener",
    );
  }

  async function cancelPhoenixOrders(symbol: string, side: PhoenixSide): Promise<void> {
    const busyKey = `cancel:${symbol}:${side}`;
    if (!phoenixAuthority || phoenixBusyKeys.has(busyKey)) return;
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    const preFingerprint = snapshotFingerprint();
    try {
      const instructions = await buildCancelAllIxs(phoenixAuthority, symbol, side);
      lastTradeSignature = await signAndSendPhoenixIxs(
        instructions,
        {
          title: `Cancel ${symbol}-PERP orders`,
          details: [
            `Venue: Phoenix Perps`,
            `Side: ${side === "bid" ? "bids" : "asks"}`,
          ],
        },
        busyKey,
      );
      track("orders_cancelled", { ...marketContext(), cancelSymbol: symbol, cancelSide: side, scope: "side" });
      void burstRefreshPhoenix(preFingerprint);
    } catch (error) {
      const human = humanizeTradeError(error);
      phoenixActionError = human.text;
      phoenixActionErrorDetail = human.detail;
      phoenixActionRetry = human.retriable
        ? () => void cancelPhoenixOrders(symbol, side)
        : null;
      if (human.confirmUncertain) void burstRefreshPhoenix(preFingerprint);
      markLastTxFailed(busyKey);
    } finally {
      setPhoenixBusy(busyKey, false);
      clearTxStage(busyKey);
    }
  }

  // Busy key for one order row — finer than the side-wide `cancel:SYM:SIDE`
  // so cancelling one order never greys out its neighbours.
  function orderCancelKey(order: PhoenixOpenOrder): string {
    return `cancel:${order.symbol}:${order.side}:${order.isStopLoss ? "sl" : order.orderSequenceNumber}`;
  }

  // Cancels exactly one resting order (or one stop-loss trigger) — a row's
  // Cancel must never sweep the whole side and take a protective stop with it.
  async function cancelPhoenixOrderById(order: PhoenixOpenOrder): Promise<void> {
    const busyKey = orderCancelKey(order);
    if (!phoenixAuthority || phoenixBusyKeys.has(busyKey)) return;
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    const preFingerprint = snapshotFingerprint();
    try {
      // Stop-loss triggers live on the child trader account holding the
      // position, not the parent that book orders rest under.
      const owner = order.isStopLoss
        ? (phoenixTrader?.positions ?? []).find(
            (position) => position.symbol === order.symbol,
          )
        : undefined;
      const instructions = await buildCancelSingleOrderIxs(phoenixAuthority, {
        symbol: order.symbol,
        side: order.side,
        price: order.price,
        orderSequenceNumber: order.orderSequenceNumber,
        isStopLoss: order.isStopLoss,
        isStopLossDirection: order.isStopLossDirection,
        traderPdaIndex: owner?.traderPdaIndex,
        subaccountIndex: owner?.subaccountIndex,
      });
      lastTradeSignature = await signAndSendPhoenixIxs(
        instructions,
        {
          title: `Cancel ${order.symbol}-PERP ${order.isStopLoss ? "stop" : "order"}`,
          details: [
            `Venue: Phoenix Perps`,
            `Side: ${order.side === "bid" ? "bid" : "ask"}`,
            `Order: #${order.orderSequenceNumber.slice(0, 8)}`,
          ],
        },
        busyKey,
      );
      track("orders_cancelled", {
        ...marketContext(),
        cancelSymbol: order.symbol,
        cancelSide: order.side,
        scope: "single",
        orderSequenceNumber: order.orderSequenceNumber,
        isStopLoss: order.isStopLoss,
      });
      void burstRefreshPhoenix(preFingerprint);
    } catch (error) {
      const human = humanizeTradeError(error);
      phoenixActionError = human.text;
      phoenixActionErrorDetail = human.detail;
      phoenixActionRetry = human.retriable
        ? () => void cancelPhoenixOrderById(order)
        : null;
      if (human.confirmUncertain) void burstRefreshPhoenix(preFingerprint);
      markLastTxFailed(busyKey);
    } finally {
      setPhoenixBusy(busyKey, false);
      clearTxStage(busyKey);
    }
  }

  // Side sweeps only reach book orders (cancel-up-to walks the book); stop
  // triggers are cancelled per row. One side-wide tx per symbol on the side.
  $: perpBidSweepSymbols = [
    ...new Set(
      perpOpenOrders
        .filter((order) => order.side === "bid" && !order.isStopLoss)
        .map((order) => order.symbol),
    ),
  ];
  $: perpAskSweepSymbols = [
    ...new Set(
      perpOpenOrders
        .filter((order) => order.side === "ask" && !order.isStopLoss)
        .map((order) => order.symbol),
    ),
  ];
  $: cancelSweepBusy = [...phoenixBusyKeys].some((key) =>
    key.startsWith("cancel:"),
  );

  async function cancelAllPhoenixOrdersOnSide(side: PhoenixSide): Promise<void> {
    const symbols = side === "bid" ? perpBidSweepSymbols : perpAskSweepSymbols;
    for (const symbol of symbols) await cancelPhoenixOrders(symbol, side);
  }

  // X hotkey + palette "Cancel N orders": clear a symbol's book both sides.
  async function cancelSymbolBookOrders(symbol: string): Promise<void> {
    const sides = [
      ...new Set(
        perpOpenOrders
          .filter((order) => order.symbol === symbol && !order.isStopLoss)
          .map((order) => order.side),
      ),
    ];
    for (const side of sides) await cancelPhoenixOrders(symbol, side);
  }

  // ── Margin top-up (isolated positions) ────────────────────────────
  // Account deposits don't move an isolated position's liq price; only a
  // transfer into its child subaccount does. Inline editor per pos-card,
  // keyed `${symbol}:${subaccountIndex}`.
  let marginAddKey: string | null = null;
  let marginAddValue = "";

  // Invert the liq estimate in enrichedPositions —
  //   liq = (entry·size − margin) / (size − mmr·|size|)
  // — for the margin that puts liquidation ~50% away from mark, capped at
  // the free cross collateral actually available to transfer.
  function marginToRestoreUsd(position: PhoenixPosition): number | null {
    const mark =
      marketMids[position.symbol] ??
      (position.symbol === selectedSymbol ? latestPrice : null);
    const entry = position.entryPrice;
    const margin = position.marginUsd;
    if (mark === null || entry === null || margin === null || position.size === 0) {
      return null;
    }
    const config = markets.find((m) => m.symbol === position.symbol);
    const mmr = config?.maxLeverage ? 0.5 / config.maxLeverage : 0.005;
    const liqTarget = mark * (1 - 0.5 * Math.sign(position.size));
    const needed =
      entry * position.size -
      liqTarget * (position.size - mmr * Math.abs(position.size));
    const delta = needed - margin;
    if (!Number.isFinite(delta) || delta <= 0) return null;
    return Math.min(delta, Math.max(0, phoenixCollateral));
  }

  function openMarginAdd(position: PhoenixPosition): void {
    const rowKey = `${position.symbol}:${position.subaccountIndex}`;
    if (marginAddKey === rowKey) {
      marginAddKey = null;
      return;
    }
    marginAddKey = rowKey;
    const suggested = marginToRestoreUsd(position);
    marginAddValue = suggested !== null ? suggested.toFixed(2) : "";
  }

  async function submitMarginAdd(position: PhoenixPosition): Promise<void> {
    const amount = Number(marginAddValue);
    const busyKey = `margin:${position.symbol}:${position.subaccountIndex}`;
    if (
      !phoenixAuthority ||
      phoenixBusyKeys.has(busyKey) ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return;
    }
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    const preFingerprint = snapshotFingerprint();
    const liqDistBefore = liqDistancePctOf(position);
    try {
      const instructions = await buildAddIsolatedMarginIxs(
        phoenixAuthority,
        position,
        amount,
      );
      lastTradeSignature = await signAndSendPhoenixIxs(
        instructions,
        {
          title: `Add margin to ${position.symbol}-PERP`,
          details: [
            `Venue: Phoenix Perps`,
            `Amount: ${formatNumber(amount, 2)} USDC`,
            `From free cross collateral into the isolated position`,
          ],
        },
        busyKey,
      );
      track("margin_added", {
        ...marketContext(),
        amountUsd: amount,
        liqDistBefore,
        marginSymbol: position.symbol,
        signature: lastTradeSignature,
      });
      marginAddKey = null;
      marginAddValue = "";
      void burstRefreshPhoenix(preFingerprint);
    } catch (error) {
      const human = humanizeTradeError(error);
      phoenixActionError = human.text;
      phoenixActionErrorDetail = human.detail;
      phoenixActionRetry = human.retriable
        ? () => void submitMarginAdd(position)
        : null;
      if (human.confirmUncertain) void burstRefreshPhoenix(preFingerprint);
      markLastTxFailed(busyKey);
    } finally {
      setPhoenixBusy(busyKey, false);
      clearTxStage(busyKey);
    }
  }

  // ── Flatten (close everything) ────────────────────────────────────
  // One reduce-only market order per position, concatenated so the whole
  // book flattens in as few signatures as possible. Chunked — a v0 tx fits
  // ~3 enhanced market orders before CU/size limits bite; the simulation in
  // signAndSendPhoenixIxs stays the per-chunk safety gate.
  const FLATTEN_CHUNK = 3;
  let flattenArmedUntil = 0;
  $: flattenArmed = nowMs < flattenArmedUntil;
  $: flattenBusy = phoenixBusyKeys.has("flatten");

  // Armed hotkeys (C = market-close, X = cancel orders on the selected
  // symbol): first press arms for 3s and surfaces a prompt in the footer
  // status line; the second press fires. nowMs ticks 1s — close enough.
  let armedHotkey: { key: "c" | "x"; until: number } | null = null;
  $: if (armedHotkey && nowMs > armedHotkey.until) armedHotkey = null;

  function onFlattenClick(): void {
    if (Date.now() < flattenArmedUntil) {
      flattenArmedUntil = 0;
      void closeAllPhoenixPositions();
    } else {
      flattenArmedUntil = Date.now() + 3_000;
    }
  }

  async function closeAllPhoenixPositions(): Promise<void> {
    const positions = enrichedPositions.filter(
      (position) => position.size !== 0,
    );
    const busyKey = "flatten";
    if (!phoenixAuthority || phoenixBusyKeys.has(busyKey) || positions.length === 0) {
      return;
    }
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    const preFingerprint = snapshotFingerprint();
    let confirmedChunks = 0; // a later chunk can fail after earlier ones land
    try {
      track("flatten_submitted", {
        ...marketContext(),
        positionCount: positions.length,
        symbols: positions.map((position) => position.symbol),
      });
      const plans = await Promise.all(
        positions.map((position) =>
          buildPlaceOrderPlan({
            authority: phoenixAuthority,
            symbol: position.symbol,
            side: position.size > 0 ? "ask" : "bid",
            orderType: "market",
            quantity: Math.abs(position.size),
            reduceOnly: true,
          }),
        ),
      );
      for (let start = 0; start < positions.length; start += FLATTEN_CHUNK) {
        const chunk = positions.slice(start, start + FLATTEN_CHUNK);
        const instructions = plans
          .slice(start, start + FLATTEN_CHUNK)
          .flatMap((plan) => plan.instructions);
        lastTradeSignature = await signAndSendPhoenixIxs(
          instructions,
          {
            title: `Flatten ${chunk.length} position${chunk.length === 1 ? "" : "s"}`,
            details: [
              `Venue: Phoenix Perps`,
              `Reduce-only market orders`,
              ...chunk.map(
                (position) =>
                  `${position.symbol}: ${formatNumber(Math.abs(position.size), 6)}`,
              ),
            ],
          },
          busyKey,
        );
        confirmedChunks += 1;
        for (const position of chunk) {
          noteTrade({
            ts: Date.now(),
            venue: "perp",
            symbol: position.symbol,
            action: "close",
            notionalUsd: marketMids[position.symbol]
              ? Math.abs(position.size) * marketMids[position.symbol]
              : null,
            price: marketMids[position.symbol] ?? null,
            leverage: null,
            signature: lastTradeSignature,
          });
        }
      }
      track("flatten_confirmed", {
        ...marketContext(),
        positionCount: positions.length,
        signature: lastTradeSignature,
      });
      closingKeys = new Set(
        positions.map(
          (position) => `${position.symbol}:${position.subaccountIndex}`,
        ),
      );
      void burstRefreshPhoenix(preFingerprint);
    } catch (error) {
      const human = humanizeTradeError(error);
      phoenixActionError = human.text;
      phoenixActionErrorDetail = human.detail;
      phoenixActionRetry = human.retriable
        ? () => void closeAllPhoenixPositions()
        : null;
      // Earlier chunks may have landed — resync the panel either way.
      if (human.confirmUncertain || confirmedChunks > 0) {
        void burstRefreshPhoenix(preFingerprint);
      }
      markLastTxFailed(busyKey);
    } finally {
      setPhoenixBusy(busyKey, false);
      clearTxStage(busyKey);
    }
  }

  async function submitCollateral(direction: "deposit" | "withdraw"): Promise<void> {
    const amount = Number(direction === "deposit" ? depositAmount : withdrawAmount);
    if (!phoenixAuthority || collateralBusy || !Number.isFinite(amount) || amount <= 0) {
      return;
    }
    collateralBusy = true;
    collateralError = "";
    collateralSignature = "";
    try {
      const registerIxs = await ensureTraderRegisteredIxs(
        solanaRpcUrl(),
        phoenixAuthority,
        phoenixTrader?.registered ?? false,
      );
      const instructions =
        direction === "deposit"
          ? await buildDepositIxs(phoenixAuthority, amount)
          : await buildWithdrawIxs(phoenixAuthority, amount);
      collateralSignature = await signAndSendPhoenixIxs(
        [...(direction === "deposit" ? registerIxs : []), ...instructions],
        {
          title: `${direction === "deposit" ? "Deposit to" : "Withdraw from"} Phoenix`,
          details: [
            `Venue: Phoenix Perps`,
            `Amount: ${formatNumber(amount, 2)} USDC`,
            direction === "withdraw"
              ? "Withdrawals settle through the Phoenix withdraw queue"
              : "Funds move from wallet USDC into Phoenix margin",
          ],
        },
      );
      track(`${direction}_confirmed`, {
        ...marketContext(),
        amountUsd: amount,
        signature: collateralSignature,
      });
      // Deposits/withdrawals move equity without being P&L — shift the day
      // baseline by the same amount so Day P&L stays pure. External
      // transfers straight to the wallet are not offset (accepted).
      shiftEquityBaseline(
        phoenixAuthority,
        direction === "deposit" ? amount : -amount,
      );
      depositAmount = "";
      withdrawAmount = "";
      void refreshPhoenixTrader();
      void refreshWalletBalance(phoenixAuthority);
    } catch (error) {
      collateralError = error instanceof Error ? error.message : `${direction}-failed`;
      track(`${direction}_failed`, { ...marketContext(), amountUsd: amount, error: collateralError });
    } finally {
      collateralBusy = false;
    }
  }

  function toggleAccountMenu(event: MouseEvent): void {
    event.stopPropagation();
    accountMenuOpen = !accountMenuOpen;
  }

  function closeAccountMenuFromWindow(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".account-menu")) return;
    accountMenuOpen = false;
  }

  function closeAccountMenuOnKey(event: KeyboardEvent): void {
    if (event.key === "Escape") accountMenuOpen = false;
  }

  // Modals may keep keys away from the global hotkeys, but never Escape —
  // the window handler owns close-on-Esc no matter where focus sits.
  function swallowKeysExceptEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape") event.stopPropagation();
  }

  async function copyWalletAddress(): Promise<void> {
    if (!$privyAuth.walletAddress) return;
    try {
      await navigator.clipboard.writeText($privyAuth.walletAddress);
      walletCopied = true;
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => {
        walletCopied = false;
      }, 1600);
    } catch {
      walletBalanceError = "Clipboard unavailable in this browser.";
    }
  }

  function setPriceMode(mode: "last" | "mark"): void {
    if (priceMode === mode) return;
    priceMode = mode;
    // Re-render the candle series in the selected price basis.
    setChartData();
  }

  function createChartInstance(): void {
    if (!chartContainer || lwChart) return;
    lwChart = createChart(chartContainer, {
      autoSize: true,
      // Direct manipulation, stated explicitly rather than left to library
      // defaults: drag to pan, wheel/pinch to zoom, drag an axis to scale
      // it, double-click an axis to reset. Vertical touch-drag stays off so
      // the chart never hijacks page scrolling; kinetic momentum is
      // touch-only (mouse panning should stop where you stop).
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      kineticScroll: { mouse: false, touch: true },
      layout: {
        background: { type: ColorType.Solid, color: colors.chartBg },
        textColor: colors.muted,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(150, 165, 190, 0.05)" },
        horzLines: { color: "rgba(150, 165, 190, 0.07)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255, 77, 151, 0.5)", labelBackgroundColor: colors.line },
        horzLine: { color: "rgba(255, 77, 151, 0.5)", labelBackgroundColor: colors.line },
      },
      rightPriceScale: {
        borderColor: colors.line,
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: colors.line,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        // Pin both edges: can't pan into empty space past the first/last bar.
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
    });
    candleSeries = lwChart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      borderVisible: false,
      priceLineVisible: false,
    });
    volumeSeries = lwChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    lwChart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    applyPriceScaleMode(chartPriceScaleMode);
    // Hand cursor: the pan affordance is visible before you try it, and the
    // grip closes while dragging. The library's own axis-resize cursors
    // still win on the price/time scales.
    const container = chartContainer;
    container.style.cursor = "grab";
    // Vertical panning: the library ignores the vertical drag component
    // while the price scale autoscales. First clear vertical intent in a
    // press switches autoscale off so the price axis follows the hand;
    // FIT or a double-click on the price axis re-arms auto-fit.
    let pressPoint: { x: number; y: number } | null = null;
    container.addEventListener("mousedown", (event) => {
      container.style.cursor = "grabbing";
      pressPoint = { x: event.clientX, y: event.clientY };
    });
    container.addEventListener("mousemove", (event) => {
      if (!pressPoint || event.buttons !== 1) return;
      const dx = Math.abs(event.clientX - pressPoint.x);
      const dy = Math.abs(event.clientY - pressPoint.y);
      if (dy > 4 && dy > dx) {
        lwChart?.priceScale("right").applyOptions({ autoScale: false });
        pressPoint = null;
      }
    });
    container.addEventListener("mouseup", () => {
      container.style.cursor = "grab";
      pressPoint = null;
    });
    container.addEventListener("mouseleave", () => {
      container.style.cursor = "grab";
      pressPoint = null;
    });
    // Alt+click sets a price alert at the cursor — drag infra's cousin.
    container.addEventListener("click", (event) => {
      if (!event.altKey || !candleSeries || tradeMode !== "perps") return;
      const rect = container.getBoundingClientRect();
      const raw = candleSeries.coordinateToPrice(event.clientY - rect.top);
      const price = Number(raw);
      if (!Number.isFinite(price) || price <= 0) return;
      const op = latestPrice !== null && price < latestPrice ? "below" : "above";
      alertsStore.arm({ symbol: selectedSymbol, op, price, tier: "ROUTINE" });
      alertsStore.pushToast({
        ts: Date.now(),
        title: `Alert set · ${selectedSymbol}-PERP`,
        body: `${op} ${formatPrice(price)}`,
      });
    });
    lwChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      const points = tradeMode === "spot" ? spotChartPoints : chartPoints;
      autoFollow = range.to >= points.length - 1;
    });
    lwChart.subscribeCrosshairMove(onCrosshairMove);
    setChartData();
    // Series was just (re)created — re-draw liq lines for open positions.
    liqLines = [];
    refreshChartLines(
      enrichedPositions,
      perpOpenOrders,
      $alerts,
      $chartLinePrefs,
      selectedSymbol,
      tradeMode,
    );
  }

  function renderChartSeries(points: MarketPoint[]): void {
    if (!candleSeries || !volumeSeries) return;
    candleSeries.setData(points.map((point) => toCandle(point, priceMode)));
    volumeSeries.setData(points.map(toVolume));
  }

  function setChartData(): void {
    // Spot mode owns the chart surface — perp paths must never repaint it
    // (boot races, market switches, AI-command symbol changes).
    if (tradeMode === "spot") return;
    renderChartSeries(chartPoints);
  }

  function updateChartPoint(point: MarketPoint): void {
    // Spot mode owns the chart surface — perp ticks must not repaint it.
    if (tradeMode === "spot") return;
    if (!candleSeries || !volumeSeries) return;
    candleSeries.update(toCandle(point, priceMode));
    volumeSeries.update(toVolume(point));
  }

  function applyPriceScaleMode(mode: PriceScaleMode): void {
    lwChart?.priceScale("right").applyOptions({ mode });
  }

  function applyLastPriceLine(price: number | null, change: number | null): void {
    if (!candleSeries) return;
    if (price === null || !Number.isFinite(price)) {
      if (lastPriceLine) {
        candleSeries.removePriceLine(lastPriceLine);
        lastPriceLine = null;
      }
      return;
    }
    const color = (change ?? 0) >= 0 ? UP_COLOR : DOWN_COLOR;
    if (!lastPriceLine) {
      lastPriceLine = candleSeries.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: priceMode === "mark" ? "mark" : "",
      });
    } else {
      lastPriceLine.applyOptions({ price, color, title: priceMode === "mark" ? "mark" : "" });
    }
  }

  function onCrosshairMove(param: MouseEventParams): void {
    if (!candleSeries || !param.point || param.time === undefined) {
      legendCandle = null;
      return;
    }
    const bar = param.seriesData.get(candleSeries) as
      | CandlestickData<UTCTimestamp>
      | undefined;
    if (!bar) {
      legendCandle = null;
      return;
    }
    const ts = (param.time as number) * 1000;
    const source = tradeMode === "spot" ? spotChartPoints : chartPoints;
    const match = source.find((point) => point.ts === ts);
    legendCandle = {
      ts,
      price: bar.close,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volumeQuote: match?.volumeQuote ?? match?.volume ?? null,
    };
  }

  function setVisibleCandleRange(count: number): void {
    visibleCandleCount = count;
    const timeScale = lwChart?.timeScale();
    if (!timeScale) return;
    const bars = chartPoints.length;
    timeScale.setVisibleLogicalRange({
      from: Math.max(0, bars - count),
      to: bars + 2,
    });
  }

  function resetChartView(): void {
    visibleCandleCount = DEFAULT_VISIBLE_CANDLES;
    // FIT also re-arms price auto-fit after a manual vertical pan.
    lwChart?.priceScale("right").applyOptions({ autoScale: true });
    lwChart?.timeScale().fitContent();
  }

  function scrollToRealtime(): void {
    lwChart?.timeScale().scrollToRealTime();
  }

  function zoomChart(direction: "in" | "out"): void {
    const timeScale = lwChart?.timeScale();
    if (!timeScale) return;
    const current = timeScale.options().barSpacing ?? 6;
    const next = direction === "in" ? current * 1.3 : current / 1.3;
    timeScale.applyOptions({ barSpacing: Math.max(2, Math.min(48, next)) });
  }

  function openPhoenixFunding(): void {
    // Swap modals (never stack): close the ticket, open funds on Phoenix tab
    // with the shortfall prefilled.
    tradeOpen = false;
    const shortfall = Math.max(0, requiredMarginUsd - phoenixCollateral);
    depositAmount = shortfall > 0 ? String(Math.ceil(shortfall)) : "";
    fundsOpen = true;
    fundsTab = "phoenix";
    void generateFundsQr();
  }

  // Clicking a book level: prefill a limit order at that price in the
  // ticket. Side/type/price only — the book you were reading stays put
  // (desktop stacks the ticket right below it).
  function prefillFromBook(price: number, rowSide: "ask" | "bid"): void {
    tradeSide = rowSide === "ask" ? "sell" : "buy";
    tradeType = "limit";
    tradeLimitPrice = String(price);
    focusTicketSize();
  }

  // Hands land on size: focus+select whichever Size/Risk input is live
  // (modal or rail) so the next keystrokes overtype the amount.
  let ticketSizeInput: HTMLInputElement | null = null;

  function focusTicketSize(): void {
    void tick().then(() => {
      ticketSizeInput?.focus();
      ticketSizeInput?.select();
    });
  }

  // Desktop = the rail ticket sits beside the chart; the grid collapses at
  // the 1100px breakpoint (matches the media query in the style block).
  function railTicketUsable(): boolean {
    return (
      typeof window !== "undefined" &&
      !window.matchMedia("(max-width: 1100px)").matches
    );
  }

  function openTrade(side: "buy" | "sell"): void {
    // A live ticket flips in place: side only — size/TP/SL survive so both
    // directions can be compared without retyping (wrong-side validation
    // already flags stale triggers as you type). Size persists in prefs,
    // so a fresh open keeps it too; only triggers and errors reset.
    const flipOnly = ticketActive;
    tradeSide = side;
    if (!flipOnly) {
      tradeTakeProfit = "";
      tradeStopLoss = "";
      phoenixActionError = "";
      phoenixActionErrorDetail = "";
      phoenixActionRetry = null;
      lastTradeSignature = "";
    }
    // Desktop always shows the stacked rail ticket; the modal remains the
    // narrow-viewport fallback where the rail lives below the fold.
    if (!railTicketUsable()) tradeOpen = true;
    focusTicketSize();
  }

  function openAuthModal(): void {
    // Step/email/message seeding happens inside AuthModal on mount.
    authOpen = true;
  }

  async function disconnectPrivy(): Promise<void> {
    logoutBusy = true;
    try {
      await logoutPrivy();
      accountMenuOpen = false;
      await refreshEdgeModules();
    } catch {
      // logout failure is non-fatal — the session clears on next boot
    } finally {
      logoutBusy = false;
    }
  }

  // Deep-link contract used by the marketing/spotlight pages and shareable
  // by hand. Query intent beats restored prefs; params are stripped after
  // parsing so a refresh returns to normal prefs semantics.
  //
  //   /terminal?asset=<assetId|symbol>   market (perps accept SOL or SOL-PERP)
  //            &venue=spot|perp          default spot
  //            &side=buy|sell|long|short
  //            &size=<usd>               prefill ticket notional
  //            &leverage=<n>             perps; snapped to 1/2/5/10/20
  //            &type=market|limit        perps order type
  //            &price=<n>                perps limit price (implies type=limit)
  //            &tp=<n>&sl=<n>            perps take-profit / stop-loss triggers
  //            &ticket=1                 open the full ticket modal (perps)
  //            &tf=1m|5m|15m|1h|4h       chart timeframe
  //            &mode=last|mark           chart price mode
  //            &fund=receive|convert|phoenix   open the funds modal on a tab
  //            &tab=book|trade           right-rail tab
  //            &alerts=1                 open the alerts panel
  //            &cmd=<text>               prefill the command bar (never runs it)
  //
  // All numbers are validated/clamped; invalid values are ignored. Only one
  // overlay (funds > ticket > alerts) opens per link — modals never stack.
  function applyDeepLink(): void {
    if (typeof window === "undefined") return;
    const intent = parseTerminalDeepLink(window.location.search);
    if (!intent) return;

    if (intent.venue === "perp") {
      pendingTradeMode = null;
      if (intent.symbol) selectedSymbol = intent.symbol;
      if (intent.side) tradeSide = intent.side;
      if (intent.sizeUsd !== null) tradeAmount = String(intent.sizeUsd);
      if (intent.leverage !== null) tradeLeverage = intent.leverage;
      if (intent.limitPrice !== null) {
        tradeType = "limit";
        tradeLimitPrice = String(intent.limitPrice);
      } else if (intent.orderType) {
        tradeType = intent.orderType;
      }
      if (intent.takeProfit !== null) tradeTakeProfit = String(intent.takeProfit);
      if (intent.stopLoss !== null) tradeStopLoss = String(intent.stopLoss);
    } else if (intent.venue === "spot") {
      pendingTradeMode = "spot";
      if (intent.spotAssetId) pendingSpotAssetId = intent.spotAssetId;
      if (intent.side) spotSide = intent.side;
      if (intent.sizeUsd !== null) spotAmount = String(intent.sizeUsd);
      if (intent.limitPrice !== null) {
        spotOrderType = "limit";
        spotLimitPrice = String(intent.limitPrice);
      }
    }
    if (intent.bookTab) bookTab = intent.bookTab;
    if (intent.timeframe) selectedTimeframe = intent.timeframe;
    if (intent.priceMode) priceMode = intent.priceMode;
    if (intent.watchSymbols.length > 0) {
      watchlist = [...new Set([...watchlist, ...intent.watchSymbols])].slice(0, 24);
    }
    if (intent.cmd) void runCommand(intent.cmd.slice(0, 200)); // parses straight into the ticket

    // Overlays — at most one (funds > ticket > alerts), modals never stack.
    if (intent.overlay?.kind === "funds") {
      openFunds();
      if (intent.overlay.tab) fundsTab = intent.overlay.tab;
    } else if (intent.overlay?.kind === "ticket") {
      phoenixActionError = "";
      phoenixActionErrorDetail = "";
      phoenixActionRetry = null;
      lastTradeSignature = "";
      tradeOpen = true;
    } else if (intent.overlay?.kind === "alerts") {
      alertsOpen = true;
    }

    window.history.replaceState(null, "", window.location.pathname);
  }

  // ── Watchlist ──────────────────────────────────────────────────────
  function toggleWatch(symbol: string): void {
    const sym = symbol.toUpperCase();
    watchlist = watchlist.includes(sym)
      ? watchlist.filter((entry) => entry !== sym)
      : [...watchlist, sym].slice(-24);
  }

  function openWatchRow(row: { sym: string; spot: SpotAsset | null; hasPerp: boolean }): void {
    // Prefer the current venue; fall back to whichever has the asset.
    if (tradeMode === "spot" && row.spot) {
      selectSpotAsset(row.spot);
    } else if (tradeMode === "perps" && row.hasPerp) {
      onMarketChange(row.sym);
    } else if (row.spot) {
      selectSpotAsset(row.spot);
    } else if (row.hasPerp) {
      setTradeMode("perps", false);
      onMarketChange(row.sym);
    }
  }

  // ── Liquidation lines: open positions drawn where the user looks ──
  // ── Chart overlay lines ────────────────────────────────────────────
  // Your live trading state drawn on the chart: position entry (with live
  // uPnL in the label), TP/SL triggers, liq estimate, open orders, armed
  // alerts. Toggleable per group, persisted per device. Lines are cheap to
  // rebuild wholesale; labels refresh on a 2s tick.
  function refreshChartLines(
    positions: PhoenixPosition[],
    orders: PhoenixOpenOrder[],
    armed: Alert[],
    prefs: { pos: boolean; tpsl: boolean; orders: boolean; alerts: boolean },
    symbol: string,
    mode: "perps" | "spot",
  ): void {
    const series = candleSeries;
    if (!series) return;
    for (const line of liqLines) series.removePriceLine(line);
    liqLines = [];
    for (const spec of buildChartLineSpecs(
      positions,
      orders,
      armed,
      prefs,
      symbol,
      mode,
    )) {
      liqLines.push(series.createPriceLine(spec));
    }
  }

  // ── Journal ────────────────────────────────────────────────────────
  function noteTrade(entry: JournalEntry): void {
    journalEntries = recordTrade(entry);
  }

  function exportJournalCsv(): void {
    const blob = new Blob([journalToCsv(journalEntries)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "trader-ralph-journal.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function wipeJournal(): void {
    clearJournal();
    journalEntries = [];
    recapRead = IDLE_READ;
    recapKey = 0;
  }

  async function runPositionBrief(): Promise<void> {
    if (aiDisabled() || !phoenixTrader || phoenixTrader.positions.length === 0) return;
    const snapshot = {
      positions: phoenixTrader.positions.map((position) => ({
        symbol: position.symbol,
        side: position.size > 0 ? "long" : "short",
        notionalUsd: position.positionValue,
        entry: position.entryPrice,
        liq: position.liquidationPrice,
        uPnlUsd: position.unrealizedPnl,
      })),
      collateralUsd: phoenixCollateral,
      accountLeverage: accountLeverage === null ? null : Math.round(accountLeverage * 10) / 10,
      fundingPctSelectedMarket: fundingPercent,
      basisBpsSelectedMarket: perpBasisBps === null ? null : Math.round(perpBasisBps),
    };
    briefRead = { phase: "loading", text: briefRead.text };
    try {
      briefRead = { phase: "ready", asOf: Date.now(), text: await aiPositionBrief(snapshot) };
    } catch (error) {
      briefRead = { phase: "error", text: "", error: aiErr(error) };
    }
  }

  async function runSessionRecap(): Promise<void> {
    if (aiDisabled() || journalToday.length === 0) return;
    const snapshot = {
      trades: journalToday.map((entry) => ({
        timeUtc: new Date(entry.ts).toISOString().slice(11, 16),
        venue: entry.venue,
        symbol: entry.symbol,
        action: entry.action,
        notionalUsd: entry.notionalUsd,
        leverage: entry.leverage,
      })),
    };
    recapRead = { phase: "loading", text: recapRead.text };
    try {
      recapRead = { phase: "ready", asOf: Date.now(), text: await aiSessionRecap(snapshot) };
    } catch (error) {
      recapRead = { phase: "error", text: "", error: aiErr(error) };
    }
  }

  // ── Spot limit orders (Jupiter Trigger) ───────────────────────────
  function deserializeBase64Tx(base64: string): VersionedTransaction {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return VersionedTransaction.deserialize(bytes);
  }

  async function refreshTriggerOrders(): Promise<void> {
    const address = $privyAuth.walletAddress;
    if (!address) {
      triggerOrders = [];
      return;
    }
    try {
      triggerOrders = await fetchTriggerOrders(address);
    } catch {
      // keep the last list on a read hiccup
    }
  }

  async function submitSpotLimitOrder(): Promise<void> {
    const address = $privyAuth.walletAddress;
    if (!spotAsset || !address || spotBusy || walletScreen.flagged) return;
    const limit = Number(spotLimitPrice);
    const amount = Number(spotAmount);
    if (!Number.isFinite(limit) || limit <= 0) return;
    if (!Number.isFinite(amount) || amount <= 0) return;
    spotBusy = true;
    spotQuoteError = "";
    try {
      // Buy: spend `spotAmount` USDC for amount/limit tokens.
      // Sell: sell `spotAmount` tokens for amount*limit USDC.
      const params =
        spotSide === "buy"
          ? {
              inputMint: SPOT_USDC_MINT,
              outputMint: spotAsset.mint,
              makingAmountAtoms: usdcToAtoms(amount),
              takingAmountAtoms: tokenToAtoms(amount / limit, spotAsset.decimals),
            }
          : {
              inputMint: spotAsset.mint,
              outputMint: SPOT_USDC_MINT,
              makingAmountAtoms: tokenToAtoms(amount, spotAsset.decimals),
              takingAmountAtoms: usdcToAtoms(amount * limit),
            };
      const { transaction } = await createTriggerOrder({ maker: address, ...params });
      const connection = new Connection(solanaRpcUrl(), "confirmed");
      spotSignature = await simulateConfirmAndSend(
        deserializeBase64Tx(transaction),
        connection,
        {
          title: `Place limit ${spotSide} ${spotAsset.symbol}`,
          details: [
            `Venue: Jupiter Trigger`,
            `Limit price: ${formatPrice(limit)}`,
            `Notional: $${formatNumber(spotSide === "buy" ? amount : amount * limit, 2)}`,
          ],
          feePayer: address,
        },
      );
      noteTrade({
        ts: Date.now(),
        venue: "spot",
        symbol: spotAsset.symbol,
        action: `limit-${spotSide}`,
        notionalUsd: spotSide === "buy" ? amount : amount * limit,
        price: limit,
        leverage: null,
        signature: spotSignature,
      });
      void refreshTriggerOrders();
    } catch (error) {
      spotQuoteStatus = "error";
      spotQuoteError = error instanceof Error ? error.message : "limit-failed";
    } finally {
      spotBusy = false;
    }
  }

  async function cancelSpotLimitOrder(orderKey: string): Promise<void> {
    const address = $privyAuth.walletAddress;
    if (!address || triggerBusy) return;
    triggerBusy = true;
    try {
      const transaction = await cancelTriggerOrder(address, orderKey);
      const connection = new Connection(solanaRpcUrl(), "confirmed");
      await simulateConfirmAndSend(
        deserializeBase64Tx(transaction),
        connection,
        {
          title: "Cancel spot limit order",
          details: [`Venue: Jupiter Trigger`, `Order: ${shortAddress(orderKey)}`],
          feePayer: address,
        },
      );
      triggerOrders = triggerOrders.filter((order) => order.orderKey !== orderKey);
      void refreshTriggerOrders();
    } catch (error) {
      spotQuoteError = error instanceof Error ? error.message : "cancel-failed";
    } finally {
      triggerBusy = false;
    }
  }

  function loadPrefs(): void {
    if (typeof window === "undefined") return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    } catch {
      return; // storage unavailable — keep defaults
    }
    const prefs = parsePrefs(raw);
    if (prefs.symbol !== undefined) selectedSymbol = prefs.symbol;
    if (prefs.timeframe !== undefined) selectedTimeframe = prefs.timeframe;
    if (prefs.priceMode !== undefined) priceMode = prefs.priceMode;
    if (prefs.chartScale !== undefined) chartScale = prefs.chartScale;
    if (prefs.chartAxisMode !== undefined) chartAxisMode = prefs.chartAxisMode;
    if (prefs.visibleCandleCount !== undefined) {
      visibleCandleCount = prefs.visibleCandleCount;
    }
    if (prefs.tradeMode === "spot") pendingTradeMode = "spot";
    if (prefs.spotAssetId !== undefined) pendingSpotAssetId = prefs.spotAssetId;
    if (prefs.watchlist !== undefined) watchlist = prefs.watchlist;
    if (prefs.screenSort !== undefined) screenSort = prefs.screenSort;
    if (prefs.screenHub !== undefined) screenHub = prefs.screenHub;
    if (prefs.sizingMode !== undefined) sizingMode = prefs.sizingMode;
    if (prefs.tradeAmount !== undefined) tradeAmount = prefs.tradeAmount;
    if (prefs.tradeRiskUsd !== undefined) tradeRiskUsd = prefs.tradeRiskUsd;
    if (prefs.tradeLeverage !== undefined) tradeLeverage = prefs.tradeLeverage;
  }

  function loadOpenBetaBanner(): void {
    if (typeof window === "undefined") return;
    try {
      showOpenBetaBanner =
        window.localStorage.getItem(OPEN_BETA_BANNER_STORAGE_KEY) !==
        "dismissed";
    } catch {
      showOpenBetaBanner = true;
    }
  }

  function dismissOpenBetaBanner(): void {
    showOpenBetaBanner = false;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        OPEN_BETA_BANNER_STORAGE_KEY,
        "dismissed",
      );
    } catch {
      // storage unavailable — banner is still hidden for this session
    }
  }

  function scrollToSection(id: string): void {
    activeSection = id;
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Market palette — the "/" picker for every tradable market ──────
  // The picker itself lives in CommandPalette.svelte, mounted only while
  // open — its row derivation no longer runs on every mids tick when
  // closed. The page keeps the flag plus venue routing (choosePalette).
  let paletteOpen = false;

  function openPalette(): void {
    paletteOpen = true;
  }

  function choosePalette(row: PaletteRow): void {
    if (row.kind === "action") {
      row.action?.();
      paletteOpen = false;
      return;
    }
    if (row.kind === "perp") {
      if (tradeMode !== "perps") setTradeMode("perps", false);
      if (row.symbol !== selectedSymbol) void switchPhoenixMarket(row.symbol);
    } else if (row.asset) {
      if (tradeMode !== "spot") setTradeMode("spot", false);
      selectSpotAsset(row.asset);
    }
    paletteOpen = false;
  }

  let cheatOpen = false;

  function cycleWatchlist(direction: number): void {
    if (watchlist.length === 0) return;
    const current =
      tradeMode === "spot" ? (spotAsset?.symbol ?? "") : selectedSymbol;
    const index = watchlist.indexOf(current.toUpperCase());
    const next =
      watchlist[
        (index + direction + watchlist.length) % watchlist.length
      ];
    if (!next || next === current.toUpperCase()) return;
    const perp = markets.find((market) => market.symbol === next);
    if (perp) {
      if (tradeMode !== "perps") setTradeMode("perps", false);
      void switchPhoenixMarket(next);
      return;
    }
    const asset = spotAssets.find(
      (candidate) => candidate.symbol.toUpperCase() === next,
    );
    if (asset) {
      if (tradeMode !== "spot") setTradeMode("spot", false);
      selectSpotAsset(asset);
    }
  }

  function onGlobalKeydown(event: KeyboardEvent): void {
    closeAccountMenuOnKey(event);
    if (event.key === "Escape") {
      if (tradeOpen) tradeOpen = false;
      if (authOpen) authOpen = false;
      if (alertsOpen) alertsOpen = false;
      if (fundsOpen) fundsOpen = false;
      if (paletteOpen) paletteOpen = false;
      if (cheatOpen) cheatOpen = false;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
    ) {
      return;
    }
    // Live-ticket keys: while a perp ticket is up (rail or modal) and no
    // other overlay owns the keyboard, flip it in place instead of
    // rebuilding it — B/S swap side, M/L swap order type.
    if (
      ticketActive &&
      tradeMode === "perps" &&
      !authOpen &&
      !alertsOpen &&
      !fundsOpen &&
      !paletteOpen &&
      !cheatOpen
    ) {
      const ticketKey = event.key.toLowerCase();
      if (ticketKey === "b" || ticketKey === "s") {
        event.preventDefault();
        tradeSide = ticketKey === "b" ? "buy" : "sell";
        focusTicketSize();
        return;
      }
      if (ticketKey === "m" || ticketKey === "l") {
        event.preventDefault();
        tradeType = ticketKey === "m" ? "market" : "limit";
        return;
      }
    }
    if (authOpen || tradeOpen || alertsOpen || fundsOpen || paletteOpen || cheatOpen) {
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      openPalette();
      return;
    }
    if (event.key === "?") {
      event.preventDefault();
      cheatOpen = true;
      return;
    }
    const tfIndex = PHOENIX_TIMEFRAMES.indexOf(selectedTimeframe);
    switch (event.key.toLowerCase()) {
      case "b":
        // In spot mode B/S drive the spot ticket — never a hidden perp order.
        if (tradeMode === "spot") {
          flipSpotSide("buy");
          bookTab = "trade";
        } else {
          openTrade("buy");
        }
        break;
      case "s":
        if (tradeMode === "spot") {
          flipSpotSide("sell");
          bookTab = "trade";
        } else {
          openTrade("sell");
        }
        break;
      case "f":
        resetChartView();
        break;
      case "c": {
        // Two-stage market close of the selected symbol's position.
        if (tradeMode !== "perps" || !selectedPosition) break;
        if (armedHotkey?.key === "c" && Date.now() < armedHotkey.until) {
          armedHotkey = null;
          void closePhoenixPosition(
            selectedPosition.symbol,
            selectedPosition.size,
            selectedPosition.subaccountIndex,
          );
        } else {
          armedHotkey = { key: "c", until: Date.now() + 3_000 };
        }
        break;
      }
      case "x": {
        // Two-stage cancel of every book order on the selected symbol.
        if (tradeMode !== "perps") break;
        const hasOrders = perpOpenOrders.some(
          (order) => order.symbol === selectedSymbol && !order.isStopLoss,
        );
        if (!hasOrders) break;
        if (armedHotkey?.key === "x" && Date.now() < armedHotkey.until) {
          armedHotkey = null;
          void cancelSymbolBookOrders(selectedSymbol);
        } else {
          armedHotkey = { key: "x", until: Date.now() + 3_000 };
        }
        break;
      }
      case ",":
        cycleWatchlist(-1);
        break;
      case ".":
        cycleWatchlist(1);
        break;
      case "[":
        if (tfIndex > 0) onTimeframeChange(PHOENIX_TIMEFRAMES[tfIndex - 1]);
        break;
      case "]":
        if (tfIndex >= 0 && tfIndex < PHOENIX_TIMEFRAMES.length - 1) {
          onTimeframeChange(PHOENIX_TIMEFRAMES[tfIndex + 1]);
        }
        break;
      default:
        break;
    }
  }

</script>

<svelte:head>
  <title>{docTitle}</title>
  <meta
    name="description"
    content="Frontend-only Trader Ralph SvelteKit terminal."
  />
</svelte:head>

<svelte:window
  onclick={closeAccountMenuFromWindow}
  onkeydown={onGlobalKeydown}
/>

<main class="terminal-shell">
  <a class="skip-link" href="#terminal-content">Skip to terminal content</a>

  <header class="topbar" bind:clientHeight={topbarHeight}>
    <a class="brand" href="/terminal" aria-label="Trader Ralph terminal">
      <span class="brand-mark"><BrandMark /></span>
      <span>Trader Ralph</span>
      <strong>Terminal</strong>
    </a>
    <div class="topbar-actions">
      {#if layoutCustomized}
        <button class="ghost" type="button" onclick={resetLayout}>Reset layout</button>
      {/if}
      <button class="secondary alerts-btn" type="button" onclick={() => (alertsOpen = true)}>
        Alerts{#if $alerts.filter((a) => !a.triggered).length}
          <span class="alerts-count">{$alerts.filter((a) => !a.triggered).length}</span>
        {/if}
      </button>
      {#if $privyAuth.authenticated}
        <div class="account-menu">
          <button
            class="account-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            onclick={toggleAccountMenu}
          >
            <span class="account-trigger-text">
              <small>{$privyAuth.email ? shortEmail($privyAuth.email) : "Account"}</small>
              <strong>{balanceText}</strong>
            </span>
            <span class="account-caret" class:open={accountMenuOpen} aria-hidden="true"></span>
          </button>
          {#if accountMenuOpen}
            <div
              class="account-dropdown"
              role="menu"
              tabindex="-1"
              onclick={(event) => event.stopPropagation()}
              onkeydown={(event) => event.stopPropagation()}
            >
              <div class="account-dropdown-head">
                <div class="account-identity">
                  <small>Signed in</small>
                  <strong>{$privyAuth.email ?? "Privy account"}</strong>
                </div>
                <span class="wallet-badge {$privyAuth.walletStatus}">{walletStatusLabel}</span>
              </div>

              <button
                class="account-row copyable"
                type="button"
                disabled={!$privyAuth.walletAddress}
                onclick={copyWalletAddress}
              >
                <span class="account-row-label">Wallet</span>
                <span class="account-row-value mono">
                  {$privyAuth.walletAddress ? shortAddress($privyAuth.walletAddress) : "Not provisioned"}
                </span>
                {#if $privyAuth.walletAddress}
                  <span class="copy-hint" class:done={walletCopied}>{walletCopied ? "Copied" : "Copy"}</span>
                {/if}
              </button>

              {#if walletScreen.checked}
                <div class="account-row">
                  <span class="account-row-label">Screening</span>
                  <span class="account-row-value">OFAC SDN</span>
                  <span class="macro-chip {walletScreen.flagged ? 'down' : 'up'}">
                    {walletScreen.flagged ? "Flagged" : "Clear"}
                  </span>
                </div>
              {/if}

              {#if phoenixWhitelisted !== null}
                <div class="account-row">
                  <span class="account-row-label">Phoenix</span>
                  <span class="account-row-value">beta access</span>
                  <span class="macro-chip {phoenixWhitelisted ? 'up' : 'warn'}">
                    {phoenixWhitelisted ? "Active" : "Pending"}
                  </span>
                </div>

              {/if}

              <div class="account-row">
                <span class="account-row-label">Funds</span>
                <span class="account-row-value mono">
                  {balanceText}
                  {#if phoenixTotalCollateral > 0 && usdcBalanceValue !== null}
                    <small class="funds-split">
                      {formatNumber(usdcBalanceValue, 2)} wallet · {formatNumber(phoenixTotalCollateral, 2)} phoenix
                    </small>
                  {/if}
                </span>
                <button
                  class="row-action"
                  type="button"
                  disabled={!$privyAuth.walletAddress || walletBalanceStatus === "loading"}
                  onclick={() => {
                    void refreshWalletBalance();
                    void refreshPhoenixTrader();
                  }}
                >
                  {walletBalanceStatus === "loading" ? "…" : "Refresh"}
                </button>
              </div>

              <div class="account-row">
                <span class="account-row-label">Gas</span>
                <span class="account-row-value mono">{walletBalanceText}</span>
              </div>

              {#if walletBalanceError}
                <p class="account-dropdown-note warn">{walletBalanceError}</p>
              {/if}

              <button
                class="account-action accent"
                type="button"
                disabled={!$privyAuth.walletAddress || walletScreen.flagged}
                onclick={openFunds}
              >
                {walletScreen.flagged ? "Funding blocked (flagged)" : "Add funds"}
              </button>

              <button class="account-action danger" type="button" disabled={logoutBusy} onclick={disconnectPrivy}>
                {logoutBusy ? "Logging out…" : "Log out"}
              </button>
            </div>
          {/if}
        </div>
      {:else}
        {#if !$privyAuth.configured}
          <span class="connect-status error">
            <span class="stream-dot offline" aria-hidden="true"></span>
            Auth not configured
          </span>
        {:else if $privyAuth.status === "error"}
          <span class="connect-status error">
            <span class="stream-dot offline" aria-hidden="true"></span>
            Connection failed
          </span>
        {/if}
        <button
          class="primary connect-btn"
          type="button"
          disabled={$privyAuth.status === "loading" || !$privyAuth.configured}
          onclick={openAuthModal}
        >
          {#if $privyAuth.status === "loading"}
            <span class="spinner" aria-hidden="true"></span>
          {/if}
          {connectLabel}
        </button>
      {/if}
    </div>
  </header>

  {#if showOpenBetaBanner}
    <div class="terminal-notice">
      <OpenBetaBanner ondismiss={dismissOpenBetaBanner} />
    </div>
  {/if}

  <div
    class="market-rail"
    bind:clientHeight={marketRailHeight}
    style={`--rail-top: ${topbarHeight}px;`}
  >
  <div class="ticker" role="status" aria-live="polite">
    {#if tradeMode === "spot" && spotAsset}
      <div class="ticker-symbol">
        <button
          class="star-btn"
          class:starred={watchlist.includes(spotAsset.symbol.toUpperCase())}
          type="button"
          aria-label="Toggle watchlist"
          onclick={() => spotAsset && toggleWatch(spotAsset.symbol)}
        >{watchlist.includes(spotAsset.symbol.toUpperCase()) ? "★" : "☆"}</button>
        <button class="ticker-market" type="button" onclick={openPalette} title="Change market — press /">
          <strong>{spotAsset.symbol}</strong>
          <span class="ticker-caret" aria-hidden="true">▾</span>
        </button>
        <span class="ticker-health">spot</span>
      </div>
      <div class="ticker-price">
        <b
          class:positive={(spotAsset.change24hPct ?? 0) >= 0}
          class:negative={(spotAsset.change24hPct ?? 0) < 0}
        >
          {formatPrice(spotAsset.price)}
        </b>
        <em
          class:positive={(spotAsset.change24hPct ?? 0) >= 0}
          class:negative={(spotAsset.change24hPct ?? 0) < 0}
        >
          {formatPercent(spotAsset.change24hPct)} 24h
        </em>
      </div>
      <div class="ticker-stats">
        {@render TickerStat("Liquidity", `$${formatNumber(spotAsset.liquidityUsd, 0)}`, "6rem", false)}
        {@render TickerStat("Mkt Cap", `$${formatNumber(spotAsset.marketCap, 0)}`, "6rem", false)}
        {@render TickerStat("24h Vol", `$${formatNumber(spotAsset.volume24hUsd, 0)}`, "6.5rem", false)}
        {@render TickerStat("Venue", "Jupiter", "4.5rem", false)}
        {@render TickerStat("Trust", spotAsset.trustTier || "—", "4rem", false)}
        {#if spotBasisBps !== null}
          {@render TickerStat(
            "Perp basis",
            `${spotBasisBps >= 0 ? "+" : ""}${formatNumber(spotBasisBps, 0)} bps`,
            "5.5rem",
            false,
            spotBasisBps >= 0 ? "positive" : "negative",
          )}
        {/if}
      </div>
    {:else}
      <div class="ticker-symbol">
        <button
          class="star-btn"
          class:starred={watchlist.includes(selectedSymbol)}
          type="button"
          aria-label="Toggle watchlist"
          onclick={() => toggleWatch(selectedSymbol)}
        >{watchlist.includes(selectedSymbol) ? "★" : "☆"}</button>
        <button class="ticker-market" type="button" onclick={openPalette} title="Change market — press /">
          <strong>{selectedSymbol}-PERP</strong>
          <span class="ticker-caret" aria-hidden="true">▾</span>
        </button>
        <span class="ticker-health">{streamHealth}</span>
      </div>
      <div class="ticker-price">
        {#if priceLoading}
          <span class="skeleton skel-price" aria-hidden="true"></span>
        {:else}
          <b
            class:positive={(change24h ?? 0) >= 0}
            class:negative={(change24h ?? 0) < 0}
          >
            {formatPrice(chartPrice)}
          </b>
          <em
            class:positive={(change24h ?? 0) >= 0}
            class:negative={(change24h ?? 0) < 0}
          >
            {formatPercent(change24h)} 24h
          </em>
        {/if}
      </div>
      <div class="ticker-stats">
        {@render TickerStat("Mark", formatPrice(marketStats?.markPx), "4.5rem", statsLoading)}
        {@render TickerStat("Oracle", formatPrice(marketStats?.oraclePx), "4.5rem", statsLoading)}
        {@render TickerStat("Spread", `${formatNumber(spreadBps, 1)} bps`, "4.5rem", bookLoading)}
        {@render TickerStat(
          "Funding",
          formatPercent(fundingPercent),
          "4rem",
          statsLoading,
          (fundingPercent ?? 0) >= 0 ? "positive" : "negative",
        )}
        {#if perpBasisBps !== null}
          {@render TickerStat(
            "Basis",
            `${perpBasisBps >= 0 ? "+" : ""}${formatNumber(perpBasisBps, 0)} bps`,
            "4.5rem",
            false,
            perpBasisBps >= 0 ? "positive" : "negative",
          )}
        {/if}
        {@render TickerStat("Open Int", formatNumber(marketStats?.openInterest, 0), "5rem", statsLoading)}
        {@render TickerStat("24h Vol", formatNumber(marketStats?.dayNtlVlm, 0), "6.5rem", statsLoading)}
        {@render TickerStat("Updated", marketFresh, "4.5rem", updatedLoading)}
      </div>
    {/if}
  </div>

  <nav class="section-nav" aria-label="Jump to terminal section">
    {#each SECTION_LINKS as link}
      <button
        type="button"
        class:active={activeSection === link.id}
        onclick={() => scrollToSection(link.id)}
      >
        {link.label}
      </button>
    {/each}
  </nav>

  <NewsMarquee {news} />
  </div>

  <!-- Sticky chrome (topbar on desktop + market rail) covers the top of the
       viewport — jump-to-section targets scroll-margin below it. -->
  <section
    id="terminal-content"
    class="dashboard"
    style={`--anchor-top: ${(stackedBook ? topbarHeight : 0) + marketRailHeight}px;`}
  >
    <section id="section-chart" class="panel chart-panel">
      <div class="chart-toolbar">
        <div class="timeframe-tabs" aria-label="Chart timeframe">
          {#each PHOENIX_TIMEFRAMES as timeframe}
            <button
              class:active={selectedTimeframe === timeframe}
              type="button"
              onclick={() => onTimeframeChange(timeframe)}
            >
              {timeframe}
            </button>
          {/each}
        </div>

        <div class="chart-market-tools">
          <div
            class="price-mode-toggle venue-toggle"
            class:spot={tradeMode === "spot"}
            aria-label="Trading mode"
          >
            <button
              class:active={tradeMode === "perps"}
              type="button"
              onclick={() => setTradeMode("perps")}
            >
              Perps
            </button>
            <button
              class:active={tradeMode === "spot"}
              type="button"
              onclick={() => setTradeMode("spot")}
            >
              Spot
            </button>
          </div>
          <button
            class="market-select market-open"
            type="button"
            onclick={openPalette}
            title="Change market — press /"
          >
            <span class="market-open-label">
              {#if tradeMode === "perps"}
                {selectedSymbol}-PERP · {selectedMarket?.marketStatus ?? "active"}
              {:else if spotAsset}
                {spotAsset.symbol} · {spotAsset.name}
              {:else}
                Select market…
              {/if}
            </span>
            <span class="market-open-hint" aria-hidden="true">/</span>
          </button>
        </div>

        {#if tradeMode === "perps"}
          <div class="price-mode-toggle" aria-label="Price mode">
            <button
              class:active={priceMode === "last"}
              type="button"
              onclick={() => setPriceMode("last")}
            >
              Last Price
            </button>
            <button
              class:active={priceMode === "mark"}
              type="button"
              onclick={() => setPriceMode("mark")}
            >
              Mark Price
            </button>
          </div>
        {:else}
          <div class="price-mode-toggle" aria-label="Spot venue">
            <span class="spot-venue-tag">Jupiter · best route</span>
          </div>
        {/if}
      </div>

      <div class="chart-workspace">
        <aside class="chart-tools" aria-label="Chart controls">
          <button type="button" aria-label="Zoom in" onclick={() => zoomChart("in")}>+</button>
          <button type="button" aria-label="Zoom out" onclick={() => zoomChart("out")}>-</button>
          <button type="button" aria-label="Fit chart" onclick={resetChartView}>FIT</button>
          <button type="button" aria-label="Scroll to latest" onclick={scrollToRealtime}>NOW</button>
        </aside>

        <div class="chart-canvas-shell">
          <div class="chart-overlay">
            <div class="chart-symbol-line">
              {#if tradeMode === "spot" && spotAsset}
                <strong>{spotAsset.symbol}</strong>
                <span class="chart-tf">{spotIntervalFor(selectedTimeframe)} · spot</span>
                <small>tokens.xyz · Jupiter</small>
              {:else}
                <strong>{selectedSymbol}-PERP</strong>
                <span class="chart-tf">{selectedTimeframe}</span>
                <span class="chart-health {streamHealth}">
                  {streamHealth}
                </span>
                <small>{marketFresh}</small>
              {/if}
            </div>
            {#if tradeMode === "perps" && selectedPosition}
              <div
                class="pos-badge"
                class:positive={selectedPosition.size > 0}
                class:negative={selectedPosition.size < 0}
              >
                {selectedPosition.size > 0 ? "LONG" : "SHORT"}
                {formatNumber(Math.abs(selectedPosition.size), 4)}
                @ {formatPrice(selectedPosition.entryPrice)}
                {#if selectedPosition.unrealizedPnl !== null}
                  · {selectedPosition.unrealizedPnl >= 0 ? "+" : "-"}${formatNumber(Math.abs(selectedPosition.unrealizedPnl), 2)}
                {/if}
                {#if selectedPosition.liquidationPrice !== null}
                  · liq {formatPrice(selectedPosition.liquidationPrice)} est
                {/if}
              </div>
            {/if}
            <div class="chart-legend">
              <span><i>O</i><b>{formatPrice(activeCandle?.open)}</b></span>
              <span><i>H</i><b>{formatPrice(activeCandle?.high)}</b></span>
              <span><i>L</i><b>{formatPrice(activeCandle?.low)}</b></span>
              <span><i>C</i><b>{formatPrice(activeCandle?.close)}</b></span>
              <span><i>Vol</i><b>{formatNumber(activeCandle?.volumeQuote, 0)}</b></span>
              <em
                class:positive={(change24h ?? 0) >= 0}
                class:negative={(change24h ?? 0) < 0}
              >{formatPercent(change24h)}</em>
            </div>
          </div>

          {#if displayPoints.length < 2}
            <div class="empty chart-empty">
              {tradeMode === "spot"
                ? `Loading ${spotAsset?.symbol ?? "spot"} candles…`
                : `Loading Phoenix ${selectedSymbol} live candles.`}
            </div>
          {/if}

          <div class="chart-canvas" bind:this={chartContainer}></div>
        </div>
      </div>

      <div class="chart-footer">
        <button
          class:active={visibleCandleCount === 30}
          type="button"
          onclick={() => setVisibleCandleRange(30)}
        >
          30
        </button>
        <button
          class:active={visibleCandleCount === 60}
          type="button"
          onclick={() => setVisibleCandleRange(60)}
        >
          60
        </button>
        <button
          class:active={visibleCandleCount === 120}
          type="button"
          onclick={() => setVisibleCandleRange(120)}
        >
          120
        </button>
        <button
          class:active={visibleCandleCount === MAX_VISIBLE_CANDLES}
          type="button"
          onclick={() => setVisibleCandleRange(MAX_VISIBLE_CANDLES)}
        >
          180
        </button>
        {#if tradeMode === "perps"}
          <span class="line-toggle-group" role="group" aria-label="Chart lines">
            {#each [["pos", "POS"], ["tpsl", "TP/SL"], ["orders", "ORD"], ["alerts", "ALRT"]] as [key, label] (key)}
              <button
                class="line-toggle"
                class:active={$chartLinePrefs[key as keyof typeof $chartLinePrefs]}
                type="button"
                title={`Toggle ${label} lines`}
                onclick={() =>
                  chartLinePrefs.update((prefs) => ({
                    ...prefs,
                    [key]: !prefs[key as keyof typeof prefs],
                  }))}
              >
                {label}
              </button>
            {/each}
          </span>
        {/if}
        <strong>{chartRangeLabel} · UTC · {candleCountdown}</strong>
        <button
          class:active={chartScale === "percent"}
          type="button"
          aria-pressed={chartScale === "percent"}
          onclick={() => {
            chartScale = chartScale === "percent" ? "price" : "percent";
            if (chartScale === "percent") chartAxisMode = "linear";
          }}
        >
          %
        </button>
        <button
          class:active={chartAxisMode === "log"}
          type="button"
          aria-pressed={chartAxisMode === "log"}
          onclick={() => {
            chartAxisMode = chartAxisMode === "log" ? "linear" : "log";
            if (chartAxisMode === "log") chartScale = "price";
          }}
        >
          log
        </button>
        <button
          class:active={autoFollow}
          type="button"
          onclick={scrollToRealtime}
        >
          auto
        </button>
      </div>
    </section>

    <section id="section-book" class="panel orderbook-panel">
      {#if stackedBook}
        <!-- Desktop: ladder + ticket stack — reading the book and typing
             the order are simultaneous, never tabs. The tape shares the
             ladder slot (all three don't fit); its tabs only swap the feed. -->
        {#if tradeMode === "perps"}
          <div class="book-stack">
            <div class="book-tabs" role="tablist" aria-label="Order book and tape">
              <button
                role="tab"
                aria-selected={bookFeed === "ladder"}
                class:active={bookFeed === "ladder"}
                type="button"
                onclick={() => (bookFeed = "ladder")}
              >
                Order Book
              </button>
              <button
                role="tab"
                aria-selected={bookFeed === "tape"}
                class:active={bookFeed === "tape"}
                type="button"
                onclick={() => (bookFeed = "tape")}
              >
                Tape
              </button>
            </div>
            {#if bookFeed === "ladder"}
              {@render BookLadder()}
            {:else}
              {@render TapeFeed()}
            {/if}
          </div>
        {/if}
        <!-- Enter from any ticket input submits, gated exactly like the button. -->
        <div
          class="panel-ticket"
          class:stacked={tradeMode === "perps"}
          role="presentation"
          onkeydown={tradeMode === "spot" ? onSpotTicketKeydown : onTicketKeydown}
        >
          {#if tradeMode === "spot"}
            {@render SpotTicketForm()}
          {:else}
            {@render TicketForm()}
          {/if}
        </div>
      {:else}
        <div class="book-tabs" role="tablist" aria-label="Trade and order book">
          <button
            role="tab"
            aria-selected={bookTab === "trade"}
            class:active={bookTab === "trade"}
            type="button"
            onclick={() => (bookTab = "trade")}
          >
            Trade
          </button>
          <button
            role="tab"
            aria-selected={bookTab === "book"}
            class:active={bookTab === "book"}
            type="button"
            onclick={() => (bookTab = "book")}
          >
            Order Book
          </button>
        </div>

        {#if bookTab === "book" && tradeMode === "spot"}
          <div class="empty spot-book-note">
            Spot routes through Jupiter's aggregated AMMs — there's no central
            order book. Pricing comes from the live best route in the Trade tab.
          </div>
        {:else if bookTab === "book"}
          <div class="orderbook-controls">
            <button class="lot-select" type="button">
              <span>1</span>
              <span class="chevron" aria-hidden="true"></span>
            </button>
            <strong>USDC</strong>
            <div class="book-icons">
              <button class="book-icon split-icon" type="button" aria-label="Book split">
                <span></span>
                <span></span>
                <span></span>
              </button>
              <button class="book-icon depth-icon" type="button" aria-label="Depth bars">
                <span></span>
                <span></span>
                <span></span>
              </button>
            </div>
          </div>

          {@render BookLadder()}

          {@render TapeFeed()}
        {:else}
          <!-- Enter from any ticket input submits, gated exactly like the button. -->
          <div
            class="panel-ticket"
            role="presentation"
            onkeydown={tradeMode === "spot" ? onSpotTicketKeydown : onTicketKeydown}
          >
            {#if tradeMode === "spot"}
              {@render SpotTicketForm()}
            {:else}
              {@render TicketForm()}
            {/if}
          </div>
        {/if}
      {/if}
    </section>

    <section
      class="panel monitor-panel"
      role="group"
      data-panel="monitor"
      style={panelStyle("monitor", $panelOrder)}
      class:dragging={$draggedPanel === "monitor"}
      class:drag-over={$dragOverPanel === "monitor"}
      ondragover={(event) => onPanelDragOver(event, "monitor")}
      ondragleave={() => onPanelDragLeave("monitor")}
      ondrop={(event) => onPanelDrop(event, "monitor")}
    >
      <div class="panel-head">
        <DragHead panelId="monitor" kicker="MARKETS" title={`${markets.length} perp markets`} />
        <div class="monitor-sorts" role="group" aria-label="Sort monitor">
          {#each ["volume", "change", "symbol"] as key (key)}
            <button
              type="button"
              class:active={monitorSort === key}
              onclick={() => (monitorSort = key as typeof monitorSort)}
            >{key}</button>
          {/each}
        </div>
      </div>
      <div class="monitor-list">
        <div class="monitor-row monitor-head" aria-hidden="true">
          <span>Market</span><span class="r">Mark</span><span class="r">24h</span><span class="r">Volume</span>
        </div>
        {#each monitorRows as row (row.symbol)}
          <button
            type="button"
            class="monitor-row"
            class:active={row.symbol === selectedSymbol && tradeMode === "perps"}
            onclick={() => chooseMonitorRow(row.symbol)}
          >
            <span class="monitor-sym">
              {row.symbol}
              {#if row.lev}<i>{row.lev}x</i>{/if}
            </span>
            <span class="r mono">{formatPrice(row.mid)}</span>
            <span
              class="r mono"
              class:positive={(row.change ?? 0) > 0}
              class:negative={(row.change ?? 0) < 0}
            >{row.change === null ? "--" : formatPercent(row.change)}</span>
            <span class="r mono">{row.volume === null ? "--" : `$${formatNumber(row.volume, 0)}`}</span>
          </button>
        {:else}
          <div class="empty">Markets loading…</div>
        {/each}
      </div>
    </section>

    <section
      id="section-perp"
      class="panel perp-panel"
      role="group"
      data-panel="perp"
      style={panelStyle("perp", $panelOrder)}
      class:dragging={$draggedPanel === "perp"}
      class:drag-over={$dragOverPanel === "perp"}
      ondragover={(event) => onPanelDragOver(event, "perp")}
      ondragleave={() => onPanelDragLeave("perp")}
      ondrop={(event) => onPanelDrop(event, "perp")}
    >
      <div class="panel-head">
        <DragHead panelId="perp" kicker="PERP_DESK" title="Phoenix account" />
        {#if enrichedPositions.length > 0}
          <!-- Two-stage armed; fixed width so the relabel never shifts layout. -->
          <button
            class="row-action flatten-btn"
            class:armed={flattenArmed}
            type="button"
            disabled={flattenBusy}
            onclick={onFlattenClick}
          >
            {#if flattenBusy}<span class="spinner" aria-hidden="true"></span>{/if}
            {flattenBusy ? "Flattening…" : flattenArmed ? "Confirm flatten" : "FLATTEN"}
          </button>
        {/if}
        <button class="primary" type="button" onclick={() => openTrade("buy")}>Trade</button>
      </div>
      <AiReadLine read={fundingRead} />

      {#if phoenixAuthority && phoenixTrader}
        <div class="venue-strip">
          <div><span>Collateral</span><b>{phoenixTrader.collateralUsd !== null ? `$${formatNumber(phoenixTrader.collateralUsd, 2)}` : "--"}</b></div>
          <div><span>uPnL</span>
            <b
              class:positive={(phoenixTrader.unrealizedPnlUsd ?? 0) >= 0}
              class:negative={(phoenixTrader.unrealizedPnlUsd ?? 0) < 0}
            >{phoenixTrader.unrealizedPnlUsd !== null ? `$${formatNumber(phoenixTrader.unrealizedPnlUsd, 2)}` : "--"}</b>
          </div>
          <div><span>Risk</span><b>{phoenixTrader.riskTier ?? "--"}</b></div>
          <div>
            <span>Exposure</span>
            <b
              class:warn={(accountLeverage ?? 0) > 10 && (accountLeverage ?? 0) <= 15}
              class:negative={(accountLeverage ?? 0) > 15}
            >
              {accountExposureUsd > 0
                ? `$${formatNumber(accountExposureUsd, 0)} · ${formatNumber(accountLeverage, 1)}x`
                : "--"}
            </b>
          </div>
          {#if sessionPnlUsd !== null && equityValues.length >= 2}
            <!-- Since the UTC day's first equity sample, deposit/withdraw
                 shifted out — needs two points before it means anything. -->
            <div>
              <span>Day P&L</span>
              <b class:positive={sessionPnlUsd >= 0} class:negative={sessionPnlUsd < 0}>
                {sessionPnlUsd >= 0 ? "+" : "-"}${formatNumber(Math.abs(sessionPnlUsd), 2)}
                {#if sessionPnlPct !== null}({formatPercent(sessionPnlPct)}){/if}
                <Spark values={equityValues} tone={sessionPnlUsd >= 0 ? "up" : "down"} />
              </b>
            </div>
          {/if}
          <button class="row-action" type="button" onclick={openFunds}>Deposit</button>
        </div>

        {#if phoenixTrader.positions.length > 0}
          <AiReadLine read={briefRead} />
        {/if}

        {#if phoenixActionError}
          <p class="auth-note error venue-note" title={phoenixActionErrorDetail || undefined}>
            {phoenixActionError}
            {#if phoenixActionRetry}
              <button class="row-action" type="button" onclick={phoenixActionRetry}>Retry</button>
            {/if}
          </p>
        {/if}

        {#if enrichedPositions.length > 0 || pendingOrder}
          <div class="venue-section">Positions</div>
          {#if pendingOrder}
            <!-- Optimistic row while the indexer catches up; the burst poll
                 replaces it with the real row or drops it on timeout. -->
            <div class="pos-card pos-pending">
              <div class="pos-card-top">
                <span class="pos-side">{pendingOrder.side === "bid" ? "LONG" : "SHORT"}</span>
                <span class="pos-symbol-static">{pendingOrder.symbol}</span>
                <b class="mono">
                  ${formatNumber(pendingOrder.notionalUsd, 2)}
                  @ {formatPrice(pendingOrder.refPrice)} · {pendingOrder.leverage}x
                </b>
              </div>
              <div class="pos-card-mid mono">
                <span>
                  confirming with indexer{apiSlotLag !== null ? ` · SYNC −${apiSlotLag}` : ""}
                </span>
              </div>
            </div>
          {/if}
          {#each enrichedPositions as position (`${position.symbol}:${position.subaccountIndex}`)}
            {@const roePct =
              position.unrealizedPnl !== null && position.marginUsd
                ? (position.unrealizedPnl / position.marginUsd) * 100
                : null}
            {@const liqDist = liqDistancePctOf(position)}
            {@const rowKey = `${position.symbol}:${position.subaccountIndex}`}
            {@const closeBusy = phoenixBusyKeys.has(`close:${rowKey}`)}
            <div class="pos-card">
              <div class="pos-card-top">
                <span
                  class="pos-side"
                  class:positive={position.size > 0}
                  class:negative={position.size < 0}
                >{position.size > 0 ? "LONG" : "SHORT"}</span>
                <button
                  class="pos-symbol"
                  type="button"
                  title="Show on chart"
                  onclick={() => chooseMonitorRow(position.symbol)}
                >{position.symbol}</button>
                <b class="mono">
                  {formatNumber(Math.abs(position.size), 4)}
                  {#if position.positionValue !== null}(${formatNumber(position.positionValue, 2)}){/if}
                </b>
                <em
                  class="mono"
                  class:positive={(position.unrealizedPnl ?? 0) >= 0}
                  class:negative={(position.unrealizedPnl ?? 0) < 0}
                >
                  {position.unrealizedPnl !== null
                    ? `${position.unrealizedPnl >= 0 ? "+" : "-"}$${formatNumber(Math.abs(position.unrealizedPnl), 2)}`
                    : "--"}
                  {#if roePct !== null}({roePct >= 0 ? "+" : ""}{formatNumber(roePct, 1)}%){/if}
                </em>
              </div>
              <div class="pos-card-mid mono">
                <span>entry {formatPrice(position.entryPrice)}</span>
                <span>
                  mark {formatPrice(
                    marketMids[position.symbol] ??
                      (position.symbol === selectedSymbol ? latestPrice : null),
                  )}
                </span>
                <span>
                  TP {position.takeProfitPrice !== null ? formatPrice(position.takeProfitPrice) : "--"}
                  · SL {position.stopLossPrice !== null ? formatPrice(position.stopLossPrice) : "--"}
                </span>
              </div>
              <div class="pos-card-bottom">
                {#if liqDist !== null}
                  <div
                    class="liq-bar"
                    class:warn={liqDist < 25}
                    class:danger={liqDist < 10}
                    title={`Liquidation est ${formatNumber(liqDist, 1)}% away`}
                  >
                    <i style={`width: ${Math.min(100, (liqDist / 50) * 100)}%;`}></i>
                    <span class="mono">liq {formatNumber(liqDist, 1)}% away</span>
                  </div>
                {:else}
                  <span class="mono liq-none">liq --</span>
                {/if}
                {#if liqDist !== null && liqDist < 25}
                  <!-- The remedy that actually moves an isolated liq price:
                       margin into the child subaccount, not an account deposit. -->
                  <button
                    class="row-action"
                    type="button"
                    onclick={() => openMarginAdd(position)}
                  >
                    Margin +
                  </button>
                {/if}
                {#if position.unrealizedPnl !== null}
                  <button
                    class="row-action"
                    type="button"
                    onclick={() => sharePhoenixPosition(position, marketMids)}
                  >
                    Share
                  </button>
                {/if}
                {#each [25, 50, 75] as pct (pct)}
                  <button
                    class="pct-chip"
                    type="button"
                    disabled={closeBusy || closingKeys.has(rowKey)}
                    title={`Close ${pct}% — TP/SL remain attached`}
                    onclick={() => closePhoenixPositionFraction(position, pct / 100)}
                  >
                    {pct}%
                  </button>
                {/each}
                <button
                  class="row-action"
                  type="button"
                  disabled={closeBusy || closingKeys.has(rowKey)}
                  onclick={() =>
                    closePhoenixPosition(
                      position.symbol,
                      position.size,
                      position.subaccountIndex,
                    )}
                >
                  {#if closeBusy}<span class="spinner" aria-hidden="true"></span>{/if}
                  {closingKeys.has(rowKey) ? "Closing…" : "Close"}
                </button>
              </div>
              {#if marginAddKey === rowKey}
                {@const marginBusy = phoenixBusyKeys.has(`margin:${rowKey}`)}
                <div class="margin-add mono">
                  <input
                    bind:value={marginAddValue}
                    inputmode="decimal"
                    aria-label="Margin to add (USDC)"
                    placeholder="USDC"
                  />
                  <button
                    class="row-action"
                    type="button"
                    disabled={marginBusy || !(Number(marginAddValue) > 0)}
                    onclick={() => submitMarginAdd(position)}
                  >
                    {#if marginBusy}<span class="spinner" aria-hidden="true"></span>{/if}
                    Add margin
                  </button>
                  <span class="margin-add-note">free ${formatNumber(Math.max(0, phoenixCollateral), 2)}</span>
                </div>
              {/if}
            </div>
          {/each}
          <div class="pos-total mono">
            <span>TOTAL</span>
            <span>
              exp ${formatNumber(
                enrichedPositions.reduce(
                  (sum, position) => sum + (position.positionValue ?? 0),
                  0,
                ),
                2,
              )}
            </span>
            <span
              class:positive={accountUpnlUsd >= 0}
              class:negative={accountUpnlUsd < 0}
            >uPNL {accountUpnlUsd >= 0 ? "+" : "-"}${formatNumber(Math.abs(accountUpnlUsd), 2)}</span>
          </div>
        {/if}

        {#if perpOpenOrders.length > 0}
          <div class="venue-section venue-section-row">
            <span>Open orders</span>
            {#if perpBidSweepSymbols.length > 0}
              <button
                class="row-action"
                type="button"
                disabled={cancelSweepBusy}
                onclick={() => cancelAllPhoenixOrdersOnSide("bid")}
              >
                Cancel all bids
              </button>
            {/if}
            {#if perpAskSweepSymbols.length > 0}
              <button
                class="row-action"
                type="button"
                disabled={cancelSweepBusy}
                onclick={() => cancelAllPhoenixOrdersOnSide("ask")}
              >
                Cancel all asks
              </button>
            {/if}
          </div>
          {#each perpOpenOrders as order (order.orderSequenceNumber)}
            {@const mark = marketMids[order.symbol] ?? (order.symbol === selectedSymbol ? latestPrice : null)}
            {@const cancelBusy = phoenixBusyKeys.has(orderCancelKey(order))}
            <div class="venue-row">
              <span class={order.side === "bid" ? "positive" : "negative"}>
                {order.isStopLoss ? "STOP" : "LIMIT"} {order.side.toUpperCase()} {order.symbol}
              </span>
              <b class="mono">
                {order.remaining !== null ? formatNumber(order.remaining, 4) : "--"}
                @ {formatPrice(order.price)}
              </b>
              <em class="mono">
                {mark !== null && order.price !== null
                  ? `${formatNumber((Math.abs(order.price - mark) / mark) * 100, 2)}% away`
                  : "--"}
              </em>
              <em class="mono order-seq">#{order.orderSequenceNumber.slice(0, 8)}</em>
              <button
                class="row-action"
                type="button"
                disabled={cancelBusy}
                onclick={() => cancelPhoenixOrderById(order)}
              >
                {#if cancelBusy}<span class="spinner" aria-hidden="true"></span>{/if}
                Cancel
              </button>
            </div>
          {/each}
        {/if}

        {#if phoenixTrader.positions.length === 0 && phoenixTrader.orders.length === 0 && !pendingOrder}
          <div class="empty">
            {phoenixTrader.registered
              ? "No open positions or orders."
              : "No Phoenix account yet — your first order or deposit creates it."}
          </div>
        {/if}
      {:else if phoenixAuthority}
        <div class="empty">Loading Phoenix account…</div>
      {:else}
        <div class="empty">Connect your account to trade on Phoenix.</div>
      {/if}

      <div class="table">
        {#each selectedMarketRows as row}
          <div class="table-row">
            <span>{row.label}</span>
            <b>{row.value}</b>
            <em>{row.status}</em>
          </div>
        {/each}
      </div>
    </section>

    <MacroPanel
      title="MACRO_RADAR"
      subtitle="Signal blend"
      panel={macroPanel}
      panelId="macro"
      id="section-macro"
      read={macroRead}
    />
    <MacroPanel title="FRED_NOWCAST" subtitle="Rates + liquidity" panel={fredPanel} panelId="fred" />
    <MacroPanel title="ETF_FLOWS" subtitle="Spot flow tape" panel={etfPanel} panelId="etf" />
    <MacroPanel
      title="STABLECOINS"
      subtitle="Dollar rail watch"
      panel={stablecoinPanel}
      panelId="stablecoins"
    />
    <MacroPanel title="OIL_MACRO" subtitle="Energy regime" panel={oilPanel} panelId="oil" />

    <section
      class="panel macro-panel"
      role="group"
      data-panel="events"
      style={panelStyle("events", $panelOrder)}
      class:dragging={$draggedPanel === "events"}
      class:drag-over={$dragOverPanel === "events"}
      ondragover={(event) => onPanelDragOver(event, "events")}
      ondragleave={() => onPanelDragLeave("events")}
      ondrop={(event) => onPanelDrop(event, "events")}
    >
      <div class="panel-head">
        <DragHead panelId="events" kicker="EVENT_RADAR" title="Live headlines" />
        <button
          class="link-chip"
          class:on={newsLinked}
          type="button"
          title="Filter headlines to the active market"
          onclick={() => (newsLinked = !newsLinked)}
        >{newsLinked && activeNewsSymbol ? activeNewsSymbol : "ALL"}</button>
        {#if newsLinked && headlineVelocity > 3}
          <span class="velocity-chip">{headlineVelocity}/h</span>
        {/if}
      </div>
      <AiReadLine read={eventRead} />
      <div class="news-list">
        {#each linkedNews.slice(0, 6) as item (item.url)}
          <a class="news-row" href={item.url} target="_blank" rel="noopener noreferrer">
            <span class="news-row-title">{item.title}</span>
            <em>{item.domain} · {formatAge(item.seenMs)}</em>
          </a>
        {:else}
          <div class="empty">
            {newsLinked && activeNewsSymbol
              ? `No ${activeNewsSymbol} headlines in feed.`
              : "No headlines loaded."}
          </div>
        {/each}
      </div>
    </section>

    <section
      class="panel macro-panel"
      role="group"
      data-panel="ideas"
      style={panelStyle("ideas", $panelOrder)}
      class:dragging={$draggedPanel === "ideas"}
      class:drag-over={$dragOverPanel === "ideas"}
      ondragover={(event) => onPanelDragOver(event, "ideas")}
      ondragleave={() => onPanelDragLeave("ideas")}
      ondrop={(event) => onPanelDrop(event, "ideas")}
    >
      <div class="panel-head">
        <DragHead panelId="ideas" kicker="DESK_IDEAS" title="Cross-signal synthesis" />
      </div>
      <AiReadLine read={ideasRead} />
    </section>

    <section
      class="panel watchlist-panel"
      role="group"
      data-panel="watch"
      style={panelStyle("watch", $panelOrder)}
      class:dragging={$draggedPanel === "watch"}
      class:drag-over={$dragOverPanel === "watch"}
      ondragover={(event) => onPanelDragOver(event, "watch")}
      ondragleave={() => onPanelDragLeave("watch")}
      ondrop={(event) => onPanelDrop(event, "watch")}
    >
      <div class="panel-head">
        <DragHead panelId="watch" kicker="WATCHLIST" title={`${watchlist.length} starred`} />
      </div>
      <div class="markets-list">
        {#each watchRows as row (row.sym)}
          <button type="button" onclick={() => openWatchRow(row)}>
            <span>
              {row.sym}
              {#if row.basisBps !== null}
                <small
                  class="basis-tag"
                  class:positive={row.basisBps >= 0}
                  class:negative={row.basisBps < 0}
                >{row.basisBps >= 0 ? "+" : ""}{formatNumber(row.basisBps, 0)}bp</small>
              {/if}
            </span>
            <b>{formatPrice(row.price)}</b>
            <em
              class:positive={(row.change ?? 0) >= 0}
              class:negative={(row.change ?? 0) < 0}
            >{row.change !== null ? formatPercent(row.change) : row.hasPerp ? "perp" : ""}</em>
          </button>
        {:else}
          <div class="empty">Star a market (☆ in the ticker) to track it here.</div>
        {/each}
      </div>
    </section>

    <section
      class="panel watchlist-panel"
      role="group"
      data-panel="screener"
      style={panelStyle("screener", $panelOrder)}
      class:dragging={$draggedPanel === "screener"}
      class:drag-over={$dragOverPanel === "screener"}
      ondragover={(event) => onPanelDragOver(event, "screener")}
      ondragleave={() => onPanelDragLeave("screener")}
      ondrop={(event) => onPanelDrop(event, "screener")}
    >
      <div class="panel-head">
        <DragHead panelId="screener" kicker="SCREENER" title={`${screenRows.length} of ${spotAssets.length}`} />
      </div>
      <div class="screen-controls">
        {#each [["movers", "Movers"], ["volume", "Volume"], ["cap", "Mkt cap"]] as [key, label] (key)}
          <button
            class="screen-chip"
            class:active={screenSort === key}
            type="button"
            onclick={() => (screenSort = key as typeof screenSort)}
          >{label}</button>
        {/each}
        <span class="screen-sep" aria-hidden="true"></span>
        {#each [["all", "All"], ["crypto", "Crypto"], ["equities", "Stocks"], ["pre-ipo", "Pre-IPO"]] as [key, label] (key)}
          <button
            class="screen-chip"
            class:active={screenHub === key}
            type="button"
            onclick={() => (screenHub = key as typeof screenHub)}
          >{label}</button>
        {/each}
      </div>
      <div class="markets-list spot-list">
        {#each screenRows as asset (asset.assetId)}
          <button
            class:selected-market={tradeMode === "spot" && spotAsset?.assetId === asset.assetId}
            type="button"
            onclick={() => selectSpotAsset(asset)}
          >
            <span>{asset.symbol}</span>
            <b>{formatPrice(asset.price)}</b>
            <em
              class:positive={(asset.change24hPct ?? 0) >= 0}
              class:negative={(asset.change24hPct ?? 0) < 0}
            >{formatPercent(asset.change24hPct)}</em>
          </button>
        {:else}
          <div class="empty">Loading the catalog…</div>
        {/each}
      </div>
    </section>

    <section
      class="panel watchlist-panel"
      role="group"
      data-panel="spot"
      style={panelStyle("spot", $panelOrder)}
      class:dragging={$draggedPanel === "spot"}
      class:drag-over={$dragOverPanel === "spot"}
      ondragover={(event) => onPanelDragOver(event, "spot")}
      ondragleave={() => onPanelDragLeave("spot")}
      ondrop={(event) => onPanelDrop(event, "spot")}
    >
      <div class="panel-head">
        <DragHead panelId="spot" kicker="SPOT_MARKETS" title={`${spotAssets.length} tokens.xyz assets`} />
        <span class="verdict-badge flat">Jupiter</span>
      </div>
      <div class="spot-search">
        <input
          bind:value={spotSearch}
          placeholder="Search token…"
          aria-label="Search spot assets"
        />
      </div>
      <div class="markets-list spot-list">
        {#each spotFiltered.slice(0, 30) as asset (asset.assetId)}
          <button
            class:selected-market={tradeMode === "spot" && spotAsset?.assetId === asset.assetId}
            type="button"
            onclick={() => selectSpotAsset(asset)}
          >
            {#if asset.imageUrl}
              <img class="spot-logo" src={asset.imageUrl} alt="" loading="lazy" />
            {:else}
              <span class="spot-logo spot-logo-blank"></span>
            {/if}
            <span class="spot-row-sym">{asset.symbol}</span>
            <b>{formatPrice(asset.price)}</b>
            <em
              class:positive={(asset.change24hPct ?? 0) >= 0}
              class:negative={(asset.change24hPct ?? 0) < 0}
            >{formatPercent(asset.change24hPct)}</em>
            {#if tokenBalances[asset.mint]}
              <small class="spot-held">●</small>
            {/if}
          </button>
        {:else}
          <div class="empty">
            {spotSearch ? "No assets match." : "Loading tokens.xyz assets…"}
          </div>
        {/each}
      </div>
    </section>

    <section
      id="section-markets"
      class="panel watchlist-panel"
      role="group"
      data-panel="markets"
      style={panelStyle("markets", $panelOrder)}
      class:dragging={$draggedPanel === "markets"}
      class:drag-over={$dragOverPanel === "markets"}
      ondragover={(event) => onPanelDragOver(event, "markets")}
      ondragleave={() => onPanelDragLeave("markets")}
      ondrop={(event) => onPanelDrop(event, "markets")}
    >
      <div class="panel-head">
        <DragHead panelId="markets" kicker="PHOENIX_MARKETS" title={`${markets.length} perp markets`} />
      </div>
      <AiReadLine read={scannerRead} />
      <div class="markets-list">
        {#each markets as market}
          <button
            class:selected-market={market.symbol === selectedSymbol}
            type="button"
            onclick={() => onMarketChange(market.symbol)}
          >
            <span>{market.symbol}</span>
            <b>{formatPrice(marketMids[market.symbol])}</b>
            <em>{market.marketStatus}</em>
          </button>
        {:else}
          <div class="empty">Loading Phoenix market list.</div>
        {/each}
      </div>
    </section>

    <section
      class="panel watchlist-panel"
      role="group"
      data-panel="journal"
      style={panelStyle("journal", $panelOrder)}
      class:dragging={$draggedPanel === "journal"}
      class:drag-over={$dragOverPanel === "journal"}
      ondragover={(event) => onPanelDragOver(event, "journal")}
      ondragleave={() => onPanelDragLeave("journal")}
      ondrop={(event) => onPanelDrop(event, "journal")}
    >
      <div class="panel-head">
        <DragHead panelId="journal" kicker="JOURNAL" title={`${journalToday.length} today · ${journalEntries.length} total`} />
        {#if journalEntries.length > 0}
          <button class="row-action" type="button" onclick={exportJournalCsv}>CSV</button>
          <button class="row-action" type="button" onclick={wipeJournal}>Clear</button>
        {/if}
      </div>
      {#if journalToday.length >= 2}
        <AiReadLine read={recapRead} />
      {/if}
      <div class="journal-list">
        {#each [...journalEntries].reverse().slice(0, 12) as entry (entry.ts)}
          <div class="journal-row">
            <span class="journal-time">{new Date(entry.ts).toISOString().slice(11, 16)}</span>
            <span
              class="journal-action"
              class:positive={entry.action === "buy" || entry.action === "long" || entry.action === "limit-buy"}
              class:negative={entry.action === "sell" || entry.action === "short" || entry.action === "limit-sell"}
            >{entry.action.toUpperCase()}</span>
            <span class="journal-sym">{entry.symbol}</span>
            <b>{entry.notionalUsd !== null ? `$${formatNumber(entry.notionalUsd, 0)}` : "--"}{entry.leverage ? ` · ${entry.leverage}x` : ""}</b>
            {#if entry.signature}
              <a
                class="journal-tx"
                href={`https://solscan.io/tx/${entry.signature}`}
                target="_blank"
                rel="noopener noreferrer"
              >tx</a>
            {/if}
          </div>
        {:else}
          <div class="empty">Orders you place are logged here, locally.</div>
        {/each}
      </div>
    </section>

  </section>
  <footer class="status-line" aria-label="Terminal status">
    <span class="mono">{new Date(nowMs).toISOString().slice(11, 19)} UTC</span>
    <span class="sl-sep" aria-hidden="true"></span>
    <span>{tradeMode === "perps" ? selectedSymbol : (spotAsset?.symbol ?? "--")} · {sessionNote}</span>
    <span class="sl-sep" aria-hidden="true"></span>
    <span class:positive={streamHealth === "live"} class:warn-txt={streamHealth !== "live"}>WS {streamHealth}</span>
    <span>RPC {rpcLatencyMs !== null ? `${rpcLatencyMs}ms` : "--"}</span>
    {#if apiSlotLag !== null}
      <span class:warn-txt={apiSlotLag > 150} title="Phoenix indexer slots behind the chain tip">
        SYNC −{apiSlotLag}
      </span>
    {/if}
    {#if lastTx}
      <span class="sl-sep" aria-hidden="true"></span>
      <span class="mono" class:warn-txt={lastTx.stage === "failed"}>
        TX {lastTx.label} · {txStageText(lastTx, nowMs)}
      </span>
    {/if}
    {#if armedHotkey}
      <span class="sl-sep" aria-hidden="true"></span>
      <span class="warn-txt">
        {armedHotkey.key === "c"
          ? `press C again to market-close ${selectedSymbol}`
          : `press X again to cancel ${selectedSymbol} orders`}
      </span>
    {/if}
    <span class="sl-grow" aria-hidden="true"></span>
    {#if phoenixAuthority}
      <!-- Money at a glance, always: the segment jumps to the perp desk. -->
      <button
        type="button"
        class="sl-money"
        title="Jump to positions"
        onclick={() => scrollToSection("section-perp")}
      >
        <span>EQ ${formatNumber(accountEquityUsd, 0)}</span>
        <span class:positive={accountUpnlUsd >= 0} class:negative={accountUpnlUsd < 0}>
          uPNL {accountUpnlUsd >= 0 ? "+" : "-"}${formatNumber(Math.abs(accountUpnlUsd), 2)}
        </span>
        <span>FREE ${formatNumber(phoenixCollateral, 0)}</span>
        {#if fundingPercent !== null}
          <span>FUND {fundingPercent >= 0 ? "+" : ""}{formatNumber(fundingPercent, 3)}%/8h</span>
        {/if}
      </button>
      <span class="sl-sep" aria-hidden="true"></span>
    {/if}
    {#if $privyAuth.walletAddress}
      <span class="mono">{shortAddress($privyAuth.walletAddress)}</span>
      <span class="sl-sep" aria-hidden="true"></span>
    {/if}
    <button type="button" class="sl-help" onclick={() => (cheatOpen = true)}>? shortcuts</button>
  </footer>
</main>

<ToastStack />

{#if cheatOpen}
  <CheatSheetModal onclose={() => (cheatOpen = false)} />
{/if}

{#if authOpen}
  <AuthModal onclose={() => (authOpen = false)} onauthenticated={refreshEdgeModules} />
{/if}

{#if tradeOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => (tradeOpen = false)}>
    <!-- Enter from any ticket input submits, gated exactly like the button;
         everything else bubbles so B/S/M/L flip the ticket and Esc closes. -->
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={onTicketKeydown}
    >
      <div class="panel-head">
        <div>
          <p>TRADE_TICKET</p>
          <h2>{tradeSide === "buy" ? "LONG" : "SHORT"} {selectedSymbol}-PERP</h2>
        </div>
        <button class="modal-close" type="button" aria-label="Close" onclick={() => (tradeOpen = false)}>×</button>
      </div>
      <div class="modal-body">
        {@render TicketForm()}
      </div>
    </section>
  </div>
{/if}

<AlertsModal
  open={alertsOpen}
  symbol={selectedSymbol}
  {latestPrice}
  onclose={() => (alertsOpen = false)}
/>

{#if paletteOpen}
  <CommandPalette
    {markets}
    {spotAssets}
    {marketMids}
    {dailyStats}
    {watchlist}
    positions={enrichedPositions}
    openOrders={perpOpenOrders}
    oncloseposition={(position) =>
      void closePhoenixPosition(
        position.symbol,
        position.size,
        position.subaccountIndex,
      )}
    oncancelorders={(symbol) => void cancelSymbolBookOrders(symbol)}
    onflatten={() => void closeAllPhoenixPositions()}
    onselect={choosePalette}
    ontogglewatch={toggleWatch}
    onclose={() => (paletteOpen = false)}
  />
{/if}

{#if fundsOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => (fundsOpen = false)}>
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={swallowKeysExceptEscape}
    >
      <div class="panel-head">
        <div>
          <p>ADD_FUNDS</p>
          <h2>{usdcBalanceText}</h2>
        </div>
        <button class="modal-close" type="button" aria-label="Close" onclick={() => (fundsOpen = false)}>×</button>
      </div>
      <div class="modal-body">
        <div class="side-toggle funds-tabs funds-tabs-3" role="group" aria-label="Funding method">
          <button class:active={fundsTab === "receive"} type="button" onclick={() => (fundsTab = "receive")}>Receive</button>
          <button class:active={fundsTab === "convert"} type="button" onclick={() => (fundsTab = "convert")}>Convert</button>
          <button class:active={fundsTab === "phoenix"} type="button" onclick={() => (fundsTab = "phoenix")}>Phoenix</button>
        </div>

        {#if fundsTab === "receive"}
          <p class="auth-lead">Send <b>USDC</b> or <b>SOL</b> on the <b>Solana</b> network to this address.</p>
          {#if fundsQr}
            <div class="funds-qr">{@html fundsQr}</div>
          {/if}
          <button
            class="account-row copyable funds-address"
            type="button"
            disabled={!$privyAuth.walletAddress}
            onclick={copyWalletAddress}
          >
            <span class="account-row-value mono">{$privyAuth.walletAddress ?? "—"}</span>
            <span class="copy-hint" class:done={walletCopied}>{walletCopied ? "Copied" : "Copy"}</span>
          </button>
          <div class="ticket-preview">
            <div class="preview-row"><span>USDC balance</span><b>{usdcBalanceText}</b></div>
            <div class="preview-row"><span>SOL (gas)</span><b>{walletBalanceText}</b></div>
          </div>
          <p class="auth-note">Deposits appear automatically. Keep a little SOL for network fees.</p>
        {:else if fundsTab === "convert"}
          <p class="auth-lead">Swap <b>SOL → USDC</b> in your wallet via Jupiter (best route).</p>
          <label>
            Amount (SOL)
            <input bind:value={swapSol} oninput={scheduleSwapQuote} inputmode="decimal" placeholder="0.5" />
          </label>
          <div class="ticket-preview">
            <div class="preview-row">
              <span>You receive</span>
              <b>
                {#if swapStatus === "quoting"}…{:else if swapQuote}{swapQuote.outUsdc.toFixed(2)} USDC{:else}—{/if}
              </b>
            </div>
            <div class="preview-row">
              <span>Price impact</span>
              <b>{swapQuote ? `${(swapQuote.priceImpactPct * 100).toFixed(2)}%` : "--"}</b>
            </div>
            <div class="preview-row"><span>Wallet SOL</span><b>{walletBalanceText}</b></div>
          </div>
          {#if swapStatus === "done"}
            <p class="auth-note">Swap submitted. <a class="news-domain" href={`https://solscan.io/tx/${swapSignature}`} target="_blank" rel="noopener noreferrer">View tx</a></p>
          {/if}
          {#if swapStatus === "error" && swapError}
            <p class="auth-note error">{swapError}</p>
          {/if}
          <button
            class="primary wide"
            type="button"
            disabled={!swapQuote || swapStatus === "swapping" || swapStatus === "quoting"}
            onclick={executeSwap}
          >
            {#if swapStatus === "swapping"}<span class="spinner" aria-hidden="true"></span>{/if}
            {swapStatus === "swapping" ? "Swapping…" : swapStatus === "done" ? "Swap again" : "Swap to USDC"}
          </button>
        {:else}
          <p class="auth-lead">Move <b>USDC</b> between your wallet and your <b>Phoenix margin account</b>.</p>
          <div class="ticket-preview">
            <div class="preview-row"><span>Phoenix collateral</span><b>{phoenixTrader?.collateralUsd !== null && phoenixTrader?.collateralUsd !== undefined ? `$${formatNumber(phoenixTrader.collateralUsd, 2)}` : "--"}</b></div>
            <div class="preview-row"><span>Wallet USDC</span><b>{usdcBalanceText}</b></div>
            <div class="preview-row"><span>SOL (gas)</span><b>{walletBalanceText}</b></div>
          </div>

          {#if usdcBalanceValue !== null && usdcBalanceValue < 0.01}
            <!-- Empty wallet: route into the funding flow instead of a dead button. -->
            <div class="funding-guide">
              <p class="auth-lead">
                Your wallet has no USDC yet — fund it first, then deposit to Phoenix.
              </p>
              <div class="ticket-grid-2">
                <button class="account-action accent" type="button" onclick={() => (fundsTab = "receive")}>
                  Receive USDC
                </button>
                {#if (solBalanceValue ?? 0) > 0.015}
                  <button class="account-action accent" type="button" onclick={() => (fundsTab = "convert")}>
                    Convert {formatNumber(solBalanceValue, 2)} SOL
                  </button>
                {:else}
                  <button class="account-action" type="button" onclick={() => (fundsTab = "receive")}>
                    Send SOL for gas
                  </button>
                {/if}
              </div>
            </div>
          {:else if (solBalanceValue ?? 0) < 0.002}
            <div class="funding-guide">
              <p class="auth-lead">
                You have USDC but no <b>SOL for network fees</b> — send a little SOL first.
              </p>
              <button class="account-action accent wide" type="button" onclick={() => (fundsTab = "receive")}>
                Receive SOL
              </button>
            </div>
          {:else}
            <div class="ticket-grid-2">
              <label>
                Deposit (USDC)
                <input bind:value={depositAmount} inputmode="decimal" placeholder="100" />
              </label>
              <label>
                Withdraw (USDC)
                <input bind:value={withdrawAmount} inputmode="decimal" placeholder="50" />
              </label>
            </div>
          {/if}
          {#if collateralSignature}
            <p class="auth-note">Submitted. <a class="news-domain" href={`https://solscan.io/tx/${collateralSignature}`} target="_blank" rel="noopener noreferrer">View tx</a></p>
          {/if}
          {#if collateralError}
            <p class="auth-note error">{collateralError}</p>
          {/if}
          {#if (usdcBalanceValue === null || usdcBalanceValue >= 0.01) && (solBalanceValue ?? 0) >= 0.002}
            <div class="ticket-grid-2">
              <button
                class="primary"
                type="button"
                disabled={collateralBusy || !Number(depositAmount)}
                onclick={() => submitCollateral("deposit")}
              >
                {#if collateralBusy}<span class="spinner" aria-hidden="true"></span>{/if}
                Deposit
              </button>
              <button
                class="account-action"
                type="button"
                disabled={collateralBusy || !Number(withdrawAmount)}
                onclick={() => submitCollateral("withdraw")}
              >
                Withdraw
              </button>
            </div>
            <p class="auth-note">Withdrawals settle through the Phoenix withdraw queue.</p>
          {/if}
        {/if}
      </div>
    </section>
  </div>
{/if}

{#snippet SpotTicketForm()}
  {#if spotAsset}
    <div class="spot-asset-head">
      {#if spotAsset.imageUrl}
        <img class="spot-logo" src={spotAsset.imageUrl} alt="" loading="lazy" />
      {/if}
      <div class="spot-asset-name">
        <strong>{spotAsset.symbol}</strong>
        <small>{spotAsset.name}</small>
      </div>
      <b
        class:positive={(spotAsset.change24hPct ?? 0) >= 0}
        class:negative={(spotAsset.change24hPct ?? 0) < 0}
      >
        {formatPrice(spotAsset.price)}
      </b>
    </div>

    <div class="side-toggle" role="group" aria-label="Spot side">
      <button
        class:active={spotSide === "buy"}
        type="button"
        onclick={() => flipSpotSide("buy")}
      >
        Buy
      </button>
      <button
        class:active={spotSide === "sell"}
        type="button"
        onclick={() => flipSpotSide("sell")}
      >
        Sell
      </button>
    </div>

    <div class="side-toggle" role="group" aria-label="Spot order type">
      <button
        class:active={spotOrderType === "market"}
        type="button"
        onclick={() => (spotOrderType = "market")}
      >
        Market
      </button>
      <button
        class:active={spotOrderType === "limit"}
        type="button"
        onclick={() => (spotOrderType = "limit")}
      >
        Limit
      </button>
    </div>

    <div class="field">
      <label>
        {spotSide === "buy" ? "Spend (USDC)" : `Sell (${spotAsset.symbol})`}
        <input
          bind:value={spotAmount}
          oninput={scheduleSpotQuote}
          inputmode="decimal"
          placeholder={spotSide === "buy" ? "25" : "0.5"}
          use:stepInput={{ kind: spotSide === "buy" ? "usd" : "price" }}
        />
      </label>
      <div class="chip-row" role="group" aria-label="Spot size presets">
        {#each SPOT_CHIP_PCTS as pct (pct)}
          <button
            class="pct-chip"
            type="button"
            disabled={spotChipBalance <= 0}
            onclick={() => setSpotAmountChip(pct)}
          >
            {pct}%
          </button>
        {/each}
        <button
          class="pct-chip"
          type="button"
          disabled={spotChipBalance <= 0}
          onclick={() => setSpotAmountChip("max")}
        >
          Max
        </button>
      </div>
    </div>

    {#if spotOrderType === "limit"}
      <label>
        Limit price (USDC)
        <input
          bind:value={spotLimitPrice}
          inputmode="decimal"
          placeholder={formatPrice(spotAsset.price)}
          use:stepInput={{ kind: "price" }}
        />
      </label>
    {/if}

    <div class="ticket-preview">
      <div class="preview-row">
        <span>You receive</span>
        <b>
          {#if spotOrderType === "limit"}
            {#if Number(spotLimitPrice) > 0 && Number(spotAmount) > 0}
              {spotSide === "buy"
                ? `${formatNumber(Number(spotAmount) / Number(spotLimitPrice), 4)} ${spotAsset.symbol}`
                : `${formatNumber(Number(spotAmount) * Number(spotLimitPrice), 2)} USDC`}
            {:else}—{/if}
          {:else if spotQuoteStatus === "quoting"}…{:else if spotQuote}
            {formatNumber(spotQuote.outUi, spotSide === "buy" ? 4 : 2)}
            {spotSide === "buy" ? spotAsset.symbol : "USDC"}
          {:else}—{/if}
        </b>
      </div>
      <div class="preview-row">
        <span>Price impact</span>
        <b class:negative={spotQuote ? spotQuote.priceImpactPct * 100 > 1 : false}>
          {spotQuote ? `${(spotQuote.priceImpactPct * 100).toFixed(2)}%` : "--"}
        </b>
      </div>
      <div class="preview-row">
        <span>Wallet USDC</span>
        <b>{usdcBalanceText}</b>
      </div>
      <div class="preview-row">
        <span>You hold</span>
        <b>{formatNumber(spotHolding, 4)} {spotAsset.symbol}</b>
      </div>
    </div>

    <div class="ticket-actions">
      <p class="ticket-status" class:error={spotQuoteStatus === "error"}>
        {#if spotQuoteStatus === "error"}
          {spotQuoteError}
        {:else if spotSignature}
          Swap submitted ·
          <a class="news-domain" href={`https://solscan.io/tx/${spotSignature}`} target="_blank" rel="noopener noreferrer">view tx</a>
        {:else}
          &nbsp;
        {/if}
      </p>

      {#if !phoenixAuthority}
        <button class="primary wide" type="button" onclick={openAuthModal}>
          Connect account to trade
        </button>
      {:else if spotOrderType === "limit"}
        <button
          class="primary wide"
          class:armed={spotLimitArmed}
          type="button"
          disabled={!canSubmitSpot || spotLimitBlocked}
          onclick={onSpotLimitSubmitClick}
        >
          {#if spotBusy}<span class="spinner" aria-hidden="true"></span>{/if}
          {spotBusy
            ? "Signing…"
            : spotLimitBlocked
              ? `Price ${formatNumber(Math.abs(spotLimitDeviationPct ?? 0), 1)}% from mark — check decimals`
              : spotLimitArmed
                ? `Confirm limit ${formatNumber(Math.abs(spotLimitDeviationPct ?? 0), 1)}% from mark`
                : `Limit ${spotSide} ${spotAsset.symbol} @ ${spotLimitPrice || "—"}`}
        </button>
      {:else}
        <button
          class="primary wide"
          type="button"
          disabled={!canSubmitSpot}
          onclick={executeSpotSwap}
        >
          {#if spotBusy}<span class="spinner" aria-hidden="true"></span>{/if}
          {spotBusy
            ? "Signing…"
            : `${spotSide === "buy" ? "Buy" : "Sell"} ${spotAsset.symbol} · spot`}
        </button>
      {/if}
    </div>

    {#if triggerOrders.length > 0}
      <div class="venue-section">Open limit orders</div>
      {#each triggerOrders as order (order.orderKey)}
        {@const view = triggerOrderView(order, spotAssets)}
        {#if view}
          <div class="venue-row">
            <span class={view.side === "buy" ? "positive" : "negative"}>
              LIMIT {view.side.toUpperCase()} {view.symbol}
            </span>
            <b>
              {view.notionalUsd !== null ? `$${formatNumber(view.notionalUsd, 2)}` : "--"}
              @ {formatPrice(view.limitPrice)}
            </b>
            <button
              class="row-action"
              type="button"
              disabled={triggerBusy}
              onclick={() => cancelSpotLimitOrder(order.orderKey)}
            >
              Cancel
            </button>
          </div>
        {/if}
      {/each}
    {/if}
  {:else}
    <div class="empty">Loading spot assets…</div>
  {/if}
{/snippet}

{#snippet TicketForm()}
    <div class="side-toggle" role="group" aria-label="Side">
      <button class:active={tradeSide === "buy"} type="button" onclick={() => (tradeSide = "buy")}>Long</button>
      <button class:active={tradeSide === "sell"} type="button" onclick={() => (tradeSide = "sell")}>Short</button>
    </div>

    <div class="ticket-grid-2">
      <div class="field">
        <label>
          <span class="label-row">
            {sizingMode === "usd" ? "Size (USD)" : "Risk (USD)"}
            <button
              class="mode-flip"
              type="button"
              onclick={() => (sizingMode = sizingMode === "usd" ? "risk" : "usd")}
            >{sizingMode === "usd" ? "from stop →" : "← plain size"}</button>
          </span>
          {#if sizingMode === "usd"}
            <input
              bind:this={ticketSizeInput}
              bind:value={tradeAmount}
              inputmode="decimal"
              use:stepInput={{ kind: "usd" }}
              oninput={() => (sizeSource = "manual")}
            />
          {:else}
            <input
              bind:this={ticketSizeInput}
              bind:value={tradeRiskUsd}
              inputmode="decimal"
              placeholder="25"
              use:stepInput={{ kind: "usd" }}
              oninput={() => (sizeSource = "manual")}
            />
          {/if}
        </label>
        {#if sizingMode === "usd"}
          <div class="chip-row" role="group" aria-label="Quick size">
            {#each SIZE_CHIP_PCTS as pct (pct)}
              <button
                class="pct-chip"
                type="button"
                disabled={phoenixCollateral <= 0}
                onclick={() => setSizeChip(pct)}
              >
                {pct}%
              </button>
            {/each}
            <button
              class="pct-chip"
              type="button"
              disabled={phoenixCollateral <= 0}
              onclick={() => setSizeChip("max")}
            >
              Max
            </button>
          </div>
        {:else}
          <div class="chip-row" role="group" aria-label="Quick risk">
            {#each RISK_CHIP_PCTS as pct (pct)}
              <button
                class="pct-chip"
                type="button"
                disabled={accountEquityUsd <= 0}
                onclick={() => setRiskChip(pct)}
              >
                {pct}%
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <label>
        Leverage
        <select bind:value={tradeLeverage}>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={5}>5x</option>
          <option value={10}>10x</option>
          <option value={20}>20x</option>
        </select>
      </label>
      <label>
        Type
        <select bind:value={tradeType}>
          <option value="market">market</option>
          <option value="limit">limit</option>
        </select>
      </label>
      <label class:ticket-field-muted={tradeType !== "limit"}>
        <span class="label-row">
          Limit price
          {#if limitCrossesBook}
            <em class="field-note field-note-amber">crosses book — fills immediately as taker</em>
          {/if}
        </span>
        <input
          bind:value={tradeLimitPrice}
          inputmode="decimal"
          placeholder={formatPrice(latestPrice)}
          disabled={tradeType !== "limit"}
          use:stepInput={{ kind: "price" }}
        />
      </label>
      <div class="field" class:field-error={tpWrongSide}>
        <label>
          <span class="label-row">
            Take profit
            {#if tpWrongSide}
              <em class="field-note">{tradeSide === "buy" ? "above" : "below"} entry</em>
            {/if}
          </span>
          <input
            bind:value={tradeTakeProfit}
            inputmode="decimal"
            placeholder="optional"
            use:stepInput={{ kind: "price" }}
          />
        </label>
        <div class="chip-row" role="group" aria-label="Quick take profit">
          {#each TP_CHIP_PCTS as pct (pct)}
            <button
              class="pct-chip"
              type="button"
              disabled={!triggerRefPrice}
              onclick={() => setTakeProfitPct(pct)}
            >
              {tradeSide === "buy" ? "+" : "-"}{pct}%
            </button>
          {/each}
        </div>
      </div>
      <div
        class="field"
        class:field-error={slWrongSide}
        class:field-wanted={sizingMode === "risk" && !slSet}
      >
        <label>
          <span class="label-row">
            Stop loss
            {#if slWrongSide}
              <em class="field-note">{tradeSide === "buy" ? "below" : "above"} entry</em>
            {:else if sizingMode === "risk" && !slSet}
              <em class="field-note field-note-amber">sets your size</em>
            {/if}
          </span>
          <input
            bind:value={tradeStopLoss}
            inputmode="decimal"
            placeholder={sizingMode === "risk" ? "required" : "optional"}
            use:stepInput={{ kind: "price" }}
          />
        </label>
        <div class="chip-row" role="group" aria-label="Quick stop loss">
          {#each SL_CHIP_PCTS as pct (pct)}
            <button
              class="pct-chip"
              type="button"
              disabled={!triggerRefPrice}
              onclick={() => setStopLossPct(pct)}
            >
              {tradeSide === "buy" ? "-" : "+"}{pct}%
            </button>
          {/each}
        </div>
      </div>
    </div>

    {#if selectedPosition}
      <!-- Only shown against a live position: without it a ticket sell opens
           a second isolated position with fresh margin instead of reducing. -->
      <label class="reduce-only">
        <input type="checkbox" bind:checked={tradeReduceOnly} />
        Reduce only — trade against the open {selectedPosition.size > 0 ? "long" : "short"}, no new margin
      </label>
    {/if}

    <div class="ticket-preview">
      {#if sizingMode === "risk"}
        <div class="preview-row">
          <span>Size from stop</span>
          <b>{riskNotionalUsd !== null ? `$${formatNumber(riskNotionalUsd, 2)}` : "set a stop loss"}</b>
        </div>
      {/if}
      <div class="preview-row"><span>Est. entry</span><b>{formatPrice(tradePreview?.entry)}</b></div>
      <div class="preview-row">
        <span>Slippage</span>
        <b>{tradePreview?.slippageBps != null ? `${formatNumber(tradePreview.slippageBps, 1)} bps` : "--"}</b>
      </div>
      <div class="preview-row"><span>Spread</span><b>{formatNumber(spreadBps, 1)} bps</b></div>
      <div class="preview-row">
        <span>Funding / 8h</span>
        <b class:positive={(fundingPercent ?? 0) >= 0} class:negative={(fundingPercent ?? 0) < 0}>
          {formatPercent(fundingPercent)}
        </b>
      </div>
      <div class="preview-row">
        <span>Est. liquidation</span>
        <b class="negative">{formatPrice(tradePreview?.liqPrice)}</b>
        {#if tradePreview && !tradePreview.fillable}
          <em class="warn ticket-thin-note">thin book</em>
        {/if}
      </div>
      {#if tpPct !== null && !tpWrongSide}
        <div class="preview-row">
          <span>At take profit</span>
          <b class="positive">
            {tpPct >= 0 ? "+" : ""}{formatNumber(tpPct, 1)}%
            {#if tpPnlUsd !== null}· +${formatNumber(Math.abs(tpPnlUsd), 2)}{/if}
          </b>
        </div>
      {/if}
      {#if slPct !== null && !slWrongSide}
        <div class="preview-row">
          <span>At stop loss</span>
          <b class="negative">
            {slPct >= 0 ? "+" : ""}{formatNumber(slPct, 1)}%
            {#if slPnlUsd !== null}· -${formatNumber(Math.abs(slPnlUsd), 2)}{/if}
          </b>
        </div>
      {/if}
      <div class="preview-row">
        <span>Margin required</span>
        <b class:negative={needsPhoenixFunding}>
          ${formatNumber(requiredMarginUsd, 2)}
          {#if phoenixAuthority}· bal ${formatNumber(phoenixCollateral, 2)}{/if}
        </b>
      </div>
    </div>

    {#if tradeOpen || !stackedBook}
      <!-- Compact ladder for tickets that can't see the full book (modal,
           narrow-viewport tabs); the desktop stack has the real one above. -->
      <div class="mini-book" aria-label="Order book preview">
        {#each asks.slice(0, 5).reverse() as level (level.price)}
          <button type="button" class="mini-row ask" onclick={() => prefillFromBook(level.price, "ask")}>
            <span>{formatBookPrice(level.price)}</span>
            <span>{formatNumber(bookLevelNotional(level), 0)}</span>
          </button>
        {/each}
        <div class="mini-spread">
          <span>{formatBookPrice(spread)}</span>
          <em>spread</em>
          <span>{formatNumber(spreadPercent, 3)}%</span>
        </div>
        {#each bids.slice(0, 5) as level (level.price)}
          <button type="button" class="mini-row bid" onclick={() => prefillFromBook(level.price, "bid")}>
            <span>{formatBookPrice(level.price)}</span>
            <span>{formatNumber(bookLevelNotional(level), 0)}</span>
          </button>
        {:else}
          <div class="mini-empty">book warming up</div>
        {/each}
      </div>
    {/if}

    <div class="ticket-actions">
      {#if phoenixAuthority && phoenixTotalCollateral > 0}
        <div
          class="risk-strip"
          class:warn={marginUsedPct > 60}
          class:danger={marginUsedPct > 85 ||
            (selectedLiqDistancePct !== null && selectedLiqDistancePct < 5)}
        >
          <span>EQ ${formatNumber(accountEquityUsd, 2)}</span>
          <span>USED {formatNumber(marginUsedPct, 0)}%</span>
          <span>
            {selectedLiqDistancePct !== null
              ? `LIQ Δ ${formatNumber(selectedLiqDistancePct, 1)}%`
              : "LIQ --"}
          </span>
          <span
            class:positive={accountUpnlUsd >= 0}
            class:negative={accountUpnlUsd < 0}
          >uPNL ${formatNumber(accountUpnlUsd, 2)}</span>
        </div>
      {/if}
      <!-- Single reserved status line: error, live tx stage, tx link, or quiet hint. -->
      <p
        class="ticket-status"
        class:error={Boolean(phoenixActionError)}
        title={phoenixActionErrorDetail || undefined}
      >
        {#if phoenixActionError}
          {phoenixActionError}
          {#if phoenixActionRetry}
            <button class="row-action" type="button" onclick={phoenixActionRetry}>Retry</button>
          {/if}
        {:else if orderStageEntry}
          {txStageText(orderStageEntry, nowMs)}
        {:else if lastTradeSignature}
          Confirmed ·
          <a class="news-domain" href={`https://solscan.io/tx/${lastTradeSignature}`} target="_blank" rel="noopener noreferrer">view tx</a>
        {:else}
          &nbsp;
        {/if}
      </p>

      {#if !phoenixAuthority}
        <button class="primary wide" type="button" onclick={openAuthModal}>
          Connect account to trade
        </button>
      {:else if !phoenixStateKnown}
        <!-- Account state still loading: show the real action, disabled —
             never the "Deposit first" claim before we actually know. -->
        <button class="primary wide" type="button" disabled>
          <span class="spinner" aria-hidden="true"></span>
          {tradeSide === "buy" ? "Long" : "Short"} {selectedSymbol}-PERP · {tradeLeverage}x
        </button>
      {:else if needsPhoenixFunding}
        <button class="primary wide" type="button" onclick={openPhoenixFunding}>
          Deposit first · ${formatNumber(Math.max(0, requiredMarginUsd - phoenixCollateral), 2)}
        </button>
      {:else}
        <!-- Two-stage armed when the limit is far from mark; the reserved
             wide button self-documents each state, no extra layout. -->
        <button
          class="primary wide"
          class:armed={limitArmed}
          type="button"
          disabled={!canSubmitPerp || limitBlocked}
          onclick={onPerpSubmitClick}
        >
          {#if orderBusy}<span class="spinner" aria-hidden="true"></span>{/if}
          {orderBusy
            ? orderStageEntry
              ? txStageText(orderStageEntry, nowMs)
              : "Simulating…"
            : limitBlocked
              ? `Price ${formatNumber(Math.abs(limitDeviationPct ?? 0), 1)}% from mark — check decimals`
              : limitArmed
                ? `Confirm limit ${formatNumber(Math.abs(limitDeviationPct ?? 0), 1)}% from mark`
                : sizingMode === "risk" && !slSet
                  ? "Set a stop loss to size"
                  : !tradePreview
                    ? "Enter a size"
                    : `${tradeSide === "buy" ? "Long" : "Short"} ${selectedSymbol}-PERP · ${tradeLeverage}x`}
        </button>
      {/if}
    </div>
{/snippet}

{#snippet BookLadder()}
  <div class="book book-ladder">
    <div class="book-header">
      <span>Price USDC</span>
      <span>Size USDC</span>
      <span>Total USDC</span>
    </div>

    {#each visibleAskLevels as ask}
      <button type="button" class="book-row ask" onclick={() => prefillFromBook(ask.price, "ask")}>
        <span class="depth-bar" style={`width: ${depthWidth(ask, bookMaxNotional)}%;`}></span>
        <span class="book-price">{formatBookPrice(ask.price)}</span>
        <span>{formatNumber(bookLevelNotional(ask), 0)}</span>
        <span>{formatNumber(bookLevelTotalNotional(ask), 0)}</span>
      </button>
    {/each}

    <div class="spread-row">
      <span>{formatBookPrice(spread)}</span>
      <strong>Spread</strong>
      <span>{formatNumber(spreadPercent, 3)}%</span>
    </div>

    {#each visibleBidLevels as bid}
      <button type="button" class="book-row bid" onclick={() => prefillFromBook(bid.price, "bid")}>
        <span class="depth-bar" style={`width: ${depthWidth(bid, bookMaxNotional)}%;`}></span>
        <span class="book-price">{formatBookPrice(bid.price)}</span>
        <span>{formatNumber(bookLevelNotional(bid), 0)}</span>
        <span>{formatNumber(bookLevelTotalNotional(bid), 0)}</span>
      </button>
    {:else}
      <div class="empty">No live order book levels loaded.</div>
    {/each}
  </div>
{/snippet}

{#snippet TapeFeed()}
  <!-- Time & sales: the prints are the heartbeat. -->
  <div class="tape" aria-label="Time and sales">
    <div class="tape-header"><span>Time</span><span>Price</span><span>Size</span></div>
    {#each trades.slice(0, 18) as tick (tick.seq)}
      <div class="tape-row" class:bid={tick.side === "buy"} class:ask={tick.side === "sell"}>
        <span>{new Date(tick.ts).toISOString().slice(11, 19)}</span>
        <span>{formatBookPrice(tick.price)}</span>
        <span>{formatNumber(tick.size * tick.price, 0)}</span>
      </div>
    {:else}
      <div class="empty">No prints yet.</div>
    {/each}
  </div>
{/snippet}

{#snippet TickerStat(
  label: string,
  value: string,
  width: string,
  loading: boolean,
  valueClass = "",
)}
  <div class="tk-stat" style={`min-width:${width}`}>
    <span>{label}</span>
    {#if loading}
      <span class="skeleton skel-val" aria-hidden="true"></span>
    {:else}
      <b class={valueClass}>{value}</b>
    {/if}
  </div>
{/snippet}

<style>
  .terminal-shell {
    min-height: 100vh;
    background:
      linear-gradient(180deg, rgba(255, 77, 151, 0.04), transparent 28rem),
      var(--paper);
    color: var(--ink);
  }

  .skip-link {
    position: absolute;
    left: -999px;
  }

  .skip-link:focus {
    left: 1rem;
    top: 1rem;
    z-index: 100;
    background: var(--surface);
    border: 1px solid var(--line);
    padding: 0.5rem 0.75rem;
  }

  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem clamp(0.75rem, 2vw, 1.5rem);
    border-bottom: 1px solid var(--line);
    background: rgba(8, 10, 13, 0.9);
    backdrop-filter: blur(16px);
  }

  .brand {
    display: flex;
    gap: 0.55rem;
    align-items: center;
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .brand .brand-mark {
    display: flex;
    width: 1.05rem;
    height: 1.05rem;
    color: var(--ink);
  }

  .brand strong {
    color: var(--muted);
    font-weight: 500;
  }

  .topbar-actions,
  .chart-toolbar,
  .timeframe-tabs,
  .chart-market-tools,
  .price-mode-toggle,
  .chart-footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .topbar-actions {
    justify-content: flex-end;
    align-items: center;
    min-width: 0;
    min-height: 2.3rem;
    flex-wrap: wrap;
  }

  .chart-toolbar button,
  .chart-tools button,
  .chart-footer button,
  .book-row {
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--ink);
    min-height: 2rem;
    padding: 0.35rem 0.65rem;
    transition:
      border-color 160ms ease,
      background 160ms ease,
      transform 160ms ease;
  }

  .chart-toolbar button:hover,
  .chart-tools button:hover,
  .chart-footer button:hover,
  .book-row:hover {
    transform: translateY(-1px);
    border-color: rgba(255, 77, 151, 0.55);
  }

  .terminal-notice {
    padding: 0.6rem clamp(0.75rem, 2vw, 1.25rem);
    border-bottom: 1px solid var(--line-soft);
    background: rgba(8, 10, 13, 0.86);
  }

  /* ── Privy auth: topbar + account menu ───────────────────────────── */
  .connect-status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.74rem;
    color: var(--muted);
    white-space: nowrap;
  }

  .connect-status.error {
    color: var(--red);
  }

  .connect-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-width: 11rem;
    font-weight: 700;
  }

  .skel-price {
    width: 8.5rem;
    height: 1rem;
    align-self: center;
  }

  .skel-val {
    width: 2.6rem;
    height: 0.78rem;
    margin-top: 0.18rem;
  }

  .account-menu {
    position: relative;
  }

  .account-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--ink);
    min-height: 2.2rem;
    padding: 0.3rem 0.6rem;
    transition: border-color 160ms ease, background 160ms ease;
  }

  .account-trigger:hover {
    border-color: rgba(255, 77, 151, 0.5);
  }

  .account-trigger-text {
    display: grid;
    text-align: left;
    line-height: 1.15;
    min-width: 0;
  }

  .account-trigger-text small {
    color: var(--muted);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 13rem;
  }

  .account-trigger-text strong {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .account-caret {
    width: 0.4rem;
    height: 0.4rem;
    border-right: 2px solid var(--muted);
    border-bottom: 2px solid var(--muted);
    transform: translateY(-0.1rem) rotate(45deg);
    transition: transform 160ms ease;
  }

  .account-caret.open {
    transform: translateY(0.05rem) rotate(-135deg);
  }

  .account-dropdown {
    position: absolute;
    top: calc(100% + 0.45rem);
    right: 0;
    z-index: 40;
    width: min(20rem, calc(100vw - 1.5rem));
    display: grid;
    gap: 0.5rem;
    padding: 0.7rem;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface);
    box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.5);
  }

  .account-dropdown-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding-bottom: 0.55rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .account-identity {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .account-identity small {
    color: var(--faint);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .account-identity strong {
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* .wallet-badge lives in terminal.css — the account menu here and the
     AuthModal component both render it. */

  .account-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    border: 1px solid var(--line-soft);
    border-radius: 0;
    background: rgba(255, 255, 255, 0.02);
    padding: 0.45rem 0.55rem;
    text-align: left;
  }

  button.account-row {
    color: var(--ink);
  }

  button.account-row.copyable:hover:not(:disabled) {
    border-color: rgba(255, 77, 151, 0.45);
    background: rgba(255, 77, 151, 0.06);
  }

  .account-row-label {
    color: var(--muted);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .account-row-value {
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Wallet/phoenix split under the combined Funds figure. */
  .funds-split {
    display: block;
    color: var(--faint);
    font-size: 0.64rem;
  }

  .copy-hint {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .copy-hint.done {
    color: var(--accent);
  }

  /* Two-stage flatten in the PERP_DESK head: reserved width so the
     FLATTEN ↔ Confirm flatten relabel never shifts the layout. */
  .flatten-btn {
    min-width: 7.5rem;
    letter-spacing: 0.05em;
  }

  .flatten-btn.armed {
    color: var(--down);
    border-color: rgba(255, 90, 106, 0.6);
  }

  .account-dropdown-note {
    margin: 0;
    font-size: 0.72rem;
  }

  .account-dropdown-note.warn {
    color: var(--amber);
  }

  .account-action {
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--ink);
    min-height: 2.1rem;
    font-weight: 700;
  }

  .account-action.danger {
    color: var(--red);
    border-color: rgba(240, 107, 99, 0.35);
  }

  .account-action.danger:hover:not(:disabled) {
    background: rgba(240, 107, 99, 0.1);
    border-color: rgba(240, 107, 99, 0.6);
  }

  .account-action.accent {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: rgba(255, 77, 151, 0.4);
  }

  .account-action.accent:hover:not(:disabled) {
    background: rgba(255, 77, 151, 0.2);
  }

  /* ── Add-funds modal ──────────────────────────────────────────────── */
  /* .side-toggle.funds-tabs / .funds-tabs-3 live in terminal.css (cascade-
     order-sensitive vs the .side-toggle first/last active rules there). */
  .funding-guide {
    display: grid;
    gap: 0.6rem;
    border: 1px dashed var(--line);
    border-radius: 0;
    padding: 0.75rem;
  }

  .funding-guide .auth-lead {
    margin: 0;
  }

  /* ── Phoenix venue (account strip + position/order rows) ─────────── */
  .venue-strip {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr auto;
    gap: 0.5rem;
    align-items: center;
    margin: 0 0.65rem 0.4rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0;
    background: rgba(255, 255, 255, 0.02);
  }

  .venue-strip span {
    display: block;
    color: var(--faint);
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .venue-strip b {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.8rem;
  }

  /* Day P&L sparkline rides the stat value line (svg lives in Spark.svelte). */
  .venue-strip :global(.spark) {
    vertical-align: -0.25rem;
  }

  .venue-note {
    margin: 0 0.75rem 0.4rem;
  }

  /* ── Position cards ──────────────────────────────────────────────── */
  .pos-card {
    display: grid;
    gap: 0.3rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .pos-card-top {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .pos-side {
    font-family: ui-monospace, monospace;
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    border: 1px solid currentcolor;
    padding: 0.05rem 0.3rem;
  }

  .pos-symbol {
    border: 0;
    background: transparent;
    color: var(--ink);
    font-weight: 800;
    font-size: 0.85rem;
    padding: 0;
    cursor: pointer;
  }

  .pos-symbol:hover {
    color: var(--accent);
  }

  .pos-card-top b {
    font-size: 0.76rem;
    color: var(--muted);
    font-weight: 500;
  }

  .pos-card-top em {
    margin-left: auto;
    font-style: normal;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .pos-card-mid {
    display: flex;
    gap: 0.9rem;
    font-size: 0.68rem;
    color: var(--muted);
    flex-wrap: wrap;
  }

  /* Optimistic row while the indexer catches up — visibly interim. */
  .pos-pending {
    color: var(--faint);
  }

  .pos-symbol-static {
    color: var(--muted);
    font-weight: 800;
    font-size: 0.85rem;
  }

  .pos-card-bottom {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Partial-close chips: fixed-size, never fight the liq bar for width. */
  .pos-card-bottom .pct-chip {
    flex: 0 0 auto;
    min-width: 2.2rem;
  }

  /* Inline margin top-up editor under the liq bar. */
  .margin-add {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.68rem;
  }

  .margin-add input {
    width: 6rem;
    min-height: 1.6rem;
    padding: 0.15rem 0.4rem;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--ink);
    font: inherit;
  }

  .margin-add-note {
    color: var(--faint);
    font-size: 0.62rem;
  }

  .liq-bar {
    position: relative;
    flex: 1;
    height: 1.05rem;
    border: 1px solid var(--line-soft);
    overflow: hidden;
  }

  .liq-bar i {
    position: absolute;
    inset: 0 auto 0 0;
    background: rgba(44, 233, 127, 0.14);
  }

  .liq-bar.warn i {
    background: rgba(255, 180, 84, 0.18);
  }

  .liq-bar.danger i {
    background: rgba(255, 90, 106, 0.22);
  }

  .liq-bar span {
    position: relative;
    display: block;
    padding: 0.08rem 0.4rem;
    font-size: 0.62rem;
    color: var(--muted);
  }

  .liq-bar.warn span { color: var(--amber); }
  .liq-bar.danger span { color: var(--down); }

  .liq-none {
    flex: 1;
    font-size: 0.62rem;
    color: var(--faint);
  }

  .pos-total {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.4rem 0.75rem;
    font-size: 0.68rem;
    color: var(--muted);
    border-bottom: 1px solid var(--line-soft);
  }

  /* ── Chart overlay position badge ────────────────────────────────── */
  .pos-badge {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.66rem;
    letter-spacing: 0.02em;
  }

  /* ── Chart footer line toggles ───────────────────────────────────── */
  .line-toggle-group {
    display: inline-flex;
    gap: 0.15rem;
    margin-left: 0.6rem;
    padding-left: 0.6rem;
    border-left: 1px solid var(--line-soft);
  }

  .chart-footer .line-toggle {
    font-size: 0.6rem;
    letter-spacing: 0.04em;
    min-height: 1.6rem;
    padding-inline: 0.35rem;
  }

  .funds-qr {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 0;
    background: rgba(255, 255, 255, 0.02);
  }

  .funds-qr :global(svg) {
    width: 9.5rem;
    height: 9.5rem;
  }

  .funds-address {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .funds-address .account-row-value {
    text-align: left;
    white-space: normal;
    overflow-wrap: anywhere;
    font-size: 0.72rem;
  }

  .dashboard {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: clamp(0.6rem, 1vw, 0.9rem);
    padding: clamp(0.75rem, 1.4vw, 1.15rem);
  }

  .chart-panel {
    /* Bloomberg posture: the chart + ticket row IS the first screen. Fill
       the viewport below the fixed chrome (topbar + ticker rail + news
       strip + dashboard padding ≈ 11.5rem); secondary panels start cleanly
       below the fold. Floor keeps laptops usable, ceiling keeps ultra-tall
       monitors from stretching candles into noodles. */
    --market-panel-height: clamp(30rem, calc(100dvh - 13.4rem), 72rem);
    grid-column: span 9;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: var(--market-panel-height);
  }

  .orderbook-panel {
    grid-column: span 3;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    height: var(--market-panel-height, clamp(30rem, calc(100dvh - 13.4rem), 72rem));
  }

  .perp-panel {
    grid-column: span 4;
  }

  .macro-panel,
  .watchlist-panel {
    grid-column: span 4;
  }

  .monitor-panel {
    grid-column: span 4;
    display: flex;
    flex-direction: column;
    max-height: 26rem;
  }

  /* Base select/input/label element rules live in terminal.css — scoped
     copies here would stop matching the same elements rendered inside
     extracted components (AuthModal & co). */

  /* Panel-header dialect on ticket labels; inputs keep body sizing. */
  .panel-ticket label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.62rem;
  }

  .panel-ticket label input,
  .panel-ticket label select {
    text-transform: none;
    letter-spacing: normal;
    font-size: 0.85rem;
  }

  .bid {
    color: #8decc3;
  }

  .chart-toolbar {
    min-height: 3.25rem;
    flex-wrap: nowrap;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.55rem 0.65rem;
    border-bottom: 1px solid var(--line-soft);
    background: rgba(18, 20, 25, 0.96);
    overflow-x: auto;
  }

  .timeframe-tabs {
    gap: 0.2rem;
  }

  .timeframe-tabs button,
  .price-mode-toggle button,
  .chart-footer button {
    min-height: 2rem;
    color: var(--muted);
    background: transparent;
    border-color: transparent;
  }

  .timeframe-tabs button.active,
  .price-mode-toggle button.active,
  .chart-footer button.active {
    color: var(--accent);
    background: rgba(255, 77, 151, 0.1);
    border-color: rgba(255, 77, 151, 0.7);
  }

  .chart-market-tools {
    flex: 1;
    justify-content: center;
    min-width: 0;
  }

  .market-select {
    min-width: 12rem;
    max-width: 18rem;
  }

  /* Palette opener styled like the select it replaced, plus the "/" hint. */
  button.market-select {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    min-height: 2rem;
    padding: 0.3rem 0.45rem 0.3rem 0.6rem;
    cursor: pointer;
    text-align: left;
    font-size: 0.82rem;
  }

  button.market-select:hover {
    border-color: var(--muted);
  }

  .market-open-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .market-open-hint {
    flex: 0 0 auto;
    font-family: ui-monospace, monospace;
    font-size: 0.66rem;
    color: var(--faint);
    border: 1px solid var(--line);
    padding: 0 0.3rem;
  }

  /* Ticker symbol doubles as a palette opener. */
  .ticker-market {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    cursor: pointer;
    font: inherit;
  }

  .ticker-caret {
    color: var(--faint);
    font-size: 0.7rem;
  }

  .ticker-market:hover .ticker-caret {
    color: var(--ink);
  }

  .price-mode-toggle {
    gap: 0;
    border: 1px solid var(--line);
    border-radius: 0;
    padding: 0.15rem;
    background: var(--paper);
  }

  .chart-workspace {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 3.25rem minmax(0, 1fr);
    overflow: hidden;
  }

  .chart-tools {
    display: grid;
    align-content: start;
    gap: 0.42rem;
    padding: 0.75rem 0.5rem;
    border-right: 1px solid var(--line-soft);
    background: rgba(14, 15, 19, 0.86);
  }

  .chart-tools button {
    min-height: 2.05rem;
    padding: 0;
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.62rem;
    overflow: hidden;
  }

  .chart-canvas-shell {
    position: relative;
    min-height: 0;
    background: var(--chart-bg);
    overflow: hidden;
  }

  .chart-overlay {
    position: absolute;
    z-index: 2;
    top: 0.6rem;
    left: 0.6rem;
    display: inline-flex;
    flex-direction: column;
    gap: 0.15rem;
    max-width: calc(100% - 6rem);
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0;
    background: rgba(10, 13, 17, 0.66);
    backdrop-filter: blur(7px);
    color: var(--muted);
    pointer-events: none;
  }

  .chart-symbol-line,
  .chart-legend {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem 0.7rem;
    min-height: 1.2rem;
  }

  .chart-symbol-line strong {
    color: var(--ink);
    font-size: 0.84rem;
    font-weight: 700;
  }

  .chart-tf {
    text-transform: uppercase;
    color: var(--muted);
    font-size: 0.66rem;
    letter-spacing: 0.04em;
  }

  .chart-health {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    text-transform: uppercase;
    font-size: 0.6rem;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  .chart-symbol-line small {
    color: var(--faint);
    font-size: 0.66rem;
  }

  .chart-legend {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.76rem;
    font-variant-numeric: tabular-nums;
  }

  .chart-legend span {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
  }

  .chart-legend i {
    color: var(--faint);
    font-style: normal;
    font-size: 0.62rem;
    text-transform: uppercase;
  }

  .chart-legend b {
    color: var(--ink);
    font-weight: 600;
  }

  .chart-legend em {
    font-style: normal;
    font-weight: 700;
  }

  .chart-canvas {
    position: absolute;
    inset: 0;
  }

  .chart-empty {
    position: absolute;
    z-index: 3;
    inset: 45% auto auto 4rem;
  }

  .chart-footer {
    position: relative;
    z-index: 5;
    min-height: 2.55rem;
    justify-content: flex-end;
    gap: 0.65rem;
    padding: 0.4rem 0.65rem;
    border-top: 1px solid var(--line-soft);
    color: var(--muted);
    background: rgba(18, 20, 25, 0.96);
  }

  .chart-footer strong {
    margin-left: auto;
    color: var(--muted);
    font-weight: 500;
  }

  .book,
  .table,
  .markets-list {
    display: grid;
    gap: 0.15rem;
    padding: 0.65rem;
  }

  .book-row,
  .table-row,
  .markets-list button {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr) 4.25rem 4rem;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    min-height: 1.8rem;
    font-size: 0.75rem;
    text-align: left;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .markets-list {
    max-height: 16rem;
    overflow: auto;
  }

  .markets-list button {
    grid-template-columns: 4.5rem minmax(0, 1fr) auto;
    border: 0;
    border-bottom: 1px solid var(--line-soft);
    background: transparent;
    padding: 0.42rem 0.45rem;
    color: var(--muted);
  }

  .markets-list button:hover,
  .markets-list button.selected-market {
    color: var(--ink);
    background: rgba(255, 77, 151, 0.08);
  }

  .markets-list b {
    color: var(--ink);
  }

  /* Right-rail tabs: Order Book | Trade (underline indicator). */
  .book-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    min-height: 2.55rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .book-tabs button {
    position: relative;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 0.74rem;
    font-weight: 700;
    transition: color 140ms ease;
  }

  .book-tabs button:hover {
    color: var(--ink);
  }

  .book-tabs button.active {
    color: var(--ink);
  }

  .book-tabs button.active::after {
    position: absolute;
    right: 22%;
    bottom: -1px;
    left: 22%;
    height: 2px;
    border-radius: 0;
    background: var(--accent);
    content: "";
  }

  .panel-ticket {
    display: grid;
    /* Tight vertical budget: the whole ticket should fit without scrolling
       at typical heights; the submit action is pinned regardless. */
    gap: 0.5rem;
    padding: 0.6rem 0.65rem 0;
    min-height: 0;
    overflow-y: auto;
  }

  /* Desktop stack: ladder on top, ticket pinned below — both always live.
     The TICKET is the priority element: it keeps a floor tall enough that
     side/size/TP-SL never hide behind the ladder; the ladder takes what's
     left and scrolls its own depth on cramped heights. Floors sum < 90%,
     so the pair never overflows the panel. */
  .book-stack {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-height: min(12rem, 30%);
  }

  .book-stack .tape {
    flex: 1;
    max-height: none;
  }

  .orderbook-panel .panel-ticket.stacked {
    flex: 0 1 auto;
    min-height: min(26rem, 56%);
    border-top: 1px solid var(--line-soft);
  }

  /* The primary action never requires scrolling: status + submit stick to
     the bottom of the ticket scroller on an opaque footer. */
  .ticket-actions {
    position: sticky;
    bottom: 0;
    display: grid;
    gap: 0.45rem;
    margin: 0 -0.65rem;
    padding: 0.35rem 0.65rem 0.6rem;
    background: var(--surface);
    border-top: 1px solid var(--line-soft);
  }

  /* ── Spot venue ───────────────────────────────────────────────────── */
  /* Venue switch: the selection thumb physically slides to the chosen
     venue (state indication), 160ms transform-only, interruptible
     mid-flight. Equal grid halves keep the thumb math exact. */
  .venue-toggle {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .venue-toggle::before {
    content: "";
    position: absolute;
    inset: 0.15rem auto 0.15rem 0.15rem;
    width: calc(50% - 0.15rem);
    background: var(--accent-soft);
    border: 1px solid rgba(255, 77, 151, 0.7);
    transition: transform 160ms cubic-bezier(0.77, 0, 0.175, 1);
  }
  .venue-toggle.spot::before {
    transform: translateX(100%);
  }
  .venue-toggle button {
    position: relative;
    z-index: 1;
    transition: color 140ms ease;
  }
  .venue-toggle button.active {
    color: var(--accent);
    background: transparent;
    border-color: transparent;
  }

  /* Venue swap: replaced controls (market select, price-mode block, chart
     labels) fade in fast; exits are instant. Entry-only keeps the swap
     snappy — no overlap, no layout shift. The chart canvas itself is never
     dimmed: price visibility is continuous. */
  .market-select,
  .price-mode-toggle,
  .chart-symbol-line > *,
  .chart-empty {
    transition:
      opacity 140ms cubic-bezier(0.23, 1, 0.32, 1),
      transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
    @starting-style {
      opacity: 0;
      transform: translateY(2px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .venue-toggle::before {
      transition-duration: 0ms;
    }
    /* Reduced motion, not zero: keep the opacity fade, drop the movement. */
    .market-select,
    .price-mode-toggle,
    .chart-symbol-line > *,
    .chart-empty {
      transition-property: opacity;
    }
  }

  .spot-venue-tag {
    padding: 0.3rem 0.6rem;
    color: var(--muted);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  /* Padding comes from the shared .empty (terminal.css); the old local
     padding was dead (lost the cascade) — only line-height is live. */
  .spot-book-note {
    line-height: 1.5;
  }

  .spot-asset-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.55rem;
    padding: 0.2rem 0.1rem;
  }

  .spot-logo {
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    background: var(--surface-2);
    object-fit: cover;
  }

  .spot-logo-blank {
    display: inline-block;
  }

  .spot-asset-name {
    display: grid;
    line-height: 1.15;
    min-width: 0;
  }

  .spot-asset-name strong {
    font-size: 0.88rem;
  }

  .spot-asset-name small {
    color: var(--muted);
    font-size: 0.66rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spot-asset-head > b {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .spot-search {
    padding: 0.5rem 0.65rem 0.1rem;
  }

  .spot-search input {
    min-height: 1.9rem;
    font-size: 0.76rem;
  }

  .spot-list button {
    grid-template-columns: auto 3.6rem minmax(0, 1fr) auto auto;
  }

  .spot-list .spot-logo {
    width: 1.1rem;
    height: 1.1rem;
  }

  .spot-row-sym {
    font-weight: 800;
  }

  .spot-held {
    color: var(--accent);
    font-size: 0.5rem;
  }


  .orderbook-controls {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.55rem;
    min-height: 2.05rem;
    padding: 0.3rem 0.58rem 0.18rem;
  }

  .lot-select {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: 700 0.68rem ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .lot-select .chevron {
    width: 0.34rem;
    height: 0.34rem;
    border-right: 2px solid #9ca9bd;
    border-bottom: 2px solid #9ca9bd;
    transform: translateY(-0.1rem) rotate(45deg);
  }

  .orderbook-controls strong {
    justify-self: end;
    font-size: 0.72rem;
  }

  .book-icons {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .book-icon {
    position: relative;
    width: 1.1rem;
    height: 1.1rem;
    border: 0;
    background: transparent;
    color: #9ca9bd;
  }

  .split-icon span {
    position: absolute;
    left: 0.15rem;
    width: 0.64rem;
    height: 2px;
    border-radius: 0;
    background: currentColor;
  }

  .split-icon span:nth-child(1) {
    top: 0.2rem;
    transform: rotate(35deg);
  }

  .split-icon span:nth-child(2) {
    top: 0.5rem;
    left: 0.34rem;
  }

  .split-icon span:nth-child(3) {
    top: 0.82rem;
    transform: rotate(-35deg);
  }

  .depth-icon span {
    position: absolute;
    right: 0.1rem;
    height: 2px;
    border-radius: 0;
    background: currentColor;
  }

  .depth-icon span::before {
    position: absolute;
    top: -0.14rem;
    left: -0.28rem;
    width: 0.2rem;
    height: 0.2rem;
    border-radius: 50%;
    background: currentColor;
    content: "";
  }

  .depth-icon span:nth-child(1) {
    top: 0.24rem;
    width: 0.44rem;
  }

  .depth-icon span:nth-child(2) {
    top: 0.52rem;
    width: 0.66rem;
  }

  .depth-icon span:nth-child(3) {
    top: 0.82rem;
    width: 0.5rem;
  }

  .orderbook-panel .book {
    min-height: 0;
    overflow: auto;
  }

  .orderbook-panel .book-ladder {
    flex: 1;
    align-content: start;
    gap: 0.06rem;
    padding: 0.28rem 0.46rem 0.42rem;
  }

  .book-header,
  .book-ladder .book-row,
  .spread-row {
    display: grid;
    grid-template-columns: minmax(4.1rem, 1fr) minmax(4.1rem, 1fr) minmax(4.1rem, 1fr);
    align-items: center;
    gap: 0.32rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .book-header {
    min-height: 1.18rem;
    color: #9ca9bd;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    font-size: 0.64rem;
    line-height: 1;
  }

  .book-header span:nth-child(2),
  .book-header span:nth-child(3),
  .book-ladder .book-row span:nth-child(3),
  .book-ladder .book-row span:nth-child(4),
  .spread-row span:last-child {
    text-align: right;
  }

  .book-ladder .book-row {
    position: relative;
    min-height: 1.08rem;
    overflow: hidden;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    padding: 0 0.3rem;
    font-size: 0.64rem;
    line-height: 1;
  }

  .book-ladder .book-row:hover {
    border-color: transparent;
    background: rgba(255, 255, 255, 0.035);
    transform: none;
  }

  .book-ladder .book-row span:not(.depth-bar) {
    position: relative;
    z-index: 1;
  }

  .book-ladder .book-price {
    font-weight: 800;
  }

  .book-ladder .book-row.ask .book-price {
    color: var(--down);
  }

  .book-ladder .book-row.bid .book-price {
    color: var(--up);
  }

  .depth-bar {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 0;
    z-index: 0;
    border-radius: 0;
    pointer-events: none;
  }

  .book-ladder .book-row.ask .depth-bar {
    background: rgba(255, 90, 106, 0.24);
  }

  .book-ladder .book-row.bid .depth-bar {
    background: rgba(44, 233, 127, 0.22);
  }

  .spread-row {
    min-height: 1.28rem;
    margin: 0.1rem 0;
    background: rgba(255, 255, 255, 0.05);
    color: var(--ink);
    padding: 0 0.3rem;
    font-size: 0.64rem;
    line-height: 1;
  }

  .spread-row strong {
    text-align: center;
  }

  .table-row {
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    padding: 0.5rem 0.5rem;
    border-bottom: 1px solid var(--line-soft);
    color: var(--muted);
  }

  .table-row b {
    color: var(--ink);
  }

  .warn {
    color: var(--amber);
  }

  /* Market-palette styles live in components/CommandPalette.svelte. */

  /* Reserved single-line status (error / tx link / blank). */
  .ticket-status {
    margin: 0;
    min-height: 1.2rem;
    font-size: 0.74rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ticket-status.error {
    color: var(--red);
  }

  .ticket-thin-note {
    margin-left: 0.4rem;
    font-style: normal;
    font-size: 0.62rem;
    text-transform: uppercase;
  }

  .ticket-field-muted {
    opacity: 0.45;
    transition: opacity 160ms ease;
  }

  /* Auth-modal styles live in components/AuthModal.svelte; the shared
     bits (.wide, .auth-lead, .wallet-badge) moved to terminal.css. */

  .market-rail {
    /* Sticky on every width: prices/funding stay in view while scrolling.
       Desktop pins below the sticky topbar (measured height via the inline
       var); the sub-1100px override returns it to the viewport top where
       the topbar goes static. */
    position: sticky;
    top: var(--rail-top, 0px);
    z-index: 15;
    background: rgba(8, 10, 13, 0.92);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--line-soft);
  }

  .ticker {
    display: flex;
    align-items: center;
    gap: clamp(0.6rem, 2vw, 1.4rem);
    padding: 0.5rem clamp(0.75rem, 2vw, 1.25rem);
    overflow-x: auto;
    scrollbar-width: thin;
    white-space: nowrap;
  }

  .ticker-symbol {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    flex: 0 0 auto;
  }

  .ticker-symbol strong {
    font-size: 0.9rem;
    font-weight: 800;
    letter-spacing: 0.01em;
  }

  .ticker-health {
    display: inline-block;
    min-width: 4.7rem;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .stream-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--faint);
    box-shadow: 0 0 0 0 rgba(255, 77, 151, 0.5);
  }

  .stream-dot.live {
    background: var(--up);
    animation: pulse 2s ease-out infinite;
  }

  .stream-dot.connecting {
    background: var(--amber);
  }

  .stream-dot.stale {
    background: var(--amber);
  }

  .stream-dot.offline {
    background: var(--red);
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(44, 233, 127, 0.45);
    }
    70% {
      box-shadow: 0 0 0 0.4rem rgba(44, 233, 127, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(44, 233, 127, 0);
    }
  }

  .ticker-price {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    flex: 0 0 auto;
    min-width: 11rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .ticker-price b {
    font-size: 1.05rem;
    font-weight: 800;
  }

  .ticker-price em {
    font-size: 0.78rem;
    font-style: normal;
    font-weight: 600;
  }

  .ticker-stats {
    display: inline-flex;
    align-items: center;
    gap: clamp(0.6rem, 1.8vw, 1.35rem);
    flex: 1 1 auto;
    min-width: 0;
  }

  .ticker-stats div {
    display: inline-flex;
    flex-direction: column;
    gap: 0.05rem;
    line-height: 1.1;
  }

  .ticker-stats span {
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--faint);
  }

  .ticker-stats b {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ink);
  }

  .section-nav {
    display: none;
    gap: 0.35rem;
    padding: 0.4rem clamp(0.75rem, 2vw, 1.25rem);
    overflow-x: auto;
    scrollbar-width: none;
    border-top: 1px solid var(--line-soft);
  }

  .section-nav::-webkit-scrollbar {
    display: none;
  }

  .section-nav button {
    flex: 0 0 auto;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.74rem;
    font-weight: 600;
    min-height: 2rem;
    padding: 0.3rem 0.85rem;
  }

  .section-nav button.active {
    color: #04130d;
    background: var(--accent);
    border-color: var(--accent);
  }

  /* The :focus-visible outline lives in terminal.css so it also reaches
     controls rendered inside extracted components. */

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
    }
  }

  /* ── Macro chips + tone palette (panel body lives in MacroPanel.svelte;
     the badge/chip/tones stay: spot panel + account dropdown use them) ── */
  .verdict-badge {
    flex: 0 0 auto;
    border-radius: 0;
    padding: 0.2rem 0.55rem;
    font-size: 0.62rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .macro-chip {
    justify-self: end;
    border-radius: 0;
    padding: 0.1rem 0.5rem;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border: 1px solid transparent;
  }

  /* Tone palette shared by badge / chip (sparkline strokes live in Spark.svelte) */
  .up {
    color: #8decc3;
    stroke: var(--up);
  }

  .down {
    color: var(--red);
    stroke: var(--red);
  }

  .warn {
    color: var(--amber);
    stroke: var(--amber);
  }

  .macro-chip.up {
    color: var(--up);
    background: var(--up-soft);
    border-color: rgba(44, 233, 127, 0.35);
  }

  .macro-chip.down {
    color: var(--red);
    background: rgba(240, 107, 99, 0.12);
    border-color: rgba(240, 107, 99, 0.35);
  }

  .macro-chip.warn {
    color: var(--amber);
    background: rgba(228, 173, 79, 0.12);
    border-color: rgba(228, 173, 79, 0.35);
  }

  .verdict-badge.flat,
  .macro-chip.flat {
    color: var(--muted);
    background: var(--surface-2);
    border-color: var(--line);
  }

  /* ── Ambient risk strip ──────────────────────────────────────────── */
  .risk-strip {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.25rem 0.45rem;
    border: 1px solid var(--line-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.64rem;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.02);
  }

  .risk-strip.warn {
    border-color: rgba(255, 180, 84, 0.5);
    color: var(--amber);
  }

  .risk-strip.danger {
    border-color: rgba(255, 90, 106, 0.6);
    color: var(--down);
  }

  /* ── Mini book inside the ticket ─────────────────────────────────── */
  .mini-book {
    border: 1px solid var(--line-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.7rem;
  }

  .mini-row {
    display: flex;
    justify-content: space-between;
    width: 100%;
    border: 0;
    background: transparent;
    padding: 0.14rem 0.5rem;
    cursor: pointer;
    font: inherit;
  }

  .mini-row.ask { color: var(--down); }
  .mini-row.bid { color: var(--up); }
  .mini-row:hover { background: rgba(255, 255, 255, 0.04); }
  .mini-row span:last-child { color: var(--muted); }

  .mini-spread {
    display: flex;
    justify-content: space-between;
    padding: 0.14rem 0.5rem;
    border-block: 1px solid var(--line-soft);
    color: var(--muted);
  }

  .mini-spread em { font-style: normal; color: var(--faint); }
  .mini-empty { padding: 0.4rem 0.5rem; color: var(--faint); }

  /* ── Time & sales ────────────────────────────────────────────────── */
  .tape {
    border-top: 1px solid var(--line-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.68rem;
    overflow-y: auto;
    max-height: 12rem;
  }

  .tape-header,
  .tape-row {
    display: grid;
    grid-template-columns: 4.6rem 1fr 4.5rem;
    gap: 0.6rem;
    padding: 0.12rem 0.9rem;
  }

  .tape-header {
    color: var(--faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.6rem;
    position: sticky;
    top: 0;
    background: var(--surface);
  }

  .tape-row span:first-child { color: var(--faint); }
  .tape-row.bid span:nth-child(2) { color: var(--up); }
  .tape-row.ask span:nth-child(2) { color: var(--down); }
  .tape-row span:last-child { text-align: right; color: var(--muted); }

  /* ── Markets monitor panel ───────────────────────────────────────── */
  .monitor-sorts {
    display: flex;
    gap: 0.2rem;
  }

  .monitor-sorts button {
    border: 0;
    background: transparent;
    color: var(--faint);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.2rem 0.35rem;
    cursor: pointer;
  }

  .monitor-sorts button.active { color: var(--accent); }

  .monitor-list {
    overflow-y: auto;
    min-height: 0;
    flex: 1;
  }

  .monitor-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 5.5rem 4.5rem 6rem;
    gap: 0.5rem;
    width: 100%;
    padding: 0.3rem 0.9rem;
    border: 0;
    border-bottom: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink);
    font-size: 0.78rem;
    text-align: left;
    cursor: pointer;
  }

  .monitor-row:hover { background: rgba(255, 77, 151, 0.04); }
  .monitor-row.active { box-shadow: inset 2px 0 0 var(--accent); background: var(--surface-2); }

  .monitor-head {
    color: var(--faint);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-family: ui-monospace, monospace;
    cursor: default;
    position: sticky;
    top: 0;
    background: var(--surface);
  }

  .monitor-sym { font-weight: 700; display: flex; gap: 0.35rem; align-items: baseline; }
  .monitor-sym i {
    font-style: normal;
    font-family: ui-monospace, monospace;
    font-size: 0.6rem;
    color: var(--muted);
    border: 1px solid var(--line);
    padding: 0 0.25rem;
  }

  /* ── Status line ─────────────────────────────────────────────────── */
  .status-line {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    height: 1.9rem;
    padding: 0 1rem;
    border-top: 1px solid var(--line);
    background: rgba(8, 10, 13, 0.92);
    backdrop-filter: blur(10px);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.66rem;
    color: var(--muted);
  }

  .sl-sep { width: 1px; height: 0.9rem; background: var(--line-soft); }
  .sl-grow { flex: 1; }
  .warn-txt { color: var(--amber); }

  .sl-help {
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font: inherit;
    padding: 0.06rem 0.4rem;
    cursor: pointer;
  }

  .sl-help:hover { color: var(--ink); }

  /* Account money in the fixed line: equity/uPnL/free/funding, one click
     from the perp desk. */
  .sl-money {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    padding: 0;
    cursor: pointer;
  }

  .sl-money:hover { color: var(--ink); }

  .dashboard { padding-bottom: 2.6rem; }

  /* ── News linking chips ──────────────────────────────────────────── */
  .link-chip {
    border: 1px solid var(--line);
    background: transparent;
    color: var(--faint);
    font-family: ui-monospace, monospace;
    font-size: 0.62rem;
    padding: 0.1rem 0.4rem;
    cursor: pointer;
  }

  .link-chip.on { color: var(--accent); border-color: rgba(255, 77, 151, 0.6); }

  .velocity-chip {
    font-family: ui-monospace, monospace;
    font-size: 0.62rem;
    color: var(--amber);
    border: 1px solid rgba(255, 180, 84, 0.5);
    padding: 0.1rem 0.35rem;
  }

  /* ── Trade ticket ─────────────────────────────────────────────────── */
  .field {
    display: grid;
    gap: 0.3rem;
    align-content: start;
  }

  .pct-chip {
    flex: 1;
    min-height: 1.4rem;
    padding: 0.05rem 0.2rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.66rem;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--line);
    cursor: pointer;
  }

  .pct-chip:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--muted);
  }

  .pct-chip:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Reduce-only toggle: a one-line row, not a grid field. */
  .reduce-only {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.68rem;
    color: var(--muted);
    cursor: pointer;
  }

  .reduce-only input {
    width: auto;
    min-height: 0;
    margin: 0;
    accent-color: var(--accent);
  }

  .field-error input {
    border-color: var(--down);
  }

  .field-wanted input {
    border-color: rgba(255, 180, 84, 0.55);
  }

  .field-note-amber {
    color: var(--amber);
  }

  .field-note {
    color: var(--down);
    font-size: 0.62rem;
    font-style: normal;
    font-weight: 600;
  }

  .ticket-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.45rem 0.6rem;
  }

  .warn-row {
    justify-content: flex-start;
    color: var(--amber);
  }

  /* ── News ticker ──────────────────────────────────────────────────── */
  /* Marquee styles live in components/NewsMarquee.svelte; .news-domain is
     shared with modal tx links, so it lives in terminal.css. */
  .news-list {
    display: grid;
    gap: 0.1rem;
    padding: 0.4rem 0.65rem 0.65rem;
  }

  .news-row {
    display: grid;
    gap: 0.1rem;
    padding: 0.38rem 0;
    border-bottom: 1px solid var(--line-soft);
    text-decoration: none;
    color: var(--ink);
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .news-row:hover .news-row-title {
    color: var(--accent);
  }

  .news-row em {
    color: var(--faint);
    font-size: 0.66rem;
  }

  /* ── Alerts ───────────────────────────────────────────────────────── */
  .alerts-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .alerts-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.05rem;
    height: 1.05rem;
    padding: 0 0.25rem;
    border-radius: 0;
    background: var(--accent);
    color: #04130d;
    font-size: 0.6rem;
    font-weight: 800;
  }

  @media (max-width: 1100px) {
    .perp-panel,
    .macro-panel,
    .watchlist-panel {
      grid-column: span 6;
    }

    .chart-panel,
    .orderbook-panel {
      grid-column: 1 / -1;
    }

    .topbar {
      position: static;
      align-items: flex-start;
      flex-direction: column;
    }

    .topbar-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .account-dropdown {
      right: auto;
      left: 0;
      width: min(22rem, calc(100vw - 1.5rem));
    }

    .market-rail {
      position: sticky;
      top: 0;
    }

    .section-nav {
      display: flex;
    }

    .chart-panel {
      height: clamp(26rem, 52vh, 34rem);
    }

    .orderbook-panel {
      height: auto;
      max-height: 30rem;
    }

    .chart-toolbar {
      align-items: center;
    }

    .chart-market-tools {
      justify-content: flex-start;
    }
  }

  @media (max-width: 720px) {
    .dashboard {
      grid-template-columns: 1fr;
    }

    .chart-panel,
    .orderbook-panel,
    .perp-panel,
    .macro-panel,
    .watchlist-panel {
      grid-column: span 1;
    }

    /* Ticket + funds forms collapse to a single column on phones. */
    .ticket-grid-2 {
      grid-template-columns: 1fr;
    }

    .venue-strip {
      grid-template-columns: 1fr 1fr;
    }

    .chart-panel {
      height: clamp(22rem, 56vh, 30rem);
    }

    .orderbook-panel {
      max-height: 26rem;
    }

    .ticker-symbol strong {
      font-size: 0.82rem;
    }

    .ticker-price b {
      font-size: 0.95rem;
    }

    .chart-toolbar {
      align-items: center;
      flex-direction: row;
      flex-wrap: nowrap;
      min-height: 3.25rem;
      overflow-x: auto;
    }

    .chart-market-tools {
      flex: 0 0 auto;
      flex-direction: row;
      min-width: max-content;
    }

    .timeframe-tabs,
    .price-mode-toggle {
      flex: 0 0 auto;
      width: auto;
    }

    .market-select {
      min-width: 11.5rem;
      max-width: 11.5rem;
    }

    .chart-workspace {
      grid-template-columns: 1fr;
    }

    .chart-tools {
      display: none;
    }

    .chart-overlay {
      max-width: calc(100% - 4rem);
      left: 0.7rem;
    }

    .chart-footer {
      overflow-x: auto;
      justify-content: flex-start;
    }

    .chart-footer strong {
      margin-left: 0;
      white-space: nowrap;
    }

    .account-trigger-text small {
      max-width: 9rem;
    }

    .book-row,
    .table-row,
    .markets-list button {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .table-row em {
      display: none;
    }
  }

  /* ── Watchlist / screener / journal / risk-mode additions ── */
  .star-btn {
    background: transparent;
    border: 0;
    color: var(--faint);
    font-size: 0.85rem;
    line-height: 1;
    padding: 0 0.15rem;
    cursor: pointer;
  }
  .star-btn:hover { color: var(--ink); }
  .star-btn.starred { color: var(--accent); }

  .basis-tag {
    font-size: 0.6rem;
    font-weight: 600;
    margin-left: 0.3rem;
    opacity: 0.9;
  }

  .label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem;
    /* Mode/side flips change these strings — never let them wrap, so the
       fields below sit at identical positions in every mode. Clip inside
       the cell rather than bleeding into the neighboring label. */
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
    gap: 0.5rem;
  }
  .mode-flip {
    background: transparent;
    border: 0;
    color: var(--accent);
    font-size: 0.62rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    white-space: nowrap;
  }
  .mode-flip:hover { filter: brightness(1.15); }

  .screen-controls {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
    padding: 0 0 0.5rem;
  }
  .screen-chip {
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font-size: 0.66rem;
    font-weight: 600;
    padding: 0.15rem 0.35rem;
    cursor: pointer;
  }
  .screen-chip:hover { color: var(--ink); }
  .screen-chip.active { color: var(--ink); border-bottom-color: var(--accent); }
  .screen-sep {
    width: 1px;
    height: 0.9rem;
    background: var(--line);
    margin: 0 0.25rem;
  }

  .journal-list { display: grid; }
  .journal-row {
    display: grid;
    grid-template-columns: 2.6rem 3.6rem minmax(0, 1fr) auto auto;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.32rem 0;
    border-bottom: 1px solid var(--line-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }
  .journal-row:last-child { border-bottom: 0; }
  .journal-time { color: var(--faint); }
  .journal-action { font-weight: 700; }
  .journal-sym { color: var(--ink); }
  .journal-row b { font-weight: 500; color: var(--muted); }
  .journal-tx { color: var(--accent); font-size: 0.66rem; text-decoration: none; }

  .warn { color: var(--amber); }
</style>
