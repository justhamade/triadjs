/**
 * `requireAuth` — the Supabase-aware beforeHandler every protected
 * endpoint in this example uses.
 *
 * Same shape as `examples/tasktracker/src/auth.ts`, with three
 * Supabase-specific twists:
 *
 *   1. Tokens are verified through `ctx.services.authVerifier`, not
 *      a local `TokenStore`. The verifier is an interface with a
 *      memory backend (tests) and a Supabase backend (deploy),
 *      letting `requireAuth` stay ignorant of which one is wired up.
 *
 *   2. The memory backend returns a full `User` record directly, so
 *      there is no second lookup — contrast with the tasktracker's
 *      flow where a token resolves to a user ID that then has to
 *      be fetched from the user repository. With Supabase the JWT
 *      IS the lookup: it encodes the user's id and email, and the
 *      production verifier just reads them via `auth.getUser`.
 *
 *   3. The `AuthState` this hook attaches to `ctx.state` holds the
 *      Triad `User` schema type, not Supabase's richer `User` type.
 *      That keeps handlers speaking the ubiquitous language of the
 *      API instead of the implementation language of the auth
 *      provider — if you ever swap Supabase Auth for Auth0 or
 *      Clerk, only this file and the verifier need to move.
 */

import type { BeforeHandler, Infer } from '@triadjs/core';
import type { User as UserSchema } from './schemas/user.js';
import type { ApiError } from './schemas/common.js';

type UserValue = Infer<typeof UserSchema>;
type ApiErrorValue = Infer<typeof ApiError>;

/**
 * Shape of the state `requireAuth` attaches to `ctx.state.user` on
 * success. Protected handlers read it directly — fully typed, no
 * runtime narrowing.
 */
export type AuthState = { user: UserValue };

/**
 * Every protected endpoint MUST declare a 401 response slot with an
 * `ApiError` schema. Constraining `requireAuth`'s `TResponses`
 * generic to a record that includes `401` means forgetting to
 * declare it is a compile error, not a runtime surprise.
 */
type With401<TApiErrorSchema> = {
  401: { schema: TApiErrorSchema; description: string };
};

function parseBearer(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1]!.trim() : null;
}

/**
 * Supabase auth `beforeHandler`.
 *
 * Reads the raw `Authorization` header, delegates token verification
 * to `ctx.services.authVerifier`, and either short-circuits with a
 * typed 401 or attaches the resolved user as `ctx.state.user`.
 *
 * Usage at an endpoint site:
 *
 * ```ts
 * endpoint({
 *   // ...
 *   beforeHandler: requireAuth,
 *   responses: {
 *     200: { schema: ..., description: '...' },
 *     401: { schema: ApiError, description: 'Missing or invalid token' },
 *   },
 *   handler: async (ctx) => {
 *     ctx.state.user;  // typed — no .ok check, no unpack
 *   },
 * });
 * ```
 */
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
  const user = await ctx.services.authVerifier.verify(token);
  if (!user) {
    const error: ApiErrorValue = {
      code: 'UNAUTHENTICATED',
      message: 'Invalid or expired token.',
    };
    return { ok: false, response: ctx.respond[401](error) };
  }
  return { ok: true, state: { user } };
};
