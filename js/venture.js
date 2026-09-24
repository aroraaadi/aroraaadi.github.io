/* Venture screen: the ETF-sourced small-cap candidates, ranked by evidence
   weight with the base rates of their profile printed beside them. Momentum,
   volume and attention are shown as context; the page says what is and is
   not established, because the data does. */

import { loadJSON, showError, fmtPct, el, renderTable } from "./common.js";
import { renderShell, setAsOf, registerCommands } from "./shell.js";

let DATA = null, sortKey = "rank", onlyFlag = null;

const num = (v, dp = 2) => (v == null ? "—" : Number(v).toFixed(dp));
const pct = (v, dp = 0) => (v == null ? "—" : fmtPct(v, dp));
const money = (v) => (v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}bn` : `$${(v / 1e6).toFixed(0)}m`);
const GRADE_CLASS = {
  "strong (literature), untested here": "up", moderate: "up", "moderate (literature)": "up",
  suggestive: "", weak: "", context: "muted", macro: "down", contrarian: "down", "NEGATIVE here": "down",
};
const NEG = new Set(["CROWDED", "FRAGILE", "DOWNGRADED", "LOSER", "PRE_RUN"]);

function flagPill(f) {
  const ev = DATA.evidence.find((e) => e.key === f);
  const cls = NEG.has(f) ? "pill down" : (ev && ev.weight > 0 ? "pill up" : "pill muted");
  return el("span", { class: cls, title: ev ? `${ev.label} · ${ev.grade} · weight ${ev.weight}` : f, text: f });
}

function headline() {
  const u = DATA.universe, port = DATA.portfolio;
  const stat = (l, v, d) => el("div", { class: "stat" }, [
    el("div", { class: "stat-l", text: l }), el("div", { class: "stat-v", text: v }),
    d ? el("div", { class: "stat-d", text: d }) : null].filter(Boolean));
  const host = document.getElementById("headline");
  host.replaceChildren(
    stat("ETFs swept", String(u.etfs), `top ${10} each`),
    stat("Names", String(u.names), `${u.small} still small`),
    stat("Screened", String(DATA.rows.length), `panel as of ${DATA.panel_as_of || "—"}`),
    stat("Portfolio", String(port.length), "equal weight, unfunded"),
    stat("Established signals", "0", "at |t| ≥ 3 in the panel"),
  );
}

function macro() {
  const m = DATA.macro;
  const host = document.getElementById("macro");
  host.replaceChildren(
    el("p", { text: m.summary }),
    el("ul", {}, m.points.map((p) => el("li", { text: p }))),
    el("p", { class: "note" }, [
      el("span", { text: `Snapshot ${m.as_of}. Sources: ` }),
      ...m.sources.flatMap((s, i) => [
        el("a", { href: s.url, target: "_blank", rel: "noopener", text: s.title }),
        i < m.sources.length - 1 ? el("span", { text: " · " }) : null]).filter(Boolean),
    ]),
  );
}

function evidence() {
  const rows = DATA.evidence.map((e) => ({ ...e, sources_txt: (e.sources || []).join("; ") }));
  renderTable(document.getElementById("ev-table"), rows, [
    { key: "key", label: "Flag", fmt: (v) => el("code", { text: v }) },
    { key: "label", label: "Signal" },
    { key: "grade", label: "Evidence", fmt: (v) => el("span", { class: `pill ${GRADE_CLASS[v] || ""}`, text: v }) },
    { key: "weight", label: "Weight", num: true, fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1) },
    { key: "note", label: "What it means here" },
    { key: "sources_txt", label: "Sources" },
  ]);
}

function baseRates() {
  const b = DATA.base_rates, t = DATA.base_tests || {};
  const rows = Object.entries(b).map(([k, v]) => ({
    key: k, label: v.label,
    m3: v.fwd3?.mean, m6: v.fwd6?.mean, m12: v.fwd12?.mean,
    dbl: v.fwd12?.p_double, hlv: v.fwd12?.p_halve, n: v.fwd12?.n,
    t3: t[k]?.fwd3?.t, t12: t[k]?.fwd12?.t, verdict: t[k]?.fwd12?.verdict || (k === "all" ? "—" : "noise"),
  }));
  renderTable(document.getElementById("br-table"), rows, [
    { key: "label", label: "Profile" },
    { key: "m3", label: "3m", num: true, fmt: (v) => pct(v, 1) },
    { key: "m6", label: "6m", num: true, fmt: (v) => pct(v, 1) },
    { key: "m12", label: "12m", num: true, fmt: (v) => pct(v, 1) },
    { key: "dbl", label: "Doubled", num: true, fmt: (v) => pct(v, 1) },
    { key: "hlv", label: "Halved", num: true, fmt: (v) => pct(v, 1) },
    { key: "n", label: "n", num: true, fmt: (v) => (v == null ? "—" : v.toLocaleString()) },
    { key: "t12", label: "t (12m)", num: true, fmt: (v) => num(v, 2) },
    { key: "verdict", label: "Verdict", fmt: (v) => el("span", { class: `pill ${v === "established" ? "up" : v === "suggestive" ? "" : "muted"}`, text: v }) },
  ]);
}

function screenRows() {
  let rows = DATA.rows.map((r) => ({ ...r, flags_n: r.flags.length }));
  if (onlyFlag) rows = rows.filter((r) => r.flags.includes(onlyFlag));
  return rows;
}

function paint() {
  const rows = screenRows();
  const dir = sortKey === "rank" ? 1 : -1;
  rows.sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir;
  });
  document.getElementById("count").textContent = `${rows.length} names` + (onlyFlag ? ` with ${onlyFlag}` : "");
  renderTable(document.getElementById("sc-table"), rows, [
    { key: "rank", label: "#", num: true },
    { key: "symbol", label: "Sym", fmt: (v, r) => {
        const a = el("a", { href: "#", class: "sym", text: v });
        a.addEventListener("click", (e) => { e.preventDefault(); detail(r); });
        return a;
      } },
    { key: "name", label: "Company", fmt: (v) => el("span", { class: "muted", text: (v || "").slice(0, 28) }) },
    { key: "score", label: "Score", num: true, fmt: (v) => el("b", { text: num(v, 1) }) },
    { key: "mcap", label: "Cap", num: true, fmt: money },
    { key: "pth", label: "÷52w hi", num: true, fmt: (v) => num(v, 2) },
    { key: "mom_12_1", label: "Mom 12-1", num: true, fmt: (v) => pct(v) },
    { key: "vol_surge", label: "Vol surge", num: true, fmt: (v) => (v == null ? "—" : v.toFixed(2) + "×") },
    { key: "sue", label: "SUE", num: true, fmt: (v) => num(v, 1) },
    { key: "gp_a", label: "GP/A", num: true, fmt: (v) => num(v, 2) },
    { key: "insider_buys_90d", label: "Ins. buys", num: true },
    { key: "target_upside", label: "Street", num: true, fmt: (v) => pct(v) },
    { key: "spike_z", label: "Attn z", num: true, fmt: (v) => num(v, 1) },
    { key: "base_p_double", label: "P(2×)", num: true, fmt: (v) => pct(v, 1) },
    { key: "base_p_halve", label: "P(½)", num: true, fmt: (v) => pct(v, 1) },
    { key: "flags_n", label: "Flags", fmt: (_, r) => el("span", { class: "flags" }, r.flags.map(flagPill)) },
  ]);
}

function portfolio() {
  const host = document.getElementById("portfolio");
  const port = DATA.portfolio;
  if (!port.length) { host.replaceChildren(el("p", { class: "note", text: "No name scored above zero." })); return; }
  const rows = port.map((p) => {
    const r = DATA.rows.find((x) => x.symbol === p.symbol) || {};
    return { ...p, name: r.name, profile: r.profile_label, dbl: r.base_p_double, hlv: r.base_p_halve, flags: r.flags || [] };
  });
  renderTable(document.getElementById("pf-table"), rows, [
    { key: "rank", label: "#", num: true },
    { key: "symbol", label: "Sym", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "name", label: "Company", fmt: (v) => (v || "").slice(0, 30) },
    { key: "weight", label: "Weight", num: true, fmt: (v) => pct(v, 1) },
    { key: "score", label: "Score", num: true, fmt: (v) => num(v, 1) },
    { key: "profile", label: "Panel profile" },
    { key: "dbl", label: "P(2×) 12m", num: true, fmt: (v) => pct(v, 1) },
    { key: "hlv", label: "P(½) 12m", num: true, fmt: (v) => pct(v, 1) },
    { key: "flags", label: "Why", fmt: (v) => el("span", { class: "flags" }, v.filter((f) => !NEG.has(f)).map(flagPill)) },
  ]);
}

async function pitches() {
  const host = document.getElementById("pitches");
  let idx = null;
  try { idx = await loadJSON("data/venture_pitches.json"); } catch { /* none built yet */ }
  if (!idx || !idx.pitches.length) {
    host.replaceChildren(el("p", { class: "note", text: "No pitch has been written yet. A pitch is a researched thesis, not a generated one — see venture/theses.py." }));
    return;
  }
  host.replaceChildren(
    ...idx.pitches.map((p) => el("div", { class: "alloc-row" }, [
      el("a", { class: "sym", href: p.path, target: "_blank", rel: "noopener", text: p.symbol }),
      el("span", { class: "muted", text: p.call }),
      el("span", { class: "spacer" }),
      el("a", { class: "note", href: p.path, target: "_blank", rel: "noopener", text: "PDF ↗" }),
    ])),
    idx.without_thesis.length
      ? el("p", { class: "note", text: `In the portfolio without a written thesis, so no PDF: ${idx.without_thesis.join(", ")}.` })
      : null,
  );
}

function themes() {
  const host = document.getElementById("themes");
  host.replaceChildren(...Object.entries(DATA.themes).filter(([, t]) => t.names.length).map(([k, t]) =>
    el("div", { class: "alloc-row" }, [
      el("span", { class: "clabel", text: t.label }),
      el("span", { class: "flags" }, t.names.map((s) => el("span", { class: "chip", text: s }))),
    ])));
  if (!host.children.length) host.replaceChildren(el("p", { class: "note", text: "No candidate matches an emerging-industry keyword." }));
}

function detail(r) {
  const box = document.getElementById("detail");
  box.innerHTML = "";
  const kv = (l, v) => el("div", { class: "stat" }, [el("div", { class: "stat-l", text: l }), el("div", { class: "stat-v", text: v })]);
  const f13 = r.f13;
  box.append(el("div", { class: "panel" }, [
    el("div", { class: "panel-h" }, [
      el("h2", { text: `${r.symbol} · ${r.name || ""}` }), el("span", { class: "spacer" }),
      el("span", { class: "note", text: `${r.sector || ""} · ${r.industry || ""}` })]),
    el("div", { class: "panel-b" }, [
      el("div", { class: "grid" }, [
        kv("Score", num(r.score, 1)), kv("Rank", String(r.rank)),
        kv("Price", r.price == null ? "—" : `$${r.price.toFixed(2)}`), kv("Market cap", money(r.mcap)),
        kv("÷ 52w high", num(r.pth, 2)), kv("Days since high", r.days_since_high == null ? "—" : String(r.days_since_high)),
        kv("1m / 3m / 6m / 12m", [r.ret_1m, r.ret_3m, r.ret_6m, r.ret_12m].map((v) => pct(v)).join(" / ")),
        kv("Vol (ann.)", pct(r.vol_ann)), kv("Volume surge", r.vol_surge == null ? "—" : r.vol_surge.toFixed(2) + "×"),
        kv("Last EPS surprise", pct(r.eps_surprise, 1)), kv("SUE", num(r.sue, 2)),
        kv("Beat streak", r.beat_streak == null ? "—" : `${r.beat_streak} (${r.beats_of_8 ?? "—"}/8)`),
        kv("Next report", r.next_earnings ? `${r.next_earnings} (${r.days_to_earnings}d)` : "—"),
        kv("Insider buys 90d", `${r.insider_buys_90d ?? 0} by ${r.insider_buyers_90d ?? 0}${r.insider_cluster ? " · CLUSTER" : ""}`),
        kv("Insider sells 90d", String(r.insider_sells_90d ?? 0)),
        kv("Analysts", `${r.n_analysts ?? 0} · ${r.consensus || "—"}`), kv("Street upside", pct(r.target_upside)),
        kv("Up / down / init 90d", `${r.grades_up_90d ?? 0} / ${r.grades_down_90d ?? 0} / ${r.initiations_90d ?? 0}`),
        kv("GP/A", num(r.gp_a, 2)), kv("Gross margin", pct(r.gross_margin)), kv("Rev growth TTM", pct(r.revenue_growth)),
        kv("Profitable", r.profitable == null ? "—" : r.profitable ? "yes" : "no"), kv("FCF", r.fcf_positive == null ? "—" : r.fcf_positive ? "positive" : "negative"),
        kv("Net debt / EBITDA", num(r.net_debt_to_ebitda, 1)), kv("Altman Z", num(r.altman_z, 1)), kv("Piotroski", num(r.piotroski, 0)),
        kv("Free float", pct(r.free_float_pct == null ? null : r.free_float_pct / 100)),
        kv("Attention z", num(r.spike_z, 1)), kv("Articles 30d", String(r.articles_30d ?? "—")),
        kv("Panel bucket", r.panel_bucket || "outgrew the panel"), kv("Panel SUE / GP/A pct", `${num(r.panel_sue_q, 2)} / ${num(r.panel_gpa_q, 2)}`),
        kv("In ETFs", (r.etfs || []).join(", ")),
      ]),
      el("p", { class: "note" }, [el("b", { text: "Profile: " }), el("span", { text: `${r.profile_label || r.profile}. ` }),
        el("span", { text: `Names with this profile since 2013: mean 12m ${pct(r.base_fwd12_mean, 1)}, doubled ${pct(r.base_p_double, 1)}, halved ${pct(r.base_p_halve, 1)}.` })]),
      el("div", { class: "flags" }, r.flags.map(flagPill)),
      r.themes && r.themes.length ? el("p", { class: "note", text: "Themes: " + r.themes.map((t) => DATA.themes[t]?.label || t).join(", ") }) : null,
      f13 ? el("p", { class: "note", text: `13F: held by ${f13.holders.map((h) => `${h.fund} (${fmtPct(h.weight, 1)})`).join(", ")}` + (f13.best_idea_for.length ? ` · best idea for ${f13.best_idea_for.join(", ")}` : "") }) : null,
      r.mention_titles && r.mention_titles.length ? el("ul", { class: "note" }, r.mention_titles.map((t) => el("li", { text: t }))) : null,
      r.description ? el("p", { class: "prose", text: r.description }) : null,
    ].filter(Boolean)),
  ]));
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function wire() {
  document.getElementById("sortby").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#sortby button").forEach((x) => x.classList.toggle("active", x === b));
    sortKey = b.dataset.sort; paint();
  });
  document.getElementById("flagfilter").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#flagfilter button").forEach((x) => x.classList.toggle("active", x === b));
    onlyFlag = b.dataset.flag || null; paint();
  });
}

(async function init() {
  renderShell();
  const content = document.getElementById("content");
  try { DATA = await loadJSON("data/venture.json"); }
  catch (err) { showError(content, err); return; }
  setAsOf(DATA.as_of);
  document.getElementById("disclosure").textContent = DATA.disclosure;
  const unav = document.getElementById("unavailable");
  unav.replaceChildren(...Object.entries(DATA.unavailable || {}).map(([k, v]) => el("li", { text: `${k}: ${v}` })));
  const ff = document.getElementById("flagfilter");
  ff.replaceChildren(el("button", { class: "active", "data-flag": "", text: "All" }),
    ...DATA.evidence.map((e) => el("button", { "data-flag": e.key, text: e.key })));
  registerCommands(DATA.rows.map((r) => ({ key: r.symbol, hint: r.profile_label || "", act: () => detail(r) })));
  headline(); macro(); evidence(); baseRates(); paint(); portfolio(); themes(); wire();
  pitches();
  const hash = decodeURIComponent(location.hash.slice(1));
  const hit = hash && DATA.rows.find((r) => r.symbol === hash);
  if (hit) detail(hit);
})();
