import { defineConfig } from "vitest/config";
import { AFTER_BUILD_TESTS } from "./tests/test-groups";
// npm run test:after-build - after `npm run build`: these tests inspect or start the Next standalone output.
export default defineConfig({ test: { include: [...AFTER_BUILD_TESTS], testTimeout: 120000, hookTimeout: 60000, fileParallelism: false } });
