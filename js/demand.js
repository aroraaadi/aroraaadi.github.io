/* The demand tree: what the ten largest firms in each sector say they are
   short of, and which industries supply it.

   index.json carries the whole tree for every period and both lenses; the
   quotes behind a count live in one file per sector and are fetched when a
   need is opened. The tree is nested lists laid out sideways in CSS, so it
   needs no measuring, reads as an outline on a phone, and is a real list to
   a screen reader. */

import { loadJSON, el, renderStats, renderTable, alpha, fmtDate } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";

const $ = (id) => document.getElementById(id);
const set = (id, t) => { const n = $(id); if (n) n.textContent = t; };
const SHORT = {
  "Communication Services": "Comm", "Consumer Discretionary": "Discr", "Consumer Staples": "Staples",
  "Energy": "Energy", "Financials": "Fin", "Health Care": "Health", "Industrials": "Indust",
  "Information Technology": "Tech", "Materials": "Mater", "Real Estate": "RE", "Utilities": "Util",
  "No industry": "None",
};
const FIT = {
  fits: null,
  thin: "Only one need is shared by two or more of the ten.",
  none: "No input constraint is described by two or more of the ten in this period.",
  non_firm: "Most of what these firms are short of is something no industry sells.",
};

let IDX = null;
const EV = {};                       // sector slug -> evidence file
const state = { lens: "sector", period: "latest", sectors: new Set(), open: new Set(), pick: null };

/* ---------- small pieces ---------- */

function pips(n, live, securing) {
  // Ten marks, one per firm: filled = short of it, ringed = buying more of it.
  const out = el("span", { class: "dm-pips", "aria-hidden": "true" });
  for (let i = 0; i < n; i++) {
    out.appendChild(el("i", { class: i < live ? "live" : i < live + securing ? "sec" : "" }));
  }
  return out;
}

function delta(now, prev) {
  if (prev == null) return el("span", { class: "dm-delta new", text: "new" });
  const d = now - prev;
  return el("span", { class: "dm-delta", text: d === 0 ? "=" : (d > 0 ? "+" : "−") + Math.abs(d) });
}

function leaf(s) {
  const kids = [el("span", { class: "dm-leaf-l", text: s.label })];
  if (s.kind === "industry") {
    kids.push(el("span", { class: "dm-tag", text: SHORT[s.sector] || s.sector }));
    if (s.verdict !== "measured") kids.push(el("span", { class: "dm-tag asserted", text: "asserted", title:
      "The largest firms in this industry do not describe this in their own filings distinctly more than other firms do." }));
  }
  return el("li", { class: `dm-leaf ${s.kind}${s.kind === "industry" && s.verdict !== "measured" ? " asserted" : ""}`,
                    title: s.kind === "non_firm" ? s.basis
                      : s.ratio != null ? `Its firms describe this ${s.ratio}× as often as other firms do (z ${s.z}).` : "" }, kids);
}

function needNode(sector, n, root) {
  const meta = IDX.needs[n.need];
  const key = `${sector}|${n.need}`;
  const open = state.open.has(key);
  const picked = state.pick && state.pick.sector === sector && state.pick.need === n.need;
  const securingOnly = n.securing.filter((s) => !n.live.includes(s)).length;
  const btn = el("button", { class: `dm-n need${picked ? " picked" : ""}`, type: "button", "aria-expanded": String(open),
                             title: meta.covers }, [
    el("span", { class: "dm-n-l", text: root ? sector : meta.label }),
    pips(10, n.firms, securingOnly),
    el("span", { class: "dm-count", text: `${n.any}/10`, title: `${n.firms} short of it, ${securingOnly} buying more of it` }),
    state.period === "latest" || n.prev != null ? delta(n.any, n.prev) : null,
  ]);
  btn.addEventListener("click", () => {
    if (state.open.has(key) && picked) state.open.delete(key); else state.open.add(key);
    state.pick = { sector, need: n.need };
    paint(); evidence();
  });
  const li = el("li", { class: "dm-node" }, [btn]);
  if (open && !root) li.appendChild(el("ul", { class: "dm-kids" }, meta.suppliers.map(leaf)));
  return li;
}

/* ---------- the two lenses ---------- */

function bySector() {
  const tree = IDX.tree[state.period];
  const out = el("ul", { class: "dm-roots" });
  for (const s of IDX.sectors) {
    if (!state.sectors.has(s.id)) continue;
    const t = tree[s.id];
    const head = el("div", { class: "dm-n root" }, [
      el("span", { class: "dm-n-l", text: s.name }),
      el("span", { class: "dm-sub", text: `${t.needs.length} shared need${t.needs.length === 1 ? "" : "s"}` }),
    ]);
    const kids = el("ul", { class: "dm-kids" }, t.needs.map((n) => needNode(s.id, n, false)));
    if (!t.needs.length) kids.appendChild(el("li", { class: "dm-leaf none" }, [el("span", { class: "dm-leaf-l", text: FIT.none })]));
    const li = el("li", { class: "dm-node" }, [head, kids]);
    const why = FIT[t.fit.verdict];
    if (why && t.needs.length) li.appendChild(el("p", { class: "dm-fit", text: why }));
    if (t.single.length) {
      li.appendChild(el("p", { class: "dm-fit", text: "One firm only: " + t.single.map((n) => IDX.needs[n.need].label.toLowerCase()).join(", ") + "." }));
    }
    out.appendChild(li);
  }
  return out;
}

function byResource() {
  const rows = IDX.by_resource[state.period];
  const tree = IDX.tree[state.period];
  const out = el("ul", { class: "dm-roots" });
  for (const r of rows) {
    const shown = r.sectors.filter((x) => state.sectors.has(x.sector));
    if (!shown.length) continue;
    const meta = IDX.needs[r.need];
    const head = el("div", { class: "dm-n root", title: meta.covers }, [
      el("span", { class: "dm-n-l", text: meta.label }),
      el("span", { class: "dm-sub", text: `${shown.reduce((a, x) => a + x.any, 0)} firms in ${shown.length} sector${shown.length === 1 ? "" : "s"}` }),
    ]);
    const kids = el("ul", { class: "dm-kids" }, shown.map((x) =>
      needNode(x.sector, tree[x.sector].needs.find((n) => n.need === r.need), true)));
    const from = el("ul", { class: "dm-from", "aria-label": "Supplied by" }, meta.suppliers.map(leaf));
    out.appendChild(el("li", { class: "dm-node resource" }, [el("div", { class: "dm-rootcol" }, [head, from]), kids]));
  }
  if (!out.children || !rows.length) out.appendChild(el("li", { class: "dm-leaf none" }, [el("span", { text: FIT.none })]));
  return out;
}

/* ---------- evidence ---------- */

async function evidence() {
  const host = $("dm-evidence");
  if (!state.pick) { host.innerHTML = ""; host.appendChild(el("p", { class: "note", text: "Open a need to read the sentences behind its count." })); return; }
  const { sector, need } = state.pick;
  const s = IDX.sectors.find((x) => x.id === sector);
  const node = IDX.tree[state.period][sector].needs.concat(IDX.tree[state.period][sector].single).find((n) => n.need === need);
  const period = IDX.periods.find((p) => p.id === state.period);
  set("dm-ev-title", `${sector} · ${IDX.needs[need].label}`);
  set("dm-ev-note", `${period.label} · filings ${fmtDate(period.start)} to ${fmtDate(period.end)}`);
  host.innerHTML = "";
  if (!node) { host.appendChild(el("p", { class: "note", text: "None of the ten firms describes this in the period chosen." })); return; }
  host.appendChild(el("div", { class: "flags dm-firms" }, s.firms.map((f) => {
    const cls = node.live.includes(f.symbol) ? "on" : node.securing.includes(f.symbol) ? "book" : node.easing.includes(f.symbol) ? "warn" : "muted";
    const what = { on: "short of it", book: "buying more of it", warn: "easing", muted: "silent" }[cls];
    return el("span", { class: `pill ${cls}`, text: f.symbol, title: `${f.name}: ${what}` });
  })));
  if (!EV[s.slug]) {
    try { EV[s.slug] = await loadJSON(`data/demand/evidence_${s.slug}.json`); }
    catch (e) { host.appendChild(el("p", { class: "note", text: "The quotes for this sector could not be loaded." })); return; }
  }
  if (!state.pick || state.pick.sector !== sector || state.pick.need !== need) return;   // moved on while loading
  const quotes = (EV[s.slug].periods[state.period] || {})[need] || [];
  if (!quotes.length) { host.appendChild(el("p", { class: "note", text: "No quotes kept for this period." })); return; }
  const list = el("ol", { class: "dm-quotes" });
  for (const q of quotes) {
    list.appendChild(el("li", { class: `dm-q ${q.status.toLowerCase()}` }, [
      el("div", { class: "dm-q-h" }, [
        el("span", { class: "sym", text: q.symbol }),
        el("span", { class: `pill ${q.status === "LIVE" ? "on" : q.status === "SECURING" ? "book" : "warn"}`,
                     text: { LIVE: "short of it", SECURING: "buying more", EASING: "easing" }[q.status] }),
        el("a", { href: q.url, target: "_blank", rel: "noopener", class: "dm-src",
                  text: `${q.form} · ${{ earnings: "earnings exhibit", mda: "MD&A", risk: "risk factors", business: "business", unsplit: "filing" }[q.channel]} · ${fmtDate(q.filed)}` }),
        el("span", { class: "dm-p", text: `p ${q.p.toFixed(2)}`, title: "The classifier's probability for this label" }),
      ]),
      el("blockquote", { text: q.text }),
    ]));
  }
  host.appendChild(list);
}

/* ---------- matrix, model, coverage ---------- */

function matrix() {
  const m = IDX.matrix[state.period];
  const host = $("dm-matrix");
  host.innerHTML = "";
  host.setAttribute("style", `grid-template-columns: max-content repeat(${m.cols.length}, minmax(44px, 1fr))`);
  const max = Math.max(1, ...m.cells.flat());
  host.appendChild(el("div", { class: "hm-corner" }));
  m.cols.forEach((c) => host.appendChild(el("div", { class: "hm-collabel", text: SHORT[c] || c, title: c })));
  m.rows.forEach((r, i) => {
    host.appendChild(el("div", { class: "hm-rowlabel", text: r }));
    m.cells[i].forEach((v, j) => host.appendChild(el("div", {
      class: "hm-cell", text: v ? String(v) : "·", title: `${r} needs something ${m.cols[j]} supplies: ${v} firm-need links`,
      style: v ? `background:${alpha("--accent", 0.12 + 0.6 * v / max)}` : "color:var(--muted)" })));
  });
  set("dm-matrix-note", "rows need, columns supply · a cell counts firm-need links");
}

function model() {
  const M = IDX.model;
  const names = { LIVE: "Short of it", SECURING: "Buying more of it", EASING: "Easing" };
  const pct = (x) => (x == null ? "–" : (x * 100).toFixed(0) + "%");
  renderTable($("dm-model"), Object.entries(M.targets).map(([k, t]) => ({
    k, name: names[k], support: t.test.positives, precision: t.test.precision, recall: t.test.recall, f1: t.test.f1,
    ci: t.test.f1_ci, lex: t.lexicon.f1, t: t.versus_lexicon.t, verdict: t.verdict, why: t.why,
  })), [
    { key: "name", label: "The model flags a sentence as" },
    { key: "support", label: "Held-out cases", num: true },
    { key: "precision", label: "Precision", num: true, fmt: pct },
    { key: "recall", label: "Recall", num: true, fmt: pct },
    { key: "f1", label: "F1", num: true, fmt: (v, r) => (v == null ? "–" : `${v.toFixed(2)}${r.ci ? ` (${r.ci[0].toFixed(2)}–${r.ci[1].toFixed(2)})` : ""}`) },
    { key: "lex", label: "Keyword rule F1", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(2)) },
    { key: "t", label: "t vs rule", num: true, fmt: (v) => (v == null ? "–" : v.toFixed(1)) },
    { key: "verdict", label: "Verdict", fmt: (v, r) => el("span", { class: `pill ${v === "established" ? "established" : "low"}`, text: v, title: r.why || "" }) },
  ]);
  const c = M.consistency.binary, u = M.uncued;
  set("dm-model-note",
    `${M.labels.toLocaleString()} labelled sentences; scored on firms the model never saw, two per sector, fixed before labelling. ` +
    (c ? `A second, blind labelling pass agreed with the first on ${pct(c.agreement)} of ${c.n} sentences (kappa ${c.kappa.toFixed(2)}) — the same labeller twice, so consistency, not independent agreement. ` : "") +
    (u && u.n ? `Of ${u.n} labelled sentences with no supply or capacity wording, ${u.hits} were constraints (at most ${pct(u.upper95)} at 95%): that is what the page cannot see. ` : "") +
    `${M.scored_sentences.toLocaleString()} sentences were scored and ${M.flagged_sentences.toLocaleString()} flagged.`);
}

function coverage() {
  const tree = IDX.tree[state.period];
  renderTable($("dm-cov"), IDX.sectors.map((s) => ({
    name: s.name, firms: s.firms.map((f) => f.symbol).join(" "), share: s.ten_share,
    filings: s.coverage.filings ?? null, split: s.coverage.split_ok ?? null,
    needs: tree[s.id].needs.length, fit: tree[s.id].fit.verdict,
  })), [
    { key: "name", label: "Sector" },
    { key: "firms", label: "The ten", cls: () => "muted" },
    { key: "share", label: "Share of sector cap", num: true, fmt: (v) => (v * 100).toFixed(0) + "%" },
    { key: "filings", label: "10-K and 10-Q", num: true },
    { key: "split", label: "Sections found", num: true, fmt: (v) => (v == null ? "–" : (v * 100).toFixed(0) + "%") },
    { key: "needs", label: "Shared needs", num: true },
    { key: "fit", label: "Reading", fmt: (v) => el("span", { class: `pill ${v === "fits" ? "" : "low"}`,
        text: { fits: "answers the question", thin: "thin", none: "nothing shared", non_firm: "no industry sells it" }[v] }) },
  ]);
}

/* ---------- controls ---------- */

const segButtons = { lens: [], period: [], sectors: [] };

function paint() {
  const host = $("dm-tree");
  host.innerHTML = "";
  host.appendChild(state.lens === "sector" ? bySector() : byResource());
  set("dm-tree-title", state.lens === "sector" ? "What each sector is short of" : "What is short, and who is short of it");
  set("dm-tree-note", `${IDX.periods.find((p) => p.id === state.period).label} · firms of ten`);
  segButtons.lens.forEach(([k, b]) => b.classList.toggle("active", k === state.lens));
  segButtons.period.forEach(([k, b]) => b.classList.toggle("active", k === state.period));
  segButtons.sectors.forEach(([k, b]) => { const on = state.sectors.has(k); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
}

function controls() {
  const lens = $("dm-lens");
  lens.innerHTML = "";
  [["sector", "By sector"], ["resource", "By resource"]].forEach(([k, label]) => {
    const b = el("button", { type: "button", text: label, class: k === state.lens ? "active" : "" });
    b.addEventListener("click", () => { state.lens = k; paint(); });
    lens.appendChild(b); segButtons.lens.push([k, b]);
  });
  const per = $("dm-period");
  per.innerHTML = "";
  IDX.periods.forEach((p) => {
    const b = el("button", { type: "button", text: p.label, class: p.id === state.period ? "active" : "" });
    b.addEventListener("click", () => { state.period = p.id; paint(); matrix(); coverage(); evidence(); });
    per.appendChild(b); segButtons.period.push([p.id, b]);
  });
  const sec = $("dm-sectors");
  sec.innerHTML = "";
  const all = el("button", { class: "pill muted", type: "button", text: "All" });
  all.addEventListener("click", () => { IDX.sectors.forEach((s) => state.sectors.add(s.id)); paint(); });
  const none = el("button", { class: "pill muted", type: "button", text: "None" });
  none.addEventListener("click", () => { state.sectors.clear(); paint(); });
  sec.appendChild(all); sec.appendChild(none);
  IDX.sectors.forEach((s) => {
    const b = el("button", { class: "pill on", type: "button", "aria-pressed": "true", text: s.name });
    b.addEventListener("click", () => { if (state.sectors.has(s.id)) state.sectors.delete(s.id); else state.sectors.add(s.id); paint(); });
    sec.appendChild(b); segButtons.sectors.push([s.id, b]);
  });
  const key = $("dm-key");
  key.innerHTML = "";
  key.appendChild(el("span", { class: "dm-key-i" }, [pips(3, 3, 0), el("span", { text: "firms short of it" })]));
  key.appendChild(el("span", { class: "dm-key-i" }, [pips(3, 0, 3), el("span", { text: "firms buying more of it, no shortage stated" })]));
  key.appendChild(el("span", { class: "dm-key-i" }, [el("span", { class: "dm-count", text: "5/10" }), el("span", { text: "firms of the ten, either kind" })]));
  key.appendChild(el("span", { class: "dm-key-i" }, [el("span", { class: "dm-delta", text: "+2" }), el("span", { text: "change on the last full year" })]));
  key.appendChild(el("span", { class: "dm-key-i" }, [el("span", { class: "dm-tag asserted", text: "asserted" }), el("span", { text: "supplier link not confirmed from the supplier's own filings" })]));
}

function notBuilt(reason) {
  set("dm-meta", `Not built yet — ${reason}.`);
  ["dm-main", "dm-evidence-panel", "dm-matrix-panel", "dm-model-panel"].forEach((id) => { const n = $(id); if (n) n.hidden = true; });
  if (IDX && IDX.sectors) {
    renderTable($("dm-cov"), IDX.sectors.map((s) => ({ name: s.name, firms: (s.firms || []).map((f) => f.symbol).join(" ") })),
      [{ key: "name", label: "Sector" }, { key: "firms", label: "The ten", cls: () => "muted" }]);
    set("dm-disclosure", IDX.disclosure || "");
  }
}

(async function init() {
  renderShell();
  try {
    IDX = await loadJSON("data/demand/index.json");
  } catch (e) {
    notBuilt("run python3 run_demand.py refresh");
    return;
  }
  if (!IDX.built) { notBuilt(IDX.reason); return; }
  setAsOf(IDX.as_of);
  IDX.sectors.forEach((s) => state.sectors.add(s.id));
  const latest = IDX.tree.latest;
  const shared = IDX.sectors.reduce((a, s) => a + latest[s.id].needs.length, 0);
  const top = IDX.by_resource.latest.find((r) => r.need !== "unspecified");
  const live = IDX.model.targets.LIVE;
  set("dm-meta", `Filings to ${fmtDate(IDX.as_of)} · ten largest firms per GICS sector as of ${fmtDate(IDX.universe_as_of)} · SEC EDGAR`);
  renderStats("dm-strip", [
    { label: "Firms read", value: String(IDX.coverage.firms), delta: `${IDX.coverage.filings.toLocaleString()} filings since ${IDX.since.slice(0, 4)}` },
    { label: "Sentences", value: IDX.coverage.sentences.toLocaleString(), delta: `${IDX.model.flagged_sentences.toLocaleString()} flagged by the model` },
    { label: "Shared needs now", value: String(shared), delta: "sector-need pairs, 2+ firms of ten" },
    top ? { label: "Most widely needed", value: IDX.needs[top.need].label, tone: "word", delta: `${top.any} firms in ${top.sectors_n} sectors, ${top.firms} short of it` } : null,
    { label: "Model precision", value: live.test.precision == null ? "–" : (live.test.precision * 100).toFixed(0) + "%",
      delta: `"short of it", held-out firms · ${live.verdict}` },
  ]);
  // Open on the widest need of the first sector that has one.
  const first = IDX.sectors.find((s) => latest[s.id].needs.length);
  if (first) { const n = latest[first.id].needs[0]; state.pick = { sector: first.id, need: n.need }; state.open.add(`${first.id}|${n.need}`); }
  controls(); paint(); matrix(); model(); coverage();
  set("dm-disclosure", IDX.disclosure);
  evidence();
  onThemeChange(() => matrix());
})();
