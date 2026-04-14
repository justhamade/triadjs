/**
 * Adapter-specific error types.
 *
 * `RequestValidationError` is thrown when an incoming request's params,
 * query, body, or headers fail schema validation. The middleware catches
 * it and maps it to a 400 response matching the fastify adapter's error
 * envelope byte-for-byte.
 */

import type { ValidationError } from '@triadjs/core';

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
