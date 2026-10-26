# Remaining Hospital Commissioning Checklist (Production installer)

Nothing below is set or claimed by the installer. Each row needs the named owner's signature and evidence on the **target hospital machine**.
`clinicalAcceptance` and `hospitalOperationalAcceptance` stay false until the hospital's own process completes this list.

| ID | Item | Owner | Evidence expected |
|---|---|---|---|
| C-01 | **Blocker B-1** - dedicated Windows account for NIPT-CBH; Word + Excel activated for it; default printer set | Hospital IT | `host-check` output; Office activation screenshot |
| C-02 | **Blocker B-1** - Windows automatic sign-in for that account (or an approved staffed-session procedure after restarts); screen lock policy approved by information security | Hospital IT + security | Policy decision recorded |
| C-03 | **Blocker B-1** - real reboot test: power cycle, wait for sign-in, `nipt.cmd office-check` returns `ok:true`, `nipt.cmd health` OK, one native NIPT PDF (name, licence, both signature images) and one Task List PDF produced from the UI | Hospital IT + LAB | `office-check` JSON before/after, PDFs |
| C-04 | Production install on the target host with the signed package; verify package against the separately obtained public key; run `host-check` first | Hospital IT | install log, `status` output |
| C-05 | Distribute the one-time passwords to the named administrator and clinical approver; delete `credentials.txt`; both change password at first sign-in | Administrator | Audit shows `ADMIN_BOOTSTRAPPED` and password changes |
| C-06 | Create real users, roles and units; second-person approvals (maker-checker) for sensitive roles | Administrator + clinical approver | Admin console export |
| C-07 | Hospital TLS certificate and DNS name; firewall scope for HTTPS only; `set-lan` | Hospital IT | browser trust screenshot, `lan-status` |
| C-08 | HIS folders: PET inbound, RES/PDF outbound, backup path - UNC/SMB shares with service-account ACLs; set in Settings > HIS paths and pass the worker folder test. **Real HIS live I/O needs the existing two-person approval and a HIS test** | Hospital IT + HIS vendor | Settings revision history, worker test report |
| C-09 | Backup destination (NAS), schedule, **backup key escrow**; one restore drill with `dr-drill` and the measured RPO/RTO accepted | Hospital IT + QA | `backups`, `dr-drill` output, key custody record |
| C-10 | Antivirus/endpoint-security exclusions for the PostgreSQL data folder and photo roots (hospital decision) | Information security | Exclusion list |
| C-11 | Upgrade procedure agreed: who verifies the signed package, maintenance window, rollback expectation (application-only; refused after a forward migration) | IT + QA | Change record |
| C-12 | DCC controlled-document approval of the request/consent forms (the bundled forms are Owner reference copies, **not DCC approved**) | DCC / QA | Controlled-document ids |
| C-13 | Owner visual/clinical sign-off items 010, 040, 043, 050, 056 and commissioning item 058 from the LAB UAT matrix | Owner / LAB | Signed matrix |
| C-14 | Optional: Authenticode (code-signing) certificate for the Setup EXE; SmartScreen reputation | Hospital IT | Signed EXE |
| C-15 | 24-hour observation on the target host (services, health, backup, Office check) before go-live | Hospital IT + LAB | Health/log extract |
