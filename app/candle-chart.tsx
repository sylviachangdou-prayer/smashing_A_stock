"use client";

import { useEffect, useRef, useState } from "react";

export type CandleBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  amount?: number | null;
  turnover?: number | null;
  source_id?: string;
};

type Hover = CandleBar & { changePercent: number | null };

// A 股惯例：红涨绿跌。与页面其他图表（净流入为正取绿）语义不同，各自沿用本领域习惯。
const UP = "#c0392b";
const DOWN = "#176b4d";

function formatVolume(lots?: number | null) {
  if (lots == null) return "—";
  if (lots >= 10_000) return `${(lots / 10_000).toFixed(2)} 万手`;
  return `${Math.round(lots)} 手`;
}

export function CandleChart({ bars, height = 340 }: { bars: CandleBar[]; height?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = holder.current;
    if (!node || bars.length === 0) return;
    let disposed = false;
    let dispose = () => {};

    (async () => {
      let lib: typeof import("lightweight-charts");
      try {
        lib = await import("lightweight-charts");
      } catch {
        if (!disposed) setFailed(true);
        return;
      }
      if (disposed) return;
      const { createChart, CandlestickSeries, HistogramSeries, CrosshairMode } = lib;

      const chart = createChart(node, {
        height,
        layout: {
          background: { color: "transparent" },
          textColor: "#6b776f",
          fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
          fontSize: 12,
        },
        grid: {
          vertLines: { color: "rgba(220, 227, 222, .55)" },
          horzLines: { color: "rgba(220, 227, 222, .55)" },
        },
        rightPriceScale: { borderColor: "#dce3de", scaleMargins: { top: 0.06, bottom: 0.28 } },
        timeScale: { borderColor: "#dce3de", rightOffset: 2, minBarSpacing: 1.5 },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: "#9da8a1", width: 1, style: 2, labelBackgroundColor: "#17231d" },
          horzLine: { color: "#9da8a1", width: 1, style: 2, labelBackgroundColor: "#17231d" },
        },
        localization: { locale: "zh-CN" },
      });

      const candles = chart.addSeries(CandlestickSeries, {
        upColor: UP,
        downColor: DOWN,
        borderUpColor: UP,
        borderDownColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
      });
      candles.setData(
        bars.map((bar) => ({
          time: bar.date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        })),
      );

      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      volume.setData(
        bars.map((bar) => ({
          time: bar.date,
          value: Number(bar.volume ?? 0),
          color: bar.close >= bar.open ? "rgba(192, 57, 43, .32)" : "rgba(23, 107, 77, .32)",
        })),
      );

      chart.timeScale().fitContent();

      const byDate = new Map(bars.map((bar, index) => [bar.date, index]));
      chart.subscribeCrosshairMove((param) => {
        const key = typeof param.time === "string" ? param.time : undefined;
        const index = key === undefined ? undefined : byDate.get(key);
        if (index === undefined || !param.point) {
          setHover(null);
          return;
        }
        const bar = bars[index];
        const previous = index > 0 ? bars[index - 1].close : null;
        setHover({
          ...bar,
          changePercent: previous ? ((bar.close - previous) / previous) * 100 : null,
        });
      });

      const observer = new ResizeObserver(() => chart.applyOptions({ width: node.clientWidth }));
      observer.observe(node);
      chart.applyOptions({ width: node.clientWidth });

      dispose = () => {
        observer.disconnect();
        chart.remove();
      };
    })();

    return () => {
      disposed = true;
      dispose();
    };
  }, [bars, height]);

  if (failed) {
    return <p className="chart-fallback">图表组件加载失败，下方表格与数据不受影响。</p>;
  }

  const last = bars.length > 0 ? bars[bars.length - 1] : null;
  const shown = hover ?? (last ? { ...last, changePercent: null } : null);
  const rising = shown ? shown.close >= shown.open : true;

  return (
    <div className="candle-wrap">
      {shown && (
        <div className="candle-readout" aria-live="polite">
          <b>{shown.date}</b>
          <span className={rising ? "candle-up" : "candle-down"}>
            开 {shown.open.toFixed(2)}　高 {shown.high.toFixed(2)}　低 {shown.low.toFixed(2)}　收 {shown.close.toFixed(2)}
          </span>
          {shown.changePercent != null && (
            <span className={shown.changePercent >= 0 ? "candle-up" : "candle-down"}>
              {shown.changePercent >= 0 ? "+" : ""}
              {shown.changePercent.toFixed(2)}%
            </span>
          )}
          <span className="candle-muted">量 {formatVolume(shown.volume)}</span>
          {shown.turnover != null && <span className="candle-muted">换手 {shown.turnover.toFixed(2)}%</span>}
        </div>
      )}
      <div ref={holder} className="candle-canvas" />
      <p className="candle-hint">滚轮缩放，拖动平移，双击还原。</p>
    </div>
  );
}
