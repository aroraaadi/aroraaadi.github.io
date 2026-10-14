/* Sector rotation: Bloomberg's RRG rebuilt from our ETF closes (macro/rrg.py -> data/rrg.json). */
import { loadJSON, showError, el, fmtDate, renderTable, tok, alpha, breakdownColors } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { applyChartDefaults, draw } from "./charts.js";

const $ = (id) => document.getElementById(id);
const QUAD = { Leading: "--up", Weakening: "--warn", Lagging: "--down", Improving: "--accent" };
const UNIT = { weekly: "weeks", daily: "days" };
let R = null, VIEW = "weekly", SET = "spdr", TAILN = 10;

function chips(id, items, current, pick) {
  const box = $(id); box.innerHTML = "";
  items.forEach(([key, label]) => {
    const b = el("button", { type: "button", class: `pill${key === current ? " on" : ""}`, role: "tab", "aria-selected": String(key === current), text: label });
    b.addEventListener("click", () => pick(key));
    box.appendChild(b);
  });
}

// The four quadrants shaded, the 100/100 cross, and each line's name at its head.
const rrgPlugin = { id: "rrg",
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { x, y } } = chart, cx = x.getPixelForValue(100), cy = y.getPixelForValue(100);
    ctx.save();
    [["Leading", cx, a.top, a.right, cy], ["Weakening", cx, cy, a.right, a.bottom],
     ["Lagging", a.left, cy, cx, a.bottom], ["Improving", a.left, a.top, cx, cy]].forEach(([q, x0, y0, x1, y1]) => {
      ctx.fillStyle = alpha(QUAD[q], 0.07); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = tok(QUAD[q]); ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = x0 === a.left ? "left" : "right"; ctx.textBaseline = y0 === a.top ? "top" : "bottom";
      ctx.fillText(q, x0 === a.left ? x0 + 6 : x1 - 6, y0 === a.top ? y0 + 6 : y1 - 6);
    });
    ctx.strokeStyle = tok("--ink-2"); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, a.top); ctx.lineTo(cx, a.bottom); ctx.moveTo(a.left, cy); ctx.lineTo(a.right, cy); ctx.stroke();
    ctx.restore();
  },
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    ctx.save(); ctx.font = "600 10px ui-monospace, monospace"; ctx.textBaseline = "middle";
    chart.data.datasets.forEach((ds, i) => {
      const pts = chart.getDatasetMeta(i).data, head = pts[pts.length - 1];
      if (!head) return;
      ctx.fillStyle = ds.borderColor; ctx.fillText(ds.label, head.x + 7, head.y);
    });
    ctx.restore();
  } };

function chart() {
  const rows = (R.sets[SET] || []).map((s) => [s, R.views[VIEW][SET]?.[s]]).filter(([, r]) => r);
  const cols = breakdownColors(rows.length);
  const datasets = rows.map(([s, r], i) => {
    const t = r.tail.slice(-TAILN), last = t.length - 1;
    return { label: s, showLine: true, borderColor: cols[i], backgroundColor: cols[i], borderWidth: 1.5, tension: 0.35,
      pointRadius: t.map((_, j) => (j === last ? 5 : 2)), pointHoverRadius: 6,
      data: t.map(([d, x, y]) => ({ x, y, d, name: r.name })) };
  });
  // Square and centred on 100, so the angle of a tail reads true.
  const span = Math.max(1, ...datasets.flatMap((d) => d.data.flatMap((p) => [Math.abs(p.x - 100), Math.abs(p.y - 100)]))) * 1.12;
  const axis = (text) => ({ min: 100 - span, max: 100 + span, title: { display: true, text }, grid: { color: tok("--grid") },
    ticks: { callback: (v) => v.toFixed(1) } });
  draw("rrg-chart", {
    type: "scatter", data: { datasets }, plugins: [rrgPlugin],
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { right: 36, top: 4 } },
      scales: { x: axis("JdK RS-Ratio (relative trend)"), y: axis("JdK RS-Momentum (its rate of change)") },
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} (${c.raw.name}), ${fmtDate(c.raw.d)}: ratio ${c.raw.x.toFixed(2)}, momentum ${c.raw.y.toFixed(2)}` } } } },
  });
  renderTable($("rrg-table"), rows.map(([s, r]) => ({ symbol: s, name: r.name, quadrant: r.quadrant, periods: r.periods,
    x: r.tail[r.tail.length - 1][1], y: r.tail[r.tail.length - 1][2] })), [
    { key: "symbol", label: "Line", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "name", label: "What it holds", cls: () => "note" },
    { key: "quadrant", label: "Quadrant", fmt: (v) => el("span", { text: v, style: `color:${tok(QUAD[v])};font-weight:600` }) },
    { key: "periods", label: `In it, ${UNIT[VIEW]}`, num: true },
    { key: "x", label: "RS-Ratio", num: true, fmt: (v) => v.toFixed(2) },
    { key: "y", label: "RS-Momentum", num: true, fmt: (v) => v.toFixed(2) },
  ], { sortKey: "x", dir: -1 });
  $("rrg-meta").textContent = `against ${R.bench[SET]} · ${VIEW}, trend window ${R.windows[VIEW].w} ${UNIT[VIEW]} · tail ${TAILN}`;
}

function controls() {
  chips("rrg-view", [["weekly", "Weekly"], ["daily", "Daily"]], VIEW, (k) => { VIEW = k; controls(); chart(); });
  chips("rrg-set", [["spdr", "SPDR sectors"], ["groups", "Industry groups"], ["markets", "Markets"]], SET, (k) => { SET = k; controls(); chart(); });
}

async function main() {
  renderShell();
  applyChartDefaults();
  try { R = await loadJSON("data/rrg.json"); } catch { R = null; }
  if (!R) { showError($("error"), new Error("The rotation graph has not been published yet.")); return; }
  setAsOf(R.as_of, "AS OF");
  controls(); chart();
  const tail = $("rrg-tail");
  tail.addEventListener("input", () => { TAILN = +tail.value; $("rrg-tail-n").textContent = TAILN; chart(); });
  $("rrg-method").textContent = R.method;
  onThemeChange(() => { applyChartDefaults(); chart(); });
}

main();
