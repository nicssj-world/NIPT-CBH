# NIPT-CBH host check
Host: NICSSJ  ·  2026-10-19T02:21:11.925Z

Summary: {"PASS":22,"WARN":2,"INFO":10}

| Check | Status | Detail | Remedy |
|---|---|---|---|
| windows_version | PASS | Microsoft Windows 11 Home 10.0.26300 | Windows 10 1809 / Server 2019 or newer is required (Node 24, PostgreSQL 17). |
| memory | PASS | 31.1 GB | Indicative: 8 GB minimum, 16 GB or more recommended (PostgreSQL, web, worker, renderer + Chromium, Excel). IT to confirm sizing. |
| cpu | PASS | 16 logical processors | Indicative: 4 or more. |
| administrator | WARN | not elevated | A SYSTEM startup task, a Windows Firewall rule and some ACL changes need an elevated prompt; run the installer as Administrator. |
| account | INFO | User | The installing user owns the secrets folder; with -TaskMode user the services also run as this user. |
| path_root | PASS | D:\Claude workspace\NIPT-CBH-PAGINATION\.local\p8-win\rehearsal-20261019021230\NIPT CBH test: create/write/read/delete incl. a Thai file name |  |
| disk_root | PASS | 155.9 GB free on D: | Indicative: the installation needs about 8 GB before data; plan backups and photos separately. |
| path_backup-path | PASS | D:\Claude workspace\NIPT-CBH-PAGINATION\.local\p8-win\evidence\rehearsal-20261019021230\host-check\backups: create/write/read/delete incl. a Thai file name |  |
| disk_backup-path | PASS | 155.9 GB free on D: | Indicative: the installation needs about 8 GB before data; plan backups and photos separately. |
| path_photo-path | PASS | D:\Claude workspace\NIPT-CBH-PAGINATION\.local\p8-win\evidence\rehearsal-20261019021230\host-check\photos: create/write/read/delete incl. a Thai file name |  |
| disk_photo-path | PASS | 155.9 GB free on D: | Indicative: the installation needs about 8 GB before data; plan backups and photos separately. |
| path_inbound | PASS | D:\Claude workspace\NIPT-CBH-PAGINATION\.local\p8-win\evidence\rehearsal-20261019021230\host-check\inbound: create/write/read/delete incl. a Thai file name |  |
| disk_inbound | PASS | 155.9 GB free on D: | Indicative: the installation needs about 8 GB before data; plan backups and photos separately. |
| path_outbound | PASS | D:\Claude workspace\NIPT-CBH-PAGINATION\.local\p8-win\evidence\rehearsal-20261019021230\host-check\outbound: create/write/read/delete incl. a Thai file name |  |
| disk_outbound | PASS | 155.9 GB free on D: | Indicative: the installation needs about 8 GB before data; plan backups and photos separately. |
| long_paths | PASS | LongPathsEnabled registry value | Not required by the installer; keep installation paths short. |
| port_19860 | PASS | postgres(loopback) port 19860 free | Choose another port with -Ports or stop the process using it. |
| port_19861 | PASS | web(loopback) port 19861 free | Choose another port with -Ports or stop the process using it. |
| port_19862 | PASS | https(LAN) port 19862 free | Choose another port with -Ports or stop the process using it. |
| port_19863 | PASS | renderer(loopback) port 19863 free | Choose another port with -Ports or stop the process using it. |
| firewall_profiles | INFO | Domain=True, Private=True, Public=True |  |
| firewall_rule_https_lan | INFO | no inbound rule for the HTTPS port (only needed for LAN access) | Elevated: New-NetFirewallRule -DisplayName 'NIPT-CBH HTTPS (LAN)' -Direction Inbound -Protocol TCP -LocalPort 19862 -Action Allow -Profile Domain,Private -RemoteAddress <hospital subnet>. Never open PostgreSQL, web, or renderer ports. |
| ipv4_addresses | INFO | Ethernet:192.168.1.57, vEthernet (WSL (Hyper-V firewall)):172.25.32.1 | The HTTPS front listens on 127.0.0.1 by default; LAN publication is a hospital IT decision (set NIPT_HTTPS_HOST). |
| address_assignment | WARN | vEthernet (WSL (Hyper-V firewall))=Disabled, Ethernet=Enabled | A server should have a static address or a DHCP reservation so the certificate name and clients keep working. |
| dns_hostname | INFO | no --hostname given | Name the hostname users will type. |
| time_sync | PASS | time source: time.windows.com,0x9 | Audit timestamps and the 5-second HIS polling depend on synchronized time (domain controller or the hospital NTP server). |
| time_zone | PASS | SE Asia Standard Time | Receive times and LN Halos month boundaries use Asia/Bangkok; the host time zone should be SE Asia Standard Time. |
| tls_certificate | INFO | no --cert given | Provide the hospital certificate (.cer) to check validity, name and chain. |
| excel_installed | PASS | Excel.Application is registered | Task List PDFs are rendered by the desktop Microsoft Excel (A4, locked template). Install Office/Excel on the host (licensed by the hospital). |
| excel_session | INFO | Excel automation is not supported from a service or SYSTEM session (session 0). With a SYSTEM startup task use -ExcelMode bridge and a logged-on interactive user running the bridge task; with -TaskMode user the services run in that user session. |  |
| default_printer_current_user | PASS | Adobe PDF,Adobe PDF Converter,Documents\*.pdf | The export script reads the signed-in user default printer and sets it to A4; the account that runs Excel needs a default printer (a PDF printer is enough). Check it as that account. |
| powershell7 | INFO | The package bundles PowerShell 7; the host does not need it. |  |
| antivirus_products | INFO | Windows Defender |  |
| defender_exclusions | INFO | N/A: Must be an administrator to view exclusions | Hospital security decides. Scanning the PostgreSQL data folder and photo roots in real time can slow the database and corrupt nothing; if exclusions are approved, apply them to the data and photo folders only, never to the application or secrets. |