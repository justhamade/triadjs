/**
 * `@triadjs/forms` — generate typed form validators from a Triad router.
 *
 * For every endpoint with a request body, emits a
 * `validateXxx(input)` function returning
 * `{ ok: true, value } | { ok: false, errors }`. Optionally emits
 * wrapper adapters for `react-hook-form` and `@tanstack/form`.
 */

export { generate } from './generator.js';
export { writeFiles } from './write.js';
export { describeSchema, type FormFieldDesc, type FormFieldKind } from './descriptor.js';
export { RUNTIME_SOURCE } from './runtime.js';
export type { GenerateOptions, GeneratedFile } from './types.js';
