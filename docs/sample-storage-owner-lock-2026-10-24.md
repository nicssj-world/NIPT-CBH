# NIPT-CBH Sample Storage — Owner Lock Addendum

**Date:** 2026-10-24  
**Scope:** Task 2 Sample Storage, linked to `LAB-UAT-003`  
**Authority:** Owner instruction in `TASK 2 SAMPLE STORAGE FINAL IMPLEMENTATION & CLOSEOUT`

## Retention — locked decision

- Retain both Backup and Buffy Coat specimens for **3 years from the actual HIS receipt date/time in the PET `P[23]` value after `^`**.
- Each Re-Sampling round uses that round's own verified PET receipt time. Do not use the prior round's receipt time.
- Do not use box placement time, PET file processing time, or the current time as a substitute.
- If the round has no verified PET receipt time, leave the receipt and due date uncomputed. Do not infer a date.
- Show the verified HIS receipt time and calculated retention due time in storage details when the evidence is available.
- No automatic destruction is approved. Do not add destruction approval, destruction notification, sample deletion, storage-history deletion, or audit-log deletion at the 3-year mark.

## Storage label identities — locked decision

- Buffy Coat uses the existing base specimen display label with **no Storage suffix**. Existing Twin (`D`) and Re-Sampling (`R`) display semantics remain intact.
- Backup uses that same display label followed by **`-3`**.
- Do not generate `-1` or `-2` as Storage identities.
- Do not change NIPT-CBH tube-label composition or its existing `-1/-2/-3` meanings.
- Storage print output follows the approved four 50 × 20 mm sticker / eight-half layout. Each half repeats only the selected Storage identity (Buffy base or Backup `-3`); it does not print other tube aliquot identities.
- Storage label data must come from the issued specimen label and storage type in the database; printing and reprinting must not issue or alter an identifier.

## Preservation and isolation

- Migration 126 is forward-only. Do not edit an applied migration, classify or discard legacy sample positions, or remove existing storage and audit history.
- Task 1 work remains isolated and untouched. Do not commit or combine its diff to satisfy a parity launcher.
- If Task 1 is still active, test Task 2 in an isolated synthetic database/runtime. Do not restart or migrate the shared Local UAT.
- Keep Clean-Git Launcher Gate, actual Source-to-Runtime Parity, Functional Verification, and Owner UAT acceptance as separate evidence.

