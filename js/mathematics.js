/* The mathematics page.

   Equations are in the HTML; every parameter in them is filled from the
   published run and from data/mathematics.json, which run_monthly writes
   straight out of config.py and policy.py — so a constant here is the
   constant the code used, not one typed into a page. KaTeX renders after the
   values are in place. If KaTeX fails to load the TeX source stays readable. */

import { loadJSON, showError, fmtPct, fmtNum, el, renderStats, renderTable, signed } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

/* A live value goes two places: into a prose slot if one exists, and into
   the map the TeX substitution reads. An equation must stay ONE text node for
   KaTeX's auto-render to find its delimiters, so a value cannot be an element
   inside it — it is spliced into the TeX source as text instead. */
const VALUES = {};
const set = (id, text) => {
  if (text == null) return;
  VALUES[id] = String(text);
  const n = document.getElementById(id); if (n) n.textContent = text;
};

function substituteTex(root) {
  // The page checker's DOM stub has no tree walker; the substitution is only
  // meaningful where KaTeX will run, so skip it there rather than throw.
  if (typeof document.createTreeWalker !== "function" || typeof NodeFilter === "undefined") return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pat = /⟪(m-[a-z0-9-]+)\|([^⟫]*)⟫/g;
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.includes("⟪")) nodes.push(walker.currentNode);
  // A percent sign opens a comment in TeX: "12.5%" inside \text{} swallowed the
  // rest of the optimizer's constraint block and rendered it as an error.
  const tex = (v) => String(v).replace(/%/g, "\\%");
  for (const n of nodes) n.nodeValue = n.nodeValue.replace(pat, (_, id, dflt) => tex(VALUES[id] ?? dflt));
}
const pct = (x, dp = 1) => (x == null ? "—" : fmtPct(x, dp));
const num = (x, dp = 2) => (x == null || !isFinite(x) ? "—" : fmtNum(x, dp));

function typeset() {
  const main = document.getElementById("main");
  substituteTex(main);
  if (typeof window.renderMathInElement !== "function") return false;
  window.renderMathInElement(main, {
    delimiters: [
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
    ],
    throwOnError: false,
    trust: (ctx) => ctx.command === "\\text",
    strict: "ignore",
  });
  return true;
}

function momentum(M) {
  const tbl = document.getElementById("mom-table");
  if (!M) {
    set("mom-scope", "not yet measured");
    set("mom-verdict", "The panel test has not been run. Its output lands here as data/momentum.json.");
    return;
  }
  const P = M.panel || {};
  set("mom-scope", `${P.months} months · ${Math.round(P.names_per_month)} names a month · ${P.since} → ${P.until}`);
  const rows = (M.variants || []).map((r) => ({
    key: r.key, label: r.label, months: r.months,
    ic1: r.ic?.["1"]?.ic, t1: r.ic?.["1"]?.t, ic3: r.ic?.["3"]?.ic, ic12: r.ic?.["12"]?.ic,
    fm: r.fm_t, ls: r.long_short_1m, lst: r.long_short_t, lo: r.top_vs_universe_1m, lot: r.top_vs_universe_t,
    verdict: r.verdict, control: r.key === "REV_1M",
  }));
  const tone = (t) => (t == null ? "" : Math.abs(t) >= (M.bar || 3) ? (t > 0 ? "up" : "down") : "");
  renderTable(tbl, rows, [
    { key: "label", label: "Variant", fmt: (v, r) => el("span", { class: r.control ? "muted" : "", text: v }) },
    { key: "months", label: "Months", num: true },
    { key: "ic1", label: "IC, 1m", num: true, fmt: (v) => num(v, 3) },
    { key: "t1", label: "t", num: true, cls: (r) => tone(r.t1), fmt: (v) => signed(v, 2) },
    { key: "ic3", label: "IC, 3m", num: true, fmt: (v) => num(v, 3) },
    { key: "ic12", label: "IC, 12m", num: true, fmt: (v) => num(v, 3) },
    { key: "fm", label: "Fama–MacBeth t", num: true, cls: (r) => tone(r.fm), fmt: (v) => signed(v, 2) },
    { key: "lo", label: "Top decile − universe, 1m", num: true, fmt: (v) => (v == null ? "—" : signed(v * 100, 2) + "%") },
    { key: "lot", label: "t", num: true, cls: (r) => tone(r.lot), fmt: (v) => signed(v, 2) },
    { key: "verdict", label: "Verdict", fmt: (v) => el("span", { class: `pill ${v === "established" ? "up" : v === "suggestive" ? "suggestive" : "muted"}`, text: v }) },
  ], { sortKey: "t1", dir: -1 });

  const est = M.established || [];
  const b = M.bear_conditioning, v = M.value_interaction;
  const parts = [];
  parts.push(est.length
    ? `Established at |t| ≥ ${M.bar}: ${est.join(", ")}.`
    : `No variant clears |t| ≥ ${M.bar} on this panel; the best by one-month IC is ${M.winner || "—"}.`);
  if (b?.bear && b?.calm) parts.push(`Daniel–Moskowitz conditioning: the 12-1 IC is ${num(b.bear.ic, 3)} in bear-market months (t ${signed(b.bear.t, 2)}, n ${b.bear.months}) against ${num(b.calm.ic, 3)} otherwise (t ${signed(b.calm.t, 2)}, n ${b.calm.months}).`);
  if (v?.difference) parts.push(`Value × momentum: value's IC among past winners ${num(v.value_in_high_momentum.ic, 3)} against ${num(v.value_in_low_momentum.ic, 3)} among past losers; the difference has t ${signed(v.difference.t, 2)}.`);
  if (M.umd_2012_on != null) parts.push(`For context, the French momentum factor itself has returned ${signed(M.umd_2012_on * 100, 1)}% a year since 2012 — a weak era for the effect everywhere.`);
  set("mom-verdict", parts.join(" "));
  const H = M.high_split;
  if (H) set("mom-split", `Where the 52-week-high ranking lives: IC ${num(H.ic_bottom_half.value, 3)} (t ${signed(H.ic_bottom_half.t, 2)}) within the half of names far from their highs, ${num(H.ic_top_half.value, 3)} (t ${signed(H.ic_top_half.t, 2)}) within the half near them. The information is on the side a long-only book cannot sell — George and Hwang's own result, where the loser effect is three to four times the winner effect — so it is a screen at most, and the top half's ${signed(H.top_vs_universe_1m.value * 100, 2)}% a month over the universe (t ${signed(H.top_vs_universe_1m.t, 2)}) is not a spread. The value × momentum result above is Asness (1997) replicated: value works best among past losers, so gating value on momentum would discard value's best cell; the literature's route is to combine the two, which this panel does not license at a momentum t near 2.`);
  const I = M.integration || {};
  set("mom-integration", I.decision === "pending" ? "Pending the test above." : `${I.decision} ${I.reason || ""}`.trim());
  set("mom-caveat", `${P.scope || ""} ${M.prior_results_note || ""}`.trim());
}

(async function init() {
  renderShell();
  const s = await Promise.allSettled([
    loadJSON("data/portfolio.json"), loadJSON("data/risk.json"), loadJSON("data/regime.json"),
    loadJSON("data/signals.json"), loadJSON("data/mathematics.json"), loadJSON("data/momentum.json"),
  ]);
  const v = (i) => (s[i].status === "fulfilled" ? s[i].value : null);
  const PORT = v(0), RISK = v(1), REG = v(2), SIG = v(3), C = v(4) || {}, MOM = v(5);
  if (!PORT) showError(document.getElementById("error"), new Error("no published run to read parameters from"));

  setAsOf(PORT?.as_of || "—");
  set("math-meta", `Parameters read from the run of ${PORT?.as_of || "—"}` + (C.as_of ? ` · constants published ${C.as_of}` : ""));
  const er = PORT?.expected_returns || {};
  const band = PORT?.vol_target_band;

  renderStats("math-live", [
    { label: "View source", value: C.view_source || "—", delta: "what feeds Black-Litterman" },
    { label: "Risk aversion λ", value: num(er.risk_aversion, 2), delta: er.universe_beta != null ? `β ${num(er.universe_beta, 2)} × ERP ${pct(er.erp_forward ?? C.erp_forward, 1)}` : "" },
    { label: "τ · confidence", value: `${C.bl_tau ?? er.tau ?? "0.05"} · ${C.bl_view_confidence ?? "0.50"}`, delta: `${er.n_views ?? "—"} views` },
    { label: "Vol band", value: band ? band.map((x) => pct(x, 0)).join("–") : "—", delta: PORT ? `model ${pct(PORT.model_vol)} · ${PORT.vol_band_used || ""}` : "" },
    { label: "EWMA λ", value: String(C.ewma_lambda ?? RISK?.vol_forecast?.ewma_lambda ?? "0.94"), delta: C.vol_forecast_method ? `method ${C.vol_forecast_method}` : "" },
    { label: "Signal weighting", value: SIG?.weighting?.startsWith("ic") ? "IC-driven" : "static", delta: SIG?.snapshot_counts ? `${Math.min(...Object.values(SIG.snapshot_counts))} of ${C.min_ic_snapshots ?? 6} snapshots` : "" },
  ]);

  // §1 signals
  const W = SIG?.weights || C.signal_weights || {};
  set("m-w-value", num(W.value, 2)); set("m-w-quality", num(W.quality, 2));
  set("m-w-mom", num(W.momentum, 2)); set("m-w-short", num(W.short_interest, 2));
  set("m-view-source", C.view_source || "dcf");
  set("sig-status", C.view_source === "dcf" ? "computed and published · not in the live path" : `in the live path via view source ${C.view_source}`);
  set("m-min-snaps", String(C.min_ic_snapshots ?? 6));
  set("m-ic-assumed", String(C.signal_ic ?? 0.05));
  set("m-weighting", SIG?.weighting || "—");
  const icv = (k) => (SIG?.[k]?.ic != null ? num(SIG[k].ic, 3) : "—");
  set("m-ic-mom", icv("momentum")); set("m-ic-value", icv("value")); set("m-ic-quality", icv("quality")); set("m-ic-short", icv("short_interest"));
  if (SIG?.snapshot_counts) set("m-ic-n", Object.entries(SIG.snapshot_counts).map(([k, n]) => `${k} ${n}`).join(", "));

  // §2 momentum
  momentum(MOM);

  // §3–5 prior and views
  if (er.risk_aversion != null) set("m-lambda", num(er.risk_aversion, 2));
  if (er.universe_beta != null) set("m-beta-u", num(er.universe_beta, 2));
  set("m-erp", pct(er.erp_forward ?? C.erp_forward, 1));
  set("m-floor", String(C.view_uncertainty_floor ?? 0.03));
  set("m-conf", num(C.bl_view_confidence ?? 0.5, 2)); set("m-tau", String(C.bl_tau ?? er.tau ?? 0.05));
  if (er.n_views != null) set("m-n-views", String(er.n_views));
  if (er.prior_posterior_corr != null) set("m-corr", num(er.prior_posterior_corr, 2));

  // §6–7 covariance and vol
  set("m-lookback", String(C.risk_lookback ?? 252)); set("m-k", String(C.n_factors ?? 3));
  const cx = RISK?.complexity || {};
  if (cx.shrinkage_intensity != null) set("m-delta", num(cx.shrinkage_intensity, 3));
  else if (cx.lw_shrinkage != null) set("m-delta", num(cx.lw_shrinkage, 3));
  const eq = RISK?.eq_weight_vol || {};
  if (eq.pca != null) set("m-eqw-pca", pct(eq.pca)); if (eq.lw != null) set("m-eqw-lw", pct(eq.lw));
  set("m-ewma-lambda", String(C.ewma_lambda ?? RISK?.vol_forecast?.ewma_lambda ?? 0.94));
  set("m-vol-method", `method in force: ${C.vol_forecast_method || RISK?.vol_forecast?.method || "ewma"}`);

  // §8 optimizer
  set("m-name-cap", pct(C.name_cap ?? PORT?.max_weight, 1)); set("m-min-pos", String(C.min_positions ?? PORT?.constraints?.min_positions ?? 8));
  set("m-prune", pct(C.prune_threshold ?? 0.02, 0)); set("m-gamma", C.tc_gamma_effective != null ? String(C.tc_gamma_effective) : "0.0002");
  const caps = C.cluster_caps || PORT?.cluster_caps || {};
  set("m-cluster-caps", Object.entries(caps).map(([k, c]) => `${k.replace("_", " ")} ${pct(c, 0)}`).join(" · ") || "—");
  if (PORT?.model_vol != null) set("m-model-vol", pct(PORT.model_vol));
  if (band) set("m-band", band.map((x) => pct(x, 0)).join("–"));

  // §9–10 trading and regime
  set("m-vol-max", pct(C.vol_max ?? 0.22, 0)); set("m-cadence", String(C.rebalance_min_days ?? 80));
  set("m-band-abs", String(C.band_absolute ?? 0.02)); set("m-band-rel", String(C.band_relative ?? 0.25));
  set("m-ce-floor", String(C.ce_trigger_floor_bp ?? 25)); set("m-spread-bp", String(C.spread_bps ?? 8)); set("m-adjust", String(C.adjust_fraction ?? 0.30));
  const bs = C.vol_band_stressed, bc = C.vol_band;
  if (bs) set("m-band-stress", bs.map((x) => pct(x, 0)).join("–")); if (bc) set("m-band-calm", bc.map((x) => pct(x, 0)).join("–"));
  const p = REG?.stress?.prob ?? PORT?.p_stressed;
  if (p != null) { set("m-p-stress", pct(p, 1)); set("m-band-used", p >= (C.stress_prob_trigger ?? 0.5) ? "stressed" : "calm"); }

  typeset();
})();
