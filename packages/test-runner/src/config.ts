/**
 * `triad.config.ts` shape and type-safe helper.
 *
 * The config file is the entry point for the Phase 6 `triad` CLI. It is a
 * plain TypeScript module that default-exports a `TriadConfig` object —
 * usually constructed via `defineConfig()` for autocomplete:
 *
 * ```ts
 * // triad.config.ts
 * import { defineConfig } from '@triad/test-runner';
 *
 * export default defineConfig({
 *   router: './src/app.ts',
 *   test: {
 *     setup: './src/test-setup.ts',
 *     teardown: 'cleanup',
 *   },
 *   docs: {
 *     output: './generated/openapi.yaml',
 *     format: 'yaml',
 *   },
 *   gherkin: {
 *     output: './generated/features',
 *   },
 * });
 * ```
 *
 * The config lives in `@triad/test-runner` rather than its own package
 * because it's the first consumer; Phase 6 `@triad/cli` will re-export
 * `defineConfig` from here so users can import it from either place.
 */

export interface TriadConfig {
  /**
   * Path to the module that default-exports a `Router`. Resolved relative
   * to the config file's directory. Required by the CLI for `docs`,
   * `gherkin`, `test`, and `validate` commands.
   */
  router?: string;

  /** Test runner configuration. */
  test?: TestConfig;

  /** OpenAPI generator configuration. */
  docs?: DocsConfig;

  /** Gherkin generator configuration. */
  gherkin?: GherkinConfig;

  /** Database codegen and migration configuration. */
  db?: DbConfig;
}

export interface DbConfig {
  /** Default database dialect for codegen and migrations. */
  dialect?: 'sqlite' | 'postgres' | 'mysql';
  /** Output file path for `triad db generate`. */
  output?: string;
  /** Directory for `triad db migrate` (snapshot + migration files). */
  migrations?: string;
}

export interface TestConfig {
  /**
   * Path to a module that default-exports a `servicesFactory` function.
   * The factory is called before every scenario for isolation.
   */
  setup?: string;

  /**
   * Name of a method on the services container to call after each
   * scenario (e.g. `'cleanup'`). The CLI looks up this method on the
   * services object returned by the setup factory.
   */
  teardown?: string;

  /** Stop on first failure. */
  bail?: boolean;

  /** Glob patterns of endpoints to include (by endpoint name). */
  include?: string[];

  /** Glob patterns of endpoints to exclude. */
  exclude?: string[];
}

export interface DocsConfig {
  /** Output file path. */
  output?: string;

  /** Output format (inferred from the file extension if omitted). */
  format?: 'yaml' | 'json';
}

export interface GherkinConfig {
  /** Output directory for `.feature` files. */
  output?: string;
}

/**
 * Identity function that exists purely for IDE autocomplete and future-
 * compat. Calling `defineConfig({...})` gives you type checking on the
 * config shape without requiring an explicit annotation.
 */
export function defineConfig(config: TriadConfig): TriadConfig {
  return config;
}
