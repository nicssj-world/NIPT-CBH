# Restore existing overview/registry LN links and highlights

2026-10-22 · **PASS — restored in Local UAT**. Source and baked Web/Worker/Renderer revision **c7cba91bdf79ae3673193b9d9b6689cc413f9209** match; clean `.local/ln-highlight-uat-source`. Final health ready=true, FRESH Worker, Renderer200, Excel bridge IDLE, unchanged Master/migration inventory, loopback-only.

Root cause: the date/Toast builds used clean snapshots of committed source. The Owner's existing hover/focus highlights and clickable LN changes were still uncommitted in the primary worktree, so they were preserved on disk but excluded from those runtime snapshots. They were not deleted. This source/runtime omission caused the visible regression.

Reproduced on the live Local UAT before restoration: `/` ANC overview and `/cases` registry each had **0 LN links** matching the existing accessible label. Computed row styles were identical before/after hover: transparent background, no highlight shadow. Evidence `.local/ln-highlight-evidence/before-browser.json`.

Restoration commit **c7cba91** contains only the existing LN links/row highlights in `src/app/globals.css`, `src/components/anc/dashboard.css`, `src/components/anc/dashboard.tsx`, `src/components/p2/registry.tsx`, including the existing “ดูเคส” action labels. The separate pending dashboard scrollbar and ANC database-test edits were left uncommitted. Candidate blobs were staged selectively; primary worktree file contents were not overwritten. Original hashes: `.local/ln-highlight-evidence/original-worktree-hashes.json`.

Validation: affected unit tests **22 PASS / 0 FAIL** in5files (`anc-dashboard`, `anc-presentation`, `p2-operational-ui`, `owner-ui-consistency`, actual `save-toast` component); lint/typecheck/guard PASS. Logs `.local/ln-highlight-evidence/affected-tests.log`, `lint.log`, `typecheck.log`, `guard.log`. No Full Regression rerun, migrations, database reset, push/merge/deploy/Hospital/EXE.

Final actual Browser checks PASS:
- ANC overview and registry, Desktop1280/Mobile375, Light/Dark: LN anchors navigate to the correct case with Enter; row/card focus highlight is visible; no document overflow. LAB role overview and registry also pass Desktop/Mobile navigation/highlight.12 keyboard-navigation scenarios in `after-browser.json`,0page errors.
- Actual mouse clicks on LN succeed for both ANC and LAB overview/registry (4scenarios): `pointer-clicks.json`.
- Computed hover styles changed from transparent/no-shadow to the existing brand-tinted background/inset highlight on both pages. Screenshots were visually inspected, including `overview-1280-light.png`, `lab-overview-1280.png`, `registry-375-dark.png`, `overview-375-light.png`.
- Existing60cases/4batches/3releases and16stored artifacts preserved;19data-group hashes and artifact hashes unchanged after rebuild: `owner-restart-persistence.json`. All5original primary-worktree file byte hashes still match before restoration: `worktree-preservation.json`. No original dirty source contents overwritten.
- `final-health.json` and `final-provenance.json` bind the observed runtime to the exact restored commit. Earlier date and Toast features remain included.

Clean runtime source: `.local/ln-highlight-uat-source`. URL https://127.0.0.1:19548/login. Current launcher:

```powershell
& tools/operational/Home-UAT.ps1 -Action Start -SourceSnapshot '.local/ln-highlight-uat-source'
& tools/operational/Home-UAT.ps1 -Action Health -SourceSnapshot '.local/ln-highlight-uat-source'
& tools/operational/Home-UAT.ps1 -Action Stop -SourceSnapshot '.local/ln-highlight-uat-source'
```

**OWNER-UAT=PENDING**. Date/Toast changes remain in ancestry; no workflow or clinical rule changes.
