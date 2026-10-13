# Continuation source evidence — 2026-10-13

Read-only local evidence under the owner's `NIPT-Audit` folder. Original files were not modified or copied into Git. This inventory records source identity, not approval of disputed procedures or criteria.

| Evidence | SHA-256 | Applied sections |
| --- | --- | --- |
| Plan v6.2.1 Reviewed 2026-10-11 | `261acf8cebec7915d255abaccf02e2bb55d76de0a59b26d9c7abc7b0c7703c2e` | §§12.13,12.17,12.20–23; Appendix C FS-10–14; Appendix F F5-01–17 |
| WI-T-BM19 Rev01, effective 19 Jun 2026 | `367a1d8c783ff89f330c2493fed0e7f6b90d84e6e868f295d3cc0d161094938c` | PDF pp8–9: DNB storage, Qubit/Standards, FS-10 conflict, QC3 and loading mix |
| WI-T-BM20 Rev02, effective 23 Jul 2026 | `8b47ce5a5d533cd4ed22c74cd80f2b205fb05483684a2bca51af75695bd4d688` | PDF pp16–18: finish/cleaning, QC4 source values, mandatory transfer/reconciliation |
| WI-T-BM21 Rev01, effective 19 Jun 2026 | `50c26f3f4c98c13ea3b7b9d4a9cc297585d770f74df4af6dacb8655fc55351d1` | PDF pp8–10: A/B distinction and sample QC warnings; no clinical decision automation |

BM19 table at N=3 prints 955 µL Buffer; FS-10 yields 995 µL and 5 µL Dye. Tests use the explicit formula `(N+2)*199` and `N+2`, labelled WC-14; they are not owner-signed Excel goldens. OD-32/WC-05 remains unresolved: no PCR/MGISP method is chosen. QC3 8–40 ng/µL is source evidence under OD-31, not an effective approved criterion. DNB 4°C/48h is shown as source guidance under OD-33, whose operational warning/block policy remains pending.

BM20 and BM21 QC criteria/grades remain source observations; this implementation records values and human synthetic review without generating a clinical QC4/QC5 pass. BM20 source credential section was excluded from extraction and no instrument credentials are stored in source, DB or fixtures.

HALOS authority remains [the existing contract](p4b-halos-export-contract.md) and its owner lock: `Sheet1!A1:E48`, 47 rows, Barcode `1–12,14–48`, Column E blank, no Row49. Physical40 is a different domain from absent HALOS Barcode13. No new mapping or Column A identity convention is approved by this milestone.
