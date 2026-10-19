# Hospital Windows host — preflight checklist

Purpose: everything hospital IT must settle **before** the offline installer is run. Run the read-only tool first and attach its report:

```powershell
node <package>\installer\host-check.mjs --root C:\NIPT-CBH --backup-path \\NAS\share\nipt-backups --photo-path D:\NIPT-Photos `
     --inbound \\HIS\share\inbound --outbound \\HIS\share\outbound --ports 5432,3000,443,3001 `
     --hostname nipt.hospital.local --cert D:\certs\nipt.cer --out hostcheck.json --report hostcheck.md
```

(The package carries its own Node: `<package>\payload\runtime\node\node.exe <package>\installer\host-check.mjs ...`.) The tool writes only short-lived probe files into the folders you name. Thresholds in it are indicative developer recommendations; **hospital IT owns real sizing and security policy**. A PASS is not hospital acceptance.

Status legend for the sign-off column: `PASS` / `FAIL` / `N/A` with the name and date of the person who checked. Nothing below has been signed by anyone; the sign-off cells are intentionally empty.

## 1. Host and account

| ID | Item | How to check | Expected | Result / evidence | Checked by, date |
|---|---|---|---|---|---|
| PF-01 | Windows edition and build | host-check `windows_version` | Windows 10 1809 / Server 2019 or newer, supported by the hospital patch policy | | |
| PF-02 | CPU and memory | host-check `memory`, `cpu` | IT-approved sizing; indicative ≥ 4 cores, ≥ 16 GB (8 GB minimum) | | |
| PF-03 | Administrator access for the install | host-check `administrator` | Installer run from an elevated prompt when `-TaskMode system` | | |
| PF-04 | Service account decided | IT decision | `-TaskMode system` (boot, SYSTEM) or `-TaskMode user` (starts at that user's logon). With SYSTEM: a named interactive user for the Excel bridge (PF-14) | | |
| PF-05 | Server time synchronized, zone Asia/Bangkok | host-check `time_sync`, `time_zone` | Hospital NTP/DC source; zone `SE Asia Standard Time` | | |

## 2. Folders and storage

| ID | Item | How to check | Expected | Result / evidence | Checked by, date |
|---|---|---|---|---|---|
| PF-06 | Installation root | host-check `path_root`, `disk_root` | Short local **ASCII-only** path (e.g. `C:\NIPT-CBH`; spaces are fine, Thai characters are refused because PostgreSQL cannot start from them), ≥ 8 GB free before data, writable by the installer | | |
| PF-07 | Database and file-store location | `data\` under the root unless IT relocates the volume | Local NTFS volume with growth headroom; **never** a network share for `data\pgdata` | | |
| PF-08 | Backup destination | host-check `path_backup-path` | Local second disk or UNC share writable by the **service account** that runs the scheduled backup; outside `data\`. Thai folder names are fine here (tested) | | |
| PF-09 | Run Photo Evidence storage path | host-check `path_photo-path`; Settings → Run Photo Evidence | Absolute drive/UNC path, writable by the service account; optional allow-list `NIPT_RUN_PHOTO_ALLOWED_ROOTS`; the folder is included in the photo backup plan (see backup runbook) | | |
| PF-10 | HIS inbound / outbound shares | host-check `path_inbound`, `path_outbound` | Test with the **service account**, not the installing user; ACLs approved by HIS owner (Q-I3). Not exercised against Production by this package | | |
| PF-11 | Real-time antivirus/EDR | host-check `antivirus_products`, `defender_exclusions` | Hospital security decides; if exclusions are approved apply them to data and photo folders only, never to the application or `secrets\` | | |

## 3. Network and certificate

| ID | Item | How to check | Expected | Result / evidence | Checked by, date |
|---|---|---|---|---|---|
| PF-12 | TCP ports | host-check `port_*` | Free: PostgreSQL, web, renderer stay on **loopback only**; only the HTTPS port is published to the LAN | | |
| PF-13 | Windows Firewall | host-check `firewall_*` | One inbound allow rule for the HTTPS port from the hospital subnet (command printed by the tool); no rule for PostgreSQL, web or renderer | | |
| PF-14 | Static address, DNS name | host-check `address_assignment`, `dns_hostname` | Static IP or DHCP reservation; DNS A record for the name in the certificate | | |
| PF-15 | HTTPS certificate | host-check `tls_certificate_*` | Hospital CA certificate whose SAN names the hostname, ≥ 30 days valid, chain trusted by clients. The installer's self-signed certificate is for test only | | |

## 4. Microsoft Office and printing

| ID | Item | How to check | Expected | Result / evidence | Checked by, date |
|---|---|---|---|---|---|
| PF-16 | Microsoft Excel installed and licensed | host-check `excel_installed` | Registered desktop Excel (Task List PDFs are rendered by Excel, A4, locked template) | | |
| PF-17 | Excel execution model | decision | Services as `-TaskMode user` with `-ExcelMode direct` **or** services as SYSTEM with `-ExcelMode bridge -ExcelUser DOMAIN\name` (a logged-on interactive user runs the bridge). Excel is **not** supported from session 0 | | |
| PF-18 | Default printer for the Excel user | host-check `default_printer_current_user` (run as that user) | A default printer exists (a PDF printer is enough); the export sets it to A4 | | |
| PF-19 | Label printer (physical) | Q-I7 / OD-R1b | Printed on the real 50×20 mm printer — see the UAT checklist; not an installer prerequisite | | |

## 5. Package and approvals

| ID | Item | How to check | Expected | Result / evidence | Checked by, date |
|---|---|---|---|---|---|
| PF-20 | Package integrity | `Nipt-Admin.ps1 verify-package -PublicKey <key obtained separately>` | exact file set and signature valid; SHA-256 of the package manifest matches the release record | | |
| PF-21 | Owner master workbook | `-MasterWorkbook <file>` | SHA-256 equals `packages/workbook/master-manifest.json` | | |
| PF-22 | Written authorization | Owner / IT | The host is a **non-production** test host, or a separate written Owner authorization exists for installing on a production host | | |
| PF-23 | Backup key escrow plan | IT | Where `secrets\backup.key` copies are held, by whom, under which policy; without it no backup is readable | | |

Open decisions that block clinical use (not installer prerequisites): Q-I3 destinations/service identity, Q-I4 confirmation method, Q-I5 RES profile and round-2 P[23], Q-I6 backup/DR targets, Q-I7 label printer, OD-06 channel mode, AL-5/AL-7, DCC form approval. See `docs/release/outstanding-gap-register.md`.
