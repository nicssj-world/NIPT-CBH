# Task1 export / workbook / result-correlation validation

Scope: Owner-locked Task1 requirements 2, 4, 6 and 8; synthetic local evidence only. No commit, push, deployment, real hospital database or HIS transmission.

## Implemented

- NIFTY removes only terminal analytical `-1` or `-2` in its existing column A. HALOS retains the full analytical ID. Re-Library/Re-Extraction repeats are included with their actual internal attempt provenance.
- Both vendor exports reject ambiguous repeated vendor IDs in one active file. Internal mapping retains case, round, attempt, physical slot and overall ordinal without adding vendor columns. Export records retain batch, workbook revision and file hash.
- Exceptional Task identifiers use appended derivative red-font styles. The original Master, original fonts/styles, sheet layout, formulas and vendor template bytes are unchanged.
- Locked metadata renders from the latest authorized Task plan; frozen clinical/placement source and prior artifacts stay unchanged. Metadata-only changes do not invalidate actual pooling or require a new draft revision. Each export records a metadata snapshot and hash.
- Actual native rendering revealed clipping of reagent expiry values when Excel combined `wrapText` with `shrinkToFit`. Only the filled derivative reagent LOT/EXP cells disable wrapping; the fixed Master and its original styles remain unchanged. Reverification reads back both complete expiry values from the real PDF.
- Result candidate search no longer truncates at 60 historical candidates, which could conceal another matching case after repeated visible IDs. Unique current-round/latest-attempt and all identity predicates remain required; no new attempt picker or clinical release exception was added.

## Actual checks

| Command / check | Actual result |
|---|---|
| `npm.cmd exec vitest run tests/contracts/lab-owner-nifty.test.ts tests/contracts/lab-owner-task-import.test.ts tests/contracts/workbook-control-highlights.test.ts tests/db/lab-repeat-export.test.ts tests/db/workbook-metadata-source.test.ts` | 5 files, 22 tests PASS |
| `npm.cmd exec vitest run tests/unit/task1-result-correlation.test.ts tests/unit/task1-exceptional-highlight.test.ts tests/db/p5a-auto-link.test.ts tests/db/lab-owner-bench.test.ts tests/db/operational-workbook.test.ts` | 5 files, 11 tests PASS |
| `npm.cmd exec vitest run tests/contracts/workbook-binding-fidelity.test.ts tests/unit/task1-exceptional-highlight.test.ts tests/db/workbook-metadata-source.test.ts` after derivative fitting correction | 3 files, 5 tests PASS; exhaustive 316 bindings verified |
| `$env:NIPT_TASK1_NATIVE_VERIFY='yes'; npm.cmd exec vitest run tests/db/task1-workbook-native-metadata.test.ts` | 1 test PASS; disposable DB → locked six-field edit → original revision → native Excel PDF; full metadata readback and frozen source/placement verified |
| `npm.cmd exec vitest run tests/db/lab-repeat-export.test.ts tests/contracts/lab-owner-nifty.test.ts tests/contracts/lab-owner-task-import.test.ts tests/unit/task1-result-correlation.test.ts` final run | 4 files, 22 tests PASS; both export mapping readbacks, repeat inclusion and metadata-only pooling-currentness verified |
| `npm.cmd exec tsx tools/operational/task1-export-evidence.ts` | Real Microsoft Excel export of all six sheets; 149 formulas preserved; native page counts 2/2/2/1/1/1 |
| PyMuPDF readback + screenshot | Exceptional identifiers red `0xFF0000` in all three Task PDFs; complete latest date/operator/both LOT+EXP values present; Thai text present |
| Playwright label preview/DOM | Two synthetic S2/S3/twin examples: 4 stickers / 8 halves each, 50×20 mm, HIS LN present, persistent R, no code overflow |
| Targeted ESLint and `git diff --check` | PASS (only Git CRLF conversion notices) |

Native Excel required the authorized elevated local test because sandbox denied `Get-PrintConfiguration`. Existing renderer restores the printer configuration. PDF.js emitted existing `TT: undefined function: 21` font warnings; readback and native page checks passed. Owner visual acceptance is separate.

## Artifacts and unchanged sources

Evidence: `.local/task1-owner-20261023/exports/manifest.json`, `pdf-readback.json`, `task1-generated.xlsx`, `task-1.pdf` through `task-6.pdf`, `task-1-page1.png` through `task-3-page1.png`, `service-latest-metadata.{xlsx,pdf,json}`, `nifty-exceptional.xlsx`, `halos-exceptional.xlsx`, `S2-S3-label-preview.{html,png}`, `labels-dom-evidence.json`.

- Six-sheet Master SHA-256: `4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1`.
- NIFTY source template SHA-256: `07c2cd582b85769b789a0ec1f952d623664366c96dcbc28953b1c3c8b07a0ebc`.
- HALOS source template SHA-256: `1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec`.

## NOT VERIFIED / NOT READY boundaries

**2026-10-24 Owner clarification:** the external No Call report uses the existing normal PDF structure with explicit `Result = No Call`. The historical missing-contract blocker below describes the original 2026-10-23 state. Parser 1.0.2 and the subsequent Task1 external-No-Call integration now implement that clarified outcome through existing import/link/review/certify/delivery gates. See `tests/unit/task1-no-call-parser.test.ts`, `tests/db/task1-external-no-call.test.ts`, `tests/contracts/task1-no-call-native.test.ts` and `.local/task1-owner-resolution-20261024/`. PGlite integration has 6/6 passed. The 2026-10-24 native run `.local/task1-browser-LDr02j/native-contracts.log` has 5 files / 5 tests passed, including the new No Call contract. It independently verifies `app_rw` acceptance/release and `worker_rw` reservation plus actual RES/PDF/OK writes to a disposable local directory; exact external PDF bytes are preserved, RES says No Call, and `hisConfirmed=false`. This is not hospital HIS acceptance.

- Historical finding at 2026-10-23, superseded by the Owner clarification above: genuine external No Call report contract was absent: `packages/results/parser.ts` has only synthetic/unapproved SINGLETON/TWIN/REDRAW_NOTICE/UNKNOWN contracts, no approved No Call evidence disposition. `packages/results/gates.ts` still requires real `FinalQcAccepted` and PDF QC PASS for normal release. No PASS was fabricated and no gate bypass was introduced. The original clinical No Call path was therefore reported NOT READY; that report did not manufacture PASS or bypass a gate.
- Live NIFTY/HALOS machine acceptance, hospital HIS transport and physical label printer acceptance were not run.
- Vendor XLSX styles remain immutable because no approved destination evidence authorizes safe exceptional-color changes. Their exact identifiers/schema are preserved; red is verified on the Task UI/Task XLSX/native Task PDFs. CSV cannot carry color.
- Metadata fits the fixed owner cells using shrinking; physical readability remains for Owner/printer acceptance. Source Master geometry is unchanged.

## Fresh Owner-resolution output check — 2026-10-24

Fresh actual Microsoft Excel derivatives are preserved separately in `.local/task1-owner-resolution-20261024/exports/`, leaving all prior output bytes intact. `manifest.json` records identifiers generated by the current rules: early S3 global3 R-1, S3 repeat global4 R-2 and further-round global5/6 R-1. Readback checks black pre5 IDs and red0xFF0000 global5 IDs; six native PDFs have2/2/2/1/1/1pages. Source six-sheet Master149 formulas and all three template hashes were reread unchanged. Generated Task and external synthetic No Call PDF were visually inspected. Native No Call transport writes/readback preserve exact PDF bytes and No Call RES/OK using temporary local-only settings, with hisConfirmed=false. See the current [validation report](task1-owner-validation-20261023.md) for exact commands and acceptance limits.
