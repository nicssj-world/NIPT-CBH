# HIS ANC export import — fill blanks (design)

Date: 2026-11-18 · Owner decisions in conversation · Size: small feature

## Intent
HIS exports ANC data (`.xlsx`, 20 text columns: hospcode, hn, cid, brthdate, pttype, age, seq,
date_serv, gravida, ancno, ga, ancresult, ancplace, provider, weight, height, bmi, edc, nipt_date, nipt).
Lab staff upload it to fill missing data on cases that are already waiting, instead of typing it.
It is only data filling: keep it simple, no new gates, no clinical blocks (Owner).

## Goals
- Any Lab staff member can upload the file.
- **Preview first**: how many rows matched, and per case what will be filled; rows not matched or
  skipped are listed with the reason.
- On confirm, for each matched case that has **not yet had "ตรวจสอบใบขอตรวจ"**: save that check
  exactly as if staff pressed save (same service, `paperReview` short REQUEST check), so the button
  becomes "แก้ไข" and moves, and can be edited later as usual:
  - doctor ← `provider`; a name not in the registry is added to the registry with a random doctor
    key (no signature, Approved — like the historical-doctor registration);
  - GA ← `ga` written `xx+xx` split into weeks + days (days > 6 carry into weeks), counted forward
    from `date_serv` to the round's blood-draw date; EDD then follows as the check already computes;
  - ครรภ์ที่ ← `gravida` (G);
  - pregnancy type ← Singleton (staff change to Twins later).
- **Incomplete HIS row → skip the whole row** (Owner 2026-11-18): G = 0, or HIS `edc` disagrees with
  `ga` at `date_serv` by more than 3 days (e.g. GA `1+0` with EDC = visit date). Preview lists it as
  "ข้อมูล HIS ไม่ครบ"; staff enter it by hand as usual. Not a gate on the case — only nothing is filled.
- Also fill **weight and height** into the request draft, only where empty.

## Non-goals
- Entitlement (`pttype`) — ignored (Owner).
- P and A — not in the HIS file (only G); ask HIS to add `para`/`abortion` later.
- No new cases; no overwriting any existing value; no new approval/evidence gates.

## Constraints
- Every case knows its blood-draw date from PET; this import runs after PET matching (Owner),
  so the check's collection-date requirement is always met.
- Use the existing save paths (paper check service, workspace draft update), never direct row
  writes, so the result is the same as manual entry ("same as existing means same").
- Patient data: file is parsed in memory; nothing stored beyond what is filled.

## Approaches
1. **Reuse the existing paper-check save per case (picked).** Identical outcome to manual save.
2. Write review rows directly — rejected: diverges from manual save (status, snapshot, draft sync).

## Builder's calls (mine, Owner can override)
- Matching key: CID (13 digits) + HN against PET-matched current rounds; either mismatching → not matched.
- Cases whose request is electronic (ANC-entered) get no paper check; only empty weight/height/G filled.
- Doctor name matching ignores title/spacing (reuse `doctorSkeleton`/one-letter tolerance).
- Weight/height 0 → treated as empty (not filled).
- Placement: an "Import HIS" action on the Lab side; wording of buttons/labels to be proposed to the
  Owner before UI text is finalised.
- Focused tests for: GA split/carry, G=0, doctor auto-add, skip-already-checked, fill-only-blank, preview counts.
