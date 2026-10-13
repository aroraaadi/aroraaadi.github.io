/* Findings (src/ops/findings.py -> data/findings.json): every question tested, null results first. */

import { loadJSON, showError, el, fmtDate, renderStats, renderTable } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const $ = (id) => document.getElementById(id);
const TONE = { failed: "down", nothing: "note", tracked: "note", inconclusive: "warn", passed: "up" };

(async function init() {
  renderShell();
  let D;
  try { D = await loadJSON("data/findings.json"); } catch (err) { showError($("error"), err); return; }
  setAsOf(D.as_of);
  const c = D.counts || {};
  renderStats("fd-strip", [
    { label: "Questions", value: String(D.rows.length) },
    { label: "Failed", value: String(c.failed || 0), delta: "lost money or fell apart out of sample" },
    { label: "Nothing found", value: String(c.nothing || 0), delta: "no effect beyond chance" },
    { label: "Passed", value: String(c.passed || 0), delta: "what the books use" },
  ]);
  $("fd-meta").textContent = `as of ${fmtDate(D.as_of)}`;
  renderTable($("fd-tbl"), D.rows, [
    { key: "verdict", label: "Verdict", fmt: (v) => el("span", { class: `pill ${TONE[v] || ""}`, text: v }) },
    { key: "area", label: "Area", cls: () => "note" },
    { key: "question", label: "Question", cls: () => "wrap" },
    { key: "tested", label: "How it was tested", cls: () => "note wrap" },
    { key: "result", label: "Result", cls: () => "wrap" },
    { key: "decision", label: "Decision", cls: () => "note wrap" },
    { key: "page", label: "", fmt: (v) => (v ? el("a", { href: (window.ASSET_BASE || "") + v, text: "details" }) : "") },
  ]);
})();
