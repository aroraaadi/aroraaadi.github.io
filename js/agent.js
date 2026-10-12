/* The Macro agent tab: a Claude agent's weekly paper macro book, its record, every run and every change. */
import { loadJSON, showError, fmtPct, fmtDate, fmtSigned, money, tone, el, renderStats, renderTable, tok } from "./common.js";
import { renderShell, setAsOf, onThemeChange } from "./shell.js";
import { applyChartDefaults, draw, lineConfig } from "./charts.js";

const $ = (id) => document.getElementById(id);
const usd = (x) => money(x, "USD", 0);
const day = (iso) => (iso ? fmtDate(String(iso).slice(0, 10)) : "–");
const VERDICT_TONE = { "EVIDENCE OF SKILL": "up", UNDERPERFORMING: "down", "NO EVIDENCE OF SKILL": "down", UNPROVEN: "", "NOT STARTED": "" };
const STATUS_TONE = { ok: "up", refused: "down", failed: "down" };
const pill = (text, t) => el("span", { class: `pill ${t || "muted"}`, text });
let A = null;

function strip() {
  const c = A.scorecard || {}, tr = c.total_return || {}, ex = c.excess || {}, dd = c.max_drawdown || {}, r = c.runs || {};
  renderStats("ag-strip", [
    { label: "Verdict", value: c.verdict || "–", tone: VERDICT_TONE[c.verdict] },
    { label: "Weeks live", value: String(c.weeks ?? 0), delta: A.inception ? `since ${day(A.inception)}` : "not started" },
    { label: "Book", value: fmtSigned(tr.book), tone: tone(tr.book) },
    { label: "vs 60/40", value: fmtSigned(ex.sixty_forty), tone: tone(ex.sixty_forty) },
    { label: "vs the rule", value: fmtSigned(ex.rule), tone: tone(ex.rule) },
    { label: "vs SPY", value: fmtSigned(ex.spy), tone: tone(ex.spy) },
    { label: "Max drawdown", value: dd.book == null ? "–" : fmtPct(dd.book), delta: dd.sixty_forty == null ? "" : `60/40 ${fmtPct(dd.sixty_forty)}` },
    { label: "Costs", value: c.costs_usd == null ? "–" : usd(c.costs_usd), delta: c.cost_drag == null ? "" : `${fmtPct(c.cost_drag, 2)} of capital` },
    { label: "Weekly runs", value: `${(r.weekly || 0) - (r.failed || 0)} ok`, tone: r.failed ? "down" : "",
      delta: `${r.failed || 0} failed · API $${(r.list_cost_usd || 0).toFixed(2)}` },
  ]);
}

function verdict() {
  const c = A.scorecard || {};
  $("ag-verdict").replaceChildren(pill(c.verdict || "–", VERDICT_TONE[c.verdict] || "warn"), " ", c.verdict_note || "");
  $("ag-v-meta").textContent = A.last_marked ? `marked to ${day(A.last_marked)}` : "";
  const flags = c.flags || [];
  $("ag-flags").replaceChildren(...(flags.length ? flags : ["Nothing flagged yet, which with this little history means nothing."])
    .map((f) => el("li", { text: f })));
}

function chart() {
  const n = A.nav || [];
  if (!n.length) {
    $("ag-chart").closest(".chart").hidden = true;
    $("ag-c-note").textContent = "The line starts on the first fill.";
    return;
  }
  $("ag-chart").closest(".chart").hidden = false;
  const lines = [["nav", "Macro agent", "--accent", 2.2], ["sixty_forty", "60/40 (SPY/AGG)", "--ink-2", 1.4],
                 ["rule", "Quadrant rule", "--warn", 1.4], ["spy", "SPY", "--muted", 1.2]];
  draw("ag-chart", lineConfig({
    labels: n.map((x) => x.date), yFmt: (v) => usd(v),
    series: lines.map(([k, label, color, width]) => ({ label, data: n.map((x) => x[k]), color: tok(color), width })),
  }));
  $("ag-c-meta").textContent = `${day(n[0].date)} to ${day(n[n.length - 1].date)}`;
  $("ag-c-note").textContent = "Every line starts with the book's capital on its first fill, rebalances on the same days and pays the same costs. The quadrant rule holds the macro layer's one sleeve for the quadrant (SPY, DBC, GLD or TLT).";
}

function holdingsTable() {
  const p = A.pending;
  $("ag-pending").textContent = p
    ? `Pending: decision ${p.id} of ${day(p.decided_date)} fills at the first close after it: ${Object.entries(p.target).map(([s, w]) => `${s} ${fmtPct(w, 0)}`).join(", ")}.`
    : "No target waiting to fill.";
  $("ag-h-meta").textContent = A.last_marked ? `at the ${day(A.last_marked)} close` : "";
  renderTable($("ag-hold"), A.holdings || [], [
    { key: "symbol", label: "Line" },
    { key: "name", label: "Index", cls: () => "note" },
    { key: "bucket", label: "Bucket" },
    { key: "weight", label: "Weight", num: true, fmt: (v) => fmtPct(v) },
    { key: "target", label: "Target", num: true, fmt: (v) => fmtPct(v) },
    { key: "value", label: "Value", num: true, fmt: (v) => usd(v) },
  ], { sortKey: "weight", empty: "Nothing held yet." });
}

async function latest() {
  const d = (A.decisions || []).slice(-1)[0];
  if (!d) {
    $("ag-l-call").textContent = "No decision yet: the first weekly rebalance runs on Saturday evening.";
    return;
  }
  const probs = Object.entries(d.regime?.probabilities || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmtPct(v, 0)}`).join(", ");
  $("ag-l-meta").textContent = `${d.id} · decided ${day(d.decided_date)} · ${d.status}${d.fill_date ? ` ${day(d.fill_date)}` : ""}`;
  $("ag-l-call").replaceChildren(el("strong", { text: d.regime?.call || "–" }),
    ` (${d.regime?.confidence || "?"} confidence; ${probs}). ${d.summary || ""}`);
  renderTable($("ag-moves"), (d.changes || []).map((c) => ({ ...c, delta: (c.to ?? 0) - (c.from ?? 0) })), [
    { key: "symbol", label: "Line" },
    { key: "from", label: "From", num: true, fmt: (v) => fmtPct(v) },
    { key: "to", label: "To", num: true, fmt: (v) => fmtPct(v) },
    { key: "delta", label: "Change", num: true, fmt: (v) => el("span", { class: tone(v), text: fmtSigned(v) }) },
    { key: "reason", label: "Why", cls: () => "note" },
  ], { sortKey: "delta", empty: "No line moved by 2 points or more." });
  try {
    await libs();
    $("ag-report").innerHTML = window.DOMPurify.sanitize(window.marked.parse(d.report_md || ""));
  } catch { $("ag-report").textContent = d.report_md || ""; }
}

function libs() {
  if (window.marked && window.DOMPurify) return Promise.resolve();
  return new Promise((ok, no) => {
    let n = 2;
    for (const src of ["https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
                       "https://cdn.jsdelivr.net/npm/dompurify@3.1.5/dist/purify.min.js"]) {
      const s = document.createElement("script");
      s.src = src; s.onload = () => --n || ok(); s.onerror = no;
      document.head.appendChild(s);
    }
  });
}

function decisions() {
  const c = A.scorecard || {};
  const out = Object.fromEntries((c.decisions || []).map((x) => [x.id, x]));
  const rows = (A.decisions || []).map((d) => ({ ...d, ...(out[d.id] || {}), call: d.regime?.call, conf: d.regime?.confidence,
    hits: out[d.id]?.tilt_hits ? `${out[d.id].tilt_hits.filter(Boolean).length}/${out[d.id].tilt_hits.length}` : "–" }));
  const h = c.helped || {}, t = c.tilts || {};
  $("ag-d-meta").textContent = `helped ${h.yes ?? 0} of ${h.n ?? 0}${h.p_value != null ? ` (p ${h.p_value})` : ""} · tilts right ${t.right ?? 0} of ${t.n ?? 0}`;
  renderTable($("ag-decisions"), rows, [
    { key: "id", label: "#" },
    { key: "decided_date", label: "Decided", fmt: day },
    { key: "fill_date", label: "Filled", fmt: day },
    { key: "status", label: "Status", fmt: (v) => pill(v, v === "filled" ? "on" : v?.startsWith("superseded") ? "muted" : "warn") },
    { key: "call", label: "Regime call", cls: () => "note" },
    { key: "conf", label: "Conf." },
    { key: "turnover", label: "Turnover", num: true, fmt: (v) => fmtPct(v) },
    { key: "cost", label: "Cost", num: true, fmt: (v) => (v == null ? "–" : usd(v)) },
    { key: "ret", label: "Held week", num: true, fmt: (v) => el("span", { class: tone(v), text: fmtSigned(v, 2) }) },
    { key: "vs_6040", label: "vs 60/40", num: true, fmt: (v) => el("span", { class: tone(v), text: fmtSigned(v, 2) }) },
    { key: "no_change_ret", label: "If unchanged", num: true, fmt: (v) => fmtSigned(v, 2) },
    { key: "helped", label: "Helped", fmt: (v) => (v == null ? "–" : pill(v ? "yes" : "no", v ? "up" : "down")) },
    { key: "hits", label: "Tilts right" },
  ], { sortKey: "decided_date", empty: "No decisions yet." });
}

function calls() {
  const c = A.scorecard?.calls || {};
  $("ag-r-meta").textContent = c.scored ? `${c.agent_right} of ${c.scored} right vs ${c.persistence_right} for "nothing changes"` : "none scored yet";
  $("ag-r-note").textContent = `Each call is scored ${c.horizon_days || 28} days after the decision against the quadrant the macro state then held, beside the forecast that nothing changes. Brier score (lower is better): agent ${c.brier ?? "–"}, persistence ${c.brier_persistence ?? "–"}.`;
  renderTable($("ag-calls"), c.rows || [], [
    { key: "id", label: "#" },
    { key: "call", label: "Agent's call" },
    { key: "at_decision", label: "Quadrant then" },
    { key: "outcome", label: "Quadrant 4 weeks on", fmt: (v) => v || "pending" },
    { key: "right", label: "Right", fmt: (v) => (v == null ? "–" : pill(v ? "yes" : "no", v ? "up" : "down")) },
    { key: "brier", label: "Brier", num: true },
  ], { empty: "No calls yet." });
}

function trades() {
  const t = A.trades || [];
  $("ag-t-meta").textContent = `${t.length} trades`;
  renderTable($("ag-trades"), t, [
    { key: "date", label: "Date", fmt: day },
    { key: "decision", label: "Decision" },
    { key: "symbol", label: "Line" },
    { key: "side", label: "Side", fmt: (v) => pill(v, v === "buy" ? "up" : "down") },
    { key: "units", label: "Units", num: true, fmt: (v) => Number(v).toFixed(2) },
    { key: "price", label: "Close", num: true, fmt: (v) => Number(v).toFixed(2) },
    { key: "value", label: "Value", num: true, fmt: (v) => usd(v) },
    { key: "cost", label: "Cost", num: true, fmt: (v) => money(v, "USD", 2) },
  ], { sortKey: "date", empty: "No trades yet." });
}

function runs() {
  const r = A.runs || [];
  $("ag-u-meta").textContent = `${r.length} runs`;
  renderTable($("ag-runs"), r, [
    { key: "at", label: "When", fmt: day },
    { key: "kind", label: "Kind" },
    { key: "status", label: "Status", fmt: (v) => pill(v, STATUS_TONE[v]) },
    { key: "reasons", label: "Why it failed", cls: () => "note", fmt: (v) => (v && v.length ? v.join("; ") : "–") },
    { key: "stop", label: "Stopped" },
    { key: "tool_calls", label: "Tool calls", num: true },
    { key: "list_cost_usd", label: "API cost", num: true, fmt: (v) => (v == null ? "–" : `$${Number(v).toFixed(2)}`) },
  ], { sortKey: "at", empty: "No runs yet." });
}

function changes() {
  renderTable($("ag-log"), A.changes || [], [
    { key: "at", label: "When", fmt: day },
    { key: "kind", label: "What" },
    { key: "text", label: "Change", cls: () => "note" },
  ], { sortKey: "at", empty: "No changes recorded yet." });
}

function briefings() {
  const b = A.briefings || [];
  if (!b.length) return;
  $("ag-b-panel").hidden = false;
  renderTable($("ag-brief"), b, [
    { key: "at", label: "When", fmt: day },
    { key: "title", label: "Title" },
    { key: "summary", label: "Summary", cls: () => "note" },
  ], { sortKey: "at" });
}

function rules() {
  $("ag-rules").textContent = A.rules?.text || "";
  renderTable($("ag-universe"), A.rules?.universe || [], [
    { key: "symbol", label: "Line" },
    { key: "bucket", label: "Bucket" },
    { key: "name", label: "Index", cls: () => "note" },
    { key: "cost_bp", label: "Cost a side (bp)", num: true },
  ]);
}

async function main() {
  renderShell();
  applyChartDefaults();
  try { A = await loadJSON("data/macro_agent.json"); } catch (err) { showError($("error"), new Error("The macro agent has not published yet.")); return; }
  setAsOf(A.last_marked || String(A.built).slice(0, 10), "MARKED", { maxAge: 4 });
  strip(); verdict(); chart(); holdingsTable(); decisions(); calls(); trades(); runs(); changes(); briefings(); rules();
  await latest();
  onThemeChange(() => { applyChartDefaults(); chart(); });
}

main();
