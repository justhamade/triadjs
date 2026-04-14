/**
 * `@triadjs/tanstack-query` — generate fully-typed TanStack Query hooks
 * from a Triad router.
 */

export { generate } from './generator.js';
export { writeFiles } from './write.js';
export { TypeEmitter } from './schema-to-ts.js';
export {
  extractResource,
  groupByResource,
  emitKeyFactory,
  flatKeyFor,
  toPascal,
  singularize,
  lowerFirst,
  type ResourceInfo,
} from './query-keys.js';
export {
  collectEndpointShape,
  hookNameFor,
  renderHook,
  renderPathExpression,
} from './hook-generator.js';
export { renderClient } from './client.js';
export type { GenerateOptions, GeneratedFile, QueryKeyStrategy } from './types.js';
