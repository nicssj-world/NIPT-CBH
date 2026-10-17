# Shared Premium UX V2 visual foundation

Implemented against approved Concept B in the separate `NIPT-CBH-DESIGN-V2` worktree. Original hospital and product PNGs remain unchanged; no form, document, signature or PDF branding was replaced.

## Changed surfaces

| Surface | Actual implementation |
| --- | --- |
| All protected pages | Light sidebar, original brand lockup, route context header, original hospital mark, Light/Dark toggle, native dialog mobile navigation, permission-filtered existing destinations |
| Login | Split desktop composition and compact mobile form; unchanged authentication, validation and password visibility behavior |
| ANC Request | All five sections retained, native radio groups, visible selected/focus/required/error states, explicit clear control, history facts and mobile footer; existing dialog/dirty-close logic retained |
| Registry / Lab / batches | Shared native table, filter, bulk action, selection and controls styling; identifiers, statuses, columns and workflow actions preserved |
| Results | Shared tables, review panels and evidence gate spacing/mobile reflow; no readiness mapping inferred by CSS |
| Settings / users | Shared fields, locked-state backgrounds, section separation, navigation and tables; server authorization and Maker-Checker unchanged |

Reusable palette covers canvas/surface/raised/text/divider/control/primary/focus and success/warning/danger/info/neutral. Domain components choose states. Theme changes do not write patient or workflow data. Existing locally bundled Noto Sans Thai is retained.

## Evidence

- Targeted ESLint passed for `app-frame.tsx`, `navigation.tsx`, protected layout and login page.
- `npx tsc --noEmit` passed after root dashboard changes.
- `git diff --check` passed.
- Impeccable detector returned `[]` for shared implementation targets.
- Real browser on isolated `https://127.0.0.1:19518`: `/lab`, `/lab/batches`, `/results`, `/settings`, `/settings/users`, `/cases`, each at1440px and375px, Light andDark; measured document width equalled viewport in all24 combinations.
- Native mobile dialog opens; Escape closes and restores menu-button focus; following a destination closes it. Theme state and toggle remain consistent through login. No page errors in shared shell check.
- Actual existing Request history section:30 native radio controls,960px desktop dialog and359px mobile dialog; no page overflow at1440px/375px in both themes. No clinical answers changed for screenshots.
- Screenshots: `.local/ux-v2/screens/shared-*`; machine-readable measurements: `.local/ux-v2/screens/shared-checks.json` and `.local/ux-v2/shared-visual/checks.json`.
- Side-by-side approved reference/local implementation: `.local/ux-v2/shared-visual-comparison.html`. Synthetic runtime content and the existing governed dialog differ from prototype content/composition.

Final small skip-link layering, print theme reset and exact status-palette CSS were added after the first browser image and require the final coordinated rebuild. Those final CSS changes are not claimed as observed in that earlier image.

## Original asset SHA-256

- ui-logo.png: `ACC37118CA5B10A2837B7BCB44019D130A9D53187A0D03301A5198ABCE4D6182`
- product-transparent.png: `2111F7A2FBEC7259D4FE2E6F76C1DDCC23F9A640ED7FF85B9A44EB7F32C2EE5C`
- hospital.png: `5993EF12A0A8A4ED70DC496E3EA490A59149316FA5DEC0E45D0599816B034511`

Source and public copies were SHA-256 compared. Hospital artwork retains3:2 proportions and a light backing surface inDark mode.

No commit, push, merge or deploy was performed by the shared visual worker. Browser evidence is local synthetic evidence; it does not establish staff/device/assistive-technology/clinical acceptance.
