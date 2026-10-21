---
name: NIPT CBH Lab Bench
description: Observed scoped extension of the pinned Thai Operate system
colors:
  primary: "#075985"
  ink: "#172e46"
  selected-surface: "#e6f3fc"
  danger: "#a1253e"
spacing:
  field-gap: "8px"
  section-gap: "16px"
---

# Design System: Lab Bench scoped record

## Overview

This records the built Lab Bench only; pinned root DESIGN.md/PRODUCT.md remain authoritative. Thai-first desktop laboratory operation, preserving the existing neutral hospital palette and local Noto fonts. Scope: `src/components/p4/lab-bench.tsx` and its CSS. Documenter was completed inline because delegated documenter exhausted its tool quota. This is an observed record, not whole-system acceptance.

## Colors

Reuse the primary, ink, information and danger roles from the incumbent tokens. Selected worksheet buttons use information background and brand border/text. Measurement alerts add explanatory text where applicable. Native Excel derivatives use red for the Owner-required Pooling/QC2 alerts; clinical acceptance remains independent.

## Typography

Inherit locally bundled Noto Sans Thai/Noto Sans and the existing page/header styles. Volume cells use tabular numbers and align right. Sample identifiers stay on one line inside the table scroll region.

## Layout

Standard groups use three equal columns with a 16 px gap on wider screens and one column at 768 px or below. Table cells have 12 px vertical/16 px horizontal padding; table minimum width is 680 px. At 375 px the table scrolls inside its region; the page does not overflow. This keeps full identifiers intact rather than wrapping them into ambiguous fragments.

## Elevation & Depth

Inherit existing panel depth. Worksheet selection and table row rules use tonal/border separation; no new decorative shadow system was introduced.

## Shapes

Reuse existing button/input/panel shapes. Fieldsets and table rows use existing line-color borders.

## Components

Worksheet selector exposes aria-pressed; the selected worksheet is visually distinct. The QC grid labels every physical position and unit. Nine Standard inputs are grouped by strip. Actions distinguish save, calculate, native preview/print and exports. Loading/status/error text uses existing roles. Paper fields are persisted with the existing workbook revision system.

## Do's and Don'ts

Do keep sample identifiers and numerical volumes visually separated. Do retain physical slot order and immutable source identifiers. Do preserve the incumbent theme tokens. Do not treat recorded values, printable worksheets or exported files as accepted QC evidence. Do not infer dark-mode, scanner, physical print or whole-workflow acceptance from light screenshots.

Review evidence: `.local/lab-browser-G65D3X/pooling-{1440,1280,768,375}.png`; reviewer disposition **ship** covers only selected-button visibility and ID/volume separation. Both fixes resolved. Other UX/browser requirements retain their own checklist status.
