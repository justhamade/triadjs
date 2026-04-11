/**
 * `SupabaseAuthVerifier` — the production `AuthVerifier`.
 *
 * Imported only by the Deno entry point. Calls
 * `supabase.auth.getUser(token)` under the hood, which:
 *
 *   1. Verifies the JWT signature against the project's signing key.
 *   2. Checks expiration.
 *   3. Returns the `auth.users` row for the token's subject, with
 *      the user's email and `user_metadata`.
 *
 * We extract `id`, `email`, and `user_metadata.name` into Triad's
 * `User` schema. Email MUST be present (Supabase guarantees it for
 * email-signin flows); `name` falls back to the local-part of the
 * email when the client didn't supply one on sign-up. If Supabase
 * hands us a user without an email (possible for phone-only or
 * custom OAuth flows), we treat the token as invalid — this example
 * is opinionated that a post author must have a stable email.
 *
 * ### A note on `getUser` cost
 *
 * `supabase.auth.getUser(token)` is a network round-trip — it does
 * NOT validate the JWT locally, it asks Supabase's auth server for
 * the canonical user record. That's safer than local validation
 * (it honors revoked tokens and deleted users) but it adds latency
 * to every authenticated request. Production deployments that can
 * tolerate slightly stale revocation SHOULD cache the verifier's
 * result for ~30 seconds keyed on the token. We don't ship a cache
 * here because caching behavior is a deployment concern, not a
 * framework concern — see `docs/guides/supabase.md` §4 for the
 * recommended pattern.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Infer } from '@triad/core';
import type { User as UserSchema } from './schemas/user.js';
import type { AuthVerifier } from './auth-verifier.js';

type User = Infer<typeof UserSchema>;

export class SupabaseAuthVerifier implements AuthVerifier {
  constructor(private readonly supabase: SupabaseClient) {}

  async verify(token: string): Promise<User | null> {
    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data.user) return null;

    const { id, email, user_metadata } = data.user;
    if (!email) {
      // Phone-only users or custom OAuth flows may not carry an email.
      // This example's domain model (posts, comments) treats email as
      // identity, so reject the token instead of inventing a value.
      return null;
    }

    // `user_metadata.name` is set by the client during sign-up. When
    // missing, fall back to the local-part of the email so handlers
    // always have a non-empty display name to render.
    const metadataName =
      typeof user_metadata?.['name'] === 'string'
        ? (user_metadata['name'] as string)
        : null;
    const name = metadataName ?? email.split('@')[0]!;

    return { id, email, name };
  }
}
