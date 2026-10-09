/* Earnings calls: coverage across the traded names, and a reader.

   index.json says which names were pulled and what kinds of document each
   actually has; <TICKER>.json holds the text, loaded only when that name is
   opened. Nothing is invented when a file is missing — the page says what
   to run instead. */

import { loadJSON, showError, el, renderStats, renderTable, fmtDate } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const set = (id, t) => { const n = document.getElementById(id); if (n) n.textContent = t; };
const KIND_ORDER = ["call_fmp", "transcript", "prepared_remarks", "shareholder_letter", "press_release", "presentation", "other"];
const SHORT = { call_fmp: "Call (FMP)", transcript: "Transcript", prepared_remarks: "Remarks", shareholder_letter: "Letter",
                press_release: "Release", presentation: "Slides", other: "Other" };
const CALL_KINDS = new Set(["call_fmp", "transcript", "prepared_remarks", "shareholder_letter"]);
let IDX = null, CUR = null, DOCS = [];

function coverage() {
  const rows = IDX.names.map((r) => ({
    symbol: r.symbol, name: r.name, filings: r.filings || 0, latest: r.latest_report || (r.latest || "").slice(0, 10) || null,
    call: KIND_ORDER.filter((k) => CALL_KINDS.has(k) && r.counts?.[k]).length > 0,
    counts: r.counts || {}, status: r.status,
  }));
  renderTable(document.getElementById("tx-cov"), rows, [
    { key: "symbol", label: "Name", fmt: (v) => el("span", { class: "sym", text: v }) },
    { key: "name", label: "Company", cls: () => "muted", fmt: (v, r) => (v && v !== r.symbol ? v : "—") },
    { key: "call", label: "Call content", fmt: (v, r) => r.status !== "ok" ? el("span", { class: "pill muted", text: r.status })
        : el("span", { class: `pill ${v ? "up" : "muted"}`, text: v ? "yes" : "release only" }) },
    { key: "counts", label: "Documents", fmt: (c) => el("span", { class: "flags" },
        KIND_ORDER.filter((k) => c[k]).map((k) => el("span", { class: `pill ${CALL_KINDS.has(k) ? "book" : ""}`, text: `${SHORT[k]} ${c[k]}` }))) },
    { key: "filings", label: "Quarters", num: true },
    { key: "latest", label: "Latest", fmt: (v) => (v ? fmtDate(v) : "—") },
  ], { sortKey: "symbol", dir: 1 });
  const tbody = document.querySelector("#tx-cov tbody");
  [...tbody.querySelectorAll("tr")].forEach((tr) => {
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => { const s = tr.querySelector(".sym")?.textContent; if (s) { document.getElementById("tx-sym").value = s; openName(s); } });
  });
}

function docList(data) {
  const out = [];
  for (const c of data.calls || []) out.push({ ...c, label: `${c.period || c.date} · call transcript (FMP)` });
  for (const f of data.filings || []) {
    for (const d of f.documents) {
      out.push({ ...d, label: `${f.report_date || (f.accepted || "").slice(0, 10)} · ${(IDX.labels || {})[d.kind] || d.kind} · ${d.exhibit}` });
    }
  }
  return out;
}

function highlight(text, q) {
  if (!q) return [document.createTextNode(text)];
  const out = [], lower = text.toLowerCase(), ql = q.toLowerCase();
  let i = 0, j;
  while ((j = lower.indexOf(ql, i)) !== -1) {
    if (j > i) out.push(document.createTextNode(text.slice(i, j)));
    out.push(el("mark", { text: text.slice(j, j + q.length) }));
    i = j + q.length;
  }
  if (i < text.length) out.push(document.createTextNode(text.slice(i)));
  return out;
}

function render() {
  const host = document.getElementById("tx-body"); host.innerHTML = "";
  const d = DOCS[Number(document.getElementById("tx-doc").value)];
  if (!d) { host.appendChild(el("p", { class: "tx-empty", text: "No documents for this name." })); set("tx-doc-meta", ""); return; }
  const q = document.getElementById("tx-find").value.trim();
  set("tx-doc-meta", [d.source === "FMP" ? "FMP transcript feed" : `${d.form} ${d.exhibit}`,
    d.accepted ? `accepted ${d.accepted.replace("T", " ").slice(0, 16)} UTC` : d.date,
    `${(d.words || 0).toLocaleString()} words`, d.evidence].filter(Boolean).join(" · "));
  let hits = 0;
  if (d.turns && d.turns.length) {
    for (const t of d.turns) {
      if (q && !t.text.toLowerCase().includes(q.toLowerCase()) && !(t.speaker || "").toLowerCase().includes(q.toLowerCase())) continue;
      if (q) hits += 1;
      const role = (t.role || "").toLowerCase();
      const cls = ["tx-turn", t.speaker === "Operator" ? "op" : "", role.includes("analyst") ? "analyst" : ""].filter(Boolean).join(" ");
      host.appendChild(el("div", { class: cls }, [
        t.speaker ? el("div", { class: "tx-who" }, [document.createTextNode(t.speaker), t.role ? el("span", { class: "tx-role", text: t.role }) : null]) : null,
        el("p", {}, highlight(t.text, q)),
      ]));
    }
  } else {
    for (const para of d.text.split(/\n\n+/)) {
      if (q && !para.toLowerCase().includes(q.toLowerCase())) continue;
      if (q) hits += 1;
      host.appendChild(el("p", {}, highlight(para, q)));
    }
  }
  if (!host.childNodes.length) host.appendChild(el("p", { class: "tx-empty", text: q ? `No passage mentions “${q}”.` : "This document has no text." }));
  set("tx-hits", q ? `${hits} passage${hits === 1 ? "" : "s"}` : "");
  if (d.url) host.appendChild(el("p", { class: "note" }, [el("a", { href: d.url, text: "Open the filing on SEC.gov →", target: "_blank", rel: "noopener" })]));
}

async function openName(sym) {
  CUR = sym;
  const sel = document.getElementById("tx-doc"); sel.innerHTML = "";
  try {
    const data = await loadJSON(`data/transcripts/${sym}.json`);
    if (CUR !== sym) return;
    DOCS = docList(data);
  } catch (e) {
    DOCS = [];
  }
  // Call content first: that is what the page is for.
  DOCS.sort((a, b) => (CALL_KINDS.has(b.source === "FMP" ? "call_fmp" : b.kind) - CALL_KINDS.has(a.source === "FMP" ? "call_fmp" : a.kind)));
  DOCS.forEach((d, i) => sel.appendChild(el("option", { value: String(i), text: d.label })));
  render();
}

(async function init() {
  renderShell();
  try {
    IDX = await loadJSON("data/transcripts/index.json");
  } catch (e) {
    set("tx-meta", "Not pulled yet.");
    showError(document.getElementById("error"), new Error(
      "no earnings documents have been pulled. SEC requires a named contact: put 'Your Name you@example.org' in .sec_contact at the repo root (gitignored), then run python3 run_transcripts.py"));
    document.getElementById("tx-reader").hidden = true;
    return;
  }
  setAsOf(IDX.as_of.slice(0, 10), "AS OF", { maxAge: 8 });   // refreshed weekly (run_daily WEEKLY) from quarterly filings
  const pulled = IDX.names.filter((r) => r.status === "ok");
  const withCall = IDX.with_call_content || [];
  const fmp = IDX.fmp_transcripts || {};
  set("tx-meta", `Pulled ${IDX.as_of.replace("T", " ").slice(0, 16)} UTC · last ${IDX.limit} results filings per name · ${IDX.source}`);
  renderStats("tx-strip", [
    { label: "Names", value: String(IDX.names.length), delta: `${pulled.length} with SEC results filings` },
    { label: "With call content", value: String(withCall.length), delta: "remarks, letters or transcripts" },
    { label: "Full transcripts", value: String((IDX.with_transcripts || []).length), delta: (IDX.with_transcripts || []).join(", ") || "none filed" },
    { label: "FMP call feed", value: fmp.available ? "on" : "off", tone: fmp.available ? "up" : "", delta: fmp.available ? "every name, with Q&A" : (fmp.reason || "") },
  ]);
  set("tx-cov-note", IDX.pulled === false ? IDX.reason : "click a row to open it");
  set("tx-note", IDX.note);
  coverage();
  if (IDX.pulled === false) {
    set("tx-meta", `Not pulled yet — ${IDX.reason}. ${IDX.source}.`);
    document.getElementById("tx-reader").hidden = true;
    return;
  }
  const sel = document.getElementById("tx-sym");
  pulled.map((r) => r.symbol).sort().forEach((s) => sel.appendChild(el("option", { value: s, text: s })));
  sel.addEventListener("change", () => openName(sel.value));
  document.getElementById("tx-doc").addEventListener("change", render);
  document.getElementById("tx-find").addEventListener("input", render);
  const first = withCall.find((s) => pulled.some((r) => r.symbol === s)) || pulled[0]?.symbol;
  if (first) { sel.value = first; openName(first); }
})();
