# P4b DNB / sequencing / F5 continuation

Authority: owner continuation request, 2026-10-13. Continue `feat/p4b-halos-export-contract`, Draft PR #2 from `5a628e3`. No merge/deployment/Production mutation. Existing P1–P4b evidence and migrations 001–013 are preserved.

1. Persist simulation DNB/QC3 and sequencing/QC4 with immutable Pool lineage, observation/review and new-attempt paths. Operational Pool HOLD stays blocked; no method or clinical criterion approval is inferred.
2. Reuse existing HALOS contract at the integration boundary. Derive source identities from stored snapshots, require explicit mapping, freeze manifest/revisions/hashes, record transfer and independent 1:1 verification; block sequence/analysis for invalid verification.
3. Add F5 simulation PDF preview/Pre-work/Completed, originals/derivatives/recall and authenticated Thai workspace. Operational F5 requires accepted/current Pool plus approved handoff; simulations cannot confer that status.
4. Verify additive migrations, rollback/races, security and regressions; commit/push existing branch and update Draft PR #2 with exact-head CI evidence.

## Interface and review ledger

| Tasks | Shared boundary | Ruling |
| --- | --- | --- |
| 1 / 2 | Pool source, DNB ID/revision, sequence gates | Same batch lock and source currentness; no caller snapshot grants eligibility |
| 1 / 3 | DNB events and F5 lifecycle | Core owns migration014; documents own migration015 and F5 tables; append-only events |
| 2 / 3 | Handoff manifest and verification in F5 | Preserve explicit unresolved mapping; partial simulation is never vendor compatible |
| 1 | Actual date versus intended identity; FS-10 versus table | Preserve explicit provenance; FS-10 `(N+2)*199` and `N+2`, WC-14 visible |
| 2 | Owner 47-row contract versus partial source | No padding, no inferred mapping; gate until evidence supports contract |
| 3 | Clinical issuance versus simulation | Separate purpose; HOLD displayed on every artifact, no operational worksheets |
| 4 | Test evidence versus acceptance | Automated results prove synthetic behavior only; no AL-4b or clinical readiness |

Ruling: use existing reviewed plan v6.2.1 plus the continuation request as the binding design; no new design approval is needed for this authorized continuation. Existing worktree is clean and matches requested head. Source PDF credentials are excluded from extraction and source artifacts.

Progress: implementation, F5/UI integration and boundary fixes complete locally; final full regression and exact-head CI are tracked in p4b-sequencing-delivery.md. Owner Legacy Parity Lock is recorded in legacy-functional-parity-matrix.md.
