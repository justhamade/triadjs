/**
 * Authentication helpers.
 *
 * ## Why this lives in a plain module instead of middleware
 *
 * Triad has no middleware concept by design — handlers are declarative
 * and the only "before/after" hook is the validation pipeline the
 * adapter runs. That's fine for small apps, but authentication touches
 * every protected endpoint, so some form of sharing is needed.
 *
 * The pattern we use is a plain async helper, `requireAuth(ctx)`, that
 * every protected handler calls in its first line. It returns a
 * discriminated union — either `{ ok: true, user }` on success or
 * `{ ok: false, response }` with a pre-built 401 envelope the handler
 * can return directly. The discriminated-union approach (as opposed to
 * throwing) keeps control flow visible at the call site and avoids any
 * need for a catch block in the adapter layer.
 *
 * This is one of the explicit gaps this example exercises: the lack of
 * middleware means every protected handler starts with an identical
 * three-line auth preamble. See `README.md` and the final report for
 * the friction notes.
 *
 * ## Password hashing
 *
 * `hashPassword` is a single SHA-256 pass over the password with a
 * static salt. **This is not safe for production.** Real apps must
 * use a memory-hard KDF like bcrypt or argon2 that resists brute-force
 * attacks on a stolen hash dump. We use SHA-256 here because:
 *
 *   - it ships with Node (no extra dependency), which keeps the
 *     example dep-light and easy for readers to run,
 *   - the point of the example is to teach Triad's auth *flow*, not
 *     password storage — swapping `hashPassword` for a bcrypt call is
 *     a five-line change once readers have bcrypt installed.
 */

import { createHash } from 'node:crypto';
import type { Infer } from '@triad/core';
import type { User } from './schemas/user.js';

type UserValue = Infer<typeof User>;
type ErrorBody = { code: string; message: string };

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
 *
 * `ctx.headers['authorization']` can technically be `string[]` under
 * some express configurations, but the header is declared in the
 * schema as `t.string().optional()` so the adapter has already
 * normalized it to `string | undefined` by the time it reaches us.
 */
export function parseBearer(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1]!.trim() : null;
}

// ---------------------------------------------------------------------------
// requireAuth helper — the shared auth preamble
// ---------------------------------------------------------------------------

/**
 * Context shape `requireAuth` needs. Typing it this loosely lets any
 * handler pass its own `ctx` in without dragging the full generic
 * `HandlerContext` parameter list through every call site.
 */
interface AuthableContext {
  headers: { authorization?: string } | Record<string, unknown>;
  services: {
    userRepo: { findById(id: string): Promise<UserValue | null> };
    tokens: { lookup(token: string): string | null };
  };
}

export type AuthResult =
  | { ok: true; user: UserValue }
  | { ok: false; error: ErrorBody };

/**
 * Resolve the authenticated user for a request, or return a ready-made
 * 401 error envelope.
 *
 * Usage:
 *
 * ```ts
 * const auth = await requireAuth(ctx);
 * if (!auth.ok) return ctx.respond[401](auth.error);
 * const user = auth.user;
 * ```
 *
 * Every protected handler in the example begins with exactly those
 * three lines. That repetition is the cost of Triad's no-middleware
 * stance — and a real gap worth surfacing.
 */
export async function requireAuth(ctx: AuthableContext): Promise<AuthResult> {
  const headerValue = (ctx.headers as Record<string, unknown>)['authorization'];
  const token = parseBearer(headerValue);
  if (!token) {
    return {
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Missing or malformed Authorization header. Expected "Bearer <token>".',
      },
    };
  }
  const userId = ctx.services.tokens.lookup(token);
  if (!userId) {
    return {
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: 'Token is invalid or has been revoked.' },
    };
  }
  const user = await ctx.services.userRepo.findById(userId);
  if (!user) {
    // The user was deleted but the token lingered. Treat as unauthenticated
    // rather than 500 — from the client's perspective the token just stopped
    // working.
    return {
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: 'Token refers to a user that no longer exists.' },
    };
  }
  return { ok: true, user };
}
