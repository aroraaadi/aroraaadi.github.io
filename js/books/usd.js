/* The USD book, as the site sees it.

   The mirror of books/usd.py: everything here is a presentation choice that
   follows from "this book is run by the engine" — it is measured against a
   model target, its names are in the PCA risk model, and it has a DCF page
   and a fundamentals page the other book does not. */

export const SPEC = {
  key: "usd",
  runBy: "run by the engine",

  // Held vs the optimizer's published target.
  driftTitle: "Held vs the engine's target",
  driftLabel: "Drift vs target",
  targetLabel: "Target",
  driftMeta: (b) => (b.target_as_of ? `target as of ${b.target_as_of}` : "engine target"),
  // The engine trades quarterly with a 30% partial adjustment, so a gap is the
  // normal state of this book; only a large one is worth colouring.
  driftTone: (gap) => (gap > 0.25 ? "down" : ""),
  gapAlert: 0.03,

  showModelColumn: true,   // "in model" / "outside model" per holding
  modelToggle: true,       // analytics can also show the target weights
  factorPanel: true,       // these names ARE the PCA risk model's universe
  legacyLedger: true,      // the pre-split CIBC ledger belongs to this lineage

  symbolLink: (sym) => `${window.ASSET_BASE || ""}usd/fundamentals.html#${sym}`,
};
