/* The Data page: the master database's catalog, its price-store agreement, and the cross-domain discoveries. */
import { loadJSON, showError, fmtPct, fmtDate, el, renderStats, renderTable, words } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const $ = (id) => document.getElementById(id);
const spct = (x, dp = 2) => (x == null ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "") + fmtPct(Math.abs(x), dp));
const tnum = (x) => (x == null ? "–" : (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(1));
const int = (x) => (x == null ? "–" : Number(x).toLocaleString("en-US"));
const GRADE = { established: 3, replicated: 2, suggestive: 1, nothing: 0 };
const GRADE_TONE = { established: "up", replicated: "on", suggestive: "warn", nothing: "muted" };
const DOMAIN = { ref: "Reference", px: "Prices", fund: "Fundamentals", filings: "Filings", news: "News", macro: "Macro", opt: "Options",
  book: "Books", sig: "Signals and research", ops: "Operations" };
let W = null, D = null;

const pill = (g) => el("span", { class: `pill ${GRADE_TONE[g] || "muted"}`, text: g || "–" });
const day = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? fmtDate(s.slice(0, 10)) : s || "–");

function strip() {
  const objs = W?.objects || [];
  const raw = objs.filter((o) => o.layer === "raw");
  const rows = raw.reduce((a, o) => a + (o.rows || 0), 0);
  const last = (W?.price_agreement || []).filter((r) => r.pair === "layered vs pit").slice(-1)[0];
  const graded = (D?.studies || []).flatMap((s) => (s.horizons || []).flatMap((h) => Object.values(h.grade || {})));
  renderStats("dt-strip", [
    { label: "Tables and views", value: int(objs.length), delta: W ? `${raw.length} raw, ${objs.length - raw.length} conformed` : "not built yet" },
    { label: "Rows held", value: rows >= 1e9 ? `${(rows / 1e9).toFixed(2)}B` : `${(rows / 1e6).toFixed(0)}M`, delta: W ? `${(W.size_mb / 1000).toFixed(1)} GB on disk` : "" },
    { label: "Last build", value: W ? day(W.built) : "–", delta: W ? `${W.seconds.toFixed(0)}s · ${W.failed.length ? W.failed.length + " failed" : "nothing failed"}` : "" },
    { label: "Price stores agree", value: last ? fmtPct(last.within_10bp, 1) : "–", delta: last ? `of ${int(last.days)} company-days in ${last.year}, within 0.1%` : "" },
    { label: "Discoveries", value: D ? String(graded.filter((g) => g === "established" || g === "replicated").length) : "–",
      tone: graded.some((g) => g === "established") ? "up" : "",
      delta: D ? `established or replicated, of ${D.n_tests} tests` : "not run yet" },
  ]);
}

function best(s) {
  let top = null;
  for (const h of s.horizons || []) for (const u of ["liquid", "all"]) {
    const g = h.grade?.[u] || "nothing", c = h.cells?.[`${u}|test`] || {};
    const score = GRADE[g] * 100 + Math.abs(c.t || 0);
    if (!top || score > top.score) top = { score, g, u, h: h.h, c, j: h.cells?.[`${u}|judged`] || {} };
  }
  return top;
}

function studies() {
  const rows = (D?.studies || []).map((s) => {
    const b = s.error ? null : best(s);
    return { title: s.title, hyp: s.hypothesis, caveat: s.caveat, domains: (s.domains || []).join(" + "), events: s.events, error: s.error,
      grade: b?.g, where: b ? `${b.u === "liquid" ? "top 2,500" : "all"} · ${b.h}d` : "–", jnet: b?.j.net, jt: b?.j.t, tnet: b?.c.net, tt: b?.c.t };
  }).sort((a, b) => (GRADE[b.grade] || 0) - (GRADE[a.grade] || 0) || Math.abs(b.tt || 0) - Math.abs(a.tt || 0));
  $("dt-d-meta").textContent = D ? `${rows.length} studies · ${D.n_tests} tests · run ${day(D.built)}` : "";
  $("dt-d-note").textContent = D
    ? "Each row is one question, shown at its strongest horizon and universe. Returns are abnormal (against the average company that day), "
      + "after 20 bp a round trip, in the direction the hypothesis expects: a negative t means the opposite happened. Established needs a test-period t of 3; "
      + "replicated needs the judged period to survive the false-discovery correction and the test period a t of 2, same sign."
      + (D.news_months?.missing?.length ? ` The headline feed is still being pulled: ${D.news_months.missing.length} months are missing, so the news studies use only the months it has.` : "")
    : "The discovery run has not produced results yet.";
  renderTable($("dt-studies"), rows, [
    { key: "title", label: "Question", cls: () => "wrap", fmt: (v, r) => el("div", {}, [el("strong", { text: v }), el("div", { class: "note", text: r.hyp }),
      ...(r.caveat ? [el("div", { class: "note", text: "Caveat: " + r.caveat })] : [])]) },
    { key: "domains", label: "Joins", cls: () => "note" },
    { key: "events", label: "Events", num: true, fmt: int },
    { key: "where", label: "Strongest", cls: () => "note" },
    { key: "jnet", label: "2012-20 net", num: true, fmt: (v) => spct(v) },
    { key: "jt", label: "t", num: true, fmt: tnum },
    { key: "tnet", label: "2021 on net", num: true, fmt: (v) => spct(v) },
    { key: "tt", label: "t", num: true, fmt: tnum },
    { key: "grade", label: "Grade", fmt: (v, r) => (r.error ? el("span", { class: "note", text: "failed to run" }) : pill(v)) },
  ], { empty: "No study has run yet." });
}

function allRows() {
  const rows = [];
  for (const s of D?.studies || []) for (const h of s.horizons || []) for (const u of ["liquid", "all"]) {
    const j = h.cells?.[`${u}|judged`] || {}, t = h.cells?.[`${u}|test`] || {};
    rows.push({ study: s.title, uni: u === "liquid" ? "top 2,500" : "all", h: h.h, jn: j.n, jnet: j.net, jt: j.t, tn: t.n, tnet: t.net, tt: t.t, grade: h.grade?.[u], bh: h.bh_judged?.[u] });
  }
  $("dt-a-meta").textContent = `${rows.length} rows`;
  renderTable($("dt-all"), rows, [
    { key: "study", label: "Study", cls: () => "wrap" },
    { key: "uni", label: "Universe", cls: () => "note" },
    { key: "h", label: "Sessions", num: true },
    { key: "jn", label: "Events 2012-20", num: true, fmt: int },
    { key: "jnet", label: "Net", num: true, fmt: (v) => spct(v) },
    { key: "jt", label: "t", num: true, fmt: tnum },
    { key: "bh", label: "Survives FDR", fmt: (v) => (v ? "yes" : "no"), cls: () => "note" },
    { key: "tn", label: "Events 2021 on", num: true, fmt: int },
    { key: "tnet", label: "Net", num: true, fmt: (v) => spct(v) },
    { key: "tt", label: "t", num: true, fmt: tnum },
    { key: "grade", label: "Grade", fmt: pill },
  ], { empty: "No study has run yet." });
}

function catalog(filter = "") {
  const f = filter.trim().toLowerCase();
  const rows = (W?.objects || []).filter((o) => o.layer !== "raw" || f)
    .filter((o) => !f || `${o.name} ${o.about} ${o.writers}`.toLowerCase().includes(f))
    .map((o) => ({ ...o, domain: o.layer === "raw" ? "As stored" : DOMAIN[o.schema] || words(o.schema) }));
  $("dt-c-note").textContent = W
    ? `${(W.objects || []).length} objects. Shown: the conformed tables, where every source shares one company key (CIK) and one date type. `
      + "Type in the box to search the raw copies too (each store exactly as its writer keeps it). From the shell: python3 -m warehouse --find \"…\"."
    : "The master database has not been built yet: python3 -m warehouse.build.";
  renderTable($("dt-catalog"), rows, [
    { key: "domain", label: "Area", cls: () => "note" },
    { key: "name", label: "Table", fmt: (v) => el("code", { text: v }) },
    { key: "about", label: "What it holds", cls: () => "wrap note" },
    { key: "rows", label: "Rows", num: true, fmt: int },
    { key: "first", label: "From", fmt: day, cls: () => "note" },
    { key: "last", label: "To", fmt: day, cls: () => "note" },
  ], { empty: f ? "Nothing matches." : "Nothing to show yet." });
}

function agreement() {
  const rows = (W?.price_agreement || []).filter((r) => r.year >= 2016).sort((a, b) => b.year - a.year || a.pair.localeCompare(b.pair));
  $("dt-q-meta").textContent = rows.length ? `${rows.length} year-pairs` : "";
  renderTable($("dt-agree"), rows, [
    { key: "year", label: "Year" },
    { key: "pair", label: "Stores", cls: () => "note" },
    { key: "days", label: "Company-days", num: true, fmt: int },
    { key: "companies", label: "Companies", num: true, fmt: int },
    { key: "within_10bp", label: "Within 0.1%", num: true, fmt: (v) => fmtPct(v, 2) },
    { key: "off_by_2pct", label: "Off by 2%+", num: true, fmt: (v) => fmtPct(v, 3) },
  ], { empty: "Measured when the database is built." });
}

async function main() {
  renderShell();
  try { W = await loadJSON("data/warehouse.json"); } catch { W = null; }
  try { D = await loadJSON("data/discoveries.json"); } catch { D = null; }
  if (!W && !D) showError($("error"), new Error("The master database has not been published yet."));
  setAsOf(W ? W.built.slice(0, 10) : "not built", "BUILT", { ages: !!W });
  strip(); studies(); allRows(); catalog(); agreement();
  $("dt-filter").addEventListener("input", (e) => catalog(e.target.value));
}

main();
