"use client";

import { motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../cn";
import {
  formatAgeMs,
  formatPercent,
  formatPrice,
  type MarketPoint,
  type MarketState,
} from "./sol-market-feed";

function formatHoverTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatVolume(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export const CHART_TIMEFRAME_WINDOWS_MS = {
  "1H": 60 * 60 * 1000,
  "6H": 6 * 60 * 60 * 1000,
  "24H": 24 * 60 * 60 * 1000,
  "7D": 7 * 24 * 60 * 60 * 1000,
} as const;

export type ChartTimeframe = keyof typeof CHART_TIMEFRAME_WINDOWS_MS;
type ChartStyle = "line" | "candles";

type OverlayState = {
  mark: boolean;
  index: boolean;
  reference: boolean;
};

export function selectMarketPointsForTimeframe(
  points: MarketPoint[],
  timeframe: ChartTimeframe,
): MarketPoint[] {
  if (points.length < 2) return points;
  const windowMs = CHART_TIMEFRAME_WINDOWS_MS[timeframe];
  const endTs = points[points.length - 1]?.ts ?? Date.now();
  const floorTs = endTs - windowMs;
  const filtered = points.filter((point) => point.ts >= floorTs);
  if (filtered.length >= 2) return filtered;
  return points.slice(-Math.min(points.length, 96));
}

export function computeIndexOverlayPrice(points: MarketPoint[]): number | null {
  if (points.length < 1) return null;
  const tail = points.slice(-Math.min(points.length, 24));
  let sum = 0;
  for (const point of tail) {
    sum += point.price;
  }
  const average = sum / tail.length;
  return Number.isFinite(average) ? average : null;
}

export function MarketChart({
  className,
  market,
  pairLabel,
}: {
  className?: string;
  market: MarketState;
  pairLabel: string;
}) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("24H");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("line");
  const [overlayState, setOverlayState] = useState<OverlayState>({
    mark: true,
    index: true,
    reference: true,
  });
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [keyboardIndex, setKeyboardIndex] = useState<number | null>(null);
  const gradientId = useId();
  const frameRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  const setHoverRatioBatched = useCallback((next: number | null): void => {
    pendingHoverRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setHoverRatio((previous) => {
        if (previous === pendingHoverRef.current) return previous;
        return pendingHoverRef.current;
      });
    });
  }, []);

  const applyTimeframe = useCallback(
    (next: ChartTimeframe): void => {
      setTimeframe(next);
      setHoverRatioBatched(null);
      setKeyboardIndex(null);
    },
    [setHoverRatioBatched],
  );

  const applyChartStyle = useCallback(
    (next: ChartStyle): void => {
      setChartStyle(next);
      setHoverRatioBatched(null);
      setKeyboardIndex(null);
    },
    [setHoverRatioBatched],
  );

  const visiblePoints = useMemo(
    () => selectMarketPointsForTimeframe(market.points, timeframe),
    [market.points, timeframe],
  );

  const chart = useMemo(() => {
    const points = visiblePoints;
    if (points.length < 2) {
      return {
        pathData: "",
        min: 0,
        max: 0,
        range: 1,
        last: 0,
        candles: [] as Array<{
          ts: number;
          x: number;
          openY: number;
          closeY: number;
          highY: number;
          lowY: number;
          rising: boolean;
          width: number;
        }>,
        yForPrice: (_price: number): number => 0,
      };
    }

    const prices = points.map((point) => point.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const last = points.length - 1;
    const yForPrice = (price: number): number =>
      200 - ((price - min) / range) * 160 - 20;
    const pathData = points
      .map((point, idx) => {
        const x = (idx / last) * 1000;
        const y = yForPrice(point.price);
        return `${idx === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
    const candleWidth = Math.max(2, Math.min(14, 900 / points.length));
    const candles = points.map((point, idx) => {
      const x = (idx / last) * 1000;
      const openY = yForPrice(point.open);
      const closeY = yForPrice(point.close);
      const highY = yForPrice(point.high);
      const lowY = yForPrice(point.low);
      return {
        ts: point.ts,
        x,
        openY,
        closeY,
        highY,
        lowY,
        rising: point.close >= point.open,
        width: candleWidth,
      };
    });
    return { pathData, min, max, range, last, candles, yForPrice };
  }, [visiblePoints]);

  const hasData = visiblePoints.length >= 2;
  const isHovering = hoverRatio !== null;
  const activeIdx = hasData
    ? keyboardIndex !== null
      ? Math.max(0, Math.min(chart.last, keyboardIndex))
      : hoverRatio === null
        ? chart.last
        : Math.max(0, Math.min(chart.last, Math.round(hoverRatio * chart.last)))
    : -1;
  const activePoint = activeIdx >= 0 ? visiblePoints[activeIdx] : null;
  const prevPoint = activeIdx > 0 ? visiblePoints[activeIdx - 1] : null;
  const isUp =
    hoverRatio === null
      ? (market.change24hPct ?? 0) >= 0
      : activePoint !== null &&
        prevPoint !== null &&
        activePoint.price >= prevPoint.price;
  const priceText = formatPrice(activePoint?.price ?? market.latestPrice);
  const changeText = formatPercent(market.change24hPct);
  const lastUpdated = formatAgeMs(market.lastUpdatedMs);
  const crosshairX =
    hasData && activeIdx >= 0 && chart.last > 0
      ? (activeIdx / chart.last) * 1000
      : 0;
  const crosshairY =
    hasData && activePoint
      ? 200 - ((activePoint.price - chart.min) / chart.range) * 160 - 20
      : 0;
  const cursorRatio =
    keyboardIndex !== null && chart.last > 0
      ? keyboardIndex / chart.last
      : hoverRatio;
  const hoverTooltipLeftPct =
    cursorRatio === null ? 86 : Math.max(12, Math.min(88, cursorRatio * 100));
  const isCursorActive = isHovering || keyboardIndex !== null;
  const hoverOpen = activePoint ? activePoint.open : null;
  const hoverHigh = activePoint ? activePoint.high : null;
  const hoverLow = activePoint ? activePoint.low : null;
  const hoverClose = activePoint ? activePoint.close : null;
  const indexOverlayPrice = useMemo(
    () => computeIndexOverlayPrice(visiblePoints),
    [visiblePoints],
  );
  const referenceOverlayPrice = visiblePoints[0]?.price ?? null;
  const markOverlayPrice = market.latestPrice ?? null;

  useEffect(() => {
    setKeyboardIndex((current) => {
      if (current === null) return current;
      if (current <= chart.last) return current;
      return chart.last;
    });
  }, [chart.last]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!hasData || isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "arrowleft" || key === "arrowright") {
        event.preventDefault();
        setHoverRatioBatched(null);
        setKeyboardIndex((current) => {
          const base = current ?? chart.last;
          const delta = key === "arrowleft" ? -1 : 1;
          return Math.max(0, Math.min(chart.last, base + delta));
        });
        return;
      }
      if (key === "1") applyTimeframe("1H");
      if (key === "2") applyTimeframe("6H");
      if (key === "3") applyTimeframe("24H");
      if (key === "4") applyTimeframe("7D");
      if (key === "l") applyChartStyle("line");
      if (key === "c") applyChartStyle("candles");
      if (key === "m") {
        setOverlayState((current) => ({ ...current, mark: !current.mark }));
      }
      if (key === "i") {
        setOverlayState((current) => ({ ...current, index: !current.index }));
      }
      if (key === "r") {
        setOverlayState((current) => ({
          ...current,
          reference: !current.reference,
        }));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    applyChartStyle,
    applyTimeframe,
    chart.last,
    hasData,
    setHoverRatioBatched,
  ]);

  return (
    <div
      className={cn(
        "relative w-full h-full overflow-hidden bg-[var(--color-chart-bg)]",
        className,
      )}
      role="application"
      aria-label="Interactive market price chart"
      onMouseMove={(event) => {
        if (!hasData) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = (event.clientX - rect.left) / rect.width;
        setKeyboardIndex(null);
        setHoverRatioBatched(Math.max(0, Math.min(1, ratio)));
      }}
      onMouseLeave={() => setHoverRatioBatched(null)}
    >
      {/* Grid Background */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-chart-grid) 1px, transparent 1px), linear-gradient(90deg, var(--color-chart-grid) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Chart Line */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 1000 200"
        preserveAspectRatio="none"
      >
        <title>Market price chart</title>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopColor={isUp ? "#10b981" : "#ef4444"}
              stopOpacity="0.4"
            />
            <stop
              offset="100%"
              stopColor={isUp ? "#10b981" : "#ef4444"}
              stopOpacity="0"
            />
          </linearGradient>
        </defs>

        {/* Area under the curve */}
        {hasData && chartStyle === "line" ? (
          <motion.path
            d={`${chart.pathData} L1000,200 L0,200 Z`}
            fill={`url(#${gradientId})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1 }}
          />
        ) : null}

        {/* The Line Itself */}
        {hasData && chartStyle === "line" ? (
          <motion.path
            d={chart.pathData}
            fill="none"
            stroke={isUp ? "#10b981" : "#ef4444"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
          />
        ) : null}

        {hasData && chartStyle === "candles"
          ? chart.candles.map((candle) => (
              <g key={`candle-${candle.ts}`}>
                <line
                  x1={candle.x}
                  x2={candle.x}
                  y1={candle.highY}
                  y2={candle.lowY}
                  stroke={candle.rising ? "#10b981" : "#ef4444"}
                  strokeWidth="1"
                />
                <rect
                  x={candle.x - candle.width / 2}
                  y={Math.min(candle.openY, candle.closeY)}
                  width={candle.width}
                  height={Math.max(1, Math.abs(candle.closeY - candle.openY))}
                  rx="1"
                  fill={candle.rising ? "#10b981" : "#ef4444"}
                  fillOpacity="0.75"
                />
              </g>
            ))
          : null}

        {hasData && overlayState.mark && markOverlayPrice !== null ? (
          <line
            x1={0}
            x2={1000}
            y1={chart.yForPrice(markOverlayPrice)}
            y2={chart.yForPrice(markOverlayPrice)}
            stroke="rgba(245, 158, 11, 0.85)"
            strokeWidth="1"
            strokeDasharray="5 4"
          />
        ) : null}

        {hasData && overlayState.index && indexOverlayPrice !== null ? (
          <line
            x1={0}
            x2={1000}
            y1={chart.yForPrice(indexOverlayPrice)}
            y2={chart.yForPrice(indexOverlayPrice)}
            stroke="rgba(56, 189, 248, 0.85)"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
        ) : null}

        {hasData && overlayState.reference && referenceOverlayPrice !== null ? (
          <line
            x1={0}
            x2={1000}
            y1={chart.yForPrice(referenceOverlayPrice)}
            y2={chart.yForPrice(referenceOverlayPrice)}
            stroke="rgba(167, 139, 250, 0.8)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        ) : null}

        {hasData && activePoint && isCursorActive ? (
          <>
            <line
              x1={crosshairX}
              x2={crosshairX}
              y1={0}
              y2={200}
              stroke="rgba(148,163,184,0.45)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <circle
              cx={crosshairX}
              cy={crosshairY}
              r={3.5}
              fill={isUp ? "#10b981" : "#ef4444"}
              stroke="rgba(10, 10, 10, 0.9)"
              strokeWidth="1.5"
            />
          </>
        ) : null}
      </svg>

      {/* Live "Pulse" Indicator */}
      <div className="absolute left-4 top-4 rounded bg-black/45 px-2.5 py-1.5 backdrop-blur-sm border border-white/10 min-w-[150px]">
        <div className="flex items-center gap-2">
          <span className="text-base font-mono font-semibold text-white">
            {priceText}
          </span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-mono",
              isUp
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-red-500/20 text-red-300",
            )}
          >
            {changeText}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] font-mono text-slate-300/90">
          {pairLabel} • {lastUpdated}
        </p>
      </div>

      <div className="absolute right-4 top-4 flex items-center gap-2 rounded bg-black/40 px-2 py-1 backdrop-blur-sm border border-white/5">
        <span className="relative flex h-2 w-2">
          <span
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              isUp ? "bg-emerald-500" : "bg-red-500",
            )}
          />
          <span
            className={cn(
              "relative inline-flex rounded-full h-2 w-2",
              isUp ? "bg-emerald-500" : "bg-red-500",
            )}
          />
        </span>
        <span
          className={cn(
            "text-xs font-mono font-bold",
            isUp ? "text-emerald-400" : "text-red-400",
          )}
        >
          {market.status === "error" ? "DEGRADED" : "LIVE"}
        </span>
      </div>

      <div className="absolute left-4 bottom-4 z-20 rounded border border-white/10 bg-black/55 px-2.5 py-2 backdrop-blur-sm">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          {(Object.keys(CHART_TIMEFRAME_WINDOWS_MS) as ChartTimeframe[]).map(
            (option) => (
              <button
                key={option}
                type="button"
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase transition-colors",
                  option === timeframe
                    ? "border-emerald-400/80 bg-emerald-500/15 text-emerald-200"
                    : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10",
                )}
                onClick={() => applyTimeframe(option)}
              >
                {option}
              </button>
            ),
          )}
          <button
            type="button"
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase transition-colors",
              chartStyle === "line"
                ? "border-sky-400/80 bg-sky-500/15 text-sky-200"
                : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10",
            )}
            onClick={() => applyChartStyle("line")}
          >
            Line
          </button>
          <button
            type="button"
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase transition-colors",
              chartStyle === "candles"
                ? "border-fuchsia-400/80 bg-fuchsia-500/15 text-fuchsia-200"
                : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10",
            )}
            onClick={() => applyChartStyle("candles")}
          >
            Candles
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase transition-colors",
              overlayState.mark
                ? "border-amber-300/80 bg-amber-500/15 text-amber-200"
                : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10",
            )}
            onClick={() =>
              setOverlayState((current) => ({
                ...current,
                mark: !current.mark,
              }))
            }
          >
            Mark
          </button>
          <button
            type="button"
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase transition-colors",
              overlayState.index
                ? "border-sky-300/80 bg-sky-500/15 text-sky-200"
                : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10",
            )}
            onClick={() =>
              setOverlayState((current) => ({
                ...current,
                index: !current.index,
              }))
            }
          >
            Index
          </button>
          <button
            type="button"
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase transition-colors",
              overlayState.reference
                ? "border-violet-300/80 bg-violet-500/15 text-violet-200"
                : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10",
            )}
            onClick={() =>
              setOverlayState((current) => ({
                ...current,
                reference: !current.reference,
              }))
            }
          >
            Ref
          </button>
          <span className="text-[10px] font-mono text-slate-300/90">
            Arrows: cursor
          </span>
        </div>
      </div>

      {hasData && activePoint ? (
        <div
          className={cn(
            "absolute top-12 z-20 rounded border border-white/15 bg-black/75 px-2.5 py-2 font-mono text-[10px] text-slate-200 backdrop-blur min-w-[180px]",
            isCursorActive ? "" : "right-4",
          )}
          style={
            isCursorActive
              ? {
                  left: `${hoverTooltipLeftPct}%`,
                  transform: "translateX(-50%)",
                }
              : undefined
          }
        >
          <div className="mb-1 text-[10px] text-slate-300">
            {formatHoverTime(activePoint.ts)}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span>O {formatPrice(hoverOpen ?? null)}</span>
            <span>H {formatPrice(hoverHigh ?? null)}</span>
            <span>L {formatPrice(hoverLow ?? null)}</span>
            <span>C {formatPrice(hoverClose ?? null)}</span>
            <span className="col-span-2 text-slate-300">
              V {formatVolume(activePoint.volume)}
            </span>
          </div>
        </div>
      ) : null}

      {market.status === "loading" && !hasData ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500" />
        </div>
      ) : null}
    </div>
  );
}
