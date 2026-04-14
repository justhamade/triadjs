import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: [
    '@triadjs/core',
    '@triadjs/openapi',
    '@triadjs/asyncapi',
    '@triadjs/gherkin',
    '@triadjs/test-runner',
    'commander',
    'jiti',
    'picocolors',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
