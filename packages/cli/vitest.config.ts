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
      '@triad/tanstack-query': fileURLToPath(new URL('tanstack-query/src/index.ts', root)),
      '@triad/channel-client': fileURLToPath(new URL('channel-client/src/index.ts', root)),
      '@triad/solid-query': fileURLToPath(new URL('solid-query/src/index.ts', root)),
      '@triad/vue-query': fileURLToPath(new URL('vue-query/src/index.ts', root)),
      '@triad/svelte-query': fileURLToPath(new URL('svelte-query/src/index.ts', root)),
      '@triad/forms': fileURLToPath(new URL('forms/src/index.ts', root)),
      '@triad/test-runner': fileURLToPath(new URL('test-runner/src/index.ts', root)),
    },
  },
});
