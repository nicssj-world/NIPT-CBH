# P2–P3 synthetic integration handoff

This is a contract record for the subsequent integration review, not an implementation or approval of P3. P2 resumes from P1 `4cc73997af51878599e744738198572256a66f4e`; the four inherited P2 backend commits end at `456e65d4e40ea055a1a134302e5f1bce09f2ba0f`. During resume preflight, P3 was a separate `feat/p3-inbound-synthetic` worktree at `4b980e221dc17694c1578c62863c31810e7a794c`, with Draft PR [#1](https://github.com/nicssj-world/NIPT-CBH/pull/1). Its contents were not merged, edited or certified by this P2 delivery.

## Actual P2 identity contract

`packages/p2/service.ts:registerP2(db, user, input, key)` consumes a transaction-bound `Queryable`, an authenticated principal/session, validated registration input and a **32-byte lookup key**. The HTTP adapter reads `IDENTITY_LOOKUP_KEY_FILE` outside the database transaction and invokes the service inside `withTransaction`. It requires synthetic mode, session authorization, same-origin CSRF and the appropriate ANC/LAB_DIRECT unit permission.

LN/HN are text. LN trims outer whitespace and removes display hyphens; HN trims outer whitespace. Neither is converted to a number, padded or stripped of leading zeros. The restricted synthetic input namespace is `0*990` followed by 3–17 digits, subject to the LN input's 6–24 character bound. This is a development safety restriction, **not a real HIS LN-length specification**.

The identity digest is `identityLookup(JSON.stringify([normalizedLn, hn]), key)`: HMAC-SHA256, lowercase hexadecimal. The shared `identityLookup` helper trims/uppercases its input; for this numeric JSON pair the serialized pair is unchanged. The key is secret material supplied through a file, never a public fixture, request field, database column or source constant. Key rotation/replacement is an integration/governance decision because it changes matching digests; do not silently regenerate it against existing identities.

| Storage | Meaning and constraints |
| --- | --- |
| `nipt_case.identity_key` | Shared registration's keyed identity digest; P2 uses the LN/HN pair contract above |
| `case_ln` | Versioned text LN linked to the case, existing P1 normalization/uniqueness rules retained |
| `p2_case_identity` | One immutable row per case: `case_id` primary/foreign key, text `hn`, mandatory `synthetic=true`; UPDATE/DELETE rejected |
| `case_unit_scope` | Authorized unit visibility, established atomically for a newly created case |
| `specimen_round` / `p2_workspace` | Initial round and per-round draft/modes; composite round/case binding prevents cross-case evidence |
| `registration_attempt` | Request-bound idempotency evidence; the shared service hashes LN, identity digest, origin and actor |

Existing P1 seed/PET identity digests use `identityLookup(SYNTHETIC-ID-…, key)`, **not the P2 LN/HN pair**. Those cases can remain readable while lacking `p2_case_identity`; P2 mutation fails `IDENTITY_UNVERIFIED`. Equality of LN alone cannot upgrade, merge or reassign them. A future PET linker must reconcile actual PET identity evidence with this pair contract under approved rules, rather than equating incompatible digests or weakening the check.

## Registration transaction boundary

1. Validate live staff session, input, registration permission and unit existence.
2. Acquire the shared transaction-scoped LN advisory lock (`lockLn`, normalized LN, salt `75432802`). Check prior case visibility before returning identity outcomes.
3. Call the existing shared `registerCase` within that **same transaction**; its repeated advisory-lock acquisition is reentrant. It checks idempotency and both identity digests, opens a matching case or creates the case/LN/initial round and registration audit atomically.
4. Only for a newly created case, insert unit scope and immutable P2 HN. Reopen does not overwrite origin, identity or unit scope. Initialize/reuse the round workspace and return the authorized case.
5. Commit all changes together; errors roll back. An unauthorized existing LN or mismatching identity returns `IDENTITY_UNVERIFIED` with `caseId:null`, without disclosing the conflicting case. Authenticated permission-denial audit is separately committed after rollback by the P2 HTTP wrapper.

ANC and LAB_DIRECT use this single registration service. LAB_DIRECT defaults Request and Consent to Paper. Neither path creates specimen receipt, Halos LN, HIS order or a PET linkage. Registration is not evidence that a specimen was received.

## Requirements for the next integration review

- Verify `linkIntakeAtRegistration` against the actual service signature and transaction ownership above; it is not a P2 export or callback. Decide and review any hook as a subsequent integration change. Preserve atomicity, LN locking, scope checks and request-bound idempotency.
- Preserve LAB_DIRECT blind entry: record authorized staff-entered identity once, then reconcile independent inbound evidence. Do not auto-accept LN-only matches, expose mismatched HN, fabricate receipt or duplicate ANC intake.
- Establish a reviewed PET-to-LN/HN evidence mapping, lookup-key ownership and immutable provenance before linking. Keep P1 PET/RES wire format and encoding unchanged. Resolve legacy synthetic identity differences explicitly.
- P2 registration creates one LN binding; it does not execute later-round LN replacement. If P3 integration introduces multiple LN versions, review current-LN selection consistently across registration, case DTO, search and locked PDF identity before enabling that path. Preserve historical snapshot identifiers.
- P2 migration sequence is **006 then 007**, after immutable P1 001–005. P3's reported `090_p3_his_inbound.sql` is outside this delivery; do not renumber or apply it here. Integration must verify combined ordered checksums on a new disposable database and verify runtime `app_rw`/`worker_rw` grants (logins `nipt_web`/`nipt_worker`), foreign keys and audit behavior.
- Test concurrent registration/PET arrival, duplicate and changed-content replay, zero-prefixed LN/HN, mismatched or unknown identity, unauthorized unit access and rollback. Preserve case-before-signing lock order if integration takes case locks; signing evidence must not be invalidated/finalized outside its guarded transaction.
- Keep collection facts separate from HIS receipt timestamps. P2 exposes latest-per-source current-round facts plus immutable history and read-only receipt provenance; it never copies an ANC draw date into HIS receipt.
- Re-run P1/P2/P3 regression and exact-SHA CI after a separately authorized integration change. P2 technical completion does not establish AL-3 receiver/share compatibility, clinical eligibility, real Consent or Production readiness.

No migration090, P3 worktree, Draft PR, inbound protocol or Production system was modified in this P2 task.
