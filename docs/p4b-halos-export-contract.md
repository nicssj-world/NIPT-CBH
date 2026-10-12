# P4b HALOS export contract — synthetic only

Status: independent proposal for P4 integration; no Database/API/UI integration, no HALOS connection, no vendor-compatible file, no AL-4b acceptance. Base: `10a646f80b1d65837985e18a916eb95bcff0b456`. Branch: `feat/p4b-halos-export-contract`.

## Binding evidence and supersession

Sources read from `C:\Users\User\OneDrive\Desktop\NIPT-Audit`:

- `NIPT_CBH_Implementation_Plan_v6.2.1_Reviewed_2026-10-11.md`: D-65, §12.23, OD-35, §15 P4b/AL-4b, AT-HALOS-HANDOFF-01..03. Requires immutable Pool/Placement provenance, ordered identity/barcode correspondence, manifest/hash, and pre-sequencing verification.
- `NIPT_HALOS_Task_Import_Template_Audit_2026-10-11.md`: §§1–4 source observations; §§8–11 unresolved identity/date/vendor semantics. Its 48-record proposal is superseded.
- `NIPT_CBH_P0_HALOS_Template_Audit_Reconciliation_2026-10-11.md`: FINAL OWNER LOCK and §3 settle 47 rows, omitted Barcode13 and no Row49; historical contradictory tables below that lock are not instructions.
- `NIPT_CBH_P0_HALOS_48_Row_Mapping_Dry_Run_2026-10-11.md`: explicitly marked SUPERSEDED; **none of its compacted physical-to-logical mapping is implemented**.
- `NIPT_CBH_P0_OD35_HALOS_47_Row_Export_Owner_Lock_2026-10-11.md`: authoritative owner clarification, especially §§2–4.
- `NIPT_Task_List_Deep_Audit_2026-10-11.md`: §§2–3, physical PC1/NC25/Blank40, source `Pooling Table!A26` mapping defect, and distinct physical/control/identity domains. Existing audit used; no repeat audit of the six-sheet workbook.
- `Task Import template.xlsx`: directly read as ZIP/OOXML, original never saved or copied into Git.

Actual local XLSX: **11,074 bytes**, SHA-256 `1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec`. It matches the audited `Task Import template(2).xlsx` bytes by digest. This establishes evidence identity, not official vendor-master status. ZIP CRC passed. Single `Sheet1`, dimension `A1:E48`, header plus 47 rows. Source hash verified before/after read. Reproduce the narrow check (Python standard library; no Excel required):

```powershell
python tools/inspect-halos-template.py 'C:\Users\User\OneDrive\Desktop\NIPT-Audit\Task Import template.xlsx'
```

## Cell contract

| Source cell/range | Observed original | Synthetic plan rule |
| --- | --- | --- |
| A1 | `*Sample ID` | Exact header |
| B1 | `*Lane ID` | Exact header |
| C1 | `*DNB ID\n(20 characters limited)` | Exact actual LF, not a literal backslash-n |
| D1 | `*Barcode ID` | Exact header |
| E1 | `Sub-Library Conc. (ng/μl)` | Exact Greek μ U+03BC |
| A2:A48 | 47 styled blank cells | 47 supplied `exportSampleId` values, explicitly typed strings |
| B2:B48 | 47 shared strings `L01` | Preserve literal string |
| C2 | String placeholder `DNBYYYYMMDD` | Reject placeholder; copy supplied date-coded DNB ID |
| C3:C48 | 46 styled blanks | Copy same supplied DNB ID into all member rows per owner lock |
| D2:D13 | Numeric 1..12 | Copy validated snapshot barcode values unchanged |
| D14:D48 | Numeric 14..48 | Copy unchanged; no Barcode13 insertion |
| E2:E48 | No cell nodes | Plan `{type:'blank'}`, no value/formula/zero/empty string |
| Row49 | Absent | Never add row/sentinel |

Column A's source blanks are placeholders to populate only from a supplied frozen member ID. Column E remains blank. HALOS Barcode13 has **no row**; do not insert a blank A row for it. Source physical Blank40 remains excluded; it is not the HALOS numbering domain. Conditional formatting at A40 does not establish physical40 correspondence.

## Complete row mapping matrix

This maps **template cells to supplied ordered members only**. Physical position and PC/NC-to-HALOS association are copied as fixture lineage, not inferred from row, barcode or the historical compaction table. The actual clinical 47-member association remains pending.

| Ordered member | Template/output cells | Observed D cell/value | Required source |
| ---: | --- | --- | --- |
| 1 | `A2:E2` | `D2=1` numeric | snapshot.members[0] |
| 2 | `A3:E3` | `D3=2` numeric | snapshot.members[1] |
| 3 | `A4:E4` | `D4=3` numeric | snapshot.members[2] |
| 4 | `A5:E5` | `D5=4` numeric | snapshot.members[3] |
| 5 | `A6:E6` | `D6=5` numeric | snapshot.members[4] |
| 6 | `A7:E7` | `D7=6` numeric | snapshot.members[5] |
| 7 | `A8:E8` | `D8=7` numeric | snapshot.members[6] |
| 8 | `A9:E9` | `D9=8` numeric | snapshot.members[7] |
| 9 | `A10:E10` | `D10=9` numeric | snapshot.members[8] |
| 10 | `A11:E11` | `D11=10` numeric | snapshot.members[9] |
| 11 | `A12:E12` | `D12=11` numeric | snapshot.members[10] |
| 12 | `A13:E13` | `D13=12` numeric | snapshot.members[11] |
| 13 | `A14:E14` | `D14=14` numeric | snapshot.members[12] |
| 14 | `A15:E15` | `D15=15` numeric | snapshot.members[13] |
| 15 | `A16:E16` | `D16=16` numeric | snapshot.members[14] |
| 16 | `A17:E17` | `D17=17` numeric | snapshot.members[15] |
| 17 | `A18:E18` | `D18=18` numeric | snapshot.members[16] |
| 18 | `A19:E19` | `D19=19` numeric | snapshot.members[17] |
| 19 | `A20:E20` | `D20=20` numeric | snapshot.members[18] |
| 20 | `A21:E21` | `D21=21` numeric | snapshot.members[19] |
| 21 | `A22:E22` | `D22=22` numeric | snapshot.members[20] |
| 22 | `A23:E23` | `D23=23` numeric | snapshot.members[21] |
| 23 | `A24:E24` | `D24=24` numeric | snapshot.members[22] |
| 24 | `A25:E25` | `D25=25` numeric | snapshot.members[23] |
| 25 | `A26:E26` | `D26=26` numeric | snapshot.members[24] |
| 26 | `A27:E27` | `D27=27` numeric | snapshot.members[25] |
| 27 | `A28:E28` | `D28=28` numeric | snapshot.members[26] |
| 28 | `A29:E29` | `D29=29` numeric | snapshot.members[27] |
| 29 | `A30:E30` | `D30=30` numeric | snapshot.members[28] |
| 30 | `A31:E31` | `D31=31` numeric | snapshot.members[29] |
| 31 | `A32:E32` | `D32=32` numeric | snapshot.members[30] |
| 32 | `A33:E33` | `D33=33` numeric | snapshot.members[31] |
| 33 | `A34:E34` | `D34=34` numeric | snapshot.members[32] |
| 34 | `A35:E35` | `D35=35` numeric | snapshot.members[33] |
| 35 | `A36:E36` | `D36=36` numeric | snapshot.members[34] |
| 36 | `A37:E37` | `D37=37` numeric | snapshot.members[35] |
| 37 | `A38:E38` | `D38=38` numeric | snapshot.members[36] |
| 38 | `A39:E39` | `D39=39` numeric | snapshot.members[37] |
| 39 | `A40:E40` | `D40=40` numeric | snapshot.members[38] |
| 40 | `A41:E41` | `D41=41` numeric | snapshot.members[39] |
| 41 | `A42:E42` | `D42=42` numeric | snapshot.members[40] |
| 42 | `A43:E43` | `D43=43` numeric | snapshot.members[41] |
| 43 | `A44:E44` | `D44=44` numeric | snapshot.members[42] |
| 44 | `A45:E45` | `D45=45` numeric | snapshot.members[43] |
| 45 | `A46:E46` | `D46=46` numeric | snapshot.members[44] |
| 46 | `A47:E47` | `D47=47` numeric | snapshot.members[45] |
| 47 | `A48:E48` | `D48=48` numeric | snapshot.members[46] |

No ordinal or Barcode13 member exists outside those 47 rows. Output order must already equal the source-audited barcode sequence; wrong order is rejected rather than sorted.

## Proposed P4 adapter boundary

`packages/halos-export/contract.ts` exposes `HalosSnapshotInput`, `buildHalosCellPlan(unknown)` and `verifyHalosCellPlan(snapshot, candidate)`. It imports only Node crypto and Zod. No DB, API, env, clock, filesystem or network calls; no P4/P2/P3 imports. This DTO is proposed, **not a locked P4 persistence schema**.

The future adapter must obtain an immutable accepted Pool snapshot and its exact Placement/Batch revisions in an authorized read, check eligibility/currentness, and pass frozen values without retyping or recreating identifiers. This patch does not implement that adapter or assert that a caller-provided revision proves persisted immutability.

| Input | Meaning |
| --- | --- |
| contract/mode/mappingStatus | Exact internal v1 contract, `synthetic`, `synthetic-fixture-unverified`; production/verified claims rejected |
| batch / placement / pool | Opaque snapshot ID and positive revision for each |
| handoffRevision / templateSha256 | Caller-supplied revision and pinned inspected template digest |
| dnb | Existing ID, YYYY-MM-DD workDate, explicit `intended` or `actual` basis; format/date consistency checked |
| excludedBlank | Explicit nominal source physical40, BLANK, no HALOS row |
| members | Exactly 47 already-ordered frozen member records |
| memberKey / physicalPosition / role | Snapshot lineage, complete nominal physical positions except40, PC1/NC25/45 patients |
| exportSampleId / printedSampleId / lnHalos | Three independently supplied opaque strings; never derive one from another, strip suffixes, trim, uppercase or convert to number |
| barcodeIndex / barcodeType | Supplied frozen barcode association/type; numeric sequence validated, not assigned |

`exportSampleId` is deliberately explicit because Column A identity selection (LN Halos vs printed ID, suffix/control convention) is not proven by the blank template. The adapter cannot use this proposal as permission to mint a third identifier. Only an approved existing identity value may eventually be selected upstream. Conservative uniqueness of member keys, positions, all three identity fields and barcode indices, and single barcode type are **synthetic v1 restrictions**, not claimed vendor rules. Unsupported partial/sparse batches and mixed barcode types fail closed rather than guessing.

Output is a deeply frozen, detached **cell plan**, 47 rows with exact Excel addresses, typed A–E values, complete copied member lineage, source revisions and DNB date basis. It has no XLSX/CSV bytes, MIME, filename or download endpoint. Blank intents do not prove serialized XLSX cell absence; a future writer must prove that by reading back bytes.

Canonical SHA-256 uses UTF-8 JSON with lexicographically sorted object keys and ordered arrays. Three digests cover the parsed complete snapshot, ordered members, and cell-plan payload excluding the digest envelope. These are internal integrity checks, **not signatures**, vendor checksums or hashes of an exported XLSX. Verification regenerates the expected plan from the supplied snapshot and compares all cells, lineage and digests; changing a candidate and recomputing its own hashes does not make it match that source. Changing both the supplied source and candidate requires upstream authorization/currentness checks that are outside this library.

## Synthetic fixture and verification scope

`tests/fixtures/halos-full-synthetic.json` contains dummy identities only. Physical members deliberately run in **reverse physical order** against the fixed HALOS barcode sequence: physical48 has Barcode1; PC physical1 has Barcode48. This is an **arbitrary unverified adversarial fixture**, not a proposed laboratory mapping. It proves the library does not silently infer an identity association from physical position. The Blank never becomes a member; PC and NC remain explicit roles.

Automated coverage in `tests/contracts/halos-export.test.ts`:

- Exact headers, Greek μ, C1 LF, 47 typed rows, copied IDs/barcodes, no Row49/Barcode13, and E blanks.
- Duplicate member/identity/physical/barcode; missing/extra and unsupported partial counts; wrong order; numeric/string/range/Blank barcode errors.
- Control count/position, physical Blank exclusion, missing identity and unsupported type/provenance/revision/template values.
- DNB placeholder, impossible Gregorian dates, leap day, supplied date mismatch and explicit intended-date provenance.
- Determinism, input non-mutation, deep output immutability and detached identities.
- Candidate missing/extra/reordered/retyped/changed cells, E zero/empty/formula, source ID mutation, hash/provenance substitution and alternate snapshot/mapping rejection.

These cover the independent transformation portions of AT-HALOS-HANDOFF-01/02. They do not complete those clinical/instrument acceptance tests, AT-HALOS-HANDOFF-03, AT-SEQ-01/02 or AL-4b. Historical 52 HALOS test IDs are not reported as executed.

## Pending contracts / decisions

| Pending | Required evidence before integration/release |
| --- | --- |
| P4 immutable snapshot DTO | Agreed accepted Pool/Placement/Batch shape, persisted revisions/digests, eligible disposition, lifecycle/currentness and supersession rules; adapter review with P4 owner |
| All 47 actual physical↔identity↔HALOS associations | Lab/vendor-approved traceability; PC/NC identifiers and barcode mapping; never infer physical40=Barcode13 |
| Column A identity convention | Authoritative existing value, LN/printed-ID selection, Normal/Repeat suffix and controls, characters/length/uniqueness |
| Partial or sparse batch | Owner/Lab QA/HALOS row cardinality, control placement and blank policy; no padding/reflow |
| DNB date change | Intended vs actual confirmation, signed reissue/revision/import reconciliation; no automatic correction or claim that intended means performed |
| Vendor controlled master / writer | Approved version/hash, formatting/style requirements, actual typed XLSX serialization/readback; no file-compatible claim from a JSON plan |
| HALOS behavior | Witnessed synthetic import proving 47 rows, intentional absent13, IDs/types/order/control association and readback/report format |
| Operational manifest / transfer | Output-file hash, creator/time, audit log, permissions, obsolete/duplicate import remediation and mandatory pre-sequencing 1:1 verification |
| AL-4b | Remaining owner/QA/vendor gates; this isolated development task does not unlock acceptance |

No changes to migrations, DB schema, navigation, Lab Worklist, Batch UI, label printing or LN generation. No merge to main, rebase, force push, production data or real HALOS access.

## Test evidence

See [p4b-halos-test-evidence.md](p4b-halos-test-evidence.md) for executed checks and CI limitations. The final response/PR identifies the exact committed SHA; committed evidence cannot include its own content-derived SHA.
