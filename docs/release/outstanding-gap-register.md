# Outstanding gap register — Release Candidate

Consolidates what is **not** proven or not decided at the Release Candidate, by owner. It supersedes nothing: older registers (`docs/p8/gap-register.md`, `docs/go-live-readiness-2026-10-19.md`, `docs/p6/integration-holds.md`, `docs/p0-owner-decision-register.md`) remain the detailed sources. "Blocks clinical go-live" means a Go decision cannot be taken while the item is open.

| ID | Area | Gap | Owner | Blocks clinical go-live | Next action / evidence required |
|---|---|---|---|---|---|
| G-01 | HIS | Real LAN share, ACLs and service account unknown (Q-I3); the signed LAN test (AT-HISOUT-LAN-01) has **not been run** | IT / HIS | **Yes** | execute `docs/release/his-acceptance-plan.md` HIS-IN-01…08 and HIS-OUT-01…10 on a non-production receiver; record answers in §5 |
| G-02 | HIS | Confirmation method (real ACK / read-only query / witnessed reconciliation) undecided (Q-I4); `hisConfirmed` must stay `false` until it is | IT / HIS | **Yes** | decision + witnessed evidence template; implement only the approved method |
| G-03 | HIS | RES profile not approved (Q-I5): sender/receiver/test/specimen codes, O[18], accession suffix, ward, R[6], DOB/sex acceptance, R[3] units/limit, certifier R[10] mapping | IT / HIS | **Yes** | signed profile; configure as a versioned operational profile |
| G-04 | HIS | Round ≥ 2 specimen date source for P[23] undecided (Q-I5); `round2SpecimenDatePolicy` has no default | IT / HIS | **Yes** | choose CURRENT_ROUND or ORIGINAL_ORDER; test HIS-OUT-10 |
| G-05 | HIS | Backup/retry/recovery policy for transfers, consumed-file and collision handling not approved | IT / HIS | **Yes** | written policy; failure-injection on real shares |
| G-06 | Backup/DR | Hospital NAS, service-account permissions, key escrow, schedule not installed; RPO/RTO targets undefined (Q-I6); restore drill on hospital volumes not performed | IT | **Yes** | `docs/release/backup-dr-runbook.md` BDR-01…13 |
| G-07 | Windows | **Reboot recovery and the SYSTEM startup task were never executed** (no elevated session; user-level task only) | IT / project | **Yes** | `docs/release/windows-installation-runbook.md` §4 on an authorized test host |
| G-08 | Windows | Excel bridge under SYSTEM + a logged-on user not executed (bridge mode rehearsed only as a user-level task) | IT / project | **Yes** (if SYSTEM mode is chosen) | INST-05 on the authorized host; decide the bridge user |
| G-09 | Windows | LAN browser access, hospital certificate, firewall rule, DNS name untested | IT | **Yes** | INST-08; preflight PF-12…15 |
| G-10 | Windows | Stale-child reaping branch of the supervisor was never triggered (job object ends children with the supervisor) | project | No | keep as defensive code; covered by review only |
| G-11 | Windows | No Authenticode code-signing, MSI/EXE wrapper or Windows Installer logging; the Ed25519 signature protects package integrity only, not publisher identity to SmartScreen/AppLocker | IT / project | No (policy-dependent) | if the hospital requires signed binaries: obtain a certificate and sign `node.exe` wrapper/PowerShell scripts, or whitelist by hash |
| G-12 | Windows | Antivirus/EDR compatibility with PostgreSQL, Node and Chromium not verified on the hospital image | IT security | **Yes** | run INST-01/06 with endpoint protection active; agree exclusions |
| G-13 | Windows | Installation root must be ASCII; hospital standard paths must comply | IT | No | PF-06 |
| G-14 | Physical | 50×20 mm label printing on the real printer, DPI/stock/cutting and the OD-R1b legibility test not done (Q-I7) | Lab | **Yes** | UAT LAB-10 with sign-off |
| G-15 | Clinical | Staff UAT not executed; no signed acceptance | Lab / ANC / DPO | **Yes** | `docs/release/uat/` checklist, signatures by the named roles |
| G-16 | Clinical | DCC approval of the electronic forms pending (ANC forms are DRAFT PREVIEW) and OD-06 channel mode pending | DCC / Owner | **Yes** | DCC decision recorded |
| G-17 | Clinical | AL-5 / AL-7 remain HOLD; OD-04 Clinical Governance sign-off, OD-07 channels/PIC/templates, OD-08 clinical gate criteria and QC1 (OD-31) not approved | Clinical governance | **Yes** | decisions per `docs/p0-owner-decision-register.md` |
| G-18 | Data | Migrations 099–104 are approved for **synthetic/test** databases only; applying them to the operational database needs an Owner-authorised procedure with a verified backup first | Owner / IT | **Yes** (for production) | change record + verified backup; use the installer's upgrade path |
| G-19 | Security | Test accounts, self-signed certificate and generated secrets are for test; production identity management, password policy, and administrator enrollment follow `docs/admin-settings-operations.md` | IT / Owner | **Yes** | production provisioning plan |
| G-20 | Capacity | Worklist Ready/Gate classification is exact up to 10 000 attempts and a lower bound beyond (still complete by paging); not load-tested at hospital scale or concurrency | project / IT | No | measure at hospital volumes (Q-I6) |
| G-21 | Photos | A relocated photo root is outside the operational backup; photo backup/restore schedule and the hospital share are not installed | IT | **Yes** (if a share is used) | BDR-10; PHO-05/06 |
| G-22 | Process | Playwright/Vitest evidence is from a developer machine, not hospital infrastructure | project | No | repeat smoke tests on the authorized host |
| G-23 | Process | `p8-installed` Linux/Docker spec and `npm audit` dev-only findings (5 high in lint tooling) are out of scope here | project | No | tracked in `docs/pagination-performance-2026-10-19.md` |

Items **not** listed because they were closed with evidence in this repository: consent marker/refusal, run photo evidence, pagination and long-page rendering, worklist scan boundary, Windows offline package, installation/upgrade/rollback/uninstall rehearsals, backup/restore/fresh-activation rehearsals, HIS outbound file contract conformance (local files only).
