import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/worker.ts', 'src/sync.ts'],
    },
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
