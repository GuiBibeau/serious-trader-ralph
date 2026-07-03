<script lang="ts">
  import { onMount, tick } from "svelte";
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
  import {
    freshSnapshot,
    recordSnapshot,
    traderSnapshots,
  } from "$lib/phoenix-cache";
  import {
    fetchNews,
    fetchOilPanel,
    fetchRatesPanel,
    screenSolanaAddress,
    type NewsItem,
  } from "$lib/intel";
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
    loginPrivyWithCode,
    logoutPrivy,
    privyAuth,
    readPrivyConfig,
    sendPrivyEmailCode,
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
  import { BrandMark } from "@trader-ralph/ui";
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
    usdcToAtoms,
    USDC_MINT as SPOT_USDC_MINT,
    type SpotAsset,
    type SpotQuote,
    type TriggerOrder,
  } from "$lib/spot";
  import {
    activatePhoenixReferral,
    buildCancelAllIxs,
    buildDepositIxs,
    buildPlaceOrderPlan,
    buildSignableTransaction,
    buildWithdrawIxs,
    checkPhoenixAccess,
    ensureTraderRegisteredIxs,
    fetchOnChainCollateralUsd,
    fetchPhoenixTraderState,
    PHOENIX_REFERRAL_CODE,
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
  type TradePreview = {
    notionalUsd: number;
    entry: number | null;
    slippageBps: number | null;
    liqPrice: number | null;
    fundingPer8hUsd: number | null;
    fillable: boolean;
  };

  const DEFAULT_VISIBLE_CANDLES = 150;
  const MAX_VISIBLE_CANDLES = 180;
  const BOOK_LADDER_LEVELS = 10;
  const UP_COLOR = colors.up;
  const DOWN_COLOR = colors.down; // was #ff5a5f — unified to the token red
  const SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

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
  let statusMessage = "loading-phoenix-perps-feed";
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
  $: monitorRows = markets
    .map((config) => ({
      symbol: config.symbol,
      lev: config.maxLeverage,
      mid: marketMids[config.symbol] ?? dailyStats[config.symbol]?.lastPrice ?? null,
      change: dailyStats[config.symbol]?.change24hPct ?? null,
      volume: dailyStats[config.symbol]?.volume24hUsd ?? null,
    }))
    .sort((a, b) =>
      monitorSort === "symbol"
        ? a.symbol.localeCompare(b.symbol)
        : monitorSort === "change"
          ? (b.change ?? -1e9) - (a.change ?? -1e9)
          : (b.volume ?? -1) - (a.volume ?? -1),
    );

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
  let authEmail = "";
  let authCode = "";
  let authBusy = false;
  let authStep: "email" | "code" = "email";
  let authMessage = "";
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
  let phoenixBusy = false;
  let phoenixActionError = "";
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
  // Right-rail tab: order book vs inline trade ticket.
  // Trade is the default right-rail mode — trading is the product; the
  // book is one tab away. Deep links (?tab=book) still override.
  let bookTab: "book" | "trade" = "trade";

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

  // Alert engine.
  type Alert = {
    id: string;
    symbol: string;
    op: "above" | "below";
    price: number;
    tier: "FLASH" | "PRIORITY" | "ROUTINE";
    triggered: boolean;
  };
  let alerts: Alert[] = [];
  let alertsOpen = false;
  let alertOp: "above" | "below" = "above";
  let alertPrice = "";
  let alertTier: Alert["tier"] = "PRIORITY";
  let notifyReady = false;

  // Draggable dashboard: reorderable info panels (chart + book stay anchored).
  const DEFAULT_PANEL_ORDER = [
    "watch",
    "markets",
    "perp",
    "spot",
    "screener",
    "macro",
    "fred",
    "etf",
    "stablecoins",
    "oil",
    "events",
    "ideas",
    "markets",
    "journal",
  ];
  let panelOrder: string[] = [...DEFAULT_PANEL_ORDER];
  let draggedPanel: string | null = null;
  let dragOverPanel: string | null = null;

  const PREFS_STORAGE_KEY = "trader-ralph-terminal/prefs/v1";
  const ALERTS_STORAGE_KEY = "trader-ralph-terminal/alerts/v1";
  const LAYOUT_STORAGE_KEY = "trader-ralph-terminal/layout/v1";
  // Stale-while-revalidate widget caches (instant paint on reload).
  const CACHE_PANELS = "trader-ralph-terminal/cache/panels/v1";
  const CACHE_NEWS = "trader-ralph-terminal/cache/news/v1";
  const CACHE_MARKETS = "trader-ralph-terminal/cache/markets/v1";
  const CACHE_READS = "trader-ralph-terminal/cache/reads/v1";
  const CACHE_MAX_AGE = 30 * 60_000;
  const MARKETS_MAX_AGE = 24 * 60 * 60_000;

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
  $: authNote = humanizePrivyError(authMessage || $privyAuth.error);
  $: authNoteIsError =
    Boolean($privyAuth.error) ||
    (Boolean(authMessage) && authMessage !== "Code sent.");
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
  $: checkAlerts(latestPrice);
  $: spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : 0;
  $: spreadBps = latestPrice && latestPrice > 0 ? (spread / latestPrice) * 10_000 : 0;
  $: spreadPercent = latestPrice && latestPrice > 0 ? (spread / latestPrice) * 100 : 0;
  $: visibleAskLevels = asks.slice(0, BOOK_LADDER_LEVELS).reverse();
  $: visibleBidLevels = bids.slice(0, BOOK_LADDER_LEVELS);
  $: bookMaxNotional = Math.max(
    1,
    ...visibleAskLevels.map(bookLevelTotalNotional),
    ...visibleBidLevels.map(bookLevelTotalNotional),
  );
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
  $: privyConfig = readPrivyConfig();
  $: fundingPercent =
    marketStats?.funding != null ? marketStats.funding * 100 : null;
  $: priceLoading = chartPrice === null;
  $: statsLoading = marketStats === null;
  $: bookLoading = asks.length === 0 || bids.length === 0;
  $: updatedLoading = lastMarketUpdate === null;
  // Perp ticket preview/AI reads run only when a perp ticket is showing.
  $: ticketActive = tradeOpen || (bookTab === "trade" && tradeMode === "perps");
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
  $: requiredMarginUsd = tradePreview ? tradePreview.notionalUsd / tradeLeverage : 0;
  $: phoenixCollateral = phoenixTrader?.collateralUsd ?? 0;
  $: phoenixStateKnown = phoenixTrader !== null;
  $: needsPhoenixFunding =
    Boolean(phoenixAuthority) &&
    phoenixStateKnown &&
    requiredMarginUsd > 0 &&
    phoenixCollateral + 0.01 < requiredMarginUsd;

  // ── Ambient risk (Bloomberg posture) ───────────────────────────────
  // The trader API stopped shipping uPnL/liq per position; reconstruct
  // client-side: uPnL from live mids, liq from the isolated subaccount's
  // margin with an estimated maintenance ratio (half the initial margin at
  // max leverage). Labeled "est." wherever rendered.
  $: enrichedPositions = (phoenixTrader?.positions ?? []).map((position) => {
    const mark =
      marketMids[position.symbol] ??
      (position.symbol === selectedSymbol ? latestPrice : null);
    const entry = position.entryPrice;
    const upnl =
      mark !== null && entry !== null
        ? (mark - entry) * position.size
        : position.unrealizedPnl;
    const config = markets.find((m) => m.symbol === position.symbol);
    const mmr = config?.maxLeverage ? 0.5 / config.maxLeverage : 0.005;
    const margin = position.marginUsd;
    let liq: number | null = position.liquidationPrice;
    if (entry !== null && margin !== null && position.size !== 0) {
      const denom = position.size - mmr * Math.abs(position.size);
      if (denom !== 0) {
        const estimate = (entry * position.size - margin) / denom;
        liq = Number.isFinite(estimate) && estimate > 0 ? estimate : null;
      }
    }
    return { ...position, unrealizedPnl: upnl, liquidationPrice: liq };
  });
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
  $: selectedPosition =
    enrichedPositions.find((position) => position.symbol === selectedSymbol) ??
    null;
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
  const TP_CHIP_PCTS = [2, 5, 10];
  const SL_CHIP_PCTS = [1, 2, 5];
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

  // Plain Number()-parseable price string, precision scaled to magnitude.
  function fmtTriggerPrice(value: number): string {
    if (value >= 1000) return value.toFixed(1);
    if (value >= 10) return value.toFixed(2);
    if (value >= 1) return value.toFixed(3);
    return value.toFixed(5);
  }

  function setTakeProfitPct(pct: number): void {
    if (!triggerRefPrice) return;
    const factor = tradeSide === "buy" ? 1 + pct / 100 : 1 - pct / 100;
    tradeTakeProfit = fmtTriggerPrice(triggerRefPrice * factor);
  }

  function setStopLossPct(pct: number): void {
    if (!triggerRefPrice) return;
    const factor = tradeSide === "buy" ? 1 - pct / 100 : 1 + pct / 100;
    tradeStopLoss = fmtTriggerPrice(triggerRefPrice * factor);
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
  $: watchRows = watchlist.map((sym) => {
    const spot = spotAssets.find((asset) => asset.symbol.toUpperCase() === sym) ?? null;
    const mid = marketMids[sym] ?? null;
    const hasPerp = mid !== null || markets.some((market) => market.symbol === sym);
    return {
      sym,
      spot,
      hasPerp,
      price: spot?.price ?? mid,
      change: spot?.change24hPct ?? null,
      basisBps: spot?.price && mid ? ((mid - spot.price) / spot.price) * 10_000 : null,
    };
  });

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
    sizingMode === "risk" &&
    Number(tradeRiskUsd) > 0 &&
    riskStopPrice > 0 &&
    riskEntryPrice > 0 &&
    Math.abs(riskEntryPrice - riskStopPrice) > riskEntryPrice * 0.0005
      ? (Number(tradeRiskUsd) * riskEntryPrice) / Math.abs(riskEntryPrice - riskStopPrice)
      : null;
  $: effectiveTradeAmount =
    sizingMode === "risk"
      ? riskNotionalUsd !== null
        ? String(riskNotionalUsd)
        : ""
      : tradeAmount;

  // ── Screener rows over the catalog ──
  $: screenRows = [...spotAssets]
    .filter((asset) => screenHub === "all" || asset.hub === screenHub)
    .sort((a, b) =>
      screenSort === "movers"
        ? Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0)
        : screenSort === "cap"
          ? (b.marketCap ?? 0) - (a.marketCap ?? 0)
          : (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0),
    )
    .slice(0, 20);

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
  $: refreshLiqLines(enrichedPositions, selectedSymbol, tradeMode);

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
    );

  onMount(() => {
    loadPrefs();
    applyDeepLink(); // ?asset=&venue=&side=… — overrides restored prefs
    loadAlerts();
    journalEntries = loadJournal();
    loadLayout();
    hydrateWidgetCache();
    notifyReady =
      typeof Notification !== "undefined" && Notification.permission === "granted";
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
    ];
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void healChartGaps(true);
        if (phoenixAuthority) void refreshPhoenixTrader();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      phoenixStream?.close();
      window.cancelAnimationFrame(bookFrame);
      document.removeEventListener("visibilitychange", onVisible);
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
    } catch (error) {
      streamHealth = "offline";
      marketSourceLabel = "Phoenix Perps unavailable";
      statusMessage =
        error instanceof Error ? error.message : "phoenix-market-load-failed";
    }
  }

  async function switchPhoenixMarket(symbol: string): Promise<void> {
    if (!symbol) return;
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
      statusMessage = "phoenix-candles-loaded";
      startPhoenixStream(symbol);
    } catch (error) {
      streamHealth = latestPrice ? "stale" : "offline";
      statusMessage =
        error instanceof Error ? error.message : "phoenix-market-refresh-failed";
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
        statusMessage = "phoenix-stream-open";
        // On reconnect, backfill candles missed while disconnected.
        if (chartPoints.length > 0) void healChartGaps(true);
      },
      onStatus: (status) => {
        if (status === "streaming") streamHealth = "live";
        if (status === "connecting" || status === "reconnecting") {
          streamHealth = latestPrice ? "stale" : "connecting";
        }
        statusMessage = `phoenix-${status}`;
      },
      onCandle: (point) => {
        chartPoints = upsertLiveCandle(chartPoints, point);
        updateChartPoint(point);
        cacheCandles(symbol, selectedTimeframe, chartPoints);
        latestPrice = marketStats?.markPx ?? point.markClose ?? point.close;
        lastMarketUpdate = Date.now();
        streamHealth = "live";
        statusMessage = "phoenix-live-candles";
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
      onError: (message) => {
        statusMessage = message;
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

  // ── Alert engine ──────────────────────────────────────────────────
  function loadAlerts(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(ALERTS_STORAGE_KEY);
      if (raw) alerts = JSON.parse(raw) as Alert[];
    } catch {
      // ignore malformed alerts
    }
  }

  function saveAlerts(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
    } catch {
      // storage unavailable — non-fatal
    }
  }

  async function addAlert(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const price = Number(alertPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        notifyReady = (await Notification.requestPermission()) === "granted";
      } catch {
        notifyReady = false;
      }
    }
    alerts = [
      ...alerts,
      {
        id: `${selectedSymbol}-${alertOp}-${price}-${alerts.length}`,
        symbol: selectedSymbol,
        op: alertOp,
        price,
        tier: alertTier,
        triggered: false,
      },
    ];
    alertPrice = "";
    saveAlerts();
    checkAlerts(latestPrice);
  }

  function removeAlert(id: string): void {
    alerts = alerts.filter((alert) => alert.id !== id);
    saveAlerts();
  }

  // News coded to the tape: filter the headline panel to the active
  // market (toggleable), and track last-hour headline velocity for it.
  let newsLinked = true;
  $: activeNewsSymbol =
    tradeMode === "spot" ? (spotAsset?.symbol ?? null) : selectedSymbol;
  function headlineMatches(title: string, symbol: string): boolean {
    return title.toUpperCase().includes(symbol.toUpperCase());
  }
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

  function checkAlerts(price: number | null): void {
    if (price === null || alerts.length === 0) return;
    let changed = false;
    for (const alert of alerts) {
      if (alert.triggered || alert.symbol !== selectedSymbol) continue;
      const hit =
        alert.op === "above" ? price >= alert.price : price <= alert.price;
      if (hit) {
        alert.triggered = true;
        changed = true;
        void fireAlert(
          `${alert.tier} · ${alert.symbol}-PERP`,
          `${alert.symbol} ${alert.op} ${alert.price} — now ${formatPrice(price)}`,
        );
      }
    }
    if (changed) {
      alerts = [...alerts];
      saveAlerts();
    }
  }

  // Fired alerts become a persistent, timestamped log plus toasts —
  // Bloomberg's message-pane pattern in miniature.
  type FiredAlert = { ts: number; title: string; body: string };
  const ALERT_LOG_KEY = "trader-ralph-alert-log";
  let alertLog: FiredAlert[] = [];
  let toasts: (FiredAlert & { toastId: number })[] = [];
  let toastSeq = 0;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(ALERT_LOG_KEY);
      const parsed = raw ? (JSON.parse(raw) as FiredAlert[]) : [];
      if (Array.isArray(parsed)) alertLog = parsed.slice(0, 50);
    } catch {
      // storage unavailable — start empty
    }
  }

  function pushToast(entry: FiredAlert): void {
    const toastId = ++toastSeq;
    toasts = [...toasts, { ...entry, toastId }];
    window.setTimeout(() => {
      toasts = toasts.filter((toast) => toast.toastId !== toastId);
    }, 6_000);
  }

  function recordFiredAlert(title: string, body: string): void {
    const entry: FiredAlert = { ts: Date.now(), title, body };
    alertLog = [entry, ...alertLog].slice(0, 50);
    try {
      window.localStorage.setItem(ALERT_LOG_KEY, JSON.stringify(alertLog));
    } catch {
      // non-fatal
    }
    pushToast(entry);
  }

  async function fireAlert(title: string, body: string): Promise<void> {
    recordFiredAlert(title, body);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification(title, { body });
      } catch {
        // notification construction can throw on some platforms
      }
    }
    statusMessage = `alert: ${body}`;
    try {
      await fetch("/notify-discord", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: `🔔 ${title} — ${body}` }),
      });
    } catch {
      // Discord webhook optional / not configured
    }
  }

  // ── Draggable dashboard layout ────────────────────────────────────
  function panelStyle(id: string, order: string[]): string {
    const index = order.indexOf(id);
    return `order: ${index < 0 ? 50 : index + 2};`;
  }

  function loadLayout(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved)) return;
      const known = saved.filter(
        (id): id is string => typeof id === "string" && DEFAULT_PANEL_ORDER.includes(id),
      );
      const missing = DEFAULT_PANEL_ORDER.filter((id) => !known.includes(id));
      panelOrder = [...known, ...missing];
    } catch {
      // ignore malformed layout
    }
  }

  function saveLayout(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(panelOrder));
    } catch {
      // storage unavailable — non-fatal
    }
  }

  // FLIP: animate panels sliding from their old to new positions on reorder.
  async function flipReorder(mutate: () => void): Promise<void> {
    if (typeof document === "undefined") {
      mutate();
      return;
    }
    const before = new Map<string, DOMRect>();
    for (const el of document.querySelectorAll<HTMLElement>("[data-panel]")) {
      const key = el.dataset.panel;
      if (key) before.set(key, el.getBoundingClientRect());
    }
    mutate();
    await tick();
    for (const el of document.querySelectorAll<HTMLElement>("[data-panel]")) {
      const key = el.dataset.panel;
      const first = key ? before.get(key) : undefined;
      if (!first) continue;
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (!dx && !dy) continue;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth; // force reflow so the inverted start applies
      requestAnimationFrame(() => {
        el.style.transition = "transform 240ms cubic-bezier(0.2, 0.85, 0.3, 1)";
        el.style.transform = "";
      });
    }
  }

  function onPanelDragStart(event: DragEvent, id: string): void {
    draggedPanel = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    }
  }

  function onPanelDragOver(event: DragEvent, id: string): void {
    if (!draggedPanel) return;
    // Must preventDefault on every dragover for the drop to be accepted.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dragOverPanel = draggedPanel === id ? null : id;
  }

  function onPanelDrop(event: DragEvent, id: string): void {
    event.preventDefault();
    const dragged = draggedPanel;
    draggedPanel = null;
    dragOverPanel = null;
    if (!dragged || dragged === id) return;
    // Reorder + FLIP-animate the panels sliding to their new positions.
    void flipReorder(() => {
      const fromIndex = panelOrder.indexOf(dragged);
      const toIndex = panelOrder.indexOf(id);
      const order = panelOrder.filter((panel) => panel !== dragged);
      let targetIndex = order.indexOf(id);
      if (targetIndex < 0) {
        targetIndex = order.length;
      } else if (fromIndex < toIndex) {
        // Dragging forward → drop AFTER the target, not before it.
        targetIndex += 1;
      }
      order.splice(targetIndex, 0, dragged);
      panelOrder = order;
      saveLayout();
    });
  }

  function onPanelDragEnd(): void {
    draggedPanel = null;
    dragOverPanel = null;
  }

  function resetLayout(): void {
    panelOrder = [...DEFAULT_PANEL_ORDER];
    saveLayout();
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
    panelOrder.join(",") !== DEFAULT_PANEL_ORDER.join(",");

  function aiErr(error: unknown): string {
    const message = error instanceof Error ? error.message : "ai-error";
    if (message === "ai-proxy-unavailable") return "AI offline (dev proxy only)";
    return message;
  }

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

  function buildTradePreview(
    side: "buy" | "sell",
    amountStr: string,
    leverage: number,
    type: "market" | "limit",
    limitStr: string,
    askLevels: DepthLevel[],
    bidLevels: DepthLevel[],
    refPrice: number | null,
    fundingPct: number | null,
  ): TradePreview | null {
    const notionalUsd = Number(amountStr);
    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return null;
    const levels = side === "buy" ? askLevels : bidLevels;
    const best = levels[0]?.price ?? refPrice ?? null;

    let entry = best;
    let slippageBps: number | null = null;
    let fillable = true;

    if (type === "limit") {
      const limit = Number(limitStr);
      if (Number.isFinite(limit) && limit > 0) entry = limit;
    } else if (levels.length > 0 && best) {
      let remaining = notionalUsd;
      let cost = 0;
      let qty = 0;
      for (const level of levels) {
        const levelNotional = level.price * level.size;
        const take = Math.min(remaining, levelNotional);
        qty += take / level.price;
        cost += take;
        remaining -= take;
        if (remaining <= 0) break;
      }
      fillable = remaining <= 0;
      const avg = qty > 0 ? cost / qty : best;
      entry = avg;
      slippageBps = best > 0 ? Math.abs((avg - best) / best) * 10_000 : null;
    }

    const liqPrice =
      entry && leverage > 0
        ? side === "buy"
          ? entry * (1 - 1 / leverage)
          : entry * (1 + 1 / leverage)
        : null;
    const fundingPer8hUsd =
      fundingPct != null ? (fundingPct / 100) * notionalUsd : null;

    return { notionalUsd, entry, slippageBps, liqPrice, fundingPer8hUsd, fillable };
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

  function clampLeverage(value: number): number {
    return Math.max(1, Math.min(20, Math.round(value)));
  }

  async function activePrivyAccessToken(): Promise<string | null> {
    if (!$privyAuth.authenticated) return $privyAuth.accessToken;
    try {
      return await getPrivyAccessToken();
    } catch {
      return $privyAuth.accessToken;
    }
  }

  function walletFundsLabel(
    auth: PrivyAuthState,
    balanceStatus: "idle" | "loading" | "ready" | "error",
    fundsText: string,
  ): string {
    if (!auth.authenticated) {
      if (!auth.configured) return "Auth unconfigured";
      if (!auth.ready) return "Privy loading";
      return "Account not connected";
    }
    if (auth.walletStatus === "creating") return "Creating wallet";
    if (auth.walletStatus === "error") return "Wallet unavailable";
    if (!auth.walletAddress) return "Wallet pending";
    if (balanceStatus === "loading") return "Loading funds";
    if (balanceStatus === "error") return "Balance unavailable";
    return fundsText;
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
  $: sessionNote = (() => {
    if (tradeMode === "spot") return "24/7 · Jupiter";
    const next = selectedMarket?.nextTransitionUtc;
    if (!next) return "24/7";
    const ms = Date.parse(next) - nowMs;
    if (!Number.isFinite(ms)) return "24/7";
    const hours = Math.floor(Math.abs(ms) / 3_600_000);
    const minutes = Math.floor((Math.abs(ms) % 3_600_000) / 60_000);
    const span = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    if (ms <= 0) return "session transition due";
    return selectedMarket?.marketStatus === "active"
      ? `closes ${span}`
      : `opens ${span}`;
  })();

  function humanizeBalanceError(raw: string): string {
    if (/-40[13]$/.test(raw) || /forbidden/i.test(raw)) {
      return "RPC blocked the request. Set PUBLIC_SOLANA_RPC_URL to a browser-accessible endpoint.";
    }
    if (/-429$/.test(raw)) return "RPC rate-limited. Set a dedicated PUBLIC_SOLANA_RPC_URL.";
    if (/^solana-rpc-http-/.test(raw)) return "RPC request failed. Check PUBLIC_SOLANA_RPC_URL.";
    return raw;
  }

  async function fetchSolanaLamports(address: string): Promise<string> {
    const response = await fetch(solanaRpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "trader-ralph-wallet-balance",
        method: "getBalance",
        // "processed" over the default "finalized": received SOL shows in
        // about a slot instead of ~12s. Display-only, so the tiny rollback
        // window is acceptable.
        params: [address, { commitment: "processed" }],
      }),
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) throw new Error(`solana-rpc-http-${response.status}`);
    if (!isRecord(payload)) throw new Error("solana-rpc-invalid-response");
    if (isRecord(payload.error)) {
      throw new Error(String(payload.error.message ?? "solana-rpc-error"));
    }
    const result = isRecord(payload.result) ? payload.result : null;
    const value = result?.value;
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value)).toString();
    }
    if (typeof value === "string" && /^\d+$/.test(value)) return value;
    throw new Error("solana-balance-missing");
  }

  function solanaRpcUrl(): string {
    const env = import.meta.env as Record<string, string | undefined>;
    const configured = String(
      env.PUBLIC_SOLANA_RPC_URL ??
        env.VITE_SOLANA_RPC_URL ??
        env.NEXT_PUBLIC_SOLANA_RPC_URL ??
        "",
    )
      .trim()
      .replace(/^"+|"+$/g, "")
      .replace(/\\n$/, "");
    return configured || SOLANA_MAINNET_RPC;
  }

  type TransactionSummary = {
    title: string;
    details: string[];
    feePayer?: string;
    programs?: string[];
  };

  async function simulateConfirmAndSend(
    transaction: VersionedTransaction,
    connection: Connection,
    summary: TransactionSummary,
    latestBlockhash?: {
      blockhash: string;
      lastValidBlockHeight: number;
    },
  ): Promise<string> {
    statusMessage = "simulating-transaction";
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

    statusMessage = "awaiting-wallet-signature";
    const signature = await signAndSendSolanaTransaction(
      transaction,
      connection,
    );
    statusMessage = "confirming-transaction";
    if (latestBlockhash) {
      await connection.confirmTransaction(
        { signature, ...latestBlockhash },
        "confirmed",
      );
    } else {
      await connection.confirmTransaction(signature, "confirmed");
    }
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
      statusMessage = "swap-submitted";
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
      statusMessage = "spot-swap-submitted";
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
  const ONBOARD_KEY = "trader-ralph-terminal/phx-referral/v2";

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
        if (result.ok) {
          phoenixWhitelisted = true;
          statusMessage = result.signature
            ? "phoenix-referral-activated"
            : "phoenix-referral-active";
        }
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
      }
      // Store is keyed per wallet, so a mid-flight switch cannot
      // cross-pollinate — record under the authority we fetched for.
      recordSnapshot(authority, state);
    } catch {
      // transient API hiccup — keep last state
    }
  }

  async function signAndSendPhoenixIxs(
    instructions: import("@solana/web3.js").TransactionInstruction[],
    summary: TransactionSummary,
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
    );
  }

  async function submitPhoenixOrder(): Promise<void> {
    if (!phoenixAuthority || phoenixBusy || !tradePreview) return;
    const entry = tradePreview.entry ?? latestPrice;
    if (!entry || entry <= 0) return;
    phoenixBusy = true;
    phoenixActionError = "";
    lastTradeSignature = "";
    try {
      const side: PhoenixSide = tradeSide === "buy" ? "bid" : "ask";
      const limitPrice = Number(tradeLimitPrice);
      const refPrice =
        tradeType === "limit" && Number.isFinite(limitPrice) && limitPrice > 0
          ? limitPrice
          : entry;
      const quantity = tradePreview.notionalUsd / refPrice;
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
      const plan = await buildPlaceOrderPlan({
        authority: phoenixAuthority,
        symbol: selectedSymbol,
        side,
        orderType: tradeType,
        quantity,
        price: tradeType === "limit" ? refPrice : undefined,
        marginUsd: tradePreview.notionalUsd / tradeLeverage,
        takeProfitPrice,
        stopLossPrice,
      });
      lastTradeSignature = await signAndSendPhoenixIxs(
        [...registerIxs, ...plan.instructions],
        {
          title: `${tradeSide === "buy" ? "Long" : "Short"} ${selectedSymbol}-PERP`,
          details: [
            `Venue: Phoenix Perps`,
            `Order: ${tradeType}`,
            `Notional: $${formatNumber(tradePreview.notionalUsd, 2)}`,
            `Margin: $${formatNumber(tradePreview.notionalUsd / tradeLeverage, 2)}`,
            `Entry ref.: ${formatPrice(refPrice)}`,
            `Leverage: ${tradeLeverage}x`,
            ...(takeProfitPrice ? [`Take profit: ${formatPrice(takeProfitPrice)}`] : []),
            ...(stopLossPrice ? [`Stop loss: ${formatPrice(stopLossPrice)}`] : []),
          ],
        },
      );
      statusMessage = "phoenix-order-submitted";
      noteTrade({
        ts: Date.now(),
        venue: "perp",
        symbol: selectedSymbol,
        action: tradeSide === "buy" ? "long" : "short",
        notionalUsd: tradePreview?.notionalUsd ?? null,
        price: refPrice,
        leverage: tradeLeverage,
        signature: lastTradeSignature,
      });
      tradeOpen = false;
      void refreshPhoenixTrader();
      void refreshWalletBalance(phoenixAuthority);
    } catch (error) {
      phoenixActionError = error instanceof Error ? error.message : "order-failed";
    } finally {
      phoenixBusy = false;
    }
  }

  async function closePhoenixPosition(symbol: string, size: number): Promise<void> {
    if (!phoenixAuthority || phoenixBusy || size === 0) return;
    phoenixBusy = true;
    phoenixActionError = "";
    try {
      const plan = await buildPlaceOrderPlan({
        authority: phoenixAuthority,
        symbol,
        side: size > 0 ? "ask" : "bid",
        orderType: "market",
        quantity: Math.abs(size),
        reduceOnly: true,
      });
      lastTradeSignature = await signAndSendPhoenixIxs(plan.instructions, {
        title: `Close ${symbol}-PERP`,
        details: [
          `Venue: Phoenix Perps`,
          `Reduce-only market order`,
          `Size: ${formatNumber(Math.abs(size), 6)} ${symbol}`,
        ],
      });
      statusMessage = "phoenix-position-close-submitted";
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
      void refreshPhoenixTrader();
    } catch (error) {
      phoenixActionError = error instanceof Error ? error.message : "close-failed";
    } finally {
      phoenixBusy = false;
    }
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
    if (!phoenixAuthority || phoenixBusy) return;
    phoenixBusy = true;
    phoenixActionError = "";
    try {
      const instructions = await buildCancelAllIxs(phoenixAuthority, symbol, side);
      lastTradeSignature = await signAndSendPhoenixIxs(instructions, {
        title: `Cancel ${symbol}-PERP orders`,
        details: [
          `Venue: Phoenix Perps`,
          `Side: ${side === "bid" ? "bids" : "asks"}`,
        ],
      });
      statusMessage = "phoenix-cancel-submitted";
      void refreshPhoenixTrader();
    } catch (error) {
      phoenixActionError = error instanceof Error ? error.message : "cancel-failed";
    } finally {
      phoenixBusy = false;
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
      statusMessage = `phoenix-${direction}-submitted`;
      depositAmount = "";
      withdrawAmount = "";
      void refreshPhoenixTrader();
      void refreshWalletBalance(phoenixAuthority);
    } catch (error) {
      collateralError = error instanceof Error ? error.message : `${direction}-failed`;
    } finally {
      collateralBusy = false;
    }
  }

  function shortAddress(value: string | null): string {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return "--";
    if (trimmed.length <= 14) return trimmed;
    return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
  }

  function shortEmail(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length <= 22) return trimmed;
    const [name, domain] = trimmed.split("@");
    if (!domain) return `${trimmed.slice(0, 19)}…`;
    const head = name.length > 10 ? `${name.slice(0, 9)}…` : name;
    return `${head}@${domain}`;
  }

  function walletStatusText(
    status: "missing" | "creating" | "ready" | "error",
  ): string {
    switch (status) {
      case "ready":
        return "Wallet ready";
      case "creating":
        return "Creating wallet…";
      case "error":
        return "Wallet error";
      default:
        return "No wallet";
    }
  }

  function humanizePrivyError(value: string | null | undefined): string {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const known: Record<string, string> = {
      "email-required": "Enter a valid email address.",
      "code-required": "Enter the 6-digit code we emailed you.",
      "privy-app-id-missing": "Auth is not configured for this environment.",
      "privy-not-configured": "Auth is not configured for this environment.",
      "privy-code-send-failed": "Couldn't send the code. Check the email and try again.",
      "privy-login-failed": "That code didn't work. Request a new one and retry.",
      "privy-logout-failed": "Couldn't log out cleanly. Try again.",
      "Code sent.": "Code sent — check your inbox.",
    };
    if (known[raw]) return known[raw];
    // Surface Privy SDK messages verbatim; tidy our internal kebab-case codes.
    if (/^[a-z0-9-]+$/.test(raw)) {
      return raw.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    }
    return raw;
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

  async function copyWalletAddress(): Promise<void> {
    if (!$privyAuth.walletAddress) return;
    try {
      await navigator.clipboard.writeText($privyAuth.walletAddress);
      statusMessage = "wallet-address-copied";
      walletCopied = true;
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => {
        walletCopied = false;
      }, 1600);
    } catch {
      walletBalanceError = "Clipboard unavailable in this browser.";
    }
  }

  function disconnectedRows(reason: string): SignalRow[] {
    return [
      {
        label: "Status",
        value: "Not connected",
        status: reason,
      },
    ];
  }

  function disconnectedPanel(reason: string): DataPanel {
    return {
      rows: disconnectedRows(reason),
      status: "not connected",
      source: "",
    };
  }

  function summarizeEdgeStatus(panels: DataPanel[]): string {
    if (panels.some((panel) => panel.status === "ready")) return "ready";
    const first = panels.find((panel) => panel.status !== "ready");
    return first?.status ?? "not connected";
  }

  function setPriceMode(mode: "last" | "mark"): void {
    if (priceMode === mode) return;
    priceMode = mode;
    // Re-render the candle series in the selected price basis.
    setChartData();
  }

  function toCandle(point: MarketPoint): CandlestickData<UTCTimestamp> {
    // Mark mode renders the mark-price OHLC series (the smoother series that
    // drives funding/liquidations); falls back to last-trade when absent.
    const useMark = priceMode === "mark";
    return {
      time: Math.floor(point.ts / 1000) as UTCTimestamp,
      open: useMark ? point.markOpen ?? point.open : point.open,
      high: useMark ? point.markHigh ?? point.high : point.high,
      low: useMark ? point.markLow ?? point.low : point.low,
      close: useMark ? point.markClose ?? point.close : point.close,
    };
  }

  function toVolume(point: MarketPoint) {
    const up = point.close >= point.open;
    return {
      time: Math.floor(point.ts / 1000) as UTCTimestamp,
      value: point.volumeQuote ?? point.volume ?? 0,
      color: up ? "rgba(44, 233, 127, 0.45)" : "rgba(255, 90, 106, 0.45)",
    };
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
      alerts = [
        ...alerts,
        {
          id: `${selectedSymbol}-${op}-${price}-${alerts.length}`,
          symbol: selectedSymbol,
          op,
          price,
          tier: "ROUTINE",
          triggered: false,
        },
      ];
      saveAlerts();
      pushToast({
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
    refreshLiqLines(enrichedPositions, selectedSymbol, tradeMode);
  }

  function renderChartSeries(points: MarketPoint[]): void {
    if (!candleSeries || !volumeSeries) return;
    candleSeries.setData(points.map(toCandle));
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
    candleSeries.update(toCandle(point));
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

  function formatChartRange(points: MarketPoint[]): string {
    const first = points.at(0);
    const last = points.at(-1);
    if (!first || !last) return "--";
    const formatter = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
    return `${formatter.format(first.ts)} - ${formatter.format(last.ts)}`;
  }

  function computeMarketChange(
    price: number | null,
    stats: PhoenixMarketStats | null,
    points: MarketPoint[],
  ): number | null {
    if (price && stats?.prevDayPx && stats.prevDayPx > 0) {
      return ((price - stats.prevDayPx) / stats.prevDayPx) * 100;
    }
    const latest = points.at(-1);
    const anchor = points.at(-80) ?? points.at(0);
    if (!latest || !anchor || anchor.price <= 0) return null;
    return ((latest.price - anchor.price) / anchor.price) * 100;
  }

  function formatCandleCountdown(
    point: MarketPoint | null,
    timeframe: PhoenixTimeframe,
    currentTime: number,
  ): string {
    if (!point) return "--";
    const duration = timeframeMs(timeframe);
    const remaining = Math.max(0, point.ts + duration - currentTime);
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1_000);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function timeframeMs(timeframe: PhoenixTimeframe): number {
    if (timeframe.endsWith("m")) return Number(timeframe.slice(0, -1)) * 60_000;
    if (timeframe.endsWith("h")) {
      return Number(timeframe.slice(0, -1)) * 60 * 60_000;
    }
    return 60_000;
  }

  function selectedMarketTableRows(
    market: PhoenixMarketConfig | null,
    stats: PhoenixMarketStats | null,
    price: number | null,
  ): SignalRow[] {
    if (!market) {
      return disconnectedRows("Phoenix market metadata loading");
    }
    return [
      {
        label: "Market",
        value: `${market.symbol}-PERP`,
        status: market.marketStatus,
      },
      {
        label: "Mark",
        value: formatPrice(stats?.markPx ?? price),
        status: `oracle ${formatPrice(stats?.oraclePx)}`,
      },
      {
        label: "Open interest",
        value: formatNumber(stats?.openInterest, 2),
        status: "base",
      },
      {
        label: "Funding",
        value: formatPercent((stats?.funding ?? 0) * 100),
        status: "rate",
      },
      {
        label: "Fees",
        value: `${formatPercent((market.makerFee ?? 0) * 100)} / ${formatPercent((market.takerFee ?? 0) * 100)}`,
        status: "maker/taker",
      },
      {
        label: "Margin",
        value: market.isolatedOnly ? "isolated only" : "cross + isolated",
        status: market.maxLeverage ? `${formatNumber(market.maxLeverage, 0)}x max` : "--",
      },
    ];
  }

  function emptyMarketStats(symbol: string): PhoenixMarketStats {
    return {
      symbol,
      dayNtlVlm: null,
      prevDayPx: null,
      markPx: null,
      midPx: null,
      funding: null,
      openInterest: null,
      oraclePx: null,
    };
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
  // right-rail Trade tab (no modal over the book).
  function prefillFromBook(price: number, rowSide: "ask" | "bid"): void {
    tradeSide = rowSide === "ask" ? "sell" : "buy";
    tradeType = "limit";
    tradeLimitPrice = String(price);
    bookTab = "trade";
  }

  function openTrade(side: "buy" | "sell"): void {
    tradeSide = side;
    tradeAmount = "25";
    tradeTakeProfit = "";
    tradeStopLoss = "";
    phoenixActionError = "";
    lastTradeSignature = "";
    tradeOpen = true;
  }

  function bookLevelNotional(level: DepthLevel | null | undefined): number | null {
    if (!level) return null;
    return level.price * level.size;
  }

  function bookLevelTotalNotional(level: DepthLevel | null | undefined): number {
    if (!level) return 0;
    return level.price * level.cum;
  }

  function depthWidth(level: DepthLevel): number {
    return Math.min(100, Math.max(2, (bookLevelTotalNotional(level) / bookMaxNotional) * 100));
  }

  function formatBookPrice(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "--";
    }
    const abs = Math.abs(value);
    const digits = abs >= 1_000 ? 0 : abs >= 1 ? 2 : 4;
    return value.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function openAuthModal(): void {
    authOpen = true;
    authMessage = $privyAuth.error ?? "";
    authStep = $privyAuth.otpSentTo ? "code" : "email";
    if ($privyAuth.email && !authEmail) authEmail = $privyAuth.email;
  }

  async function submitAuthEmail(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    authBusy = true;
    authMessage = "";
    try {
      await sendPrivyEmailCode(authEmail);
      authStep = "code";
      authMessage = "Code sent.";
    } catch (error) {
      authMessage = error instanceof Error ? error.message : "privy-code-send-failed";
    } finally {
      authBusy = false;
    }
  }

  async function resendAuthCode(): Promise<void> {
    if (authBusy || !authEmail) return;
    authBusy = true;
    authMessage = "";
    try {
      await sendPrivyEmailCode(authEmail);
      authMessage = "Code sent.";
    } catch (error) {
      authMessage = error instanceof Error ? error.message : "privy-code-send-failed";
    } finally {
      authBusy = false;
    }
  }

  function backToEmailStep(): void {
    authStep = "email";
    authCode = "";
    authMessage = "";
  }

  async function submitAuthCode(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    authBusy = true;
    authMessage = "";
    try {
      await loginPrivyWithCode(authEmail, authCode);
      authOpen = false;
      authCode = "";
      statusMessage = "privy-session-connected";
      await refreshEdgeModules();
    } catch (error) {
      authMessage = error instanceof Error ? error.message : "privy-login-failed";
    } finally {
      authBusy = false;
    }
  }

  async function disconnectPrivy(): Promise<void> {
    authBusy = true;
    try {
      await logoutPrivy();
      accountMenuOpen = false;
      statusMessage = "privy-session-cleared";
      await refreshEdgeModules();
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : "privy-logout-failed";
    } finally {
      authBusy = false;
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
    const params = new URLSearchParams(window.location.search);
    const KNOWN = [
      "asset", "venue", "side", "size", "leverage", "type", "price", "tp",
      "sl", "ticket", "tf", "mode", "fund", "tab", "alerts", "cmd", "watch",
    ];
    if (!KNOWN.some((key) => params.has(key))) return;

    const str = (key: string) => params.get(key)?.trim() || null;
    const lower = (key: string) => str(key)?.toLowerCase() ?? null;
    // Positive finite number within sane bounds, else null.
    const numParam = (key: string, max: number): number | null => {
      const value = Number(str(key));
      return Number.isFinite(value) && value > 0 && value <= max ? value : null;
    };
    const flag = (key: string) => {
      const value = lower(key);
      return value !== null && value !== "0" && value !== "false";
    };

    const asset = str("asset");
    const venue = lower("venue");
    const side = lower("side");
    const isPerp = venue === "perp" || venue === "perps";
    const wantsSell = side === "sell" || side === "short";
    const size = numParam("size", 10_000_000);
    const tab = lower("tab");

    if (isPerp) {
      pendingTradeMode = null;
      if (asset) selectedSymbol = asset.toUpperCase().replace(/-PERP$/, "");
      if (side) tradeSide = wantsSell ? "sell" : "buy";
      if (size !== null) tradeAmount = String(size);

      const leverage = numParam("leverage", 100);
      if (leverage !== null) {
        // Snap to the select's options so the binding displays correctly.
        const allowed = [1, 2, 5, 10, 20];
        tradeLeverage = allowed.reduce((best, option) =>
          Math.abs(option - leverage) < Math.abs(best - leverage) ? option : best,
        );
      }

      const limitPrice = numParam("price", 100_000_000);
      const type = lower("type");
      if (limitPrice !== null) {
        tradeType = "limit";
        tradeLimitPrice = String(limitPrice);
      } else if (type === "limit" || type === "market") {
        tradeType = type;
      }
      const takeProfit = numParam("tp", 100_000_000);
      const stopLoss = numParam("sl", 100_000_000);
      if (takeProfit !== null) tradeTakeProfit = String(takeProfit);
      if (stopLoss !== null) tradeStopLoss = String(stopLoss);

      bookTab = tab === "book" ? "book" : "trade";
    } else if (asset || venue || side || size !== null) {
      // Default venue is spot — the broader universe.
      pendingTradeMode = "spot";
      if (asset) pendingSpotAssetId = asset.toLowerCase();
      if (side) spotSide = wantsSell ? "sell" : "buy";
      if (size !== null) spotAmount = String(size);
      const spotLimit = numParam("price", 100_000_000);
      if (spotLimit !== null) {
        spotOrderType = "limit";
        spotLimitPrice = String(spotLimit);
      }
      if (asset || side || size !== null) bookTab = tab === "book" ? "book" : "trade";
    }
    if (tab === "book" || tab === "trade") bookTab = tab;

    const tf = lower("tf");
    if (PHOENIX_TIMEFRAMES.includes(tf as PhoenixTimeframe)) {
      selectedTimeframe = tf as PhoenixTimeframe;
    }
    const mode = lower("mode");
    if (mode === "last" || mode === "mark") priceMode = mode;

    const watch = str("watch");
    if (watch) {
      const symbols = watch
        .split(",")
        .map((sym) => sym.trim().toUpperCase())
        .filter((sym) => /^[A-Z0-9]{1,12}$/.test(sym));
      watchlist = [...new Set([...watchlist, ...symbols])].slice(0, 24);
    }

    const cmd = str("cmd");
    if (cmd) {
      bookTab = "trade";
      void runCommand(cmd.slice(0, 200)); // parses straight into the ticket
    }

    // Overlays — at most one (funds > ticket > alerts), modals never stack.
    const fund = lower("fund");
    if (fund) {
      openFunds();
      if (fund === "convert" || fund === "phoenix") fundsTab = fund;
    } else if (flag("ticket") && isPerp) {
      phoenixActionError = "";
      lastTradeSignature = "";
      tradeOpen = true;
    } else if (flag("alerts")) {
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
  function refreshLiqLines(
    positions: PhoenixPosition[],
    symbol: string,
    mode: "perps" | "spot",
  ): void {
    if (!candleSeries) return;
    for (const line of liqLines) candleSeries.removePriceLine(line);
    liqLines = [];
    if (mode !== "perps") return;
    for (const position of positions) {
      if (position.symbol !== symbol || !position.liquidationPrice) continue;
      liqLines.push(
        candleSeries.createPriceLine({
          price: position.liquidationPrice,
          color: colors.down,
          lineWidth: 1,
          lineStyle: 2, // dashed
          axisLabelVisible: true,
          title: "LIQ",
        }),
      );
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

  function triggerOrderView(order: TriggerOrder): {
    side: "buy" | "sell";
    symbol: string;
    notionalUsd: number | null;
    limitPrice: number | null;
  } | null {
    const isBuy = order.inputMint === SPOT_USDC_MINT;
    const tokenMint = isBuy ? order.outputMint : order.inputMint;
    const asset = spotAssets.find((candidate) => candidate.mint === tokenMint);
    if (!asset) return null;
    const usdAtoms = isBuy ? order.makingAmountAtoms : order.takingAmountAtoms;
    const tokenAtoms = isBuy ? order.takingAmountAtoms : order.makingAmountAtoms;
    const usd = usdAtoms / 1e6;
    const qty = tokenAtoms / 10 ** asset.decimals;
    return {
      side: isBuy ? "buy" : "sell",
      symbol: asset.symbol,
      notionalUsd: Number.isFinite(usd) && usd > 0 ? usd : null,
      limitPrice: qty > 0 && usd > 0 ? usd / qty : null,
    };
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
      statusMessage = "spot-limit-placed";
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
    try {
      const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data.symbol === "string") selectedSymbol = data.symbol;
      if (PHOENIX_TIMEFRAMES.includes(data.timeframe as PhoenixTimeframe)) {
        selectedTimeframe = data.timeframe as PhoenixTimeframe;
      }
      if (data.priceMode === "last" || data.priceMode === "mark") {
        priceMode = data.priceMode;
      }
      if (data.chartScale === "price" || data.chartScale === "percent") {
        chartScale = data.chartScale;
      }
      if (data.chartAxisMode === "linear" || data.chartAxisMode === "log") {
        chartAxisMode = data.chartAxisMode;
      }
      if (typeof data.visibleCandleCount === "number" && Number.isFinite(data.visibleCandleCount)) {
        visibleCandleCount = data.visibleCandleCount;
      }
      if (data.tradeMode === "spot") pendingTradeMode = "spot";
      if (typeof data.spotAssetId === "string") pendingSpotAssetId = data.spotAssetId;
      if (Array.isArray(data.watchlist)) {
        watchlist = data.watchlist
          .filter((sym): sym is string => typeof sym === "string")
          .map((sym) => sym.toUpperCase())
          .slice(0, 24);
      }
      if (data.screenSort === "movers" || data.screenSort === "volume" || data.screenSort === "cap") {
        screenSort = data.screenSort;
      }
      if (
        data.screenHub === "all" || data.screenHub === "crypto" ||
        data.screenHub === "equities" || data.screenHub === "pre-ipo"
      ) {
        screenHub = data.screenHub;
      }
      if (data.sizingMode === "usd" || data.sizingMode === "risk") {
        sizingMode = data.sizingMode;
      }
    } catch {
      // ignore malformed persisted preferences
    }
  }

  function persistPrefs(
    _symbol: string,
    _timeframe: PhoenixTimeframe,
    _priceMode: "last" | "mark",
    _scale: ChartScale,
    _axis: ChartAxisMode,
    _visible: number,
    _tradeMode: "perps" | "spot",
    _spotAssetId: string | null,
    _watchlist: string[],
    _screenSort: string,
    _screenHub: string,
    _sizingMode: string,
  ): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        PREFS_STORAGE_KEY,
        JSON.stringify({
          symbol: _symbol,
          timeframe: _timeframe,
          priceMode: _priceMode,
          chartScale: _scale,
          chartAxisMode: _axis,
          visibleCandleCount: _visible,
          tradeMode: _tradeMode,
          spotAssetId: _spotAssetId,
          watchlist: _watchlist,
          screenSort: _screenSort,
          screenHub: _screenHub,
          sizingMode: _sizingMode,
        }),
      );
    } catch {
      // storage may be unavailable (private mode, quota) — non-fatal
    }
  }

  const SECTION_LINKS: { id: string; label: string }[] = [
    { id: "section-chart", label: "Chart" },
    { id: "section-book", label: "Book" },
    { id: "section-perp", label: "Perp" },
    { id: "section-markets", label: "Markets" },
    { id: "section-macro", label: "Macro" },
  ];

  function scrollToSection(id: string): void {
    activeSection = id;
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Market palette — the "/" picker for every tradable market ──────
  // One primitive for both venues: perp markets (live mids) and the spot
  // catalog (full 24h stats). Selecting a row switches venue if needed.
  type PaletteRow = {
    kind: "perp" | "spot";
    key: string;
    symbol: string;
    name: string;
    imageUrl: string | null;
    lev: number | null;
    price: number | null;
    change24hPct: number | null;
    volumeUsd: number | null;
    hub: "perps" | "crypto" | "equities" | "pre-ipo";
    asset?: SpotAsset;
  };
  type PaletteTab = "all" | "perps" | "crypto" | "equities" | "pre-ipo";
  const PALETTE_TABS: { key: PaletteTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "perps", label: "Perps" },
    { key: "crypto", label: "Crypto" },
    { key: "equities", label: "Equities" },
    { key: "pre-ipo", label: "Pre-IPO" },
  ];
  let paletteOpen = false;
  let paletteQuery = "";
  let paletteTab: PaletteTab = "all";
  let paletteIndex = 0;
  let paletteInput: HTMLInputElement | null = null;
  let paletteList: HTMLDivElement | null = null;

  function buildPaletteRows(
    perpMarkets: PhoenixMarketConfig[],
    assets: SpotAsset[],
    mids: Record<string, number>,
    stats: Record<string, PhoenixDailyStat>,
    query: string,
    tab: PaletteTab,
  ): PaletteRow[] {
    const perps: PaletteRow[] = perpMarkets.map((market) => ({
      kind: "perp",
      key: `perp:${market.symbol}`,
      symbol: market.symbol,
      name: `${market.symbol}-PERP`,
      imageUrl: null,
      lev: market.maxLeverage,
      price: mids[market.symbol] ?? stats[market.symbol]?.lastPrice ?? null,
      change24hPct: stats[market.symbol]?.change24hPct ?? null,
      volumeUsd: stats[market.symbol]?.volume24hUsd ?? null,
      hub: "perps",
    }));
    const spots: PaletteRow[] = assets.map((asset) => ({
      kind: "spot",
      key: `spot:${asset.assetId}`,
      symbol: asset.symbol,
      name: asset.name,
      imageUrl: asset.imageUrl || null,
      lev: null,
      price: asset.price,
      change24hPct: asset.change24hPct,
      volumeUsd: asset.volume24hUsd,
      hub: asset.hub,
    }));
    for (const [index, asset] of assets.entries()) spots[index].asset = asset;
    spots.sort((a, b) => (b.volumeUsd ?? -1) - (a.volumeUsd ?? -1));
    // Perps lead — this is a perp terminal first; spot follows by volume.
    let rows =
      tab === "perps"
        ? perps
        : tab === "all"
          ? [...perps, ...spots]
          : spots.filter((row) => row.hub === tab);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (row) =>
          row.symbol.toLowerCase().includes(q) ||
          row.name.toLowerCase().includes(q),
      );
    }
    return rows.slice(0, 80);
  }

  $: paletteRows = buildPaletteRows(
    markets,
    spotAssets,
    marketMids,
    dailyStats,
    paletteQuery,
    paletteTab,
  );
  $: if (paletteIndex >= paletteRows.length) {
    paletteIndex = Math.max(0, paletteRows.length - 1);
  }

  function openPalette(): void {
    paletteOpen = true;
    paletteQuery = "";
    paletteTab = "all";
    paletteIndex = 0;
    void tick().then(() => paletteInput?.focus());
  }

  function choosePalette(row: PaletteRow): void {
    if (row.kind === "perp") {
      if (tradeMode !== "perps") setTradeMode("perps", false);
      if (row.symbol !== selectedSymbol) void switchPhoenixMarket(row.symbol);
    } else if (row.asset) {
      if (tradeMode !== "spot") setTradeMode("spot", false);
      selectSpotAsset(row.asset);
    }
    paletteOpen = false;
  }

  function scrollPaletteRowIntoView(): void {
    void tick().then(() =>
      paletteList?.children[paletteIndex]?.scrollIntoView({ block: "nearest" }),
    );
  }

  function onPaletteKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      paletteIndex = Math.min(paletteIndex + 1, paletteRows.length - 1);
      scrollPaletteRowIntoView();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      paletteIndex = Math.max(paletteIndex - 1, 0);
      scrollPaletteRowIntoView();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = paletteRows[paletteIndex];
      if (row) choosePalette(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      paletteOpen = false;
    }
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
    if (authOpen || tradeOpen || alertsOpen || fundsOpen || paletteOpen) {
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
          spotSide = "buy";
          bookTab = "trade";
          scheduleSpotQuote();
        } else {
          openTrade("buy");
        }
        break;
      case "s":
        if (tradeMode === "spot") {
          spotSide = "sell";
          bookTab = "trade";
          scheduleSpotQuote();
        } else {
          openTrade("sell");
        }
        break;
      case "f":
        resetChartView();
        break;
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
  <title>Trader Ralph</title>
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

  <header class="topbar">
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
        Alerts{#if alerts.filter((a) => !a.triggered).length}
          <span class="alerts-count">{alerts.filter((a) => !a.triggered).length}</span>
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

              <button class="account-action danger" type="button" disabled={authBusy} onclick={disconnectPrivy}>
                {authBusy ? "Logging out…" : "Log out"}
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

  <div class="market-rail">
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

  <div class="news-ticker" aria-label="Market headlines">
    {#if news.length}
      <div class="news-track">
        {#each [...news.slice(0, 14), ...news.slice(0, 14)] as item}
          <a class="news-item" href={item.url} target="_blank" rel="noopener noreferrer">
            <span class="news-domain">{item.domain}</span>
            {item.title}
          </a>
        {/each}
      </div>
    {:else}
      <div class="news-placeholder" aria-hidden="true">
        <i></i><i></i><i></i><i></i>
      </div>
    {/if}
  </div>
  </div>

  <section id="terminal-content" class="dashboard">
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

        <div class="book book-ladder">
          <div class="book-header">
            <span>Price USDC</span>
            <span>Size USDC</span>
            <span>Total USDC</span>
          </div>

          {#each visibleAskLevels as ask}
            <button type="button" class="book-row ask" onclick={() => prefillFromBook(ask.price, "ask")}>
              <span class="depth-bar" style={`width: ${depthWidth(ask)}%;`}></span>
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
              <span class="depth-bar" style={`width: ${depthWidth(bid)}%;`}></span>
              <span class="book-price">{formatBookPrice(bid.price)}</span>
              <span>{formatNumber(bookLevelNotional(bid), 0)}</span>
              <span>{formatNumber(bookLevelTotalNotional(bid), 0)}</span>
            </button>
          {:else}
            <div class="empty">No live order book levels loaded.</div>
          {/each}
        </div>

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
      {:else}
        <div class="panel-ticket">
          {#if tradeMode === "spot"}
            {@render SpotTicketForm()}
          {:else}
            {@render TicketForm()}
          {/if}
        </div>
      {/if}
    </section>

    <section
      class="panel monitor-panel"
      role="group"
      data-panel="markets"
      style={panelStyle("markets", panelOrder)}
      class:dragging={draggedPanel === "markets"}
      class:drag-over={dragOverPanel === "markets"}
      ondragover={(event) => onPanelDragOver(event, "markets")}
      ondragleave={() => {
        if (dragOverPanel === "markets") dragOverPanel = null;
      }}
      ondrop={(event) => onPanelDrop(event, "markets")}
    >
      <div class="panel-head">
        {@render DragHead("markets", "MARKETS", `${markets.length} perp markets`)}
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
      style={panelStyle("perp", panelOrder)}
      class:dragging={draggedPanel === "perp"}
      class:drag-over={dragOverPanel === "perp"}
      ondragover={(event) => onPanelDragOver(event, "perp")}
      ondragleave={() => {
        if (dragOverPanel === "perp") dragOverPanel = null;
      }}
      ondrop={(event) => onPanelDrop(event, "perp")}
    >
      <div class="panel-head">
        {@render DragHead("perp", "PERP_DESK", "Phoenix account")}
        <button class="primary" type="button" onclick={() => openTrade("buy")}>Trade</button>
      </div>
      {@render AiReadLine(fundingRead)}

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
          <button class="row-action" type="button" onclick={openFunds}>Deposit</button>
        </div>

        {#if phoenixTrader.positions.length > 0}
          {@render AiReadLine(briefRead)}
        {/if}

        {#if phoenixActionError}
          <p class="auth-note error venue-note">{phoenixActionError}</p>
        {/if}

        {#if enrichedPositions.length > 0}
          <div class="venue-section">Positions</div>
          {#each enrichedPositions as position}
            <div class="venue-row">
              <span class={position.size > 0 ? "positive" : "negative"}>
                {position.size > 0 ? "LONG" : "SHORT"} {position.symbol}
              </span>
              <b>{formatNumber(Math.abs(position.size), 4)} @ {formatPrice(position.entryPrice)}</b>
              <em
                class:positive={(position.unrealizedPnl ?? 0) >= 0}
                class:negative={(position.unrealizedPnl ?? 0) < 0}
              >{position.unrealizedPnl !== null ? `$${formatNumber(position.unrealizedPnl, 2)}` : "--"}</em>
              <small>liq est {formatPrice(position.liquidationPrice)}</small>
              {#if position.unrealizedPnl !== null}
                <button
                  class="row-action"
                  type="button"
                  onclick={() => sharePhoenixPosition(position, marketMids)}
                >
                  Share
                </button>
              {/if}
              <button
                class="row-action"
                type="button"
                disabled={phoenixBusy}
                onclick={() => closePhoenixPosition(position.symbol, position.size)}
              >
                Close
              </button>
            </div>
          {/each}
        {/if}

        {#if phoenixTrader.orders.length > 0}
          <div class="venue-section">Open orders</div>
          {#each phoenixTrader.orders as order}
            <div class="venue-row">
              <span class={order.side === "bid" ? "positive" : "negative"}>
                {order.side.toUpperCase()} {order.symbol}{order.isStopLoss ? " · SL" : ""}
              </span>
              <b>{formatNumber(order.remaining, 4)} @ {formatPrice(order.price)}</b>
              <em>#{order.orderSequenceNumber.slice(0, 8)}</em>
              <button
                class="row-action"
                type="button"
                disabled={phoenixBusy}
                onclick={() => cancelPhoenixOrders(order.symbol, order.side)}
              >
                Cancel side
              </button>
            </div>
          {/each}
        {/if}

        {#if phoenixTrader.positions.length === 0 && phoenixTrader.orders.length === 0}
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

    {@render MacroPanel("MACRO_RADAR", "Signal blend", macroPanel, "macro", "section-macro", macroRead)}
    {@render MacroPanel("FRED_NOWCAST", "Rates + liquidity", fredPanel, "fred")}
    {@render MacroPanel("ETF_FLOWS", "Spot flow tape", etfPanel, "etf")}
    {@render MacroPanel("STABLECOINS", "Dollar rail watch", stablecoinPanel, "stablecoins")}
    {@render MacroPanel("OIL_MACRO", "Energy regime", oilPanel, "oil")}

    <section
      class="panel macro-panel"
      role="group"
      data-panel="events"
      style={panelStyle("events", panelOrder)}
      class:dragging={draggedPanel === "events"}
      class:drag-over={dragOverPanel === "events"}
      ondragover={(event) => onPanelDragOver(event, "events")}
      ondragleave={() => {
        if (dragOverPanel === "events") dragOverPanel = null;
      }}
      ondrop={(event) => onPanelDrop(event, "events")}
    >
      <div class="panel-head">
        {@render DragHead("events", "EVENT_RADAR", "Live headlines")}
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
      {@render AiReadLine(eventRead)}
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
      style={panelStyle("ideas", panelOrder)}
      class:dragging={draggedPanel === "ideas"}
      class:drag-over={dragOverPanel === "ideas"}
      ondragover={(event) => onPanelDragOver(event, "ideas")}
      ondragleave={() => {
        if (dragOverPanel === "ideas") dragOverPanel = null;
      }}
      ondrop={(event) => onPanelDrop(event, "ideas")}
    >
      <div class="panel-head">
        {@render DragHead("ideas", "DESK_IDEAS", "Cross-signal synthesis")}
      </div>
      {@render AiReadLine(ideasRead)}
    </section>

    <section
      class="panel watchlist-panel"
      role="group"
      data-panel="watch"
      style={panelStyle("watch", panelOrder)}
      class:dragging={draggedPanel === "watch"}
      class:drag-over={dragOverPanel === "watch"}
      ondragover={(event) => onPanelDragOver(event, "watch")}
      ondragleave={() => {
        if (dragOverPanel === "watch") dragOverPanel = null;
      }}
      ondrop={(event) => onPanelDrop(event, "watch")}
    >
      <div class="panel-head">
        {@render DragHead("watch", "WATCHLIST", `${watchlist.length} starred`)}
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
      style={panelStyle("screener", panelOrder)}
      class:dragging={draggedPanel === "screener"}
      class:drag-over={dragOverPanel === "screener"}
      ondragover={(event) => onPanelDragOver(event, "screener")}
      ondragleave={() => {
        if (dragOverPanel === "screener") dragOverPanel = null;
      }}
      ondrop={(event) => onPanelDrop(event, "screener")}
    >
      <div class="panel-head">
        {@render DragHead("screener", "SCREENER", `${screenRows.length} of ${spotAssets.length}`)}
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
      style={panelStyle("spot", panelOrder)}
      class:dragging={draggedPanel === "spot"}
      class:drag-over={dragOverPanel === "spot"}
      ondragover={(event) => onPanelDragOver(event, "spot")}
      ondragleave={() => {
        if (dragOverPanel === "spot") dragOverPanel = null;
      }}
      ondrop={(event) => onPanelDrop(event, "spot")}
    >
      <div class="panel-head">
        {@render DragHead("spot", "SPOT_MARKETS", `${spotAssets.length} tokens.xyz assets`)}
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
      style={panelStyle("markets", panelOrder)}
      class:dragging={draggedPanel === "markets"}
      class:drag-over={dragOverPanel === "markets"}
      ondragover={(event) => onPanelDragOver(event, "markets")}
      ondragleave={() => {
        if (dragOverPanel === "markets") dragOverPanel = null;
      }}
      ondrop={(event) => onPanelDrop(event, "markets")}
    >
      <div class="panel-head">
        {@render DragHead("markets", "PHOENIX_MARKETS", `${markets.length} perp markets`)}
      </div>
      {@render AiReadLine(scannerRead)}
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
      style={panelStyle("journal", panelOrder)}
      class:dragging={draggedPanel === "journal"}
      class:drag-over={dragOverPanel === "journal"}
      ondragover={(event) => onPanelDragOver(event, "journal")}
      ondragleave={() => {
        if (dragOverPanel === "journal") dragOverPanel = null;
      }}
      ondrop={(event) => onPanelDrop(event, "journal")}
    >
      <div class="panel-head">
        {@render DragHead("journal", "JOURNAL", `${journalToday.length} today · ${journalEntries.length} total`)}
        {#if journalEntries.length > 0}
          <button class="row-action" type="button" onclick={exportJournalCsv}>CSV</button>
          <button class="row-action" type="button" onclick={wipeJournal}>Clear</button>
        {/if}
      </div>
      {#if journalToday.length >= 2}
        {@render AiReadLine(recapRead)}
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
    <span class="sl-grow" aria-hidden="true"></span>
    {#if $privyAuth.walletAddress}
      <span class="mono">{shortAddress($privyAuth.walletAddress)}</span>
      <span class="sl-sep" aria-hidden="true"></span>
    {/if}
    <button type="button" class="sl-help" onclick={() => (cheatOpen = true)}>? shortcuts</button>
  </footer>
</main>

{#if toasts.length > 0}
  <div class="toast-stack" role="status" aria-live="polite">
    {#each toasts as toast (toast.toastId)}
      <div class="toast">
        <b>{toast.title}</b>
        <span>{toast.body}</span>
      </div>
    {/each}
  </div>
{/if}

{#if cheatOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => (cheatOpen = false)}>
    <div
      class="modal cheat"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <div class="panel-head">
        <div><p>KEYBOARD</p><h2>Shortcuts</h2></div>
        <button class="modal-close" type="button" aria-label="Close" onclick={() => (cheatOpen = false)}>×</button>
      </div>
      <div class="modal-body cheat-body">
        {#each [
          ["/", "Market palette"],
          ["B / S", "Long / Short ticket"],
          ["[ ]", "Previous / next timeframe"],
          [", .", "Cycle watchlist"],
          ["F", "Fit chart + re-arm autoscale"],
          ["Alt+Click", "Set price alert at cursor"],
          ["Drag axis", "Scale price/time · double-click resets"],
          ["?", "This sheet"],
          ["Esc", "Close any overlay"],
        ] as [keys, what] (keys)}
          <div class="cheat-row"><kbd>{keys}</kbd><span>{what}</span></div>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if authOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => (authOpen = false)}>
    <section
      class="modal auth-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <div class="panel-head">
        <div>
          <p>PRIVY_AUTH</p>
          <h2>Connect account</h2>
        </div>
        <button class="modal-close" type="button" aria-label="Close" onclick={() => (authOpen = false)}>×</button>
      </div>

      <div class="modal-body">
        {#if !privyConfig.appId}
          <div class="auth-callout error">
            <strong>Auth is not configured</strong>
            <span>Set <code>PUBLIC_PRIVY_APP_ID</code> (or <code>VITE_PRIVY_APP_ID</code> / <code>NEXT_PUBLIC_PRIVY_APP_ID</code>) for this frontend, then reload.</span>
          </div>
        {:else if $privyAuth.authenticated}
          <div class="auth-success">
            <span class="auth-check" aria-hidden="true">✓</span>
            <strong>You're connected</strong>
            <span>{$privyAuth.email ?? shortAddress($privyAuth.walletAddress)}</span>
            <span class="wallet-badge {$privyAuth.walletStatus}">{walletStatusLabel}</span>
            <button class="primary wide" type="button" onclick={() => (authOpen = false)}>Done</button>
          </div>
        {:else}
          <ol class="auth-steps" aria-hidden="true">
            <li class:active={authStep === "email"} class:done={authStep === "code"}>
              <span class="step-dot">1</span> Email
            </li>
            <li class="step-divider"></li>
            <li class:active={authStep === "code"}>
              <span class="step-dot">2</span> Verify
            </li>
          </ol>

          {#if authStep === "email"}
            <p class="auth-lead">Sign in with your email — we'll send a one-time code. A Solana wallet is provisioned automatically.</p>
            <form class="auth-form" onsubmit={submitAuthEmail}>
              <label>
                Email address
                <input
                  bind:value={authEmail}
                  autocomplete="email"
                  inputmode="email"
                  placeholder="you@example.com"
                  required
                  type="email"
                />
              </label>
              <button class="primary wide" type="submit" disabled={authBusy || !$privyAuth.ready}>
                {#if authBusy}<span class="spinner" aria-hidden="true"></span>{/if}
                {authBusy ? "Sending code…" : !$privyAuth.ready ? "Preparing…" : "Send code"}
              </button>
            </form>
          {:else}
            <p class="auth-lead">Enter the 6-digit code sent to <b>{authEmail || "your email"}</b>.</p>
            <form class="auth-form" onsubmit={submitAuthCode}>
              <label>
                Verification code
                <input
                  class="code-input"
                  bind:value={authCode}
                  autocomplete="one-time-code"
                  inputmode="numeric"
                  maxlength="6"
                  placeholder="123456"
                  required
                />
              </label>
              <button class="primary wide" type="submit" disabled={authBusy || !authCode.trim()}>
                {#if authBusy}<span class="spinner" aria-hidden="true"></span>{/if}
                {authBusy ? "Verifying…" : "Verify & connect"}
              </button>
              <div class="auth-secondary">
                <button class="linklike" type="button" disabled={authBusy} onclick={backToEmailStep}>
                  Use another email
                </button>
                <button class="linklike" type="button" disabled={authBusy} onclick={resendAuthCode}>
                  Resend code
                </button>
              </div>
            </form>
          {/if}
        {/if}

        {#if authNote && !$privyAuth.authenticated}
          <p class="auth-note" class:error={authNoteIsError}>{authNote}</p>
        {/if}
      </div>
    </section>
  </div>
{/if}

{#if tradeOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => (tradeOpen = false)}>
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
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

{#if alertsOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => (alertsOpen = false)}>
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <div class="panel-head">
        <div>
          <p>ALERTS</p>
          <h2>{selectedSymbol}-PERP · {formatPrice(latestPrice)}</h2>
        </div>
        <button class="modal-close" type="button" aria-label="Close" onclick={() => (alertsOpen = false)}>×</button>
      </div>
      <div class="modal-body">
        <form class="alert-form" onsubmit={addAlert}>
          <select bind:value={alertOp} aria-label="Condition">
            <option value="above">above</option>
            <option value="below">below</option>
          </select>
          <input bind:value={alertPrice} inputmode="decimal" placeholder={formatPrice(latestPrice)} aria-label="Price" />
          <select bind:value={alertTier} aria-label="Tier">
            <option value="FLASH">FLASH</option>
            <option value="PRIORITY">PRIORITY</option>
            <option value="ROUTINE">ROUTINE</option>
          </select>
          <button class="primary" type="submit">Arm</button>
        </form>
        {#if !notifyReady}
          <p class="auth-note">Arming an alert will ask for browser-notification permission so you get pinged off-screen.</p>
        {/if}
        <div class="alert-list">
          {#each alerts as alert (alert.id)}
            <div class="alert-row" class:done={alert.triggered}>
              <span class="alert-tier {alert.tier.toLowerCase()}">{alert.tier}</span>
              <b>{alert.symbol} {alert.op} {formatPrice(alert.price)}</b>
              <em>{alert.triggered ? "triggered" : "armed"}</em>
              <button class="row-action" type="button" onclick={() => removeAlert(alert.id)}>Remove</button>
            </div>
          {:else}
            <div class="empty">No alerts armed. Add a price trigger above.</div>
          {/each}
        </div>
        {#if alertLog.length > 0}
          <div class="venue-section">Fired</div>
          <div class="alert-list">
            {#each alertLog.slice(0, 10) as fired (fired.ts)}
              <div class="alert-row done">
                <span class="mono alert-when">{new Date(fired.ts).toISOString().slice(5, 16).replace("T", " ")}Z</span>
                <b>{fired.title}</b>
                <em>{fired.body}</em>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>
{/if}

{#if paletteOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => (paletteOpen = false)}>
    <div
      class="modal palette"
      role="dialog"
      aria-modal="true"
      aria-label="Select market"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={onPaletteKeydown}
    >
      <div class="palette-search">
        <span class="palette-glass" aria-hidden="true">⌕</span>
        <input
          bind:this={paletteInput}
          bind:value={paletteQuery}
          placeholder="Search markets"
          aria-label="Search markets"
          oninput={() => (paletteIndex = 0)}
        />
      </div>
      <div class="palette-tabs" role="tablist" aria-label="Market category">
        {#each PALETTE_TABS as tab (tab.key)}
          <button
            role="tab"
            aria-selected={paletteTab === tab.key}
            class:active={paletteTab === tab.key}
            type="button"
            onclick={() => {
              paletteTab = tab.key;
              paletteIndex = 0;
            }}
          >
            {tab.label}
          </button>
        {/each}
      </div>
      <div class="palette-row palette-head" aria-hidden="true">
        <span></span>
        <span>Market</span>
        <span class="r">Price</span>
        <span class="r">24h</span>
        <span class="r pal-wide">Volume</span>
      </div>
      <div class="palette-list" bind:this={paletteList}>
        {#each paletteRows as row, index (row.key)}
          <button
            type="button"
            class="palette-row"
            class:active={index === paletteIndex}
            onclick={() => choosePalette(row)}
            onmousemove={() => (paletteIndex = index)}
          >
            <span
              class="pal-star"
              class:starred={watchlist.includes(row.symbol.toUpperCase())}
              role="presentation"
              onclick={(event) => {
                event.stopPropagation();
                toggleWatch(row.symbol);
              }}
            >{watchlist.includes(row.symbol.toUpperCase()) ? "★" : "☆"}</span>
            <span class="pal-id">
              {#if row.imageUrl}<img src={row.imageUrl} alt="" loading="lazy" />{/if}
              <b>{row.kind === "perp" ? `${row.symbol}` : row.symbol}</b>
              {#if row.lev}<i class="pal-lev">{row.lev}x</i>{/if}
              <small>{row.kind === "perp" ? "PERP · Phoenix" : row.name}</small>
            </span>
            <span class="r mono">{formatPrice(row.price)}</span>
            <span
              class="r mono"
              class:positive={(row.change24hPct ?? 0) > 0 && row.change24hPct !== null}
              class:negative={(row.change24hPct ?? 0) < 0}
            >{row.change24hPct === null ? "--" : formatPercent(row.change24hPct)}</span>
            <span class="r mono pal-wide">
              {row.volumeUsd === null ? "--" : `$${formatNumber(row.volumeUsd, 0)}`}
            </span>
          </button>
        {:else}
          <p class="palette-empty">No markets match “{paletteQuery}”.</p>
        {/each}
      </div>
      <div class="palette-foot" aria-hidden="true">
        <span><kbd>/</kbd> Open</span>
        <span><kbd>↑↓</kbd> Navigate</span>
        <span><kbd>Enter</kbd> Select</span>
        <span><kbd>Esc</kbd> Close</span>
      </div>
    </div>
  </div>
{/if}

{#if fundsOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => (fundsOpen = false)}>
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
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
        onclick={() => {
          spotSide = "buy";
          scheduleSpotQuote();
        }}
      >
        Buy
      </button>
      <button
        class:active={spotSide === "sell"}
        type="button"
        onclick={() => {
          spotSide = "sell";
          scheduleSpotQuote();
        }}
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

    <label>
      {spotSide === "buy" ? "Spend (USDC)" : `Sell (${spotAsset.symbol})`}
      <input bind:value={spotAmount} oninput={scheduleSpotQuote} inputmode="decimal" placeholder={spotSide === "buy" ? "25" : "0.5"} />
    </label>

    {#if spotOrderType === "limit"}
      <label>
        Limit price (USDC)
        <input bind:value={spotLimitPrice} inputmode="decimal" placeholder={formatPrice(spotAsset.price)} />
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
          type="button"
          disabled={spotBusy || !(Number(spotLimitPrice) > 0) || !(Number(spotAmount) > 0) || walletScreen.flagged}
          onclick={submitSpotLimitOrder}
        >
          {#if spotBusy}<span class="spinner" aria-hidden="true"></span>{/if}
          {spotBusy
            ? "Signing…"
            : `Limit ${spotSide} ${spotAsset.symbol} @ ${spotLimitPrice || "—"}`}
        </button>
      {:else}
        <button
          class="primary wide"
          type="button"
          disabled={spotBusy || !spotQuote || spotQuoteStatus !== "quoted" || walletScreen.flagged}
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
        {@const view = triggerOrderView(order)}
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
          <input bind:value={tradeAmount} inputmode="decimal" />
        {:else}
          <input bind:value={tradeRiskUsd} inputmode="decimal" placeholder="25" />
        {/if}
      </label>
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
        Limit price
        <input
          bind:value={tradeLimitPrice}
          inputmode="decimal"
          placeholder={formatPrice(latestPrice)}
          disabled={tradeType !== "limit"}
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
          <input bind:value={tradeTakeProfit} inputmode="decimal" placeholder="optional" />
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

    <!-- Always-on ladder: book and ticket are simultaneous, not tabs. -->
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
      <!-- Single reserved status line: error, tx link, or quiet hint. -->
      <p class="ticket-status" class:error={Boolean(phoenixActionError)}>
        {#if phoenixActionError}
          {phoenixActionError}
        {:else if lastTradeSignature}
          Order submitted ·
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
        <button
          class="primary wide"
          type="button"
          disabled={phoenixBusy || !tradePreview || walletScreen.flagged}
          onclick={submitPhoenixOrder}
        >
          {#if phoenixBusy}<span class="spinner" aria-hidden="true"></span>{/if}
          {phoenixBusy
            ? "Signing…"
            : sizingMode === "risk" && !slSet
              ? "Set a stop loss to size"
              : !tradePreview
                ? "Enter a size"
                : `${tradeSide === "buy" ? "Long" : "Short"} ${selectedSymbol}-PERP · ${tradeLeverage}x`}
        </button>
      {/if}
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

{#snippet Spark(values: number[], tone: string)}
  {@const min = Math.min(...values)}
  {@const max = Math.max(...values)}
  {@const range = max - min || 1}
  {@const last = values.length - 1 || 1}
  <svg class="spark {tone}" viewBox="0 0 64 20" preserveAspectRatio="none" aria-hidden="true">
    <polyline
      points={values
        .map((v, i) => `${(i / last) * 64},${19 - ((v - min) / range) * 18}`)
        .join(" ")}
    />
  </svg>
{/snippet}

{#snippet AiReadLine(read: AiRead)}
  <!-- Always rendered: the slot is reserved so notes never shift layout. -->
  <div class="desk-note">
    <span class="desk-kicker" class:desk-kicker-dim={read.phase === "idle" || (read.phase === "loading" && !read.text)}>Desk</span>
    {#if read.phase === "error"}
      <span class="desk-text desk-dim">{read.error}</span>
    {:else if read.phase === "ready" || read.text}
      <span class="desk-text" class:desk-soft-pulse={read.phase === "loading"}>{read.text}</span>
      {#if read.asOf}
        <em class="desk-asof">as of {new Date(read.asOf).toISOString().slice(11, 19)}Z</em>
      {/if}
    {:else}
      <span class="desk-skeleton" aria-hidden="true">
        <i></i>
        <i></i>
      </span>
    {/if}
  </div>
{/snippet}

{#snippet DragHead(panelId: string, kicker: string, title: string)}
  <div
    class="panel-head-main"
    draggable="true"
    role="button"
    tabindex="0"
    aria-label="Drag to reorder {kicker} panel"
    ondragstart={(event) => onPanelDragStart(event, panelId)}
    ondragend={onPanelDragEnd}
  >
    <span class="drag-grip" aria-hidden="true">⠿</span>
    <div>
      <p>{kicker}</p>
      <h2>{title}</h2>
    </div>
  </div>
{/snippet}

{#snippet MacroPanel(
  title: string,
  subtitle: string,
  panel: DataPanel,
  panelId: string,
  id?: string,
  read?: AiRead,
)}
  <section
    class="panel macro-panel"
    {id}
    role="group"
    data-panel={panelId}
    style={panelStyle(panelId, panelOrder)}
    class:dragging={draggedPanel === panelId}
    class:drag-over={dragOverPanel === panelId}
    ondragover={(event) => onPanelDragOver(event, panelId)}
    ondragleave={() => {
      if (dragOverPanel === panelId) dragOverPanel = null;
    }}
    ondrop={(event) => onPanelDrop(event, panelId)}
  >
    <div class="panel-head">
      {@render DragHead(panelId, title, subtitle)}
      {#if panel.summary}
        <span class="verdict-badge {panel.summary.tone ?? 'flat'}">
          {panel.summary.label}
        </span>
      {/if}
    </div>
    {#if read}
      {@render AiReadLine(read)}
    {/if}
    <div class="table macro-table">
      {#each panel.rows.slice(0, 6) as row}
        <div class="macro-row">
          <span class="macro-label">{row.label}</span>
          <span class="macro-spark">
            {#if row.spark && row.spark.length > 1}
              {@render Spark(row.spark, row.tone ?? "flat")}
            {/if}
          </span>
          <span class="macro-value">
            <b class={row.tone ?? "flat"}>{row.value}</b>
            {#if row.change}
              <em class="macro-delta {row.tone ?? 'flat'}">{row.change}</em>
            {/if}
          </span>
          <span class="macro-chip {row.tone ?? 'flat'}">{row.status}</span>
        </div>
      {/each}
    </div>
  </section>
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
  .panel-head,
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

  .secondary,
  .primary,
  .ghost,
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

  .primary {
    background: var(--accent);
    color: #04130d;
    border-color: var(--accent);
  }

  .primary:hover,
  .secondary:hover,
  .ghost:hover,
  .chart-toolbar button:hover,
  .chart-tools button:hover,
  .chart-footer button:hover,
  .book-row:hover {
    transform: translateY(-1px);
    border-color: rgba(255, 77, 151, 0.55);
  }

  .secondary,
  .ghost {
    color: var(--muted);
  }

  .ghost {
    min-height: 1.7rem;
    padding: 0.25rem 0.45rem;
    font-size: 0.75rem;
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

  /* Loading skeletons */
  .skeleton {
    display: inline-block;
    border-radius: 0;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 25%,
      rgba(255, 255, 255, 0.1) 37%,
      rgba(255, 255, 255, 0.04) 63%
    );
    background-size: 300% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 150% 0;
    }
    100% {
      background-position: -150% 0;
    }
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

  .spinner {
    width: 0.85rem;
    height: 0.85rem;
    border: 2px solid rgba(4, 19, 13, 0.35);
    border-top-color: #04130d;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
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

  .wallet-badge {
    flex: 0 0 auto;
    border-radius: 0;
    padding: 0.18rem 0.5rem;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border: 1px solid transparent;
  }

  .wallet-badge.ready {
    color: var(--up);
    background: var(--up-soft);
    border-color: rgba(44, 233, 127, 0.4);
  }

  .wallet-badge.creating {
    color: var(--amber);
    background: rgba(228, 173, 79, 0.12);
    border-color: rgba(228, 173, 79, 0.4);
  }

  .wallet-badge.error {
    color: var(--red);
    background: rgba(240, 107, 99, 0.12);
    border-color: rgba(240, 107, 99, 0.4);
  }

  .wallet-badge.missing {
    color: var(--muted);
    background: var(--surface-2);
    border-color: var(--line);
  }

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

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
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

  .row-action {
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.66rem;
    font-weight: 700;
    min-height: 1.6rem;
    padding: 0.15rem 0.45rem;
  }

  .row-action:hover:not(:disabled) {
    color: var(--ink);
    border-color: rgba(255, 77, 151, 0.45);
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
  .side-toggle.funds-tabs button.active {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .side-toggle.funds-tabs-3 {
    grid-template-columns: 1fr 1fr 1fr;
  }

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

  .venue-section {
    margin: 0.35rem 0.75rem 0.1rem;
    color: var(--accent);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .venue-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 0.55rem;
    margin: 0 0.65rem;
    padding: 0.4rem 0.1rem;
    border-bottom: 1px solid var(--line-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.72rem;
  }

  .venue-row span {
    font-weight: 800;
  }

  .venue-row b {
    color: var(--ink);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .venue-row em {
    font-style: normal;
  }

  .venue-row small {
    color: var(--muted);
  }

  .venue-note {
    margin: 0 0.75rem 0.4rem;
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

  .panel-head p {
    margin: 0;
    color: var(--accent);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    font-weight: 800;
  }

  .panel-head h2 {
    margin: 0;
  }

  .dashboard {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: clamp(0.6rem, 1vw, 0.9rem);
    padding: clamp(0.75rem, 1.4vw, 1.15rem);
  }

  .panel {
    position: relative;
    min-height: 12rem;
    border: 1px solid var(--line);
    border-radius: 0;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent),
      var(--surface);
    overflow: hidden;
    transition:
      outline-color 120ms ease,
      opacity 120ms ease,
      border-color 160ms ease;
    outline: 1px solid transparent;
    outline-offset: -1px;
    /* Hairline top highlight — gives panels a machined edge. */
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
  }

  .panel:hover {
    border-color: #323845;
  }

  .panel.dragging {
    opacity: 0.4;
  }

  .panel.drag-over {
    outline-color: var(--accent);
  }

  /* Draggable panel header (grab the title to move the widget) */
  .panel-head-main {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    cursor: grab;
  }

  .panel-head-main:active {
    cursor: grabbing;
  }

  .drag-grip {
    color: var(--faint);
    font-size: 0.85rem;
    line-height: 1;
    letter-spacing: -0.1em;
    opacity: 0;
    transition: opacity 120ms ease, color 120ms ease;
  }

  .panel:hover .drag-grip {
    opacity: 1;
  }

  .panel-head-main:hover .drag-grip {
    color: var(--accent);
  }

  .panel-head {
    justify-content: space-between;
    min-height: 3.15rem;
    padding: 0.75rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .panel-head h2 {
    font-size: 0.86rem;
    font-weight: 700;
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

  select,
  input {
    width: 100%;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 0;
    min-height: 2rem;
    padding: 0.3rem 0.45rem;
  }

  label {
    display: grid;
    gap: 0.35rem;
    color: var(--muted);
    font-size: 0.72rem;
  }

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

  .positive,
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

  .spot-book-note {
    padding: 1rem 0.9rem;
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


  .empty {
    color: var(--muted);
    padding: 0.65rem;
    font-size: 0.8rem;
  }

  .warn {
    color: var(--amber);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.68);
    backdrop-filter: blur(2px);
    /* Top-anchored: content growth extends downward only (no recentering). */
    place-items: start center;
    padding: clamp(1rem, 6vh, 4rem) 1rem 1rem;
  }

  /* ── Market palette ──────────────────────────────────────────────── */
  .modal.palette {
    width: min(52rem, 100%);
    max-height: min(40rem, calc(100dvh - 4rem));
  }

  .palette-search {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .palette-glass {
    color: var(--faint);
    font-size: 1.1rem;
  }

  .palette-search input {
    flex: 1;
    border: 0;
    background: transparent;
    font-size: 1rem;
    color: var(--ink);
  }

  .palette-search input:focus {
    outline: none;
  }

  .palette-tabs {
    display: flex;
    gap: 0.2rem;
    padding: 0 0.6rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .palette-tabs button {
    border: 0;
    border-bottom: 3px solid transparent;
    background: transparent;
    color: var(--muted);
    padding: 0.5rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .palette-tabs button:hover {
    color: var(--ink);
  }

  .palette-tabs button.active {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }

  .palette-row {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr) 7rem 5.5rem 8rem;
    gap: 0.6rem;
    align-items: center;
    width: 100%;
    padding: 0.5rem 1rem;
    border: 0;
    border-bottom: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .palette-head {
    color: var(--faint);
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-family: ui-monospace, monospace;
    cursor: default;
    padding-block: 0.4rem;
  }

  .palette-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .palette-list .palette-row.active {
    background: var(--surface-2);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .pal-star {
    color: var(--faint);
    cursor: pointer;
    text-align: center;
  }

  .pal-star:hover,
  .pal-star.starred {
    color: var(--amber);
  }

  .pal-id {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    min-width: 0;
  }

  .pal-id img {
    width: 1.15rem;
    height: 1.15rem;
    border-radius: 50%;
    align-self: center;
    flex: 0 0 auto;
  }

  .pal-id b {
    font-size: 0.9rem;
  }

  .pal-id small {
    color: var(--faint);
    font-size: 0.7rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pal-lev {
    font-style: normal;
    font-family: ui-monospace, monospace;
    font-size: 0.64rem;
    color: var(--muted);
    border: 1px solid var(--line);
    padding: 0.02rem 0.3rem;
  }

  .palette-empty {
    padding: 1.2rem 1rem;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .palette-foot {
    display: flex;
    gap: 1.2rem;
    padding: 0.55rem 1rem;
    border-top: 1px solid var(--line-soft);
    color: var(--muted);
    font-size: 0.72rem;
  }

  .palette-foot kbd {
    font-family: ui-monospace, monospace;
    font-size: 0.68rem;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    padding: 0.05rem 0.35rem;
    margin-right: 0.3rem;
  }

  @media (max-width: 720px) {
    .palette-row {
      grid-template-columns: 2rem minmax(0, 1fr) 6rem 4.5rem;
    }

    .pal-wide {
      display: none;
    }
  }

  .modal {
    width: min(30rem, 100%);
    max-height: calc(100vh - 2rem);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 1.5rem 5rem rgba(0, 0, 0, 0.5);
    animation: modal-in 160ms cubic-bezier(0.2, 0.85, 0.3, 1);
  }

  @keyframes modal-in {
    from {
      opacity: 0;
      transform: translateY(0.4rem) scale(0.985);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* Desk note inside modals: stable footprint, text clamped to 3 lines. */
  .modal .desk-note {
    min-height: 3.1rem;
    max-height: 4.9rem;
    overflow: hidden;
  }

  .modal .desk-text {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Long dynamic CTAs (e.g. "Deposit $12.50 USDC to Phoenix first") must
     wrap inside the button, never clip out of it. */
  .primary.wide {
    height: auto;
    white-space: normal;
    line-height: 1.25;
    padding-block: 0.55rem;
  }

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

  .modal .panel-head {
    flex: 0 0 auto;
  }

  .modal-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 1.2rem;
    line-height: 1;
  }

  .modal-close:hover {
    color: var(--ink);
    border-color: rgba(240, 107, 99, 0.5);
  }

  .modal-body {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    overflow-y: auto;
  }

  .modal-body label {
    gap: 0.4rem;
    font-size: 0.74rem;
  }

  .auth-form {
    display: grid;
    gap: 0.7rem;
  }

  .wide {
    width: 100%;
  }

  .auth-steps {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .auth-steps li {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--faint);
    font-size: 0.74rem;
    font-weight: 600;
  }

  .auth-steps li.active {
    color: var(--ink);
  }

  .auth-steps li.done {
    color: var(--accent);
  }

  .auth-steps .step-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    border: 1px solid currentColor;
    font-size: 0.72rem;
  }

  .auth-steps li.active .step-dot {
    background: var(--accent);
    border-color: var(--accent);
    color: #04130d;
  }

  .step-divider {
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .auth-lead {
    margin: 0;
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.45;
  }

  .auth-lead b {
    color: var(--ink);
  }

  .code-input {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 1.3rem;
    letter-spacing: 0.5rem;
    text-align: center;
  }

  .auth-secondary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .linklike {
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 0.74rem;
    padding: 0.2rem 0;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .linklike:hover:not(:disabled) {
    color: var(--ink);
  }

  .auth-note {
    margin: 0;
    border-radius: 0;
    padding: 0.55rem 0.7rem;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.78rem;
    line-height: 1.4;
  }

  .auth-note.error {
    color: var(--red);
    background: rgba(240, 107, 99, 0.1);
    border: 1px solid rgba(240, 107, 99, 0.3);
  }

  .auth-callout {
    display: grid;
    gap: 0.35rem;
    border-radius: 0;
    padding: 0.85rem;
    background: var(--surface-2);
    border: 1px solid var(--line);
    font-size: 0.8rem;
    line-height: 1.45;
  }

  .auth-callout.error {
    border-color: rgba(240, 107, 99, 0.35);
  }

  .auth-callout strong {
    color: var(--ink);
  }

  .auth-callout span {
    color: var(--muted);
  }

  .auth-callout code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.74rem;
    color: var(--blue);
  }

  .auth-success {
    display: grid;
    justify-items: center;
    gap: 0.5rem;
    text-align: center;
    padding: 0.5rem 0;
  }

  .auth-success strong {
    font-size: 1rem;
  }

  .auth-success span {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .auth-success .wide {
    margin-top: 0.5rem;
  }

  .auth-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 1.3rem;
    font-weight: 800;
  }

  .negative {
    color: var(--red);
  }

  .market-rail {
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

  :where(button, a, select, input):focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-radius: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
    }
  }

  /* ── Macro panels: verdict badge, signal rows, sparklines ─────────── */
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

  .macro-table {
    gap: 0;
  }

  .macro-row {
    display: grid;
    grid-template-columns: minmax(3.5rem, 1fr) 3.4rem minmax(0, auto) auto;
    align-items: center;
    gap: 0.55rem;
    min-height: 2.2rem;
    padding: 0.5rem 0.25rem;
    border-bottom: 1px solid var(--line-soft);
    font-size: 0.75rem;
  }

  .macro-label {
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .macro-spark {
    display: flex;
    align-items: center;
    height: 1.15rem;
  }

  .spark {
    width: 3.4rem;
    height: 1.15rem;
  }

  .spark polyline {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.3;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .macro-value {
    display: inline-flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 0.35rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .macro-value b {
    color: var(--ink);
    font-weight: 700;
  }

  .macro-delta {
    color: var(--muted);
    font-size: 0.68rem;
    font-style: normal;
    font-weight: 600;
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

  /* Tone palette shared by badge / value / delta / chip / spark */
  .up,
  .spark.up polyline {
    color: #8decc3;
    stroke: var(--up);
  }

  .down,
  .spark.down polyline {
    color: var(--red);
    stroke: var(--red);
  }

  .warn,
  .spark.warn polyline {
    color: var(--amber);
    stroke: var(--amber);
  }

  .verdict-badge.up,
  .macro-chip.up {
    color: var(--up);
    background: var(--up-soft);
    border-color: rgba(44, 233, 127, 0.35);
  }

  .verdict-badge.down,
  .macro-chip.down {
    color: var(--red);
    background: rgba(240, 107, 99, 0.12);
    border-color: rgba(240, 107, 99, 0.35);
  }

  .verdict-badge.warn,
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

  /* ── Desk note: market commentary, styled like a wire line ────────── */
  .desk-note {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    /* Reserved two-line footprint so loading → text never shifts layout. */
    min-height: 3.1rem;
    margin: 0 0.65rem 0.45rem;
    padding: 0.45rem 0.6rem;
    border-left: 2px solid rgba(255, 77, 151, 0.55);
    background: rgba(255, 255, 255, 0.015);
    border-radius: 0;
    font-size: 0.76rem;
    line-height: 1.45;
  }

  .desk-kicker {
    flex: 0 0 auto;
    color: var(--accent);
    font-size: 0.56rem;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    transform: translateY(0.05rem);
  }

  .desk-text {
    color: var(--ink);
  }

  .desk-dim {
    color: var(--muted);
  }

  .desk-kicker-dim {
    opacity: 0.45;
    transition: opacity 400ms ease;
  }

  /* Refreshing an existing read: barely-there breathing, no text swap. */
  .desk-soft-pulse {
    animation: desk-breathe 2.6s ease-in-out infinite;
  }

  @keyframes desk-breathe {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.72;
    }
  }

  /* Loading: two soft shimmer lines in place of text. */
  .desk-skeleton {
    flex: 1;
    display: grid;
    gap: 0.45rem;
    align-self: center;
  }

  .desk-skeleton i {
    display: block;
    height: 0.5rem;
    border-radius: 0;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.035) 25%,
      rgba(255, 77, 151, 0.07) 50%,
      rgba(255, 255, 255, 0.035) 75%
    );
    background-size: 280% 100%;
    animation: shimmer 2.2s ease-in-out infinite;
  }

  .desk-skeleton i:last-child {
    width: 62%;
    animation-delay: 180ms;
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

  .dashboard { padding-bottom: 2.6rem; }

  /* ── Toasts ──────────────────────────────────────────────────────── */
  .toast-stack {
    position: fixed;
    top: 4rem;
    right: 1rem;
    z-index: 90;
    display: grid;
    gap: 0.4rem;
  }

  .toast {
    display: grid;
    gap: 0.1rem;
    min-width: 16rem;
    max-width: 22rem;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--accent);
    background: var(--surface);
    font-size: 0.74rem;
  }

  .toast b { color: var(--accent); font-size: 0.68rem; letter-spacing: 0.04em; }

  /* ── Cheat sheet ─────────────────────────────────────────────────── */
  .cheat-body { display: grid; gap: 0.3rem; }

  .cheat-row {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.8rem;
    align-items: baseline;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .cheat-row kbd {
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    padding: 0.08rem 0.4rem;
    text-align: center;
  }

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

  /* ── Desk read provenance ────────────────────────────────────────── */
  .desk-asof {
    display: block;
    font-style: normal;
    font-family: ui-monospace, monospace;
    font-size: 0.58rem;
    color: var(--faint);
    margin-top: 0.15rem;
  }

  .alert-when { color: var(--faint); font-size: 0.62rem; }

  /* ── Trade ticket ─────────────────────────────────────────────────── */
  .field {
    display: grid;
    gap: 0.3rem;
    align-content: start;
  }

  .chip-row {
    display: flex;
    gap: 0.3rem;
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

  .side-toggle {
    display: grid;
    grid-template-columns: 1fr 1fr;
    /* overflow:hidden zeroes the grid auto-minimum — pin the height so a
       height-constrained modal grid can never collapse this row. */
    min-height: 2.45rem;
    border: 1px solid var(--line);
    border-radius: 0;
    overflow: hidden;
  }

  .side-toggle button {
    border: 0;
    background: var(--surface-2);
    color: var(--muted);
    min-height: 2.3rem;
    font-weight: 800;
  }

  .side-toggle button.active:first-child {
    background: var(--up-soft);
    color: var(--up);
  }

  .side-toggle button.active:last-child {
    background: var(--down-soft);
    color: var(--down);
  }

  .ticket-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.45rem 0.6rem;
  }

  .ticket-preview {
    display: grid;
    gap: 0.05rem;
    border: 1px solid var(--line-soft);
    border-radius: 0;
    padding: 0.3rem 0.65rem;
    background: rgba(255, 255, 255, 0.02);
  }

  .preview-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.12rem 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.76rem;
  }

  .preview-row span {
    flex: 0 1 auto;
    color: var(--muted);
    white-space: nowrap;
  }

  .preview-row b {
    text-align: right;
    overflow-wrap: anywhere;
  }

  .preview-row b {
    color: var(--ink);
  }

  .warn-row {
    justify-content: flex-start;
    color: var(--amber);
  }

  /* ── News ticker ──────────────────────────────────────────────────── */
  .news-ticker {
    /* Fixed footprint: present from first paint, headlines fade in. */
    height: 2rem;
    overflow: hidden;
    border-top: 1px solid var(--line-soft);
    background: rgba(8, 10, 13, 0.6);
    white-space: nowrap;
    /* Soft fade at both edges so items don't hard-clip. */
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 3rem, #000 calc(100% - 3rem), transparent);
    mask-image: linear-gradient(90deg, transparent, #000 3rem, #000 calc(100% - 3rem), transparent);
  }

  .news-placeholder {
    display: flex;
    gap: 2.5rem;
    align-items: center;
    height: 100%;
    padding-left: 3.5rem;
  }

  .news-placeholder i {
    display: block;
    width: clamp(8rem, 18vw, 16rem);
    height: 0.45rem;
    border-radius: 0;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.03) 25%,
      rgba(255, 255, 255, 0.07) 50%,
      rgba(255, 255, 255, 0.03) 75%
    );
    background-size: 280% 100%;
    animation: shimmer 2.4s ease-in-out infinite;
  }

  .news-placeholder i:nth-child(2) { animation-delay: 150ms; }
  .news-placeholder i:nth-child(3) { animation-delay: 300ms; }
  .news-placeholder i:nth-child(4) { animation-delay: 450ms; }

  .news-track {
    display: inline-flex;
    align-items: center;
    gap: 2.5rem;
    height: 100%;
    animation: news-scroll 90s linear infinite, fade-in 600ms ease;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .news-ticker:hover .news-track {
    animation-play-state: paused;
  }

  @keyframes news-scroll {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-50%);
    }
  }

  .news-item {
    display: inline-flex;
    align-items: baseline;
    gap: 0.45rem;
    font-size: 0.74rem;
    color: var(--muted);
    text-decoration: none;
  }

  .news-item:hover {
    color: var(--ink);
  }

  .news-domain {
    color: var(--accent);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

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

  .alert-form {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: 0.4rem;
    align-items: center;
  }

  .alert-list {
    display: grid;
    gap: 0.3rem;
  }

  .alert-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 0;
    background: rgba(255, 255, 255, 0.02);
    font-size: 0.78rem;
  }

  .alert-row.done {
    opacity: 0.55;
  }

  .alert-row em {
    color: var(--muted);
    font-size: 0.68rem;
  }

  .alert-tier {
    border-radius: 0;
    padding: 0.1rem 0.45rem;
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.04em;
  }

  .alert-tier.flash {
    color: var(--red);
    background: rgba(240, 107, 99, 0.14);
  }

  .alert-tier.priority {
    color: var(--amber);
    background: rgba(228, 173, 79, 0.14);
  }

  .alert-tier.routine {
    color: var(--muted);
    background: var(--surface-2);
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

    .modal-backdrop {
      padding: 0.75rem;
    }

    .modal {
      max-height: calc(100dvh - 1.5rem);
    }

    .venue-strip {
      grid-template-columns: 1fr 1fr;
    }

    .venue-row {
      grid-template-columns: auto minmax(0, 1fr) auto auto;
    }

    .venue-row small {
      display: none;
    }

    .chart-panel {
      height: clamp(22rem, 56vh, 30rem);
    }

    .orderbook-panel {
      max-height: 26rem;
    }

    .macro-row {
      grid-template-columns: minmax(3rem, 1fr) auto auto;
    }

    .macro-spark {
      display: none;
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
