import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'../../tests/e2e',testMatch:'p6-sandbox.spec.ts',workers:1,timeout:60000,reporter:'line',outputDir:'../../test-results/p6-cli'});
