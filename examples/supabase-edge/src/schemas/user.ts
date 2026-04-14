/**
 * User schemas — the Auth bounded context.
 *
 * Unlike the tasktracker example, this application does NOT own its
 * user records. Registration, login, and password storage all live
 * inside Supabase Auth; our API only sees users as a by-product of a
 * valid JWT arriving on a request. That means:
 *
 *   - There is no `RegisterInput` / `LoginInput` / `AuthResult` trio
 *     here — those flows happen against Supabase's own `/auth/v1`
 *     endpoints (or via `supabase-js` on the client). Clients exchange
 *     credentials for a JWT with Supabase directly, then send the JWT
 *     to this API as `Authorization: Bearer <jwt>`.
 *   - `User` only carries the fields Supabase Auth will reliably
 *     populate for a confirmed session: a UUID `id`, an `email`, and
 *     a display `name` extracted from `user_metadata`. The backing
 *     storage for all of this is the `auth.users` table Supabase
 *     manages for you, not a table your migrations control.
 *
 * Keeping `User` as a lean API-facing model means the rest of the
 * codebase — endpoint responses, `ctx.state.user`, `loadOwnedPost` —
 * all speak Triad's ubiquitous language, not Supabase's internal one.
 * The mapping from Supabase's `User` type to our `User` model happens
 * in `src/auth-verifier-supabase.ts`.
 */

import { t } from '@triadjs/core';

export const User = t.model('User', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .doc('Supabase Auth user id (auth.users.id)'),
  email: t
    .string()
    .format('email')
    .doc('Contact / login email (from auth.users.email)')
    .example('alice@example.com'),
  name: t
    .string()
    .minLength(1)
    .maxLength(100)
    .doc('Display name (from user_metadata.name)'),
});
