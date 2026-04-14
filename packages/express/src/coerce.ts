/**
 * Scalar coercion for URL-sourced request data.
 *
 * Query strings, path parameters, and headers arrive as strings, but
 * Triad schemas often declare `t.int32()`, `t.boolean()`, etc. This
 * module walks a model shape and coerces each incoming string value to
 * the target scalar type before validation runs. Unsupported types pass
 * through untouched so validation can produce a useful error.
 *
 * Body coercion is not needed — `express.json()` parses JSON bodies
 * before the route handler runs, so values already have the right JS
 * types.
 *
 * Duplicated verbatim from `@triadjs/fastify` on purpose: both adapters
 * need identical semantics, and v1 prefers duplication over a shared
 * internal package.
 */

import type { ModelShape, SchemaNode } from '@triadjs/core';

/**
 * Coerce every field in `raw` using the target schema's kind. Returns a
 * new object — the input is not mutated. Missing fields are preserved as
 * undefined so downstream validation sees the same picture the client
 * sent.
 */
export function coerceByShape(
  shape: ModelShape,
  raw: unknown,
): Record<string, unknown> {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return {};
  }
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const value = input[key];
    out[key] = coerceScalar(schema as SchemaNode, value);
  }
  return out;
}

/**
 * Coerce a single value to match the declared schema kind. String inputs
 * are the normal case; non-string inputs pass through unchanged.
 */
export function coerceScalar(schema: SchemaNode, value: unknown): unknown {
  if (typeof value !== 'string') return value;

  switch (schema.kind) {
    case 'number': {
      if (value === '') return value;
      const num = Number(value);
      return Number.isNaN(num) ? value : num;
    }
    case 'boolean': {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    }
    default:
      return value;
  }
}
