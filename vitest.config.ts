import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@shared': path.resolve(import.meta.dirname, 'shared'),
    },
  },
  test: {
    environment: 'node',
    // The integration suites boot an in-process Postgres and run every
    // migration in beforeAll. That takes a few seconds normally and can pass
    // ten on a busy machine, which was failing whole suites for no reason.
    hookTimeout: 60_000,
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
