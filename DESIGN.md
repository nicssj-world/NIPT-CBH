# NIPT CBH Design System

## Overview

Thai-first hospital operations. Light theme ตาม baseline ที่ล็อกไว้ งาน Lab ใช้ทะเบียนที่อ่านเร็ว งาน ANC ใน Phase ถัดไปใช้ form-first บนจอเล็ก ระบบแสดงสถานะรอบปัจจุบันและแยกประวัติชัดเจน

## Colors

Source: `src/app/globals.css` / Tailwind 4 build-time `@theme`.

| Role | Token | Value |
| --- | --- | --- |
| Text | ink | #182d42 |
| Secondary text | muted | #4e6173 |
| Primary / hover | brand / brand-hover | #174e72 / #103b58 |
| Page / panel | canvas / surface | #f3f6f8 / #ffffff |
| Borders | line | #cbd5de |
| Success / warning / error | success / warning / danger | #1b6547 / #765016 / #a42431 |
| Keyboard focus | focus | #005fcc |

Status always contains text; color is supplemental. No page-level color overrides.

## Typography

Locally bundled Noto Sans Thai and Noto Sans (OFL) via `@fontsource`. Body 16 px, line-height 1.65; headings 600 weight, h1 1.6–2 rem, h2 1.25 rem. No font/CDN network dependency. LN remains text to preserve leading zeroes.

## Layout

4 px base, spacing 4/8/12/16/24/32/48 px. Desktop sidebar 240 px, main content max 1440 px. Under 900 px navigation wraps above content; under 600 px registry fields reflow into two columns and full-width actions. Controls ≥48 px except inline links ≥44 px. Visible labels/helper text; form errors and recovery text have live announcements.

## Elevation & Depth

Flat bordered white panels; no decorative shadow or animation. Loading skeleton preserves a visible region. Skip link is the only fixed layer, z-index 100. PDF opens as a labeled new tab in P1.

## Shapes

Panels/buttons radius 12 px; inputs and notices 8 px. Consistent 3 px keyboard outline with 3 px offset.

## Components

Native Button/Input/Select/Textarea patterns; Navigation, LoginForm, SettingsEditor, Status, round-labelled Timeline, registry, definition list, EmptyState, loading/error boundaries, PDF/scan actions. Settings edit/approval actions reflect server permissions; maker-checker remains enforced server-side. Loading/empty/error/success states are present. Clinical dialogs, SignaturePad, five-category ANC forms and worksheet components are delivered in their governed phases.

## Do's and Don'ts

- Keep Thai labels, current-round context, visible focus and large controls.
- Use server authorization on every operation; display authorized actions only.
- Preserve LN and source provenance; never ask staff to receive S1 again after HIS.
- Do not put patient data in browser storage, URLs, logs or design fixtures.
- Do not mark a generated baseline or automated axe result as formal user acceptance.
