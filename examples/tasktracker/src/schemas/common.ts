/**
 * Shared schemas used by multiple bounded contexts.
 *
 * `ApiError` mirrors the petstore's error envelope verbatim so clients
 * of either example can parse errors uniformly.
 *
 * `AuthHeaders` is the inline header shape every auth-required
 * endpoint plugs into `request.headers`. We declare `authorization` as
 * `optional` on the schema and enforce it inside `requireAuth()` so
 * the endpoint can produce a proper `401 ApiError` response instead of
 * a framework-level 400 validation failure when the client forgets the
 * header. Swap `.optional()` off and the test runner will reject the
 * "missing auth" scenarios before they ever reach the handler.
 *
 * 204 responses use the first-class `t.empty()` primitive — see the
 * DELETE endpoints in the projects/tasks modules.
 */

import { t } from '@triad/core';

export const ApiError = t.model('ApiError', {
  code: t.string().doc('Machine-readable error code').example('UNAUTHENTICATED'),
  message: t.string().doc('Human-readable error message'),
  details: t
    .record(t.string(), t.unknown())
    .optional()
    .doc('Additional context about the error'),
});

/** Inline header shape for endpoints that read the Authorization header. */
export const AuthHeaders = {
  authorization: t
    .string()
    .optional()
    .doc('Bearer token, e.g. "Bearer 0c1f...". Optional at the schema level so missing-auth scenarios can be tested as 401 instead of 400.'),
};
