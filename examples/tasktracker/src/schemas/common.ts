/**
 * Shared schemas used by multiple bounded contexts.
 *
 * `ApiError` mirrors the petstore's error envelope verbatim so clients
 * of either example can parse errors uniformly. `NoContent` is a
 * placeholder body for DELETE endpoints: it exists so `ctx.respond[204]`
 * still has *something* to validate (handlers pass `undefined` and the
 * test runner's response validation lets it through because the node
 * is optional). This is one of the documented gaps in this example —
 * Triad does not yet ship a dedicated "empty body" response helper, so
 * every 204 has to reach for this pattern.
 *
 * `AuthHeaders` is the inline header shape every auth-required
 * endpoint plugs into `request.headers`. We declare `authorization` as
 * `optional` on the schema and enforce it inside `requireAuth()` so
 * the endpoint can produce a proper `401 ApiError` response instead of
 * a framework-level 400 validation failure when the client forgets the
 * header. Swap `.optional()` off and the test runner will reject the
 * "missing auth" scenarios before they ever reach the handler.
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

/**
 * 204 "no body" response schema. See module-level comment for the
 * reasoning — this is a workaround, not an idiomatic API surface.
 */
export const NoContent = t.unknown().optional().doc('Empty response body');

/** Inline header shape for endpoints that read the Authorization header. */
export const AuthHeaders = {
  authorization: t
    .string()
    .optional()
    .doc('Bearer token, e.g. "Bearer 0c1f...". Optional at the schema level so missing-auth scenarios can be tested as 401 instead of 400.'),
};
