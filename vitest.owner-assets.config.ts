import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
// npm run test:owner-assets - only on a host holding the owner's private clinical files; a missing file fails the run (ENOENT), never skips.
const groups = JSON.parse(readFileSync("tests/test-groups.json", "utf8"));
export default defineConfig({ test: { include: groups.ownerAssets.files, testTimeout: 30000, hookTimeout: 60000, fileParallelism: false } });
