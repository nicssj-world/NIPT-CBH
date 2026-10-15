# Owner-approved F52 Master update — 15 October 2026

The F52 formula issue is **RESOLVED**. No further owner decision is requested.

## Current Master and integrity

- File: `Final_New_Task_List_Edit_2_F52_Corrected.xlsx`
- SHA-256 verified: `2f8aef50243c89eae6a4e9115d65fbf9239754a1bd9ce330205378f3a9b3aacf`
- Current integrity manifest: `packages/workbook/master-manifest.json`, copied from the supplied approved manifest and checked against the actual workbook.
- All six worksheet XML hashes, styles XML hash and all twelve embedded media hashes match the manifest.
- Restoring only F52's formula text in memory to the previous expression reproduces the previous locked sheet5 XML hash. This is a verification comparison only; neither Master was rewritten.
- Comparison against the previous verified derivative finds exactly one changed formula, F52. All other 148 formulas match; total remains 149. Forty-eight non-worksheet archive parts match byte-for-byte, covering fonts/styles, drawings/anchors, media, relationships and printer settings. Worksheet hashes and the approved single-expression comparison also preserve row/column layout, merges and page setup.

## Binding and calculations

`pool.dilutionC1` remains the editable numeric input at `Pooling Table!D52`. Draft values, including zero, can be saved and resumed. The editor shows a Thai notice for absent, zero, negative or invalid concentration: enter D52 greater than zero before using F52/D55. Formula text is never rewritten by input validation.

Native Excel recalculation produced:

| D52 | F52 `=(D54*F54)/D52` | D55 `=F54-F52` |
|---:|---:|---:|
| 10 | 33.3 | 66.7 |
| 20 | 16.65 | 83.35 |

Each value was saved as a new draft, resumed, exported to XLSX and exported to Pooling PDF. The PDF export's generated-XLSX hash equals the corresponding XLSX download hash. Both native Pooling exports report zero formula errors. Excel remains the calculation authority; there is no replacement JavaScript calculation.

The native export port also validated Task Lists 1–3 as two portrait A4 pages each while generating these derivatives. Existing font/layout/page-setup behavior was retained. This focused update does not recertify the outstanding 100% visual-fidelity acceptance for the overall system.

## Compatibility

Migration `091_owner_approved_f52_master.sql` preserves old immutable revisions and exports. Only new revisions with the approved current hash are accepted. Old-master drafts are marked stale and cannot create new exports until explicitly saved/rebound to the new Master. Historical downloads retain their original bytes and provenance.

An upgrade test migrates through 090, creates an old-master draft, applies 091 twice, verifies history remains unchanged, refuses export of the old revision and successfully rebinds a new revision. No previously applied migration file was edited and no shared/Production migration was applied.

## Focused validation and evidence

- Initial affected workbook checks: 11 passed, including real native Excel calculations at both concentrations.
- Upgrade/readiness/integrity checks: 3 passed; the separate native-Excel test is opt-in and was already exercised in the initial run.
- Focused browser test: **1 passed** in `.local/f52-browser-final.log`, artifacts `.local/browser-regression-2nKRmV`; tests missing/zero notice, save/reload/resume, XLSX download and actual native Pooling PDF preview. The first attempt hit an exact-label test locator mismatch; selecting the actual combobox fixed the test without changing application behavior.
- Typecheck, lint, source guard and production build: checked in `.local/f52-*.log`.
- Calculation artifacts: `.local/workbook-f52-approved/evidence.json`, `d52-10.xlsx`, `d52-10.pdf`, `d52-20.xlsx`, `d52-20.pdf`.
- Integrity evidence: `.local/workbook-f52-approved/integrity.json`.

Resampling/PET, Operational Lab/Results/P6 and the previously passed full browser suite were not rerun. The remaining controlled-document lifecycle, binding-exhaustiveness and complete positive operational journey gaps are tracked in `operational-completion-delivery.md`; this update closes the F52 blocker only. No Windows package, push or merge was performed.
