---
name: NIPT CBH
description: Thai-first hospital laboratory console. Light-blue wayfinding, dense tables, status always in words.
colors:
  canvas: "#f5f9fc"
  surface: "#ffffff"
  ink: "#10283b"
  muted: "#4f6476"
  line: "#d8e6f0"
  input-line: "#6b8094"
  raised: "#edf4f9"
  brand: "#14476b"
  brand-hover: "#0e3552"
  focus: "#005fcc"
  info: "#0b4f7a"
  success: "#17603b"
  warning: "#7a4f00"
  danger: "#a1253e"
  good-bg: "#e5f4ea"
  warn-bg: "#fff2d1"
  bad-bg: "#fce8ed"
  info-bg: "#e4f0f9"
  shell-bg: "#e3f1fb"
  shell-active: "#c6e3f6"
  shell-ink: "#0b2f4a"
  shell-muted: "#4f6f86"
  sign: "#a9daf5"
  sign-edge: "#2b8fd0"
  sign-soft: "#e3f2fb"
  on-sign: "#0b2f4a"
typography:
  body:
    fontFamily: "Noto Sans Thai, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  h1:
    fontFamily: "Noto Sans Thai, sans-serif"
    fontSize: "clamp(1.6rem, 3vw, 2rem)"
    fontWeight: 600
    lineHeight: 1.4
  h2:
    fontFamily: "Noto Sans Thai, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.5
  label:
    fontFamily: "Noto Sans Thai, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.55
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.brand}"
    rounded: "{rounded.lg}"
    height: "48px"
  icon-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.brand}"
    rounded: "{rounded.md}"
    size: "44px"
  next-sign:
    backgroundColor: "{colors.sign}"
    textColor: "{colors.on-sign}"
    rounded: "{rounded.sm}"
    padding: "5px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: NIPT CBH

## Overview

A Thai-first operating console for a hospital NIPT laboratory and its ANC clinics. The nurse wants to know three things: was the specimen received, is it being analysed, is the result out. The laboratory wants to know where each Run stands and what is left to do. The interface is a wayfinding system: light-blue signs say where you are and where to go next, tables are dense and quiet, and nothing relies on colour alone.

Light theme is the default and the focus; the dark theme is supported and contrast-checked. Tokens live in `src/app/globals.css` (`:root` and `html[data-theme="dark"]`); the shell is in `src/components/shell.css`; shared console parts (progress cell, signs, icon button) are in `src/components/shared/console.css`. This file replaces the earlier "Concept B" record (Owner 2026-11-09); the older record is kept in `docs/ux-projectwide/DESIGN.legacy-2026-10-19.md`.

Product rules that the design must never break are in `PRODUCT.md`: dates are Buddhist Era, LN keeps its leading zeroes, status is always a word, no new approvals or extra clicks, no patient data in URLs or browser storage.

## Colors

Names are stable (other CSS reads them); values were retuned to the light-blue palette.

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Page / panel | `--color-canvas` / `--color-surface` | #f5f9fc / #fff | #0a141c / #122130 |
| Text / secondary text | `--color-ink` / `--color-muted` | #10283b / #4f6476 | #e6f1f9 / #9db4c6 |
| Primary / hover | `--color-brand` / `--color-brand-hover` | #14476b / #0e3552 | #8fcdf1 / #b5def6 |
| Borders / input border | `--color-line` / `--input-line` | #d8e6f0 / #6b8094 | #24394c / #7f97ab |
| Raised (table head, chips) | `--raised` | #edf4f9 | #182a3b |
| Success / warning / danger | `--color-success` / `--color-warning` / `--color-danger` | #17603b / #7a4f00 / #a1253e | #8ee8b1 / #f6d388 / #ffb1bf |
| Status backgrounds | `--good-bg` / `--warn-bg` / `--bad-bg` / `--info-bg` | #e5f4ea / #fff2d1 / #fce8ed / #e4f0f9 | tonal darks |
| Shell (sidebar, top bar) | `--shell-bg` / `--shell-active` / `--shell-ink` | #e3f1fb / #c6e3f6 / #0b2f4a | #0c1b27 / #16314a / #e4f2fc |
| Wayfinding sign | `--sign` / `--sign-edge` / `--on-sign` / `--sign-soft` | #a9daf5 / #2b8fd0 / #0b2f4a / #e3f2fb | #8fcdf1 / #8fcdf1 / #06223a / #123049 |
| Keyboard focus | `--color-focus` | #005fcc | #38bdf8 |

- The accent is the sign blue. It marks the current place (top-bar rule, active navigation item) and the next step (`.next-sign`). Everything else is neutral blue-grey.
- Status always contains text; colour is supplemental. A status uses an icon plus a word, never a coloured dot alone.
- The last four digits of an LN are red (`.ln-tail`, `--color-danger`) everywhere an LN is shown, through the `Ln` component only. Never print an LN as raw text.
- Small text must reach 4.5:1 on its own background. Page-local palettes (for example `sample-storage.module.css`) follow the same floor.
- Focus colour is for keyboard focus only.

## Typography

Noto Sans Thai (OFL), bundled locally through `@fontsource`; no font or CDN network dependency.

- Body 16 px, line-height 1.65. Thai text never goes below line-height 1.5 and never uses letter-spacing.
- h1 `clamp(1.6rem, 3vw, 2rem)`, h2 1.25 rem (section titles on the case page are 20 px), weight 600.
- Table text 14–15 px; labels and chips 13 px (`.8125rem`) at weight 600; help text 13 px.
- Thai has no word spaces: headings and paragraphs use `overflow-wrap: break-word` (not `anywhere`, which splits syllables inside flex and grid cells).
- Numerals: tabular figures for LN, counts and times. LN is text so leading zeroes survive.
- Dates are Buddhist Era, `วว/ดด/ปปปป`, through `formatBe`/`ThaiDateInput`. ISO CE appears only in APIs.

## Layout

- **Spacing** is a 4 px base: 4 / 8 / 12 / 16 / 24 / 32 / 48.
- **Lab and administrators:** 240 px left sidebar on `--shell-bg`, grouped by work (daily work, laboratory, results, system), with a thin top bar showing a group / page breadcrumb over a 4 px sign-blue rule. Content is up to 1440 px; data-table pages use the full width.
- **ANC nurses:** a top navigation bar with the same rule and sign-blue active item.
- **Breakpoints:** 900 px (sidebar becomes a menu, tables become cards) and 600 px (single-column forms, full-width buttons except inline controls).
- **Tables:** a real `<table>` on desktop, row height `--row-h` 56 px, sticky header, toolbar controls `--control-h` 44 px. Form controls in dialogs are 52 px (`--ui-control-height`). Inline links and small buttons are at least 44 px.
- **Scrollable regions:** `.table-wrap` is always `role="region"` with a Thai `aria-label` and `tabIndex={0}`. A top scroll rail appears only when the table overflows.
- **The case page** has one layout for every role: numbered sections, in a fixed order per stage (registered, received, released) that CSS applies and `tests/unit/case-page-order.test.ts` locks. Do not reorder.
- Verified at 1440, 1280, 768, 390 and 375 px with `tools/ux-audit/audit.ts`.

## Elevation & Depth

- Panels are white with a hairline `--color-line` border and a very soft `--surface-shadow`; radius 12 px.
- Nested panels flatten into a top border, never card-in-card.
- Dialogs use the same surface over a 60 % ink scrim. The only fixed layers are the skip link, the sticky table header, the sticky save bar and the local UAT banner.

## Shapes

- Panels and primary buttons 12 px; inputs and icon buttons 8 px; chips and signs 6 px; status pills and progress tracks fully round (999 px).
- Section numbers are a 26 px circle on `--raised`; section icons sit in a 40 px rounded tile on `--info-bg`.
- Keyboard outline 3 px with a 3 px offset.

## Components

- **Buttons:** primary (filled brand), secondary (surface with brand text and `--color-line` border), danger variants for destructive actions, kept apart from the main action. Sibling buttons sit in `.action-bar` with a 12 px gap.
- **Icon button (`.icon-btn`):** 44 px square, one outlined glyph from `LabIcon`, brand colour (red for destructive). The accessible name is `aria-label` and the same text is the `title` tooltip, for example "ลบรายการลงทะเบียน LN …".
- **Status pill and progress cell:** an icon, a word and, for ANC, a three-step track (รับตัวอย่าง → ตรวจวิเคราะห์ → มีผลตรวจ). ANC screens use people language ("กำลังตรวจวิเคราะห์"), never laboratory stage names. A repeat blood draw adds a "เจาะเลือดครั้งที่ N" chip.
- **Next sign (`.next-sign`):** the nurse's next step as a sign-blue link with an arrow; it opens the case. Empty when nothing is pending: there is no "nothing to do" text.
- **Run header (Lab):** four steps — Task List, QC Measurements, Pooling, Sequencing — each with icon, step number and evidence-based status words ("ล็อกตำแหน่งครบแล้ว", "บันทึกครบแล้ว", "ยังไม่เสร็จ", "ไม่ทราบสถานะ" when unreadable, never "done" by default). The Batch list badge shows the furthest saved step.
- **Repeat badge:** a text-labelled pill "Re-Library", "Re-Extraction" or "Re-Sampling" with an icon, beside the sample ID on every Run page.
- **Case section header:** icon tile, then the number, then the title, for every section (the HIS and NIPT result sections set the pattern). Collapsed sections (history, HIS order history) use the same header inside `<summary>`.
- **Registry table (ทะเบียนกลาง, Owner 2026-11-14: the only case list; the ANC overview queue was folded in):** ANC columns คุณแม่ · วันที่ส่งตรวจ · อายุครรภ์ (GA) ณ วันเจาะเลือด · วัน/เวลารับสิ่งส่งตรวจ · ความคืบหน้า · actions; Lab keeps its LN-first columns. There is no "สิ่งที่ต้องทำ" column and none may return: High Risk, HOLD, an open identity issue and Paper Consent are marks inside the progress / status cell. GA over 18+0 is red with a warning icon. Toolbar: search (never in the URL), unit, send date, sort, refresh; then a status chip row and a follow-up chip row with the server's facet counts, and a "กรองอยู่ … ล้างตัวกรองทั้งหมด" line. Every filter except the search text lives in the URL (`/cases?status=…&flag=…`).
- **Lab registration dialog:** each LN/HN is matched with its PET as it is entered and listed with an icon and words (matched, not matched with the reason, duplicate); one confirm button registers only the matched entries and shows a summary of registered, not registered and the numbers to check. The Lab channel is paper only, so there is no consent choice.
- **Shared primitives:** `Field` (label, help, error with `aria-describedby`), `Dialog`, `ErrorNotice`, `Status`, `Ln`, `Pager`, `ThaiDateInput`, `TableScroll` (`src/components/p2/shared.tsx`, `src/components/shared/`).
- **Error versus empty:** a failed load shows the error and a retry, never an empty state beside it.
- **Dashboard (Owner 2026-11-14, the home page, formerly "ภาพรวม"; `src/components/anc/dashboard.tsx`, `src/components/lab-workload.tsx`):** current work only, never a patient list or a queue table. Order: page header (Dashboard, scope, time, actions) → "ต้องดูตอนนี้" alert pills (icon + words + count, only above 0, else one calm line) → one row of KPI link cards (`Kpi`: label with its period, number, sub line; "—" when the source failed, never 0) → Lab only: the stage signs → a 2×2 grid of chart panels. Every card, pill and chart row opens the page that owns the list: the registry with filters, a Lab worklist tab (`/lab?tab=…`), the Batch list or results. Counts that open the registry come from the registry's own summary (`summary=1`), so the number and the list always agree. Statistics (monthly, yearly) stay on the statistics tab/page; the Dashboard never repeats a monthly chart.
  - *Charts:* `LinkBars` (horizontal bars, the whole 44 px row a link with a chevron, parts stacked by TAT state) and `Columns` (short buckets: working days waited with a dashed TAT limit, or the last 14 days grouped). Bars are SVG (the CSP forbids style attributes). The panel h2 names the chart; the figure caption stays for screen readers. Empty data says so in words instead of empty axes.
  - *TAT status:* icon + words — "เกินกำหนด", "ใกล้ครบ (≤ N วัน)", "ภายในกำหนด"; danger / warning / success tones always with the words in the legend.
  - *Statistics charts* (`MonthBars`, `StackedMonthBars`, `TrendLines`, `HBars`, `Histogram`): monthly columns on one axis, at most two series, bars ≤ 24 px with a 4 px rounded end, hairline grid, a hover / keyboard readout, and "ดูเป็นตาราง" under every chart. Series colours are chart-local and validated (light `#2b8fd0` / `#eb6834`, dark `#3987e5` / `#d95926`); text never uses them.

## Do's and Don'ts

Do
- Keep Thai labels, the current-round context, visible focus and 44 px targets.
- Show status as icon plus word; show the same status words on every page of a Run.
- Use the `Ln` component for every LN, and Buddhist Era for every date.
- Use server authorization on every operation and display only the actions the user is allowed.
- Check any new text against `PRODUCT.md` and the Owner decision register before changing wording, tab names, column order or button labels.

Don't
- Add approvals, confirmations, mandatory uploads or extra clicks in UI work.
- Rely on colour alone, put letter-spacing or a line-height below 1.5 on Thai text, or let `overflow-wrap: anywhere` split Thai syllables.
- Reorder the case page sections, or reintroduce a tick, a barcode on the tube label, or a consent choice in Lab registration without a new Owner decision.
- Put patient data in browser storage, URLs, logs or design fixtures.
- Present a generated baseline or an automated axe result as formal user acceptance.
