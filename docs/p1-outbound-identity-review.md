# P1 outbound PDF/RES identity review

Baseline inspected: `a4e88e9a7264ca8f5782d05c8a8d49cff0442381`, clean `main`, matching remote `main`. Scope: synthetic P1 outbound validation only; no new migration, inbound PET change, clinical rule change, P2 work or production deployment.

The baseline publisher checked filenames independently and verified RES BOM/record widths. It did not compare PDF filename LN with RES filename/content LN, the duplicate P LN, O LN or R accession. Synthetic red tests reproduced delivery of mismatched pairs, inconsistent records and invalid filename suffixes. UTF-16 decoding also silently replaced malformed surrogate sequences.

`validateOutboundIdentity` is the common, synchronous pre-write gate. It compares exact strings without numeric conversion or an LN length assumption:

| Source | Required identity |
| --- | --- |
| PDF filename | `{attempt}_{HN}__{LN}.pdf`, matching P[2] |
| RES P | P[2] numeric and P[21] identical |
| RES O | O[2] identical to P[2] |
| RES R | R[11] exactly LN plus legacy accession suffix `118` |
| RES filename | Exactly LN + H[13] hour (two digits) + last minute digit + `.res` |
| Optional job source | Payload `ln`, when supplied, must exactly match P[2] |

These are the executable legacy positions/conventions already documented in `legacy-mapping.md`, preserved by the P1 serializer. Filename generation and accession suffix now share definitions with validation. UTF-16LE BOM, field widths, CR separators, escaping, original PDF bytes and OK sentinel remain unchanged. Malformed UTF-16 is rejected without replacement decoding.

The existing synthetic export job had hashes and filenames only; the foundation PDF snapshot has no LN field. An optional string `ln` now carries explicit source identity when available. Legacy jobs without it still pass through the full filename/wire validator. This does not establish a clinical snapshot binding or validate the PDF body; PDF Identifier Contract evidence remains AL-5. Synthetic publication still requires SYNTHETIC HN and reserved `99000` LN identifiers, with optional leading zeros preserved. The serializer's existing synthetic fixture guard is unchanged.

Errors are coded: `PDF_LN_MISMATCH`, `RES_FILENAME_MISMATCH`, `RES_LN_MISMATCH`, `SOURCE_LN_MISMATCH`, and existing/explicit format or encoding errors. All validation runs before the first filesystem operation in the publisher. The worker calls that same publisher; invalid jobs cannot write a success receipt. Existing cancellation, post-OK reconciliation, immutable collisions and idempotent retry behavior remain covered.

Regression coverage added: 41 test cases across filename/wire contracts, publisher pre-write checks and native worker integration. This includes different LN widths, leading zeros, valid legacy suffixes across hour/minute boundaries, invalid suffixes, P/O/R mismatches, source LN mismatch, malformed records/encoding, repeated rejection without any destination artifacts, valid delivery after rejection and legacy jobs without a source-LN field. The native test creates its own disposable PostgreSQL database and filesystem, exercises five invalid jobs through pg-boss retry with coded failures and no files/receipts, then verifies a valid job's original PDF/RES/OK bytes. It does not activate settings in another session's database.

Local verification: `npm run typecheck`, `npm run lint`, `npm run guard`, `git diff --check`, `npm run build`, and `npm test` with native synthetic PostgreSQL enabled all passed; 854 tests across 19 files, zero skipped. Build emitted three dynamic filesystem tracing warnings in unchanged PDF preview/secret routes. GitHub CI and browser results are recorded in the delivery report against the pushed commit.

This review closes the focused P1 technical gap when the pushed commit's CI passes. It grants no authorization for a real HIS share/receiver, clinical PDF identification, clinical publication or production use; AL-3/AL-5/AL-6 remain their own integration gates.
