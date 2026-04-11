/**
 * User schemas — the core of the Users bounded context.
 *
 * `User` is the canonical response shape. Notice that `passwordHash` is
 * **not** on `User` — the wire representation of a user never leaks the
 * hash, so it only exists as a column in the repository layer. This is
 * a good example of the "storage contract vs API contract" split Triad
 * encourages: the Drizzle `users` table has `password_hash`, but the
 * API-facing `User` model simply doesn't.
 *
 * `AuthResult` is the login/register success envelope: a user plus a
 * freshly minted token. We model it as a full `t.model` because it is
 * a first-class response shape clients will name in their own code.
 *
 * You might expect a `Credentials` value object here (email + password
 * has no identity and would be a textbook `t.value(...)`), but because
 * clients post `{email, password, name}` to `/auth/register` and
 * `{email, password}` to `/auth/login` as flat JSON objects, wrapping
 * them in a value object would force every client into
 * `{credentials: {...}}` envelope bodies. We chose developer ergonomics
 * over perfect DDD hygiene and kept them as plain `t.model` inputs.
 */

import { t } from '@triad/core';

export const User = t.model('User', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Unique user identifier'),
  email: t
    .string()
    .format('email')
    .storage({ unique: true, indexed: true })
    .doc('Contact / login email')
    .example('alice@example.com'),
  name: t.string().minLength(1).maxLength(100).doc('Display name'),
  createdAt: t
    .datetime()
    .storage({ defaultNow: true })
    .doc('When the account was created'),
});

/**
 * Registration input: email, password, and display name. Password is a
 * plain string on the wire; the repository hashes it before storage
 * (and the module-level docs for `src/auth.ts` explain why that hash
 * is deliberately simple).
 */
export const RegisterInput = t.model('RegisterInput', {
  email: t.string().format('email').doc('Login email'),
  password: t.string().minLength(6).maxLength(200).doc('Plaintext password'),
  name: t.string().minLength(1).maxLength(100).doc('Display name'),
});

/** Login input — just the credentials. */
export const LoginInput = t.model('LoginInput', {
  email: t.string().format('email').doc('Login email'),
  password: t.string().minLength(1).doc('Plaintext password'),
});

export const AuthResult = t.model('AuthResult', {
  user: User,
  token: t
    .string()
    .doc('Bearer token. Pass as "Authorization: Bearer <token>" on subsequent requests.'),
});
