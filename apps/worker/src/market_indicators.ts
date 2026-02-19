import type { HistoricalOhlcvBar } from "./historical_ohlcv";

export type MarketIndicators = {
  barCount: number;
  latestTs: string | null;
  latestClose: number | null;
  sma20: number | null;
  ema20: number | null;
  rsi14: number | null;
  macd: {
    line: number | null;
    signal: number | null;
    histogram: number | null;
  };
  returnsPct: {
    h1: number | null;
    h24: number | null;
    h168: number | null;
  };
};

function round(value: number, places = 8): number {
  const p = 10 ** places;
  return Math.round(value * p) / p;
}

function toCloseSeries(bars: HistoricalOhlcvBar[]): number[] {
  return bars
    .map((bar) => Number(bar.close))
    .filter((value) => Number.isFinite(value));
}

function latestValue(values: number[]): number | null {
  if (!values.length) return null;
  return values[values.length - 1] ?? null;
}

function computeSma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((acc, value) => acc + value, 0);
  return round(sum / period);
}

function computeEmaSeries(values: number[], period: number): number[] {
  if (!values.length || period <= 0) return [];
  const alpha = 2 / (period + 1);
  const series: number[] = [];
  let prev = values[0] ?? 0;
  series.push(prev);
  for (let i = 1; i < values.length; i += 1) {
    const next = (values[i] ?? prev) * alpha + prev * (1 - alpha);
    series.push(next);
    prev = next;
  }
  return series;
}

function computeRsi(values: number[], period: number): number | null {
  if (values.length <= period || period <= 0) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = (values[i] ?? 0) - (values[i - 1] ?? 0);
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i += 1) {
    const delta = (values[i] ?? 0) - (values[i - 1] ?? 0);
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return round(100 - 100 / (1 + rs), 4);
}

function pctChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0 || !Number.isFinite(previous)) {
    return null;
  }
  return round(((current - previous) / previous) * 100, 4);
}

function priorClose(values: number[], hoursAgo: number): number | null {
  const idx = values.length - 1 - hoursAgo;
  if (idx < 0) return null;
  const value = values[idx];
  return Number.isFinite(value) ? value : null;
}

export function computeMarketIndicators(
  bars: HistoricalOhlcvBar[],
): MarketIndicators {
  const closes = toCloseSeries(bars);
  const latestClose = latestValue(closes);

  const ema20Series = computeEmaSeries(closes, 20);
  const ema12Series = computeEmaSeries(closes, 12);
  const ema26Series = computeEmaSeries(closes, 26);
  const macdLineSeries = ema12Series.map((value, idx) => {
    const rhs = ema26Series[idx] ?? value;
    return value - rhs;
  });
  const macdSignalSeries = computeEmaSeries(macdLineSeries, 9);

  const macdLine = latestValue(macdLineSeries);
  const macdSignal = latestValue(macdSignalSeries);
  const macdHistogram =
    macdLine !== null && macdSignal !== null
      ? round(macdLine - macdSignal, 8)
      : null;

  const latestTs = bars.length > 0 ? (bars[bars.length - 1]?.ts ?? null) : null;
  const current = latestClose ?? 0;

  return {
    barCount: bars.length,
    latestTs,
    latestClose: latestClose === null ? null : round(latestClose, 8),
    sma20: computeSma(closes, 20),
    ema20:
      ema20Series.length > 0
        ? round(ema20Series[ema20Series.length - 1] ?? 0, 8)
        : null,
    rsi14: computeRsi(closes, 14),
    macd: {
      line: macdLine === null ? null : round(macdLine, 8),
      signal: macdSignal === null ? null : round(macdSignal, 8),
      histogram: macdHistogram,
    },
    returnsPct: {
      h1:
        latestClose === null ? null : pctChange(current, priorClose(closes, 1)),
      h24:
        latestClose === null
          ? null
          : pctChange(current, priorClose(closes, 24)),
      h168:
        latestClose === null
          ? null
          : pctChange(current, priorClose(closes, 168)),
    },
  };
}
