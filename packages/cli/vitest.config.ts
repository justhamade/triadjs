import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    globals: false,
    // Commands that spawn the jiti loader can take a bit longer on cold start.
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@triad/core': fileURLToPath(new URL('core/src/index.ts', root)),
      '@triad/openapi': fileURLToPath(new URL('openapi/src/index.ts', root)),
      '@triad/asyncapi': fileURLToPath(new URL('asyncapi/src/index.ts', root)),
      '@triad/gherkin': fileURLToPath(new URL('gherkin/src/index.ts', root)),
      '@triad/test-runner': fileURLToPath(new URL('test-runner/src/index.ts', root)),
    },
  },
});
