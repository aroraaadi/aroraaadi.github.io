/* Chart.js factories. Replaces, verbatim-duplicated across the old modules:
   6 bar-tip-label plugins, 4 draw() destroy-then-recreate wrappers, 7 nearly
   identical horizontal-bar configs, and 4 copies of the date-tick callback. */

import { tok, alpha, clearTokCache, fmtMonth } from "./common.js";

const registry = new Map();

/* Canvas pixels don't follow CSS tokens, so a theme flip needs a redraw. This
   destroys and rebuilds rather than mutating — Chart.js bakes colours in. */
export function draw(id, cfg) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  registry.get(id)?.destroy();
  const c = new Chart(canvas.getContext("2d"), cfg);
  registry.set(id, c);
  return c;
}

export function destroyAll() {
  for (const c of registry.values()) c.destroy();
  registry.clear();
}

export function applyChartDefaults() {
  clearTokCache();
  Chart.defaults.font.family = getComputedStyle(document.body).getPropertyValue("--font-num")
    || "ui-monospace, monospace";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = tok("--muted");
  Chart.defaults.borderColor = tok("--grid");
  Chart.defaults.plugins.legend.display = false;   // legends are our own HTML
  Chart.defaults.plugins.tooltip.backgroundColor = tok("--raised");
  Chart.defaults.plugins.tooltip.titleColor = tok("--ink");
  Chart.defaults.plugins.tooltip.bodyColor = tok("--ink-2");
  Chart.defaults.plugins.tooltip.borderColor = tok("--border-2");
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 8;
  Chart.defaults.plugins.tooltip.cornerRadius = 4;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
  Chart.defaults.animation = false;
}

/* ---------- plugins ---------- */

export const crosshair = {
  id: "crosshair",
  afterDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.();
    if (!active?.length) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = tok("--baseline");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(active[0].element.x, chartArea.top);
    ctx.lineTo(active[0].element.x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

/* One parameterised label plugin replaces pflabels / seclab / tipLabels /
   mvolabels / seclabels / barLabels. */
export function barLabels(labels, { color = "--ink-2", pad = 8 } = {}) {
  return {
    id: "barlabels-" + Math.random().toString(36).slice(2),
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.fillStyle = tok(color);
      ctx.font = `11px ${tok("--font-num") || "monospace"}`;
      ctx.textBaseline = "middle";
      meta.data.forEach((bar, i) => {
        const t = labels[i];
        if (t != null) ctx.fillText(t, bar.x + pad, bar.y);
      });
      ctx.restore();
    },
  };
}

/* Shades the pre-live region and marks where the real track record starts.
   This is the site's most substantive data-integrity affordance — the stats
   before this line are hypothetical, weights fitted on the window they are
   measured over. Preserved deliberately. */
export function liveMarker(dates, liveStart) {
  return {
    id: "livemarker",
    beforeDatasetsDraw(chart) {
      if (!liveStart) return;
      const i = dates.indexOf(liveStart);
      if (i < 0) return;
      const { ctx, chartArea, scales } = chart;
      const x = scales.x.getPixelForValue(i);
      ctx.save();
      ctx.fillStyle = alpha("--grid", 0.55);
      ctx.fillRect(chartArea.left, chartArea.top, x - chartArea.left, chartArea.bottom - chartArea.top);
      ctx.strokeStyle = tok("--baseline");
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = tok("--muted");
      ctx.font = `10px ${tok("--font-num") || "monospace"}`;
      ctx.fillText("hypothetical", chartArea.left + 6, chartArea.top + 12);
      ctx.fillText("live", x + 6, chartArea.top + 12);
      ctx.restore();
    },
  };
}

/* ---------- config factories ---------- */

const dateTicks = (labels) => ({
  callback(v) { return fmtMonth(labels[v] ?? ""); },
  maxRotation: 0,
  autoSkip: true,
  maxTicksLimit: 8,
});

export function lineConfig({ labels, series, yFmt = (v) => v, plugins = [] }) {
  return {
    type: "line",
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.fill ? alpha(s.color, 0.16) : undefined,
        fill: !!s.fill,
        borderWidth: s.width ?? 2,
        borderDash: s.dash || undefined,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: s.color,
        pointHoverBorderColor: tok("--surface"),
        pointHoverBorderWidth: 2,
        tension: 0,
        order: s.order ?? 1,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false }, border: { color: tok("--baseline") }, ticks: dateTicks(labels) },
        y: { grid: { color: tok("--grid") }, border: { display: false },
             ticks: { callback: yFmt } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: (it) => labels[it[0].dataIndex],
            label: (c) => ` ${c.dataset.label}: ${yFmt(c.parsed.y)}`,
          },
        },
      },
    },
    plugins: [crosshair, ...plugins],
  };
}

/* Replaces 7 near-identical horizontal-bar blocks whose barThickness (15/18/
   20/22) and right padding (42/44/46/48) had drifted apart accidentally. */
export function hbarConfig({ labels, values, colors, valueLabels, fmt = (v) => v + "%",
                             thickness = 14, padRight = 52 }) {
  return {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderRadius: { topRight: 2, bottomRight: 2 },
        borderSkipped: "start",
        barThickness: thickness,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: padRight } },
      scales: {
        x: { grid: { color: tok("--grid") }, border: { display: false },
             ticks: { callback: fmt } },
        y: { grid: { display: false }, border: { color: tok("--baseline") },
             ticks: { color: tok("--ink-2"), font: { size: 11 } } },
      },
      plugins: {
        tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed.x)}` } },
      },
    },
    plugins: valueLabels ? [barLabels(valueLabels)] : [],
  };
}

export function doughnutConfig({ labels, values, colors, fmt = (v) => v.toFixed(2) + "%" }) {
  return {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: tok("--surface"),
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: "62%",
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed)}` } } },
    },
  };
}

/* Charts are invisible to screen readers without this — the old site had 17
   unnamed <canvas> elements. */
export function describeCanvas(id, label) {
  const c = document.getElementById(id);
  if (!c) return;
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", label);
}
