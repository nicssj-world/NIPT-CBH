# NIPT-CBH Setup 1.0.0 — one-click offline installer: evidence and honest status

Test environment only (synthetic data, developer/test signing key). Not a clinical release.

## The file

| | |
|---|---|
| File | `D:\Claude workspace\NIPT-CBH-PAGINATION\.local\p8-win\setup\NIPT-CBH-Setup-1.0.0.exe` |
| Size | 365,141,601 bytes |
| SHA-256 | `48b58ef9eaf47ee7ec6153898ba057068c347f8e2eb572d06797806a19190e62` |
| Built from | commit `c57ced4` (package revision `c57ced450fab13bfbaf247e0e65c4d51a11b741e`), Inno Setup 6.7.3, lzma2 normal compression |
| Payload | web app, Node 24.15, PostgreSQL 17.11, Worker, Renderer, HTTPS front, Supervisor, Chromium headless shell, PowerShell 7.6.6, Excel Bridge, 47 migrations (001–104), approved Master Workbook (SHA-256 checked against `master-manifest.json`), Thai fonts/templates/static assets |
| Not bundled | Microsoft Excel (external requirement); a printer |
| Integrity | Ed25519-signed package; the engine verifies signature + exact file set after extraction and before it writes anything. Public key is outside the package folder; developer/test key only; no production secrets, HIS credentials or private production signing key inside |
| Signing | **The EXE is NOT Authenticode-signed.** Windows SmartScreen may warn. This is reported, not hidden |

## What was tested from the real EXE (final build unless stated)

Method: the real EXE launched as a process, silent (`/CURRENTUSER /VERYSILENT`) so it runs without UAC; the GUI wizard was driven on this machine (screenshots).

| # | Requirement | Result | Evidence / note |
|---|---|---|---|
| 1 | Double-click starts Setup | PASS | wizard launched from the file; Thai welcome page with the hospital text, Install button, small Advanced option |
| 2 | UAC | PARTIAL | Setup is built to ask for administrator rights (Inno `PrivilegesRequired=admin`); an earlier launch did raise the real UAC prompt. The assistant cannot click an elevated consent prompt, so **every elevated path below is NOT tested** |
| 3 | Offline install | PASS | 243 s; connections of installer/service processes observed during install: all loopback (127.0.0.1), none to another address |
| 4 | PostgreSQL private cluster starts | PASS | `status`: postgres running on loopback port |
| 5 | Web / Worker / Renderer / HTTPS front | PASS | all `RUNNING`; `lan-status` probe 200 |
| 6 | Desktop + Start Menu shortcuts | PASS | `NIPT-CBH.url` on Desktop, Start Menu group (open, uninstall; Set-LAN and Status entries fixed after a first run showed the name `/` was illegal) |
| 7 | Login + Dashboard | PASS | installed journey logs in over HTTPS with secure cookies on the LAN origin |
| 8 | Works after Windows restart | **NOT TESTED as a real reboot.** Substitute: all processes hard-killed, then the logon task started as Windows does → services and HTTPS back, data and photo intact. The default startup is a **logon** task (starts when the user signs in), not a machine-start service; the SYSTEM-at-boot mode exists but is untested |
| 9 | Excel Bridge | Rehearsal S-steps (bridge mode, earlier run) only; **not re-run from the EXE** |
| 10 | Create/open PDF | PASS (journey: native PDFs, report PDF, outbound PDF) — Excel installed on this host, `direct` mode |
| 11 | Run Photo Evidence | PASS (upload; byte-identical fetch after hard restart and after upgrade, on the previous build of the same engine; rehearsal S06c on the final commit) |
| 12 | Backup | PASS (verified backup, 97 files) |
| 13 | Upgrade without data loss | PASS 1.0.0 → 1.0.1 via a second EXE: 45 cases and the photo preserved (previous build); repeated on the final engine without data (history `INSTALLED,UPGRADE_STARTED,UPGRADED`). Failed pre-upgrade backup (busy queue after a crash) leaves the old system running, exit code 2, Thai message |
| 14 | Uninstall | PASS keep-data (state `UNINSTALLED_DATA_RETAINED`, data/secrets kept) and delete-all (`/DELETEDATA=1`: root folder, task, shortcuts, registry, ports, processes all gone) |
| 15 | Reinstall | PASS on retained data: same DB password file, 45 cases kept, history `REINSTALLED_ON_RETAINED_DATA` |
| 16 | No leftover processes | PASS after both uninstall modes (tasks 0, listeners 0, processes 0) |
| — | Open EXE again on an installed system | PASS: no new database, exit 0, shows the real URL; version history unchanged |

Regression for the changed engine: `rehearse.ts` all steps passed at `c57ced4` (signature/tamper, preflight, install, crash recovery, installed journey 45 patients, HIS outbound contract, photo, backup, restore, failed/successful upgrade, rollback gates, DR, scheduled backup, stop/start, uninstall). Unit tests 27/27, `tsc`, ESLint clean. Web application code was not changed in this task.

## Hospital LAN access

| Item | Status |
|---|---|
| Real LAN URL shown on the Success page (`https://192.168.1.57`) with Copy URL | Shown only after the server probed its own published address (probe 200, TLS name matches). Copy URL button present on the page; its clipboard action was **not** verified (an elevated Windows prompt blocked input) |
| Certificate: SAN = localhost, 127.0.0.1, published IP/DNS, computer name; public `.cer` at `/.well-known/nipt-cbh-certificate.cer` | implemented, probed from the server |
| HTTPS front binds `0.0.0.0` only when LAN is enabled; PostgreSQL/web/renderer stay on loopback | verified by listeners |
| Windows Firewall rule limited to Domain/Private + LocalSubnet for the HTTPS front | **NOT tested** (needs administrator). The engine now creates it before the first service start, so Windows' own "allow access" prompt should not appear; this ordering is untested. An un-elevated test install does raise that Windows prompt (observed) |
| **Opening the URL from another real Windows PC** | **NOT TESTED.** No second machine was available. The probe was made from the server to its own LAN address only. Nobody should treat the URL as proven for other PCs until a nurse machine opens it |
| Later changes (IP, DNS name, port, allowed subnet) | `Set-LAN` Start-menu entry / `nipt.cmd set-lan` (console, Thai prompts). There is **no GUI Settings page** for the LAN address or certificate in the web app: reported gap |

## Defects found by these runs and fixed

1. Windows PowerShell 5.1 lost its `Cert:` drive when started from a PowerShell 7 process (polluted `PSModulePath`) → engine passes a clean module path.
2. A failed engine run left silent Setup waiting on a hidden dialog; opening Setup on an installed system also waited on a message box → `SuppressibleMsgBox`, failure exit code 2, already-installed exit code 0.
3. Failed pre-upgrade backup left the system stopped → old release restarted.
4. Start-menu shortcut name contained `/`.
5. Welcome page was skipped (hospital text and Advanced option not shown); progress sentences showed `?` → the wizard now receives only ASCII codes and shows Thai from tables compiled into Setup.
6. Finish text overlapped the check boxes → layout recalculated, wizard taller.
7. Delete-all uninstall left an empty root folder.

## Not done / not proven (read before go-live)

- Real UAC click-through, SYSTEM-at-boot task, Windows reboot, firewall-rule creation, LocalMachine certificate trust: elevated, not executed.
- Final-EXE GUI screenshots: welcome and Finish pages were captured on **development builds** (`docs/p8/setup-evidence/`, before the last wording and layout fixes). The final EXE was exercised silently and through the rehearsal.
- Access from another PC in the hospital LAN.
- Excel Bridge from the EXE install; printer-dependent steps depend on this host's printer.
- Clinical go-live verdict is unchanged by this work (NO-GO per the release candidate report).
