/**
 * Adapter-specific error types.
 *
 * `RequestValidationError` is thrown when an incoming request's params,
 * query, body, or headers fail schema validation. The adapter catches it
 * and maps it to a 400 response. `InternalResponseError` is thrown when
 * the handler returns a response that doesn't match its declared schema —
 * a server bug that should produce a 500, not leak invalid data to the
 * client.
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
