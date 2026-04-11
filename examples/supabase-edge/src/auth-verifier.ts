/**
 * `AuthVerifier` — the service that turns a bearer token into a
 * `User` or `null`.
 *
 * Same split pattern as the repositories: one interface, two
 * concrete implementations.
 *
 *   - `MemoryAuthVerifier` (below) — used by tests. Accepts tokens
 *     of the form `test-<uuid>` (or whatever a test pre-registers
 *     via `register()`) and resolves them to a seeded `User`. No
 *     network, no JWT cryptography, no Supabase instance required.
 *   - `SupabaseAuthVerifier` (in `./auth-verifier-supabase.ts`) —
 *     used at deploy time. Calls `supabase.auth.getUser(token)` and
 *     maps the result to our `User` schema. Lives in a separate
 *     module so tests never even transitively import
 *     `@supabase/supabase-js`.
 *
 * Both implementations conform to the same one-method interface,
 * and both are injected into `ctx.services.authVerifier` where the
 * `requireAuth` beforeHandler can reach them.
 */

import type { Infer } from '@triad/core';
import type { User as UserSchema } from './schemas/user.js';

type User = Infer<typeof UserSchema>;

/**
 * The single-method contract every auth backend implements. Returns
 * the authenticated user on success or `null` if the token is
 * missing, malformed, expired, or otherwise unacceptable.
 */
export interface AuthVerifier {
  verify(token: string): Promise<User | null>;
}

// ---------------------------------------------------------------------------
// MemoryAuthVerifier — the test-only implementation
// ---------------------------------------------------------------------------

/**
 * A test-double `AuthVerifier` backed by an in-process `Map`. A test
 * scenario calls `.register(user)` during setup to seed a user and
 * get back a synthetic token; the scenario then sends that token in
 * the `Authorization` header and `requireAuth` resolves it back to
 * the seeded user.
 *
 * The token format (`test-<uuid>`) is deliberately distinct from a
 * real Supabase JWT (which starts with `eyJ...`) so you'd know at a
 * glance if a real JWT somehow ended up in this backend. Same idea
 * as the prefix some libraries use for mock keys (`sk_test_...`).
 */
export class MemoryAuthVerifier implements AuthVerifier {
  private readonly tokensToUsers = new Map<string, User>();

  async verify(token: string): Promise<User | null> {
    return this.tokensToUsers.get(token) ?? null;
  }

  /**
   * Seed a user and return a synthetic bearer token. Used by test
   * scenarios during `.setup(services)` to produce a valid token
   * the `.headers({ authorization: 'Bearer {token}' })` clause can
   * interpolate. Also used by the Node dev server (`npm run dev`)
   * to give a human an easy way to curl the API without running
   * a full Supabase stack locally.
   */
  register(user: User): string {
    const token = `test-${crypto.randomUUID()}`;
    this.tokensToUsers.set(token, user);
    return token;
  }

  async clear(): Promise<void> {
    this.tokensToUsers.clear();
  }
}
