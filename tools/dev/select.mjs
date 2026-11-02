// Which checks does a set of changed files need? Pure (no I/O), so tests/deploy/dev-select.node.mjs pins the mapping.
// The fast loop runs ONLY what these rules select; the full suite stays a release-qualification job (npm test, CI).
const norm=p=>String(p).replaceAll('\\','/').replace(/^\.\//,'');
const isCode=p=>/\.(ts|tsx|mjs|js|cjs)$/.test(p);
const LINT_IGNORED=/^(\.next|\.local|data|coverage|playwright-report|test-results|node_modules)\//;

// area → [changed-path pattern, test-file name pattern, label]. A test file is chosen by directory (tests/unit, tests/db, tests/contracts) and name.
export const AREAS=[
 {area:'pdf',label:'PDF renderer',paths:/^(packages\/pdf\/|apps\/renderer\/|packages\/forms\/|packages\/readygen\/(reports|templates|filename)[^/]*$)/,tests:/(^|\/)[^/]*(pdf|render)[^/]*\.test\.ts$/},
 {area:'worker',label:'Worker and job queue',paths:/^(apps\/worker\/|packages\/jobs\/)/,tests:/(worker|job|queue)[^/]*\.test\.ts$/},
 {area:'his',label:'HIS / PET / RES contract (simulator only)',paths:/^(packages\/(integrations|inbound)\/|tools\/his-simulator\/)/,tests:/(^|\/)[^/]*(his|pet|inbound|outbound|p3-)[^/]*\.test\.ts$/},
 {area:'registration',label:'Patient identity and registration',paths:/^(packages\/p2\/|src\/app\/api\/p2\/|src\/components\/p2\/)/,tests:/(^|\/)(p2|anc-owner-registry|registry)[^/]*\.test\.ts$/},
 {area:'database',label:'Database schema and access',paths:/^(db\/|packages\/db\/|tools\/(migrate|migration-checksums|prepare-db)\.ts)/,tests:/(^|\/)(migrations?|archive-schema|operational-migration-checksums|database)[^/]*\.test\.ts$/},
 {area:'historical',label:'Historical migration',paths:/^(packages\/(migration|historical)\/|tools\/migration\/)/,tests:/(^|\/)(migration|historical)[^/]*\.test\.ts$/},
 {area:'results',label:'Results, release and certification',paths:/^packages\/(results|release|p6)\//,tests:/(^|\/)(p5|p6|p7|results?|release)[^/]*\.test\.ts$/},
];

const DEPLOY_PATHS=/^(deploy\/|tools\/win-installer\/|tools\/(dev|release)\/|tests\/deploy\/|tools\/(build-provenance|environment-boundary|runtime-env|source-guard)[^/]*$|package(-lock)?\.json$|next\.config\.|\.github\/)/;
const MIGRATION_PATHS=/^(db\/migrations\/|tools\/(migrate|migration-checksums)\.ts$|deploy\/windows\/risk-classification\.mjs$)/;
const BUILD_INPUT_PATHS=/^(package(-lock)?\.json|next\.config\.[a-z]+|tsconfig\.json|packages\/workbook\/master-manifest\.json|tools\/win-installer\/form-assets\.mjs|deploy\/windows\/app-version\.json)$/;

/** @param {string[]} changed repository-relative paths @param {string[]} testFiles every tests/**\/*.test.ts (for the area suites) */
export function selectChecks(changed,testFiles=[]){
 const files=[...new Set(changed.map(norm).filter(Boolean))].sort();
 const code=files.filter(isCode);
 const tsFiles=files.filter(p=>/\.(ts|tsx)$/.test(p));
 const lint=code.filter(p=>!LINT_IGNORED.test(p));
 const changedTests=files.filter(p=>/^tests\/.*\.test\.ts$/.test(p));
 // vitest `related` follows the import graph from these files to the tests that load them
 const related=code.filter(p=>!LINT_IGNORED.test(p)&&!/^tests\/.*\.test\.ts$/.test(p)&&!/^tests\/deploy\//.test(p)&&!/^(deploy|tools\/(win-installer|dev|release))\//.test(p));
 const areas=AREAS.filter(a=>files.some(f=>a.paths.test(f))).map(a=>({area:a.area,label:a.label,tests:testFiles.map(norm).filter(t=>a.tests.test(t)&&!/^tests\/deploy\//.test(t))}));
 return {
  files,
  typecheck:tsFiles.length>0||files.some(f=>/^(tsconfig\.json|package(-lock)?\.json|next\.config\.)/.test(f)),
  typegen:files.some(f=>/^src\/app\//.test(f)||/^next\.config\./.test(f)),
  lint,
  changedTests,
  related,
  areas,
  deployContracts:files.some(f=>DEPLOY_PATHS.test(f)),
  migration:files.some(f=>MIGRATION_PATHS.test(f)),
  buildInputs:files.some(f=>BUILD_INPUT_PATHS.test(f)),
  nothingToCheck:files.length===0
 };
}

/** Unique test files to run directly: changed tests plus the suites of each touched area. */
export function directTests(plan){
 return [...new Set([...plan.changedTests,...plan.areas.flatMap(a=>a.tests)])].sort();
}
