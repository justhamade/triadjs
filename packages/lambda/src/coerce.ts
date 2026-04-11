/**
 * Scalar coercion for URL-sourced request data.
 *
 * Query strings, path parameters, and headers arrive as strings, but
 * Triad schemas often declare `t.int32()`, `t.boolean()`, etc. This
 * module walks a model shape and coerces each incoming string value to
 * the target scalar type before validation runs.
 *
 * Duplicated verbatim from `@triad/express` / `@triad/fastify` /
 * `@triad/hono` on purpose: every adapter needs identical semantics, and
 * v1 prefers small duplication over a shared internal package.
 */

import type { ModelShape, SchemaNode } from '@triad/core';

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
