import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
Object.assign(process.env, loadEnv('test', process.cwd(), ''));
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, fileParallelism: false },
});
