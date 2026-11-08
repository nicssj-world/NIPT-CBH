---
version: 1
slug: "src-components-p2-registry-tsx"
primary_target: "src/components/p2/registry.tsx"
related_targets: ["src/components/anc/dashboard.tsx"]
---

Scope: ทะเบียนกลาง (/cases), ภาพรวม (/ ANC dashboard + Lab workload), หน้าเคส ANC ขั้น released, shell. Mode: Operate.
Audience/job: ANC nurses on tablet (people language, "รับแล้วหรือยัง/กำลังตรวจ/มีผลแล้ว"); Lab staff on desktop (Lab language). Owner-locked rules: see plan `ux-ui-promax-soft-umbrella.md` section "ตรวจเทียบกฎเดิมของ Owner".
Mockup (approved, Owner 2026-11-08): https://claude.ai/artifact/GPvtaruSXpCyeQCrc6haAa — direction C "ป้ายบอกทาง" light blue.

## Direction contract
THESIS: Every screen answers "where does this case go next". Light-blue sign bands are reserved for the next step only; everything else is quiet navy-on-white. Refuses the KPI-tile + triple-filter dashboard and the label-repeating pseudo-table.
OWN-WORLD: Pale sky shell (#e3f1fb) with navy ink (#10283b), 4px sky-edge rule (#2b8fd0) under the top bar; white surfaces on #f5f9fc; sign fill #a9daf5 with navy text; primary buttons solid navy; status pills keep text + dot; tabular numerals; Noto Sans Thai, line-height ≥1.55 for Thai, never letter-spaced Thai.
STORY: Nurse sees each mother's progress (รับตัวอย่าง → ตรวจวิเคราะห์ → มีผลตรวจ) and only her own to-dos; Lab sees today's workload by stage and opens a pre-filtered list in one click.
FIRST VIEWPORT: Header (title + one primary action) → 5 filter tiles (ANC) / 4 stage sign-boards (Lab) → one-row toolbar → real table with sticky header, 48–56px rows.
FORM: hospital wayfinding signage, candidate 3 of the grounded list (Owner picked challenger C, recoloured light blue). seed: none (unavailable)
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
