import { defineConfig, configDefaults } from "vitest/config";
import { OWNER_ASSET_TESTS, AFTER_BUILD_TESTS } from "./tests/test-groups";
// Owner-asset and after-build tests have their own commands (tests/test-groups.ts); everything else runs here.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], exclude: [...configDefaults.exclude, ...OWNER_ASSET_TESTS, ...AFTER_BUILD_TESTS], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false } });
