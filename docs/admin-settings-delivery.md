# Admin & Settings Completion — P0 + P1

Local integration candidate on `feat/admin-settings-completion` at `D:\Claude workspace\NIPT-CBH-ADMIN-SETTINGS`. Source/Main baseline verified against remote at start: `ea48e624c21cb7fef89e89bc4c02241300a3dd02` (PR #12). Main and both Preview worktrees were not modified; no existing database/container/volume/launcher was restarted or reused.

**ADMIN SETTINGS READY FOR INTEGRATION** is the delivery result only when the companion exact-HEAD receipt reports PASS. Authoritative final commit SHA, source tree, migration inventory hash, command results, full regression counts and working-tree status are emitted after commit by `tools/admin-final-verify.ts` to `.local/admin-final-verification.json` and `.local/admin-final-readiness.md`. This report is read together with that receipt, rather than treating documentation as test evidence. No Push/Merge/Deploy/Installer or remote CI is included.

## Findings and completed changes

| Finding | Delivered behavior / evidence |
| --- | --- |
| No user administration UI | Browser create/edit/search/filter/pagination/department/disable/unlock/history, with server `user.manage` enforcement |
| No scope/permission approval workflow | Immutable versioned requests for existing roles, `user_unit_scope` and `user_permission`; independent checker; revocation on change |
| Privileged reset can impersonate another approval identity | No privileged caller-selected reset; future sensitive roles included; Web approvals require owner-only target enrollment and return no credential to maker/checker |
| Queued requests can outlive authentication | Session/role validation after lock uses current clock; native queued-revocation/expiry tests |
| Current-password guesses unthrottled | Persisted failure counter, five-attempt lockout/session revocation; no guesses in audit |
| User/session locking conflicts with signing | NOWAIT reservation of sessions rejects busy signing operations before password verification; native two-connection negative test |
| No first-admin operational provisioning | Empty-install-only operator CLI for two distinct identities, mandatory rotation; no synthetic permanent admin or public registration |
| No department lifecycle UI | Forward active/version fields; reference-safe unused-code edit; FK and pending scope checks; no deletes |
| Hardcoded synthetic Worker in Health | Runtime-specific identity + freshness + singleton lock; actual Synthetic and Operational workers tested in fresh cluster |
| Active alert thresholds ignored | Active notifications consumed; native activation → health verification |
| System name stored but hardcoded Sidebar | Active general name consumed and shell refreshed; document provenance preserved |
| Unsupported/installation settings appear effective | Read-only explanations and server guards; laboratory labels distinguished from actual fixed calculation/template sources |
| Settings dropdown hard to navigate | Thai grouped navigation/search, visible version/author/effectiveness/locks, required red stars, unsaved-data protection |
| Global 100-revision history window can hide an old Active revision | Always include actual `setting_active` revisions as well as the latest 100 history entries; >100-history negative regression test |
| No audit viewer | Authenticated read-only redacted viewer, Bangkok time, event/outcome/actor search, pagination |
| No trustworthy backup monitoring | Optional signed operator completion receipts, public-key-only Web verification, creation/restore distinction, age/warnings; no Web recovery authority |
| Alert visibility incomplete | In-app Worker/queue/scan/transfer/P6/migration/renderer/backup/storage signals and labelled local-only test; no external sender |

User workflows and secure provisioning/enrollment details: [admin-settings-operations.md](admin-settings-operations.md). No new role was introduced. Normal account administration is browser-based; sensitive identity delivery remains outside Web to preserve independent human identities. Independent source review identified the reset/session/throttle issues above; revised source review found no remaining critical/important issues. The reviewer did not run tests or claim external acceptance.

## Coverage — all 102 items

The original source matrix matches the prompt's baseline counts. [Nine-dimension audit](admin-settings-audit.md) records UI, API/service, schema, validation, server RBAC, runtime consumption, audit, test source families and locks for each stable item ID. [Generated matrix](p5-settings-coverage.md) and `packages/settings/coverage.ts` remain synchronized by tests.

| Status | Before | After |
| --- | ---: | ---: |
| Functional / Implemented | 37 | 40 |
| Partial | 13 | 10 |
| Missing | 9 | 5 |
| HOLD | 31 | 30 |
| Deferred | 12 | 1 |
| Installation-owned | 0 | 8 |
| Intentionally Locked | 0 | 8 |
| Total | 102 | 102 |

These counts classify source coverage, not Hospital acceptance or 102 independently exercised browser workflows. Missing items remain: request-duration alerts, Lab TAT thresholds, configured role recipients, conflict-center queue-age threshold, and daily recollection report recipients. Historical daily report recipients remain Deferred. No Email/LINE provider/policy was inferred. Clinical/HIS/QC/DCC/owner decisions remain visible as HOLD; existing operational authority from 084–095 is preserved and not broadened. The original external Plan file was not present for fresh byte/hash re-verification; §13.2 inventory and immutable source register were used alongside current source/schema.

## Migration and compatibility

New forward migrations: `096_admin_settings.sql`, `097_admin_recovery.sql`, `098_admin_target_enrollment.sql`. Prior migration bytes and checksum tools/ledger were not edited. Existing users retain passwords/roles/scopes and are not forced to rotate by migration. Last login starts null unless actual successful authentication supplies evidence. Units default Active. New administration uses optimistic versions; access requests retain immutable payload and decision guards.

Fresh installation, reapply/idempotence and populated 095 upgrade tests verify original user credential/role/scope/permission/settings/audit/case rows and prior ledger entries. Native tests execute migrations/role grants on disposable PostgreSQL, with an actual app_rw-backed Web connection; Web cannot perform operator enrollment. No shared/Preview/Production migration was applied.

## Verification and artifacts

Focused database/security/settings/HIS lifecycle tests, Production Build, Typecheck, Lint and Source Guard were run during implementation. The final receipt records their exact-HEAD final equivalents and the **one standard full Vitest regression on the final delivery HEAD**, including actual pass/fail/skip counts. Opt-in native clinical/Excel/hardware suites remain explicitly skipped; they were not represented as passing. Deployment contracts run separately.

`tools/admin-verify-browser.ts` uses its own fresh cluster, random loopback ports, test identities, files, keys and child processes. It exercises browser user/unit creation, independent ordinary access approval, sensitive owner enrollment, password rotation, RBAC/CSRF denials, concurrent-update winner, queued session revocation/expiry, busy signing conflict, Active Settings identity/notification consumption, least-privilege health and both actual Worker modes. It checks six pages at 375/768/1440, Axe WCAG2 A/AA, horizontal page overflow and page errors, and writes 18 screenshots. The focused operational CLI smoke verifies real encrypted backup/restore on a fresh empty operational test database, signed completion receipts, quarantine and unchanged Master SHA-256. It does not claim a populated hospital restore drill.

Final browser `evidence.json` and screenshot directory are printed in the exact-HEAD `admin-browser-native.log`. Earlier focused evidence exists under `.local/admin-browser-sHNpUO/` and is not substituted for final-HEAD results. Original Master SHA-256 remains `0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6`.

The earlier `485b1b2` candidate's full verification was interrupted after the independently reproduced >100-history issue invalidated that candidate. Only its specifically owned verification process tree was stopped. It supplies no final PASS claim; the amended final HEAD runs the complete final sequence afresh.

Candidate `c811280` completed full regression with 1,976 passed, 50 skipped and one failing legacy Health/Reconciliation test. Its old generic mock did not supply the newly required mode/quarantine/lock/P6 evidence and matched P6 queries as ordinary Worker heartbeats. The fixture was corrected to model those independent signals and the real migration inventory; the durable reconciliation assertion remains enforced. No production Health guard was loosened. That failed receipt is retained and does not supply final PASS evidence.

## Remaining boundaries

Installation-owned: operator identity confirmation/delivery, PostgreSQL service accounts, private/public receipt key provisioning and ACLs, backup scheduling/retention, deployment log rotation, storage roots/quotas, ports/TLS and controlled brand assets. An unconfigured runtime reports NOT CONFIGURED / NOT VERIFIED. Logo upload was not added; approved document/workbook logos are unchanged.

NOT VERIFIED: Hospital LAN/UNC/SMB, actual HIS acknowledgement, HALOS hardware, physical printers, hospital/clinical/DCC acceptance, operational service identity/ACLs, formal Owner UAT and Windows clean-machine installer lifecycle. Local tests do not replace these. Remote CI is NOT RUN because nothing was pushed.

Dependency inspection: `npm audit --omit=dev` reported zero runtime findings. The unchanged development toolchain reported five high findings through ESLint's braces/micromatch/fast-glob chain; the suggested automatic change downgrades the Next lint configuration across major versions and was not applied. Package/lockfile versions are unchanged. Exact audit outputs are retained in `.local/{dependency-audit,runtime-dependency-audit}.json`.

Integration guidance is in the operations document. Stop for Owner Review; later integration must reconcile concurrent Home Preview changes and verify the combined exact HEAD. No merge or Preview lifecycle action is authorized by this local result.
