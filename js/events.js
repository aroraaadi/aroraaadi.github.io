/* Current events: what is happening, what it says about each holding, and,
   separately, how the portfolio moved and which events reach it.

   events.json is rebuilt every evening by run_daily (news/events.py). Every
   headline is quoted with its publisher and link; nothing is summarised. */

import { loadJSON, showError, el, fmtPct, fmtDate, renderStats, tone, signedPct as pct } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const $ = (id) => document.getElementById(id);
const set = (id, t) => { const n = $(id); if (n) n.textContent = t; };
const ago = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`);
const when = (iso) => { const d = new Date(iso); return d.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
let D = null;

function events() {
  const host = $("ev-list"); host.innerHTML = "";
  D.events.forEach((e, i) => {
    const open = { v: false };
    const items = el("ul", { class: "ev-items", hidden: true }, e.items.map((it) => el("li", {}, [
      el("a", { href: it.url, target: "_blank", rel: "noopener", text: it.title }),
      el("span", { class: "note", text: ` · ${it.publisher} · ${when(it.at)}` })])));
    const more = el("button", { class: "ev-more", type: "button", "aria-expanded": "false",
                                text: `${e.stories} stor${e.stories === 1 ? "y" : "ies"} from ${e.publishers.length} outlets` });
    more.addEventListener("click", () => { open.v = !open.v; items.hidden = !open.v; more.setAttribute("aria-expanded", String(open.v)); });
    const reach = [];
    if (e.direct_tickers.length) reach.push(el("span", { class: "ev-reach direct" }, [
      el("b", { text: "Names " }), el("span", { class: "flags" }, e.direct_tickers.map((t) => el("span", { class: "pill on", text: t }))),
      el("span", { class: "note", text: ` ${fmtPct(e.direct_weight, 1)} of the portfolio` })]));
    if (e.thematic_tickers.length) reach.push(el("span", { class: "ev-reach" }, [
      el("b", { text: "Through sector " }),
      el("span", { class: "note", title: e.thematic_tickers.join(", "), text: `${e.thematic_tickers.length} holdings, ${fmtPct(e.thematic_weight, 0)} of the portfolio` })]));

    host.appendChild(el("li", { class: "ev" }, [
      el("span", { class: "ev-rank", text: String(i + 1) }),
      el("div", { class: "ev-main" }, [
        el("a", { class: "ev-head", href: e.url, target: "_blank", rel: "noopener", text: e.headline }),
        e.summary ? el("p", { class: "ev-sum", text: e.summary }) : null,
        el("div", { class: "ev-tags" }, [
          ...e.topics.map((t) => el("span", { class: "pill muted", text: t })),
          el("span", { class: "note", text: ago(e.hours_ago) })]),
        el("div", { class: "ev-reaches" }, reach),
        more, items,
      ]),
    ]));
  });
  set("ev-count", `${D.events.length} of ${D.events_found.toLocaleString()} events, from ${D.stories.toLocaleString()} stories in ${D.window_hours} hours`);
  set("ev-note", `${D.method.events} ${D.method.direct} ${D.method.thematic}`);
}

function companies() {
  const host = $("co-list"); host.innerHTML = "";
  // Holdings with news get a card, most-covered first; the rest share a line.
  const loud = D.companies.filter((c) => c.news_week > 0)
    .sort((a, b) => (b.events.length - a.events.length) || (b.news_session - a.news_session) || (b.weight - a.weight));
  const quiet = D.companies.filter((c) => c.news_week === 0);
  for (const c of loud) {
    host.appendChild(el("article", { class: "co" }, [
      el("div", { class: "co-h" }, [
        el("span", { class: "sym co-t", text: c.ticker }),
        el("span", { class: `tk-ccy ${c.book}`, text: c.book.toUpperCase() }),
        el("span", { class: "co-n", text: c.name }),
        el("span", { class: "co-w note", text: `${fmtPct(c.weight, 1)} of portfolio` }),
      ]),
      el("div", { class: "co-move" }, [
        el("span", { class: `co-r ${tone(c.ret)}`, text: pct(c.ret, 2) }),
        el("span", { class: `note ${tone(c.vs_spy)}`, text: c.vs_spy == null ? "" : ` ${pct(c.vs_spy, 2)} vs SPY on ${fmtDate(D.session)}` }),
        c.events.length ? el("span", { class: "flags co-ev" }, c.events.map((i) => el("span", { class: "pill on", title: D.events[i].headline, text: `event ${i + 1}` }))) : null,
      ]),
      c.headlines.length
        ? el("ul", { class: "co-heads" }, c.headlines.slice(0, 3).map((h) => el("li", {}, [
            el("a", { href: h.url, target: "_blank", rel: "noopener", text: h.title }),
            el("span", { class: "note", text: ` · ${h.publisher} · ${when(h.at)}` })])))
        : el("p", { class: "note", text: "No news in the last seven days." }),
    ]));
  }
  if (quiet.length) {
    const line = el("p", { class: "co-quiet" }, [el("span", { text: "No news this week: " })]);
    quiet.forEach((c) => line.appendChild(el("span", { class: "sym", title: `${c.name} · ${pct(c.ret, 2)} last session`, text: c.ticker })));
    host.after(line);
  }
  const withNews = loud.length;
  set("co-meta", `${withNews} of ${D.companies.length} holdings in the news this week`);
  set("co-note", `${D.method.moves} Headlines from the last seven days; syndicated copies of one story are shown once.`);
}

function portfolio() {
  const P = D.portfolio;
  set("pf-meta", `Last completed session: ${fmtDate(P.session)}`);
  renderStats("pf-strip", [
    { label: "Portfolio, last session", value: pct(P.ret, 2), tone: tone(P.ret), delta: "in Canadian dollars" },
    { label: "SPY", value: pct(P.spy, 2), tone: tone(P.spy), delta: "dividends in, in CAD" },
    { label: "Difference", value: pct(P.vs_spy, 2), tone: tone(P.vs_spy), delta: P.vs_spy >= 0 ? "ahead of SPY" : "behind SPY" },
    { label: "Holdings with news that day", value: fmtPct(P.weight_with_news, 0), delta: "of the portfolio, by weight" },
  ]);
  const max = Math.max(...P.drivers.map((d) => Math.abs(d.contribution)), 1e-9);
  const dh = $("pf-drivers"); dh.innerHTML = "";
  for (const d of P.drivers) {
    dh.appendChild(el("div", { class: "pf-d" }, [
      el("span", { class: "sym", text: d.ticker }),
      el("span", { class: "pf-bar" }, [el("i", { class: d.contribution >= 0 ? "up" : "down",
        style: `width:${(Math.abs(d.contribution) / max) * 50}%;${d.contribution >= 0 ? "left:50%" : `right:50%`}` })]),
      el("span", { class: `pf-c ${tone(d.contribution)}`, text: `${d.contribution >= 0 ? "+" : "−"}${Math.abs(d.contribution * 100).toFixed(2)} pts` }),
      el("span", { class: "note", text: `stock ${pct(d.ret, 1)}` }),
      el("span", { class: `pill ${d.news ? "on" : "muted"}`, text: d.news ? "had news" : "no news" }),
    ]));
  }
  const rh = $("pf-reach"); rh.innerHTML = "";
  P.event_reach.forEach((r, i) => {
    rh.appendChild(el("div", { class: "pf-r" }, [
      el("span", { class: "ev-rank", text: String(i + 1) }),
      el("span", { class: "pf-rh", text: r.headline }),
      el("span", { class: "pf-rbar", title: `named: ${fmtPct(r.direct, 1)}, through sector: ${fmtPct(r.thematic, 1)}` }, [
        el("i", { class: "direct", style: `width:${r.direct * 100}%` }),
        el("i", { class: "thematic", style: `width:${r.thematic * 100}%` })]),
      el("span", { class: "note", text: `${fmtPct(r.direct, 0)} named · ${fmtPct(r.thematic, 0)} by sector` }),
    ]));
  });
  set("pf-note", "Contribution is each holding's weight times its return, in percentage points of the portfolio. " +
    "Reach: the solid part is holdings an event names, the light part holdings it touches only through their sector. " +
    `${D.method.moves}`);
}

(async function init() {
  renderShell();
  try {
    D = await loadJSON("data/events.json");
  } catch (err) {
    showError($("error"), err); return;
  }
  setAsOf(D.as_of);
  set("ev-meta", `Built ${when(D.built)} · FMP news · updated every evening`);
  events(); companies(); portfolio();
})();
