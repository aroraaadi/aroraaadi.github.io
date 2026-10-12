/* A candle chart (lightweight-charts) for one swing setup or position: the bars from data/swing_bars.json with the
   levels the nightly scan published drawn over them, so a setup can be read against the prices it came from.
   Nothing is computed here that the scan did not: the EMA lines are the 9- and 21-day averages of the same closes,
   and the price lines are the scan's own signal close, stop, target, VWAP, Fibonacci levels and swing range. */
import { tok, alpha } from "./common.js";
import { ema, levelLines } from "./pricelevels.js";

let current = null;

export function clearPriceChart() {
  if (current) { current.chart.remove(); current = null; }
}

/** Draw `bars` ({t,o,h,l,c,v} arrays) in `host` with `row`'s levels. Replaces any chart already drawn. */
export function drawPriceChart(host, bars, row) {
  clearPriceChart();
  const LW = window.LightweightCharts;
  host.replaceChildren();
  if (!LW || !bars || !bars.t || !bars.t.length) return false;
  const chart = LW.createChart(host, {
    height: host.clientHeight || 380,
    autoSize: true,
    layout: { background: { type: "solid", color: tok("--surface") }, textColor: tok("--muted"), fontFamily: getComputedStyle(document.body).getPropertyValue("--font-num") || "ui-monospace, monospace", fontSize: 11 },
    grid: { vertLines: { color: tok("--grid") }, horzLines: { color: tok("--grid") } },
    rightPriceScale: { borderColor: tok("--border-2") },
    timeScale: { borderColor: tok("--border-2"), timeVisible: false },
    crosshair: { mode: LW.CrosshairMode.Normal },
  });
  const up = tok("--up"), down = tok("--down");
  const candles = chart.addSeries(LW.CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
  candles.setData(bars.t.map((t, i) => ({ time: t, open: bars.o[i], high: bars.h[i], low: bars.l[i], close: bars.c[i] })));
  const vol = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
  vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(bars.t.map((t, i) => ({ time: t, value: bars.v[i], color: alpha(bars.c[i] >= bars.o[i] ? "--up" : "--down", 0.35) })));
  for (const [n, color] of [[9, tok("--accent")], [21, tok("--warn")]]) {
    const line = chart.addSeries(LW.LineSeries, { color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const e = ema(bars.c, n);
    line.setData(bars.t.map((t, i) => ({ time: t, value: e[i] })));
  }
  const tone = { ink: tok("--ink"), up, down, warn: tok("--warn"), muted: tok("--muted") };
  for (const l of levelLines(row)) {
    candles.createPriceLine({ price: l.price, color: tone[l.tone], lineWidth: 1, lineStyle: l.dashed ? LW.LineStyle.Dashed : LW.LineStyle.Solid, axisLabelVisible: true, title: l.title });
  }
  chart.timeScale().fitContent();
  current = { chart };
  return true;
}
