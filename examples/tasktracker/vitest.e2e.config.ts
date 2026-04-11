/**
 * Vitest configuration for tasktracker e2e tests.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
