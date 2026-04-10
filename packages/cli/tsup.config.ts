import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: [
    '@triad/core',
    '@triad/openapi',
    '@triad/asyncapi',
    '@triad/gherkin',
    '@triad/test-runner',
    'commander',
    'jiti',
    'picocolors',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
