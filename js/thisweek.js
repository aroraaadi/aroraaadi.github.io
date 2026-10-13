/* Decisions (src/ops/thisweek.py -> data/thisweek.json): what needs the owner this week. */

import { loadJSON, showError, el, fmtPct, fmtDate, renderStats, renderTable, money } from "./common.js";
import { renderShell, setAsOf } from "./shell.js";

const $ = (id) => document.getElementById(id);

(async function init() {
  renderShell();
  let D;
  try { D = await loadJSON("data/thisweek.json"); } catch (err) { showError($("error"), err); return; }
  setAsOf(D.as_of);
  const u = D.usd, books = Object.entries(D.risk.books || {});
  const past = books.filter(([, v]) => v.state !== "ok");
  renderStats("dc-strip", [
    { label: "USD rebalance", value: u.trade ? "Due" : "Not due", tone: u.trade ? "down" : "up", delta: u.due_on ? `earliest ${fmtDate(u.due_on)}` : "" },
    { label: "Engine suggestions", value: String(u.actions.length), delta: "to accept or reject by hand" },
    { label: "Books past a limit", value: String(past.length), tone: past.length ? "down" : "up" },
    { label: "Needs you today", value: String((D.ops.todo || []).length + (D.ops.red_steps || []).length) },
  ]);
  $("dc-usd-meta").textContent = u.days_since != null ? `${u.days_since} days since the last rebalance; the floor is ${u.floor}` : "";
  $("dc-usd-note").textContent = u.trade ? `A rebalance is due: ${u.reasons.join("; ")}.`
    : `No trade yet. ${u.blocked_by.join("; ") || u.reasons.join("; ") || ""}`;
  renderTable($("dc-gaps"), u.gaps, [
    { key: "symbol", label: "Name" },
    { key: "current", label: "Held", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "target", label: "Target", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "gap", label: "Gap", num: true, fmt: (v) => el("span", { class: v > 0 ? "up" : "down", text: fmtPct(v, 1) }) },
  ], { empty: "Every name is inside its band." });
  const al = $("dc-actions"); al.innerHTML = "";
  (u.actions.length ? u.actions : [{ note: "None this week." }]).forEach((a) => al.appendChild(el("li", { text: [a.type, a.symbol].filter(Boolean).join(" ") + (a.type ? ": " : "") + (a.note || "") })));
  renderTable($("dc-risk"), books.map(([b, v]) => ({ book: b.replace(/_/g, " "), ...v })), [
    { key: "book", label: "Book" },
    { key: "state", label: "State", fmt: (v) => el("span", { class: `pill ${v === "ok" ? "up" : "down"}`, text: v }) },
    { key: "drawdown", label: "From its peak", num: true, fmt: (v) => fmtPct(v, 1) },
  ]);
  $("dc-cap").textContent = D.risk.over_cap.length ? `Over the ${fmtPct(D.risk.name_cap, 0)} cap across the two real accounts: ${D.risk.over_cap.join(", ")}.`
    : "No name is over the cap across the two real accounts.";
  renderTable($("dc-paper"), D.paper, [
    { key: "book", label: "Book", fmt: (v, r) => el("a", { href: (window.ASSET_BASE || "") + r.page, text: v }) },
    { key: "nav", label: "Value", num: true, fmt: (v) => (v == null ? "–" : money(v, "USD", 0)) },
    { key: "ret", label: "Return", num: true, fmt: (v) => fmtPct(v, 1) },
    { key: "line", label: "Now", cls: () => "note wrap" },
  ]);
  const ol = $("dc-ops"); ol.innerHTML = "";
  const items = [...(D.ops.todo || []), ...(D.ops.red_steps || [])];
  if (D.ops.ai_spend) items.push(`AI spend this month: $${D.ops.ai_spend.spent.toFixed(2)} of $${D.ops.ai_spend.cap.toFixed(0)}`);
  (items.length ? items : ["Nothing."]).forEach((t) => ol.appendChild(el("li", { text: t })));
})();
