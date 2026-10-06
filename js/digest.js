/* This week: the digest weekly_digest.py builds every Monday from what the
   daily pipeline published. Nothing here is computed in the browser. */

import { loadJSON, showError, el, fmtDate, renderStats, tone, signedPct, money } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const $ = (id) => document.getElementById(id);
const pts = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)} pts`;
const item = (text, note) => el("li", {}, [el("span", { text }), note ? el("span", { class: "note", text: note }) : null]);

function movers(M) {
  const host = $("dg-movers"); host.innerHTML = "";
  const rows = [...M.best, ...M.worst];
  const max = Math.max(...rows.map((r) => Math.abs(r.contribution)), 1e-9);
  for (const r of rows) {
    host.appendChild(el("div", { class: "pf-d" }, [
      el("span", { class: "sym", text: r.ticker }),
      el("span", { class: "pf-bar" }, [el("i", { class: r.contribution >= 0 ? "up" : "down",
        style: `width:${(Math.abs(r.contribution) / max) * 50}%;${r.contribution >= 0 ? "left:50%" : "right:50%"}` })]),
      el("span", { class: `pf-c ${tone(r.contribution)}`, text: pts(r.contribution) }),
    ]));
  }
  $("dg-movers-note").textContent = "Each holding's weight at the previous close times its return that day, summed over the week; points of the portfolio.";
}

function models(md) {
  const host = $("dg-models"); host.innerHTML = "";
  const tc = md.target_changes;
  host.appendChild(tc
    ? item(`The engine's target moved ${(tc.one_way * 100).toFixed(1)}% one way since ${fmtDate(tc.since)}.`,
           tc.rows.map((r) => `${r.ticker} ${signedPct(r.change, 1)}`).join(", ") || "No name moved half a point.")
    : item("The target book is recorded from this week; changes appear in next week's digest."));
  const v = md.view_changes;
  if (v) host.appendChild(item(`The DCF views that moved most since ${fmtDate(v.since)}:`,
    v.rows.slice(0, 6).map((r) => `${r.ticker} ${r.change >= 0 ? "+" : "−"}${Math.abs(r.change * 100).toFixed(1)} pts`).join(", ")));
  const d = md.decision || {};
  host.appendChild(item(d.trade ? "The rebalance rule says trade." : "The rebalance rule says hold.",
    (d.blocked_by || d.reasons || []).join("; ")));
  if (md.view_share != null) host.appendChild(item(`${Math.round(md.view_share * 100)}% of the average name's expected return comes from its DCF view; the rest is the market prior.`));
  const sc = md.scorecard || {}, first = (sc.by_horizon || []).find((h) => h.independent > 0);
  host.appendChild(item(first
    ? `Scorecard: at ${first.horizon_days} days, mean rank IC ${first.mean_rank_ic >= 0 ? "+" : "−"}${Math.abs(first.mean_rank_ic).toFixed(2)} on ${first.independent} independent run(s).`
    : `Scorecard: ${sc.archived || 0} runs archived since ${sc.first ? fmtDate(sc.first) : "–"}; the first 30-day reading is not due yet.`,
    "Established only at |t| ≥ 3 on non-overlapping runs."));
}

function alerts(A) {
  const host = $("dg-alerts"); host.innerHTML = "";
  if (!A.length) { host.appendChild(item("Nothing raised an alert.", "Every scheduled job ran, or failed without telling anyone; the second is what the alerts exist to rule out.")); return; }
  A.forEach((a) => host.appendChild(item(a.title, `${a.at} · ${a.source}`)));
}

function events(E) {
  const host = $("dg-events"); host.innerHTML = "";
  E.forEach((e) => host.appendChild(el("li", {}, [el("a", { href: e.url, target: "_blank", rel: "noopener", text: e.headline }),
    el("span", { class: "note", text: `${e.stories} stories` })])));
  if (!E.length) host.appendChild(item("No events file this week."));
}

(async function init() {
  renderShell();
  let D;
  try { D = await loadJSON("data/digest.json"); } catch (err) { showError($("error"), err); return; }
  setAsOf(D.week_ending, "WEEK TO", { ages: false, note: "Rebuilt every Monday." });
  const M = D.moves;
  $("dg-eyebrow").textContent = `${fmtDate(D.start)} to ${fmtDate(D.week_ending)}`;
  $("dg-title").textContent = M.vs_spy >= 0 ? `A week ahead of SPY, by ${(M.vs_spy * 100).toFixed(2)} points`
                                            : `A week behind SPY, by ${(-M.vs_spy * 100).toFixed(2)} points`;
  $("dg-sub").textContent = `The portfolio returned ${signedPct(M.fund, 2)} over ${M.days} sessions against SPY's ${signedPct(M.spy, 2)}` +
    (M.change != null ? `, ${money(M.change)} on the money invested.` : ".");
  renderStats("dg-strip", [
    { label: "Portfolio", value: signedPct(M.fund, 2), tone: tone(M.fund), delta: "time-weighted, in CAD" },
    { label: "SPY", value: signedPct(M.spy, 2), tone: tone(M.spy), delta: "dividends after TFSA withholding, CAD" },
    { label: "Value", value: M.value != null ? money(M.value) : "–", delta: M.change != null ? `${M.change >= 0 ? "+" : ""}${money(M.change)} this week` : "" },
    D.income ? { label: "IBKR income vs data bill", value: `${D.income.ratio.toFixed(1)}×`, delta: `${money(D.income.monthly_income, "CAD", 2)} against ${money(D.income.bill, "CAD", 2)} a month` } : null,
  ]);
  movers(M); models(D.models); alerts(D.alerts); events(D.events);
})();
