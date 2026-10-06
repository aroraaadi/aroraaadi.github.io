/* Terminal components — the TradingView-inspired layer.
   ------------------------------------------------------------------
   Four pieces, each answering a question a price screen answers without
   being asked:

     ticker()    what is this, where is it, how much did it move
     pill()      is that good or bad, at a glance, in greyscale too
     sparkline() and is that shape unusual
     timeframes()show me a different window without leaving the page
     crosshair() what was the value on that day

   Everything is inline SVG or plain DOM. No chart library is loaded for
   the sparkline: it is nine points and a path, and pulling in a renderer
   to draw it would cost more than the page it decorates.
*/
import { el, fmtPct, fmtNum } from "./common.js";

/** A signed pill. The arrow is the non-colour cue, so this survives
 *  greyscale printing and colour-vision deficiency. */
export function pill(value, { fmt = (v) => fmtPct(v, 2), zero = 1e-9 } = {}) {
  if (value == null || !isFinite(value)) return el("span", { class: "pill", text: "—" });
  const dir = value > zero ? "up" : value < -zero ? "down" : "";
  const sign = value > zero ? "+" : "";
  return el("span", { class: `pill ${dir}`.trim(), text: sign + fmt(value) });
}

/** The quote header: symbol, name, level, change, and any extra facts.
 *  `meta` is a list of [label, value] pairs shown on the right. */
export function ticker(host, { symbol, name, value, valueFmt, change, meta = [] }) {
  if (!host) return;
  host.innerHTML = "";
  host.className = "ticker";
  const left = el("div", {});
  left.appendChild(el("div", { class: "ticker-sym", text: symbol || "" }));
  if (name) left.appendChild(el("div", { class: "ticker-name", text: name }));
  host.appendChild(left);
  if (value != null) {
    host.appendChild(el("div", {
      class: "ticker-val",
      text: valueFmt ? valueFmt(value) : fmtNum(value, 2),
    }));
  }
  if (change != null) host.appendChild(pill(change));
  if (meta.length) {
    const m = el("div", { class: "ticker-meta" });
    for (const [k, v] of meta) {
      const cell = el("div", {});
      cell.appendChild(el("div", { class: "k", text: k }));
      cell.appendChild(el("div", { class: "v", text: v == null ? "—" : String(v) }));
      m.appendChild(cell);
    }
    host.appendChild(m);
  }
}

/** An inline sparkline. Returns an <svg>, coloured by its own net move.
 *
 *  Drawn in a 0..100 x 0..30 viewBox and scaled by CSS, so one path serves
 *  every size. A flat series still draws a line rather than collapsing to
 *  nothing: "this did not move" is information. */
export function sparkline(values, { width = 68, height = 20, area = true } = {}) {
  const pts = (values || []).filter((v) => v != null && isFinite(v));
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "spark");
  svg.setAttribute("viewBox", "0 0 100 30");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("aria-hidden", "true");
  if (pts.length < 2) return svg;

  const lo = Math.min(...pts), hi = Math.max(...pts);
  const span = hi - lo || 1;
  const x = (i) => (i / (pts.length - 1)) * 100;
  const y = (v) => 29 - ((v - lo) / span) * 28;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join("");
  const net = pts[pts.length - 1] - pts[0];
  const cls = net > 0 ? "up" : net < 0 ? "down" : "flat";

  if (area) {
    const fill = document.createElementNS(ns, "path");
    fill.setAttribute("class", `area ${cls}`);
    fill.setAttribute("d", `${d}L100,30L0,30Z`);
    fill.setAttribute("fill", "currentColor");
    fill.style.color = `var(--${cls === "flat" ? "muted" : cls})`;
    svg.appendChild(fill);
  }
  const line = document.createElementNS(ns, "path");
  line.setAttribute("class", cls);
  line.setAttribute("d", d);
  svg.appendChild(line);
  return svg;
}

/** A timeframe chip row. `onPick` receives the chosen key.
 *
 *  Buttons rather than a select: one tap, the current state visible without
 *  opening anything, and the set is small enough that a menu would be slower
 *  than the thing it hides. */
export function timeframes(host, options, active, onPick) {
  if (!host) return;
  host.innerHTML = "";
  host.className = "tf";
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "Time range");
  for (const [key, label] of options) {
    const b = el("button", { type: "button", text: label });
    b.setAttribute("aria-pressed", String(key === active));
    b.addEventListener("click", () => {
      for (const other of host.querySelectorAll("button")) {
        other.setAttribute("aria-pressed", "false");
      }
      b.setAttribute("aria-pressed", "true");
      onPick(key);
    });
    host.appendChild(b);
  }
}

/** A crosshair readout over a Chart.js line chart.
 *
 *  Chart.js already tracks the nearest point; this borrows that rather than
 *  re-deriving it from the mouse position, so the readout and the tooltip can
 *  never disagree about which day is under the cursor. */
export function crosshair(canvas, chart, format) {
  if (!canvas || !chart) return null;
  const wrap = canvas.closest(".chart-wrap") || canvas.parentElement;
  if (!wrap) return null;
  if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
  const box = el("div", { class: "readout" });
  wrap.appendChild(box);

  const show = (ev) => {
    const hit = chart.getElementsAtEventForMode(ev, "index", { intersect: false }, true);
    if (!hit.length) { box.classList.remove("on"); return; }
    const i = hit[0].index;
    box.innerHTML = "";
    const label = chart.data.labels?.[i];
    box.appendChild(el("span", { class: "d", text: label == null ? "" : String(label) }));
    for (const ds of chart.data.datasets) {
      if (ds.hidden) continue;
      const v = ds.data[i];
      if (v == null) continue;
      const cell = el("span", {});
      cell.appendChild(el("span", { class: "d", text: `${ds.label} ` }));
      cell.appendChild(el("b", { text: format ? format(v, ds) : fmtNum(v, 2) }));
      box.appendChild(cell);
    }
    box.classList.add("on");
  };
  canvas.addEventListener("mousemove", show);
  canvas.addEventListener("mouseleave", () => box.classList.remove("on"));
  return box;
}
