/**
 * Authentication helpers.
 *
 * Phase 10.3 update: Triad now ships a first-class `beforeHandler`
 * extension point on `endpoint()`. It runs BEFORE request schema
 * validation, receives the raw request (headers/query/params/cookies),
 * and either short-circuits with a typed response or attaches typed
 * `state` that flows into `ctx.state` on the main handler.
 *
 * That is a much better fit for auth than the pre-10.3 pattern of a
 * helper called in every handler's first line — it removes the
 * three-line preamble, removes the schema lie that declared
 * `authorization` as `optional` so missing-auth could reach the
 * handler, and makes `ctx.state.user` typed without any runtime
 * narrowing at the call site.
 *
 * ## Password hashing
 *
 * `hashPassword` is a single SHA-256 pass over the password with a
 * static salt. **This is not safe for production.** Real apps must
 * use a memory-hard KDF like bcrypt or argon2. We use SHA-256 here
 * because it ships with Node (no extra dependency) and the point of
 * the example is to teach Triad's auth *flow*, not password storage.
 */

import { createHash } from 'node:crypto';
import type { BeforeHandler, Infer } from '@triadjs/core';
import type { User } from './schemas/user.js';
import type { ApiError } from './schemas/common.js';

type UserValue = Infer<typeof User>;
type ApiErrorValue = Infer<typeof ApiError>;

/**
 * Deliberately simple SHA-256 with a module-level salt. DO NOT ship
 * this to production — see the module-level comment.
 */
const STATIC_SALT = 'triad-tasktracker-demo-salt';

export function hashPassword(password: string): string {
  return createHash('sha256').update(password + STATIC_SALT).digest('hex');
}

export function verifyPassword(plaintext: string, hash: string): boolean {
  return hashPassword(plaintext) === hash;
}

// ---------------------------------------------------------------------------
// Authorization header parsing
// ---------------------------------------------------------------------------

/**
 * Extract the bearer token from an `Authorization: Bearer <token>`
 * header value, or `null` if the header is missing or malformed.
 */
export function parseBearer(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1]!.trim() : null;
}

// ---------------------------------------------------------------------------
// requireAuth — a reusable beforeHandler for protected endpoints
// ---------------------------------------------------------------------------

/**
 * Shape of the state `requireAuth` attaches to `ctx.state` on success.
 * Every protected endpoint reads `ctx.state.user` for the authenticated
 * user — fully typed, no runtime narrowing.
 */
export type AuthState = { user: UserValue };

/**
 * The response slot every protected endpoint must declare. We constrain
 * `requireAuth`'s `TResponses` generic to a `Record` that includes a
 * `401: { schema: ApiError }` entry — so forgetting to declare 401 is a
 * compile error, not a runtime surprise.
 */
type With401<TApiErrorSchema> = {
  401: { schema: TApiErrorSchema; description: string };
};

/**
 * Auth `beforeHandler` for the tasktracker. Reads the raw
 * `Authorization` header, validates the bearer token against the
 * `TokenStore`, loads the user, and either short-circuits with a
 * typed 401 `ApiError` or attaches the loaded user as `ctx.state.user`.
 *
 * Every protected endpoint uses this directly:
 *
 * ```ts
 * endpoint({
 *   // ...
 *   beforeHandler: requireAuth,
 *   responses: { 200: ..., 401: { schema: ApiError, description: '...' } },
 *   handler: async (ctx) => {
 *     ctx.state.user;  // typed — no .ok check, no unpack
 *   },
 * });
 * ```
 *
 * The generic `TResponses` is inferred at each use site so that the
 * short-circuit response's `ctx.respond[401](...)` is checked against
 * the caller's declared schema.
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
  const userId = ctx.services.tokens.lookup(token);
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
