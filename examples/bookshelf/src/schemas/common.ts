/**
 * Shared schemas used by every bounded context.
 *
 * `ApiError` mirrors the error envelope used in the petstore and
 * tasktracker examples so clients of any Triad reference app can parse
 * errors uniformly.
 *
 * 204 "no content" responses use `t.empty()` — a first-class primitive
 * for bodyless responses. The `ctx.respond[204]` slot narrows to a
 * zero-argument function, the OpenAPI generator emits no `content`, and
 * all adapters skip the `Content-Type` header.
 */

import { t } from '@triadjs/core';

export const ApiError = t.model('ApiError', {
  code: t.string().doc('Machine-readable error code').example('NOT_FOUND'),
  message: t.string().doc('Human-readable error message'),
  details: t
    .record(t.string(), t.unknown())
    .optional()
    .doc('Additional context about the error'),
});
