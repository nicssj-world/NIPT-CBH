# Synthetic staff UAT preparation

Status: **PREPARED — NOT RUN, NOT SIGNED**. Physical printing/scanning and clinical acceptance are pending. The existing [18-scenario checklist](../p7/acceptance-checklist.md) and [Thai operator guide](../p7/operator-guide.md) remain authoritative. No staff outcome or signature has been generated.

## Prepared local environment

The retained final preparation is `.local/p8/uat-1f94d17f8a1644e0a9a01320221a637c`; its `manifest.json` lists seven synthetic accounts and three foundation cases, authority false and zero releases. These are **seven users, not seven patients**. The earlier failed setup and earlier successful preparation are retained separately; use the final manifest rather than selecting an arbitrary database.

`seed-password` is a generated local synthetic credential shared by these training accounts. It is not printed in reports, committed or a hospital password. `web-url` and `worker-url` hold separate database login credentials; `runtime.env` holds file references and local service settings. Windows file modes do not prove hospital ACL enforcement. Limit access to the test operator and grant staff only the individual test credentials they need. Linux container permissions are validated separately in deployment evidence.

| Account | Test role / task |
|---|---|
|synthetic.anc|ANC registration and scoped access to SYNTHETIC_ANC|
|synthetic.lab|Lab Direct, task/lab flow and explicit HISTORICAL_ENTRY test permission|
|synthetic.verifier|Independent historical verification; cannot verify own contributed rows|
|synthetic.certifier|Synthetic review/settings maker; clinical release stays blocked|
|synthetic.approver|Separate settings/role approval actor|
|synthetic.admin|Application administration; no clinical override|
|synthetic.auditor|Read-only evidence review|

The native UAT environment uses the existing controller-owned cluster on loopback55461. To prepare another independent dataset when explicitly needed (never reset the retained one):

```powershell
$env:NIPT_MODE='synthetic'
$env:NIPT_P8_OPS_URL='postgresql://nipt_p8_synthetic_owner@127.0.0.1:55461/nipt_p8_synthetic_admin'
node --import tsx tools/p8/prepare-uat.ts
```

The command creates a fresh UUID database; no inherited application database is selected. Preserve its returned directory and manifest. Run the approved candidate build with its `runtime.env` using the existing runtime loader. Web binds127.0.0.1:3380 and renderer3381. Run worker with `DATABASE_URL_FILE` changed to that directory's `worker-url`. Keep the renderer token, lookup key and file/simulator roots exactly as prepared. For signed container UAT, use the separately validated installation runbook and that installation's generated credential files; do not mix native and container datasets or secrets.

## Execution and evidence

`acceptance-records.csv` contains UAT01–18 with status `NOT_RUN` and blank tester/date/device/evidence/issue/witness/signature fields. Record observed results, screenshots/log references and retests per scenario. Preserve original failing evidence. Do not replace a staff test with automated P7/P8 results.

For each task, confirm the displayed synthetic identity, LN, unit, round/attempt and HOLD reason before acting. Use the existing checklist for Registration, Task List, Lab processing, HALOS contract, Results, Historical Import, permissions and error recovery. Synthetic cutoff `2026-01-01` and demonstration anchor choices are test parameters only. Do not enter real patient data or real integration paths.

Physical device checklist (each **PENDING PHYSICAL VALIDATION**):

- Record authorized scanner/printer/model/DPI/driver/stock, browser and operator.
- Scan external LN input with leading zeros; verify displayed identity before submission. A typed synthetic LN is not a physical scanner test.
- Print locked 60×20mm stickers/30×20mm halves at actual scale; inspect cuts, Thai text, LN/Halos/suffix ordering, readability and sample segregation. Preserve the Owner's NO BARCODE tube-label lock.
- Verify reprint uses the same evidence and number; test paper/queue failure and operator recovery without duplicate numbering.
- Witness HALOS import/export on an authorized vendor test environment separately. A pure47-row contract test does not prove vendor acceptance.
- Collect staff task success, critical-error count and SUS against the existing approved checklist; manual WCAG/NVDA and signing devices require actual testers.

Before staff access, the technical operator starts the selected synthetic environment, runs the documented health/login/PDF smoke and confirms release authority false/releases0. Keep test endpoints loopback unless IT separately authorizes a LAN test. Clinical pilot, actual cutoff, clinical templates/consent and AL-7 remain HOLD.
