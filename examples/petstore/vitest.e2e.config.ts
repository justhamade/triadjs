/**
 * Vitest configuration for petstore e2e tests.
 *
 * Runs only files under `e2e/`. Uses a single forked worker so the
 * stream of tests does not fight over TCP ports or in-memory SQLite
 * state. `testTimeout` is raised to 15s because each test spins up
 * a real Fastify server.
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
