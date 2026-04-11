/**
 * Shared schemas used across every bounded context.
 *
 * `ApiError` is the canonical error envelope. Every non-2xx response
 * in this example (401, 403, 404) carries this shape so clients have
 * one thing to parse instead of four. It is intentionally identical
 * in shape to the `ApiError` shipped by `examples/tasktracker` and
 * `examples/petstore` — if you already know how those two render
 * errors, you already know how this one does.
 */

import { t } from '@triad/core';

export const ApiError = t.model('ApiError', {
  code: t
    .string()
    .doc('Machine-readable error code')
    .example('UNAUTHENTICATED'),
  message: t.string().doc('Human-readable error message'),
  details: t
    .record(t.string(), t.unknown())
    .optional()
    .doc('Additional context about the error'),
});
