# P8 synthetic cutover rehearsal

Executed locally on PostgreSQL17.11, 2026-10-14 Asia/Bangkok. This is technical preparation under OD-26(c), not an actual hospital cutover, approved cutoff/anchor, AL-7 acceptance or clinical pilot. The immutable reviewed plan's OD-26, §§14 and15 remain the governing references; no runtime eligibility exception or clinical publisher was added.

## Run and target isolation

Use the controller-owned, separately provisioned loopback cluster only:

```powershell
$env:NIPT_MODE='synthetic'
$env:NIPT_P8_OPS_URL='postgresql://nipt_p8_synthetic_owner@127.0.0.1:55461/nipt_p8_synthetic_admin'
npx tsx tools/p8/cutover-rehearsal.ts
```

The tool requires that exact admin target and explicit synthetic mode. It never reads a target from `DATABASE_URL`, changes inherited environment variables, reconnects to an existing rehearsal database or stops the shared cluster. Each invocation creates its own UUID database and ignored `.local/p8/cutover-<uuid>` evidence directory; both remain for review. Target options, alternate roles/ports/hosts and application database names fail before connection or filesystem creation. No installed application, hospital database, live HIS endpoint or existing sandbox is touched.

The frozen manifest is a synthetic external legacy-HIS fixture with pre-cutoff receipt and post-cutoff completion. It is written with exclusive creation/read-only permissions and its SHA256 is checked at the end and retained separately. This is technical hash evidence, not owner signature, hospital immutable storage or operational approval. Its `ownerApproved:false` and `governedExceptionImplemented:false` flags remain explicit.

## Observed final run

Retained directory: `.local/p8/cutover-8f6578bedf0149e09355a55ff03ac7cb`.

Database: `nipt_p8_synthetic_cutover_8f6578bedf0149e09355a55ff03ac7cb`.

Tool SHA256: `45caa84579f4a58cc111d05d6bb1301636231c647acabb46cfeecbee459841d3`.

Frozen manifest SHA256: `3bb6cddd9881aca08e9c0ae2486bea14be5f57f2f98ba3746a706ddd2dcaa6ae`.

| Scenario through existing helpers/services | Result |
|---|---|
| Synthetic cutoff `2026-01-01`, Anchor(a), balanced profile, maker-checker configuration | Parameters active in this disposable DB only; no owner approval inferred |
| Completed final report `2025-12-31` | Submitted, independently verified and promoted as HISTORICAL |
| Final report on cutoff day | NotEligible: anchor is not strictly before cutoff |
| Frozen in-flight LN, legacy receipt `2025-12-31T23:59:59+07:00`, final report `2026-01-02` | NotEligible; explicit confirmation rejects `DRAFT_NOT_SUBMITTED`; no case for that LN. Remains HOLD pending governed exception |
| Current LAB_DIRECT registration/receipt at `2026-01-01T00:00:00+07:00` and after cutoff | Separate new-runtime cases with exact Bangkok receipt boundaries; ordinary gates retained |
| Reuse current LN with another identity | CONFLICT, no extra case/round |
| Same HN with conflicting historical name/DOB | Draft queued with `IDENTITY_CONFLICT_SAME_HN`; no silent match/link |
| Importer also given verifier role | Own contribution still rejects `SELF_VERIFICATION_PROHIBITED` |
| CSV + PDF ZIP mixed batch, independent partial confirmation | PROMOTED / DISCREPANCY / CONFLICT; unselected row stays Submitted |
| Register conflicting LN after staging but before confirmation | Promotion rechecks registry and returns CONFLICT |
| Interrupt real promotion before transaction commit | Case, verification and audit roll back; same-key retry promotes once; committed replay reports ALREADY_PROMOTED |
| Historical origin passed to actual P6 fixture enrollment | Queue barrier rejects; zero fixture/transfer rows |
| Actual clinical outbound candidate boundary | `P6_CLINICAL_RELEASE_HOLD_AL5`; authority false and release rows0 |
| Read-only historical integrity / audit verification |3 records,10 evaluations,12 source files; zero issues and valid audit chain |

All17 rehearsal check groups passed. Measured elapsed: migration360ms; boundary CSV/PDF stage504ms; mixed ZIP batch51ms; partial confirmation11.4ms; rollback retry5.9ms; complete rehearsal1.24s. These tiny synthetic fixtures establish executable tooling evidence, not hospital volume, accepted downtime, RPO/RTO or staff performance.

`report.json` records observations, timing, tool/manifest hashes and all HOLD flags; `frozen-inflight.json`/`.sha256` retain the manifest; `eligibility-evidence.json` retains synthetic policy versions, maker/checker IDs and immutable evaluation snapshots/hashes; `audit-chain.json` retains the verified audit payloads. No passwords or connection URLs are written to these artifacts.

## Verification and limits

- New target guard regressions:4/4 passed. Test-first red run observed3 failed guard assertions, then the implementation passed. An earlier module-missing discovery run is not counted as an assertion regression.
- `npx tsc --noEmit` and scoped ESLint passed. The executable native rehearsal passed its17 check groups on the dedicated PG17.11 target.
- Two initial harness evidence queries failed (reserved alias `day`; nonexistent `proposed_by` instead of `created_by`). Corrected only the harness queries and repeated on fresh UUID databases. Failed own databases/directories `c4ad26599b554c87842c07a936073edd` and `83b7fd7751674a20beb4d69ddfd7e19a` remain with `failed.json`; they are not successful evidence. Earlier successful run `7a66dd7d37a441a5afa07ee7178daeab` also remains; the final run above adds tool-hash provenance.

No original plan content, real patient records, production mutation, clinical completion state, forged release, staff signature, live transport or deployment was created. Frozen in-flight exception design/implementation and actual cutoff/anchor approval remain pending. The manifest cannot authorize promotion by itself; actual OD-26(c) hospital cutover and AL-7 remain HOLD.
