/**
 * Adapter-specific error types.
 *
 * `RequestValidationError` is thrown when an incoming request's params,
 * query, body, or headers fail schema validation. The handler catches it
 * and maps it to a 400 response matching the `@triad/express`,
 * `@triad/fastify`, and `@triad/hono` adapters byte-for-byte.
 */

import type { ValidationError } from '@triad/core';

export type RequestPart = 'params' | 'query' | 'body' | 'headers';

export class RequestValidationError extends Error {
  constructor(
    public readonly part: RequestPart,
    public readonly errors: ValidationError[],
  ) {
    super(
      `Request ${part} failed validation: ${errors.map((e) => `${e.path || '<root>'}: ${e.message}`).join(', ')}`,
    );
    this.name = 'RequestValidationError';
  }
}
