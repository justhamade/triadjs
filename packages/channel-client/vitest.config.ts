import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const coreSrc = fileURLToPath(new URL('../core/src/index.ts', import.meta.url));
const tanstackSrc = fileURLToPath(
  new URL('../tanstack-query/src/index.ts', import.meta.url),
);

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    globals: false,
    testTimeout: 60000,
  },
  resolve: {
    alias: {
      '@triad/core': coreSrc,
      '@triad/tanstack-query': tanstackSrc,
    },
  },
});
