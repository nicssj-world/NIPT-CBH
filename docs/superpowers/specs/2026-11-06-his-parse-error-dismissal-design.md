# HIS parse-error cleanup design

## Intent

Let an authorized HIS operator permanently remove a selected parse-error row from the inbound file table while keeping the registration safety block, deduplicating the unchanged source, and preserving a minimal audit trail. The raw HIS/NAS file remains untouched.

## Goals and constraints

- Provide **ลบรายการ** for `ParseError` rows with an explicit confirmation; deleted file rows cannot be restored.
- Keep a minimal immutable tombstone with source path, content hash, LN, path version, actor, and time, plus the append-only audit entry.
- Suppress the same content hash on every later scan. Byte-identical copies must never create another visible file row.
- An unresolved tombstone remains a patient-registration blocker. Only a valid newer file with the same path and LN supersedes it and releases that block.
- Do not infer a match from LN alone. A same-LN file with different bytes may be a corrected version and remains eligible for review.
- Do not change Lab/Pooling workflows or write, rename, or delete HIS/NAS source files. Add a new numbered migration; keep applied migrations immutable.

## Approaches

1. Delete the failed row and all provenance: rejected because the unchanged file can be re-imported on the next scan and the registration block would disappear.
2. Keep the whole failed file row and only hide it: rejected because the operator explicitly requested removal from the database.
3. Delete only the `ParseError` row and retain an immutable SHA-256 tombstone plus audit. Skip that hash on all future scans, and keep registration blocked until a valid same-path/same-LN replacement is stored. **Chosen** because the bad row disappears without re-importing the file or weakening the registration guard.

## Behavior

- The database function deletes only a `ParseError` row. It stores the SHA-256, original path, LN, path version, actor, and timestamp in a tombstone.
- The deletion cascades only through that row's review events and nulls immutable source-sighting links; source-sighting records and audit-chain records remain.
- The scanner is read-only. It never changes the file on the HIS/NAS share.
- A tombstoned hash is not imported or displayed again, even if copied to a different path. Interval scans that find only unchanged content do not append another scan-history row.
- A valid newer parsed row from the same source path and LN supersedes both older parse-error rows and matching tombstones. An unresolved tombstone continues to block patient registration.
- Existing globally unique SHA-256 storage already prevents byte-identical files from creating duplicate `his_inbound_file` rows. Different bytes at the same LN remain a distinct file version.
