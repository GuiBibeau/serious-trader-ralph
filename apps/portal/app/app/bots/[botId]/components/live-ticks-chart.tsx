import { motion } from "framer-motion";
import { useId, useMemo, useState } from "react";
import {
  formatAgeMs,
  formatPercent,
  formatPrice,
  useSolMarketFeed,
} from "../../../components/sol-market-feed";

interface LiveTicksChartProps {
  className?: string;
}

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

export function LiveTicksChart({ className }: LiveTicksChartProps) {
  const market = useSolMarketFeed();
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const gradientId = useId();

  const chart = useMemo(() => {
    const ticks = market.points;
    if (ticks.length < 2) {
      return { pathData: "", min: 0, max: 0, range: 1, last: 0 };
    }

    const prices = ticks.map((t) => t.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const last = ticks.length - 1;

    // Normalize to 1000x200 SVG space
    const points = ticks.map((t, i) => {
      const x = (i / last) * 1000;
      const normalizedY = (t.price - min) / range;
      const y = 200 - normalizedY * 160 - 20; // 20px padding
      return `${x},${y}`;
    });

    return {
      pathData: `M ${points.join(" L ")}`,
      min,
      max,
      range,
      last,
    };
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
  const currentPrice = activePoint?.price ?? market.latestPrice;
  const isUp =
    hoverRatio === null
      ? (market.change24hPct ?? 0) >= 0
      : activePoint !== null &&
        prevPoint !== null &&
        activePoint.price >= prevPoint.price;
  const crosshairX =
    hasData && activeIdx >= 0 && chart.last > 0
      ? (activeIdx / chart.last) * 1000
      : 0;
  const crosshairY =
    hasData && activePoint
      ? 200 - ((activePoint.price - chart.min) / chart.range) * 160 - 20
      : 0;
  const tooltipLeftPct =
    hoverRatio === null ? 84 : Math.max(12, Math.min(88, hoverRatio * 100));

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-[var(--color-chart-bg)] flex flex-col ${className}`}
      role="img"
      aria-label="Live SOL/USDC chart"
      onMouseMove={(event) => {
        if (!hasData) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = (event.clientX - rect.left) / rect.width;
        setHoverRatio(Math.max(0, Math.min(1, ratio)));
      }}
      onMouseLeave={() => setHoverRatio(null)}
    >
      {/* Header overlay */}
      <div className="absolute top-4 left-4 z-10">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-mono font-bold text-white">
            ${formatPrice(currentPrice ?? null)}
          </span>
          <span
            className={`text-xs font-mono px-1.5 py-0.5 rounded ${isUp ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}
          >
            {formatPercent(market.change24hPct)}
          </span>
        </div>
        <p className="text-xs text-muted font-mono mt-1">
          SOL/USDC • Updated {formatAgeMs(market.lastUpdatedMs)}
        </p>
      </div>

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
        <title>Live SOL/USDC chart</title>
        {hasData ? (
          <motion.path
            d={chart.pathData}
            fill="none"
            stroke={isUp ? "#10b981" : "#ef4444"}
            strokeWidth="2"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1, ease: "easeInOut" }}
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
        {/* Gradient Fill (optional) */}
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={isUp ? "#10b981" : "#ef4444"}
              stopOpacity="0.2"
            />
            <stop
              offset="100%"
              stopColor={isUp ? "#10b981" : "#ef4444"}
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        {hasData ? (
          <path
            d={`${chart.pathData} L 1000,200 L 0,200 Z`}
            fill={`url(#${gradientId})`}
            stroke="none"
          />
        ) : null}
      </svg>

      {hasData && activePoint ? (
        <div
          className={`absolute top-12 z-20 rounded border border-white/15 bg-black/75 px-2.5 py-2 font-mono text-[10px] text-slate-200 backdrop-blur min-w-[180px] ${isHovering ? "" : "right-4"}`}
          style={
            isHovering
              ? { left: `${tooltipLeftPct}%`, transform: "translateX(-50%)" }
              : undefined
          }
        >
          <div className="mb-1 text-[10px] text-slate-300">
            {formatHoverTime(activePoint.ts)}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span>O {formatPrice(activePoint.open)}</span>
            <span>H {formatPrice(activePoint.high)}</span>
            <span>L {formatPrice(activePoint.low)}</span>
            <span>C {formatPrice(activePoint.close)}</span>
            <span className="col-span-2 text-slate-300">
              V {formatVolume(activePoint.volume)}
            </span>
          </div>
        </div>
      ) : null}

      {!hasData ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500" />
        </div>
      ) : null}
    </div>
  );
}
