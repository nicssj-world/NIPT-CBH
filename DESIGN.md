# NIPT CBH Design System

## Overview

Thai-first hospital operations. Light theme ตาม baseline ที่ล็อกไว้; a dark theme toggle is supported and contrast-checked but light is the focus (confirmed 2026-10-19). งาน Lab ใช้ทะเบียนและตารางที่อ่านเร็วบน desktop, งาน ANC ใช้ form-first บน tablet/มือถือ. ระบบแสดงสถานะรอบปัจจุบันและแยกประวัติชัดเจน.

Previous record (pre-V2 values): `docs/ux-projectwide/DESIGN.legacy-2026-10-19.md`.

## Colors

Source: `src/app/globals.css`, "Premium UX V2, approved Concept B" `:root` block (overrides the earlier `@theme` values) and `html[data-theme="dark"]`.

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Text | `--color-ink` | #172e46 | #eaf0f7 |
| Secondary text | `--color-muted` | #52687d | #adbed0 |
| Primary / hover | `--color-brand` / `--color-brand-hover` | #075985 / #06476a | #7dd3fc / #a7e2fc |
| Text on primary | `--on-primary` | #fff | #092d43 |
| Page / panel | `--color-canvas` / `--color-surface` | #f3f6fa / #fff | #0c1422 / #142236 |
| Raised (table head, chips) | `--raised` | #eaf1f7 | #1b3048 |
| Borders / input borders | `--color-line` / `--input-line` | #dce5ee / #718398 | #344b64 / #8195ab |
| Success / warning / danger | `--color-success` / `--color-warning` / `--color-danger` | #17603b / #80510a / #a1253e | #8ee8b1 / #f6d388 / #ffb1bf |
| Status backgrounds | `--good-bg` / `--warn-bg` / `--bad-bg` / `--info-bg` | #e7f5ec / #fff3d6 / #fce9ee / #e6f3fc | tonal darks |
| Keyboard focus | `--color-focus` | #005fcc | #38bdf8 |

Status always contains text; colour is supplemental. No page-level colour overrides. Focus colour is for keyboard focus only. Selected and current states use `--info-bg` with a `--color-brand` border, not the focus outline.

## Typography

Locally bundled Noto Sans Thai and Noto Sans (OFL) via `@fontsource`; no font or CDN network dependency.
- **Body:** 16 px, line-height 1.65.
- **Headings:** weight 600; h1 1.75 rem (24 px under 600 px), h2 1.25 rem.
- **Labels:** 14 px.
- **Help text:** 13 px.
- **Tables:** 14 px.
- **Numerals:** LN stays text to preserve leading zeroes. Use tabular figures for LN, counts and times.
- **Dates:** every user-facing date is Buddhist Era, `วว/ดด/ปปปป` (`formatBe` / `ThaiDateInput`). ISO CE appears only in APIs.

## Layout

- **Spacing:** 4 px base; scale 4/8/12/16/24/32/48 px.
- **Desktop:** 244 px sidebar, content up to 1600 px; data-table pages go full width.
- **Under 900 px:** the sidebar becomes a dialog menu.
- **Under 600 px:** single-column forms, and buttons are full width except inline controls (BE calendar button, dialog close, photo stage bar).
- **Controls:** at least 48 px tall; inline links and small buttons at least 44 px.
- **Verified widths:** 1440, 1280, 768, 390 and 375 px, with `tools/ux-audit/audit.ts`.

## Elevation & Depth

- Panels are white with a soft `--surface-shadow`, radius 16 px (12 px on phones).
- Nested panels flatten into a top border, never card-in-card.
- Dialogs use the same surface over a 60 % ink scrim.
- The only fixed layers are the skip link and the local UAT banner.

## Shapes

- Buttons and inputs: radius 9 px.
- Panels: 16 px.
- Chips and badges: 6 px.
- Keyboard outline: 3 px, with a 3 px offset.

## Components

The shared primitives are:
- Native Button / Input / Select / Textarea patterns.
- `Field` (label, help, error with `aria-describedby`), `Dialog`, `ErrorNotice` and `Status` (`src/components/p2/shared.tsx`).
- `ThaiDateInput`, `ThaiDateTimeInput` and `ThaiDateFormField` (`src/components/shared/thai-date-input.tsx`).
- Navigation and AppFrame, plus registry, timeline and definition list.

Patterns standardised in the 2026-10-19 project-wide pass:
- **Action groups:** sibling buttons always sit in `.action-bar` (wrapping row, 12 px gap). Never stack bare buttons with no gap. A destructive action is never adjacent without a gap.
- **Scrollable tables:** `.table-wrap` is always `role="region"` with a Thai `aria-label` and `tabIndex={0}`, so it is keyboard-scrollable (WCAG 2.1.1).
- **Checkbox rows:** `label.check-label` keeps the box and its text on one line inside `.stack`, `fieldset` and form grids.
- **Search rows:**
  - A single-field `.search-form` aligns its buttons with the input, not with the helper text.
  - A multi-field filter keeps bottom alignment.
- **Error versus empty:** a failed load shows the error and a retry, never an empty state beside it.
- **Overview shortcuts:** `QuickActions` lists only destinations the sidebar already grants (same `authorize` checks), with a one-line purpose each. Links only, with no counts and no new step.
- **Settings sub-navigation:** `AdminNavLink` marks `aria-current="page"`.
- **Disclosure:** a flex `summary` draws its own chevron, because the native marker is lost.

## Do's and Don'ts

- Keep Thai labels, current-round context, visible focus and large controls.
- Use server authorization on every operation; display authorized actions only.
- Preserve LN and source provenance; never ask staff to receive S1 again after HIS.
- Do not add approvals, confirmations, mandatory uploads or extra clicks in UI work.
- Do not put patient data in browser storage, URLs, logs or design fixtures.
- Do not mark a generated baseline or automated axe result as formal user acceptance.
