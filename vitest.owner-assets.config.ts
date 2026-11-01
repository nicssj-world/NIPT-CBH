import { defineConfig } from "vitest/config";
import { OWNER_ASSET_TESTS } from "./tests/test-groups";
// npm run test:owner-assets - only on a host holding the owner's private clinical files; a missing file fails the run (ENOENT), never skips.
export default defineConfig({ test: { include: [...OWNER_ASSET_TESTS], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false } });
