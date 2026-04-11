/**
 * Authentication helpers — `requireAuth` beforeHandler plus a small
 * helper for parsing `Authorization: Bearer <token>` headers. Channels
 * re-use `parseBearer` from their `onConnect` hook (channels do not
 * participate in the endpoint beforeHandler pipeline in v1).
 *
 * The `beforeHandler` hook runs BEFORE request schema validation,
 * receives the raw request (headers/query/params/cookies), and either
 * short-circuits with a typed response or attaches typed `state` that
 * flows into `ctx.state` on the main handler. That is the right fit
 * for auth — the pre-Phase-10.3 pattern of declaring `authorization`
 * as an optional header in the request schema was a "schema lie" (the
 * header was required in practice) and polluted the OpenAPI output.
 * `request.headers` should only describe business headers — idempotency
 * keys, tenant hints, etc. Cross-cutting auth lives here.
 */

import type { BeforeHandler, Infer } from '@triad/core';
import type { User } from './schemas/user.js';
import type { ApiError } from './schemas/common.js';

type UserValue = Infer<typeof User>;
type ApiErrorValue = Infer<typeof ApiError>;

/**
 * Extract the bearer token from an `Authorization: Bearer <token>`
 * header value, or `null` if the header is missing or malformed.
 * Exported so the `bookReviews` channel can reuse it in `onConnect`.
 */
export function parseBearer(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1]!.trim() : null;
}

/** Shape the `requireAuth` beforeHandler attaches to `ctx.state`. */
export type AuthState = { user: UserValue };

/**
 * We constrain the `TResponses` generic so every endpoint that uses
 * `requireAuth` is forced to declare a `401: { schema: ApiError }`
 * entry. Forgetting 401 becomes a compile error, not a runtime
 * surprise.
 */
type With401<TApiErrorSchema> = {
  401: { schema: TApiErrorSchema; description: string };
};

export const requireAuth: BeforeHandler<
  AuthState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  With401<any>
> = async (ctx) => {
  const headerValue = ctx.rawHeaders['authorization'];
  const token = parseBearer(headerValue);
  if (!token) {
    const error: ApiErrorValue = {
      code: 'UNAUTHENTICATED',
      message:
        'Missing or malformed Authorization header. Expected "Bearer <token>".',
    };
    return { ok: false, response: ctx.respond[401](error) };
  }
  const userId = ctx.services.tokenStore.lookup(token);
  if (!userId) {
    const error: ApiErrorValue = {
      code: 'UNAUTHENTICATED',
      message: 'Token is invalid or has been revoked.',
    };
    return { ok: false, response: ctx.respond[401](error) };
  }
  const user = await ctx.services.userRepo.findById(userId);
  if (!user) {
    const error: ApiErrorValue = {
      code: 'UNAUTHENTICATED',
      message: 'Token refers to a user that no longer exists.',
    };
    return { ok: false, response: ctx.respond[401](error) };
  }
  return { ok: true, state: { user } };
};
