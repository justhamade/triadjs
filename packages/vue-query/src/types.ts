/**
 * Public configuration types for the Vue Query generator.
 */

import type { Endpoint } from '@triad/core';

export interface GenerateOptions {
  outputDir: string;
  baseUrl?: string;
  emitRuntime?: boolean;
  queryKeyStrategy?: QueryKeyStrategy;
}

export type QueryKeyStrategy =
  | 'default'
  | ((endpoint: Endpoint) => readonly unknown[]);

export interface GeneratedFile {
  path: string;
  contents: string;
}
