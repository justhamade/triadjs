/**
 * `@triadjs/vue-query` — generate fully-typed Vue Query composables from
 * a Triad router.
 */

export { generate } from './generator.js';
export { writeFiles } from './write.js';
export { renderVueHook, type HookRenderContext, type EndpointHook } from './hook-generator.js';
export type { GenerateOptions, GeneratedFile, QueryKeyStrategy } from './types.js';
