# NIPT CBH

<!-- impeccable:product-schema 1 -->

## Platform

web

Web application used from desktop and mobile browsers on a hospital LAN. (Legacy record preserved: docs/ux-projectwide/PRODUCT.legacy-2026-10-19.md.)

## Stack

Owner-selected Next.js 16 / React 19 / TypeScript, Tailwind CSS 4 at build time, self-hosted PostgreSQL, Node worker, isolated Chromium renderer and Docker/OCI. Application is at repository root. All assets are local (no CDN, fonts bundled).

## Users

Confirmed 2026-10-19:
- **ANC staff (nurses):** register the pregnancy case, fill the five-category Request, and run Consent with the patient (Signature Pad, or a Paper Consent marker / refusal). They work mostly on a **tablet or phone at the bedside or counter**.
- **Laboratory staff:** receive HIS PET/OK requests and specimens, then work the FIFO queue, Task List 1–3, QC, pooling, sequencing, Run Photo Evidence and P5 result PDF intake. They work on **desktop PCs at the bench**; phones are used to photograph Run racks.
- **Lab certifiers and clinical approvers:** perform second-person checks, clinical review and result release, on desktop.
- **Administrators:** manage users, roles, units, HIS/storage settings, backup and health. They have no implicit clinical permissions.

ANC and Lab share one case registry. Thai is the primary interface language.

## Product Purpose

NIPT CBH replaces the legacy NIPTY workflow for Chonburi Hospital's NIPT screening. One case moves from ANC request and consent, through HIS reception and laboratory processing, to result PDF intake, review, release and the HIS RES/PDF/OK handoff.

Success means:
- the working PET/OK and RES/OK/PDF protocol is preserved;
- no duplicate entry and no extra workflow steps;
- AL-1 and OD-24 UQ-1–UQ-11 are enforced.

## Positioning

It keeps hospital-specific truth that a generic LIS would not:
- the exact HIS file protocol;
- Owner DCC master workbooks rendered natively (Task List 1–3, F2–F5);
- Genomic-CBH / LN Halos numbering;
- Thai Buddhist Era dates everywhere;
- a redraw keeps the existing LN and receives a new specimen round, while a repeat creates an attempt on the same specimen.

## Operating Context

- Normal office and laboratory lighting. Staff need a light surface, explicit status text and large controls.
- ANC works form-first on small screens, often with the patient present (signature on a touch screen).
- Lab works with dense registries, worksheets and second-person checks, and prints labels and DCC PDFs.
- Owner decisions are recorded in `docs/p0-owner-decision-register.md` and the plan documents. They are binding and outside the scope of UI work:
  - PET reception;
  - FIFO / Task List rules;
  - QC gates;
  - Consent decisions, including Paper as a marker only and Paper refusal blocking every gate;
  - Result/HIS gates;
  - the P5 result folder scanned only when "สแกนไฟล์ PDF" is pressed;
  - DCC original templates;
  - Run photos are optional and never gate work.

## Capabilities and Constraints

- The current release runs on generated synthetic data only. There is no live HIS, no actual patients, no historical promotion, and no clinical certification or release. Original legacy archives supply the compatibility reference and are never a separate runtime.
- Every user-facing date is Thai Buddhist Era (`วว/ดด/ปปปป`). APIs stay ISO CE.
- LN stays text to preserve leading zeroes. No patient data in browser storage, URLs, logs or design fixtures.
- Server authorization is enforced on every operation; the UI shows only authorized actions. Maker-checker stays server-side.
- UI work must not add approvals, confirmations, mandatory uploads or extra clicks.

## Brand Commitments

- Product name NIPT-CBH; Chonburi Hospital artwork (`public/brand/hospital.png`, original 3:2) and the product logo (`public/brand/ui-logo.png`).
- Thai-first copy.
- Light theme is the locked default. The dark theme toggle stays supported and contrast-checked, but light is the focus (confirmed 2026-10-19).

## Evidence on Hand

- Synthetic fixtures only: the seeded foundation cases, plus the legacy handover samples, which are fictional and kept outside the repository.
- Owner DCC reference PDFs and master workbooks are read in place and are never copied into the repository.
- No real patient data and no user-acceptance results exist. An automated axe result or a generated screenshot baseline is never formal user acceptance.

## Product Principles

1. Clinical gates and Owner decisions are product truth. The UI makes them clear and never relaxes them.
2. One entry per fact: never ask staff to re-enter or re-receive what the system already has.
3. Current round first, history clearly separated.
4. Status is always stated in words; colour is only supplemental.
5. The same patterns hold on every screen, so ANC on a phone and Lab on a desktop learn the system once.

## Accessibility & Inclusion

Required standard: **WCAG 2.2 AA** (confirmed 2026-10-19), as enforced by the Playwright axe gates (wcag2a/aa, 21a/aa, 22aa). Further requirements:
- keyboard operation with a visible focus;
- touch targets of at least 44 px;
- live announcements for errors and recovery;
- Thai text that is readable at 375 px.
