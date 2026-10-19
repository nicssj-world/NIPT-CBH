# Rollback and recovery decision tree

Use this when an upgrade, a restore or a runtime failure leaves the installation in doubt. It maps each situation to what the installer **does by itself**, what an operator may do, and what needs an authorization the project does not hold. There is no down-migration; the migration ledger is forward-only with SHA-256 checksums, and the ledger is never edited. Evidence for every branch marked "rehearsed" is in `docs/p8/windows-installer-evidence.md`.

```
START: something is wrong after an upgrade / restore / failure
│
├─ Is a service down or restarting?                       (nipt.cmd status / health)
│   ├─ one service restarts, others fine ──► read logs\<service>.log; the supervisor restarts it with backoff 1→30 s (rehearsed S05).
│   │                                          Persistent? escalate with logs. Do NOT edit install-state.json or the ledger.
│   └─ supervisor itself gone ───────────────► nipt.cmd start (stale children are reaped); Task Scheduler restarts it after failure (5 × 1 min).
│
├─ Did `upgrade` just run?
│   ├─ it REFUSED before touching anything ──► nothing changed. Causes: tampered/unsigned package, version not newer,
│   │      (UPGRADE_*, PACKAGE_*)               database knows migrations the package lacks, checksum differs. Fix the package; retry.  (rehearsed S09)
│   ├─ migration FAILED, old release still running ► UPGRADE_MIGRATION_FAILED_OLD_RELEASE_STILL_RUNNING. Old release keeps serving; the new
│   │                                          release folder is discarded. Investigate the SQL error in the output; no restore needed. (rehearsed S09)
│   ├─ migration FAILED and the old release can no longer run on the schema ► UPGRADE_MIGRATION_FAILED_RESTORE_REQUIRED
│   │                                          → go to "RESTORE REQUIRED" below.   (guarded in code; not reproducible with an additive migration)
│   ├─ new release started but not healthy ───► automatic rollback to the previous release, failed folder kept as <version>.failed-<time>;
│   │                                          state history shows UPGRADE_FAILED_AUTO_ROLLBACK. (rehearsed S09, ≈2 min)
│   └─ upgraded and healthy but you want the old release back
│        ├─ no migration was applied by this upgrade ──► `nipt.cmd rollback` (application-only; database untouched)   (rehearsed S12)
│        └─ a migration WAS applied ───────────► `rollback` is REFUSED (ROLLBACK_REQUIRES_DATABASE_RESTORE); nothing changes.  (rehearsed S11)
│                                                 Options: (a) stay on the new release and fix forward (preferred);
│                                                          (b) restore the pre-upgrade backup — see "RESTORE REQUIRED".
│
├─ RESTORE REQUIRED  (database or files damaged, or an upgrade left an unusable schema)
│   ├─ Is the live database still the one you want to keep as evidence?
│   │     yes ──► `nipt.cmd restore --backup <dir>` : restores into a NEW quarantined database + fresh file tree and verifies it. The live
│   │              system is untouched. Inspect. (rehearsed S08)
│   └─ Do you want to switch to the restored copy?
│         ├─ the live database did NOT change since the backup (e.g. planned move, drill) ──► `nipt.cmd restore --fresh --activate --confirm-source-fenced yes`
│         │       the source is fenced, the restored target activated, forward migrations applied. (rehearsed S13)
│         ├─ the live database CHANGED after the backup ──► the activation gate refuses (RESTORE_SOURCE_CHANGED_SINCE_BACKUP).
│         │       DO NOT bypass it. Activating discards everything written after the backup. This is a data-loss recovery:
│         │       it needs an Owner/IT-authorised procedure (who accepts the loss, for which period, how lost work is re-entered).  (refusal rehearsed S13)
│         └─ the host is lost ──► rebuild a host with the same package, restore with the escrowed backup key (docs/release/backup-dr-runbook.md §2.8).
│
├─ Certificate / TLS problem ──► replace config\tls\server.pfx + .cer/.pem, update secrets\tls-passphrase, `nipt.cmd restart`.
├─ Disk full / backup destination unreachable ──► free space or `set-backup-root`; a failed scheduled backup must alert a person (IT-owned).
└─ HIS files / reconciliation items after any recovery ──► never resend blindly, never delete: follow the reconciliation workflow;
                                                            `hisConfirmed` stays false until the approved confirmation condition is met.
```

## Authorization matrix

| Action | Who may do it | Needs separate Owner authorization? |
|---|---|---|
| start / stop / restart / health / backup / dr-drill / restore for inspection | authorized operator | no (test host); production use per hospital policy |
| upgrade, application-only rollback | authorized operator, change window | production: yes (written) |
| `restore --activate` (planned, source unchanged) | operator + IT lead | production: **yes** |
| activating an older backup over changed work | Owner + IT lead + clinical governance | **always** |
| editing the ledger, `install-state.json`, bypassing a gate | nobody | not available |

## After any recovery

1. `nipt.cmd health` is `ok:true` and `auditValid`, `migrationsMatch`, `rolesRestricted` are true.
2. Compare case/release/transfer counts with the last known figures.
3. Check Results/Transfers for items in reconciliation; check the job backlog drains.
4. Take a fresh backup and record the incident, the decision taken, who authorized it and the evidence.
