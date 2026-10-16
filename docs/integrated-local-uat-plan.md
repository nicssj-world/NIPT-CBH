# Integrated Admin + Operational Local UAT

Owner-authorized local integration only. Sources: operational `f84313a0965d191e952e3a4ee98750bc6ec2cad1`, admin `0fd4a896964d4791eed213429e84f56feef017c0`, common baseline `ea48e624c21cb7fef89e89bc4c02241300a3dd02`.

1. Verify ancestry, clean sources, changes and migration inventory. Merge both histories in the new integration worktree only.
2. Isolate launcher/compose to project `nipt-integrated-owner-uat-20261017`, HTTPS 19448, database ingress 19449, database `nipt_operational_integrated_owner_uat`. All bind paths resolve within this worktree; new project-scoped database/Caddy volumes. Provision fresh local credentials and fake fixtures; never copy existing UAT data.
3. Preserve Admin and operational implementation. Package migration SQL with Web because Admin Health verifies the actual ledger against source files. No clinical/security/owner gate changes.
4. Verify static/build, fresh and populated-095 upgrade, bootstrap, security and contracts. Start the exact committed candidate. Run combined Admin browser checks, existing complete positive operational journey with native Excel/PDF, controls, local RES/OK, and restart persistence.
5. Run full regression on final exact HEAD; retain logs and matching source/migration hashes. Deliver combined Owner checklist, local credentials location, isolation and remaining external limitations.

No push, Main merge, Production deployment, installer, hospital HIS/HALOS, original Preview lifecycle/data/volume changes, or Approved Master modifications. Owner Manual UAT remains pending after automated verification. Skipped tests are reported separately.

Progress is recorded under ignored `.local/integration/`; final exact-HEAD evidence supplements the committed delivery report without making a documentation-only commit invalidate the evidence.
