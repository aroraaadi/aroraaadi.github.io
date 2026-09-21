/* Home: the two books side by side, what they have in common, what moved. */

import {
  loadJSON, showError, fmtPct, fmtNum, fmtSigned, fmtDate, signClass, tok,
  breakdownColors, el, renderStats, renderTable,
} from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const BOOK_ORDER = ["usd", "cad"];
let PF = null, MET = {}, HIST = null, TX = {}, REGIME = null, DECISION = null, MODEL = null;

const run = (b) => (b.managed_by === "model" ? "run by the engine" : "run by hand");

function bookCard(key, b) {
  const m = MET[key];
  const rows = [...b.positions].sort((x, y) => y.weight - x.weight);
  const colors = breakdownColors(rows.length);
  const idx = (HIST?.books?.[key] || []);
  const last = idx[idx.length - 1], first = idx[0];
  const since = idx.length > 1 ? (last.value_index / first.value_index - 1) : null;

  const stats = el("div", { class: "strip" });
  renderStats(stats, [
    { label: "Positions", value: String(b.n_positions),
      delta: `cash ${fmtPct(b.cash_weight, 1)}` },
    { label: "Share of both", value: fmtPct(b.share_of_total, 0), delta: "of the combined book" },
    m ? { label: `Beta vs ${m.benchmark === "S&P 500" ? "S&P" : "TSX"}`, value: fmtNum(m.beta),
          delta: `vol ${fmtPct(m.vol_annual, 0)} · 3y, hypothetical` } : null,
    m ? { label: "Max drawdown", value: fmtPct(m.max_drawdown, 0), tone: "down",
          delta: `CVaR₉₅ ${fmtPct(m.cvar95, 1)}/day` } : null,
    { label: since == null ? "Tracking" : "Since the split", value: since == null ? "day 1" : fmtSigned(since),
      tone: since == null ? "" : signClass(since),
      delta: since == null ? `index starts ${first ? fmtDate(first.date) : "today"}` : `${idx.length} points` },
    m ? { label: "Effective bets", value: fmtNum(m.effective_bets, 1),
          delta: `${fmtNum(m.effective_n, 1)} by weight` } : null,
  ]);

  const bar = el("div", { class: "stack-bar", role: "img",
    "aria-label": `Allocation: ${rows.map((p) => `${p.symbol} ${fmtPct(p.weight, 1)}`).join(", ")}` },
    rows.map((p, i) => el("i", { style: `flex:${p.weight};background:${colors[i]}`, title: `${p.symbol} ${fmtPct(p.weight, 1)}` }))
      .concat(b.cash_weight > 0.005 ? [el("i", { class: "cash", style: `flex:${b.cash_weight}`, title: "cash" })] : []));

  const top = rows.slice(0, 6);
  const list = el("div", { class: "toplist" }, top.map((p, i) => el("div", { class: "row" }, [
    el("span", { class: "dot", style: `background:${colors[i]}` }),
    el("span", { class: "sym", text: p.symbol }),
    el("span", { class: "name", text: p.name || "" }),
    el("span", { class: "num", text: fmtPct(p.weight, 1) }),
  ])));
  if (rows.length > top.length) {
    const rest = rows.slice(top.length).reduce((s, p) => s + p.weight, 0);
    list.appendChild(el("div", { class: "more", text: `${rows.length - top.length} more positions · ${fmtPct(rest, 1)}` }));
  }

  return el("article", { class: "book-card", "data-book": key }, [
    el("div", { class: "book-card-h" }, [
      el("span", { class: "book-tag", text: b.currency }),
      el("h2", { class: "book-name", text: b.label }),
      el("span", { class: "book-run", text: run(b) }),
    ]),
    el("p", { class: "mandate", text: b.mandate }),
    stats, bar, list,
    el("a", { class: "book-link", href: `${key}/index.html`, text: `Open the ${b.label} →` }),
  ]);
}

function renderBooks() {
  const host = document.getElementById("books"); host.innerHTML = "";
  for (const key of BOOK_ORDER) if (PF.books[key]) host.appendChild(bookCard(key, PF.books[key]));
}

function renderCombined() {
  const books = BOOK_ORDER.filter((k) => PF.books[k]).map((k) => PF.books[k]);
  const n = books.reduce((s, b) => s + b.n_positions, 0);
  const shares = books.map((b) => `${b.currency} ${Math.round((b.share_of_total || 0) * 100)}`).join(" / ");
  const comb = HIST?.combined || [];
  const c0 = comb[0], c1 = comb[comb.length - 1];
  renderStats("combined", [
    { label: "Split by book", value: shares, delta: "share of combined value" },
    { label: "Positions", value: String(n), delta: books.map((b) => `${b.n_positions} ${b.currency}`).join(" · ") },
    { label: "Managed by", value: books.map((b) => (b.managed_by === "model" ? "engine" : "hand")).join(" + "),
      delta: "one suggest-only engine, one owner" },
    c0 && c1 && comb.length > 1
      ? { label: `Combined since ${fmtDate(c0.date)}`, value: fmtSigned(c1.value_index / 100 - 1),
          tone: signClass(c1.value_index / 100 - 1), delta: "value index, CAD, incl. contributions" } : null,
    { label: "Last sync", value: PF.as_of, delta: "Questrade API, daily" },
  ]);
}

function renderActivity() {
  const rows = [];
  for (const key of BOOK_ORDER) for (const r of (TX[key]?.rows || [])) rows.push({ ...r, book: key });
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const note = document.getElementById("activity-note");
  if (!rows.length) {
    note.textContent = "No activity published yet — Questrade's activity endpoint timed out at the last sync; the log fills in when it answers.";
    document.querySelector("#activity-table").closest(".tbl-wrap").hidden = true;
    return;
  }
  note.textContent = `latest ${rows.length > 12 ? 12 : rows.length}`;
  renderTable(document.getElementById("activity-table"), rows.slice(0, 12), [
    { key: "date", label: "Date", fmt: (v) => fmtDate(v) },
    { key: "book", label: "Book", fmt: (v) => el("span", { class: "pill book", "data-book": v, text: v.toUpperCase() }) },
    { key: "action", label: "Action", fmt: (v) => el("span", { class: `pill ${v === "buy" ? "up" : v === "sell" ? "down" : ""}`.trim(), text: v }) },
    { key: "symbol", label: "Security", fmt: (v, r) => v ? el("span", { class: "sym", text: v }) : (r.description || "—") },
    { key: "size_pct", label: "Size", num: true, fmt: (v) => (v == null ? "—" : fmtPct(v, 2)) },
  ]);
}

function renderEngine() {
  const stress = REGIME?.stress ?? REGIME?.nowcast?.stress ?? null;
  const p = stress?.prob ?? stress?.p ?? REGIME?.p_stressed ?? MODEL?.p_stressed ?? null;
  const band = MODEL?.vol_band_used || MODEL?.vol_target_band || null;
  const defs = [
    p != null ? { label: "P(stressed)", value: fmtPct(p, 0), tone: p >= 0.5 ? "down" : "",
                  delta: "Markov-switching nowcast" } : null,
    band ? { label: "Vol band", value: band.map((v) => fmtPct(v, 0)).join("–"),
             delta: MODEL?.vol_band_met ? "model inside band" : "model outside band" } : null,
    MODEL ? { label: "Model vol", value: fmtPct(MODEL.model_vol, 1), delta: `${MODEL.n_positions} target names` } : null,
    MODEL?.active_share != null ? { label: "Active share", value: fmtPct(MODEL.active_share, 0), delta: "vs equilibrium" } : null,
    DECISION?.decision ? { label: "Decision", value: String(DECISION.decision).toUpperCase(),
                           delta: DECISION.as_of || "" } : null,
  ].filter(Boolean);
  renderStats("engine", defs.length ? defs : [{ label: "Engine", value: "—", delta: "no published state" }]);
  document.getElementById("engine-note").textContent = "suggest-only; runs the USD book";
  const links = [
    ["research/index.html", "Model book", "what the optimizer would hold"],
    ["research/regime.html", "Regime", "stress nowcast and the decision"],
    ["research/holdings.html", "Rebalances", "what changed and why"],
    ["research/options.html", "Options", "the hedge overlay"],
  ];
  const host = document.getElementById("engine-links"); host.innerHTML = "";
  for (const [href, b, s] of links) host.appendChild(el("a", { href }, [el("b", { text: b }), el("span", { text: s })]));
}

(async function init() {
  renderShell();
  try {
    PF = await loadJSON("data/current_portfolio.json");
  } catch (err) {
    showError(document.getElementById("error"), err); return;
  }
  const settled = await Promise.allSettled([
    loadJSON("data/metrics_usd.json"), loadJSON("data/metrics_cad.json"),
    loadJSON("data/book_history.json"),
    loadJSON("data/transactions_usd.json"), loadJSON("data/transactions_cad.json"),
    loadJSON("data/regime.json"), loadJSON("data/decision.json"), loadJSON("data/portfolio.json"),
  ]);
  const v = (i) => (settled[i].status === "fulfilled" ? settled[i].value : null);
  MET = { usd: v(0), cad: v(1) }; HIST = v(2); TX = { usd: v(3), cad: v(4) };
  REGIME = v(5); DECISION = v(6); MODEL = v(7);
  setAsOf(PF.as_of);
  document.getElementById("home-meta").textContent =
    `Synced ${PF.as_of} · ${Object.keys(PF.books).length} accounts · weights within each book`;
  renderBooks(); renderCombined(); renderActivity(); renderEngine();
})();
