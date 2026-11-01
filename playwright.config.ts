import {defineConfig,devices} from "@playwright/test";
import {existsSync,readFileSync} from "node:fs";
if(existsSync(".env.local"))process.loadEnvFile(".env.local");
// Harness-only specs (tests/test-groups.json e2eHarness) throw while loading without their fixture, which would abort every spec.
// Leave out exactly those whose prerequisite is absent, and say so; their harness supplies it and runs them unchanged.
type HarnessSpec={file:string;requiresEnv?:string;requiresFile?:string};
const harness=(JSON.parse(readFileSync("tests/test-groups.json","utf8")) as {e2eHarness:{specs:HarnessSpec[]}}).e2eHarness.specs;
const absent=harness.filter(s=>s.requiresEnv?!process.env[s.requiresEnv]:s.requiresFile?!existsSync(s.requiresFile):false);
if(absent.length)console.log(`[e2e] harness-only specs not run (prerequisite absent): ${absent.map(s=>`${s.file} (${s.requiresEnv??s.requiresFile})`).join(", ")}`);
export default defineConfig({testDir:"tests/e2e",testIgnore:absent.map(s=>"**/"+s.file.split("/").pop()),fullyParallel:false,workers:1,timeout:30000,retries:0,outputDir:process.env.NIPT_E2E_OUTPUT_DIR??"test-results",reporter:[["list"],["html",{open:"never",outputFolder:process.env.NIPT_E2E_HTML_REPORT_DIR??"playwright-report"}]],expect:{toHaveScreenshot:{maxDiffPixelRatio:0.001}},use:{baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3000",ignoreHTTPSErrors:process.env.E2E_IGNORE_LOCAL_TLS==="1",trace:"retain-on-failure",...devices["Desktop Chrome"]},webServer:process.env.E2E_BASE_URL?undefined:{command:"npm run start",url:"http://127.0.0.1:3000/login",reuseExistingServer:!process.env.CI,timeout:60000}});
