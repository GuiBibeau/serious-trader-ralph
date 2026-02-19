"use client";

import { motion } from "framer-motion";
import { useId, useMemo, useState } from "react";
import { cn } from "../../cn";
import {
  formatAgeMs,
  formatPercent,
  formatPrice,
  useSolMarketFeed,
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

export function MarketChart({ className }: { className?: string }) {
  const market = useSolMarketFeed();
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const gradientId = useId();

  const chart = useMemo(() => {
    const points = market.points;
    if (points.length < 2) {
      return { pathData: "", min: 0, max: 0, range: 1, last: 0 };
    }

    const prices = points.map((point) => point.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const last = points.length - 1;
    const pathData = points
      .map((point, idx) => {
        const x = (idx / last) * 1000;
        const normalizedY = (point.price - min) / range;
        const y = 200 - normalizedY * 160 - 20;
        return `${idx === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
    return { pathData, min, max, range, last };
  }, [market.points]);

  const hasData = market.points.length >= 2;
  const isHovering = hoverRatio !== null;
  const activeIdx = hasData
    ? hoverRatio === null
      ? chart.last
      : Math.max(0, Math.min(chart.last, Math.round(hoverRatio * chart.last)))
    : -1;
  const activePoint = activeIdx >= 0 ? market.points[activeIdx] : null;
  const prevPoint = activeIdx > 0 ? market.points[activeIdx - 1] : null;
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
  const hoverTooltipLeftPct =
    hoverRatio === null ? 86 : Math.max(12, Math.min(88, hoverRatio * 100));
  const hoverOpen = activePoint ? activePoint.open : null;
  const hoverHigh = activePoint ? activePoint.high : null;
  const hoverLow = activePoint ? activePoint.low : null;
  const hoverClose = activePoint ? activePoint.close : null;

  return (
    <div
      className={cn(
        "relative w-full h-full overflow-hidden bg-[var(--color-chart-bg)]",
        className,
      )}
      role="img"
      aria-label="Market price chart"
      onMouseMove={(event) => {
        if (!hasData) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = (event.clientX - rect.left) / rect.width;
        setHoverRatio(Math.max(0, Math.min(1, ratio)));
      }}
      onMouseLeave={() => setHoverRatio(null)}
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
        {hasData ? (
          <motion.path
            d={`${chart.pathData} L1000,200 L0,200 Z`}
            fill={`url(#${gradientId})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1 }}
          />
        ) : null}

        {/* The Line Itself */}
        {hasData ? (
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

        {hasData && isHovering && activePoint ? (
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
          SOL/USDC • {lastUpdated}
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

      {hasData && activePoint ? (
        <div
          className={cn(
            "absolute top-12 z-20 rounded border border-white/15 bg-black/75 px-2.5 py-2 font-mono text-[10px] text-slate-200 backdrop-blur min-w-[180px]",
            isHovering ? "" : "right-4",
          )}
          style={
            isHovering
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
