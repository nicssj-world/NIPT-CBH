/** Test files that cannot run in the default `npm test`, and the command that runs each group. Nothing here is skipped silently:
 *  each group has its own command, which fails (not skips) when its prerequisite is missing. tests/unit/test-groups.test.ts keeps
 *  these lists exact (every entry exists, no overlap).
 *
 *  OWNER_ASSET_TESTS - read the owner's private clinical files (.local/lab-owner-evidence, .local/task3-sources and the owner's
 *  originals), which never enter Git. Run on a host that holds NIPT-CBH-HOME-BACKUP:  npm run test:owner-assets
 *
 *  AFTER_BUILD_TESTS - need the Next standalone output (.next/standalone):  npm run build && npm run test:after-build */
export const OWNER_ASSET_TESTS=[
 'tests/contracts/archive-clinical-native.test.ts',
 'tests/contracts/lab-owner-nifty.test.ts',
 'tests/contracts/lab-owner-pooling.test.ts',
 'tests/contracts/lab-owner-task-import.test.ts',
 'tests/contracts/owner-lab-054-signers-native.test.ts',
 'tests/contracts/readygen-enrich-parity.test.ts',
 'tests/contracts/task3-golden.test.ts',
 'tests/contracts/task3-identity-sources.test.ts',
 'tests/contracts/task3-native-concurrency.test.ts',
 'tests/contracts/task3-native-no-call.test.ts',
 'tests/contracts/task3-native-pathway.test.ts',
 'tests/contracts/task3-native-pg.test.ts',
 'tests/contracts/task3-negatives.test.ts',
 'tests/contracts/task3-real-sources.test.ts',
 'tests/contracts/task3-reconciliation.test.ts',
 'tests/contracts/task3-template-registry-native.test.ts',
 'tests/contracts/workbook-pooling-alerts.test.ts',
 'tests/db/lab-owner-bench.test.ts',
 'tests/db/lab-owner-qc-release.test.ts',
 'tests/db/lab-repeat-export.test.ts',
 'tests/db/owner-lab-report-templates.test.ts',
 'tests/db/task1-failure-no-call.test.ts',
 'tests/db/task3-fallback-package.test.ts',
 'tests/db/task3-halos-import.test.ts',
 'tests/unit/task1-exceptional-highlight.test.ts'
] as const;

export const AFTER_BUILD_TESTS=[
 'tests/unit/standalone-safe-artifacts.test.ts',
 'tests/contracts/archive-admin-browser-native.test.ts'
] as const;
