/**
 * User schemas — the Accounts bounded context.
 *
 * `User` is the canonical response shape for an account. Notice what is
 * NOT on it: `passwordHash`. The wire representation of a user never
 * leaks the hash — it only exists as a column in the repository layer.
 * This is the "storage contract vs API contract" split Triad encourages.
 *
 * `RegisterInput` and `LoginInput` are flat `t.model`s rather than
 * value objects. A classic DDD analysis would say "(email, password) is
 * a value object", but wrapping them in `{credentials: {...}}` envelopes
 * would force every client into a nested body for no operational gain.
 * Developer ergonomics wins.
 *
 * `AuthResult` is a named `t.model` (not an inline shape) because
 * clients will reference it in their own TypeScript — it deserves a
 * stable OpenAPI component.
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
    .storage({ defaultNow: true, columnName: 'created_at' })
    .doc('When the account was created'),
});

export const RegisterInput = t.model('RegisterInput', {
  email: t.string().format('email').doc('Login email'),
  password: t.string().minLength(6).maxLength(200).doc('Plaintext password'),
  name: t.string().minLength(1).maxLength(100).doc('Display name'),
});

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
