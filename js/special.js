/* Special situations: the US$100,000 long/short book (swing/book.py), tonight's review panel (swing/review.py), the
   stat-arb hedge (swing/hedge.py), the situations and their lab grades (swing/special_lab.py), and the record
   (swing/journal.py). */

import { loadJSON, showError, el, fmtPct, fmtDate, renderStats, renderTable, money, signedMoney, words } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const $ = (id) => document.getElementById(id);
const usd = (x) => money(x, "USD", 0);
const r2 = (x) => (x == null ? "–" : Number(x).toFixed(2));
const tcell = (t) => el("span", { class: t == null ? "note" : Math.abs(t) >= 2 ? (t > 0 ? "up" : "down") : "", text: t == null ? "–" : t.toFixed(1) });
const pnl = (v) => el("span", { class: v > 0 ? "up" : v < 0 ? "down" : "", text: signedMoney(v, "USD", 0) });
const verdict = (v) => el("span", { class: v === "keep" || v === true ? "up" : v === "reject" || v === false ? "down" : "note", text: v === true ? "traded" : v === false ? "not traded" : v });
const load = async (p) => { try { return await loadJSON(p); } catch { return null; } };

function strip(B, S) {
  const h = B.hedge || {};
  renderStats("sp-strip", [
    { label: "Net asset value", value: usd(B.nav), delta: `${fmtPct(B.return_total, 2)} since ${fmtDate(B.started)}` },
    { label: "Long", value: fmtPct(B.gross_long / B.nav, 0), delta: `${B.positions.filter((p) => p.side === "long").length} names` },
    { label: "Short", value: fmtPct(Math.abs(B.gross_short) / B.nav, 0), delta: "situations and the hedge basket" },
    { label: "Longs' beta", value: h.beta_long == null ? "–" : r2(h.beta_long), delta: h.notional ? `hedge wanted ${usd(h.notional)}` : "no hedge planned yet" },
    { label: "Review tonight", value: S && S.review ? `${S.review.answered} of ${S.review.of}` : "–", delta: S && S.review ? `auditors answered · US$${(S.review.cost_usd || 0).toFixed(2)}` : "" },
  ]);
}

function steps(B) {
  const R = B.rules || {};
  const box = $("sp-steps"); box.innerHTML = "";
  [
    ["Situation", "A dated event the lab grades established or replicated in the book's own universe: a shock fall, a dip after a positive earnings surprise, a dip in a name Renaissance holds. Shorts only where the situation survives its borrow cost."],
    ["Engine", "Stat arb's boosted trees score every liquid name each night; candidates are ranked by grade, then by that score. A veto on its bottom decile is tested, and stays off until the test passes."],
    ["Fundamentals and the bigger picture", "Value, quality and earnings percentiles within the sector, the sector ETF's trend, the macro desk's tilt for that group, the quadrant and stress. Evidence for the auditors; a gate only if the lab switches it on."],
    ["Review", "Four Claude auditors (fundamentals, evidence, bull and bear, risk) score every candidate. Traded only with at most one reject; sized by the geometric mean of their plausibility. Under three answers, nothing new is entered."],
    ["Risk and execution", `Longs up to ${fmtPct(R.max_weight, 0)} each (${R.max_positions} slots), shorts up to ${fmtPct(R.max_short_weight, 0)} (${R.max_shorts} slots), gross at most ${fmtPct(R.gross_max, 0)}; the hedge basket nets the longs' beta to IWM. Orders go to Alpaca's paper account at the next open, with target and stop standing.`],
  ].forEach(([k, v]) => box.appendChild(el("li", {}, [el("strong", { text: k + ". " }), el("span", { text: v })])));
}

function positions(B) {
  const rows = B.positions.map((p) => ({ ...p, plaus: p.review, value: p.qty * (p.last ?? p.fill_px) }));
  $("sp-pos-meta").textContent = `cash ${usd(B.cash)} · borrow paid ${usd(B.borrow_paid || 0)}` + (B.migrated_from ? ` · opened from ${B.migrated_from}` : "");
  renderTable($("sp-pos"), rows, [
    { key: "symbol", label: "Name" },
    { key: "situation", label: "Situation", cls: () => "note", fmt: (v) => (v ? words(v) : "–") },
    { key: "side", label: "Side" },
    { key: "qty", label: "Shares", num: true, fmt: (v) => v.toLocaleString() },
    { key: "fill_px", label: "Fill", num: true, fmt: r2 },
    { key: "last", label: "Last", num: true, fmt: r2 },
    { key: "value", label: "Value", num: true, fmt: usd },
    { key: "pnl", label: "P&L", num: true, fmt: pnl },
    { key: "sessions", label: "Held", num: true, fmt: (v, r) => (r.rule === "hedge" ? "–" : `${v ?? 0} of ${r.hold}`) },
    { key: "plaus", label: "Review", num: true, fmt: (v, r) => (v == null ? (r.adopted ? "before review" : "–") : r2(v)) },
    { key: "statarb_rank", label: "Stat arb", num: true, fmt: (v) => (v == null ? "–" : fmtPct(v, 0)) },
  ], { sortKey: "value", dir: -1, empty: "No positions." });
}

function review(S) {
  const cands = [...(S.long || []), ...(S.short || [])].filter((c) => c.review);
  const rv = S.review || {};
  $("sp-rev-meta").textContent = rv.built ? `${cands.filter((c) => c.review.keep).length} of ${cands.length} kept · ${fmtDate(S.as_of)}` : "no review tonight";
  const first = (c, who) => ((c.review.auditors.find((a) => a.auditor === who) || {}).objections || [])[0] || "";
  renderTable($("sp-rev"), cands.map((c) => ({ ...c, keep: c.review.keep, plaus: c.review.plausibility, rejects: c.review.rejects,
    f: first(c, "fundamentals"), r: first(c, "risk") })), [
    { key: "symbol", label: "Name" },
    { key: "direction", label: "Side" },
    { key: "situation", label: "Situation", cls: () => "note", fmt: (v) => (v ? words(v) : "–") },
    { key: "keep", label: "Verdict", fmt: verdict },
    { key: "plaus", label: "Plausibility", num: true, fmt: r2 },
    { key: "rejects", label: "Rejects", num: true },
    { key: "f", label: "Fundamentals auditor", cls: () => "note wrap" },
    { key: "r", label: "Risk manager", cls: () => "note wrap" },
  ], { sortKey: "plaus", dir: -1, empty: "No candidate passed the quant gates tonight." });
  const box = $("sp-rev-overall"); box.innerHTML = "";
  (rv.overall || []).forEach((a) => box.appendChild(el("p", {}, [el("strong", { text: (a.role || a.auditor) + ". " }),
    el("span", { class: a.error ? "down" : "", text: a.error ? `did not answer (${a.error})` : a.overall })])));
}

function hedge(B, S) {
  const h = B.hedge || {}, plan = B.hedge_plan;
  const basket = (S && S.hedge && S.hedge.basket) || h.members || [];
  $("sp-hedge-meta").textContent = h.date ? `planned ${fmtDate(h.date)}` : "";
  const held = B.positions.filter((p) => p.rule === "hedge");
  renderStats("sp-hedge-strip", [
    { label: "Longs' beta to IWM", value: h.beta_long == null ? "–" : r2(h.beta_long), delta: "per dollar of NAV, 60 sessions, shrunk toward 1" },
    { label: "Hedge beta", value: h.basket_beta ? r2(h.basket_beta) : "–", delta: `${basket.length} name${basket.length === 1 ? "" : "s"}, to IWM` },
    { label: "Hedge wanted", value: h.notional == null ? "–" : usd(h.notional), delta: plan ? "re-size at the next open" : "within 20% of held" },
    { label: "Hedge held", value: usd(-held.reduce((s, p) => s - p.qty * (p.last ?? p.fill_px), 0)), delta: `${held.length} short positions` },
  ]);
  const mode = (S && S.hedge && S.hedge.mode) || "index";
  $("sp-hedge-note").textContent = !basket.length ? "No hedge yet: the scan publishes it tonight."
    : mode === "index"
      ? `The hedge is a short in ${basket.join(", ")}, sized to the longs' beta and capped so longs, shorts and hedge stay within ${fmtPct((B.rules || {}).gross_max, 0)} of NAV (so with small-cap longs it hedges part of the beta, not all). The stat-arb basket was the first design; in the 2025-26 replay below it kept only a tenth of the unhedged return, because the names stat arb scored lowest were the year's speculative rally.`
      : `The basket: ${basket.join(", ")}. These are the names stat arb scores lowest among those Alpaca marks easy to borrow, liquid and not held. Its P&L is reported on its own line in the record.`;
}

function situations(S, L) {
  const cat = (S && S.situations && S.situations.catalogue) || {};
  const act = (S && S.situations && S.situations.active_in_universe) || {};
  const G = (L && L.grades) || {};
  const rows = Object.entries(cat).map(([k, v]) => {
    const gs = (v.rules || []).map((r) => G[r]).filter(Boolean);
    const rank = { established: 0, replicated: 1, suggestive: 2, untested: 3, failed: 4 };
    const best = gs.sort((a, b) => (rank[a.grade] ?? 5) - (rank[b.grade] ?? 5) || ((b.oos || {}).t || 0) - ((a.oos || {}).t || 0))[0];
    return { name: k, kind: v.kind, side: v.side, active: act[k], grade: best ? best.grade : null, oos_t: best ? (best.oos || {}).t : null, evidence: v.evidence };
  });
  renderTable($("sp-sit"), rows, [
    { key: "name", label: "Situation", fmt: (v) => words(v) },
    { key: "kind", label: "Use", fmt: (v) => el("span", { class: v === "trade" ? "up" : v === "avoid" ? "down" : "note", text: v }) },
    { key: "side", label: "Side" },
    { key: "grade", label: "Best grade here", cls: () => "note" },
    { key: "oos_t", label: "Test t", num: true, fmt: tcell },
    { key: "active", label: "Live in universe", num: true, fmt: (v) => (v == null ? "–" : v.toLocaleString()) },
    { key: "evidence", label: "Evidence", cls: () => "note wrap" },
  ]);
}

function lab(L) {
  if (!L) return;
  $("sp-lab-meta").textContent = `judged before ${L.split.slice(0, 4)}, tested after · ${L.tried} tried · ${fmtDate(L.built.slice(0, 10))}`;
  renderTable($("sp-grades"), Object.entries(L.grades).map(([k, g]) => ({ rule: k, grade: g.grade, ins_t: (g.ins || {}).t, oos_t: (g.oos || {}).t,
    oos_mean: (g.oos || {}).mean, n: (g.oos || {}).n, net25: ((L.baseline[k] || {}).oos_25bp || {}).mean })), [
    { key: "rule", label: "Rule", fmt: (v) => words(v) },
    { key: "grade", label: "Grade", fmt: (v) => el("span", { class: v === "established" || v === "replicated" ? "up" : v === "failed" ? "down" : "note", text: v }) },
    { key: "ins_t", label: "Judged t", num: true, fmt: tcell },
    { key: "oos_t", label: "Test t", num: true, fmt: tcell },
    { key: "oos_mean", label: "Test mean", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "net25", label: "At 25 bp", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "n", label: "Trades", num: true, fmt: (v) => (v == null ? "–" : v.toLocaleString()) },
  ], { sortKey: "oos_t", dir: -1 });
  const T = L.tests || {};
  const gate = Object.entries(T).filter(([, v]) => v.per_rule).map(([k, v]) => {
    const pr = Object.values(v.per_rule);
    const on = pr.filter((x) => x.on).length;
    const ts = pr.map((x) => (x.oos || {}).diff_t).filter((t) => t != null);
    return { gate: k, on: on > 0, rules_on: on, of: pr.length, best_t: ts.length ? Math.min(...ts) : null,
      pooled: v.pooled ? v.pooled.oos.diff_mean : null, pooled_t: v.pooled ? v.pooled.oos.t : null };
  });
  renderTable($("sp-gates"), gate, [
    { key: "gate", label: "Gate", fmt: (v) => words(v) },
    { key: "on", label: "Status", fmt: (v) => el("span", { class: v ? "up" : "note", text: v ? "on" : "off" }) },
    { key: "rules_on", label: "Rules it gates", num: true, fmt: (v, r) => `${v} of ${r.of}` },
    { key: "pooled", label: "Flagged vs rest, 2021 on", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "pooled_t", label: "Pooled t", num: true, fmt: tcell },
    { key: "best_t", label: "Weakest rule t", num: true, fmt: tcell },
  ]);
  const ss = T.settlement_stress_short || {};
  const nb = (ss.net_of_borrow || {}).oos || {};
  $("sp-lab-note").textContent = `A gate turns on only when, after ${L.split.slice(0, 4)}, the trades it would block did worse than the rest at t ≤ −2, the sign agreed before, and it survives a false-discovery correction across every gate and rule tried. The "may keep falling" rows ask your question: does a dip with this condition keep dipping? A positive number means those dips rebounded more. The fails-to-deliver short, net of a 10% borrow: test mean ${fmtPct(nb.mean, 1)} (t ${r2(nb.t)}), so it is not traded.`;
}

function record(J) {
  if (!J) return;
  const A = J.auditors || {}, H = J.hedge || {};
  $("sp-rec-meta").textContent = `since ${fmtDate(J.started)} · ${J.edge ? J.edge.verdict || "" : ""}`;
  renderStats("sp-rec-strip", [
    { label: "Closed trades", value: String((J.edge || {}).closed ?? 0), delta: "30 before the edge test says anything" },
    { label: "Hedge P&L", value: signedMoney((H.realised || 0) + (H.open_pnl || 0), "USD", 0), delta: `borrow paid ${usd(H.borrow_paid || 0)}` },
    { label: "Kept by the panel", value: A.kept && A.kept.mean != null ? fmtPct(A.kept.mean, 2) : "–", delta: A.kept ? `${A.kept.resolved} of ${A.kept.reviewed} resolved` : "" },
    { label: "Rejected by the panel", value: A.rejected && A.rejected.mean != null ? fmtPct(A.rejected.mean, 2) : "–", delta: A.verdict || "" },
  ]);
  renderTable($("sp-bysit"), J.by_situation || [], [
    { key: "setup", label: "Situation", fmt: (v) => words(v) },
    { key: "trades", label: "Trades", num: true }, { key: "closed", label: "Closed", num: true },
    { key: "mean", label: "Mean", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "hit", label: "Hit", num: true, fmt: (v) => fmtPct(v, 0) },
    { key: "lab_mean", label: "Lab mean", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "net_pnl", label: "Net P&L", num: true, fmt: pnl },
  ], { empty: "No trades yet." });
  const O = (J.replay && J.replay.orders) || {};
  const label = { random: "Unhedged (random tiebreak)", hedged_index: "Hedged with SPY (in use)", hedged_basket: "Hedged with the stat-arb basket", low_vol: "Unhedged, quietest first", biggest_fall: "Unhedged, biggest fall first" };
  renderTable($("sp-replay"), Object.entries(O).map(([k, v]) => ({ name: label[k] || k, ...v })), [
    { key: "name", label: "Run" },
    { key: "book", label: "Return", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "iwm", label: "IWM", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "beta", label: "Beta to IWM", num: true, fmt: r2 },
    { key: "alpha_annual", label: "Alpha a year", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "t_alpha", label: "t", num: true, fmt: tcell },
    { key: "max_drawdown", label: "Worst drawdown", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "closed", label: "Trades", num: true },
  ], { empty: "The replay runs on Saturdays." });
}

(async function init() {
  renderShell();
  const [B, S, L, J] = await Promise.all(["data/swing_book.json", "data/swing.json", "data/special_lab.json", "data/swing_journal.json"].map(load));
  if (!B) { showError($("error"), new Error("The book has not been published yet.")); return; }
  setAsOf(B.as_of);
  strip(B, S); steps(B); positions(B); hedge(B, S); lab(L); record(J);
  if (S) { review(S); situations(S, L); }
})();
