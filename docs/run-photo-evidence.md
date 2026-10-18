# Run Photo Evidence (ภาพประจำ Run)

Branch `feat/run-photo-evidence`, based on `6d6e41c` (Go-Live readiness HEAD of `feat/task-list-parity-p0`). Migration `103_run_photo_evidence.sql` (filed as 102 on the source branch; renumbered to 103 on integration because Consent refusal owns 102, content and checksum unchanged), SHA-256 (LF) `f11c8080b172e2628404c0a8d6476ae1d5c77e625d917c0e72c75836009b03f9`, forward only. It has been applied only to disposable synthetic databases (PGlite and the isolated e2e PostgreSQL). It has **not** been applied to Production.

## FINAL OWNER LOCK: photos are optional

- A Run with no photos is a normal Run. No popup, no minimum count, and no gate.
- No table, constraint, trigger or function of Run, Task List, QC, Pooling, Result or HIS refers to the photo tables. `tests/db/run-photos.test.ts` asserts this against the live catalog.
- If the photo store is offline or access is denied, only photo upload and photo viewing report it. The Run page, Task List, planning, QC and every other workflow continue to work. This is covered by both the DB test and the e2e test.

## For Lab staff (คู่มือการใช้งาน)

1. Open **งาน Lab → ภาพประจำ Run** in the menu, or the link **ภาพประจำ Run (n ภาพ)** on a Run's page.
2. On the Run gallery page, tap **ถ่ายภาพด้วยกล้อง** (opens the phone camera) or **เลือกภาพจากเครื่อง (หลายภาพได้)**. You can pick several photos at once.
3. Optionally enter:
   - **วันที่ถ่ายภาพ** (Buddhist Era; defaults to today).
   - **ลำดับตัวอย่างในภาพ (คนที่) ตั้งแต่–ถึง**, e.g. 1–10, 11–20. Samples are counted in slot order, and the controls (PC/NC/Blank) are not counted. The page shows which slots the range covers in the current placement, e.g. `ตำแหน่ง 2–11 · 10 ตัวอย่าง`.
   - **คำอธิบายภาพ**.
4. Tap **อัปโหลด n ภาพ**. Each photo shows its own progress. A failed photo stays in the list; tap the button again to retry it. A retry is never recorded twice.
5. Tap a thumbnail to open the photo. The viewer shows:
   - the full-resolution original;
   - previous/next (arrow keys on desktop);
   - **เปิดภาพเต็มในแท็บใหม่** and **ดาวน์โหลดต้นฉบับ**;
   - the uploader, the upload time, the file size, the pixel size and the SHA-256;
   - the samples (slot, sample code, LN HIS) inside the declared range.
6. Corrections are available to the uploader or a LAB_CERTIFIER:
   - **แก้ไขคำอธิบาย ช่วงตัวอย่าง หรือวันที่**.
   - **อัปโหลดผิด Run** → move the photo to the correct Run (a reason is required).
   - **ถอนภาพนี้ออก** (a reason is required). A retracted photo is kept on file and in the history, and it is never deleted. Tick **แสดงภาพที่ถอนออก** to see retracted photos.

**Search** (**ภาพประจำ Run** page) works by Run date or photo date, Run (`12`, `Run012`, `012/2026`), LN Halos, LN HIS, sample order (คนที่) and caption text. An LN search lists every Run where the sample was actually placed, with its order and slot, and the photos of those Runs. Only a photo whose uploader declared a range containing that order is marked **ครอบคลุมคนที่ N (ตามที่ผู้อัปโหลดระบุ)**. The system never claims that a photo shows a specific patient's tube. There is no OCR or image analysis.

## For administrators: Settings → Run Photo Evidence → Storage Path

- **Path ใหม่** accepts a local Windows folder (`D:\NIPT-CBH\RunPhotos`) or a UNC share (`\\LAB-SERVER\NIPT-Photos`). The folder must already exist, and the service account of the web process must be able to read and write it. Do not use a drive letter that is mapped only for a user.
- **ทดสอบการเข้าถึง** is run by the web process itself, which is the same account that stores the photos. It checks that the folder exists and is a directory, then writes a 64 KiB probe, fsyncs it, reads it back byte-for-byte and deletes it. It shows the account, host, elapsed time and free space.
- **บันทึกและใช้ Path นี้** needs a passing test and a reason, and the server re-tests the path before it saves. From then on, new photos go to the new path. Earlier photos stay where they are and are still opened from their original root. Nothing is moved or deleted automatically. **Keep the old roots reachable and include them in the backup.**
- Only APP_ADMIN and IT_OPERATOR (`photo.storage.configure`) can see absolute paths or change them. Other users with `settings.read` see the status only.
- Until an administrator sets a path, photos go to the installation default `<FILE_STORE_ROOT>/run-photos`, which can be overridden with `RUN_PHOTO_DEFAULT_ROOT`.
- Optional installer policy: `NIPT_RUN_PHOTO_ALLOWED_ROOTS="D:\NIPT-CBH;\\LAB-SERVER\NIPT-Photos"` restricts which roots can be chosen.

## Backup and restore

The database rows (photo metadata, ranges, uploader, SHA-256, roots and history) are covered by the existing Backup/Restore tooling (`deploy/scripts`). Photo files can be large and may live on a separate share, so they have their own verified copy tool. Run it on the application server as the storing service account:

```
npm run photos -- verify                                   # DB ↔ file consistency; exit 1 if any file is missing or changed
npm run photos -- backup <empty-folder>                    # copies every referenced file, writes manifest.json + manifest.sha256, verifies each byte
npm run photos -- restore <backup-folder> <rootId> <path>  # after the DB restore: put one root's files into <path>
npm run photos -- relocate <rootId> <path> "<reason>"      # record that the root now lives at <path> (all files must verify first)
```

`verify` also lists orphan files that no record references, for example after a failed record following a successful write. Orphans are reported and never deleted. Relocation is append-only (`run_photo_root_location`), so the old path stays in the history.

## Technical reference

| Area | Implementation |
| --- | --- |
| Schema | `run_photo_storage_root` (Active/Retired, one Active), `run_photo_root_location` (append-only path history + passing test receipt), view `run_photo_root_current`, `run_photo`, `run_photo_event` (append-only UPLOADED/EDITED/MOVED/RETRACTED) |
| DB guards | No DELETE on photos. Evidence columns (hash, size, type, root, uploader, time, name) are immutable. Retracted is terminal. Every update must bump `row_version`. Duplicate bytes: unique `(batch_id, sha256)` among Active photos |
| Files | Content-addressed `sha256/aa/bb/<sha256>` under the root. Staged, fsynced, renamed, then read back and verified. The original is never re-encoded; EXIF is kept as captured. The thumbnail (≤480 px JPEG, ≤512 KiB) is made by the uploading browser and is for browsing only |
| Path safety | Absolute drive/UNC only. No `..`/`.`, device namespaces (`\\?\`, `\\.\`), reserved names, drive roots, or web-published folders (`public`, `.next`, `src`). Keys are fixed patterns with no user input. Symlinks/junctions below the root are refused |
| Outage handling | 12 s timeout (`RUN_PHOTO_STORAGE_TIMEOUT_MS`) and a 30 s per-root circuit breaker, so an offline share fails fast and never stalls other work |
| Content checks | Media type comes from magic bytes (JPEG/PNG/WebP/HEIC/HEIF). SVG/GIF/HTML/PDF are refused. Size cap `RUN_PHOTO_MAX_MB` (default 30, max 50) |
| Serving | `GET /api/run-photos/[id]/file?variant=thumb\|original[&download=1]`: session + `photo.read`, verifies the SHA-256 on every read, `private, no-store`, `nosniff`, sandboxed CSP. HEIC is served as a download. Viewing an original is audited (`RUN_PHOTO_VIEWED`). There is no public URL |
| Upload | `POST /api/run-photos/upload`: one photo per request, CSRF + `photo.upload`, idempotency key per file. This path is excluded from `src/proxy.ts` because the proxy would buffer and truncate bodies above 10 MB; the route caps the body itself |
| Search | `POST /api/run-photos/search` (POST keeps LN values out of URLs and logs). LN hits are written to `phi_access_log` (`REGISTRY_VIEW`). Sample order = `row_number()` over live (or cancel-time) slot assignments by slot |
| Permissions | `photo.read` LAB_STAFF/LAB_CERTIFIER (AUDITOR read). `photo.upload`/`photo.manage` LAB_STAFF/LAB_CERTIFIER (staff: own uploads only; certifier: any). `photo.storage.configure` APP_ADMIN/IT_OPERATOR. ANC, CLINICAL_APPROVER and APP_ADMIN cannot open photos |
| Code | `packages/run-photos/{image,store,service,maintenance}.ts`, `src/server/run-photos.ts`, `src/app/api/run-photos/**`, `src/app/api/settings/run-photo-storage`, `src/components/run-photos/*`, pages `/lab/photos`, `/lab/photos/[batchId]`, `/settings/run-photos`, CLI `tools/run-photos.ts` |

## Evidence (synthetic, local)

| Check | Result |
| --- | --- |
| `tests/db/run-photos.test.ts` | 15/15 (owner lock, upload 1/many, duplicates, idempotency, permissions, history, DB guards, search incl. LN Halos/HIS/order/text, cancelled Run, path change, failed targets, verify/backup/restore/relocate) |
| `tests/unit/run-photos.test.ts` | 9/9 (Windows/UNC/posix path validation, allow-list, sniffing, safe names, content-addressed write/verify/tamper, vanished root, junction refusal) |
| `tests/e2e/run-photos.spec.ts` (isolated runner `tools/run-photos-e2e/e2e.ts`, ports 19728–19730) | 8/8. Includes a 13.7 MB upload, desktop 1440 px and phone 390 px, original byte-identity, axe WCAG 2.2 AA on gallery/viewer/search/settings, 401/403 for anonymous/ANC/admin/approver, path change, an offline root during Run work, move and retract |

| Full Vitest | 2147 passed, 57 skipped (env-gated native/legacy-sample suites), 0 failed |
| Regression Playwright (same isolated runner) | foundation, be-date-input, p2 (incl. Paper Consent), p4-lab, p4-task-list, p5-results, p5-case-upload, settings-operational, run-photos: 64 passed + 3 Settings specs skipped (need `NIPT_LEGACY_HANDOVER_FIXTURES_DIR`). The first pass had 3 failures: 2 foundation baselines shifted by the new Lab menu item (`registry-1280/1440-win32.png`, re-baselined), and the P2 preview, which needed the ANC form registry that the runner now provides. Re-run of foundation + p2: 38/38 |
| Lint / typecheck / build / source guard | pass. The build shows only pre-existing Turbopack tracing warnings in files not touched here |
| Impeccable design detector on the new UI | no findings |

Known pre-existing issue (not changed here): below 600 px the global `.button{width:100%}` rule makes the calendar button of every `ThaiDateInput` fill the row and squeezes the date field. The photo pages override this locally; other pages are unchanged.

## Pending physical acceptance (not claimed)

- A real **UNC share** (`\\LAB-SERVER\...`) with the hospital's service account, SMB permissions and the offline/timeout behaviour on a real network. Tests used local folders. The UNC path syntax is unit-tested only.
- A real **Windows service account** that differs from the interactive user, plus the ACL errors seen through it.
- **Real phones** on the hospital Wi-Fi/LAN: Android Chrome and iOS Safari camera capture, HEIC handling and large-photo upload times. Browser camera capture was emulated with file inputs in Playwright Chromium.
- The **hospital backup/DR schedule** for the photo roots, and a restore drill on the target server.
- Production migration authorisation for `103_run_photo_evidence.sql`.
