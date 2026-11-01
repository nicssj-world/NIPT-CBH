import { defineConfig, configDefaults } from "vitest/config";
import { readFileSync } from "node:fs";
// Owner-asset, Windows-native and after-build tests have their own commands (tests/test-groups.json); everything else runs here.
const groups = JSON.parse(readFileSync("tests/test-groups.json", "utf8"));
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], exclude: [...configDefaults.exclude, ...groups.ownerAssets.files, ...groups.windowsNative.files, ...groups.afterBuild.files], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false } });
