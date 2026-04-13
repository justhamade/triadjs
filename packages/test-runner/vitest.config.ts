import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const coreSrc = fileURLToPath(new URL('../core/src/index.ts', import.meta.url));
const coreAutoSrc = fileURLToPath(new URL('../core/src/scenario-auto.ts', import.meta.url));

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@triad/core/scenario-auto': coreAutoSrc,
      '@triad/core': coreSrc,
    },
  },
});
