# NIPT-CBH Production Installation Guide (Windows 10/11, hospital LAN)

This guide covers the **production profile** of the offline Setup EXE (`NIPT-CBH-Setup-<version>.exe`) and of the signed package folder it wraps.
Clinical acceptance and hospital operational acceptance are never set by the installer. What remains for the hospital is in `HOSPITAL-COMMISSIONING-CHECKLIST.md`;
the unattended-Office limitation is in `OFFICE-UNATTENDED-ASSESSMENT.md`; the build/test facts for the delivered EXE are in `PRODUCTION-INSTALLER-STATUS.md`.

## 1. What is delivered

| Item | Purpose |
|---|---|
| `NIPT-CBH-Setup-<version>.exe` | One offline installer: signed package (application, PostgreSQL 17, Node 24, PowerShell 7, Chromium, approved master workbook) + Thai wizard |
| `NIPT-CBH-Setup-<version>.record.json` | Build record: exact Git commit, package manifest hash, profile, payload scan, EXE SHA-256 |
| `SHA256SUMS.txt` | Checksums of the delivered files |
| `package-signing-public.pem` | Public key of the Ed25519 package signature (the EXE also carries it; hospital IT may verify the checksum file through another channel) |

A production EXE wraps a package whose manifest says `profile: "production"`, `testEnvironmentOnly: false`, no test migration, no fault switch. The builder refuses anything else.
Ed25519 package signing protects the package contents; it is **not** Windows Authenticode. The EXE is not code-signed unless the hospital signs it (checklist C-14); SmartScreen may warn.

## 2. Host requirements (hospital IT)

- Windows 10 (1809+) or 11, 64-bit; 8 GB free on the install drive; an **ASCII-only** install path (default `C:\NIPT-CBH`).
- **Microsoft Word and Microsoft Excel desktop**, activated for the Windows account that installs and runs NIPT-CBH, and a default printer for that account (a PDF printer is enough).
- The account that runs Setup is the account that must be signed in to Windows (the startup task runs as that user so Office has a desktop).
- HTTPS port (443, otherwise 8443+) free; three loopback ports are chosen automatically. Only HTTPS can be published to the LAN.

## 3. Install the system and sign in as administrator (no SQL, no developer tool)

1. Check the EXE against `SHA256SUMS.txt` (`Get-FileHash`).
2. Run the EXE as the NIPT Windows account (UAC prompt for administrator rights, or `/CURRENTUSER`).
3. In the wizard, enter **two different people**: the system administrator (APP_ADMIN) and the clinical approver (CLINICAL_APPROVER) - login names (lowercase letters, digits, `.` `-` `_`) and full names.
   There are no default usernames or passwords anywhere in the product.
4. Press Install. Setup installs PostgreSQL, applies the migrations, creates the two accounts with **random one-time passwords**, registers the startup task, starts Web/Worker/Renderer,
   checks health and takes the first verified encrypted backup.
5. The finish page shows the HTTPS address and the file `C:\NIPT-CBH\credentials.txt` (readable only by the installing account, SYSTEM and Administrators) with the two one-time passwords.
   Give each password only to its owner, then **delete the file**.
6. Open the address, sign in as the administrator with the one-time password. The system forces a new password; until it is changed every other page and API is refused.
   After the change the old password no longer works. The administrator then reaches Settings and user administration (create real users, units, HIS folders under Settings > HIS paths).

Silent install (for scripted deployment): `NIPT-CBH-Setup-<version>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER /ADMINUSER=<login> /ADMINNAME="<name>" /CHECKERUSER=<login> /CHECKERNAME="<name>" [/ROOT=C:\NIPT-CBH] [/HOST=<dns>] [/LAN=yes|no]`.
Without all four names a production install is refused before anything is written.

`install-state.json` stays `INSTALLED_NOT_ACCEPTED` / `NOT_ACCEPTED`; the installer never sets `clinicalAcceptance` or `hospitalOperationalAcceptance`.

## 4. Operate (from `C:\NIPT-CBH\nipt.cmd` or the Start menu entries)

| Task | Command |
|---|---|
| Status / health | `nipt.cmd status`, `nipt.cmd health` |
| Start / stop / restart | `nipt.cmd start`, `stop`, `restart` |
| Prove Word + Excel in the signed-in session | `nipt.cmd office-check --report-master <singleton.docx>` |
| Backup now / destination / schedule | `nipt.cmd backup`; `nipt.cmd set-backup-root --path <dir>`; `nipt.cmd schedule-backup --time 02:00` |
| Host LAN address / certificate | Start menu "Set-LAN", `nipt.cmd lan-status` |
| Uninstall | Start menu / `nipt.cmd uninstall --confirm <root folder name>` (keeps data); `--remove-data` deletes everything (irreversible) |

## 5. Upgrade, repair and recovery

- **Upgrade / repair**: run a newer `NIPT-CBH-Setup-<newer>.exe` on the same machine. Setup detects the installation, takes a verified pre-upgrade backup, applies forward migrations, switches the release and checks health.
  Existing accounts, passwords and permissions are untouched: there is no second bootstrap and no password reset. Running the **same** version again changes nothing (it starts the services and shows the address).
  A production installation refuses a test-profile package, and a test installation refuses a production package. A failed health check rolls back automatically when the schema allows it.
- **Rollback** (`nipt.cmd rollback`): application-only; refused once a forward migration has been applied (then restore the pre-upgrade backup).
- **Recovery**: `nipt.cmd restore --backup <dir>` restores into a new quarantined database for inspection; disaster recovery uses `--activate --confirm-source-fenced yes` after the failed source has been fenced.
  `nipt.cmd restore --fresh --activate --confirm-source-fenced yes` is the drill form. The backup key (`secrets\backup.key`) must be escrowed separately (checklist C-09).
- **Reinstall after uninstall that kept data**: Setup reuses the retained database and accounts; it does not ask for new first accounts.

## 6. Keeping Word/Excel working 24 hours (read before go-live)

Microsoft does not support Word or Excel automation from a service or the SYSTEM account (session 0). NIPT-CBH therefore runs its startup task as the installing user (interactive-logon task),
so Office has that user's desktop. After a power loss or Windows Update restart the task only starts when that user signs in again. The recommended topology is a dedicated account with
Windows automatic sign-in and a locked screen (hospital IT decision), proven on the target machine with a real reboot and `nipt.cmd office-check`.
**This was not provable on the build host** - see `OFFICE-UNATTENDED-ASSESSMENT.md`. Everything except PDF export (database, web, worker, renderer, API) is independent of the Office session once the task has started.

## 7. Not done by the installer

Hospital certificate and DNS, firewall scope, UNC/SMB shares and service-account ACLs, NAS backup target and key escrow, real HIS connection, endpoint-security exclusions,
Authenticode signing, DCC approval of the bundled request/consent form copies, and the clinical/operational acceptance. They are listed with owners in `HOSPITAL-COMMISSIONING-CHECKLIST.md`.
