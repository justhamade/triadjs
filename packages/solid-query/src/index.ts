/**
 * `@triadjs/solid-query` — generate fully-typed Solid Query hooks from a
 * Triad router.
 */

export { generate } from './generator.js';
export { writeFiles } from './write.js';
export { renderSolidHook, type HookRenderContext, type EndpointHook } from './hook-generator.js';
export type { GenerateOptions, GeneratedFile, QueryKeyStrategy } from './types.js';
