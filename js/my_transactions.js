/* Transaction log with windowed rendering.

   The previous version built all 352 rows x 6 cells with individual
   createElement calls on every filter change, producing a 13,335px page. This
   renders only the rows intersecting the viewport plus a small overscan, and
   pads above/below with spacer rows so the scrollbar still reflects the real
   dataset length. */

import {
  loadJSON, showError, fmtNum, fmtPct, fmtDate, parseDate, el, renderStats,
} from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const ROW_H = 33;          // must match the CSS row height
const OVERSCAN = 8;

let TX = [], view = [], activity = "All", query = "";
let sortKey = "date", sortDir = -1;

const scroller = () => document.getElementById("tx-scroll");
const tbody = () => document.querySelector("#tx-table tbody");

function applyFilters() {
  const q = query.trim().toLowerCase();
  view = TX.filter((t) =>
    (activity === "All" || t.activity === activity) &&
    (!q || (t.description || "").toLowerCase().includes(q)));
  view.sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * sortDir;
  });
  document.getElementById("tx-count").textContent =
    view.length === TX.length ? `${TX.length} rows` : `${view.length} of ${TX.length} rows`;
  renderWindow(true);
}

const MAXP = () => Math.max(...TX.map((t) => Math.abs(t.size_pct || 0)), 0.0001);

function rowEl(t) {
  const a = (t.activity || "").toLowerCase();
  const tone = a === "buy" ? "up" : a === "sell" ? "down" : "";
  const pct = Math.abs(t.size_pct || 0) / MAXP() * 100;
  return el("tr", { style: `height:${ROW_H}px` }, [
    el("td", { class: "num", text: fmtDate(t.date) }),
    el("td", {}, [el("span", { class: `pill ${tone}`.trim(), text: t.activity })]),
    el("td", { text: t.description || "—" }),
    el("td", { text: t.currency || "" }),
    el("td", { class: "num", text: t.price ? fmtNum(t.price) : "—" }),
    el("td", { class: "num" }, [
      el("div", { style: "display:flex;align-items:center;gap:8px;justify-content:flex-end" }, [
        el("span", { text: fmtPct(t.size_pct, 2) }),
        el("span", { class: "meter", style: "width:52px" },
           [el("i", { style: `width:${pct.toFixed(1)}%` })]),
      ]),
    ]),
  ]);
}

let lastRange = [-1, -1];
function renderWindow(force = false) {
  const sc = scroller(), body = tbody();
  if (!sc || !body) return;
  const head = sc.querySelector("thead")?.offsetHeight || 0;
  const top = Math.max(0, sc.scrollTop - head);
  const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const visible = Math.ceil(sc.clientHeight / ROW_H) + OVERSCAN * 2;
  const last = Math.min(view.length, first + visible);
  if (!force && first === lastRange[0] && last === lastRange[1]) return;
  lastRange = [first, last];

  body.innerHTML = "";
  if (first > 0) body.appendChild(el("tr", { style: `height:${first * ROW_H}px` }, [el("td", { colspan: "6" })]));
  for (let i = first; i < last; i++) body.appendChild(rowEl(view[i]));
  const tail = view.length - last;
  if (tail > 0) body.appendChild(el("tr", { style: `height:${tail * ROW_H}px` }, [el("td", { colspan: "6" })]));
}

function renderFilters() {
  const host = document.getElementById("filters");
  const counts = new Map();
  for (const t of TX) counts.set(t.activity, (counts.get(t.activity) || 0) + 1);
  const kinds = ["All", ...[...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))];
  host.innerHTML = "";
  for (const k of kinds) {
    const n = k === "All" ? TX.length : counts.get(k);
    const b = el("button", { class: `pill${k === activity ? " on" : ""}`, type: "button",
                             "aria-pressed": String(k === activity), text: `${k} ${n}` });
    b.addEventListener("click", () => {
      activity = k;
      [...host.children].forEach((c) => {
        const on = c === b;
        c.classList.toggle("on", on);
        c.setAttribute("aria-pressed", String(on));
      });
      applyFilters();
    });
    host.appendChild(b);
  }
}

function wireSort() {
  document.querySelectorAll("#tx-table th[data-k]").forEach((th) => {
    const act = () => {
      const k = th.dataset.k;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = k === "description" || k === "activity" ? 1 : -1; }
      document.querySelectorAll("#tx-table th[data-k]").forEach((o) => o.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
      applyFilters();
    };
    th.addEventListener("click", act);
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); }
    });
  });
}

(async function init() {
  renderShell();
  const content = document.getElementById("content");
  try {
    TX = await loadJSON("data/transactions.json");
  } catch (err) { showError(content, err); return; }

  const dates = TX.map((t) => t.date).sort();
  setAsOf(`${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`, "RANGE");

  // Activity values arrive lower-case from parse_statements.py ("buy", "sell").
  const n = (k) => TX.filter((t) => (t.activity || "").toLowerCase() === k).length;
  renderStats("stats", [
    { label: "Transactions", value: String(TX.length) },
    { label: "Buys", value: String(n("buy")), tone: "up" },
    { label: "Sells", value: String(n("sell")), tone: "down" },
    { label: "Dividends", value: String(n("dividend")) },
    { label: "Contributions", value: String(n("contribution")) },
  ]);

  renderFilters();
  wireSort();
  document.querySelector('#tx-table th[data-k="date"]').setAttribute("aria-sort", "descending");
  document.getElementById("tx-search").addEventListener("input", (e) => {
    query = e.target.value; applyFilters();
  });
  scroller().addEventListener("scroll", () => renderWindow(), { passive: true });
  addEventListener("resize", () => renderWindow(true));
  document.getElementById("tx-note").textContent =
    "Sizes are percent of book at the time of the trade. Only rows in view are rendered; " +
    "scroll position reflects the full dataset.";
  applyFilters();
})();
