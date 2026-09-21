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
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
