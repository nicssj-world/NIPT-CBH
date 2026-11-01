import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
// npm run test:windows-native - on the Windows server: native PostgreSQL client binaries (.exe); missing binaries fail the run.
const groups = JSON.parse(readFileSync("tests/test-groups.json", "utf8"));
export default defineConfig({ test: { include: groups.windowsNative.files, testTimeout: 300000, hookTimeout: 120000, fileParallelism: false } });
