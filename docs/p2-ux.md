# P2 synthetic workflow and UX evidence

Scope: AL-2 synthetic implementation, 12 October 2026. No clinical eligibility approval, real patient/signature intake, Production release, or operator acceptance is claimed. P1 integration and result-PDF routes remain unchanged. Backend contract is Task 1, reviewed before Task 2 started.

## Flow and wireframe

```text
Overview / central registry
  LN/HN digit search → existing shared case
  authorized ANC or Lab registration → unit + LN/HN text → duplicate-safe shared case
Case S[n]
  Request [Electronic | Paper]       Consent [Electronic | Paper]
  Electronic: five-category dialog  Electronic: authorized doctor version → prepared draft
    1 patient / optional facility     device handover → isolated patient-only route
    2 pregnancy / EDD / S[n] draw      12 server acknowledgments → explicit decision → vector
    3 history / conditional facts     complete / cancel / expiry → original preparer return
    4 explicit sex / SCA choice        password + attestation → final snapshot or stale warning
    5 A/B facts, applicability pending
  Paper: ANC reference/location Pending, certifier 13-item conditional review
  History: immutable revisions / paper changes / round dates / withdrawal evidence
  PDF: locked Request or prepared/final Consent → one transient asset → preview/save/print
Doctor registry: proposer → different authorized checker → versioned stored signature
```

Desktop keeps the incumbent full-width left-aligned workspace, sidebar, blue/slate tokens and local Noto Thai font. Two columns group related fields; mobile uses one column and scrollable native modal. Persistent step navigation and saved/dirty/error status precede fields. Required red stars include an accessible text name. Conditional content appears beside its originating fact. No unanswered/Unknown value is converted to No. Zero age/GA are displayed; BMI is rounded only for display, with the raw calculated value visible.

Real Plan LN is ten digits, formatted `xx-xxx-x-xxxx` with the last four digits red. Existing synthetic 12-digit fixtures remain valid and leading zeros are text. No global fixed-length LN restriction was introduced. Search is LN/HN digit search; patient name search is outside the backend contract.

## Skill decisions

UI/UX Pro Max design-system, Next.js stack and UX searches were run once during planning; Impeccable context/new-work/operate and craft-floor were read before implementation. Local planning evidence is `.local/p2-work/ui-plan.md` and `ui-*-search.txt`. Their recommendations were reconciled with PRODUCT/DESIGN and source-locked behavior. No decorative redesign, new remote font, modal dependency, runtime inline styles or browser data storage was added. CSS classes respect the nonce-only CSP. Accessible native controls and `<dialog>.showModal()` provide keyboard behavior; explicit opener restoration and dirty-close choice preserve context.

Autosave uses server versions, stable comparison, and a queued save when edits arrive during an in-flight request. Network errors retain the in-memory draft with retry. A conflict displays each differing field in Thai and requires a choice before writing against the latest version. A locked Request amendment requires a reason. Conditional A/B facts do not invent clinical thresholds. Pending paper history names the capturing/preparing actor, rather than claiming verification.

Patient simulation is outside the protected staff layout; the actual backend freezes staff sessions across tabs. The UI has no staff navigation, prechecked acknowledgments, image upload, token URL, or substitute staff signature. Signature drawing supports pointer input and clear; inability to draw leads to the Paper alternative. A stale completed signing return explicitly states that no final Consent was created. Representative signing uses Paper. Withdrawal preserves prior snapshots and keeps the case on hold.

## Verification and limits

Reproducible browser evidence is in `tests/e2e/p2.spec.ts`; P1 regression remains in `foundation.spec.ts`. It covers live HTTP/DB operations, all four mode combinations, permission denial and durable `audit_chain` evidence, server autosave/conflicts/retry, zero age/GA, raw BMI40.004, Paper conditional evidence/amend/replace/decline, vector grant/decline/clear/empty rejection, frozen staff, original preparer return, cancellation/expiry/stale return, PDF identical bytes/cross-session denial, withdrawal and no browser storage. The expiry test inserts a separately expired synthetic fixture into an isolated browser database; it does not alter immutable expiry or wait ten minutes.

Automated axe checks include all A/AA impacts and record incomplete findings. Responsive widths are 375/768/1280/1440. Browser keyboard assertions cover Escape, dirty-close choice, focus containment and opener restoration. These are automated browser evidence, not NVDA or hospital operator trials. Manual all-success-criteria review, touch/pen hardware, native print dialogue, 400% zoom/text spacing, task timings/CLS, clinical/DPO/DCC and formal owner visual acceptance remain pending. The signature Paper alternative must be included in the assistive-technology trial.

Visual evidence is one deliberate Windows baseline batch after functional stabilization; the controller reserves a second fresh-database comparison. Baseline creation is implementation evidence and does not constitute Owner approval. P1 registry snapshots are refreshed because the authorized P2 shared registry adds document/progress information. See `docs/accessibility.md` for the additive per-screen ACR checklist and [p2-delivery.md](p2-delivery.md) for durable execution and review evidence.

Batch1 identified retained Request dialog scroll after category changes. Resetting scroll on each category change keeps the title/close visible; a375/1440 browser test covers this correction without another screenshot pass. The6 affected pre-fix screenshots are retained until the controller's reserved batch2 refresh. A subsequent source/incomplete review corrected generic-span ARIA naming. No formal visual approval is inferred from either correction.
