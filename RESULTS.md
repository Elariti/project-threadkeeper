# Results

This page separates what has been **measured** from what has only been **built and tested with a fake model**.

## 1. Automated tests (current version)

| Suite | Result |
|---|---|
| App (`npm test`) | 39 passing |
| Backend (`pytest`) | 33 passing |

These verify the validation logic and the plumbing (for example, that an invented quote is removed). They use a scripted fake model, so they say nothing about the quality of real AI output.

## 2. Pilot with a real Nemotron model (earlier version)

One research project, "How does plastic pollution affect marine ecosystems?", with three review papers (Tekman; Apete; Signa), run through extraction and thread discovery with a Nemotron model via Nebius Token Factory. Figures are counted from the project's Markdown export.

| Measure | Result |
|---|---|
| Items extracted by the AI | 48 |
| Items whose quote was found verbatim in the PDF text | 45 / 48 (94%) |
| Items labelled "AI interpretation" (no usable quote) | 3 |
| Duplicate items (mostly from extracting one paper twice) | 6 pairs, about 15% of items |
| Quotes that were cut-off fragments | 3 |
| Items whose text said more than their quote (e.g. a mis-rendered formula, an organisation not in the quote) | at least 2 |
| Threads proposed / stitched / dismissed at export time | 25 / 1 / 0 |
| Open proposals linking two items from the **same** paper | 13 of 24 (54%) |
| Open proposals linking **different** papers | 5 of 24 (21%) |
| Proposed contradictions | 0 |

**What this shows:** the verbatim-quote check worked (no invented quotes were visible; spot-check against the PDFs before relying on this). The weaknesses were duplicates, fragment quotes, quotes that did not cover the whole item, and thread proposals that mostly stayed inside one paper and never proposed a tension.

**Caveats:** one project, three papers, one reviewer; only 1 of 25 threads had been reviewed, so there is no thread acceptance rate yet.

## 3. Changes made in response

| Pilot finding | Change in this version |
|---|---|
| Duplicates after re-extracting | Extraction skips items already on the map; duplicates merged across chunks; List view offers one-click duplicate removal |
| Fragment quotes | Quotes that are cut off or heading-like are rejected as evidence |
| Quote does not cover the item | Support check (numbers, names, formulas, hedging, key-word coverage) → "Partly sourced" with the reason |
| Cited work presented as the paper's own | "Cites other work" marker |
| Same-paper threads, no tensions | Cross-paper quota, tension cues, per-pair reasoning, new "qualifies" relation, second critical reading, swap direction when editing |

## 4. Not yet measured

- Extraction and thread quality **after** these changes. To measure: re-extract the same three papers, review every proposed thread, export, and compare duplicate rate, partly-sourced rate, cross-paper share, tensions proposed and acceptance rate (the export now includes a review summary).
- Windows-specific behaviour (toast delivery, dragging on scaled displays) beyond manual use.
- Usability with other users.
