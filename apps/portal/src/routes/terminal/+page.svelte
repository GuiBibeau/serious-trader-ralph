<script lang="ts">
  import "./terminal.css";

  import { onMount, tick } from "svelte";
  import AckModal from "./components/AckModal.svelte";
  import AiReadLine from "./components/AiReadLine.svelte";
  import AlertsModal from "./components/AlertsModal.svelte";
  import AuthModal from "./components/AuthModal.svelte";
  import BookLadder from "./components/BookLadder.svelte";
  import CheatSheetModal from "./components/CheatSheetModal.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import DragHead from "./components/DragHead.svelte";
  import EventsPanel from "./components/EventsPanel.svelte";
  import FundingWizard from "./components/FundingWizard.svelte";
  import FundsModal from "./components/FundsModal.svelte";
  import PaperFundsModal from "./components/PaperFundsModal.svelte";
  import JournalPanel from "./components/JournalPanel.svelte";
  import MacroPanel from "./components/MacroPanel.svelte";
  import MonitorPanel from "./components/MonitorPanel.svelte";
  import PerpDeskPanel from "./components/PerpDeskPanel.svelte";
  import ScreenerPanel from "./components/ScreenerPanel.svelte";
  import SpotMarketsPanel from "./components/SpotMarketsPanel.svelte";
  import SpotTicketForm from "./components/SpotTicketForm.svelte";
  import StatusLine from "./components/StatusLine.svelte";
  import Tape from "./components/Tape.svelte";
  import TicketForm from "./components/TicketForm.svelte";
  import TickerRail from "./components/TickerRail.svelte";
  import ToastStack from "./components/ToastStack.svelte";
  import Topbar from "./components/Topbar.svelte";
  import WatchlistPanel from "./components/WatchlistPanel.svelte";
  import WelcomeStrip from "./components/WelcomeStrip.svelte";
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
  import { hasAcked, recordAck } from "$lib/terminal/ack";
  import {
    hasAutoOpenedWizard,
    hasDismissedWelcome,
    recordWelcomeDismissed,
    recordWizardAutoOpened,
  } from "$lib/terminal/welcome";
  import { type Alert, alertsStore } from "$lib/terminal/alerts";
  import {
    GHOST_DEFAULTS,
    type StructureLevels,
    structureLevels,
  } from "$lib/terminal/autocomplete";
  import {
    buildChartLineSpecs,
    buildStructureLineSpecs,
    clickTradeLabel,
    clickTradeSide,
    measureParts,
    nearestRay,
    type PositionLineKind,
    positionLineSpecs,
    type PriceLineSpec,
    RAY_TOLERANCE_PCT,
    rayLineSpec,
  } from "$lib/terminal/chart-lines";
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
    walletFundsLabel,
  } from "$lib/terminal/account-format";
  import {
    BOOK_LADDER_LEVELS,
    BOOK_LADDER_LEVELS_STACKED,
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
    RAYS_PER_SYMBOL_CAP,
  } from "$lib/terminal/prefs";
  import {
    PAPER_AUTHORITY,
    PAPER_STARTING_BALANCE,
    addPaperMargin,
    cancelPaperOrder,
    cancelPaperOrdersOnSide,
    closePaperPosition,
    ledgerToTraderState,
    paperLedger,
    placePaperOrder,
    resetPaperLedger,
    setPaperTpSl,
    tickPaperLedger,
    topUpPaperCash,
    PAPER_MARK_TTL_MS,
    type PaperEvent,
    type PaperMark,
  } from "$lib/terminal/paper-ledger";
  import {
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
  import { chatState, closeChat, toggleChat } from "$lib/chat";
  import { buildDeskContext } from "$lib/chat-context";
  import { fetchMintSafety, fetchSolanaLamports, solanaRpcUrl } from "$lib/solana-rpc";
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
    readPrivyConfig,
    signAndSendSolanaTransaction,
    signSolanaTransaction,
    type PrivyAuthState,
  } from "$lib/privy-auth";
  import {
    fetchUsdcBalance,
    getJupiterSwapTransaction,
    type JupiterQuote,
  } from "$lib/funding";
  import { OpenBetaBanner } from "@harness-trade/ui";
  import { colors } from "@harness-trade/ui/tokens";
  import {
    clearJournal,
    entriesToday,
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
    getSpotSwapTransaction,
    spotIntervalFor,
    tokenToAtoms,
    usdcToAtoms,
    USDC_MINT as SPOT_USDC_MINT,
    type SpotAsset,
    type TriggerOrder,
  } from "$lib/spot";
  import type {
    PhoenixOpenOrder,
    PhoenixPosition,
    PhoenixSide,
    PhoenixTraderState,
  } from "$lib/phoenix-trade";
  import type { Connection, VersionedTransaction } from "@solana/web3.js";
  import {
    formatAge,
    formatNumber,
    formatPercent,
    formatPrice,
    formatSolBalanceDisplay,
    isRecord,
  } from "$lib/utils";
  import {
    clampLeverage,
    enrichPosition,
    fmtTriggerPrice,
    liqDistancePct,
    orderCancelKey,
  } from "$lib/terminal/trade-math";
  import { createPerpTicket } from "$lib/terminal/perp-ticket";
  import { createSpotTicket } from "$lib/terminal/spot-ticket";
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
  let paperExecutableMarks: Record<string, PaperMark> = {};
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

  function applyLastOrderIntent(): void {
    const intent = lastOrderIntent;
    if (!intent) return;
    if (tradeMode !== "perps") setTradeMode("perps", false);
    // switchPhoenixMarket clears price-anchored fields synchronously at its
    // top, so re-applying after the call keeps the intent's values.
    if (intent.symbol !== selectedSymbol) void switchPhoenixMarket(intent.symbol);
    $tradeSide = intent.side;
    $tradeType = intent.type;
    $tradeAmount = intent.amount;
    $tradeLeverage = intent.leverage;
    $tradeLimitPrice = intent.limitPrice;
    $tradeTakeProfit = intent.tp;
    $tradeStopLoss = intent.sl;
  }

  function chooseMonitorRow(symbol: string): void {
    if (tradeMode !== "perps") setTradeMode("perps", false);
    if (symbol !== selectedSymbol) void switchPhoenixMarket(symbol);
  }

  function paperMaintenanceMarginRatio(symbol: string): number {
    const maxLeverage = markets.find(
      (market) => market.symbol === symbol,
    )?.maxLeverage;
    return maxLeverage && Number.isFinite(maxLeverage) && maxLeverage > 0
      ? 0.5 / maxLeverage
      : 0.005;
  }

  function stampPaperExecutableMark(
    symbol: string,
    price: number | null | undefined,
    asOfMs = Date.now(),
  ): void {
    if (price == null || !Number.isFinite(price) || price <= 0) return;
    paperExecutableMarks = {
      ...paperExecutableMarks,
      [symbol]: {
        price,
        asOfMs,
        maintenanceMarginRatio: paperMaintenanceMarginRatio(symbol),
      },
    };
  }

  function stampPaperExecutableMids(mids: Record<string, number>): void {
    // Every symbol present in this live payload was freshly observed even if
    // its numeric price did not move. Refresh only those symbols; omitted
    // symbols keep their old timestamp and age out independently.
    const asOfMs = Date.now();
    const next = { ...paperExecutableMarks };
    let observed = false;
    for (const [symbol, price] of Object.entries(mids)) {
      if (!Number.isFinite(price) || price <= 0) continue;
      next[symbol] = {
        price,
        asOfMs,
        maintenanceMarginRatio: paperMaintenanceMarginRatio(symbol),
      };
      observed = true;
    }
    if (observed) paperExecutableMarks = next;
  }

  function freshPaperMark(symbol: string): PaperMark | null {
    const mark = paperExecutableMarks[symbol];
    if (!mark) return null;
    const age = Date.now() - mark.asOfMs;
    if (
      !Number.isFinite(mark.price) ||
      mark.price <= 0 ||
      !Number.isFinite(mark.asOfMs) ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > PAPER_MARK_TTL_MS ||
      !Number.isFinite(mark.maintenanceMarginRatio) ||
      mark.maintenanceMarginRatio < 0
    ) {
      return null;
    }
    return mark;
  }

  function showPaperFreshPriceUnavailable(): void {
    phoenixActionError =
      "Fresh live price unavailable — paper order not executed.";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    alertsStore.pushToast({
      ts: Date.now(),
      title: "Paper order not executed",
      body: "Fresh live price unavailable — paper order not executed.",
    });
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
  let ackOpen = false;
  let pendingAckAction: (() => void) | null = null;

  // Perp soft gate (PRD #493 / #498): a definitive not-whitelisted answer
  // swaps the ticket submit for an inline activation state. Activation is
  // self-serve — the app re-runs the referral onboarding with the Harness
  // invite code (one signature), same flow every new wallet gets on
  // connect. Unknown (null) fails open — the venue's own error is the
  // honest signal then.
  let perpGateNotice = false;
  // The wallet:symbol pair whose submit tripped the notice — a different
  // context (market switch, wallet switch) must re-earn it with its own
  // submit click (review).
  let perpGateContext = "";
  let perpAccessBusy = false;

  async function activatePerpAccess(): Promise<void> {
    const wallet = $privyAuth.walletAddress;
    if (paperMode) {
      phoenixActionError = "Perp access activation is LIVE-only; switch out of PAPER first.";
      phoenixActionErrorDetail = "";
      phoenixActionRetry = null;
      return;
    }
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
    if (!wallet || perpAccessBusy) return;
    perpAccessBusy = true;
    // A stale failure from a previous attempt must not outlive a retry
    // (review): clear before the attempt; the catch below re-sets it.
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    try {
      // Force a fresh referral attempt even if an earlier one was recorded
      // for this wallet (covers the recorded-but-not-whitelisted edge).
      const done = JSON.parse(
        window.localStorage.getItem(ONBOARD_KEY) ?? "[]",
      ) as string[];
      window.localStorage.setItem(
        ONBOARD_KEY,
        JSON.stringify(done.filter((a) => a !== wallet)),
      );
      onboardedAddress = "";
      await ensurePhoenixOnboarding(wallet, expectedLiveExecutionEpoch);
      track("perp_access_activation", {
        wallet,
        ok: phoenixWhitelisted === true,
      });
      if (phoenixWhitelisted !== true) {
        phoenixActionError = "Activation didn't complete — try again.";
      }
    } catch (error) {
      phoenixActionError =
        error instanceof Error && error.message === LIVE_MODE_ABORT_ERROR
          ? LIVE_MODE_ABORT_ERROR
          : "Activation didn't complete — try again.";
    } finally {
      perpAccessBusy = false;
    }
  }

  // Gate a trading submit behind the one-time risk ack (PRD #493). The
  // pending action runs only after "I agree" — closing the modal drops it.
  function requireTradeAck(action: () => void): void {
    if (hasAcked($privyAuth.walletAddress)) {
      action();
      return;
    }
    pendingAckAction = action;
    ackOpen = true;
  }

  function onAckAgree(): void {
    recordAck($privyAuth.walletAddress);
    track("ack_accepted", {});
    // The welcome strip's "first trade" step reads the ack from
    // localStorage — bump its tick so the reactive re-runs now (review).
    welcomeTick += 1;
    ackOpen = false;
    const action = pendingAckAction;
    pendingAckAction = null;
    action?.();
  }

  let logoutBusy = false;
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
  // Paper mode swaps in a local ledger shaped like PhoenixTraderState so
  // the desk/ticket/chart keep working without signing.
  // Default to paper when Privy isn't set up locally — live trading needs
  // PUBLIC_PRIVY_APP_ID; paper does not. Saved prefs still win on load.
  let paperMode = !readPrivyConfig().appId;
  let liveExecutionEpoch = 0;
  let liveSignerInFlight = false;
  let liveSignerInvocationCount = 0;
  const LIVE_MODE_ABORT_ERROR =
    "Live transaction canceled — switched mode before wallet signing.";

  function assertLiveExecutionEpoch(expectedLiveExecutionEpoch: number): void {
    if (paperMode || expectedLiveExecutionEpoch !== liveExecutionEpoch) {
      throw new Error(LIVE_MODE_ABORT_ERROR);
    }
  }

  function captureLiveExecutionEpoch(): number {
    const expectedLiveExecutionEpoch = liveExecutionEpoch;
    assertLiveExecutionEpoch(expectedLiveExecutionEpoch);
    return expectedLiveExecutionEpoch;
  }

  function beginLiveSignerInvocation(): void {
    liveSignerInvocationCount += 1;
    liveSignerInFlight = true;
  }

  function endLiveSignerInvocation(): void {
    liveSignerInvocationCount = Math.max(0, liveSignerInvocationCount - 1);
    liveSignerInFlight = liveSignerInvocationCount > 0;
  }

  function clearCrossModeTransactionPresentation(): void {
    pendingAckAction = null;
    ackOpen = false;
    phoenixActionRetry = null;
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    txStages = {};
    lastTx = null;
    lastTradeSignature = "";
    collateralSignature = "";
    collateralError = "";
    spotSignature = "";
    $spotQuoteError = "";
    pendingOrder = null;
    perpAccessBusy = false;
    collateralBusy = false;
    spotBusy = false;
    triggerBusy = false;
    phoenixBusyKeys = new Set();
    closingKeys = new Set();
    tpslPending = null;
    tpslDrag = null;
    limitArmedUntil = 0;
    spotLimitArmedUntil = 0;
    flattenArmedUntil = 0;
    armedHotkey = null;
    perpGateNotice = false;
    spotTicket.invalidateQuote();
  }

  function enterPaperSafetyBoundary(): void {
    liveExecutionEpoch += 1;
    clearCrossModeTransactionPresentation();
    fundsOpen = false;
    pendingTradeMode = null;
    pendingSpotAssetId = null;
    if (tradeMode !== "perps") setTradeMode("perps", false);
  }

  function exitPaperSafetyBoundary(): void {
    liveExecutionEpoch += 1;
    clearCrossModeTransactionPresentation();
  }

  $: livePhoenixTrader = phoenixAuthority
    ? freshSnapshot($traderSnapshots, phoenixAuthority)
    : null;
  $: phoenixTrader = paperMode
    ? ledgerToTraderState($paperLedger)
    : livePhoenixTrader;
  $: tradeAuthority = paperMode ? PAPER_AUTHORITY : phoenixAuthority;
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

  // Add-funds (receive + swap) flow. QR + swap-quote state live in
  // components/FundsModal.svelte; the page keeps the open flag + tab
  // (deep-link `?fund=` and openPhoenixFunding pre-set them).
  let fundsOpen = false;
  let paperFundsOpen = false;
  let fundsTab: "receive" | "convert" | "phoenix" = "receive";
  let tradeOpen = false;
  let pendingBook: { bids: DepthLevel[]; asks: DepthLevel[]; mid: number | null } | null =
    null;
  let bookFrame = 0;
  let prefsReady = false;
  let activeSection = "chart";

  // AI co-pilot reads (DeepSeek). Interpretation only — never computes numbers.
  let macroRead: AiRead = IDLE_READ;
  let fundingRead: AiRead = IDLE_READ;
  let scannerRead: AiRead = IDLE_READ;
  // Perp ticket state (side/size/risk/leverage/type/limit/TP/SL/sizing +
  // reduce-only) and its derived previews live in $lib/terminal/perp-ticket.
  // The page feeds hot inputs through perpTicket.setInputs below and keeps
  // the signing pipeline; components arrive in a later stage.
  const perpTicket = createPerpTicket();
  const {
    tradeSide,
    sizingMode,
    tradeAmount,
    tradeRiskUsd,
    tradeLeverage,
    tradeType,
    tradeLimitPrice,
    tradeTakeProfit,
    tradeStopLoss,
    tradeReduceOnly,
    ticketActive,
    tradePreview,
    requiredMarginUsd,
    needsPhoenixFunding,
  } = perpTicket;
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
  let spotBusy = false;
  let spotSignature = "";
  let spotChartTimer: ReturnType<typeof setInterval> | null = null;
  // Generation token: invalidate in-flight chart responses when the user
  // changes asset/timeframe (out-of-order fetch protection). The quote-side
  // twin lives inside the spot ticket store.
  let spotChartSeq = 0;
  // Spot ticket state (side/amount/order-type/limit) + the Jupiter quote
  // engine (debounce + generation tokens) live in $lib/terminal/spot-ticket.
  // The store reads the selected asset live and clears the last swap
  // signature whenever pricing is invalidated; the money paths
  // (executeSpotSwap / submitSpotLimitOrder) stay in this file.
  const spotTicket = createSpotTicket({
    getAsset: () => spotAsset,
    onQuoteInvalidated: () => {
      spotSignature = "";
    },
  });
  const {
    spotSide,
    spotAmount,
    spotOrderType,
    spotLimitPrice,
    spotQuote,
    spotQuoteStatus,
    spotQuoteError,
  } = spotTicket;
  const scheduleSpotQuote = spotTicket.scheduleQuote;
  const flipSpotSide = spotTicket.flipSide;
  let spotChartPoints: MarketPoint[] = [];
  let tokenBalances: Record<string, number> = {};
  let pendingTradeMode: "spot" | null = null;
  let pendingSpotAssetId: string | null = null;

  // Watchlist: starred symbols (uppercase), persisted in prefs.
  let watchlist: string[] = [];
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
  let triggerOrders: TriggerOrder[] = [];
  let triggerBusy = false;
  let triggerWallet = "";
  // Liquidation price lines for open positions on the perp chart.
  let liqLines: IPriceLine[] = [];
  // Signature memo for refreshChartLines — skip the remove/create cycle
  // when the rendered lines would be unchanged. null = force next apply
  // (reset whenever the candle series is recreated).
  let chartLineFullSig: string | null = null;
  let chartLineStructSig: string | null = null;
  let chartLineTick = -1;
  // Structure levels (PDH/PDL + swing pivots) drawn quietly on the chart.
  // Full data loads recompute immediately (renderChartSeries); websocket
  // candle ticks only arm the trailing 2 s debounce — never per tick.
  let showLevels = true;
  let structLevels: StructureLevels = {
    prevDayHigh: null,
    prevDayLow: null,
    swings: [],
  };
  let structureLines: IPriceLine[] = [];
  let structureTimer: ReturnType<typeof setTimeout> | null = null;
  // Click-to-trade: armed per-session only (never persisted — arming is an
  // intent, not a preference; defaults OFF every load). While armed, ONE
  // reusable price line follows the crosshair and a click prefills the perp
  // ticket then disarms. Zero overhead when off: the crosshair/click
  // subscriptions exist only while armed.
  let clickTradeArmed = false;
  let clickTradeLine: IPriceLine | null = null;
  let clickTradeHover: { y: number; right: number; label: string } | null =
    null;
  // Horizontal rays — user-drawn price lines persisted per symbol in prefs
  // (max 12, FIFO eviction). Arming is one-shot like click-to-trade: the
  // armed click places a ray, or removes the nearest existing ray within
  // ±0.5% instead. Zero overhead unarmed with no rays for the symbol: no
  // subscriptions, no lines.
  let rays: Record<string, number[]> = {};
  let rayArmed = false;
  let rayLines: IPriceLine[] = [];
  // Measure tool — armed pointer drag between two points shows a Δ/%/bars
  // chip near the cursor; ephemeral by design (never persisted). The chip
  // lingers 2 s after release; ESC cancels. Pointer listeners exist only
  // while armed.
  let measureArmed = false;
  let measure: {
    pointerId: number;
    p1: number;
    p2: number;
    startLogical: number;
    bars: number;
    x: number;
    y: number;
    moved: boolean;
    done: boolean;
  } | null = null;
  let measureLingerTimer: ReturnType<typeof setTimeout> | null = null;
  // Draggable TP/SL overlay: the charted position's entry/TP/SL price lines
  // plus DOM grab handles on the TP/SL lines. Line handles are reusable
  // (applyOptions on change, guarded by a price memo — never re-created per
  // WS event); the drag itself is transform/option-update only. tpslPending
  // holds a just-submitted trigger at the dragged price until the lagging
  // indexer confirms it (or 25s pass) — the position ROW keeps rendering
  // chain state throughout; only these chart lines preview.
  type TpSlKind = Exclude<PositionLineKind, "entry">;
  let posOverlayLines: Record<PositionLineKind, IPriceLine | null> = {
    entry: null,
    tp: null,
    sl: null,
  };
  let posOverlayPrices: Record<PositionLineKind, number | null> = {
    entry: null,
    tp: null,
    sl: null,
  };
  let tpHandleEl: HTMLButtonElement | null = null;
  let slHandleEl: HTMLButtonElement | null = null;
  let tpslHandleCache: Record<
    TpSlKind,
    { el: HTMLButtonElement | null; y: number | null; right: number | null }
  > = {
    tp: { el: null, y: null, right: null },
    sl: { el: null, y: null, right: null },
  };
  let tpslDrag: {
    kind: TpSlKind;
    pointerId: number;
    startPrice: number;
    price: number;
    chartTop: number;
    moved: boolean;
  } | null = null;
  let tpslPending: {
    kind: TpSlKind;
    price: number;
    from: number;
    until: number;
  } | null = null;
  let tpslFrame: number | null = null;

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

  // Legacy key name kept across the Harness rebrand.
  const OPEN_BETA_BANNER_STORAGE_KEY =
    "trader-ralph-terminal/open-beta-banner/v1";
  let showOpenBetaBanner = false;
  // Welcome strip (PRD #493 / #499): three steps derived from real state,
  // shown once per wallet until dismissed or complete. welcomeTick bumps
  // after a dismissal or an ack so the $:s re-read localStorage.
  let welcomeTick = 0;
  // Never judge "unfunded" from a loading state (review): balances start
  // null and Phoenix trader state arrives async — an onboarded wallet must
  // not see the strip flash while they resolve.
  $: welcomeStateKnown = usdcBalanceValue !== null && phoenixStateKnown;
  $: welcomeFunded =
    (usdcBalanceValue ?? 0) > 0 ||
    (solBalanceValue ?? 0) > 0 ||
    phoenixTotalCollateral > 0;
  $: welcomeTraded =
    welcomeTick >= 0 &&
    (enrichedPositions.length > 0 || hasAcked($privyAuth.walletAddress));
  $: showWelcomeStrip =
    welcomeTick >= 0 &&
    welcomeStateKnown &&
    $privyAuth.authenticated &&
    Boolean($privyAuth.walletAddress) &&
    !(welcomeFunded && welcomeTraded) &&
    !hasDismissedWelcome($privyAuth.walletAddress);

  function dismissWelcome(): void {
    recordWelcomeDismissed($privyAuth.walletAddress);
    welcomeTick += 1;
  }

  // Funding wizard (PRD #510): the welcome strip's expanded form. Auto-opens
  // once per wallet for fresh authed accounts that still need onboarding —
  // afterwards the strip is the re-entry point. Reload never re-opens (the
  // wizard-auto key is set on first open); signed-out never opens.
  let wizardOpen = false;
  // In-memory guard alongside the persisted key: if the localStorage write
  // fails (private mode, quota), the reactive must NOT re-fire and reopen
  // the wizard every time it closes (review). Session memory wins.
  const wizardAutoOpenedSession = new Set<string>();
  $: welcomeCollateralized = phoenixTotalCollateral > 0;
  $: if (
    showWelcomeStrip &&
    !wizardOpen &&
    $privyAuth.walletAddress &&
    !wizardAutoOpenedSession.has($privyAuth.walletAddress) &&
    !hasAutoOpenedWizard($privyAuth.walletAddress)
  ) {
    wizardAutoOpenedSession.add($privyAuth.walletAddress);
    recordWizardAutoOpened($privyAuth.walletAddress);
    wizardOpen = true;
  }
  // While the wizard is open and the wallet is unfunded, poll balances
  // every 5s so "this screen will advance on its own" is actually prompt —
  // the ambient 30s cadence stays for everything else.
  let wizardPollTimer: ReturnType<typeof setInterval> | null = null;
  $: {
    const wantFast = wizardOpen && !welcomeFunded && Boolean(walletBalanceAddress);
    if (wantFast && wizardPollTimer === null) {
      wizardPollTimer = setInterval(() => {
        if (walletBalanceAddress) {
          void refreshWalletBalance(walletBalanceAddress, { quiet: true });
        }
      }, 5_000);
    } else if (!wantFast && wizardPollTimer !== null) {
      clearInterval(wizardPollTimer);
      wizardPollTimer = null;
    }
  }
  // Bottom dock (desk / journal / alerts) + macro drawer — day-trading grid.
  let dockTab: "desk" | "journal" | "alerts" = "desk";
  let macroOpen = false;
  const { alertLog } = alertsStore;
  // Meme safety rails: SPL authority checks per selected mint (cached —
  // authorities effectively never un-revoke).
  let mintSafetyCache: Record<string, import("$lib/solana-rpc").MintSafety> = {};
  let mintSafetyMisses: Record<string, true> = {};
  $: if (spotAsset && !mintSafetyCache[spotAsset.mint] && !mintSafetyMisses[spotAsset.mint]) {
    const mint = spotAsset.mint;
    mintSafetyMisses = { ...mintSafetyMisses, [mint]: true };
    void fetchMintSafety(mint)
      .then((safety) => {
        mintSafetyCache = { ...mintSafetyCache, [mint]: safety };
      })
      .catch(() => {
        // decode failed (RPC hiccup / exotic mint) — chips stay amber
      });
  }
  // Repeat-last-order: the exact ticket inputs of the last CONFIRMED perp
  // order; the palette re-applies them (never auto-submits).
  let lastOrderIntent: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    amount: string;
    leverage: number;
    limitPrice: string;
    tp: string;
    sl: string;
  } | null = null;

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
  $: normalizedWalletAddress = $privyAuth.walletAddress ?? "";
  $: if (normalizedWalletAddress !== walletBalanceAddress) {
    walletBalanceAddress = normalizedWalletAddress;
    void refreshWalletBalance(normalizedWalletAddress);
  }
  $: if (normalizedWalletAddress !== screenedAddress) {
    void screenWallet(normalizedWalletAddress);
  }
  $: phoenixAuthority = $privyAuth.authenticated ? normalizedWalletAddress : "";
  // Lazy web3 boundary (plan 8.1): $lib/phoenix-trade statically pulls
  // @solana/web3.js + @ellipsis-labs/rise (~1.1 MB pre-minify) — the dynamic
  // import keeps that graph out of the entry chunk. The module registry
  // memoizes the load, so every call site shares one in-flight fetch.
  const tradeModule = () => import("$lib/phoenix-trade");
  // Side-chat dock (PRD #563, WP3): lazy so the panel's chunk stays out of
  // the entry bundle until the first summon — closed = zero JS weight. The
  // module registry caches the load, so repeat opens are instant.
  const SidePanelLazy = () => import("./components/SidePanel.svelte");
  // Mandatory auth-time prefetch: the moment auth lands — before any trade,
  // deposit, swap or cancel is possible (all require the wallet, which only
  // exists when authenticated) — warm the chunk so no user action ever
  // awaits a cold import. Disconnected visitors never fetch it.
  $: if ($privyAuth.authenticated) void tradeModule();
  // Wallet appears (login, restore, or switch): refresh from the network;
  // the derived view above already shows the device snapshot meanwhile.
  let refreshedAuthority: string | null = null;
  $: if (phoenixAuthority && refreshedAuthority !== phoenixAuthority) {
    refreshedAuthority = phoenixAuthority;
    void refreshPhoenixTrader();
  } else if (!phoenixAuthority) {
    refreshedAuthority = null;
  }
  $: if (!paperMode && phoenixAuthority)
    void ensurePhoenixOnboarding(phoenixAuthority, liveExecutionEpoch);
  $: if (phoenixAuthority) void refreshTokenBalances(phoenixAuthority);
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
        ? `${formatPrice(spotAsset.price)} ${spotAsset.symbol} · Harness`
        : `${spotAsset.symbol} · Harness`;
    }
    return latestPrice !== null
      ? `${formatPrice(latestPrice)} ${selectedSymbol}-PERP · Harness`
      : "Harness";
  })();
  $: statsLoading = marketStats === null;
  $: bookLoading = asks.length === 0 || bids.length === 0;
  $: updatedLoading = lastMarketUpdate === null;
  // Grouped ticker models (new identities per tick — accepted; the same
  // bindings re-evaluated per tick before the TickerRail split, and the
  // leaf component now scopes the DOM update).
  $: tickerPerp = {
    price: chartPrice,
    change: change24h,
    stats: marketStats,
    spreadBps,
    fundingPercent,
    basisBps: perpBasisBps,
    loading: {
      price: priceLoading,
      stats: statsLoading,
      book: bookLoading,
      updated: updatedLoading,
    },
  };
  $: tickerSpot = { asset: spotAsset, basisBps: spotBasisBps };
  $: phoenixCollateral = phoenixTrader?.collateralUsd ?? 0;
  $: phoenixStateKnown = phoenixTrader !== null;
  // Perp ticket derivations (preview, funding gate, TP/SL analysis, risk
  // sizing) live in $lib/terminal/perp-ticket — feed it the hot inputs
  // (book, mark, funding), ticket visibility, the chain-first account
  // snapshot, and the 1s clock for the funding-shortfall debounce.
  $: perpTicket.setInputs({
    asks,
    bids,
    latestPrice,
    fundingPercent,
    tradeOpen,
    perpsMode: tradeMode === "perps",
    stackedBook,
    tradeTab: bookTab === "trade",
    hasAuthority: Boolean(phoenixAuthority) || paperMode,
    stateKnown: phoenixStateKnown,
    chainVerified: paperMode || phoenixTrader?.chainVerified === true,
    collateralUsd: phoenixCollateral,
  });
  $: perpTicket.setNow(nowMs);

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
  // PAPER has no flow-adjusted daily baseline yet: suppress the live wallet's
  // equity history entirely rather than subtracting the simulated ledger's
  // equity from a live baseline (a dishonest mixed number). A dedicated paper
  // daily baseline is a deferred follow-up.
  $: equityPoints =
    !paperMode && phoenixAuthority
      ? $equityHistory[phoenixAuthority] ?? []
      : [];
  $: equityValues = equityPoints.map((point) => point.equity);
  $: equityBaseline =
    !paperMode && phoenixAuthority
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

  // Side-chat grounding snapshot (PRD #563, WP2 serializer): assembled at
  // send time from the page's live state so the model always sees the current
  // desk. The panel never imports page state — it only calls this closure.
  function buildDeskContextClosure(): Record<string, unknown> {
    return buildDeskContext({
      accountMode: paperMode ? "paper" : "live",
      symbol: selectedSymbol,
      timeframe: selectedTimeframe,
      positions: enrichedPositions,
      openOrders: perpOpenOrders,
      // Paper has no flow-adjusted daily baseline yet — null is honest;
      // mixing the simulator with a live wallet baseline is not.
      dayPnlUsd: paperMode ? null : sessionPnlUsd,
      equityUsd: accountEquityUsd,
      monitorRows: markets.map((market) => ({
        symbol: market.symbol,
        mid: marketMids[market.symbol] ?? null,
      })),
      watchlist,
      headlines: news.map((item) => ({
        title: item.title,
        source: item.domain,
        ageMin: Math.max(0, Math.round((nowMs - item.seenMs) / 60_000)),
      })),
      nowMs: Date.now(),
    });
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
  $: if (!selectedPosition && $tradeReduceOnly) $tradeReduceOnly = false;
  $: selectedLiqDistancePct =
    selectedPosition?.liquidationPrice != null && latestPrice
      ? (Math.abs(latestPrice - selectedPosition.liquidationPrice) /
          latestPrice) *
        100
      : null;

  // The ticket only blocks on ITS symbol's open — Close/Cancel stay live.
  $: orderBusyKey = `order:${selectedSymbol}`;
  $: orderBusy = phoenixBusyKeys.has(orderBusyKey);
  $: orderStageEntry = txStages[orderBusyKey] ?? null;

  // ── Size presets ───────────────────────────────────────────────────
  // USD mode: % of free collateral × leverage; Max keeps the same $0.01
  // margin buffer the funding gate tolerates so a Max ticket can't flash
  // "Deposit first". Risk mode: % of account equity put at risk.
  // (The offered percentages live in TicketForm.svelte; the chip math and
  // sizeSource tracking stay here so leverage re-follow keeps working.)
  // Chip-sized tickets re-follow leverage changes; hand-typed sizes never
  // move underneath the trader.
  let sizeSource: "chip" | "manual" = "manual";
  let sizeChipPct: number | "max" | null = null;

  function chipNotionalUsd(pct: number | "max"): number {
    const margin =
      pct === "max"
        ? Math.max(0, phoenixCollateral - 0.01)
        : (pct / 100) * phoenixCollateral;
    return margin * $tradeLeverage;
  }

  function setSizeChip(pct: number | "max"): void {
    $tradeAmount = chipNotionalUsd(pct).toFixed(2);
    sizeSource = "chip";
    sizeChipPct = pct;
  }

  function setRiskChip(pct: number): void {
    $tradeRiskUsd = ((pct / 100) * accountEquityUsd).toFixed(2);
    sizeSource = "chip";
    // Risk chips don't depend on leverage — nothing to re-derive later.
    sizeChipPct = null;
  }

  $: recomputeChipSize($tradeLeverage);
  function recomputeChipSize(_leverage: number): void {
    if (sizeSource !== "chip" || sizeChipPct === null || $sizingMode !== "usd") return;
    $tradeAmount = chipNotionalUsd(sizeChipPct).toFixed(2);
  }

  // ── Keyboard: Enter submits, arrows step ───────────────────────────
  // Enter-to-submit shares the exact gate that enables each submit button.
  $: canSubmitPerp =
    (paperMode || Boolean(phoenixAuthority)) &&
    phoenixStateKnown &&
    !$needsPhoenixFunding &&
    !orderBusy &&
    Boolean($tradePreview) &&
    (paperMode || !walletScreen.flagged);
  $: canSubmitSpot =
    !paperMode &&
    Boolean(phoenixAuthority) &&
    !spotBusy &&
    !walletScreen.flagged &&
    ($spotOrderType === "limit"
      ? Number($spotLimitPrice) > 0 && Number($spotAmount) > 0
      : $spotQuote !== null && $spotQuoteStatus === "quoted");

  // ── Limit deviation gate ───────────────────────────────────────────
  // A dropped decimal (2450 instead of 245.0) would otherwise execute in
  // one click. Crossing the touch is informational only (marketable limits
  // are a real tactic); >5% from mark arms a two-stage confirm; >25%
  // blocks outright. Same tiers on the spot limit ticket, against the
  // catalog price (spot has no live book, so no crossing tier there).
  $: limitPriceValue = $tradeType === "limit" ? Number($tradeLimitPrice) : 0;
  $: limitDeviationPct =
    limitPriceValue > 0 && latestPrice
      ? ((limitPriceValue - latestPrice) / latestPrice) * 100
      : null;
  $: limitCrossesBook =
    limitPriceValue > 0 &&
    ($tradeSide === "buy"
      ? asks.length > 0 && limitPriceValue >= asks[0].price
      : bids.length > 0 && limitPriceValue <= bids[0].price);
  $: limitNeedsConfirm =
    limitDeviationPct !== null && Math.abs(limitDeviationPct) > 5;
  $: limitBlocked =
    limitDeviationPct !== null && Math.abs(limitDeviationPct) > 25;
  let limitArmedUntil = 0;
  $: limitArmed = limitNeedsConfirm && nowMs < limitArmedUntil;

  function onPerpSubmitClick(): void {
    if (!paperMode && phoenixWhitelisted === false) {
      perpGateContext = `${$privyAuth.walletAddress ?? ""}:${selectedSymbol}`;
      perpGateNotice = true;
      return;
    }
    if (!canSubmitPerp || limitBlocked) return;
    if (limitNeedsConfirm && Date.now() >= limitArmedUntil) {
      limitArmedUntil = Date.now() + 3_000;
      return;
    }
    limitArmedUntil = 0;
    if (paperMode) {
      void submitPaperOrder();
      return;
    }
    requireTradeAck(() => void submitPhoenixOrder());
  }

  // The gate notice clears on a whitelist flip OR any context change
  // (market/wallet switch) — each context re-earns it with its own submit.
  $: if (
    perpGateNotice &&
    (phoenixWhitelisted !== false ||
      perpGateContext !== `${$privyAuth.walletAddress ?? ""}:${selectedSymbol}`)
  )
    perpGateNotice = false;

  $: spotLimitPriceValue = $spotOrderType === "limit" ? Number($spotLimitPrice) : 0;
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
    requireTradeAck(() => void submitSpotLimitOrder());
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
    if ($spotOrderType === "limit") onSpotLimitSubmitClick();
    else requireTradeAck(() => void executeSpotSwap());
  }

  // Arrow-key stepping on ticket inputs (use:stepInput) moved to
  // $lib/terminal/step-input — TicketForm/SpotTicketForm consume it there.

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

  // ── Account exposure / leverage (margin meter, deterministic) ──
  $: accountExposureUsd = (phoenixTrader?.positions ?? []).reduce(
    (sum, position) => sum + Math.abs(position.positionValue ?? 0),
    0,
  );
  $: accountLeverage =
    phoenixCollateral > 0 && accountExposureUsd > 0
      ? accountExposureUsd / phoenixCollateral
      : null;

  // ── Journal-derived views + AI notes (facts computed, AI narrates) ──
  // Session stats/recap are mode-scoped: simulated and live activity never
  // add together. Legacy entries stay visible in the journal but are omitted
  // from mode-specific aggregates because their provenance is unknown.
  $: journalToday = entriesToday(journalEntries, Date.now()).filter(
    (entry) => entry.mode === (paperMode ? "paper" : "live"),
  );
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
    lineLabelTick,
  );

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
      paperMode ? "perps" : pendingTradeMode ?? tradeMode,
      paperMode ? null : spotAsset?.assetId ?? pendingSpotAssetId,
      watchlist,
      screenSort,
      screenHub,
      $sizingMode,
      $tradeAmount,
      $tradeRiskUsd,
      $tradeLeverage,
      dockTab,
      macroOpen,
      showLevels,
      rays,
      paperMode,
    );

  onMount(() => {
    loadOpenBetaBanner();
    loadPrefs();
    applyDeepLink(); // ?asset=&venue=&side=… — overrides restored prefs
    alertsStore.load({ trackContext: marketContext });
    journalEntries = loadJournal();
    loadLayout();
    const panelsWarm = hydrateWidgetCache();
    prefsReady = true;
    createChartInstance();
    void bootPhoenixMarketData();
    // Boot dedupe: warm panels defer the edge fetch burst until the stream
    // is live (or 3s), and the post-Privy rerun only fires when auth
    // actually changed the token — cold unauthenticated boots used to fetch
    // the whole panel set twice plus a third AI burst from a 4s timer.
    if (panelsWarm) kickEdgeModulesWhenWarm();
    else void refreshEdgeModules();
    void initializePrivyAuth().then(async () => {
      const token = (await activePrivyAccessToken()) ?? null;
      if (lastEdgeRunToken === undefined || token !== lastEdgeRunToken) {
        void refreshEdgeModules();
      }
    });
    void loadSpotAssets();

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
      if (wizardPollTimer !== null) window.clearInterval(wizardPollTimer);
      if (copyResetTimer) clearTimeout(copyResetTimer);
      spotTicket.dispose();
      if (spotChartTimer) clearInterval(spotChartTimer);
      if (structureTimer !== null) clearTimeout(structureTimer);
      if (measureLingerTimer !== null) clearTimeout(measureLingerTimer);
      if (tpslFrame !== null) cancelAnimationFrame(tpslFrame);
      tpslFrame = null;
      posOverlayLines = { entry: null, tp: null, sl: null };
      posOverlayPrices = { entry: null, tp: null, sl: null };
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
    // Warm-cache fast path: hydrateWidgetCache already restored the market
    // catalog (24h max age). When it knows the selected symbol, connect NOW —
    // the WS handshake stops waiting behind two serial HTTPS round-trips —
    // and refresh the catalog concurrently, reconciling only if the symbol
    // vanished (rare: slug-stability invariant).
    const hydrated = markets.find(
      (market) =>
        market.symbol === selectedSymbol && market.marketStatus === "active",
    );
    if (hydrated) {
      void switchPhoenixMarket(selectedSymbol);
      void refreshDailyStats();
      void probeRpc();
      try {
        markets = await fetchPhoenixMarkets();
        if (!markets.some((market) => market.symbol === selectedSymbol)) {
          await selectDefaultMarket();
        }
      } catch {
        // catalog refresh failed — the hydrated catalog stands, stream is up
      }
      return;
    }
    try {
      markets = await fetchPhoenixMarkets();
      void refreshDailyStats();
      void probeRpc();
      await selectDefaultMarket();
    } catch {
      streamHealth = "offline";
      marketSourceLabel = "Phoenix Perps unavailable";
    }
  }

  async function selectDefaultMarket(): Promise<void> {
    const defaultMarket =
      markets.find((market) => market.symbol === selectedSymbol) ??
      markets.find((market) => market.symbol === DEFAULT_PHOENIX_SYMBOL) ??
      markets.find((market) => market.marketStatus === "active") ??
      markets[0];
    selectedSymbol = defaultMarket?.symbol ?? DEFAULT_PHOENIX_SYMBOL;
    await switchPhoenixMarket(selectedSymbol);
  }

  async function switchPhoenixMarket(symbol: string): Promise<void> {
    track("market_switched", { from: selectedSymbol, to: symbol, venue: "perps" });
    if (!symbol) return;
    // Price-anchored ticket fields are stale on a different market — a SOL
    // limit at 150 would cross the entire BTC book as taker. Clear them
    // (never re-anchor); size and leverage persist across the switch.
    if (symbol !== selectedSymbol) {
      $tradeLimitPrice = "";
      $tradeTakeProfit = "";
      $tradeStopLoss = "";
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

    // WS first: the handshake (first live quote) no longer waits behind the
    // candle-history round-trip. Ticks that land while REST is in flight go
    // through the upsert into the cached/empty series; the snapshot merge
    // below keeps them instead of blind-replacing.
    const streamStartedAt = Date.now();
    startPhoenixStream(symbol);

    try {
      const snapshot = await fetchPhoenixInitialMarketData(
        symbol,
        selectedTimeframe,
      );
      const historyEnd = snapshot.chartPoints.at(-1)?.ts ?? 0;
      // Live candles at or beyond the history boundary survive the merge —
      // including a same-period update to history's last candle: the stream
      // sends exchange-computed full candles, so the live version carries
      // the freshest close. Route them through the same upsert the stream
      // handler uses. Gated on a real post-connect tick (cache paints carry
      // historical stamps, always older than streamStartedAt).
      const liveTicked =
        lastMarketUpdate !== null && lastMarketUpdate >= streamStartedAt;
      const liveSince = liveTicked
        ? chartPoints.filter((point) => point.ts >= historyEnd)
        : [];
      chartPoints = liveSince.reduce(
        (acc, point) => upsertLiveCandle(acc, point),
        snapshot.chartPoints,
      );
      if (!liveTicked) {
        latestPrice = snapshot.latestPrice;
        lastMarketUpdate = snapshot.lastMarketUpdate;
      }
      setChartData();
      if (tradeMode === "perps" && (!cached || !cached.length)) {
        setVisibleCandleRange(visibleCandleCount);
      }
      marketSourceLabel = `${snapshot.source.provider} ${snapshot.source.symbol}`;
      streamHealth = "live";
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
      // No candles → no levels; the old market's lines must not linger.
      recomputeStructureLevels([]);
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
        const livePrice = point.markClose ?? point.close;
        stampPaperExecutableMark(symbol, livePrice);
        chartPoints = upsertLiveCandle(chartPoints, point);
        updateChartPoint(point);
        cacheCandles(symbol, selectedTimeframe, chartPoints);
        latestPrice = marketStats?.markPx ?? livePrice;
        lastMarketUpdate = Date.now();
        streamHealth = "live";
      },
      onOrderbook: (payload) => {
        stampPaperExecutableMark(symbol, payload.mid);
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
        const livePrice = stats.markPx ?? stats.midPx;
        stampPaperExecutableMark(symbol, livePrice);
        marketStats = stats;
        latestPrice = livePrice ?? latestPrice;
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
        stampPaperExecutableMids(mids);
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

  // undefined = never ran this session; null = ran unauthenticated.
  let lastEdgeRunToken: string | null | undefined = undefined;

  /** Deferred first edge run for warm boots: stream live or 3s, whichever first. */
  function kickEdgeModulesWhenWarm(): void {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (streamHealth === "live" || Date.now() - started >= 3_000) {
        window.clearInterval(timer);
        // The post-Privy path may have run meanwhile — never double-fetch.
        if (lastEdgeRunToken === undefined) void refreshEdgeModules();
      }
    }, 250);
  }

  async function refreshEdgeModules(): Promise<void> {
    edgeSource = edgeApiBase() || "not configured";
    edgeStatus = "loading";
    const accessToken = await activePrivyAccessToken();
    lastEdgeRunToken = accessToken ?? null;
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

  /** Restores cached widgets; returns true when fresh panels were painted. */
  function hydrateWidgetCache(): boolean {
    let panelsWarm = false;
    const panels = swrRead<{
      macro: DataPanel;
      fred: DataPanel;
      etf: DataPanel;
      stablecoin: DataPanel;
      oil: DataPanel;
    }>(CACHE_PANELS, CACHE_MAX_AGE);
    if (panels) {
      panelsWarm = true;
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
    return panelsWarm;
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
      $tradeSide = intent.side;
      $tradeType = intent.orderType;
      if (intent.sizeUsd != null) $tradeAmount = String(intent.sizeUsd);
      if (intent.leverage != null) $tradeLeverage = clampLeverage(intent.leverage);
      if (intent.limitPrice != null) $tradeLimitPrice = String(intent.limitPrice);
      if (intent.stopPercent != null) {
        // Convert a "1% stop" style command into a Phoenix SL trigger price.
        const ref = intent.limitPrice ?? latestPrice;
        if (ref && ref > 0) {
          const sl =
            intent.side === "buy"
              ? ref * (1 - intent.stopPercent / 100)
              : ref * (1 + intent.stopPercent / 100);
          $tradeStopLoss = sl.toFixed(4);
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
    expectedLiveExecutionEpoch: number,
    latestBlockhash?: {
      blockhash: string;
      lastValidBlockHeight: number;
    },
    stageKey?: string,
  ): Promise<string> {
    assertLiveExecutionEpoch(expectedLiveExecutionEpoch);
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
    assertLiveExecutionEpoch(expectedLiveExecutionEpoch);
    beginLiveSignerInvocation();
    try {
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
    } finally {
      endLiveSignerInvocation();
    }
  }

  // ── Add funds (receive + Jupiter swap) ────────────────────────────
  // QR generation + swap-quote state live in components/FundsModal.svelte;
  // the swap SUBMIT stays here (signing plumbing: simulateConfirmAndSend).
  function openFunds(): void {
    if (paperMode) {
      paperFundsOpen = true;
      return;
    }
    fundsOpen = true;
    fundsTab = "receive";
    if ($privyAuth.walletAddress) void refreshWalletBalance($privyAuth.walletAddress);
  }

  async function performSwap(quote: JupiterQuote): Promise<string> {
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
    const address = $privyAuth.walletAddress;
    if (!address) throw new Error("wallet-not-connected");
    const amount = quote.inSol;
    const base64 = await getJupiterSwapTransaction(quote.raw, address);
    const trade = await tradeModule();
    const transaction = trade.deserializeBase64Tx(base64);
    const connection = trade.createSolanaConnection(solanaRpcUrl());
    const signature = await simulateConfirmAndSend(transaction, connection, {
      title: "Swap SOL to USDC",
      details: [
        `Spend: ${formatNumber(amount, 4)} SOL`,
        `Receive est.: ${formatNumber(quote.outUsdc, 2)} USDC`,
        `Price impact: ${(quote.priceImpactPct * 100).toFixed(2)}%`,
      ],
      feePayer: address,
    }, expectedLiveExecutionEpoch);
    track("swap_confirmed", { ...marketContext(), inSol: amount, outUsdc: quote.outUsdc ?? null });
    void refreshWalletBalance(address);
    return signature;
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
        if (paperMode) {
          pendingSpotAssetId = null;
        } else {
          // Restored pref/deep-link — keep the restored asset, don't remap.
          setTradeMode("spot", false);
        }
      }
    } catch {
      // catalog hiccup — keep last list
    }
  }

  function setTradeMode(mode: "perps" | "spot", followAsset = true): void {
    if (mode === "spot" && paperMode) {
      pendingTradeMode = null;
      pendingSpotAssetId = null;
      spotSignature = "";
      $spotQuoteStatus = "error";
      $spotQuoteError = "Spot trading is disabled in PAPER mode.";
      return;
    }
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
      // Click-to-trade is perp-only — the armed crosshair must not survive
      // onto the spot surface.
      disarmClickTrade();
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
          $spotQuote = null;
          $spotQuoteStatus = "idle";
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
    if (paperMode) {
      pendingTradeMode = null;
      pendingSpotAssetId = null;
      spotSignature = "";
      $spotQuoteStatus = "error";
      $spotQuoteError = "Spot trading is disabled in PAPER mode.";
      return;
    }
    const changed = spotAsset?.assetId !== asset.assetId;
    spotAsset = asset;
    $spotQuote = null;
    $spotQuoteStatus = "idle";
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

  // ── Spot size chips ────────────────────────────────────────────────
  // % of wallet USDC on buy, % of the token holding on sell — the same
  // balances that power the ticket preview. Max buy keeps the $0.01 dust
  // buffer the perp Max chip leaves. (The offered percentages live in
  // SpotTicketForm.svelte; the chip math stays here with the balances.)
  $: spotChipBalance = $spotSide === "buy" ? (usdcBalanceValue ?? 0) : spotHolding;

  function setSpotAmountChip(pct: number | "max"): void {
    const amount =
      pct === "max"
        ? $spotSide === "buy"
          ? Math.max(0, spotChipBalance - 0.01)
          : spotChipBalance
        : (pct / 100) * spotChipBalance;
    if (amount <= 0) return;
    if ($spotSide === "buy") {
      $spotAmount = amount.toFixed(2);
    } else if (pct === "max") {
      // Max sell floors at fmtTriggerPrice's precision — round-half-up
      // could format above the real holding and the sell would fail
      // simulation with insufficient funds. 25/50% keep round formatting;
      // the remaining balance absorbs the half-ULP overage.
      const p = amount >= 1000 ? 1 : amount >= 10 ? 2 : amount >= 1 ? 3 : 5;
      $spotAmount = (Math.floor(amount * 10 ** p) / 10 ** p).toFixed(p);
    } else {
      $spotAmount = fmtTriggerPrice(amount);
    }
    scheduleSpotQuote();
  }

  async function executeSpotSwap(): Promise<void> {
    if (paperMode) {
      $spotQuoteStatus = "error";
      $spotQuoteError = "Spot trading is disabled in PAPER mode.";
      return;
    }
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
    const address = $privyAuth.walletAddress;
    const asset = spotAsset;
    if (!asset || !$spotQuote || !address || spotBusy || walletScreen.flagged) return;
    // Freshness gate: never execute a quote older than 30s — re-quote instead.
    if (Date.now() - spotTicket.quotedAtMs() > 30_000) {
      scheduleSpotQuote();
      return;
    }
    spotBusy = true;
    $spotQuoteError = "";
    try {
      const base64 = await getSpotSwapTransaction($spotQuote.raw, address);
      const trade = await tradeModule();
      const transaction = trade.deserializeBase64Tx(base64);
      const connection = trade.createSolanaConnection(solanaRpcUrl());
      spotSignature = await simulateConfirmAndSend(transaction, connection, {
        title: `${$spotSide === "buy" ? "Buy" : "Sell"} ${asset.symbol}`,
        details: [
          `Venue: Jupiter spot route`,
          `Amount: ${formatNumber(Number($spotAmount), 4)}`,
          `Receive est.: ${formatNumber($spotQuote.outUi, $spotSide === "buy" ? 4 : 2)} ${$spotSide === "buy" ? asset.symbol : "USDC"}`,
          `Price impact: ${($spotQuote.priceImpactPct * 100).toFixed(2)}%`,
        ],
        feePayer: address,
      }, expectedLiveExecutionEpoch);
      noteTrade({
        ts: Date.now(),
        mode: "live",
        venue: "spot",
        symbol: asset.symbol,
        action: $spotSide,
        notionalUsd:
          $spotSide === "buy" ? Number($spotAmount) || null : ($spotQuote?.outUi ?? null),
        price: asset.price,
        leverage: null,
        signature: spotSignature,
      });
      void refreshWalletBalance(address);
      void refreshTokenBalances(address);
      spotTicket.invalidateQuote(); // a late in-flight quote must not re-arm the button
    } catch (error) {
      $spotQuoteStatus = "error";
      $spotQuoteError = error instanceof Error ? error.message : "swap-failed";
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

  async function ensurePhoenixOnboarding(
    authority: string,
    expectedLiveExecutionEpoch = liveExecutionEpoch,
  ): Promise<void> {
    if (paperMode) throw new Error("Phoenix onboarding is LIVE-only; PAPER never signs.");
    assertLiveExecutionEpoch(expectedLiveExecutionEpoch);
    if (!authority || onboardedAddress === authority) return;
    onboardedAddress = authority;
    try {
      const access = await (await tradeModule()).checkPhoenixAccess(authority);
      phoenixWhitelisted = access.whitelisted;
    } catch {
      phoenixWhitelisted = null;
    }
    assertLiveExecutionEpoch(expectedLiveExecutionEpoch);
    // Referral onboarding: once per wallet, best-effort, never blocks market reads.
    try {
      const done = JSON.parse(
        window.localStorage.getItem(ONBOARD_KEY) ?? "[]",
      ) as string[];
      if (done.includes(authority)) return;
      const signLiveReferralTransaction: typeof signSolanaTransaction = async (
        transaction,
      ) => {
        assertLiveExecutionEpoch(expectedLiveExecutionEpoch);
        return await signSolanaTransaction(transaction);
      };
      // Hold the in-flight flag across the WHOLE referral flow, not just the
      // sign step: Phoenix submits the delegated transaction AFTER the local
      // signature returns, so the mode switch must stay blocked until that
      // submission resolves — otherwise a switch-to-PAPER could land between
      // sign and send while a real transaction is still in flight.
      beginLiveSignerInvocation();
      let result: Awaited<
        ReturnType<Awaited<ReturnType<typeof tradeModule>>["activatePhoenixReferral"]>
      >;
      try {
        result = await (await tradeModule()).activatePhoenixReferral(
          authority,
          solanaRpcUrl(),
          signLiveReferralTransaction,
        );
      } finally {
        endLiveSignerInvocation();
      }
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
    } catch (error) {
      // wallet declined the signature or transient failure — retry next visit
      onboardedAddress = "";
      if (error instanceof Error && error.message === LIVE_MODE_ABORT_ERROR) {
        throw error;
      }
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
      const trade = await tradeModule();
      const [state, chainCollateralUsd] = await Promise.all([
        trade.fetchPhoenixTraderState(authority),
        trade.fetchOnChainCollateralUsd(solanaRpcUrl(), authority),
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
      // Never sample equity in PAPER: accountEquityUsd is then the simulated
      // ledger's equity, and recording it under the real wallet authority
      // would poison the live Day P&L baseline/history (persisted per wallet).
      if (!paperMode && authority === phoenixAuthority) {
        recordEquitySample(authority, accountEquityUsd);
      }
    } catch {
      // transient API hiccup — keep last state
    }
  }

  async function signAndSendPhoenixIxs(
    instructions: import("@solana/web3.js").TransactionInstruction[],
    summary: TransactionSummary,
    expectedLiveExecutionEpoch: number,
    stageKey?: string,
  ): Promise<string> {
    assertLiveExecutionEpoch(expectedLiveExecutionEpoch);
    const { transaction, connection, latestBlockhash } =
      await (await tradeModule()).buildSignableTransaction(
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
      expectedLiveExecutionEpoch,
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
    if (raw === LIVE_MODE_ABORT_ERROR) {
      return { text: raw, retriable: false, confirmUncertain: false, detail: "" };
    }
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

  function notePaperEvents(events: PaperEvent[]): void {
    for (const event of events) {
      noteTrade({
        ts: Date.now(),
        mode: "paper",
        venue: "perp",
        symbol: event.symbol,
        action:
          event.kind === "close" || event.kind === "tp" || event.kind === "sl" || event.kind === "liq"
            ? "close"
            : event.side === "bid"
              ? "long"
              : "short",
        notionalUsd: event.notionalUsd,
        price: event.price,
        leverage: event.leverage,
        signature: event.signature,
      });
      if (event.kind === "tp" || event.kind === "sl" || event.kind === "liq") {
        alertsStore.pushToast({
          ts: Date.now(),
          title:
            event.kind === "tp"
              ? "Paper take profit"
              : event.kind === "sl"
                ? "Paper stop loss"
                : "Paper liquidation",
          body: `${event.symbol} @ ${formatPrice(event.price)}`,
        });
      }
    }
  }

  function applyPaperMids(): void {
    if (!paperMode) return;
    const ticked = tickPaperLedger($paperLedger, paperExecutableMarks, nowMs);
    if (ticked.events.length === 0 && ticked.ledger === $paperLedger) return;
    paperLedger.set(ticked.ledger);
    notePaperEvents(ticked.events);
  }

  $: if (paperMode) {
    paperExecutableMarks;
    nowMs;
    applyPaperMids();
  }

  function togglePaperMode(): void {
    if (liveSignerInFlight) {
      phoenixActionError =
        "Wallet signing is already in progress — finish or reject it before switching PAPER/LIVE.";
      phoenixActionErrorDetail = "";
      phoenixActionRetry = null;
      alertsStore.pushToast({
        ts: Date.now(),
        title: "Mode switch blocked",
        body: "Finish or reject the wallet signature first.",
      });
      return;
    }
    paperMode = !paperMode;
    if (paperMode) enterPaperSafetyBoundary();
    else exitPaperSafetyBoundary();
    track("paper_mode_toggled", { paperMode });
  }

  function resetPaperAccount(): void {
    paperLedger.set(resetPaperLedger());
    pendingOrder = null;
    alertsStore.pushToast({
      ts: Date.now(),
      title: "Paper reset",
      body: `Balance restored to $${PAPER_STARTING_BALANCE.toLocaleString()} USDC`,
    });
  }

  function topUpPaperAccount(amount = 1_000): void {
    paperLedger.set(topUpPaperCash($paperLedger, amount));
    alertsStore.pushToast({
      ts: Date.now(),
      title: "Paper top-up",
      body: `+$${amount.toLocaleString()} USDC`,
    });
  }

  function flattenPaperPositions(): void {
    const marks = new Map<string, PaperMark>();
    for (const position of $paperLedger.positions) {
      const mark = freshPaperMark(position.symbol);
      if (!mark) {
        showPaperFreshPriceUnavailable();
        return;
      }
      marks.set(position.symbol, mark);
    }
    let next = $paperLedger;
    const events: PaperEvent[] = [];
    for (const position of [...next.positions]) {
      const mark = marks.get(position.symbol);
      if (!mark) {
        showPaperFreshPriceUnavailable();
        return;
      }
      const closed = closePaperPosition(
        next,
        position.symbol,
        position.subaccountIndex,
        1,
        mark.price,
        "close",
      );
      next = closed.ledger;
      if (closed.event) events.push(closed.event);
    }
    paperLedger.set(next);
    notePaperEvents(events);
  }

  async function submitPaperOrder(): Promise<void> {
    const symbol = selectedSymbol;
    const busyKey = `order:${symbol}`;
    if (phoenixBusyKeys.has(busyKey) || !$tradePreview) return;
    const preview = $tradePreview;
    const orderType = $tradeType;
    const leverage = $tradeLeverage;
    const reduceOnly = $tradeReduceOnly && selectedPosition !== null;
    const limitPrice = Number($tradeLimitPrice);
    let refPrice: number;
    if (orderType === "limit") {
      if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
        phoenixActionError = "Enter a valid paper limit price.";
        phoenixActionErrorDetail = "";
        phoenixActionRetry = null;
        return;
      }
      refPrice = limitPrice;
    } else {
      const mark = freshPaperMark(symbol);
      if (!mark) {
        showPaperFreshPriceUnavailable();
        return;
      }
      refPrice = mark.price;
    }
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    try {
      const side: PhoenixSide = $tradeSide === "buy" ? "bid" : "ask";
      const tp = Number($tradeTakeProfit);
      const sl = Number($tradeStopLoss);
      const takeProfitPrice = Number.isFinite(tp) && tp > 0 ? tp : null;
      const stopLossPrice = Number.isFinite(sl) && sl > 0 ? sl : null;
      const result = placePaperOrder($paperLedger, {
        symbol,
        side,
        orderType,
        notionalUsd: preview.notionalUsd,
        leverage,
        price: refPrice,
        takeProfitPrice,
        stopLossPrice,
        reduceOnly,
      });
      paperLedger.set(result.ledger);
      notePaperEvents(result.events);
      lastOrderIntent = {
        symbol,
        side: $tradeSide,
        type: orderType,
        amount: $tradeAmount,
        leverage,
        limitPrice: $tradeLimitPrice,
        tp: $tradeTakeProfit,
        sl: $tradeStopLoss,
      };
      lastTradeSignature =
        result.events[0]?.signature ??
        result.ledger.orders.at(-1)?.orderSequenceNumber ??
        "paper-order";
      tradeOpen = false;
      if (orderType === "limit" && result.events.length === 0) {
        alertsStore.pushToast({
          ts: Date.now(),
          title: "Paper limit resting",
          body: `${symbol} @ ${formatPrice(refPrice)}`,
        });
      }
      track("paper_order_submitted", {
        ...marketContext(),
        side,
        orderType,
        notionalUsd: preview.notionalUsd,
        leverage,
      });
    } catch (error) {
      phoenixActionError =
        error instanceof Error ? error.message : "paper-order-failed";
      phoenixActionRetry = () => void submitPaperOrder();
    } finally {
      setPhoenixBusy(busyKey, false);
    }
  }

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
    // Snapshot the ticket inputs now — on confirm they become the
    // repeat-last intent exactly as sent, even if edited mid-flight.
    const intentSnapshot = {
      symbol,
      side: $tradeSide,
      type: $tradeType,
      amount: $tradeAmount,
      leverage: $tradeLeverage,
      limitPrice: $tradeLimitPrice,
      tp: $tradeTakeProfit,
      sl: $tradeStopLoss,
    };
    if (paperMode || !phoenixAuthority || phoenixBusyKeys.has(busyKey) || !$tradePreview) return;
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
    // Freeze the ticket state before the first await — inputs stay editable
    // while the tx confirms, so a live read after an await could describe a
    // different order than the one submitted (or throw once the $:-derived
    // $tradePreview turns null mid-flight).
    const preview = $tradePreview;
    const orderType = $tradeType;
    const leverage = $tradeLeverage;
    const reduceOnly = $tradeReduceOnly && selectedPosition !== null;
    const entry = preview.entry ?? latestPrice;
    if (!entry || entry <= 0) return;
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    lastTradeSignature = "";
    const preFingerprint = snapshotFingerprint();
    try {
      const side: PhoenixSide = $tradeSide === "buy" ? "bid" : "ask";
      const limitPrice = Number($tradeLimitPrice);
      const refPrice =
        orderType === "limit" && Number.isFinite(limitPrice) && limitPrice > 0
          ? limitPrice
          : entry;
      const quantity = preview.notionalUsd / refPrice;
      // Phoenix-native TP/SL trigger prices, validated against the side so a
      // mis-placed trigger can't slip through.
      const tp = Number($tradeTakeProfit);
      const sl = Number($tradeStopLoss);
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
      const trade = await tradeModule();
      const registerIxs = await trade.ensureTraderRegisteredIxs(
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
        sizingMode: $sizingMode,
        reduceOnly,
        takeProfitPrice,
        stopLossPrice,
        estEntry: preview.entry,
        slippageBps: preview.slippageBps,
        estLiqPrice: preview.liqPrice,
      });
      const plan = await trade.buildPlaceOrderPlan({
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
        expectedLiveExecutionEpoch,
        busyKey,
      );
      track("order_confirmed", {
        ...marketContext(),
        side,
        signature: lastTradeSignature,
      });
      lastOrderIntent = intentSnapshot;
      noteTrade({
        ts: Date.now(),
        mode: "live",
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
    if (paperMode) {
      const mark = freshPaperMark(symbol);
      if (!mark) {
        showPaperFreshPriceUnavailable();
        return;
      }
      const closed = closePaperPosition(
        $paperLedger,
        symbol,
        subaccountIndex,
        fraction,
        mark.price,
        "close",
      );
      paperLedger.set(closed.ledger);
      if (closed.event) notePaperEvents([closed.event]);
      return;
    }
    const busyKey = `close:${symbol}:${subaccountIndex}`;
    if (!phoenixAuthority || phoenixBusyKeys.has(busyKey) || size === 0) return;
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
    const partial = fraction < 1;
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    const preFingerprint = snapshotFingerprint();
    try {
      const plan = await (await tradeModule()).buildPlaceOrderPlan({
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
        expectedLiveExecutionEpoch,
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
        mode: "live",
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
      const exchange = await (await tradeModule()).fetchExchangeConfig();
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
    // Provenance rides the share URL so the /share page and OG card label a
    // simulated result as paper — never present it as a real on-chain trade.
    if (paperMode) params.set("mode", "paper");
    const shareUrl = `${window.location.origin}/share?${params.toString()}`;
    const dir = position.size > 0 ? "Long" : "Short";
    const text = paperMode
      ? `Paper trade: ${dir} ${position.symbol} on Harness (simulated — not real funds)`
      : `${dir} ${position.symbol} on Harness`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`,
      "_blank",
      "noopener",
    );
  }

  async function cancelPhoenixOrders(symbol: string, side: PhoenixSide): Promise<void> {
    if (paperMode) {
      paperLedger.set(cancelPaperOrdersOnSide($paperLedger, symbol, side));
      return;
    }
    const busyKey = `cancel:${symbol}:${side}`;
    if (!phoenixAuthority || phoenixBusyKeys.has(busyKey)) return;
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    const preFingerprint = snapshotFingerprint();
    try {
      const instructions = await (await tradeModule()).buildCancelAllIxs(phoenixAuthority, symbol, side);
      lastTradeSignature = await signAndSendPhoenixIxs(
        instructions,
        {
          title: `Cancel ${symbol}-PERP orders`,
          details: [
            `Venue: Phoenix Perps`,
            `Side: ${side === "bid" ? "bids" : "asks"}`,
          ],
        },
        expectedLiveExecutionEpoch,
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

  // Cancels exactly one resting order (or one stop-loss trigger) — a row's
  // Cancel must never sweep the whole side and take a protective stop with it.
  async function cancelPhoenixOrderById(order: PhoenixOpenOrder): Promise<void> {
    if (paperMode) {
      paperLedger.set(cancelPaperOrder($paperLedger, order.orderSequenceNumber));
      return;
    }
    const busyKey = orderCancelKey(order);
    if (!phoenixAuthority || phoenixBusyKeys.has(busyKey)) return;
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
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
      const instructions = await (await tradeModule()).buildCancelSingleOrderIxs(phoenixAuthority, {
        symbol: order.symbol,
        side: order.side,
        price: order.price,
        orderSequenceNumber: order.orderSequenceNumber,
        isStopLoss: order.isStopLoss,
        isStopLossDirection: order.isStopLossDirection,
        // The order's own subaccount wins: isolated resting orders live on
        // child accounts the owning-position lookup can't see.
        traderPdaIndex: order.traderPdaIndex ?? owner?.traderPdaIndex,
        subaccountIndex: order.subaccountIndex ?? owner?.subaccountIndex,
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
        expectedLiveExecutionEpoch,
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
    if (paperMode) {
      try {
        paperLedger.set(
          addPaperMargin(
            $paperLedger,
            position.symbol,
            position.subaccountIndex,
            amount,
          ),
        );
        marginAddKey = null;
        marginAddValue = "";
      } catch (error) {
        phoenixActionError =
          error instanceof Error ? error.message : "paper-margin-failed";
      }
      return;
    }
    const busyKey = `margin:${position.symbol}:${position.subaccountIndex}`;
    if (
      !phoenixAuthority ||
      phoenixBusyKeys.has(busyKey) ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return;
    }
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    const preFingerprint = snapshotFingerprint();
    const liqDistBefore = liqDistancePctOf(position);
    try {
      const instructions = await (await tradeModule()).buildAddIsolatedMarginIxs(
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
        expectedLiveExecutionEpoch,
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

  // Status-line model: every field already derived here; the tx stage text
  // is pre-rendered because txStageText stays with the signing pipeline
  // (the ticket's order-stage readout shares it).
  $: statusModel = {
    clockMs: nowMs,
    symbol: tradeMode === "perps" ? selectedSymbol : (spotAsset?.symbol ?? "--"),
    selectedSymbol,
    sessionNote,
    streamHealth,
    rpcLatencyMs,
    apiSlotLag,
    lastTx: lastTx
      ? {
          label: lastTx.label,
          failed: lastTx.stage === "failed",
          text: txStageText(lastTx, nowMs),
        }
      : null,
    armedHotkey,
    showMoney: Boolean(phoenixAuthority) || paperMode,
    paperMode,
    equityUsd: accountEquityUsd,
    upnlUsd: accountUpnlUsd,
    freeCollateralUsd: phoenixCollateral,
    fundingPercent,
    walletAddress: $privyAuth.walletAddress ?? "",
  };

  function onFlattenClick(): void {
    if (Date.now() < flattenArmedUntil) {
      flattenArmedUntil = 0;
      if (paperMode) {
        void flattenPaperPositions();
        return;
      }
      void closeAllPhoenixPositions();
    } else {
      flattenArmedUntil = Date.now() + 3_000;
    }
  }

  async function closeAllPhoenixPositions(): Promise<void> {
    if (paperMode) {
      flattenPaperPositions();
      return;
    }
    const positions = enrichedPositions.filter(
      (position) => position.size !== 0,
    );
    const busyKey = "flatten";
    if (!phoenixAuthority || phoenixBusyKeys.has(busyKey) || positions.length === 0) {
      return;
    }
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
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
      const trade = await tradeModule();
      const plans = await Promise.all(
        positions.map((position) =>
          trade.buildPlaceOrderPlan({
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
          expectedLiveExecutionEpoch,
          busyKey,
        );
        confirmedChunks += 1;
        for (const position of chunk) {
          noteTrade({
            ts: Date.now(),
            mode: "live",
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
    if (paperMode) {
      const raw = direction === "deposit" ? depositAmount : withdrawAmount;
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) return;
      try {
        if (direction === "deposit") {
          paperLedger.set(topUpPaperCash($paperLedger, amount));
        } else {
          if ($paperLedger.cashUsd + 1e-9 < amount) {
            throw new Error("Insufficient paper free collateral");
          }
          paperLedger.set({
            ...$paperLedger,
            cashUsd: $paperLedger.cashUsd - amount,
          });
        }
        collateralSignature = `paper-${direction}-${Date.now()}`;
        collateralError = "";
        depositAmount = "";
        withdrawAmount = "";
      } catch (error) {
        collateralError =
          error instanceof Error ? error.message : "paper-collateral-failed";
      }
      return;
    }
    const amount = Number(direction === "deposit" ? depositAmount : withdrawAmount);
    if (!phoenixAuthority || collateralBusy || !Number.isFinite(amount) || amount <= 0) {
      return;
    }
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
    collateralBusy = true;
    collateralError = "";
    collateralSignature = "";
    try {
      const trade = await tradeModule();
      const registerIxs = await trade.ensureTraderRegisteredIxs(
        solanaRpcUrl(),
        phoenixAuthority,
        phoenixTrader?.registered ?? false,
      );
      const instructions =
        direction === "deposit"
          ? await trade.buildDepositIxs(phoenixAuthority, amount)
          : await trade.buildWithdrawIxs(phoenixAuthority, amount);
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
        expectedLiveExecutionEpoch,
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

  // Account-menu open/close handlers live in components/Topbar.svelte;
  // modal Escape-swallowing lives in each modal component.

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

  // Creation-time scroll behavior, named so the measure tool's disarm can
  // restore EXACTLY this (a blanket `handleScroll: true` would silently
  // re-enable vertTouchDrag and let the chart hijack page scrolling).
  const CHART_SCROLL_OPTIONS = {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: false,
  };

  function createChartInstance(): void {
    if (!chartContainer || lwChart) return;
    lwChart = createChart(chartContainer, {
      autoSize: true,
      // Direct manipulation, stated explicitly rather than left to library
      // defaults: drag to pan, wheel/pinch to zoom, drag an axis to scale
      // it, double-click an axis to reset. Vertical touch-drag stays off so
      // the chart never hijacks page scrolling; kinetic momentum is
      // touch-only (mouse panning should stop where you stop).
      handleScroll: CHART_SCROLL_OPTIONS,
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
      // Meme-ready axis: sub-cent prices need the subscript-zero dialect —
      // the default 2dp formatter flat-lines them at 0.00. minMove keeps
      // axis steps meaningful down to 8 decimals.
      priceFormat: {
        type: "custom",
        formatter: (price: number) => formatBookPrice(price),
        minMove: 0.00000001,
      },
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
      // While an armed chart tool owns the pointer the crosshair cursor
      // wins throughout (click-to-trade, ray placement, measure).
      container.style.cursor = chartToolArmed() ? "crosshair" : "grabbing";
      // An armed measure drag must never double as the vertical-pan
      // autoscale-off gesture.
      pressPoint = measureArmed ? null : { x: event.clientX, y: event.clientY };
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
      container.style.cursor = chartToolArmed() ? "crosshair" : "grab";
      pressPoint = null;
    });
    container.addEventListener("mouseleave", () => {
      container.style.cursor = chartToolArmed() ? "crosshair" : "grab";
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
    // The old line handles died with the old series; reset the signature
    // memo so the refresh below applies unconditionally.
    liqLines = [];
    chartLineFullSig = null;
    chartLineStructSig = null;
    // Ray line handles died with the old series too — redraw from prefs.
    rayLines = [];
    applyRayLines(chartedRaySymbol, rays);
    // The draggable TP/SL overlay's lines died with the old series too —
    // drop the stale handles and redraw against the fresh series.
    posOverlayLines = { entry: null, tp: null, sl: null };
    posOverlayPrices = { entry: null, tp: null, sl: null };
    syncPositionOverlay(
      selectedPosition,
      entryLinePrice,
      tpHandlePrice,
      slHandlePrice,
      tradeMode,
    );
    refreshChartLines(
      enrichedPositions,
      perpOpenOrders,
      $alerts,
      $chartLinePrefs,
      selectedSymbol,
      tradeMode,
      lineLabelTick,
    );
  }

  function renderChartSeries(points: MarketPoint[]): void {
    if (!candleSeries || !volumeSeries) return;
    candleSeries.setData(points.map((point) => toCandle(point, priceMode)));
    volumeSeries.setData(points.map(toVolume));
    // Full loads are the immediate structure path — every symbol/timeframe
    // switch, boot paint, gap heal, and spot swap funnels through here.
    recomputeStructureLevels(points);
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
    // Debounced — this is the per-tick hot path; see the scheduler.
    scheduleStructureRecompute();
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
    if (paperMode) {
      paperFundsOpen = true;
      return;
    }
    const shortfall = Math.max(0, $requiredMarginUsd - phoenixCollateral);
    depositAmount = shortfall > 0 ? String(Math.ceil(shortfall)) : "";
    fundsOpen = true;
    fundsTab = "phoenix";
  }

  // Clicking a book level: prefill a limit order at that price in the
  // ticket. Side/type/price only — the book you were reading stays put
  // (desktop stacks the ticket right below it).
  function prefillFromBook(price: number, rowSide: "ask" | "bid"): void {
    perpTicket.prefill(price, rowSide === "ask" ? "sell" : "buy");
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
    // directions can be compared without retyping (the store clears the
    // triggers on a fresh open; size persists in prefs). Errors reset only
    // on a fresh open too.
    const flipOnly = $ticketActive;
    perpTicket.setSide(side);
    if (!flipOnly) {
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
    // Local clones without PUBLIC_PRIVY_APP_ID can't sign in — never open
    // the broken auth modal. Drop into paper instead.
    if (!readPrivyConfig().appId) {
      if (!paperMode) {
        paperMode = true;
        enterPaperSafetyBoundary();
      }
      alertsStore.pushToast({
        ts: Date.now(),
        title: "Paper mode",
        body: "Live auth isn't configured here — trading with simulated funds.",
      });
      return;
    }
    authOpen = true;
  }

  async function disconnectPrivy(): Promise<void> {
    logoutBusy = true;
    try {
      await logoutPrivy();
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
      if (intent.side) $tradeSide = intent.side;
      if (intent.sizeUsd !== null) $tradeAmount = String(intent.sizeUsd);
      if (intent.leverage !== null) $tradeLeverage = intent.leverage;
      if (intent.limitPrice !== null) {
        $tradeType = "limit";
        $tradeLimitPrice = String(intent.limitPrice);
      } else if (intent.orderType) {
        $tradeType = intent.orderType;
      }
      if (intent.takeProfit !== null) $tradeTakeProfit = String(intent.takeProfit);
      if (intent.stopLoss !== null) $tradeStopLoss = String(intent.stopLoss);
    } else if (intent.venue === "spot" && !paperMode) {
      pendingTradeMode = "spot";
      if (intent.spotAssetId) pendingSpotAssetId = intent.spotAssetId;
      if (intent.side) $spotSide = intent.side;
      if (intent.sizeUsd !== null) $spotAmount = String(intent.sizeUsd);
      if (intent.limitPrice !== null) {
        $spotOrderType = "limit";
        $spotLimitPrice = String(intent.limitPrice);
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
  // alerts. Toggleable per group, persisted per device.
  //
  // Signature memo: enrichedPositions gets a fresh array identity on every
  // WS event that touches price, so this runs at book-update rate — but
  // tearing down and recreating every price line invalidates the pane per
  // line. Only touch the series when the rendered output would change.
  // Structural changes (position open/close, order place/cancel, alert
  // arm/fire, prefs, symbol, mode, prices) apply immediately; a change to
  // the uPnL entry-label alone waits for the 2 s lineLabelTick — the label
  // cadence that tick dependency always intended.
  function refreshChartLines(
    positions: PhoenixPosition[],
    orders: PhoenixOpenOrder[],
    armed: Alert[],
    prefs: { pos: boolean; tpsl: boolean; orders: boolean; alerts: boolean },
    symbol: string,
    mode: "perps" | "spot",
    labelTick: number,
  ): void {
    const series = candleSeries;
    if (!series) return;
    const specs = buildChartLineSpecs(
      positions,
      orders,
      armed,
      prefs,
      symbol,
      mode,
    );
    const fullSig = chartLineSignature(specs);
    if (fullSig === chartLineFullSig) return; // nothing rendered changed
    // The only tick-varying rendered value is the uPnL suffix in the entry
    // label (already rounded to label precision inside the spec title).
    // Rebuild the specs with uPnL blanked to detect label-only drift
    // without duplicating the builder's filtering rules.
    const structSig = chartLineSignature(
      buildChartLineSpecs(
        positions.map((position) =>
          position.unrealizedPnl === null
            ? position
            : { ...position, unrealizedPnl: null },
        ),
        orders,
        armed,
        prefs,
        symbol,
        mode,
      ),
    );
    if (structSig === chartLineStructSig && labelTick === chartLineTick) {
      return; // uPnL label drift only — hold until the next 2 s tick
    }
    for (const line of liqLines) series.removePriceLine(line);
    liqLines = [];
    for (const spec of specs) liqLines.push(series.createPriceLine(spec));
    chartLineFullSig = fullSig;
    chartLineStructSig = structSig;
    chartLineTick = labelTick;
  }

  function chartLineSignature(specs: PriceLineSpec[]): string {
    let sig = "";
    for (const spec of specs) {
      sig += `${spec.price}|${spec.color}|${spec.lineWidth}|${spec.lineStyle}|${spec.axisLabelVisible}|${spec.title}\n`;
    }
    return sig;
  }

  // ── Structure levels: PDH/PDL + swing pivots, drawn quietly ─────────
  const STRUCTURE_DEBOUNCE_MS = 2_000;

  // Immediate path: full data loads only (symbol/timeframe switch, boot,
  // gap heal, spot swaps) plus the footer toggle — infrequent by nature.
  function recomputeStructureLevels(points: MarketPoint[]): void {
    structLevels = structureLevels(
      points,
      GHOST_DEFAULTS.swingWindow,
      Date.now(),
    );
    applyStructureLines();
  }

  // Tick path: the websocket can update the live candle many times a
  // second, but swing pivots and PDH/PDL barely move within a bar — arm a
  // single trailing 2 s timer and recompute once when it fires. Never
  // recompute per tick.
  function scheduleStructureRecompute(): void {
    if (structureTimer !== null) return; // already armed — coalesce
    structureTimer = setTimeout(() => {
      structureTimer = null;
      recomputeStructureLevels(
        tradeMode === "spot" ? spotChartPoints : chartPoints,
      );
    }, STRUCTURE_DEBOUNCE_MS);
  }

  function applyStructureLines(): void {
    const series = candleSeries;
    if (!series) return;
    // Remove before re-adding — stale handles must never leak duplicates.
    for (const line of structureLines) series.removePriceLine(line);
    structureLines = [];
    if (!showLevels) return;
    for (const spec of buildStructureLineSpecs(structLevels)) {
      structureLines.push(series.createPriceLine(spec));
    }
  }

  // ── Click-to-trade: armed crosshair → one-shot limit prefill ────────
  // Perp-only. Subscribe on arm, unsubscribe on disarm — the unarmed path
  // registers nothing. The follow line is ONE reusable price-line handle
  // (created on first hover, applyOptions per move, removed on disarm) —
  // never created/removed per crosshair move.
  function armClickTrade(): void {
    if (clickTradeArmed || tradeMode !== "perps" || !lwChart) return;
    disarmChartTools();
    clickTradeArmed = true;
    lwChart.subscribeCrosshairMove(onClickTradeCrosshair);
    lwChart.subscribeClick(onClickTradeClick);
    if (chartContainer) chartContainer.style.cursor = "crosshair";
  }

  function disarmClickTrade(): void {
    if (!clickTradeArmed) return;
    clickTradeArmed = false;
    lwChart?.unsubscribeCrosshairMove(onClickTradeCrosshair);
    lwChart?.unsubscribeClick(onClickTradeClick);
    removeClickTradeLine();
    if (chartContainer) chartContainer.style.cursor = "grab";
  }

  function removeClickTradeLine(): void {
    if (clickTradeLine && candleSeries) {
      candleSeries.removePriceLine(clickTradeLine);
    }
    clickTradeLine = null;
    clickTradeHover = null;
  }

  // Hovered PRICE from the crosshair's y coordinate — valid only over the
  // plot area with a live mark to preview the side against.
  function clickTradeHoverPrice(param: MouseEventParams): number | null {
    if (!param.point || !candleSeries || latestPrice === null) return null;
    const price = Number(candleSeries.coordinateToPrice(param.point.y));
    return Number.isFinite(price) && price > 0 ? price : null;
  }

  function onClickTradeCrosshair(param: MouseEventParams): void {
    const price = clickTradeHoverPrice(param);
    if (price === null || latestPrice === null || !param.point) {
      // Left the plot (or no mark yet): hide the preview, keep armed.
      removeClickTradeLine();
      return;
    }
    if (clickTradeLine) {
      clickTradeLine.applyOptions({ price });
    } else if (candleSeries) {
      clickTradeLine = candleSeries.createPriceLine({
        price,
        color: colors.muted,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "",
      });
    }
    clickTradeHover = {
      y: param.point.y,
      right: (lwChart?.priceScale("right").width() ?? 0) + 6,
      label: clickTradeLabel(price, latestPrice),
    };
  }

  function onClickTradeClick(param: MouseEventParams): void {
    // Alt+click stays the set-alert gesture even while armed.
    if (param.sourceEvent?.altKey) return;
    const mark = latestPrice;
    const price = clickTradeHoverPrice(param);
    if (price === null || mark === null || tradeMode !== "perps") return;
    // One-shot fill: limit ticket at the hovered price, side per the
    // long-at-or-below / short-above rule. NOTHING submits — the trader
    // lands on the size input with the order staged.
    $tradeType = "limit";
    $tradeLimitPrice = fmtTriggerPrice(price);
    $tradeSide = clickTradeSide(price, mark) === "long" ? "buy" : "sell";
    disarmClickTrade();
    focusTicketSize();
  }

  // Any armed chart tool → the crosshair cursor owns the plot.
  function chartToolArmed(): boolean {
    return clickTradeArmed || rayArmed || measureArmed;
  }

  // Armed chart tools are mutually exclusive — one crosshair, one intent.
  // Every arm path disarms the others through here; each disarm is a no-op
  // when its tool is not armed (including the caller's own, still unarmed).
  function disarmChartTools(): void {
    disarmClickTrade();
    disarmRay();
    disarmMeasure();
  }

  // ── Horizontal rays: armed click places/removes a persisted line ────
  // Venue-agnostic drawings keyed by the CHARTED symbol (perp market or
  // spot asset). One-shot arming; the click subscription exists only while
  // armed, and the line set is empty for symbols without rays.
  $: chartedRaySymbol =
    tradeMode === "spot"
      ? (spotAsset?.symbol.toUpperCase() ?? null)
      : selectedSymbol;
  // Reapply on symbol/mode switches and every rays mutation. Timeframe
  // switches setData on the same series, so the lines simply survive.
  $: applyRayLines(chartedRaySymbol, rays);

  function applyRayLines(
    symbol: string | null,
    bySymbol: Record<string, number[]>,
  ): void {
    const series = candleSeries;
    if (!series) return;
    // Remove before re-adding — stale handles must never leak duplicates.
    for (const line of rayLines) series.removePriceLine(line);
    rayLines = [];
    const prices = symbol ? (bySymbol[symbol] ?? []) : [];
    for (const price of prices) {
      rayLines.push(series.createPriceLine(rayLineSpec(price)));
    }
  }

  function armRay(): void {
    if (rayArmed || !lwChart || !chartedRaySymbol) return;
    disarmChartTools();
    rayArmed = true;
    lwChart.subscribeClick(onRayClick);
    if (chartContainer) chartContainer.style.cursor = "crosshair";
  }

  function disarmRay(): void {
    if (!rayArmed) return;
    rayArmed = false;
    lwChart?.unsubscribeClick(onRayClick);
    if (chartContainer) chartContainer.style.cursor = "grab";
  }

  function onRayClick(param: MouseEventParams): void {
    // Alt+click stays the set-alert gesture even while armed.
    if (param.sourceEvent?.altKey) return;
    const symbol = chartedRaySymbol;
    if (!param.point || !candleSeries || !symbol) return;
    const price = Number(candleSeries.coordinateToPrice(param.point.y));
    if (!Number.isFinite(price) || price <= 0) return;
    const existing = rays[symbol] ?? [];
    const hit = nearestRay(existing, price, RAY_TOLERANCE_PCT);
    const next = { ...rays };
    if (hit !== null) {
      // Click landed on an existing ray (nearest within ±0.5%): remove
      // that one occurrence instead of stacking a near-duplicate.
      const index = existing.indexOf(hit);
      const remaining = existing.filter((_, i) => i !== index);
      if (remaining.length > 0) next[symbol] = remaining;
      else delete next[symbol];
    } else {
      // Append newest-last; the slice evicts the oldest at the cap (FIFO).
      next[symbol] = [...existing, price].slice(-RAYS_PER_SYMBOL_CAP);
    }
    rays = next; // reactive: reapplies lines + persists via prefs
    disarmRay(); // one-shot — place/remove, then back to normal
  }

  // ── Measure tool: armed drag → Δ/%/bars chip near the cursor ────────
  // Chart scroll is suspended while armed so the drag measures instead of
  // panning; bars come from the time scale's logical indices
  // (coordinateToLogical), so the delta IS the bar count.
  const MEASURE_LINGER_MS = 2_000;

  $: measureChip = measure
    ? measureParts(measure.p1, measure.p2, measure.bars)
    : null;

  function armMeasure(): void {
    if (measureArmed || !lwChart || !chartContainer) return;
    disarmChartTools();
    measureArmed = true;
    lwChart.applyOptions({ handleScroll: false });
    chartContainer.addEventListener("pointerdown", onMeasureDown);
    chartContainer.addEventListener("pointermove", onMeasureMove);
    chartContainer.addEventListener("pointerup", onMeasureUp);
    chartContainer.addEventListener("pointercancel", onMeasureCancel);
    chartContainer.style.cursor = "crosshair";
  }

  function disarmMeasure(): void {
    clearMeasure();
    if (!measureArmed) return;
    measureArmed = false;
    lwChart?.applyOptions({ handleScroll: CHART_SCROLL_OPTIONS });
    if (chartContainer) {
      chartContainer.removeEventListener("pointerdown", onMeasureDown);
      chartContainer.removeEventListener("pointermove", onMeasureMove);
      chartContainer.removeEventListener("pointerup", onMeasureUp);
      chartContainer.removeEventListener("pointercancel", onMeasureCancel);
      chartContainer.style.cursor = "grab";
    }
  }

  function clearMeasure(): void {
    if (measureLingerTimer !== null) {
      clearTimeout(measureLingerTimer);
      measureLingerTimer = null;
    }
    measure = null;
  }

  function onMeasureDown(event: PointerEvent): void {
    // Alt+click stays the set-alert gesture even while armed.
    if (event.altKey || !candleSeries || !lwChart || !chartContainer) return;
    const rect = chartContainer.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const price = Number(candleSeries.coordinateToPrice(y));
    const logical = lwChart.timeScale().coordinateToLogical(x);
    if (!Number.isFinite(price) || price <= 0 || logical === null) return;
    clearMeasure(); // a fresh press replaces any lingering chip
    event.preventDefault();
    chartContainer.setPointerCapture(event.pointerId);
    measure = {
      pointerId: event.pointerId,
      p1: price,
      p2: price,
      startLogical: logical,
      bars: 0,
      x,
      y,
      moved: false,
      done: false,
    };
  }

  function onMeasureMove(event: PointerEvent): void {
    const active = measure;
    if (!active || active.done || event.pointerId !== active.pointerId) return;
    if (!candleSeries || !lwChart || !chartContainer) return;
    const rect = chartContainer.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const price = Number(candleSeries.coordinateToPrice(y));
    const logical = lwChart.timeScale().coordinateToLogical(x);
    if (!Number.isFinite(price) || price <= 0 || logical === null) return;
    // Reassign, never mutate: the chip derives from this state.
    measure = {
      ...active,
      p2: price,
      bars: Math.abs(Math.round(logical - active.startLogical)),
      x,
      y,
      moved: true,
    };
  }

  function onMeasureUp(event: PointerEvent): void {
    const active = measure;
    if (!active || active.done || event.pointerId !== active.pointerId) return;
    if (!active.moved) {
      clearMeasure(); // a click, not a drag — nothing measured, no chip
      return;
    }
    measure = { ...active, done: true };
    measureLingerTimer = setTimeout(() => {
      measureLingerTimer = null;
      measure = null;
    }, MEASURE_LINGER_MS);
  }

  function onMeasureCancel(event: PointerEvent): void {
    if (measure && !measure.done && event.pointerId === measure.pointerId) {
      clearMeasure();
    }
  }

  // ── Draggable TP/SL overlay: the open position drawn on the chart ───
  // Entry line (muted, not draggable) whenever the charted perp position
  // exists; TP/SL lines with DOM grab handles ONLY when the position has
  // that trigger set on-chain — dragging EDITS existing triggers, adding
  // new ones by drag is out of scope (the ticket sets them at order time).
  // Footer prefs keep their meaning: POS gates entry, TP/SL gates triggers.
  // No position on the charted symbol → zero lines, zero rAF, zero
  // subscriptions (the handles are the only event surface).

  // Line/handle price per trigger: live drag preview wins, then an
  // in-flight (submitted, indexer-lagging) edit, then chain state.
  function tpslOverlayPrice(
    kind: TpSlKind,
    drag: typeof tpslDrag,
    pending: typeof tpslPending,
    position: PhoenixPosition | null,
    mode: "perps" | "spot",
    enabled: boolean,
  ): number | null {
    if (mode !== "perps" || !enabled || !position) return null;
    const trigger =
      kind === "tp" ? position.takeProfitPrice : position.stopLossPrice;
    if (trigger === null) return null; // no trigger → no line, no handle
    if (drag?.kind === kind) return drag.price;
    if (pending?.kind === kind) return pending.price;
    return trigger;
  }

  $: entryLinePrice =
    tradeMode === "perps" && $chartLinePrefs.pos && selectedPosition
      ? selectedPosition.entryPrice
      : null;
  $: tpHandlePrice = tpslOverlayPrice(
    "tp",
    tpslDrag,
    tpslPending,
    selectedPosition,
    tradeMode,
    $chartLinePrefs.tpsl,
  );
  $: slHandlePrice = tpslOverlayPrice(
    "sl",
    tpslDrag,
    tpslPending,
    selectedPosition,
    tradeMode,
    $chartLinePrefs.tpsl,
  );
  $: syncPositionOverlay(
    selectedPosition,
    entryLinePrice,
    tpHandlePrice,
    slHandlePrice,
    tradeMode,
  );

  // An in-flight edit's preview clears the moment the indexer reports a
  // trigger different from the pre-drag one (fmtTriggerPrice equality — the
  // chain quantizes to tick size, exact float match would never clear), the
  // trigger disappears, or the 25 s horizon passes. Only then does chain
  // state own the line again.
  $: if (tpslPending) {
    const confirmed = selectedPosition
      ? tpslPending.kind === "tp"
        ? selectedPosition.takeProfitPrice
        : selectedPosition.stopLossPrice
      : null;
    if (
      nowMs >= tpslPending.until ||
      confirmed === null ||
      fmtTriggerPrice(confirmed) !== fmtTriggerPrice(tpslPending.from)
    ) {
      tpslPending = null;
    }
  }

  function syncPositionOverlay(
    position: PhoenixPosition | null,
    entryPrice: number | null,
    tpPrice: number | null,
    slPrice: number | null,
    mode: "perps" | "spot",
  ): void {
    const series = candleSeries;
    if (!series) return;
    const specs =
      mode === "perps" && position ? positionLineSpecs(position) : [];
    const prices: Record<PositionLineKind, number | null> = {
      entry: entryPrice,
      tp: tpPrice,
      sl: slPrice,
    };
    for (const kind of ["entry", "tp", "sl"] as const) {
      const spec = specs.find((candidate) => candidate.kind === kind);
      const price = spec ? prices[kind] : null;
      const held = posOverlayLines[kind];
      if (spec === undefined || price === null) {
        if (held) {
          series.removePriceLine(held);
          posOverlayLines[kind] = null;
          posOverlayPrices[kind] = null;
        }
        // Position/trigger vanished mid-drag (closed, symbol or mode
        // switch) — drop the drag rather than edit a ghost.
        if (tpslDrag?.kind === kind) tpslDrag = null;
        continue;
      }
      if (held) {
        // Option-update only (styles are static per kind); the price memo
        // keeps WS-rate reruns from repainting an unchanged line.
        if (posOverlayPrices[kind] !== price) {
          held.applyOptions({ price });
          posOverlayPrices[kind] = price;
        }
      } else {
        posOverlayLines[kind] = series.createPriceLine({
          price,
          color: spec.color,
          lineWidth: spec.lineWidth,
          lineStyle: spec.lineStyle,
          axisLabelVisible: spec.axisLabelVisible,
          title: spec.title,
        });
        posOverlayPrices[kind] = price;
      }
    }
    // The reposition loop exists ONLY while a draggable handle is on
    // screen; it dies with the last TP/SL line.
    const needsFrame =
      posOverlayLines.tp !== null || posOverlayLines.sl !== null;
    if (needsFrame && tpslFrame === null) {
      tpslFrame = requestAnimationFrame(tpslFrameTick);
    } else if (!needsFrame && tpslFrame !== null) {
      cancelAnimationFrame(tpslFrame);
      tpslFrame = null;
    }
  }

  // Handle repositioning mechanism: lightweight-charts v5 exposes NO
  // price-scale change hook (typings checked — only timeScale
  // visible-range/size and series dataChanged; a manual price-axis rescale
  // or an autoscale shift from a live tick fires none of them), so a rAF
  // loop owns handle geometry while handles exist. Cost: ≤2
  // priceToCoordinate calls (pure math, no layout read) and ≤2 memoized
  // transform writes per frame — and syncPositionOverlay cancels the loop
  // the moment the charted position loses its triggers.
  function tpslFrameTick(): void {
    tpslFrame = requestAnimationFrame(tpslFrameTick);
    placeTpSlHandle("tp", tpHandleEl, tpHandlePrice);
    placeTpSlHandle("sl", slHandleEl, slHandlePrice);
  }

  function placeTpSlHandle(
    kind: TpSlKind,
    el: HTMLButtonElement | null,
    price: number | null,
  ): void {
    if (tpslHandleCache[kind].el !== el) {
      // Fresh (re)mount: forget cached geometry so the new element gets
      // positioned before its CSS visibility:hidden lifts.
      tpslHandleCache[kind] = { el, y: null, right: null };
    }
    if (!el || price === null || !candleSeries || !lwChart) return;
    const cache = tpslHandleCache[kind];
    const y = candleSeries.priceToCoordinate(price);
    // Null = scale not ready; out-of-pane coordinates (the library returns
    // them for prices beyond the visible range, it does NOT null them) would
    // float the handle over the chart header — hide in both cases.
    if (y === null || y < 0 || y > lwChart.paneSize().height) {
      if (cache.y !== null) {
        el.style.visibility = "hidden";
        cache.y = null;
      }
      return;
    }
    const snapped = Math.round(y * 2) / 2;
    if (cache.y !== snapped) {
      // Transform-only write — translates, never triggers layout.
      el.style.transform = `translate(0, ${snapped}px) translateY(-50%)`;
      el.style.visibility = "visible";
      cache.y = snapped;
    }
    const right = Math.round(lwChart.priceScale("right").width()) + 4;
    if (right !== cache.right) {
      // `right` is a layout write, but the price-scale width changes only
      // when the axis re-measures — effectively never per frame.
      el.style.right = `${right}px`;
      cache.right = right;
    }
  }

  function tpslBusyKey(position: PhoenixPosition): string {
    return `tpsl:${position.symbol}:${position.subaccountIndex}`;
  }

  function onTpSlHandleDown(event: PointerEvent, kind: TpSlKind): void {
    const position = selectedPosition;
    if (!position || !chartContainer || tpslDrag || tpslPending) return;
    if (phoenixBusyKeys.has(tpslBusyKey(position))) return;
    const trigger =
      kind === "tp" ? position.takeProfitPrice : position.stopLossPrice;
    if (trigger === null) return;
    event.preventDefault();
    (kind === "tp" ? tpHandleEl : slHandleEl)?.setPointerCapture(
      event.pointerId,
    );
    tpslDrag = {
      kind,
      pointerId: event.pointerId,
      startPrice: trigger,
      price: trigger,
      // Cached once — the chart doesn't move mid-drag, so pointermove
      // never needs a layout read.
      chartTop: chartContainer.getBoundingClientRect().top,
      moved: false,
    };
  }

  function onTpSlHandleMove(event: PointerEvent): void {
    if (!tpslDrag || event.pointerId !== tpslDrag.pointerId || !candleSeries) {
      return;
    }
    const price = Number(
      candleSeries.coordinateToPrice(event.clientY - tpslDrag.chartTop),
    );
    if (!Number.isFinite(price) || price <= 0) return;
    // Reassign, never mutate: line price and handle label derive from this.
    tpslDrag = { ...tpslDrag, price, moved: true };
  }

  // ESC mid-drag and pointercancel land here: dropping the drag state
  // snaps line + label back to the position's real trigger.
  function cancelTpSlDrag(): void {
    tpslDrag = null;
  }

  function onTpSlHandleUp(event: PointerEvent): void {
    const drag = tpslDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    tpslDrag = null;
    const position = selectedPosition;
    if (!drag.moved || !position) return;
    const current =
      drag.kind === "tp" ? position.takeProfitPrice : position.stopLossPrice;
    if (current === null) return; // trigger vanished mid-drag
    // Unchanged at the trigger dialect's own precision → a grab, not an edit.
    if (fmtTriggerPrice(drag.price) === fmtTriggerPrice(current)) return;
    // Same side-validity the ticket enforces at order time, against the
    // mark: a wrong-side trigger would fire the moment it lands on-chain.
    const mark =
      marketMids[position.symbol] ??
      (position.symbol === selectedSymbol ? latestPrice : null);
    const long = position.size > 0;
    if (mark !== null) {
      const valid =
        drag.kind === "tp"
          ? long
            ? drag.price > mark
            : drag.price < mark
          : long
            ? drag.price < mark
            : drag.price > mark;
      if (!valid) {
        phoenixActionError =
          drag.kind === "tp"
            ? `Take profit must be ${long ? "above" : "below"} the mark — trigger unchanged`
            : `Stop loss must be ${long ? "below" : "above"} the mark — trigger unchanged`;
        phoenixActionErrorDetail = "";
        phoenixActionRetry = null;
        return; // snap back — the drag state is already cleared
      }
    }
    void submitTpSlDrag(position, drag.kind, drag.price, current);
  }

  // Release path: the position row has NO TP/SL editor today —
  // buildSetPositionTpSlIxs (phoenix-trade.ts) is the app's only TP/SL
  // edit machinery, and simulate→auto-sign (ratified 2026-07-02) its only
  // confirmation posture, exactly how Close/Margin+ submit from the row.
  // A completed drag therefore submits through that same existing pipeline
  // (no new transaction code, no new confirm UI). The drag is pointer-only
  // by design: keyboard/AT users keep the position row as the accessible
  // TP/SL surface (read-only there today — a follow-up row editor should
  // reuse submitTpSlDrag's body).
  async function submitTpSlDrag(
    position: PhoenixPosition,
    kind: TpSlKind,
    price: number,
    fromPrice: number,
  ): Promise<void> {
    if (paperMode) {
      try {
        paperLedger.set(
          setPaperTpSl($paperLedger, position.symbol, position.subaccountIndex, {
            takeProfitPrice: kind === "tp" ? price : undefined,
            stopLossPrice: kind === "sl" ? price : undefined,
          }),
        );
        tpslPending = null;
      } catch (error) {
        tpslPending = null;
        phoenixActionError =
          error instanceof Error ? error.message : "paper-tpsl-failed";
      }
      return;
    }
    const busyKey = tpslBusyKey(position);
    if (!phoenixAuthority || phoenixBusyKeys.has(busyKey)) return;
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
    setPhoenixBusy(busyKey, true);
    phoenixActionError = "";
    phoenixActionErrorDetail = "";
    phoenixActionRetry = null;
    // Hold the line at the dragged price while the tx flies and the lagging
    // indexer catches up; the position ROW keeps rendering chain state the
    // whole time — only the chart line previews.
    tpslPending = { kind, price, from: fromPrice, until: Date.now() + 25_000 };
    const preFingerprint = snapshotFingerprint();
    const label = kind === "tp" ? "take profit" : "stop loss";
    try {
      const instructions = await (await tradeModule()).buildSetPositionTpSlIxs(
        phoenixAuthority,
        position,
        kind === "tp" ? { takeProfitPrice: price } : { stopLossPrice: price },
      );
      lastTradeSignature = await signAndSendPhoenixIxs(
        instructions,
        {
          title: `Move ${label} · ${position.symbol}-PERP`,
          details: [
            "Venue: Phoenix Perps",
            `${kind === "tp" ? "Take profit" : "Stop loss"}: ${formatPrice(fromPrice)} → ${formatPrice(price)}`,
          ],
        },
        expectedLiveExecutionEpoch,
        busyKey,
      );
      track("tpsl_dragged", {
        ...marketContext(),
        trigger: kind,
        fromPrice,
        toPrice: price,
        signature: lastTradeSignature,
      });
      void burstRefreshPhoenix(preFingerprint);
    } catch (error) {
      tpslPending = null; // snap back to the position's real trigger
      const human = humanizeTradeError(error);
      phoenixActionError = human.text;
      phoenixActionErrorDetail = human.detail;
      phoenixActionRetry = null; // re-dragging is the natural retry gesture
      if (human.confirmUncertain) void burstRefreshPhoenix(preFingerprint);
      markLastTxFailed(busyKey);
    } finally {
      setPhoenixBusy(busyKey, false);
      clearTxStage(busyKey);
    }
  }

  // ── Journal ────────────────────────────────────────────────────────
  function noteTrade(entry: JournalEntry): void {
    journalEntries = recordTrade(entry);
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
      briefRead = { phase: "ready", asOf: Date.now(), text: await aiPositionBrief(snapshot, paperMode) };
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
      recapRead = { phase: "ready", asOf: Date.now(), text: await aiSessionRecap(snapshot, paperMode) };
    } catch (error) {
      recapRead = { phase: "error", text: "", error: aiErr(error) };
    }
  }

  // ── Spot limit orders (Jupiter Trigger) ───────────────────────────
  // (base64 tx deserialization lives in $lib/phoenix-trade behind the lazy
  // web3 boundary — see tradeModule above.)

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
    if (paperMode) {
      $spotQuoteStatus = "error";
      $spotQuoteError = "Spot trading is disabled in PAPER mode.";
      return;
    }
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
    const address = $privyAuth.walletAddress;
    if (!spotAsset || !address || spotBusy || walletScreen.flagged) return;
    const limit = Number($spotLimitPrice);
    const amount = Number($spotAmount);
    if (!Number.isFinite(limit) || limit <= 0) return;
    if (!Number.isFinite(amount) || amount <= 0) return;
    spotBusy = true;
    $spotQuoteError = "";
    try {
      // Buy: spend `$spotAmount` USDC for amount/limit tokens.
      // Sell: sell `$spotAmount` tokens for amount*limit USDC.
      const params =
        $spotSide === "buy"
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
      const trade = await tradeModule();
      const connection = trade.createSolanaConnection(solanaRpcUrl());
      spotSignature = await simulateConfirmAndSend(
        trade.deserializeBase64Tx(transaction),
        connection,
        {
          title: `Place limit ${$spotSide} ${spotAsset.symbol}`,
          details: [
            `Venue: Jupiter Trigger`,
            `Limit price: ${formatPrice(limit)}`,
            `Notional: $${formatNumber($spotSide === "buy" ? amount : amount * limit, 2)}`,
          ],
          feePayer: address,
        },
        expectedLiveExecutionEpoch,
      );
      noteTrade({
        ts: Date.now(),
        mode: "live",
        venue: "spot",
        symbol: spotAsset.symbol,
        action: `limit-${$spotSide}`,
        notionalUsd: $spotSide === "buy" ? amount : amount * limit,
        price: limit,
        leverage: null,
        signature: spotSignature,
      });
      void refreshTriggerOrders();
    } catch (error) {
      $spotQuoteStatus = "error";
      $spotQuoteError = error instanceof Error ? error.message : "limit-failed";
    } finally {
      spotBusy = false;
    }
  }

  async function cancelSpotLimitOrder(orderKey: string): Promise<void> {
    if (paperMode) {
      $spotQuoteStatus = "error";
      $spotQuoteError = "Spot trading is disabled in PAPER mode.";
      return;
    }
    const expectedLiveExecutionEpoch = captureLiveExecutionEpoch();
    const address = $privyAuth.walletAddress;
    if (!address || triggerBusy) return;
    triggerBusy = true;
    try {
      const transaction = await cancelTriggerOrder(address, orderKey);
      const trade = await tradeModule();
      const connection = trade.createSolanaConnection(solanaRpcUrl());
      await simulateConfirmAndSend(
        trade.deserializeBase64Tx(transaction),
        connection,
        {
          title: "Cancel spot limit order",
          details: [`Venue: Jupiter Trigger`, `Order: ${shortAddress(orderKey)}`],
          feePayer: address,
        },
        expectedLiveExecutionEpoch,
      );
      triggerOrders = triggerOrders.filter((order) => order.orderKey !== orderKey);
      void refreshTriggerOrders();
    } catch (error) {
      $spotQuoteError = error instanceof Error ? error.message : "cancel-failed";
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
    if (prefs.tradeMode === "spot" && prefs.paperMode !== true) pendingTradeMode = "spot";
    if (prefs.spotAssetId !== undefined && prefs.paperMode !== true) pendingSpotAssetId = prefs.spotAssetId;
    if (prefs.watchlist !== undefined) watchlist = prefs.watchlist;
    if (prefs.screenSort !== undefined) screenSort = prefs.screenSort;
    if (prefs.screenHub !== undefined) screenHub = prefs.screenHub;
    if (prefs.sizingMode !== undefined) $sizingMode = prefs.sizingMode;
    if (prefs.tradeAmount !== undefined) $tradeAmount = prefs.tradeAmount;
    if (prefs.tradeRiskUsd !== undefined) $tradeRiskUsd = prefs.tradeRiskUsd;
    if (prefs.tradeLeverage !== undefined) $tradeLeverage = prefs.tradeLeverage;
    if (prefs.dockTab !== undefined) dockTab = prefs.dockTab;
    if (prefs.macroOpen !== undefined) macroOpen = prefs.macroOpen;
    if (prefs.showLevels !== undefined) showLevels = prefs.showLevels;
    if (prefs.rays !== undefined) rays = prefs.rays;
    if (prefs.paperMode !== undefined) paperMode = prefs.paperMode;
    // Without Privy, live trading is impossible — stay in paper regardless
    // of a previously saved LIVE preference.
    if (!readPrivyConfig().appId) paperMode = true;
    if (paperMode) {
      pendingTradeMode = null;
      pendingSpotAssetId = null;
      tradeMode = "perps";
    }
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
    // A live TP/SL drag owns Escape ahead of everything: cancel the drag
    // (snap back) and swallow — one Escape never doubles as anything else.
    if (event.key === "Escape" && tpslDrag) {
      event.stopPropagation();
      cancelTpSlDrag();
      return;
    }
    // Armed click-to-trade owns Escape: disarm only, swallowed before the
    // modal-close block below so one Escape never doubles as modal-close
    // (same key-swallowing posture as the funding wizard).
    if (event.key === "Escape" && clickTradeArmed) {
      event.stopPropagation();
      disarmClickTrade();
      return;
    }
    // Armed measure (mid-drag or lingering chip) owns Escape the same way:
    // cancel the measurement and disarm, swallowed before modal-close.
    if (event.key === "Escape" && (measureArmed || measure !== null)) {
      event.stopPropagation();
      disarmMeasure();
      return;
    }
    // Armed ray placement owns Escape: disarm without placing.
    if (event.key === "Escape" && rayArmed) {
      event.stopPropagation();
      disarmRay();
      return;
    }
    if (event.key === "Escape") {
      // Modal-priority: if a modal owns this Escape, close only it and leave
      // the side chat — one Escape never doubles as chat-close.
      const modalOwned =
        tradeOpen || authOpen || alertsOpen || fundsOpen || paperFundsOpen || paletteOpen || cheatOpen;
      if (tradeOpen) tradeOpen = false;
      if (authOpen) authOpen = false;
      if (alertsOpen) alertsOpen = false;
      if (fundsOpen) fundsOpen = false;
      if (paperFundsOpen) paperFundsOpen = false;
      if (paletteOpen) paletteOpen = false;
      if (cheatOpen) cheatOpen = false;
      if ($chatState.open && !modalOwned) closeChat();
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
      $ticketActive &&
      tradeMode === "perps" &&
      !authOpen &&
      !alertsOpen &&
      !fundsOpen &&
      !paperFundsOpen &&
      !paletteOpen &&
      !cheatOpen
    ) {
      const ticketKey = event.key.toLowerCase();
      if (ticketKey === "b" || ticketKey === "s") {
        event.preventDefault();
        // Ticket is live here, so setSide flips in place (TP/SL survive).
        perpTicket.setSide(ticketKey === "b" ? "buy" : "sell");
        focusTicketSize();
        return;
      }
      if (ticketKey === "m" || ticketKey === "l") {
        event.preventDefault();
        $tradeType = ticketKey === "m" ? "market" : "limit";
        return;
      }
    }
    if (authOpen || tradeOpen || alertsOpen || fundsOpen || paperFundsOpen || paletteOpen || cheatOpen) {
      return;
    }
    // Backtick summons the side chat — same input/modal guards as the other
    // hotkeys above (typing-in-input and modal-open both bail earlier).
    if (event.key === "`") {
      toggleChat();
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
    content="Frontend-only Harness SvelteKit terminal."
  />
</svelte:head>

<svelte:window onkeydown={onGlobalKeydown} />

<main class="terminal-shell">
  <a class="skip-link" href="#terminal-content">Skip to terminal content</a>

  <Topbar
    bind:height={topbarHeight}
    wallet={{
      balanceText,
      gasText: walletBalanceText,
      status: walletBalanceStatus,
      error: walletBalanceError,
      usdcValue: usdcBalanceValue,
      phoenixCollateral: phoenixTotalCollateral,
      screen: walletScreen,
      whitelisted: phoenixWhitelisted,
      copied: walletCopied,
    }}
    {layoutCustomized}
    {logoutBusy}
    {paperMode}
    paperFundsLabel={`$${formatNumber(accountEquityUsd, 0)}`}
    onopenauth={openAuthModal}
    onopenfunds={openFunds}
    onopenalerts={() => (alertsOpen = true)}
    onresetlayout={resetLayout}
    onToggleChat={toggleChat}
    onlogout={disconnectPrivy}
    oncopyaddress={copyWalletAddress}
    onrefreshbalances={() => {
      void refreshWalletBalance();
      void refreshPhoenixTrader();
    }}
    ontogglepaper={togglePaperMode}
  />

  {#if showOpenBetaBanner}
    <div class="terminal-notice">
      <OpenBetaBanner ondismiss={dismissOpenBetaBanner} />
    </div>
  {/if}

  {#if showWelcomeStrip}
    <div class="terminal-notice">
      <WelcomeStrip
        address={`${($privyAuth.walletAddress ?? "").slice(0, 4)}…${($privyAuth.walletAddress ?? "").slice(-4)}`}
        funded={welcomeFunded}
        traded={welcomeTraded}
        onopen={() => (wizardOpen = true)}
        ondismiss={dismissWelcome}
      />
    </div>
  {/if}

  <TickerRail
    perp={tickerPerp}
    spot={tickerSpot}
    {streamHealth}
    {marketFresh}
    {tradeMode}
    {selectedSymbol}
    {watchlist}
    {news}
    {activeSection}
    {topbarHeight}
    bind:railHeight={marketRailHeight}
    ontogglewatch={toggleWatch}
    onopenpalette={openPalette}
    onsectionselect={scrollToSection}
  />

  <!-- Sticky chrome (topbar on desktop + market rail) covers the top of the
       viewport — jump-to-section targets scroll-margin below it. -->
  <section
    id="terminal-content"
    class="dashboard"
    class:chat-open={$chatState.open}
    style={`--anchor-top: ${(stackedBook ? topbarHeight : 0) + marketRailHeight}px;`}
  >
    <!-- Chart column: chart stacked over the dock (Hyperliquid posture) —
         the dock's height is independent of the taller ticket rail. -->
    <div class="chart-col">
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

          {#if clickTradeArmed && clickTradeHover}
            <div
              class="click-trade-pill"
              style="top: {clickTradeHover.y}px; right: {clickTradeHover.right}px;"
            >
              {clickTradeHover.label}
            </div>
          {/if}

          {#if measure && measureChip}
            <div
              class="measure-chip"
              style="left: {measure.x + 14}px; top: {measure.y + 14}px;"
            >
              {measureChip.delta} ·
              <span
                class:up={measureChip.direction === "up"}
                class:down={measureChip.direction === "down"}
              >{measureChip.pct}</span>
              · {measureChip.bars}
            </div>
          {/if}

          <!-- Draggable TP/SL grab handles. Geometry (transform/right) is
               written imperatively by the rAF loop — never through Svelte
               attributes, so a re-render can't clobber a mid-drag position.
               Pointer-only affordance: the accessible TP/SL surface stays
               the position row, not these handles. -->
          {#if tpHandlePrice !== null}
            <button
              class="tpsl-handle tpsl-handle-tp"
              class:pending={tpslPending?.kind === "tp"}
              type="button"
              aria-label="Drag to move the take-profit trigger"
              bind:this={tpHandleEl}
              onpointerdown={(event) => onTpSlHandleDown(event, "tp")}
              onpointermove={onTpSlHandleMove}
              onpointerup={onTpSlHandleUp}
              onpointercancel={cancelTpSlDrag}
            >
              <span>TP {fmtTriggerPrice(tpHandlePrice)}</span>
              <i aria-hidden="true">⋮⋮</i>
            </button>
          {/if}
          {#if slHandlePrice !== null}
            <button
              class="tpsl-handle tpsl-handle-sl"
              class:pending={tpslPending?.kind === "sl"}
              type="button"
              aria-label="Drag to move the stop-loss trigger"
              bind:this={slHandleEl}
              onpointerdown={(event) => onTpSlHandleDown(event, "sl")}
              onpointermove={onTpSlHandleMove}
              onpointerup={onTpSlHandleUp}
              onpointercancel={cancelTpSlDrag}
            >
              <span>SL {fmtTriggerPrice(slHandlePrice)}</span>
              <i aria-hidden="true">⋮⋮</i>
            </button>
          {/if}
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
          class:active={showLevels}
          type="button"
          aria-pressed={showLevels}
          title="Toggle structure levels (PDH/PDL, swings)"
          onclick={() => {
            showLevels = !showLevels;
            // OFF removes every structure line immediately; ON recomputes
            // fresh from the candles currently on the chart.
            recomputeStructureLevels(
              tradeMode === "spot" ? spotChartPoints : chartPoints,
            );
          }}
        >
          levels
        </button>
        <button
          class:active={clickTradeArmed}
          type="button"
          aria-pressed={clickTradeArmed}
          disabled={tradeMode === "spot"}
          title={tradeMode === "spot"
            ? "perps only for now"
            : "Arm click-to-trade — click the chart to stage a limit order"}
          onclick={() => (clickTradeArmed ? disarmClickTrade() : armClickTrade())}
        >
          trade
        </button>
        <button
          class:active={rayArmed}
          type="button"
          aria-pressed={rayArmed}
          disabled={chartedRaySymbol === null}
          title="Arm ray — click the chart to place a horizontal ray (or click an existing ray to remove it)"
          onclick={() => (rayArmed ? disarmRay() : armRay())}
        >
          ray
        </button>
        <button
          class:active={measureArmed}
          type="button"
          aria-pressed={measureArmed}
          title="Arm measure — drag on the chart to read Δ / % / bars"
          onclick={() => (measureArmed ? disarmMeasure() : armMeasure())}
        >
          measure
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

    <!-- Bottom dock: risk never leaves the screen — desk/journal/alerts
         tabs span the full width directly under the chart row. -->
    <section class="panel dock" aria-label="Trading desk dock">
      <div class="dock-tabs" role="tablist" aria-label="Dock views">
        <button
          role="tab"
          aria-selected={dockTab === "desk"}
          class:active={dockTab === "desk"}
          type="button"
          onclick={() => (dockTab = "desk")}
        >
          Desk
        </button>
        <button
          role="tab"
          aria-selected={dockTab === "journal"}
          class:active={dockTab === "journal"}
          type="button"
          onclick={() => (dockTab = "journal")}
        >
          Journal
        </button>
        <button
          role="tab"
          aria-selected={dockTab === "alerts"}
          class:active={dockTab === "alerts"}
          type="button"
          onclick={() => (dockTab = "alerts")}
        >
          Alerts{#if $alertLog.length > 0}
            <span class="dock-count">{$alertLog.length}</span>{/if}
        </button>
      </div>
      <div class="dock-body">
        {#if dockTab === "journal"}
          <JournalPanel
            {journalEntries}
            {journalToday}
            {recapRead}
            {sessionPnlUsd}
            onwipe={wipeJournal}
          />
        {:else if dockTab === "alerts"}
          <div class="dock-alert-log">
            {#each $alertLog as fired (fired.ts)}
              <div class="dock-alert-row">
                <span class="dock-alert-ts">
                  {new Date(fired.ts).toISOString().slice(11, 19)}
                </span>
                <b>{fired.title}</b>
                <span>{fired.body}</span>
              </div>
            {:else}
              <p class="dock-empty">No alerts fired this session.</p>
            {/each}
          </div>
        {:else}
          {@render perpDeskPanel()}
        {/if}
      </div>
    </section>
    </div>

    <section id="section-book" class="panel orderbook-panel">
      {#if stackedBook}
        <!-- Desktop: ticket + ladder stack (Hyperliquid order) — the ticket
             owns the top of the rail so entry controls are always visible;
             the book/tape reads below it. The tape shares the ladder slot
             (all three don't fit); its tabs only swap the feed. -->
        <!-- Enter from any ticket input submits, gated exactly like the button. -->
        <div
          class="panel-ticket"
          class:stacked={tradeMode === "perps"}
          role="presentation"
          onkeydown={tradeMode === "spot" ? onSpotTicketKeydown : onTicketKeydown}
        >
          {#if tradeMode === "spot"}
            {@render spotTicketForm()}
          {:else}
            {@render perpTicketForm()}
          {/if}
        </div>
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
              <BookLadder
                asks={visibleAskLevels}
                bids={visibleBidLevels}
                {spread}
                {spreadPercent}
                maxNotional={bookMaxNotional}
                onpick={prefillFromBook}
              />
            {:else}
              <Tape {trades} />
            {/if}
          </div>
        {/if}
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

          <BookLadder
            asks={visibleAskLevels}
            bids={visibleBidLevels}
            {spread}
            {spreadPercent}
            maxNotional={bookMaxNotional}
            onpick={prefillFromBook}
          />

          <Tape {trades} />
        {:else}
          <!-- Enter from any ticket input submits, gated exactly like the button. -->
          <div
            class="panel-ticket"
            role="presentation"
            onkeydown={tradeMode === "spot" ? onSpotTicketKeydown : onTicketKeydown}
          >
            {#if tradeMode === "spot"}
              {@render spotTicketForm()}
            {:else}
              {@render perpTicketForm()}
            {/if}
          </div>
        {/if}
      {/if}
    </section>


    <MonitorPanel
      {markets}
      {marketMids}
      {dailyStats}
      {selectedSymbol}
      {tradeMode}
      {scannerRead}
      onselect={chooseMonitorRow}
    />

{#snippet perpDeskPanel()}
    <PerpDeskPanel
      authority={tradeAuthority}
      trader={phoenixTrader}
      positions={enrichedPositions}
      openOrders={perpOpenOrders}
      {pendingOrder}
      account={{
        upnl: accountUpnlUsd,
        exposure: accountExposureUsd,
        leverage: accountLeverage,
      }}
      {sessionPnlUsd}
      {sessionPnlPct}
      {equityValues}
      {fundingRead}
      {briefRead}
      actionError={phoenixActionError}
      actionErrorDetail={phoenixActionErrorDetail}
      actionRetry={phoenixActionRetry}
      busyKeys={phoenixBusyKeys}
      {closingKeys}
      {apiSlotLag}
      {marketMids}
      {selectedSymbol}
      {latestPrice}
      marketRows={selectedMarketRows}
      freeCollateralUsd={phoenixCollateral}
      {flattenArmed}
      {flattenBusy}
      bidSweepSymbols={perpBidSweepSymbols}
      askSweepSymbols={perpAskSweepSymbols}
      {cancelSweepBusy}
      {marginAddKey}
      bind:marginAddValue
      {paperMode}
      ontrade={openTrade}
      ondeposit={openFunds}
      onselectsymbol={chooseMonitorRow}
      onshare={(position) => sharePhoenixPosition(position, marketMids)}
      onclose={(position) =>
        closePhoenixPosition(
          position.symbol,
          position.size,
          position.subaccountIndex,
        )}
      onclosepartial={(position, fraction) =>
        closePhoenixPositionFraction(position, fraction)}
      oncancelorder={(order) => cancelPhoenixOrderById(order)}
      oncancelside={(side) => cancelAllPhoenixOrdersOnSide(side)}
      onflatten={onFlattenClick}
      onmarginopen={openMarginAdd}
      onmarginsubmit={(position) => submitMarginAdd(position)}
      onresetpaper={resetPaperAccount}
    />
{/snippet}

    <!-- Macro drawer: the research desk folds away — day traders open it
         when they want regime context; the chip carries edge status. -->
    <section class="panel macro-drawer" id="section-macro">
      <button
        class="drawer-head"
        type="button"
        aria-expanded={macroOpen}
        onclick={() => (macroOpen = !macroOpen)}
      >
        <span class="drawer-kicker">MACRO_DESK</span>
        <span class="drawer-status">{edgeStatus}</span>
        <span class="drawer-caret" aria-hidden="true">{macroOpen ? "▾" : "▸"}</span>
      </button>
      {#if macroOpen}
        <div class="drawer-grid">
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
        </div>
      {/if}
    </section>

    <EventsPanel
      {news}
      {selectedSymbol}
      spotSymbol={spotAsset?.symbol ?? null}
      {tradeMode}
      {eventRead}
    />

    <WatchlistPanel
      {watchlist}
      {spotAssets}
      {marketMids}
      {markets}
      onopenrow={openWatchRow}
    />

    <ScreenerPanel
      {spotAssets}
      {tradeMode}
      {spotAsset}
      bind:sort={screenSort}
      bind:hub={screenHub}
      onselect={selectSpotAsset}
    />

    <SpotMarketsPanel
      {spotAssets}
      {tokenBalances}
      {tradeMode}
      {spotAsset}
      onselect={selectSpotAsset}
    />

    {#if $chatState.open}
      {#await SidePanelLazy()}
        <!-- dock chunk loading on first summon -->
      {:then module}
        <svelte:component
          this={module.default}
          buildContext={buildDeskContextClosure}
          onRequestAuth={openAuthModal}
        />
      {/await}
    {/if}
  </section>
  <StatusLine
    status={statusModel}
    onshowshortcuts={() => (cheatOpen = true)}
    onjumptopositions={() => scrollToSection("section-perp")}
  />
</main>

<ToastStack />

{#if cheatOpen}
  <CheatSheetModal onclose={() => (cheatOpen = false)} />
{/if}

{#if authOpen}
  <AuthModal onclose={() => (authOpen = false)} onauthenticated={refreshEdgeModules} />
{/if}

{#if ackOpen}
  <AckModal onagree={onAckAgree} onclose={() => { ackOpen = false; pendingAckAction = null; }} />
{/if}

{#if wizardOpen}
  <FundingWizard
    address={$privyAuth.walletAddress ?? ""}
    funded={welcomeFunded}
    collateralized={welcomeCollateralized}
    traded={welcomeTraded}
    onopenfunds={() => {
      wizardOpen = false;
      openFunds();
    }}
    onclose={() => (wizardOpen = false)}
  />
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
          <h2>{$tradeSide === "buy" ? "LONG" : "SHORT"} {selectedSymbol}-PERP</h2>
        </div>
        <button class="modal-close" type="button" aria-label="Close" onclick={() => (tradeOpen = false)}>×</button>
      </div>
      <div class="modal-body">
        {@render perpTicketForm()}
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
    onflatten={onFlattenClick}
    repeatLast={lastOrderIntent
      ? {
          label: `Repeat last · ${lastOrderIntent.side === "buy" ? "LONG" : "SHORT"} $${lastOrderIntent.amount} ${lastOrderIntent.symbol} ${lastOrderIntent.leverage}x`,
          apply: applyLastOrderIntent,
        }
      : null}
    onselect={choosePalette}
    ontogglewatch={toggleWatch}
    onclose={() => (paletteOpen = false)}
  />
{/if}

<FundsModal
  open={fundsOpen}
  bind:tab={fundsTab}
  bind:depositAmount
  bind:withdrawAmount
  walletAddress={$privyAuth.walletAddress ?? null}
  {walletCopied}
  usdcBalance={{ text: usdcBalanceText, value: usdcBalanceValue }}
  {solBalanceValue}
  gasText={walletBalanceText}
  phoenixCollateralUsd={phoenixTrader?.collateralUsd ?? null}
  collateral={{
    busy: collateralBusy,
    error: collateralError,
    signature: collateralSignature,
  }}
  onclose={() => (fundsOpen = false)}
  ondeposit={() => void submitCollateral("deposit")}
  onwithdraw={() => void submitCollateral("withdraw")}
  oncopyaddress={copyWalletAddress}
  onswap={performSwap}
/>

<PaperFundsModal
  open={paperFundsOpen}
  freeUsd={$paperLedger.cashUsd}
  equityUsd={accountEquityUsd}
  marginUsd={Math.max(
    0,
    ($paperLedger.positions.reduce((sum, p) => sum + (p.marginUsd ?? 0), 0) +
      $paperLedger.orders.reduce((sum, o) => sum + o.marginUsd, 0)),
  )}
  openPositions={$paperLedger.positions.length}
  onclose={() => (paperFundsOpen = false)}
  ontopup={(amount) => {
    topUpPaperAccount(amount);
  }}
  onreset={() => {
    resetPaperAccount();
  }}
/>

{#snippet spotTicketForm()}
  <SpotTicketForm
    ticket={spotTicket}
    {spotAsset}
    {spotAssets}
    {spotChipBalance}
    {usdcBalanceText}
    {spotHolding}
    {phoenixAuthority}
    {spotBusy}
    {spotSignature}
    {paperMode}
    canSubmit={canSubmitSpot}
    limitArmed={spotLimitArmed}
    limitBlocked={spotLimitBlocked}
    limitDeviationPct={spotLimitDeviationPct}
    {triggerOrders}
    {triggerBusy}
    mintSafety={spotAsset ? (mintSafetyCache[spotAsset.mint] ?? null) : null}
    onswap={() => requireTradeAck(() => void executeSpotSwap())}
    onlimitsubmit={onSpotLimitSubmitClick}
    onopenauth={openAuthModal}
    onchip={setSpotAmountChip}
    oncancelorder={cancelSpotLimitOrder}
  />
{/snippet}

{#snippet perpTicketForm()}
  <TicketForm
    ticket={perpTicket}
    bind:sizeInput={ticketSizeInput}
    {asks}
    {bids}
    {spread}
    {spreadPercent}
    {spreadBps}
    {latestPrice}
    {fundingPercent}
    {selectedSymbol}
    {selectedPosition}
    phoenixAuthority={tradeAuthority}
    {phoenixStateKnown}
    {phoenixCollateral}
    {phoenixTotalCollateral}
    {accountEquityUsd}
    {marginUsedPct}
    {selectedLiqDistancePct}
    {accountUpnlUsd}
    {paperMode}
    canSubmit={canSubmitPerp}
    perpGate={{
      show: perpGateNotice && phoenixWhitelisted === false,
      busy: perpAccessBusy,
    }}
    onrequestaccess={() => void activatePerpAccess()}
    {orderBusy}
    {orderStageEntry}
    {nowMs}
    {limitArmed}
    {limitBlocked}
    {limitDeviationPct}
    {limitCrossesBook}
    actionError={phoenixActionError}
    actionErrorDetail={phoenixActionErrorDetail}
    actionRetry={phoenixActionRetry}
    {lastTradeSignature}
    {txStageText}
    {tradeOpen}
    {stackedBook}
    onsubmit={onPerpSubmitClick}
    onopenauth={openAuthModal}
    onopenfunds={openPhoenixFunding}
    onpick={prefillFromBook}
    onmanualsize={() => (sizeSource = "manual")}
    onsizechip={setSizeChip}
    onriskchip={setRiskChip}
  />
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

  .chart-toolbar,
  .timeframe-tabs,
  .chart-market-tools,
  .price-mode-toggle,
  .chart-footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .chart-toolbar button,
  .chart-tools button,
  .chart-footer button {
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
  .chart-footer button:hover {
    transform: translateY(-1px);
    border-color: rgba(255, 77, 151, 0.55);
  }

  .terminal-notice {
    padding: 0.6rem clamp(0.75rem, 2vw, 1.25rem);
    border-bottom: 1px solid var(--line-soft);
    background: rgba(8, 10, 13, 0.86);
  }

  /* ── Privy auth: topbar + account menu markup/styles live in
     components/Topbar.svelte; the shared rows/actions (.account-row*,
     .copy-hint, .account-action) moved to terminal.css — the add-funds
     modal renders them too. ── */

  /* ── Phoenix venue (venue strip / position cards / open orders) —
     markup + styles live in components/PerpDeskPanel.svelte; the shared
     venue-section/venue-row rows stay in terminal.css ── */

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


  /* ── Day-trading grid: bottom dock + macro drawer ─────────────────── */
  /* The dock spans the full row directly under the chart (order 1 slots
     between the anchored chart/book pair at 0 and ordered panels at 2+),
     so open risk never leaves the screen. */
  .chart-col {
    grid-column: span 9;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
  }
  /* NOTE: no `.chart-col .chart-panel { grid-column: auto }` here — inside
     the flex .chart-col grid-column is inert anyway, and because
     display: contents (≤1100px) removes the box but NOT the element, the
     descendant selector kept matching at narrow widths and its higher
     specificity defeated the full-width override below — the chart
     collapsed to one auto-placed grid column (bug, 2026-07-07). */
  .dock {
    grid-column: 1 / -1;
    order: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .dock-tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .dock-tabs button {
    appearance: none;
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.45rem 0.7rem;
    cursor: pointer;
  }
  .dock-tabs button.active {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .dock-count {
    margin-left: 0.35rem;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .dock-body {
    min-height: 12rem;
    max-height: 38vh;
    overflow-y: auto;
  }
  /* Panels re-mounted in the dock keep their component shells; neutralize
     the grid-era chrome (drag grips, panelStyle ordering, card borders). */
  .dock-body :global([data-panel]) {
    order: 0 !important;
    border: 0;
    background: none;
  }
  .dock-body :global(.drag-grip) {
    display: none;
  }
  .dock-alert-log {
    display: grid;
    gap: 0.3rem;
    padding: 0.55rem 0.65rem;
    font-size: 0.74rem;
  }
  .dock-alert-row {
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: 0.6rem;
    align-items: baseline;
    color: var(--muted);
  }
  .dock-alert-row b {
    color: var(--ink);
    font-weight: 600;
  }
  .dock-alert-ts {
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .dock-empty {
    color: var(--faint);
    margin: 0;
  }

  /* Macro drawer: research desk folds away below the trading panels. */
  .macro-drawer {
    grid-column: 1 / -1;
    order: 80;
    padding: 0;
  }
  .drawer-head {
    appearance: none;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: none;
    border: 0;
    color: var(--muted);
    font: inherit;
    padding: 0.55rem 0.7rem;
    cursor: pointer;
  }
  .drawer-kicker {
    color: var(--ink);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
  }
  .drawer-status {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .drawer-caret {
    margin-left: auto;
  }
  .drawer-grid {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 0.75rem;
    padding: 0 0.7rem 0.7rem;
    border-top: 1px solid var(--line-soft);
  }
  .drawer-grid :global(.drag-grip) {
    display: none;
  }

  .dashboard {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: clamp(0.6rem, 1vw, 0.9rem);
    padding: clamp(0.75rem, 1.4vw, 1.15rem);
  }

  /* Side-chat dock (PRD #563, WP3): when the panel is open the main grid
     gains a 380px right track for the dock while the existing 12-col content
     stays intact. Closed = class absent = repeat(12, …) unchanged, so the
     layout is byte-identical. Below the dock's mobile breakpoint the panel
     goes fixed-sheet, so no track is reserved there. */
  @media (min-width: 1101px) {
    .dashboard.chat-open {
      grid-template-columns: repeat(12, minmax(0, 1fr)) 380px;
    }
  }

  .chart-panel {
    /* Day-trading posture: chart + ticket row AND the dock's first rows
       share the first screen — the extra 11rem subtraction reserves the
       dock's tab strip + a few position rows above the fold (fixed chrome
       ≈ 13.4rem as before). Floor keeps laptops usable, ceiling keeps
       ultra-tall monitors from stretching candles into noodles. */
    --market-panel-height: clamp(26rem, calc(100dvh - 24.4rem), 72rem);
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
    overflow: hidden;
    /* min-height (not height): the ticket renders at full natural height,
       and when that outgrows the viewport clamp the PAGE scrolls — the
       ticket itself must never require scrolling to be seen in full. */
    height: auto;
    min-height: var(--market-panel-height, clamp(26rem, calc(100dvh - 24.4rem), 72rem));
  }

  .macro-panel {
    grid-column: span 4;
  }

  /* Base select/input/label element rules live in terminal.css — scoped
     copies here would stop matching the same elements rendered inside
     extracted components (AuthModal & co). */

  /* The .panel-ticket label dialect rules live in terminal.css — the
     wrapper is page markup while the labels render inside
     TicketForm/SpotTicketForm, so a scoped compound would stop matching. */

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

  /* Honest gating: the trade toggle stays visible but inert on Spot. */
  .chart-footer button:disabled {
    color: var(--faint);
    cursor: not-allowed;
    transform: none;
    border-color: transparent;
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

  /* Draggable TP/SL grab handles: bordered pills riding their price lines
     at the plot's right edge (just left of the price scale). Vertical
     position + right offset are written imperatively by the rAF loop —
     keep transforms out of this rule. Hidden until first placement so a
     fresh mount never flashes at the top-left corner. */
  .tpsl-handle {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 24px;
    height: 14px;
    margin: 0;
    padding: 0 0.3rem;
    border: 1px solid var(--up);
    background: var(--surface);
    color: var(--up);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
    line-height: 1;
    white-space: nowrap;
    cursor: ns-resize;
    touch-action: none;
    visibility: hidden;
  }

  .tpsl-handle-sl {
    border-color: var(--down);
    color: var(--down);
  }

  /* In-flight edit: inert until the chain answers. */
  .tpsl-handle.pending {
    cursor: progress;
    opacity: 0.6;
  }

  .tpsl-handle i {
    font-style: normal;
    letter-spacing: -2px;
  }

  /* Armed click-to-trade: side/price preview pill riding the crosshair
     line at the right edge of the plot (just left of the price scale). */
  .click-trade-pill {
    position: absolute;
    z-index: 4;
    transform: translateY(-50%);
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
  }

  /* Armed measure: Δ/%/bars readout chip trailing the drag cursor. Only
     the % segment carries direction color — the sign already says it. */
  .measure-chip {
    position: absolute;
    z-index: 4;
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
  }

  .measure-chip .up {
    color: var(--up);
  }

  .measure-chip .down {
    color: var(--down);
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

  /* Desktop stack: TICKET on top, ladder below — both always live. The
     ticket owns the top of the rail (entry controls always visible); the
     ladder takes what's left and scrolls its own depth on cramped
     heights. Floors sum < 90%, so the pair never overflows the panel. */
  .book-stack {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-height: 12rem;
    border-top: 1px solid var(--line-soft);
  }

  /* Stacked book slot: `.book-stack` is page markup while `.tape` is
     Tape.svelte's root, so the compound spans the component boundary.
     The page-scoped :global keeps specificity at 0,3,0 — beating the
     component's own `.tape { max-height: 12rem }` regardless of CSS
     bundle order — so the tape fills the ladder slot when stacked. */
  .book-stack :global(.tape) {
    flex: 1;
    max-height: none;
  }

  .orderbook-panel .panel-ticket.stacked {
    /* Never shrinks: the full ticket is always visible without scrolling. */
    flex: 0 0 auto;
  }

  /* .ticket-actions (sticky status + submit footer) lives in
     TicketForm.svelte / SpotTicketForm.svelte. */

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

  /* .spot-asset-head / .spot-asset-name moved with the spot ticket into
     SpotTicketForm.svelte (.spot-logo stays in terminal.css — shared with
     the spot list rendered inside SpotMarketsPanel.svelte). */

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

  /* Market-palette styles live in components/CommandPalette.svelte. */

  /* .ticket-status / .ticket-thin-note / .ticket-field-muted (and the
     ticket's amber .warn) moved into TicketForm/SpotTicketForm. */

  /* Auth-modal styles live in components/AuthModal.svelte; the shared
     bits (.wide, .auth-lead, .wallet-badge) moved to terminal.css. */

  /* .stream-dot moved with its last page consumer, the topbar connect
     status (Topbar.svelte renders only the offline variant; the unused
     live/connecting/stale variants + pulse keyframes were dropped). */

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

  /* ── Tone palette (macro-chip copies live in MacroPanel/Topbar;
     verdict-badge copies live in MacroPanel/SpotMarketsPanel) ── */

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

  /* ── Ambient risk strip + mini book: moved with the perp ticket into
     components/TicketForm.svelte ── */

  /* ── Status line (markup + styles live in components/StatusLine.svelte;
     the dashboard keeps clearance for the fixed footer) ── */
  .dashboard { padding-bottom: 2.6rem; }

  /* ── Trade ticket: field/chip/note styles moved into
     components/TicketForm.svelte and components/SpotTicketForm.svelte
     (.ticket-grid-2 stays in terminal.css — the add-funds modal renders
     the same two-column form grid). The dead .warn-row orphan was dropped
     with the move. ── */

  /* ── News ticker ──────────────────────────────────────────────────── */
  /* Marquee styles live in components/NewsMarquee.svelte; .news-domain is
     shared with modal tx links, so it lives in terminal.css. The headline
     list styles live in components/EventsPanel.svelte. */

  /* ── Alerts (the topbar button + badge live in Topbar.svelte) ─────── */

  @media (max-width: 1100px) {
    /* Narrow: dissolve the chart column so chart + dock become direct
       grid items again (single-column flow). */
    .chart-col {
      display: contents;
    }
    .macro-panel {
      grid-column: span 6;
    }

    .chart-panel,
    .orderbook-panel {
      grid-column: 1 / -1;
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

    /* Every panel goes full-width on phones. The :global child reset is
       load-bearing: component panels (monitor, watch, spot, …) carry
       `grid-column: span N` in their OWN scoped styles, which this page's
       media query can't otherwise reach — their spans were forcing implicit
       columns and shattering the 1fr grid. chart-panel is listed explicitly
       because it's a grandchild via the display:contents .chart-col, so the
       direct-child selector misses it. */
    .dashboard > :global(*),
    .chart-panel {
      grid-column: 1 / -1;
    }

    /* Ticket + funds forms collapse to a single column on phones —
       .ticket-grid-2's override lives in terminal.css. */

    .chart-panel {
      height: clamp(22rem, 56vh, 30rem);
    }

    .orderbook-panel {
      max-height: 26rem;
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
  }

  /* ── Risk-mode additions (the ticker star moved to TickerRail.svelte;
     watchlist/screener/journal styles live in their panel components;
     .label-row/.mode-flip moved with the ticket into TicketForm.svelte) ── */
</style>
