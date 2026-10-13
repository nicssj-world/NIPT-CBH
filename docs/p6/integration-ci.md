# P6/P5H integration CI correction — 2026-10-13

PR #7 initial candidate `0cb5af0` ran 1,844 Vitest tests successfully (35 optional tests skipped), production dependency audit and build passed. GitHub Actions PR run 38398070421 and push run 38398027855 each failed only the two P5H browser tests: their manually created browser contexts defaulted to port 3600 while the configured CI app used port 3000. No product, database or migration defect was indicated by this failure.

Corrected the P5H context default to the same 3000 used by the main Playwright configuration and existing P5 contexts, including the existing local TLS opt-in. Focused native Windows/Chromium verification used a newly initialized PostgreSQL 17.11 cluster bound only to 127.0.0.1:55448 and a fresh reserved synthetic browser database; actual app/worker/renderer, E2E_BASE_URL absent, web on port 3000: **2/2 passed (10.4 s)**, including all 47 historical rows and ANC permission denial. Test processes and that owned database server stopped after verification. A preliminary local harness run reloaded an old ignored E2E_BASE_URL=3700 and failed before exercising the fix; the final explicit no-env configuration above supersedes that harness result.

Required CI must pass on the corrected head before merge. Synthetic tests do not approve AL-5/6/8 or Staff UAT, and no deployment was performed.
