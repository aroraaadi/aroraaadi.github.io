/* A book's activity log. Questrade activity for the book; the USD book can
   also show the pre-split CIBC ledger (Jan 2024 – Jun 2026), which predates
   the two accounts and is kept as history. */

import { loadJSON, showError, fmtNum, fmtPct, fmtDate, el, renderStats, renderTable } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const BOOK = document.querySelector("main").dataset.book;
let QT = null, LEGACY = null, SOURCE = "questrade";
let rows = [], activity = "All", query = "";

const norm = (r) => ({
  date: r.date,
  activity: (r.action || r.activity || r.kind || "").toLowerCase(),
  symbol: r.symbol || null,
  description: r.description || "",
  currency: r.currency || "",
  price: r.price ?? null,
  size_pct: r.size_pct ?? null,
});

function current() {
  return SOURCE === "legacy" ? (LEGACY || []).map(norm) : (QT?.rows || []).map(norm);
}

function paint() {
  const q = query.trim().toLowerCase();
  const view = rows.filter((t) =>
    (activity === "All" || t.activity === activity) &&
    (!q || (t.description + " " + (t.symbol || "")).toLowerCase().includes(q)));
  document.getElementById("tx-count").textContent =
    view.length === rows.length ? `${rows.length} rows` : `${view.length} of ${rows.length} rows`;
  const maxp = Math.max(...rows.map((t) => Math.abs(t.size_pct || 0)), 0.0001);
  renderTable(document.getElementById("tx-table"), view, [
    { key: "date", label: "Date", fmt: (v) => fmtDate(v) },
    { key: "activity", label: "Activity", fmt: (v) =>
        el("span", { class: `pill ${v === "buy" ? "up" : v === "sell" ? "down" : ""}`.trim(), text: v || "—" }) },
    { key: "symbol", label: "Security", fmt: (v, r) => v
        ? el("span", {}, [el("span", { class: "sym", text: v }), r.description ? el("span", { class: "muted", text: `  ${r.description}` }) : null])
        : el("span", { class: "muted", text: r.description || "—" }) },
    { key: "currency", label: "Ccy" },
    { key: "price", label: "Price", num: true, fmt: (v) => (v ? fmtNum(v) : "—") },
    { key: "size_pct", label: "Size", num: true, fmt: (v) => el("div", { style: "display:flex;align-items:center;gap:8px;justify-content:flex-end" }, [
        el("span", { text: v == null ? "—" : fmtPct(v, 2) }),
        el("span", { class: "meter", style: "width:52px" }, [el("i", { style: `width:${(Math.abs(v || 0) / maxp * 100).toFixed(1)}%` })]),
      ]) },
  ], { sortKey: "date", dir: -1 });
}

function renderFilters() {
  const host = document.getElementById("filters");
  const counts = new Map();
  for (const t of rows) counts.set(t.activity, (counts.get(t.activity) || 0) + 1);
  const kinds = ["All", ...[...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))];
  host.innerHTML = "";
  for (const k of kinds) {
    const n = k === "All" ? rows.length : counts.get(k);
    const b = el("button", { class: `pill${k === activity ? " on" : ""}`, type: "button",
                             "aria-pressed": String(k === activity), text: `${k} ${n}` });
    b.addEventListener("click", () => {
      activity = k;
      [...host.children].forEach((c) => { const on = c === b; c.classList.toggle("on", on); c.setAttribute("aria-pressed", String(on)); });
      paint();
    });
    host.appendChild(b);
  }
}

function load() {
  rows = current();
  activity = "All";
  const n = (k) => rows.filter((t) => t.activity === k).length;
  renderStats("stats", [
    { label: "Rows", value: String(rows.length) },
    { label: "Buys", value: String(n("buy")), tone: "up" },
    { label: "Sells", value: String(n("sell")), tone: "down" },
    { label: "Dividends", value: String(n("dividend")) },
    { label: "Contributions", value: String(n("contribution")) },
  ]);
  const note = document.getElementById("tx-note");
  if (SOURCE === "legacy") {
    note.textContent = "CIBC Investor's Edge statements, Jan 2024 – Jun 2026, before the account moved to Questrade and " +
      "was split into two books. Sizes are percent of the whole account at the time of the trade.";
  } else if (!rows.length) {
    note.textContent = "No Questrade activity is published yet — the activity endpoint timed out at the last sync. " +
      "It is retried daily and the log fills in when it answers.";
  } else {
    note.textContent = `Questrade activity, ${QT.as_of}. Sizes are percent of the book's equity at the time of the sync, not of the trade.`;
  }
  const dates = rows.map((t) => t.date).sort();
  setAsOf(dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}` : (QT?.as_of || "—"), dates.length ? "RANGE" : "AS OF");
  renderFilters();
  paint();
}

(async function init() {
  renderShell();
  const pf = await loadJSON("data/current_portfolio.json").catch(() => null);
  const b = pf?.books?.[BOOK];
  document.getElementById("book-eyebrow").textContent = b ? `${b.label} · ${b.currency}` : BOOK.toUpperCase();
  QT = await loadJSON(`data/transactions_${BOOK}.json`).catch(() => null);
  if (BOOK === "usd") {
    LEGACY = await loadJSON("data/transactions.json").catch(() => null);
    if (LEGACY) {
      const ctl = document.getElementById("source-controls"); ctl.hidden = false;
      document.getElementById("source-note").textContent = `${LEGACY.length} rows in the pre-split ledger`;
      document.getElementById("source").addEventListener("click", (e) => {
        const btn = e.target.closest("button"); if (!btn) return;
        [...e.currentTarget.children].forEach((c) => c.classList.toggle("active", c === btn));
        SOURCE = btn.dataset.v; load();
      });
    }
  }
  if (!QT && !LEGACY) { showError(document.getElementById("error"), new Error("no activity files published")); return; }
  document.getElementById("tx-search").addEventListener("input", (e) => { query = e.target.value; paint(); });
  load();
})();
