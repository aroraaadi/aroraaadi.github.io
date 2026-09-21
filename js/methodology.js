/* The methodology page.

   The prose is in the HTML; every number in it is filled from the published
   run so the description cannot drift away from the system it describes. If a
   file is missing the slot keeps its placeholder rather than rendering NaN. */

import { loadJSON, showError, fmtPct, fmtNum, el, renderStats, renderTable } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const set = (id, text) => { const n = document.getElementById(id); if (n && text != null) n.textContent = text; };

/* Each row names a claim the system declines to make, and where that refusal
   is written down. These are not caveats bolted on at the end — most of them
   are the reason some piece of the code is shaped the way it is. */
const LIMITS = [
  { what: "No signal backtest", detail: "There is no point-in-time history of P/E, ROIC or short interest for this universe, so the signals cannot be scored before the live record starts. The performance chart is the live record only; there is no shaded 'hypothetical' segment, because the honest alternative — today's weights run backwards — is fitted on the window it would be measured over.", where: "quant/backtest.py" },
  { what: "The live record is very short", detail: "A few dozen sessions. No annualised figure is shown from it, because annualising two months of noise produces a number that looks like information.", where: "docs/js/main.js" },
  { what: "The earnings screen failed its own test", detail: "Point-in-time, on 55 survivor names over three years, the trailing earnings-yield component had a rank IC of about −0.09 at three months. It was demoted from a gate to a diagnostic: a screen that has been tested and failed should not outrank one that has not been tested at all.", where: "valuation/backtest_screen.py" },
  { what: "That test has survivorship bias", detail: "The universe it runs on is today's names. The level of any spread it reports should be ignored in favour of the sign and the stability.", where: "valuation/backtest_screen.py" },
  { what: "The narrative regimes are not a forecast", detail: "Layer B is a hand-written score sheet with no track record. It is a consistent way to read conditions and nothing more; every action it drives is capped at low confidence in code.", where: "valuation/regime_detect.py" },
  { what: "The stress model is not point-in-time", detail: "Its probability is filtered — each date uses only data up to that date — but its parameters are fitted on the full sample. That is defensible for a live reading and wrong for a backtest; any backtest of this signal must refit on an expanding window.", where: "valuation/regime_detect.py" },
  { what: "The options backtest is synthetic", detail: "No option prices are stored, so every contract is priced off the VIX term structure with a fixed skew. Real skew steepens in a crash, so it understates the payoff; it can say nothing about fills, liquidity, early exercise or gaps.", where: "options/backtest.py" },
  { what: "The information coefficient is assumed", detail: "The Grinold alpha scaling uses an IC of 0.05 because a genuinely good equity signal runs 0.03–0.08. It is an assumption until enough signal snapshots exist to measure it.", where: "quant/config.py" },
  { what: "The transaction-cost model is not calibrated", detail: "It is proportional to traded value, while the real dominant cost at this size is a fixed per-ticket commission — so cost actually scales with the number of positions, not the value traded. That inverts the intuition a proportional coefficient encodes.", where: "quant/config.py" },
  { what: "Risk analytics on the held books are hypothetical", detail: "They apply today's weights over the past three years. Weights changed over that window; this is the risk of what is held now, not the risk that was taken.", where: "compute_metrics.py" },
  { what: "The optimizer treats the posterior as certain", detail: "Black-Litterman fixes where expected returns sit, but the optimizer still takes them at face value. A robustness layer that would stop that is the biggest piece not built.", where: "docs/ADDENDUM_STATUS.md" },
  { what: "One expected-return number is asserted", detail: "The forward equity risk premium is a config constant, not an estimate. Everything downstream of the equilibrium prior inherits it.", where: "quant/config.py" },
];

const PAPERS = [
  { work: "He & Litterman (1999); Idzorek (2005)", use: "The posterior that blends views with the equilibrium prior, and the confidence rescaling that stops the views overwhelming it.", where: "3" },
  { work: "Chopra & Ziemba (1993)", use: "Why the expected-return stack gets the structure and the covariance gets shrinkage: errors in means cost roughly ten times what errors in covariance cost.", where: "3, 4" },
  { work: "Ledoit & Wolf (2004)", use: "Constant-correlation shrinkage, run every time as a cross-check on the factor model.", where: "4" },
  { work: "Koller et al., Valuation", use: "The value-driver terminal that makes growth cost capital.", where: "3" },
  { work: "Pastor, Sinha & Swaminathan (2008); Lee, So & Wang (2021)", use: "The implied cost of capital as an expected-return proxy — and how much data it takes to show one predicts.", where: "3, 10" },
  { work: "Burns, Engle & Mezrich (1998)", use: "Why the research covariance is weekly: non-synchronous closes bias daily correlations toward zero.", where: "4" },
  { work: "Moreira & Muir (2017)", use: "Volatility-managed exposure — the stress-scaled vol band. The strongest result behind any regime action here, and applied in one direction only.", where: "5, 7" },
  { work: "Hamilton (1989); Kritzman, Page & Turkington (2012)", use: "The two-state Markov-switching stress model, and the case for two states rather than five.", where: "7" },
  { work: "Kritzman & Li (2010); Kritzman, Li, Page & Rigobon (2011)", use: "Turbulence and the absorption ratio, two of the conditions the score sheet reads.", where: "7" },
  { work: "Gârleanu & Pedersen (2013)", use: "Moving part of the way to the target rather than all of it, when the target is noisy.", where: "6" },
  { work: "Michaud (1989)", use: "The error-maximisation argument, and the resampling measurement that sizes the rebalance bands.", where: "6" },
  { work: "Meucci (2009)", use: "The effective number of bets — diversification measured in risk rather than in weights.", where: "9" },
  { work: "Israelov & Nielsen (2015)", use: "That a persistent long-put program has negative expected return. The reason the overlay is conditional, budgeted, and honest about its coverage.", where: "8" },
  { work: "Bichuch & Sturm (2014)", use: "Why a return-maximising objective needs a concave constraint to be well-posed.", where: "5" },
  { work: "Haddad, Kozak & Santosh (2020), read beside Asness", use: "Why the nowcast drives risk first and expected returns only weakly.", where: "7" },
];

(async function init() {
  renderShell();
  const s = await Promise.allSettled([
    loadJSON("data/portfolio.json"), loadJSON("data/risk.json"),
    loadJSON("data/regime.json"), loadJSON("data/current_portfolio.json"),
    loadJSON("data/performance.json"), loadJSON("data/options.json"),
  ]);
  const v = (i) => (s[i].status === "fulfilled" ? s[i].value : null);
  const PORT = v(0), RISK = v(1), REG = v(2), PF = v(3), PERF = v(4), OPT = v(5);

  if (!PORT && !PF) {
    showError(document.getElementById("error"), new Error("no published run to read parameters from"));
  }
  setAsOf(PORT?.as_of || PF?.as_of || "—");
  set("meth-meta", `Parameters read from the run of ${PORT?.as_of || "—"} · book synced ${PF?.as_of || "—"}`);

  const er = PORT?.expected_returns || {};
  const band = PORT?.vol_target_band;
  const stress = REG?.stress || {};
  const live = PERF?.stats?.portfolio_live;

  renderStats("meth-live", [
    { label: "Traded universe", value: "30 names", delta: "20 more valued for research" },
    { label: "Target book", value: PORT ? `${PORT.n_positions} positions` : "—",
      delta: PORT ? `vol ${fmtPct(PORT.model_vol)} in a ${band.map((x) => fmtPct(x, 0)).join("–")} band` : "" },
    { label: "Risk aversion", value: fmtNum(er.risk_aversion, 2),
      delta: er.erp_forward != null ? `ERP ${fmtPct(er.erp_forward, 1)} × beta ${fmtNum(er.universe_beta, 2)}` : "" },
    { label: "Views", value: er.n_views != null ? String(er.n_views) : "—",
      delta: `confidence 0.50 · prior/posterior ${fmtNum(er.prior_posterior_corr, 2)}` },
    { label: "P(stressed)", value: fmtPct(stress.prob, 1),
      delta: stress.prob >= 0.5 ? "stressed band in force" : "calm band in force" },
    { label: "Live record", value: live ? `${live.n_obs} sessions` : "—",
      delta: live ? `from ${live.start}` : "not started" },
  ]);

  set("n-trade", "30"); set("n-watch", "5"); set("n-research", "20");
  set("min-hist", "252 bars");
  if (er.risk_aversion != null) set("risk-aversion", fmtNum(er.risk_aversion, 2));
  if (er.erp_forward != null) set("erp", fmtPct(er.erp_forward, 1));
  set("bl-conf", "0.50"); set("tau", er.tau != null ? String(er.tau) : "0.05");
  set("lambda", RISK?.vol_forecast?.ewma_lambda != null ? String(RISK.vol_forecast.ewma_lambda) : "0.94");
  set("prune", "2%"); set("min-pos", String(PORT?.constraints?.min_positions ?? 8));
  if (PORT?.max_weight != null) set("name-cap", fmtPct(PORT.max_weight, 1));
  const aiCap = PORT?.cluster_caps?.ai_complex;
  if (aiCap != null) set("ai-cap", fmtPct(aiCap, 0));
  if (band) set("band", band.map((x) => fmtPct(x, 0)).join("–"));
  set("band-stress", "12–15%"); set("stress-trigger", "50%");
  set("cadence", "80 days"); set("band-abs", "2pp"); set("band-rel", "25%");
  set("ce-floor", "25bp"); set("adjust", "30%");
  if (stress.vol_calm_weekly != null) set("vol-calm", `${fmtPct(stress.vol_calm_weekly, 1)}/week`);
  if (stress.vol_stress_weekly != null) set("vol-stress", `${fmtPct(stress.vol_stress_weekly, 1)}/week`);
  if (stress.prob != null) set("p-stress", fmtPct(stress.prob, 1));
  if (OPT?.beta?.target != null) set("hedge-beta", fmtNum(OPT.beta.target, 2));
  if (OPT?.budget?.cap_bp_yr != null) set("hedge-budget", `${fmtNum(OPT.budget.cap_bp_yr, 0)}bp`);
  const cov = OPT?.backtest_summary?.summary?.policy?.coverage;
  if (cov != null) set("hedge-funded", fmtPct(cov, 0));
  const cad = PF?.books?.cad;
  if (cad) set("cad-n", String(cad.n_positions));

  renderTable(document.getElementById("limits-table"), LIMITS, [
    { key: "what", label: "Not claimed", fmt: (x) => el("span", { style: "font-weight:600", text: x }) },
    { key: "detail", label: "Why", cls: () => "wrap" },
    { key: "where", label: "Written down in", fmt: (x) => el("span", { class: "mono note", text: x }) },
  ]);
  renderTable(document.getElementById("papers-table"), PAPERS, [
    { key: "work", label: "Work" },
    { key: "use", label: "What it is used for here", cls: () => "wrap" },
    { key: "where", label: "§", fmt: (x) => el("span", { class: "pill", text: x }) },
  ]);
})();
