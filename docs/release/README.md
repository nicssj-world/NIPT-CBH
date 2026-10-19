# Release Candidate package — index

Start with [release-candidate-report.md](release-candidate-report.md) (artifacts, evidence, Go/No-Go). The overall recommendation is **NO-GO for clinical go-live**; the reasons and the order of the remaining work are in that report and in [outstanding-gap-register.md](outstanding-gap-register.md).

| Purpose | Document |
|---|---|
| What is outstanding, by owner | [outstanding-gap-register.md](outstanding-gap-register.md) |
| Host readiness before installation | [hospital-preflight-checklist.md](hospital-preflight-checklist.md) |
| Install, reboot/SYSTEM-task test, LAN access, upgrade, rollback, uninstall | [windows-installation-runbook.md](windows-installation-runbook.md) |
| HIS PET/OK in, RES/PDF/OK out | [his-acceptance-plan.md](his-acceptance-plan.md) |
| Backup, restore, DR, photo files, RPO/RTO | [backup-dr-runbook.md](backup-dr-runbook.md) |
| Clinical and staff UAT (blank, unsigned) | [uat/clinical-staff-uat-checklist.md](uat/clinical-staff-uat-checklist.md), [uat/uat-checklist.csv](uat/uat-checklist.csv) |
| What to do when something goes wrong | [rollback-recovery-decision-tree.md](rollback-recovery-decision-tree.md) |
| Artifact hashes, versions, ancestry | [artifact-record.json](artifact-record.json), [package-signing-public.pem](package-signing-public.pem) |
| Installer design and rehearsal evidence | [../p8/windows-installer.md](../p8/windows-installer.md), [../p8/windows-installer-evidence.md](../p8/windows-installer-evidence.md), [../p8/evidence/](../p8/evidence/) |

Rules for everyone using these documents: synthetic or HIS-supplied test data only; no push, merge to `main`, deployment, Production migration, production installation, Production HIS access or real patient results without separate explicit Owner authorization; a result cell is filled in only by the person who ran the test.
