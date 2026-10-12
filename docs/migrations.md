# Migration checksums

SHA-256 of canonical committed LF source. Applied only to disposable synthetic/test databases; never Production. The migrator verifies immutable applied history before forward application.

| Migration | SHA-256 |
| --- | --- |
| 001_foundation.sql | `5d013f4ecd13424373059fb33827ba4cda265b929014a991efee2d0683f18492` |
| 002_security_settings.sql | `4965ec3b918df8769b78cd41696b7c5439b00e8ba77dcb15afa4cbbfc3e5fe6c` |
| 003_web_foundation.sql | `8f47ab63924d1138d457171ce7025632e8041a9d99c4f26f6b9828b456b13b99` |
| 004_integration.sql | `96e1e3c32e6e029bb38ff9dc92194103cdd5735fe0155b4a4aad85fb6fa2aa07` |
| 005_phi_access.sql | `61df4b863c9016b2808276240a6e4c36af71c65ced38b35641199ba82c9c9274` |
| 006_p2_synthetic.sql | `fc48d19774f0f9517db7f271d1d93bcd96493c82a1510a238e8550c4245c5107` |
| 007_p2_consent_document_uniqueness.sql | `51cda447ae029673c920a96234fcbdae430b3b115e84dcdbceb14d00dd5fa1d1` |

Migration006 adds restricted synthetic P2 identity/draft/revision/paper/signing/doctor/PDF-access/withdrawal evidence and guards. Applied only to disposable local synthetic databases using the ordinary checksum-enforcing migrator; no Production apply. Migration001–005 source bytes remain unchanged. Subsequent fixes use a new forward migration.

Migration007 enforces one active signing attempt, signature and final Consent per immutable document revision, and validates exact source evidence plus the declared canonical hash algorithm. It refuses existing ambiguous evidence rather than deleting or selecting a winner. Existing migration006 payloads/hashes remain unchanged; new final rows use `PG_JSONB_CANONICAL_V1`. Only isolated synthetic/test databases are migration targets.
