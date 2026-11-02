// Risk classification of a deployment (Owner decision 2026-11-02): derived ONLY from the files that differ between the installed release and the
// candidate commit. There is no switch to choose a level: the deployer cannot lower it by renaming a file or picking a mode. The highest level
// of any changed file wins; a file no rule recognises is HIGH, with the reason shown. Node built-ins only and pure, so it is unit-tested
// (tests/deploy/risk-classification.node.mjs); deploy-production.ps1 only reads the result.
export const LEVELS=['LOW','MEDIUM','HIGH'];
const rank=l=>LEVELS.indexOf(l);

// First matching rule wins, so the specific HIGH areas are listed before the broad presentation / application areas.
// patient identity, results, certification and release, HIS, authentication, database, clinical calculation, migration, the deployment engine itself
const RULES=[
 ['HIGH','database schema and roles',/^(db\/|packages\/db\/)/],
 ['HIGH','dependencies (package.json / lockfile)',/^(package\.json|package-lock\.json|npm-shrinkwrap\.json)$/],
 ['HIGH','authentication, authorization and security',/^(packages\/(security|auth|admin|settings)\/|src\/proxy\.ts|src\/server\/(http|auth|session)[^/]*$|src\/app\/api\/(auth|admin|secrets|me)\/)/],
 ['HIGH','HIS integration and inbound',/^(packages\/(integrations|inbound|his)\/|src\/app\/api\/(p6|p5h|task3|synthetic)\/)/],
 ['HIGH','patient identity and case registration',/^(packages\/(p2|p3|domain\/identity)[^/]*\/|packages\/p2\/|src\/app\/api\/p2\/|packages\/db\/registration)/],
 ['HIGH','results, certification and release workflow',/^(packages\/(results|p6|release)\/|src\/app\/api\/p5\/(results|releases|cases|intake|jobs|historical)\/)/],
 ['HIGH','clinical laboratory logic and interpretation',/^(packages\/(lab|pooling|p4|p4b|p4c|workbook|readygen\/(interpretation|signers|halos|enrich)[^/]*)\/|packages\/readygen\/(interpretation|signers|halos)[^/]*$|src\/app\/api\/(p3|p4|p4b|p4c|lab-bench|halos|workbook|sample-storage)\/)/],
 ['HIGH','historical migration',/^(packages\/migration\/|tools\/migration\/|src\/app\/api\/migration\/|src\/server\/migration)/],
 ['HIGH','deployment engine and operations',/^(deploy\/|tools\/win-installer\/|tools\/(configure|bootstrap)[^/]*|scripts\/)/],
 ['HIGH','continuous integration / build configuration',/^(\.github\/|next\.config|tsconfig|vitest\.config|eslint\.config)/],
 // application logic that is not clinical
 ['MEDIUM','PDF renderer, reports and printing',/^(packages\/(pdf|report|print)[^/]*\/|packages\/readygen\/(reports|filename|templates)[^/]*$|src\/app\/api\/pdf\/)/],
 ['MEDIUM','ANC dashboard and views',/^(packages\/anc\/|src\/app\/api\/anc\/)/],
 ['MEDIUM','non-clinical domain helpers',/^packages\/(domain|storage|ui|i18n)\//],
 // presentation only
 ['LOW','style sheets',/\.css$/],
 ['LOW','documentation',/^(docs\/|[^/]+\.md$)/],
 ['LOW','tests only',/^tests\//],
 ['LOW','static assets',/^public\//],
 ['LOW','screens and components (presentation)',/^(src\/components\/|src\/app\/\([^)]*\)\/[^/]*\/?(page|layout|loading|error|not-found)\.tsx$|src\/app\/(page|layout|loading|error|not-found)\.tsx$)/],
];

/** @param {{files:{status?:string,path:string}[]}} input  `git diff --name-status <installed>..<candidate>` as data */
export function classifyChange(input){
 const files=(input?.files??[]).map(f=>({status:f.status??'M',path:String(f.path).replaceAll('\\','/').replace(/^\.?\//,'')})).filter(f=>f.path);
 if(!files.length)return {ok:true,level:'HIGH',reasons:[{path:'(no changed files found)',level:'HIGH',rule:'the difference to the installed release could not be established'}],files:0,requires:requires('HIGH')};
 const reasons=files.map(f=>{
  // a deleted or renamed file is judged by the path it touches in the same way; a migration file anywhere is always HIGH
  if(/(^|\/)migrations?\/[^/]*\.sql$/.test(f.path))return {path:f.path,level:'HIGH',rule:'database migration'};
  const r=RULES.find(([,,re])=>re.test(f.path));
  return r?{path:f.path,level:r[0],rule:r[1]}:{path:f.path,level:'HIGH',rule:'not recognised by any rule: treated as HIGH'};
 });
 const level=reasons.reduce((m,r)=>rank(r.level)>rank(m)?r.level:m,'LOW');
 return {ok:true,level,files:files.length,reasons:reasons.sort((a,b)=>rank(b.level)-rank(a.level)||a.path.localeCompare(b.path)),requires:requires(level)};
}
/** What a level demands before Production (Owner policy 2026-11-02): no level needs a Staging round; each is validated on the exact commit, HIGH most widely. */
export function requires(level){
 const base=['typecheck','lint','deploy contracts','related tests (vitest related, from the changed files)'];
 return {
  stagingVerification:false,
  focusedValidation:level==='HIGH'?[...base,'PDF / report / dashboard render tests (tests/unit/*pdf*, tests/db/anc-*)','migration and integrity tests (tests/db/migration*, historical, specimen acceptance)']:level==='MEDIUM'?[...base,'PDF / report / dashboard render tests (tests/unit/*pdf*, tests/db/anc-*)']:base,
  verifiedPreUpgradeBackup:true,confirmation:'one typed confirmation'
 };
}
/** Facts the migrations in the package force: any pending migration makes the deployment HIGH whatever the paths say. */
export function withPendingMigrations(result,pendingMigrations){
 if(!pendingMigrations?.length||result.level==='HIGH')return result;
 return {...result,level:'HIGH',reasons:[{path:`${pendingMigrations.length} pending database migration(s)`,level:'HIGH',rule:'database migration'},...result.reasons],requires:requires('HIGH')};
}
