# Tender Comparison (Standalone Export)

Standalone, concept-tab-free implementation of the Tender Comparison table.

## Files

- `index.html` — Page shell and table layout (open directly in any modern browser, or serve via any static HTTP server).
- `styles.css` — Sticky columns, breakdown fold/unfold animations, deprioritized previous-resubmission styling, and soft row rework focus styling.
- `data.js` — BOQ tiers (`10-20A`, `25-30A`, `40-60A`), 12 tenderers, and per-tenderer submission histories.
- `app.js` — Evaluation logic, 17-rule cell colour/arrow/alert engine, `Price Statistics` column group (`Median` / `Mean` / `Min Price`), per-row `Need Rework` + inline chat comments (`localStorage`), and hover progression tooltips.

## Quick Start

Double-click `index.html` in your browser, or run:

```bash
python3 -m http.server 8000
```
and visit `http://localhost:8000`.
