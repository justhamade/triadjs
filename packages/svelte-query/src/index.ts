/**
 * `@triadjs/svelte-query` — generate fully-typed Svelte Query store
 * factories from a Triad router.
 */

export { generate } from './generator.js';
export { writeFiles } from './write.js';
export {
  renderSvelteHook,
  svelteFactoryName,
  type HookRenderContext,
  type EndpointHook,
} from './hook-generator.js';
export type { GenerateOptions, GeneratedFile, QueryKeyStrategy } from './types.js';
