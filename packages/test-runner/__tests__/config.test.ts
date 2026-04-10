import { describe, expect, it, expectTypeOf } from 'vitest';
import { defineConfig, type TriadConfig } from '../src/config.js';

describe('defineConfig', () => {
  it('returns the config object unchanged', () => {
    const config = defineConfig({
      router: './src/app.ts',
      test: { setup: './src/test-setup.ts', teardown: 'cleanup' },
      docs: { output: './generated/openapi.yaml', format: 'yaml' },
      gherkin: { output: './generated/features' },
    });

    expect(config.router).toBe('./src/app.ts');
    expect(config.test?.setup).toBe('./src/test-setup.ts');
    expect(config.test?.teardown).toBe('cleanup');
    expect(config.docs?.format).toBe('yaml');
  });

  it('accepts a minimal config', () => {
    const config = defineConfig({});
    expect(config).toEqual({});
  });

  it('typechecks fields', () => {
    expectTypeOf(defineConfig).parameter(0).toMatchTypeOf<TriadConfig>();
  });
});
