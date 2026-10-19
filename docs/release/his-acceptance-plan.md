# HIS acceptance plan — PET/OK in, RES/PDF/OK out

**Status: PREPARED — NOT EXECUTED ON ANY HOSPITAL NETWORK.** The local installed rehearsal exercised the same code against **local folders** with synthetic patients (45 cases, two certified releases, RES/PDF/OK/backup files verified against the frozen contract). That proves "the files we write match our contract". It does **not** prove that the hospital HIS reads, accepts or acknowledges anything. `hisConfirmed` therefore stays `false` everywhere.

This plan does not redesign the HIS protocol and does not change any Owner lock. Preserved: HIS reception ends at PET/OK (NIPT-CBH never receives the specimen a second time); PET is read-only; LN/HN/identity validation unchanged; P5 PDF folder scan is **on demand** (no timer) with manual upload as fallback; result confirmation is the single authorized P5-B step; output is RES + PDF + BOM-only OK; "file written" ≠ "HIS acknowledged".

## 0. Authorization and safety (all must be true before any step)

| Item | Requirement |
|---|---|
| Environment | a **non-production** HIS receiver or an HIS-owner-supplied test patient and test folder; written IT/HIS procedure naming exact folder names, times and an observer |
| Data | synthetic or HIS-supplied **test** identities only. No real patient, no real result |
| Flags | Production outbound flag stays **off** unless the Owner separately approves it in writing (`his_outbound.productionAuthorized`) |
| Rollback | the procedure names who removes test files from the shared folders and how the test patient is closed in the HIS |
| Service identity | tests run as the **installed service account** (not the installing user, not an administrator) |

Open decisions that these tests cannot close by themselves (record the answer given by IT/HIS in §5): **Q-I3** destinations, ACLs, filename/temp-name semantics, service identity; **Q-I4** confirmation (real ACK, read-only query, or witnessed reconciliation); **Q-I5** versioned RES profile (sender/receiver/test/specimen/O[18]/suffix/ward/R[6]), DOB/sex acceptance, R[3] units/limit, certifier R[10] mapping, and the P[23] date source for round ≥ 2. Source: `docs/p6/integration-holds.md`.

## 1. Tools

| Tool | Use |
|---|---|
| `Nipt-Admin.ps1 host-check --inbound <path> --outbound <path>` | read-only create/write/read/delete probe (incl. a Thai file name) of the shares **as the account running it** |
| Settings → HIS inbound/outbound → **Test** | existing path test through the real Worker (writes a receipt; no patient data) |
| `tsx tools/win-installer/his-outbound-verify.ts --dir <outbound root> [--database-url-file <file>] [--out report.json]` (from `<release>\ops`) | read-only conformance check of every `.res` against the frozen wire contract plus OK/PDF/backup consistency and `hisConfirmed` |
| Health (`nipt.cmd health`) | worker alive, backlog, reconciliation counts |

## 2. Inbound acceptance (HIS → NIPT-CBH)

| ID | Test | Procedure | Expected | Local run (synthetic, local folder) | HIS network result (result, tester, date, evidence) |
|---|---|---|---|---|---|
| HIS-IN-01 | LAN connectivity and permission | `host-check --inbound \\HIS\share\inbound` as the service account; Settings → HIS inbound → Test | read/list works; failure shows `SHARE_PERMISSION_DENIED` / `SHARE_PATH_NOT_FOUND`, never a silent skip | share policy and Test path executed in the installed journey; **no UNC share** | |
| HIS-IN-02 | PET + OK reception | HIS writes the test PET/OK pair (`inbound/YYYYMMDD/<LN>-7.pet`) | one case received; receive time = HIS time in PET P[21]; **no** second reception step in NIPT-CBH; PET never modified | Passed (installed journey, 45 PETs through the Worker) | |
| HIS-IN-03 | Identity validation | PET with an LN already linked to another HN/identity | issue `IDENTITY_MISMATCH`, case not silently merged, visible in /inbound with oldest-first order | covered by automated suites (`tests/db/p3*`, `tests/contracts/p3-native.test.ts`); not on a share | |
| HIS-IN-04 | Duplicate detection | same PET bytes twice; then a different PET for the same LN | identical bytes: idempotent (one file row, one receipt); changed bytes: issue, no overwrite | automated suites; not on a share | |
| HIS-IN-05 | Corrupt / incomplete file | truncated PET; wrong encoding/BOM; PET without OK | rejected or held in the waiting queue with a visible message; no partial case; limits message shown when the queue is capped | automated suites; not on a share | |
| HIS-IN-06 | Resampling (new PET) | HIS issues a new PET for an existing LN after a redraw order | S2 expected → received; **HIS LN preserved**, new attempt on the same specimen, new P2 approval required | Passed (journey step `S2_NEW_PET_SAME_BASE_NEW_P2_APPROVAL`) | |
| HIS-IN-07 | Worker restart and idempotency | stop the Worker during a scan (`nipt.cmd stop`), start it again | each PET is received exactly once; no duplicate case or LN Halos | restart/recovery exercised (S05, S14); mid-scan interruption not exercised on a share | |
| HIS-IN-08 | Result PDFs folder (P5) | press **Scan** on the Results page; preview; confirm import; also upload manually | scan only on demand; identity validated; manual upload works when the share is down | covered by automated suites and the journey (PDFs imported locally); not on a share | |

## 3. Outbound acceptance (NIPT-CBH → HIS)

Run only after HIS-IN tests pass and §0 is satisfied. A certified test result must exist (P5-B confirmation by an authorized person).

| ID | Test | Procedure | Expected | Local run (synthetic, local folder) | HIS network result |
|---|---|---|---|---|---|
| HIS-OUT-01 | Destination path test | Settings → HIS outbound → Test for RES, PDF and backup paths, as the service account | write, read-back and delete succeed under the approved temp-name/rename semantics (Q-I3) | executed against local folders | |
| HIS-OUT-02 | RES file content (field level) | run `his-outbound-verify` on the receiver folder and send `report.json` to the HIS owner for line-by-line review | all checks pass: UTF-16LE BOM, CR separators, 5 records of widths 14/35/26/12/3; P[2]=P[21]=O[2]; **P[7] DOB**; **P[23] specimen date** `X^X`; **R[9]** approval pair; **R[10]** certifier `a^b`; R[11] accession; filename = LN + HH + last digit of the minute + `.res` (`resFilename`) | Passed on the installed journey output (`S06b`) | |
| HIS-OUT-03 | PDF | compare the PDF in the folder with the released PDF in NIPT-CBH (hash) and open it in the hospital viewer | name `N_HN__LN.pdf` (template per profile), `%PDF-` header, byte-identical to the immutable released asset, opens in CFS | name/header/backup identity verified; CFS not available | |
| HIS-OUT-04 | OK marker | observe order of files | OK is BOM-only, same stem as the RES, written **last** | verified (`S06b`) | |
| HIS-OUT-05 | Atomic completion and permissions | watch the folder while a large result is written; check ACLs on created files | the receiver never sees a partial RES/PDF; created files readable by the HIS service identity, not world-writable | exclusive-create/read-back executed locally; receiver behavior unknown | |
| HIS-OUT-06 | Confirmation (Q-I4) | follow the approved method (ACK file, read-only query, or witnessed operator reconciliation) | NIPT-CBH records **who/when/what was observed**; only then may `hisConfirmed` change; the approved condition must be written down first | `hisConfirmed=false` verified for all transfers (`S06b`) | |
| HIS-OUT-07 | Retry and duplicate protection | take the destination offline, certify a test result, bring it back | state `RETRY_PENDING`/waiting, one RES after recovery, no duplicate, no blind resend | model/automated tests; not on a share | |
| HIS-OUT-08 | Missing acknowledgment | do not acknowledge | after the timeout the transfer shows reconciliation required (`UNKNOWN_TIMEOUT`); operator workflow documented; **no automatic resend or delete** | automated tests | |
| HIS-OUT-09 | Rejected result | receiver rejects the file | operator sees the state; correction creates a revision under the approved policy; consumed files are never overwritten | automated tests | |
| HIS-OUT-10 | Round-2 report, same original LN (AT-HISOUT-LAN-01) | redraw → S2 → second certified result | second RES uses the **original HIS LN**, P[23] follows the approved `round2SpecimenDatePolicy`; HIS state changes; CFS opens the exact PDF | policy cannot be defaulted: unresolved Q-I5; **NOT RUN** | |

## 4. Passing criteria and what remains NO-GO

HIS acceptance is complete only when: HIS-IN-01…08 and HIS-OUT-01…10 have hospital results signed by IT/HIS **and** Q-I3, Q-I4 and Q-I5 have written answers recorded in §5. Until then HIS integration is **unproven on the hospital network** and Clinical Go-Live remains NO-GO (`docs/release/release-candidate-report.md`).

## 5. Decision record (to be completed by IT/HIS; nothing here is filled in by the project)

| Decision | Answer | Decided by | Date |
|---|---|---|---|
| Q-I3 destinations, ACLs, temp-name/rename/durability, service identity | | | |
| Q-I4 confirmation method and timeout | | | |
| Q-I5 RES profile (sender, receiver, test code, specimen code, O[18], accession suffix, ward, R[6]) | | | |
| Q-I5 DOB/sex acceptance and R[3] units/limit; certifier R[10] mapping | | | |
| Q-I5 round-2 P[23] date source (`CURRENT_ROUND` or `ORIGINAL_ORDER`) | | | |
| OD-07 which results/notices/revisions may reach HIS/CFS | | | |
| Retry/backoff/timeouts and collision handling | | | |
