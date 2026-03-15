import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/worker.ts', 'src/sync.ts', 'src/scheduler.ts', 'src/types/**', 'src/db/migrate.ts', 'src/modules/tools/integrations/manifest.ts'],
      reporter: ['text', 'text-summary', 'json', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
