// Research: one page that says what each research page answers, by group (2026-10-22, PM memo: 21 tabs in one row).
import { el } from "./common.js";
import { renderShell, sectionGroups } from "./shell.js";

const WHAT = {
  "research/heldmodel.html": "What you hold against the model's suggestion, and both against a beta-matched S&P.",
  "research/index.html": "The model book: its names, weights and the reasons for each.",
  "research/portfolio.html": "Today's target from the optimizer, with its vol, beta and caps.",
  "research/holdings.html": "Every rebalance the model has recorded.",
  "research/mvo.html": "The optimizer's frontier and constraints.",
  "research/regime.html": "The regime nowcast: how stressed the market looks.",
  "research/macro.html": "The point-in-time macro quadrant.",
  "research/rrg.html": "Which sectors and markets are taking the lead (display only).",
  "research/options.html": "Options on the held names.",
  "research/volsurface.html": "SPY's implied volatility surface.",
  "research/voltrade.html": "The SPY short-vol strategy: unfunded, synthetic evidence only.",
  "research/volengine.html": "Volatility forecasts raced out of sample.",
  "usd/model.html": "Each company's ten-year model and DCF.",
  "research/theses.html": "Each thesis tested: checks, base rates and the AI critics' verdicts.",
  "usd/fundamentals.html": "Reported fundamentals for the book's names.",
  "research/transcripts.html": "Earnings calls and results releases for every stock in the program.",
  "research/revisions.html": "Candidate names and what adding each would do to the book.",
  "research/demand.html": "The demand tree: who sells to whom.",
  "research/power.html": "The power study: data-centre load and the companies behind it.",
  "research/rentech.html": "Renaissance's 13F holdings and what they tilt toward.",
  "research/data.html": "The data warehouse and what its event studies found.",
};

renderShell();
const root = document.getElementById("hub");
for (const [group, pages] of sectionGroups("research")) {
  root.appendChild(el("div", { class: "panel" }, [
    el("div", { class: "panel-h" }, [el("h2", { text: group || "Research" })]),
    el("div", { class: "panel-b" }, [el("ul", { class: "hub-list" }, pages.map(([label, p]) =>
      el("li", {}, [el("a", { href: `../${p}`, text: label }), el("span", { class: "note", text: ` · ${WHAT[p] || ""}` })])))]),
  ]));
}
