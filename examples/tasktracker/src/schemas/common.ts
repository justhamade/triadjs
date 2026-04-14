/**
 * Shared schemas used by multiple bounded contexts.
 *
 * `ApiError` mirrors the petstore's error envelope verbatim so clients
 * of either example can parse errors uniformly.
 *
 * Before Phase 10.3, this file also exported an `AuthHeaders` inline
 * header shape because every protected endpoint had to declare the
 * `Authorization` header as optional in its `request.headers` — that
 * was the "schema lie" we used so missing-auth scenarios could reach
 * the handler instead of getting 400-rejected by the validator.
 *
 * Phase 10.3 added `beforeHandler` to `endpoint()`. Authentication
 * now reads the raw `Authorization` header in a beforeHandler that
 * runs BEFORE request-schema validation — so the header no longer
 * needs to appear on the endpoint's declared request shape at all.
 * `AuthHeaders` has been removed.
 *
 * 204 responses use the first-class `t.empty()` primitive — see the
 * DELETE endpoints in the projects/tasks modules.
 */

import { t } from '@triadjs/core';

export const ApiError = t.model('ApiError', {
  code: t.string().doc('Machine-readable error code').example('UNAUTHENTICATED'),
  message: t.string().doc('Human-readable error message'),
  details: t
    .record(t.string(), t.unknown())
    .optional()
    .doc('Additional context about the error'),
});
