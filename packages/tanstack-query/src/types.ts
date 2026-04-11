/**
 * Public configuration types for the TanStack Query generator.
 */

import type { Endpoint } from '@triad/core';

export interface GenerateOptions {
  /** Output directory for generated files. */
  outputDir: string;
  /** Base URL for the generated fetch client (default: '/api'). */
  baseUrl?: string;
  /** Whether to emit the runtime client (default: true). */
  emitRuntime?: boolean;
  /**
   * Query key derivation strategy. Use `'default'` for the built-in
   * heuristic (resource, operation, params) or provide a function to
   * customise per-endpoint.
   */
  queryKeyStrategy?: QueryKeyStrategy;
}

export type QueryKeyStrategy = 'default' | ((endpoint: Endpoint) => readonly unknown[]);

export interface GeneratedFile {
  /** Relative path inside the `outputDir`. */
  path: string;
  contents: string;
}
