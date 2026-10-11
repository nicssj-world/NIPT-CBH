import {defineConfig,devices} from "@playwright/test";
import {existsSync} from "node:fs";
if(existsSync(".env.local"))process.loadEnvFile(".env.local");
export default defineConfig({testDir:"tests/e2e",fullyParallel:false,workers:1,timeout:30000,retries:0,reporter:[["list"],["html",{open:"never"}]],expect:{toHaveScreenshot:{maxDiffPixelRatio:0.001}},use:{baseURL:process.env.E2E_BASE_URL??"http://127.0.0.1:3000",ignoreHTTPSErrors:process.env.E2E_IGNORE_LOCAL_TLS==="1",trace:"retain-on-failure",...devices["Desktop Chrome"]},webServer:process.env.E2E_BASE_URL?undefined:{command:"npm run start",url:"http://127.0.0.1:3000/login",reuseExistingServer:!process.env.CI,timeout:60000}});
