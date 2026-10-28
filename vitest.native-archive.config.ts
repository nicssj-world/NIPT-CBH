import {defineConfig} from 'vitest/config';
export default defineConfig({
 test:{
  include:['tests/**/*.test.ts'],testTimeout:300000,hookTimeout:120000,
  fileParallelism:false,
  globalSetup:['tests/helpers/native-archive-global-setup.ts']
 }
});
