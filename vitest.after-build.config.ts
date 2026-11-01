import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
// npm run test:after-build - after `npm run build`: these tests inspect or start the Next standalone output.
const groups = JSON.parse(readFileSync("tests/test-groups.json", "utf8"));
export default defineConfig({ test: { include: groups.afterBuild.files, testTimeout: 120000, hookTimeout: 60000, fileParallelism: false } });
