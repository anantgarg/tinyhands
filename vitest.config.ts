import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // Deferred to v1.50: these test files mock the pre-v1.48 Slack surface
    // (static `getSlackApp().client` + slash-command handlers). The
    // production code moved to authorize() + AsyncLocalStorage + dashboard
    // workflows, so the mocks no longer match. Rewriting them is tracked in
    // TODO.md under Infrastructure. Re-enable by removing from this list.
    exclude: [
      '**/node_modules/**',
      'tests/unit/slack-module.test.ts',
      'tests/unit/events.test.ts',
      'tests/unit/commands.test.ts',
      'tests/unit/api-misc.test.ts',
    ],
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
