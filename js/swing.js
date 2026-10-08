/* Swing setups: tonight's graded entries with live prices, the evidence per
   rule, the sizing race and the scored record (swing/*.py). */

import { loadJSON, showError, el, fmtPct, fmtDate, renderStats, renderTable, tok } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { draw, lineConfig, applyChartDefaults } from "./charts.js";

const $ = (id) => document.getElementById(id);
let S = null, L = null, R = null, Q = null, side = "long", gradeMode = "strong", sizeRule = null;
const GRADE_TONE = { established: "up", replicated: "up", suggestive: "warn", untested: "muted", failed: "down", control: "muted" };
const STRONG = new Set(["established", "replicated"]);
const spct = (x, dp = 1) => (x == null ? "–" : (x > 0 ? "+" : "") + fmtPct(x, dp));
const tcell = (t) => el("span", { class: t == null ? "note" : Math.abs(t) >= 3 ? (t > 0 ? "up" : "down") : Math.abs(t) >= 2 ? "" : "note", text: t == null ? "–" : t.toFixed(1) });
const gradePill = (g) => el("span", { class: `pill ${GRADE_TONE[g] || ""}`, text: g || "untested" });
const ruleLabel = (k) => k.replace(/_/g, " ").replace(/\b(long|short)$/, "").trim();
const fmtPx = (v) => (v == null ? "–" : v.toFixed(2));
const PLAN_NAMES = { next_open: "next open", confirm_ema: "close above EMA9, then open", confirm_vwap: "close above anchored VWAP, then open",
  fib_bounce_382: "stop-entry at the 38.2% bounce", fib_dip_382: "limit 38.2% lower", fib_target_382: "next open; take profit at 38.2%", fib_target_618: "next open; take profit at 61.8%", ema21_filter: "next open (above EMA21 only)" };
const planLabel = (r) => { const p = r.plan || {}; const n = PLAN_NAMES[r.timing] || r.timing || "next open"; return p.level ? `${n} (${p.level.toFixed(2)})` : n; };

function strip() {
  const c = S.context, rec = R?.overall || {};
  const strong = [...S.long, ...S.short].filter((x) => STRONG.has(x.grade)).length;
  renderStats("sw-strip", [
    { label: "Scanned at the close of", value: fmtDate(S.as_of), delta: `${S.universe.names.toLocaleString()} names · $${S.universe.min_price}+, $${(S.universe.min_dollar_volume / 1e6).toFixed(0)}m+ a day` },
    { label: "Setups tonight", value: `${S.counts.long} long · ${S.counts.short} short`, delta: `${strong} with established or replicated evidence` },
    { label: "Regime", value: c.stressed ? "stressed" : "calm", tone: c.stressed ? "down" : "", delta: `p ${c.p_stressed == null ? "–" : (c.p_stressed * 100).toFixed(0)}% · SPY ${c.spy_above_200d ? "above" : "below"} its 200-day · VIX ${c.vix == null ? "–" : c.vix.toFixed(1)}` },
    { label: "Record", value: R ? `${R.closed} closed` : "–", delta: R && rec.n ? `hit ${fmtPct(rec.hit, 0)} · mean ${spct(rec.mean, 2)} · t ${rec.t == null ? "–" : rec.t.toFixed(1)}` : "no closed suggestions yet" },
  ]);
}

function entries() {
  const rows = (side === "long" ? S.long : S.short).filter((r) => gradeMode === "all" || STRONG.has(r.grade)).map((r) => ({ ...r, q: Q?.quotes?.[r.symbol] }));
  renderTable($("sw-entries"), rows, [
    { key: "rank", label: "#", num: true },
    { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "rule", label: "Setup", fmt: (v, r) => el("span", { title: (r.also || []).length ? `also: ${r.also.map(ruleLabel).join(", ")}` : "", text: ruleLabel(v) + ((r.also || []).length ? ` +${r.also.length}` : "") }) },
    { key: "grade", label: "Evidence", fmt: gradePill },
    { key: "model", label: "Model", num: true, fmt: (m) => (m && m.mu != null ? el("span", { class: m.in_use ? (m.mu > 0 ? "up" : "down") : "note", title: `chart ${spct(m.tech, 2)} · fundamentals ${spct(m.fund, 2)} · setup ${spct(m.base, 2)}${m.in_use ? "" : " · diagnostic"}`, text: spct(m.mu, 2) }) : "–") },
    { key: "signal_close", label: "Signal close", num: true, fmt: (v) => v.toFixed(2) },
    { key: "q", label: "Live", num: true, fmt: (q) => (q ? el("span", { class: q.day_pct > 0 ? "up" : q.day_pct < 0 ? "down" : "", text: `${q.price.toFixed(2)} (${spct(q.day_pct)})` }) : "–") },
    { key: "timing", label: "Entry plan", cls: () => "note", fmt: (v, r) => planLabel(r) },
    { key: "levels", label: "Levels", cls: () => "note wrap", fmt: (lv) => (lv ? `EMA9 ${fmtPx(lv.ema9)} ${lv.above_ema9 ? "▲" : "▼"} · EMA21 ${fmtPx(lv.ema21)} ${lv.above_ema21 ? "▲" : "▼"} · VWAP ${fmtPx(lv.vwap)} · Fib 38/62 ${fmtPx(lv.fib_382)}/${fmtPx(lv.fib_618)}` : "–") },
    { key: "stop", label: "Stop", num: true, fmt: (v, r) => (v ? v.toFixed(2) : `time, ${r.hold}d`) },
    { key: "target", label: "Target", num: true, fmt: (v) => (v ? v.toFixed(2) : "–") },
    { key: "risk_unit_pct", label: "Risk unit", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "size_pct", label: "Size", num: true, fmt: (v) => `${(v * 100).toFixed(1)}%` },
    { key: "hold", label: "Hold", num: true, fmt: (v) => `${v}d` },
    { key: "days_to_earnings", label: "Reports in", num: true, fmt: (v) => (v == null ? "–" : el("span", { class: v <= S.context.earnings_skip_days ? "down" : "", text: `${v}d` })) },
    { key: "news2", label: "News", num: true, fmt: (v, r) => el("span", { class: r.news_neg ? "down" : r.news_pos ? "up" : "note", text: v ? String(v) : "–" }) },
    { key: "statarb_rank", label: "Stat-arb rank", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(2)) },
    { key: "flags", label: "Flags", cls: () => "note", fmt: (v) => (v || []).join(", ") || "" },
    { key: "why", label: "Why", cls: () => "note wrap sw-why" },
  ]);
  $("sw-e-meta").textContent = `${rows.length} shown · entered at the next open · built ${S.built.replace("T", " ")}`;
  $("sw-e-note").textContent = side === "long"
    ? "Buy at the next open; the stop and target are set off the signal close in units of the 14-day ATR. A setup with no stop leaves at the close of its last held session."
    : "Sell short at the next open; the stop sits above, the target below. Borrow and locate costs are not modelled; a name Alpaca does not mark shortable is flagged.";
  $("sw-e-foot").textContent = `Size is the share of equity under the ${S.size_policy.replace("_", " ")} policy, capped at a tenth of equity and 5% risk; "risk unit" is the stop ` +
    `distance (or one ATR). Rank: evidence grade first, then ${S.model_in_use ? "the trade model's expected return" : "the stat-arb model's rank for the side (the trade model's expectation is shown as a diagnostic until it clears its bar)"}. ` +
    `Flags are shown, not hidden: a report within ${S.context.earnings_skip_days} sessions, a stressed regime for longs, a name that cannot be shorted, a rule the live record has paused.`;
}

function storiesPanel() {
  const rows = (side === "long" ? S.long : S.short).filter((r) => STRONG.has(r.grade) && r.story).slice(0, 12);
  const box = $("sw-stories"); box.innerHTML = "";
  $("sw-st-meta").textContent = rows.length ? `${rows.length} of tonight's ${side} setups with established or replicated evidence` : "no strong setups tonight";
  rows.forEach((r) => {
    const st = r.story, m = st.model || r.model;
    const head = el("div", { class: "sw-story-h" }, [
      el("span", { class: "sym", text: r.symbol }), el("span", { class: "note", text: ruleLabel(r.rule) }), gradePill(r.grade),
      el("span", { class: "spacer" }),
      m && m.mu != null ? el("span", { class: m.in_use ? (m.mu > 0 ? "up" : "down") : "note", text: `model ${spct(m.mu, 2)}` }) : el("span"),
    ]);
    const kids = [head, el("p", { class: "sw-story-t", text: st.text })];
    if ((st.headlines || []).length) {
      kids.push(el("ul", { class: "sw-story-news" }, st.headlines.map((h) => el("li", {}, [
        h.url ? el("a", { href: h.url, target: "_blank", rel: "noopener", text: `“${h.title}”` }) : el("span", { text: `“${h.title}”` }),
        el("span", { class: "note", text: ` ${h.publisher || ""} · ${fmtDate(h.session)}` }),
      ]))));
    }
    if (m && m.mu != null) {
      const w = Math.max(Math.abs(m.tech), Math.abs(m.fund), Math.abs(m.base), 1e-6);
      kids.push(el("div", { class: "sw-story-bars" }, [["chart", m.tech], ["fundamentals", m.fund], ["setup", m.base]].map(([k, v]) =>
        el("div", { class: "sw-bar-row" }, [el("span", { class: "note", text: k }), el("div", { class: "sw-bar" }, [el("div", { class: `sw-bar-fill ${v >= 0 ? "pos" : "neg"}`, style: `width:${(50 * Math.abs(v) / w).toFixed(1)}%;${v >= 0 ? "left:50%" : "right:50%"}` })]),
          el("span", { class: "num " + (v > 0 ? "up" : v < 0 ? "down" : ""), text: spct(v, 2) })]))));
    }
    box.appendChild(el("div", { class: "sw-story" }, kids));
  });
}

let LN = null, lMode = "coef";
function learnPanel() {
  if (!LN) { $("sw-l-note").textContent = "The trade model is fitted with the weekly lab and updated each evening from the ledger."; return; }
  const b = LN.models.both, t = LN.models.tech, f = LN.models.fund, add = LN.added_by_fundamentals, lv = LN.live, sc = lv.score || {};
  $("sw-l-meta").textContent = `fitted ${fmtDate(LN.fitted)} · ${LN.rules.length} setups pooled · ${LN.n_train.toLocaleString()} trades to ${LN.split.slice(0, 4)}, ${LN.n_test.toLocaleString()} after`;
  renderStats("sw-l-strip", [
    { label: "Combined model, out of sample", value: b.oos.ic == null ? "–" : `IC ${b.oos.ic.toFixed(3)}`, tone: b.oos.t == null ? "" : b.oos.t >= 3 ? "up" : b.oos.t <= -3 ? "down" : "", delta: `t ${b.oos.t == null ? "–" : b.oos.t.toFixed(1)} over ${b.oos.weeks} weeks · top third − bottom third ${spct(b.oos.spread?.diff, 2)} (t ${b.oos.spread?.t == null ? "–" : b.oos.spread.t.toFixed(1)})` },
    { label: "Chart alone · story alone", value: `${t.oos.ic == null ? "–" : t.oos.ic.toFixed(3)} · ${f.oos.ic == null ? "–" : f.oos.ic.toFixed(3)}`, delta: `t ${t.oos.t == null ? "–" : t.oos.t.toFixed(1)} · t ${f.oos.t == null ? "–" : f.oos.t.toFixed(1)}` },
    { label: "What the story adds", value: add.mean == null ? "–" : `${add.mean >= 0 ? "+" : ""}${add.mean.toFixed(3)} IC`, tone: add.t == null ? "" : add.t >= 3 ? "up" : add.t <= -3 ? "down" : "", delta: `paired over ${add.weeks} weeks, t ${add.t == null ? "–" : add.t.toFixed(1)}` },
    { label: "In use", value: LN.use ? "yes" : "no", tone: LN.use ? "up" : "warn", delta: LN.use ? "orders candidates within a grade; a negative expectation is not traded" : "published as a diagnostic until the out-of-sample t clears 3" },
    { label: "Learned from the record", value: `${lv.n} trades`, delta: sc.ic != null ? `live IC ${sc.ic.toFixed(3)} (t ${sc.t == null ? "–" : sc.t.toFixed(1)}) · sign agreement ${fmtPct(sc.sign_agreement, 0)} · panel weight ${fmtPct(lv.prior_weight, 0)}` : `panel weight ${fmtPct(lv.prior_weight, 0)} · scored once five trades close` },
  ]);
  $("sw-l-note").textContent = LN.method.split("\n\n").slice(0, 1).join(" ");
  const tbl = $("sw-l-table"), chart = $("sw-l-chart").closest(".chart");
  chart.style.display = lMode === "history" ? "" : "none";
  if (lMode === "coef") {
    const rows = LN.coefficients.filter((c) => c.block !== "base").sort((a, b) => Math.abs(b.prior_t) - Math.abs(a.prior_t));
    renderTable(tbl, rows, [
      { key: "label", label: "Term" }, { key: "block", label: "Block", cls: () => "note" },
      { key: "prior", label: "Fitted β (per s.d.)", num: true, fmt: (v) => spct(v, 3) }, { key: "prior_t", label: "t", num: true, fmt: (v) => tcell(v) },
      { key: "live", label: "After the record", num: true, fmt: (v, r) => el("span", { class: Math.sign(v) !== Math.sign(r.prior) && Math.abs(v - r.prior) > 1e-5 ? "warn" : "", text: spct(v, 3) }) },
      { key: "live", label: "Moved", num: true, fmt: (v, r) => { const d = (lv.drift || []).find((x) => x.name === r.name); return d ? `${d.moved_se.toFixed(2)} s.e.` : "0.00 s.e."; } },
    ]);
    $("sw-l-foot").textContent = "β is the change in expected net return per one standard deviation of the term across the fitted trades, every other term held; " +
      "t is the posterior mean over its standard error. The base terms (intercept and one per setup) carry each setup's own mean and are not shown. " +
      `"After the record" is the posterior once the ${lv.n} closed live trades are folded in; "moved" is that shift in prior standard errors.`;
  } else if (lMode === "tests") {
    const rows = ["tech", "fund", "both"].map((k) => ({ model: { tech: "chart only", fund: "story only", both: "both" }[k], ...LN.models[k] }));
    renderTable(tbl, rows, [
      { key: "model", label: "Model" }, { key: "lam", label: "Shrinkage λ", num: true, fmt: (v) => v.toLocaleString() },
      { key: "ins", label: "In sample IC", num: true, fmt: (b) => el("span", {}, [el("span", { text: (b.ic == null ? "–" : b.ic.toFixed(3)) + " " }), el("span", { class: "note", text: "t " }), tcell(b.t)]) },
      { key: "oos", label: "Out of sample IC", num: true, fmt: (b) => el("span", {}, [el("span", { text: (b.ic == null ? "–" : b.ic.toFixed(3)) + " " }), el("span", { class: "note", text: "t " }), tcell(b.t)]) },
      { key: "oos", label: "Top third − bottom third", num: true, fmt: (b) => el("span", {}, [el("span", { text: spct(b.spread?.diff, 2) + " " }), el("span", { class: "note", text: "t " }), tcell(b.spread?.t)]) },
      { key: "oos", label: "Calibration slope", num: true, fmt: (b) => (b.calibration_slope == null ? "–" : b.calibration_slope.toFixed(2)) },
      { key: "oos", label: "Trades out", num: true, fmt: (b) => b.n.toLocaleString() },
    ]);
    $("sw-l-foot").textContent = "IC is the Spearman correlation of prediction and outcome within each entry week, averaged over weeks (its t over weeks). " +
      "The spread is the mean net return of the top third of predictions less the bottom third, weekly-averaged before the t. A calibration slope of 1 means a predicted " +
      "+1% was worth +1%. λ was chosen by leave-one-year-out cross-validation inside the fitted years. The paired test of both against chart only is the test of whether the story adds.";
  } else if (lMode === "rules") {
    const rows = Object.entries(LN.per_rule || {}).map(([k, v]) => ({ rule: k, ...v }));
    renderTable(tbl, rows, [
      { key: "rule", label: "Setup", fmt: ruleLabel },
      { key: "prior_mean", label: "Lab mean (prior)", num: true, fmt: (v, r) => `${spct(v, 2)} ± ${r.prior_se == null ? "–" : fmtPct(r.prior_se, 2)}` },
      { key: "live_n", label: "Live trades", num: true }, { key: "live_mean", label: "Live mean", num: true, fmt: (v) => spct(v, 2) },
      { key: "post_mean", label: "Posterior mean", num: true, fmt: (v, r) => (v == null ? "–" : `${spct(v, 2)} ± ${fmtPct(r.post_se, 2)}`) },
      { key: "p_positive", label: "P(mean > 0)", num: true, fmt: (v) => (v == null ? "–" : el("span", { class: v < 0.5 ? "down" : v > 0.95 ? "up" : "", text: fmtPct(v, 0) })) },
      { key: "paused", label: "Book", fmt: (v) => el("span", { class: `pill ${v ? "down" : "up"}`, text: v ? "paused" : "trading" }) },
    ]);
    $("sw-l-foot").textContent = "Each setup's mean trade as a normal posterior: the lab's out-of-sample mean and standard error as the prior, the closed live suggestions as the data " +
      "(the trade-level standard deviation from the lab). A setup is paused for the book once thirty live trades leave P(mean > 0) under a half; the weekly refit reconsiders it.";
  } else {
    const H = LN.history || [];
    renderTable(tbl, H.slice().reverse().slice(0, 60), [
      { key: "date", label: "Evening", fmt: fmtDate }, { key: "folded", label: "Trades folded", num: true }, { key: "n_live", label: "Live in all", num: true },
      { key: "ic", label: "Live IC", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(3)) }, { key: "ic_t", label: "t", num: true, fmt: (v) => tcell(v) },
      { key: "sign_agreement", label: "Sign agreement", num: true, fmt: (v) => fmtPct(v, 0) }, { key: "prior_weight", label: "Panel weight", num: true, fmt: (v) => fmtPct(v, 0) },
      { key: "drift", label: "Moved most", cls: () => "note wrap", fmt: (v) => (v || []).map((d) => `${LN.labels?.[d.name] || d.name} ${d.moved_se >= 0 ? "+" : ""}${d.moved_se.toFixed(2)} s.e.`).join(" · ") },
    ]);
    const pts = H.filter((h) => h.ic != null);
    if (pts.length >= 2) {
      const cfg = lineConfig({ labels: pts.map((h) => h.date), yFmt: (v) => v.toFixed(2), series: [{ label: "Live IC", data: pts.map((h) => h.ic), color: tok("--accent"), width: 2 }] });
      cfg.options.plugins.legend = { display: false };
      draw("sw-l-chart", cfg);
    } else { chart.style.display = "none"; }
    $("sw-l-foot").textContent = "One row per evening the model learned: how many closed suggestions were folded in, the running rank correlation of its live predictions with their " +
      "outcomes, the share whose sign it called, the weight the panel fit still carries, and the coefficients that moved most since the fit.";
  }
}

function rules() {
  const G = L.grades;
  const rows = Object.entries(G).map(([k, g]) => ({ key: k, ...g, tier_b: L.tier_b?.[k] }));
  rows.sort((a, b) => (["established", "replicated", "suggestive", "untested", "failed", "control"].indexOf(a.grade) - ["established", "replicated", "suggestive", "untested", "failed", "control"].indexOf(b.grade)) || ((b.oos_t || 0) - (a.oos_t || 0)));
  renderTable($("sw-rules"), rows, [
    { key: "key", label: "Setup", fmt: (v, r) => el("span", { title: r.hypothesis, text: ruleLabel(v) }) },
    { key: "direction", label: "Side", cls: () => "note" },
    { key: "family", label: "Family", cls: () => "note" },
    { key: "grade", label: "Grade", fmt: gradePill },
    { key: "basis", label: "Judged on", cls: () => "note", fmt: (v) => (v === "tier A" ? "panel with failures" : v === "tier B" ? "today's names" : v) },
    { key: "ins_mean", label: "In sample", num: true, fmt: (v, r) => el("span", {}, [el("span", { text: spct(v, 2) + " " }), el("span", { class: "note", text: "t " }), tcell(r.ins_t)]) },
    { key: "oos_mean", label: "Out of sample", num: true, fmt: (v, r) => el("span", {}, [el("span", { text: spct(v, 2) + " " }), el("span", { class: "note", text: "t " }), tcell(r.oos_t)]) },
    { key: "oos_n", label: "Trades out", num: true, fmt: (v) => (v == null ? "–" : v.toLocaleString()) },
    { key: "oos_25bp_mean", label: "At 25 bp", num: true, fmt: (v) => spct(v, 2) },
    { key: "tier_b", label: "With stops", cls: () => "note", fmt: (b) => (b && b.trades ? `${b.trades.toLocaleString()} trades · mean R ${b.mean_r == null ? "–" : b.mean_r.toFixed(2)} · stops ${fmtPct((b.exits?.stop || 0) / b.trades, 0)}` : "–") },
    { key: "literature", label: "Source", cls: () => "note wrap" },
  ]);
  $("sw-r-meta").textContent = `${rows.length} setups · FDR: ${L.fdr_passed} of ${L.tried} pass at ${(0.1 * 100).toFixed(0)}%`;
  $("sw-r-note").textContent = `Grades: established = out-of-sample t ≥ 3, the site's bar; replicated = in-sample t ≥ 3 and out-of-sample t ≥ 2, the bar the venture ` +
    `sleeve adopts on; suggestive = t ≥ 1.5; untested = under 30 trades out of sample; failed = no money out of sample. A grade from "today's names" ` +
    `can never be more than suggestive: that sample has no failures in it. Returns are per trade net of 10 bp a side, averaged by entry week before the t. ` +
    `Selection decay on the panel: the best in-sample rules averaged ${spct(L.decay_a?.in_mean, 2)} in and ${spct(L.decay_a?.out_mean, 2)} out.`;
}

function sizing() {
  const B = L.tier_b || {};
  const keys = Object.keys(B).filter((k) => B[k].sizing && B[k].sizing._inputs);
  if (!keys.length) { $("sw-s-note").textContent = "The sizing race needs the OHLC lab run."; return; }
  if (!sizeRule || !keys.includes(sizeRule)) sizeRule = keys.includes("reversal_3d_long") ? "reversal_3d_long" : keys[0];
  const seg = $("sw-s-rule"); seg.innerHTML = "";
  keys.forEach((k) => { const b = el("button", { text: ruleLabel(k), "aria-pressed": String(k === sizeRule) }); if (k === sizeRule) b.classList.add("active");
    b.addEventListener("click", () => { sizeRule = k; sizing(); }); seg.appendChild(b); });
  const z = B[sizeRule].sizing, inp = z._inputs;
  const rows = Object.entries(z).filter(([k]) => k !== "_inputs").map(([k, v]) => ({ policy: k.replace(/_/g, " "), ...v }));
  renderTable($("sw-sizing"), rows, [
    { key: "policy", label: "Policy" },
    { key: "mean_size", label: "Mean size", num: true, fmt: (v) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`) },
    { key: "annual_growth", label: "Growth a year", num: true, fmt: (v) => (v == null ? "–" : spct(v, 0)) },
    { key: "growth_per_trade", label: "Log growth / trade", num: true, fmt: (v) => (v == null ? "–" : (v * 100).toFixed(3) + "%") },
    { key: "max_drawdown", label: "Worst drawdown", num: true, fmt: (v) => fmtPct(v, 0) },
    { key: "longest_underwater_days", label: "Longest under water", num: true, fmt: (v) => `${v} days` },
  ]);
  $("sw-s-note").textContent = `${inp.n} out-of-sample trades of ${ruleLabel(sizeRule)}: hit ${fmtPct(inp.hit, 0)}, payoff ${inp.payoff == null ? "–" : inp.payoff.toFixed(2)}, ` +
    `full Kelly ${(inp.kelly_full * 100).toFixed(0)}% of equity (shrunk two standard errors), discrete Kelly ${inp.kelly_discrete == null ? "–" : (inp.kelly_discrete * 100).toFixed(0) + "%"}. ` +
    `Risk of losing half before doubling at half Kelly: ${inp.risk_of_ruin_half_kelly == null ? "–" : fmtPct(inp.risk_of_ruin_half_kelly, 1)}. ` +
    `Kelly maximises log growth and nothing else (Kelly 1956; Thorp 2006); half Kelly keeps three quarters of the growth at half the variance (MacLean, Thorp and Ziemba 2010). ` +
    `Replayed as a daily book: each entry takes its share of that day's equity, the book never exceeds 100% (a crowded day is scaled down pro rata), every policy is capped at a tenth of equity a trade and 5% risk. Today's names, so the inputs flatter.`;
}

let tRule = null;
function timingPanel() {
  const T = L.timing || {};
  const keys = Object.keys(T);
  if (!keys.length) { $("sw-t-note").textContent = "The timing test runs with the weekly lab."; return; }
  if (!tRule || !keys.includes(tRule)) tRule = keys[0];
  const seg = $("sw-t-rule"); seg.innerHTML = "";
  keys.forEach((k) => { const b = el("button", { text: ruleLabel(k), "aria-pressed": String(k === tRule) }); if (k === tRule) b.classList.add("active");
    b.addEventListener("click", () => { tRule = k; timingPanel(); }); seg.appendChild(b); });
  const V = T[tRule].variants;
  const rows = Object.entries(V).map(([k, v]) => ({ variant: PLAN_NAMES[k] || k, key: k, chosen: k === T[tRule].choice, ...v }));
  renderTable($("sw-timing"), rows, [
    { key: "variant", label: "Variant", fmt: (v, r) => el("span", { class: r.chosen ? "up" : "", text: v + (r.chosen ? " ✓" : "") }) },
    { key: "fill_rate", label: "Fills", num: true, fmt: (v) => fmtPct(v, 0) },
    { key: "ins", label: "In sample", num: true, fmt: (b) => el("span", {}, [el("span", { text: spct(b.mean, 2) + " " }), el("span", { class: "note", text: "t " }), tcell(b.t)]) },
    { key: "oos", label: "Out of sample", num: true, fmt: (b) => el("span", {}, [el("span", { text: spct(b.mean, 2) + " " }), el("span", { class: "note", text: "t " }), tcell(b.t)]) },
    { key: "trades", label: "Trades", num: true, fmt: (v) => v.toLocaleString() },
    { key: "exits", label: "Exits", cls: () => "note", fmt: (e) => `${e.stop} stop · ${e.target} target · ${e.time} time` },
  ]);
  $("sw-t-note").textContent = `Each variant is applied to every signal of ${ruleLabel(tRule)} on today's names with real ranges, judged before 2025 and tested on 2025 on, net of 10 bp. ` +
    `The book adopts a variant only when, out of sample, it fills at least half the signals and beats the next-open fill on both mean and t; today's choice: ${PLAN_NAMES[T[tRule].choice] || T[tRule].choice}. ` +
    `Waiting for confirmation costs the first day of the move; a limit misses the names that never come back. The test is what says whether the wait is worth it.`;
}

let I = null;
function ideasPanel() {
  if (!I) { $("sw-i-note").textContent = "The idea engine runs with the weekly lab."; return; }
  $("sw-i-meta").textContent = `${I.tried.toLocaleString()} rules tried · ${I.fdr_passed} pass the FDR · ${I.ideas.length} replicate`;
  const cov = I.extra_coverage || {};
  const bf = I.by_filter || {};
  const best = Object.entries(bf).sort((a, b) => (b[1].mean_oos_t || -9) - (a[1].mean_oos_t || -9)).slice(0, 6).map(([k, v]) => `${k.replace(/_/g, " ")} (mean out-of-sample t ${v.mean_oos_t == null ? "–" : v.mean_oos_t.toFixed(1)}, ${v.replicated} replicate)`);
  $("sw-i-note").textContent = I.method.split("\n\n")[0] + (best.length ? ` Filters that helped most across the grid: ${best.join("; ")}.` : "") +
    (Object.keys(cov).length ? ` Coverage of the extra data on the last day: ${Object.entries(cov).map(([k, v]) => `${k} ${fmtPct(v, 0)}`).join(", ")}.` : "");
  const rows = (I.ideas.length ? I.ideas : I.leaderboard.slice(0, 25)).map((r) => ({ ...r, ins_m: r.ins.mean, ins_t: r.ins.t, oos_m: r.oos.mean, oos_t: r.oos.t, n: r.oos.n }));
  renderTable($("sw-ideas"), rows, [
    { key: "rule", label: "Rule", fmt: (v) => v.replace(/\|/g, " · ").replace(/_/g, " ") },
    { key: "grade", label: "Grade", fmt: gradePill },
    { key: "ins_m", label: "In sample", num: true, fmt: (v, r) => el("span", {}, [el("span", { text: spct(v, 2) + " " }), el("span", { class: "note", text: "t " }), tcell(r.ins_t)]) },
    { key: "oos_m", label: "Out of sample", num: true, fmt: (v, r) => el("span", {}, [el("span", { text: spct(v, 2) + " " }), el("span", { class: "note", text: "t " }), tcell(r.oos_t)]) },
    { key: "n", label: "Trades out", num: true, fmt: (v) => (v == null ? "–" : v.toLocaleString()) },
    { key: "oos_25bp_mean", label: "At 25 bp", num: true, fmt: (v) => spct(v, 2) },
    { key: "fdr_pass", label: "FDR", cls: () => "note", fmt: (v) => (v ? "pass" : "–") },
  ]);
}

function formingPanel() {
  const rows = Q?.forming || [];
  $("sw-f-meta").textContent = Q ? `${rows.length} names · ${Q.stamp.replace("T", " ").slice(0, 16)}` : "no live data";
  renderTable($("sw-forming"), rows, [
    { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "price", label: "Live", num: true, fmt: (v) => v.toFixed(2) },
    { key: "r1", label: "Today", num: true, fmt: (v) => el("span", { class: v > 0 ? "up" : "down", text: spct(v, 1) }) },
    { key: "r3", label: "3 sessions", num: true, fmt: (v) => el("span", { class: v > 0 ? "up" : "down", text: spct(v, 1) }) },
    { key: "vs_hi20", label: "vs 20-day high", num: true, fmt: (v) => spct(v, 1) },
    { key: "flags", label: "Taking shape", cls: () => "note", fmt: (v) => v.join(" · ") },
  ]);
}

let P = null, pTopic = "all";
const VERDICT_TONE = { works: "up", works_with_caveats: "warn", fails: "down", untested_here: "muted" };
function papersPanel() {
  if (!P) { $("sw-p-note").textContent = "The literature survey has not been published yet."; return; }
  const topics = ["all", ...new Set(P.papers.map((p) => p.topic))];
  const seg = $("sw-p-topic"); seg.innerHTML = "";
  topics.forEach((t) => { const b = el("button", { text: t.replace(/_/g, " "), "aria-pressed": String(t === pTopic) }); if (t === pTopic) b.classList.add("active");
    b.addEventListener("click", () => { pTopic = t; papersPanel(); }); seg.appendChild(b); });
  const rows = P.papers.filter((p) => pTopic === "all" || p.topic === pTopic);
  renderTable($("sw-papers"), rows, [
    { key: "title", label: "Paper", cls: () => "wrap", fmt: (v, r) => el("span", {}, [r.url ? el("a", { href: r.url, target: "_blank", rel: "noopener", text: v }) : el("span", { text: v }), el("span", { class: "note", text: ` ${r.authors || ""} ${r.year || ""}` })]) },
    { key: "topic", label: "Topic", cls: () => "note", fmt: (v) => v.replace(/_/g, " ") },
    { key: "finding", label: "Finding", cls: () => "note wrap" },
    { key: "stat", label: "Strength", cls: () => "note" },
    { key: "holds_after_costs", label: "After costs", cls: () => "note" },
    { key: "verdict", label: "Verdict", fmt: (v) => el("span", { class: `pill ${VERDICT_TONE[v] || "muted"}`, text: (v || "").replace(/_/g, " ") }) },
    { key: "testable_rule", label: "Rule it implies", cls: () => "note wrap", fmt: (v) => v || "–" },
  ]);
  const S_ = P.summary || {};
  $("sw-p-meta").textContent = `${P.papers.length} papers · surveyed ${fmtDate(P.as_of)}`;
  $("sw-p-note").textContent = [S_.what_works?.length ? `Works: ${S_.what_works.join("; ")}.` : "", S_.what_fails?.length ? `Fails or unsupported: ${S_.what_fails.join("; ")}.` : "",
    S_.gaps?.length ? `Gaps: ${S_.gaps.join("; ")}.` : ""].filter(Boolean).join(" ");
}

function record() {
  if (!R) { $("sw-rec-note").textContent = "No record yet."; return; }
  const o = R.overall;
  renderStats("sw-rec-strip", [
    { label: "Suggestions", value: String(R.suggestions), delta: `${R.open} open · ${R.unfilled} unfilled · since ${R.started ? fmtDate(R.started) : "–"}` },
    { label: "Hit rate", value: o.n ? fmtPct(o.hit, 0) : "–", delta: o.n ? `${o.n} closed` : "" },
    { label: "Mean per trade", value: o.n ? spct(o.mean, 2) : "–", delta: o.n ? `R ${o.mean_r == null ? "–" : o.mean_r.toFixed(2)} · SPY same windows ${spct(o.spy_mean, 2)}` : "" },
    { label: "t", value: o.t == null ? "–" : o.t.toFixed(1), delta: R.trades_needed_for_t3 ? `about ${R.trades_needed_for_t3.toLocaleString()} trades for t 3 at this mean` : "needs more trades" },
  ]);
  if (R.curve.length > 1) {
    const cfg = lineConfig({ labels: R.curve.map((p) => p.date), yFmt: (v) => v.toFixed(1), series: [{ label: "Suggestions, equal weight, 100 at start", data: R.curve.map((p) => p.index), color: tok("--accent"), width: 2, fill: true }] });
    cfg.options.plugins.legend = { display: false };
    draw("sw-rec-chart", cfg);
  } else { $("sw-rec-chart").closest(".chart").style.display = "none"; }
  $("sw-rec-note").textContent = R.note;
  const rows = Object.entries(R.by_rule).map(([k, v]) => ({ rule: ruleLabel(k), ...v }));
  renderTable($("sw-rec-rules"), rows, [
    { key: "rule", label: "Setup" }, { key: "n", label: "Closed", num: true },
    { key: "hit", label: "Hit", num: true, fmt: (v) => fmtPct(v, 0) }, { key: "mean", label: "Mean", num: true, fmt: (v) => spct(v, 2) },
    { key: "mean_r", label: "R", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(2)) }, { key: "t", label: "t", num: true, fmt: tcell },
    { key: "exits", label: "Exits", cls: () => "note", fmt: (e) => `${e.stop} stop · ${e.target} target · ${e.time} time` },
  ]);
  renderTable($("sw-rec-trades"), R.recent, [
    { key: "signal_date", label: "Signal", fmt: (v) => fmtDate(v) }, { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "rule", label: "Setup", fmt: ruleLabel }, { key: "grade", label: "Grade", fmt: gradePill }, { key: "direction", label: "Side", cls: () => "note" },
    { key: "status", label: "Status", cls: () => "note" }, { key: "fill_date", label: "Filled", fmt: (v) => (v ? fmtDate(v) : "–") },
    { key: "exit_date", label: "Exit", fmt: (v, r) => (v ? `${fmtDate(v)} (${r.why})` : "–") },
    { key: "ret_net", label: "Return", num: true, fmt: (v) => el("span", { class: v == null ? "" : v > 0 ? "up" : "down", text: spct(v, 2) }) },
    { key: "r_mult", label: "R", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(2)) },
  ]);
  $("sw-rec-meta").textContent = `${R.closed} closed · ${R.open} open`;
}

function method() {
  const box = $("sw-method"); box.innerHTML = "";
  [S.method, L.method].forEach((t) => t && box.appendChild(el("p", { text: t })));
  [
    "Of the roughly 15,000 rule permutations this repo has tried, none cleared a 10% false-discovery bar on its own; one family, short-term reversal, replicated in every variant on fourteen years of small caps including the ones that failed. That is why most rows above read untested or failed.",
    "Costs: 10 bp a side is a liquid-name haircut and 25 bp is nearer the truth for a $5 name; shorts also pay to borrow, which is not modelled.",
    "Daily closes only: stops are checked against each day's high and low with the pessimistic order (stop first, gaps at the open). A stop hit at 10:30 is seen at the close.",
    "The regime gate uses today's stress probability, which the backtest cannot use historically; the lab gates on SPY's 200-day average instead.",
    "Earnings dates come from FMP and are sometimes late; the three-session flag is a warning, not a guarantee.",
    "A record needs months: at the reversal rule's mean, a t of 3 needs several hundred independent trades.",
  ].forEach((t) => box.appendChild(el("p", { text: t })));
}

let B = null, bMode = "positions";
const usd = (x, dp = 2) => (x == null ? "–" : (x < 0 ? "−" : "") + "$" + Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const susd = (x) => (x == null ? "–" : (x >= 0 ? "+" : "−") + "$" + Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function bookPanel() {
  if (!B) { $("sw-b-note").textContent = "The book has not stepped yet."; return; }
  const q = Q?.quotes || {};
  $("sw-b-meta").textContent = `since ${fmtDate(B.started)} · stepped ${fmtDate(B.days[B.days.length - 1].date)} · hedged with ${B.rules.hedge}`;
  renderStats("sw-b-strip", [
    { label: "NAV", value: usd(B.nav), tone: B.return_total > 0 ? "up" : B.return_total < 0 ? "down" : "", delta: `${spct(B.return_total, 2)} on ${usd(B.start_cash, 0)}` },
    { label: "Today", value: susd(B.pnl_today), tone: B.pnl_today > 0 ? "up" : B.pnl_today < 0 ? "down" : "", delta: `${B.days.length} sessions recorded` },
    { label: "Book", value: `${B.positions.filter((p) => p.rule !== "hedge").length} names`, delta: `long ${usd(B.gross_long, 0)} · short ${usd(B.gross_short, 0)} · cash ${usd(B.cash, 0)}` },
    { label: "Closed trades", value: String(B.stats.trades), delta: B.stats.trades ? `hit ${fmtPct(B.stats.hit, 0)} · mean ${spct(B.stats.mean_ret, 2)} · P&L ${susd(B.stats.pnl_closed)}` : `${B.orders.length} orders queued` },
    { label: "Worst drawdown", value: fmtPct(B.max_drawdown, 1), delta: B.sharpe == null ? "Sharpe needs more days" : `Sharpe ${B.sharpe.toFixed(2)}` },
  ]);
  if (B.days.length > 1) {
    const cfg = lineConfig({ labels: B.days.map((d) => d.date), yFmt: (v) => usd(v, 0), series: [{ label: "NAV", data: B.days.map((d) => d.nav), color: tok("--accent"), width: 2, fill: true }] });
    cfg.options.plugins.legend = { display: false };
    draw("sw-b-chart", cfg);
  } else { $("sw-b-chart").closest(".chart").style.display = "none"; }
  $("sw-b-note").textContent = `Paper money: ${B.rules.max_positions} positions at most, a tenth of NAV each, ${B.rules.cost_bp} bp a side on every fill, only setups graded ${B.rules.grades.join(" or ")}, ` +
    `the long book hedged with a short in ${B.rules.hedge} so the return is the setups' over the market. Fills are the next session's real open; nothing is sent to a broker.`;
  if (bMode === "positions") {
    const rows = B.positions.map((p) => ({ ...p, live: q[p.symbol]?.price }));
    renderTable($("sw-b-table"), rows, [
      { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v }) }, { key: "rule", label: "Setup", fmt: ruleLabel }, { key: "side", label: "Side", cls: () => "note" },
      { key: "qty", label: "Shares", num: true }, { key: "fill_px", label: "Filled at", num: true, fmt: (v) => v.toFixed(2) }, { key: "fill_date", label: "On", fmt: fmtDate },
      { key: "last", label: "Last close", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(2)) }, { key: "live", label: "Live", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(2)) },
      { key: "stop", label: "Stop", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(2)) }, { key: "target", label: "Target", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(2)) },
      { key: "sessions", label: "Held", num: true, fmt: (v, r) => (r.rule === "hedge" ? "–" : `${v} of ${r.hold}`) },
      { key: "pnl", label: "P&L", num: true, fmt: (v) => el("span", { class: v > 0 ? "up" : v < 0 ? "down" : "", text: susd(v) }) },
    ]);
  } else if (bMode === "orders") {
    renderTable($("sw-b-table"), B.orders, [
      { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v }) }, { key: "rule", label: "Setup", fmt: ruleLabel }, { key: "grade", label: "Grade", fmt: gradePill },
      { key: "side", label: "Side", cls: () => "note" }, { key: "notional", label: "Size", num: true, fmt: (v) => usd(v, 0) }, { key: "hold", label: "Hold", num: true, fmt: (v) => `${v}d` },
      { key: "signal_date", label: "Signal", fmt: fmtDate }, { key: "mu", label: "Model", num: true, fmt: (v) => spct(v, 2) },
      { key: "story", label: "The story", cls: () => "note wrap sw-why", fmt: (v) => (v ? v.split(". ").slice(0, 3).join(". ") + (v.split(". ").length > 3 ? "…" : "") : "") },
    ]);
  } else {
    renderTable($("sw-b-table"), B.closed, [
      { key: "exit_date", label: "Closed", fmt: fmtDate }, { key: "symbol", label: "Stock", fmt: (v) => el("span", { class: "sym", text: v }) }, { key: "rule", label: "Setup", fmt: ruleLabel },
      { key: "side", label: "Side", cls: () => "note" }, { key: "qty", label: "Shares", num: true }, { key: "fill_px", label: "In", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(2)) },
      { key: "exit_px", label: "Out", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(2)) }, { key: "why", label: "Why", cls: () => "note" },
      { key: "ret", label: "Return", num: true, fmt: (v) => el("span", { class: v > 0 ? "up" : v < 0 ? "down" : "", text: spct(v, 2) }) },
      { key: "pnl", label: "P&L", num: true, fmt: (v) => el("span", { class: v > 0 ? "up" : v < 0 ? "down" : "", text: susd(v) }) },
    ]);
  }
}

async function live() {
  try { Q = await loadJSON("data/swing_live.json"); } catch { Q = null; }
  if (Q && Q.as_of_scan === S.as_of) { entries(); bookPanel(); }
  formingPanel();
}

function wire() {
  const seg = (id, set) => $(id).querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b)); set(b.dataset.k); }));
  seg("sw-e-side", (k) => { side = k; entries(); storiesPanel(); });
  seg("sw-e-grade", (k) => { gradeMode = k; entries(); });
  seg("sw-b-mode", (k) => { bMode = k; bookPanel(); });
  seg("sw-l-mode", (k) => { lMode = k; learnPanel(); });
}

(async function init() {
  renderShell();
  try { S = await loadJSON("data/swing.json"); } catch (err) { showError($("error"), err); return; }
  try { L = await loadJSON("data/swing_lab.json"); } catch { L = { grades: {}, tier_b: {}, tried: 0, fdr_passed: 0 }; }
  try { R = await loadJSON("data/swing_record.json"); } catch { R = null; }
  try { B = await loadJSON("data/swing_book.json"); } catch { B = null; }
  try { I = await loadJSON("data/swing_ideas.json"); } catch { I = null; }
  try { P = await loadJSON("data/swing_papers.json"); } catch { P = null; }
  try { LN = await loadJSON("data/swing_learn.json"); } catch { LN = null; }
  setAsOf(S.as_of);
  strip(); bookPanel(); entries(); storiesPanel(); learnPanel(); formingPanel(); timingPanel(); ideasPanel(); rules(); sizing(); record(); papersPanel(); method(); wire();
  live(); setInterval(live, 60_000);
  onThemeChange(() => { applyChartDefaults(); record(); bookPanel(); learnPanel(); });
})();
